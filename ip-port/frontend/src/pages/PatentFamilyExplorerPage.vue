<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import {
  patentFamilyV2Api,
  type ScoringWeightsV2,
  type ScoredCandidateV2,
  type ExplorationStateV2,
  type ExpansionHistoryStep,
  type ScoringPresetV2,
} from '@/services/api';

const router = useRouter();
const $q = useQuasar();

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: ScoringWeightsV2 = {
  taxonomicOverlap: 0.20,
  commonPriorArt: 0.20,
  commonForwardCites: 0.20,
  competitorOverlap: 0.08,
  portfolioAffiliate: 0.10,
  citationSectorAlignment: 0.07,
  multiPathConnectivity: 0.05,
  assigneeRelationship: 0.05,
  temporalProximity: 0.05,
  depthDecayRate: 0.20,
};

const WEIGHT_DIMENSIONS = [
  { key: 'taxonomicOverlap' as const, label: 'Taxonomic Overlap', description: 'Sub-sector, sector, or super-sector match with seeds', color: 'blue' },
  { key: 'commonPriorArt' as const, label: 'Common Prior Art', description: 'Jaccard similarity of backward citations', color: 'indigo' },
  { key: 'commonForwardCites' as const, label: 'Common Forward Cites', description: 'Jaccard similarity of forward citations', color: 'deep-purple' },
  { key: 'competitorOverlap' as const, label: 'Competitor Overlap', description: 'Shared competitor entities in citation network', color: 'red' },
  { key: 'portfolioAffiliate' as const, label: 'Portfolio/Affiliate', description: 'In portfolio (1.0) or affiliate (0.7)', color: 'green' },
  { key: 'citationSectorAlignment' as const, label: 'Citation Sector Align', description: 'Fraction of connecting citations in matching sectors', color: 'teal' },
  { key: 'multiPathConnectivity' as const, label: 'Multi-Path Connect', description: 'Number of independent citation paths (capped at 3)', color: 'cyan' },
  { key: 'assigneeRelationship' as const, label: 'Assignee Relationship', description: 'Same assignee (1.0) or affiliate group (0.5)', color: 'amber' },
  { key: 'temporalProximity' as const, label: 'Temporal Proximity', description: 'Linear decay over 15 years from seed filing dates', color: 'orange' },
];

// ─────────────────────────────────────────────────────────────────────────────
// State — Seeds
// ─────────────────────────────────────────────────────────────────────────────

const seedInput = ref('');
const seedPatentIds = computed(() => {
  return seedInput.value
    .split(/[\s,\n]+/)
    .map(id => id.trim().replace(/^US/i, ''))
    .filter(id => id && /^\d{6,}$/.test(id));
});

// ─────────────────────────────────────────────────────────────────────────────
// State — Exploration
// ─────────────────────────────────────────────────────────────────────────────

const explorationId = ref<string | null>(null);
const explorationState = ref<ExplorationStateV2 | null>(null);
const loading = ref(false);
const expanding = ref(false);
const rescoring = ref(false);
const error = ref<string | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// State — Weights & Presets
// ─────────────────────────────────────────────────────────────────────────────

const weights = ref<ScoringWeightsV2>({ ...DEFAULT_WEIGHTS });
const presets = ref<Record<string, ScoringPresetV2>>({});
const selectedPreset = ref<string | null>('balanced');

// ─────────────────────────────────────────────────────────────────────────────
// State — Thresholds
// ─────────────────────────────────────────────────────────────────────────────

const membershipThreshold = ref(60);
const expansionThreshold = ref(30);

// ─────────────────────────────────────────────────────────────────────────────
// State — UI
// ─────────────────────────────────────────────────────────────────────────────

