<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { sectorApi } from '@/services/api';
import type { SuperSectorDetail, SectorDetail, SectorRule, SectorRuleType, RulePreviewResult } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const superSectors = ref<SuperSectorDetail[]>([]);
const selectedSectorId = ref<string | null>(null);
const selectedSector = ref<SectorDetail | null>(null);
const activeTab = ref('overview');
const loading = ref(false);
const treeLoading = ref(false);
const error = ref<string | null>(null);
const seedLoading = ref(false);
const recalcLoading = ref(false);

// Add Rule dialog
const showAddRule = ref(false);
const newRule = ref({
  ruleType: 'CPC_PREFIX' as SectorRuleType,
  expression: '',
  priority: 0,
  isExclusion: false,
  scope: 'LIBRARY' as string,
  description: '',
});

// Preview dialog
const showPreview = ref(false);
const previewLoading = ref(false);
const previewResult = ref<RulePreviewResult | null>(null);
const previewRule = ref({
  ruleType: 'CPC_PREFIX' as SectorRuleType,
  expression: '',
});

// Add Sector dialog
const showAddSector = ref(false);
const newSector = ref({
  name: '',
  displayName: '',
  description: '',
  superSectorId: '',
});

// Add Super-Sector dialog
const showAddSuperSector = ref(false);
const newSuperSector = ref({
  name: '',
  displayName: '',
  description: '',
});

// ─────────────────────────────────────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────────────────────────────────────

const treeNodes = computed(() => {
  return superSectors.value.map(ss => ({
    id: `ss-${ss.id}`,
    label: ss.displayName,
    icon: 'folder',
    selectable: false,
    children: ss.sectors.map(s => ({
      id: s.id,
      label: s.displayName,
      icon: 'label',
      badge: s.patentCount,
      ruleCount: s._count?.rules ?? 0,
    })),
  }));
});

const totalPatents = computed(() => {
  return superSectors.value.reduce(
    (sum, ss) => sum + ss.sectors.reduce((s2, s) => s2 + s.patentCount, 0),
    0
  );
});

const ruleTypeOptions = [
  { label: 'CPC Prefix', value: 'CPC_PREFIX' },
  { label: 'CPC Subgroup', value: 'CPC_SUBGROUP' },
  { label: 'Keyword', value: 'KEYWORD' },
  { label: 'Phrase', value: 'PHRASE' },
  { label: 'Keyword AND', value: 'KEYWORD_AND' },
  { label: 'Boolean', value: 'BOOLEAN' },
];

const scopeOptions = [
  { label: 'Library (all portfolios)', value: 'LIBRARY' },
  { label: 'Portfolio-specific', value: 'PORTFOLIO' },
];

const superSectorOptions = computed(() =>
  superSectors.value.map(ss => ({ label: ss.displayName, value: ss.id }))
);

const activeRules = computed(() =>
  selectedSector.value?.rules?.filter(r => r.isActive) || []
);

const inactiveRules = computed(() =>
  selectedSector.value?.rules?.filter(r => !r.isActive) || []
);

// ─────────────────────────────────────────────────────────────────────────────
// Data Loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadTree() {
  treeLoading.value = true;
  try {
    superSectors.value = await sectorApi.getSuperSectors();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load sectors';
  } finally {
    treeLoading.value = false;
  }
}

