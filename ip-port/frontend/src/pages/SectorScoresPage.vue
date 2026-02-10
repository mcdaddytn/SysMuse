<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { sectorApi, scoringTemplatesApi } from '@/services/api';
import type { SectorScoringProgress, ScoredPatent, SuperSectorProgress } from '@/services/api';
import type { SuperSectorDetail } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const superSectors = ref<SuperSectorDetail[]>([]);
const sectorProgress = ref<Map<string, SectorScoringProgress>>(new Map());
const loading = ref(false);
const loadingProgress = ref(false);
const exportLoading = ref(false);
const error = ref<string | null>(null);

// View mode
const viewMode = ref<'summary' | 'super-sector' | 'sector'>('summary');
const selectedSuperSector = ref<string | null>(null);
const selectedSector = ref<string | null>(null);

// Super-sector detail view
const superSectorDetail = ref<SuperSectorProgress | null>(null);
const superSectorLoading = ref(false);

// Sector scores view
const sectorScores = ref<ScoredPatent[]>([]);
const sectorScoresLoading = ref(false);
const sectorScoresTotal = ref(0);
const sectorMetricNames = ref<string[]>([]);
const scoresPagination = ref({
  page: 1,
  rowsPerPage: 25,
  sortBy: 'compositeScore',
  descending: true,
  rowsNumber: 0
});

// Patent detail dialog
const showPatentDetail = ref(false);
const selectedPatent = ref<ScoredPatent | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────────────────────────────────────

const totalScored = computed(() => {
  let total = 0;
  sectorProgress.value.forEach(p => { total += p.scored; });
  return total;
});

const totalWithClaims = computed(() => {
  let total = 0;
  sectorProgress.value.forEach(p => { total += p.withClaims; });
  return total;
});

const progressRows = computed(() => {
  const rows: Array<SectorScoringProgress & { id: string }> = [];
  sectorProgress.value.forEach((p, key) => {
    rows.push({ ...p, id: key });
  });
  return rows.sort((a, b) => b.scored - a.scored);
});

const scoreColumns = computed(() => {
  const base = [
    { name: 'patentId', label: 'Patent ID', field: 'patentId', sortable: true, align: 'left' as const },
    { name: 'patentTitle', label: 'Title', field: 'patentTitle', sortable: true, align: 'left' as const, style: 'max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' },
    { name: 'compositeScore', label: 'Score', field: 'compositeScore', sortable: true, align: 'right' as const },
    { name: 'withClaims', label: 'Claims', field: 'withClaims', sortable: true, align: 'center' as const },
  ];
  return base;
});

// ─────────────────────────────────────────────────────────────────────────────
// Data Loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadSuperSectors() {
  loading.value = true;
  try {
    superSectors.value = await sectorApi.getSuperSectors();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load sectors';
  } finally {
    loading.value = false;
  }
}

async function loadAllProgress() {
  loadingProgress.value = true;
  error.value = null;

  try {
    const allSectors = superSectors.value.flatMap(ss => ss.sectors);
    const progressMap = new Map<string, SectorScoringProgress>();

    // Load progress for each sector (batch for performance)
    const promises = allSectors.map(async (sector) => {
      try {
        const progress = await scoringTemplatesApi.getSectorProgress(sector.name);
        if (progress.scored > 0) {
          progressMap.set(sector.name, progress);
        }
      } catch {
        // Ignore individual sector errors
      }
    });

    await Promise.all(promises);
    sectorProgress.value = progressMap;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load progress';
  } finally {
    loadingProgress.value = false;
  }
}

async function loadSuperSectorDetail(superSectorName: string) {
  superSectorLoading.value = true;
  error.value = null;
  try {
    superSectorDetail.value = await scoringTemplatesApi.getSuperSectorProgress(superSectorName);
    selectedSuperSector.value = superSectorName;
    viewMode.value = 'super-sector';
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load super-sector details';
  } finally {
    superSectorLoading.value = false;
  }
}