type ZoneFilter = 'all' | 'members' | 'candidates' | 'excluded';
const activeZone = ref<ZoneFilter>('all');
const searchFilter = ref('');
const pagination = ref({
  page: 1,
  rowsPerPage: 50,
  sortBy: 'score',
  descending: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// State — Dialogs
// ─────────────────────────────────────────────────────────────────────────────

const showSaveDialog = ref(false);
const saveName = ref('');
const saveDescription = ref('');
const saving = ref(false);

const showFocusAreaDialog = ref(false);
const focusAreaName = ref('');
const focusAreaDescription = ref('');
const creatingFocusArea = ref(false);

// ─────────────────────────────────────────────────────────────────────────────
// Computed — All Candidates (merged view)
// ─────────────────────────────────────────────────────────────────────────────

const allCandidates = computed<ScoredCandidateV2[]>(() => {
  if (!explorationState.value) return [];
  return [
    ...explorationState.value.members,
    ...explorationState.value.candidates,
    ...explorationState.value.excluded,
  ];
});

const zoneCounts = computed(() => {
  if (!explorationState.value) return { all: 0, members: 0, candidates: 0, excluded: 0 };
  return {
    all: allCandidates.value.length,
    members: explorationState.value.members.length,
    candidates: explorationState.value.candidates.length,
    excluded: explorationState.value.excluded.length,
  };
});

const displayedCandidates = computed(() => {
  let list: ScoredCandidateV2[];
  if (!explorationState.value) return [];

  switch (activeZone.value) {
    case 'members':
      list = explorationState.value.members;
      break;
    case 'candidates':
      list = explorationState.value.candidates;
      break;
    case 'excluded':
      list = explorationState.value.excluded;
      break;
    default:
      list = allCandidates.value;
  }

  if (searchFilter.value.trim()) {
    const q = searchFilter.value.toLowerCase();
    list = list.filter(c =>
      c.patentId.includes(q) ||
      (c.title || '').toLowerCase().includes(q) ||
      (c.assignee || '').toLowerCase().includes(q) ||
      (c.sector || '').toLowerCase().includes(q)
    );
  }

  return list;
});

const totalWeight = computed(() => {
  const w = weights.value;
  return w.taxonomicOverlap + w.commonPriorArt + w.commonForwardCites +
    w.competitorOverlap + w.portfolioAffiliate + w.citationSectorAlignment +
    w.multiPathConnectivity + w.assigneeRelationship + w.temporalProximity;
});

const tableColumns = computed(() => [
  { name: 'status', label: 'Status', field: 'zone', sortable: true, align: 'center' as const, style: 'width: 50px' },
  { name: 'score', label: 'Score', field: (row: ScoredCandidateV2) => row.score.compositeScore, sortable: true, align: 'right' as const, style: 'width: 70px' },
  { name: 'patentId', label: 'Patent ID', field: 'patentId', sortable: true, align: 'left' as const },
  { name: 'title', label: 'Title', field: 'title', sortable: true, align: 'left' as const },
  { name: 'assignee', label: 'Assignee', field: 'assignee', sortable: true, align: 'left' as const },
  { name: 'sector', label: 'Sector', field: 'sector', sortable: true, align: 'left' as const },
  { name: 'relation', label: 'Relation', field: 'relation', sortable: true, align: 'left' as const },
  { name: 'inPortfolio', label: 'Portfolio', field: 'inPortfolio', sortable: true, align: 'center' as const, style: 'width: 50px' },
  { name: 'remainingYears', label: 'Yrs Left', field: 'remainingYears', sortable: true, align: 'right' as const, format: (val: number | undefined) => val?.toFixed(1) || '--' },
]);

const hasExploration = computed(() => !!explorationId.value && !!explorationState.value);

// ─────────────────────────────────────────────────────────────────────────────
// Methods — Exploration Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

async function createExploration() {
  if (seedPatentIds.value.length === 0) return;

  loading.value = true;
  error.value = null;

  try {
    const state = await patentFamilyV2Api.createExploration({
      seedPatentIds: seedPatentIds.value,
      weights: weights.value,
      membershipThreshold: membershipThreshold.value,
      expansionThreshold: expansionThreshold.value,
    });

    explorationId.value = state.id;
    explorationState.value = state;

    $q.notify({
      type: 'positive',
      message: `Exploration created with ${state.memberCount} seed patents`,
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create exploration';
    $q.notify({ type: 'negative', message: error.value });
  } finally {
    loading.value = false;
  }
}

async function expand(direction: 'forward' | 'backward' | 'both') {
  if (!explorationId.value) return;

  expanding.value = true;
  error.value = null;

  try {
    const result = await patentFamilyV2Api.expand(explorationId.value, {
      direction,
      weights: weights.value,
      membershipThreshold: membershipThreshold.value,
      expansionThreshold: expansionThreshold.value,
    });

    // Refresh full state
    explorationState.value = await patentFamilyV2Api.getExploration(explorationId.value);

    const msg = `Discovered ${result.stats.totalDiscovered} patents: ${result.stats.aboveMembership} members, ${result.stats.inExpansionZone} candidates, ${result.stats.belowExpansion} excluded`;
    $q.notify({ type: 'positive', message: msg, timeout: 5000 });

    if (result.warnings.length > 0) {
      $q.notify({ type: 'warning', message: result.warnings.join('; '), timeout: 8000 });
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Expansion failed';
    $q.notify({ type: 'negative', message: error.value });
  } finally {
    expanding.value = false;
  }
}

async function expandSiblingsAction(direction: 'forward' | 'backward' | 'both') {
  if (!explorationId.value) return;

  expanding.value = true;
  error.value = null;

  try {
    const result = await patentFamilyV2Api.expandSiblings(explorationId.value, {
      direction,
      weights: weights.value,
      membershipThreshold: membershipThreshold.value,
      expansionThreshold: expansionThreshold.value,
    });

    explorationState.value = await patentFamilyV2Api.getExploration(explorationId.value);

    const msg = `Sibling discovery: ${result.stats.totalDiscovered} found, ${result.stats.aboveMembership} members, ${result.stats.inExpansionZone} candidates`;
    $q.notify({ type: 'positive', message: msg, timeout: 5000 });
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Sibling expansion failed';
    $q.notify({ type: 'negative', message: error.value });
  } finally {
    expanding.value = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Methods — Rescore (debounced)
// ─────────────────────────────────────────────────────────────────────────────

let rescoreTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRescore() {
  if (!explorationId.value) return;
  if (rescoreTimer) clearTimeout(rescoreTimer);
  rescoreTimer = setTimeout(executeRescore, 300);
}

async function executeRescore() {
  if (!explorationId.value) return;

  rescoring.value = true;
  try {
    await patentFamilyV2Api.rescore(explorationId.value, {
      weights: weights.value,
      membershipThreshold: membershipThreshold.value,
      expansionThreshold: expansionThreshold.value,
    });

    explorationState.value = await patentFamilyV2Api.getExploration(explorationId.value);
  } catch (err) {
    console.error('[Rescore] Failed:', err);
  } finally {
    rescoring.value = false;
  }
}

// Deep watch weights + thresholds for rescore
watch(
  [weights, membershipThreshold, expansionThreshold],
  () => {
    if (explorationId.value) {
      selectedPreset.value = null; // custom weights now
      scheduleRescore();
    }
  },
  { deep: true },
);

// ─────────────────────────────────────────────────────────────────────────────
// Methods — Status Toggle
// ─────────────────────────────────────────────────────────────────────────────

async function toggleStatus(candidate: ScoredCandidateV2) {
  if (!explorationId.value) return;

  // Cycle: member → excluded → candidate → member
  const statusCycle: Record<string, 'member' | 'candidate' | 'excluded'> = {
    member: 'excluded',
    expansion: 'excluded',
    rejected: 'member',
  };
  const newStatus = statusCycle[candidate.zone] || 'candidate';

  try {
    await patentFamilyV2Api.updateCandidates(explorationId.value, [
      { patentId: candidate.patentId, status: newStatus },
    ]);
    explorationState.value = await patentFamilyV2Api.getExploration(explorationId.value);
  } catch (err) {
    $q.notify({ type: 'negative', message: 'Failed to update status' });
  }
}

async function acceptAllAboveThreshold() {
  if (!explorationId.value || !explorationState.value) return;

  const toAccept = explorationState.value.candidates.filter(
    c => c.score.compositeScore >= membershipThreshold.value
  );

  if (toAccept.length === 0) {
    $q.notify({ type: 'info', message: 'No candidates above membership threshold' });
    return;
  }

  try {
    await patentFamilyV2Api.updateCandidates(
      explorationId.value,
      toAccept.map(c => ({ patentId: c.patentId, status: 'member' as const })),
    );
    explorationState.value = await patentFamilyV2Api.getExploration(explorationId.value);
    $q.notify({ type: 'positive', message: `Accepted ${toAccept.length} candidates as members` });
  } catch (err) {
    $q.notify({ type: 'negative', message: 'Failed to accept candidates' });
  }
}

async function rejectAllBelowThreshold() {
  if (!explorationId.value || !explorationState.value) return;

  const toReject = explorationState.value.candidates.filter(
    c => c.score.compositeScore < expansionThreshold.value
  );

  if (toReject.length === 0) {
    $q.notify({ type: 'info', message: 'No candidates below expansion threshold' });
    return;
  }

  try {
    await patentFamilyV2Api.updateCandidates(
      explorationId.value,
      toReject.map(c => ({ patentId: c.patentId, status: 'excluded' as const })),
    );
    explorationState.value = await patentFamilyV2Api.getExploration(explorationId.value);
    $q.notify({ type: 'positive', message: `Excluded ${toReject.length} candidates` });
  } catch (err) {
    $q.notify({ type: 'negative', message: 'Failed to exclude candidates' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Methods — Presets
// ─────────────────────────────────────────────────────────────────────────────

function applyPreset(key: string) {
  const preset = presets.value[key];
  if (!preset) return;

  selectedPreset.value = key;
  // Update weights without triggering rescore for each field — set all at once
  weights.value = { ...preset.weights };
  // The deep watcher will trigger rescore
}

function resetWeights() {
  selectedPreset.value = 'balanced';
  weights.value = { ...DEFAULT_WEIGHTS };
  membershipThreshold.value = 60;
  expansionThreshold.value = 30;
}

// ─────────────────────────────────────────────────────────────────────────────
// Methods — Save & Focus Area
// ─────────────────────────────────────────────────────────────────────────────

async function saveExploration() {
  if (!explorationId.value || !saveName.value.trim()) return;

  saving.value = true;
  try {
    await patentFamilyV2Api.save(explorationId.value, {
      name: saveName.value.trim(),
      description: saveDescription.value.trim() || undefined,
    });
    showSaveDialog.value = false;
    $q.notify({ type: 'positive', message: 'Exploration saved' });
  } catch (err) {
    $q.notify({ type: 'negative', message: 'Failed to save exploration' });
  } finally {
    saving.value = false;
  }
}

async function createFocusArea() {
  if (!explorationId.value || !focusAreaName.value.trim()) return;

  creatingFocusArea.value = true;
  try {
    const result = await patentFamilyV2Api.createFocusArea(explorationId.value, {
      name: focusAreaName.value.trim(),
      description: focusAreaDescription.value.trim() || undefined,
      includeExternalPatents: true,
    });

    showFocusAreaDialog.value = false;
    $q.notify({
      type: 'positive',
      message: `Created focus area "${result.focusArea.name}" with ${result.added} patents`,
    });

    router.push({ name: 'focus-area-detail', params: { id: result.focusArea.id } });
  } catch (err) {
    $q.notify({ type: 'negative', message: err instanceof Error ? err.message : 'Failed to create focus area' });
  } finally {
    creatingFocusArea.value = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clearExploration() {
  seedInput.value = '';
  explorationId.value = null;
  explorationState.value = null;
  error.value = null;
  resetWeights();
}

function scoreColor(score: number): string {
  if (score >= membershipThreshold.value) return 'positive';
  if (score >= expansionThreshold.value) return 'amber';
  return 'negative';
}

function zoneIcon(zone: string): string {
  if (zone === 'member') return 'check_circle';
  if (zone === 'rejected') return 'cancel';
  return 'remove_circle_outline';
}

function zoneColor(zone: string): string {
  if (zone === 'member') return 'positive';
  if (zone === 'rejected') return 'negative';
  return 'grey';
}

function dimensionLabel(key: string): string {
  const dim = WEIGHT_DIMENSIONS.find(d => d.key === key);
  return dim?.label || key;
}

function formatPct(val: number): string {
  return `${Math.round(val * 100)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mount — Load presets
// ─────────────────────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    presets.value = await patentFamilyV2Api.getPresets();
  } catch (err) {
    console.error('Failed to load presets:', err);
  }
});
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="text-h5">Patent Family Explorer</div>
      <q-badge color="primary" class="q-ml-md" v-if="explorationState">
        Gen {{ explorationState.currentGeneration }}
      </q-badge>
      <q-badge color="green" class="q-ml-sm" v-if="zoneCounts.members > 0">
        {{ zoneCounts.members }} members
      </q-badge>
      <q-badge color="amber" text-color="dark" class="q-ml-sm" v-if="zoneCounts.candidates > 0">
        {{ zoneCounts.candidates }} candidates
      </q-badge>
      <q-spinner-dots v-if="rescoring" color="primary" class="q-ml-md" size="20px" />
      <q-space />
      <q-btn
        v-if="hasExploration"
        flat
        dense
        icon="refresh"
        label="New"
        @click="clearExploration"
      />
    </div>

    <div class="row q-col-gutter-md">
      <!-- ═══════════════════════════════════════════════════════════════════ -->
      <!-- LEFT PANEL (col-4) -->
      <!-- ═══════════════════════════════════════════════════════════════════ -->
      <div class="col-12 col-md-4">

        <!-- Card 1: Seed Patents -->
        <q-card class="q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">
              <q-icon name="scatter_plot" class="q-mr-sm" />
              Seed Patents
            </div>
            <q-input
              v-model="seedInput"
              type="textarea"
              outlined
              dense
              rows="4"
              :disable="hasExploration"
              placeholder="Enter patent IDs (one per line or comma-separated)&#10;e.g., 10123456, 10234567"
            />
            <div class="row q-mt-sm q-gutter-sm items-center">
              <q-badge color="primary">{{ seedPatentIds.length }} seeds</q-badge>
              <q-btn
                v-if="seedPatentIds.length > 0 && !hasExploration"
                flat dense size="sm" label="Clear"
                @click="seedInput = ''"
              />
            </div>
          </q-card-section>
        </q-card>

        <!-- Create Exploration Button -->
        <q-btn
          v-if="!hasExploration"
          color="primary"
          icon="explore"
          label="Create Exploration"
          :loading="loading"
          :disable="seedPatentIds.length === 0"
          class="full-width q-mb-md"
          @click="createExploration"
        />

        <!-- Card 2: Scoring Weights (after exploration) -->
        <q-card v-if="hasExploration" class="q-mb-md">
          <q-card-section>
            <div class="row items-center q-mb-sm">
              <div class="text-subtitle1">
                <q-icon name="tune" class="q-mr-sm" />
                Scoring Weights
              </div>
              <q-space />
              <q-btn flat dense size="sm" label="Reset" icon="restart_alt" @click="resetWeights" />
            </div>

            <!-- Preset dropdown -->
            <q-select
              v-model="selectedPreset"
              :options="Object.entries(presets).map(([k, v]) => ({ label: v.label, value: k, description: v.description }))"
              label="Preset"
              outlined dense
              emit-value
              map-options
              clearable
              class="q-mb-md"
              @update:model-value="(val: string | null) => val && applyPreset(val)"
            >
              <template v-slot:option="scope">
                <q-item v-bind="scope.itemProps">
                  <q-item-section>
                    <q-item-label>{{ scope.opt.label }}</q-item-label>
                    <q-item-label caption>{{ scope.opt.description }}</q-item-label>
                  </q-item-section>
                </q-item>
              </template>
            </q-select>

            <!-- Dimension weight sliders -->
            <div v-for="dim in WEIGHT_DIMENSIONS" :key="dim.key" class="q-mb-sm">
              <div class="row items-center no-wrap">
                <div class="text-caption col" style="min-width: 0">
                  {{ dim.label }}
                  <q-tooltip>{{ dim.description }}</q-tooltip>
                </div>
                <q-badge :color="dim.color" class="q-ml-sm" style="min-width: 36px; text-align: center">
                  {{ formatPct(weights[dim.key]) }}
                </q-badge>
              </div>
              <q-slider
                v-model="weights[dim.key]"
                :min="0"
                :max="0.50"
                :step="0.01"
                :color="dim.color"
                dense
              />
            </div>

            <q-separator class="q-my-sm" />

            <!-- Depth Decay -->
            <div class="q-mb-sm">
              <div class="row items-center no-wrap">
                <div class="text-caption col">Depth Decay Rate</div>
                <q-badge color="orange" class="q-ml-sm" style="min-width: 36px; text-align: center">
                  {{ formatPct(weights.depthDecayRate) }}
                </q-badge>
              </div>
              <q-slider
                v-model="weights.depthDecayRate"
                :min="0"
                :max="0.50"
                :step="0.01"
                color="orange"
                dense
              />
            </div>

            <!-- Total weight indicator -->
            <div class="row items-center q-mt-sm">
              <div class="text-caption text-grey-7">Total dimension weight:</div>
              <q-badge
                :color="Math.abs(totalWeight - 1.0) < 0.02 ? 'positive' : 'warning'"
                class="q-ml-sm"
              >
                {{ (totalWeight * 100).toFixed(0) }}%
              </q-badge>
            </div>
          </q-card-section>
        </q-card>

        <!-- Card 3: Thresholds -->
        <q-card v-if="hasExploration" class="q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">
              <q-icon name="speed" class="q-mr-sm" />
              Thresholds
            </div>

            <div class="q-mb-md">
              <div class="row items-center no-wrap q-mb-xs">
                <div class="text-caption col">Membership Threshold</div>
                <q-badge color="positive">{{ membershipThreshold }}</q-badge>
              </div>
              <q-slider
                v-model="membershipThreshold"
                :min="0"
                :max="100"
                :step="1"
                color="positive"
                dense
              />
            </div>

            <div class="q-mb-sm">
              <div class="row items-center no-wrap q-mb-xs">
                <div class="text-caption col">Expansion Threshold</div>
                <q-badge color="amber" text-color="dark">{{ expansionThreshold }}</q-badge>
              </div>
              <q-slider
                v-model="expansionThreshold"
                :min="0"
                :max="100"
                :step="1"
                color="amber"
                dense
              />
            </div>

            <!-- Zone counts -->
            <div class="row q-gutter-sm q-mt-sm">
              <q-badge color="positive" outline>{{ zoneCounts.members }} members</q-badge>
              <q-badge color="amber" text-color="dark" outline>{{ zoneCounts.candidates }} candidates</q-badge>
              <q-badge color="negative" outline>{{ zoneCounts.excluded }} excluded</q-badge>
            </div>
          </q-card-section>
        </q-card>

        <!-- Card 4: Expansion Controls -->
        <q-card v-if="hasExploration" class="q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">
              <q-icon name="account_tree" class="q-mr-sm" />
              Expansion Controls
            </div>

            <div class="text-caption text-grey-7 q-mb-sm">
              Current Generation: {{ explorationState?.currentGeneration || 0 }}
            </div>

            <!-- Direction expansion -->
            <div class="text-caption text-grey-7 q-mb-xs">Expand Citations</div>
            <div class="row q-gutter-sm q-mb-md">
              <q-btn
                dense no-caps
                color="primary" outline
                icon="arrow_forward"
                label="Forward"
                :loading="expanding"
                @click="expand('forward')"
              />
              <q-btn
                dense no-caps
                color="primary" outline
                icon="arrow_back"
                label="Backward"
                :loading="expanding"
                @click="expand('backward')"
              />
              <q-btn
                dense no-caps
                color="primary" outline
                icon="swap_horiz"
                label="Both"
                :loading="expanding"
                @click="expand('both')"
              />
            </div>

            <!-- Sibling expansion -->
            <div class="text-caption text-grey-7 q-mb-xs">Find Siblings</div>
            <div class="row q-gutter-sm q-mb-md">
              <q-btn
                dense no-caps
                color="deep-purple" outline
                icon="arrow_forward"
                label="Fwd Siblings"
                :loading="expanding"
                @click="expandSiblingsAction('forward')"
              />
              <q-btn
                dense no-caps
                color="deep-purple" outline
                icon="arrow_back"
                label="Bwd Siblings"
                :loading="expanding"
                @click="expandSiblingsAction('backward')"
              />
              <q-btn
                dense no-caps
                color="deep-purple" outline
                icon="swap_horiz"
                label="All Siblings"
                :loading="expanding"
                @click="expandSiblingsAction('both')"
              />
            </div>

            <!-- Expansion History -->
            <q-expansion-item
              v-if="explorationState?.expansionHistory?.length"
              dense
              label="Expansion History"
              icon="history"
              header-class="text-caption"
            >
              <q-list dense separator>
                <q-item v-for="step in explorationState.expansionHistory" :key="step.stepNumber">
                  <q-item-section>
                    <q-item-label class="text-caption">
                      Step {{ step.stepNumber }}: {{ step.direction }}
                      (gen {{ step.generationDepth }})
                    </q-item-label>
                    <q-item-label caption>
                      {{ step.candidatesEvaluated }} evaluated,
                      {{ step.autoIncluded }} auto-included,
                      {{ step.expansionZone }} expansion zone,
                      {{ step.autoRejected }} rejected
                    </q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-expansion-item>
          </q-card-section>
        </q-card>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════ -->
      <!-- RIGHT PANEL (col-8) -->
      <!-- ═══════════════════════════════════════════════════════════════════ -->
      <div class="col-12 col-md-8">
        <q-card v-if="hasExploration">
          <q-card-section>
            <!-- Zone Tab Selector -->
            <div class="row items-center q-mb-md">
              <q-btn-toggle
                v-model="activeZone"
                toggle-color="primary"
                no-caps
                dense
                :options="[
                  { label: `All (${zoneCounts.all})`, value: 'all' },
                  { label: `Members (${zoneCounts.members})`, value: 'members' },
                  { label: `Candidates (${zoneCounts.candidates})`, value: 'candidates' },
                  { label: `Excluded (${zoneCounts.excluded})`, value: 'excluded' },
                ]"
              />
            </div>

            <!-- Search filter -->
            <q-input
              v-model="searchFilter"
              dense outlined
              placeholder="Search by patent ID, title, assignee, or sector..."
              class="q-mb-md"
            >
              <template v-slot:append>
                <q-icon name="search" />
              </template>
              <template v-slot:after v-if="searchFilter">
                <q-btn flat dense icon="clear" @click="searchFilter = ''" />
              </template>
            </q-input>

            <!-- Bulk actions bar -->
            <div class="row items-center q-gutter-sm q-mb-md">
              <q-btn
                dense no-caps flat
                icon="check_circle"
                label="Accept Above Threshold"
                color="positive"
                :disable="zoneCounts.candidates === 0"
                @click="acceptAllAboveThreshold"
              />
              <q-btn
                dense no-caps flat
                icon="cancel"
                label="Reject Below Expansion"
                color="negative"
                :disable="zoneCounts.candidates === 0"
                @click="rejectAllBelowThreshold"
              />
              <q-space />
              <q-btn
                dense no-caps flat
                icon="save"
                label="Save"
                @click="showSaveDialog = true; saveName = explorationState?.name || ''"
              />
              <q-btn
                dense no-caps
                icon="folder_special"
                label="Create Focus Area"
                color="primary"
                :disable="zoneCounts.members === 0"
                @click="showFocusAreaDialog = true; focusAreaName = ''; focusAreaDescription = ''"
              />
            </div>

            <!-- Results table -->
            <q-table
              :rows="displayedCandidates"
              :columns="tableColumns"
              row-key="patentId"
              v-model:pagination="pagination"
              flat bordered dense
              :loading="expanding"
            >
              <!-- Status column: clickable icon -->
              <template v-slot:body-cell-status="props">
                <q-td :props="props" class="cursor-pointer" @click.stop="toggleStatus(props.row)">
                  <q-icon
                    :name="zoneIcon(props.row.zone)"
                    :color="zoneColor(props.row.zone)"
                    size="20px"
                  >
                    <q-tooltip>
                      Click to toggle ({{ props.row.zone }})
                    </q-tooltip>
                  </q-icon>
                </q-td>
              </template>

              <!-- Score column: colored badge with tooltip -->
              <template v-slot:body-cell-score="props">
                <q-td :props="props">
                  <q-badge :color="scoreColor(props.row.score.compositeScore)">
                    {{ props.row.score.compositeScore.toFixed(1) }}
                  </q-badge>
                  <!-- Score tooltip: dimension breakdown -->
                  <q-tooltip anchor="center right" self="center left" :offset="[10, 0]" max-width="350px">
                    <div class="text-subtitle2 q-mb-xs">Score Breakdown</div>
                    <div class="text-caption q-mb-sm">
                      Composite: {{ props.row.score.compositeScore.toFixed(1) }}
                      (raw: {{ props.row.score.rawWeightedScore.toFixed(1) }},
                      depth: x{{ props.row.score.depthMultiplier.toFixed(2) }})
                    </div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 11px">
                      <tr v-for="dim in WEIGHT_DIMENSIONS" :key="dim.key"
                          style="border-bottom: 1px solid rgba(255,255,255,0.15)">
                        <td style="padding: 2px 4px">{{ dim.label }}</td>
                        <td style="padding: 2px 4px; text-align: right">
                          {{ ((props.row.score.dimensions as Record<string, number>)[dim.key] * 100).toFixed(0) }}%
                        </td>
                      </tr>
                    </table>
                    <div class="text-caption q-mt-xs text-grey-4">
                      Data completeness: {{ (props.row.score.dataCompleteness * 100).toFixed(0) }}%
                    </div>
                  </q-tooltip>
                </q-td>
              </template>

              <!-- Patent ID: link to detail -->
              <template v-slot:body-cell-patentId="props">
                <q-td :props="props">
                  <router-link
                    :to="{ name: 'patent-detail', params: { id: props.row.patentId } }"
                    class="text-primary"
                    @click.stop
                  >
                    {{ props.row.patentId }}
                  </router-link>
                </q-td>
              </template>

              <!-- Title: truncated with tooltip -->
              <template v-slot:body-cell-title="props">
                <q-td :props="props">
                  <div class="ellipsis" style="max-width: 250px">
                    {{ props.row.title || '--' }}
                    <q-tooltip v-if="props.row.title && props.row.title.length > 35">
                      {{ props.row.title }}
                    </q-tooltip>
                  </div>
                </q-td>
              </template>

              <!-- Assignee: truncated -->
              <template v-slot:body-cell-assignee="props">
                <q-td :props="props">
                  <div class="ellipsis" style="max-width: 150px">
                    {{ props.row.assignee || '--' }}
                    <q-tooltip v-if="props.row.assignee && props.row.assignee.length > 20">
                      {{ props.row.assignee }}
                    </q-tooltip>
                  </div>
                </q-td>
              </template>

              <!-- Sector: truncated -->
              <template v-slot:body-cell-sector="props">
                <q-td :props="props">
                  <div class="ellipsis" style="max-width: 120px">
                    {{ props.row.sector || '--' }}
                  </div>
                </q-td>
              </template>

              <!-- Portfolio icon -->
              <template v-slot:body-cell-inPortfolio="props">
                <q-td :props="props">
                  <q-icon
                    :name="props.row.inPortfolio ? 'check_circle' : 'public'"
                    :color="props.row.inPortfolio ? 'positive' : 'grey'"
                    size="18px"
                  />
                </q-td>
              </template>
            </q-table>
          </q-card-section>
        </q-card>

        <!-- Empty state -->
        <q-card v-else>
          <q-card-section class="text-center q-pa-xl">
            <q-icon name="account_tree" size="64px" color="grey-4" />
            <div class="text-h6 text-grey-6 q-mt-md">No exploration active</div>
            <div class="text-body2 text-grey-5">
              Enter seed patents and click "Create Exploration" to begin iterative family discovery
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- ═════════════════════════════════════════════════════════════════════ -->
    <!-- Save Dialog -->
    <!-- ═════════════════════════════════════════════════════════════════════ -->
    <q-dialog v-model="showSaveDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Save Exploration</div>
        </q-card-section>
        <q-card-section>
          <q-input
            v-model="saveName"
            label="Name *"
            outlined autofocus
            :rules="[val => !!val?.trim() || 'Name is required']"
            class="q-mb-md"
          />
          <q-input
            v-model="saveDescription"
            label="Description (optional)"
            outlined
            type="textarea"
            rows="2"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Save"
            :loading="saving"
            :disable="!saveName.trim()"
            @click="saveExploration"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- ═════════════════════════════════════════════════════════════════════ -->
    <!-- Focus Area Dialog -->
    <!-- ═════════════════════════════════════════════════════════════════════ -->
    <q-dialog v-model="showFocusAreaDialog" persistent>
      <q-card style="min-width: 450px">
        <q-card-section class="row items-center">
          <q-avatar icon="folder_special" color="primary" text-color="white" />
          <span class="q-ml-sm text-h6">Create Focus Area</span>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>
        <q-card-section>
          <div class="text-body2 text-grey-7 q-mb-md">
            Creating a focus area from {{ zoneCounts.members }} accepted members.
          </div>
          <q-input
            v-model="focusAreaName"
            label="Focus Area Name *"
            outlined autofocus
            :rules="[val => !!val?.trim() || 'Name is required']"
            class="q-mb-md"
          />
          <q-input
            v-model="focusAreaDescription"
            label="Description (optional)"
            outlined
            type="textarea"
            rows="2"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            icon="add"
            label="Create Focus Area"
            :loading="creatingFocusArea"
            :disable="!focusAreaName.trim()"
            @click="createFocusArea"
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
