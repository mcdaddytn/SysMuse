<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import {
  patentFamilyApi,
  type MultiSeedConfig,
  type MergeStrategy,
  type PreviewResult,
  type EnrichedFamilyMember,
  type FilterOptions,
  type LitigationIndicator,
} from '@/services/api';

const route = useRoute();
const router = useRouter();
const $q = useQuasar();

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

// Seed patent input
const seedInput = ref('');
const seedPatentIds = computed(() => {
  return seedInput.value
    .split(/[\s,\n]+/)
    .map(id => id.trim().replace(/^US/i, ''))
    .filter(id => id && /^\d{6,}$/.test(id));
});

// Expansion configuration
const maxAncestorDepth = ref(1);
const maxDescendantDepth = ref(1);
const includeSiblings = ref(true);
const includeCousins = ref(false);
const requireInPortfolio = ref(false);
const mergeStrategy = ref<MergeStrategy>('INTERSECTION');
const minFilingYear = ref<number | null>(null);

// Filter options (loaded from API)
const filterOptions = ref<FilterOptions | null>(null);
const selectedCompetitors = ref<string[]>([]);
const selectedAffiliates = ref<string[]>([]);
const selectedSectors = ref<string[]>([]);

// Preview state
const preview = ref<PreviewResult | null>(null);
const loadingPreview = ref(false);
const previewError = ref<string | null>(null);

// Exploration results
const members = ref<EnrichedFamilyMember[]>([]);
const explorationId = ref<string | null>(null);
const loadingExploration = ref(false);
const explorationError = ref<string | null>(null);

// Selection and filtering
const selectedMembers = ref<EnrichedFamilyMember[]>([]);
const memberFilter = ref({
  relation: 'all',
  inPortfolio: 'all',
  competitor: 'all',
});
const memberSearch = ref('');

// Focus Area creation
const showCreateFocusAreaDialog = ref(false);
const newFocusAreaName = ref('');
const newFocusAreaDescription = ref('');
const includeExternalPatents = ref(true);
const creatingFocusArea = ref(false);

// Pagination
const pagination = ref({
  page: 1,
  rowsPerPage: 50,
  sortBy: 'score',
  descending: true,
});

// Litigation enrichment
const litigationData = ref<Map<string, LitigationIndicator>>(new Map());
const enrichingLitigation = ref(false);

// ─────────────────────────────────────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────────────────────────────────────

const config = computed<MultiSeedConfig>(() => ({
  seedPatentIds: seedPatentIds.value,
  maxAncestorDepth: maxAncestorDepth.value,
  maxDescendantDepth: maxDescendantDepth.value,
  includeSiblings: includeSiblings.value,
  includeCousins: includeCousins.value,
  limitToCompetitors: selectedCompetitors.value,
  limitToAffiliates: selectedAffiliates.value,
  limitToSectors: selectedSectors.value,
  requireInPortfolio: requireInPortfolio.value,
  mergeStrategy: mergeStrategy.value,
  minFilingYear: minFilingYear.value ?? undefined,
}));

const filteredMembers = computed(() => {
  let result = members.value;

  // Apply relation filter
  if (memberFilter.value.relation !== 'all') {
    result = result.filter(m => m.relationToSeed === memberFilter.value.relation);
  }

  // Apply portfolio filter
  if (memberFilter.value.inPortfolio === 'yes') {
    result = result.filter(m => m.inPortfolio);
  } else if (memberFilter.value.inPortfolio === 'no') {
    result = result.filter(m => !m.inPortfolio);
  }

  // Apply competitor filter
  if (memberFilter.value.competitor === 'competitors') {
    result = result.filter(m => m.competitorMatch);
  } else if (memberFilter.value.competitor === 'non-competitors') {
    result = result.filter(m => !m.competitorMatch);
  }

  // Apply search
  if (memberSearch.value.trim()) {
    const search = memberSearch.value.toLowerCase();
    result = result.filter(m =>
      m.patentId.includes(search) ||
      m.patentTitle.toLowerCase().includes(search) ||
      m.assignee.toLowerCase().includes(search)
    );
  }

  return result;
});

const relationCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const m of members.value) {
    counts[m.relationToSeed] = (counts[m.relationToSeed] || 0) + 1;
  }
  return counts;
});

const portfolioCounts = computed(() => ({
  inPortfolio: members.value.filter(m => m.inPortfolio).length,
  external: members.value.filter(m => !m.inPortfolio).length,
}));

