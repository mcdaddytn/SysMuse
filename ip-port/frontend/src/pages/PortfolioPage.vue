<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { usePatentsStore } from '@/stores/patents';
import type { Patent } from '@/types';

const router = useRouter();
const patentsStore = usePatentsStore();

// Local state
const searchText = ref('');
const showColumnSelector = ref(false);
const selectedPatents = ref<Patent[]>([]);

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
onMounted(() => {
  // Load patents with mock data for now (until backend is ready)
  loadMockData();
});

// Temporary: Load from existing candidates file
async function loadMockData() {
  try {
    const response = await fetch('/api/patents');
    if (!response.ok) {
      // If API not available, load directly from candidates file
      console.log('API not available, using mock data');
      // For now, set empty - will populate from API when backend is ready
    }
    await patentsStore.loadPatents();
  } catch (err) {
    console.log('Using placeholder data until API is ready');
  }
}
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
    </div>

    <!-- Filters (expandable) -->
    <q-expansion-item
      v-if="patentsStore.hasFilters"
      label="Active Filters"
      icon="filter_list"
      class="q-mb-md"
    >
      <q-card>
        <q-card-section>
          <div class="row q-gutter-sm">
            <q-chip
              v-for="(value, key) in patentsStore.filters"
              :key="key"
              removable
              @remove="patentsStore.updateFilters({ [key]: undefined })"
            >
              {{ key }}: {{ value }}
            </q-chip>
          </div>
          <q-btn flat color="negative" label="Clear All" @click="patentsStore.clearFilters" />
        </q-card-section>
      </q-card>
    </q-expansion-item>

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

      <!-- Assignee as link -->
      <template v-slot:body-cell-assignee="props">
        <q-td :props="props">
          <a
            href="#"
            class="text-primary"
            @click.stop.prevent="patentsStore.updateFilters({ assignees: [props.row.assignee] })"
          >
            {{ props.row.assignee }}
          </a>
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
    <q-dialog v-model="showColumnSelector">
      <q-card style="min-width: 300px">
        <q-card-section class="row items-center">
          <div class="text-h6">Show/Hide Columns</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <q-list>
            <q-item
              v-for="column in patentsStore.columns"
              :key="column.name"
              tag="label"
            >
              <q-item-section avatar>
                <q-checkbox
                  :model-value="column.visible"
                  @update:model-value="patentsStore.toggleColumn(column.name)"
                />
              </q-item-section>
              <q-item-section>{{ column.label }}</q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
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

:deep(.q-table tbody tr) {
  cursor: pointer;
}

:deep(.q-table tbody tr:hover) {
  background-color: rgba(0, 0, 0, 0.03);
}
</style>
