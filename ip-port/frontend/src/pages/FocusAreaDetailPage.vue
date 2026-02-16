<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { focusAreaApi, patentApi, searchApi, type FocusArea, type FocusAreaPatent, type SearchTerm, type PatentPreview, type SearchPreviewResult, type ScopeOptions, type SearchScopeType, type SearchScopeConfig, type PromptTemplate, type PromptResult, type PromptPreviewResponse } from '@/services/api';
import PatentPreviewTooltip from '@/components/PatentPreviewTooltip.vue';
import KeywordExtractionPanel from '@/components/KeywordExtractionPanel.vue';
import { usePatentsStore } from '@/stores/patents';
import ColumnSelector from '@/components/grid/ColumnSelector.vue';
import type { Patent } from '@/types';

const route = useRoute();
const router = useRouter();
const patentsStore = usePatentsStore();
const $q = useQuasar();

// State
const focusArea = ref<FocusArea | null>(null);
const faPatents = ref<Patent[]>([]);
const faPatentsTotal = ref(0);
const faPatentsLoading = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const activeTab = ref('overview');

// Rich grid state
const showColumnSelector = ref(false);
const searchText = ref('');
const showFilters = ref(true);
const selectedPatents = ref<Patent[]>([]);

// Filter options (loaded from API)
interface FilterOption { name: string; count: number }
const affiliateOptions = ref<FilterOption[]>([]);
const superSectorOptions = ref<FilterOption[]>([]);
const loadingFilters = ref(false);
const selectedAffiliates = ref<string[]>([]);
const selectedSuperSectors = ref<string[]>([]);
// Numeric range filters
const scoreMin = ref<number | null>(null);
const scoreMax = ref<number | null>(null);
const yearsMin = ref<number | null>(null);
const yearsMax = ref<number | null>(null);
const competitorCitesMin = ref<number | null>(null);
const competitorCitesMax = ref<number | null>(null);
const forwardCitesMin = ref<number | null>(null);
const forwardCitesMax = ref<number | null>(null);

// Pagination for patents (server-side)
const faPagination = ref({
  page: 1,
  rowsPerPage: 50,
  rowsNumber: 0,
  sortBy: 'score',
  descending: true
});

// Local filter state for the focus-area patents API call
const faFilters = ref<Record<string, unknown>>({});

// Edit mode
const editing = ref(false);
const editForm = ref({ name: '', description: '' });

// Add patent dialog
const showAddPatentDialog = ref(false);
const newPatentIds = ref('');
const addingPatents = ref(false);
const parsedPatentIds = ref<string[]>([]);
const patentPreviews = ref<Record<string, PatentPreview | null>>({});
const loadingPreviews = ref(false);
const fetchingData = ref(false);
let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Parse patent IDs from input
function parsePatentIds(input: string): string[] {
  return input
    .split(/[\s,\n]+/)
    .map(id => id.trim().replace(/^US/i, ''))
    .filter(id => id && /^\d{6,}$/.test(id));
}

// Debounced preview loading
watch(newPatentIds, (val) => {
  if (previewDebounceTimer) clearTimeout(previewDebounceTimer);

  const ids = parsePatentIds(val);
  parsedPatentIds.value = ids;

  if (ids.length === 0 || ids.length > 50) {
    patentPreviews.value = {};
    return;
  }

  previewDebounceTimer = setTimeout(async () => {
    loadingPreviews.value = true;
    try {
      const response = await patentApi.getBatchPreviews(ids);
      patentPreviews.value = response.previews;
    } catch (err) {
      console.error('Failed to load previews:', err);
    } finally {
      loadingPreviews.value = false;
    }
  }, 300);
});

// Computed preview stats
const previewStats = computed(() => {
  const total = parsedPatentIds.value.length;
  const found = Object.values(patentPreviews.value).filter(p => p !== null).length;
  const notFound = total - found;
  return { total, found, notFound };
});

// Search scope
const showScopeDialog = ref(false);
const scopeOptions = ref<ScopeOptions | null>(null);
const loadingScopeOptions = ref(false);
const pendingScopeType = ref<SearchScopeType>('PORTFOLIO');
const pendingScopeConfig = ref<SearchScopeConfig>({});

const activeScopeLabel = computed(() => {
  if (!focusArea.value) return 'Portfolio';
  const st = focusArea.value.searchScopeType;
  const sc = focusArea.value.searchScopeConfig;
  if (st === 'PORTFOLIO') return 'Portfolio';
  if (st === 'SUPER_SECTOR' && sc?.superSectors?.length) {
    return sc.superSectors.length === 1
      ? formatScopeLabel(sc.superSectors[0])
      : `${sc.superSectors.length} super-sectors`;
  }
  if (st === 'SECTOR' && sc?.sectors?.length) {
    return sc.sectors.length === 1
      ? formatScopeLabel(sc.sectors[0])
      : `${sc.sectors.length} sectors`;
  }
  return st.toLowerCase().replace('_', '-');
});

