<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { scoringApi } from '@/services/api';
import type { ScoringProfile, SectorRanking } from '@/types';

const router = useRouter();

// State
const profiles = ref<ScoringProfile[]>([]);
const selectedProfileId = ref('executive');
const sectors = ref<SectorRanking[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const expandedSectors = ref<Set<string>>(new Set());
const topN = ref(15);
const sortField = ref<'damages' | 'avg_score' | 'patent_count' | 'max_score'>('damages');

// Load profiles on mount
async function loadProfiles() {
  try {
    profiles.value = await scoringApi.getProfiles();
    const defaultProfile = profiles.value.find(p => p.isDefault);
    if (defaultProfile) {
      selectedProfileId.value = defaultProfile.id;
    }
  } catch (err) {
    console.error('Failed to load profiles:', err);
  }
}

// Load sector rankings
async function loadSectors() {
  loading.value = true;
  error.value = null;
  try {
    const result = await scoringApi.getSectorRankings({
      profile: selectedProfileId.value,
      topN: topN.value
    });
    sectors.value = result.sectors;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load sector rankings';
    console.error('Failed to load sectors:', err);
  } finally {
    loading.value = false;
  }
}

// Sort sectors
function sortedSectors(): SectorRanking[] {
  const sorted = [...sectors.value];
  switch (sortField.value) {
    case 'damages':
      sorted.sort((a, b) => b.damages_rating - a.damages_rating || b.avg_score - a.avg_score);
      break;
    case 'avg_score':
      sorted.sort((a, b) => b.avg_score - a.avg_score);
      break;
    case 'patent_count':
      sorted.sort((a, b) => b.patent_count - a.patent_count);
      break;
    case 'max_score':
      sorted.sort((a, b) => b.max_score - a.max_score);
      break;
  }
  return sorted;
}

// Damages tier color
function damagesColor(rating: number): string {
  switch (rating) {
    case 4: return 'red-7';
    case 3: return 'orange-7';
    case 2: return 'blue-7';
    default: return 'grey-6';
  }
}

function damagesTextColor(rating: number): string {
  return rating >= 2 ? 'white' : 'dark';
}

// Toggle sector expansion
function toggleSector(sectorKey: string) {
  if (expandedSectors.value.has(sectorKey)) {
    expandedSectors.value.delete(sectorKey);
  } else {
    expandedSectors.value.add(sectorKey);
  }
}

// Navigate to portfolio filtered by sector
function drillDown(sectorKey: string) {
  router.push({
    name: 'portfolio',
    query: { primarySectors: sectorKey }
  });
}

// Navigate to patent detail
function goToPatent(patentId: string) {
  router.push({ name: 'patent-detail', params: { id: patentId } });
}

// Reload when profile changes
watch(selectedProfileId, () => {
  loadSectors();
});

// Summary stats
function totalPatents(): number {
  return sectors.value.reduce((sum, s) => sum + s.patent_count, 0);
}

onMounted(async () => {
  await loadProfiles();
  await loadSectors();
});
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="text-h5 q-mr-md">Sector Rankings</div>
      <q-badge color="primary" class="q-mr-md">
        {{ sectors.length }} sectors &middot; {{ totalPatents().toLocaleString() }} patents
      </q-badge>
      <q-space />

      <!-- Profile Selector -->
      <q-select
        v-model="selectedProfileId"
        :options="profiles"
        option-value="id"
        option-label="displayName"
        emit-value
        map-options
        outlined
        dense
        label="Scoring Profile"
        style="min-width: 200px"
        class="q-mr-sm"
      >
        <template v-slot:option="{ itemProps, opt }">
          <q-item v-bind="itemProps">
            <q-item-section>
              <q-item-label>{{ opt.displayName }}</q-item-label>
              <q-item-label caption>{{ opt.description }}</q-item-label>
            </q-item-section>
          </q-item>
        </template>
      </q-select>

      <!-- Sort Selector -->
      <q-select
        v-model="sortField"
        :options="[
          { value: 'damages', label: 'Damages Tier' },
          { value: 'avg_score', label: 'Avg Score' },
          { value: 'max_score', label: 'Max Score' },
          { value: 'patent_count', label: 'Patent Count' }
        ]"
        emit-value
        map-options
        outlined
        dense
        label="Sort By"
        style="min-width: 160px"
      />
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center q-pa-xl">
      <q-spinner-dots size="40px" color="primary" />
      <div class="text-grey-6 q-mt-sm">Loading sector rankings...</div>
    </div>

    <!-- Error -->
    <q-banner v-else-if="error" class="bg-negative text-white q-mb-md">
      {{ error }}
      <template v-slot:action>
        <q-btn flat label="Retry" @click="loadSectors" />
      </template>
    </q-banner>

    <!-- Sector Cards -->
    <div v-else class="q-gutter-md">
      <q-card
        v-for="sector in sortedSectors()"
        :key="sector.sector"
        flat
        bordered
      >
        <q-card-section
          class="cursor-pointer"
          @click="toggleSector(sector.sector)"
        >
          <div class="row items-center">
            <!-- Expand icon -->
            <q-icon
              :name="expandedSectors.has(sector.sector) ? 'expand_less' : 'expand_more'"
              size="sm"
              class="q-mr-sm"
            />

            <!-- Sector name -->
            <div class="col">
              <div class="row items-center q-gutter-sm">
                <span class="text-subtitle1 text-weight-medium">{{ sector.sector_name }}</span>
                <q-badge
                  :color="damagesColor(sector.damages_rating)"
                  :text-color="damagesTextColor(sector.damages_rating)"
                >
                  {{ sector.damages_label }}
                </q-badge>
                <q-chip
                  v-if="sector.super_sector"
                  dense
                  size="sm"
                  color="grey-3"
                  text-color="grey-8"
                >
                  {{ sector.super_sector }}
                </q-chip>
              </div>
            </div>

            <!-- Stats -->
            <div class="row q-gutter-lg text-center">
              <div>
                <div class="text-weight-bold">{{ sector.patent_count }}</div>
                <div class="text-caption text-grey-6">Patents</div>
              </div>
              <div>
                <div class="text-weight-bold">{{ sector.avg_score.toFixed(1) }}</div>
                <div class="text-caption text-grey-6">Avg Score</div>
              </div>
              <div>
                <div class="text-weight-bold">{{ sector.max_score.toFixed(1) }}</div>
                <div class="text-caption text-grey-6">Max Score</div>
              </div>
            </div>

            <!-- Drill-down button -->
            <q-btn
              flat
              dense
              icon="open_in_new"
              size="sm"
              class="q-ml-md"
              @click.stop="drillDown(sector.sector)"
            >
              <q-tooltip>View in Portfolio</q-tooltip>
            </q-btn>
          </div>
        </q-card-section>

        <!-- Expanded: Top Patents -->
        <q-slide-transition>
          <div v-show="expandedSectors.has(sector.sector)">
            <q-separator />
            <q-card-section class="q-pa-none">
              <q-table
                :rows="sector.top_patents"
                :columns="[
                  { name: 'rank', label: '#', field: 'rank', align: 'center', sortable: false },
                  { name: 'patent_id', label: 'Patent ID', field: 'patent_id', align: 'left', sortable: false },
                  { name: 'title', label: 'Title', field: 'title', align: 'left', sortable: false },
                  { name: 'assignee', label: 'Assignee', field: 'assignee', align: 'left', sortable: false },
                  { name: 'score', label: 'Score', field: 'score', align: 'center', sortable: false },
                  { name: 'remaining_years', label: 'Years Left', field: 'remaining_years', align: 'center', sortable: false }
                ]"
                row-key="patent_id"
                flat
                dense
                hide-bottom
                :rows-per-page-options="[0]"
              >
                <template v-slot:body-cell-patent_id="props">
                  <q-td :props="props">
                    <a
                      href="#"
                      class="text-primary"
                      @click.stop.prevent="goToPatent(props.row.patent_id)"
                    >
                      {{ props.row.patent_id }}
                    </a>
                  </q-td>
                </template>

                <template v-slot:body-cell-title="props">
                  <q-td :props="props">
                    <div class="ellipsis" style="max-width: 400px">
                      {{ props.row.title }}
                      <q-tooltip v-if="props.row.title?.length > 60">
                        {{ props.row.title }}
                      </q-tooltip>
                    </div>
                  </q-td>
                </template>

                <template v-slot:body-cell-score="props">
                  <q-td :props="props">
                    <q-badge
                      :color="props.row.score > 50 ? 'positive' : props.row.score > 25 ? 'warning' : 'grey'"
                    >
                      {{ props.row.score.toFixed(1) }}
                    </q-badge>
                  </q-td>
                </template>

                <template v-slot:body-cell-remaining_years="props">
                  <q-td :props="props">
                    {{ props.row.remaining_years?.toFixed(1) || '-' }}
                  </q-td>
                </template>
              </q-table>
            </q-card-section>
          </div>
        </q-slide-transition>
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
</style>
