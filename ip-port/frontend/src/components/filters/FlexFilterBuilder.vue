<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';

// Props
const props = defineProps<{
  modelValue: Record<string, unknown>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>];
}>();

// Filter field definitions
interface FilterField {
  key: string;
  label: string;
  type: 'multiselect' | 'range' | 'boolean';
  optionsKey?: string;  // Key in filterOptions for multiselect
  icon?: string;
  color?: string;
}

const availableFilters: FilterField[] = [
  // Multiselect filters
  { key: 'affiliates', label: 'Affiliate', type: 'multiselect', optionsKey: 'affiliates', icon: 'business', color: 'primary' },
  { key: 'superSectors', label: 'Super-Sector', type: 'multiselect', optionsKey: 'superSectors', icon: 'category', color: 'purple' },
  { key: 'primarySectors', label: 'Primary Sector', type: 'multiselect', optionsKey: 'primarySectors', icon: 'label', color: 'deep-purple' },
  { key: 'competitorNames', label: 'Competitor Names', type: 'multiselect', optionsKey: 'competitorNames', icon: 'groups', color: 'orange' },
  { key: 'cpcCodes', label: 'CPC Codes', type: 'multiselect', optionsKey: 'cpcCodes', icon: 'code', color: 'teal' },
  { key: 'subSectors', label: 'Sub-Sector', type: 'multiselect', optionsKey: 'subSectors', icon: 'subdirectory_arrow_right', color: 'indigo' },
  // Range filters - scores
  { key: 'score', label: 'Base Score', type: 'range', icon: 'trending_up', color: 'green' },
  { key: 'v2Score', label: 'V2 Score', type: 'range', icon: 'analytics', color: 'light-green' },
  { key: 'v3Score', label: 'V3 Score', type: 'range', icon: 'insights', color: 'lime' },
  // Range filters - time
  { key: 'years', label: 'Years Remaining', type: 'range', icon: 'schedule', color: 'teal' },
  // Range filters - citations
  { key: 'forwardCites', label: 'Forward Citations', type: 'range', icon: 'arrow_forward', color: 'blue' },
  { key: 'competitorCites', label: 'Competitor Citations', type: 'range', icon: 'warning', color: 'orange' },
  { key: 'affiliateCites', label: 'Affiliate Citations', type: 'range', icon: 'business', color: 'primary' },
  { key: 'neutralCites', label: 'Neutral Citations', type: 'range', icon: 'remove_circle_outline', color: 'grey' },
  // Boolean filters
  { key: 'hasLlmData', label: 'Has LLM Data', type: 'boolean', icon: 'psychology', color: 'amber' },
  { key: 'isExpired', label: 'Is Expired', type: 'boolean', icon: 'event_busy', color: 'red' },
];

// Active filters (keys that user has added)
const activeFilterKeys = ref<string[]>([]);

// Flag to prevent watcher from overwriting during local updates
const isUpdatingLocally = ref(false);

// Filter options from API
interface FilterOptions {
  affiliates: Array<{ name: string; count: number }>;
  superSectors: Array<{ name: string; count: number }>;
  primarySectors: Array<{ name: string; count: number }>;
  competitorNames: Array<{ name: string; count: number }>;
  cpcCodes: Array<{ code: string; count: number; description?: string | null }>;
  subSectors: Array<{ name: string; count: number; sector?: string }>;
  ranges: {
    score: { min: number; max: number };
    years: { min: number; max: number };
  };
  counts: {
    total: number;
    withLlmData: number;
    withCompetitors: number;
    expired: number;
  };
}

const filterOptions = ref<FilterOptions | null>(null);
const loadingOptions = ref(false);

// Local filter values
const localFilters = ref<Record<string, unknown>>({});

// Computed: filters not yet active
const unusedFilters = computed(() =>
  availableFilters.filter(f => !activeFilterKeys.value.includes(f.key))
);

// Get filter definition by key
function getFilterDef(key: string): FilterField | undefined {
  return availableFilters.find(f => f.key === key);
}

// Load filter options from API
async function loadFilterOptions() {
  loadingOptions.value = true;
  try {
    const res = await fetch('/api/patents/filter-options');
    if (res.ok) {
      filterOptions.value = await res.json();
    }
  } catch (err) {
    console.error('Failed to load filter options:', err);
  } finally {
    loadingOptions.value = false;
  }
}

