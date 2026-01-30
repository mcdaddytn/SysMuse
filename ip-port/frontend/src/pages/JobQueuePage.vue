<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue';
import { patentApi, enrichmentApi, batchJobsApi, type EnrichmentSummary, type SectorEnrichmentSummary, type BatchJob, type BatchJobsResponse } from '@/services/api';

const activeTab = ref('enrichment');

// ─── Enrichment Overview (Tier-based) ────────────────────────────────────────
const enrichmentData = ref<EnrichmentSummary | null>(null);
const enrichmentLoading = ref(false);
const enrichmentError = ref<string | null>(null);

const TIER_SIZE_KEY = 'enrichment-tier-size';
const savedTierSize = localStorage.getItem(TIER_SIZE_KEY);
const selectedTierSize = ref(savedTierSize ? parseInt(savedTierSize) : 1000);

watch(selectedTierSize, (newVal) => {
  localStorage.setItem(TIER_SIZE_KEY, String(newVal));
});

const tierSizeOptions = [
  { value: 1000, label: '1,000' },
  { value: 2000, label: '2,000' },
  { value: 3000, label: '3,000' },
  { value: 5000, label: '5,000' }
];

async function loadEnrichmentSummary() {
  enrichmentLoading.value = true;
  enrichmentError.value = null;
  try {
    enrichmentData.value = await patentApi.getEnrichmentSummary(selectedTierSize.value);
  } catch (err) {
    enrichmentError.value = err instanceof Error ? err.message : 'Failed to load enrichment summary';
  } finally {
    enrichmentLoading.value = false;
  }
}

// ─── Sector Enrichment Overview ──────────────────────────────────────────────
const sectorEnrichmentData = ref<SectorEnrichmentSummary | null>(null);
const sectorEnrichmentLoading = ref(false);
const sectorEnrichmentError = ref<string | null>(null);

const TOP_PER_SECTOR_KEY = 'enrichment-top-per-sector';
const savedTopPerSector = localStorage.getItem(TOP_PER_SECTOR_KEY);
const selectedTopPerSector = ref(savedTopPerSector ? parseInt(savedTopPerSector) : 500);

watch(selectedTopPerSector, (newVal) => {
  localStorage.setItem(TOP_PER_SECTOR_KEY, String(newVal));
});

const topPerSectorOptions = [
  { value: 100, label: '100' },
  { value: 250, label: '250' },
  { value: 500, label: '500' },
  { value: 1000, label: '1,000' }
];

async function loadSectorEnrichment() {
  sectorEnrichmentLoading.value = true;
  sectorEnrichmentError.value = null;
  try {
    sectorEnrichmentData.value = await enrichmentApi.getSectorEnrichment(selectedTopPerSector.value);
  } catch (err) {
    sectorEnrichmentError.value = err instanceof Error ? err.message : 'Failed to load sector enrichment';
  } finally {
    sectorEnrichmentLoading.value = false;
  }
}

// ─── Job Queue ───────────────────────────────────────────────────────────────
const batchJobsData = ref<BatchJobsResponse | null>(null);
const jobsLoading = ref(false);
const jobsError = ref<string | null>(null);
let jobsRefreshInterval: ReturnType<typeof setInterval> | null = null;

async function loadBatchJobs() {
  jobsLoading.value = true;
  jobsError.value = null;
  try {
    batchJobsData.value = await batchJobsApi.getJobs();
  } catch (err) {
    jobsError.value = err instanceof Error ? err.message : 'Failed to load batch jobs';
  } finally {
    jobsLoading.value = false;
  }
}

// New Job Dialog
const showNewJobDialog = ref(false);
const newJobType = ref<'tier' | 'super-sector' | 'sector'>('tier');
const newJobTarget = ref('6000');
const newJobMaxHours = ref(4);
const startingJob = ref(false);

const jobTypeOptions = [
  { value: 'tier', label: 'Tier (Top N patents)' },
  { value: 'super-sector', label: 'Super-Sector' },
  { value: 'sector', label: 'Sector' }
];

const superSectorOptions = [
  'Video & Streaming', 'Semiconductor', 'Security', 'Virtualization & Cloud',
  'SDN & Network Infrastructure', 'Computing & Data', 'Wireless & RF',
  'Imaging & Optics', 'Audio', 'AI & Machine Learning'
];