function formatScopeLabel(key: string): string {
  return key.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

async function loadScopeOptions() {
  loadingScopeOptions.value = true;
  try {
    scopeOptions.value = await searchApi.getScopeOptions();
  } catch (err) {
    console.error('Failed to load scope options:', err);
  } finally {
    loadingScopeOptions.value = false;
  }
}

function openScopeDialog() {
  if (focusArea.value) {
    pendingScopeType.value = focusArea.value.searchScopeType || 'PORTFOLIO';
    pendingScopeConfig.value = { ...(focusArea.value.searchScopeConfig || {}) };
  }
  loadScopeOptions();
  showScopeDialog.value = true;
}

async function saveScope() {
  if (!focusArea.value) return;
  try {
    const config = pendingScopeType.value === 'PORTFOLIO' ? null : pendingScopeConfig.value;
    await focusAreaApi.updateFocusArea(focusAreaId.value, {
      searchScopeType: pendingScopeType.value,
      searchScopeConfig: config
    } as Partial<FocusArea>);
    focusArea.value.searchScopeType = pendingScopeType.value;
    focusArea.value.searchScopeConfig = config || undefined;
    showScopeDialog.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save scope';
  }
}

function toggleScopeSector(sector: string) {
  const sectors = pendingScopeConfig.value.sectors || [];
  const idx = sectors.indexOf(sector);
  if (idx >= 0) {
    sectors.splice(idx, 1);
  } else {
    sectors.push(sector);
  }
  pendingScopeConfig.value = { ...pendingScopeConfig.value, sectors };
}

function toggleScopeSuperSector(ss: string) {
  const superSectors = pendingScopeConfig.value.superSectors || [];
  const idx = superSectors.indexOf(ss);
  if (idx >= 0) {
    superSectors.splice(idx, 1);
  } else {
    superSectors.push(ss);
  }
  pendingScopeConfig.value = { ...pendingScopeConfig.value, superSectors };
}

// Build scope params for search preview based on active focus area scope
function getScopeParams() {
  if (!focusArea.value) return {};
  const st = focusArea.value.searchScopeType;
  const sc = focusArea.value.searchScopeConfig;
  if (st === 'SECTOR' && sc?.sectors?.length) {
    return { sectors: sc.sectors };
  }
  if (st === 'SUPER_SECTOR' && sc?.superSectors?.length) {
    return { superSectors: sc.superSectors };
  }
  return {};
}

// Add search term dialog
const showAddTermDialog = ref(false);
const newTerm = ref({
  expression: '',
  termType: 'KEYWORD' as const
});
const addingTerm = ref(false);

// Search term preview
const termPreviewResult = ref<SearchPreviewResult | null>(null);
const loadingTermPreview = ref(false);
const termSearchFields = ref<'title' | 'abstract' | 'both'>('both');

const searchFieldOptions = [
  { value: 'both', label: 'Title + Abstract' },
  { value: 'title', label: 'Title Only' },
  { value: 'abstract', label: 'Abstract Only' }
];

// Explicit search preview trigger
async function triggerTermPreview() {
  const expression = newTerm.value.expression.trim();
  if (!expression) return;

  loadingTermPreview.value = true;
  try {
    termPreviewResult.value = await searchApi.previewSearchTerm(expression, {
      termType: newTerm.value.termType,
      searchFields: termSearchFields.value,
      focusAreaId: focusAreaId.value,
      ...getScopeParams()
    });
  } catch (err) {
    console.error('Failed to load term preview:', err);
    termPreviewResult.value = null;
  } finally {
    loadingTermPreview.value = false;
  }
}

// Computed
const focusAreaId = computed(() => route.params.id as string);

const termSelectivityRatio = computed(() => {
  if (!termPreviewResult.value) return 1;
  const denominator = termPreviewResult.value.hitCounts.scope
    ?? termPreviewResult.value.hitCounts.portfolio;
  if (denominator === 0) return 1;
  const fa = termPreviewResult.value.hitCounts.focusArea ?? 0;
  return fa / denominator;
});

const searchTerms = computed(() => focusArea.value?.searchTerms || []);

const termTypeOptions = [
  { value: 'KEYWORD', label: 'Keywords (OR)' },
  { value: 'KEYWORD_AND', label: 'Keywords (AND)' },
  { value: 'PHRASE', label: 'Exact Phrase' },
  { value: 'PROXIMITY', label: 'Proximity (W/N)' },
  { value: 'WILDCARD', label: 'Wildcards' },
  { value: 'BOOLEAN', label: 'Boolean Expression' }
];

// Load focus area
async function loadFocusArea() {
  loading.value = true;
  error.value = null;

  try {
    focusArea.value = await focusAreaApi.getFocusArea(focusAreaId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load focus area';
    console.error('Failed to load focus area:', err);
  } finally {
    loading.value = false;
  }
}

// Load patents via the enriched /api/patents endpoint with focusAreaId filter
async function loadPatents() {
  faPatentsLoading.value = true;
  try {
    const response = await patentApi.getPatents(
      {
        page: faPagination.value.page,
        rowsPerPage: faPagination.value.rowsPerPage,
        sortBy: faPagination.value.sortBy,
        descending: faPagination.value.descending
      },
      {
        focusAreaId: focusAreaId.value,
        search: searchText.value || undefined,
        affiliates: selectedAffiliates.value.length > 0 ? selectedAffiliates.value : undefined,
        superSectors: selectedSuperSectors.value.length > 0 ? selectedSuperSectors.value : undefined,
        scoreMin: scoreMin.value ?? undefined,
        scoreMax: scoreMax.value ?? undefined,
        yearsMin: yearsMin.value ?? undefined,
        yearsMax: yearsMax.value ?? undefined,
        competitorCitesMin: competitorCitesMin.value ?? undefined,
        competitorCitesMax: competitorCitesMax.value ?? undefined,
        forwardCitesMin: forwardCitesMin.value ?? undefined,
        forwardCitesMax: forwardCitesMax.value ?? undefined,
      }
    );
    faPatents.value = response.data as Patent[];
    faPatentsTotal.value = response.total;
    faPagination.value.rowsNumber = response.total;
  } catch (err) {
    console.error('Failed to load patents:', err);
  } finally {
    faPatentsLoading.value = false;
  }
}

// Load filter options from API
async function loadFilterOptions() {
  loadingFilters.value = true;
  try {
    const [affiliatesRes, sectorsRes] = await Promise.all([
      fetch('/api/patents/affiliates'),
      fetch('/api/patents/super-sectors')
    ]);
    if (affiliatesRes.ok) affiliateOptions.value = await affiliatesRes.json();
    if (sectorsRes.ok) superSectorOptions.value = await sectorsRes.json();
  } catch (err) {
    console.error('Failed to load filter options:', err);
  } finally {
    loadingFilters.value = false;
  }
}

// Apply filters and reload
function applyFaFilters() {
  faPagination.value.page = 1;
  loadPatents();
}

function onFaSearch() {
  faPagination.value.page = 1;
  loadPatents();
}

function clearFaFilters() {
  searchText.value = '';
  selectedAffiliates.value = [];
  selectedSuperSectors.value = [];
  scoreMin.value = null;
  scoreMax.value = null;
  yearsMin.value = null;
  yearsMax.value = null;
  competitorCitesMin.value = null;
  competitorCitesMax.value = null;
  forwardCitesMin.value = null;
  forwardCitesMax.value = null;
  faPagination.value.page = 1;
  loadPatents();
}

const hasFaFilters = computed(() =>
  !!searchText.value ||
  selectedAffiliates.value.length > 0 ||
  selectedSuperSectors.value.length > 0 ||
  scoreMin.value != null || scoreMax.value != null ||
  yearsMin.value != null || yearsMax.value != null ||
  competitorCitesMin.value != null || competitorCitesMax.value != null ||
  forwardCitesMin.value != null || forwardCitesMax.value != null
);

// Table columns from the patents store
const tableColumns = computed(() =>
  patentsStore.visibleColumns.map(col => ({
    ...col,
    field: typeof col.field === 'function' ? col.field : (row: Patent) => (row as Record<string, unknown>)[col.field as string]
  }))
);

// Pagination model for q-table
const paginationModel = computed({
  get: () => ({
    page: faPagination.value.page,
    rowsPerPage: faPagination.value.rowsPerPage,
    rowsNumber: faPatentsTotal.value,
    sortBy: faPagination.value.sortBy,
    descending: faPagination.value.descending
  }),
  set: (val) => {
    faPagination.value.page = val.page;
    faPagination.value.rowsPerPage = val.rowsPerPage;
    faPagination.value.sortBy = val.sortBy;
    faPagination.value.descending = val.descending;
    loadPatents();
  }
});

// Super-sector color mapping (same as PortfolioPage)
const sectorColors: Record<string, string> = {
  'Security': 'red-7',
  'Virtualization & Cloud': 'purple-7',
  'SDN & Network Infrastructure': 'blue-7',
  'Wireless & RF': 'teal-7',
  'Video & Streaming': 'orange-7',
  'Computing & Data': 'grey-7',
  'Semiconductor': 'indigo-7',
  'Imaging & Optics': 'cyan-7',
  'Audio': 'pink-7',
  'AI & Machine Learning': 'green-7',
  'Fault Tolerance & Reliability': 'amber-7'
};

function getSectorColor(sector: string): string {
  return sectorColors[sector] || 'grey-6';
}

// Start editing
function startEdit() {
  if (!focusArea.value) return;
  editForm.value = {
    name: focusArea.value.name,
    description: focusArea.value.description || ''
  };
  editing.value = true;
}

// Save edits
async function saveEdit() {
  if (!focusArea.value || !editForm.value.name.trim()) return;

  try {
    const updated = await focusAreaApi.updateFocusArea(focusAreaId.value, {
      name: editForm.value.name,
      description: editForm.value.description || undefined
    });
    focusArea.value = { ...focusArea.value, ...updated };
    editing.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save';
  }
}

// Cancel edit
function cancelEdit() {
  editing.value = false;
}

// Navigate to Patent Family Explorer with focus area patents as seeds
function exploreFamilies() {
  // Use first 20 patents as seeds (reasonable limit for exploration)
  const patentIds = faPatents.value.slice(0, 20).map(p => p.patent_id);
  if (patentIds.length === 0) {
    $q.notify({
      type: 'warning',
      message: 'No patents in focus area to explore',
    });
    return;
  }
  router.push({
    name: 'patent-families',
    query: { seeds: patentIds.join(',') }
  });
}

// Add patents
async function addPatents() {
  // Use the same parser as the preview so IDs match
  const ids = parsePatentIds(newPatentIds.value);

  if (ids.length === 0) return;

  addingPatents.value = true;
  try {
    const result = await focusAreaApi.addPatentsToFocusArea(focusAreaId.value, ids);

    // Show success notification
    $q.notify({
      type: 'positive',
      message: `Added ${result.added} patent(s) to focus area`,
      timeout: 3000,
    });

    // Show fetch feedback
    if (result.fetched && result.fetched > 0) {
      $q.notify({
        type: 'positive',
        message: `${result.fetched} patent(s) fetched from PatentsView API`,
        timeout: 3000,
      });
    }
    if (result.fetchFailed && result.fetchFailed > 0) {
      $q.notify({
        type: 'warning',
        message: `${result.fetchFailed} patent(s) could not be fetched (invalid IDs or API error)`,
        timeout: 5000,
      });
    }

    // Refresh
    await Promise.all([loadFocusArea(), loadPatents()]);

    showAddPatentDialog.value = false;
    newPatentIds.value = '';
  } catch (err) {
    // Show error in a notification (not behind the dialog)
    $q.notify({
      type: 'negative',
      message: err instanceof Error ? err.message : 'Failed to add patents',
      timeout: 5000,
    });
  } finally {
    addingPatents.value = false;
  }
}

// Fetch patent data for uncached patents
async function fetchPatentData() {
  fetchingData.value = true;
  try {
    const result = await focusAreaApi.fetchPatentData(focusAreaId.value);
    if (result.fetched > 0) {
      $q.notify({
        type: 'positive',
        message: `Fetched data for ${result.fetched} patent(s) from PatentsView API`,
        timeout: 3000,
      });
      // Refresh the patent list
      await loadPatents();
    } else if (result.uncached === 0) {
      $q.notify({
        type: 'info',
        message: 'All patents already have cached data',
        timeout: 3000,
      });
    }
    if (result.failed > 0) {
      $q.notify({
        type: 'warning',
        message: `${result.failed} patent(s) could not be fetched${result.failedIds ? ': ' + result.failedIds.slice(0, 5).join(', ') + (result.failedIds.length > 5 ? '...' : '') : ''}`,
        timeout: 5000,
      });
    }
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: err instanceof Error ? err.message : 'Failed to fetch patent data',
      timeout: 5000,
    });
  } finally {
    fetchingData.value = false;
  }
}

