<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { usePatentsStore } from '@/stores/patents';
import { focusAreaApi, jobsApi } from '@/services/api';
import ColumnSelector from '@/components/grid/ColumnSelector.vue';
import type { Patent } from '@/types';

const router = useRouter();
const route = useRoute();
const patentsStore = usePatentsStore();

// Focus Group creation
const showCreateFocusGroupDialog = ref(false);
const newFocusGroupName = ref('');
const newFocusGroupDescription = ref('');
const creatingFocusGroup = ref(false);
const focusGroupError = ref<string | null>(null);

// Local state
const searchText = ref('');
const showColumnSelector = ref(false);
const selectedPatents = ref<Patent[]>([]);
const showFilters = ref(true);

// Filter options (loaded from API)
interface FilterOption {
  name: string;
  count: number;
}
const affiliateOptions = ref<FilterOption[]>([]);
const superSectorOptions = ref<FilterOption[]>([]);
const primarySectorOptions = ref<FilterOption[]>([]);
const loadingFilters = ref(false);

// Selected filter values (multi-select)
const selectedAffiliates = ref<string[]>([]);
const selectedSuperSectors = ref<string[]>([]);
const selectedPrimarySectors = ref<string[]>([]);

// Numeric range filters
const scoreMin = ref<number | null>(null);
const scoreMax = ref<number | null>(null);
const yearsMin = ref<number | null>(null);
const yearsMax = ref<number | null>(null);
const competitorCitesMin = ref<number | null>(null);
const competitorCitesMax = ref<number | null>(null);
const forwardCitesMin = ref<number | null>(null);
const forwardCitesMax = ref<number | null>(null);

// Load filter options from API
async function loadFilterOptions() {
  loadingFilters.value = true;
  try {
    const [affiliatesRes, sectorsRes, primarySectorsRes] = await Promise.all([
      fetch('/api/patents/affiliates'),
      fetch('/api/patents/super-sectors'),
      fetch('/api/patents/primary-sectors')
    ]);

    if (affiliatesRes.ok) {
      affiliateOptions.value = await affiliatesRes.json();
    }
    if (sectorsRes.ok) {
      superSectorOptions.value = await sectorsRes.json();
    }
    if (primarySectorsRes.ok) {
      primarySectorOptions.value = await primarySectorsRes.json();
    }
  } catch (err) {
    console.error('Failed to load filter options:', err);
  } finally {
    loadingFilters.value = false;
  }
}

// Sync local filter state with store
watch(() => patentsStore.filters, (newFilters) => {
  selectedAffiliates.value = newFilters.affiliates || [];
  selectedSuperSectors.value = newFilters.superSectors || [];
  selectedPrimarySectors.value = newFilters.primarySectors || [];
  scoreMin.value = newFilters.scoreMin ?? null;
  scoreMax.value = newFilters.scoreMax ?? null;
  yearsMin.value = newFilters.yearsMin ?? null;
  yearsMax.value = newFilters.yearsMax ?? null;
  competitorCitesMin.value = newFilters.competitorCitesMin ?? null;
  competitorCitesMax.value = newFilters.competitorCitesMax ?? null;
  forwardCitesMin.value = newFilters.forwardCitesMin ?? null;
  forwardCitesMax.value = newFilters.forwardCitesMax ?? null;
}, { immediate: true });

// Apply filters when dropdowns change
function applyFilters() {
  patentsStore.updateFilters({
    affiliates: selectedAffiliates.value.length > 0 ? selectedAffiliates.value : undefined,
    superSectors: selectedSuperSectors.value.length > 0 ? selectedSuperSectors.value : undefined,
    primarySectors: selectedPrimarySectors.value.length > 0 ? selectedPrimarySectors.value : undefined,
    scoreMin: scoreMin.value ?? undefined,
    scoreMax: scoreMax.value ?? undefined,
    yearsMin: yearsMin.value ?? undefined,
    yearsMax: yearsMax.value ?? undefined,
    competitorCitesMin: competitorCitesMin.value ?? undefined,
    competitorCitesMax: competitorCitesMax.value ?? undefined,
    forwardCitesMin: forwardCitesMin.value ?? undefined,
    forwardCitesMax: forwardCitesMax.value ?? undefined,
  });
}