async function startNewJob() {
  startingJob.value = true;
  try {
    await batchJobsApi.startJob({
      type: newJobType.value,
      target: newJobTarget.value,
      maxHours: newJobMaxHours.value
    });
    showNewJobDialog.value = false;
    await loadBatchJobs();
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } } };
    alert(error.response?.data?.error || 'Failed to start job');
  } finally {
    startingJob.value = false;
  }
}

async function cancelJob(jobId: string) {
  if (!confirm('Cancel this job?')) return;
  try {
    await batchJobsApi.cancelJob(jobId);
    await loadBatchJobs();
  } catch (err) {
    console.error('Failed to cancel job:', err);
  }
}

// Quick Start from Sector table
async function quickStartSectorJob(sectorName: string) {
  if (!confirm(`Start enrichment job for "${sectorName}"?`)) return;
  try {
    await batchJobsApi.startJob({
      type: 'super-sector',
      target: sectorName,
      maxHours: 4
    });
    activeTab.value = 'jobs';
    await loadBatchJobs();
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } } };
    alert(error.response?.data?.error || 'Failed to start job');
  }
}

// Log Viewer
const showLogDialog = ref(false);
const logContent = ref('');
const viewingJobId = ref('');

async function viewJobLog(jobId: string) {
  viewingJobId.value = jobId;
  try {
    const { log } = await batchJobsApi.getJobLog(jobId, 100);
    logContent.value = log;
    showLogDialog.value = true;
  } catch (err) {
    console.error('Failed to load log:', err);
  }
}

// Helpers
function enrichmentPct(count: number, total: number): number {
  return total > 0 ? Math.round(count / total * 1000) / 10 : 0;
}

function coverageColor(pct: number): string {
  if (pct >= 80) return 'positive';
  if (pct >= 50) return 'warning';
  if (pct >= 20) return 'orange';
  return 'negative';
}

