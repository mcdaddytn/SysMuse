<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import PortfolioSelector from '@/components/PortfolioSelector.vue';
import { usePortfolioStore } from '@/stores/portfolio';
import {
  formulaApi,
  type FormulaDefinition,
  type WeightProfile,
  type GroupTerm,
  type MetricTerm,
  type EvaluatedPatent,
  type ConsensusPatent,
} from '@/services/formula-api';

const router = useRouter();
const $q = useQuasar();
const portfolioStore = usePortfolioStore();

// =============================================================================
// State
// =============================================================================

// Formula selection
const formulas = ref<FormulaDefinition[]>([]);
const selectedFormulaId = ref<string | null>(null);
const selectedFormula = ref<FormulaDefinition | null>(null);

// Weight profiles
const profiles = ref<WeightProfile[]>([]);
const selectedProfileId = ref<string | null>(null);
const currentWeights = ref<Record<string, number>>({});

// Mode
const mode = ref<'single' | 'consensus'>('single');

// Consensus voters
const voters = ref<Array<{ profileId: string; consensusWeight: number }>>([]);

// Results
const patents = ref<EvaluatedPatent[]>([]);
const consensusPatents = ref<ConsensusPatent[]>([]);
const previousRankings = ref<Array<{ patent_id: string; rank: number }>>([]);
const total = ref(0);

// UI state
const loading = ref(false);
const error = ref<string | null>(null);
const topN = ref(100);
const llmEnhancedOnly = ref(false);
const hasUnsavedChanges = ref(false);

// Top N options
const topNOptions = [
  { label: '60', value: 60 },
  { label: '100', value: 100 },
  { label: '250', value: 250 },
  { label: '500', value: 500 },
  { label: '1000', value: 1000 },
  { label: 'All', value: 0 },
];

// =============================================================================
// Computed
// =============================================================================

/** Extract group terms from the formula structure for rendering sliders */
const formulaGroups = computed(() => {
  if (!selectedFormula.value) return [];
  const terms = selectedFormula.value.structure.terms;
  return terms
    .filter((t): t is GroupTerm => t.type === 'group')
    .map(g => ({
      name: g.name,
      weightKey: g.weightKey,
      displayName: formatGroupName(g.name),
      metrics: g.terms
        .filter((t): t is MetricTerm => t.type === 'metric')
        .map(m => ({
          attribute: m.attribute,
          weightKey: m.weightKey,
          displayName: m.displayName || formatMetricName(m.attribute),
          sparseGroup: m.sparseGroup,
        })),
    }));
});

/** Flat (ungrouped) metric terms at top level */
const flatMetrics = computed(() => {
  if (!selectedFormula.value) return [];
  return selectedFormula.value.structure.terms
    .filter((t): t is MetricTerm => t.type === 'metric')
    .map(m => ({
      attribute: m.attribute,
      weightKey: m.weightKey,
      displayName: m.displayName || formatMetricName(m.attribute),
    }));
});

/** Total group weight for display */
const totalGroupWeight = computed(() => {
  return formulaGroups.value.reduce((sum, g) => sum + (currentWeights.value[g.weightKey] ?? 0), 0);
});

/** Results columns for the table */
const columns = computed(() => {
  const cols: any[] = [
    { name: 'rank', label: '#', field: 'rank', sortable: true, align: 'center', style: 'width: 50px' },
    { name: 'rank_change', label: 'Δ', field: 'rank_change', sortable: true, align: 'center', style: 'width: 50px' },
    { name: 'patent_id', label: 'Patent ID', field: 'patent_id', sortable: true },
    { name: 'title', label: 'Title', field: 'title', sortable: false, style: 'max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' },
    { name: 'assignee', label: 'Assignee', field: 'assignee', sortable: true },
    { name: 'score', label: 'Score', field: 'score', sortable: true, align: 'right' },
  ];

  // Add group score columns
  if (mode.value === 'single') {
    for (const g of formulaGroups.value) {
      cols.push({
        name: `gs_${g.name}`,
        label: g.displayName,
        field: (row: EvaluatedPatent) => row.group_scores?.[g.name]?.score ?? '-',
        sortable: true,
        align: 'right',
      });
    }
  } else {
    // Consensus: show role scores
    for (const v of voters.value) {
      const profile = profiles.value.find(p => p.id === v.profileId);
      cols.push({
        name: `role_${v.profileId}`,
        label: profile?.name ?? 'Unknown',
        field: (row: ConsensusPatent) => row.role_scores?.[profile?.name ?? ''] ?? '-',
        sortable: true,
        align: 'right',
      });
    }
  }

  cols.push(
    { name: 'superSector', label: 'Super-Sector', field: 'superSector', sortable: true },
    { name: 'yearsRemaining', label: 'Years', field: 'yearsRemaining', sortable: true, align: 'right' },
    { name: 'hasLlmData', label: 'LLM', field: 'hasLlmData', sortable: true, align: 'center' },
  );

  return cols;
});

