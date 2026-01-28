<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  patentFamilyApi,
  focusAreaApi,
  type PatentFamilyExploration,
  type PatentFamilyMember,
  type FamilyExplorationResult,
  type FamilyCacheStatus,
  type FocusArea,
} from '@/services/api';

const props = defineProps<{
  patentId: string;
}>();

const router = useRouter();

// State
const loading = ref(false);
const exploring = ref(false);
const error = ref<string | null>(null);
const cacheStatus = ref<FamilyCacheStatus | null>(null);
const explorations = ref<PatentFamilyExploration[]>([]);
const activeResult = ref<FamilyExplorationResult | null>(null);
const configExpanded = ref(true);
const previousExpanded = ref(true);

// Config
const config = ref({
  maxAncestorDepth: 2,
  maxDescendantDepth: 2,
  includeSiblings: true,
  includeCousins: false,
  requireInPortfolio: false,
  limitToSectors: [] as string[],
  limitToCpcPrefixes: '',
  name: '',
});

// Selection state
const selectedPatentIds = ref<string[]>([]);

// Focus area dialog
const showFocusAreaDialog = ref(false);
const focusAreas = ref<FocusArea[]>([]);
const selectedFocusAreaId = ref<string | null>(null);
const addingToFocusArea = ref(false);

// Polling
let pollTimer: ReturnType<typeof setInterval> | null = null;

// Depth options
const depthOptions = [
  { label: '0 (none)', value: 0 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
];

// Computed
const sortedGenerations = computed(() => {
  if (!activeResult.value) return [];
  const gens = activeResult.value.generations;
  const entries: Array<{ key: string; label: string; count: number; sortOrder: number }> = [];

  for (const [key, val] of Object.entries(gens)) {
    const numKey = Number(key);
    const sortOrder = key === 'sibling' ? 0.5 : numKey;
    entries.push({ key, label: val.label, count: val.count, sortOrder });
  }

  return entries.sort((a, b) => a.sortOrder - b.sortOrder);
});

const membersByGeneration = computed(() => {
  if (!activeResult.value) return new Map<string, PatentFamilyMember[]>();
  const map = new Map<string, PatentFamilyMember[]>();

  for (const m of activeResult.value.members) {
    const key = m.relationToSeed === 'sibling' ? 'sibling' : String(m.generationDepth);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }

  return map;
});

const selectedCount = computed(() => selectedPatentIds.value.length);

const generationLabel = computed(() => {
  return (key: string, label: string) => {
    const displayLabels: Record<string, string> = {
      seed: 'Seed',
      parent: 'Parents',
      grandparent: 'Grandparents',
      child: 'Children',
      grandchild: 'Grandchildren',
      sibling: 'Siblings',
    };
    return displayLabels[label] || label.charAt(0).toUpperCase() + label.slice(1) + 's';
  };
});

const generationColor = computed(() => {
  return (key: string, label: string) => {
    const colors: Record<string, string> = {
      seed: 'amber',
      parent: 'deep-purple',
      grandparent: 'purple',
      child: 'blue',
      grandchild: 'cyan',
      sibling: 'teal',
    };
    return colors[label] || 'grey';
  };
});

// Summary bar labels
const summaryItems = computed(() => {
  return sortedGenerations.value.map(g => {
    const abbrev: Record<string, string> = {
      grandparent: 'GP',
      parent: 'P',
      seed: 'SEED',
      sibling: 'Sib',
      child: 'C',
      grandchild: 'GC',
    };
    return {
      abbrev: abbrev[g.label] || g.label.slice(0, 3).toUpperCase(),
      count: g.count,
      label: g.label,
      key: g.key,
    };
  });
});

// Methods
async function loadCacheStatus() {
  try {
    cacheStatus.value = await patentFamilyApi.getCacheStatus(props.patentId);
  } catch { /* non-critical */ }
}

async function loadExplorations() {
  try {
    explorations.value = await patentFamilyApi.listExplorations(props.patentId);
  } catch (err) {
    console.error('Failed to load explorations:', err);
  }
}

async function loadExploration(id: string) {
  loading.value = true;
  error.value = null;
  try {
    activeResult.value = await patentFamilyApi.getExploration(id);
    selectedPatentIds.value = [];
    configExpanded.value = false;
    previousExpanded.value = false;
  } catch (err) {
    error.value = 'Failed to load exploration results';
    console.error(err);
  } finally {
    loading.value = false;
  }
}

async function startExploration() {
  exploring.value = true;
  error.value = null;

  try {
    // Create exploration
    const cpcPrefixes = config.value.limitToCpcPrefixes
      ? config.value.limitToCpcPrefixes.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const exploration = await patentFamilyApi.createExploration({
      seedPatentId: props.patentId,
      name: config.value.name || undefined,
      maxAncestorDepth: config.value.maxAncestorDepth,
      maxDescendantDepth: config.value.maxDescendantDepth,
      includeSiblings: config.value.includeSiblings,
      includeCousins: config.value.includeCousins,
      requireInPortfolio: config.value.requireInPortfolio,
      limitToSectors: config.value.limitToSectors,
      limitToCpcPrefixes: cpcPrefixes,
    });

    // Execute
    await patentFamilyApi.executeExploration(exploration.id);

    // Poll for completion
    startPolling(exploration.id);
  } catch (err) {
    error.value = 'Failed to start exploration';
    exploring.value = false;
    console.error(err);
  }
}

function startPolling(explorationId: string) {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const status = await patentFamilyApi.getStatus(explorationId);
      if (status.status === 'COMPLETE') {
        stopPolling();
        exploring.value = false;
        await loadExploration(explorationId);
        await loadExplorations();
      } else if (status.status === 'ERROR') {
        stopPolling();
        exploring.value = false;
        error.value = status.errorMessage || 'Exploration failed';
        await loadExplorations();
      }
    } catch {
      stopPolling();
      exploring.value = false;
      error.value = 'Lost connection while polling';
    }
  }, 500);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function toggleMemberSelection(patentId: string) {
  const idx = selectedPatentIds.value.indexOf(patentId);
  if (idx >= 0) {
    selectedPatentIds.value.splice(idx, 1);
  } else {
    selectedPatentIds.value.push(patentId);
  }
}