async function loadSectorDetail(id: string) {
  loading.value = true;
  error.value = null;
  try {
    selectedSector.value = await sectorApi.getSector(id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load sector';
  } finally {
    loading.value = false;
  }
}

function onNodeSelect(nodeId: string) {
  if (nodeId.startsWith('ss-')) return; // Don't select super-sectors
  selectedSectorId.value = nodeId;
  loadSectorDetail(nodeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

async function seedFromConfig() {
  seedLoading.value = true;
  try {
    const result = await sectorApi.seed();
    await loadTree();
    error.value = null;
    alert(`Seeded: ${result.superSectors} super-sectors, ${result.sectors} sectors, ${result.cpcRules} CPC rules, ${result.keywordRules} keyword rules`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Seed failed';
  } finally {
    seedLoading.value = false;
  }
}

async function recalculateCount() {
  if (!selectedSectorId.value) return;
  recalcLoading.value = true;
  try {
    const result = await sectorApi.recalculateSector(selectedSectorId.value);
    if (selectedSector.value) {
      selectedSector.value.patentCount = result.patentCount;
    }
    await loadTree();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Recalculate failed';
  } finally {
    recalcLoading.value = false;
  }
}

// Rule CRUD
async function addRule() {
  if (!selectedSectorId.value) return;
  try {
    await sectorApi.addRule(selectedSectorId.value, {
      ruleType: newRule.value.ruleType,
      expression: newRule.value.expression,
      priority: newRule.value.priority,
      isExclusion: newRule.value.isExclusion,
      scope: newRule.value.scope,
      description: newRule.value.description || undefined,
    });
    showAddRule.value = false;
    resetNewRule();
    await loadSectorDetail(selectedSectorId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add rule';
  }
}

function resetNewRule() {
  newRule.value = {
    ruleType: 'CPC_PREFIX',
    expression: '',
    priority: 0,
    isExclusion: false,
    scope: 'LIBRARY',
    description: '',
  };
}

async function toggleRuleActive(rule: SectorRule) {
  if (!selectedSectorId.value) return;
  try {
    await sectorApi.updateRule(selectedSectorId.value, rule.id, {
      isActive: !rule.isActive,
    });
    await loadSectorDetail(selectedSectorId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to toggle rule';
  }
}

async function deleteRule(rule: SectorRule) {
  if (!selectedSectorId.value) return;
  if (!confirm(`Delete rule "${rule.expression}"?`)) return;
  try {
    await sectorApi.deleteRule(selectedSectorId.value, rule.id);
    await loadSectorDetail(selectedSectorId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete rule';
  }
}

async function promoteRule(rule: SectorRule) {
  try {
    await sectorApi.promoteRule(rule.id);
    if (selectedSectorId.value) {
      await loadSectorDetail(selectedSectorId.value);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to promote rule';
  }
}

// Preview
async function doPreview() {
  if (!selectedSectorId.value) return;
  previewLoading.value = true;
  try {
    previewResult.value = await sectorApi.previewRule({
      ruleType: previewRule.value.ruleType,
      expression: previewRule.value.expression,
      sectorId: selectedSectorId.value,
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Preview failed';
  } finally {
    previewLoading.value = false;
  }
}

function openPreviewForRule(rule: SectorRule) {
  previewRule.value = {
    ruleType: rule.ruleType,
    expression: rule.expression,
  };
  previewResult.value = null;
  showPreview.value = true;
  doPreview();
}

function openPreviewNew() {
  previewRule.value = {
    ruleType: newRule.value.ruleType,
    expression: newRule.value.expression,
  };
  previewResult.value = null;
  showPreview.value = true;
  if (previewRule.value.expression) {
    doPreview();
  }
}

// Sector CRUD
async function addSector() {
  try {
    const created = await sectorApi.createSector({
      name: newSector.value.name,
      displayName: newSector.value.displayName,
      description: newSector.value.description || undefined,
      superSectorId: newSector.value.superSectorId || undefined,
    });
    showAddSector.value = false;
    newSector.value = { name: '', displayName: '', description: '', superSectorId: '' };
    await loadTree();
    selectedSectorId.value = created.id;
    await loadSectorDetail(created.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create sector';
  }
}

async function deleteSector() {
  if (!selectedSectorId.value || !selectedSector.value) return;
  if (!confirm(`Delete sector "${selectedSector.value.displayName}" and all its rules?`)) return;
  try {
    await sectorApi.deleteSector(selectedSectorId.value);
    selectedSectorId.value = null;
    selectedSector.value = null;
    await loadTree();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete sector';
  }
}

// Super-sector CRUD
async function addSuperSector() {
  try {
    await sectorApi.createSuperSector({
      name: newSuperSector.value.name,
      displayName: newSuperSector.value.displayName,
      description: newSuperSector.value.description || undefined,
    });
    showAddSuperSector.value = false;
    newSuperSector.value = { name: '', displayName: '', description: '' };
    await loadTree();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create super-sector';
  }
}

// Helpers
function ruleTypeLabel(type: string): string {
  return ruleTypeOptions.find(o => o.value === type)?.label || type;
}

function damagesColor(rating: number | null | undefined): string {
  switch (rating) {
    case 4: return 'red-7';
    case 3: return 'orange-7';
    case 2: return 'blue-7';
    case 1: return 'grey-6';
    default: return 'grey-4';
  }
}

function damagesLabel(rating: number | null | undefined): string {
  switch (rating) {
    case 4: return 'Very High';
    case 3: return 'High';
    case 2: return 'Medium';
    case 1: return 'Low';
    default: return 'N/A';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

onMounted(() => {
  loadTree();
});
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <div class="col">
        <div class="text-h5">Sector Management</div>
        <div class="text-caption text-grey-7">
          {{ superSectors.length }} super-sectors &middot;
          {{ superSectors.reduce((s, ss) => s + ss.sectors.length, 0) }} sectors &middot;
          {{ totalPatents.toLocaleString() }} patents
        </div>
      </div>
      <div class="col-auto q-gutter-sm">
        <q-btn
          outline
          color="primary"
          label="Seed from Config"
          icon="cloud_download"
          :loading="seedLoading"
          @click="seedFromConfig"
        />
      </div>
    </div>

    <!-- Error banner -->
    <q-banner v-if="error" class="bg-red-1 text-red-9 q-mb-md" rounded>
      {{ error }}
      <template #action>
        <q-btn flat label="Dismiss" @click="error = null" />
      </template>
    </q-banner>

    <!-- Main Layout: Tree + Detail -->
    <div class="row q-col-gutter-md" style="min-height: 600px">
      <!-- Left: Tree Navigation -->
      <div class="col-12 col-md-3">
        <q-card flat bordered>
          <q-card-section class="q-pb-none">
            <div class="text-subtitle2">Super-Sectors</div>
          </q-card-section>

          <q-card-section>
            <q-inner-loading :showing="treeLoading" />

            <q-list v-if="!treeLoading" dense separator>
              <template v-for="ss in superSectors" :key="ss.id">
                <q-expansion-item
                  :label="ss.displayName"
                  :caption="`${ss.sectors.length} sectors`"
                  icon="folder"
                  default-opened
                  dense
                  header-class="text-weight-medium"
                >
                  <q-item
                    v-for="sector in ss.sectors"
                    :key="sector.id"
                    clickable
                    v-ripple
                    :active="selectedSectorId === sector.id"
                    active-class="bg-blue-1"
                    class="q-pl-lg"
                    @click="onNodeSelect(sector.id)"
                  >
                    <q-item-section avatar>
                      <q-icon name="label" size="xs" />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label>{{ sector.displayName }}</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge
                        :label="sector.patentCount"
                        :color="sector.patentCount > 0 ? 'primary' : 'grey-4'"
                        :text-color="sector.patentCount > 0 ? 'white' : 'grey-7'"
                      />
                    </q-item-section>
                  </q-item>
                </q-expansion-item>
              </template>
            </q-list>
          </q-card-section>

          <q-separator />
          <q-card-actions>
            <q-btn flat dense size="sm" icon="add" label="Super-Sector" @click="showAddSuperSector = true" />
            <q-btn flat dense size="sm" icon="add" label="Sector" @click="showAddSector = true" />
          </q-card-actions>
        </q-card>
      </div>

      <!-- Right: Detail Panel -->
      <div class="col-12 col-md-9">
        <q-card v-if="!selectedSector" flat bordered class="text-center q-pa-xl">
          <q-icon name="category" size="64px" color="grey-4" />
          <div class="text-grey-6 q-mt-md">Select a sector to view details</div>
        </q-card>

        <q-card v-else flat bordered>
          <q-inner-loading :showing="loading" />

          <!-- Sector Header -->
          <q-card-section>
            <div class="row items-center">
              <div class="col">
                <div class="text-h6">{{ selectedSector.displayName }}</div>
                <div class="text-caption text-grey-7">
                  {{ selectedSector.name }}
                  <span v-if="selectedSector.superSector">
                    &middot; {{ selectedSector.superSector.displayName }}
                  </span>
                </div>
              </div>
              <div class="col-auto q-gutter-sm">
                <q-badge
                  :color="damagesColor(selectedSector.damagesRating)"
                  :label="damagesLabel(selectedSector.damagesRating)"
                />
                <q-badge color="primary" :label="`${selectedSector.patentCount} patents`" />
                <q-btn
                  flat
                  dense
                  icon="delete"
                  color="red"
                  size="sm"
                  @click="deleteSector"
                >
                  <q-tooltip>Delete sector</q-tooltip>
                </q-btn>
              </div>
            </div>
          </q-card-section>

          <q-separator />

          <!-- Tabs -->
          <q-tabs v-model="activeTab" dense align="left" class="bg-grey-1">
            <q-tab name="overview" label="Overview" icon="info" />
            <q-tab name="rules" label="Rules" icon="rule" :badge="selectedSector.rules?.length" />
            <q-tab name="patents" label="Patents" icon="description" />
          </q-tabs>

          <q-separator />

          <q-tab-panels v-model="activeTab" animated>
            <!-- Overview Tab -->
            <q-tab-panel name="overview">
              <div class="row q-col-gutter-md">
                <div class="col-12 col-sm-6">
                  <div class="text-subtitle2 q-mb-sm">Description</div>
                  <div class="text-body2">
                    {{ selectedSector.description || 'No description' }}
                  </div>
                </div>
                <div class="col-12 col-sm-6">
                  <div class="text-subtitle2 q-mb-sm">Metadata</div>
                  <q-list dense>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Damages Tier</q-item-label>
                        <q-item-label>{{ selectedSector.damagesTier || 'N/A' }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Damages Rating</q-item-label>
                        <q-item-label>{{ selectedSector.damagesRating ?? 'N/A' }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>CPC Prefixes</q-item-label>
                        <q-item-label>
                          <q-chip
                            v-for="cpc in selectedSector.cpcPrefixes"
                            :key="cpc"
                            dense
                            size="sm"
                            color="grey-3"
                          >{{ cpc }}</q-chip>
                          <span v-if="!selectedSector.cpcPrefixes.length" class="text-grey-6">None</span>
                        </q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Patent Count</q-item-label>
                        <q-item-label>{{ selectedSector.patentCount }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Rules</q-item-label>
                        <q-item-label>{{ selectedSector.rules?.length ?? 0 }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </div>
              </div>

              <!-- Facets -->
              <div v-if="selectedSector.facets && Object.keys(selectedSector.facets).length" class="q-mt-md">
                <div class="text-subtitle2 q-mb-sm">Scoring Facets</div>
                <div class="row q-col-gutter-sm">
                  <div
                    v-for="(val, key) in selectedSector.facets"
                    :key="key"
                    class="col-auto"
                  >
                    <q-chip dense>
                      {{ key }}: {{ val }}
                    </q-chip>
                  </div>
                </div>
              </div>
            </q-tab-panel>

            <!-- Rules Tab -->
            <q-tab-panel name="rules">
              <div class="row items-center q-mb-md">
                <div class="col text-subtitle2">
                  Active Rules ({{ activeRules.length }})
                </div>
                <div class="col-auto q-gutter-sm">
                  <q-btn
                    outline
                    size="sm"
                    icon="calculate"
                    label="Recalculate Count"
                    :loading="recalcLoading"
                    @click="recalculateCount"
                  />
                  <q-btn
                    color="primary"
                    size="sm"
                    icon="add"
                    label="Add Rule"
                    @click="showAddRule = true"
                  />
                </div>
              </div>

              <!-- Rules Table -->
              <q-table
                :rows="selectedSector.rules || []"
                :columns="[
                  { name: 'ruleType', label: 'Type', field: 'ruleType', align: 'left', sortable: true,
                    format: (v: string) => ruleTypeLabel(v) },
                  { name: 'expression', label: 'Expression', field: 'expression', align: 'left', sortable: true },
                  { name: 'priority', label: 'Priority', field: 'priority', align: 'center', sortable: true },
                  { name: 'scope', label: 'Scope', field: 'scope', align: 'center', sortable: true },
                  { name: 'matchCount', label: 'Matches', field: 'matchCount', align: 'center', sortable: true },
                  { name: 'isActive', label: 'Active', field: 'isActive', align: 'center' },
                  { name: 'actions', label: '', field: 'id', align: 'right' },
                ]"
                row-key="id"
                flat
                dense
                :pagination="{ rowsPerPage: 50 }"
                hide-bottom
              >
                <template #body-cell-expression="props">
                  <q-td :props="props">
                    <code class="text-body2">{{ props.row.expression }}</code>
                    <q-icon
                      v-if="props.row.isExclusion"
                      name="block"
                      color="red"
                      size="xs"
                      class="q-ml-xs"
                    >
                      <q-tooltip>Exclusion rule</q-tooltip>
                    </q-icon>
                  </q-td>
                </template>

                <template #body-cell-scope="props">
                  <q-td :props="props">
                    <q-badge
                      :color="props.row.scope === 'LIBRARY' ? 'blue-7' : 'orange-7'"
                      :label="props.row.scope"
                      dense
                    />
                  </q-td>
                </template>

                <template #body-cell-isActive="props">
                  <q-td :props="props">
                    <q-toggle
                      :model-value="props.row.isActive"
                      dense
                      @update:model-value="toggleRuleActive(props.row)"
                    />
                  </q-td>
                </template>

                <template #body-cell-actions="props">
                  <q-td :props="props">
                    <q-btn
                      flat
                      dense
                      round
                      size="sm"
                      icon="visibility"
                      @click="openPreviewForRule(props.row)"
                    >
                      <q-tooltip>Preview matches</q-tooltip>
                    </q-btn>
                    <q-btn
                      v-if="props.row.scope === 'PORTFOLIO'"
                      flat
                      dense
                      round
                      size="sm"
                      icon="publish"
                      color="green"
                      @click="promoteRule(props.row)"
                    >
                      <q-tooltip>Promote to Library</q-tooltip>
                    </q-btn>
                    <q-btn
                      flat
                      dense
                      round
                      size="sm"
                      icon="delete"
                      color="red"
                      @click="deleteRule(props.row)"
                    >
                      <q-tooltip>Delete rule</q-tooltip>
                    </q-btn>
                  </q-td>
                </template>
              </q-table>
            </q-tab-panel>

            <!-- Patents Tab -->
            <q-tab-panel name="patents">
              <div class="text-body2 text-grey-7">
                This sector contains <strong>{{ selectedSector.patentCount }}</strong> patents
                based on the current portfolio data.
              </div>
              <div class="q-mt-md">
                <q-btn
                  outline
                  size="sm"
                  icon="calculate"
                  label="Recalculate Patent Count"
                  :loading="recalcLoading"
                  @click="recalculateCount"
                />
              </div>
            </q-tab-panel>
          </q-tab-panels>
        </q-card>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- DIALOGS -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->

    <!-- Add Rule Dialog -->
    <q-dialog v-model="showAddRule" persistent>
      <q-card style="min-width: 500px">
        <q-card-section>
          <div class="text-h6">Add Rule</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-select
            v-model="newRule.ruleType"
            :options="ruleTypeOptions"
            label="Rule Type"
            emit-value
            map-options
            outlined
            dense
          />

          <q-input
            v-model="newRule.expression"
            label="Expression"
            outlined
            dense
            :hint="newRule.ruleType === 'CPC_PREFIX' ? 'e.g., H04N19/' : 'e.g., video codec'"
          />

          <q-input
            v-model.number="newRule.priority"
            label="Priority"
            type="number"
            outlined
            dense
            hint="Higher = evaluated first"
          />

          <q-select
            v-model="newRule.scope"
            :options="scopeOptions"
            label="Scope"
            emit-value
            map-options
            outlined
            dense
          />

          <q-toggle
            v-model="newRule.isExclusion"
            label="Exclusion rule (removes from sector)"
          />

          <q-input
            v-model="newRule.description"
            label="Description (optional)"
            outlined
            dense
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showAddRule = false" />
          <q-btn
            flat
            label="Preview"
            color="secondary"
            :disable="!newRule.expression"
            @click="openPreviewNew"
          />
          <q-btn
            label="Add Rule"
            color="primary"
            :disable="!newRule.expression"
            @click="addRule"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Preview Dialog -->
    <q-dialog v-model="showPreview">
      <q-card style="min-width: 450px">
        <q-card-section>
          <div class="text-h6">Rule Preview</div>
          <div class="text-caption text-grey-7">
            {{ ruleTypeLabel(previewRule.ruleType) }}: <code>{{ previewRule.expression }}</code>
          </div>
        </q-card-section>

        <q-card-section>
          <q-inner-loading :showing="previewLoading" />

          <div v-if="previewResult && !previewLoading">
            <q-list dense>
              <q-item>
                <q-item-section>
                  <q-item-label caption>Total Matches</q-item-label>
                  <q-item-label class="text-h6 text-primary">
                    {{ previewResult.matchCount }}
                  </q-item-label>
                </q-item-section>
              </q-item>
              <q-item>
                <q-item-section>
                  <q-item-label caption>Already in Sector</q-item-label>
                  <q-item-label>{{ previewResult.overlapWithCurrentSector }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-item>
                <q-item-section>
                  <q-item-label caption>New to Sector</q-item-label>
                  <q-item-label class="text-positive">
                    {{ previewResult.newToSector }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>

            <div v-if="previewResult.samplePatentIds.length" class="q-mt-md">
              <div class="text-caption text-grey-7 q-mb-xs">
                Sample Patent IDs (up to 20):
              </div>
              <div class="text-body2" style="font-family: monospace; font-size: 0.8rem">
                {{ previewResult.samplePatentIds.join(', ') }}
              </div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Close" @click="showPreview = false" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Sector Dialog -->
    <q-dialog v-model="showAddSector" persistent>
      <q-card style="min-width: 450px">
        <q-card-section>
          <div class="text-h6">Add Sector</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-input
            v-model="newSector.name"
            label="Key (e.g., video-codec)"
            outlined
            dense
          />
          <q-input
            v-model="newSector.displayName"
            label="Display Name"
            outlined
            dense
          />
          <q-input
            v-model="newSector.description"
            label="Description"
            outlined
            dense
          />
          <q-select
            v-model="newSector.superSectorId"
            :options="superSectorOptions"
            label="Super-Sector"
            emit-value
            map-options
            outlined
            dense
            clearable
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showAddSector = false" />
          <q-btn
            label="Create"
            color="primary"
            :disable="!newSector.name || !newSector.displayName"
            @click="addSector"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Super-Sector Dialog -->
    <q-dialog v-model="showAddSuperSector" persistent>
      <q-card style="min-width: 450px">
        <q-card-section>
          <div class="text-h6">Add Super-Sector</div>
        </q-card-section>

        <q-card-section class="q-gutter-md">
          <q-input
            v-model="newSuperSector.name"
            label="Key (e.g., SECURITY)"
            outlined
            dense
          />
          <q-input
            v-model="newSuperSector.displayName"
            label="Display Name"
            outlined
            dense
          />
          <q-input
            v-model="newSuperSector.description"
            label="Description"
            outlined
            dense
          />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showAddSuperSector = false" />
          <q-btn
            label="Create"
            color="primary"
            :disable="!newSuperSector.name || !newSuperSector.displayName"
            @click="addSuperSector"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
code {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.85em;
}
</style>
