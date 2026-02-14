<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import {
  v2EnhancedApi,
  snapshotApi,
  type V2EnhancedConfig,
  type V2EnhancedScoredPatent,
  type V2EnhancedPreset,
  type ScalingType,
  type ScoreSnapshot,
  DEFAULT_V3_ROLES,
  BUILTIN_V3_PRESETS,
} from '@/services/api';
import type {
  V3ConsensusRole,
  V3ConsensusPreset,
  V3ConsensusScoredPatent,
  V3ConsensusSnapshot,
} from '@/types';

const router = useRouter();
const $q = useQuasar();

// LocalStorage keys
const V3_PRESETS_KEY = 'v3-consensus-custom-presets';

// State - Roles and Configuration
const roles = ref<V3ConsensusRole[]>([]);
const v2Presets = ref<V2EnhancedPreset[]>([]);  // Available V2 presets for role selection

// State - V3 Presets
const builtInV3Presets = ref<V3ConsensusPreset[]>([...BUILTIN_V3_PRESETS]);
const customV3Presets = ref<V3ConsensusPreset[]>([]);
const selectedV3PresetId = ref<string | null>('balanced-team');

// State - View mode
type ViewMode = 'consensus' | 'individual';
const viewMode = ref<ViewMode>('consensus');
const selectedIndividualRoleId = ref<string | null>(null);

// State - Results
const patents = ref<V3ConsensusScoredPatent[]>([]);
const previousRankings = ref<Array<{ patent_id: string; rank: number }>>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const total = ref(0);
const hasUnsavedChanges = ref(false);

// State - Saved Scores
const savedScores = ref<ScoreSnapshot[]>([]);
const activeSnapshot = ref<ScoreSnapshot | null>(null);
const savedScoresLoading = ref(false);

// State - Dialogs
const showSavePresetDialog = ref(false);
const showSaveDialog = ref(false);
const newPresetName = ref('');
const newPresetDescription = ref('');

// Save dialog state
const snapshotName = ref('');
const snapshotDescription = ref('');
const setAsActive = ref(true);
const saving = ref(false);

// State - Filters
const topNOptions = [60, 100, 250, 500, 1000];
const topN = ref(100);
const llmEnhancedOnly = ref(true);

// Computed: all V3 presets
const allV3Presets = computed(() => [...builtInV3Presets.value, ...customV3Presets.value]);

// Computed: total weight
const totalWeight = computed(() => {
  return roles.value.reduce((sum, role) => sum + role.consensusWeight, 0);
});

// Computed: is weight valid (should sum to 100)
const isWeightValid = computed(() => Math.abs(totalWeight.value - 100) < 1);

// Computed: table columns
const columns = computed(() => [
  { name: 'rank', label: 'Rank', field: 'rank', align: 'center' as const, sortable: true, style: 'width: 60px' },
  { name: 'change', label: '+/-', field: 'rank_change', align: 'center' as const, style: 'width: 50px' },
  { name: 'patent_id', label: 'Patent ID', field: 'patent_id', align: 'left' as const },
  { name: 'patent_title', label: 'Title', field: 'patent_title', align: 'left' as const },
  { name: 'assignee', label: 'Assignee', field: 'assignee', align: 'left' as const },
  { name: 'super_sector', label: 'Super-Sector', field: 'super_sector', align: 'left' as const },
  { name: 'years_remaining', label: 'Years', field: 'years_remaining', align: 'center' as const, sortable: true,
    format: (val: number) => val?.toFixed(1) },
  { name: 'has_llm', label: 'LLM', field: 'has_llm_data', align: 'center' as const, style: 'width: 50px' },
  { name: 'score', label: viewMode.value === 'consensus' ? 'Consensus' : 'Score', field: 'consensus_score', align: 'center' as const, sortable: true,
    format: (val: number) => val?.toFixed(2) },
]);

// Initialize roles from defaults
function initRoles() {
  roles.value = DEFAULT_V3_ROLES.map(r => ({ ...r }));
}