function selectAllInGeneration(key: string) {
  const members = membersByGeneration.value.get(key) || [];
  const ids = members.map(m => m.patentId).filter(id => id !== props.patentId);
  const allSelected = ids.every(id => selectedPatentIds.value.includes(id));

  if (allSelected) {
    selectedPatentIds.value = selectedPatentIds.value.filter(id => !ids.includes(id));
  } else {
    const newIds = ids.filter(id => !selectedPatentIds.value.includes(id));
    selectedPatentIds.value.push(...newIds);
  }
}

async function openFocusAreaDialog() {
  showFocusAreaDialog.value = true;
  if (focusAreas.value.length === 0) {
    try {
      focusAreas.value = await focusAreaApi.getFocusAreas({ status: 'ACTIVE' });
    } catch { /* skip */ }
  }
}

async function confirmAddToFocusArea() {
  if (!selectedFocusAreaId.value || !activeResult.value) return;
  addingToFocusArea.value = true;

  try {
    const result = await patentFamilyApi.addToFocusArea(
      activeResult.value.exploration.id,
      selectedFocusAreaId.value,
      selectedPatentIds.value,
    );
    showFocusAreaDialog.value = false;
    selectedPatentIds.value = [];
    alert(`Added ${result.added} patents to focus area (${result.total} total)`);
  } catch (err) {
    console.error('Failed to add to focus area:', err);
  } finally {
    addingToFocusArea.value = false;
  }
}

async function deleteExplorationById(id: string) {
  try {
    await patentFamilyApi.deleteExploration(id);
    explorations.value = explorations.value.filter(e => e.id !== id);
    if (activeResult.value?.exploration.id === id) {
      activeResult.value = null;
    }
  } catch (err) {
    console.error('Failed to delete exploration:', err);
  }
}

function navigateToPatent(patentId: string) {
  router.push({ name: 'patent-detail', params: { id: patentId } });
}

onMounted(() => {
  loadCacheStatus();
  loadExplorations();
});

// Cleanup polling on unmount
import { onUnmounted } from 'vue';
onUnmounted(() => stopPolling());
</script>

