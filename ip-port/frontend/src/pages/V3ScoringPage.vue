<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { scoringApi } from '@/services/api';
import type { ScoringProfile, V3ScoredPatent, LlmCoverage } from '@/types';

const router = useRouter();

// State
const profiles = ref<ScoringProfile[]>([]);
const selectedProfileId = ref('executive');
const patents = ref<V3ScoredPatent[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const total = ref(0);
const llmCoverage = ref<LlmCoverage | null>(null);
const expandedRow = ref<string | null>(null);
const sectorFilter = ref<string | null>(null);
const minScoreFilter = ref<number | null>(1); // Default to score >= 1 to exclude zero-score patents
const sectors = ref<{ label: string; value: string }[]>([]);

// Pagination
const pagination = ref({
  page: 1,
  rowsPerPage: 100,
  rowsNumber: 0,
  sortBy: 'rank',
  descending: false,
});

// Current profile
const currentProfile = computed(() => {
  return profiles.value.find(p => p.id === selectedProfileId.value);
});

// Weight metric labels
const METRIC_LABELS: Record<string, string> = {
  competitor_citations: 'Competitor Citations',
  forward_citations: 'Forward Citations (Raw)',
  adjusted_forward_citations: 'Forward Citations (Adjusted)',
  years_remaining: 'Years Remaining',
  competitor_count: 'Competitor Count',
  competitor_density: 'Competitor Density',
  eligibility_score: 'Eligibility (LLM)',
  validity_score: 'Validity (LLM)',
  claim_breadth: 'Claim Breadth (LLM)',
  enforcement_clarity: 'Enforcement Clarity (LLM)',
  design_around_difficulty: 'Design-Around Difficulty (LLM)',
  market_relevance_score: 'Market Relevance (LLM)',
  ipr_risk_score: 'IPR Risk (API)',
  prosecution_quality_score: 'Prosecution Quality (API)',
};

const METRIC_COLORS: Record<string, string> = {
  competitor_citations: '#e53935',
  forward_citations: '#1e88e5',
  adjusted_forward_citations: '#1565c0',
  years_remaining: '#43a047',
  competitor_count: '#f4511e',
  competitor_density: '#d84315',
  eligibility_score: '#8e24aa',
  validity_score: '#5e35b1',
  claim_breadth: '#3949ab',
  enforcement_clarity: '#7b1fa2',
  design_around_difficulty: '#6a1b9a',
  market_relevance_score: '#00838f',
  ipr_risk_score: '#bf360c',
  prosecution_quality_score: '#4e342e',
};

// Sorted weights for the current profile
const sortedWeights = computed(() => {
  if (!currentProfile.value) return [];
  return Object.entries(currentProfile.value.weights)
    .filter(([_, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, weight]) => ({
      key,
      label: METRIC_LABELS[key] || key,
      weight,
      pct: Math.round(weight * 100),
      color: METRIC_COLORS[key] || '#757575',
      isLlm: ['eligibility_score', 'validity_score', 'claim_breadth', 'enforcement_clarity', 'design_around_difficulty'].includes(key),
    }));
});

// Table columns
const columns = [
  { name: 'rank', label: '#', field: 'rank', align: 'center' as const, sortable: true, style: 'width: 50px' },
  { name: 'patent_id', label: 'Patent ID', field: 'patent_id', align: 'left' as const, sortable: false },
  { name: 'patent_title', label: 'Title', field: 'patent_title', align: 'left' as const, sortable: false },
  { name: 'assignee', label: 'Assignee', field: 'assignee', align: 'left' as const, sortable: false },
  { name: 'primary_sector', label: 'Sector', field: 'primary_sector', align: 'left' as const, sortable: false },
  { name: 'score', label: 'Score', field: 'score', align: 'center' as const, sortable: true },
  { name: 'competitor_citations', label: 'Comp Cites', field: 'competitor_citations', align: 'center' as const, sortable: true },
  { name: 'forward_citations', label: 'Fwd Cites', field: 'forward_citations', align: 'center' as const, sortable: true },
  { name: 'remaining_years', label: 'Years Left', field: 'remaining_years', align: 'center' as const, sortable: true,
    format: (val: number) => val?.toFixed(1) },
  { name: 'llm', label: 'LLM', field: 'has_llm_scores', align: 'center' as const, sortable: false, style: 'width: 40px' },
  { name: 'expand', label: '', field: 'patent_id', align: 'center' as const, sortable: false, style: 'width: 40px' },
];

// Load profiles
async function loadProfiles() {
  try {
    profiles.value = await scoringApi.getProfiles();
    const defaultProfile = profiles.value.find(p => p.isDefault);
    if (defaultProfile) {
      selectedProfileId.value = defaultProfile.id;
    }
  } catch (err) {
    console.error('Failed to load profiles:', err);
  }
}

// Load scored patents
async function fetchScores() {
  loading.value = true;
  error.value = null;

  try {
    const response = await scoringApi.getV3Scores({
      profile: selectedProfileId.value,
      page: pagination.value.page,
      limit: pagination.value.rowsPerPage,
      sector: sectorFilter.value || undefined,
      minScore: minScoreFilter.value || undefined,
    });

    patents.value = response.data;
    total.value = response.total;
    pagination.value.rowsNumber = response.total;
    llmCoverage.value = response.llm_coverage;

    // Build sector list from first page results (use full set)
    if (sectors.value.length === 0 && !sectorFilter.value) {
      const sectorSet = new Set<string>();
      for (const p of response.data) {
        if (p.primary_sector && p.primary_sector !== 'general') {
          sectorSet.add(p.primary_sector);
        }
      }
      // We'll load sectors from the API too
      loadSectors();
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load v3 scores';
    console.error('Failed to fetch v3 scores:', err);
  } finally {
    loading.value = false;
  }
}

// Load sector options from the API
async function loadSectors() {
  try {
    const response = await fetch('/api/patents/primary-sectors');
    const data = await response.json();
    sectors.value = data.map((s: { sector: string; count: number }) => ({
      label: `${s.sector} (${s.count})`,
      value: s.sector,
    }));
  } catch (err) {
    console.error('Failed to load sectors:', err);
  }
}

// Handle pagination
function onRequest(props: { pagination: typeof pagination.value }) {
  pagination.value.page = props.pagination.page;
  pagination.value.rowsPerPage = props.pagination.rowsPerPage;
  fetchScores();
}

// Navigate to patent detail
function goToPatent(patentId: string) {
  router.push({ name: 'patent-detail', params: { id: patentId } });
}

// Toggle score breakdown
function toggleExpand(patentId: string) {
  expandedRow.value = expandedRow.value === patentId ? null : patentId;
}

// Score badge color
function scoreColor(score: number): string {
  if (score >= 60) return 'positive';
  if (score >= 40) return 'primary';
  if (score >= 25) return 'warning';
  return 'grey';
}

// Normalized metric bar width
function metricBarWidth(value: number): string {
  return `${Math.min(100, Math.round(value * 100))}%`;
}

// Metric contribution to total score
function metricContribution(patent: V3ScoredPatent, metricKey: string): number {
  const profile = currentProfile.value;
  if (!profile) return 0;
  const normValue = patent.normalized_metrics[metricKey] ?? 0;
  const weight = profile.weights[metricKey] ?? 0;
  return normValue * weight;
}

// Reload data
async function reloadAll() {
  try {
    await scoringApi.reloadScores();
    await fetchScores();
  } catch (err) {
    console.error('Failed to reload:', err);
  }
}

// CSV export
function exportCsv() {
  const headers = ['Rank', 'Patent ID', 'Title', 'Assignee', 'Sector', 'Score', 'Comp Cites', 'Fwd Cites', 'Years Left', 'Year Multiplier', 'Has LLM'];
  const rows = patents.value.map(p => [
    p.rank,
    p.patent_id,
    `"${(p.patent_title || '').replace(/"/g, '""')}"`,
    `"${(p.assignee || '').replace(/"/g, '""')}"`,
    p.primary_sector,
    p.score,
    p.competitor_citations,
    p.forward_citations,
    p.remaining_years?.toFixed(1),
    p.year_multiplier,
    p.has_llm_scores ? 'Yes' : 'No',
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `v3-scores-${selectedProfileId.value}-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Watch profile and filter changes
watch(selectedProfileId, () => {
  pagination.value.page = 1;
  fetchScores();
});

watch(sectorFilter, () => {
  pagination.value.page = 1;
  fetchScores();
});

watch(minScoreFilter, () => {
  pagination.value.page = 1;
  fetchScores();
});

onMounted(async () => {
  await loadProfiles();
  await fetchScores();
});
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="text-h5 q-mr-md">V3 Scoring</div>
      <q-badge color="primary" class="q-mr-sm">
        {{ total.toLocaleString() }} patents
      </q-badge>
      <q-badge v-if="llmCoverage" color="deep-purple" class="q-mr-sm">
        LLM: {{ llmCoverage.patents_with_llm }} / {{ llmCoverage.total_patents }}
        ({{ llmCoverage.coverage_pct }}%)
      </q-badge>
      <q-space />

      <!-- Actions -->
      <q-btn flat dense icon="refresh" @click="reloadAll" class="q-mr-sm">
        <q-tooltip>Reload scoring data</q-tooltip>
      </q-btn>
      <q-btn flat dense icon="download" @click="exportCsv" class="q-mr-sm">
        <q-tooltip>Export CSV</q-tooltip>
      </q-btn>
    </div>

    <div class="row q-gutter-lg">
      <!-- Left Panel: Profile & Weights -->
      <div class="col-3">
        <!-- Profile Selector -->
        <q-card class="q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 text-weight-medium q-mb-sm">Scoring Profile</div>
            <q-select
              v-model="selectedProfileId"
              :options="profiles"
              option-value="id"
              option-label="displayName"
              emit-value
              map-options
              outlined
              dense
            >
              <template v-slot:option="{ itemProps, opt }">
                <q-item v-bind="itemProps">
                  <q-item-section>
                    <q-item-label>{{ opt.displayName }}</q-item-label>
                    <q-item-label caption>{{ opt.description }}</q-item-label>
                  </q-item-section>
                  <q-item-section side v-if="opt.isDefault">
                    <q-badge color="grey-5" label="Default" />
                  </q-item-section>
                </q-item>
              </template>
            </q-select>

            <div v-if="currentProfile" class="text-caption text-grey-6 q-mt-sm">
              {{ currentProfile.description }}
            </div>
          </q-card-section>
        </q-card>

        <!-- Weight Visualization -->
        <q-card class="q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 text-weight-medium q-mb-md">Profile Weights</div>

            <div v-for="w in sortedWeights" :key="w.key" class="q-mb-sm">
              <div class="row items-center justify-between q-mb-xs">
                <span class="text-caption" :class="{ 'text-purple-6': w.isLlm }">
                  {{ w.label }}
                </span>
                <span class="text-caption text-weight-bold">{{ w.pct }}%</span>
              </div>
              <q-linear-progress
                :value="w.weight"
                :color="w.isLlm ? 'deep-purple' : 'primary'"
                size="8px"
                rounded
              />
            </div>

            <q-separator class="q-my-md" />
            <div class="text-caption text-grey-6">
              <q-icon name="circle" size="8px" color="primary" class="q-mr-xs" />
              Quantitative metrics (always available)
            </div>
            <div class="text-caption text-grey-6">
              <q-icon name="circle" size="8px" color="deep-purple" class="q-mr-xs" />
              LLM metrics ({{ llmCoverage?.patents_with_llm || 0 }} patents)
            </div>
            <div class="text-caption text-grey-6 q-mt-xs">
              When LLM metrics are missing, their weight is redistributed proportionally to available metrics.
            </div>
          </q-card-section>
        </q-card>

        <!-- Filters -->
        <q-card>
          <q-card-section>
            <div class="text-subtitle1 text-weight-medium q-mb-sm">Filters</div>

            <q-select
              v-model="sectorFilter"
              :options="sectors"
              option-value="value"
              option-label="label"
              emit-value
              map-options
              outlined
              dense
              clearable
              label="Sector"
              class="q-mb-md"
            />

            <q-input
              v-model.number="minScoreFilter"
              type="number"
              outlined
              dense
              clearable
              label="Min Score"
              :min="0"
              :max="100"
            />
          </q-card-section>
        </q-card>
      </div>

      <!-- Right Panel: Rankings Table -->
      <q-card class="col">
        <q-card-section class="q-pb-none">
          <div class="row items-center">
            <div class="text-h6">Patent Rankings</div>
            <q-space />
            <q-spinner v-if="loading" color="primary" size="sm" class="q-mr-sm" />
            <span v-if="loading" class="text-grey-6 text-caption">Loading...</span>
          </div>
        </q-card-section>

        <q-card-section>
          <!-- Error State -->
          <q-banner v-if="error" class="bg-negative text-white q-mb-md">
            {{ error }}
            <template v-slot:action>
              <q-btn flat label="Retry" @click="fetchScores" />
            </template>
          </q-banner>

          <!-- Rankings Table -->
          <q-table
            :rows="patents"
            :columns="columns"
            row-key="patent_id"
            v-model:pagination="pagination"
            :loading="loading"
            flat
            bordered
            binary-state-sort
            @request="onRequest"
          >
            <!-- Rank -->
            <template v-slot:body-cell-rank="props">
              <q-td :props="props">
                <span class="text-weight-bold">{{ props.row.rank }}</span>
              </q-td>
            </template>

            <!-- Patent ID as link -->
            <template v-slot:body-cell-patent_id="props">
              <q-td :props="props">
                <a
                  href="#"
                  class="text-primary"
                  @click.prevent="goToPatent(props.row.patent_id)"
                >
                  {{ props.row.patent_id }}
                </a>
              </q-td>
            </template>

            <!-- Title with truncation -->
            <template v-slot:body-cell-patent_title="props">
              <q-td :props="props">
                <div class="ellipsis" style="max-width: 280px">
                  {{ props.row.patent_title }}
                  <q-tooltip v-if="props.row.patent_title?.length > 40">
                    {{ props.row.patent_title }}
                  </q-tooltip>
                </div>
              </q-td>
            </template>

            <!-- Assignee -->
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

            <!-- Sector -->
            <template v-slot:body-cell-primary_sector="props">
              <q-td :props="props">
                <div class="ellipsis" style="max-width: 130px">
                  {{ props.row.primary_sector }}
                </div>
              </q-td>
            </template>

            <!-- Score badge -->
            <template v-slot:body-cell-score="props">
              <q-td :props="props">
                <q-badge :color="scoreColor(props.row.score)">
                  {{ props.row.score.toFixed(1) }}
                </q-badge>
              </q-td>
            </template>

            <!-- Competitor citations -->
            <template v-slot:body-cell-competitor_citations="props">
              <q-td :props="props">
                <span :class="{ 'text-red-7 text-weight-bold': props.row.competitor_citations > 0 }">
                  {{ props.row.competitor_citations }}
                </span>
              </q-td>
            </template>

            <!-- LLM indicator -->
            <template v-slot:body-cell-llm="props">
              <q-td :props="props">
                <q-icon
                  v-if="props.row.has_llm_scores"
                  name="psychology"
                  color="deep-purple"
                  size="xs"
                >
                  <q-tooltip>
                    LLM scores available:
                    Elig={{ props.row.llm_scores?.eligibility_score }},
                    Valid={{ props.row.llm_scores?.validity_score }},
                    Breadth={{ props.row.llm_scores?.claim_breadth }},
                    Enforce={{ props.row.llm_scores?.enforcement_clarity }},
                    Design={{ props.row.llm_scores?.design_around_difficulty }}
                  </q-tooltip>
                </q-icon>
                <span v-else class="text-grey-4">-</span>
              </q-td>
            </template>

            <!-- Expand button -->
            <template v-slot:body-cell-expand="props">
              <q-td :props="props">
                <q-btn
                  flat
                  dense
                  round
                  size="sm"
                  :icon="expandedRow === props.row.patent_id ? 'expand_less' : 'expand_more'"
                  @click="toggleExpand(props.row.patent_id)"
                />
              </q-td>
            </template>

            <!-- Expanded row: Score breakdown -->
            <template v-slot:body="props">
              <q-tr :props="props">
                <q-td v-for="col in props.cols" :key="col.name" :props="props">
                  <!-- Use slot template content for special columns -->
                  <template v-if="col.name === 'rank'">
                    <span class="text-weight-bold">{{ props.row.rank }}</span>
                  </template>
                  <template v-else-if="col.name === 'patent_id'">
                    <a href="#" class="text-primary" @click.prevent="goToPatent(props.row.patent_id)">
                      {{ props.row.patent_id }}
                    </a>
                  </template>
                  <template v-else-if="col.name === 'patent_title'">
                    <div class="ellipsis" style="max-width: 280px">
                      {{ props.row.patent_title }}
                      <q-tooltip v-if="props.row.patent_title?.length > 40">
                        {{ props.row.patent_title }}
                      </q-tooltip>
                    </div>
                  </template>
                  <template v-else-if="col.name === 'assignee'">
                    <div class="ellipsis" style="max-width: 150px">
                      {{ props.row.assignee }}
                      <q-tooltip v-if="props.row.assignee?.length > 20">
                        {{ props.row.assignee }}
                      </q-tooltip>
                    </div>
                  </template>
                  <template v-else-if="col.name === 'primary_sector'">
                    <div class="ellipsis" style="max-width: 130px">
                      {{ props.row.primary_sector }}
                    </div>
                  </template>
                  <template v-else-if="col.name === 'score'">
                    <q-badge :color="scoreColor(props.row.score)">
                      {{ props.row.score.toFixed(1) }}
                    </q-badge>
                  </template>
                  <template v-else-if="col.name === 'competitor_citations'">
                    <span :class="{ 'text-red-7 text-weight-bold': props.row.competitor_citations > 0 }">
                      {{ props.row.competitor_citations }}
                    </span>
                  </template>
                  <template v-else-if="col.name === 'remaining_years'">
                    {{ props.row.remaining_years?.toFixed(1) }}
                  </template>
                  <template v-else-if="col.name === 'llm'">
                    <q-icon v-if="props.row.has_llm_scores" name="psychology" color="deep-purple" size="xs">
                      <q-tooltip>LLM scores available</q-tooltip>
                    </q-icon>
                    <span v-else class="text-grey-4">-</span>
                  </template>
                  <template v-else-if="col.name === 'expand'">
                    <q-btn
                      flat dense round size="sm"
                      :icon="expandedRow === props.row.patent_id ? 'expand_less' : 'expand_more'"
                      @click="toggleExpand(props.row.patent_id)"
                    />
                  </template>
                  <template v-else>
                    {{ col.value }}
                  </template>
                </q-td>
              </q-tr>

              <!-- Expanded: Score Breakdown -->
              <q-tr v-show="expandedRow === props.row.patent_id" :props="props">
                <q-td colspan="100%" class="bg-grey-1">
                  <div class="q-pa-md">
                    <div class="row q-gutter-lg">
                      <!-- Score Formula -->
                      <div class="col-5">
                        <div class="text-subtitle2 q-mb-sm">Score Breakdown</div>
                        <div class="text-caption text-grey-7 q-mb-md">
                          Score = base_score &times; year_mult &times; 100
                          = {{ props.row.base_score?.toFixed(4) }} &times; {{ props.row.year_multiplier?.toFixed(3) }} &times; 100
                          = <b>{{ props.row.score.toFixed(1) }}</b>
                        </div>

                        <!-- Metrics breakdown -->
                        <div v-for="w in sortedWeights" :key="w.key" class="q-mb-xs">
                          <div class="row items-center no-wrap">
                            <span class="text-caption col-5" :class="{ 'text-purple-6': w.isLlm }">
                              {{ w.label }}
                            </span>
                            <div class="col-4">
                              <q-linear-progress
                                :value="props.row.normalized_metrics[w.key] || 0"
                                :color="w.isLlm ? 'deep-purple-4' : 'blue-4'"
                                size="6px"
                                rounded
                              />
                            </div>
                            <span class="text-caption text-right col-1 q-ml-sm">
                              {{ ((props.row.normalized_metrics[w.key] || 0) * 100).toFixed(0) }}%
                            </span>
                            <span class="text-caption text-grey-6 text-right col-2 q-ml-sm">
                              {{ (metricContribution(props.row, w.key) * 100).toFixed(1) }}pts
                            </span>
                          </div>
                        </div>
                      </div>

                      <!-- Patent Details -->
                      <div class="col">
                        <div class="text-subtitle2 q-mb-sm">Patent Details</div>
                        <div class="row q-gutter-md">
                          <div>
                            <div class="text-caption text-grey-6">Forward Citations</div>
                            <div class="text-body2">{{ props.row.forward_citations }}</div>
                          </div>
                          <div>
                            <div class="text-caption text-blue-9">Adj. Fwd Cites</div>
                            <div class="text-body2 text-blue-8">{{ props.row.adjusted_forward_citations?.toFixed(1) || '-' }}</div>
                          </div>
                          <div>
                            <div class="text-caption text-grey-6">Competitor Cites</div>
                            <div class="text-body2 text-red-7">{{ props.row.competitor_citations }}</div>
                          </div>
                          <div>
                            <div class="text-caption text-grey-6">Affiliate Cites</div>
                            <div class="text-body2 text-orange">{{ props.row.affiliate_citations }}</div>
                          </div>
                          <div>
                            <div class="text-caption text-grey-6">Neutral Cites</div>
                            <div class="text-body2">{{ props.row.neutral_citations }}</div>
                          </div>
                          <div>
                            <div class="text-caption text-deep-orange-9">Comp. Density</div>
                            <div class="text-body2">{{ props.row.competitor_density != null ? (props.row.competitor_density * 100).toFixed(0) + '%' : '-' }}</div>
                          </div>
                          <div>
                            <div class="text-caption text-grey-6">Competitors</div>
                            <div class="text-body2">{{ props.row.competitor_count }}</div>
                          </div>
                          <div>
                            <div class="text-caption text-grey-6">Years Left</div>
                            <div class="text-body2">{{ props.row.remaining_years?.toFixed(1) }}</div>
                          </div>
                          <div>
                            <div class="text-caption text-grey-6">Year Multiplier</div>
                            <div class="text-body2">{{ props.row.year_multiplier?.toFixed(3) }}</div>
                          </div>
                        </div>

                        <!-- LLM Scores if available -->
                        <div v-if="props.row.has_llm_scores && props.row.llm_scores" class="q-mt-md">
                          <div class="text-subtitle2 q-mb-sm">
                            <q-icon name="psychology" color="deep-purple" size="xs" class="q-mr-xs" />
                            LLM Analysis Scores
                          </div>
                          <div class="row q-gutter-md">
                            <div>
                              <div class="text-caption text-grey-6">Eligibility</div>
                              <q-badge :color="props.row.llm_scores.eligibility_score >= 4 ? 'positive' : props.row.llm_scores.eligibility_score >= 3 ? 'warning' : 'negative'">
                                {{ props.row.llm_scores.eligibility_score }}/5
                              </q-badge>
                            </div>
                            <div>
                              <div class="text-caption text-grey-6">Validity</div>
                              <q-badge :color="props.row.llm_scores.validity_score >= 4 ? 'positive' : props.row.llm_scores.validity_score >= 3 ? 'warning' : 'negative'">
                                {{ props.row.llm_scores.validity_score }}/5
                              </q-badge>
                            </div>
                            <div>
                              <div class="text-caption text-grey-6">Claim Breadth</div>
                              <q-badge :color="props.row.llm_scores.claim_breadth >= 4 ? 'positive' : props.row.llm_scores.claim_breadth >= 3 ? 'warning' : 'negative'">
                                {{ props.row.llm_scores.claim_breadth }}/5
                              </q-badge>
                            </div>
                            <div>
                              <div class="text-caption text-grey-6">Enforcement</div>
                              <q-badge :color="props.row.llm_scores.enforcement_clarity >= 4 ? 'positive' : props.row.llm_scores.enforcement_clarity >= 3 ? 'warning' : 'negative'">
                                {{ props.row.llm_scores.enforcement_clarity }}/5
                              </q-badge>
                            </div>
                            <div>
                              <div class="text-caption text-grey-6">Design-Around</div>
                              <q-badge :color="props.row.llm_scores.design_around_difficulty >= 4 ? 'positive' : props.row.llm_scores.design_around_difficulty >= 3 ? 'warning' : 'negative'">
                                {{ props.row.llm_scores.design_around_difficulty }}/5
                              </q-badge>
                            </div>
                          </div>
                        </div>

                        <!-- Competitor names -->
                        <div v-if="props.row.competitor_names?.length" class="q-mt-md">
                          <div class="text-caption text-grey-6">Competitor Companies Citing</div>
                          <div class="row q-gutter-xs q-mt-xs">
                            <q-chip
                              v-for="name in props.row.competitor_names.slice(0, 10)"
                              :key="name"
                              dense
                              size="sm"
                              color="red-1"
                              text-color="red-9"
                            >
                              {{ name }}
                            </q-chip>
                            <q-chip
                              v-if="props.row.competitor_names.length > 10"
                              dense
                              size="sm"
                              color="grey-3"
                            >
                              +{{ props.row.competitor_names.length - 10 }} more
                            </q-chip>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </q-td>
              </q-tr>
            </template>

            <!-- No data -->
            <template v-slot:no-data>
              <div class="full-width row flex-center text-grey q-gutter-sm q-pa-xl">
                <q-icon size="2em" name="analytics" />
                <span>No scored patents found</span>
              </div>
            </template>
          </q-table>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<style scoped>
.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
