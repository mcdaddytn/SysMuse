<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { focusAreaApi, patentApi, searchApi, type FocusArea, type FocusAreaPatent, type SearchTerm, type PatentPreview, type SearchPreviewResult } from '@/services/api';
import PatentPreviewTooltip from '@/components/PatentPreviewTooltip.vue';
import KeywordExtractionPanel from '@/components/KeywordExtractionPanel.vue';

const route = useRoute();
const router = useRouter();

// State
const focusArea = ref<FocusArea | null>(null);
const patents = ref<FocusAreaPatent[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const activeTab = ref('overview');

// Pagination for patents
const patentPagination = ref({
  page: 1,
  rowsPerPage: 25,
  rowsNumber: 0
});

// Edit mode
const editing = ref(false);
const editForm = ref({ name: '', description: '' });

// Add patent dialog
const showAddPatentDialog = ref(false);
const newPatentIds = ref('');
const addingPatents = ref(false);
const parsedPatentIds = ref<string[]>([]);
const patentPreviews = ref<Record<string, PatentPreview | null>>({});
const loadingPreviews = ref(false);
let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Parse patent IDs from input
function parsePatentIds(input: string): string[] {
  return input
    .split(/[\s,\n]+/)
    .map(id => id.trim().replace(/^US/i, ''))
    .filter(id => id && /^\d{6,}$/.test(id));
}

// Debounced preview loading
watch(newPatentIds, (val) => {
  if (previewDebounceTimer) clearTimeout(previewDebounceTimer);

  const ids = parsePatentIds(val);
  parsedPatentIds.value = ids;

  if (ids.length === 0 || ids.length > 50) {
    patentPreviews.value = {};
    return;
  }

  previewDebounceTimer = setTimeout(async () => {
    loadingPreviews.value = true;
    try {
      const response = await patentApi.getBatchPreviews(ids);
      patentPreviews.value = response.previews;
    } catch (err) {
      console.error('Failed to load previews:', err);
    } finally {
      loadingPreviews.value = false;
    }
  }, 300);
});

// Computed preview stats
const previewStats = computed(() => {
  const total = parsedPatentIds.value.length;
  const found = Object.values(patentPreviews.value).filter(p => p !== null).length;
  const notFound = total - found;
  return { total, found, notFound };
});

// Add search term dialog
const showAddTermDialog = ref(false);
const newTerm = ref({
  expression: '',
  termType: 'KEYWORD' as const
});
const addingTerm = ref(false);

// Search term preview
const termPreviewResult = ref<SearchPreviewResult | null>(null);
const loadingTermPreview = ref(false);
const termSearchFields = ref<'title' | 'abstract' | 'both'>('both');

const searchFieldOptions = [
  { value: 'both', label: 'Title + Abstract' },
  { value: 'title', label: 'Title Only' },
  { value: 'abstract', label: 'Abstract Only' }
];

// Explicit search preview trigger
async function triggerTermPreview() {
  const expression = newTerm.value.expression.trim();
  if (!expression) return;

  loadingTermPreview.value = true;
  try {
    termPreviewResult.value = await searchApi.previewSearchTerm(expression, {
      termType: newTerm.value.termType,
      searchFields: termSearchFields.value,
      focusAreaId: focusAreaId.value
    });
  } catch (err) {
    console.error('Failed to load term preview:', err);
    termPreviewResult.value = null;
  } finally {
    loadingTermPreview.value = false;
  }
}

// Computed
const focusAreaId = computed(() => route.params.id as string);

const searchTerms = computed(() => focusArea.value?.searchTerms || []);

const termTypeOptions = [
  { value: 'KEYWORD', label: 'Keywords (OR)' },
  { value: 'PHRASE', label: 'Exact Phrase' },
  { value: 'PROXIMITY', label: 'Proximity (W/N)' },
  { value: 'WILDCARD', label: 'Wildcards' },
  { value: 'BOOLEAN', label: 'Boolean Expression' }
];

// Load focus area
async function loadFocusArea() {
  loading.value = true;
  error.value = null;

  try {
    focusArea.value = await focusAreaApi.getFocusArea(focusAreaId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load focus area';
    console.error('Failed to load focus area:', err);
  } finally {
    loading.value = false;
  }
}

// Load patents
async function loadPatents() {
  try {
    const response = await focusAreaApi.getFocusAreaPatents(focusAreaId.value, {
      page: patentPagination.value.page,
      limit: patentPagination.value.rowsPerPage
    });
    patents.value = response.data;
    patentPagination.value.rowsNumber = response.total;
  } catch (err) {
    console.error('Failed to load patents:', err);
  }
}

// Start editing
function startEdit() {
  if (!focusArea.value) return;
  editForm.value = {
    name: focusArea.value.name,
    description: focusArea.value.description || ''
  };
  editing.value = true;
}

// Save edits
async function saveEdit() {
  if (!focusArea.value || !editForm.value.name.trim()) return;

  try {
    const updated = await focusAreaApi.updateFocusArea(focusAreaId.value, {
      name: editForm.value.name,
      description: editForm.value.description || undefined
    });
    focusArea.value = { ...focusArea.value, ...updated };
    editing.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save';
  }
}

// Cancel edit
function cancelEdit() {
  editing.value = false;
}

// Add patents
async function addPatents() {
  const ids = newPatentIds.value
    .split(/[\s,]+/)
    .map(id => id.trim())
    .filter(id => id);

  if (ids.length === 0) return;

  addingPatents.value = true;
  try {
    const result = await focusAreaApi.addPatentsToFocusArea(focusAreaId.value, ids);

    // Refresh
    await Promise.all([loadFocusArea(), loadPatents()]);

    showAddPatentDialog.value = false;
    newPatentIds.value = '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add patents';
  } finally {
    addingPatents.value = false;
  }
}

// Remove patent
async function removePatent(patentId: string) {
  if (!confirm('Remove this patent from the focus area?')) return;

  try {
    await focusAreaApi.removePatentsFromFocusArea(focusAreaId.value, [patentId]);
    patents.value = patents.value.filter(p => p.patentId !== patentId);
    if (focusArea.value) {
      focusArea.value.patentCount--;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to remove patent';
  }
}

// Add search term
async function addSearchTerm() {
  if (!newTerm.value.expression.trim()) return;

  addingTerm.value = true;
  try {
    const term = await focusAreaApi.addSearchTerm(focusAreaId.value, {
      expression: newTerm.value.expression,
      termType: newTerm.value.termType,
      sourceType: 'MANUAL'
    });

    if (focusArea.value) {
      focusArea.value.searchTerms = [...(focusArea.value.searchTerms || []), term];
    }

    showAddTermDialog.value = false;
    newTerm.value = { expression: '', termType: 'KEYWORD' };
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add search term';
  } finally {
    addingTerm.value = false;
  }
}

// Remove search term
async function removeSearchTerm(termId: string) {
  if (!confirm('Remove this search term?')) return;

  try {
    await focusAreaApi.removeSearchTerm(focusAreaId.value, termId);
    if (focusArea.value) {
      focusArea.value.searchTerms = focusArea.value.searchTerms?.filter(t => t.id !== termId);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to remove search term';
  }
}

// Add search term from keyword extraction
async function addTermFromExtraction(expression: string, termType: string) {
  addingTerm.value = true;
  try {
    const term = await focusAreaApi.addSearchTerm(focusAreaId.value, {
      expression,
      termType,
      sourceType: 'FREQUENCY_ANALYSIS'
    });

    if (focusArea.value) {
      focusArea.value.searchTerms = [...(focusArea.value.searchTerms || []), term];
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add search term';
  } finally {
    addingTerm.value = false;
  }
}

// Navigate to patent detail
function goToPatent(patentId: string) {
  router.push({ name: 'patent-detail', params: { id: patentId } });
}

// Remove a patent from the input
function removePatentFromInput(patentId: string) {
  const ids = parsePatentIds(newPatentIds.value);
  const remaining = ids.filter(id => id !== patentId);
  newPatentIds.value = remaining.join(', ');
}

// Pagination handler
function onPatentRequest(props: { pagination: typeof patentPagination.value }) {
  patentPagination.value.page = props.pagination.page;
  patentPagination.value.rowsPerPage = props.pagination.rowsPerPage;
  loadPatents();
}

// Initialize
onMounted(async () => {
  await loadFocusArea();
  await loadPatents();
});
</script>

<template>
  <q-page padding>
    <!-- Loading -->
    <div v-if="loading" class="row justify-center q-pa-xl">
      <q-spinner size="lg" color="primary" />
    </div>

    <!-- Error -->
    <q-banner v-else-if="error && !focusArea" class="bg-negative text-white">
      {{ error }}
      <template v-slot:action>
        <q-btn flat label="Go Back" @click="router.back()" />
        <q-btn flat label="Retry" @click="loadFocusArea" />
      </template>
    </q-banner>

    <!-- Content -->
    <template v-else-if="focusArea">
      <!-- Breadcrumb -->
      <q-breadcrumbs class="q-mb-md">
        <q-breadcrumbs-el icon="home" to="/" />
        <q-breadcrumbs-el label="Focus Areas" to="/focus-areas" />
        <q-breadcrumbs-el :label="focusArea.name" />
      </q-breadcrumbs>

      <!-- Header -->
      <q-card class="q-mb-md">
        <q-card-section>
          <div class="row items-start">
            <div class="col">
              <!-- View Mode -->
              <template v-if="!editing">
                <div class="row items-center q-mb-xs">
                  <div class="text-h5">{{ focusArea.name }}</div>
                  <q-btn flat round dense icon="edit" class="q-ml-sm" @click="startEdit" />
                </div>
                <div v-if="focusArea.description" class="text-body2 text-grey-7">
                  {{ focusArea.description }}
                </div>
              </template>

              <!-- Edit Mode -->
              <template v-else>
                <q-input
                  v-model="editForm.name"
                  label="Name"
                  dense
                  outlined
                  class="q-mb-sm"
                />
                <q-input
                  v-model="editForm.description"
                  label="Description"
                  dense
                  outlined
                  type="textarea"
                  rows="2"
                />
                <div class="q-mt-sm">
                  <q-btn flat label="Cancel" @click="cancelEdit" />
                  <q-btn color="primary" label="Save" @click="saveEdit" />
                </div>
              </template>
            </div>

            <!-- Stats -->
            <div class="col-auto">
              <div class="row q-gutter-md">
                <div class="text-center">
                  <div class="text-h4 text-primary">{{ focusArea.patentCount }}</div>
                  <div class="text-caption text-grey-7">Patents</div>
                </div>
                <div class="text-center">
                  <div class="text-h4 text-blue">{{ searchTerms.length }}</div>
                  <div class="text-caption text-grey-7">Search Terms</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Metadata Chips -->
          <div class="row q-mt-md q-gutter-sm">
            <q-chip v-if="focusArea.superSector" dense color="grey-3">
              <q-icon name="category" class="q-mr-xs" size="xs" />
              {{ focusArea.superSector }}
            </q-chip>
            <q-chip v-if="focusArea.parent" dense color="grey-3">
              <q-icon name="account_tree" class="q-mr-xs" size="xs" />
              Parent: {{ focusArea.parent.name }}
            </q-chip>
            <q-chip dense :color="focusArea.status === 'ACTIVE' ? 'green-2' : 'grey-3'">
              {{ focusArea.status }}
            </q-chip>
          </div>
        </q-card-section>
      </q-card>

      <!-- Error Banner -->
      <q-banner v-if="error" class="bg-negative text-white q-mb-md">
        {{ error }}
        <template v-slot:action>
          <q-btn flat label="Dismiss" @click="error = null" />
        </template>
      </q-banner>

      <!-- Tabs -->
      <q-tabs v-model="activeTab" class="q-mb-md" align="left" active-color="primary">
        <q-tab name="overview" label="Overview" />
        <q-tab name="patents" label="Patents" :badge="focusArea.patentCount || undefined" />
        <q-tab name="search-terms" label="Search Terms" :badge="searchTerms.length || undefined" />
      </q-tabs>

      <q-tab-panels v-model="activeTab" animated>
        <!-- Overview Tab -->
        <q-tab-panel name="overview" class="q-pa-none">
          <div class="row q-col-gutter-md">
            <!-- Info Card -->
            <div class="col-12 col-md-6">
              <q-card flat bordered>
                <q-card-section>
                  <div class="text-subtitle2 q-mb-md">Details</div>
                  <q-list dense>
                    <q-item>
                      <q-item-section avatar>
                        <q-icon name="person" />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label caption>Owner</q-item-label>
                        <q-item-label>{{ focusArea.owner?.name || 'Unknown' }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section avatar>
                        <q-icon name="calendar_today" />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label caption>Created</q-item-label>
                        <q-item-label>{{ new Date(focusArea.createdAt).toLocaleDateString() }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item v-if="focusArea.lastCalculatedAt">
                      <q-item-section avatar>
                        <q-icon name="update" />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label caption>Last Calculated</q-item-label>
                        <q-item-label>{{ new Date(focusArea.lastCalculatedAt).toLocaleString() }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </q-card-section>
              </q-card>
            </div>

            <!-- Quick Actions Card -->
            <div class="col-12 col-md-6">
              <q-card flat bordered>
                <q-card-section>
                  <div class="text-subtitle2 q-mb-md">Quick Actions</div>
                  <div class="column q-gutter-sm">
                    <q-btn outline icon="add" label="Add Patents" @click="showAddPatentDialog = true" />
                    <q-btn outline icon="search" label="Add Search Term" @click="showAddTermDialog = true" />
                    <q-btn outline icon="analytics" label="Define Facet" disabled />
                  </div>
                </q-card-section>
              </q-card>
            </div>
          </div>
        </q-tab-panel>

        <!-- Patents Tab -->
        <q-tab-panel name="patents" class="q-pa-none">
          <q-card flat bordered>
            <q-card-section class="q-pb-none">
              <div class="row items-center">
                <div class="text-subtitle2">Member Patents</div>
                <q-space />
                <q-btn flat dense icon="add" label="Add" @click="showAddPatentDialog = true" />
              </div>
            </q-card-section>

            <q-card-section>
              <q-table
                :rows="patents"
                :columns="[
                  { name: 'patentId', label: 'Patent ID', field: 'patentId', align: 'left' },
                  { name: 'membershipType', label: 'Type', field: 'membershipType', align: 'center' },
                  { name: 'matchScore', label: 'Score', field: 'matchScore', align: 'center', format: (v: number) => v?.toFixed(2) || '-' },
                  { name: 'actions', label: '', field: 'actions', align: 'right' }
                ]"
                row-key="id"
                v-model:pagination="patentPagination"
                flat
                bordered
                @request="onPatentRequest"
              >
                <template v-slot:body-cell-patentId="props">
                  <q-td :props="props">
                    <PatentPreviewTooltip
                      :patent-id="props.row.patentId"
                      show-link
                      @click="goToPatent"
                    />
                  </q-td>
                </template>

                <template v-slot:body-cell-membershipType="props">
                  <q-td :props="props">
                    <q-chip
                      dense
                      size="sm"
                      :color="props.row.membershipType === 'MANUAL' ? 'grey-4' : 'blue-2'"
                    >
                      {{ props.row.membershipType.toLowerCase() }}
                    </q-chip>
                  </q-td>
                </template>

                <template v-slot:body-cell-actions="props">
                  <q-td :props="props">
                    <q-btn flat dense icon="delete" color="negative" @click="removePatent(props.row.patentId)" />
                  </q-td>
                </template>

                <template v-slot:no-data>
                  <div class="full-width row flex-center text-grey q-pa-xl">
                    <q-icon name="folder_open" size="2em" class="q-mr-sm" />
                    No patents in this focus area yet
                  </div>
                </template>
              </q-table>
            </q-card-section>
          </q-card>
        </q-tab-panel>

        <!-- Search Terms Tab -->
        <q-tab-panel name="search-terms" class="q-pa-none">
          <!-- Keyword Extraction Panel -->
          <KeywordExtractionPanel
            v-if="focusArea"
            :focus-area-id="focusArea.id"
            :patent-count="focusArea.patentCount"
            class="q-mb-md"
            @add-term="addTermFromExtraction"
          />

          <q-card flat bordered>
            <q-card-section class="q-pb-none">
              <div class="row items-center">
                <div class="text-subtitle2">Search Terms</div>
                <q-space />
                <q-btn flat dense icon="add" label="Add Term" @click="showAddTermDialog = true" />
              </div>
            </q-card-section>

            <q-card-section>
              <!-- Empty State -->
              <div v-if="searchTerms.length === 0" class="text-center q-pa-xl text-grey-6">
                <q-icon name="search_off" size="3em" />
                <div class="q-mt-md">No search terms defined</div>
                <q-btn flat color="primary" label="Add First Term" class="q-mt-sm" @click="showAddTermDialog = true" />
              </div>

              <!-- Terms List -->
              <q-list v-else separator>
                <q-item v-for="term in searchTerms" :key="term.id">
                  <q-item-section avatar>
                    <q-icon name="search" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-weight-medium">
                      <code>{{ term.expression }}</code>
                    </q-item-label>
                    <q-item-label caption>
                      {{ term.termType }} | Source: {{ term.sourceType.toLowerCase().replace('_', ' ') }}
                    </q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <div class="row q-gutter-sm items-center">
                      <q-badge v-if="term.hitCountPortfolio" color="grey-6" outline>
                        {{ term.hitCountPortfolio }} hits
                      </q-badge>
                      <q-btn flat dense icon="delete" color="negative" @click="removeSearchTerm(term.id)" />
                    </div>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>
        </q-tab-panel>
      </q-tab-panels>
    </template>

    <!-- Add Patent Dialog -->
    <q-dialog v-model="showAddPatentDialog" persistent>
      <q-card style="min-width: 550px; max-width: 700px">
        <q-card-section class="row items-center">
          <div class="text-h6">Add Patents</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup @click="newPatentIds = ''" />
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="newPatentIds"
            label="Patent IDs"
            outlined
            type="textarea"
            rows="3"
            hint="Enter patent IDs separated by commas, spaces, or newlines"
            placeholder="10378893, 10445123, 10567890"
            autofocus
          />

          <!-- Preview Section -->
          <div v-if="parsedPatentIds.length > 0" class="q-mt-md">
            <div class="row items-center q-mb-sm">
              <div class="text-subtitle2">Preview</div>
              <q-space />
              <div class="text-caption text-grey">
                <q-spinner v-if="loadingPreviews" size="xs" class="q-mr-xs" />
                <span v-if="previewStats.found > 0" class="text-positive">
                  {{ previewStats.found }} found
                </span>
                <span v-if="previewStats.notFound > 0" class="text-negative q-ml-sm">
                  {{ previewStats.notFound }} not in portfolio
                </span>
              </div>
            </div>

            <div class="patent-chips-container">
              <template v-for="id in parsedPatentIds" :key="id">
                <PatentPreviewTooltip
                  v-if="patentPreviews[id] !== undefined"
                  :patent-id="id"
                >
                  <q-chip
                    dense
                    :color="patentPreviews[id] ? 'blue-2' : 'red-2'"
                    :text-color="patentPreviews[id] ? 'blue-9' : 'red-9'"
                    :icon="patentPreviews[id] ? 'check_circle' : 'error'"
                    size="sm"
                    removable
                    @remove="removePatentFromInput(id)"
                  >
                    {{ id }}
                  </q-chip>
                </PatentPreviewTooltip>
                <q-chip
                  v-else
                  dense
                  color="grey-3"
                  size="sm"
                >
                  <q-spinner size="xs" class="q-mr-xs" />
                  {{ id }}
                </q-chip>
              </template>
            </div>

            <!-- Info about found patents -->
            <div v-if="Object.values(patentPreviews).some(p => p !== null)" class="q-mt-sm text-caption text-grey-7">
              Hover over patents to see details
            </div>
          </div>

          <!-- Too many patents warning -->
          <q-banner v-if="parsedPatentIds.length > 50" class="q-mt-md bg-orange-1 text-orange-9">
            <template v-slot:avatar>
              <q-icon name="warning" color="orange" />
            </template>
            Preview limited to 50 patents. All entered IDs will still be added.
          </q-banner>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup @click="newPatentIds = ''" />
          <q-btn
            color="primary"
            :label="`Add ${previewStats.found || parsedPatentIds.length} Patents`"
            :loading="addingPatents"
            :disable="parsedPatentIds.length === 0"
            @click="addPatents"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Search Term Dialog -->
    <q-dialog v-model="showAddTermDialog">
      <q-card style="min-width: 500px">
        <q-card-section class="row items-center">
          <div class="text-h6">Add Search Term</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <q-select
            v-model="newTerm.termType"
            :options="termTypeOptions"
            label="Term Type"
            outlined
            emit-value
            map-options
            class="q-mb-md"
          />

          <q-input
            v-model="newTerm.expression"
            label="Search Expression"
            outlined
            :placeholder="newTerm.termType === 'BOOLEAN' ? 'container AND (security OR isolation)' : 'container security'"
            :hint="newTerm.termType === 'PROXIMITY' ? 'Use W/N syntax, e.g., container W/3 security' : ''"
            @keyup.enter="triggerTermPreview"
          />

          <!-- Search Fields + Search Button -->
          <div class="row q-gutter-sm q-mt-sm items-center">
            <q-select
              v-model="termSearchFields"
              :options="searchFieldOptions"
              label="Search In"
              outlined
              dense
              emit-value
              map-options
              style="min-width: 170px"
            />
            <q-btn
              color="primary"
              icon="search"
              label="Search"
              :loading="loadingTermPreview"
              :disable="!newTerm.expression.trim()"
              @click="triggerTermPreview"
            />
          </div>

          <!-- Hit Preview (always visible) -->
          <div class="q-mt-md">
            <div class="text-subtitle2 q-mb-sm">Hit Preview</div>

            <template v-if="loadingTermPreview">
              <div class="row items-center q-gutter-sm">
                <q-spinner size="xs" />
                <span class="text-caption text-grey">Searching...</span>
              </div>
            </template>

            <template v-else-if="termPreviewResult">
              <div class="row q-gutter-md q-mb-sm">
                <q-chip dense color="grey-2" icon="public" size="sm">
                  <span class="text-weight-medium">Portfolio:</span>
                  <span class="q-ml-xs">{{ termPreviewResult.hitCounts.portfolio.toLocaleString() }}</span>
                </q-chip>
                <q-chip
                  v-if="termPreviewResult.hitCounts.focusArea !== undefined"
                  dense
                  color="blue-2"
                  icon="folder"
                  size="sm"
                >
                  <span class="text-weight-medium">Focus Area:</span>
                  <span class="q-ml-xs">{{ termPreviewResult.hitCounts.focusArea.toLocaleString() }}</span>
                </q-chip>
              </div>

              <!-- Sample matches -->
              <div v-if="termPreviewResult.sampleHits?.length" class="sample-matches">
                <div class="text-caption text-grey-7 q-mb-xs">Sample matches:</div>
                <div
                  v-for="hit in termPreviewResult.sampleHits.slice(0, 3)"
                  :key="hit.patentId"
                  class="sample-match-row"
                >
                  <span class="text-weight-medium text-primary">{{ hit.patentId }}</span>
                  <span class="text-grey-7 q-ml-sm" v-html="hit.highlight || hit.title.substring(0, 50) + '...'"></span>
                </div>
              </div>

              <div v-else class="text-caption text-grey-6">
                No matches found
              </div>
            </template>

            <template v-else>
              <div class="text-caption text-grey-6">
                Click Search to preview hits
              </div>
            </template>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            :label="`Add Term${termPreviewResult?.hitCounts?.portfolio ? ' (' + termPreviewResult.hitCounts.portfolio + ' hits)' : ''}`"
            :loading="addingTerm"
            :disable="!newTerm.expression.trim()"
            @click="addSearchTerm"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
code {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Fira Code', monospace;
}

.patent-chips-container {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}

.sample-matches {
  background: #f8f9fa;
  border-radius: 4px;
  padding: 8px 12px;
}

.sample-match-row {
  font-size: 0.85em;
  padding: 3px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sample-match-row :deep(mark) {
  background: #fff59d;
  padding: 0 2px;
  border-radius: 2px;
}
</style>