// Super-sector color mapping
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

// Computed
const tableColumns = computed(() =>
  patentsStore.visibleColumns.map(col => ({
    ...col,
    field: typeof col.field === 'function' ? col.field : (row: Patent) => row[col.field as keyof Patent]
  }))
);

const paginationModel = computed({
  get: () => ({
    page: patentsStore.pagination.page,
    rowsPerPage: patentsStore.pagination.rowsPerPage,
    rowsNumber: patentsStore.totalCount,
    sortBy: patentsStore.pagination.sortBy,
    descending: patentsStore.pagination.descending
  }),
  set: (val) => {
    patentsStore.updatePagination({
      page: val.page,
      rowsPerPage: val.rowsPerPage,
      sortBy: val.sortBy,
      descending: val.descending
    });
  }
});

// Handlers
function onSearch() {
  patentsStore.updateFilters({ search: searchText.value || undefined });
}

function onRowClick(_evt: Event, row: Patent) {
  router.push({ name: 'patent-detail', params: { id: row.patent_id } });
}

function onRequest(props: { pagination: typeof paginationModel.value }) {
  patentsStore.updatePagination({
    page: props.pagination.page,
    rowsPerPage: props.pagination.rowsPerPage,
    sortBy: props.pagination.sortBy,
    descending: props.pagination.descending
  });
}

