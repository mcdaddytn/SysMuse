<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  v2EnhancedApi,
  type V2EnhancedConfig,
  type V2EnhancedScoredPatent,
  type V2EnhancedPreset,
  type ScalingType,
} from '@/services/api';

const router = useRouter();

// LocalStorage keys
const PRESETS_KEY = 'v2-enhanced-custom-presets';
const SNAPSHOTS_KEY = 'v2-enhanced-snapshots';

// Metrics organized by category
interface MetricControl {
  key: string;
  label: string;
  description: string;
  weight: number;
  scaling: ScalingType;
  invert: boolean;
}

interface MetricCategory {
  name: string;
  color: string;
  metrics: MetricControl[];
}

// Snapshot interface
interface RankSnapshot {
  id: string;
  name: string;
  timestamp: string;
  topN: number;
  config: V2EnhancedConfig;
  rankings: Array<{ patent_id: string; rank: number; score: number; rank_change?: number }>;
}

// State
const categories = ref<MetricCategory[]>([]);
const patents = ref<V2EnhancedScoredPatent[]>([]);
const previousRankings = ref<Array<{ patent_id: string; rank: number }>>([]);
const builtInPresets = ref<V2EnhancedPreset[]>([]);
const customPresets = ref<V2EnhancedPreset[]>([]);
const selectedPresetId = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const total = ref(0);
const hasUnsavedChanges = ref(false);
const lastConfig = ref<V2EnhancedConfig | null>(null);

// Snapshots state
const snapshots = ref<RankSnapshot[]>([]);
const selectedSnapshotId = ref<string | null>(null);
const compareToSnapshot = ref(false);
const snapshotRankMap = ref<Map<string, number>>(new Map());

// Dialogs
const showSavePresetDialog = ref(false);
const showSaveSnapshotDialog = ref(false);
const newPresetName = ref('');
const newPresetDescription = ref('');
const newSnapshotName = ref('');
const resetAfterSnapshot = ref(true);
const autoRecalcOnPreset = ref(true);

// Top N and filter options
const topNOptions = [
  { label: '60', value: 60 },
  { label: '100', value: 100 },
  { label: '250', value: 250 },
  { label: '500', value: 500 },
  { label: '1000', value: 1000 },
  { label: '2500', value: 2500 },
  { label: '5000', value: 5000 },
  { label: '7500', value: 7500 },
  { label: '10000', value: 10000 },
  { label: 'All', value: 0 },
];
const topN = ref(100);
const llmEnhancedOnly = ref(true);
const includeMetrics = ref(false);

// Scaling options for dropdown
const scalingOptions = [
  { label: 'Linear', value: 'linear' as ScalingType },
  { label: 'Log', value: 'log' as ScalingType },
  { label: 'Sqrt', value: 'sqrt' as ScalingType },
];

// All presets combined
const allPresets = computed(() => [...builtInPresets.value, ...customPresets.value]);

// All metric keys for columns (used when includeMetrics is true)
const allMetricKeys = [
  'competitor_citations',
  'adjusted_forward_citations',
  'years_remaining',
  'competitor_count',
  'competitor_density',
  'eligibility_score',
  'validity_score',
  'claim_breadth',
  'enforcement_clarity',
  'design_around_difficulty',
  'market_relevance_score',
  'ipr_risk_score',
  'prosecution_quality_score',
];

// Table columns - dynamic based on snapshot comparison and includeMetrics
const columns = computed(() => {
  const baseCols = [
    { name: 'rank', label: 'Rank', field: 'rank', align: 'center' as const, sortable: true, style: 'width: 60px' },
    { name: 'change', label: '+/-', field: 'rank_change', align: 'center' as const, style: 'width: 50px' },
  ];

  if (compareToSnapshot.value && selectedSnapshotId.value) {
    baseCols.push({
      name: 'snapshot_change',
      label: 'vs Snap',
      field: 'snapshot_rank_change',
      align: 'center' as const,
      style: 'width: 60px',
    });
  }

  const mainCols = [
    ...baseCols,
    { name: 'patent_id', label: 'Patent ID', field: 'patent_id', align: 'left' as const },
    { name: 'patent_title', label: 'Title', field: 'patent_title', align: 'left' as const },
    { name: 'assignee', label: 'Assignee', field: 'assignee', align: 'left' as const },
    { name: 'super_sector', label: 'Super-Sector', field: 'super_sector', align: 'left' as const },
    { name: 'years_remaining', label: 'Years', field: 'years_remaining', align: 'center' as const, sortable: true,
      format: (val: number) => val?.toFixed(1) },
    { name: 'has_llm', label: 'LLM', field: 'has_llm_data', align: 'center' as const, style: 'width: 50px' },
    { name: 'score', label: 'Score', field: 'score', align: 'center' as const, sortable: true,
      format: (val: number) => val?.toFixed(2) },
  ];

  // Add metric columns if includeMetrics is enabled
  if (includeMetrics.value) {
    const metricCols = allMetricKeys.map(key => ({
      name: `metric_${key}`,
      label: formatMetricName(key),
      field: (row: V2EnhancedScoredPatent) => row.raw_metrics?.[key],
      align: 'center' as const,
      sortable: true,
      format: (val: number) => formatRawMetric(key, val),
      style: 'width: 70px; font-size: 0.85em',
    }));
    return [...mainCols, ...metricCols];
  }

  return mainCols;
});