// Add a filter
function addFilter(key: string) {
  if (!activeFilterKeys.value.includes(key)) {
    activeFilterKeys.value = [...activeFilterKeys.value, key];
    // Initialize with default value based on type
    const def = getFilterDef(key);
    if (def?.type === 'multiselect') {
      localFilters.value[key] = [];
    } else if (def?.type === 'range') {
      localFilters.value[`${key}Min`] = null;
      localFilters.value[`${key}Max`] = null;
    } else if (def?.type === 'boolean') {
      localFilters.value[key] = null; // null = any, true = yes, false = no
    }
  }
}

// Remove a filter
function removeFilter(key: string) {
  isUpdatingLocally.value = true;

  // Remove from active keys
  activeFilterKeys.value = activeFilterKeys.value.filter(k => k !== key);

  // Remove from local filters
  const def = getFilterDef(key);
  if (def?.type === 'range') {
    delete localFilters.value[`${key}Min`];
    delete localFilters.value[`${key}Max`];
  } else {
    delete localFilters.value[key];
  }

  // Emit updated filters
  emitFilters();

  // Reset flag after next tick
  nextTick(() => {
    isUpdatingLocally.value = false;
  });
}

// Emit filters when they change
function emitFilters() {
  isUpdatingLocally.value = true;

  const filters: Record<string, unknown> = {};

  for (const key of activeFilterKeys.value) {
    const def = getFilterDef(key);
    if (!def) continue;

    if (def.type === 'multiselect') {
      const val = localFilters.value[key] as string[] | undefined;
      if (val && val.length > 0) {
        filters[key] = val;
      }
    } else if (def.type === 'range') {
      const min = localFilters.value[`${key}Min`];
      const max = localFilters.value[`${key}Max`];
      if (min != null) filters[`${key}Min`] = min;
      if (max != null) filters[`${key}Max`] = max;
    } else if (def.type === 'boolean') {
      const val = localFilters.value[key];
      if (val === true) filters[key] = 'true';
      else if (val === false) filters[key] = 'false';
    }
  }

  emit('update:modelValue', filters);

  // Reset flag after next tick
  nextTick(() => {
    isUpdatingLocally.value = false;
  });
}

// Get options for a multiselect filter
function getOptions(optionsKey: string): Array<{ label: string; value: string; count?: number; description?: string | null }> {
  if (!filterOptions.value) return [];

  switch (optionsKey) {
    case 'affiliates':
      return (filterOptions.value.affiliates || []).map(o => ({ label: o.name, value: o.name, count: o.count }));
    case 'superSectors':
      return (filterOptions.value.superSectors || []).map(o => ({ label: o.name, value: o.name, count: o.count }));
    case 'primarySectors':
      return (filterOptions.value.primarySectors || []).map(o => ({ label: o.name, value: o.name, count: o.count }));
    case 'competitorNames':
      return (filterOptions.value.competitorNames || []).map(o => ({ label: o.name, value: o.name, count: o.count }));
    case 'cpcCodes':
      return (filterOptions.value.cpcCodes || []).map(o => ({
        label: o.description ? `${o.code} - ${o.description}` : o.code,
        value: o.code,
        count: o.count,
        description: o.description
      }));
    case 'subSectors':
      return (filterOptions.value.subSectors || []).map(o => ({
        label: o.sector ? `${o.name} (${o.sector})` : o.name,
        value: o.name,
        count: o.count
      }));
    default:
      return [];
  }
}

