<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import FlexFilterBuilder from '@/components/filters/FlexFilterBuilder.vue';
import { snapshotApi, type ActiveSnapshots } from '@/services/api';

// Group by field options
interface GroupByOption {
  value: string;
  label: string;
  isArray?: boolean;
}

const groupByOptions: GroupByOption[] = [
  { value: 'affiliate', label: 'Affiliate' },
  { value: 'super_sector', label: 'Super-Sector' },
  { value: 'primary_sector', label: 'Primary Sector' },
  { value: 'primary_sub_sector_name', label: 'Sub-Sector' },
  { value: 'competitor_names', label: 'Competitor Names', isArray: true },
  { value: 'cpc_codes', label: 'CPC Codes', isArray: true },
  { value: 'llm_technology_category', label: 'Tech Category' },
  { value: 'llm_market_segment', label: 'Market Segment' },
  { value: 'llm_implementation_type', label: 'Implementation Type' },
];

// Aggregation field options
interface AggFieldOption {
  value: string;
  label: string;
}

const aggFieldOptions: AggFieldOption[] = [
  { value: 'score', label: 'Base Score' },
  { value: 'v2_score', label: 'V2 Score' },
  { value: 'v3_score', label: 'V3 Score' },
  { value: 'forward_citations', label: 'Forward Citations' },
  { value: 'competitor_citations', label: 'Competitor Citations' },
  { value: 'affiliate_citations', label: 'Affiliate Citations' },
  { value: 'neutral_citations', label: 'Neutral Citations' },
  { value: 'remaining_years', label: 'Years Remaining' },
  { value: 'competitor_count', label: 'Competitor Count' },
  { value: 'eligibility_score', label: 'Eligibility Score' },
  { value: 'validity_score', label: 'Validity Score' },
  { value: 'claim_breadth', label: 'Claim Breadth' },
  { value: 'enforcement_clarity', label: 'Enforcement Clarity' },
  { value: 'market_relevance_score', label: 'Market Relevance' },
];

const aggOpOptions = [
  { value: 'avg', label: 'Average' },
  { value: 'sum', label: 'Sum' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
  { value: 'count_nonnull', label: 'Count (non-null)' },
];

// State
const selectedGroupBy = ref<string[]>(['super_sector']);
const aggregations = ref<Array<{ field: string; op: string }>>([
  { field: 'score', op: 'avg' }
]);
const explodeArrays = ref(false);
const filters = ref<Record<string, unknown>>({});
const sortBy = ref('count');
const sortDesc = ref(true);
const limit = ref(100);

const loading = ref(false);
const results = ref<Array<Record<string, string | number>>>([]);
const totalGroups = ref(0);
const filteredPatents = ref(0);
const exporting = ref(false);

// Active snapshots state
const activeSnapshots = ref<ActiveSnapshots>({ V2: null, V3: null });

// Check if any selected groupBy field is an array field
const hasArrayGroupBy = computed(() =>
  selectedGroupBy.value.some(field =>
    groupByOptions.find(o => o.value === field)?.isArray
  )
);

// Computed columns for the results table
const tableColumns = computed(() => {
  const cols: Array<{ name: string; label: string; field: string; sortable: boolean; align: string }> = [];

  // Group by columns
  for (const field of selectedGroupBy.value) {
    const opt = groupByOptions.find(o => o.value === field);
    cols.push({
      name: field,
      label: opt?.label || field,
      field: field,
      sortable: true,
      align: 'left'
    });
  }

  // Count column (always present)
  cols.push({
    name: 'count',
    label: 'Count',
    field: 'count',
    sortable: true,
    align: 'right'
  });

  // Aggregation columns
  for (const agg of aggregations.value) {
    const fieldOpt = aggFieldOptions.find(o => o.value === agg.field);
    const opOpt = aggOpOptions.find(o => o.value === agg.op);
    const colName = `${agg.field}_${agg.op}`;
    cols.push({
      name: colName,
      label: `${fieldOpt?.label || agg.field} (${opOpt?.label || agg.op})`,
      field: colName,
      sortable: true,
      align: 'right'
    });
  }

  return cols;
});

// Add aggregation
function addAggregation() {
  aggregations.value.push({ field: 'score', op: 'avg' });
}

// Remove aggregation
function removeAggregation(index: number) {
  aggregations.value.splice(index, 1);
}

// Run aggregation
async function runAggregation() {
  if (selectedGroupBy.value.length === 0) return;

  loading.value = true;
  try {
    const response = await fetch('/api/patents/aggregate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupBy: selectedGroupBy.value,
        aggregations: aggregations.value,
        explodeArrays: explodeArrays.value,
        filters: filters.value,
        sortBy: sortBy.value,
        sortDesc: sortDesc.value,
        limit: limit.value
      })
    });

    if (response.ok) {
      const data = await response.json();
      results.value = data.results;
      totalGroups.value = data.totalGroups;
      filteredPatents.value = data.filteredPatents;
    }
  } catch (err) {
    console.error('Aggregation failed:', err);
  } finally {
    loading.value = false;
  }
}