// Computed: build config from current state
const currentConfig = computed<V2EnhancedConfig>(() => {
  const weights: Record<string, number> = {};
  const scaling: Record<string, ScalingType> = {};
  const invert: Record<string, boolean> = {};

  for (const cat of categories.value) {
    for (const metric of cat.metrics) {
      weights[metric.key] = metric.weight;
      scaling[metric.key] = metric.scaling;
      invert[metric.key] = metric.invert;
    }
  }

  return {
    weights,
    scaling,
    invert,
    topN: topN.value,
    llmEnhancedOnly: llmEnhancedOnly.value,
  };
});

// Computed: total weight percentage
const totalWeight = computed(() => {
  let sum = 0;
  for (const cat of categories.value) {
    for (const metric of cat.metrics) {
      sum += metric.weight;
    }
  }
  return sum;
});

// Patents with snapshot comparison
const patentsWithSnapshotChange = computed(() => {
  if (!compareToSnapshot.value || !selectedSnapshotId.value) {
    return patents.value;
  }

  return patents.value.map(p => ({
    ...p,
    snapshot_rank_change: snapshotRankMap.value.has(p.patent_id)
      ? snapshotRankMap.value.get(p.patent_id)! - p.rank
      : undefined,
  }));
});

// Initialize metrics from API
async function loadMetrics() {
  try {
    const metrics = await v2EnhancedApi.getMetrics();

    const categoryMap: Record<string, MetricControl[]> = {
      quantitative: [],
      llm: [],
      api: [],
    };

    for (const m of metrics) {
      categoryMap[m.category]?.push({
        key: m.key,
        label: m.label,
        description: m.description,
        weight: m.defaultWeight,
        scaling: m.defaultScaling,
        invert: false,
      });
    }

    categories.value = [
      { name: 'Quantitative', color: 'primary', metrics: categoryMap.quantitative },
      { name: 'LLM Metrics', color: 'teal', metrics: categoryMap.llm },
      { name: 'API Metrics', color: 'deep-purple', metrics: categoryMap.api },
    ];
  } catch (err) {
    console.error('Failed to load metrics:', err);
    initDefaultMetrics();
  }
}

function initDefaultMetrics() {
  categories.value = [
    {
      name: 'Quantitative',
      color: 'primary',
      metrics: [
        { key: 'competitor_citations', label: 'Competitor Citations', description: 'Number of forward citations from tracked competitors. Higher values indicate the patent covers technology competitors are actively building upon or around.', weight: 20, scaling: 'linear', invert: false },
        { key: 'adjusted_forward_citations', label: 'Adj. Fwd Citations', description: 'Forward citations weighted by source: competitor 1.5x, neutral 1.0x, affiliate (self) 0.25x. Reduces inflation from internal R&D.', weight: 10, scaling: 'sqrt', invert: false },
        { key: 'years_remaining', label: 'Years Remaining', description: 'Years until patent expiration. Longer life increases licensing value and litigation leverage.', weight: 15, scaling: 'linear', invert: false },
        { key: 'competitor_count', label: 'Competitor Count', description: 'Number of distinct competitors who have cited this patent. Broader interest suggests relevance across multiple players.', weight: 5, scaling: 'linear', invert: false },
        { key: 'competitor_density', label: 'Competitor Density', description: 'Ratio of competitor citations to total external citations. High density = technology sits in competitive space.', weight: 5, scaling: 'linear', invert: false },
      ],
    },
    {
      name: 'LLM Metrics',
      color: 'teal',
      metrics: [
        { key: 'eligibility_score', label: 'Eligibility', description: '35 USC 101 strength (1-5). Higher = less vulnerable to Alice/Mayo abstract idea challenges. 5=clearly technical.', weight: 5, scaling: 'linear', invert: false },
        { key: 'validity_score', label: 'Validity', description: 'Prior art defensibility under 102/103 (1-5). Higher = stronger novelty. 5=clearly novel, 1=prior art concerns.', weight: 5, scaling: 'linear', invert: false },
        { key: 'claim_breadth', label: 'Claim Breadth', description: 'Scope of patent claims (1-5). Broader claims cover more infringement scenarios. 5=very broad, 1=narrow.', weight: 4, scaling: 'linear', invert: false },
        { key: 'enforcement_clarity', label: 'Enforcement Clarity', description: 'Ease of detecting infringement (1-5). 5=easily observable in products, 1=hidden implementation.', weight: 6, scaling: 'linear', invert: false },
        { key: 'design_around_difficulty', label: 'Design Around', description: 'How hard to avoid the patent (1-5). Higher = more licensing leverage. 5=no alternatives, 1=easy substitutes.', weight: 5, scaling: 'linear', invert: false },
        { key: 'market_relevance_score', label: 'Market Relevance', description: 'Commercial applicability (1-5). 5=core to major products/markets, 1=niche/obsolete technology.', weight: 5, scaling: 'linear', invert: false },
      ],
    },
    {
      name: 'API Metrics',
      color: 'deep-purple',
      metrics: [
        { key: 'ipr_risk_score', label: 'IPR Risk', description: 'PTAB risk from USPTO history (1-5). 5=no IPR history (safe), 4=survived IPR, 2=pending, 1=invalidated.', weight: 5, scaling: 'linear', invert: false },
        { key: 'prosecution_quality_score', label: 'Prosecution Quality', description: 'File wrapper quality (1-5). 5=minimal rejections, 1=extensive amendments during prosecution.', weight: 5, scaling: 'linear', invert: false },
      ],
    },
  ];
}