// Initialize from modelValue - only run when not updating locally
watch(() => props.modelValue, (newVal) => {
  // Skip if we're updating locally to prevent feedback loops
  if (isUpdatingLocally.value) return;
  if (!newVal) return;

  // Extract active filter keys from the model
  const keys = new Set<string>();
  for (const k of Object.keys(newVal)) {
    // Handle range filters
    if (k.endsWith('Min') || k.endsWith('Max')) {
      const baseKey = k.replace(/Min$|Max$/, '');
      if (availableFilters.some(f => f.key === baseKey && f.type === 'range')) {
        keys.add(baseKey);
      }
    } else if (k !== 'scoreField' && k !== 'search') {
      if (availableFilters.some(f => f.key === k)) {
        keys.add(k);
      }
    }
  }

  activeFilterKeys.value = Array.from(keys);

  // Set local filter values
  for (const key of activeFilterKeys.value) {
    const def = getFilterDef(key);
    if (!def) continue;

    if (def.type === 'multiselect') {
      localFilters.value[key] = newVal[key] || [];
    } else if (def.type === 'range') {
      localFilters.value[`${key}Min`] = newVal[`${key}Min`] ?? null;
      localFilters.value[`${key}Max`] = newVal[`${key}Max`] ?? null;
    } else if (def.type === 'boolean') {
      const val = newVal[key];
      if (val === 'true') localFilters.value[key] = true;
      else if (val === 'false') localFilters.value[key] = false;
      else localFilters.value[key] = null;
    }
  }
}, { immediate: true, deep: true });

// Clear all filters
function clearAll() {
  isUpdatingLocally.value = true;
  activeFilterKeys.value = [];
  localFilters.value = {};
  emit('update:modelValue', {});
  nextTick(() => {
    isUpdatingLocally.value = false;
  });
}

// Super-sector colors
const sectorColors: Record<string, string> = {
  'Security': 'red-7',
  'Virtualization & Cloud': 'purple-7',
  'SDN & Network Infrastructure': 'blue-7',
  'Wireless & RF': 'teal-7',
  'Video & Streaming': 'orange-7',
  'Computing & Data': 'grey-7',
  'Semiconductor': 'indigo-7',
  'Imaging & Optics': 'cyan-7',
  'Audio': 'pink-7',
  'AI & Machine Learning': 'green-7',
  'Fault Tolerance & Reliability': 'amber-7'
};

function getSectorColor(sector: string): string {
  return sectorColors[sector] || 'grey-6';
}

// Lifecycle
onMounted(() => {
  loadFilterOptions();
});
</script>