function exportToCSV() {
  const patents = patentsStore.patents;
  if (patents.length === 0) return;

  // Use visible columns for export
  const exportCols = patentsStore.visibleColumns;
  const headers = exportCols.map(c => c.label);

  const rows = patents.map(patent => {
    return exportCols.map(col => {
      const fieldName = typeof col.field === 'string' ? col.field : col.name;
      const value = (patent as Record<string, unknown>)[fieldName];
      if (value === null || value === undefined) return '';
      if (Array.isArray(value)) return value.join('; ');
      if (typeof value === 'string' && value.includes(',')) return `"${value}"`;
      return String(value);
    }).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `patent-portfolio-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Create focus group from selected patents
async function createFocusGroup() {
  if (!newFocusGroupName.value.trim()) return;
  if (selectedPatents.value.length === 0) return;

  creatingFocusGroup.value = true;
  focusGroupError.value = null;

  try {
    const patentIds = selectedPatents.value.map(p => p.patent_id);

    const focusGroup = await focusAreaApi.createFocusGroup({
      name: newFocusGroupName.value.trim(),
      description: newFocusGroupDescription.value.trim() || undefined,
      ownerId: 'default-user', // TODO: Get from auth context
      sourceType: 'MANUAL',
      patentIds
    });

    // Close dialog and clear state
    showCreateFocusGroupDialog.value = false;
    newFocusGroupName.value = '';
    newFocusGroupDescription.value = '';
    selectedPatents.value = [];

    // Navigate to the new focus group or show success
    router.push({ name: 'focus-areas', query: { tab: 'groups' } });
  } catch (err) {
    focusGroupError.value = err instanceof Error ? err.message : 'Failed to create focus group';
    console.error('Failed to create focus group:', err);
  } finally {
    creatingFocusGroup.value = false;
  }
}

function openCreateFocusGroupDialog() {
  focusGroupError.value = null;
  newFocusGroupName.value = '';
  newFocusGroupDescription.value = '';
  showCreateFocusGroupDialog.value = true;
}

// Queue Enrichment
const showEnrichmentDialog = ref(false);
const enrichmentJobTypes = ref<string[]>([]);
const queueingEnrichment = ref(false);
const enrichmentError = ref<string | null>(null);
const enrichmentJobTypeOptions = [
  { value: 'LLM_ANALYSIS', label: 'LLM Analysis' },
  { value: 'PROSECUTION_HISTORY', label: 'Prosecution History' },
  { value: 'PTAB_CHECK', label: 'IPR / PTAB' },
  { value: 'CITATION_ANALYSIS', label: 'Patent Families' }
];

function openEnrichmentDialog() {
  enrichmentError.value = null;
  enrichmentJobTypes.value = [];
  showEnrichmentDialog.value = true;
}

async function queueEnrichment() {
  if (enrichmentJobTypes.value.length === 0 || selectedPatents.value.length === 0) return;
  queueingEnrichment.value = true;
  enrichmentError.value = null;
  try {
    const patentIds = selectedPatents.value.map(p => p.patent_id);
    for (const jobType of enrichmentJobTypes.value) {
      await jobsApi.createBulkJobs(jobType, patentIds);
    }
    showEnrichmentDialog.value = false;
    selectedPatents.value = [];
  } catch (err) {
    enrichmentError.value = err instanceof Error ? err.message : 'Failed to queue enrichment jobs';
  } finally {
    queueingEnrichment.value = false;
  }
}

// Lifecycle
onMounted(async () => {
  // Apply filters from query params (e.g., from sector drill-down)
  const queryFilters: Record<string, unknown> = {};
  if (route.query.primarySectors) {
    const sectors = Array.isArray(route.query.primarySectors)
      ? route.query.primarySectors as string[]
      : [route.query.primarySectors as string];
    queryFilters.primarySectors = sectors;
    selectedPrimarySectors.value = sectors;
  }
  if (route.query.superSectors) {
    const sectors = Array.isArray(route.query.superSectors)
      ? route.query.superSectors as string[]
      : [route.query.superSectors as string];
    queryFilters.superSectors = sectors;
    selectedSuperSectors.value = sectors;
  }
  if (route.query.affiliates) {
    const affs = Array.isArray(route.query.affiliates)
      ? route.query.affiliates as string[]
      : [route.query.affiliates as string];
    queryFilters.affiliates = affs;
    selectedAffiliates.value = affs;
  }

  if (Object.keys(queryFilters).length > 0) {
    patentsStore.updateFilters(queryFilters);
  }

  // Load filter options and patents in parallel
  await Promise.all([
    loadFilterOptions(),
    patentsStore.loadPatents()
  ]);
});
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="text-h5 q-mr-md">Patent Portfolio</div>
      <q-badge color="primary" class="q-mr-md">
        {{ patentsStore.totalCount.toLocaleString() }} patents
      </q-badge>
      <q-space />

      <!-- Search -->
      <q-input
        v-model="searchText"
        dense
        outlined
        placeholder="Search patents..."
        class="q-mr-sm"
        style="width: 300px"
        @keyup.enter="onSearch"
      >
        <template v-slot:append>
          <q-icon name="search" class="cursor-pointer" @click="onSearch" />
        </template>
      </q-input>

      <!-- Column Selector -->
      <q-btn
        flat
        icon="view_column"
        label="Columns"
        class="q-mr-sm"
        @click="showColumnSelector = true"
      />

      <!-- Export -->
      <q-btn
        flat
        icon="download"
        label="Export"
        @click="exportToCSV"
      />

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
              <!-- Affiliate Multi-Select -->
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
                @update:model-value="applyFilters"
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

              <!-- Super-Sector Multi-Select -->
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
                @update:model-value="applyFilters"
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

              <!-- Primary Sector Multi-Select -->
              <q-select
                v-model="selectedPrimarySectors"
                :options="primarySectorOptions"
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
                label="Primary Sector"
                style="min-width: 220px"
                @update:model-value="applyFilters"
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

              <!-- Numeric Range Filters -->
              <div class="row items-center q-gutter-xs">
                <span class="text-caption text-grey-7">Score:</span>
                <q-input v-model.number="scoreMin" type="number" dense outlined placeholder="min" style="width: 80px" @change="applyFilters" />
                <q-input v-model.number="scoreMax" type="number" dense outlined placeholder="max" style="width: 80px" @change="applyFilters" />
              </div>
              <div class="row items-center q-gutter-xs">
                <span class="text-caption text-grey-7">Years Left:</span>
                <q-input v-model.number="yearsMin" type="number" dense outlined placeholder="min" style="width: 80px" @change="applyFilters" />
                <q-input v-model.number="yearsMax" type="number" dense outlined placeholder="max" style="width: 80px" @change="applyFilters" />
              </div>
              <div class="row items-center q-gutter-xs">
                <span class="text-caption text-grey-7">Competitor Cites:</span>
                <q-input v-model.number="competitorCitesMin" type="number" dense outlined placeholder="min" style="width: 80px" @change="applyFilters" />
                <q-input v-model.number="competitorCitesMax" type="number" dense outlined placeholder="max" style="width: 80px" @change="applyFilters" />
              </div>
              <div class="row items-center q-gutter-xs">
                <span class="text-caption text-grey-7">Forward Cites:</span>
                <q-input v-model.number="forwardCitesMin" type="number" dense outlined placeholder="min" style="width: 80px" @change="applyFilters" />
                <q-input v-model.number="forwardCitesMax" type="number" dense outlined placeholder="max" style="width: 80px" @change="applyFilters" />
              </div>

              <q-space />

              <!-- Clear Filters -->
              <q-btn
                v-if="patentsStore.hasFilters"
                flat
                dense
                color="negative"
                icon="clear_all"
                label="Clear All"
                @click="patentsStore.clearFilters(); selectedAffiliates = []; selectedSuperSectors = []; selectedPrimarySectors = []; scoreMin = null; scoreMax = null; yearsMin = null; yearsMax = null; competitorCitesMin = null; competitorCitesMax = null; forwardCitesMin = null; forwardCitesMax = null;"
              />
            </div>
          </q-card-section>
        </q-card>
      </div>
    </q-slide-transition>

    <!-- Active Filter Summary (shown when filters hidden) -->
    <div v-if="!showFilters && patentsStore.hasFilters" class="q-mb-md">
      <div class="row q-gutter-sm items-center">
        <span class="text-caption text-grey-7">Filters:</span>
        <q-chip
          v-for="affiliate in (patentsStore.filters.affiliates || [])"
          :key="'aff-' + affiliate"
          dense
          removable
          color="primary"
          text-color="white"
          @remove="selectedAffiliates = selectedAffiliates.filter(a => a !== affiliate); applyFilters()"
        >
          {{ affiliate }}
        </q-chip>
        <q-chip
          v-for="sector in (patentsStore.filters.superSectors || [])"
          :key="'sec-' + sector"
          dense
          removable
          :color="getSectorColor(sector)"
          text-color="white"
          @remove="selectedSuperSectors = selectedSuperSectors.filter(s => s !== sector); applyFilters()"
        >
          {{ sector }}
        </q-chip>
        <q-chip
          v-for="sector in (patentsStore.filters.primarySectors || [])"
          :key="'psec-' + sector"
          dense
          removable
          color="deep-purple"
          text-color="white"
          @remove="selectedPrimarySectors = selectedPrimarySectors.filter(s => s !== sector); applyFilters()"
        >
          {{ sector }}
        </q-chip>
        <q-chip
          v-if="patentsStore.filters.scoreMin != null || patentsStore.filters.scoreMax != null"
          dense
          removable
          color="green"
          text-color="white"
          @remove="scoreMin = null; scoreMax = null; applyFilters()"
        >
          Score: {{ patentsStore.filters.scoreMin ?? '*' }}–{{ patentsStore.filters.scoreMax ?? '*' }}
        </q-chip>
        <q-chip
          v-if="patentsStore.filters.yearsMin != null || patentsStore.filters.yearsMax != null"
          dense
          removable
          color="teal"
          text-color="white"
          @remove="yearsMin = null; yearsMax = null; applyFilters()"
        >
          Years: {{ patentsStore.filters.yearsMin ?? '*' }}–{{ patentsStore.filters.yearsMax ?? '*' }}
        </q-chip>
        <q-chip
          v-if="patentsStore.filters.competitorCitesMin != null || patentsStore.filters.competitorCitesMax != null"
          dense
          removable
          color="orange"
          text-color="white"
          @remove="competitorCitesMin = null; competitorCitesMax = null; applyFilters()"
        >
          Comp. Cites: {{ patentsStore.filters.competitorCitesMin ?? '*' }}–{{ patentsStore.filters.competitorCitesMax ?? '*' }}
        </q-chip>
        <q-chip
          v-if="patentsStore.filters.forwardCitesMin != null || patentsStore.filters.forwardCitesMax != null"
          dense
          removable
          color="blue"
          text-color="white"
          @remove="forwardCitesMin = null; forwardCitesMax = null; applyFilters()"
        >
          Fwd Cites: {{ patentsStore.filters.forwardCitesMin ?? '*' }}–{{ patentsStore.filters.forwardCitesMax ?? '*' }}
        </q-chip>
        <q-chip
          v-if="patentsStore.filters.search"
          dense
          removable
          color="grey-7"
          text-color="white"
          @remove="searchText = ''; patentsStore.updateFilters({ search: undefined })"
        >
          Search: {{ patentsStore.filters.search }}
        </q-chip>
      </div>
    </div>

    <!-- Data Table -->
    <div class="table-scroll-container">
    <q-table
      :rows="patentsStore.patents"
      :columns="tableColumns"
      row-key="patent_id"
      v-model:pagination="paginationModel"
      v-model:selected="selectedPatents"
      :loading="patentsStore.loading"
      selection="multiple"
      flat
      bordered
      binary-state-sort
      @row-click="onRowClick"
      @request="onRequest"
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

      <!-- Affiliate as clickable filter -->
      <template v-slot:body-cell-affiliate="props">
        <q-td :props="props">
          <a
            href="#"
            class="text-primary"
            @click.stop.prevent="patentsStore.updateFilters({ affiliates: [props.row.affiliate] })"
          >
            {{ props.row.affiliate }}
          </a>
        </q-td>
      </template>

      <!-- Super-Sector as clickable filter with chip style -->
      <template v-slot:body-cell-super_sector="props">
        <q-td :props="props">
          <q-chip
            dense
            clickable
            :color="getSectorColor(props.row.super_sector)"
            text-color="white"
            size="sm"
            @click.stop="patentsStore.updateFilters({ superSectors: [props.row.super_sector] })"
          >
            {{ props.row.super_sector }}
          </q-chip>
        </q-td>
      </template>

      <!-- Assignee as link (hidden by default) -->
      <template v-slot:body-cell-assignee="props">
        <q-td :props="props">
          <a
            href="#"
            class="text-secondary text-caption"
            @click.stop.prevent="patentsStore.updateFilters({ assignees: [props.row.assignee] })"
          >
            {{ props.row.assignee }}
          </a>
        </q-td>
      </template>

      <!-- Primary Sector (hidden by default) -->
      <template v-slot:body-cell-primary_sector="props">
        <q-td :props="props">
          <span class="text-caption text-grey-7">{{ props.row.primary_sector }}</span>
        </q-td>
      </template>

      <!-- Score with color coding -->
      <template v-slot:body-cell-score="props">
        <q-td :props="props">
          <q-badge
            :color="props.row.score > 100 ? 'positive' : props.row.score > 50 ? 'warning' : 'grey'"
          >
            {{ props.row.score?.toFixed(1) || '-' }}
          </q-badge>
        </q-td>
      </template>

      <!-- Competitor citations with color intensity -->
      <template v-slot:body-cell-competitor_citations="props">
        <q-td :props="props">
          <span :class="props.row.competitor_citations > 10 ? 'text-bold text-negative' : props.row.competitor_citations > 3 ? 'text-bold text-warning' : ''">
            {{ props.row.competitor_citations ?? 0 }}
          </span>
        </q-td>
      </template>

      <!-- Competitor count with tooltip showing names -->
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

      <!-- LLM Summary with truncation -->
      <template v-slot:body-cell-llm_summary="props">
        <q-td :props="props">
          <div v-if="props.row.llm_summary" class="ellipsis" style="max-width: 300px">
            {{ props.row.llm_summary }}
            <q-tooltip max-width="400px" :delay="300">
              {{ props.row.llm_summary }}
            </q-tooltip>
          </div>
          <span v-else class="text-grey-4">--</span>
        </q-td>
      </template>

      <template v-slot:body-cell-llm_prior_art_problem="props">
        <q-td :props="props">
          <div v-if="props.row.llm_prior_art_problem" class="ellipsis" style="max-width: 300px">
            {{ props.row.llm_prior_art_problem }}
            <q-tooltip max-width="400px" :delay="300">
              {{ props.row.llm_prior_art_problem }}
            </q-tooltip>
          </div>
          <span v-else class="text-grey-4">--</span>
        </q-td>
      </template>

      <template v-slot:body-cell-llm_technical_solution="props">
        <q-td :props="props">
          <div v-if="props.row.llm_technical_solution" class="ellipsis" style="max-width: 300px">
            {{ props.row.llm_technical_solution }}
            <q-tooltip max-width="400px" :delay="300">
              {{ props.row.llm_technical_solution }}
            </q-tooltip>
          </div>
          <span v-else class="text-grey-4">--</span>
        </q-td>
      </template>

      <!-- LLM Score columns (1-5 with color badge) -->
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

      <template v-slot:body-cell-llm_confidence="props">
        <q-td :props="props">
          <q-badge v-if="props.row.llm_confidence" color="grey-7">
            {{ props.row.llm_confidence }}
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

      <!-- No data -->
      <template v-slot:no-data>
        <div class="full-width row flex-center text-grey q-gutter-sm q-pa-xl">
          <q-icon size="2em" name="sentiment_dissatisfied" />
          <span>No patents found</span>
        </div>
      </template>

      <!-- Loading -->
      <template v-slot:loading>
        <q-inner-loading showing color="primary" />
      </template>
    </q-table>
    </div>

    <!-- Bulk Actions (when items selected) -->
    <q-page-sticky v-if="selectedPatents.length > 0" position="bottom" :offset="[0, 18]">
      <q-banner class="bg-primary text-white">
        <template v-slot:avatar>
          <q-icon name="check_circle" />
        </template>
        {{ selectedPatents.length }} patents selected
        <template v-slot:action>
          <q-btn flat icon="folder_special" label="Create Focus Group" @click="openCreateFocusGroupDialog" />
          <q-btn flat icon="science" label="Queue Enrichment" @click="openEnrichmentDialog" />
          <q-btn flat icon="download" label="Export Selected" @click="exportToCSV" />
          <q-btn flat label="Clear" @click="selectedPatents = []" />
        </template>
      </q-banner>
    </q-page-sticky>

    <!-- Create Focus Group Dialog -->
    <q-dialog v-model="showCreateFocusGroupDialog" persistent>
      <q-card style="min-width: 450px">
        <q-card-section class="row items-center">
          <q-avatar icon="folder_special" color="primary" text-color="white" />
          <span class="q-ml-sm text-h6">Create Focus Group</span>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <div class="text-body2 text-grey-7 q-mb-md">
            Creating a focus group with {{ selectedPatents.length }} selected patents.
            You can later formalize this into a Focus Area with search terms.
          </div>

          <q-input
            v-model="newFocusGroupName"
            label="Group Name *"
            outlined
            autofocus
            :rules="[val => !!val?.trim() || 'Name is required']"
            class="q-mb-md"
            placeholder="e.g., Container Security Patents"
          />

          <q-input
            v-model="newFocusGroupDescription"
            label="Description (optional)"
            outlined
            type="textarea"
            rows="2"
            placeholder="Brief description of this group..."
          />

          <q-banner v-if="focusGroupError" class="bg-negative text-white q-mt-md">
            {{ focusGroupError }}
          </q-banner>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            icon="add"
            label="Create Focus Group"
            :loading="creatingFocusGroup"
            :disable="!newFocusGroupName.trim()"
            @click="createFocusGroup"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Queue Enrichment Dialog -->
    <q-dialog v-model="showEnrichmentDialog" persistent>
      <q-card style="min-width: 450px">
        <q-card-section class="row items-center">
          <q-avatar icon="science" color="primary" text-color="white" />
          <span class="q-ml-sm text-h6">Queue Enrichment</span>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <div class="text-body2 text-grey-7 q-mb-md">
            Queue enrichment jobs for {{ selectedPatents.length }} selected patents.
          </div>

          <div class="column q-gutter-sm">
            <q-checkbox
              v-for="opt in enrichmentJobTypeOptions"
              :key="opt.value"
              v-model="enrichmentJobTypes"
              :val="opt.value"
              :label="opt.label"
            />
          </div>

          <q-banner v-if="enrichmentError" class="bg-negative text-white q-mt-md">
            {{ enrichmentError }}
          </q-banner>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            icon="play_arrow"
            :label="`Queue ${enrichmentJobTypes.length} Job Type(s)`"
            :loading="queueingEnrichment"
            :disable="enrichmentJobTypes.length === 0"
            @click="queueEnrichment"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Column Selector Dialog -->
    <ColumnSelector v-model="showColumnSelector" />
  </q-page>
</template>

<style scoped>
.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-scroll-container {
  max-height: calc(100vh - 260px);
  overflow: auto;
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
</style>
