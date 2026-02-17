<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { usePatentsStore } from '@/stores/patents';
import { focusAreaApi, jobsApi, patentApi, snapshotApi, type ActiveSnapshots } from '@/services/api';
import ColumnSelector from '@/components/grid/ColumnSelector.vue';
import FlexFilterBuilder from '@/components/filters/FlexFilterBuilder.vue';
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

// View mode: portfolio vs all
const viewMode = ref<'portfolio' | 'all'>('portfolio');
const selectedPortfolio = ref('broadcom-core');
const portfolioOptions = [
  { value: 'broadcom-core', label: 'Broadcom Core' }
];

// Active snapshots state
const activeSnapshots = ref<ActiveSnapshots>({ V2: null, V3: null });

// Local state
const searchText = ref('');
const showColumnSelector = ref(false);
const selectedPatents = ref<Patent[]>([]);
const showFilters = ref(true);

// Flexible filters (v2)
const flexFilters = computed({
  get: () => patentsStore.filters as Record<string, unknown>,
  set: (val) => patentsStore.updateFilters(val)
});

// Apply flex filters from the builder (replaces all filters except search)
function onFlexFiltersUpdate(filters: Record<string, unknown>) {
  // Preserve search from the separate search input
  const search = patentsStore.filters.search;
  // Use setFilters to REPLACE (not merge) filters
  patentsStore.setFilters({ ...filters, search });
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

const exporting = ref(false);

async function exportToCSV() {
  if (patentsStore.totalCount === 0) return;
  exporting.value = true;
  try {
    // Send visible column field names to backend
    const columnFields = patentsStore.visibleColumns.map(col =>
      typeof col.field === 'string' ? col.field : col.name
    );

    await patentApi.exportCSV(
      patentsStore.filters,
      columnFields,
      patentsStore.pagination.sortBy,
      patentsStore.pagination.descending
    );
  } catch (err) {
    console.error('Export failed:', err);
  } finally {
    exporting.value = false;
  }
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

// Navigate to Patent Family Explorer with selected patents as seeds
function exploreFamilies() {
  if (selectedPatents.value.length === 0) return;
  const patentIds = selectedPatents.value.map(p => p.patent_id);
  router.push({
    name: 'patent-families',
    query: { seeds: patentIds.join(',') }
  });
}

// Lifecycle
onMounted(async () => {
  // Load active snapshots and apply query filters in parallel
  const [, snapshots] = await Promise.all([
    (async () => {
      // Apply filters from query params (e.g., from sector drill-down)
      const queryFilters: Record<string, unknown> = {};
      if (route.query.primarySectors) {
        const sectors = Array.isArray(route.query.primarySectors)
          ? route.query.primarySectors as string[]
          : [route.query.primarySectors as string];
        queryFilters.primarySectors = sectors;
      }
      if (route.query.superSectors) {
        const sectors = Array.isArray(route.query.superSectors)
          ? route.query.superSectors as string[]
          : [route.query.superSectors as string];
        queryFilters.superSectors = sectors;
      }
      if (route.query.affiliates) {
        const affs = Array.isArray(route.query.affiliates)
          ? route.query.affiliates as string[]
          : [route.query.affiliates as string];
        queryFilters.affiliates = affs;
      }

      if (Object.keys(queryFilters).length > 0) {
        patentsStore.updateFilters(queryFilters);
      }

      // Load patents
      await patentsStore.loadPatents();
    })(),
    snapshotApi.getActive().catch(() => ({ V2: null, V3: null })),
  ]);

  activeSnapshots.value = snapshots;
});
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="text-h5 q-mr-md">Patent Summary</div>
      <q-btn-toggle
        v-model="viewMode"
        toggle-color="primary"
        dense
        no-caps
        rounded
        class="q-mr-md"
        :options="[
          { value: 'portfolio', label: 'Portfolio' },
          { value: 'all', label: 'All Patents' }
        ]"
      />
      <q-select
        v-if="viewMode === 'portfolio'"
        v-model="selectedPortfolio"
        :options="portfolioOptions"
        outlined
        dense
        emit-value
        map-options
        option-value="value"
        option-label="label"
        class="q-mr-md"
        style="min-width: 180px"
      />
      <q-badge color="primary" class="q-mr-md">
        {{ patentsStore.totalCount.toLocaleString() }} patents
      </q-badge>

      <!-- Snapshot Status -->
      <q-badge
        v-if="activeSnapshots.V2"
        color="positive"
        class="q-mr-xs"
      >
        <q-icon name="check_circle" size="xs" class="q-mr-xs" />
        V2: {{ activeSnapshots.V2.name }}
        <q-tooltip>
          V2 scores from snapshot "{{ activeSnapshots.V2.name }}"
          ({{ activeSnapshots.V2.patentCount.toLocaleString() }} patents,
          {{ new Date(activeSnapshots.V2.createdAt).toLocaleDateString() }})
        </q-tooltip>
      </q-badge>
      <q-badge
        v-else
        color="warning"
        outline
        class="q-mr-xs"
      >
        V2: calculated
        <q-tooltip>V2 scores are calculated on-the-fly. Save a snapshot in V2 Scoring for consistent scores.</q-tooltip>
      </q-badge>

      <q-badge
        v-if="activeSnapshots.V3"
        color="positive"
        class="q-mr-md"
      >
        <q-icon name="check_circle" size="xs" class="q-mr-xs" />
        V3: {{ activeSnapshots.V3.name }}
        <q-tooltip>
          V3 scores from snapshot "{{ activeSnapshots.V3.name }}"
          ({{ activeSnapshots.V3.patentCount.toLocaleString() }} patents,
          {{ new Date(activeSnapshots.V3.createdAt).toLocaleDateString() }})
        </q-tooltip>
      </q-badge>
      <q-badge
        v-else
        color="warning"
        outline
        class="q-mr-md"
      >
        V3: calculated
        <q-tooltip>V3 scores are calculated on-the-fly. Save a snapshot in V3 Scoring for consistent scores.</q-tooltip>
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
        :loading="exporting"
        @click="exportToCSV"
      >
        <q-tooltip>Export all {{ patentsStore.totalCount.toLocaleString() }} filtered patents as CSV</q-tooltip>
      </q-btn>

      <!-- Filter Toggle -->
      <q-btn
        flat
        :icon="showFilters ? 'filter_list_off' : 'filter_list'"
        :label="showFilters ? 'Hide Filters' : 'Filters'"
        @click="showFilters = !showFilters"
      />
    </div>

    <!-- Flexible Filter Builder -->
    <q-slide-transition>
      <div v-show="showFilters" class="q-mb-md">
        <q-card flat bordered>
          <q-card-section class="q-py-sm">
            <FlexFilterBuilder
              :model-value="flexFilters"
              @update:model-value="onFlexFiltersUpdate"
            />
          </q-card-section>
        </q-card>
      </div>
    </q-slide-transition>

    <!-- Active Filter Summary (shown when filters hidden) -->
    <div v-if="!showFilters && patentsStore.hasFilters" class="q-mb-md">
      <div class="row q-gutter-sm items-center">
        <span class="text-caption text-grey-7">Active filters:</span>
        <q-badge color="primary">{{ Object.keys(patentsStore.filters).filter(k => patentsStore.filters[k] != null).length }} filters</q-badge>
        <q-btn flat dense size="sm" label="Show" @click="showFilters = true" />
      </div>
    </div>

    <!-- Data Table with fixed pagination -->
    <div class="table-wrapper">
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
          hide-pagination
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

      <!-- Competitor names as list -->
      <template v-slot:body-cell-competitor_names="props">
        <q-td :props="props">
          <div v-if="props.row.competitor_names?.length > 0" class="ellipsis" style="max-width: 250px">
            {{ props.row.competitor_names.join(', ') }}
            <q-tooltip v-if="props.row.competitor_names?.length > 2" max-width="400px">
              {{ props.row.competitor_names.join(', ') }}
            </q-tooltip>
          </div>
          <span v-else class="text-grey-4">--</span>
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

      <!-- Pagination Controls (always visible outside scroll area) -->
      <div class="pagination-bar q-pa-sm bg-grey-1 row items-center justify-between">
        <div class="text-caption text-grey-7">
          {{ patentsStore.totalCount.toLocaleString() }} total patents
          <span v-if="paginationModel.rowsNumber > 0">
            &middot; Page {{ paginationModel.page }} of {{ Math.ceil(paginationModel.rowsNumber / paginationModel.rowsPerPage) }}
          </span>
        </div>
        <div class="row items-center q-gutter-sm">
          <span class="text-caption text-grey-7">Rows per page:</span>
          <q-select
            v-model="paginationModel.rowsPerPage"
            :options="[25, 50, 100, 250, 500]"
            dense
            borderless
            style="min-width: 60px"
            @update:model-value="onRequest({ pagination: paginationModel })"
          />
          <q-pagination
            v-model="paginationModel.page"
            :max="Math.ceil(paginationModel.rowsNumber / paginationModel.rowsPerPage) || 1"
            :max-pages="7"
            direction-links
            boundary-links
            icon-first="first_page"
            icon-last="last_page"
            icon-prev="chevron_left"
            icon-next="chevron_right"
            @update:model-value="onRequest({ pagination: paginationModel })"
          />
        </div>
      </div>
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
          <q-btn flat icon="account_tree" label="Explore Families" @click="exploreFamilies" />
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

.table-wrapper {
  display: flex;
  flex-direction: column;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  /* Critical: don't let wrapper overflow, contain everything */
  overflow: hidden;
  /* Fixed height so we control scrolling */
  height: calc(100vh - 340px);
  min-height: 350px;
}

.table-scroll-container {
  /* Fill available space */
  flex: 1;
  /* Critical: override flexbox default min-height: auto so this
     container can be smaller than its content and actually scroll */
  min-height: 0;
  min-width: 0;
  /* ALWAYS show both scrollbars */
  overflow: scroll !important;
  position: relative;
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

.pagination-bar {
  border-top: 1px solid #e0e0e0;
  flex-shrink: 0;
  background: #fafafa;
}

/* ═══════════════════════════════════════════════════════════════════════════
   STICKY HEADER - Excel-like freeze panes
   The key is to make thead sticky relative to the scroll container
   ═══════════════════════════════════════════════════════════════════════════ */

/* Remove any default q-table wrapper scrolling */
:deep(.q-table__container) {
  overflow: visible !important;
}

:deep(.q-table__middle) {
  overflow: visible !important;
}

/* Make the table fill its container */
:deep(.q-table) {
  width: max-content;
  min-width: 100%;
}

/* STICKY HEADER ROW */
:deep(.q-table thead tr) {
  position: sticky;
  top: 0;
  z-index: 10;
}

:deep(.q-table thead th) {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #f5f5f5 !important;
  border-bottom: 2px solid #ddd !important;
}

/* Pin selection checkbox column (frozen left) */
:deep(.q-table td:first-child),
:deep(.q-table th:first-child) {
  position: sticky;
  left: 0;
  z-index: 5;
  background: #fff;
}

:deep(.q-table thead th:first-child) {
  z-index: 15 !important;
  background: #f5f5f5 !important;
}

/* Pin patent_id column (frozen left, second column) */
:deep(.q-table td:nth-child(2)),
:deep(.q-table th:nth-child(2)) {
  position: sticky;
  left: 48px;
  z-index: 5;
  background: #fff;
  box-shadow: 2px 0 4px -2px rgba(0, 0, 0, 0.15);
}

:deep(.q-table thead th:nth-child(2)) {
  z-index: 15 !important;
  background: #f5f5f5 !important;
}

:deep(.q-table tbody tr) {
  cursor: pointer;
}

:deep(.q-table tbody tr:hover) {
  background-color: rgba(0, 0, 0, 0.03);
}
</style>
