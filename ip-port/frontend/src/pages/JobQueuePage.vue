<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed } from 'vue';
import {
  patentApi, enrichmentApi, batchJobsApi,
  type EnrichmentSummary, type SectorEnrichmentSummary,
  type BatchJob, type BatchJobsResponse, type CoverageType, type TargetType, type GapsResponse
} from '@/services/api';

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
  { value: 250, label: '250' },
  { value: 500, label: '500' },
  { value: 1000, label: '1,000' },
  { value: 2000, label: '2,000' },
  { value: 3500, label: '3,500' },
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
// Default to 0 (all patents) for accurate coverage view
const selectedTopPerSector = ref(savedTopPerSector !== null ? parseInt(savedTopPerSector) : 0);

watch(selectedTopPerSector, (newVal) => {
  localStorage.setItem(TOP_PER_SECTOR_KEY, String(newVal));
});

const topPerSectorOptions = [
  { value: 0, label: 'All (Full Coverage)' },
  { value: 25, label: 'Top 25' },
  { value: 50, label: 'Top 50' },
  { value: 100, label: 'Top 100' },
  { value: 250, label: 'Top 250' },
  { value: 500, label: 'Top 500' },
  { value: 1000, label: 'Top 1,000' }
];

const sectorScopeTooltip = `Controls how many patents are evaluated per sector.

• "All (Full Coverage)" shows true enrichment coverage across all patents in each sector.

• "Top N" options show coverage for only the highest-scoring N patents within each sector. This is useful for prioritizing enrichment of high-value patents, but can be misleading since those patents often overlap with the top tiers in the Enrichment Overview.

For accurate portfolio-wide coverage, use "All (Full Coverage)" or the tier-based Enrichment Overview tab.`;

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
let etaUpdateInterval: ReturnType<typeof setInterval> | null = null;

// Reactive timestamp to force ETA recalculation
const currentTime = ref(Date.now());

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

// Group jobs by groupId for display
const groupedJobs = computed(() => {
  if (!batchJobsData.value) return [];

  const groups: Map<string, BatchJob[]> = new Map();
  const ungrouped: BatchJob[] = [];

  for (const job of batchJobsData.value.jobs) {
    if (job.groupId) {
      if (!groups.has(job.groupId)) {
        groups.set(job.groupId, []);
      }
      groups.get(job.groupId)!.push(job);
    } else {
      ungrouped.push(job);
    }
  }

  // Convert to array format for display
  const result: Array<{ isGroup: boolean; groupId?: string; jobs: BatchJob[]; job?: BatchJob }> = [];

  for (const [groupId, jobs] of groups) {
    result.push({ isGroup: true, groupId, jobs });
  }

  for (const job of ungrouped) {
    result.push({ isGroup: false, job, jobs: [] });
  }

  return result;
});

// ─── Start Job Dialog ────────────────────────────────────────────────────────
const showNewJobDialog = ref(false);
const newJobTargetType = ref<TargetType>('tier');
const newJobTargetValue = ref('6000');
const newJobCoverageTypes = ref<CoverageType[]>(['llm', 'prosecution', 'ipr', 'family']);
const newJobMaxHours = ref(4);
const startingJob = ref(false);
const gapsData = ref<GapsResponse | null>(null);
const loadingGaps = ref(false);

const targetTypeOptions = [
  { value: 'tier', label: 'Tier (Top N patents)' },
  { value: 'super-sector', label: 'Super-Sector' },
  { value: 'sector', label: 'Sector' }
];

const coverageTypeOptions: Array<{ value: CoverageType; label: string; color: string }> = [
  { value: 'llm', label: 'LLM Analysis', color: 'blue' },
  { value: 'prosecution', label: 'Prosecution History', color: 'purple' },
  { value: 'ipr', label: 'IPR / PTAB', color: 'orange' },
  { value: 'family', label: 'Patent Families', color: 'teal' }
];