// Load V2 presets from API
async function loadV2Presets() {
  try {
    v2Presets.value = await v2EnhancedApi.getPresets();
  } catch (err) {
    console.error('Failed to load V2 presets:', err);
    // Fallback to built-in preset IDs
    v2Presets.value = [
      { id: 'default', name: 'Default Balanced', description: 'Balanced scoring', isBuiltIn: true, config: {} as V2EnhancedConfig },
      { id: 'defensive', name: 'Defensive', description: 'Defensive portfolio', isBuiltIn: true, config: {} as V2EnhancedConfig },
      { id: 'licensing_focused', name: 'Licensing Focus', description: 'Licensing emphasis', isBuiltIn: true, config: {} as V2EnhancedConfig },
      { id: 'litigation_focused', name: 'Litigation Focus', description: 'Litigation emphasis', isBuiltIn: true, config: {} as V2EnhancedConfig },
      { id: 'quick_wins', name: 'Quick Wins', description: 'Quick enforcement', isBuiltIn: true, config: {} as V2EnhancedConfig },
    ];
  }
}

// Load custom V3 presets from localStorage
function loadCustomV3Presets() {
  try {
    const stored = localStorage.getItem(V3_PRESETS_KEY);
    if (stored) {
      customV3Presets.value = JSON.parse(stored);
    }
  } catch (err) {
    console.error('Failed to load custom V3 presets:', err);
  }
}

// Save custom V3 presets to localStorage
function saveCustomV3Presets() {
  localStorage.setItem(V3_PRESETS_KEY, JSON.stringify(customV3Presets.value));
}

// Apply a V3 preset
function applyV3Preset(preset: V3ConsensusPreset) {
  selectedV3PresetId.value = preset.id;
  roles.value = preset.roles.map(r => ({ ...r }));
  hasUnsavedChanges.value = true;
}

// Save current config as new V3 preset
function saveAsV3Preset() {
  if (!newPresetName.value.trim()) return;

  const newPreset: V3ConsensusPreset = {
    id: `custom-${Date.now()}`,
    name: newPresetName.value.trim(),
    description: newPresetDescription.value.trim() || 'Custom V3 preset',
    isBuiltIn: false,
    roles: roles.value.map(r => ({ ...r })),
  };

  customV3Presets.value.push(newPreset);
  saveCustomV3Presets();
  selectedV3PresetId.value = newPreset.id;

  showSavePresetDialog.value = false;
  newPresetName.value = '';
  newPresetDescription.value = '';
}

// Delete a custom V3 preset
function deleteV3Preset(presetId: string) {
  customV3Presets.value = customV3Presets.value.filter(p => p.id !== presetId);
  saveCustomV3Presets();
  if (selectedV3PresetId.value === presetId) {
    selectedV3PresetId.value = null;
  }
}

// Normalize weights to sum to 100
function normalizeWeights() {
  const total = roles.value.reduce((sum, r) => sum + r.consensusWeight, 0);
  if (total === 0) {
    // If all weights are 0, distribute equally
    const equalWeight = 100 / roles.value.length;
    roles.value.forEach(r => r.consensusWeight = Math.round(equalWeight));
  } else {
    const factor = 100 / total;
    roles.value.forEach(r => r.consensusWeight = Math.round(r.consensusWeight * factor));
  }
  // Adjust for rounding errors
  const newTotal = roles.value.reduce((sum, r) => sum + r.consensusWeight, 0);
  if (newTotal !== 100 && roles.value.length > 0) {
    roles.value[0].consensusWeight += (100 - newTotal);
  }
  hasUnsavedChanges.value = true;
  selectedV3PresetId.value = null;
}

