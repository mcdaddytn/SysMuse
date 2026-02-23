<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed } from 'vue';
import { Notify } from 'quasar';
import PortfolioSelector from '@/components/PortfolioSelector.vue';
import { usePortfolioStore } from '@/stores/portfolio';
import { useSuperSectors } from '@/composables/useSuperSectors';
import {
  patentApi, enrichmentApi, batchJobsApi, portfolioApi, scoringTemplatesApi, snapshotApi, quarantineApi,
  type EnrichmentSummary, type SectorEnrichmentSummary,
  type BatchJob, type BatchJobSettings, type BatchJobsResponse, type CoverageType, type TargetType, type GapsResponse,
  type BatchJobMetadata, type HydrationResult, type ScoreSnapshot,
  type QuarantineSummary, type QuarantineGroup
} from '@/services/api';

const portfolioStore = usePortfolioStore();
const { superSectorOptions } = useSuperSectors();

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

async function loadEnrichmentSummary(forceRefresh = false) {
  enrichmentLoading.value = true;
  enrichmentError.value = null;
  try {
    enrichmentData.value = await patentApi.getEnrichmentSummary(selectedTierSize.value, portfolioStore.selectedPortfolioId, forceRefresh);
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
  loadSectorEnrichment();
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

async function loadSectorEnrichment(forceRefresh = false) {
  sectorEnrichmentLoading.value = true;
  sectorEnrichmentError.value = null;
  try {
    sectorEnrichmentData.value = await enrichmentApi.getSectorEnrichment(selectedTopPerSector.value, portfolioStore.selectedPortfolioId, forceRefresh);
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

// ─── Active Job Indicators ───────────────────────────────────────────────────
const activeJobsByTier = computed(() => {
  const map = new Map<number, BatchJob[]>();
  if (!batchJobsData.value || !enrichmentData.value) return map;
  const tierSize = selectedTierSize.value;
  const numTiers = enrichmentData.value.tiers.length;
  const selectedPid = portfolioStore.selectedPortfolioId;
  for (const job of batchJobsData.value.jobs) {
    if (job.targetType !== 'tier') continue;
    if (job.status !== 'running' && job.status !== 'pending') continue;
    if (selectedPid && job.portfolioId !== selectedPid) continue;
    const jobRange = parseRange(job.targetValue);
    if (!jobRange) continue;
    for (let i = 0; i < numTiers; i++) {
      const tierStart = i * tierSize + 1;
      const tierEnd = (i + 1) * tierSize;
      if (jobRange.start <= tierEnd && tierStart <= jobRange.end) {
        if (!map.has(i)) map.set(i, []);
        map.get(i)!.push(job);
      }
    }
  }
  return map;
});
const hasActiveJobs = computed(() => activeJobsByTier.value.size > 0);

// Aggregate active job progress by coverage type (for summary cards)
const activeJobsByCoverage = computed(() => {
  const map = new Map<string, { total: number; completed: number; jobCount: number }>();
  if (!batchJobsData.value) return map;
  const selectedPid = portfolioStore.selectedPortfolioId;
  for (const job of batchJobsData.value.jobs) {
    if (job.status !== 'running' && job.status !== 'pending') continue;
    if (selectedPid && job.portfolioId !== selectedPid) continue;
    const existing = map.get(job.coverageType) || { total: 0, completed: 0, jobCount: 0 };
    existing.jobCount++;
    if (job.progress) {
      existing.total += job.progress.total;
      existing.completed += job.progress.completed;
    }
    map.set(job.coverageType, existing);
  }
  return map;
});

// Aggregate active job progress by super-sector name (for sector enrichment tab)
const activeJobsBySuperSector = computed(() => {
  const map = new Map<string, Map<string, { total: number; completed: number; jobCount: number }>>();
  if (!batchJobsData.value) return map;
  const selectedPid = portfolioStore.selectedPortfolioId;
  for (const job of batchJobsData.value.jobs) {
    if (job.status !== 'running' && job.status !== 'pending') continue;
    if (selectedPid && job.portfolioId !== selectedPid) continue;
    if (job.targetType !== 'super-sector') continue;
    const sectorName = job.targetValue;
    if (!map.has(sectorName)) map.set(sectorName, new Map());
    const sectorMap = map.get(sectorName)!;
    const existing = sectorMap.get(job.coverageType) || { total: 0, completed: 0, jobCount: 0 };
    existing.jobCount++;
    if (job.progress) {
      existing.total += job.progress.total;
      existing.completed += job.progress.completed;
    }
    sectorMap.set(job.coverageType, existing);
  }
  return map;
});

// ─── Start Job Dialog ────────────────────────────────────────────────────────
const showNewJobDialog = ref(false);
const newJobTargetType = ref<TargetType>('tier');
const newJobTargetValue = ref('6000');
const newJobCoverageTypes = ref<CoverageType[]>(['llm', 'prosecution', 'ipr', 'family', 'xml']);
const newJobMaxHours = ref(4);
// Claims are always included in LLM scoring (independent claims by default)
const newJobModel = ref<string | null>(null);
const newJobBatchMode = ref(true);
const startingJob = ref(false);
const gapsData = ref<GapsResponse | null>(null);
const loadingGaps = ref(false);

// Advanced settings (shared between New Job and Enrich dialogs — only one open at a time)
const showAdvanced = ref(false);
const advancedSettings = ref<BatchJobSettings>({
  llmConcurrency: 3,
  llmMaxRetries: 3,
  llmRetryBaseDelay: 5000,
  llmInterBatchDelay: 500,
  apiRateLimit: 60,
  apiRetryAttempts: 3,
  apiRetryDelay: 1000,
  batchSize: 500,
});

function resetAdvancedSettings() {
  showAdvanced.value = false;
  advancedSettings.value = {
    llmConcurrency: 3, llmMaxRetries: 3, llmRetryBaseDelay: 5000, llmInterBatchDelay: 500,
    apiRateLimit: 60, apiRetryAttempts: 3, apiRetryDelay: 1000, batchSize: 500,
  };
}

// Duplicate job warning
const showDuplicateWarning = ref(false);
const duplicateJobs = ref<BatchJob[]>([]);
const pendingSubmitFn = ref<(() => Promise<void>) | null>(null);

const llmModelOptions = [
  { value: null, label: 'Sonnet 4 (default)', hint: 'Best balance of quality and cost' },
  { value: 'claude-opus-4-20250115', label: 'Opus 4', hint: '6x more expensive, highest quality' },
  { value: 'claude-haiku-3-5-sonnet-20241022', label: 'Haiku 3.5', hint: 'Fastest, cheapest' },
];

// (Claims gate handled via soft-skip on backend — no dialog needed)

const targetTypeOptions = [
  { value: 'tier', label: 'Tier (Top N patents)' },
  { value: 'super-sector', label: 'Super-Sector' },
  { value: 'sector', label: 'Sector' }
];

const coverageTypeOptions: Array<{ value: CoverageType; label: string; color: string }> = [
  { value: 'llm', label: 'LLM Analysis', color: 'blue' },
  { value: 'prosecution', label: 'Prosecution History', color: 'purple' },
  { value: 'ipr', label: 'IPR / PTAB', color: 'orange' },
  { value: 'family', label: 'Patent Families', color: 'teal' },
  { value: 'xml', label: 'USPTO Bulk Data', color: 'positive' }
];

// Load gaps when dialog opens or target changes
async function loadGaps() {
  if (!newJobTargetValue.value) return;
  loadingGaps.value = true;
  try {
    gapsData.value = await batchJobsApi.getGaps(newJobTargetType.value, newJobTargetValue.value, undefined, portfolioStore.selectedPortfolioId);
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
    resetAdvancedSettings();
    loadGaps();
  }
});

async function startNewJob() {
  if (checkDuplicatesAndSubmit(newJobTargetType.value, newJobTargetValue.value, newJobCoverageTypes.value, doStartNewJob)) return;
  await doStartNewJob();
}

async function doStartNewJob() {
  startingJob.value = true;
  try {
    const result = await batchJobsApi.startJobs({
      targetType: newJobTargetType.value,
      targetValue: newJobTargetValue.value,
      coverageTypes: newJobCoverageTypes.value,
      maxHours: newJobMaxHours.value,
      portfolioId: portfolioStore.selectedPortfolioId,
      ...(newJobModel.value ? { model: newJobModel.value } : {}),
      ...(newJobCoverageTypes.value.includes('llm') ? { batchMode: newJobBatchMode.value } : {}),
      ...(showAdvanced.value ? { settings: advancedSettings.value } : {}),
    }) as any;
    showNewJobDialog.value = false;
    await loadBatchJobs();
    // Check if LLM was deferred (no XML data available yet)
    if (result?.llmDeferred) {
      Notify.create({
        type: 'warning',
        message: `LLM scoring deferred — ${result.llmDeferredCount} patents awaiting XML extraction`,
        caption: 'Resubmit LLM after XML extraction completes',
        timeout: 6000,
      });
    }
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string; message?: string } } };
    Notify.create({
      type: 'negative',
      message: error.response?.data?.message || error.response?.data?.error || 'Failed to start jobs',
      timeout: 5000,
    });
  } finally {
    startingJob.value = false;
  }
}

// ─── Contextual Enrich Dialogs ───────────────────────────────────────────────
const showEnrichDialog = ref(false);
const enrichDialogTargetType = ref<TargetType>('tier');
const enrichDialogTargetValue = ref('');
const enrichDialogTopN = ref<number>(0);  // 0 = all patents in sector
const enrichDialogCoverageTypes = ref<CoverageType[]>(['llm', 'prosecution', 'ipr', 'family', 'xml']);
const enrichDialogGaps = ref<GapsResponse | null>(null);
const enrichDialogLoading = ref(false);
const enrichDialogStarting = ref(false);
const enrichDialogModel = ref<string | null>(null);
const enrichDialogBatchMode = ref(true);