const superSectorOptions = [
  'Video & Streaming', 'Semiconductor', 'Security', 'Virtualization & Cloud',
  'SDN & Network Infrastructure', 'Computing & Data', 'Wireless & RF',
  'Imaging & Optics', 'Audio', 'AI & Machine Learning'
];

// Load gaps when dialog opens or target changes
async function loadGaps() {
  if (!newJobTargetValue.value) return;
  loadingGaps.value = true;
  try {
    gapsData.value = await batchJobsApi.getGaps(newJobTargetType.value, newJobTargetValue.value);
  } catch (err) {
    console.error('Failed to load gaps:', err);
    gapsData.value = null;
  } finally {
    loadingGaps.value = false;
  }
}

watch([newJobTargetType, newJobTargetValue], () => {
  if (showNewJobDialog.value) {
    loadGaps();
  }
});

watch(showNewJobDialog, (open) => {
  if (open) {
    loadGaps();
  }
});

async function startNewJob() {
  startingJob.value = true;
  try {
    await batchJobsApi.startJobs({
      targetType: newJobTargetType.value,
      targetValue: newJobTargetValue.value,
      coverageTypes: newJobCoverageTypes.value,
      maxHours: newJobMaxHours.value
    });
    showNewJobDialog.value = false;
    await loadBatchJobs();
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } } };
    alert(error.response?.data?.error || 'Failed to start jobs');
  } finally {
    startingJob.value = false;
  }
}

// ─── Contextual Enrich Dialogs ───────────────────────────────────────────────
const showEnrichDialog = ref(false);
const enrichDialogTargetType = ref<TargetType>('tier');
const enrichDialogTargetValue = ref('');
const enrichDialogTopN = ref<number>(0);  // 0 = all patents in sector
const enrichDialogCoverageTypes = ref<CoverageType[]>(['llm', 'prosecution', 'ipr', 'family']);
const enrichDialogGaps = ref<GapsResponse | null>(null);
const enrichDialogLoading = ref(false);
const enrichDialogStarting = ref(false);

async function openEnrichDialog(targetType: TargetType, targetValue: string, topN: number = 0) {
  enrichDialogTargetType.value = targetType;
  enrichDialogTargetValue.value = targetValue;
  enrichDialogTopN.value = topN;
  enrichDialogCoverageTypes.value = ['llm', 'prosecution', 'ipr', 'family'];
  enrichDialogGaps.value = null;
  showEnrichDialog.value = true;

  // Load gaps (pass topN for super-sector/sector to limit to top N patents)
  enrichDialogLoading.value = true;
  try {
    enrichDialogGaps.value = await batchJobsApi.getGaps(targetType, targetValue, topN > 0 ? topN : undefined);
  } catch (err) {
    console.error('Failed to load gaps:', err);
  } finally {
    enrichDialogLoading.value = false;
  }
}

async function startEnrichFromDialog() {
  enrichDialogStarting.value = true;
  try {
    await batchJobsApi.startJobs({
      targetType: enrichDialogTargetType.value,
      targetValue: enrichDialogTargetValue.value,
      coverageTypes: enrichDialogCoverageTypes.value,
      maxHours: 4,
      topN: enrichDialogTopN.value > 0 ? enrichDialogTopN.value : undefined
    });
    showEnrichDialog.value = false;
    activeTab.value = 'jobs';
    await loadBatchJobs();
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } } };
    alert(error.response?.data?.error || 'Failed to start enrichment');
  } finally {
    enrichDialogStarting.value = false;
  }
}

// ─── Job Actions ─────────────────────────────────────────────────────────────
async function cancelJob(jobId: string) {
  if (!confirm('Cancel this job?')) return;
  try {
    await batchJobsApi.cancelJob(jobId);
    await loadBatchJobs();
  } catch (err) {
    console.error('Failed to cancel job:', err);
  }
}