// Build V2 config from preset ID
function buildV2ConfigFromPreset(presetId: string): V2EnhancedConfig {
  const preset = v2Presets.value.find(p => p.id === presetId);
  if (preset?.config?.weights) {
    return {
      ...preset.config,
      topN: topN.value,
      llmEnhancedOnly: llmEnhancedOnly.value,
    };
  }
  // Return default config if preset not found
  return {
    weights: {
      competitor_citations: 20,
      adjusted_forward_citations: 10,
      years_remaining: 15,
      competitor_count: 5,
      competitor_density: 5,
      eligibility_score: 5,
      validity_score: 5,
      claim_breadth: 4,
      enforcement_clarity: 6,
      design_around_difficulty: 5,
      market_relevance_score: 5,
      ipr_risk_score: 5,
      prosecution_quality_score: 5,
    },
    scaling: {},
    invert: {},
    topN: topN.value,
    llmEnhancedOnly: llmEnhancedOnly.value,
  };
}

// Calculate consensus scores
async function recalculate() {
  loading.value = true;
  error.value = null;

  try {
    if (viewMode.value === 'individual' && selectedIndividualRoleId.value) {
      // Individual view: fetch scores for single role
      const role = roles.value.find(r => r.roleId === selectedIndividualRoleId.value);
      if (!role) {
        error.value = 'Selected role not found';
        return;
      }

      const config = buildV2ConfigFromPreset(role.v2PresetId);
      const response = await v2EnhancedApi.getScores(config, previousRankings.value);

      // Map to consensus format
      patents.value = response.data.map(p => ({
        patent_id: p.patent_id,
        rank: p.rank,
        rank_change: p.rank_change,
        consensus_score: p.score,
        role_scores: { [role.roleId]: p.score },
        patent_title: p.patent_title,
        patent_abstract: p.patent_abstract,
        patent_date: p.patent_date,
        assignee: p.assignee,
        primary_sector: p.primary_sector,
        super_sector: p.super_sector,
        years_remaining: p.years_remaining,
        has_llm_data: p.has_llm_data,
        raw_metrics: p.raw_metrics,
        normalized_metrics: p.normalized_metrics,
        year_multiplier: p.year_multiplier,
      }));
      total.value = response.total;
    } else {
      // Consensus view: fetch scores for all roles and combine
      const roleScores: Map<string, Map<string, { score: number; data: V2EnhancedScoredPatent }>> = new Map();
      let allPatentIds = new Set<string>();

      // Fetch scores for each role
      for (const role of roles.value) {
        if (role.consensusWeight <= 0) continue;

        const config = buildV2ConfigFromPreset(role.v2PresetId);
        const response = await v2EnhancedApi.getScores(config, []);

        const scoreMap = new Map<string, { score: number; data: V2EnhancedScoredPatent }>();
        for (const p of response.data) {
          scoreMap.set(p.patent_id, { score: p.score, data: p });
          allPatentIds.add(p.patent_id);
        }
        roleScores.set(role.roleId, scoreMap);
      }

      // Calculate consensus scores
      const consensusResults: Array<{
        patent_id: string;
        consensus_score: number;
        role_scores: Record<string, number>;
        data: V2EnhancedScoredPatent | null;
      }> = [];

      const totalWeight = roles.value.reduce((sum, r) => sum + r.consensusWeight, 0);

      for (const patentId of allPatentIds) {
        let weightedSum = 0;
        const roleScoresForPatent: Record<string, number> = {};
        let patentData: V2EnhancedScoredPatent | null = null;

        for (const role of roles.value) {
          if (role.consensusWeight <= 0) continue;

          const scoreEntry = roleScores.get(role.roleId)?.get(patentId);
          if (scoreEntry) {
            const normalizedWeight = role.consensusWeight / totalWeight;
            weightedSum += normalizedWeight * scoreEntry.score;
            roleScoresForPatent[role.roleId] = scoreEntry.score;
            if (!patentData) patentData = scoreEntry.data;
          }
        }

        if (patentData) {
          consensusResults.push({
            patent_id: patentId,
            consensus_score: weightedSum,
            role_scores: roleScoresForPatent,
            data: patentData,
          });
        }
      }

      // Sort by consensus score and assign ranks
      consensusResults.sort((a, b) => b.consensus_score - a.consensus_score);

      // Apply topN limit
      const limitedResults = consensusResults.slice(0, topN.value);

      // Calculate rank changes
      const prevRankMap = new Map(previousRankings.value.map(r => [r.patent_id, r.rank]));

      patents.value = limitedResults.map((r, idx) => {
        const rank = idx + 1;
        const prevRank = prevRankMap.get(r.patent_id);
        const rankChange = prevRank !== undefined ? prevRank - rank : undefined;

        return {
          patent_id: r.patent_id,
          rank,
          rank_change: rankChange,
          consensus_score: r.consensus_score,
          role_scores: r.role_scores,
          patent_title: r.data?.patent_title || '',
          patent_abstract: r.data?.patent_abstract || '',
          patent_date: r.data?.patent_date || '',
          assignee: r.data?.assignee || '',
          primary_sector: r.data?.primary_sector || '',
          super_sector: r.data?.super_sector || '',
          years_remaining: r.data?.years_remaining || 0,
          has_llm_data: r.data?.has_llm_data || false,
          raw_metrics: r.data?.raw_metrics || {},
          normalized_metrics: r.data?.normalized_metrics || {},
          year_multiplier: r.data?.year_multiplier || 1,
        };
      });

      total.value = consensusResults.length;
    }

    // Update previous rankings for next comparison
    previousRankings.value = patents.value.map(p => ({
      patent_id: p.patent_id,
      rank: p.rank,
    }));

    hasUnsavedChanges.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to calculate scores';
    console.error('Failed to calculate consensus scores:', err);
  } finally {
    loading.value = false;
  }
}