async function openEnrichDialog(targetType: TargetType, targetValue: string, topN: number = 0) {
  enrichDialogTargetType.value = targetType;
  enrichDialogTargetValue.value = targetValue;
  enrichDialogTopN.value = topN;
  enrichDialogCoverageTypes.value = ['llm', 'prosecution', 'ipr', 'family', 'xml'];
  enrichDialogGaps.value = null;
  enrichDialogModel.value = null;
  enrichDialogBatchMode.value = true;
  resetAdvancedSettings();
  showEnrichDialog.value = true;

  // Load gaps (pass topN for super-sector/sector to limit to top N patents)
  enrichDialogLoading.value = true;
  try {
    enrichDialogGaps.value = await batchJobsApi.getGaps(targetType, targetValue, topN > 0 ? topN : undefined, portfolioStore.selectedPortfolioId);
    // Auto-select only types that have gaps (pre-check types with work to do)
    if (enrichDialogGaps.value?.gaps) {
      const typesWithGaps = coverageTypeOptions
        .map(o => o.value)
        .filter(t => (enrichDialogGaps.value!.gaps[t]?.gap ?? 0) > 0);
      enrichDialogCoverageTypes.value = typesWithGaps.length > 0 ? typesWithGaps : [];
    }
  } catch (err) {
    console.error('Failed to load gaps:', err);
  } finally {
    enrichDialogLoading.value = false;
  }
}

async function startEnrichFromDialog() {
  if (checkDuplicatesAndSubmit(enrichDialogTargetType.value, enrichDialogTargetValue.value, enrichDialogCoverageTypes.value, doStartEnrichFromDialog)) return;
  await doStartEnrichFromDialog();
}

async function doStartEnrichFromDialog() {
  enrichDialogStarting.value = true;
  try {
    const result = await batchJobsApi.startJobs({
      targetType: enrichDialogTargetType.value,
      targetValue: enrichDialogTargetValue.value,
      coverageTypes: enrichDialogCoverageTypes.value,
      maxHours: 4,
      topN: enrichDialogTopN.value > 0 ? enrichDialogTopN.value : undefined,
      portfolioId: portfolioStore.selectedPortfolioId,
      ...(enrichDialogModel.value ? { model: enrichDialogModel.value } : {}),
      ...(enrichDialogCoverageTypes.value.includes('llm') ? { batchMode: enrichDialogBatchMode.value } : {}),
      ...(showAdvanced.value ? { settings: advancedSettings.value } : {}),
    }) as any;
    showEnrichDialog.value = false;
    activeTab.value = 'jobs';
    await loadBatchJobs();
    if (result?.llmDeferred) {
      Notify.create({
        type: 'warning',
        message: `LLM scoring deferred — ${result.llmDeferredCount} patents awaiting XML extraction`,
        caption: 'Resubmit LLM after XML extraction completes',
        timeout: 6000,
      });
    }
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string; message?: string } } };
    Notify.create({
      type: 'negative',
      message: error.response?.data?.message || error.response?.data?.error || 'Failed to start enrichment',
      timeout: 5000,
    });
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

// Get aggregated active job progress for a (tierIndex, coverageType) pair
function tierActiveProgress(tierIdx: number, coverageType: string): { completed: number; total: number } | null {
  const jobs = activeJobsByTier.value.get(tierIdx)?.filter(j => j.coverageType === coverageType);
  if (!jobs?.length) return null;
  let completed = 0, total = 0;
  for (const j of jobs) {
    if (j.progress) { completed += j.progress.completed; total += j.progress.total; }
  }
  return total > 0 ? { completed, total } : null;
}

// Get quarantine-adjusted denominator for a coverage type
function quarantineAdjustedTotal(total: number, key: string, quarantineCounts?: { total: number; xml: number; llm?: number }): number {
  if (key === 'xml') return (total - (quarantineCounts?.xml || 0)) || 1;
  if (key === 'llm') return (total - (quarantineCounts?.llm || 0)) || 1;
  return total;
}

// Blend DB enrichment count with active job progress to get effective bar value (0-1)
function effectiveBarValue(dbCount: number, patentTotal: number, active: { completed: number; total: number } | null): number {
  if (!active || patentTotal <= 0) return patentTotal > 0 ? dbCount / patentTotal : 0;
  return Math.min(1, (dbCount + active.completed) / patentTotal);
}

