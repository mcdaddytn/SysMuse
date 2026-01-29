<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { scoringApi, type ScoreWeights, type WeightPreset, type ScoredPatent } from '@/services/api';
import { useDebounceFn } from '@vueuse/core';

const router = useRouter();

// Weight sliders
const citationWeight = ref(50);
const yearsWeight = ref(30);
const competitorWeight = ref(20);

// State
const patents = ref<ScoredPatent[]>([]);
const previousRanks = ref<Map<string, number>>(new Map());
const presets = ref<WeightPreset[]>([]);
const selectedPreset = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const total = ref(0);

// Pagination
const pagination = ref({
  page: 1,
  rowsPerPage: 50,
  rowsNumber: 0,
  sortBy: 'rank',
  descending: false
});

// Normalize weights to 100%
const normalizedWeights = computed(() => {
  const total = citationWeight.value + yearsWeight.value + competitorWeight.value;
  if (total === 0) return { citation: 33.3, years: 33.3, competitor: 33.4 };
  return {
    citation: (citationWeight.value / total) * 100,
    years: (yearsWeight.value / total) * 100,
    competitor: (competitorWeight.value / total) * 100
  };
});

// Current weights object
const currentWeights = computed<ScoreWeights>(() => ({
  citation: citationWeight.value,
  years: yearsWeight.value,
  competitor: competitorWeight.value
}));

// Table columns
const columns = [
  { name: 'rank', label: 'Rank', field: 'rank', align: 'center' as const, sortable: true },
  { name: 'change', label: '', field: 'rank_change', align: 'center' as const, style: 'width: 50px' },
  { name: 'patent_id', label: 'Patent ID', field: 'patent_id', align: 'left' as const },
  { name: 'patent_title', label: 'Title', field: 'patent_title', align: 'left' as const },
  { name: 'affiliate', label: 'Affiliate', field: 'affiliate', align: 'left' as const },
  { name: 'forward_citations', label: 'Fwd Cites', field: 'forward_citations', align: 'center' as const, sortable: true },
  { name: 'remaining_years', label: 'Years Left', field: 'remaining_years', align: 'center' as const, sortable: true,
    format: (val: number) => val?.toFixed(1) },
  { name: 'competitor_citations', label: 'Comp Cites', field: 'competitor_citations', align: 'center' as const, sortable: true },
  { name: 'v2_score', label: 'v2 Score', field: 'v2_score', align: 'center' as const, sortable: true,
    format: (val: number) => val?.toFixed(2) }
];

// Fetch scores from API (only patents with score > 0)
async function fetchScores() {
  loading.value = true;
  error.value = null;

  try {
    const response = await scoringApi.getV2Scores(
      currentWeights.value,
      {
        page: pagination.value.page,
        limit: pagination.value.rowsPerPage
      },
      0.01  // minScore: filter out patents with effectively zero score
    );

    // Calculate rank changes compared to previous
    const newPatents = response.data.map(p => {
      const prevRank = previousRanks.value.get(p.patent_id);
      return {
        ...p,
        rank_change: prevRank !== undefined ? prevRank - p.rank : undefined
      };
    });

    // Store current ranks for next comparison
    const newRanks = new Map<string, number>();
    response.data.forEach(p => newRanks.set(p.patent_id, p.rank));
    previousRanks.value = newRanks;

    patents.value = newPatents;
    total.value = response.total;
    pagination.value.rowsNumber = response.total;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load scores';
    console.error('Failed to fetch scores:', err);
  } finally {
    loading.value = false;
  }
}

// Debounced fetch for slider changes
const debouncedFetch = useDebounceFn(fetchScores, 300);

// Load presets
async function loadPresets() {
  try {
    presets.value = await scoringApi.getWeightPresets();
  } catch (err) {
    console.error('Failed to load presets:', err);
  }
}

// Apply a preset
function applyPreset(preset: WeightPreset) {
  citationWeight.value = preset.weights.citation;
  yearsWeight.value = preset.weights.years;
  competitorWeight.value = preset.weights.competitor;
  selectedPreset.value = preset.name;
}

// Reset to default
function resetToDefault() {
  const defaultPreset = presets.value.find(p => p.name === 'Default');
  if (defaultPreset) {
    applyPreset(defaultPreset);
  } else {
    citationWeight.value = 50;
    yearsWeight.value = 30;
    competitorWeight.value = 20;
    selectedPreset.value = null;
  }
}

// Handle pagination request
function onRequest(props: { pagination: typeof pagination.value }) {
  pagination.value.page = props.pagination.page;
  pagination.value.rowsPerPage = props.pagination.rowsPerPage;
  fetchScores();
}

// Navigate to patent detail
function goToPatent(patentId: string) {
  router.push({ name: 'patent-detail', params: { id: patentId } });
}

// Watch for weight changes
watch([citationWeight, yearsWeight, competitorWeight], () => {
  selectedPreset.value = null; // Clear preset selection when manually adjusting
  debouncedFetch();
});