// Remove patent
async function removePatent(patentId: string) {
  if (!confirm('Remove this patent from the focus area?')) return;

  try {
    await focusAreaApi.removePatentsFromFocusArea(focusAreaId.value, [patentId]);
    faPatents.value = faPatents.value.filter(p => p.patent_id !== patentId);
    faPatentsTotal.value = Math.max(0, faPatentsTotal.value - 1);
    if (focusArea.value) {
      focusArea.value.patentCount--;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to remove patent';
  }
}

// Add search term
async function addSearchTerm() {
  if (!newTerm.value.expression.trim()) return;

  addingTerm.value = true;
  try {
    const term = await focusAreaApi.addSearchTerm(focusAreaId.value, {
      expression: newTerm.value.expression,
      termType: newTerm.value.termType,
      sourceType: 'MANUAL'
    });

    if (focusArea.value) {
      focusArea.value.searchTerms = [...(focusArea.value.searchTerms || []), term];
    }

    showAddTermDialog.value = false;
    newTerm.value = { expression: '', termType: 'KEYWORD' };
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add search term';
  } finally {
    addingTerm.value = false;
  }
}

// Remove search term
async function removeSearchTerm(termId: string) {
  if (!confirm('Remove this search term?')) return;

  try {
    await focusAreaApi.removeSearchTerm(focusAreaId.value, termId);
    if (focusArea.value) {
      focusArea.value.searchTerms = focusArea.value.searchTerms?.filter(t => t.id !== termId);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to remove search term';
  }
}

// Add search term from keyword extraction
async function addTermFromExtraction(expression: string, termType: string) {
  addingTerm.value = true;
  try {
    const term = await focusAreaApi.addSearchTerm(focusAreaId.value, {
      expression,
      termType,
      sourceType: 'FREQUENCY_ANALYSIS'
    });

    if (focusArea.value) {
      focusArea.value.searchTerms = [...(focusArea.value.searchTerms || []), term];
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add search term';
  } finally {
    addingTerm.value = false;
  }
}

// Bulk actions
const removingPatents = ref(false);
const showNewFocusAreaDialog = ref(false);
const newFocusAreaName = ref('');
const newFocusAreaDescription = ref('');
const creatingFocusArea = ref(false);
const newFocusAreaError = ref<string | null>(null);
const newFocusAreaRemoveFromCurrent = ref(false);

async function removeSelectedPatents() {
  if (selectedPatents.value.length === 0) return;
  const ids = selectedPatents.value.map(p => p.patent_id);
  removingPatents.value = true;
  try {
    await focusAreaApi.removePatentsFromFocusArea(focusAreaId.value, ids);
    selectedPatents.value = [];
    await Promise.all([loadFocusArea(), loadPatents()]);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to remove patents';
  } finally {
    removingPatents.value = false;
  }
}

function openNewFocusAreaDialog(removeFromCurrent: boolean) {
  newFocusAreaError.value = null;
  newFocusAreaName.value = '';
  newFocusAreaDescription.value = '';
  newFocusAreaRemoveFromCurrent.value = removeFromCurrent;
  showNewFocusAreaDialog.value = true;
}

async function createNewFocusArea() {
  if (!newFocusAreaName.value.trim() || selectedPatents.value.length === 0) return;
  creatingFocusArea.value = true;
  newFocusAreaError.value = null;
  try {
    const patentIds = selectedPatents.value.map(p => p.patent_id);
    await focusAreaApi.createFocusArea({
      name: newFocusAreaName.value.trim(),
      description: newFocusAreaDescription.value.trim() || undefined,
      ownerId: 'default-user',
      patentIds,
    });
    // Optionally remove from current focus area
    if (newFocusAreaRemoveFromCurrent.value) {
      await focusAreaApi.removePatentsFromFocusArea(focusAreaId.value, patentIds);
      await Promise.all([loadFocusArea(), loadPatents()]);
    }
    showNewFocusAreaDialog.value = false;
    selectedPatents.value = [];
  } catch (err) {
    newFocusAreaError.value = err instanceof Error ? err.message : 'Failed to create focus area';
  } finally {
    creatingFocusArea.value = false;
  }
}

// =============================================================================
// PROMPT TEMPLATES
// =============================================================================

const promptTemplates = ref<PromptTemplate[]>([]);
const promptTemplatesLoading = ref(false);
const selectedTemplate = ref<PromptTemplate | null>(null);
const editingTemplate = ref(false);

// Template editor form
const templateForm = ref({
  name: '',
  description: '',
  promptText: '',
  executionMode: 'PER_PATENT' as 'PER_PATENT' | 'COLLECTIVE',
  contextFields: [] as string[],
  llmModel: 'claude-sonnet-4-20250514'
});

const savingTemplate = ref(false);

// Execution
const executingTemplate = ref(false);
let statusPollTimer: ReturnType<typeof setInterval> | null = null;

// Preview
const previewResult = ref<PromptPreviewResponse | null>(null);
const loadingPreview = ref(false);

// Results
const promptResults = ref<PromptResult[]>([]);
const promptResultsTotal = ref(0);
const promptResultsLoading = ref(false);
const expandedResultId = ref<string | null>(null);
const showVariableRef = ref(false);

// Available models
const llmModelOptions = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-haiku-3-5-20241022', label: 'Claude Haiku 3.5' }
];

const executionModeOptions = [
  { value: 'PER_PATENT', label: 'Per Patent' },
  { value: 'COLLECTIVE', label: 'Collective' }
];

const contextFieldOptions = [
  'patent_title', 'abstract', 'patent_date', 'assignee', 'affiliate',
  'super_sector', 'primary_sector', 'cpc_codes', 'forward_citations',
  'remaining_years', 'score', 'competitor_citations', 'competitor_names',
  'summary', 'technology_category', 'prior_art_problem', 'technical_solution'
];

const patentVariables = [
  'patent_id', 'patent_title', 'abstract', 'patent_date', 'assignee',
  'affiliate', 'super_sector', 'primary_sector', 'cpc_codes',
  'forward_citations', 'remaining_years', 'score',
  'competitor_citations', 'competitor_names',
  'summary', 'technology_category', 'prior_art_problem', 'technical_solution',
  'implementation_type', 'standards_relevance', 'market_segment',
  'eligibility_score', 'validity_score', 'claim_breadth',
  'enforcement_clarity', 'market_relevance_score'
];

const focusAreaVariables = [
  'name', 'description', 'patentIDs', 'patentCount', 'patentData'
];

// Load prompt templates
async function loadPromptTemplates() {
  promptTemplatesLoading.value = true;
  try {
    promptTemplates.value = await focusAreaApi.getPromptTemplates(focusAreaId.value);
  } catch (err) {
    console.error('Failed to load prompt templates:', err);
  } finally {
    promptTemplatesLoading.value = false;
  }
}

// Select template
function selectTemplate(template: PromptTemplate) {
  selectedTemplate.value = template;
  editingTemplate.value = false;
  previewResult.value = null;
  expandedResultId.value = null;

  // Load results for this template
  loadPromptResults(template.id);

  // If running, start polling
  if (template.status === 'RUNNING') {
    startStatusPolling(template.id);
  }
}

// New template
function startNewTemplate() {
  selectedTemplate.value = null;
  editingTemplate.value = true;
  templateForm.value = {
    name: '',
    description: '',
    promptText: '',
    executionMode: 'PER_PATENT',
    contextFields: [],
    llmModel: 'claude-sonnet-4-20250514'
  };
  previewResult.value = null;
  promptResults.value = [];
}

// Edit existing template
function startEditTemplate() {
  if (!selectedTemplate.value) return;
  templateForm.value = {
    name: selectedTemplate.value.name,
    description: selectedTemplate.value.description || '',
    promptText: selectedTemplate.value.promptText || '',
    executionMode: selectedTemplate.value.executionMode,
    contextFields: [...selectedTemplate.value.contextFields],
    llmModel: selectedTemplate.value.llmModel
  };
  editingTemplate.value = true;
}

function cancelEditTemplate() {
  editingTemplate.value = false;
  if (!selectedTemplate.value) {
    // Was creating new — deselect
  }
}

// Save template (create or update)
async function saveTemplate() {
  if (!templateForm.value.name.trim() || !templateForm.value.promptText?.trim()) return;
  savingTemplate.value = true;
  try {
    if (selectedTemplate.value) {
      // Update
      const updated = await focusAreaApi.updatePromptTemplate(
        focusAreaId.value,
        selectedTemplate.value.id,
        {
          name: templateForm.value.name,
          description: templateForm.value.description || undefined,
          promptText: templateForm.value.promptText,
          executionMode: templateForm.value.executionMode,
          contextFields: templateForm.value.contextFields,
          llmModel: templateForm.value.llmModel
        }
      );
      selectedTemplate.value = updated;
      // Update in list
      const idx = promptTemplates.value.findIndex(t => t.id === updated.id);
      if (idx >= 0) promptTemplates.value[idx] = updated;
    } else {
      // Create
      const created = await focusAreaApi.createPromptTemplate(focusAreaId.value, {
        name: templateForm.value.name,
        description: templateForm.value.description || undefined,
        promptText: templateForm.value.promptText,
        executionMode: templateForm.value.executionMode,
        contextFields: templateForm.value.contextFields,
        llmModel: templateForm.value.llmModel
      });
      promptTemplates.value.unshift(created);
      selectedTemplate.value = created;
    }
    editingTemplate.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save template';
  } finally {
    savingTemplate.value = false;
  }
}

// Delete template
async function deleteTemplate() {
  if (!selectedTemplate.value) return;
  if (!confirm(`Delete template "${selectedTemplate.value.name}"?`)) return;
  try {
    await focusAreaApi.deletePromptTemplate(focusAreaId.value, selectedTemplate.value.id);
    promptTemplates.value = promptTemplates.value.filter(t => t.id !== selectedTemplate.value!.id);
    selectedTemplate.value = null;
    editingTemplate.value = false;
    promptResults.value = [];
    previewResult.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete template';
  }
}

// Execute template
async function executeSelectedTemplate() {
  if (!selectedTemplate.value) return;
  executingTemplate.value = true;
  try {
    await focusAreaApi.executePromptTemplate(focusAreaId.value, selectedTemplate.value.id);
    selectedTemplate.value = { ...selectedTemplate.value, status: 'RUNNING', completedCount: 0 };
    // Update in list
    const idx = promptTemplates.value.findIndex(t => t.id === selectedTemplate.value!.id);
    if (idx >= 0) promptTemplates.value[idx] = { ...promptTemplates.value[idx], status: 'RUNNING', completedCount: 0 };
    startStatusPolling(selectedTemplate.value.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to execute template';
  } finally {
    executingTemplate.value = false;
  }
}

// Poll status
function startStatusPolling(templateId: string) {
  stopStatusPolling();
  statusPollTimer = setInterval(async () => {
    try {
      const status = await focusAreaApi.getPromptTemplateStatus(focusAreaId.value, templateId);
      if (selectedTemplate.value && selectedTemplate.value.id === templateId) {
        selectedTemplate.value = {
          ...selectedTemplate.value,
          status: status.status as PromptTemplate['status'],
          completedCount: status.completedCount,
          totalCount: status.totalCount,
          lastRunAt: status.lastRunAt,
          errorMessage: status.errorMessage
        };
      }
      // Update in list
      const idx = promptTemplates.value.findIndex(t => t.id === templateId);
      if (idx >= 0) {
        promptTemplates.value[idx] = {
          ...promptTemplates.value[idx],
          status: status.status as PromptTemplate['status'],
          completedCount: status.completedCount,
          totalCount: status.totalCount
        };
      }
      // Stop polling when done
      if (status.status !== 'RUNNING') {
        stopStatusPolling();
        // Reload results
        loadPromptResults(templateId);
      }
    } catch (err) {
      console.error('Status poll error:', err);
    }
  }, 3000);
}

function stopStatusPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
}

// Preview
async function previewSelectedTemplate() {
  const tid = selectedTemplate.value?.id;
  if (!tid) return;
  loadingPreview.value = true;
  try {
    previewResult.value = await focusAreaApi.previewPromptTemplate(focusAreaId.value, tid);
  } catch (err) {
    console.error('Preview failed:', err);
  } finally {
    loadingPreview.value = false;
  }
}

// Load results
async function loadPromptResults(templateId: string) {
  promptResultsLoading.value = true;
  try {
    const res = await focusAreaApi.getPromptResults(focusAreaId.value, templateId, { page: 1, limit: 200 });
    promptResults.value = res.data;
    promptResultsTotal.value = res.total;
  } catch (err) {
    console.error('Failed to load results:', err);
  } finally {
    promptResultsLoading.value = false;
  }
}

function toggleResultExpand(patentId: string) {
  expandedResultId.value = expandedResultId.value === patentId ? null : patentId;
}

function insertVariable(variable: string) {
  templateForm.value.promptText += variable;
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'DRAFT': return 'grey';
    case 'RUNNING': return 'blue';
    case 'COMPLETE': return 'green';
    case 'ERROR': return 'red';
    default: return 'grey';
  }
}

function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

// Navigate to patent detail
function goToPatent(patentId: string) {
  router.push({ name: 'patent-detail', params: { id: patentId } });
}

// Remove a patent from the input
function removePatentFromInput(patentId: string) {
  const ids = parsePatentIds(newPatentIds.value);
  const remaining = ids.filter(id => id !== patentId);
  newPatentIds.value = remaining.join(', ');
}

// Pagination handler
function onPatentRequest(props: { pagination: typeof paginationModel.value }) {
  faPagination.value.page = props.pagination.page;
  faPagination.value.rowsPerPage = props.pagination.rowsPerPage;
  faPagination.value.sortBy = props.pagination.sortBy;
  faPagination.value.descending = props.pagination.descending;
  loadPatents();
}

// Watch tab changes to load data lazily
watch(activeTab, (tab) => {
  if (tab === 'llm-prompts' && promptTemplates.value.length === 0 && !promptTemplatesLoading.value) {
    loadPromptTemplates();
  }
  // Clean up polling when leaving LLM tab
  if (tab !== 'llm-prompts') {
    stopStatusPolling();
  }
});

// Initialize
onMounted(async () => {
  // Auto-show focus area columns
  patentsStore.setColumnVisibility('fa_membership_type', true);
  patentsStore.setColumnVisibility('fa_match_score', true);

  await loadFocusArea();
  await Promise.all([loadPatents(), loadFilterOptions()]);
});
</script>

<template>
  <q-page padding>
    <!-- Loading -->
    <div v-if="loading" class="row justify-center q-pa-xl">
      <q-spinner size="lg" color="primary" />
    </div>

    <!-- Error -->
    <q-banner v-else-if="error && !focusArea" class="bg-negative text-white">
      {{ error }}
      <template v-slot:action>
        <q-btn flat label="Go Back" @click="router.back()" />
        <q-btn flat label="Retry" @click="loadFocusArea" />
      </template>
    </q-banner>

    <!-- Content -->
    <template v-else-if="focusArea">
      <!-- Breadcrumb -->
      <q-breadcrumbs class="q-mb-md">
        <q-breadcrumbs-el icon="home" to="/" />
        <q-breadcrumbs-el label="Focus Areas" to="/focus-areas" />
        <q-breadcrumbs-el :label="focusArea.name" />
      </q-breadcrumbs>

      <!-- Header -->
      <q-card class="q-mb-md">
        <q-card-section>
          <div class="row items-start">
            <div class="col">
              <!-- View Mode -->
              <template v-if="!editing">
                <div class="row items-center q-mb-xs">
                  <div class="text-h5">{{ focusArea.name }}</div>
                  <q-btn flat round dense icon="edit" class="q-ml-sm" @click="startEdit" />
                </div>
                <div v-if="focusArea.description" class="text-body2 text-grey-7">
                  {{ focusArea.description }}
                </div>
              </template>

              <!-- Edit Mode -->
              <template v-else>
                <q-input
                  v-model="editForm.name"
                  label="Name"
                  dense
                  outlined
                  class="q-mb-sm"
                />
                <q-input
                  v-model="editForm.description"
                  label="Description"
                  dense
                  outlined
                  type="textarea"
                  rows="2"
                />
                <div class="q-mt-sm">
                  <q-btn flat label="Cancel" @click="cancelEdit" />
                  <q-btn color="primary" label="Save" @click="saveEdit" />
                </div>
              </template>
            </div>

            <!-- Stats -->
            <div class="col-auto">
              <div class="row q-gutter-md">
                <div class="text-center">
                  <div class="text-h4 text-primary">{{ focusArea.patentCount }}</div>
                  <div class="text-caption text-grey-7">Patents</div>
                </div>
                <div class="text-center">
                  <div class="text-h4 text-blue">{{ searchTerms.length }}</div>
                  <div class="text-caption text-grey-7">Search Terms</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Metadata Chips -->
          <div class="row q-mt-md q-gutter-sm">
            <q-chip v-if="focusArea.superSector" dense color="grey-3">
              <q-icon name="category" class="q-mr-xs" size="xs" />
              {{ focusArea.superSector }}
            </q-chip>
            <q-chip v-if="focusArea.parent" dense color="grey-3">
              <q-icon name="account_tree" class="q-mr-xs" size="xs" />
              Parent: {{ focusArea.parent.name }}
            </q-chip>
            <q-chip dense :color="focusArea.status === 'ACTIVE' ? 'green-2' : 'grey-3'">
              {{ focusArea.status }}
            </q-chip>
            <q-chip
              dense
              clickable
              :color="focusArea.searchScopeType === 'PORTFOLIO' ? 'grey-3' : 'purple-2'"
              @click="openScopeDialog"
            >
              <q-icon name="filter_alt" class="q-mr-xs" size="xs" />
              Scope: {{ activeScopeLabel }}
              <q-tooltip>Search scope — click to change</q-tooltip>
            </q-chip>
          </div>
        </q-card-section>
      </q-card>

      <!-- Error Banner -->
      <q-banner v-if="error" class="bg-negative text-white q-mb-md">
        {{ error }}
        <template v-slot:action>
          <q-btn flat label="Dismiss" @click="error = null" />
        </template>
      </q-banner>

      <!-- Tabs -->
      <q-tabs v-model="activeTab" class="q-mb-md" align="left" active-color="primary">
        <q-tab name="overview" label="Overview" />
        <q-tab name="patents" label="Patents" :badge="focusArea.patentCount || undefined" />
        <q-tab name="search-terms" label="Search Terms" :badge="searchTerms.length || undefined" />
        <q-tab name="llm-prompts" label="LLM Prompts" :badge="promptTemplates.length || undefined" />
      </q-tabs>

      <q-tab-panels v-model="activeTab" animated>
        <!-- Overview Tab -->
        <q-tab-panel name="overview" class="q-pa-none">
          <div class="row q-col-gutter-md">
            <!-- Info Card -->
            <div class="col-12 col-md-6">
              <q-card flat bordered>
                <q-card-section>
                  <div class="text-subtitle2 q-mb-md">Details</div>
                  <q-list dense>
                    <q-item>
                      <q-item-section avatar>
                        <q-icon name="person" />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label caption>Owner</q-item-label>
                        <q-item-label>{{ focusArea.owner?.name || 'Unknown' }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section avatar>
                        <q-icon name="calendar_today" />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label caption>Created</q-item-label>
                        <q-item-label>{{ new Date(focusArea.createdAt).toLocaleDateString() }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item v-if="focusArea.lastCalculatedAt">
                      <q-item-section avatar>
                        <q-icon name="update" />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label caption>Last Calculated</q-item-label>
                        <q-item-label>{{ new Date(focusArea.lastCalculatedAt).toLocaleString() }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </q-card-section>
              </q-card>
            </div>

            <!-- Quick Actions Card -->
            <div class="col-12 col-md-6">
              <q-card flat bordered>
                <q-card-section>
                  <div class="text-subtitle2 q-mb-md">Quick Actions</div>
                  <div class="column q-gutter-sm">
                    <q-btn outline icon="add" label="Add Patents" @click="showAddPatentDialog = true" />
                    <q-btn outline icon="account_tree" label="Explore Families" @click="exploreFamilies" />
                    <q-btn outline icon="search" label="Add Search Term" @click="showAddTermDialog = true" />
                    <q-btn outline icon="analytics" label="Define Facet" disabled />
                  </div>
                </q-card-section>
              </q-card>
            </div>
          </div>
        </q-tab-panel>

        <!-- Patents Tab -->
        <q-tab-panel name="patents" class="q-pa-none">
          <!-- Toolbar -->
          <div class="row items-center q-mb-md">
            <div class="text-subtitle1 q-mr-md">Member Patents</div>
            <q-badge color="primary" class="q-mr-md">
              {{ faPatentsTotal.toLocaleString() }} patents
            </q-badge>
            <q-space />

            <!-- Search -->
            <q-input
              v-model="searchText"
              dense
              outlined
              placeholder="Search patents..."
              class="q-mr-sm"
              style="width: 250px"
              @keyup.enter="onFaSearch"
            >
              <template v-slot:append>
                <q-icon name="search" class="cursor-pointer" @click="onFaSearch" />
              </template>
            </q-input>

            <!-- Column Selector -->
            <q-btn flat icon="view_column" label="Columns" class="q-mr-sm" @click="showColumnSelector = true" />

            <!-- Add Patents -->
            <q-btn flat icon="add" label="Add" @click="showAddPatentDialog = true" />

            <!-- Fetch Patent Data -->
            <q-btn flat icon="cloud_download" label="Fetch Data" :loading="fetchingData" @click="fetchPatentData">
              <q-tooltip>Fetch data from PatentsView API for uncached patents</q-tooltip>
            </q-btn>

            <!-- Filter Toggle -->
            <q-btn
              flat
              :icon="showFilters ? 'filter_list_off' : 'filter_list'"
              :label="showFilters ? 'Hide Filters' : 'Filters'"
              @click="showFilters = !showFilters"
            />
          </div>

          <!-- Filter Bar -->
          <q-slide-transition>
            <div v-show="showFilters" class="q-mb-md">
              <q-card flat bordered>
                <q-card-section class="q-py-sm">
                  <div class="row q-gutter-md items-center">
                    <q-select
                      v-model="selectedAffiliates"
                      :options="affiliateOptions"
                      option-value="name"
                      option-label="name"
                      emit-value
                      map-options
                      multiple
                      use-chips
                      dense
                      outlined
                      clearable
                      :loading="loadingFilters"
                      label="Affiliate"
                      style="min-width: 200px"
                      @update:model-value="applyFaFilters"
                    >
                      <template v-slot:option="{ itemProps, opt }">
                        <q-item v-bind="itemProps">
                          <q-item-section>
                            <q-item-label>{{ opt.name }}</q-item-label>
                          </q-item-section>
                          <q-item-section side>
                            <q-badge color="grey-6">{{ opt.count.toLocaleString() }}</q-badge>
                          </q-item-section>
                        </q-item>
                      </template>
                    </q-select>

                    <q-select
                      v-model="selectedSuperSectors"
                      :options="superSectorOptions"
                      option-value="name"
                      option-label="name"
                      emit-value
                      map-options
                      multiple
                      use-chips
                      dense
                      outlined
                      clearable
                      :loading="loadingFilters"
                      label="Super-Sector"
                      style="min-width: 220px"
                      @update:model-value="applyFaFilters"
                    >
                      <template v-slot:option="{ itemProps, opt }">
                        <q-item v-bind="itemProps">
                          <q-item-section avatar>
                            <q-badge :color="getSectorColor(opt.name)" />
                          </q-item-section>
                          <q-item-section>
                            <q-item-label>{{ opt.name }}</q-item-label>
                          </q-item-section>
                          <q-item-section side>
                            <q-badge color="grey-6">{{ opt.count.toLocaleString() }}</q-badge>
                          </q-item-section>
                        </q-item>
                      </template>
                    </q-select>

                    <!-- Numeric Range Filters -->
                    <div class="row items-center q-gutter-xs">
                      <span class="text-caption text-grey-7">Score:</span>
                      <q-input v-model.number="scoreMin" type="number" dense outlined placeholder="min" style="width: 80px" @change="applyFaFilters" />
                      <q-input v-model.number="scoreMax" type="number" dense outlined placeholder="max" style="width: 80px" @change="applyFaFilters" />
                    </div>
                    <div class="row items-center q-gutter-xs">
                      <span class="text-caption text-grey-7">Years Left:</span>
                      <q-input v-model.number="yearsMin" type="number" dense outlined placeholder="min" style="width: 80px" @change="applyFaFilters" />
                      <q-input v-model.number="yearsMax" type="number" dense outlined placeholder="max" style="width: 80px" @change="applyFaFilters" />
                    </div>
                    <div class="row items-center q-gutter-xs">
                      <span class="text-caption text-grey-7">Comp. Cites:</span>
                      <q-input v-model.number="competitorCitesMin" type="number" dense outlined placeholder="min" style="width: 80px" @change="applyFaFilters" />
                      <q-input v-model.number="competitorCitesMax" type="number" dense outlined placeholder="max" style="width: 80px" @change="applyFaFilters" />
                    </div>
                    <div class="row items-center q-gutter-xs">
                      <span class="text-caption text-grey-7">Fwd Cites:</span>
                      <q-input v-model.number="forwardCitesMin" type="number" dense outlined placeholder="min" style="width: 80px" @change="applyFaFilters" />
                      <q-input v-model.number="forwardCitesMax" type="number" dense outlined placeholder="max" style="width: 80px" @change="applyFaFilters" />
                    </div>

                    <q-space />

                    <q-btn
                      v-if="hasFaFilters"
                      flat
                      dense
                      color="negative"
                      icon="clear_all"
                      label="Clear All"
                      @click="clearFaFilters"
                    />
                  </div>
                </q-card-section>
              </q-card>
            </div>
          </q-slide-transition>

          <!-- Data Table -->
          <div class="table-scroll-container">
          <q-table
            :rows="faPatents"
            :columns="tableColumns"
            row-key="patent_id"
            v-model:pagination="paginationModel"
            v-model:selected="selectedPatents"
            :loading="faPatentsLoading"
            selection="multiple"
            flat
            bordered
            binary-state-sort
            @row-click="(_evt: Event, row: Patent) => goToPatent(row.patent_id)"
            @request="onPatentRequest"
          >
            <!-- Patent ID as link -->
            <template v-slot:body-cell-patent_id="props">
              <q-td :props="props">
                <router-link
                  :to="{ name: 'patent-detail', params: { id: props.row.patent_id } }"
                  class="text-primary"
                  @click.stop
                >
                  {{ props.row.patent_id }}
                </router-link>
              </q-td>
            </template>

            <!-- Title with truncation -->
            <template v-slot:body-cell-patent_title="props">
              <q-td :props="props">
                <div class="ellipsis" style="max-width: 400px">
                  {{ props.row.patent_title }}
                  <q-tooltip v-if="props.row.patent_title?.length > 60">
                    {{ props.row.patent_title }}
                  </q-tooltip>
                </div>
              </q-td>
            </template>

            <!-- Affiliate -->
            <template v-slot:body-cell-affiliate="props">
              <q-td :props="props">
                <a href="#" class="text-primary" @click.stop.prevent="selectedAffiliates = [props.row.affiliate]; applyFaFilters()">
                  {{ props.row.affiliate }}
                </a>
              </q-td>
            </template>

            <!-- Super-Sector -->
            <template v-slot:body-cell-super_sector="props">
              <q-td :props="props">
                <q-chip
                  dense
                  clickable
                  :color="getSectorColor(props.row.super_sector)"
                  text-color="white"
                  size="sm"
                  @click.stop="selectedSuperSectors = [props.row.super_sector]; applyFaFilters()"
                >
                  {{ props.row.super_sector }}
                </q-chip>
              </q-td>
            </template>

            <!-- Assignee -->
            <template v-slot:body-cell-assignee="props">
              <q-td :props="props">
                <span class="text-secondary text-caption">{{ props.row.assignee }}</span>
              </q-td>
            </template>

            <!-- Primary Sector -->
            <template v-slot:body-cell-primary_sector="props">
              <q-td :props="props">
                <span class="text-caption text-grey-7">{{ props.row.primary_sector }}</span>
              </q-td>
            </template>

            <!-- Score with color coding -->
            <template v-slot:body-cell-score="props">
              <q-td :props="props">
                <q-badge :color="props.row.score > 100 ? 'positive' : props.row.score > 50 ? 'warning' : 'grey'">
                  {{ props.row.score?.toFixed(1) || '-' }}
                </q-badge>
              </q-td>
            </template>

            <!-- Competitor citations -->
            <template v-slot:body-cell-competitor_citations="props">
              <q-td :props="props">
                <span :class="props.row.competitor_citations > 10 ? 'text-bold text-negative' : props.row.competitor_citations > 3 ? 'text-bold text-warning' : ''">
                  {{ props.row.competitor_citations ?? 0 }}
                </span>
              </q-td>
            </template>

            <!-- Competitor count -->
            <template v-slot:body-cell-competitor_count="props">
              <q-td :props="props">
                <span :class="props.row.competitor_count > 3 ? 'text-bold text-negative' : props.row.competitor_count > 1 ? 'text-bold' : ''">
                  {{ props.row.competitor_count ?? 0 }}
                </span>
                <q-tooltip v-if="props.row.competitor_names?.length > 0">
                  {{ props.row.competitor_names.join(', ') }}
                </q-tooltip>
              </q-td>
            </template>

            <!-- LLM Text fields -->
            <template v-slot:body-cell-llm_summary="props">
              <q-td :props="props">
                <div v-if="props.row.llm_summary" class="ellipsis" style="max-width: 300px">
                  {{ props.row.llm_summary }}
                  <q-tooltip max-width="400px" :delay="300">{{ props.row.llm_summary }}</q-tooltip>
                </div>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-llm_prior_art_problem="props">
              <q-td :props="props">
                <div v-if="props.row.llm_prior_art_problem" class="ellipsis" style="max-width: 300px">
                  {{ props.row.llm_prior_art_problem }}
                  <q-tooltip max-width="400px" :delay="300">{{ props.row.llm_prior_art_problem }}</q-tooltip>
                </div>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-llm_technical_solution="props">
              <q-td :props="props">
                <div v-if="props.row.llm_technical_solution" class="ellipsis" style="max-width: 300px">
                  {{ props.row.llm_technical_solution }}
                  <q-tooltip max-width="400px" :delay="300">{{ props.row.llm_technical_solution }}</q-tooltip>
                </div>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <!-- LLM Score columns (1-5 scale) -->
            <template v-slot:body-cell-eligibility_score="props">
              <q-td :props="props">
                <q-badge v-if="props.row.eligibility_score" :color="props.row.eligibility_score >= 4 ? 'positive' : props.row.eligibility_score >= 3 ? 'warning' : 'negative'">
                  {{ props.row.eligibility_score }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-validity_score="props">
              <q-td :props="props">
                <q-badge v-if="props.row.validity_score" :color="props.row.validity_score >= 4 ? 'positive' : props.row.validity_score >= 3 ? 'warning' : 'negative'">
                  {{ props.row.validity_score }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-claim_breadth="props">
              <q-td :props="props">
                <q-badge v-if="props.row.claim_breadth" :color="props.row.claim_breadth >= 4 ? 'positive' : props.row.claim_breadth >= 3 ? 'warning' : 'negative'">
                  {{ props.row.claim_breadth }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-enforcement_clarity="props">
              <q-td :props="props">
                <q-badge v-if="props.row.enforcement_clarity" :color="props.row.enforcement_clarity >= 4 ? 'positive' : props.row.enforcement_clarity >= 3 ? 'warning' : 'negative'">
                  {{ props.row.enforcement_clarity }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-design_around_difficulty="props">
              <q-td :props="props">
                <q-badge v-if="props.row.design_around_difficulty" :color="props.row.design_around_difficulty >= 4 ? 'positive' : props.row.design_around_difficulty >= 3 ? 'warning' : 'negative'">
                  {{ props.row.design_around_difficulty }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-claim_clarity_score="props">
              <q-td :props="props">
                <q-badge v-if="props.row.claim_clarity_score" :color="props.row.claim_clarity_score >= 4 ? 'positive' : props.row.claim_clarity_score >= 3 ? 'warning' : 'negative'">
                  {{ props.row.claim_clarity_score }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-evidence_accessibility_score="props">
              <q-td :props="props">
                <q-badge v-if="props.row.evidence_accessibility_score" :color="props.row.evidence_accessibility_score >= 4 ? 'positive' : props.row.evidence_accessibility_score >= 3 ? 'warning' : 'negative'">
                  {{ props.row.evidence_accessibility_score }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-market_relevance_score="props">
              <q-td :props="props">
                <q-badge v-if="props.row.market_relevance_score" :color="props.row.market_relevance_score >= 4 ? 'positive' : props.row.market_relevance_score >= 3 ? 'warning' : 'negative'">
                  {{ props.row.market_relevance_score }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-trend_alignment_score="props">
              <q-td :props="props">
                <q-badge v-if="props.row.trend_alignment_score" :color="props.row.trend_alignment_score >= 4 ? 'positive' : props.row.trend_alignment_score >= 3 ? 'warning' : 'negative'">
                  {{ props.row.trend_alignment_score }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-investigation_priority_score="props">
              <q-td :props="props">
                <q-badge v-if="props.row.investigation_priority_score" :color="props.row.investigation_priority_score >= 4 ? 'positive' : props.row.investigation_priority_score >= 3 ? 'warning' : 'negative'">
                  {{ props.row.investigation_priority_score }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-llm_confidence="props">
              <q-td :props="props">
                <q-badge v-if="props.row.llm_confidence" color="grey-7">
                  {{ props.row.llm_confidence }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <!-- Composite scores (0-100 scale) -->
            <template v-slot:body-cell-legal_viability_score="props">
              <q-td :props="props">
                <q-badge v-if="props.row.legal_viability_score" :color="props.row.legal_viability_score >= 70 ? 'positive' : props.row.legal_viability_score >= 50 ? 'warning' : 'negative'">
                  {{ Math.round(props.row.legal_viability_score) }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-enforcement_potential_score="props">
              <q-td :props="props">
                <q-badge v-if="props.row.enforcement_potential_score" :color="props.row.enforcement_potential_score >= 70 ? 'positive' : props.row.enforcement_potential_score >= 50 ? 'warning' : 'negative'">
                  {{ Math.round(props.row.enforcement_potential_score) }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-market_value_score="props">
              <q-td :props="props">
                <q-badge v-if="props.row.market_value_score" :color="props.row.market_value_score >= 70 ? 'positive' : props.row.market_value_score >= 50 ? 'warning' : 'negative'">
                  {{ Math.round(props.row.market_value_score) }}
                </q-badge>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <!-- Focus Area columns -->
            <template v-slot:body-cell-fa_membership_type="props">
              <q-td :props="props">
                <q-chip
                  v-if="props.row.fa_membership_type"
                  dense
                  size="sm"
                  :color="props.row.fa_membership_type === 'MANUAL' ? 'grey-4' : 'blue-2'"
                >
                  {{ props.row.fa_membership_type.toLowerCase().replace('_', ' ') }}
                </q-chip>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <template v-slot:body-cell-fa_match_score="props">
              <q-td :props="props">
                <span v-if="props.row.fa_match_score != null">
                  {{ props.row.fa_match_score.toFixed(2) }}
                </span>
                <span v-else class="text-grey-4">--</span>
              </q-td>
            </template>

            <!-- Actions column (remove button) -->
            <template v-slot:body-cell-actions="props">
              <q-td :props="props">
                <q-btn flat dense icon="delete" color="negative" @click.stop="removePatent(props.row.patent_id)" />
              </q-td>
            </template>

            <!-- No data -->
            <template v-slot:no-data>
              <div class="full-width row flex-center text-grey q-pa-xl">
                <q-icon name="folder_open" size="2em" class="q-mr-sm" />
                No patents in this focus area yet
              </div>
            </template>

            <!-- Loading -->
            <template v-slot:loading>
              <q-inner-loading showing color="primary" />
            </template>
          </q-table>
          </div>

          <!-- Column Selector Dialog -->
          <ColumnSelector v-model="showColumnSelector" />
        </q-tab-panel>

        <!-- Search Terms Tab -->
        <q-tab-panel name="search-terms" class="q-pa-none">
          <!-- Keyword Extraction Panel -->
          <KeywordExtractionPanel
            v-if="focusArea"
            :focus-area-id="focusArea.id"
            :patent-count="focusArea.patentCount"
            class="q-mb-md"
            @add-term="addTermFromExtraction"
          />

          <q-card flat bordered>
            <q-card-section class="q-pb-none">
              <div class="row items-center">
                <div class="text-subtitle2">Search Terms</div>
                <q-space />
                <q-btn flat dense icon="add" label="Add Term" @click="showAddTermDialog = true" />
              </div>
            </q-card-section>

            <q-card-section>
              <!-- Empty State -->
              <div v-if="searchTerms.length === 0" class="text-center q-pa-xl text-grey-6">
                <q-icon name="search_off" size="3em" />
                <div class="q-mt-md">No search terms defined</div>
                <q-btn flat color="primary" label="Add First Term" class="q-mt-sm" @click="showAddTermDialog = true" />
              </div>

              <!-- Terms List -->
              <q-list v-else separator>
                <q-item v-for="term in searchTerms" :key="term.id">
                  <q-item-section avatar>
                    <q-icon name="search" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-weight-medium">
                      <code>{{ term.expression }}</code>
                    </q-item-label>
                    <q-item-label caption>
                      {{ term.termType }} | Source: {{ term.sourceType.toLowerCase().replace('_', ' ') }}
                    </q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <div class="row q-gutter-sm items-center">
                      <q-badge v-if="term.hitCountPortfolio" color="grey-6" outline>
                        {{ term.hitCountPortfolio }} hits
                      </q-badge>
                      <q-btn flat dense icon="delete" color="negative" @click="removeSearchTerm(term.id)" />
                    </div>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>
        </q-tab-panel>

        <!-- LLM Prompts Tab -->
        <q-tab-panel name="llm-prompts" class="q-pa-none">
          <div class="row q-col-gutter-md" style="min-height: 500px">
            <!-- Left Panel: Template List + Editor -->
            <div class="col-12 col-md-5">
              <!-- Template List -->
              <q-card flat bordered class="q-mb-md">
                <q-card-section class="q-pb-none">
                  <div class="row items-center">
                    <div class="text-subtitle2">Prompt Templates</div>
                    <q-space />
                    <q-btn flat dense icon="add" label="New" @click="startNewTemplate" />
                  </div>
                </q-card-section>
                <q-card-section>
                  <div v-if="promptTemplatesLoading" class="text-center q-pa-md">
                    <q-spinner size="sm" />
                  </div>
                  <div v-else-if="promptTemplates.length === 0 && !editingTemplate" class="text-center q-pa-lg text-grey-6">
                    <q-icon name="auto_awesome" size="2em" />
                    <div class="q-mt-sm">No prompt templates yet</div>
                    <q-btn flat color="primary" label="Create First Template" class="q-mt-sm" @click="startNewTemplate" />
                  </div>
                  <q-list v-else separator>
                    <q-item
                      v-for="tmpl in promptTemplates"
                      :key="tmpl.id"
                      clickable
                      :active="selectedTemplate?.id === tmpl.id"
                      active-class="bg-blue-1"
                      @click="selectTemplate(tmpl)"
                    >
                      <q-item-section>
                        <q-item-label class="text-weight-medium">{{ tmpl.name }}</q-item-label>
                        <q-item-label caption>
                          {{ tmpl.executionMode === 'PER_PATENT' ? 'Per Patent' : 'Collective' }}
                          <span v-if="tmpl.lastRunAt"> | Last run: {{ new Date(tmpl.lastRunAt).toLocaleDateString() }}</span>
                        </q-item-label>
                      </q-item-section>
                      <q-item-section side>
                        <q-badge
                          :color="getStatusColor(tmpl.status)"
                          :label="tmpl.status === 'RUNNING' ? `${tmpl.completedCount}/${tmpl.totalCount}` : tmpl.status"
                        />
                      </q-item-section>
                    </q-item>
                  </q-list>
                </q-card-section>
              </q-card>

              <!-- Template Editor -->
              <q-card v-if="editingTemplate" flat bordered>
                <q-card-section class="q-pb-sm">
                  <div class="text-subtitle2">{{ selectedTemplate ? 'Edit Template' : 'New Template' }}</div>
                </q-card-section>
                <q-card-section class="q-pt-none">
                  <q-input
                    v-model="templateForm.name"
                    label="Name *"
                    outlined
                    dense
                    class="q-mb-sm"
                    placeholder="e.g., POS Relevance Analysis"
                  />
                  <q-input
                    v-model="templateForm.description"
                    label="Description"
                    outlined
                    dense
                    class="q-mb-sm"
                    placeholder="Brief description..."
                  />
                  <div class="row q-gutter-sm q-mb-sm">
                    <q-select
                      v-model="templateForm.executionMode"
                      :options="executionModeOptions"
                      label="Execution Mode"
                      outlined
                      dense
                      emit-value
                      map-options
                      class="col"
                    />
                    <q-select
                      v-model="templateForm.llmModel"
                      :options="llmModelOptions"
                      label="Model"
                      outlined
                      dense
                      emit-value
                      map-options
                      class="col"
                    />
                  </div>
                  <q-select
                    v-model="templateForm.contextFields"
                    :options="contextFieldOptions"
                    label="Context Fields (for collective mode)"
                    outlined
                    dense
                    multiple
                    use-chips
                    class="q-mb-sm"
                  />

                  <!-- Variable Reference Toggle -->
                  <q-btn
                    flat
                    dense
                    size="sm"
                    :icon="showVariableRef ? 'expand_less' : 'expand_more'"
                    :label="showVariableRef ? 'Hide Variables' : 'Show Available Variables'"
                    class="q-mb-xs"
                    @click="showVariableRef = !showVariableRef"
                  />

                  <q-slide-transition>
                    <div v-show="showVariableRef" class="variable-ref q-mb-sm">
                      <div class="text-caption text-weight-medium q-mb-xs">Patent fields:</div>
                      <div class="variable-chips">
                        <q-chip
                          v-for="v in patentVariables"
                          :key="v"
                          dense
                          clickable
                          size="sm"
                          color="blue-1"
                          text-color="blue-9"
                          @click="insertVariable(`{patent.${v}}`)"
                        >
                          {patent.{{ v }}}
                        </q-chip>
                      </div>
                      <div class="text-caption text-weight-medium q-mt-sm q-mb-xs">Focus Area fields (collective mode):</div>
                      <div class="variable-chips">
                        <q-chip
                          v-for="v in focusAreaVariables"
                          :key="v"
                          dense
                          clickable
                          size="sm"
                          color="purple-1"
                          text-color="purple-9"
                          @click="insertVariable(`{focusArea.${v}}`)"
                        >
                          {focusArea.{{ v }}}
                        </q-chip>
                      </div>
                    </div>
                  </q-slide-transition>

                  <q-input
                    v-model="templateForm.promptText"
                    label="Prompt Text *"
                    outlined
                    type="textarea"
                    rows="10"
                    class="prompt-textarea"
                    placeholder="Analyze this patent for relevance...&#10;&#10;Patent: {patent.patent_id} - {patent.patent_title}&#10;Abstract: {patent.abstract}&#10;&#10;Return JSON: { &quot;relevance_score&quot;: 1-5, ... }"
                  />

                  <div class="row q-mt-sm q-gutter-sm">
                    <q-btn outline label="Cancel" @click="cancelEditTemplate" />
                    <q-space />
                    <q-btn
                      v-if="selectedTemplate"
                      flat
                      color="negative"
                      icon="delete"
                      label="Delete"
                      @click="deleteTemplate"
                    />
                    <q-btn
                      color="primary"
                      icon="save"
                      label="Save"
                      :loading="savingTemplate"
                      :disable="!templateForm.name.trim() || !templateForm.promptText?.trim()"
                      @click="saveTemplate"
                    />
                  </div>
                </q-card-section>
              </q-card>

              <!-- Template Detail (view mode) -->
              <q-card v-else-if="selectedTemplate" flat bordered>
                <q-card-section class="q-pb-sm">
                  <div class="row items-center">
                    <div class="text-subtitle2">{{ selectedTemplate.name }}</div>
                    <q-space />
                    <q-btn flat dense icon="edit" @click="startEditTemplate" />
                  </div>
                  <div v-if="selectedTemplate.description" class="text-caption text-grey-7">
                    {{ selectedTemplate.description }}
                  </div>
                </q-card-section>
                <q-card-section class="q-pt-none">
                  <div class="row q-gutter-sm q-mb-sm">
                    <q-chip dense size="sm" :color="selectedTemplate.executionMode === 'PER_PATENT' ? 'blue-2' : 'purple-2'">
                      {{ selectedTemplate.executionMode === 'PER_PATENT' ? 'Per Patent' : 'Collective' }}
                    </q-chip>
                    <q-chip dense size="sm" color="grey-3">
                      {{ selectedTemplate.llmModel }}
                    </q-chip>
                    <q-chip v-if="selectedTemplate.contextFields.length > 0" dense size="sm" color="grey-3">
                      {{ selectedTemplate.contextFields.length }} context fields
                    </q-chip>
                  </div>
                  <div class="prompt-display q-mb-md">
                    <pre class="prompt-text">{{ selectedTemplate.promptText || '(Structured template — view in Prompt Templates page)' }}</pre>
                  </div>
                  <div class="row q-gutter-sm">
                    <q-btn
                      outline
                      icon="visibility"
                      label="Preview"
                      :loading="loadingPreview"
                      @click="previewSelectedTemplate"
                    />
                    <q-btn
                      color="primary"
                      icon="play_arrow"
                      label="Execute"
                      :loading="executingTemplate"
                      :disable="selectedTemplate.status === 'RUNNING'"
                      @click="executeSelectedTemplate"
                    />
                    <q-btn
                      flat
                      color="negative"
                      icon="delete"
                      label="Delete"
                      @click="deleteTemplate"
                    />
                  </div>
                </q-card-section>
              </q-card>
            </div>

            <!-- Right Panel: Results -->
            <div class="col-12 col-md-7">
              <!-- Preview Card -->
              <q-card v-if="previewResult" flat bordered class="q-mb-md">
                <q-card-section class="q-pb-sm">
                  <div class="row items-center">
                    <div class="text-subtitle2">Preview</div>
                    <q-chip v-if="previewResult.patentId" dense size="sm" color="blue-2" class="q-ml-sm">
                      Patent: {{ previewResult.patentId }}
                    </q-chip>
                    <q-chip dense size="sm" color="grey-3" class="q-ml-sm">
                      {{ previewResult.patentCount }} patents in focus area
                    </q-chip>
                    <q-space />
                    <q-btn flat dense icon="close" @click="previewResult = null" />
                  </div>
                </q-card-section>
                <q-card-section class="q-pt-none">
                  <div class="prompt-display">
                    <pre class="prompt-text">{{ previewResult.resolvedPrompt }}</pre>
                  </div>
                </q-card-section>
              </q-card>

              <!-- Status Bar -->
              <q-card v-if="selectedTemplate" flat bordered class="q-mb-md">
                <q-card-section class="q-py-sm">
                  <div class="row items-center q-gutter-sm">
                    <q-badge :color="getStatusColor(selectedTemplate.status)" :label="selectedTemplate.status" />
                    <template v-if="selectedTemplate.status === 'RUNNING'">
                      <q-spinner size="xs" color="blue" />
                      <span class="text-caption">
                        {{ selectedTemplate.completedCount }} / {{ selectedTemplate.totalCount }} patents
                      </span>
                      <q-linear-progress
                        :value="selectedTemplate.totalCount > 0 ? selectedTemplate.completedCount / selectedTemplate.totalCount : 0"
                        color="primary"
                        class="col"
                        rounded
                        size="8px"
                      />
                    </template>
                    <template v-else-if="selectedTemplate.status === 'COMPLETE'">
                      <span class="text-caption text-green">
                        {{ selectedTemplate.completedCount }} / {{ selectedTemplate.totalCount }} complete
                      </span>
                      <span v-if="selectedTemplate.lastRunAt" class="text-caption text-grey">
                        | {{ new Date(selectedTemplate.lastRunAt).toLocaleString() }}
                      </span>
                    </template>
                    <template v-else-if="selectedTemplate.status === 'ERROR'">
                      <span class="text-caption text-red">{{ selectedTemplate.errorMessage }}</span>
                    </template>
                    <q-space />
                    <span class="text-caption text-grey">{{ promptResultsTotal }} results</span>
                  </div>
                </q-card-section>
              </q-card>

              <!-- Results -->
              <q-card v-if="selectedTemplate && promptResults.length > 0" flat bordered>
                <q-card-section class="q-pb-none">
                  <div class="text-subtitle2">Results</div>
                </q-card-section>
                <q-card-section>
                  <div v-if="promptResultsLoading" class="text-center q-pa-md">
                    <q-spinner size="sm" />
                  </div>

                  <!-- Per-Patent Results -->
                  <template v-else-if="selectedTemplate.executionMode === 'PER_PATENT'">
                    <q-list separator class="results-list">
                      <q-item
                        v-for="result in promptResults"
                        :key="result.patentId || 'collective'"
                        clickable
                        @click="toggleResultExpand(result.patentId || '_collective')"
                      >
                        <q-item-section avatar>
                          <q-icon
                            :name="result.response ? 'check_circle' : 'error'"
                            :color="result.response ? 'green' : 'orange'"
                            size="sm"
                          />
                        </q-item-section>
                        <q-item-section>
                          <q-item-label class="text-weight-medium">
                            {{ result.patentId || 'Collective Result' }}
                          </q-item-label>
                          <q-item-label caption>
                            {{ new Date(result.executedAt).toLocaleString() }}
                            <span v-if="result.inputTokens">
                              | {{ result.inputTokens }} in / {{ result.outputTokens }} out tokens
                            </span>
                          </q-item-label>
                        </q-item-section>
                        <q-item-section side>
                          <q-icon
                            :name="expandedResultId === (result.patentId || '_collective') ? 'expand_less' : 'expand_more'"
                          />
                        </q-item-section>
                      </q-item>

                      <!-- Expanded result detail -->
                      <template v-for="result in promptResults" :key="'detail-' + (result.patentId || '_collective')">
                        <q-slide-transition>
                          <div v-show="expandedResultId === (result.patentId || '_collective')" class="result-detail">
                            <div class="result-json-container">
                              <pre class="result-json">{{ result.response ? formatJson(result.response) : (result.rawText || 'No response') }}</pre>
                            </div>
                            <q-expansion-item dense label="Show sent prompt" class="q-mt-xs">
                              <div class="prompt-display q-pa-sm">
                                <pre class="prompt-text" style="font-size: 0.75em">{{ result.promptSent }}</pre>
                              </div>
                            </q-expansion-item>
                          </div>
                        </q-slide-transition>
                      </template>
                    </q-list>
                  </template>

                  <!-- Collective Result -->
                  <template v-else>
                    <div v-for="result in promptResults" :key="'coll-' + result.templateId" class="result-detail">
                      <div class="text-caption text-grey q-mb-xs">
                        {{ new Date(result.executedAt).toLocaleString() }}
                        <span v-if="result.inputTokens">
                          | {{ result.inputTokens }} in / {{ result.outputTokens }} out tokens
                        </span>
                      </div>
                      <div class="result-json-container">
                        <pre class="result-json">{{ result.response ? formatJson(result.response) : (result.rawText || 'No response') }}</pre>
                      </div>
                      <q-expansion-item dense label="Show sent prompt" class="q-mt-sm">
                        <div class="prompt-display q-pa-sm">
                          <pre class="prompt-text" style="font-size: 0.75em">{{ result.promptSent }}</pre>
                        </div>
                      </q-expansion-item>
                    </div>
                  </template>
                </q-card-section>
              </q-card>

              <!-- Empty state for results -->
              <q-card v-else-if="selectedTemplate && !promptResultsLoading" flat bordered>
                <q-card-section class="text-center q-pa-xl text-grey-6">
                  <q-icon name="science" size="3em" />
                  <div class="q-mt-md">No results yet</div>
                  <div class="text-caption">Click "Execute" to run this template against focus area patents</div>
                </q-card-section>
              </q-card>

              <!-- No template selected -->
              <q-card v-else-if="!editingTemplate" flat bordered>
                <q-card-section class="text-center q-pa-xl text-grey-5">
                  <q-icon name="arrow_back" size="2em" />
                  <div class="q-mt-md">Select or create a template to view results</div>
                </q-card-section>
              </q-card>
            </div>
          </div>
        </q-tab-panel>
      </q-tab-panels>
    </template>

    <!-- Bulk Actions (when items selected) -->
    <q-page-sticky v-if="selectedPatents.length > 0" position="bottom" :offset="[0, 18]">
      <q-banner class="bg-primary text-white">
        <template v-slot:avatar>
          <q-icon name="check_circle" />
        </template>
        {{ selectedPatents.length }} patents selected
        <template v-slot:action>
          <q-btn flat icon="delete" label="Remove from Focus Area" :loading="removingPatents" @click="removeSelectedPatents" />
          <q-btn flat icon="drive_file_move" label="Move to New Focus Area" @click="openNewFocusAreaDialog(true)" />
          <q-btn flat icon="content_copy" label="Copy to New Focus Area" @click="openNewFocusAreaDialog(false)" />
          <q-btn flat label="Clear" @click="selectedPatents = []" />
        </template>
      </q-banner>
    </q-page-sticky>

    <!-- Create New Focus Area Dialog -->
    <q-dialog v-model="showNewFocusAreaDialog" persistent>
      <q-card style="min-width: 450px">
        <q-card-section class="row items-center">
          <q-avatar :icon="newFocusAreaRemoveFromCurrent ? 'drive_file_move' : 'content_copy'" color="primary" text-color="white" />
          <span class="q-ml-sm text-h6">{{ newFocusAreaRemoveFromCurrent ? 'Move' : 'Copy' }} to New Focus Area</span>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <div class="text-body2 text-grey-7 q-mb-md">
            {{ newFocusAreaRemoveFromCurrent
              ? `Moving ${selectedPatents.length} patents out of "${focusArea?.name}" into a new focus area.`
              : `Copying ${selectedPatents.length} patents into a new focus area (they will remain in "${focusArea?.name}").`
            }}
          </div>

          <q-input
            v-model="newFocusAreaName"
            label="Focus Area Name *"
            outlined
            autofocus
            :rules="[val => !!val?.trim() || 'Name is required']"
            class="q-mb-md"
            placeholder="e.g., High-Score Container Patents"
          />

          <q-input
            v-model="newFocusAreaDescription"
            label="Description (optional)"
            outlined
            type="textarea"
            rows="2"
            placeholder="Brief description of this focus area..."
          />

          <q-banner v-if="newFocusAreaError" class="bg-negative text-white q-mt-md">
            {{ newFocusAreaError }}
          </q-banner>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            :icon="newFocusAreaRemoveFromCurrent ? 'drive_file_move' : 'content_copy'"
            :label="newFocusAreaRemoveFromCurrent ? 'Move to New Focus Area' : 'Copy to New Focus Area'"
            :loading="creatingFocusArea"
            :disable="!newFocusAreaName.trim()"
            @click="createNewFocusArea"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Patent Dialog -->
    <q-dialog v-model="showAddPatentDialog" persistent>
      <q-card style="min-width: 550px; max-width: 700px">
        <q-card-section class="row items-center">
          <div class="text-h6">Add Patents</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup @click="newPatentIds = ''" />
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newPatentIds"
            label="Patent IDs"
            outlined
            type="textarea"
            rows="3"
            hint="Enter patent IDs separated by commas, spaces, or newlines"
            placeholder="10378893, 10445123, 10567890"
            autofocus
          />

          <!-- Preview Section -->
          <div v-if="parsedPatentIds.length > 0" class="q-mt-md">
            <div class="row items-center q-mb-sm">
              <div class="text-subtitle2">Preview</div>
              <q-space />
              <div class="text-caption text-grey">
                <q-spinner v-if="loadingPreviews" size="xs" class="q-mr-xs" />
                <span v-if="previewStats.found > 0" class="text-positive">
                  {{ previewStats.found }} found
                </span>
                <span v-if="previewStats.notFound > 0" class="text-negative q-ml-sm">
                  {{ previewStats.notFound }} not in portfolio
                </span>
              </div>
            </div>

            <div class="patent-chips-container">
              <template v-for="id in parsedPatentIds" :key="id">
                <PatentPreviewTooltip
                  v-if="patentPreviews[id] !== undefined"
                  :patent-id="id"
                >
                  <q-chip
                    dense
                    :color="patentPreviews[id] ? 'blue-2' : 'red-2'"
                    :text-color="patentPreviews[id] ? 'blue-9' : 'red-9'"
                    :icon="patentPreviews[id] ? 'check_circle' : 'error'"
                    size="sm"
                    removable
                    @remove="removePatentFromInput(id)"
                  >
                    {{ id }}
                  </q-chip>
                </PatentPreviewTooltip>
                <q-chip
                  v-else
                  dense
                  color="grey-3"
                  size="sm"
                >
                  <q-spinner size="xs" class="q-mr-xs" />
                  {{ id }}
                </q-chip>
              </template>
            </div>

            <!-- Info about found patents -->
            <div v-if="Object.values(patentPreviews).some(p => p !== null)" class="q-mt-sm text-caption text-grey-7">
              Hover over patents to see details
            </div>
          </div>

          <!-- Too many patents warning -->
          <q-banner v-if="parsedPatentIds.length > 50" class="q-mt-md bg-orange-1 text-orange-9">
            <template v-slot:avatar>
              <q-icon name="warning" color="orange" />
            </template>
            Preview limited to 50 patents. All entered IDs will still be added.
          </q-banner>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup @click="newPatentIds = ''" />
          <q-btn
            color="primary"
            :label="`Add ${parsedPatentIds.length} Patents`"
            :loading="addingPatents"
            :disable="parsedPatentIds.length === 0"
            @click="addPatents"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Search Scope Dialog -->
    <q-dialog v-model="showScopeDialog">
      <q-card style="min-width: 500px; max-width: 600px">
        <q-card-section class="row items-center">
          <div class="text-h6">Search Scope</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="text-caption text-grey-7 q-mb-md">
            The search scope limits which patents are considered when evaluating search terms.
            A narrower scope produces more meaningful selectivity ratios.
          </div>

          <q-select
            v-model="pendingScopeType"
            :options="[
              { value: 'PORTFOLIO', label: 'Full Portfolio' },
              { value: 'SUPER_SECTOR', label: 'Super-Sector(s)' },
              { value: 'SECTOR', label: 'Sector(s)' }
            ]"
            label="Scope Type"
            outlined
            emit-value
            map-options
            class="q-mb-md"
          />

          <!-- Super-sector selection -->
          <template v-if="pendingScopeType === 'SUPER_SECTOR'">
            <div class="text-subtitle2 q-mb-sm">Select Super-Sectors</div>
            <div v-if="loadingScopeOptions" class="q-pa-sm">
              <q-spinner size="sm" /> Loading...
            </div>
            <div v-else-if="scopeOptions?.superSectors" class="scope-chips-container">
              <q-chip
                v-for="ss in scopeOptions.superSectors"
                :key="ss.term"
                dense
                clickable
                :color="(pendingScopeConfig.superSectors || []).includes(ss.term) ? 'purple-3' : 'grey-3'"
                @click="toggleScopeSuperSector(ss.term)"
              >
                {{ formatScopeLabel(ss.term) }}
                <q-badge color="grey-6" text-color="white" class="q-ml-xs">{{ ss.count.toLocaleString() }}</q-badge>
              </q-chip>
            </div>
          </template>

          <!-- Sector selection -->
          <template v-if="pendingScopeType === 'SECTOR'">
            <div class="text-subtitle2 q-mb-sm">Select Sectors</div>
            <div v-if="loadingScopeOptions" class="q-pa-sm">
              <q-spinner size="sm" /> Loading...
            </div>
            <div v-else-if="scopeOptions?.sectors" class="scope-chips-container">
              <q-chip
                v-for="s in scopeOptions.sectors"
                :key="s.term"
                dense
                clickable
                :color="(pendingScopeConfig.sectors || []).includes(s.term) ? 'purple-3' : 'grey-3'"
                @click="toggleScopeSector(s.term)"
              >
                {{ formatScopeLabel(s.term) }}
                <q-badge color="grey-6" text-color="white" class="q-ml-xs">{{ s.count.toLocaleString() }}</q-badge>
              </q-chip>
            </div>
          </template>

          <!-- Selected summary -->
          <div v-if="pendingScopeType !== 'PORTFOLIO'" class="q-mt-md text-caption">
            <template v-if="pendingScopeType === 'SUPER_SECTOR' && pendingScopeConfig.superSectors?.length">
              Selected: {{ pendingScopeConfig.superSectors.map(formatScopeLabel).join(', ') }}
            </template>
            <template v-else-if="pendingScopeType === 'SECTOR' && pendingScopeConfig.sectors?.length">
              Selected: {{ pendingScopeConfig.sectors.map(formatScopeLabel).join(', ') }}
            </template>
            <template v-else>
              <span class="text-orange">No selections — will use full portfolio</span>
            </template>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Save Scope"
            @click="saveScope"
            :disable="pendingScopeType !== 'PORTFOLIO' &&
              !(pendingScopeConfig.sectors?.length || pendingScopeConfig.superSectors?.length)"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Search Term Dialog -->
    <q-dialog v-model="showAddTermDialog">
      <q-card style="min-width: 500px">
        <q-card-section class="row items-center">
          <div class="text-h6">Add Search Term</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <q-select
            v-model="newTerm.termType"
            :options="termTypeOptions"
            label="Term Type"
            outlined
            emit-value
            map-options
            class="q-mb-md"
          />

          <q-input
            v-model="newTerm.expression"
            label="Search Expression"
            outlined
            :placeholder="newTerm.termType === 'BOOLEAN' ? 'container AND (security OR isolation)' : 'container security'"
            :hint="newTerm.termType === 'PROXIMITY' ? 'Use W/N syntax, e.g., container W/3 security' : ''"
            @keyup.enter="triggerTermPreview"
          />

          <!-- Search Fields + Search Button -->
          <div class="row q-gutter-sm q-mt-sm items-center">
            <q-select
              v-model="termSearchFields"
              :options="searchFieldOptions"
              label="Search In"
              outlined
              dense
              emit-value
              map-options
              style="min-width: 170px"
            />
            <q-btn
              color="primary"
              icon="search"
              label="Search"
              :loading="loadingTermPreview"
              :disable="!newTerm.expression.trim()"
              @click="triggerTermPreview"
            />
          </div>

          <!-- Hit Preview (always visible) -->
          <div class="q-mt-md">
            <div class="text-subtitle2 q-mb-sm">Hit Preview</div>

            <template v-if="loadingTermPreview">
              <div class="row items-center q-gutter-sm">
                <q-spinner size="xs" />
                <span class="text-caption text-grey">Searching...</span>
              </div>
            </template>

            <template v-else-if="termPreviewResult">
              <div class="row q-gutter-md q-mb-sm items-center">
                <q-chip dense color="grey-2" icon="public" size="sm">
                  <span class="text-weight-medium">Portfolio:</span>
                  <span class="q-ml-xs">{{ termPreviewResult.hitCounts.portfolio.toLocaleString() }}</span>
                  <q-tooltip>Patents in the full portfolio matching this search term</q-tooltip>
                </q-chip>
                <q-chip
                  v-if="termPreviewResult.hitCounts.scope !== undefined"
                  dense
                  color="purple-2"
                  icon="filter_alt"
                  size="sm"
                >
                  <span class="text-weight-medium">Scope:</span>
                  <span class="q-ml-xs">{{ termPreviewResult.hitCounts.scope.toLocaleString() }}</span>
                  <span v-if="termPreviewResult.scopeTotal" class="text-grey-7 q-ml-xs">
                    / {{ termPreviewResult.scopeTotal.toLocaleString() }}
                  </span>
                  <q-tooltip>
                    Hits within search scope ({{ activeScopeLabel }}){{ termPreviewResult.scopeTotal ? ` out of ${termPreviewResult.scopeTotal.toLocaleString()} patents in scope` : '' }}
                  </q-tooltip>
                </q-chip>
                <q-chip
                  v-if="termPreviewResult.hitCounts.focusArea !== undefined"
                  dense
                  color="blue-2"
                  icon="folder"
                  size="sm"
                >
                  <span class="text-weight-medium">Focus Area:</span>
                  <span class="q-ml-xs">{{ termPreviewResult.hitCounts.focusArea.toLocaleString() }}</span>
                  <q-tooltip>Patents in this focus area matching this search term</q-tooltip>
                </q-chip>
                <q-chip
                  v-if="termPreviewResult.hitCounts.focusArea !== undefined && (termPreviewResult.hitCounts.scope ?? termPreviewResult.hitCounts.portfolio) > 0"
                  dense
                  :color="termSelectivityRatio > 0.05 ? 'green-2' : termSelectivityRatio > 0.01 ? 'orange-2' : 'red-2'"
                  :text-color="termSelectivityRatio > 0.05 ? 'green-9' : termSelectivityRatio > 0.01 ? 'orange-9' : 'red-9'"
                  icon="tune"
                  size="sm"
                >
                  Focus Ratio: {{ (termSelectivityRatio * 100).toFixed(2) }}%
                  <q-tooltip>
                    Focus area hits / {{ termPreviewResult.hitCounts.scope !== undefined ? 'scope' : 'portfolio' }} hits. Higher = search term captures more of this focus area.
                  </q-tooltip>
                </q-chip>
              </div>

              <!-- Sample matches -->
              <div v-if="termPreviewResult.sampleHits?.length" class="sample-matches">
                <div class="text-caption text-grey-7 q-mb-xs">Sample matches:</div>
                <div
                  v-for="hit in termPreviewResult.sampleHits.slice(0, 3)"
                  :key="hit.patentId"
                  class="sample-match-row"
                >
                  <span class="text-weight-medium text-primary">{{ hit.patentId }}</span>
                  <span class="text-grey-7 q-ml-sm" v-html="hit.highlight || hit.title.substring(0, 50) + '...'"></span>
                </div>
              </div>

              <div v-else class="text-caption text-grey-6">
                No matches found
              </div>
            </template>

            <template v-else>
              <div class="text-caption text-grey-6">
                Click Search to preview hits
              </div>
            </template>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            label="Add Term"
            :loading="addingTerm"
            :disable="!newTerm.expression.trim()"
            @click="addSearchTerm"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
code {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Fira Code', monospace;
}

.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-scroll-container {
  max-height: calc(100vh - 260px);
  /* ALWAYS show both scrollbars */
  overflow: scroll !important;
}

/* Custom scrollbar styling - larger and always visible */
.table-scroll-container::-webkit-scrollbar {
  width: 16px;
  height: 16px;
  -webkit-appearance: none;
}

.table-scroll-container::-webkit-scrollbar-track {
  background: #e8e8e8;
}

.table-scroll-container::-webkit-scrollbar-thumb {
  background: #999;
  border: 3px solid #e8e8e8;
  border-radius: 8px;
}

.table-scroll-container::-webkit-scrollbar-thumb:hover {
  background: #666;
}

.table-scroll-container::-webkit-scrollbar-corner {
  background: #e8e8e8;
}

/* Firefox scrollbar - always visible */
.table-scroll-container {
  scrollbar-width: auto;
  scrollbar-color: #999 #e8e8e8;
}

/* Pin selection checkbox column */
:deep(.q-table td:first-child),
:deep(.q-table th:first-child) {
  position: sticky;
  left: 0;
  z-index: 1;
  background: #fff;
}

/* Pin patent_id column */
:deep(.q-table td:nth-child(2)),
:deep(.q-table th:nth-child(2)) {
  position: sticky;
  left: 48px;
  z-index: 1;
  background: #fff;
  box-shadow: 2px 0 4px -2px rgba(0, 0, 0, 0.1);
}

/* Header row stays pinned */
:deep(.q-table thead th) {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fff;
}

/* Corner cells get highest z-index */
:deep(.q-table thead th:first-child),
:deep(.q-table thead th:nth-child(2)) {
  z-index: 3;
}

:deep(.q-table tbody tr) {
  cursor: pointer;
}

:deep(.q-table tbody tr:hover) {
  background-color: rgba(0, 0, 0, 0.03);
}

.patent-chips-container {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}

.sample-matches {
  background: #f8f9fa;
  border-radius: 4px;
  padding: 8px 12px;
}

.sample-match-row {
  font-size: 0.85em;
  padding: 3px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sample-match-row :deep(mark) {
  background: #fff59d;
  padding: 0 2px;
  border-radius: 2px;
}

.scope-chips-container {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}

/* LLM Prompts Tab Styles */
.prompt-textarea :deep(textarea) {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.85em;
  line-height: 1.5;
}

.prompt-display {
  background: #f5f5f5;
  border-radius: 4px;
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.prompt-text {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.8em;
  line-height: 1.6;
}

.variable-ref {
  background: #fafafa;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 8px 12px;
}

.variable-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.results-list {
  max-height: 600px;
  overflow-y: auto;
}

.result-detail {
  padding: 12px 16px;
  background: #fafafa;
  border-bottom: 1px solid #e0e0e0;
}

.result-json-container {
  background: #1e1e1e;
  border-radius: 4px;
  padding: 12px;
  max-height: 400px;
  overflow: auto;
}

.result-json {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.8em;
  line-height: 1.5;
  color: #d4d4d4;
}
</style>