// Load presets from API and localStorage
async function loadPresets() {
  try {
    builtInPresets.value = await v2EnhancedApi.getPresets();
  } catch (err) {
    console.error('Failed to load presets:', err);
  }

  // Load custom presets from localStorage
  try {
    const stored = localStorage.getItem(PRESETS_KEY);
    if (stored) {
      customPresets.value = JSON.parse(stored);
    }
  } catch (err) {
    console.error('Failed to load custom presets:', err);
  }
}

// Load snapshots from localStorage
function loadSnapshots() {
  try {
    const stored = localStorage.getItem(SNAPSHOTS_KEY);
    if (stored) {
      snapshots.value = JSON.parse(stored);
    }
  } catch (err) {
    console.error('Failed to load snapshots:', err);
  }
}

// Save custom presets to localStorage
function saveCustomPresets() {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(customPresets.value));
}

// Save snapshots to localStorage
function saveSnapshots() {
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots.value));
}

// Apply a preset
async function applyPreset(preset: V2EnhancedPreset) {
  selectedPresetId.value = preset.id;

  for (const cat of categories.value) {
    for (const metric of cat.metrics) {
      metric.weight = preset.config.weights[metric.key] ?? 0;
      metric.scaling = preset.config.scaling[metric.key] ?? 'linear';
      metric.invert = preset.config.invert[metric.key] ?? false;
    }
  }

  if (autoRecalcOnPreset.value) {
    await recalculate();
  } else {
    hasUnsavedChanges.value = true;
  }
}

// Save current settings as a new preset
function saveAsPreset() {
  if (!newPresetName.value.trim()) return;

  const newPreset: V2EnhancedPreset = {
    id: `custom-${Date.now()}`,
    name: newPresetName.value.trim(),
    description: newPresetDescription.value.trim() || 'Custom preset',
    isBuiltIn: false,
    config: { ...currentConfig.value },
  };

  customPresets.value.push(newPreset);
  saveCustomPresets();
  selectedPresetId.value = newPreset.id;

  showSavePresetDialog.value = false;
  newPresetName.value = '';
  newPresetDescription.value = '';
}

// Delete a custom preset
function deletePreset(presetId: string) {
  customPresets.value = customPresets.value.filter(p => p.id !== presetId);
  saveCustomPresets();
  if (selectedPresetId.value === presetId) {
    selectedPresetId.value = null;
  }
}

// Reset rank movements (clear previous rankings baseline)
function resetRankMovements() {
  // Set current rankings as the new baseline
  previousRankings.value = patents.value.map(p => ({
    patent_id: p.patent_id,
    rank: p.rank,
  }));
  // Clear the rank_change on displayed patents
  patents.value = patents.value.map(p => ({
    ...p,
    rank_change: undefined,
  }));
}

