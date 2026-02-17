<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { sectorApi, scoringTemplatesApi } from '@/services/api';
import type {
  ScoredPatent, SuperSectorProgress, MergedSectorTemplate
} from '@/services/api';
import type { SuperSectorDetail } from '@/types';
import SectorScoreTooltip from '@/components/SectorScoreTooltip.vue';

const router = useRouter();

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const superSectors = ref<SuperSectorDetail[]>([]);
const superSectorProgressMap = ref<Map<string, SuperSectorProgress>>(new Map());
const loading = ref(false);
const error = ref<string | null>(null);

// Expansion state
const expandedSuperSectors = reactive(new Set<string>());
const expandedSectors = reactive(new Set<string>());
const sectorLoadingSet = reactive(new Set<string>());

// Caches
const sectorScoresCache = reactive(new Map<string, {
  data: ScoredPatent[];
  total: number;
  page: number;
}>());
const sectorTemplateCache = reactive(new Map<string, MergedSectorTemplate>());

// Column toggles
const showV2Score = ref(false);
const showV3Score = ref(false);
const showBaseScore = ref(false);

// Patent detail dialog
const showPatentDetail = ref(false);
const selectedPatent = ref<ScoredPatent | null>(null);
const selectedPatentSector = ref<string | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────────────────────────────────────

const totalScored = computed(() => {
  let total = 0;
  superSectorProgressMap.value.forEach(p => { total += p.totals.scored; });
  return total;
});

