<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { sectorApi, scoringTemplatesApi } from '@/services/api';
import PortfolioSelector from '@/components/PortfolioSelector.vue';
import { usePortfolioStore } from '@/stores/portfolio';
import type { SectorScoringProgress, SubSector, BatchJobMetadata, LlmSnapshotSummary, LlmSnapshotComparison, ModelComparisonResult } from '@/services/api';
import type { SuperSectorDetail, SectorDetail, SectorRule, SectorRuleType, RulePreviewResult } from '@/types';
import { useCpcDescriptions } from '@/composables/useCpcDescriptions';

// CPC description lookups for tooltips
const { getDescription, formatTooltip, preloadCodes } = useCpcDescriptions();
const portfolioStore = usePortfolioStore();

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const superSectors = ref<SuperSectorDetail[]>([]);
const selectedSectorId = ref<string | null>(null);
const selectedSector = ref<SectorDetail | null>(null);
const activeTab = ref('overview');
const loading = ref(false);
const treeLoading = ref(false);
const error = ref<string | null>(null);
const seedLoading = ref(false);
const recalcLoading = ref(false);

// Sub-sectors state - keyed by sector name
const subSectorsMap = ref<Record<string, SubSector[]>>({});
const subSectorsLoading = ref<Record<string, boolean>>({});
const expandedSectors = ref<Set<string>>(new Set());

// Add Rule dialog
const showAddRule = ref(false);
const newRule = ref({
  ruleType: 'CPC_PREFIX' as SectorRuleType,
  expression: '',
  priority: 0,
  isExclusion: false,
  scope: 'LIBRARY' as string,
  description: '',
});

// Preview dialog
const showPreview = ref(false);
const previewLoading = ref(false);
const previewResult = ref<RulePreviewResult | null>(null);
const previewRule = ref({
  ruleType: 'CPC_PREFIX' as SectorRuleType,
  expression: '',
});

// Add Sector dialog
const showAddSector = ref(false);
const newSector = ref({
  name: '',
  displayName: '',
  description: '',
  superSectorId: '',
});

// Add Super-Sector dialog
const showAddSuperSector = ref(false);
const newSuperSector = ref({
  name: '',
  displayName: '',
  description: '',
});

// LLM Scoring state
const scoringProgress = ref<SectorScoringProgress | null>(null);
const scoringLoading = ref(false);
const startScoringLoading = ref(false);
const scoringOptions = ref({
  useClaims: true,
  rescore: false,
  topN: 500,
  model: 'claude-sonnet-4-20250514',
});
const scoringError = ref<string | null>(null);

// Model options for dropdown
const modelOptions = [
  { label: 'Sonnet 4 (Default)', value: 'claude-sonnet-4-20250514' },
  { label: 'Haiku 4.5 (Cheap Triage)', value: 'claude-haiku-4-5-20251001' },
  { label: 'Opus 4.6 Batch (Deep Analysis)', value: 'claude-opus-4-6' },
];

// Batch jobs state
const batchJobs = ref<BatchJobMetadata[]>([]);
const batchJobsLoading = ref(false);
const batchProcessingId = ref<string | null>(null);
const batchCancellingId = ref<string | null>(null);
let batchPollInterval: ReturnType<typeof setInterval> | null = null;

// Snapshots state
const snapshots = ref<LlmSnapshotSummary[]>([]);
const snapshotsLoading = ref(false);
const createSnapshotLoading = ref(false);
const snapshotComparison = ref<LlmSnapshotComparison | null>(null);
const snapshotCompareLoading = ref(false);
const showSnapshotCompare = ref(false);

// Model comparison state
const modelCompareModels = ref<string[]>(['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001']);
const modelCompareSampleSize = ref(10);
const modelCompareLoading = ref(false);
const modelCompareResult = ref<ModelComparisonResult | null>(null);
const modelCompareError = ref<string | null>(null);

// Template Preview state
const templatePreviewPatentId = ref('');
const templatePreviewIncludeClaims = ref(true);
const templatePreviewLoading = ref(false);
const templatePreviewResult = ref<{
  patentId: string;
  patentTitle: string;
  renderedPrompt: string;
  estimatedTokens: number;
  questionCount: number;
  inheritanceChain: string[];
} | null>(null);
const templatePreviewError = ref<string | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────────────────────────────────────

const treeNodes = computed(() => {
  return superSectors.value.map(ss => ({
    id: `ss-${ss.id}`,
    label: ss.displayName,
    icon: 'folder',
    selectable: false,
    children: ss.sectors.map(s => ({
      id: s.id,
      label: s.displayName,
      icon: 'label',
      badge: s.patentCount,
      ruleCount: s._count?.rules ?? 0,
    })),
  }));
});

const totalPatents = computed(() => {
  return superSectors.value.reduce(
    (sum, ss) => sum + ss.sectors.reduce((s2, s) => s2 + s.patentCount, 0),
    0
  );
});

const ruleTypeOptions = [
  { label: 'CPC Prefix', value: 'CPC_PREFIX' },
  { label: 'CPC Subgroup', value: 'CPC_SUBGROUP' },
  { label: 'Keyword', value: 'KEYWORD' },
  { label: 'Phrase', value: 'PHRASE' },
  { label: 'Keyword AND', value: 'KEYWORD_AND' },
  { label: 'Boolean', value: 'BOOLEAN' },
];

const scopeOptions = [
  { label: 'Library (all portfolios)', value: 'LIBRARY' },
  { label: 'Portfolio-specific', value: 'PORTFOLIO' },
];

const superSectorOptions = computed(() =>
  superSectors.value.map(ss => ({ label: ss.displayName, value: ss.id }))
);

const activeRules = computed(() =>
  selectedSector.value?.rules?.filter(r => r.isActive) || []
);

const inactiveRules = computed(() =>
  selectedSector.value?.rules?.filter(r => !r.isActive) || []
);

// ─────────────────────────────────────────────────────────────────────────────
// Data Loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadTree() {
  treeLoading.value = true;
  try {
    superSectors.value = await sectorApi.getSuperSectors();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load sectors';
  } finally {
    treeLoading.value = false;
  }
}