// Same but as a display percentage
function effectiveBarPct(dbCount: number, patentTotal: number, active: { completed: number; total: number } | null): number {
  return Math.round(effectiveBarValue(dbCount, patentTotal, active) * 1000) / 10;
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

// Format tier range as raw string for backend use (e.g., tierIndex=4, tierSize=1000 → "3001-4000")
function formatTierRange(tierIndex: number, tierSize: number): string {
  const end = tierIndex * tierSize;
  const start = end - tierSize + 1;
  return `${start}-${end}`;
}

// Format job target for display
function formatJobTarget(job: BatchJob): string {
  if (job.targetType === 'tier') {
    // targetValue could be "5000" (legacy), "4001-5000", or "4,001-5,000" (old locale format)
    const val = job.targetValue.replace(/,/g, '').replace(/\s*\(\d+\/\d+\)/, '');
    if (val.includes('-')) {
      return `Tier ${val.split('-').map(n => parseInt(n).toLocaleString()).join('-')}`;
    }
    // Legacy format: just show "Top N"
    return `Top ${parseInt(val).toLocaleString()}`;
  }
  return job.targetValue;
}

function getChunkLabel(job: BatchJob): string | null {
  const match = job.targetValue.match(/\((\d+\/\d+)\)/);
  return match ? match[1] : null;
}

function getCoverageColor(type: CoverageType): string {
  const opt = coverageTypeOptions.find(o => o.value === type);
  return opt?.color || 'grey';
}

function formatCoverageLabel(type: CoverageType): string {
  return type === 'xml' ? 'Bulk' : type;
}

function parseRange(val: string): { start: number; end: number } | null {
  const clean = val.replace(/,/g, '').replace(/\s*\(\d+\/\d+\)/, '');
  if (!clean.includes('-')) return null;
  const [s, e] = clean.split('-').map(n => parseInt(n));
  return isNaN(s) || isNaN(e) ? null : { start: s, end: e };
}

function findOverlappingJobs(targetType: TargetType, targetValue: string, coverageTypes: CoverageType[]): BatchJob[] {
  if (!batchJobsData.value) return [];
  const selectedPid = portfolioStore.selectedPortfolioId;
  return batchJobsData.value.jobs.filter(job => {
    if (job.status !== 'running' && job.status !== 'pending') return false;
    if (job.targetType !== targetType) return false;
    if (!coverageTypes.includes(job.coverageType)) return false;
    if (selectedPid && job.portfolioId !== selectedPid) return false;
    if (targetType === 'tier') {
      const jobRange = parseRange(job.targetValue);
      const newRange = parseRange(targetValue);
      if (!jobRange || !newRange) return job.targetValue.replace(/,/g, '') === targetValue.replace(/,/g, '');
      return jobRange.start <= newRange.end && newRange.start <= jobRange.end;
    }
    return job.targetValue === targetValue;
  });
}

function checkDuplicatesAndSubmit(
  targetType: TargetType, targetValue: string, coverageTypes: CoverageType[],
  submitFn: () => Promise<void>
): boolean {
  const overlapping = findOverlappingJobs(targetType, targetValue, coverageTypes);
  if (overlapping.length > 0) {
    duplicateJobs.value = overlapping;
    pendingSubmitFn.value = submitFn;
    showDuplicateWarning.value = true;
    return true;
  }
  return false;
}

function confirmDuplicateSubmit() {
  showDuplicateWarning.value = false;
  if (pendingSubmitFn.value) {
    pendingSubmitFn.value();
    pendingSubmitFn.value = null;
  }
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

function getGroupCoverageTypes(jobs: BatchJob[]): CoverageType[] {
  return [...new Set(jobs.map(j => j.coverageType))];
}

function getGroupLlmInfo(jobs: BatchJob[]): string | null {
  const llmJob = jobs.find(j => j.coverageType === 'llm');
  if (!llmJob) return null;
  const parts: string[] = [];
  if (llmJob.model) parts.push(llmModelLabel(llmJob.model));
  if (llmJob.batchMode === false) parts.push('realtime');
  // Claims are always included now
  return parts.length > 0 ? parts.join(', ') : null;
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

// ─── LLM Batch Scoring ──────────────────────────────────────────────────────
const llmBatchJobs = ref<BatchJobMetadata[]>([]);
const llmBatchLoading = ref(false);
const llmBatchError = ref<string | null>(null);
const llmBatchProcessingId = ref<string | null>(null);
const llmBatchCancellingId = ref<string | null>(null);
let llmBatchPollInterval: ReturnType<typeof setInterval> | null = null;

async function loadLlmBatchJobs() {
  llmBatchLoading.value = true;
  llmBatchError.value = null;
  try {
    const result = await scoringTemplatesApi.refreshAllBatchStatuses();
    llmBatchJobs.value = result.jobs;
  } catch (err) {
    llmBatchError.value = err instanceof Error ? err.message : 'Failed to load LLM batch jobs';
  } finally {
    llmBatchLoading.value = false;
  }
}

async function processLlmBatchResults(batchId: string) {
  llmBatchProcessingId.value = batchId;
  try {
    await scoringTemplatesApi.processBatchResults(batchId);
    await loadLlmBatchJobs();
  } catch (err) {
    console.error('Failed to process batch results:', err);
  } finally {
    llmBatchProcessingId.value = null;
  }
}

async function cancelLlmBatch(batchId: string) {
  if (!confirm('Cancel this LLM batch job?')) return;
  llmBatchCancellingId.value = batchId;
  try {
    await scoringTemplatesApi.cancelBatch(batchId);
    await loadLlmBatchJobs();
  } catch (err) {
    console.error('Failed to cancel batch:', err);
  } finally {
    llmBatchCancellingId.value = null;
  }
}

function startLlmBatchPoll() {
  stopLlmBatchPoll();
  llmBatchPollInterval = setInterval(() => {
    const hasActive = llmBatchJobs.value.some(j => j.status === 'submitted' || j.status === 'in_progress');
    if (hasActive) {
      loadLlmBatchJobs();
    }
  }, 30000);
}

function stopLlmBatchPoll() {
  if (llmBatchPollInterval) {
    clearInterval(llmBatchPollInterval);
    llmBatchPollInterval = null;
  }
}

function llmBatchStatusColor(status: string): string {
  switch (status) {
    case 'submitted': return 'blue-grey';
    case 'in_progress': return 'blue';
    case 'ended': return 'positive';
    case 'failed': return 'negative';
    default: return 'grey';
  }
}

function truncateBatchId(batchId: string): string {
  return batchId.length > 16 ? batchId.slice(0, 16) + '...' : batchId;
}

function llmModelLabel(model: string): string {
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  return model;
}

// ─── Auto-Snapshots ──────────────────────────────────────────────────────────
const showAutoSnapshots = ref(false);
const autoSnapshots = ref<ScoreSnapshot[]>([]);
const autoSnapshotsLoading = ref(false);

async function loadAutoSnapshots() {
  autoSnapshotsLoading.value = true;
  try {
    const all = await snapshotApi.list(portfolioStore.selectedPortfolioId);
    autoSnapshots.value = all.filter(s =>
      (s.config as Record<string, unknown>)?.autoGenerated === true
    );
  } catch (err) {
    console.error('Failed to load auto-snapshots:', err);
  } finally {
    autoSnapshotsLoading.value = false;
  }
}

async function activateSnapshot(snapshotId: string) {
  try {
    await snapshotApi.activate(snapshotId);
    await loadAutoSnapshots();
  } catch (err) {
    console.error('Failed to activate snapshot:', err);
  }
}

function isLlmBatchProcessable(job: BatchJobMetadata): boolean {
  return job.status === 'ended' && job.results.succeeded > 0 && !job.results.processed;
}

function isLlmBatchActive(job: BatchJobMetadata): boolean {
  return job.status === 'submitted' || job.status === 'in_progress';
}

function formatLlmDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

// ─── Portfolio Info Bar (Hydrate / Import) ────────────────────────────────────
const portfolioPatentCount = ref(0);
const portfolioBareCount = ref(0);
const portfolioInfoLoading = ref(false);
const hydrating = ref(false);
const hydrationResult = ref<HydrationResult | null>(null);
const importing = ref(false);
const importResult = ref<{ imported: number; totalInPortfolio: number } | null>(null);
const showImportDialog = ref(false);
const importMaxPatents = ref(1000);
const importMaxOptions = [
  { value: 500, label: '500' },
  { value: 1000, label: '1,000' },
  { value: 2000, label: '2,000' },
  { value: 3000, label: '3,000' },
  { value: 4000, label: '4,000' },
  { value: 5000, label: '5,000' },
  { value: 7500, label: '7,500' },
  { value: 10000, label: '10,000' },
  { value: 0, label: 'All' },
];

async function loadPortfolioInfo() {
  const pid = portfolioStore.selectedPortfolioId;
  if (!pid) {
    portfolioPatentCount.value = 0;
    portfolioBareCount.value = 0;
    return;
  }
  portfolioInfoLoading.value = true;
  try {
    // Get patent count from portfolio detail
    const detail = await portfolioApi.get(pid);
    portfolioPatentCount.value = detail._count?.patents ?? 0;

    // Get bare patent count: patents in this portfolio with empty title
    const result = await patentApi.getPatents(
      { page: 1, rowsPerPage: 1, sortBy: 'score', descending: true },
      { title: '' },
      pid,
    );
    // This is approximate — we use the total that have empty title filter
    // Actually, let's just use the hydration endpoint info after first run
    portfolioBareCount.value = 0; // Will be calculated server-side during hydrate
  } catch (err) {
    console.error('Failed to load portfolio info:', err);
  } finally {
    portfolioInfoLoading.value = false;
  }
}

async function doHydrate() {
  const pid = portfolioStore.selectedPortfolioId;
  if (!pid) return;
  hydrating.value = true;
  hydrationResult.value = null;
  try {
    hydrationResult.value = await portfolioApi.hydratePatents(pid);
    // Reload enrichment data after hydration
    loadEnrichmentSummary();
    loadSectorEnrichment();
    loadPortfolioInfo();
  } catch (err) {
    console.error('Hydration failed:', err);
  } finally {
    hydrating.value = false;
  }
}

async function doImport() {
  const pid = portfolioStore.selectedPortfolioId;
  if (!pid) return;
  showImportDialog.value = false;
  importing.value = true;
  importResult.value = null;
  try {
    const result = await portfolioApi.importPatents(pid, { maxPatents: importMaxPatents.value || undefined });
    importResult.value = { imported: result.imported, totalInPortfolio: result.totalInPortfolio };
    // Reload everything after import
    loadEnrichmentSummary();
    loadSectorEnrichment();
    loadPortfolioInfo();
  } catch (err) {
    console.error('Import failed:', err);
  } finally {
    importing.value = false;
  }
}

// ─── Watch portfolio selection ────────────────────────────────────────────────
watch(() => portfolioStore.selectedPortfolioId, () => {
  hydrationResult.value = null;
  importResult.value = null;
  loadEnrichmentSummary();
  loadSectorEnrichment();
  loadPortfolioInfo();
  if (activeTab.value === 'quarantine') {
    quarantineDryRunResult.value = null;
    loadQuarantineSummary();
  }
});

// ─── Quarantine Tab ──────────────────────────────────────────────────────────
const quarantineData = ref<QuarantineSummary | null>(null);
const quarantineLoading = ref(false);
const quarantineError = ref<string | null>(null);
const quarantineAutoLoading = ref(false);
const quarantineDryRunLoading = ref(false);
const quarantineDryRunResult = ref<any>(null);

const quarantineColumns = [
  { name: 'patentId', label: 'Patent ID', field: 'patentId', align: 'left' as const, sortable: true },
  { name: 'title', label: 'Title', field: 'title', align: 'left' as const, sortable: true },
  { name: 'grantDate', label: 'Grant Date', field: 'grantDate', align: 'center' as const, sortable: true },
  { name: 'assignee', label: 'Assignee', field: 'assignee', align: 'left' as const, sortable: true },
  { name: 'actions', label: '', field: 'patentId', align: 'center' as const },
];

const QUARANTINE_REASON_META: Record<string, { label: string; icon: string; color: string; retryable: boolean; remedy: string }> = {
  'design-patent': { label: 'Design Patent', icon: 'brush', color: 'blue-grey', retryable: false, remedy: 'Design patents have no claims text' },
  'reissue-patent': { label: 'Reissue Patent', icon: 'replay', color: 'blue-grey', retryable: false, remedy: 'Reissue patents not in bulk XML' },
  'pre-2005': { label: 'Pre-2005 Grant', icon: 'history', color: 'blue-grey', retryable: false, remedy: 'No bulk XML available for pre-2005 patents' },
  'recent-no-bulk': { label: 'Recent — No Bulk Data', icon: 'schedule', color: 'orange', retryable: true, remedy: 'Bulk XML not yet published — check back after next USPTO release' },
  'extraction-failed': { label: 'USPTO Bulk Extraction Failed', icon: 'error_outline', color: 'red', retryable: true, remedy: 'Re-run XML extraction or check bulk ZIP coverage' },
  'no-abstract': { label: 'No Abstract', icon: 'description', color: 'amber', retryable: true, remedy: 'Run Hydrate on the portfolio to fetch abstract from PatentsView' },
  'no-sector': { label: 'No Sector Assigned', icon: 'category', color: 'amber', retryable: true, remedy: 'Run Sector Assignment on the portfolio' },
  'manual': { label: 'Manually Quarantined', icon: 'person', color: 'grey', retryable: false, remedy: 'Manually quarantined by user' },
};

function getQuarantineLabel(reason: string): string {
  return QUARANTINE_REASON_META[reason]?.label || reason;
}
function getQuarantineIcon(reason: string): string {
  return QUARANTINE_REASON_META[reason]?.icon || 'shield';
}
function getQuarantineColor(reason: string): string {
  return QUARANTINE_REASON_META[reason]?.color || 'grey';
}
function isRetryable(reason: string): boolean {
  return QUARANTINE_REASON_META[reason]?.retryable || false;
}
function getQuarantineRemedy(reason: string): string {
  return QUARANTINE_REASON_META[reason]?.remedy || '';
}

async function loadQuarantineSummary() {
  quarantineLoading.value = true;
  quarantineError.value = null;
  try {
    quarantineData.value = await quarantineApi.getSummary(portfolioStore.selectedPortfolioId);
  } catch (err) {
    quarantineError.value = err instanceof Error ? err.message : 'Failed to load quarantine summary';
  } finally {
    quarantineLoading.value = false;
  }
}

async function runAutoQuarantine(dryRun: boolean) {
  if (dryRun) {
    quarantineDryRunLoading.value = true;
  } else {
    quarantineAutoLoading.value = true;
  }
  try {
    const result = await batchJobsApi.autoQuarantine(portfolioStore.selectedPortfolioId, dryRun);
    if (dryRun) {
      quarantineDryRunResult.value = result;
    } else {
      quarantineDryRunResult.value = null;
      await loadQuarantineSummary();
    }
  } catch (err) {
    quarantineError.value = err instanceof Error ? err.message : 'Auto-quarantine failed';
  } finally {
    quarantineAutoLoading.value = false;
    quarantineDryRunLoading.value = false;
  }
}

async function unquarantinePatent(patentId: string, coverageType: string) {
  try {
    await quarantineApi.unquarantine(patentId, coverageType);
    await loadQuarantineSummary();
  } catch (err) {
    console.error('Failed to unquarantine:', err);
  }
}

async function bulkUnquarantine(group: QuarantineGroup) {
  try {
    const patentIds = group.patents.map(p => p.patentId);
    await quarantineApi.bulkQuarantine(patentIds, group.coverageType, group.reason, 'unquarantine');
    await loadQuarantineSummary();
  } catch (err) {
    console.error('Failed to bulk unquarantine:', err);
  }
}

// Watch for tab changes to refresh data
watch(activeTab, (newTab) => {
  if (newTab === 'sectors') {
    loadSectorEnrichment(true);
  } else if (newTab === 'enrichment') {
    loadEnrichmentSummary(true);
  } else if (newTab === 'jobs') {
    loadBatchJobs();
  } else if (newTab === 'llm-batch') {
    loadLlmBatchJobs();
    loadAutoSnapshots();
    startLlmBatchPoll();
  } else if (newTab === 'quarantine') {
    loadQuarantineSummary();
  }
  // Stop LLM polling when leaving the tab
  if (newTab !== 'llm-batch') {
    stopLlmBatchPoll();
  }
});

// Lifecycle
onMounted(() => {
  loadEnrichmentSummary();
  loadSectorEnrichment();
  loadBatchJobs();
  loadPortfolioInfo();

  // Auto-refresh every 15 seconds based on active tab
  // Force refresh enrichment data when there are active jobs (to pick up recently synced flags)
  jobsRefreshInterval = setInterval(() => {
    const forceSync = hasActiveJobs.value;
    if (activeTab.value === 'jobs') {
      loadBatchJobs();
    } else if (activeTab.value === 'sectors') {
      loadSectorEnrichment(forceSync);
    } else if (activeTab.value === 'enrichment') {
      loadEnrichmentSummary(forceSync);
      loadBatchJobs();
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
  stopLlmBatchPoll();
});
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5 q-mr-md">Jobs &amp; Enrichment</div>
      <PortfolioSelector class="q-mr-md" />
    </div>

    <!-- Portfolio Actions Bar -->
    <q-card v-if="portfolioStore.selectedPortfolio" flat bordered class="q-mb-md">
      <q-card-section class="q-py-sm">
        <div class="row items-center q-gutter-md">
          <span class="text-weight-medium">
            {{ portfolioStore.selectedPortfolio.displayName }}
            <span class="text-grey-6">({{ portfolioPatentCount }} patents)</span>
          </span>
          <q-btn
            flat dense
            color="primary"
            icon="cloud_download"
            label="Hydrate Patents"
            :loading="hydrating"
            @click="doHydrate"
          >
            <q-tooltip>Fetch missing patent data (title, abstract, CPC codes) from PatentsView API</q-tooltip>
          </q-btn>
          <q-btn
            flat dense
            color="secondary"
            icon="add_circle"
            label="Import from PatentsView"
            :loading="importing"
            @click="showImportDialog = true"
          >
            <q-tooltip>Search PatentsView by company affiliates and import new patents</q-tooltip>
          </q-btn>
          <q-spinner v-if="portfolioInfoLoading" size="xs" color="grey" />
          <q-chip v-if="hydrationResult" dense color="positive" text-color="white" icon="check">
            {{ hydrationResult.hydrated }} hydrated, {{ hydrationResult.alreadyComplete }} already complete
            <span v-if="hydrationResult.notFound > 0">, {{ hydrationResult.notFound }} not found</span>
          </q-chip>
          <q-chip v-if="importResult" dense color="positive" text-color="white" icon="check">
            {{ importResult.imported }} imported ({{ importResult.totalInPortfolio }} total)
          </q-chip>
        </div>
      </q-card-section>
    </q-card>

    <q-tabs v-model="activeTab" class="q-mb-md" align="left" active-color="primary">
      <q-tab name="enrichment" label="Enrichment Overview" icon="analytics" />
      <q-tab name="sectors" label="Sector Enrichment" icon="category" />
      <q-tab name="jobs" label="Job Queue" icon="queue" />
      <q-tab name="llm-batch" label="LLM Batch Scoring" icon="psychology" />
      <q-tab name="quarantine" label="Quarantine" icon="shield" />
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
          <q-btn flat icon="refresh" label="Refresh" :loading="enrichmentLoading" @click="loadEnrichmentSummary(true)" />
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
            <q-card v-for="(label, key) in { llm: 'LLM', prosecution: 'Prosecution', ipr: 'IPR', family: 'Families', xml: 'USPTO Bulk' }" :key="key" class="col">
              <q-card-section>
                <div class="row items-center justify-between q-mb-xs">
                  <span class="text-weight-medium">{{ label }}</span>
                  <span class="text-caption">{{ enrichmentData.enrichmentTotals[key as keyof typeof enrichmentData.enrichmentTotals].toLocaleString() }}</span>
                </div>
                <q-linear-progress
                  :value="effectiveBarValue(enrichmentData.enrichmentTotals[key as keyof typeof enrichmentData.enrichmentTotals], quarantineAdjustedTotal(enrichmentData.totalPatents, key, enrichmentData.quarantineCounts), activeJobsByCoverage.get(key) || null)"
                  :color="coverageColor(effectiveBarPct(enrichmentData.enrichmentTotals[key as keyof typeof enrichmentData.enrichmentTotals], quarantineAdjustedTotal(enrichmentData.totalPatents, key, enrichmentData.quarantineCounts), activeJobsByCoverage.get(key) || null))"
                  size="20px"
                  rounded
                >
                  <div class="absolute-full flex flex-center">
                    <span class="text-caption text-white text-weight-bold">
                      {{ effectiveBarPct(enrichmentData.enrichmentTotals[key as keyof typeof enrichmentData.enrichmentTotals], quarantineAdjustedTotal(enrichmentData.totalPatents, key, enrichmentData.quarantineCounts), activeJobsByCoverage.get(key) || null) }}%
                      <template v-if="activeJobsByCoverage.get(key)?.total"> ({{ activeJobsByCoverage.get(key)!.completed.toLocaleString() }}/{{ activeJobsByCoverage.get(key)!.total.toLocaleString() }})</template>
                    </span>
                  </div>
                </q-linear-progress>
                <div v-if="(key === 'xml' && enrichmentData.quarantineCounts?.xml) || (key === 'llm' && enrichmentData.quarantineCounts?.llm)" class="text-caption text-blue-grey q-mt-xs">
                  {{ key === 'xml' ? enrichmentData.quarantineCounts?.xml : enrichmentData.quarantineCounts?.llm }} quarantined
                </div>
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
                      <td v-for="(tier, idx) in enrichmentData.tiers" :key="tier.tierLabel + '-llm'">
                        <div class="enrichment-cell">
                          <q-linear-progress :value="effectiveBarValue(tier.enrichment.llm, quarantineAdjustedTotal(tier.count, 'llm', tier.quarantineCounts), tierActiveProgress(idx, 'llm'))" :color="coverageColor(effectiveBarPct(tier.enrichment.llm, quarantineAdjustedTotal(tier.count, 'llm', tier.quarantineCounts), tierActiveProgress(idx, 'llm')))" size="14px" rounded class="q-mb-xs" />
                          <span class="text-caption">{{ effectiveBarPct(tier.enrichment.llm, quarantineAdjustedTotal(tier.count, 'llm', tier.quarantineCounts), tierActiveProgress(idx, 'llm')) }}%</span>
                          <span v-if="tierActiveProgress(idx, 'llm')" class="text-caption text-blue q-ml-xs">({{ tierActiveProgress(idx, 'llm')!.completed }}/{{ tierActiveProgress(idx, 'llm')!.total }})</span>
                          <q-badge v-if="tier.quarantineCounts?.llm" color="blue-grey" class="q-ml-xs" dense>
                            {{ tier.quarantineCounts.llm }} quarantined
                          </q-badge>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold">Prosecution</td>
                      <td v-for="(tier, idx) in enrichmentData.tiers" :key="tier.tierLabel + '-pros'">
                        <div class="enrichment-cell">
                          <q-linear-progress :value="effectiveBarValue(tier.enrichment.prosecution, tier.count, tierActiveProgress(idx, 'prosecution'))" :color="coverageColor(effectiveBarPct(tier.enrichment.prosecution, tier.count, tierActiveProgress(idx, 'prosecution')))" size="14px" rounded class="q-mb-xs" />
                          <span class="text-caption">{{ effectiveBarPct(tier.enrichment.prosecution, tier.count, tierActiveProgress(idx, 'prosecution')) }}%</span>
                          <span v-if="tierActiveProgress(idx, 'prosecution')" class="text-caption text-blue q-ml-xs">({{ tierActiveProgress(idx, 'prosecution')!.completed }}/{{ tierActiveProgress(idx, 'prosecution')!.total }})</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold">IPR / PTAB</td>
                      <td v-for="(tier, idx) in enrichmentData.tiers" :key="tier.tierLabel + '-ipr'">
                        <div class="enrichment-cell">
                          <q-linear-progress :value="effectiveBarValue(tier.enrichment.ipr, tier.count, tierActiveProgress(idx, 'ipr'))" :color="coverageColor(effectiveBarPct(tier.enrichment.ipr, tier.count, tierActiveProgress(idx, 'ipr')))" size="14px" rounded class="q-mb-xs" />
                          <span class="text-caption">{{ effectiveBarPct(tier.enrichment.ipr, tier.count, tierActiveProgress(idx, 'ipr')) }}%</span>
                          <span v-if="tierActiveProgress(idx, 'ipr')" class="text-caption text-blue q-ml-xs">({{ tierActiveProgress(idx, 'ipr')!.completed }}/{{ tierActiveProgress(idx, 'ipr')!.total }})</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold">Families</td>
                      <td v-for="(tier, idx) in enrichmentData.tiers" :key="tier.tierLabel + '-fam'">
                        <div class="enrichment-cell">
                          <q-linear-progress :value="effectiveBarValue(tier.enrichment.family, tier.count, tierActiveProgress(idx, 'family'))" :color="coverageColor(effectiveBarPct(tier.enrichment.family, tier.count, tierActiveProgress(idx, 'family')))" size="14px" rounded class="q-mb-xs" />
                          <span class="text-caption">{{ effectiveBarPct(tier.enrichment.family, tier.count, tierActiveProgress(idx, 'family')) }}%</span>
                          <span v-if="tierActiveProgress(idx, 'family')" class="text-caption text-blue q-ml-xs">({{ tierActiveProgress(idx, 'family')!.completed }}/{{ tierActiveProgress(idx, 'family')!.total }})</span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold">USPTO Bulk</td>
                      <td v-for="(tier, idx) in enrichmentData.tiers" :key="tier.tierLabel + '-xml'">
                        <div class="enrichment-cell">
                          <q-linear-progress :value="effectiveBarValue(tier.enrichment.xml, (tier.count - (tier.quarantineCounts?.xml || 0)) || 1, tierActiveProgress(idx, 'xml'))" :color="coverageColor(effectiveBarPct(tier.enrichment.xml, (tier.count - (tier.quarantineCounts?.xml || 0)) || 1, tierActiveProgress(idx, 'xml')))" size="14px" rounded class="q-mb-xs" />
                          <span class="text-caption">{{ effectiveBarPct(tier.enrichment.xml, (tier.count - (tier.quarantineCounts?.xml || 0)) || 1, tierActiveProgress(idx, 'xml')) }}%</span>
                          <span v-if="tierActiveProgress(idx, 'xml')" class="text-caption text-blue q-ml-xs">({{ tierActiveProgress(idx, 'xml')!.completed }}/{{ tierActiveProgress(idx, 'xml')!.total }})</span>
                          <q-badge v-if="tier.quarantineCounts?.xml" color="blue-grey" class="q-ml-xs" dense>
                            {{ tier.quarantineCounts.xml }} quarantined
                          </q-badge>
                        </div>
                      </td>
                    </tr>
                    <!-- Active Jobs Row -->
                    <tr v-if="hasActiveJobs">
                      <td class="metric-col text-weight-bold">
                        <q-icon name="sync" color="blue" size="xs" class="q-mr-xs" />
                        Active
                      </td>
                      <td v-for="(tier, idx) in enrichmentData.tiers" :key="tier.tierLabel + '-active'">
                        <template v-if="activeJobsByTier.get(idx)?.length">
                          <div class="row items-center justify-center q-gutter-xs" style="flex-wrap: nowrap">
                            <q-spinner size="xs" color="blue" />
                            <q-chip
                              v-for="job in activeJobsByTier.get(idx)"
                              :key="job.id"
                              dense
                              size="sm"
                              :color="getCoverageColor(job.coverageType)"
                              text-color="white"
                              clickable
                              @click="activeTab = 'jobs'"
                            >
                              {{ formatCoverageLabel(job.coverageType) }}
                              <template v-if="job.progress && job.progress.completed > 0">
                                &nbsp;{{ Math.round(job.progress.completed / job.progress.total * 100) }}%
                              </template>
                            </q-chip>
                          </div>
                        </template>
                        <span v-else class="text-grey-4">&mdash;</span>
                      </td>
                    </tr>
                    <!-- Enrich Actions Row -->
                    <tr class="section-separator">
                      <td class="metric-col text-weight-bold">Actions</td>
                      <td v-for="(tier, idx) in enrichmentData.tiers" :key="tier.tierLabel + '-actions'">
                        <q-btn
                          v-if="tier.enrichment.llmPct < 100 || tier.enrichment.prosecutionPct < 100 || tier.enrichment.xmlPct < 100"
                          flat
                          dense
                          color="primary"
                          icon="play_arrow"
                          label="Enrich"
                          @click="openEnrichDialog('tier', formatTierRange(idx + 1, selectedTierSize))"
                        >
                          <q-badge v-if="activeJobsByTier.get(idx)?.length" floating color="warning" rounded>
                            <q-icon name="sync" size="10px" />
                          </q-badge>
                        </q-btn>
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
          <q-btn flat icon="refresh" label="Refresh" :loading="sectorEnrichmentLoading" @click="loadSectorEnrichment(true)" />
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
                  { name: 'xml', label: 'USPTO Bulk', field: (row: any) => row.enrichment.xmlPct, align: 'center', sortable: true },
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
                      <q-linear-progress :value="effectiveBarValue(props.row.enrichment.llm, quarantineAdjustedTotal(props.row.checkedPatents, 'llm', props.row.quarantineCounts), activeJobsBySuperSector.get(props.row.name)?.get('llm') || null)" :color="coverageColor(effectiveBarPct(props.row.enrichment.llm, quarantineAdjustedTotal(props.row.checkedPatents, 'llm', props.row.quarantineCounts), activeJobsBySuperSector.get(props.row.name)?.get('llm') || null))" size="12px" rounded />
                      <span class="text-caption">{{ effectiveBarPct(props.row.enrichment.llm, quarantineAdjustedTotal(props.row.checkedPatents, 'llm', props.row.quarantineCounts), activeJobsBySuperSector.get(props.row.name)?.get('llm') || null) }}%<span v-if="props.row.gaps.llm > 0 && !activeJobsBySuperSector.get(props.row.name)?.get('llm')" class="text-grey-6"> ({{ props.row.gaps.llm }})</span></span>
                      <span v-if="activeJobsBySuperSector.get(props.row.name)?.get('llm')" class="text-caption text-blue q-ml-xs">({{ activeJobsBySuperSector.get(props.row.name)!.get('llm')!.completed }}/{{ activeJobsBySuperSector.get(props.row.name)!.get('llm')!.total }})</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-pros="props">
                  <q-td :props="props">
                    <div class="enrichment-cell-small">
                      <q-linear-progress :value="effectiveBarValue(props.row.enrichment.prosecution, props.row.checkedPatents, activeJobsBySuperSector.get(props.row.name)?.get('prosecution') || null)" :color="coverageColor(effectiveBarPct(props.row.enrichment.prosecution, props.row.checkedPatents, activeJobsBySuperSector.get(props.row.name)?.get('prosecution') || null))" size="12px" rounded />
                      <span class="text-caption">{{ effectiveBarPct(props.row.enrichment.prosecution, props.row.checkedPatents, activeJobsBySuperSector.get(props.row.name)?.get('prosecution') || null) }}%<span v-if="props.row.gaps.prosecution > 0 && !activeJobsBySuperSector.get(props.row.name)?.get('prosecution')" class="text-grey-6"> ({{ props.row.gaps.prosecution }})</span></span>
                      <span v-if="activeJobsBySuperSector.get(props.row.name)?.get('prosecution')" class="text-caption text-blue q-ml-xs">({{ activeJobsBySuperSector.get(props.row.name)!.get('prosecution')!.completed }}/{{ activeJobsBySuperSector.get(props.row.name)!.get('prosecution')!.total }})</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-ipr="props">
                  <q-td :props="props">
                    <div class="enrichment-cell-small">
                      <q-linear-progress :value="effectiveBarValue(props.row.enrichment.ipr, props.row.checkedPatents, activeJobsBySuperSector.get(props.row.name)?.get('ipr') || null)" :color="coverageColor(effectiveBarPct(props.row.enrichment.ipr, props.row.checkedPatents, activeJobsBySuperSector.get(props.row.name)?.get('ipr') || null))" size="12px" rounded />
                      <span class="text-caption">{{ effectiveBarPct(props.row.enrichment.ipr, props.row.checkedPatents, activeJobsBySuperSector.get(props.row.name)?.get('ipr') || null) }}%<span v-if="props.row.gaps.ipr > 0 && !activeJobsBySuperSector.get(props.row.name)?.get('ipr')" class="text-grey-6"> ({{ props.row.gaps.ipr }})</span></span>
                      <span v-if="activeJobsBySuperSector.get(props.row.name)?.get('ipr')" class="text-caption text-blue q-ml-xs">({{ activeJobsBySuperSector.get(props.row.name)!.get('ipr')!.completed }}/{{ activeJobsBySuperSector.get(props.row.name)!.get('ipr')!.total }})</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-family="props">
                  <q-td :props="props">
                    <div class="enrichment-cell-small">
                      <q-linear-progress :value="effectiveBarValue(props.row.enrichment.family, props.row.checkedPatents, activeJobsBySuperSector.get(props.row.name)?.get('family') || null)" :color="coverageColor(effectiveBarPct(props.row.enrichment.family, props.row.checkedPatents, activeJobsBySuperSector.get(props.row.name)?.get('family') || null))" size="12px" rounded />
                      <span class="text-caption">{{ effectiveBarPct(props.row.enrichment.family, props.row.checkedPatents, activeJobsBySuperSector.get(props.row.name)?.get('family') || null) }}%<span v-if="props.row.gaps.family > 0 && !activeJobsBySuperSector.get(props.row.name)?.get('family')" class="text-grey-6"> ({{ props.row.gaps.family }})</span></span>
                      <span v-if="activeJobsBySuperSector.get(props.row.name)?.get('family')" class="text-caption text-blue q-ml-xs">({{ activeJobsBySuperSector.get(props.row.name)!.get('family')!.completed }}/{{ activeJobsBySuperSector.get(props.row.name)!.get('family')!.total }})</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-xml="props">
                  <q-td :props="props">
                    <div class="enrichment-cell-small">
                      <q-linear-progress :value="effectiveBarValue(props.row.enrichment.xml, (props.row.checkedPatents - (props.row.quarantineCounts?.xml || 0)) || 1, activeJobsBySuperSector.get(props.row.name)?.get('xml') || null)" :color="coverageColor(effectiveBarPct(props.row.enrichment.xml, (props.row.checkedPatents - (props.row.quarantineCounts?.xml || 0)) || 1, activeJobsBySuperSector.get(props.row.name)?.get('xml') || null))" size="12px" rounded />
                      <span class="text-caption">{{ effectiveBarPct(props.row.enrichment.xml, (props.row.checkedPatents - (props.row.quarantineCounts?.xml || 0)) || 1, activeJobsBySuperSector.get(props.row.name)?.get('xml') || null) }}%<span v-if="props.row.gaps.xml > 0 && !activeJobsBySuperSector.get(props.row.name)?.get('xml')" class="text-grey-6"> ({{ props.row.gaps.xml }})</span></span>
                      <span v-if="activeJobsBySuperSector.get(props.row.name)?.get('xml')" class="text-caption text-blue q-ml-xs">({{ activeJobsBySuperSector.get(props.row.name)!.get('xml')!.completed }}/{{ activeJobsBySuperSector.get(props.row.name)!.get('xml')!.total }})</span>
                    </div>
                  </q-td>
                </template>
                <template v-slot:body-cell-actions="props">
                  <q-td :props="props">
                    <q-btn
                      v-if="props.row.gaps.llm + props.row.gaps.prosecution + props.row.gaps.ipr + props.row.gaps.family + props.row.gaps.xml > 0"
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
                    <span v-if="item.jobs[0]?.portfolioName" class="text-primary q-mr-sm">{{ item.jobs[0].portfolioName }}</span>
                    {{ item.jobs[0]?.targetType === 'tier' ? formatJobTarget(item.jobs[0]) : `${item.jobs[0]?.targetType}: ${item.jobs[0]?.targetValue}` }}
                  </q-item-label>
                  <q-item-label caption>
                    {{ item.jobs.length }} jobs | Started {{ formatDate(item.jobs[0]?.startedAt) }}
                    <template v-if="item.jobs[0]?.progress">
                      | {{ item.jobs[0].progress.total.toLocaleString() }} patents
                    </template>
                    <template v-if="getGroupLlmInfo(item.jobs)">
                      | {{ getGroupLlmInfo(item.jobs) }}
                    </template>
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <div class="row items-center q-gutter-xs">
                    <q-chip v-for="type in getGroupCoverageTypes(item.jobs)" :key="type" dense size="sm" :color="getCoverageColor(type)" text-color="white">
                      {{ formatCoverageLabel(type) }}
                    </q-chip>
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
                  </div>
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
                    {{ formatCoverageLabel(job.coverageType) }}
                  </q-chip>
                </q-item-section>
                <q-item-section>
                  <q-item-label>
                    <q-badge :color="getStatusColor(job.status)" class="q-mr-sm">
                      {{ job.status }}
                    </q-badge>
                    <q-spinner v-if="job.status === 'running'" size="xs" color="blue" class="q-ml-xs" />
                    <span v-if="!item.isGroup">
                      <span v-if="job.portfolioName" class="text-primary q-mr-sm">{{ job.portfolioName }}</span>
                      <span class="text-grey-7">
                        {{ job.targetType === 'tier' ? formatJobTarget(job) : `${job.targetType}: ${job.targetValue}` }}
                      </span>
                    </span>
                  </q-item-label>
                  <q-item-label caption>
                    <span v-if="job.progress && job.status === 'running' && job.progress.completed > 0">
                      {{ job.progress.completed.toLocaleString() }} / {{ job.progress.total.toLocaleString() }} patents
                      ({{ Math.round(job.progress.completed / job.progress.total * 100) }}%)
                    </span>
                    <span v-else-if="job.progress">{{ job.progress.total.toLocaleString() }} patents</span>
                    <span v-if="job.model" class="q-ml-sm">
                      | <q-badge dense :color="job.model.includes('opus') ? 'deep-purple' : job.model.includes('haiku') ? 'teal' : 'blue'" text-color="white" class="text-caption">{{ llmModelLabel(job.model) }}</q-badge>
                    </span>
                    <span v-if="job.batchMode === false" class="q-ml-sm">| <q-badge dense color="orange" text-color="white" class="text-caption">realtime</q-badge></span>
                    <template v-if="job.settings">
                      <q-badge v-if="job.settings.llmConcurrency && job.settings.llmConcurrency !== 3" dense color="grey-6" text-color="white" class="text-caption q-ml-xs">{{ job.settings.llmConcurrency }}x</q-badge>
                      <q-badge v-if="job.settings.apiRateLimit && job.settings.apiRateLimit !== 60" dense color="grey-6" text-color="white" class="text-caption q-ml-xs">{{ job.settings.apiRateLimit }}rpm</q-badge>
                      <q-badge v-if="job.settings.batchSize && job.settings.batchSize !== 500" dense color="grey-6" text-color="white" class="text-caption q-ml-xs">batch:{{ job.settings.batchSize }}</q-badge>
                    </template>
                    <!-- Claims are always included in LLM scoring -->
                    <span v-if="job.status === 'running' && job.actualRate" class="q-ml-sm">| {{ job.actualRate.toLocaleString() }}/hr</span>
                    <span v-else-if="job.status === 'running' && job.estimatedRate" class="q-ml-sm">| ~{{ job.estimatedRate.toLocaleString() }}/hr</span>
                    <span v-if="job.status !== 'running' && job.actualRate" class="q-ml-sm">| {{ job.actualRate.toLocaleString() }}/hr</span>
                    <span v-if="job.status === 'running' && job.estimatedCompletion" class="q-ml-sm">
                      | ETA: {{ formatETA(job.estimatedCompletion) }}
                    </span>
                    <span v-if="job.completedAt" class="q-ml-sm">
                      | {{ formatDuration(job.startedAt, job.completedAt) }}
                    </span>
                  </q-item-label>
                  <q-linear-progress
                    v-if="job.status === 'running' && job.progress && job.progress.completed > 0"
                    :value="job.progress.completed / job.progress.total"
                    color="blue"
                    size="6px"
                    rounded
                    class="q-mt-xs"
                  />
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

      <!-- ═══ LLM Batch Scoring Tab ═══ -->
      <q-tab-panel name="llm-batch" class="q-pa-none">
        <div class="row items-center q-mb-md">
          <div class="text-subtitle1 q-mr-md">Anthropic Batch API Jobs</div>
          <q-space />
          <q-btn flat icon="refresh" label="Refresh" :loading="llmBatchLoading" @click="loadLlmBatchJobs" />
        </div>

        <q-banner v-if="llmBatchError" class="bg-negative text-white q-mb-md">
          {{ llmBatchError }}
        </q-banner>

        <div v-if="llmBatchLoading && llmBatchJobs.length === 0" class="row justify-center q-pa-xl">
          <q-spinner size="lg" color="primary" />
        </div>

        <q-card flat bordered v-else-if="llmBatchJobs.length > 0">
          <q-table
            :rows="llmBatchJobs"
            :columns="[
              { name: 'sector', label: 'Sector', field: 'sectorName', align: 'left', sortable: true },
              { name: 'model', label: 'Model', field: 'model', align: 'left', sortable: true },
              { name: 'patents', label: 'Patents', field: 'patentCount', align: 'right', sortable: true },
              { name: 'status', label: 'Status', field: 'status', align: 'center', sortable: true },
              { name: 'results', label: 'Results', field: 'results', align: 'center' },
              { name: 'submitted', label: 'Submitted', field: 'submittedAt', align: 'left', sortable: true },
              { name: 'completed', label: 'Completed', field: 'completedAt', align: 'left', sortable: true },
              { name: 'actions', label: 'Actions', field: 'actions', align: 'center' }
            ]"
            row-key="batchId"
            flat
            bordered
            dense
            :pagination="{ rowsPerPage: 20, sortBy: 'submitted', descending: true }"
          >
            <template v-slot:body-cell-sector="props">
              <q-td :props="props">
                <span class="text-weight-medium">{{ props.row.sectorName }}</span>
                <div class="text-caption text-grey-6">{{ props.row.superSector }}</div>
              </q-td>
            </template>

            <template v-slot:body-cell-model="props">
              <q-td :props="props">
                <q-chip dense size="sm" :color="props.row.model.includes('haiku') ? 'teal' : props.row.model.includes('opus') ? 'deep-purple' : 'blue'" text-color="white">
                  {{ llmModelLabel(props.row.model) }}
                </q-chip>
              </q-td>
            </template>

            <template v-slot:body-cell-status="props">
              <q-td :props="props">
                <q-badge :color="llmBatchStatusColor(props.row.status)">
                  {{ props.row.status }}
                </q-badge>
                <q-spinner v-if="isLlmBatchActive(props.row)" size="xs" color="blue" class="q-ml-xs" />
              </q-td>
            </template>

            <template v-slot:body-cell-results="props">
              <q-td :props="props">
                <span v-if="props.row.results.succeeded > 0" class="text-positive q-mr-xs">{{ props.row.results.succeeded }} ok</span>
                <span v-if="props.row.results.errored > 0" class="text-negative q-mr-xs">{{ props.row.results.errored }} err</span>
                <span v-if="props.row.results.expired > 0" class="text-warning q-mr-xs">{{ props.row.results.expired }} exp</span>
                <q-badge v-if="props.row.results.processed" color="positive" class="q-ml-xs">saved</q-badge>
                <span v-if="props.row.results.succeeded === 0 && props.row.results.errored === 0 && props.row.results.expired === 0" class="text-grey">-</span>
              </q-td>
            </template>

            <template v-slot:body-cell-submitted="props">
              <q-td :props="props">
                {{ formatLlmDate(props.row.submittedAt) }}
              </q-td>
            </template>

            <template v-slot:body-cell-completed="props">
              <q-td :props="props">
                {{ formatLlmDate(props.row.completedAt) }}
              </q-td>
            </template>

            <template v-slot:body-cell-actions="props">
              <q-td :props="props">
                <div class="row q-gutter-xs no-wrap">
                  <q-btn
                    v-if="isLlmBatchProcessable(props.row)"
                    flat dense
                    color="primary"
                    icon="download_done"
                    label="Process"
                    :loading="llmBatchProcessingId === props.row.batchId"
                    @click="processLlmBatchResults(props.row.batchId)"
                  >
                    <q-tooltip>Process batch results into DB</q-tooltip>
                  </q-btn>
                  <q-btn
                    v-if="isLlmBatchActive(props.row)"
                    flat dense
                    color="negative"
                    icon="cancel"
                    :loading="llmBatchCancellingId === props.row.batchId"
                    @click="cancelLlmBatch(props.row.batchId)"
                  >
                    <q-tooltip>Cancel batch</q-tooltip>
                  </q-btn>
                  <q-btn
                    flat dense
                    color="grey"
                    icon="content_copy"
                    @click="navigator.clipboard.writeText(props.row.batchId)"
                  >
                    <q-tooltip>Copy batch ID: {{ props.row.batchId }}</q-tooltip>
                  </q-btn>
                </div>
              </q-td>
            </template>
          </q-table>
        </q-card>

        <div v-else class="text-center text-grey q-pa-xl">
          <q-icon size="3em" name="psychology" class="q-mb-md" />
          <div class="text-h6">No LLM batch jobs found</div>
          <div class="text-caption">Submit batch scoring jobs from the Sector Management page</div>
        </div>

        <!-- Auto-Snapshots Section -->
        <q-card flat bordered class="q-mt-md" v-if="autoSnapshots.length > 0 || showAutoSnapshots">
          <q-card-section class="q-py-sm row items-center">
            <q-toggle v-model="showAutoSnapshots" label="Show auto-snapshots" dense />
            <q-space />
            <q-badge v-if="autoSnapshots.length > 0" color="grey">
              {{ autoSnapshots.length }} auto-snapshot{{ autoSnapshots.length !== 1 ? 's' : '' }}
            </q-badge>
          </q-card-section>
          <q-card-section v-if="showAutoSnapshots" class="q-pt-none">
            <q-spinner v-if="autoSnapshotsLoading" size="sm" />
            <q-list v-else-if="autoSnapshots.length > 0" separator dense>
              <q-item v-for="snap in autoSnapshots" :key="snap.id">
                <q-item-section>
                  <q-item-label class="text-italic text-grey-7">{{ snap.name }}</q-item-label>
                  <q-item-label caption>
                    {{ snap.patentCount }} patents | {{ new Date(snap.createdAt).toLocaleString() }}
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    v-if="!snap.isActive"
                    flat dense
                    color="primary"
                    label="Make Active"
                    @click="activateSnapshot(snap.id)"
                  />
                  <q-badge v-else color="positive">Active</q-badge>
                </q-item-section>
              </q-item>
            </q-list>
            <div v-else class="text-grey text-caption">No auto-snapshots yet</div>
          </q-card-section>
        </q-card>
      </q-tab-panel>

      <!-- ═══ Quarantine Tab ═══ -->
      <q-tab-panel name="quarantine" class="q-pa-none">
        <div class="row items-center q-mb-md q-gutter-md">
          <PortfolioSelector />
          <q-btn
            flat icon="auto_fix_high" label="Auto-Detect"
            :loading="quarantineAutoLoading"
            @click="runAutoQuarantine(false)"
          />
          <q-btn
            flat icon="visibility" label="Dry Run"
            :loading="quarantineDryRunLoading"
            @click="runAutoQuarantine(true)"
          />
          <q-btn flat icon="refresh" label="Refresh" :loading="quarantineLoading" @click="loadQuarantineSummary" />
        </div>

        <!-- Dry run results -->
        <q-banner v-if="quarantineDryRunResult" class="bg-blue-1 q-mb-md" rounded>
          <div class="text-subtitle2">Dry Run Results</div>
          <div>Scanned: {{ quarantineDryRunResult.totalScanned.toLocaleString() }} patents</div>
          <div>Would quarantine: {{ quarantineDryRunResult.wouldQuarantine.toLocaleString() }}</div>
          <div v-for="(count, reason) in quarantineDryRunResult.summary" :key="reason" class="q-ml-md">
            {{ reason }}: {{ count }}
          </div>
          <template v-slot:action>
            <q-btn flat label="Dismiss" @click="quarantineDryRunResult = null" />
            <q-btn flat color="primary" label="Apply Now" @click="runAutoQuarantine(false)" />
          </template>
        </q-banner>

        <div v-if="quarantineLoading" class="flex flex-center q-pa-xl">
          <q-spinner size="lg" color="primary" />
        </div>

        <div v-else-if="quarantineData">
          <!-- Summary cards -->
          <div class="row q-gutter-md q-mb-lg">
            <q-card v-for="group in quarantineData.groups" :key="`${group.coverageType}:${group.reason}`"
              flat bordered class="col-auto" style="min-width: 200px">
              <q-card-section class="q-pa-sm">
                <div class="row items-center q-gutter-sm">
                  <q-icon :name="getQuarantineIcon(group.reason)" :color="getQuarantineColor(group.reason)" size="sm" />
                  <div>
                    <div class="text-subtitle2">{{ getQuarantineLabel(group.reason) }}</div>
                    <div class="text-caption text-grey">{{ group.coverageType }} &middot; {{ group.count }} patents</div>
                    <div v-if="getQuarantineRemedy(group.reason)" class="text-caption text-blue-grey-6">{{ getQuarantineRemedy(group.reason) }}</div>
                  </div>
                </div>
              </q-card-section>
            </q-card>
            <q-card v-if="quarantineData.groups.length === 0" flat bordered class="col-12">
              <q-card-section class="text-center text-grey">
                <q-icon name="check_circle" size="xl" color="positive" class="q-mb-sm" />
                <div>No quarantined patents</div>
              </q-card-section>
            </q-card>
          </div>

          <!-- Grouped patent tables -->
          <q-card v-for="group in quarantineData.groups" :key="`table-${group.coverageType}:${group.reason}`"
            flat bordered class="q-mb-md">
            <q-card-section>
              <div class="row items-center q-mb-sm">
                <q-icon :name="getQuarantineIcon(group.reason)" :color="getQuarantineColor(group.reason)" size="sm" class="q-mr-sm" />
                <div>
                  <span class="text-subtitle1 text-weight-medium">{{ getQuarantineLabel(group.reason) }}</span>
                  <q-badge class="q-ml-sm" :color="getQuarantineColor(group.reason)">{{ group.count }}</q-badge>
                  <div v-if="getQuarantineRemedy(group.reason)" class="text-caption text-blue-grey-6">{{ getQuarantineRemedy(group.reason) }}</div>
                </div>
                <q-space />
                <q-btn v-if="isRetryable(group.reason)" flat dense size="sm"
                  label="Retry All" icon="replay" color="primary" />
                <q-btn flat dense size="sm" label="Unquarantine All" icon="shield"
                  @click="bulkUnquarantine(group)" />
              </div>
              <q-table
                flat dense
                :rows="group.patents"
                :columns="quarantineColumns"
                :pagination="{ rowsPerPage: 10 }"
                row-key="patentId"
              >
                <template v-slot:body-cell-patentId="props">
                  <q-td :props="props">
                    <router-link :to="{ name: 'patent-detail', params: { id: props.row.patentId } }" class="text-primary">
                      US{{ props.row.patentId }}
                    </router-link>
                  </q-td>
                </template>
                <template v-slot:body-cell-actions="props">
                  <q-td :props="props">
                    <q-btn flat dense size="sm" icon="shield" color="orange"
                      @click="unquarantinePatent(props.row.patentId, group.coverageType)">
                      <q-tooltip>Unquarantine</q-tooltip>
                    </q-btn>
                  </q-td>
                </template>
              </q-table>
            </q-card-section>
          </q-card>
        </div>

        <div v-else-if="quarantineError" class="text-negative q-pa-md">
          {{ quarantineError }}
        </div>
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

          <!-- Advanced Settings -->
          <q-expansion-item
            v-model="showAdvanced"
            label="Advanced Settings"
            icon="tune"
            header-class="text-grey-8"
            dense
            class="q-mt-sm"
          >
            <q-card flat>
              <q-card-section class="q-gutter-sm q-pt-sm">
                <!-- LLM Settings -->
                <template v-if="newJobCoverageTypes.includes('llm')">
                  <div class="text-caption text-weight-medium text-grey-8">LLM Scoring</div>
                  <q-select
                    v-model="newJobModel"
                    :options="llmModelOptions"
                    option-value="value"
                    option-label="label"
                    emit-value
                    map-options
                    label="LLM Model"
                    outlined
                    dense
                  >
                    <template v-slot:option="scope">
                      <q-item v-bind="scope.itemProps">
                        <q-item-section>
                          <q-item-label>{{ scope.opt.label }}</q-item-label>
                          <q-item-label caption>{{ scope.opt.hint }}</q-item-label>
                        </q-item-section>
                      </q-item>
                    </template>
                  </q-select>
                  <q-toggle
                    v-model="newJobBatchMode"
                    color="blue"
                  >
                    <template v-slot:default>
                      <span class="text-body2">{{ newJobBatchMode ? 'Batch API — ~50% cheaper, results in ~24h' : 'Realtime — full price, immediate results' }}</span>
                    </template>
                  </q-toggle>
                  <div class="row q-gutter-sm q-mt-xs">
                    <q-input
                      v-model.number="advancedSettings.llmConcurrency"
                      type="number"
                      label="Concurrency"
                      hint="Parallel API calls (1-10)"
                      outlined dense
                      :rules="[(v: number) => (v >= 1 && v <= 10) || '1-10']"
                      style="max-width: 140px"
                    />
                    <q-input
                      v-model.number="advancedSettings.llmMaxRetries"
                      type="number"
                      label="Max Retries"
                      hint="0-5"
                      outlined dense
                      :rules="[(v: number) => (v >= 0 && v <= 5) || '0-5']"
                      style="max-width: 120px"
                    />
                    <q-input
                      v-model.number="advancedSettings.llmRetryBaseDelay"
                      type="number"
                      label="Retry Delay (ms)"
                      hint="Base backoff delay"
                      outlined dense
                      style="max-width: 150px"
                    />
                    <q-input
                      v-model.number="advancedSettings.llmInterBatchDelay"
                      type="number"
                      label="Batch Delay (ms)"
                      hint="Delay between batches"
                      outlined dense
                      style="max-width: 150px"
                    />
                  </div>
                </template>

                <!-- API Settings -->
                <template v-if="newJobCoverageTypes.includes('prosecution') || newJobCoverageTypes.includes('ipr')">
                  <div class="text-caption text-weight-medium text-grey-8 q-mt-sm">USPTO API</div>
                  <div class="row q-gutter-sm">
                    <q-input
                      v-model.number="advancedSettings.apiRateLimit"
                      type="number"
                      label="Rate Limit"
                      hint="Requests/min"
                      outlined dense
                      style="max-width: 130px"
                    />
                    <q-input
                      v-model.number="advancedSettings.apiRetryAttempts"
                      type="number"
                      label="Retries"
                      hint="0-5"
                      outlined dense
                      :rules="[(v: number) => (v >= 0 && v <= 5) || '0-5']"
                      style="max-width: 110px"
                    />
                    <q-input
                      v-model.number="advancedSettings.apiRetryDelay"
                      type="number"
                      label="Retry Delay (ms)"
                      outlined dense
                      style="max-width: 140px"
                    />
                  </div>
                </template>

                <!-- General -->
                <div class="text-caption text-weight-medium text-grey-8 q-mt-sm">General</div>
                <q-input
                  v-model.number="advancedSettings.batchSize"
                  type="number"
                  label="Batch Size"
                  hint="Patents per process (100-1000)"
                  outlined dense
                  :rules="[(v: number) => (v >= 100 && v <= 1000) || '100-1000']"
                  style="max-width: 180px"
                />
              </q-card-section>
            </q-card>
          </q-expansion-item>

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
      <q-card style="min-width: 440px">
        <q-card-section>
          <div class="text-h6">Enrich: {{ enrichDialogTargetType }} "{{ enrichDialogTargetValue }}"</div>
          <div v-if="enrichDialogGaps" class="text-caption text-grey-7">
            {{ enrichDialogGaps.gaps.llm?.total?.toLocaleString() || 0 }} patents in scope
          </div>
        </q-card-section>

        <q-card-section>
          <div v-if="enrichDialogLoading" class="text-center q-pa-md">
            <q-spinner size="sm" /> Analyzing gaps...
          </div>
          <template v-else-if="enrichDialogGaps">
            <div class="text-subtitle2 q-mb-sm">Coverage Types to Run</div>
            <div class="column q-gutter-xs">
              <q-checkbox
                v-for="opt in coverageTypeOptions"
                :key="opt.value"
                v-model="enrichDialogCoverageTypes"
                :val="opt.value"
                :color="(enrichDialogGaps.gaps[opt.value]?.gap ?? 0) > 0 ? opt.color : 'grey-5'"
                :disable="(enrichDialogGaps.gaps[opt.value]?.gap ?? 0) === 0"
              >
                <span :class="{ 'text-grey-5': (enrichDialogGaps.gaps[opt.value]?.gap ?? 0) === 0 }">{{ opt.label }}</span>
                <q-badge
                  v-if="(enrichDialogGaps.gaps[opt.value]?.gap ?? 0) > 0"
                  :color="opt.color"
                  :label="`${enrichDialogGaps.gaps[opt.value].gap.toLocaleString()} gaps`"
                  class="q-ml-sm"
                />
                <q-badge
                  v-else
                  color="grey-4"
                  text-color="grey-7"
                  label="complete"
                  class="q-ml-sm"
                />
              </q-checkbox>
            </div>
            <div v-if="enrichDialogCoverageTypes.length > 0" class="text-caption text-grey-7 q-mt-md">
              Will submit {{ enrichDialogCoverageTypes.length }} job{{ enrichDialogCoverageTypes.length > 1 ? 's' : '' }}
            </div>
            <div v-else class="text-caption text-positive q-mt-md">
              All coverage types are complete for this scope.
            </div>
          </template>

          <!-- Advanced Settings (shared component pattern) -->
          <q-expansion-item
            v-if="enrichDialogGaps && enrichDialogCoverageTypes.length > 0"
            v-model="showAdvanced"
            label="Advanced Settings"
            icon="tune"
            header-class="text-grey-8"
            dense
            class="q-mt-sm"
          >
            <q-card flat>
              <q-card-section class="q-gutter-sm q-pt-sm">
                <template v-if="enrichDialogCoverageTypes.includes('llm')">
                  <div class="text-caption text-weight-medium text-grey-8">LLM Scoring</div>
                  <q-select
                    v-model="enrichDialogModel"
                    :options="llmModelOptions"
                    option-value="value"
                    option-label="label"
                    emit-value
                    map-options
                    label="LLM Model"
                    outlined
                    dense
                  >
                    <template v-slot:option="scope">
                      <q-item v-bind="scope.itemProps">
                        <q-item-section>
                          <q-item-label>{{ scope.opt.label }}</q-item-label>
                          <q-item-label caption>{{ scope.opt.hint }}</q-item-label>
                        </q-item-section>
                      </q-item>
                    </template>
                  </q-select>
                  <q-toggle
                    v-model="enrichDialogBatchMode"
                    color="blue"
                  >
                    <template v-slot:default>
                      <span class="text-body2">{{ enrichDialogBatchMode ? 'Batch API — ~50% cheaper, results in ~24h' : 'Realtime — full price, immediate results' }}</span>
                    </template>
                  </q-toggle>
                  <div class="row q-gutter-sm q-mt-xs">
                    <q-input v-model.number="advancedSettings.llmConcurrency" type="number" label="Concurrency" hint="Parallel API calls (1-10)" outlined dense :rules="[(v: number) => (v >= 1 && v <= 10) || '1-10']" style="max-width: 140px" />
                    <q-input v-model.number="advancedSettings.llmMaxRetries" type="number" label="Max Retries" hint="0-5" outlined dense :rules="[(v: number) => (v >= 0 && v <= 5) || '0-5']" style="max-width: 120px" />
                    <q-input v-model.number="advancedSettings.llmRetryBaseDelay" type="number" label="Retry Delay (ms)" hint="Base backoff delay" outlined dense style="max-width: 150px" />
                    <q-input v-model.number="advancedSettings.llmInterBatchDelay" type="number" label="Batch Delay (ms)" hint="Delay between batches" outlined dense style="max-width: 150px" />
                  </div>
                </template>
                <template v-if="enrichDialogCoverageTypes.includes('prosecution') || enrichDialogCoverageTypes.includes('ipr')">
                  <div class="text-caption text-weight-medium text-grey-8 q-mt-sm">USPTO API</div>
                  <div class="row q-gutter-sm">
                    <q-input v-model.number="advancedSettings.apiRateLimit" type="number" label="Rate Limit" hint="Requests/min" outlined dense style="max-width: 130px" />
                    <q-input v-model.number="advancedSettings.apiRetryAttempts" type="number" label="Retries" hint="0-5" outlined dense :rules="[(v: number) => (v >= 0 && v <= 5) || '0-5']" style="max-width: 110px" />
                    <q-input v-model.number="advancedSettings.apiRetryDelay" type="number" label="Retry Delay (ms)" outlined dense style="max-width: 140px" />
                  </div>
                </template>
                <div class="text-caption text-weight-medium text-grey-8 q-mt-sm">General</div>
                <q-input v-model.number="advancedSettings.batchSize" type="number" label="Batch Size" hint="Patents per process (100-1000)" outlined dense :rules="[(v: number) => (v >= 100 && v <= 1000) || '100-1000']" style="max-width: 180px" />
              </q-card-section>
            </q-card>
          </q-expansion-item>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Start Enrichment"
            :loading="enrichDialogStarting"
            :disable="enrichDialogCoverageTypes.length === 0 || enrichDialogLoading"
            @click="startEnrichFromDialog"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- ═══ Duplicate Job Warning Dialog ═══ -->
    <q-dialog v-model="showDuplicateWarning">
      <q-card style="min-width: 420px">
        <q-card-section>
          <div class="text-h6 text-warning">
            <q-icon name="warning" class="q-mr-sm" />
            Overlapping Jobs Detected
          </div>
        </q-card-section>
        <q-card-section>
          <p>The following jobs are already running or pending for the same target:</p>
          <q-list dense separator class="q-mb-md">
            <q-item v-for="job in duplicateJobs" :key="job.id">
              <q-item-section avatar>
                <q-badge :color="getStatusColor(job.status)">{{ job.status }}</q-badge>
              </q-item-section>
              <q-item-section>
                <q-item-label>
                  <q-chip dense size="sm" :color="getCoverageColor(job.coverageType)" text-color="white">
                    {{ formatCoverageLabel(job.coverageType) }}
                  </q-chip>
                  <span class="q-ml-sm text-grey-7">{{ formatJobTarget(job) }}</span>
                </q-item-label>
                <q-item-label caption v-if="job.progress">
                  {{ job.progress.completed.toLocaleString() }} / {{ job.progress.total.toLocaleString() }} patents
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
          <p class="text-caption text-grey-7">
            Submitting duplicate jobs is usually harmless (gap analysis returns 0 for already-enriched patents) but wastes resources.
          </p>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="warning"
            text-color="black"
            label="Submit Anyway"
            @click="confirmDuplicateSubmit"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- ═══ Import Dialog ═══ -->
    <q-dialog v-model="showImportDialog">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">Import from PatentsView</div>
          <div class="text-caption text-grey-7 q-mt-xs">
            Searches PatentsView by company affiliates and imports new patents into the portfolio.
          </div>
        </q-card-section>
        <q-card-section>
          <q-select
            v-model="importMaxPatents"
            :options="importMaxOptions"
            emit-value
            map-options
            label="Max patents to import"
            outlined
            dense
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Import" icon="cloud_download" @click="doImport" />
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