const tableData = computed(() => {
  return mode.value === 'consensus' ? consensusPatents.value : patents.value;
});

// =============================================================================
// Methods
// =============================================================================

function formatGroupName(name: string): string {
  return name
    .replace(/^(g_|ss_|sec_|sub_)/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatMetricName(attr: string): string {
  return attr
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function scoreColor(score: number): string {
  if (score >= 60) return 'positive';
  if (score >= 45) return 'primary';
  if (score >= 30) return 'warning';
  return 'grey';
}

async function loadFormulas() {
  try {
    formulas.value = await formulaApi.listFormulas({ active: true });
  } catch (e: any) {
    error.value = `Failed to load formulas: ${e.message}`;
  }
}

async function onFormulaSelected(formulaId: string) {
  selectedFormulaId.value = formulaId;
  loading.value = true;
  error.value = null;

  try {
    selectedFormula.value = await formulaApi.getFormula(formulaId);
    profiles.value = await formulaApi.getProfiles(formulaId);

    // Load default profile weights
    const defaultProfile = profiles.value.find(p => p.isDefault) || profiles.value[0];
    if (defaultProfile) {
      selectedProfileId.value = defaultProfile.id;
      currentWeights.value = { ...defaultProfile.weights };
    }
  } catch (e: any) {
    error.value = `Failed to load formula: ${e.message}`;
  } finally {
    loading.value = false;
  }
}

async function onProfileSelected(profileId: string) {
  selectedProfileId.value = profileId;
  const profile = profiles.value.find(p => p.id === profileId);
  if (profile) {
    currentWeights.value = { ...profile.weights };
    hasUnsavedChanges.value = false;
  }
}

function onWeightChanged() {
  hasUnsavedChanges.value = true;
}

async function recalculate() {
  if (!selectedFormulaId.value || !portfolioStore.selectedPortfolioId) return;

  loading.value = true;
  error.value = null;

  try {
    if (mode.value === 'single') {
      const result = await formulaApi.evaluatePortfolio(selectedFormulaId.value, {
        portfolioId: portfolioStore.selectedPortfolioId,
        weights: currentWeights.value,
        topN: topN.value,
        llmEnhancedOnly: llmEnhancedOnly.value,
        previousRankings: previousRankings.value.length > 0 ? previousRankings.value : undefined,
      });

      // Store current rankings for next comparison
      previousRankings.value = result.data.map(p => ({ patent_id: p.patent_id, rank: p.rank }));
      patents.value = result.data;
      total.value = result.total;
    } else {
      // Consensus mode
      if (voters.value.length === 0) {
        error.value = 'Add at least one voter for consensus scoring';
        return;
      }

      const result = await formulaApi.consensus(selectedFormulaId.value, {
        portfolioId: portfolioStore.selectedPortfolioId,
        profiles: voters.value,
        topN: topN.value,
        llmEnhancedOnly: llmEnhancedOnly.value,
      });

      consensusPatents.value = result.data;
      total.value = result.total;
    }
  } catch (e: any) {
    error.value = `Scoring failed: ${e.message}`;
  } finally {
    loading.value = false;
  }
}

async function saveProfile() {
  if (!selectedFormulaId.value) return;

  $q.dialog({
    title: 'Save Weight Profile',
    message: 'Enter a name for this weight profile:',
    prompt: { model: '', type: 'text' },
    cancel: true,
  }).onOk(async (name: string) => {
    try {
      const saved = await formulaApi.saveProfile(selectedFormulaId.value!, {
        name,
        weights: currentWeights.value,
      });
      profiles.value.push(saved);
      selectedProfileId.value = saved.id;
      hasUnsavedChanges.value = false;
      $q.notify({ type: 'positive', message: `Profile "${name}" saved` });
    } catch (e: any) {
      $q.notify({ type: 'negative', message: `Failed to save: ${e.message}` });
    }
  });
}

function addVoter() {
  const defaultProfile = profiles.value.find(p => p.isDefault) || profiles.value[0];
  if (defaultProfile) {
    voters.value.push({ profileId: defaultProfile.id, consensusWeight: 1 });
  }
}

function removeVoter(index: number) {
  voters.value.splice(index, 1);
}

function resetRankChanges() {
  previousRankings.value = [];
  for (const p of patents.value) {
    p.rank_change = undefined;
  }
}

function navigateToPatent(patentId: string) {
  router.push({ name: 'patent-detail', params: { patentId } });
}

// =============================================================================
// Lifecycle
// =============================================================================

onMounted(async () => {
  await loadFormulas();
});

// Watch portfolio changes
watch(() => portfolioStore.selectedPortfolioId, () => {
  patents.value = [];
  consensusPatents.value = [];
  previousRankings.value = [];
});
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md q-gutter-md">
      <div class="text-h5">Scoring</div>
      <q-space />

      <!-- Formula Selector -->
      <q-select
        v-model="selectedFormulaId"
        :options="formulas.map(f => ({ label: f.displayName, value: f.id, description: f.description }))"
        option-label="label"
        option-value="value"
        emit-value
        map-options
        label="Formula"
        dense
        outlined
        style="min-width: 250px"
        @update:model-value="onFormulaSelected"
      >
        <template #option="{ itemProps, opt }">
          <q-item v-bind="itemProps">
            <q-item-section>
              <q-item-label>{{ opt.label }}</q-item-label>
              <q-item-label caption>{{ opt.description }}</q-item-label>
            </q-item-section>
          </q-item>
        </template>
      </q-select>

      <!-- Portfolio Selector -->
      <PortfolioSelector />

      <!-- Mode Toggle -->
      <q-btn-toggle
        v-model="mode"
        :options="[
          { label: 'Single', value: 'single' },
          { label: 'Consensus', value: 'consensus' },
        ]"
        dense
        no-caps
        toggle-color="primary"
      />
    </div>

    <q-separator class="q-mb-md" />

    <!-- Error Banner -->
    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
      {{ error }}
      <template #action>
        <q-btn flat label="Dismiss" @click="error = null" />
      </template>
    </q-banner>

    <div class="row q-gutter-md" v-if="selectedFormula">
      <!-- Left Panel: Weight Controls -->
      <div class="col-12 col-md-4 col-lg-3">
        <!-- Profile Selector -->
        <q-card flat bordered class="q-mb-md">
          <q-card-section class="q-pb-none">
            <div class="text-subtitle2">Weight Profile</div>
          </q-card-section>
          <q-card-section>
            <q-select
              v-model="selectedProfileId"
              :options="profiles.map(p => ({ label: p.name + (p.isDefault ? ' (default)' : ''), value: p.id }))"
              option-label="label"
              option-value="value"
              emit-value
              map-options
              dense
              outlined
              @update:model-value="onProfileSelected"
            />
            <div class="row q-mt-sm q-gutter-xs">
              <q-btn size="sm" flat color="primary" label="Save As..." @click="saveProfile" :disable="!hasUnsavedChanges" />
              <q-btn size="sm" flat label="Reset" @click="onProfileSelected(selectedProfileId!)" :disable="!hasUnsavedChanges" />
            </div>
          </q-card-section>
        </q-card>

        <!-- Single Mode: Group Weight Sliders -->
        <template v-if="mode === 'single'">
          <!-- Group Level Weights Summary -->
          <q-card flat bordered class="q-mb-md" v-if="formulaGroups.length > 1">
            <q-card-section class="q-pb-none">
              <div class="text-subtitle2">Group Weights
                <q-badge :color="Math.abs(totalGroupWeight - 1) < 0.05 ? 'positive' : 'warning'" class="q-ml-sm">
                  {{ Math.round(totalGroupWeight * 100) }}%
                </q-badge>
              </div>
            </q-card-section>
            <q-card-section>
              <div v-for="group in formulaGroups" :key="group.weightKey" class="q-mb-sm">
                <div class="row items-center">
                  <div class="col text-body2">{{ group.displayName }}</div>
                  <div class="col-auto">
                    <q-badge outline>{{ Math.round((currentWeights[group.weightKey] ?? 0) * 100) }}%</q-badge>
                  </div>
                </div>
                <q-slider
                  v-model="currentWeights[group.weightKey]"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  dense
                  color="primary"
                  @update:model-value="onWeightChanged"
                />
              </div>
            </q-card-section>
          </q-card>

          <!-- Per-Group Metric Sliders (Expandable) -->
          <q-expansion-item
            v-for="group in formulaGroups"
            :key="group.name"
            :label="group.displayName"
            :caption="`${group.metrics.length} metrics`"
            header-class="text-weight-medium"
            class="q-mb-sm"
            bordered
            dense
          >
            <q-card>
              <q-card-section>
                <div v-for="metric in group.metrics" :key="metric.attribute" class="q-mb-sm">
                  <div class="row items-center">
                    <div class="col text-caption">{{ metric.displayName }}</div>
                    <div class="col-auto">
                      <q-badge outline size="sm">
                        {{ typeof currentWeights[metric.weightKey] === 'number'
                          ? currentWeights[metric.weightKey] <= 1
                            ? Math.round(currentWeights[metric.weightKey] * 100) + '%'
                            : currentWeights[metric.weightKey]
                          : '0' }}
                      </q-badge>
                    </div>
                  </div>
                  <q-slider
                    v-model="currentWeights[metric.weightKey]"
                    :min="0"
                    :max="currentWeights[metric.weightKey] > 1 ? 50 : 0.5"
                    :step="currentWeights[metric.weightKey] > 1 ? 1 : 0.01"
                    dense
                    color="accent"
                    @update:model-value="onWeightChanged"
                  />
                </div>
              </q-card-section>
            </q-card>
          </q-expansion-item>

          <!-- Flat (ungrouped) metrics if any -->
          <q-expansion-item
            v-if="flatMetrics.length > 0"
            label="General Metrics"
            :caption="`${flatMetrics.length} metrics`"
            header-class="text-weight-medium"
            class="q-mb-sm"
            bordered
            dense
          >
            <q-card>
              <q-card-section>
                <div v-for="metric in flatMetrics" :key="metric.attribute" class="q-mb-sm">
                  <div class="row items-center">
                    <div class="col text-caption">{{ metric.displayName }}</div>
                    <div class="col-auto">
                      <q-badge outline size="sm">{{ currentWeights[metric.weightKey] ?? 0 }}</q-badge>
                    </div>
                  </div>
                  <q-slider
                    v-model="currentWeights[metric.weightKey]"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    dense
                    @update:model-value="onWeightChanged"
                  />
                </div>
              </q-card-section>
            </q-card>
          </q-expansion-item>
        </template>

        <!-- Consensus Mode: Voter Configuration -->
        <template v-if="mode === 'consensus'">
          <q-card flat bordered class="q-mb-md">
            <q-card-section class="q-pb-none">
              <div class="text-subtitle2">Voters</div>
            </q-card-section>
            <q-card-section>
              <div v-for="(voter, idx) in voters" :key="idx" class="row items-center q-mb-sm q-gutter-sm">
                <q-select
                  v-model="voter.profileId"
                  :options="profiles.map(p => ({ label: p.name, value: p.id }))"
                  option-label="label"
                  option-value="value"
                  emit-value
                  map-options
                  dense
                  outlined
                  class="col"
                />
                <q-input
                  v-model.number="voter.consensusWeight"
                  type="number"
                  dense
                  outlined
                  style="width: 70px"
                  :min="0"
                  :max="100"
                />
                <q-btn flat round dense icon="close" size="sm" @click="removeVoter(idx)" />
              </div>
              <q-btn flat dense color="primary" icon="add" label="Add Voter" @click="addVoter" />
            </q-card-section>
          </q-card>
        </template>

        <!-- Controls -->
        <q-card flat bordered>
          <q-card-section>
            <div class="row q-gutter-sm items-center q-mb-sm">
              <q-select
                v-model="topN"
                :options="topNOptions"
                option-label="label"
                option-value="value"
                emit-value
                map-options
                dense
                outlined
                label="Top N"
                style="min-width: 100px"
              />
              <q-toggle v-model="llmEnhancedOnly" label="LLM only" dense />
            </div>
            <q-btn
              color="primary"
              label="Recalculate"
              :loading="loading"
              @click="recalculate"
              class="full-width q-mb-sm"
              :disable="!portfolioStore.selectedPortfolioId"
            />
            <q-btn
              flat
              dense
              label="Reset Rank Changes"
              @click="resetRankChanges"
              class="full-width"
              :disable="previousRankings.length === 0"
            />
          </q-card-section>
        </q-card>
      </div>

      <!-- Right Panel: Results Table -->
      <div class="col">
        <q-card flat bordered>
          <q-card-section class="q-pb-none">
            <div class="row items-center">
              <div class="text-subtitle1">
                Results
                <q-badge v-if="total > 0" color="primary" class="q-ml-sm">
                  {{ tableData.length }} of {{ total }}
                </q-badge>
              </div>
            </div>
          </q-card-section>
          <q-card-section>
            <q-table
              :rows="tableData"
              :columns="columns"
              row-key="patent_id"
              :rows-per-page-options="[25, 50, 100, 0]"
              :loading="loading"
              dense
              flat
              :pagination="{ rowsPerPage: 50 }"
            >
              <!-- Rank change column -->
              <template #body-cell-rank_change="props">
                <q-td :props="props">
                  <template v-if="props.value != null">
                    <span v-if="props.value > 0" class="text-positive">+{{ props.value }}</span>
                    <span v-else-if="props.value < 0" class="text-negative">{{ props.value }}</span>
                    <span v-else class="text-grey">-</span>
                  </template>
                </q-td>
              </template>

              <!-- Score column with color badge -->
              <template #body-cell-score="props">
                <q-td :props="props">
                  <q-badge :color="scoreColor(props.value)" :label="props.value?.toFixed(1)" />
                </q-td>
              </template>

              <!-- Consensus score -->
              <template #body-cell-consensus_score="props">
                <q-td :props="props">
                  <q-badge :color="scoreColor(props.value)" :label="props.value?.toFixed(1)" />
                </q-td>
              </template>

              <!-- Patent ID clickable -->
              <template #body-cell-patent_id="props">
                <q-td :props="props">
                  <a href="#" @click.prevent="navigateToPatent(props.value)" class="text-primary">
                    {{ props.value }}
                  </a>
                </q-td>
              </template>

              <!-- LLM data indicator -->
              <template #body-cell-hasLlmData="props">
                <q-td :props="props">
                  <q-icon v-if="props.value" name="check_circle" color="positive" size="sm" />
                  <q-icon v-else name="radio_button_unchecked" color="grey" size="sm" />
                </q-td>
              </template>

              <!-- Group score columns -->
              <template v-for="group in formulaGroups" #[`body-cell-gs_${group.name}`]="props" :key="group.name">
                <q-td :props="props">
                  <span v-if="typeof props.value === 'number'" class="text-caption">
                    {{ (props.value * 100).toFixed(0) }}
                  </span>
                  <span v-else class="text-grey">-</span>
                </q-td>
              </template>
            </q-table>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!selectedFormula && !loading" class="text-center q-mt-xl text-grey-6">
      <q-icon name="functions" size="64px" />
      <div class="text-h6 q-mt-md">Select a formula to begin scoring</div>
      <div class="text-body2">Choose a formula from the dropdown above, then configure weights and calculate scores.</div>
    </div>
  </q-page>
</template>