const competitorCounts = computed(() => ({
  competitors: members.value.filter(m => m.competitorMatch).length,
  nonCompetitors: members.value.filter(m => !m.competitorMatch).length,
}));

const uniqueCompetitors = computed(() => {
  const companies = new Set<string>();
  for (const m of members.value) {
    if (m.competitorMatch) {
      companies.add(m.competitorMatch.company);
    }
  }
  return [...companies].sort();
});

const tableColumns = computed(() => [
  { name: 'patentId', label: 'Patent ID', field: 'patentId', sortable: true, align: 'left' as const },
  { name: 'patentTitle', label: 'Title', field: 'patentTitle', sortable: true, align: 'left' as const },
  { name: 'assignee', label: 'Assignee', field: 'assignee', sortable: true, align: 'left' as const },
  { name: 'relationToSeed', label: 'Relation', field: 'relationToSeed', sortable: true, align: 'left' as const },
  { name: 'inPortfolio', label: 'Portfolio', field: 'inPortfolio', sortable: true, align: 'center' as const },
  { name: 'competitorMatch', label: 'Competitor', field: (row: EnrichedFamilyMember) => row.competitorMatch?.company || '', sortable: true, align: 'left' as const },
  { name: 'ipr', label: 'IPR', field: (row: EnrichedFamilyMember) => getLitigationIndicator(row.patentId)?.hasIPR ? 'Yes' : '', sortable: true, align: 'center' as const },
  { name: 'remainingYears', label: 'Years Left', field: 'remainingYears', sortable: true, align: 'right' as const, format: (val: number | undefined) => val?.toFixed(1) || '--' },
  { name: 'score', label: 'Score', field: 'score', sortable: true, align: 'right' as const, format: (val: number | undefined) => val?.toFixed(1) || '--' },
]);

const iprCounts = computed(() => {
  let hasIPR = 0;
  let checked = 0;
  for (const m of members.value) {
    const lit = litigationData.value.get(m.patentId);
    if (lit) {
      checked++;
      if (lit.hasIPR) hasIPR++;
    }
  }
  return { hasIPR, checked, total: members.value.length };
});

// ─────────────────────────────────────────────────────────────────────────────
// Methods
// ─────────────────────────────────────────────────────────────────────────────

async function loadFilterOptions() {
  try {
    filterOptions.value = await patentFamilyApi.getFilterOptions();
  } catch (err) {
    console.error('Failed to load filter options:', err);
  }
}

async function loadPreview() {
  if (seedPatentIds.value.length === 0) {
    preview.value = null;
    return;
  }

  loadingPreview.value = true;
  previewError.value = null;

  try {
    preview.value = await patentFamilyApi.previewMultiSeed(config.value);
  } catch (err) {
    previewError.value = err instanceof Error ? err.message : 'Preview failed';
    preview.value = null;
  } finally {
    loadingPreview.value = false;
  }
}

async function executeExploration() {
  if (seedPatentIds.value.length === 0) return;

  loadingExploration.value = true;
  explorationError.value = null;
  members.value = [];
  selectedMembers.value = [];

  try {
    const result = await patentFamilyApi.executeMultiSeed(config.value);
    explorationId.value = result.exploration.id;
    members.value = result.members;

    $q.notify({
      type: 'positive',
      message: `Found ${result.memberCount} patents in family`,
    });
  } catch (err) {
    explorationError.value = err instanceof Error ? err.message : 'Exploration failed';
    $q.notify({
      type: 'negative',
      message: 'Exploration failed',
    });
  } finally {
    loadingExploration.value = false;
  }
}

function openCreateFocusAreaDialog() {
  if (selectedMembers.value.length === 0) {
    $q.notify({
      type: 'warning',
      message: 'Please select patents first',
    });
    return;
  }
  newFocusAreaName.value = '';
  newFocusAreaDescription.value = '';
  showCreateFocusAreaDialog.value = true;
}

async function createFocusArea() {
  if (!newFocusAreaName.value.trim()) return;

  creatingFocusArea.value = true;

  try {
    const patentIds = selectedMembers.value.map(m => m.patentId);

    const result = explorationId.value
      ? await patentFamilyApi.createFocusAreaFromExploration(explorationId.value, {
          name: newFocusAreaName.value.trim(),
          description: newFocusAreaDescription.value.trim() || undefined,
          patentIds,
          includeExternalPatents: includeExternalPatents.value,
        })
      : await patentFamilyApi.createFocusAreaDirect({
          name: newFocusAreaName.value.trim(),
          description: newFocusAreaDescription.value.trim() || undefined,
          patentIds,
          includeExternalPatents: includeExternalPatents.value,
        });

    showCreateFocusAreaDialog.value = false;
    $q.notify({
      type: 'positive',
      message: `Created focus area "${result.focusArea.name}" with ${result.added} patents`,
    });

    // Navigate to the new focus area
    router.push({ name: 'focus-area-detail', params: { id: result.focusArea.id } });
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: err instanceof Error ? err.message : 'Failed to create focus area',
    });
  } finally {
    creatingFocusArea.value = false;
  }
}