// Reset rank movements
function resetRankMovements() {
  previousRankings.value = patents.value.map(p => ({
    patent_id: p.patent_id,
    rank: p.rank,
  }));
  patents.value = patents.value.map(p => ({
    ...p,
    rank_change: undefined,
  }));
}

// Load saved scores from database
async function loadSavedScores() {
  savedScoresLoading.value = true;
  try {
    const [allSnapshots, activeSnapshots] = await Promise.all([
      snapshotApi.list(),
      snapshotApi.getActive(),
    ]);
    // Filter to V3 only
    savedScores.value = allSnapshots.filter(s => s.scoreType === 'V3');
    activeSnapshot.value = activeSnapshots.V3;
  } catch (err) {
    console.error('Failed to load saved scores:', err);
  } finally {
    savedScoresLoading.value = false;
  }
}

async function saveScores() {
  if (!snapshotName.value.trim()) return;

  saving.value = true;
  try {
    // Build the scores array from current patents
    const scores = patents.value.map(p => ({
      patent_id: p.patent_id,
      score: p.consensus_score,
      rank: p.rank,
      raw_metrics: p.raw_metrics,
      normalized_metrics: p.normalized_metrics,
    }));

    // Build the config including role configuration
    const config = {
      roles: roles.value.map(r => ({ ...r })),
      topN: topN.value,
      llmEnhancedOnly: llmEnhancedOnly.value,
    };

    const snapshot = await snapshotApi.save({
      name: snapshotName.value.trim(),
      description: snapshotDescription.value.trim() || undefined,
      scoreType: 'V3',
      config,
      scores,
      setActive: setAsActive.value,
    });

    $q.notify({
      type: 'positive',
      message: `Saved "${snapshot.name}" with ${snapshot.patentCount.toLocaleString()} scores`,
      caption: setAsActive.value ? 'Set as active V3 scores' : undefined,
    });

    // Reload saved scores
    await loadSavedScores();

    // Reset dialog
    showSaveDialog.value = false;
    snapshotName.value = '';
    snapshotDescription.value = '';
    setAsActive.value = true;
  } catch (err) {
    console.error('Failed to save scores:', err);
    $q.notify({
      type: 'negative',
      message: 'Failed to save scores',
      caption: err instanceof Error ? err.message : 'Unknown error',
    });
  } finally {
    saving.value = false;
  }
}

async function activateSnapshot(snapshotId: string) {
  try {
    await snapshotApi.activate(snapshotId);
    await loadSavedScores();
    $q.notify({
      type: 'positive',
      message: 'Scores activated',
      caption: 'These scores will be used in Portfolio and Aggregates',
    });
  } catch (err) {
    console.error('Failed to activate snapshot:', err);
    $q.notify({
      type: 'negative',
      message: 'Failed to activate snapshot',
    });
  }
}