// Export to CSV
async function exportCSV() {
  if (selectedGroupBy.value.length === 0) return;

  exporting.value = true;
  try {
    const response = await fetch('/api/patents/aggregate/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupBy: selectedGroupBy.value,
        aggregations: aggregations.value,
        explodeArrays: explodeArrays.value,
        filters: filters.value,
        sortBy: sortBy.value,
        sortDesc: sortDesc.value
      })
    });

    if (response.ok) {
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `patent-aggregate-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }
  } catch (err) {
    console.error('Export failed:', err);
  } finally {
    exporting.value = false;
  }
}

// Handle sort
function onSort(col: string) {
  if (sortBy.value === col) {
    sortDesc.value = !sortDesc.value;
  } else {
    sortBy.value = col;
    sortDesc.value = true;
  }
  runAggregation();
}

// Handle filter update
function onFiltersUpdate(newFilters: Record<string, unknown>) {
  filters.value = newFilters;
}

// Run initial aggregation
onMounted(async () => {
  // Load active snapshots and run aggregation in parallel
  const [, snapshots] = await Promise.all([
    runAggregation(),
    snapshotApi.getActive().catch(() => ({ V2: null, V3: null })),
  ]);
  activeSnapshots.value = snapshots;
});
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="text-h5 q-mr-md">Aggregate View</div>
      <q-badge color="primary" class="q-mr-md">
        {{ filteredPatents.toLocaleString() }} patents
      </q-badge>
      <q-badge color="secondary" class="q-mr-md">
        {{ totalGroups.toLocaleString() }} groups
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
      <q-btn
        color="primary"
        icon="play_arrow"
        label="Run"
        :loading="loading"
        @click="runAggregation"
        class="q-mr-sm"
      />
      <q-btn
        flat
        icon="download"
        label="Export CSV"
        :loading="exporting"
        :disable="results.length === 0"
        @click="exportCSV"
      />
    </div>

    <!-- Configuration Panel -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="row q-gutter-md">
          <!-- Group By -->
          <div class="col-12 col-md-4">
            <div class="text-subtitle2 q-mb-sm">Group By</div>
            <q-select
              v-model="selectedGroupBy"
              :options="groupByOptions"
              option-value="value"
              option-label="label"
              emit-value
              map-options
              multiple
              use-chips
              dense
              outlined
              label="Select fields to group by"
            >
              <template v-slot:option="{ itemProps, opt }">
                <q-item v-bind="itemProps">
                  <q-item-section>
                    <q-item-label>{{ opt.label }}</q-item-label>
                  </q-item-section>
                  <q-item-section v-if="opt.isArray" side>
                    <q-badge color="orange" label="array" />
                  </q-item-section>
                </q-item>
              </template>
            </q-select>

            <!-- Explode arrays toggle -->
            <q-toggle
              v-if="hasArrayGroupBy"
              v-model="explodeArrays"
              label="Explode arrays (patent appears in multiple groups)"
              dense
              class="q-mt-sm"
            />
          </div>

          <!-- Aggregations -->
          <div class="col-12 col-md-5">
            <div class="text-subtitle2 q-mb-sm">Aggregations</div>
            <div v-for="(agg, index) in aggregations" :key="index" class="row q-gutter-sm q-mb-sm items-center">
              <q-select
                v-model="agg.field"
                :options="aggFieldOptions"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                dense
                outlined
                style="min-width: 180px"
              />
              <q-select
                v-model="agg.op"
                :options="aggOpOptions"
                option-value="value"
                option-label="label"
                emit-value
                map-options
                dense
                outlined
                style="min-width: 120px"
              />
              <q-btn
                v-if="aggregations.length > 1"
                icon="close"
                flat
                round
                dense
                size="sm"
                color="grey"
                @click="removeAggregation(index)"
              />
            </div>
            <q-btn
              flat
              dense
              icon="add"
              label="Add Aggregation"
              color="primary"
              @click="addAggregation"
            />
          </div>

          <!-- Options -->
          <div class="col-12 col-md-3">
            <div class="text-subtitle2 q-mb-sm">Options</div>
            <q-input
              v-model.number="limit"
              type="number"
              label="Max rows"
              dense
              outlined
              style="max-width: 120px"
            />
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Filters -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section class="q-py-sm">
        <div class="text-subtitle2 q-mb-sm">Filters</div>
        <FlexFilterBuilder
          :model-value="filters"
          @update:model-value="onFiltersUpdate"
        />
      </q-card-section>
    </q-card>

    <!-- Results Table -->
    <q-table
      :rows="results"
      :columns="tableColumns"
      row-key="__index"
      :loading="loading"
      flat
      bordered
      :pagination="{ rowsPerPage: 50 }"
    >
      <!-- Sortable headers -->
      <template v-slot:header-cell="props">
        <q-th
          :props="props"
          class="cursor-pointer"
          @click="onSort(props.col.name)"
        >
          {{ props.col.label }}
          <q-icon
            v-if="sortBy === props.col.name"
            :name="sortDesc ? 'arrow_downward' : 'arrow_upward'"
            size="xs"
            class="q-ml-xs"
          />
        </q-th>
      </template>

      <!-- Number formatting -->
      <template v-slot:body-cell="props">
        <q-td :props="props">
          <template v-if="typeof props.value === 'number'">
            {{ props.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}
          </template>
          <template v-else>
            {{ props.value }}
          </template>
        </q-td>
      </template>

      <!-- No data -->
      <template v-slot:no-data>
        <div class="full-width row flex-center text-grey q-gutter-sm q-pa-xl">
          <q-icon size="2em" name="analytics" />
          <span>No aggregation results. Select group by fields and click Run.</span>
        </div>
      </template>
    </q-table>
  </q-page>
</template>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}
</style>