function selectAllPortfolio() {
  selectedMembers.value = members.value.filter(m => m.inPortfolio);
}

function selectAllCompetitors() {
  selectedMembers.value = members.value.filter(m => m.competitorMatch);
}

function clearSelection() {
  selectedMembers.value = [];
}

function clearSeeds() {
  seedInput.value = '';
  preview.value = null;
  members.value = [];
  selectedMembers.value = [];
  explorationId.value = null;
}

function onRowClick(_evt: Event, row: EnrichedFamilyMember) {
  router.push({ name: 'patent-detail', params: { id: row.patentId } });
}

// Litigation enrichment
async function enrichLitigation() {
  if (members.value.length === 0) return;

  enrichingLitigation.value = true;
  try {
    const patentIds = members.value.map(m => m.patentId);
    const result = await patentFamilyApi.enrichLitigation(patentIds, {
      includeIpr: true,
      includeProsecution: true,
    });

    // Store results in map for quick lookup
    for (const indicator of result.indicators) {
      litigationData.value.set(indicator.patentId, indicator);
    }

    const iprCount = result.indicators.filter(i => i.hasIPR).length;
    $q.notify({
      type: 'positive',
      message: `Enriched ${result.enriched} patents. ${iprCount} have IPR history.`,
    });
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: 'Failed to enrich litigation data',
    });
  } finally {
    enrichingLitigation.value = false;
  }
}

function getLitigationIndicator(patentId: string): LitigationIndicator | undefined {
  return litigationData.value.get(patentId);
}

// Debounced preview
let previewTimeout: ReturnType<typeof setTimeout> | null = null;
watch([seedPatentIds, maxAncestorDepth, maxDescendantDepth, includeSiblings, mergeStrategy], () => {
  if (previewTimeout) clearTimeout(previewTimeout);
  previewTimeout = setTimeout(loadPreview, 500);
});

