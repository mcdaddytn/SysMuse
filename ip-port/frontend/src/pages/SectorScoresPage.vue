<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { sectorApi, scoringTemplatesApi } from '@/services/api';
import type { SectorScoringProgress } from '@/services/api';
import type { SuperSectorDetail } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const superSectors = ref<SuperSectorDetail[]>([]);
const sectorProgress = ref<Map<string, SectorScoringProgress>>(new Map());
const selectedSectors = ref<string[]>([]);
const loading = ref(false);
const loadingProgress = ref(false);
const exportLoading = ref(false);
const error = ref<string | null>(null);

// Scores view state
const scores = ref<Array<{
  patentId: string;
  patentTitle: string;
  sector: string;
  superSector: string;
  compositeScore: number;
  withClaims: boolean;
  metrics: Record<string, { score: number; reasoning: string }>;
}>>([]);
const scoresLoading = ref(false);
const scoresPagination = ref({
  page: 1,
  rowsPerPage: 25,
  sortBy: 'compositeScore',
  descending: true,
  rowsNumber: 0
});

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

const scoreColumns = [
  { name: 'patentId', label: 'Patent ID', field: 'patentId', sortable: true, align: 'left' as const },
  { name: 'patentTitle', label: 'Title', field: 'patentTitle', sortable: true, align: 'left' as const },
  { name: 'sector', label: 'Sector', field: 'sector', sortable: true, align: 'left' as const },
  { name: 'compositeScore', label: 'Score', field: 'compositeScore', sortable: true, align: 'right' as const },
  { name: 'withClaims', label: 'Claims', field: 'withClaims', sortable: true, align: 'center' as const },
];

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

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadSuperSectors();
  await loadAllProgress();
});
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="col">
        <div class="text-h5">LLM Sector Scores</div>
        <div class="text-caption text-grey-7">
          {{ totalScored.toLocaleString() }} patents scored
          ({{ totalWithClaims.toLocaleString() }} with claims)
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

    <!-- Progress by Super-Sector -->
    <div v-else class="row q-col-gutter-md">
      <div
        v-for="ss in superSectors"
        :key="ss.id"
        class="col-12 col-md-6 col-lg-4"
      >
        <q-card flat bordered>
          <q-card-section>
            <div class="row items-center">
              <div class="col">
                <div class="text-subtitle1 text-weight-medium">{{ ss.displayName }}</div>
                <div class="text-caption text-grey-7">{{ ss.name }}</div>
              </div>
              <div class="col-auto">
                <q-btn
                  flat
                  dense
                  icon="download"
                  color="primary"
                  :loading="exportLoading"
                  @click="exportSuperSector(ss.name)"
                >
                  <q-tooltip>Export CSV</q-tooltip>
                </q-btn>
              </div>
            </div>
          </q-card-section>

          <q-separator />

          <q-card-section class="q-pa-none">
            <q-list dense separator>
              <q-item
                v-for="sector in ss.sectors"
                :key="sector.id"
                :class="{ 'bg-grey-1': sectorProgress.get(sector.name)?.percentComplete === 100 }"
              >
                <q-item-section>
                  <q-item-label>{{ sector.displayName }}</q-item-label>
                  <q-item-label caption>
                    <span v-if="sectorProgress.get(sector.name)">
                      {{ sectorProgress.get(sector.name)?.scored }} / {{ sectorProgress.get(sector.name)?.total }}
                      ({{ sectorProgress.get(sector.name)?.percentComplete }}%)
                    </span>
                    <span v-else class="text-grey-5">Not scored</span>
                  </q-item-label>
                </q-item-section>

                <q-item-section side v-if="sectorProgress.get(sector.name)">
                  <div class="row items-center q-gutter-xs">
                    <q-badge
                      v-if="sectorProgress.get(sector.name)?.avgScore"
                      :color="getScoreColor(sectorProgress.get(sector.name)?.avgScore || 0)"
                    >
                      {{ sectorProgress.get(sector.name)?.avgScore?.toFixed(1) }}
                    </q-badge>
                    <q-icon
                      v-if="sectorProgress.get(sector.name)?.percentComplete === 100"
                      name="check_circle"
                      color="positive"
                      size="xs"
                    />
                  </div>
                </q-item-section>

                <q-item-section side style="width: 100px" v-if="sectorProgress.get(sector.name)">
                  <q-linear-progress
                    :value="(sectorProgress.get(sector.name)?.percentComplete || 0) / 100"
                    :color="sectorProgress.get(sector.name)?.percentComplete === 100 ? 'positive' : 'primary'"
                    track-color="grey-3"
                    rounded
                    size="sm"
                  />
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script lang="ts">
function getScoreColor(score: number): string {
  if (score >= 60) return 'positive';
  if (score >= 45) return 'primary';
  if (score >= 30) return 'warning';
  return 'grey';
}
</script>

<style scoped>
.q-linear-progress {
  min-width: 80px;
}
</style>