function getStatusColor(status: string) {
  switch (status) {
    case 'pending': return 'grey';
    case 'running': return 'blue';
    case 'completed': return 'positive';
    case 'failed': return 'negative';
    case 'cancelled': return 'orange';
    default: return 'grey';
  }
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const mins = Math.round((end - start) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Metric descriptions
const metricDescriptions: Record<string, string> = {
  'Patents': 'Number of patents in this tier',
  'Base Score Range': 'Multi-factor base score: citation score (log-scaled) + time score (remaining years) + velocity score (citations per year), multiplied by sector damages potential (0.8x-1.5x). Range 0-200.',
  'Expired': 'Patents with 0 or fewer years of remaining term',
  'Active 3yr+': 'Patents with at least 3 years of remaining term',
  'Avg Years Left': 'Average remaining patent term in years across the tier',
  'Median Years Left': 'Median remaining patent term in years across the tier',
  'Avg Forward Cites': 'Average number of forward citations (patents that cite this patent) from the PatentsView database',
  'Avg Competitor Cites': 'Average number of forward citations originating from known competitor companies',
  'LLM Coverage': 'Patents with AI-generated analysis (summary, legal scores, classification) from the LLM enrichment pipeline',
  'Prosecution': 'Patents with prosecution history data retrieved from the USPTO File Wrapper API',
  'IPR / PTAB': 'Patents checked for inter partes review (IPR) and Patent Trial & Appeal Board (PTAB) proceedings',
  'Families': 'Patents with backward citation (parent patent) data from the patent families pipeline',
};

// Lifecycle
onMounted(() => {
  loadEnrichmentSummary();
  loadSectorEnrichment();
  loadBatchJobs();

  // Auto-refresh jobs every 30 seconds
  jobsRefreshInterval = setInterval(() => {
    if (activeTab.value === 'jobs') {
      loadBatchJobs();
    }
  }, 30000);
});

onUnmounted(() => {
  if (jobsRefreshInterval) {
    clearInterval(jobsRefreshInterval);
  }
});
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5 q-mr-md">Jobs &amp; Enrichment</div>
    </div>

    <!-- Tab Navigation -->
    <q-tabs v-model="activeTab" class="q-mb-md" align="left" active-color="primary">
      <q-tab name="enrichment" label="Enrichment Overview" icon="analytics" />
      <q-tab name="sectors" label="Sector Enrichment" icon="category" />
      <q-tab name="jobs" label="Job Queue" icon="queue" />
    </q-tabs>

    <q-tab-panels v-model="activeTab" animated>
      <!-- ═══ Enrichment Overview Tab (Tier-based) ═══ -->
      <q-tab-panel name="enrichment" class="q-pa-none">
        <!-- Tier size selector -->
        <div class="row items-center q-mb-md q-gutter-md">
          <span class="text-subtitle2">Tier Size:</span>
          <q-select
            v-model="selectedTierSize"
            :options="tierSizeOptions"
            emit-value
            map-options
            outlined
            dense
            style="min-width: 120px"
            @update:model-value="loadEnrichmentSummary"
          />
          <q-btn flat icon="refresh" label="Refresh" :loading="enrichmentLoading" @click="loadEnrichmentSummary" />
        </div>

        <!-- Loading -->
        <div v-if="enrichmentLoading && !enrichmentData" class="row justify-center q-pa-xl">
          <q-spinner size="lg" color="primary" />
        </div>

        <!-- Error -->
        <q-banner v-else-if="enrichmentError" class="bg-negative text-white q-mb-md">
          {{ enrichmentError }}
          <template v-slot:action>
            <q-btn flat label="Retry" @click="loadEnrichmentSummary" />
          </template>
        </q-banner>

        <!-- Data -->
        <template v-else-if="enrichmentData">
          <!-- Overall Summary Cards -->
          <div class="row q-gutter-md q-mb-lg">
            <q-card class="col">
              <q-card-section class="text-center">
                <div class="text-h4">{{ enrichmentData.totalPatents.toLocaleString() }}</div>
                <div class="text-grey-6">Total Patents</div>
              </q-card-section>
            </q-card>
            <q-card class="col">
              <q-card-section>
                <div class="row items-center justify-between q-mb-xs">
                  <span class="text-weight-medium">LLM Analysis</span>
                  <span class="text-caption">{{ enrichmentData.enrichmentTotals.llm.toLocaleString() }} / {{ enrichmentData.totalPatents.toLocaleString() }}</span>
                </div>
                <q-linear-progress
                  :value="enrichmentData.enrichmentTotals.llm / enrichmentData.totalPatents"
                  :color="coverageColor(enrichmentPct(enrichmentData.enrichmentTotals.llm, enrichmentData.totalPatents))"
                  size="20px"
                  rounded
                >
                  <div class="absolute-full flex flex-center">
                    <span class="text-caption text-white text-weight-bold">{{ enrichmentPct(enrichmentData.enrichmentTotals.llm, enrichmentData.totalPatents) }}%</span>
                  </div>
                </q-linear-progress>
              </q-card-section>
            </q-card>
            <q-card class="col">
              <q-card-section>
                <div class="row items-center justify-between q-mb-xs">
                  <span class="text-weight-medium">Prosecution</span>
                  <span class="text-caption">{{ enrichmentData.enrichmentTotals.prosecution.toLocaleString() }} / {{ enrichmentData.totalPatents.toLocaleString() }}</span>
                </div>
                <q-linear-progress
                  :value="enrichmentData.enrichmentTotals.prosecution / enrichmentData.totalPatents"
                  :color="coverageColor(enrichmentPct(enrichmentData.enrichmentTotals.prosecution, enrichmentData.totalPatents))"
                  size="20px"
                  rounded
                >
                  <div class="absolute-full flex flex-center">
                    <span class="text-caption text-white text-weight-bold">{{ enrichmentPct(enrichmentData.enrichmentTotals.prosecution, enrichmentData.totalPatents) }}%</span>
                  </div>
                </q-linear-progress>
              </q-card-section>
            </q-card>
            <q-card class="col">
              <q-card-section>
                <div class="row items-center justify-between q-mb-xs">
                  <span class="text-weight-medium">IPR / PTAB</span>
                  <span class="text-caption">{{ enrichmentData.enrichmentTotals.ipr.toLocaleString() }} / {{ enrichmentData.totalPatents.toLocaleString() }}</span>
                </div>
                <q-linear-progress
                  :value="enrichmentData.enrichmentTotals.ipr / enrichmentData.totalPatents"
                  :color="coverageColor(enrichmentPct(enrichmentData.enrichmentTotals.ipr, enrichmentData.totalPatents))"
                  size="20px"
                  rounded
                >
                  <div class="absolute-full flex flex-center">
                    <span class="text-caption text-white text-weight-bold">{{ enrichmentPct(enrichmentData.enrichmentTotals.ipr, enrichmentData.totalPatents) }}%</span>
                  </div>
                </q-linear-progress>
              </q-card-section>
            </q-card>
            <q-card class="col">
              <q-card-section>
                <div class="row items-center justify-between q-mb-xs">
                  <span class="text-weight-medium">Families</span>
                  <span class="text-caption">{{ enrichmentData.enrichmentTotals.family.toLocaleString() }} / {{ enrichmentData.totalPatents.toLocaleString() }}</span>
                </div>
                <q-linear-progress
                  :value="enrichmentData.enrichmentTotals.family / enrichmentData.totalPatents"
                  :color="coverageColor(enrichmentPct(enrichmentData.enrichmentTotals.family, enrichmentData.totalPatents))"
                  size="20px"
                  rounded
                >
                  <div class="absolute-full flex flex-center">
                    <span class="text-caption text-white text-weight-bold">{{ enrichmentPct(enrichmentData.enrichmentTotals.family, enrichmentData.totalPatents) }}%</span>
                  </div>
                </q-linear-progress>
              </q-card-section>
            </q-card>
          </div>

          <!-- Tier Comparison Table -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section class="q-pb-none">
              <div class="text-subtitle1">Tier Comparison</div>
              <div class="text-caption text-grey-7">Patents ranked by v1 pre-screening score, broken into tiers of {{ selectedTierSize.toLocaleString() }}. Hover metric names for definitions.</div>
            </q-card-section>
            <q-card-section>
              <div class="tier-table-scroll">
                <table class="tier-table">
                  <thead>
                    <tr>
                      <th class="metric-col">Metric</th>
                      <th v-for="tier in enrichmentData.tiers" :key="tier.tierLabel">{{ tier.tierLabel }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="metric-col text-weight-medium metric-label">
                        Patents
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]">{{ metricDescriptions['Patents'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-count'">{{ tier.count.toLocaleString() }}</td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-medium metric-label">
                        Base Score Range
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]" max-width="350px">{{ metricDescriptions['Base Score Range'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-score'">{{ tier.scoreRange }}</td>
                    </tr>
                    <tr class="section-separator">
                      <td class="metric-col text-weight-medium metric-label">
                        Expired
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]">{{ metricDescriptions['Expired'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-expired'">
                        {{ tier.expired.toLocaleString() }}
                        <span class="text-grey-6">({{ Math.round(tier.expired / tier.count * 100) }}%)</span>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-medium metric-label">
                        Active 3yr+
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]">{{ metricDescriptions['Active 3yr+'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-active'">
                        {{ tier.active3yr.toLocaleString() }}
                        <span class="text-grey-6">({{ Math.round(tier.active3yr / tier.count * 100) }}%)</span>
                      </td>
                    </tr>
                    <tr class="section-separator">
                      <td class="metric-col text-weight-bold metric-label">
                        LLM Coverage
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]" max-width="350px">{{ metricDescriptions['LLM Coverage'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-llm'">
                        <div class="enrichment-cell">
                          <q-linear-progress
                            :value="tier.enrichment.llmPct / 100"
                            :color="coverageColor(tier.enrichment.llmPct)"
                            size="16px"
                            rounded
                            class="q-mb-xs"
                          />
                          <span class="text-caption">{{ tier.enrichment.llm.toLocaleString() }} ({{ tier.enrichment.llmPct }}%)</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold metric-label">
                        Prosecution
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]" max-width="350px">{{ metricDescriptions['Prosecution'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-pros'">
                        <div class="enrichment-cell">
                          <q-linear-progress
                            :value="tier.enrichment.prosecutionPct / 100"
                            :color="coverageColor(tier.enrichment.prosecutionPct)"
                            size="16px"
                            rounded
                            class="q-mb-xs"
                          />
                          <span class="text-caption">{{ tier.enrichment.prosecution.toLocaleString() }} ({{ tier.enrichment.prosecutionPct }}%)</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold metric-label">
                        IPR / PTAB
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]" max-width="350px">{{ metricDescriptions['IPR / PTAB'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-ipr'">
                        <div class="enrichment-cell">
                          <q-linear-progress
                            :value="tier.enrichment.iprPct / 100"
                            :color="coverageColor(tier.enrichment.iprPct)"
                            size="16px"
                            rounded
                            class="q-mb-xs"
                          />
                          <span class="text-caption">{{ tier.enrichment.ipr.toLocaleString() }} ({{ tier.enrichment.iprPct }}%)</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold metric-label">
                        Families
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]" max-width="350px">{{ metricDescriptions['Families'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-fam'">
                        <div class="enrichment-cell">
                          <q-linear-progress
                            :value="tier.enrichment.familyPct / 100"
                            :color="coverageColor(tier.enrichment.familyPct)"
                            size="16px"
                            rounded
                            class="q-mb-xs"
                          />
                          <span class="text-caption">{{ tier.enrichment.family.toLocaleString() }} ({{ tier.enrichment.familyPct }}%)</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </q-card-section>
          </q-card>
        </template>
      </q-tab-panel>

      <!-- ═══ Sector Enrichment Tab ═══ -->
      <q-tab-panel name="sectors" class="q-pa-none">
        <div class="row items-center q-mb-md q-gutter-md">
          <span class="text-subtitle2">Top patents per sector:</span>
          <q-select
            v-model="selectedTopPerSector"
            :options="topPerSectorOptions"
            emit-value
            map-options
            outlined
            dense
            style="min-width: 120px"
            @update:model-value="loadSectorEnrichment"
          />
          <q-btn flat icon="refresh" label="Refresh" :loading="sectorEnrichmentLoading" @click="loadSectorEnrichment" />
        </div>

        <div v-if="sectorEnrichmentLoading && !sectorEnrichmentData" class="row justify-center q-pa-xl">
          <q-spinner size="lg" color="primary" />
        </div>

        <q-banner v-else-if="sectorEnrichmentError" class="bg-negative text-white q-mb-md">
          {{ sectorEnrichmentError }}
          <template v-slot:action>
            <q-btn flat label="Retry" @click="loadSectorEnrichment" />
          </template>
        </q-banner>

        <template v-else-if="sectorEnrichmentData">
          <q-card flat bordered>
            <q-card-section class="q-pb-none">
              <div class="text-subtitle1">Sector Enrichment Overview</div>
              <div class="text-caption text-grey-7">
                Enrichment coverage for top {{ selectedTopPerSector.toLocaleString() }} patents in each super-sector (by base score).
                Click "Enrich" to start a batch job for that sector.
              </div>
            </q-card-section>
            <q-card-section>
              <q-table
                :rows="sectorEnrichmentData.sectors"
                :columns="[
                  { name: 'name', label: 'Super-Sector', field: 'name', align: 'left', sortable: true },
                  { name: 'total', label: 'Total', field: 'totalPatents', align: 'right', sortable: true },
                  { name: 'checked', label: 'Checked', field: 'checkedPatents', align: 'right' },
                  { name: 'llm', label: 'LLM', field: (row: any) => row.enrichment.llmPct, align: 'center', sortable: true },
                  { name: 'pros', label: 'Prosecution', field: (row: any) => row.enrichment.prosecutionPct, align: 'center', sortable: true },
                  { name: 'ipr', label: 'IPR', field: (row: any) => row.enrichment.iprPct, align: 'center', sortable: true },
                  { name: 'family', label: 'Families', field: (row: any) => row.enrichment.familyPct, align: 'center', sortable: true },
                  { name: 'gaps', label: 'Total Gaps', field: (row: any) => row.gaps.llm + row.gaps.prosecution + row.gaps.ipr + row.gaps.family, align: 'right', sortable: true },
                  { name: 'actions', label: '', field: 'actions', align: 'center' }
                ]"
                row-key="name"
                flat
                bordered
                dense
                :pagination="{ rowsPerPage: 20 }"
              >
                <template v-slot:body-cell-llm="props">
                  <q-td :props="props">
                    <div class="enrichment-cell-small">
                      <q-linear-progress
                        :value="props.row.enrichment.llmPct / 100"
                        :color="coverageColor(props.row.enrichment.llmPct)"
                        size="12px"
                        rounded
                      />
                      <span class="text-caption">{{ props.row.enrichment.llmPct }}%</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-pros="props">
                  <q-td :props="props">
                    <div class="enrichment-cell-small">
                      <q-linear-progress
                        :value="props.row.enrichment.prosecutionPct / 100"
                        :color="coverageColor(props.row.enrichment.prosecutionPct)"
                        size="12px"
                        rounded
                      />
                      <span class="text-caption">{{ props.row.enrichment.prosecutionPct }}%</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-ipr="props">
                  <q-td :props="props">
                    <div class="enrichment-cell-small">
                      <q-linear-progress
                        :value="props.row.enrichment.iprPct / 100"
                        :color="coverageColor(props.row.enrichment.iprPct)"
                        size="12px"
                        rounded
                      />
                      <span class="text-caption">{{ props.row.enrichment.iprPct }}%</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-family="props">
                  <q-td :props="props">
                    <div class="enrichment-cell-small">
                      <q-linear-progress
                        :value="props.row.enrichment.familyPct / 100"
                        :color="coverageColor(props.row.enrichment.familyPct)"
                        size="12px"
                        rounded
                      />
                      <span class="text-caption">{{ props.row.enrichment.familyPct }}%</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-gaps="props">
                  <q-td :props="props">
                    <q-badge
                      :color="props.value > 500 ? 'negative' : props.value > 100 ? 'warning' : 'positive'"
                    >
                      {{ props.value.toLocaleString() }}
                    </q-badge>
                  </q-td>
                </template>
                <template v-slot:body-cell-actions="props">
                  <q-td :props="props">
                    <q-btn
                      v-if="props.row.gaps.llm + props.row.gaps.prosecution > 0"
                      flat
                      dense
                      color="primary"
                      icon="play_arrow"
                      label="Enrich"
                      @click="quickStartSectorJob(props.row.name)"
                    />
                    <q-icon
                      v-else
                      name="check_circle"
                      color="positive"
                      size="sm"
                    />
                  </q-td>
                </template>
              </q-table>
            </q-card-section>
          </q-card>
        </template>
      </q-tab-panel>

      <!-- ═══ Job Queue Tab ═══ -->
      <q-tab-panel name="jobs" class="q-pa-none">
        <div class="row items-center q-mb-md">
          <q-btn color="primary" label="New Job" icon="add" @click="showNewJobDialog = true" />
          <q-space />
          <q-btn flat icon="refresh" label="Refresh" :loading="jobsLoading" @click="loadBatchJobs" />
        </div>

        <!-- Stats Cards -->
        <div class="row q-gutter-md q-mb-md" v-if="batchJobsData">
          <q-card class="col">
            <q-card-section class="text-center">
              <div class="text-h4">{{ batchJobsData.stats.pending }}</div>
              <div class="text-grey-6">Pending</div>
            </q-card-section>
          </q-card>
          <q-card class="col">
            <q-card-section class="text-center">
              <div class="text-h4 text-blue">{{ batchJobsData.stats.running }}</div>
              <div class="text-grey-6">Running</div>
            </q-card-section>
          </q-card>
          <q-card class="col">
            <q-card-section class="text-center">
              <div class="text-h4 text-positive">{{ batchJobsData.stats.completed }}</div>
              <div class="text-grey-6">Completed (7d)</div>
            </q-card-section>
          </q-card>
          <q-card class="col">
            <q-card-section class="text-center">
              <div class="text-h4 text-negative">{{ batchJobsData.stats.failed }}</div>
              <div class="text-grey-6">Failed</div>
            </q-card-section>
          </q-card>
        </div>

        <!-- Jobs Table -->
        <q-table
          v-if="batchJobsData"
          :rows="batchJobsData.jobs"
          :columns="[
            { name: 'status', label: 'Status', field: 'status', align: 'center' },
            { name: 'type', label: 'Type', field: 'type', align: 'left' },
            { name: 'target', label: 'Target', field: 'target', align: 'left' },
            { name: 'started', label: 'Started', field: 'startedAt', align: 'center' },
            { name: 'duration', label: 'Duration', field: 'startedAt', align: 'center' },
            { name: 'actions', label: 'Actions', field: 'actions', align: 'center' }
          ]"
          row-key="id"
          flat
          bordered
          :pagination="{ rowsPerPage: 20 }"
        >
          <template v-slot:body-cell-status="props">
            <q-td :props="props">
              <q-badge :color="getStatusColor(props.row.status)">
                {{ props.row.status }}
              </q-badge>
              <q-spinner v-if="props.row.status === 'running'" size="xs" color="blue" class="q-ml-xs" />
            </q-td>
          </template>

          <template v-slot:body-cell-type="props">
            <q-td :props="props">
              <q-chip dense :color="props.row.type === 'tier' ? 'blue-2' : props.row.type === 'super-sector' ? 'purple-2' : 'teal-2'">
                {{ props.row.type }}
              </q-chip>
            </q-td>
          </template>

          <template v-slot:body-cell-started="props">
            <q-td :props="props">
              {{ formatDate(props.row.startedAt) }}
            </q-td>
          </template>

          <template v-slot:body-cell-duration="props">
            <q-td :props="props">
              {{ formatDuration(props.row.startedAt, props.row.completedAt) }}
            </q-td>
          </template>

          <template v-slot:body-cell-actions="props">
            <q-td :props="props">
              <q-btn
                flat
                dense
                icon="article"
                color="grey"
                @click="viewJobLog(props.row.id)"
              >
                <q-tooltip>View Log</q-tooltip>
              </q-btn>
              <q-btn
                v-if="props.row.status === 'running'"
                flat
                dense
                icon="stop"
                color="negative"
                @click="cancelJob(props.row.id)"
              >
                <q-tooltip>Cancel</q-tooltip>
              </q-btn>
            </q-td>
          </template>

          <template v-slot:no-data>
            <div class="full-width row flex-center text-grey q-pa-xl">
              <q-icon size="2em" name="inbox" class="q-mr-sm" />
              No batch jobs found
            </div>
          </template>
        </q-table>
      </q-tab-panel>
    </q-tab-panels>

    <!-- New Job Dialog -->
    <q-dialog v-model="showNewJobDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Start Enrichment Job</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-select
            v-model="newJobType"
            :options="jobTypeOptions"
            emit-value
            map-options
            label="Job Type"
            outlined
          />

          <q-input
            v-if="newJobType === 'tier'"
            v-model="newJobTarget"
            label="Top N Patents"
            outlined
            type="number"
            hint="e.g., 6000 for top 6000 patents"
          />

          <q-select
            v-else
            v-model="newJobTarget"
            :options="superSectorOptions"
            label="Super-Sector"
            outlined
          />

          <q-input
            v-model.number="newJobMaxHours"
            label="Max Hours"
            outlined
            type="number"
            hint="Maximum runtime before job stops"
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Start Job"
            :loading="startingJob"
            @click="startNewJob"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Log Viewer Dialog -->
    <q-dialog v-model="showLogDialog" maximized>
      <q-card>
        <q-card-section class="row items-center">
          <div class="text-h6">Job Log: {{ viewingJobId }}</div>
          <q-space />
          <q-btn flat round icon="close" v-close-popup />
        </q-card-section>

        <q-card-section class="log-viewer">
          <pre>{{ logContent }}</pre>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.tier-table-scroll {
  overflow-x: auto;
}

.tier-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.tier-table th,
.tier-table td {
  padding: 8px 12px;
  text-align: center;
  border-bottom: 1px solid #e0e0e0;
  white-space: nowrap;
}

.tier-table th {
  background: #f5f5f5;
  font-weight: 600;
  position: sticky;
  top: 0;
}

.tier-table .metric-col {
  text-align: left;
  min-width: 160px;
  position: sticky;
  left: 0;
  background: #fff;
  z-index: 1;
}

.tier-table th.metric-col {
  background: #f5f5f5;
  z-index: 2;
}

.tier-table tr.section-separator td {
  border-top: 2px solid #bdbdbd;
}

.metric-label {
  cursor: help;
  border-bottom: 1px dotted #9e9e9e;
}

.enrichment-cell {
  position: relative;
  min-width: 140px;
}

.enrichment-cell-small {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 80px;
}

.log-viewer {
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  max-height: calc(100vh - 100px);
  overflow: auto;
}

.log-viewer pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