// Load seeds from URL params
onMounted(async () => {
  await loadFilterOptions();

  // Check for seeds from URL or navigation state
  const urlSeeds = route.query.seeds;
  if (urlSeeds) {
    if (Array.isArray(urlSeeds)) {
      seedInput.value = urlSeeds.join('\n');
    } else {
      seedInput.value = urlSeeds;
    }
  }
});
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="text-h5">Patent Family Explorer</div>
      <q-badge color="primary" class="q-ml-md" v-if="members.length > 0">
        {{ members.length }} patents
      </q-badge>
      <q-space />
      <q-btn
        flat
        icon="help_outline"
        @click="$q.notify({ message: 'Enter seed patents, configure expansion, then explore to find related patents.' })"
      />
    </div>

    <div class="row q-col-gutter-md">
      <!-- Left Panel: Configuration -->
      <div class="col-12 col-md-4">
        <!-- Seed Patents -->
        <q-card class="q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">
              <q-icon name="scatter_plot" class="q-mr-sm" />
              Seed Patents
            </div>
            <q-input
              v-model="seedInput"
              type="textarea"
              outlined
              dense
              rows="4"
              placeholder="Enter patent IDs (one per line or comma-separated)&#10;e.g., 10123456, 10234567"
              hint="Paste from scoring results or other sources"
            />
            <div class="row q-mt-sm q-gutter-sm">
              <q-badge color="primary">{{ seedPatentIds.length }} seeds</q-badge>
              <q-btn v-if="seedPatentIds.length > 0" flat dense size="sm" label="Clear" @click="clearSeeds" />
            </div>
          </q-card-section>
        </q-card>

        <!-- Expansion Config -->
        <q-card class="q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">
              <q-icon name="account_tree" class="q-mr-sm" />
              Expansion Configuration
            </div>

            <div class="row q-col-gutter-sm q-mb-sm">
              <div class="col-6">
                <q-select
                  v-model="maxAncestorDepth"
                  :options="[0, 1, 2, 3]"
                  label="Ancestors (parents)"
                  outlined
                  dense
                />
              </div>
              <div class="col-6">
                <q-select
                  v-model="maxDescendantDepth"
                  :options="[0, 1, 2, 3]"
                  label="Descendants (children)"
                  outlined
                  dense
                />
              </div>
            </div>

            <div class="row q-gutter-sm q-mb-sm">
              <q-checkbox v-model="includeSiblings" label="Include siblings" dense />
              <q-checkbox v-model="includeCousins" label="Include cousins" dense />
            </div>

            <q-separator class="q-my-sm" />

            <div class="text-caption text-grey-7 q-mb-xs">Merge Strategy</div>
            <q-btn-toggle
              v-model="mergeStrategy"
              toggle-color="primary"
              :options="[
                { value: 'INTERSECTION', label: 'Intersection' },
                { value: 'UNION', label: 'Union' },
              ]"
              dense
              no-caps
              class="q-mb-sm"
            />
            <div class="text-caption text-grey-6">
              <template v-if="mergeStrategy === 'INTERSECTION'">
                Only patents connected to ALL seeds
              </template>
              <template v-else>
                Patents connected to ANY seed
              </template>
            </div>
          </q-card-section>
        </q-card>

        <!-- Constraints -->
        <q-card class="q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">
              <q-icon name="filter_list" class="q-mr-sm" />
              Constraints
            </div>

            <q-checkbox
              v-model="requireInPortfolio"
              label="Portfolio patents only"
              dense
              class="q-mb-sm"
            />

            <q-select
              v-model="selectedCompetitors"
              :options="filterOptions?.competitors || []"
              label="Limit to competitors"
              outlined
              dense
              multiple
              use-chips
              clearable
              class="q-mb-sm"
            />

            <q-select
              v-model="selectedAffiliates"
              :options="(filterOptions?.affiliates || []).map(a => ({ label: a.displayName, value: a.key }))"
              label="Limit to affiliates"
              outlined
              dense
              multiple
              use-chips
              clearable
              emit-value
              map-options
              class="q-mb-sm"
            />

            <q-input
              v-model.number="minFilingYear"
              type="number"
              label="Min filing year"
              outlined
              dense
              placeholder="e.g., 2015"
              clearable
            />
          </q-card-section>
        </q-card>

        <!-- Preview -->
        <q-card v-if="preview || loadingPreview" class="q-mb-md">
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">
              <q-icon name="preview" class="q-mr-sm" />
              Preview Estimate
            </div>

            <q-inner-loading :showing="loadingPreview" />

            <template v-if="preview && !loadingPreview">
              <div class="row q-col-gutter-xs q-mb-sm">
                <div class="col-6">
                  <div class="text-h6">~{{ preview.estimatedMembers.total }}</div>
                  <div class="text-caption text-grey-7">Est. total</div>
                </div>
                <div class="col-6">
                  <div class="text-body2">
                    Parents: {{ preview.estimatedMembers.parents }}<br>
                    Children: {{ preview.estimatedMembers.children }}<br>
                    Siblings: {{ preview.estimatedMembers.siblings }}
                  </div>
                </div>
              </div>

              <q-separator class="q-my-sm" />

              <div class="text-caption">
                <q-icon name="check_circle" color="positive" v-if="preview.cachedDataAvailable === seedPatentIds.length" />
                <q-icon name="cloud_download" color="warning" v-else />
                {{ preview.cachedDataAvailable }}/{{ seedPatentIds.length }} seeds cached
                <span v-if="preview.estimatedApiCalls > 0">
                  (~{{ preview.estimatedApiCalls }} API calls needed)
                </span>
              </div>

              <div v-if="preview.seedOverlap.commonSectors.length > 0" class="q-mt-sm">
                <div class="text-caption text-grey-7">Common sectors:</div>
                <q-chip
                  v-for="sector in preview.seedOverlap.commonSectors"
                  :key="sector"
                  dense
                  size="sm"
                >
                  {{ sector }}
                </q-chip>
              </div>
            </template>

            <q-banner v-if="previewError" class="bg-negative text-white q-mt-sm">
              {{ previewError }}
            </q-banner>
          </q-card-section>
        </q-card>

        <!-- Execute Button -->
        <q-btn
          color="primary"
          icon="search"
          label="Explore Family"
          :loading="loadingExploration"
          :disable="seedPatentIds.length === 0"
          class="full-width"
          @click="executeExploration"
        />
      </div>

      <!-- Right Panel: Results -->
      <div class="col-12 col-md-8">
        <q-card v-if="members.length > 0 || loadingExploration">
          <q-card-section>
            <div class="row items-center q-mb-md">
              <div class="text-subtitle1">
                Results ({{ filteredMembers.length }} patents)
              </div>
              <q-space />

              <!-- Filter controls -->
              <q-select
                v-model="memberFilter.relation"
                :options="[
                  { label: 'All relations', value: 'all' },
                  ...Object.entries(relationCounts).map(([rel, count]) => ({ label: `${rel} (${count})`, value: rel }))
                ]"
                outlined
                dense
                emit-value
                map-options
                style="min-width: 140px"
                class="q-mr-sm"
              />

              <q-select
                v-model="memberFilter.inPortfolio"
                :options="[
                  { label: 'All', value: 'all' },
                  { label: `Portfolio (${portfolioCounts.inPortfolio})`, value: 'yes' },
                  { label: `External (${portfolioCounts.external})`, value: 'no' },
                ]"
                outlined
                dense
                emit-value
                map-options
                style="min-width: 130px"
                class="q-mr-sm"
              />

              <q-select
                v-model="memberFilter.competitor"
                :options="[
                  { label: 'All', value: 'all' },
                  { label: `Competitors (${competitorCounts.competitors})`, value: 'competitors' },
                  { label: `Non-comp (${competitorCounts.nonCompetitors})`, value: 'non-competitors' },
                ]"
                outlined
                dense
                emit-value
                map-options
                style="min-width: 150px"
              />
            </div>

            <q-input
              v-model="memberSearch"
              dense
              outlined
              placeholder="Search patents..."
              class="q-mb-md"
            >
              <template v-slot:append>
                <q-icon name="search" />
              </template>
            </q-input>

            <q-inner-loading :showing="loadingExploration" />

            <!-- Summary chips -->
            <div class="row q-gutter-sm q-mb-md" v-if="!loadingExploration">
              <q-chip dense icon="business" v-if="uniqueCompetitors.length > 0">
                {{ uniqueCompetitors.length }} competitors
                <q-tooltip>{{ uniqueCompetitors.join(', ') }}</q-tooltip>
              </q-chip>
              <q-chip dense icon="folder" color="primary" text-color="white">
                {{ portfolioCounts.inPortfolio }} in portfolio
              </q-chip>
              <q-chip dense icon="public" outline>
                {{ portfolioCounts.external }} external
              </q-chip>
              <q-chip
                v-if="iprCounts.checked > 0"
                dense
                icon="gavel"
                :color="iprCounts.hasIPR > 0 ? 'negative' : 'positive'"
                text-color="white"
              >
                {{ iprCounts.hasIPR }} with IPR ({{ iprCounts.checked }}/{{ iprCounts.total }} checked)
              </q-chip>
              <q-space />
              <q-btn
                flat
                dense
                icon="gavel"
                label="Enrich Litigation Data"
                :loading="enrichingLitigation"
                :disable="members.length === 0"
                @click="enrichLitigation"
              >
                <q-tooltip>Fetch IPR and prosecution history for all patents</q-tooltip>
              </q-btn>
            </div>

            <!-- Results table -->
            <q-table
              :rows="filteredMembers"
              :columns="tableColumns"
              row-key="patentId"
              v-model:pagination="pagination"
              v-model:selected="selectedMembers"
              :loading="loadingExploration"
              selection="multiple"
              flat
              bordered
              dense
              @row-click="onRowClick"
            >
              <template v-slot:body-cell-patentId="props">
                <q-td :props="props">
                  <router-link
                    :to="{ name: 'patent-detail', params: { id: props.row.patentId } }"
                    class="text-primary"
                    @click.stop
                  >
                    {{ props.row.patentId }}
                  </router-link>
                </q-td>
              </template>

              <template v-slot:body-cell-patentTitle="props">
                <q-td :props="props">
                  <div class="ellipsis" style="max-width: 300px">
                    {{ props.row.patentTitle }}
                    <q-tooltip v-if="props.row.patentTitle?.length > 40">
                      {{ props.row.patentTitle }}
                    </q-tooltip>
                  </div>
                </q-td>
              </template>

              <template v-slot:body-cell-inPortfolio="props">
                <q-td :props="props">
                  <q-icon
                    :name="props.row.inPortfolio ? 'check_circle' : 'public'"
                    :color="props.row.inPortfolio ? 'positive' : 'grey'"
                  />
                </q-td>
              </template>

              <template v-slot:body-cell-competitorMatch="props">
                <q-td :props="props">
                  <q-chip
                    v-if="props.row.competitorMatch"
                    dense
                    size="sm"
                    color="negative"
                    text-color="white"
                  >
                    {{ props.row.competitorMatch.company }}
                  </q-chip>
                  <span v-else class="text-grey-5">--</span>
                </q-td>
              </template>

              <template v-slot:body-cell-score="props">
                <q-td :props="props">
                  <q-badge
                    v-if="props.row.score"
                    :color="props.row.score > 100 ? 'positive' : props.row.score > 50 ? 'warning' : 'grey'"
                  >
                    {{ props.row.score?.toFixed(1) }}
                  </q-badge>
                  <span v-else class="text-grey-5">--</span>
                </q-td>
              </template>

              <template v-slot:body-cell-ipr="props">
                <q-td :props="props">
                  <template v-if="getLitigationIndicator(props.row.patentId)">
                    <q-badge
                      v-if="getLitigationIndicator(props.row.patentId)?.hasIPR"
                      color="negative"
                      text-color="white"
                    >
                      <q-icon name="gavel" size="12px" class="q-mr-xs" />
                      {{ getLitigationIndicator(props.row.patentId)?.iprCount }}
                      <q-tooltip>
                        {{ getLitigationIndicator(props.row.patentId)?.iprCount }} IPR proceeding(s)
                      </q-tooltip>
                    </q-badge>
                    <q-icon
                      v-else
                      name="check_circle_outline"
                      color="positive"
                      size="18px"
                    >
                      <q-tooltip>No IPR history found</q-tooltip>
                    </q-icon>
                  </template>
                  <span v-else-if="enrichingLitigation" class="text-grey-5">
                    <q-spinner size="14px" />
                  </span>
                  <span v-else class="text-grey-5">--</span>
                </q-td>
              </template>
            </q-table>
          </q-card-section>

          <!-- Selection Actions -->
          <q-card-section v-if="selectedMembers.length > 0" class="bg-grey-2">
            <div class="row items-center q-gutter-sm">
              <span class="text-body2">{{ selectedMembers.length }} selected</span>
              <q-btn flat dense label="Select All Portfolio" @click="selectAllPortfolio" />
              <q-btn flat dense label="Select Competitors" @click="selectAllCompetitors" />
              <q-btn flat dense label="Clear" @click="clearSelection" />
              <q-space />
              <q-btn
                color="primary"
                icon="folder_special"
                label="Create Focus Area"
                @click="openCreateFocusAreaDialog"
              />
            </div>
          </q-card-section>
        </q-card>

        <!-- Empty state -->
        <q-card v-else>
          <q-card-section class="text-center q-pa-xl">
            <q-icon name="account_tree" size="64px" color="grey-4" />
            <div class="text-h6 text-grey-6 q-mt-md">No exploration results</div>
            <div class="text-body2 text-grey-5">
              Enter seed patents and click "Explore Family" to find related patents
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Create Focus Area Dialog -->
    <q-dialog v-model="showCreateFocusAreaDialog" persistent>
      <q-card style="min-width: 450px">
        <q-card-section class="row items-center">
          <q-avatar icon="folder_special" color="primary" text-color="white" />
          <span class="q-ml-sm text-h6">Create Focus Area</span>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <div class="text-body2 text-grey-7 q-mb-md">
            Creating a focus area with {{ selectedMembers.length }} selected patents
            ({{ selectedMembers.filter(m => m.inPortfolio).length }} in portfolio,
            {{ selectedMembers.filter(m => !m.inPortfolio).length }} external).
          </div>

          <q-input
            v-model="newFocusAreaName"
            label="Focus Area Name *"
            outlined
            autofocus
            :rules="[val => !!val?.trim() || 'Name is required']"
            class="q-mb-md"
            placeholder="e.g., Authentication Patent Family"
          />

          <q-input
            v-model="newFocusAreaDescription"
            label="Description (optional)"
            outlined
            type="textarea"
            rows="2"
            placeholder="Brief description..."
            class="q-mb-md"
          />

          <q-checkbox
            v-model="includeExternalPatents"
            label="Include external (non-portfolio) patents"
          />
          <div class="text-caption text-grey-6 q-ml-lg">
            External patents provide context but may have limited data
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="primary"
            icon="add"
            label="Create Focus Area"
            :loading="creatingFocusArea"
            :disable="!newFocusAreaName.trim()"
            @click="createFocusArea"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