// Initialize
onMounted(async () => {
  await loadPresets();
  await fetchScores();
});
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5">v2 Scoring - Weighted Rankings</div>
      <q-badge color="primary" class="q-ml-md">
        {{ total.toLocaleString() }} patents
      </q-badge>
    </div>

    <div class="row q-gutter-lg">
      <!-- Weight Controls -->
      <q-card class="col-3">
        <q-card-section>
          <div class="text-h6 q-mb-md">Weight Controls</div>

          <!-- Citation Weight -->
          <div class="q-mb-lg">
            <div class="row justify-between items-center">
              <span>Citation Weight</span>
              <q-badge color="primary">{{ normalizedWeights.citation.toFixed(1) }}%</q-badge>
            </div>
            <q-slider
              v-model="citationWeight"
              :min="0"
              :max="100"
              :step="1"
              label
              color="primary"
              class="q-mt-sm"
            />
            <div class="text-caption text-grey-6">
              Forward citations (log scale)
            </div>
          </div>

          <!-- Years Weight -->
          <div class="q-mb-lg">
            <div class="row justify-between items-center">
              <span>Years Remaining</span>
              <q-badge color="secondary">{{ normalizedWeights.years.toFixed(1) }}%</q-badge>
            </div>
            <q-slider
              v-model="yearsWeight"
              :min="0"
              :max="100"
              :step="1"
              label
              color="secondary"
              class="q-mt-sm"
            />
            <div class="text-caption text-grey-6">
              Patent life remaining (linear)
            </div>
          </div>

          <!-- Competitor Weight -->
          <div class="q-mb-lg">
            <div class="row justify-between items-center">
              <span>Competitor Citations</span>
              <q-badge color="accent">{{ normalizedWeights.competitor.toFixed(1) }}%</q-badge>
            </div>
            <q-slider
              v-model="competitorWeight"
              :min="0"
              :max="100"
              :step="1"
              label
              color="accent"
              class="q-mt-sm"
            />
            <div class="text-caption text-grey-6">
              Citations from competitors
            </div>
          </div>

          <q-separator class="q-my-md" />

          <!-- Presets -->
          <div class="text-subtitle2 q-mb-sm">Presets</div>
          <div class="row q-gutter-sm q-mb-md">
            <q-chip
              v-for="preset in presets"
              :key="preset.name"
              clickable
              :color="selectedPreset === preset.name ? 'primary' : 'grey-4'"
              :text-color="selectedPreset === preset.name ? 'white' : 'black'"
              size="sm"
              @click="applyPreset(preset)"
            >
              {{ preset.name }}
            </q-chip>
          </div>

          <q-btn
            outline
            color="grey"
            label="Reset to Default"
            icon="restart_alt"
            class="full-width"
            @click="resetToDefault"
          />
        </q-card-section>

        <!-- Formula Display -->
        <q-card-section class="bg-grey-2">
          <div class="text-subtitle2 q-mb-sm">Current Formula</div>
          <code class="text-caption">
            score = log10(fwd_cites + 1) × {{ normalizedWeights.citation.toFixed(0) }}%
            <br />+ years_left/20 × {{ normalizedWeights.years.toFixed(0) }}%
            <br />+ comp_cites × {{ normalizedWeights.competitor.toFixed(0) }}%
          </code>
        </q-card-section>
      </q-card>

      <!-- Rankings Grid -->
      <q-card class="col">
        <q-card-section class="q-pb-none">
          <div class="row items-center">
            <div class="text-h6">Patent Rankings</div>
            <q-space />
            <q-spinner v-if="loading" color="primary" size="sm" class="q-mr-sm" />
            <span v-if="loading" class="text-grey-6 text-caption">Recalculating...</span>
          </div>
        </q-card-section>

        <q-card-section>
          <!-- Error State -->
          <q-banner v-if="error" class="bg-negative text-white q-mb-md">
            {{ error }}
            <template v-slot:action>
              <q-btn flat label="Retry" @click="fetchScores" />
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

            <!-- Rank change indicator -->
            <template v-slot:body-cell-change="props">
              <q-td :props="props">
                <template v-if="props.row.rank_change !== undefined && props.row.rank_change !== 0">
                  <q-icon
                    :name="props.row.rank_change > 0 ? 'arrow_upward' : 'arrow_downward'"
                    :color="props.row.rank_change > 0 ? 'positive' : 'negative'"
                    size="xs"
                  />
                  <span
                    :class="props.row.rank_change > 0 ? 'text-positive' : 'text-negative'"
                    class="text-caption"
                  >
                    {{ Math.abs(props.row.rank_change) }}
                  </span>
                </template>
                <span v-else-if="props.row.rank_change === 0" class="text-grey-5">-</span>
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

            <!-- Title with truncation -->
            <template v-slot:body-cell-patent_title="props">
              <q-td :props="props">
                <div class="ellipsis" style="max-width: 300px">
                  {{ props.row.patent_title }}
                  <q-tooltip v-if="props.row.patent_title?.length > 50">
                    {{ props.row.patent_title }}
                  </q-tooltip>
                </div>
              </q-td>
            </template>

            <!-- Score with color coding -->
            <template v-slot:body-cell-v2_score="props">
              <q-td :props="props">
                <q-badge
                  :color="props.row.v2_score > 50 ? 'positive' : props.row.v2_score > 25 ? 'warning' : 'grey'"
                >
                  {{ props.row.v2_score?.toFixed(2) }}
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
}
</style>