<template>
  <div>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="text-h6">Patent Family Explorer</div>
      <q-space />
      <q-btn
        color="primary"
        label="Explore"
        icon="account_tree"
        :loading="exploring"
        @click="startExploration"
      />
    </div>

    <!-- Cache Status -->
    <div v-if="cacheStatus" class="q-mb-sm">
      <q-chip dense size="sm" :color="cacheStatus.hasForwardCitations ? 'positive' : 'grey-4'" text-color="white" icon="arrow_forward">
        Forward citations {{ cacheStatus.hasForwardCitations ? 'cached' : 'not cached' }}
      </q-chip>
      <q-chip dense size="sm" :color="cacheStatus.hasBackwardCitations ? 'positive' : 'grey-4'" text-color="white" icon="arrow_back">
        Backward citations {{ cacheStatus.hasBackwardCitations ? 'cached' : 'not cached' }}
      </q-chip>
    </div>

    <!-- Error -->
    <q-banner v-if="error" type="warning" class="q-mb-md bg-negative text-white" rounded>
      {{ error }}
      <template #action>
        <q-btn flat label="Dismiss" @click="error = null" />
      </template>
    </q-banner>

    <!-- Config -->
    <q-expansion-item
      v-model="configExpanded"
      label="Configuration"
      icon="settings"
      header-class="text-subtitle2"
      class="q-mb-md"
      bordered
      dense
    >
      <q-card flat>
        <q-card-section>
          <div class="row q-gutter-md">
            <q-select
              v-model="config.maxAncestorDepth"
              :options="depthOptions"
              label="Ancestor Depth"
              emit-value
              map-options
              dense
              outlined
              style="min-width: 140px"
            />
            <q-select
              v-model="config.maxDescendantDepth"
              :options="depthOptions"
              label="Descendant Depth"
              emit-value
              map-options
              dense
              outlined
              style="min-width: 140px"
            />
          </div>
          <div class="row q-gutter-md q-mt-sm">
            <q-toggle v-model="config.includeSiblings" label="Siblings" dense />
            <q-toggle v-model="config.includeCousins" label="Cousins" dense />
            <q-toggle v-model="config.requireInPortfolio" label="Portfolio Only" dense />
          </div>
          <div class="row q-gutter-md q-mt-sm">
            <q-input
              v-model="config.limitToCpcPrefixes"
              label="CPC Prefix Filter"
              hint="Comma-separated, e.g. H04L,G06F"
              dense
              outlined
              class="col"
            />
            <q-input
              v-model="config.name"
              label="Exploration Name (optional)"
              dense
              outlined
              class="col"
            />
          </div>
        </q-card-section>
      </q-card>
    </q-expansion-item>

    <!-- Previous Explorations -->
    <q-expansion-item
      v-if="explorations.length > 0"
      v-model="previousExpanded"
      :label="`Previous Explorations (${explorations.length})`"
      icon="history"
      header-class="text-subtitle2"
      class="q-mb-md"
      bordered
      dense
    >
      <q-list separator dense>
        <q-item
          v-for="exp in explorations"
          :key="exp.id"
          clickable
          @click="loadExploration(exp.id)"
        >
          <q-item-section>
            <q-item-label>{{ exp.name || 'Unnamed' }}</q-item-label>
            <q-item-label caption>
              {{ exp.discoveredCount }} members
              &middot;
              {{ new Date(exp.createdAt).toLocaleDateString() }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="row items-center q-gutter-xs">
              <q-badge :color="exp.status === 'COMPLETE' ? 'positive' : exp.status === 'ERROR' ? 'negative' : 'warning'">
                {{ exp.status }}
              </q-badge>
              <q-btn
                flat
                dense
                round
                icon="delete"
                size="sm"
                color="grey-6"
                @click.stop="deleteExplorationById(exp.id)"
              />
            </div>
          </q-item-section>
        </q-item>
      </q-list>
    </q-expansion-item>

    <!-- Loading -->
    <div v-if="loading || exploring" class="flex flex-center q-pa-xl">
      <q-spinner-dots color="primary" size="40px" />
      <span class="q-ml-md text-grey-7">
        {{ exploring ? 'Exploring patent family...' : 'Loading results...' }}
      </span>
    </div>

    <!-- Results -->
    <template v-if="activeResult && !loading && !exploring">
      <!-- Generation Summary Bar -->
      <q-card flat bordered class="q-mb-md">
        <q-card-section class="q-py-sm">
          <div class="row items-center justify-center q-gutter-sm">
            <template v-for="(item, idx) in summaryItems" :key="item.key">
              <span v-if="idx > 0" class="text-grey-4">→</span>
              <q-chip
                dense
                :color="item.label === 'seed' ? 'amber-7' : generationColor(item.key, item.label)"
                text-color="white"
                size="sm"
                :outline="item.label !== 'seed'"
              >
                <template v-if="item.label === 'seed'">[SEED]</template>
                <template v-else>{{ item.abbrev }}({{ item.count }})</template>
              </q-chip>
            </template>
            <q-space />
            <span class="text-caption text-grey-6">
              {{ activeResult.members.length }} total members
            </span>
          </div>
        </q-card-section>
      </q-card>

      <!-- Generation Groups -->
      <q-card
        v-for="gen in sortedGenerations"
        :key="gen.key"
        class="q-mb-sm"
        bordered
        flat
      >
        <q-card-section class="q-py-sm">
          <div class="row items-center">
            <q-badge :color="generationColor(gen.key, gen.label)" class="q-mr-sm">
              {{ gen.label === 'seed' ? '0' : gen.key }}
            </q-badge>
            <span class="text-subtitle2">{{ generationLabel(gen.key, gen.label) }}</span>
            <span class="text-caption text-grey-6 q-ml-sm">{{ gen.count }} patent{{ gen.count !== 1 ? 's' : '' }}</span>
            <q-space />
            <q-btn
              v-if="gen.label !== 'seed'"
              flat
              dense
              size="sm"
              label="Select all"
              @click="selectAllInGeneration(gen.key)"
            />
          </div>
        </q-card-section>

        <q-separator />

        <q-list dense separator>
          <q-item
            v-for="member in membersByGeneration.get(gen.key) || []"
            :key="member.patentId"
            :clickable="member.inPortfolio"
            @click="member.inPortfolio && navigateToPatent(member.patentId)"
          >
            <q-item-section side v-if="member.relationToSeed !== 'seed'">
              <q-checkbox
                :model-value="selectedPatentIds.includes(member.patentId)"
                @update:model-value="toggleMemberSelection(member.patentId)"
                @click.stop
                dense
              />
            </q-item-section>

            <q-item-section avatar>
              <q-icon
                :name="member.inPortfolio ? 'link' : 'link_off'"
                :color="member.inPortfolio ? 'primary' : 'grey-4'"
                size="xs"
              />
            </q-item-section>

            <q-item-section>
              <q-item-label :class="member.inPortfolio ? 'text-primary' : 'text-grey-7'">
                US{{ member.patentId }}
              </q-item-label>
              <q-item-label v-if="member.patentTitle" caption class="ellipsis">
                {{ member.patentTitle }}
              </q-item-label>
            </q-item-section>

            <q-item-section side top>
              <q-item-label caption>{{ member.patentDate }}</q-item-label>
              <q-item-label caption class="text-grey-6 ellipsis" style="max-width: 150px;">
                {{ member.assignee }}
              </q-item-label>
            </q-item-section>

            <q-item-section v-if="member.inPortfolio" side>
              <div class="row items-center q-gutter-xs">
                <q-badge v-if="member.primarySector" outline color="grey-7" size="sm">
                  {{ member.primarySector }}
                </q-badge>
                <q-icon name="chevron_right" color="grey-5" />
              </div>
            </q-item-section>

            <q-item-section v-else-if="member.patentId" side>
              <q-btn
                flat
                dense
                icon="open_in_new"
                size="sm"
                color="grey-6"
                tag="a"
                :href="`https://patents.google.com/patent/US${member.patentId}`"
                target="_blank"
                @click.stop
              />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <!-- Add to Focus Area -->
      <div v-if="selectedCount > 0" class="q-mt-md">
        <q-btn
          color="secondary"
          :label="`Add ${selectedCount} Selected to Focus Area`"
          icon="playlist_add"
          @click="openFocusAreaDialog"
        />
      </div>
    </template>

    <!-- No results yet message -->
    <div v-if="!activeResult && !loading && !exploring && explorations.length === 0" class="text-center q-pa-xl">
      <q-icon name="account_tree" color="grey-4" size="4em" class="q-mb-md" />
      <div class="text-body1 text-grey-6">
        Configure exploration parameters and click Explore to discover patent family relationships.
      </div>
    </div>

    <!-- Focus Area Dialog -->
    <q-dialog v-model="showFocusAreaDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Add to Focus Area</div>
          <div class="text-caption text-grey-6">
            {{ selectedCount }} patent{{ selectedCount !== 1 ? 's' : '' }} selected
          </div>
        </q-card-section>

        <q-card-section>
          <q-select
            v-model="selectedFocusAreaId"
            :options="focusAreas.map(fa => ({ label: fa.name, value: fa.id }))"
            label="Select Focus Area"
            emit-value
            map-options
            outlined
            dense
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showFocusAreaDialog = false" />
          <q-btn
            color="primary"
            label="Add Patents"
            :loading="addingToFocusArea"
            :disable="!selectedFocusAreaId"
            @click="confirmAddToFocusArea"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>
