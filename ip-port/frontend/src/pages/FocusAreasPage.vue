<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { focusAreaApi, type FocusArea, type FocusGroup } from '@/services/api';

const router = useRouter();

// State
const focusAreas = ref<FocusArea[]>([]);
const focusGroups = ref<FocusGroup[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const activeTab = ref<'areas' | 'groups'>('areas');

// Create dialog state
const showCreateDialog = ref(false);
const createForm = ref({
  name: '',
  description: '',
  superSector: null as string | null
});
const creating = ref(false);

// Super-sector options
const superSectorOptions = ref<string[]>([]);

// Computed
const activeFocusAreas = computed(() =>
  focusAreas.value.filter(fa => fa.status === 'ACTIVE')
);

const draftFocusGroups = computed(() =>
  focusGroups.value.filter(fg => fg.status === 'DRAFT')
);

const needsReviewGroups = computed(() =>
  focusGroups.value.filter(fg => fg.status === 'NEEDS_REVIEW')
);

// Load data
async function loadData() {
  loading.value = true;
  error.value = null;

  try {
    const [areasRes, groupsRes, sectorsRes] = await Promise.all([
      focusAreaApi.getFocusAreas(),
      focusAreaApi.getFocusGroups(),
      fetch('/api/patents/super-sectors').then(r => r.json())
    ]);

    focusAreas.value = areasRes;
    focusGroups.value = groupsRes;
    superSectorOptions.value = sectorsRes.map((s: { name: string }) => s.name);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load data';
    console.error('Failed to load focus areas:', err);
  } finally {
    loading.value = false;
  }
}

// Create new focus area
async function createFocusArea() {
  if (!createForm.value.name.trim()) return;

  creating.value = true;
  try {
    // For now, use a demo user ID - in production this would come from auth
    const newArea = await focusAreaApi.createFocusArea({
      name: createForm.value.name,
      description: createForm.value.description || undefined,
      ownerId: 'demo-user-1',
      superSector: createForm.value.superSector || undefined
    });

    focusAreas.value.unshift(newArea);
    showCreateDialog.value = false;
    resetCreateForm();

    // Navigate to the new focus area
    router.push({ name: 'focus-area-detail', params: { id: newArea.id } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create focus area';
  } finally {
    creating.value = false;
  }
}

function resetCreateForm() {
  createForm.value = { name: '', description: '', superSector: null };
}

// Delete/archive focus area
async function archiveFocusArea(area: FocusArea) {
  if (!confirm(`Archive "${area.name}"? It can be restored later.`)) return;

  try {
    await focusAreaApi.deleteFocusArea(area.id);
    focusAreas.value = focusAreas.value.filter(fa => fa.id !== area.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to archive';
  }
}

// Delete focus group
async function deleteFocusGroup(group: FocusGroup) {
  if (!confirm(`Delete draft "${group.name}"? This cannot be undone.`)) return;

  try {
    await focusAreaApi.deleteFocusGroup(group.id);
    focusGroups.value = focusGroups.value.filter(fg => fg.id !== group.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete';
  }
}

// Formalize focus group
async function formalizeFocusGroup(group: FocusGroup) {
  try {
    const newArea = await focusAreaApi.formalizeFocusGroup(group.id);
    focusAreas.value.unshift(newArea);
    focusGroups.value = focusGroups.value.filter(fg => fg.id !== group.id);

    router.push({ name: 'focus-area-detail', params: { id: newArea.id } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to formalize';
  }
}

// Navigate to detail
function goToFocusArea(id: string) {
  router.push({ name: 'focus-area-detail', params: { id } });
}

// Initialize
onMounted(loadData);
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="text-h5">Focus Areas</div>
      <q-badge color="primary" class="q-ml-md">
        {{ activeFocusAreas.length }} active
      </q-badge>
      <q-badge v-if="draftFocusGroups.length" color="orange" class="q-ml-sm">
        {{ draftFocusGroups.length }} drafts
      </q-badge>
      <q-space />
      <q-btn
        color="primary"
        icon="add"
        label="New Focus Area"
        @click="showCreateDialog = true"
      />
    </div>

    <!-- Error Banner -->
    <q-banner v-if="error" class="bg-negative text-white q-mb-md">
      {{ error }}
      <template v-slot:action>
        <q-btn flat label="Dismiss" @click="error = null" />
        <q-btn flat label="Retry" @click="loadData" />
      </template>
    </q-banner>

    <!-- Tabs -->
    <q-tabs v-model="activeTab" class="q-mb-md" align="left" active-color="primary">
      <q-tab name="areas" label="Focus Areas" :badge="activeFocusAreas.length || undefined" />
      <q-tab name="groups" label="Draft Groups" :badge="draftFocusGroups.length || undefined" />
    </q-tabs>

    <!-- Loading -->
    <div v-if="loading" class="row justify-center q-pa-xl">
      <q-spinner size="lg" color="primary" />
    </div>

    <!-- Focus Areas Tab -->
    <q-tab-panels v-else v-model="activeTab" animated>
      <q-tab-panel name="areas" class="q-pa-none">
        <!-- Empty State -->
        <q-card v-if="activeFocusAreas.length === 0" flat bordered class="q-pa-xl text-center">
          <q-icon name="filter_center_focus" size="4em" color="grey-5" />
          <div class="text-h6 text-grey-7 q-mt-md">No Focus Areas Yet</div>
          <div class="text-body2 text-grey-6 q-mb-md">
            Create a focus area to group patents by technology or interest area.
          </div>
          <q-btn color="primary" label="Create First Focus Area" @click="showCreateDialog = true" />
        </q-card>

        <!-- Focus Areas Grid -->
        <div v-else class="row q-col-gutter-md">
          <div
            v-for="area in activeFocusAreas"
            :key="area.id"
            class="col-12 col-sm-6 col-md-4"
          >
            <q-card class="cursor-pointer hover-lift" @click="goToFocusArea(area.id)">
              <q-card-section>
                <div class="row items-center no-wrap">
                  <div class="col">
                    <div class="text-h6 ellipsis">{{ area.name }}</div>
                    <div v-if="area.superSector" class="text-caption text-grey-7">
                      {{ area.superSector }}
                    </div>
                  </div>
                  <q-badge color="primary">
                    {{ area.patentCount }} patents
                  </q-badge>
                </div>

                <div v-if="area.description" class="text-body2 text-grey-7 q-mt-sm ellipsis-2-lines">
                  {{ area.description }}
                </div>

                <!-- Stats Row -->
                <div class="row q-mt-md q-gutter-sm">
                  <q-chip
                    v-if="area.searchTerms && area.searchTerms.length"
                    dense
                    color="blue-2"
                    text-color="blue-9"
                    icon="search"
                    size="sm"
                  >
                    {{ area.searchTerms.length }} terms
                  </q-chip>
                  <q-chip
                    v-if="area._count?.facetDefs"
                    dense
                    color="purple-2"
                    text-color="purple-9"
                    icon="analytics"
                    size="sm"
                  >
                    {{ area._count.facetDefs }} facets
                  </q-chip>
                  <q-chip
                    v-if="area.children && area.children.length"
                    dense
                    color="grey-3"
                    text-color="grey-8"
                    icon="account_tree"
                    size="sm"
                  >
                    {{ area.children.length }} children
                  </q-chip>
                </div>
              </q-card-section>

              <q-separator />

              <q-card-actions>
                <q-btn flat dense icon="visibility" label="View" @click.stop="goToFocusArea(area.id)" />
                <q-space />
                <q-btn
                  flat
                  dense
                  icon="archive"
                  color="grey"
                  @click.stop="archiveFocusArea(area)"
                />
              </q-card-actions>
            </q-card>
          </div>
        </div>
      </q-tab-panel>

      <!-- Draft Groups Tab -->
      <q-tab-panel name="groups" class="q-pa-none">
        <!-- Empty State -->
        <q-card v-if="focusGroups.length === 0" flat bordered class="q-pa-xl text-center">
          <q-icon name="drafts" size="4em" color="grey-5" />
          <div class="text-h6 text-grey-7 q-mt-md">No Draft Groups</div>
          <div class="text-body2 text-grey-6">
            Draft groups are created when exploring patent selections before formalizing them.
          </div>
        </q-card>

        <!-- Draft Groups List -->
        <q-list v-else separator>
          <!-- Needs Review Section -->
          <template v-if="needsReviewGroups.length">
            <q-item-label header class="text-orange">
              <q-icon name="warning" class="q-mr-sm" />
              Needs Review ({{ needsReviewGroups.length }})
            </q-item-label>

            <q-item v-for="group in needsReviewGroups" :key="group.id">
              <q-item-section avatar>
                <q-icon name="rate_review" color="orange" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ group.name }}</q-item-label>
                <q-item-label caption>
                  {{ group.patentIds.length }} patents
                  <span v-if="group.parent"> | Parent: {{ group.parent.name }}</span>
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <div class="row q-gutter-sm">
                  <q-btn flat dense icon="check" color="positive" label="Formalize" @click="formalizeFocusGroup(group)" />
                  <q-btn flat dense icon="delete" color="negative" @click="deleteFocusGroup(group)" />
                </div>
              </q-item-section>
            </q-item>
          </template>

          <!-- Draft Section -->
          <template v-if="draftFocusGroups.length">
            <q-item-label header>
              Drafts ({{ draftFocusGroups.length }})
            </q-item-label>

            <q-item v-for="group in draftFocusGroups" :key="group.id">
              <q-item-section avatar>
                <q-icon name="edit_note" color="grey" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ group.name }}</q-item-label>
                <q-item-label caption>
                  {{ group.patentIds.length }} patents |
                  Source: {{ group.sourceType.replace('_', ' ').toLowerCase() }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <div class="row q-gutter-sm">
                  <q-btn flat dense icon="check" color="positive" label="Formalize" @click="formalizeFocusGroup(group)" />
                  <q-btn flat dense icon="delete" color="negative" @click="deleteFocusGroup(group)" />
                </div>
              </q-item-section>
            </q-item>
          </template>
        </q-list>
      </q-tab-panel>
    </q-tab-panels>

    <!-- Create Focus Area Dialog -->
    <q-dialog v-model="showCreateDialog" persistent>
      <q-card style="min-width: 400px">
        <q-card-section class="row items-center">
          <div class="text-h6">Create Focus Area</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup @click="resetCreateForm" />
        </q-card-section>

        <q-card-section>
          <q-input
            v-model="createForm.name"
            label="Name *"
            outlined
            autofocus
            class="q-mb-md"
            :rules="[val => !!val || 'Name is required']"
          />

          <q-input
            v-model="createForm.description"
            label="Description"
            outlined
            type="textarea"
            rows="3"
            class="q-mb-md"
          />

          <q-select
            v-model="createForm.superSector"
            :options="superSectorOptions"
            label="Super-Sector (optional)"
            outlined
            clearable
            emit-value
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup @click="resetCreateForm" />
          <q-btn
            color="primary"
            label="Create"
            :loading="creating"
            :disable="!createForm.name.trim()"
            @click="createFocusArea"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.hover-lift {
  transition: transform 0.2s, box-shadow 0.2s;
}

.hover-lift:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.ellipsis-2-lines {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
