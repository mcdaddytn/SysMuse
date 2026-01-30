<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { patentApi } from '@/services/api';
import type { Patent } from '@/types';

const router = useRouter();

// State
const patents = ref<Patent[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const total = ref(0);

// Pagination
const pagination = ref({
  page: 1,
  rowsPerPage: 100,
  rowsNumber: 0,
  sortBy: 'score',
  descending: true
});

// Table columns
const columns = [
  { name: 'rank', label: 'Rank', field: 'rank', align: 'center' as const, style: 'width: 60px' },
  { name: 'patent_id', label: 'Patent ID', field: 'patent_id', align: 'left' as const, sortable: true },
  { name: 'patent_title', label: 'Title', field: 'patent_title', align: 'left' as const },
  { name: 'affiliate', label: 'Affiliate', field: 'affiliate', align: 'left' as const, sortable: true },
  { name: 'super_sector', label: 'Sector', field: 'super_sector', align: 'left' as const, sortable: true },
  { name: 'forward_citations', label: 'Fwd Cites', field: 'forward_citations', align: 'center' as const, sortable: true },
  { name: 'remaining_years', label: 'Years Left', field: 'remaining_years', align: 'center' as const, sortable: true,
    format: (val: number) => val?.toFixed(1) },
  { name: 'score', label: 'Base Score', field: 'score', align: 'center' as const, sortable: true,
    format: (val: number) => val?.toFixed(1) }
];

// Fetch patents sorted by base score
async function fetchPatents() {
  loading.value = true;
  error.value = null;

  try {
    const response = await patentApi.getPatents(
      {
        page: pagination.value.page,
        rowsPerPage: pagination.value.rowsPerPage,
        sortBy: 'score',
        descending: true
      },
      { scoreMin: 0.01 } // Filter out zero-score patents
    );

    // Add rank based on pagination offset
    const startRank = (pagination.value.page - 1) * pagination.value.rowsPerPage + 1;
    patents.value = response.data.map((p, idx) => ({
      ...p,
      rank: startRank + idx
    }));
    total.value = response.total;
    pagination.value.rowsNumber = response.total;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load patents';
    console.error('Failed to fetch patents:', err);
  } finally {
    loading.value = false;
  }
}

// Handle pagination request
function onRequest(props: { pagination: typeof pagination.value }) {
  pagination.value.page = props.pagination.page;
  pagination.value.rowsPerPage = props.pagination.rowsPerPage;
  fetchPatents();
}

// Navigate to patent detail
function goToPatent(patentId: string) {
  router.push({ name: 'patent-detail', params: { id: patentId } });
}

// Initialize
onMounted(async () => {
  await fetchPatents();
});
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5">Base Score Rankings</div>
      <q-badge color="primary" class="q-ml-md">
        {{ total.toLocaleString() }} patents
      </q-badge>
      <q-space />
      <q-spinner v-if="loading" color="primary" size="sm" class="q-mr-sm" />
    </div>

    <div class="row q-gutter-lg">
      <!-- Formula Explanation -->
      <q-card class="col-3">
        <q-card-section>
          <div class="text-h6 q-mb-md">Base Score Formula</div>

          <div class="text-body2 q-mb-md">
            Multi-factor score calculated when patents are loaded. Uses citation count,
            remaining life, citation velocity, and sector value.
          </div>

          <q-separator class="q-my-md" />

          <div class="text-subtitle2 q-mb-sm">Formula</div>
          <code class="text-caption">
            base_score = (citation + time + velocity) × sector
          </code>

          <q-separator class="q-my-md" />

          <div class="text-subtitle2 q-mb-sm">Components</div>
          <div class="q-gutter-sm">
            <div class="row items-center">
              <q-icon name="format_quote" color="primary" class="q-mr-sm" />
              <div>
                <span class="text-caption text-weight-medium">Citation Score</span>
                <div class="text-caption text-grey-7">log10(citations + 1) × 40</div>
              </div>
            </div>
            <div class="row items-center">
              <q-icon name="schedule" color="secondary" class="q-mr-sm" />
              <div>
                <span class="text-caption text-weight-medium">Time Score</span>
                <div class="text-caption text-grey-7">remaining_years / 20 × 25 (expired get penalty, not zero)</div>
              </div>
            </div>
            <div class="row items-center">
              <q-icon name="speed" color="accent" class="q-mr-sm" />
              <div>
                <span class="text-caption text-weight-medium">Velocity Score</span>
                <div class="text-caption text-grey-7">log10(citations/year + 1) × 20</div>
              </div>
            </div>
            <div class="row items-center">
              <q-icon name="category" color="positive" class="q-mr-sm" />
              <div>
                <span class="text-caption text-weight-medium">Sector Multiplier</span>
                <div class="text-caption text-grey-7">0.8× (Low) to 1.5× (Very High damages)</div>
              </div>
            </div>
          </div>
        </q-card-section>

        <q-card-section class="bg-grey-2">
          <div class="text-subtitle2 q-mb-sm">For More Advanced Scoring</div>
          <div class="text-caption text-grey-7 q-mb-sm">
            Use v2 or v3 scoring pages to apply weighted formulas that include
            competitor citations and other factors.
          </div>
          <div class="row q-gutter-sm">
            <q-btn
              outline
              size="sm"
              color="primary"
              label="v2 Scoring"
              :to="{ name: 'v2-scoring' }"
            />
            <q-btn
              outline
              size="sm"
              color="secondary"
              label="v3 Scoring"
              :to="{ name: 'v3-scoring' }"
            />
          </div>
        </q-card-section>
      </q-card>

      <!-- Rankings Grid -->
      <q-card class="col">
        <q-card-section class="q-pb-none">
          <div class="row items-center">
            <div class="text-h6">Patent Rankings by Base Score</div>
          </div>
        </q-card-section>

        <q-card-section>
          <!-- Error State -->
          <q-banner v-if="error" class="bg-negative text-white q-mb-md">
            {{ error }}
            <template v-slot:action>
              <q-btn flat label="Retry" @click="fetchPatents" />
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
            <!-- Rank column -->
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

            <!-- Title with truncation and larger tooltip -->
            <template v-slot:body-cell-patent_title="props">
              <q-td :props="props">
                <div class="ellipsis" style="max-width: 350px">
                  {{ props.row.patent_title }}
                  <q-tooltip
                    v-if="props.row.patent_title?.length > 50"
                    max-width="500px"
                    class="text-body2"
                  >
                    {{ props.row.patent_title }}
                  </q-tooltip>
                </div>
              </q-td>
            </template>

            <!-- Sector chip -->
            <template v-slot:body-cell-super_sector="props">
              <q-td :props="props">
                <q-chip dense size="sm" color="grey-4">
                  {{ props.row.super_sector }}
                </q-chip>
              </q-td>
            </template>

            <!-- Score with color coding -->
            <template v-slot:body-cell-score="props">
              <q-td :props="props">
                <q-badge
                  :color="props.row.score > 100 ? 'positive' : props.row.score > 50 ? 'warning' : 'grey'"
                >
                  {{ props.row.score?.toFixed(1) }}
                </q-badge>
                <q-tooltip class="text-body2">
                  {{ props.row.forward_citations }} citations × 1.5 = {{ (props.row.forward_citations * 1.5).toFixed(1) }}
                </q-tooltip>
              </q-td>
            </template>

            <!-- No data -->
            <template v-slot:no-data>
              <div class="full-width row flex-center text-grey q-gutter-sm q-pa-xl">
                <q-icon size="2em" name="sentiment_dissatisfied" />
                <span>No patents found</span>
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

code {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.85em;
  line-height: 1.6;
  display: block;
  background: #f5f5f5;
  padding: 8px 12px;
  border-radius: 4px;
}

/* Larger tooltip text */
:deep(.q-tooltip) {
  font-size: 14px !important;
}
</style>