async function loadSectorDetail(id: string) {
  loading.value = true;
  error.value = null;
  try {
    selectedSector.value = await sectorApi.getSector(id);

    // Preload CPC descriptions for tooltips
    const cpcCodes: string[] = [];
    if (selectedSector.value.cpcPrefixes) {
      cpcCodes.push(...selectedSector.value.cpcPrefixes);
    }
    if (selectedSector.value.rules) {
      for (const rule of selectedSector.value.rules) {
        if (rule.ruleType === 'CPC_PREFIX' || rule.ruleType === 'CPC_SUBGROUP') {
          cpcCodes.push(rule.expression);
        }
      }
    }
    if (cpcCodes.length > 0) {
      preloadCodes(cpcCodes);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load sector';
  } finally {
    loading.value = false;
  }
}

function onNodeSelect(nodeId: string) {
  if (nodeId.startsWith('ss-')) return; // Don't select super-sectors
  selectedSectorId.value = nodeId;
  loadSectorDetail(nodeId);
}

async function loadSubSectors(sectorName: string) {
  if (subSectorsLoading.value[sectorName]) return;
  subSectorsLoading.value[sectorName] = true;
  try {
    const subSectors = await sectorApi.getSubSectors(sectorName);
    subSectorsMap.value[sectorName] = subSectors;

    // Preload CPC descriptions for sub-sector tooltips
    const cpcCodes: string[] = [];
    for (const ss of subSectors) {
      if (ss.cpcCode) cpcCodes.push(ss.cpcCode);
      if (ss.cpcPrefix) cpcCodes.push(ss.cpcPrefix);
    }
    if (cpcCodes.length > 0) {
      preloadCodes(cpcCodes);
    }
  } catch (err) {
    console.error(`Failed to load sub-sectors for ${sectorName}:`, err);
    subSectorsMap.value[sectorName] = [];
  } finally {
    subSectorsLoading.value[sectorName] = false;
  }
}

function toggleSectorExpansion(sectorName: string) {
  if (expandedSectors.value.has(sectorName)) {
    expandedSectors.value.delete(sectorName);
  } else {
    expandedSectors.value.add(sectorName);
    // Load sub-sectors if not already loaded
    if (!subSectorsMap.value[sectorName]) {
      loadSubSectors(sectorName);
    }
  }
}

function hasSubSectors(sectorName: string): boolean {
  return (subSectorsMap.value[sectorName]?.length ?? 0) > 0;
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'APPLIED': return 'green-7';
    case 'PROSPECTIVE': return 'blue-7';
    case 'REJECTED': return 'grey-6';
    default: return 'grey-5';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

async function seedFromConfig() {
  seedLoading.value = true;
  try {
    const result = await sectorApi.seed();
    await loadTree();
    error.value = null;
    alert(`Seeded: ${result.superSectors} super-sectors, ${result.sectors} sectors, ${result.cpcRules} CPC rules, ${result.keywordRules} keyword rules`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Seed failed';
  } finally {
    seedLoading.value = false;
  }
}

async function recalculateCount() {
  if (!selectedSectorId.value) return;
  recalcLoading.value = true;
  try {
    const result = await sectorApi.recalculateSector(selectedSectorId.value);
    if (selectedSector.value) {
      selectedSector.value.patentCount = result.patentCount;
    }
    await loadTree();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Recalculate failed';
  } finally {
    recalcLoading.value = false;
  }
}

// Rule CRUD
async function addRule() {
  if (!selectedSectorId.value) return;
  try {
    await sectorApi.addRule(selectedSectorId.value, {
      ruleType: newRule.value.ruleType,
      expression: newRule.value.expression,
      priority: newRule.value.priority,
      isExclusion: newRule.value.isExclusion,
      scope: newRule.value.scope,
      description: newRule.value.description || undefined,
    });
    showAddRule.value = false;
    resetNewRule();
    await loadSectorDetail(selectedSectorId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add rule';
  }
}

function resetNewRule() {
  newRule.value = {
    ruleType: 'CPC_PREFIX',
    expression: '',
    priority: 0,
    isExclusion: false,
    scope: 'LIBRARY',
    description: '',
  };
}

async function toggleRuleActive(rule: SectorRule) {
  if (!selectedSectorId.value) return;
  try {
    await sectorApi.updateRule(selectedSectorId.value, rule.id, {
      isActive: !rule.isActive,
    });
    await loadSectorDetail(selectedSectorId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to toggle rule';
  }
}

async function deleteRule(rule: SectorRule) {
  if (!selectedSectorId.value) return;
  if (!confirm(`Delete rule "${rule.expression}"?`)) return;
  try {
    await sectorApi.deleteRule(selectedSectorId.value, rule.id);
    await loadSectorDetail(selectedSectorId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete rule';
  }
}

async function promoteRule(rule: SectorRule) {
  try {
    await sectorApi.promoteRule(rule.id);
    if (selectedSectorId.value) {
      await loadSectorDetail(selectedSectorId.value);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to promote rule';
  }
}

// Preview
async function doPreview() {
  if (!selectedSectorId.value) return;
  previewLoading.value = true;
  try {
    previewResult.value = await sectorApi.previewRule({
      ruleType: previewRule.value.ruleType,
      expression: previewRule.value.expression,
      sectorId: selectedSectorId.value,
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Preview failed';
  } finally {
    previewLoading.value = false;
  }
}

function openPreviewForRule(rule: SectorRule) {
  previewRule.value = {
    ruleType: rule.ruleType,
    expression: rule.expression,
  };
  previewResult.value = null;
  showPreview.value = true;
  doPreview();
}

function openPreviewNew() {
  previewRule.value = {
    ruleType: newRule.value.ruleType,
    expression: newRule.value.expression,
  };
  previewResult.value = null;
  showPreview.value = true;
  if (previewRule.value.expression) {
    doPreview();
  }
}

// Sector CRUD
async function addSector() {
  try {
    const created = await sectorApi.createSector({
      name: newSector.value.name,
      displayName: newSector.value.displayName,
      description: newSector.value.description || undefined,
      superSectorId: newSector.value.superSectorId || undefined,
    });
    showAddSector.value = false;
    newSector.value = { name: '', displayName: '', description: '', superSectorId: '' };
    await loadTree();
    selectedSectorId.value = created.id;
    await loadSectorDetail(created.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create sector';
  }
}

async function deleteSector() {
  if (!selectedSectorId.value || !selectedSector.value) return;
  if (!confirm(`Delete sector "${selectedSector.value.displayName}" and all its rules?`)) return;
  try {
    await sectorApi.deleteSector(selectedSectorId.value);
    selectedSectorId.value = null;
    selectedSector.value = null;
    await loadTree();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete sector';
  }
}

// Super-sector CRUD
async function addSuperSector() {
  try {
    await sectorApi.createSuperSector({
      name: newSuperSector.value.name,
      displayName: newSuperSector.value.displayName,
      description: newSuperSector.value.description || undefined,
    });
    showAddSuperSector.value = false;
    newSuperSector.value = { name: '', displayName: '', description: '' };
    await loadTree();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create super-sector';
  }
}

// LLM Scoring
async function loadScoringProgress() {
  if (!selectedSector.value) return;
  scoringLoading.value = true;
  scoringError.value = null;
  try {
    scoringProgress.value = await scoringTemplatesApi.getSectorProgress(selectedSector.value.name);
  } catch (err) {
    scoringError.value = err instanceof Error ? err.message : 'Failed to load scoring progress';
  } finally {
    scoringLoading.value = false;
  }
}

async function startScoring() {
  if (!selectedSector.value) return;
  startScoringLoading.value = true;
  scoringError.value = null;
  try {
    const result = await scoringTemplatesApi.batchScoreSector(selectedSector.value.name, {
      useClaims: scoringOptions.value.useClaims,
      rescore: scoringOptions.value.rescore,
      topN: scoringOptions.value.topN || undefined,
      model: scoringOptions.value.model,
    });
    // Reload batch jobs to show the new job
    await loadBatchJobs();
    startBatchPoll();
  } catch (err) {
    scoringError.value = err instanceof Error ? err.message : 'Failed to submit batch scoring';
  } finally {
    startScoringLoading.value = false;
  }
}

// Batch jobs
async function loadBatchJobs() {
  batchJobsLoading.value = true;
  try {
    const result = await scoringTemplatesApi.getBatchJobs();
    // Filter to this sector's jobs
    const sectorName = selectedSector.value?.name;
    batchJobs.value = sectorName
      ? result.jobs.filter(j => j.sectorName === sectorName)
      : result.jobs;
  } catch (err) {
    console.error('Failed to load batch jobs:', err);
  } finally {
    batchJobsLoading.value = false;
  }
}

async function processBatchResults(batchId: string) {
  batchProcessingId.value = batchId;
  try {
    await scoringTemplatesApi.processBatchResults(batchId);
    await loadBatchJobs();
    await loadScoringProgress();
  } catch (err) {
    scoringError.value = err instanceof Error ? err.message : 'Failed to process batch results';
  } finally {
    batchProcessingId.value = null;
  }
}

async function cancelBatchJob(batchId: string) {
  batchCancellingId.value = batchId;
  try {
    await scoringTemplatesApi.cancelBatch(batchId);
    await loadBatchJobs();
  } catch (err) {
    scoringError.value = err instanceof Error ? err.message : 'Failed to cancel batch';
  } finally {
    batchCancellingId.value = null;
  }
}

function startBatchPoll() {
  stopBatchPoll();
  batchPollInterval = setInterval(async () => {
    const hasActive = batchJobs.value.some(j => j.status === 'submitted' || j.status === 'in_progress');
    if (hasActive) {
      await loadBatchJobs();
    } else {
      stopBatchPoll();
    }
  }, 30000);
}

function stopBatchPoll() {
  if (batchPollInterval) {
    clearInterval(batchPollInterval);
    batchPollInterval = null;
  }
}

function batchStatusColor(status: string): string {
  switch (status) {
    case 'ended': return 'positive';
    case 'in_progress': return 'primary';
    case 'submitted': return 'info';
    case 'failed': return 'negative';
    default: return 'grey';
  }
}

function truncateBatchId(id: string): string {
  return id.length > 20 ? id.substring(0, 8) + '...' + id.substring(id.length - 8) : id;
}

function formatDate(date: string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function modelLabel(modelId: string): string {
  const opt = modelOptions.find(o => o.value === modelId);
  if (opt) return opt.label;
  if (modelId.includes('haiku')) return 'Haiku';
  if (modelId.includes('opus')) return 'Opus';
  if (modelId.includes('sonnet')) return 'Sonnet';
  return modelId;
}

// Snapshots
async function loadSnapshots() {
  if (!selectedSector.value) return;
  snapshotsLoading.value = true;
  try {
    snapshots.value = await scoringTemplatesApi.getLlmSnapshots(selectedSector.value.name);
  } catch (err) {
    console.error('Failed to load snapshots:', err);
  } finally {
    snapshotsLoading.value = false;
  }
}

async function createSnapshot() {
  if (!selectedSector.value) return;
  createSnapshotLoading.value = true;
  try {
    await scoringTemplatesApi.createLlmSnapshot(selectedSector.value.name);
    await loadSnapshots();
  } catch (err) {
    scoringError.value = err instanceof Error ? err.message : 'Failed to create snapshot';
  } finally {
    createSnapshotLoading.value = false;
  }
}

async function compareSnapshot(snapshotId: string) {
  snapshotCompareLoading.value = true;
  snapshotComparison.value = null;
  showSnapshotCompare.value = true;
  try {
    snapshotComparison.value = await scoringTemplatesApi.compareLlmSnapshot(snapshotId);
  } catch (err) {
    scoringError.value = err instanceof Error ? err.message : 'Failed to compare snapshot';
  } finally {
    snapshotCompareLoading.value = false;
  }
}

// Model comparison
async function runModelComparison() {
  if (!selectedSector.value) return;
  modelCompareLoading.value = true;
  modelCompareError.value = null;
  modelCompareResult.value = null;
  try {
    modelCompareResult.value = await scoringTemplatesApi.compareModels(
      selectedSector.value.name,
      { models: modelCompareModels.value, sampleSize: modelCompareSampleSize.value }
    );
  } catch (err) {
    modelCompareError.value = err instanceof Error ? err.message : 'Failed to run model comparison';
  } finally {
    modelCompareLoading.value = false;
  }
}

async function previewTemplate() {
  if (!selectedSector.value || !templatePreviewPatentId.value) return;
  templatePreviewLoading.value = true;
  templatePreviewError.value = null;
  templatePreviewResult.value = null;
  try {
    const result = await scoringTemplatesApi.previewPrompt({
      patentId: templatePreviewPatentId.value.trim(),
      sectorName: selectedSector.value.name,
      includeClaims: templatePreviewIncludeClaims.value,
    });
    templatePreviewResult.value = {
      patentId: result.patentId,
      patentTitle: result.patentTitle,
      renderedPrompt: result.renderedPrompt,
      estimatedTokens: result.estimatedTokens,
      questionCount: result.questionCount || 0,
      inheritanceChain: result.inheritanceChain || [],
    };
  } catch (err) {
    templatePreviewError.value = err instanceof Error ? err.message : 'Failed to preview template';
  } finally {
    templatePreviewLoading.value = false;
  }
}

// Helpers
function ruleTypeLabel(type: string): string {
  return ruleTypeOptions.find(o => o.value === type)?.label || type;
}

function damagesColor(rating: number | null | undefined): string {
  switch (rating) {
    case 4: return 'red-7';
    case 3: return 'orange-7';
    case 2: return 'blue-7';
    case 1: return 'grey-6';
    default: return 'grey-4';
  }
}

function damagesLabel(rating: number | null | undefined): string {
  switch (rating) {
    case 4: return 'Very High';
    case 3: return 'High';
    case 2: return 'Medium';
    case 1: return 'Low';
    default: return 'N/A';
  }
}

function getSuperSectorIcon(name: string): string {
  const icons: Record<string, string> = {
    VIDEO_STREAMING: 'videocam',
    AI_ML: 'psychology',
    IMAGING: 'camera',
    NETWORKING: 'lan',
    COMPUTING: 'computer',
    STORAGE: 'storage',
    WIRELESS: 'wifi',
    MEDIA: 'perm_media',
    SEMICONDUCTOR: 'memory',
    INTERFACE: 'settings_input_component',
    SECURITY: 'security',
  };
  return icons[name] || 'layers';
}

function getSectorIcon(name: string): string {
  // Map specific sectors to meaningful icons
  if (name.includes('video')) return 'movie';
  if (name.includes('codec')) return 'theaters';
  if (name.includes('network')) return 'hub';
  if (name.includes('wireless') || name.includes('antenna')) return 'cell_tower';
  if (name.includes('security') || name.includes('auth') || name.includes('crypto')) return 'lock';
  if (name.includes('memory') || name.includes('storage')) return 'sd_storage';
  if (name.includes('power')) return 'bolt';
  if (name.includes('audio') || name.includes('acoustic')) return 'graphic_eq';
  if (name.includes('image') || name.includes('camera') || name.includes('optic')) return 'image';
  if (name.includes('ai') || name.includes('ml')) return 'model_training';
  if (name.includes('compute') || name.includes('runtime')) return 'dns';
  return 'grain';
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

onMounted(() => {
  loadTree();
});

onUnmounted(() => {
  stopBatchPoll();
});

// Load scoring progress + batch jobs when switching to LLM Scoring tab
watch(activeTab, (newTab) => {
  if (newTab === 'llm-scoring' && selectedSector.value) {
    if (!scoringProgress.value) loadScoringProgress();
    loadBatchJobs();
    loadSnapshots();
    // Start polling if there are active jobs
    const hasActive = batchJobs.value.some(j => j.status === 'submitted' || j.status === 'in_progress');
    if (hasActive) startBatchPoll();
  } else {
    stopBatchPoll();
  }
});

// Reset scoring progress when sector changes
watch(selectedSectorId, () => {
  scoringProgress.value = null;
  scoringError.value = null;
  batchJobs.value = [];
  snapshots.value = [];
  snapshotComparison.value = null;
  modelCompareResult.value = null;
  stopBatchPoll();
});
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="col">
        <div class="row items-center q-gutter-sm q-mb-none">
      <div class="text-h5">Sector Management</div>
      <PortfolioSelector />
    </div>
        <div class="text-caption text-grey-7">
          {{ superSectors.length }} super-sectors &middot;
          {{ superSectors.reduce((s, ss) => s + ss.sectors.length, 0) }} sectors &middot;
          {{ totalPatents.toLocaleString() }} patents
        </div>
      </div>
      <div class="col-auto q-gutter-sm">
        <q-btn
          outline
          color="primary"
          label="Seed from Config"
          icon="cloud_download"
          :loading="seedLoading"
          @click="seedFromConfig"
        />
      </div>
    </div>

    <!-- Error banner -->
    <q-banner v-if="error" class="bg-red-1 text-red-9 q-mb-md" rounded>
      {{ error }}
      <template #action>
        <q-btn flat label="Dismiss" @click="error = null" />
      </template>
    </q-banner>

    <!-- Main Layout: Tree + Detail -->
    <div class="row q-col-gutter-md">
      <!-- Left: Tree Navigation (fixed height with scroll) -->
      <div class="col-12 col-md-3">
        <q-card flat bordered class="sector-tree-card">
          <q-card-section class="q-pb-none">
            <div class="text-subtitle2">Portfolio Hierarchy</div>
          </q-card-section>

          <q-card-section class="sector-tree-scroll">
            <q-inner-loading :showing="treeLoading" />

            <q-list v-if="!treeLoading" dense>
              <template v-for="ss in superSectors" :key="ss.id">
                <q-expansion-item
                  :label="ss.displayName"
                  :caption="`${ss.sectors.length} sectors`"
                  :icon="getSuperSectorIcon(ss.name)"
                  default-opened
                  dense
                  header-class="text-weight-medium bg-grey-1"
                >
                  <template v-for="sector in ss.sectors" :key="sector.id">
                    <!-- Sector item with expansion for sub-sectors -->
                    <q-item
                      clickable
                      v-ripple
                      :active="selectedSectorId === sector.id"
                      active-class="bg-primary text-white"
                      class="q-pl-lg"
                      @click="onNodeSelect(sector.id)"
                    >
                      <q-item-section avatar>
                        <q-icon :name="getSectorIcon(sector.name)" size="xs" :color="selectedSectorId === sector.id ? 'white' : 'grey-7'" />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label :class="{ 'text-white': selectedSectorId === sector.id }">
                          {{ sector.displayName }}
                        </q-item-label>
                        <q-item-label caption :class="{ 'text-blue-2': selectedSectorId === sector.id }">
                          {{ sector.patentCount?.toLocaleString() || 0 }} patents
                        </q-item-label>
                      </q-item-section>
                      <q-item-section side>
                        <q-btn
                          flat
                          dense
                          round
                          size="xs"
                          :icon="expandedSectors.has(sector.name) ? 'expand_less' : 'expand_more'"
                          :loading="subSectorsLoading[sector.name]"
                          @click.stop="toggleSectorExpansion(sector.name)"
                        >
                          <q-tooltip>{{ expandedSectors.has(sector.name) ? 'Hide' : 'Show' }} sub-sectors</q-tooltip>
                        </q-btn>
                      </q-item-section>
                    </q-item>

                    <!-- Sub-sectors (expandable) -->
                    <q-slide-transition>
                      <div v-if="expandedSectors.has(sector.name)">
                        <q-inner-loading :showing="subSectorsLoading[sector.name]" size="xs" />
                        <template v-if="subSectorsMap[sector.name]?.length">
                          <q-item
                            v-for="subSector in subSectorsMap[sector.name]"
                            :key="subSector.id"
                            dense
                            class="q-pl-xl sub-sector-item"
                          >
                            <q-item-section avatar>
                              <q-icon name="subdirectory_arrow_right" size="xs" color="grey-5" />
                            </q-item-section>
                            <q-item-section>
                              <q-item-label class="text-caption">
                                {{ subSector.displayName }}
                                <q-tooltip
                                  v-if="subSector.cpcCode && getDescription(subSector.cpcCode)"
                                  :delay="200"
                                >
                                  {{ formatTooltip(subSector.cpcCode) }}
                                </q-tooltip>
                                <q-tooltip
                                  v-else-if="subSector.cpcPrefix && getDescription(subSector.cpcPrefix)"
                                  :delay="200"
                                >
                                  {{ formatTooltip(subSector.cpcPrefix) }}
                                </q-tooltip>
                              </q-item-label>
                              <q-item-label caption>
                                {{ subSector.patentCount?.toLocaleString() || 0 }} patents
                              </q-item-label>
                            </q-item-section>
                            <q-item-section side>
                              <q-badge
                                :color="getStatusColor(subSector.status)"
                                :label="subSector.status"
                                dense
                                class="text-caption"
                              />
                            </q-item-section>
                          </q-item>
                        </template>
                        <q-item v-else-if="!subSectorsLoading[sector.name]" dense class="q-pl-xl">
                          <q-item-section>
                            <q-item-label caption class="text-grey-6">
                              No sub-sectors defined
                            </q-item-label>
                          </q-item-section>
                        </q-item>
                      </div>
                    </q-slide-transition>
                  </template>
                </q-expansion-item>
              </template>
            </q-list>
          </q-card-section>

          <q-separator />
          <q-card-actions>
            <q-btn flat dense size="sm" icon="add" label="Super-Sector" @click="showAddSuperSector = true" />
            <q-btn flat dense size="sm" icon="add" label="Sector" @click="showAddSector = true" />
          </q-card-actions>
        </q-card>
      </div>

      <!-- Right: Detail Panel -->
      <div class="col-12 col-md-9">
        <q-card v-if="!selectedSector" flat bordered class="text-center q-pa-xl">
          <q-icon name="category" size="64px" color="grey-4" />
          <div class="text-grey-6 q-mt-md">Select a sector to view details</div>
        </q-card>

        <q-card v-else flat bordered>
          <q-inner-loading :showing="loading" />

          <!-- Sector Header -->
          <q-card-section>
            <div class="row items-center">
              <div class="col">
                <div class="text-h6">{{ selectedSector.displayName }}</div>
                <div class="text-caption text-grey-7">
                  {{ selectedSector.name }}
                  <span v-if="selectedSector.superSector">
                    &middot; {{ selectedSector.superSector.displayName }}
                  </span>
                </div>
              </div>
              <div class="col-auto q-gutter-sm">
                <q-badge
                  :color="damagesColor(selectedSector.damagesRating)"
                  :label="damagesLabel(selectedSector.damagesRating)"
                />
                <q-badge color="primary" :label="`${selectedSector.patentCount} patents`" />
                <q-btn
                  flat
                  dense
                  icon="delete"
                  color="red"
                  size="sm"
                  @click="deleteSector"
                >
                  <q-tooltip>Delete sector</q-tooltip>
                </q-btn>
              </div>
            </div>
          </q-card-section>

          <q-separator />

          <!-- Tabs -->
          <q-tabs v-model="activeTab" dense align="left" class="bg-grey-1">
            <q-tab name="overview" label="Overview" icon="info" />
            <q-tab name="rules" label="Rules" icon="rule" :badge="selectedSector.rules?.length" />
            <q-tab name="patents" label="Patents" icon="description" />
            <q-tab name="llm-scoring" label="LLM Scoring" icon="psychology" />
          </q-tabs>

          <q-separator />

          <q-tab-panels v-model="activeTab" animated>
            <!-- Overview Tab -->
            <q-tab-panel name="overview">
              <div class="row q-col-gutter-md">
                <div class="col-12 col-sm-6">
                  <div class="text-subtitle2 q-mb-sm">Description</div>
                  <div class="text-body2">
                    {{ selectedSector.description || 'No description' }}
                  </div>
                </div>
                <div class="col-12 col-sm-6">
                  <div class="text-subtitle2 q-mb-sm">Metadata</div>
                  <q-list dense>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Damages Tier</q-item-label>
                        <q-item-label>{{ selectedSector.damagesTier || 'N/A' }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Damages Rating</q-item-label>
                        <q-item-label>{{ selectedSector.damagesRating ?? 'N/A' }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>CPC Prefixes</q-item-label>
                        <q-item-label>
                          <q-chip
                            v-for="cpc in selectedSector.cpcPrefixes"
                            :key="cpc"
                            dense
                            size="sm"
                            color="grey-3"
                          >
                            {{ cpc }}
                            <q-tooltip v-if="getDescription(cpc)" :delay="200">
                              {{ formatTooltip(cpc) }}
                            </q-tooltip>
                          </q-chip>
                          <span v-if="!selectedSector.cpcPrefixes.length" class="text-grey-6">None</span>
                        </q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Patent Count</q-item-label>
                        <q-item-label>{{ selectedSector.patentCount }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Rules</q-item-label>
                        <q-item-label>{{ selectedSector.rules?.length ?? 0 }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </div>
              </div>

              <!-- Facets -->
              <div v-if="selectedSector.facets && Object.keys(selectedSector.facets).length" class="q-mt-md">
                <div class="text-subtitle2 q-mb-sm">Scoring Facets</div>
                <div class="row q-col-gutter-sm">
                  <div
                    v-for="(val, key) in selectedSector.facets"
                    :key="key"
                    class="col-auto"
                  >
                    <q-chip dense>
                      {{ key }}: {{ val }}
                    </q-chip>
                  </div>
                </div>
              </div>
            </q-tab-panel>

            <!-- Rules Tab -->
            <q-tab-panel name="rules">
              <div class="row items-center q-mb-md">
                <div class="col text-subtitle2">
                  Active Rules ({{ activeRules.length }})
                </div>
                <div class="col-auto q-gutter-sm">
                  <q-btn
                    outline
                    size="sm"
                    icon="calculate"
                    label="Recalculate Count"
                    :loading="recalcLoading"
                    @click="recalculateCount"
                  />
                  <q-btn
                    color="primary"
                    size="sm"
                    icon="add"
                    label="Add Rule"
                    @click="showAddRule = true"
                  />
                </div>
              </div>

              <!-- Rules Table -->
              <q-table
                :rows="selectedSector.rules || []"
                :columns="[
                  { name: 'ruleType', label: 'Type', field: 'ruleType', align: 'left', sortable: true,
                    format: (v: string) => ruleTypeLabel(v) },
                  { name: 'expression', label: 'Expression', field: 'expression', align: 'left', sortable: true },
                  { name: 'priority', label: 'Priority', field: 'priority', align: 'center', sortable: true },
                  { name: 'scope', label: 'Scope', field: 'scope', align: 'center', sortable: true },
                  { name: 'matchCount', label: 'Matches', field: 'matchCount', align: 'center', sortable: true },
                  { name: 'isActive', label: 'Active', field: 'isActive', align: 'center' },
                  { name: 'actions', label: '', field: 'id', align: 'right' },
                ]"
                row-key="id"
                flat
                dense
                :pagination="{ rowsPerPage: 50 }"
                hide-bottom
              >
                <template #body-cell-expression="props">
                  <q-td :props="props">
                    <code class="text-body2">{{ props.row.expression }}</code>
                    <q-tooltip
                      v-if="(props.row.ruleType === 'CPC_PREFIX' || props.row.ruleType === 'CPC_SUBGROUP') && getDescription(props.row.expression)"
                      :delay="200"
                    >
                      {{ formatTooltip(props.row.expression) }}
                    </q-tooltip>
                    <q-icon
                      v-if="props.row.isExclusion"
                      name="block"
                      color="red"
                      size="xs"
                      class="q-ml-xs"
                    >
                      <q-tooltip>Exclusion rule</q-tooltip>
                    </q-icon>
                  </q-td>
                </template>

                <template #body-cell-scope="props">
                  <q-td :props="props">
                    <q-badge
                      :color="props.row.scope === 'LIBRARY' ? 'blue-7' : 'orange-7'"
                      :label="props.row.scope"
                      dense
                    />
                  </q-td>
                </template>

                <template #body-cell-isActive="props">
                  <q-td :props="props">
                    <q-toggle
                      :model-value="props.row.isActive"
                      dense
                      @update:model-value="toggleRuleActive(props.row)"
                    />
                  </q-td>
                </template>

                <template #body-cell-actions="props">
                  <q-td :props="props">
                    <q-btn
                      flat
                      dense
                      round
                      size="sm"
                      icon="visibility"
                      @click="openPreviewForRule(props.row)"
                    >
                      <q-tooltip>Preview matches</q-tooltip>
                    </q-btn>
                    <q-btn
                      v-if="props.row.scope === 'PORTFOLIO'"
                      flat
                      dense
                      round
                      size="sm"
                      icon="publish"
                      color="green"
                      @click="promoteRule(props.row)"
                    >
                      <q-tooltip>Promote to Library</q-tooltip>
                    </q-btn>
                    <q-btn
                      flat
                      dense
                      round
                      size="sm"
                      icon="delete"
                      color="red"
                      @click="deleteRule(props.row)"
                    >
                      <q-tooltip>Delete rule</q-tooltip>
                    </q-btn>
                  </q-td>
                </template>
              </q-table>
            </q-tab-panel>

            <!-- Patents Tab -->
            <q-tab-panel name="patents">
              <div class="text-body2 text-grey-7">
                This sector contains <strong>{{ selectedSector.patentCount }}</strong> patents
                based on the current portfolio data.
              </div>
              <div class="q-mt-md">
                <q-btn
                  outline
                  size="sm"
                  icon="calculate"
                  label="Recalculate Patent Count"
                  :loading="recalcLoading"
                  @click="recalculateCount"
                />
              </div>
            </q-tab-panel>

            <!-- LLM Scoring Tab -->
            <q-tab-panel name="llm-scoring">
              <q-inner-loading :showing="scoringLoading" />

              <!-- Scoring Progress Card -->
              <q-card flat bordered class="q-mb-md">
                <q-card-section>
                  <div class="text-subtitle2">Scoring Progress</div>
                </q-card-section>
                <q-separator />
                <q-card-section v-if="scoringProgress">
                  <div class="row q-col-gutter-md">
                    <div class="col-6 col-sm-2">
                      <div class="text-caption text-grey-7">Total Patents</div>
                      <div class="text-h6">{{ scoringProgress.total }}</div>
                    </div>
                    <div class="col-6 col-sm-2">
                      <div class="text-caption text-grey-7">Scored</div>
                      <div class="text-h6 text-positive">{{ scoringProgress.scored }}</div>
                    </div>
                    <div class="col-6 col-sm-2">
                      <div class="text-caption text-grey-7">With Claims</div>
                      <div class="text-h6 text-primary">{{ scoringProgress.withClaims }}</div>
                    </div>
                    <div class="col-6 col-sm-2">
                      <div class="text-caption text-grey-7">Remaining</div>
                      <div class="text-h6 text-grey-7">{{ scoringProgress.remaining }}</div>
                    </div>
                    <div class="col-6 col-sm-2">
                      <div class="text-caption text-grey-7">Avg Score</div>
                      <div class="text-h6 text-secondary">{{ scoringProgress.avgScore?.toFixed(1) || '-' }}</div>
                    </div>
                  </div>

                  <div class="q-mt-md">
                    <q-linear-progress
                      :value="scoringProgress.percentComplete / 100"
                      size="lg"
                      color="primary"
                      track-color="grey-3"
                      rounded
                    >
                      <div class="absolute-full flex flex-center">
                        <span class="text-white text-caption text-weight-bold">
                          {{ scoringProgress.percentComplete }}%
                        </span>
                      </div>
                    </q-linear-progress>
                  </div>
                </q-card-section>
                <q-card-section v-else class="text-grey-6 text-center">
                  <q-btn flat @click="loadScoringProgress">Load Progress</q-btn>
                </q-card-section>
              </q-card>

              <!-- Scoring Actions -->
              <q-card flat bordered>
                <q-card-section>
                  <div class="text-subtitle2">Start Batch Scoring Job</div>
                  <div class="text-caption text-grey-7">
                    Submits to Anthropic Batch API at 50% cost. Results typically arrive within minutes.
                  </div>
                </q-card-section>
                <q-separator />
                <q-card-section>
                  <div class="row q-col-gutter-md items-center">
                    <div class="col-12 col-sm-4">
                      <q-select
                        v-model="scoringOptions.model"
                        :options="modelOptions"
                        label="Model"
                        emit-value
                        map-options
                        outlined
                        dense
                      />
                    </div>
                    <div class="col-12 col-sm-4">
                      <q-select
                        v-model="scoringOptions.topN"
                        :options="[25, 50, 100, 250, 500, 1000, 0]"
                        label="TopN Limit"
                        outlined
                        dense
                        hint="0 = score all patents"
                        :option-label="(v: number) => v === 0 ? 'All' : v.toString()"
                      />
                    </div>
                    <div class="col-12 col-sm-4">
                      <q-toggle v-model="scoringOptions.useClaims" label="Include Claims" />
                      <q-toggle v-model="scoringOptions.rescore" label="Rescore" />
                    </div>
                  </div>

                  <q-banner v-if="scoringError" class="bg-negative text-white q-mt-md" rounded>
                    {{ scoringError }}
                    <template #action>
                      <q-btn flat label="Dismiss" @click="scoringError = null" />
                    </template>
                  </q-banner>
                </q-card-section>
                <q-card-actions>
                  <q-btn
                    color="primary"
                    icon="send"
                    label="Start Batch Scoring"
                    :loading="startScoringLoading"
                    @click="startScoring"
                  />
                  <q-btn
                    flat
                    icon="refresh"
                    label="Refresh Progress"
                    @click="loadScoringProgress"
                  />
                </q-card-actions>
              </q-card>

              <!-- Batch Jobs -->
              <q-card flat bordered class="q-mt-md">
                <q-card-section class="row items-center">
                  <div class="col">
                    <div class="text-subtitle2">Batch Jobs</div>
                  </div>
                  <div class="col-auto">
                    <q-btn flat dense icon="refresh" size="sm" :loading="batchJobsLoading" @click="loadBatchJobs">
                      <q-tooltip>Refresh batch jobs</q-tooltip>
                    </q-btn>
                  </div>
                </q-card-section>
                <q-separator />
                <q-card-section v-if="batchJobs.length > 0" class="q-pa-none">
                  <q-table
                    :rows="batchJobs"
                    :columns="[
                      { name: 'batchId', label: 'Batch ID', field: 'batchId', align: 'left' },
                      { name: 'status', label: 'Status', field: 'status', align: 'center' },
                      { name: 'model', label: 'Model', field: 'model', align: 'left' },
                      { name: 'patentCount', label: 'Patents', field: 'patentCount', align: 'center' },
                      { name: 'submittedAt', label: 'Submitted', field: 'submittedAt', align: 'left' },
                      { name: 'results', label: 'Results', field: 'results', align: 'center' },
                      { name: 'actions', label: '', field: 'batchId', align: 'right' },
                    ]"
                    row-key="batchId"
                    flat
                    dense
                    :pagination="{ rowsPerPage: 5 }"
                    hide-bottom
                  >
                    <template #body-cell-batchId="props">
                      <q-td :props="props">
                        <span class="text-caption">{{ truncateBatchId(props.row.batchId) }}</span>
                        <q-tooltip>{{ props.row.batchId }}</q-tooltip>
                      </q-td>
                    </template>
                    <template #body-cell-status="props">
                      <q-td :props="props">
                        <q-badge :color="batchStatusColor(props.row.status)" :label="props.row.status" />
                      </q-td>
                    </template>
                    <template #body-cell-model="props">
                      <q-td :props="props">
                        <span class="text-caption">{{ modelLabel(props.row.model) }}</span>
                      </q-td>
                    </template>
                    <template #body-cell-submittedAt="props">
                      <q-td :props="props">
                        <span class="text-caption">{{ formatDate(props.row.submittedAt) }}</span>
                      </q-td>
                    </template>
                    <template #body-cell-results="props">
                      <q-td :props="props">
                        <span v-if="props.row.results.processed" class="text-caption text-positive">
                          {{ props.row.results.succeeded }} OK
                          <span v-if="props.row.results.errored"> / {{ props.row.results.errored }} err</span>
                        </span>
                        <span v-else-if="props.row.status === 'ended'" class="text-caption text-warning">
                          Needs processing
                        </span>
                        <span v-else class="text-caption text-grey-6">-</span>
                      </q-td>
                    </template>
                    <template #body-cell-actions="props">
                      <q-td :props="props" class="q-gutter-xs">
                        <q-btn
                          v-if="props.row.status === 'ended' && !props.row.results.processed"
                          dense
                          flat
                          size="sm"
                          color="primary"
                          icon="download_done"
                          :loading="batchProcessingId === props.row.batchId"
                          @click="processBatchResults(props.row.batchId)"
                        >
                          <q-tooltip>Process Results</q-tooltip>
                        </q-btn>
                        <q-btn
                          v-if="props.row.status === 'submitted' || props.row.status === 'in_progress'"
                          dense
                          flat
                          size="sm"
                          color="negative"
                          icon="cancel"
                          :loading="batchCancellingId === props.row.batchId"
                          @click="cancelBatchJob(props.row.batchId)"
                        >
                          <q-tooltip>Cancel</q-tooltip>
                        </q-btn>
                      </q-td>
                    </template>
                  </q-table>
                </q-card-section>
                <q-card-section v-else class="text-grey-6 text-center">
                  No batch jobs for this sector
                </q-card-section>
              </q-card>

              <!-- Snapshots -->
              <q-card flat bordered class="q-mt-md">
                <q-card-section class="row items-center">
                  <div class="col">
                    <div class="text-subtitle2">Score Snapshots</div>
                    <div class="text-caption text-grey-7">Save current scores for later comparison</div>
                  </div>
                  <div class="col-auto q-gutter-xs">
                    <q-btn
                      flat
                      dense
                      icon="add_a_photo"
                      label="Create Snapshot"
                      size="sm"
                      color="primary"
                      :loading="createSnapshotLoading"
                      :disable="!scoringProgress || scoringProgress.scored === 0"
                      @click="createSnapshot"
                    />
                  </div>
                </q-card-section>
                <q-separator v-if="snapshots.length > 0" />
                <q-list v-if="snapshots.length > 0" dense separator>
                  <q-item v-for="snap in snapshots" :key="snap.id">
                    <q-item-section>
                      <q-item-label>{{ snap.name }}</q-item-label>
                      <q-item-label caption>
                        {{ snap.patentCount }} patents &middot; {{ formatDate(snap.createdAt) }}
                      </q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-btn
                        flat
                        dense
                        size="sm"
                        icon="compare_arrows"
                        color="secondary"
                        @click="compareSnapshot(snap.id)"
                      >
                        <q-tooltip>Compare to Current</q-tooltip>
                      </q-btn>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-card>

              <!-- Model Comparison -->
              <q-expansion-item
                class="q-mt-md"
                icon="science"
                label="Multi-Model Comparison"
                caption="Compare scoring across different models"
                header-class="bg-grey-1"
                dense
              >
                <q-card flat bordered>
                  <q-card-section>
                    <div class="row q-col-gutter-md items-end">
                      <div class="col-12 col-sm-5">
                        <q-select
                          v-model="modelCompareModels"
                          :options="modelOptions"
                          label="Models to Compare"
                          emit-value
                          map-options
                          multiple
                          outlined
                          dense
                          use-chips
                        />
                      </div>
                      <div class="col-12 col-sm-3">
                        <q-select
                          v-model="modelCompareSampleSize"
                          :options="[5, 10, 20, 50]"
                          label="Sample Size"
                          outlined
                          dense
                        />
                      </div>
                      <div class="col-12 col-sm-4">
                        <q-btn
                          color="secondary"
                          icon="science"
                          label="Run Comparison"
                          :loading="modelCompareLoading"
                          :disable="modelCompareModels.length < 2"
                          @click="runModelComparison"
                        />
                      </div>
                    </div>

                    <q-banner v-if="modelCompareError" class="bg-negative text-white q-mt-md" rounded>
                      {{ modelCompareError }}
                    </q-banner>
                  </q-card-section>

                  <!-- Comparison Results -->
                  <template v-if="modelCompareResult">
                    <q-separator />
                    <q-card-section>
                      <div class="text-subtitle2 q-mb-sm">Summary</div>
                      <div class="row q-col-gutter-md">
                        <div
                          v-for="model in modelCompareResult.models"
                          :key="model"
                          class="col-12 col-sm-4"
                        >
                          <q-card flat bordered class="q-pa-sm">
                            <div class="text-caption text-weight-medium">{{ modelLabel(model) }}</div>
                            <div class="text-h6">{{ modelCompareResult.summary[model]?.avgScore?.toFixed(1) }}</div>
                            <div class="text-caption text-grey-7">
                              {{ modelCompareResult.summary[model]?.totalTokens?.toLocaleString() }} tokens
                            </div>
                          </q-card>
                        </div>
                      </div>
                    </q-card-section>
                    <q-separator />
                    <q-card-section>
                      <div class="text-subtitle2 q-mb-sm">Per-Patent Scores</div>
                      <q-table
                        :rows="modelCompareResult.results"
                        :columns="[
                          { name: 'patentId', label: 'Patent', field: 'patentId', align: 'left' },
                          { name: 'title', label: 'Title', field: 'patentTitle', align: 'left' },
                          ...modelCompareResult.models.map(m => ({
                            name: m,
                            label: modelLabel(m),
                            field: (row: any) => row.scores[m]?.compositeScore?.toFixed(1) || '-',
                            align: 'center' as const,
                          })),
                        ]"
                        row-key="patentId"
                        flat
                        dense
                        :pagination="{ rowsPerPage: 10 }"
                      >
                        <template #body-cell-title="props">
                          <q-td :props="props">
                            <span class="text-caption">{{ props.row.patentTitle?.substring(0, 60) }}{{ (props.row.patentTitle?.length || 0) > 60 ? '...' : '' }}</span>
                          </q-td>
                        </template>
                      </q-table>
                    </q-card-section>
                  </template>
                </q-card>
              </q-expansion-item>

              <!-- Template Preview -->
              <q-card flat bordered class="q-mt-md">
                <q-card-section>
                  <div class="text-subtitle2">Template Preview</div>
                  <div class="text-caption text-grey-7">
                    Preview how the scoring prompt will look for a specific patent
                  </div>
                </q-card-section>
                <q-separator />
                <q-card-section>
                  <div class="row q-col-gutter-md items-end">
                    <div class="col-12 col-sm-6">
                      <q-input
                        v-model="templatePreviewPatentId"
                        label="Patent ID"
                        outlined
                        dense
                        placeholder="e.g., 10000000"
                        hint="Enter a patent ID from this sector"
                      />
                    </div>
                    <div class="col-12 col-sm-3">
                      <q-toggle v-model="templatePreviewIncludeClaims" label="Include Claims" />
                    </div>
                    <div class="col-12 col-sm-3">
                      <q-btn
                        color="secondary"
                        icon="visibility"
                        label="Preview"
                        :loading="templatePreviewLoading"
                        :disable="!templatePreviewPatentId"
                        @click="previewTemplate"
                      />
                    </div>
                  </div>

                  <q-banner v-if="templatePreviewError" class="bg-negative text-white q-mt-md" rounded>
                    {{ templatePreviewError }}
                  </q-banner>
                </q-card-section>

                <!-- Preview Result -->
                <template v-if="templatePreviewResult">
                  <q-separator />
                  <q-card-section>
                    <div class="row q-col-gutter-md q-mb-md">
                      <div class="col-auto">
                        <q-chip dense color="primary" text-color="white">
                          {{ templatePreviewResult.patentId }}
                        </q-chip>
                      </div>
                      <div class="col">
                        <div class="text-weight-medium">{{ templatePreviewResult.patentTitle }}</div>
                      </div>
                    </div>

                    <div class="row q-col-gutter-md q-mb-md">
                      <div class="col-auto">
                        <q-chip dense outline>
                          {{ templatePreviewResult.questionCount }} questions
                        </q-chip>
                      </div>
                      <div class="col-auto">
                        <q-chip dense outline>
                          ~{{ templatePreviewResult.estimatedTokens?.toLocaleString() }} tokens
                        </q-chip>
                      </div>
                      <div class="col-auto" v-if="templatePreviewResult.inheritanceChain?.length">
                        <span class="text-caption text-grey-7">
                          Template: {{ templatePreviewResult.inheritanceChain.join(' → ') }}
                        </span>
                      </div>
                    </div>

                    <q-expansion-item
                      label="Rendered Prompt"
                      icon="code"
                      header-class="bg-grey-2"
                      dense
                    >
                      <q-card>
                        <q-card-section>
                          <pre class="prompt-preview">{{ templatePreviewResult.renderedPrompt }}</pre>
                        </q-card-section>
                      </q-card>
                    </q-expansion-item>
                  </q-card-section>
                </template>
              </q-card>
            </q-tab-panel>
          </q-tab-panels>
        </q-card>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- DIALOGS -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->

    <!-- Add Rule Dialog -->
    <q-dialog v-model="showAddRule" persistent>
      <q-card style="min-width: 500px">
        <q-card-section>
          <div class="text-h6">Add Rule</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-select
            v-model="newRule.ruleType"
            :options="ruleTypeOptions"
            label="Rule Type"
            emit-value
            map-options
            outlined
            dense
          />

          <q-input
            v-model="newRule.expression"
            label="Expression"
            outlined
            dense
            :hint="newRule.ruleType === 'CPC_PREFIX' ? 'e.g., H04N19/' : 'e.g., video codec'"
          />

          <q-input
            v-model.number="newRule.priority"
            label="Priority"
            type="number"
            outlined
            dense
            hint="Higher = evaluated first"
          />

          <q-select
            v-model="newRule.scope"
            :options="scopeOptions"
            label="Scope"
            emit-value
            map-options
            outlined
            dense
          />

          <q-toggle
            v-model="newRule.isExclusion"
            label="Exclusion rule (removes from sector)"
          />

          <q-input
            v-model="newRule.description"
            label="Description (optional)"
            outlined
            dense
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showAddRule = false" />
          <q-btn
            flat
            label="Preview"
            color="secondary"
            :disable="!newRule.expression"
            @click="openPreviewNew"
          />
          <q-btn
            label="Add Rule"
            color="primary"
            :disable="!newRule.expression"
            @click="addRule"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Preview Dialog -->
    <q-dialog v-model="showPreview">
      <q-card style="min-width: 450px">
        <q-card-section>
          <div class="text-h6">Rule Preview</div>
          <div class="text-caption text-grey-7">
            {{ ruleTypeLabel(previewRule.ruleType) }}: <code>{{ previewRule.expression }}</code>
          </div>
        </q-card-section>

        <q-card-section>
          <q-inner-loading :showing="previewLoading" />

          <div v-if="previewResult && !previewLoading">
            <q-list dense>
              <q-item>
                <q-item-section>
                  <q-item-label caption>Total Matches</q-item-label>
                  <q-item-label class="text-h6 text-primary">
                    {{ previewResult.matchCount }}
                  </q-item-label>
                </q-item-section>
              </q-item>
              <q-item>
                <q-item-section>
                  <q-item-label caption>Already in Sector</q-item-label>
                  <q-item-label>{{ previewResult.overlapWithCurrentSector }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-item>
                <q-item-section>
                  <q-item-label caption>New to Sector</q-item-label>
                  <q-item-label class="text-positive">
                    {{ previewResult.newToSector }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>

            <div v-if="previewResult.samplePatentIds.length" class="q-mt-md">
              <div class="text-caption text-grey-7 q-mb-xs">
                Sample Patent IDs (up to 20):
              </div>
              <div class="text-body2" style="font-family: monospace; font-size: 0.8rem">
                {{ previewResult.samplePatentIds.join(', ') }}
              </div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Close" @click="showPreview = false" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Sector Dialog -->
    <q-dialog v-model="showAddSector" persistent>
      <q-card style="min-width: 450px">
        <q-card-section>
          <div class="text-h6">Add Sector</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-input
            v-model="newSector.name"
            label="Key (e.g., video-codec)"
            outlined
            dense
          />
          <q-input
            v-model="newSector.displayName"
            label="Display Name"
            outlined
            dense
          />
          <q-input
            v-model="newSector.description"
            label="Description"
            outlined
            dense
          />
          <q-select
            v-model="newSector.superSectorId"
            :options="superSectorOptions"
            label="Super-Sector"
            emit-value
            map-options
            outlined
            dense
            clearable
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showAddSector = false" />
          <q-btn
            label="Create"
            color="primary"
            :disable="!newSector.name || !newSector.displayName"
            @click="addSector"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Super-Sector Dialog -->
    <q-dialog v-model="showAddSuperSector" persistent>
      <q-card style="min-width: 450px">
        <q-card-section>
          <div class="text-h6">Add Super-Sector</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-input
            v-model="newSuperSector.name"
            label="Key (e.g., SECURITY)"
            outlined
            dense
          />
          <q-input
            v-model="newSuperSector.displayName"
            label="Display Name"
            outlined
            dense
          />
          <q-input
            v-model="newSuperSector.description"
            label="Description"
            outlined
            dense
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showAddSuperSector = false" />
          <q-btn
            label="Create"
            color="primary"
            :disable="!newSuperSector.name || !newSuperSector.displayName"
            @click="addSuperSector"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Snapshot Comparison Dialog -->
    <q-dialog v-model="showSnapshotCompare" maximized>
      <q-card>
        <q-card-section class="row items-center">
          <div class="col">
            <div class="text-h6">Snapshot Comparison</div>
            <div v-if="snapshotComparison" class="text-caption text-grey-7">
              {{ snapshotComparison.snapshotName }} vs Current &middot; {{ snapshotComparison.sectorName }}
            </div>
          </div>
          <q-btn flat round icon="close" @click="showSnapshotCompare = false" />
        </q-card-section>
        <q-separator />
        <q-card-section v-if="snapshotCompareLoading" class="text-center q-pa-xl">
          <q-spinner size="48px" color="primary" />
        </q-card-section>
        <q-card-section v-else-if="snapshotComparison">
          <!-- Summary -->
          <div class="row q-col-gutter-md q-mb-lg">
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">Snapshot Patents</div>
              <div class="text-h6">{{ snapshotComparison.summary.snapshotPatents }}</div>
            </div>
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">Current Patents</div>
              <div class="text-h6">{{ snapshotComparison.summary.currentPatents }}</div>
            </div>
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">Avg Delta</div>
              <div class="text-h6" :class="snapshotComparison.summary.avgDelta > 0 ? 'text-positive' : snapshotComparison.summary.avgDelta < 0 ? 'text-negative' : ''">
                {{ snapshotComparison.summary.avgDelta > 0 ? '+' : '' }}{{ snapshotComparison.summary.avgDelta }}
              </div>
            </div>
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">Improved</div>
              <div class="text-h6 text-positive">{{ snapshotComparison.summary.improved }}</div>
            </div>
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">Degraded</div>
              <div class="text-h6 text-negative">{{ snapshotComparison.summary.degraded }}</div>
            </div>
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">Unchanged</div>
              <div class="text-h6 text-grey-7">{{ snapshotComparison.summary.unchanged }}</div>
            </div>
          </div>

          <!-- Top Movers -->
          <div class="text-subtitle2 q-mb-sm">Top Score Changes</div>
          <q-table
            :rows="snapshotComparison.topMovers"
            :columns="[
              { name: 'patentId', label: 'Patent ID', field: 'patentId', align: 'left' },
              { name: 'snapshotScore', label: 'Snapshot', field: 'snapshotScore', align: 'center', format: (v: number) => v.toFixed(1) },
              { name: 'currentScore', label: 'Current', field: 'currentScore', align: 'center', format: (v: number | null) => v !== null ? v.toFixed(1) : '-' },
              { name: 'delta', label: 'Delta', field: 'delta', align: 'center' },
            ]"
            row-key="patentId"
            flat
            dense
            :pagination="{ rowsPerPage: 20 }"
          >
            <template #body-cell-delta="props">
              <q-td :props="props">
                <span :class="props.row.delta > 0 ? 'text-positive' : props.row.delta < 0 ? 'text-negative' : ''">
                  {{ props.row.delta > 0 ? '+' : '' }}{{ props.row.delta }}
                </span>
              </q-td>
            </template>
          </q-table>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
code {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.85em;
}

.sector-tree-card {
  position: sticky;
  top: 60px;
  max-height: calc(100vh - 140px);
  display: flex;
  flex-direction: column;
}

.sector-tree-scroll {
  flex: 1;
  overflow-y: auto;
  max-height: calc(100vh - 260px);
}

.sector-tree-scroll::-webkit-scrollbar {
  width: 6px;
}

.sector-tree-scroll::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.sector-tree-scroll::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.sector-tree-scroll::-webkit-scrollbar-thumb:hover {
  background: #a1a1a1;
}

.prompt-preview {
  background: #f8f9fa;
  padding: 12px;
  border-radius: 4px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.8rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 400px;
  overflow-y: auto;
}

.sub-sector-item {
  background-color: #fafafa;
  border-left: 2px solid #e0e0e0;
  margin-left: 24px;
  min-height: 36px;
}

.sub-sector-item:hover {
  background-color: #f0f0f0;
}
</style>