async function cancelJobGroup(groupId: string) {
  if (!confirm('Cancel all jobs in this group?')) return;
  try {
    await batchJobsApi.cancelJobGroup(groupId);
    await loadBatchJobs();
  } catch (err) {
    console.error('Failed to cancel job group:', err);
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// Format tier range for display (e.g., tierIndex=4, tierSize=1000 → "3,001-4,000")
function formatTierRange(tierIndex: number, tierSize: number): string {
  const end = tierIndex * tierSize;
  const start = end - tierSize + 1;
  return `${start.toLocaleString()}-${end.toLocaleString()}`;
}

// Format job target for display
function formatJobTarget(job: BatchJob): string {
  if (job.targetType === 'tier') {
    // targetValue could be "5000" (legacy) or "4001-5000" (new format)
    const val = job.targetValue;
    if (val.includes('-')) {
      return `Tier ${val.replace('-', '-').split('-').map(n => parseInt(n).toLocaleString()).join('-')}`;
    }
    // Legacy format: just show "Top N"
    return `Top ${parseInt(val).toLocaleString()}`;
  }
  return job.targetValue;
}

function getCoverageColor(type: CoverageType): string {
  const opt = coverageTypeOptions.find(o => o.value === type);
  return opt?.color || 'grey';
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleTimeString();
}

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const mins = Math.round((end - start) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatETA(dateStr?: string): string {
  if (!dateStr) return '-';
  const eta = new Date(dateStr);
  // Use reactive currentTime to force recalculation
  const diff = eta.getTime() - currentTime.value;
  if (diff <= 0) return 'Soon';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `~${mins}m`;
  return `~${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function getGroupStatus(jobs: BatchJob[]): string {
  if (jobs.some(j => j.status === 'running')) return 'running';
  if (jobs.every(j => j.status === 'completed')) return 'completed';
  if (jobs.some(j => j.status === 'failed')) return 'failed';
  if (jobs.some(j => j.status === 'cancelled')) return 'cancelled';
  return 'pending';
}

// Metric descriptions
const metricDescriptions: Record<string, string> = {
  'Patents': 'Number of patents in this tier',
  'Base Score Range': 'Multi-factor base score including citations, time, and sector factors.',
  'LLM Coverage': 'Patents with AI-generated analysis from the LLM enrichment pipeline',
  'Prosecution': 'Patents with prosecution history data from USPTO',
  'IPR / PTAB': 'Patents checked for inter partes review proceedings',
  'Families': 'Patents with backward citation data from patent families pipeline',
};

// Watch for tab changes to refresh data
watch(activeTab, (newTab) => {
  if (newTab === 'sectors') {
    loadSectorEnrichment();
  } else if (newTab === 'enrichment') {
    loadEnrichmentSummary();
  } else if (newTab === 'jobs') {
    loadBatchJobs();
  }
});

// Lifecycle
onMounted(() => {
  loadEnrichmentSummary();
  loadSectorEnrichment();
  loadBatchJobs();

  // Auto-refresh every 15 seconds based on active tab
  jobsRefreshInterval = setInterval(() => {
    if (activeTab.value === 'jobs') {
      loadBatchJobs();
    } else if (activeTab.value === 'sectors') {
      loadSectorEnrichment();
    } else if (activeTab.value === 'enrichment') {
      loadEnrichmentSummary();
    }
  }, 15000);

  // Update ETA display every 10 seconds
  etaUpdateInterval = setInterval(() => {
    currentTime.value = Date.now();
  }, 10000);
});

onUnmounted(() => {
  if (jobsRefreshInterval) {
    clearInterval(jobsRefreshInterval);
  }
  if (etaUpdateInterval) {
    clearInterval(etaUpdateInterval);
  }
});
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5 q-mr-md">Jobs &amp; Enrichment</div>
    </div>

    <q-tabs v-model="activeTab" class="q-mb-md" align="left" active-color="primary">
      <q-tab name="enrichment" label="Enrichment Overview" icon="analytics" />
      <q-tab name="sectors" label="Sector Enrichment" icon="category" />
      <q-tab name="jobs" label="Job Queue" icon="queue" />
    </q-tabs>

    <q-tab-panels v-model="activeTab" animated>
      <!-- ═══ Enrichment Overview Tab (Tier-based) ═══ -->
      <q-tab-panel name="enrichment" class="q-pa-none">
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

        <div v-if="enrichmentLoading && !enrichmentData" class="row justify-center q-pa-xl">
          <q-spinner size="lg" color="primary" />
        </div>

        <q-banner v-else-if="enrichmentError" class="bg-negative text-white q-mb-md">
          {{ enrichmentError }}
        </q-banner>

        <template v-else-if="enrichmentData">
          <!-- Overall Summary Cards -->
          <div class="row q-gutter-md q-mb-lg">
            <q-card class="col">
              <q-card-section class="text-center">
                <div class="text-h4">{{ enrichmentData.totalPatents.toLocaleString() }}</div>
                <div class="text-grey-6">Total Patents</div>
              </q-card-section>
            </q-card>
            <q-card v-for="(label, key) in { llm: 'LLM', prosecution: 'Prosecution', ipr: 'IPR', family: 'Families' }" :key="key" class="col">
              <q-card-section>
                <div class="row items-center justify-between q-mb-xs">
                  <span class="text-weight-medium">{{ label }}</span>
                  <span class="text-caption">{{ enrichmentData.enrichmentTotals[key as keyof typeof enrichmentData.enrichmentTotals].toLocaleString() }}</span>
                </div>
                <q-linear-progress
                  :value="enrichmentData.enrichmentTotals[key as keyof typeof enrichmentData.enrichmentTotals] / enrichmentData.totalPatents"
                  :color="coverageColor(enrichmentPct(enrichmentData.enrichmentTotals[key as keyof typeof enrichmentData.enrichmentTotals], enrichmentData.totalPatents))"
                  size="20px"
                  rounded
                >
                  <div class="absolute-full flex flex-center">
                    <span class="text-caption text-white text-weight-bold">{{ enrichmentPct(enrichmentData.enrichmentTotals[key as keyof typeof enrichmentData.enrichmentTotals], enrichmentData.totalPatents) }}%</span>
                  </div>
                </q-linear-progress>
              </q-card-section>
            </q-card>
          </div>

          <!-- Tier Comparison Table -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section class="q-pb-none">
              <div class="text-subtitle1">Tier Comparison</div>
              <div class="text-caption text-grey-7">Click "Enrich" to fill gaps for a tier</div>
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
                      <td class="metric-col text-weight-medium">Patents</td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-count'">{{ tier.count.toLocaleString() }}</td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-medium">Score Range</td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-score'">{{ tier.scoreRange }}</td>
                    </tr>
                    <tr class="section-separator">
                      <td class="metric-col text-weight-bold">LLM</td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-llm'">
                        <div class="enrichment-cell">
                          <q-linear-progress :value="tier.enrichment.llmPct / 100" :color="coverageColor(tier.enrichment.llmPct)" size="14px" rounded class="q-mb-xs" />
                          <span class="text-caption">{{ tier.enrichment.llmPct }}%</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold">Prosecution</td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-pros'">
                        <div class="enrichment-cell">
                          <q-linear-progress :value="tier.enrichment.prosecutionPct / 100" :color="coverageColor(tier.enrichment.prosecutionPct)" size="14px" rounded class="q-mb-xs" />
                          <span class="text-caption">{{ tier.enrichment.prosecutionPct }}%</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold">IPR / PTAB</td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-ipr'">
                        <div class="enrichment-cell">
                          <q-linear-progress :value="tier.enrichment.iprPct / 100" :color="coverageColor(tier.enrichment.iprPct)" size="14px" rounded class="q-mb-xs" />
                          <span class="text-caption">{{ tier.enrichment.iprPct }}%</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold">Families</td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-fam'">
                        <div class="enrichment-cell">
                          <q-linear-progress :value="tier.enrichment.familyPct / 100" :color="coverageColor(tier.enrichment.familyPct)" size="14px" rounded class="q-mb-xs" />
                          <span class="text-caption">{{ tier.enrichment.familyPct }}%</span>
                        </div>
                      </td>
                    </tr>
                    <!-- Enrich Actions Row -->
                    <tr class="section-separator">
                      <td class="metric-col text-weight-bold">Actions</td>
                      <td v-for="(tier, idx) in enrichmentData.tiers" :key="tier.tierLabel + '-actions'">
                        <q-btn
                          v-if="tier.enrichment.llmPct < 100 || tier.enrichment.prosecutionPct < 100"
                          flat
                          dense
                          color="primary"
                          icon="play_arrow"
                          label="Enrich"
                          @click="openEnrichDialog('tier', formatTierRange(idx + 1, selectedTierSize))"
                        />
                        <q-icon v-else name="check_circle" color="positive" size="sm" />
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
          <span class="text-subtitle2">Coverage Scope:</span>
          <q-select
            v-model="selectedTopPerSector"
            :options="topPerSectorOptions"
            emit-value
            map-options
            outlined
            dense
            style="min-width: 180px"
            @update:model-value="loadSectorEnrichment"
          />
          <q-icon name="help_outline" color="grey-6" size="sm" class="cursor-pointer">
            <q-tooltip max-width="400px" class="text-body2" style="white-space: pre-line;">
              {{ sectorScopeTooltip }}
            </q-tooltip>
          </q-icon>
          <q-btn flat icon="refresh" label="Refresh" :loading="sectorEnrichmentLoading" @click="loadSectorEnrichment" />
        </div>

        <div v-if="sectorEnrichmentLoading && !sectorEnrichmentData" class="row justify-center q-pa-xl">
          <q-spinner size="lg" color="primary" />
        </div>

        <q-banner v-else-if="sectorEnrichmentError" class="bg-negative text-white q-mb-md">
          {{ sectorEnrichmentError }}
        </q-banner>

        <template v-else-if="sectorEnrichmentData">
          <q-card flat bordered>
            <q-card-section class="q-pb-none">
              <div class="text-subtitle1">Sector Enrichment Overview</div>
              <div class="text-caption text-grey-7">Click "Enrich" to fill gaps for a super-sector</div>
            </q-card-section>
            <q-card-section>
              <q-table
                :rows="sectorEnrichmentData.sectors"
                :columns="[
                  { name: 'name', label: 'Super-Sector', field: 'name', align: 'left', sortable: true },
                  { name: 'total', label: 'Total', field: 'totalPatents', align: 'right', sortable: true },
                  { name: 'llm', label: 'LLM', field: (row: any) => row.enrichment.llmPct, align: 'center', sortable: true },
                  { name: 'pros', label: 'Prosecution', field: (row: any) => row.enrichment.prosecutionPct, align: 'center', sortable: true },
                  { name: 'ipr', label: 'IPR', field: (row: any) => row.enrichment.iprPct, align: 'center', sortable: true },
                  { name: 'family', label: 'Families', field: (row: any) => row.enrichment.familyPct, align: 'center', sortable: true },
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
                      <q-linear-progress :value="props.row.enrichment.llmPct / 100" :color="coverageColor(props.row.enrichment.llmPct)" size="12px" rounded />
                      <span class="text-caption">{{ props.row.enrichment.llmPct }}%</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-pros="props">
                  <q-td :props="props">
                    <div class="enrichment-cell-small">
                      <q-linear-progress :value="props.row.enrichment.prosecutionPct / 100" :color="coverageColor(props.row.enrichment.prosecutionPct)" size="12px" rounded />
                      <span class="text-caption">{{ props.row.enrichment.prosecutionPct }}%</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-ipr="props">
                  <q-td :props="props">
                    <div class="enrichment-cell-small">
                      <q-linear-progress :value="props.row.enrichment.iprPct / 100" :color="coverageColor(props.row.enrichment.iprPct)" size="12px" rounded />
                      <span class="text-caption">{{ props.row.enrichment.iprPct }}%</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-family="props">
                  <q-td :props="props">
                    <div class="enrichment-cell-small">
                      <q-linear-progress :value="props.row.enrichment.familyPct / 100" :color="coverageColor(props.row.enrichment.familyPct)" size="12px" rounded />
                      <span class="text-caption">{{ props.row.enrichment.familyPct }}%</span>
                    </div>
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
                      @click="openEnrichDialog('super-sector', props.row.name, selectedTopPerSector)"
                    />
                    <q-icon v-else name="check_circle" color="positive" size="sm" />
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
              <div class="text-grey-6">Completed</div>
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
        <q-card flat bordered v-if="batchJobsData">
          <q-list separator>
            <template v-for="item in groupedJobs" :key="item.groupId || item.job?.id">
              <!-- Group Header -->
              <q-item v-if="item.isGroup" class="bg-grey-2">
                <q-item-section avatar>
                  <q-badge :color="getStatusColor(getGroupStatus(item.jobs))">
                    {{ getGroupStatus(item.jobs) }}
                  </q-badge>
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-medium">
                    {{ item.jobs[0]?.targetType === 'tier' ? formatJobTarget(item.jobs[0]) : `${item.jobs[0]?.targetType}: ${item.jobs[0]?.targetValue}` }}
                  </q-item-label>
                  <q-item-label caption>
                    {{ item.jobs.length }} jobs | Started {{ formatDate(item.jobs[0]?.startedAt) }}
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    v-if="getGroupStatus(item.jobs) === 'running'"
                    flat
                    dense
                    icon="stop"
                    color="negative"
                    @click="cancelJobGroup(item.groupId!)"
                  >
                    <q-tooltip>Cancel All</q-tooltip>
                  </q-btn>
                </q-item-section>
              </q-item>

              <!-- Individual Jobs (within group or standalone) -->
              <q-item
                v-for="job in (item.isGroup ? item.jobs : [item.job!])"
                :key="job.id"
                :class="item.isGroup ? 'q-pl-xl' : ''"
              >
                <q-item-section avatar>
                  <q-chip dense :color="getCoverageColor(job.coverageType)" text-color="white" size="sm">
                    {{ job.coverageType }}
                  </q-chip>
                </q-item-section>
                <q-item-section>
                  <q-item-label>
                    <q-badge :color="getStatusColor(job.status)" class="q-mr-sm">
                      {{ job.status }}
                    </q-badge>
                    <q-spinner v-if="job.status === 'running'" size="xs" color="blue" class="q-ml-xs" />
                    <span v-if="!item.isGroup" class="text-grey-7">
                      {{ job.targetType === 'tier' ? formatJobTarget(job) : `${job.targetType}: ${job.targetValue}` }}
                    </span>
                  </q-item-label>
                  <q-item-label caption>
                    <span v-if="job.progress">{{ job.progress.total.toLocaleString() }} patents</span>
                    <span v-if="job.estimatedRate" class="q-ml-sm">| Est: {{ job.estimatedRate }}/hr</span>
                    <span v-if="job.actualRate" class="q-ml-sm">| Actual: {{ job.actualRate }}/hr</span>
                    <span v-if="job.status === 'running' && job.estimatedCompletion" class="q-ml-sm">
                      | ETA: {{ formatETA(job.estimatedCompletion) }}
                    </span>
                    <span v-if="job.completedAt" class="q-ml-sm">
                      | Duration: {{ formatDuration(job.startedAt, job.completedAt) }}
                    </span>
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <div class="row q-gutter-xs">
                    <q-btn flat dense icon="article" color="grey" @click="viewJobLog(job.id)">
                      <q-tooltip>View Log</q-tooltip>
                    </q-btn>
                    <q-btn
                      v-if="job.status === 'running'"
                      flat
                      dense
                      icon="stop"
                      color="negative"
                      @click="cancelJob(job.id)"
                    >
                      <q-tooltip>Cancel</q-tooltip>
                    </q-btn>
                  </div>
                </q-item-section>
              </q-item>
            </template>

            <q-item v-if="groupedJobs.length === 0">
              <q-item-section class="text-center text-grey q-pa-xl">
                <q-icon size="2em" name="inbox" class="q-mb-sm" />
                No batch jobs found
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </q-tab-panel>
    </q-tab-panels>

    <!-- ═══ New Job Dialog ═══ -->
    <q-dialog v-model="showNewJobDialog">
      <q-card style="min-width: 450px">
        <q-card-section>
          <div class="text-h6">Start Enrichment Jobs</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-select
            v-model="newJobTargetType"
            :options="targetTypeOptions"
            emit-value
            map-options
            label="Target Type"
            outlined
          />

          <q-input
            v-if="newJobTargetType === 'tier'"
            v-model="newJobTargetValue"
            label="Top N Patents"
            outlined
            type="number"
            hint="e.g., 6000 for top 6000 patents"
          />

          <q-select
            v-else
            v-model="newJobTargetValue"
            :options="superSectorOptions"
            label="Super-Sector"
            outlined
          />

          <div>
            <div class="text-subtitle2 q-mb-sm">Coverage Types</div>
            <div class="row q-gutter-sm">
              <q-checkbox
                v-for="opt in coverageTypeOptions"
                :key="opt.value"
                v-model="newJobCoverageTypes"
                :val="opt.value"
                :label="opt.label"
                :color="opt.color"
              />
            </div>
          </div>

          <!-- Gap Preview -->
          <q-card v-if="gapsData" flat bordered class="q-mt-md">
            <q-card-section class="q-pa-sm">
              <div class="text-caption text-grey-7 q-mb-sm">Gaps to fill:</div>
              <div class="row q-gutter-sm">
                <q-chip v-for="(info, type) in gapsData.gaps" :key="type" dense :color="info.gap > 0 ? 'orange' : 'positive'" text-color="white">
                  {{ type }}: {{ info.gap.toLocaleString() }}
                </q-chip>
              </div>
            </q-card-section>
          </q-card>
          <div v-else-if="loadingGaps" class="text-center">
            <q-spinner size="sm" /> Loading gaps...
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Start Jobs"
            :loading="startingJob"
            :disable="newJobCoverageTypes.length === 0"
            @click="startNewJob"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- ═══ Contextual Enrich Dialog ═══ -->
    <q-dialog v-model="showEnrichDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Enrich: {{ enrichDialogTargetType }} "{{ enrichDialogTargetValue }}"</div>
        </q-card-section>

        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">Select Coverage Types</div>
          <div class="column q-gutter-sm">
            <q-checkbox
              v-for="opt in coverageTypeOptions"
              :key="opt.value"
              v-model="enrichDialogCoverageTypes"
              :val="opt.value"
              :color="opt.color"
            >
              <span>{{ opt.label }}</span>
              <span v-if="enrichDialogGaps" class="text-grey-6 q-ml-sm">
                ({{ enrichDialogGaps.gaps[opt.value]?.gap.toLocaleString() || 0 }} gaps)
              </span>
            </q-checkbox>
          </div>

          <div v-if="enrichDialogLoading" class="text-center q-mt-md">
            <q-spinner size="sm" /> Analyzing gaps...
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Start Enrichment"
            :loading="enrichDialogStarting"
            :disable="enrichDialogCoverageTypes.length === 0"
            @click="startEnrichFromDialog"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- ═══ Log Viewer Dialog ═══ -->
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
.tier-table-scroll { overflow-x: auto; }
.tier-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.tier-table th, .tier-table td { padding: 8px 12px; text-align: center; border-bottom: 1px solid #e0e0e0; white-space: nowrap; }
.tier-table th { background: #f5f5f5; font-weight: 600; }
.tier-table .metric-col { text-align: left; min-width: 120px; position: sticky; left: 0; background: #fff; z-index: 1; }
.tier-table th.metric-col { background: #f5f5f5; z-index: 2; }
.tier-table tr.section-separator td { border-top: 2px solid #bdbdbd; }
.enrichment-cell { min-width: 100px; }
.enrichment-cell-small { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 70px; }
.log-viewer { background: #1e1e1e; color: #d4d4d4; font-family: 'Fira Code', monospace; font-size: 12px; max-height: calc(100vh - 100px); overflow: auto; }
.log-viewer pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
</style>