async function loadSectorScores(sectorName: string) {
  sectorScoresLoading.value = true;
  error.value = null;
  try {
    const result = await scoringTemplatesApi.getSectorScores(sectorName, {
      limit: scoresPagination.value.rowsPerPage,
      offset: (scoresPagination.value.page - 1) * scoresPagination.value.rowsPerPage,
      order: scoresPagination.value.descending ? 'desc' : 'asc'
    });
    sectorScores.value = result.results;
    sectorScoresTotal.value = result.total;
    sectorMetricNames.value = result.metricNames;
    scoresPagination.value.rowsNumber = result.total;
    selectedSector.value = sectorName;
    viewMode.value = 'sector';
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load sector scores';
  } finally {
    sectorScoresLoading.value = false;
  }
}

async function exportSuperSector(superSectorName: string) {
  exportLoading.value = true;
  try {
    const blob = await scoringTemplatesApi.exportScores(superSectorName);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${superSectorName}-llm-scores.csv`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Export failed';
  } finally {
    exportLoading.value = false;
  }
}

function showPatentDetails(patent: ScoredPatent) {
  selectedPatent.value = patent;
  showPatentDetail.value = true;
}

function goBack() {
  if (viewMode.value === 'sector') {
    viewMode.value = 'super-sector';
    selectedSector.value = null;
  } else if (viewMode.value === 'super-sector') {
    viewMode.value = 'summary';
    selectedSuperSector.value = null;
    superSectorDetail.value = null;
  }
}

function getScoreColor(score: number): string {
  if (score >= 60) return 'positive';
  if (score >= 45) return 'primary';
  if (score >= 30) return 'warning';
  return 'grey';
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadSuperSectors();
  await loadAllProgress();
});

// Watch pagination changes
watch(scoresPagination, async () => {
  if (selectedSector.value && viewMode.value === 'sector') {
    await loadSectorScores(selectedSector.value);
  }
}, { deep: true });
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="col">
        <div class="row items-center q-gutter-sm">
          <q-btn
            v-if="viewMode !== 'summary'"
            flat
            dense
            round
            icon="arrow_back"
            @click="goBack"
          />
          <div>
            <div class="text-h5">
              <template v-if="viewMode === 'summary'">LLM Sector Scores</template>
              <template v-else-if="viewMode === 'super-sector'">{{ superSectorDetail?.displayName }}</template>
              <template v-else>{{ selectedSector }} Scores</template>
            </div>
            <div class="text-caption text-grey-7">
              <template v-if="viewMode === 'summary'">
                {{ totalScored.toLocaleString() }} patents scored
                ({{ totalWithClaims.toLocaleString() }} with claims)
              </template>
              <template v-else-if="viewMode === 'super-sector' && superSectorDetail">
                {{ superSectorDetail.totals.scored.toLocaleString() }} / {{ superSectorDetail.totals.total.toLocaleString() }} patents
                ({{ superSectorDetail.totals.percentComplete }}% complete)
              </template>
              <template v-else>
                {{ sectorScoresTotal.toLocaleString() }} scored patents
              </template>
            </div>
          </div>
        </div>
      </div>
      <div class="col-auto">
        <q-btn
          flat
          icon="refresh"
          label="Refresh"
          :loading="loadingProgress"
          @click="loadAllProgress"
        />
      </div>
    </div>

    <!-- Error Banner -->
    <q-banner v-if="error" class="bg-negative text-white q-mb-md">
      {{ error }}
      <template v-slot:action>
        <q-btn flat label="Dismiss" @click="error = null" />
      </template>
    </q-banner>

    <!-- Loading State -->
    <div v-if="loading" class="text-center q-pa-xl">
      <q-spinner size="lg" />
      <div class="q-mt-md text-grey-7">Loading sectors...</div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- SUMMARY VIEW -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <template v-else-if="viewMode === 'summary'">
      <div class="row q-col-gutter-md">
        <div
          v-for="ss in superSectors"
          :key="ss.id"
          class="col-12 col-md-6 col-lg-4"
        >
          <q-card flat bordered class="cursor-pointer" @click="loadSuperSectorDetail(ss.name)">
            <q-card-section>
              <div class="row items-center">
                <div class="col">
                  <div class="text-subtitle1 text-weight-medium">{{ ss.displayName }}</div>
                  <div class="text-caption text-grey-7">{{ ss.sectors.length }} sectors</div>
                </div>
                <div class="col-auto q-gutter-xs">
                  <q-btn
                    flat
                    dense
                    icon="download"
                    color="primary"
                    :loading="exportLoading"
                    @click.stop="exportSuperSector(ss.name)"
                  >
                    <q-tooltip>Export CSV</q-tooltip>
                  </q-btn>
                  <q-btn
                    flat
                    dense
                    icon="chevron_right"
                    color="grey-7"
                  >
                    <q-tooltip>View details</q-tooltip>
                  </q-btn>
                </div>
              </div>
            </q-card-section>

            <q-separator />

            <q-card-section class="q-pa-none">
              <q-list dense separator>
                <q-item
                  v-for="sector in ss.sectors.slice(0, 5)"
                  :key="sector.id"
                  :class="{ 'bg-grey-1': sectorProgress.get(sector.name)?.percentComplete === 100 }"
                >
                  <q-item-section>
                    <q-item-label>{{ sector.displayName }}</q-item-label>
                    <q-item-label caption>
                      <span v-if="sectorProgress.get(sector.name)">
                        {{ sectorProgress.get(sector.name)?.scored }} / {{ sectorProgress.get(sector.name)?.total }}
                      </span>
                      <span v-else class="text-grey-5">Not scored</span>
                    </q-item-label>
                  </q-item-section>

                  <q-item-section side v-if="sectorProgress.get(sector.name)">
                    <q-badge
                      v-if="sectorProgress.get(sector.name)?.avgScore"
                      :color="getScoreColor(sectorProgress.get(sector.name)?.avgScore || 0)"
                    >
                      {{ sectorProgress.get(sector.name)?.avgScore?.toFixed(1) }}
                    </q-badge>
                  </q-item-section>
                </q-item>
                <q-item v-if="ss.sectors.length > 5" class="text-caption text-grey-6">
                  <q-item-section>+ {{ ss.sectors.length - 5 }} more sectors</q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- SUPER-SECTOR DETAIL VIEW -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <template v-else-if="viewMode === 'super-sector' && superSectorDetail">
      <q-inner-loading :showing="superSectorLoading" />

      <!-- Summary Card -->
      <q-card flat bordered class="q-mb-md">
        <q-card-section>
          <div class="row q-col-gutter-md">
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">Total Patents</div>
              <div class="text-h5">{{ superSectorDetail.totals.total.toLocaleString() }}</div>
            </div>
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">Scored</div>
              <div class="text-h5 text-positive">{{ superSectorDetail.totals.scored.toLocaleString() }}</div>
            </div>
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">With Claims</div>
              <div class="text-h5 text-primary">{{ superSectorDetail.totals.withClaims.toLocaleString() }}</div>
            </div>
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">Remaining</div>
              <div class="text-h5 text-grey-7">{{ superSectorDetail.totals.remaining.toLocaleString() }}</div>
            </div>
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">Avg Score</div>
              <div class="text-h5" :class="superSectorDetail.totals.avgScore ? `text-${getScoreColor(superSectorDetail.totals.avgScore)}` : ''">
                {{ superSectorDetail.totals.avgScore?.toFixed(1) || '-' }}
              </div>
            </div>
            <div class="col-6 col-sm-2">
              <div class="text-caption text-grey-7">Progress</div>
              <div class="text-h5">{{ superSectorDetail.totals.percentComplete }}%</div>
            </div>
          </div>
          <q-linear-progress
            :value="superSectorDetail.totals.percentComplete / 100"
            size="lg"
            color="primary"
            track-color="grey-3"
            rounded
            class="q-mt-md"
          />
        </q-card-section>
      </q-card>

      <!-- Sector List -->
      <q-card flat bordered>
        <q-card-section class="q-pb-none">
          <div class="text-subtitle2">Sectors ({{ superSectorDetail.sectorCount }})</div>
        </q-card-section>
        <q-card-section class="q-pa-none">
          <q-table
            :rows="superSectorDetail.sectors"
            :columns="[
              { name: 'displayName', label: 'Sector', field: 'displayName', align: 'left', sortable: true },
              { name: 'scored', label: 'Scored', field: 'scored', align: 'right', sortable: true },
              { name: 'total', label: 'Total', field: 'total', align: 'right', sortable: true },
              { name: 'withClaims', label: 'With Claims', field: 'withClaims', align: 'right', sortable: true },
              { name: 'percentComplete', label: 'Progress', field: 'percentComplete', align: 'right', sortable: true },
              { name: 'avgScore', label: 'Avg Score', field: 'avgScore', align: 'right', sortable: true },
              { name: 'actions', label: '', field: 'sectorName', align: 'right' },
            ]"
            row-key="sectorId"
            flat
            dense
            :pagination="{ rowsPerPage: 20 }"
            hide-bottom
          >
            <template #body-cell-displayName="props">
              <q-td :props="props">
                <span class="cursor-pointer text-primary" @click="loadSectorScores(props.row.sectorName)">
                  {{ props.row.displayName }}
                </span>
              </q-td>
            </template>
            <template #body-cell-percentComplete="props">
              <q-td :props="props">
                <div class="row items-center q-gutter-xs">
                  <q-linear-progress
                    :value="props.row.percentComplete / 100"
                    :color="props.row.percentComplete === 100 ? 'positive' : 'primary'"
                    track-color="grey-3"
                    rounded
                    size="sm"
                    style="width: 60px"
                  />
                  <span class="text-caption">{{ props.row.percentComplete }}%</span>
                </div>
              </q-td>
            </template>
            <template #body-cell-avgScore="props">
              <q-td :props="props">
                <q-badge
                  v-if="props.row.avgScore"
                  :color="getScoreColor(props.row.avgScore)"
                  :label="props.row.avgScore.toFixed(1)"
                />
                <span v-else class="text-grey-5">-</span>
              </q-td>
            </template>
            <template #body-cell-actions="props">
              <q-td :props="props">
                <q-btn
                  v-if="props.row.scored > 0"
                  flat
                  dense
                  round
                  icon="visibility"
                  color="primary"
                  @click="loadSectorScores(props.row.sectorName)"
                >
                  <q-tooltip>View scores</q-tooltip>
                </q-btn>
              </q-td>
            </template>
          </q-table>
        </q-card-section>
      </q-card>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- SECTOR SCORES VIEW -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <template v-else-if="viewMode === 'sector'">
      <q-inner-loading :showing="sectorScoresLoading" />

      <!-- Metrics Legend -->
      <q-card v-if="sectorMetricNames.length > 0" flat bordered class="q-mb-md">
        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">Scoring Metrics ({{ sectorMetricNames.length }})</div>
          <div class="row q-gutter-sm">
            <q-chip
              v-for="metric in sectorMetricNames"
              :key="metric"
              dense
              outline
              color="primary"
            >
              {{ metric.replace(/_/g, ' ') }}
            </q-chip>
          </div>
        </q-card-section>
      </q-card>

      <!-- Scores Table -->
      <q-card flat bordered>
        <q-table
          :rows="sectorScores"
          :columns="scoreColumns"
          row-key="patentId"
          flat
          dense
          :loading="sectorScoresLoading"
          v-model:pagination="scoresPagination"
          :rows-per-page-options="[10, 25, 50, 100]"
          @request="(props) => { scoresPagination = props.pagination; }"
        >
          <template #body-cell-patentId="props">
            <q-td :props="props">
              <span
                class="cursor-pointer text-primary"
                @click="showPatentDetails(props.row)"
              >
                {{ props.row.patentId }}
              </span>
            </q-td>
          </template>
          <template #body-cell-patentTitle="props">
            <q-td :props="props">
              <span :title="props.row.patentTitle">{{ props.row.patentTitle }}</span>
            </q-td>
          </template>
          <template #body-cell-compositeScore="props">
            <q-td :props="props">
              <q-badge
                :color="getScoreColor(props.row.compositeScore)"
                :label="props.row.compositeScore.toFixed(1)"
              />
            </q-td>
          </template>
          <template #body-cell-withClaims="props">
            <q-td :props="props">
              <q-icon
                :name="props.row.withClaims ? 'check_circle' : 'cancel'"
                :color="props.row.withClaims ? 'positive' : 'grey-4'"
                size="sm"
              />
            </q-td>
          </template>
        </q-table>
      </q-card>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- PATENT DETAIL DIALOG -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <q-dialog v-model="showPatentDetail" maximized transition-show="slide-up" transition-hide="slide-down">
      <q-card v-if="selectedPatent">
        <q-bar class="bg-primary text-white">
          <div class="text-weight-bold">Patent {{ selectedPatent.patentId }}</div>
          <q-space />
          <q-btn dense flat icon="close" v-close-popup />
        </q-bar>

        <q-card-section>
          <div class="text-h6">{{ selectedPatent.patentTitle }}</div>
          <div class="text-caption text-grey-7 q-mb-md">
            {{ selectedPatent.assignee }} &middot; {{ selectedPatent.patentDate }}
          </div>

          <div class="row q-col-gutter-md q-mb-md">
            <div class="col-auto">
              <q-badge
                :color="getScoreColor(selectedPatent.compositeScore)"
                class="text-body1 q-pa-sm"
              >
                Composite: {{ selectedPatent.compositeScore.toFixed(2) }}
              </q-badge>
            </div>
            <div class="col-auto">
              <q-chip
                :icon="selectedPatent.withClaims ? 'check_circle' : 'cancel'"
                :color="selectedPatent.withClaims ? 'positive' : 'grey'"
                text-color="white"
              >
                {{ selectedPatent.withClaims ? 'Scored with claims' : 'No claims' }}
              </q-chip>
            </div>
            <div class="col-auto" v-if="selectedPatent.executedAt">
              <q-chip icon="schedule" color="grey-7" text-color="white">
                {{ new Date(selectedPatent.executedAt).toLocaleDateString() }}
              </q-chip>
            </div>
          </div>
        </q-card-section>

        <q-separator />

        <q-card-section class="q-pa-none" style="max-height: calc(100vh - 200px); overflow-y: auto;">
          <q-list separator>
            <q-expansion-item
              v-for="metric in selectedPatent.metrics"
              :key="metric.fieldName"
              :label="metric.displayName"
              :caption="`Score: ${metric.score}/10`"
              expand-separator
              dense
            >
              <template #header>
                <q-item-section avatar>
                  <q-badge
                    :color="getScoreColor(metric.score * 10)"
                    :label="metric.score.toString()"
                    class="text-weight-bold"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ metric.displayName }}</q-item-label>
                </q-item-section>
              </template>
              <q-card>
                <q-card-section class="bg-grey-1">
                  <div class="text-subtitle2 q-mb-xs">Reasoning</div>
                  <div class="text-body2" style="white-space: pre-wrap;">{{ metric.reasoning || 'No reasoning provided' }}</div>
                </q-card-section>
              </q-card>
            </q-expansion-item>
          </q-list>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.q-linear-progress {
  min-width: 60px;
}
</style>