<template>
  <div class="flex-filter-builder">
    <!-- Active Filters Row -->
    <div class="row q-gutter-md items-start flex-wrap">
      <!-- Render each active filter -->
      <template v-for="key in activeFilterKeys" :key="key">
        <div class="filter-chip">
          <template v-if="getFilterDef(key)?.type === 'multiselect'">
            <q-select
              v-model="localFilters[key]"
              :options="getOptions(getFilterDef(key)!.optionsKey!)"
              :label="getFilterDef(key)?.label"
              option-value="value"
              option-label="label"
              emit-value
              map-options
              multiple
              use-chips
              dense
              outlined
              :loading="loadingOptions"
              style="min-width: 200px"
              @update:model-value="emitFilters"
            >
              <template v-slot:prepend>
                <q-icon :name="getFilterDef(key)?.icon || 'filter_list'" :color="getFilterDef(key)?.color" size="xs" />
              </template>
              <template v-slot:option="{ itemProps, opt }">
                <q-item v-bind="itemProps">
                  <q-item-section v-if="key === 'superSectors'" avatar>
                    <q-badge :color="getSectorColor(opt.value)" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>{{ opt.label }}</q-item-label>
                    <q-item-label v-if="opt.description" caption class="text-grey-6">
                      {{ opt.description }}
                    </q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <q-badge color="grey-6">{{ opt.count?.toLocaleString() }}</q-badge>
                  </q-item-section>
                </q-item>
              </template>
              <template v-slot:after>
                <q-btn
                  icon="close"
                  flat
                  round
                  dense
                  size="sm"
                  color="grey"
                  @click.stop.prevent="removeFilter(key)"
                >
                  <q-tooltip>Remove filter</q-tooltip>
                </q-btn>
              </template>
            </q-select>
          </template>

          <template v-else-if="getFilterDef(key)?.type === 'range'">
            <div class="row items-center q-gutter-xs no-wrap range-filter-group">
              <q-icon :name="getFilterDef(key)?.icon || 'linear_scale'" :color="getFilterDef(key)?.color" size="xs" class="q-mr-xs" />
              <span class="text-caption text-grey-7">{{ getFilterDef(key)?.label }}:</span>
              <q-input
                v-model.number="localFilters[`${key}Min`]"
                type="number"
                dense
                outlined
                placeholder="min"
                style="width: 70px"
                @update:model-value="emitFilters"
              />
              <span class="text-grey-5">-</span>
              <q-input
                v-model.number="localFilters[`${key}Max`]"
                type="number"
                dense
                outlined
                placeholder="max"
                style="width: 70px"
                @update:model-value="emitFilters"
              />
              <q-btn
                icon="close"
                flat
                round
                dense
                size="sm"
                color="grey"
                @click.stop.prevent="removeFilter(key)"
              >
                <q-tooltip>Remove filter</q-tooltip>
              </q-btn>
            </div>
          </template>

          <template v-else-if="getFilterDef(key)?.type === 'boolean'">
            <div class="row items-center q-gutter-xs no-wrap boolean-filter-group">
              <q-icon :name="getFilterDef(key)?.icon || 'check'" :color="getFilterDef(key)?.color" size="xs" />
              <span class="text-caption text-grey-7">{{ getFilterDef(key)?.label }}:</span>
              <q-btn-toggle
                v-model="localFilters[key]"
                toggle-color="primary"
                dense
                no-caps
                rounded
                :options="[
                  { value: null, label: 'Any' },
                  { value: true, label: 'Yes' },
                  { value: false, label: 'No' }
                ]"
                @update:model-value="emitFilters"
              />
              <q-btn
                icon="close"
                flat
                round
                dense
                size="sm"
                color="grey"
                @click.stop.prevent="removeFilter(key)"
              >
                <q-tooltip>Remove filter</q-tooltip>
              </q-btn>
            </div>
          </template>
        </div>
      </template>

      <!-- Add Filter Button -->
      <q-btn-dropdown
        v-if="unusedFilters.length > 0"
        flat
        dense
        icon="add"
        label="Add Filter"
        color="primary"
        :loading="loadingOptions"
      >
        <q-list>
          <q-item-label header>Multiselect Filters</q-item-label>
          <q-item
            v-for="filter in unusedFilters.filter(f => f.type === 'multiselect')"
            :key="filter.key"
            clickable
            v-close-popup
            @click="addFilter(filter.key)"
          >
            <q-item-section avatar>
              <q-icon :name="filter.icon || 'filter_list'" :color="filter.color" />
            </q-item-section>
            <q-item-section>{{ filter.label }}</q-item-section>
          </q-item>

          <q-separator />
          <q-item-label header>Range Filters</q-item-label>
          <q-item
            v-for="filter in unusedFilters.filter(f => f.type === 'range')"
            :key="filter.key"
            clickable
            v-close-popup
            @click="addFilter(filter.key)"
          >
            <q-item-section avatar>
              <q-icon :name="filter.icon || 'linear_scale'" :color="filter.color" />
            </q-item-section>
            <q-item-section>{{ filter.label }}</q-item-section>
          </q-item>

          <q-separator />
          <q-item-label header>Boolean Filters</q-item-label>
          <q-item
            v-for="filter in unusedFilters.filter(f => f.type === 'boolean')"
            :key="filter.key"
            clickable
            v-close-popup
            @click="addFilter(filter.key)"
          >
            <q-item-section avatar>
              <q-icon :name="filter.icon || 'toggle_on'" :color="filter.color" />
            </q-item-section>
            <q-item-section>{{ filter.label }}</q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>

      <q-space />

      <!-- Clear All -->
      <q-btn
        v-if="activeFilterKeys.length > 0"
        flat
        dense
        color="negative"
        icon="clear_all"
        label="Clear All"
        @click.stop.prevent="clearAll"
      />
    </div>

    <!-- Summary counts -->
    <div v-if="filterOptions" class="q-mt-sm text-caption text-grey-6">
      {{ filterOptions.counts.total.toLocaleString() }} total
      &middot; {{ filterOptions.counts.withLlmData.toLocaleString() }} with LLM data
      &middot; {{ filterOptions.counts.expired?.toLocaleString() || 0 }} expired
    </div>
  </div>
</template>

<style scoped>
.flex-filter-builder {
  padding: 8px 0;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
}

.range-filter-group,
.boolean-filter-group {
  background: #f8f9fa;
  border-radius: 4px;
  padding: 4px 8px;
}
</style>
