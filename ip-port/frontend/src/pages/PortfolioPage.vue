<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { usePatentsStore } from '@/stores/patents';
import ColumnSelector from '@/components/grid/ColumnSelector.vue';
import type { Patent } from '@/types';

const router = useRouter();
const patentsStore = usePatentsStore();

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
const loadingFilters = ref(false);

// Selected filter values (multi-select)
const selectedAffiliates = ref<string[]>([]);
const selectedSuperSectors = ref<string[]>([]);
const activeOnlyFilter = ref(false);

// Load filter options from API
async function loadFilterOptions() {
  loadingFilters.value = true;
  try {
    const [affiliatesRes, sectorsRes] = await Promise.all([
      fetch('/api/patents/affiliates'),
      fetch('/api/patents/super-sectors')
    ]);

    if (affiliatesRes.ok) {
      affiliateOptions.value = await affiliatesRes.json();
    }
    if (sectorsRes.ok) {
      superSectorOptions.value = await sectorsRes.json();
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
  activeOnlyFilter.value = newFilters.activeOnly || false;
}, { immediate: true });

// Apply filters when dropdowns change
function applyFilters() {
  patentsStore.updateFilters({
    affiliates: selectedAffiliates.value.length > 0 ? selectedAffiliates.value : undefined,
    superSectors: selectedSuperSectors.value.length > 0 ? selectedSuperSectors.value : undefined,
    activeOnly: activeOnlyFilter.value || undefined
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
  // TODO: Implement CSV export
  console.log('Export to CSV');
}

// Lifecycle
onMounted(async () => {
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

              <!-- Active Only Toggle -->
              <q-toggle
                v-model="activeOnlyFilter"
                label="Active Only"
                dense
                @update:model-value="applyFilters"
              />

              <q-space />

              <!-- Clear Filters -->
              <q-btn
                v-if="patentsStore.hasFilters"
                flat
                dense
                color="negative"
                icon="clear_all"
                label="Clear All"
                @click="patentsStore.clearFilters(); selectedAffiliates = []; selectedSuperSectors = []; activeOnlyFilter = false;"
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
          v-if="patentsStore.filters.activeOnly"
          dense
          removable
          color="green"
          text-color="white"
          @remove="activeOnlyFilter = false; applyFilters()"
        >
          Active Only
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

    <!-- Bulk Actions (when items selected) -->
    <q-page-sticky v-if="selectedPatents.length > 0" position="bottom" :offset="[0, 18]">
      <q-banner class="bg-primary text-white">
        <template v-slot:avatar>
          <q-icon name="check_circle" />
        </template>
        {{ selectedPatents.length }} patents selected
        <template v-slot:action>
          <q-btn flat label="Queue Jobs" @click="console.log('Queue jobs for', selectedPatents)" />
          <q-btn flat label="Export Selected" />
          <q-btn flat label="Clear" @click="selectedPatents = []" />
        </template>
      </q-banner>
    </q-page-sticky>

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

:deep(.q-table tbody tr) {
  cursor: pointer;
}

:deep(.q-table tbody tr:hover) {
  background-color: rgba(0, 0, 0, 0.03);
}
</style>