const totalPatents = computed(() => {
  let total = 0;
  superSectorProgressMap.value.forEach(p => { total += p.totals.total; });
  return total;
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getScoreColor(score: number | null | undefined): string {
  if (score == null) return 'grey';
  if (score >= 60) return 'positive';
  if (score >= 45) return 'primary';
  if (score >= 30) return 'warning';
  return 'grey';
}

function patentColumns() {
  const cols: any[] = [
    { name: 'patentId', label: 'Patent ID', field: 'patentId', sortable: true, align: 'left' as const, style: 'width: 110px' },
    { name: 'patentTitle', label: 'Title', field: 'patentTitle', sortable: true, align: 'left' as const, style: 'max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' },
    { name: 'compositeScore', label: 'Sector Score', field: 'compositeScore', sortable: true, align: 'right' as const, style: 'width: 100px' },
  ];
  if (showV2Score.value) {
    cols.push({ name: 'v2Score', label: 'V2', field: 'v2Score', sortable: true, align: 'right' as const, style: 'width: 65px' });
  }
  if (showV3Score.value) {
    cols.push({ name: 'v3Score', label: 'V3', field: 'v3Score', sortable: true, align: 'right' as const, style: 'width: 65px' });
  }
  if (showBaseScore.value) {
    cols.push({ name: 'baseScore', label: 'Base', field: 'baseScore', sortable: true, align: 'right' as const, style: 'width: 65px' });
  }
  cols.push(
    { name: 'assignee', label: 'Assignee', field: 'assignee', sortable: true, align: 'left' as const, style: 'max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' },
    { name: 'remainingYears', label: 'Years Rem.', field: 'remainingYears', sortable: true, align: 'right' as const, style: 'width: 85px' },
    { name: 'withClaims', label: 'Claims', field: 'withClaims', sortable: true, align: 'center' as const, style: 'width: 60px' },
  );
  return cols;
}

function goToPatent(patentId: string) {
  router.push({ name: 'patent-detail', params: { id: patentId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadSuperSectors() {
  loading.value = true;
  error.value = null;
  try {
    superSectors.value = await sectorApi.getSuperSectors();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load sectors';
  } finally {
    loading.value = false;
  }
}

async function loadAllSuperSectorProgress() {
  const promises = superSectors.value.map(async (ss) => {
    try {
      const progress = await scoringTemplatesApi.getSuperSectorProgress(ss.name);
      superSectorProgressMap.value.set(ss.name, progress);
    } catch {
      // Ignore individual failures
    }
  });
  await Promise.all(promises);
  // Force reactivity update
  superSectorProgressMap.value = new Map(superSectorProgressMap.value);
}

function toggleSuperSector(ssName: string) {
  if (expandedSuperSectors.has(ssName)) {
    expandedSuperSectors.delete(ssName);
  } else {
    expandedSuperSectors.add(ssName);
  }
}

async function toggleSector(sectorName: string) {
  if (expandedSectors.has(sectorName)) {
    expandedSectors.delete(sectorName);
    return;
  }
  expandedSectors.add(sectorName);

  // Load scores and template in parallel if not cached
  const promises: Promise<void>[] = [];

  if (!sectorScoresCache.has(sectorName)) {
    promises.push(loadSectorScores(sectorName, 0));
  }
  if (!sectorTemplateCache.has(sectorName)) {
    promises.push(loadSectorTemplate(sectorName));
  }

  if (promises.length > 0) {
    sectorLoadingSet.add(sectorName);
    await Promise.all(promises);
    sectorLoadingSet.delete(sectorName);
  }
}

async function loadSectorScores(sectorName: string, offset: number) {
  try {
    const result = await scoringTemplatesApi.getSectorScores(sectorName, {
      limit: 50,
      offset,
      order: 'desc'
    });
    sectorScoresCache.set(sectorName, {
      data: result.results,
      total: result.total,
      page: Math.floor(offset / 50) + 1,
    });
  } catch (err) {
    console.error(`Failed to load scores for ${sectorName}:`, err);
  }
}

async function loadSectorTemplate(sectorName: string) {
  try {
    const template = await scoringTemplatesApi.getMergedSectorTemplate(sectorName);
    sectorTemplateCache.set(sectorName, template);
  } catch (err) {
    console.error(`Failed to load template for ${sectorName}:`, err);
  }
}

async function onSectorPageChange(sectorName: string, newPage: number) {
  sectorLoadingSet.add(sectorName);
  const offset = (newPage - 1) * 50;
  await loadSectorScores(sectorName, offset);
  sectorLoadingSet.delete(sectorName);
}

function getSectorScoreData(sectorName: string) {
  return sectorScoresCache.get(sectorName) || { data: [], total: 0, page: 1 };
}

function getSectorTemplate(sectorName: string): MergedSectorTemplate | null {
  return sectorTemplateCache.get(sectorName) || null;
}

function showPatentDetails(patent: ScoredPatent, sectorName: string) {
  selectedPatent.value = patent;
  selectedPatentSector.value = sectorName;
  showPatentDetail.value = true;
}

async function refreshAll() {
  sectorScoresCache.clear();
  sectorTemplateCache.clear();
  expandedSectors.clear();
  expandedSuperSectors.clear();
  superSectorProgressMap.value.clear();
  await loadSuperSectors();
  await loadAllSuperSectorProgress();
}

// Sector info helper — gets progress data for a sector within a super-sector
function getSectorRows(ssName: string) {
  const progress = superSectorProgressMap.value.get(ssName);
  if (progress?.sectors) {
    return progress.sectors;
  }
  // Fallback: use the basic sector list from super-sector detail
  const ss = superSectors.value.find(s => s.name === ssName);
  if (!ss) return [];
  return ss.sectors.map(s => ({
    sectorId: s.id,
    sectorName: s.name,
    displayName: s.displayName,
    total: s.patentCount,
    scored: 0,
    withClaims: 0,
    remaining: s.patentCount,
    percentComplete: 0,
    avgScore: null as number | null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadSuperSectors();
  await loadAllSuperSectorProgress();
});
</script>

<template>
  <q-page padding>
    <!-- Page Header -->
    <div class="row items-center q-mb-md">
      <div class="col">
        <div class="text-h5">Sector Scores</div>
        <div class="text-caption text-grey-7">
          {{ totalScored.toLocaleString() }} scored / {{ totalPatents.toLocaleString() }} total patents
          across {{ superSectors.length }} super-sectors
        </div>
      </div>
      <div class="col-auto q-gutter-sm row items-center">
        <q-chip
          clickable
          :color="showV2Score ? 'primary' : 'grey-4'"
          :text-color="showV2Score ? 'white' : 'grey-8'"
          dense
          @click="showV2Score = !showV2Score"
          label="V2 Score"
        />
        <q-chip
          clickable
          :color="showV3Score ? 'primary' : 'grey-4'"
          :text-color="showV3Score ? 'white' : 'grey-8'"
          dense
          @click="showV3Score = !showV3Score"
          label="V3 Score"
        />
        <q-chip
          clickable
          :color="showBaseScore ? 'primary' : 'grey-4'"
          :text-color="showBaseScore ? 'white' : 'grey-8'"
          dense
          @click="showBaseScore = !showBaseScore"
          label="Base Score"
        />
        <q-btn
          flat
          icon="refresh"
          label="Refresh"
          :loading="loading"
          @click="refreshAll"
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
      <q-spinner-dots size="40px" color="primary" />
      <div class="text-grey-6 q-mt-sm">Loading sector data...</div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- SUPER-SECTOR CARDS — full-width vertical stack -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <div v-else class="q-gutter-md">
      <q-card
        v-for="ss in superSectors"
        :key="ss.id"
        flat
        bordered
      >
        <!-- Super-sector header row -->
        <q-card-section
          class="cursor-pointer q-py-sm"
          @click="toggleSuperSector(ss.name)"
        >
          <div class="row items-center">
            <q-icon
              :name="expandedSuperSectors.has(ss.name) ? 'expand_less' : 'expand_more'"
              size="sm"
              class="q-mr-sm"
            />

            <div class="col">
              <div class="row items-center q-gutter-sm">
                <span class="text-subtitle1 text-weight-medium">{{ ss.displayName }}</span>
                <q-chip dense size="sm" color="grey-3" text-color="grey-8">
                  {{ ss.sectors.length }} sectors
                </q-chip>
              </div>
            </div>

            <!-- Summary stats -->
            <div class="row q-gutter-lg text-center">
              <div v-if="superSectorProgressMap.get(ss.name)">
                <div class="text-weight-bold">{{ superSectorProgressMap.get(ss.name)!.totals.scored.toLocaleString() }}</div>
                <div class="text-caption text-grey-6">Scored</div>
              </div>
              <div v-if="superSectorProgressMap.get(ss.name)">
                <div class="text-weight-bold">{{ superSectorProgressMap.get(ss.name)!.totals.total.toLocaleString() }}</div>
                <div class="text-caption text-grey-6">Total</div>
              </div>
              <div v-if="superSectorProgressMap.get(ss.name)?.totals.avgScore">
                <q-badge
                  :color="getScoreColor(superSectorProgressMap.get(ss.name)!.totals.avgScore)"
                  class="text-body2"
                >
                  {{ superSectorProgressMap.get(ss.name)!.totals.avgScore!.toFixed(1) }}
                </q-badge>
                <div class="text-caption text-grey-6">Avg Score</div>
              </div>
              <div v-if="superSectorProgressMap.get(ss.name)">
                <q-linear-progress
                  :value="(superSectorProgressMap.get(ss.name)!.totals.percentComplete || 0) / 100"
                  :color="superSectorProgressMap.get(ss.name)!.totals.percentComplete === 100 ? 'positive' : 'primary'"
                  track-color="grey-3"
                  rounded
                  size="sm"
                  style="width: 80px"
                  class="q-mt-xs"
                />
                <div class="text-caption text-grey-6">{{ superSectorProgressMap.get(ss.name)!.totals.percentComplete }}%</div>
              </div>
            </div>
          </div>
        </q-card-section>

        <!-- Expanded: Sector rows -->
        <q-slide-transition>
          <div v-show="expandedSuperSectors.has(ss.name)">
            <q-separator />
            <q-card-section class="q-pa-none">
              <q-list dense separator>
                <template
                  v-for="sector in getSectorRows(ss.name)"
                  :key="sector.sectorName"
                >
                  <!-- Sector row -->
                  <q-item
                    clickable
                    @click="toggleSector(sector.sectorName)"
                    :class="{ 'bg-blue-1': expandedSectors.has(sector.sectorName) }"
                    class="q-py-xs"
                  >
                    <q-item-section avatar style="min-width: 28px;">
                      <q-icon
                        :name="expandedSectors.has(sector.sectorName) ? 'expand_more' : 'chevron_right'"
                        size="xs"
                        color="grey-6"
                      />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label class="text-weight-medium">{{ sector.displayName }}</q-item-label>
                    </q-item-section>
                    <q-item-section side style="min-width: 350px;">
                      <div class="row items-center q-gutter-md">
                        <div class="text-caption text-grey-7" style="min-width: 90px;">
                          {{ sector.scored }} / {{ sector.total }}
                        </div>
                        <q-linear-progress
                          v-if="sector.total > 0"
                          :value="(sector.percentComplete || 0) / 100"
                          :color="sector.percentComplete === 100 ? 'positive' : 'primary'"
                          track-color="grey-3"
                          rounded
                          size="xs"
                          style="width: 60px"
                        />
                        <q-badge
                          v-if="sector.avgScore"
                          :color="getScoreColor(sector.avgScore)"
                          :label="sector.avgScore.toFixed(1)"
                        />
                        <span v-else class="text-grey-4" style="min-width: 30px;">-</span>
                      </div>
                    </q-item-section>
                  </q-item>

                  <!-- Expanded: Patent grid for this sector -->
                  <q-slide-transition>
                    <div v-show="expandedSectors.has(sector.sectorName)">
                      <div class="patent-grid-container">
                        <!-- Loading indicator -->
                        <div v-if="sectorLoadingSet.has(sector.sectorName) && !sectorScoresCache.has(sector.sectorName)" class="text-center q-pa-md">
                          <q-spinner size="sm" color="primary" />
                          <span class="text-caption text-grey-6 q-ml-sm">Loading scores...</span>
                        </div>

                        <!-- No scores -->
                        <div
                          v-else-if="getSectorScoreData(sector.sectorName).total === 0 && !sectorLoadingSet.has(sector.sectorName)"
                          class="text-center q-pa-sm text-caption text-grey-5"
                        >
                          No scored patents in this sector
                        </div>

                        <!-- Scores table -->
                        <q-table
                          v-else-if="getSectorScoreData(sector.sectorName).data.length > 0"
                          :rows="getSectorScoreData(sector.sectorName).data"
                          :columns="patentColumns()"
                          row-key="patentId"
                          flat
                          dense
                          :loading="sectorLoadingSet.has(sector.sectorName)"
                          :pagination="{
                            page: getSectorScoreData(sector.sectorName).page,
                            rowsPerPage: 50,
                            rowsNumber: getSectorScoreData(sector.sectorName).total,
                          }"
                          @request="(p: any) => onSectorPageChange(sector.sectorName, p.pagination.page)"
                          :rows-per-page-options="[50]"
                        >
                          <!-- Patent ID with tooltip -->
                          <template #body-cell-patentId="props">
                            <q-td :props="props">
                              <span
                                class="patent-id-text cursor-pointer text-primary"
                                @click.stop="goToPatent(props.row.patentId)"
                              >
                                {{ props.row.patentId }}
                                <q-tooltip
                                  class="sector-score-tooltip"
                                  anchor="top middle"
                                  self="bottom middle"
                                  :offset="[0, 8]"
                                  max-width="550px"
                                >
                                  <SectorScoreTooltip
                                    :patent="props.row"
                                    :template="getSectorTemplate(sector.sectorName)"
                                  />
                                </q-tooltip>
                              </span>
                            </q-td>
                          </template>
                          <template #body-cell-patentTitle="props">
                            <q-td :props="props">
                              <div class="ellipsis" style="max-width: 320px;">
                                {{ props.row.patentTitle }}
                                <q-tooltip v-if="props.row.patentTitle?.length > 50">
                                  {{ props.row.patentTitle }}
                                </q-tooltip>
                              </div>
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
                          <template #body-cell-v2Score="props">
                            <q-td :props="props">
                              <span v-if="props.row.v2Score > 0">{{ props.row.v2Score.toFixed(1) }}</span>
                              <span v-else class="text-grey-4">-</span>
                            </q-td>
                          </template>
                          <template #body-cell-v3Score="props">
                            <q-td :props="props">
                              <span v-if="props.row.v3Score > 0">{{ props.row.v3Score.toFixed(1) }}</span>
                              <span v-else class="text-grey-4">-</span>
                            </q-td>
                          </template>
                          <template #body-cell-baseScore="props">
                            <q-td :props="props">
                              <span v-if="props.row.baseScore > 0">{{ props.row.baseScore.toFixed(1) }}</span>
                              <span v-else class="text-grey-4">-</span>
                            </q-td>
                          </template>
                          <template #body-cell-remainingYears="props">
                            <q-td :props="props">
                              <span v-if="props.row.remainingYears > 0">{{ props.row.remainingYears.toFixed(1) }}</span>
                              <span v-else class="text-grey-4 text-italic">Exp</span>
                            </q-td>
                          </template>
                          <template #body-cell-withClaims="props">
                            <q-td :props="props">
                              <q-icon
                                :name="props.row.withClaims ? 'check_circle' : 'radio_button_unchecked'"
                                :color="props.row.withClaims ? 'positive' : 'grey-4'"
                                size="xs"
                              />
                            </q-td>
                          </template>
                        </q-table>
                      </div>
                    </div>
                  </q-slide-transition>
                </template>
              </q-list>
            </q-card-section>
          </div>
        </q-slide-transition>
      </q-card>
    </div>

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

          <!-- Score badges -->
          <div class="row q-gutter-sm q-mb-md">
            <q-badge v-if="selectedPatent.v2Score" color="blue-8">V2: {{ selectedPatent.v2Score.toFixed(1) }}</q-badge>
            <q-badge v-if="selectedPatent.v3Score" color="purple-8">V3: {{ selectedPatent.v3Score.toFixed(1) }}</q-badge>
            <q-badge v-if="selectedPatent.baseScore" color="grey-8">Base: {{ selectedPatent.baseScore.toFixed(1) }}</q-badge>
            <q-badge v-if="selectedPatent.remainingYears" color="teal-8">{{ selectedPatent.remainingYears.toFixed(1) }}yr</q-badge>
          </div>

          <!-- LLM Narrative -->
          <template v-if="selectedPatent.llmSummary">
            <div class="text-subtitle2 q-mb-xs">LLM Summary</div>
            <div class="text-body2 q-mb-md" style="white-space: pre-wrap;">{{ selectedPatent.llmSummary }}</div>
          </template>
          <template v-if="selectedPatent.llmPriorArtProblem">
            <div class="text-subtitle2 q-mb-xs">Prior Art Problem</div>
            <div class="text-body2 q-mb-md" style="white-space: pre-wrap;">{{ selectedPatent.llmPriorArtProblem }}</div>
          </template>
          <template v-if="selectedPatent.llmTechnicalSolution">
            <div class="text-subtitle2 q-mb-xs">Technical Solution</div>
            <div class="text-body2 q-mb-md" style="white-space: pre-wrap;">{{ selectedPatent.llmTechnicalSolution }}</div>
          </template>
        </q-card-section>

        <q-separator />

        <q-card-section class="q-pa-none" style="max-height: calc(100vh - 350px); overflow-y: auto;">
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
                    :color="metric.score >= 7 ? 'positive' : metric.score >= 5 ? 'primary' : metric.score >= 3 ? 'warning' : 'negative'"
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
.patent-id-text {
  font-family: 'Fira Code', monospace;
  font-size: 0.9em;
}

.sector-score-tooltip {
  background: #1e1e1e;
  border: 1px solid #444;
  max-width: 550px;
}

.patent-grid-container {
  background: #f8f9fa;
  border-top: 1px solid #e0e0e0;
  padding: 4px 8px 8px 36px;
}

.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