async function deactivateSnapshot(snapshotId: string) {
  try {
    await snapshotApi.deactivate(snapshotId);
    await loadSavedScores();
    $q.notify({
      type: 'info',
      message: 'Scores deactivated',
    });
  } catch (err) {
    console.error('Failed to deactivate snapshot:', err);
  }
}

async function deleteSavedScores(snapshotId: string) {
  const snapshot = savedScores.value.find(s => s.id === snapshotId);
  if (!snapshot) return;

  $q.dialog({
    title: 'Delete Saved Scores',
    message: `Delete "${snapshot.name}" with ${snapshot.patentCount.toLocaleString()} scores? This cannot be undone.`,
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    try {
      await snapshotApi.delete(snapshotId);
      await loadSavedScores();
      $q.notify({
        type: 'info',
        message: 'Saved scores deleted',
      });
    } catch (err) {
      console.error('Failed to delete saved scores:', err);
      $q.notify({
        type: 'negative',
        message: 'Failed to delete saved scores',
      });
    }
  });
}

// Export to CSV
function exportCSV() {
  const date = new Date().toISOString().split('T')[0];

  // Build header comments
  const comments = [
    `# V3 Consensus Scoring Export`,
    `# Generated: ${new Date().toISOString()}`,
    `# View Mode: ${viewMode.value}`,
    `# Top N: ${topN.value}`,
    `# Complete Data Only: ${llmEnhancedOnly.value}`,
    `# Role Weights: ${roles.value.map(r => `${r.roleName}=${r.consensusWeight}%`).join(', ')}`,
  ];

  // Build CSV headers
  const roleScoreHeaders = viewMode.value === 'consensus'
    ? roles.value.filter(r => r.consensusWeight > 0).map(r => `score_${r.roleId}`)
    : [];

  const headers = [
    'rank',
    'rank_change',
    'patent_id',
    'title',
    'assignee',
    'super_sector',
    'primary_sector',
    'years_remaining',
    'has_llm_data',
    'consensus_score',
    ...roleScoreHeaders,
  ];

  // Build rows
  const rows = patents.value.map(p => {
    const row = [
      p.rank,
      p.rank_change ?? '',
      p.patent_id,
      `"${(p.patent_title || '').replace(/"/g, '""')}"`,
      `"${(p.assignee || '').replace(/"/g, '""')}"`,
      p.super_sector || '',
      p.primary_sector || '',
      p.years_remaining?.toFixed(1) || '',
      p.has_llm_data ? 'Y' : 'N',
      p.consensus_score?.toFixed(2) || '',
      ...roleScoreHeaders.map(h => {
        const roleId = h.replace('score_', '');
        return p.role_scores[roleId]?.toFixed(2) || '';
      }),
    ];
    return row.join(',');
  });

  const csvContent = [...comments, '', headers.join(','), ...rows].join('\n');

  // Download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `v3-consensus-top${topN.value}-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Navigate to patent detail
function goToPatent(patentId: string) {
  router.push({ name: 'patent-detail', params: { id: patentId } });
}

// Handle role changes
function onRoleChange() {
  selectedV3PresetId.value = null;
  hasUnsavedChanges.value = true;
}

// Watch filter changes
watch([topN, llmEnhancedOnly], () => {
  hasUnsavedChanges.value = true;
});

// Watch view mode changes
watch(viewMode, () => {
  if (viewMode.value === 'individual' && !selectedIndividualRoleId.value && roles.value.length > 0) {
    selectedIndividualRoleId.value = roles.value[0].roleId;
  }
  hasUnsavedChanges.value = true;
});

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

// Initialize
onMounted(async () => {
  initRoles();
  await Promise.all([loadV2Presets(), loadSavedScores()]);
  loadCustomV3Presets();
  await recalculate();
});
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5">V3 Consensus Scoring</div>
      <q-badge color="primary" class="q-ml-md">
        {{ total.toLocaleString() }} patents
      </q-badge>
      <q-space />
      <q-badge v-if="hasUnsavedChanges" color="warning" outline class="q-mr-md">
        Unsaved changes
      </q-badge>
    </div>

    <div class="row q-gutter-md">
      <!-- Left Sidebar: Role Configuration -->
      <div class="col-3" style="min-width: 340px; max-width: 400px">
        <!-- Top Controls -->
        <q-card class="q-mb-md">
          <q-card-section class="q-pb-sm">
            <div class="row items-center q-gutter-sm">
              <q-select
                v-model="topN"
                :options="topNOptions"
                label="Top N"
                dense
                outlined
                style="width: 100px"
              />
              <q-toggle
                v-model="llmEnhancedOnly"
                label="Complete Data"
                dense
              >
                <q-tooltip>Only show patents with LLM enrichment data</q-tooltip>
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

        <!-- View Mode -->
        <q-card class="q-mb-md">
          <q-card-section class="q-pb-sm">
            <div class="text-subtitle2 q-mb-sm">View Mode</div>
            <div class="row q-gutter-sm">
              <q-btn-toggle
                v-model="viewMode"
                :options="[
                  { label: 'Consensus', value: 'consensus' },
                  { label: 'Individual', value: 'individual' },
                ]"
                dense
                no-caps
                toggle-color="primary"
              />
              <q-select
                v-if="viewMode === 'individual'"
                v-model="selectedIndividualRoleId"
                :options="roles.map(r => ({ label: r.roleName, value: r.roleId }))"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                dense
                outlined
                class="col"
              />
            </div>
          </q-card-section>
        </q-card>

        <!-- V3 Presets -->
        <q-card class="q-mb-md">
          <q-card-section class="q-pb-sm">
            <div class="row items-center q-mb-sm">
              <span class="text-subtitle2">V3 Presets</span>
              <q-space />
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
                v-for="preset in allV3Presets"
                :key="preset.id"
                clickable
                :removable="!preset.isBuiltIn"
                :color="selectedV3PresetId === preset.id ? 'primary' : 'grey-4'"
                :text-color="selectedV3PresetId === preset.id ? 'white' : 'black'"
                size="sm"
                @click="applyV3Preset(preset)"
                @remove="deleteV3Preset(preset.id)"
              >
                {{ preset.name }}
                <q-tooltip>{{ preset.description }}</q-tooltip>
              </q-chip>
            </div>
          </q-card-section>
        </q-card>

        <!-- Role Configuration Table -->
        <q-card class="q-mb-md">
          <q-card-section class="q-pb-none">
            <div class="row items-center">
              <span class="text-subtitle2">Role Weights</span>
              <q-space />
              <q-badge
                :color="isWeightValid ? 'positive' : 'warning'"
              >
                {{ totalWeight }}%
              </q-badge>
              <q-btn
                v-if="!isWeightValid"
                flat
                dense
                size="sm"
                label="Normalize"
                class="q-ml-sm"
                @click="normalizeWeights"
              >
                <q-tooltip>Adjust weights to sum to 100%</q-tooltip>
              </q-btn>
            </div>
          </q-card-section>

          <q-card-section class="q-pt-sm">
            <div
              v-for="role in roles"
              :key="role.roleId"
              class="q-mb-md"
            >
              <div class="row items-center q-mb-xs">
                <span class="text-body2 text-weight-medium">{{ role.roleName }}</span>
                <q-space />
                <q-badge color="primary" outline>
                  {{ role.consensusWeight }}%
                </q-badge>
              </div>

              <div class="row items-center q-gutter-sm">
                <q-select
                  v-model="role.v2PresetId"
                  :options="v2Presets.map(p => ({ label: p.name, value: p.id }))"
                  option-value="value"
                  option-label="label"
                  emit-value
                  map-options
                  dense
                  outlined
                  class="col"
                  @update:model-value="onRoleChange"
                >
                  <q-tooltip>V2 scoring preset for this role</q-tooltip>
                </q-select>

                <q-input
                  v-model.number="role.consensusWeight"
                  type="number"
                  :min="0"
                  :max="100"
                  dense
                  outlined
                  style="width: 70px"
                  @update:model-value="onRoleChange"
                >
                  <template v-slot:append>
                    <span class="text-caption">%</span>
                  </template>
                </q-input>
              </div>
            </div>
          </q-card-section>
        </q-card>

        <!-- Saved Scores -->
        <q-card class="q-mb-md">
          <q-card-section class="q-pb-sm">
            <div class="row items-center q-mb-sm">
              <span class="text-subtitle2">Saved Scores</span>
              <q-space />
              <q-btn
                flat
                dense
                size="sm"
                icon="save"
                label="Save"
                color="primary"
                :disable="patents.length === 0"
                @click="showSaveDialog = true"
              />
            </div>

            <!-- Active Snapshot Badge -->
            <div v-if="activeSnapshot" class="q-mb-sm">
              <q-badge color="positive" class="q-pa-xs">
                <q-icon name="check_circle" size="xs" class="q-mr-xs" />
                Active: {{ activeSnapshot.name }}
              </q-badge>
            </div>
            <div v-else class="q-mb-sm">
              <q-badge color="warning" outline class="q-pa-xs">
                No active V3 scores
              </q-badge>
            </div>

            <!-- Saved Scores List -->
            <q-list v-if="savedScores.length > 0" dense separator class="bg-grey-1 rounded-borders">
              <q-item
                v-for="snap in savedScores"
                :key="snap.id"
                dense
              >
                <q-item-section>
                  <q-item-label>
                    {{ snap.name }}
                    <q-icon
                      v-if="snap.isActive"
                      name="check_circle"
                      color="positive"
                      size="xs"
                      class="q-ml-xs"
                    />
                  </q-item-label>
                  <q-item-label caption>
                    {{ snap.patentCount.toLocaleString() }} patents
                    <span class="q-mx-xs">|</span>
                    {{ new Date(snap.createdAt).toLocaleDateString() }}
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <div class="row no-wrap q-gutter-xs">
                    <q-btn
                      v-if="!snap.isActive"
                      flat
                      dense
                      round
                      size="sm"
                      icon="check_circle"
                      color="positive"
                      @click="activateSnapshot(snap.id)"
                    >
                      <q-tooltip>Set as active</q-tooltip>
                    </q-btn>
                    <q-btn
                      v-else
                      flat
                      dense
                      round
                      size="sm"
                      icon="remove_circle"
                      color="grey"
                      @click="deactivateSnapshot(snap.id)"
                    >
                      <q-tooltip>Deactivate</q-tooltip>
                    </q-btn>
                    <q-btn
                      flat
                      dense
                      round
                      size="sm"
                      icon="delete"
                      color="negative"
                      @click="deleteSavedScores(snap.id)"
                    >
                      <q-tooltip>Delete</q-tooltip>
                    </q-btn>
                  </div>
                </q-item-section>
              </q-item>
            </q-list>
            <div v-else-if="!savedScoresLoading" class="text-caption text-grey q-pa-sm">
              No saved scores. Save current scores to use them in Portfolio and Aggregates.
            </div>
            <q-spinner v-if="savedScoresLoading" size="sm" class="q-mt-sm" />
          </q-card-section>
        </q-card>
      </div>

      <!-- Right Side: Rankings Table -->
      <div class="col">
        <q-card>
          <q-card-section class="q-pb-none">
            <div class="row items-center">
              <div class="text-h6">Patent Rankings</div>
              <q-badge
                v-if="viewMode === 'individual' && selectedIndividualRoleId"
                color="deep-purple"
                class="q-ml-sm"
              >
                {{ roles.find(r => r.roleId === selectedIndividualRoleId)?.roleName }}
              </q-badge>
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
              :rows="patents"
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
                    max-width="550px"
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

                      <!-- Role Scores (for consensus view) -->
                      <div v-if="viewMode === 'consensus' && Object.keys(props.row.role_scores).length > 0" class="q-mb-md">
                        <div class="text-subtitle2 q-mb-xs">Role Scores</div>
                        <div class="row q-gutter-xs">
                          <q-chip
                            v-for="role in roles.filter(r => r.consensusWeight > 0)"
                            :key="role.roleId"
                            dense
                            size="sm"
                            :color="props.row.role_scores[role.roleId] >= 70 ? 'positive' : props.row.role_scores[role.roleId] >= 50 ? 'warning' : 'grey'"
                          >
                            {{ role.roleName.split(' ')[0] }}: {{ props.row.role_scores[role.roleId]?.toFixed(1) || '-' }}
                          </q-chip>
                        </div>
                      </div>

                      <div class="text-subtitle2 q-mb-xs">Scoring Metrics</div>
                      <table class="metrics-table">
                        <thead>
                          <tr>
                            <th>Metric</th>
                            <th>Raw</th>
                            <th>Norm</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="key in Object.keys(props.row.normalized_metrics || {}).slice(0, 10)" :key="key">
                            <td>{{ formatMetricName(key) }}</td>
                            <td class="text-right">{{ props.row.raw_metrics[key]?.toFixed?.(1) || props.row.raw_metrics[key] || '-' }}</td>
                            <td class="text-right">{{ ((props.row.normalized_metrics[key] || 0) * 100).toFixed(0) }}%</td>
                          </tr>
                        </tbody>
                      </table>

                      <div class="row q-mt-sm text-caption">
                        <div class="col">Year Mult: <strong class="text-yellow-4">{{ props.row.year_multiplier?.toFixed(3) }}</strong></div>
                        <div class="col text-right">Consensus: <strong class="text-amber-3" style="font-size: 1.1em">{{ props.row.consensus_score?.toFixed(2) }}</strong></div>
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
                    :color="props.row.consensus_score > 70 ? 'positive' : props.row.consensus_score > 50 ? 'warning' : 'grey'"
                  >
                    {{ props.row.consensus_score?.toFixed(2) }}
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
          <div class="text-h6">Save as V3 Preset</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newPresetName"
            label="Preset Name"
            dense
            autofocus
            @keyup.enter="saveAsV3Preset"
          />
          <q-input
            v-model="newPresetDescription"
            label="Description (optional)"
            dense
            class="q-mt-md"
          />
          <div class="text-caption text-grey q-mt-md">
            Saves current role configuration ({{ roles.length }} roles with their V2 presets and weights).
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Save"
            :disable="!newPresetName.trim()"
            @click="saveAsV3Preset"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Save Scores Dialog -->
    <q-dialog v-model="showSaveDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Save Scores</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="snapshotName"
            label="Name"
            dense
            autofocus
            :placeholder="`V3 Consensus - ${new Date().toLocaleDateString()}`"
          />
          <q-input
            v-model="snapshotDescription"
            label="Description (optional)"
            dense
            type="textarea"
            rows="2"
            class="q-mt-md"
          />
          <q-toggle
            v-model="setAsActive"
            label="Set as active V3 scores"
            dense
            class="q-mt-md"
          />
          <div class="text-caption text-grey q-mt-sm">
            Saves {{ patents.length.toLocaleString() }} consensus scores.
            <strong v-if="setAsActive">Active scores</strong>
            <span v-else>Saved scores</span>
            will be used for V3 in Portfolio Summary and Aggregate View.
          </div>

          <q-banner v-if="activeSnapshot && setAsActive" class="bg-warning-1 q-mt-md" dense>
            <template v-slot:avatar>
              <q-icon name="info" color="warning" />
            </template>
            This will replace "{{ activeSnapshot.name }}" as the active V3 scores.
          </q-banner>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup :disable="saving" />
          <q-btn
            color="primary"
            label="Save"
            icon="save"
            :disable="!snapshotName.trim()"
            :loading="saving"
            @click="saveScores"
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
/* Patent detail tooltip - larger and more detailed */
.patent-detail-tooltip {
  max-width: 550px !important;
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