// Save current rankings as a snapshot
function saveSnapshot() {
  if (!newSnapshotName.value.trim()) return;

  // Include current rank_change in snapshot before potentially resetting
  const snapshot: RankSnapshot = {
    id: `snap-${Date.now()}`,
    name: newSnapshotName.value.trim(),
    timestamp: new Date().toISOString(),
    topN: topN.value,
    config: { ...currentConfig.value },
    rankings: patents.value.map(p => ({
      patent_id: p.patent_id,
      rank: p.rank,
      score: p.score,
      rank_change: p.rank_change,
    })),
  };

  snapshots.value.unshift(snapshot);
  // Limit to 10 snapshots
  if (snapshots.value.length > 10) {
    snapshots.value = snapshots.value.slice(0, 10);
  }
  saveSnapshots();

  // Reset rank movements if checkbox is checked
  if (resetAfterSnapshot.value) {
    resetRankMovements();
  }

  showSaveSnapshotDialog.value = false;
  newSnapshotName.value = '';
}

// Delete a snapshot
function deleteSnapshot(snapshotId: string) {
  snapshots.value = snapshots.value.filter(s => s.id !== snapshotId);
  saveSnapshots();
  if (selectedSnapshotId.value === snapshotId) {
    selectedSnapshotId.value = null;
    compareToSnapshot.value = false;
  }
}

// Select snapshot for comparison
function onSnapshotSelect(snapshotId: string | null) {
  selectedSnapshotId.value = snapshotId;
  if (snapshotId) {
    const snapshot = snapshots.value.find(s => s.id === snapshotId);
    if (snapshot) {
      snapshotRankMap.value = new Map(snapshot.rankings.map(r => [r.patent_id, r.rank]));
    }
  } else {
    snapshotRankMap.value.clear();
    compareToSnapshot.value = false;
  }
}

// Export to CSV
function exportCSV() {
  // Warn if there are unsaved changes (data may not match displayed config)
  if (hasUnsavedChanges.value) {
    const proceed = confirm(
      'You have unsaved changes. The exported data reflects the last recalculation, ' +
      'not the current slider settings. Click Recalculate first if you want the export to match current settings.\n\n' +
      'Export anyway?'
    );
    if (!proceed) return;
  }

  const config = lastConfig.value || currentConfig.value;
  const date = new Date().toISOString().split('T')[0];

  // Find preset name if one is selected
  const presetName = selectedPresetId.value
    ? allPresets.value.find(p => p.id === selectedPresetId.value)?.name || 'Custom'
    : 'Custom';

  // Build header comments
  const comments = [
    `# V2 Enhanced Scoring Export`,
    `# Generated: ${new Date().toISOString()}`,
    `# Preset: ${presetName}`,
    `# Top N: ${config.topN === 0 ? 'All' : config.topN}`,
    `# Complete Data Only: ${config.llmEnhancedOnly}`,
    `# Include Metrics: ${includeMetrics.value}`,
    `# Weights: ${Object.entries(config.weights).map(([k, v]) => `${k}=${v}`).join(',')}`,
    `# Scaling: ${Object.entries(config.scaling).map(([k, v]) => `${k}=${v}`).join(',')}`,
  ];

  // Build CSV headers - base columns
  const headers = [
    'rank',
    'rank_change',
    ...(compareToSnapshot.value && selectedSnapshotId.value ? ['snapshot_rank_change'] : []),
    'patent_id',
    'title',
    'assignee',
    'super_sector',
    'primary_sector',
    'years_remaining',
    'has_llm_data',
    'score',
  ];

  // Add metric headers if includeMetrics is enabled
  if (includeMetrics.value) {
    headers.push(...allMetricKeys);
  }

  // Build rows
  const rows = patentsWithSnapshotChange.value.map(p => {
    const row = [
      p.rank,
      p.rank_change ?? '',
      ...(compareToSnapshot.value && selectedSnapshotId.value ? [(p as any).snapshot_rank_change ?? 'NEW'] : []),
      p.patent_id,
      `"${(p.patent_title || '').replace(/"/g, '""')}"`,
      `"${(p.assignee || '').replace(/"/g, '""')}"`,
      p.super_sector || '',
      p.primary_sector || '',
      p.years_remaining?.toFixed(1) || '',
      p.has_llm_data ? 'Y' : 'N',
      p.score?.toFixed(2) || '',
    ];

    // Add metric values if includeMetrics is enabled
    if (includeMetrics.value) {
      for (const key of allMetricKeys) {
        const val = p.raw_metrics?.[key];
        row.push(val !== undefined && val !== null ? val.toString() : '');
      }
    }

    return row.join(',');
  });

  const csvContent = [...comments, '', headers.join(','), ...rows].join('\n');

  // Download - use "all" in filename if topN is 0
  const topNLabel = topN.value === 0 ? 'all' : `top${topN.value}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `v2-scoring-${topNLabel}-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Recalculate scores
async function recalculate() {
  loading.value = true;
  error.value = null;

  try {
    const response = await v2EnhancedApi.getScores(currentConfig.value, previousRankings.value);

    patents.value = response.data;
    total.value = response.total;
    lastConfig.value = response.config;
    hasUnsavedChanges.value = false;

    previousRankings.value = response.data.map(p => ({
      patent_id: p.patent_id,
      rank: p.rank,
    }));
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to calculate scores';
    console.error('Failed to fetch scores:', err);
  } finally {
    loading.value = false;
  }
}

// Navigate to patent detail
function goToPatent(patentId: string) {
  router.push({ name: 'patent-detail', params: { id: patentId } });
}

// Mark changes when metrics are modified
function onMetricChange() {
  selectedPresetId.value = null;
  hasUnsavedChanges.value = true;
}

// Format metric key to human-readable name
function formatMetricName(key: string): string {
  const names: Record<string, string> = {
    competitor_citations: 'Competitor Cites',
    adjusted_forward_citations: 'Adj. Fwd Cites',
    years_remaining: 'Years Remaining',
    competitor_count: 'Competitor Count',
    competitor_density: 'Competitor Density',
    eligibility_score: 'Eligibility',
    validity_score: 'Validity',
    claim_breadth: 'Claim Breadth',
    enforcement_clarity: 'Enforcement Clarity',
    design_around_difficulty: 'Design Around',
    market_relevance_score: 'Market Relevance',
    ipr_risk_score: 'IPR Risk',
    prosecution_quality_score: 'Prosecution Quality',
  };
  return names[key] || key;
}

// Format raw metric value appropriately
function formatRawMetric(key: string, value: number | undefined): string {
  if (value === undefined || value === null) return '-';
  // LLM and API scores are 1-5
  if (key.includes('score') || key === 'claim_breadth' || key === 'enforcement_clarity' || key === 'design_around_difficulty') {
    return value.toFixed(1);
  }
  // Density is 0-1
  if (key === 'competitor_density') {
    return (value * 100).toFixed(0) + '%';
  }
  // Years
  if (key === 'years_remaining') {
    return value.toFixed(1);
  }
  // Citations and counts are integers
  return Math.round(value).toString();
}

// Watch for filter changes
watch([topN, llmEnhancedOnly], () => {
  hasUnsavedChanges.value = true;
});

// Initialize
onMounted(async () => {
  await Promise.all([loadMetrics(), loadPresets()]);
  loadSnapshots();
  await recalculate();
});
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5">V2 Enhanced Scoring</div>
      <q-badge color="primary" class="q-ml-md">
        {{ total.toLocaleString() }} patents
      </q-badge>
      <q-space />
      <q-badge v-if="hasUnsavedChanges" color="warning" outline class="q-mr-md">
        Unsaved changes
      </q-badge>
    </div>

    <div class="row q-gutter-md">
      <!-- Left Sidebar: Controls -->
      <div class="col-3" style="min-width: 320px; max-width: 380px">
        <!-- Top Controls -->
        <q-card class="q-mb-md">
          <q-card-section class="q-pb-sm">
            <div class="row items-center q-gutter-sm">
              <q-select
                v-model="topN"
                :options="topNOptions"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                label="Top N"
                dense
                outlined
                style="width: 100px"
                @update:model-value="onMetricChange"
              />
              <q-toggle
                v-model="llmEnhancedOnly"
                label="Complete Data Only"
                dense
                @update:model-value="onMetricChange"
              >
                <q-tooltip>Only show patents with LLM enrichment data</q-tooltip>
              </q-toggle>
            </div>
            <div class="row items-center q-gutter-sm q-mt-sm">
              <q-toggle
                v-model="includeMetrics"
                label="Include Metrics"
                dense
              >
                <q-tooltip>Show all metric component columns in table and CSV export</q-tooltip>
              </q-toggle>
              <q-space />
              <q-btn
                color="primary"
                label="Recalculate"
                icon="refresh"
                :loading="loading"
                @click="recalculate"
              />
            </div>
          </q-card-section>
        </q-card>

        <!-- Presets -->
        <q-card class="q-mb-md">
          <q-card-section class="q-pb-sm">
            <div class="row items-center q-mb-sm">
              <span class="text-subtitle2">Presets</span>
              <q-space />
              <span class="text-caption text-grey-7 q-mr-xs">Auto-Recalc</span>
              <q-toggle
                v-model="autoRecalcOnPreset"
                size="xs"
                dense
                class="q-mr-sm"
              >
                <q-tooltip>Auto-recalculate when preset is selected</q-tooltip>
              </q-toggle>
              <q-btn
                flat
                dense
                size="sm"
                icon="add"
                label="Save"
                @click="showSavePresetDialog = true"
              />
            </div>
            <div class="row q-gutter-xs">
              <q-chip
                v-for="preset in allPresets"
                :key="preset.id"
                clickable
                :removable="!preset.isBuiltIn"
                :color="selectedPresetId === preset.id ? 'primary' : 'grey-4'"
                :text-color="selectedPresetId === preset.id ? 'white' : 'black'"
                size="sm"
                @click="applyPreset(preset)"
                @remove="deletePreset(preset.id)"
              >
                {{ preset.name }}
                <q-tooltip>{{ preset.description }}</q-tooltip>
              </q-chip>
            </div>
          </q-card-section>
        </q-card>

        <!-- Snapshots -->
        <q-card class="q-mb-md">
          <q-card-section class="q-pb-sm">
            <div class="row items-center q-mb-sm">
              <span class="text-subtitle2">Snapshots</span>
              <q-space />
              <q-btn
                flat
                dense
                size="sm"
                icon="camera_alt"
                label="Save"
                :disable="patents.length === 0"
                @click="showSaveSnapshotDialog = true"
              />
            </div>
            <q-select
              v-model="selectedSnapshotId"
              :options="[{ label: '(None)', value: null }, ...snapshots.map(s => ({ label: `${s.name} (${new Date(s.timestamp).toLocaleDateString()})`, value: s.id }))]"
              option-value="value"
              option-label="label"
              emit-value
              map-options
              dense
              outlined
              clearable
              placeholder="Select snapshot..."
              @update:model-value="onSnapshotSelect"
            />
            <q-toggle
              v-if="selectedSnapshotId"
              v-model="compareToSnapshot"
              label="Compare to snapshot"
              dense
              class="q-mt-sm"
            />
            <q-btn
              v-if="selectedSnapshotId"
              flat
              dense
              size="sm"
              color="negative"
              icon="delete"
              label="Delete snapshot"
              class="q-mt-sm"
              @click="deleteSnapshot(selectedSnapshotId)"
            />
          </q-card-section>
        </q-card>

        <!-- Weight Summary -->
        <q-card class="q-mb-md">
          <q-card-section class="q-py-sm">
            <div class="row items-center">
              <span class="text-subtitle2">Total Weight:</span>
              <q-space />
              <q-badge
                :color="Math.abs(totalWeight - 100) < 1 ? 'positive' : 'warning'"
              >
                {{ totalWeight.toFixed(0) }}%
              </q-badge>
            </div>
          </q-card-section>
        </q-card>

        <!-- Metric Controls by Category -->
        <q-card
          v-for="category in categories"
          :key="category.name"
          class="q-mb-md"
        >
          <q-card-section class="q-pb-none">
            <div class="text-subtitle1" :class="`text-${category.color}`">
              {{ category.name }}
            </div>
          </q-card-section>

          <q-card-section class="q-pt-sm">
            <div
              v-for="metric in category.metrics"
              :key="metric.key"
              class="q-mb-md"
            >
              <div class="row items-center q-mb-xs">
                <span class="text-body2">{{ metric.label }}</span>
                <q-icon name="info" size="xs" class="q-ml-xs text-grey-6">
                  <q-tooltip>{{ metric.description }}</q-tooltip>
                </q-icon>
                <q-space />
                <q-badge :color="category.color" outline>
                  {{ metric.weight }}%
                </q-badge>
              </div>

              <q-slider
                v-model="metric.weight"
                :min="0"
                :max="50"
                :step="1"
                :color="category.color"
                dense
                @update:model-value="onMetricChange"
              />

              <div class="row items-center q-gutter-sm">
                <q-select
                  v-model="metric.scaling"
                  :options="scalingOptions"
                  option-value="value"
                  option-label="label"
                  emit-value
                  map-options
                  dense
                  outlined
                  class="col"
                  style="max-width: 100px"
                  @update:model-value="onMetricChange"
                />
                <q-toggle
                  v-model="metric.invert"
                  label="Invert"
                  dense
                  size="sm"
                  @update:model-value="onMetricChange"
                />
              </div>
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Right Side: Rankings Table -->
      <div class="col">
        <q-card>
          <q-card-section class="q-pb-none">
            <div class="row items-center">
              <div class="text-h6">Patent Rankings</div>
              <q-space />
              <q-btn
                flat
                dense
                icon="restart_alt"
                label="Reset +/-"
                :disable="patents.length === 0"
                class="q-mr-sm"
                @click="resetRankMovements"
              >
                <q-tooltip>Clear rank movements and set current rankings as new baseline</q-tooltip>
              </q-btn>
              <q-btn
                flat
                dense
                icon="download"
                label="Export CSV"
                :disable="patents.length === 0"
                class="q-mr-sm"
                @click="exportCSV"
              />
              <q-spinner v-if="loading" color="primary" size="sm" />
            </div>
          </q-card-section>

          <q-card-section>
            <q-banner v-if="error" class="bg-negative text-white q-mb-md">
              {{ error }}
              <template v-slot:action>
                <q-btn flat label="Retry" @click="recalculate" />
              </template>
            </q-banner>

            <q-table
              :rows="patentsWithSnapshotChange"
              :columns="columns"
              row-key="patent_id"
              :loading="loading"
              flat
              bordered
              dense
              :rows-per-page-options="[0]"
              hide-pagination
            >
              <template v-slot:body-cell-rank="props">
                <q-td :props="props">
                  <span class="text-weight-bold">{{ props.row.rank }}</span>
                </q-td>
              </template>

              <template v-slot:body-cell-change="props">
                <q-td :props="props">
                  <template v-if="props.row.rank_change !== undefined && props.row.rank_change !== 0">
                    <q-icon
                      :name="props.row.rank_change > 0 ? 'arrow_upward' : 'arrow_downward'"
                      :color="props.row.rank_change > 0 ? 'positive' : 'negative'"
                      size="xs"
                    />
                    <span
                      :class="props.row.rank_change > 0 ? 'text-positive' : 'text-negative'"
                      class="text-caption"
                    >
                      {{ Math.abs(props.row.rank_change) }}
                    </span>
                  </template>
                  <span v-else class="text-grey-5">-</span>
                </q-td>
              </template>

              <template v-slot:body-cell-snapshot_change="props">
                <q-td :props="props">
                  <template v-if="props.row.snapshot_rank_change !== undefined">
                    <template v-if="props.row.snapshot_rank_change !== 0">
                      <q-icon
                        :name="props.row.snapshot_rank_change > 0 ? 'arrow_upward' : 'arrow_downward'"
                        :color="props.row.snapshot_rank_change > 0 ? 'positive' : 'negative'"
                        size="xs"
                      />
                      <span
                        :class="props.row.snapshot_rank_change > 0 ? 'text-positive' : 'text-negative'"
                        class="text-caption"
                      >
                        {{ Math.abs(props.row.snapshot_rank_change) }}
                      </span>
                    </template>
                    <span v-else class="text-grey-5">-</span>
                  </template>
                  <q-badge v-else color="info" outline size="xs">NEW</q-badge>
                </q-td>
              </template>

              <template v-slot:body-cell-patent_id="props">
                <q-td :props="props">
                  <a
                    href="#"
                    class="text-primary"
                    @click.prevent="goToPatent(props.row.patent_id)"
                  >
                    {{ props.row.patent_id }}
                  </a>
                  <q-tooltip
                    anchor="center right"
                    self="center left"
                    :offset="[10, 0]"
                    class="patent-detail-tooltip"
                    max-width="500px"
                  >
                    <div class="patent-popup">
                      <div class="text-subtitle1 text-weight-bold q-mb-xs">
                        {{ props.row.patent_id }}
                      </div>
                      <div class="text-body2 q-mb-sm">{{ props.row.patent_title }}</div>

                      <div class="row q-gutter-sm q-mb-sm text-caption">
                        <q-badge color="cyan-4" text-color="dark">{{ props.row.assignee }}</q-badge>
                        <q-badge color="blue-grey-4" text-color="dark">{{ props.row.super_sector || props.row.primary_sector }}</q-badge>
                        <q-badge color="light-green-4" text-color="dark">{{ props.row.years_remaining?.toFixed(1) }} yrs</q-badge>
                        <q-badge v-if="props.row.has_llm_data" color="amber-4" text-color="dark">LLM</q-badge>
                      </div>

                      <div v-if="props.row.patent_abstract" class="text-caption text-grey-8 q-mb-md abstract-text">
                        {{ props.row.patent_abstract.length > 400
                           ? props.row.patent_abstract.substring(0, 400) + '...'
                           : props.row.patent_abstract }}
                      </div>

                      <div class="text-subtitle2 q-mb-xs">Scoring Metrics</div>
                      <table class="metrics-table">
                        <thead>
                          <tr>
                            <th>Metric</th>
                            <th>Raw</th>
                            <th>Norm</th>
                            <th>Wt%</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="key in props.row.metrics_used" :key="key">
                            <td>{{ formatMetricName(key) }}</td>
                            <td class="text-right">{{ formatRawMetric(key, props.row.raw_metrics[key]) }}</td>
                            <td class="text-right">{{ (props.row.normalized_metrics[key] * 100).toFixed(0) }}%</td>
                            <td class="text-right">{{ currentConfig.weights[key] || 0 }}%</td>
                          </tr>
                        </tbody>
                      </table>

                      <div class="row q-mt-sm text-caption">
                        <div class="col">Year Mult: <strong class="text-yellow-4">{{ props.row.year_multiplier?.toFixed(3) }}</strong></div>
                        <div class="col text-right">Final Score: <strong class="text-amber-3" style="font-size: 1.1em">{{ props.row.score?.toFixed(2) }}</strong></div>
                      </div>
                    </div>
                  </q-tooltip>
                </q-td>
              </template>

              <template v-slot:body-cell-patent_title="props">
                <q-td :props="props">
                  <div class="ellipsis" style="max-width: 250px">
                    {{ props.row.patent_title }}
                    <q-tooltip v-if="props.row.patent_title?.length > 40">
                      {{ props.row.patent_title }}
                    </q-tooltip>
                  </div>
                </q-td>
              </template>

              <template v-slot:body-cell-assignee="props">
                <q-td :props="props">
                  <div class="ellipsis" style="max-width: 150px">
                    {{ props.row.assignee }}
                    <q-tooltip v-if="props.row.assignee?.length > 20">
                      {{ props.row.assignee }}
                    </q-tooltip>
                  </div>
                </q-td>
              </template>

              <template v-slot:body-cell-has_llm="props">
                <q-td :props="props">
                  <q-icon
                    :name="props.row.has_llm_data ? 'check_circle' : 'remove_circle_outline'"
                    :color="props.row.has_llm_data ? 'positive' : 'grey-4'"
                    size="sm"
                  />
                </q-td>
              </template>

              <template v-slot:body-cell-score="props">
                <q-td :props="props">
                  <q-badge
                    :color="props.row.score > 70 ? 'positive' : props.row.score > 50 ? 'warning' : 'grey'"
                  >
                    {{ props.row.score?.toFixed(2) }}
                  </q-badge>
                </q-td>
              </template>

              <template v-slot:no-data>
                <div class="full-width row flex-center text-grey q-gutter-sm q-pa-xl">
                  <q-icon size="2em" name="sentiment_dissatisfied" />
                  <span>No patents found. Try adjusting filters or click Recalculate.</span>
                </div>
              </template>
            </q-table>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Save Preset Dialog -->
    <q-dialog v-model="showSavePresetDialog">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">Save as Preset</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newPresetName"
            label="Preset Name"
            dense
            autofocus
            @keyup.enter="saveAsPreset"
          />
          <q-input
            v-model="newPresetDescription"
            label="Description (optional)"
            dense
            class="q-mt-md"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Save"
            :disable="!newPresetName.trim()"
            @click="saveAsPreset"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Save Snapshot Dialog -->
    <q-dialog v-model="showSaveSnapshotDialog">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">Save Snapshot</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newSnapshotName"
            label="Snapshot Name"
            dense
            autofocus
            :placeholder="`Snapshot ${new Date().toLocaleDateString()}`"
            @keyup.enter="saveSnapshot"
          />
          <q-toggle
            v-model="resetAfterSnapshot"
            label="Reset rank movements after save"
            dense
            class="q-mt-md"
          />
          <div class="text-caption text-grey q-mt-sm">
            Saves current rankings ({{ patents.length }} patents) with their +/- movements.
            If reset is checked, current rankings become the new baseline.
            Limit: 10 snapshots.
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Save"
            :disable="!newSnapshotName.trim()"
            @click="saveSnapshot"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

<style>
/* Larger font for metric description tooltips */
.q-tooltip {
  font-size: 14px !important;
  line-height: 1.4;
  max-width: 350px;
}

/* Patent detail tooltip - larger and more detailed */
.patent-detail-tooltip {
  max-width: 500px !important;
  font-size: 13px !important;
}

.patent-popup {
  padding: 8px;
}

.patent-popup .abstract-text {
  line-height: 1.3;
  border-left: 3px solid #1976d2;
  padding-left: 8px;
  font-style: italic;
}

.patent-popup .metrics-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.patent-popup .metrics-table th,
.patent-popup .metrics-table td {
  padding: 3px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.2);
}

.patent-popup .metrics-table th {
  text-align: left;
  font-weight: 600;
  color: #90caf9;
}

.patent-popup .metrics-table td.text-right {
  text-align: right;
}
</style>
