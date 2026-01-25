<script setup lang="ts">
import { ref, computed } from 'vue';
import { usePatentsStore } from '@/stores/patents';
import type { ColumnGroup } from '@/types';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const patentsStore = usePatentsStore();

// Track expanded state of each group
const expandedGroups = ref<Record<ColumnGroup, boolean>>(
  patentsStore.columnGroups.reduce((acc, group) => {
    acc[group.id] = group.defaultExpanded;
    return acc;
  }, {} as Record<ColumnGroup, boolean>)
);

// Search filter for columns
const searchFilter = ref('');

// Computed: filtered groups based on search
const filteredGroups = computed(() => {
  if (!searchFilter.value.trim()) {
    return patentsStore.columnGroups;
  }

  const search = searchFilter.value.toLowerCase();
  return patentsStore.columnGroups.filter(group => {
    // Check if group name matches
    if (group.label.toLowerCase().includes(search)) return true;
    // Check if any column in group matches
    const groupCols = patentsStore.getColumnsByGroup(group.id);
    return groupCols.some(col =>
      col.label.toLowerCase().includes(search) ||
      col.description?.toLowerCase().includes(search)
    );
  });
});

// Get visible column count for a group
function getGroupVisibleCount(groupId: ColumnGroup): string {
  const groupCols = patentsStore.getColumnsByGroup(groupId);
  const visibleCount = groupCols.filter(col => col.visible).length;
  return `${visibleCount}/${groupCols.length}`;
}

// Get checkbox state for group header
function getGroupCheckboxState(groupId: ColumnGroup): boolean | null {
  if (patentsStore.isGroupFullyVisible(groupId)) return true;
  if (patentsStore.isGroupPartiallyVisible(groupId)) return null;
  return false;
}

// Toggle group expansion
function toggleGroupExpansion(groupId: ColumnGroup) {
  expandedGroups.value[groupId] = !expandedGroups.value[groupId];
}

// Toggle all columns in a group
function toggleGroup(groupId: ColumnGroup) {
  const isFullyVisible = patentsStore.isGroupFullyVisible(groupId);
  patentsStore.toggleGroupColumns(groupId, !isFullyVisible);
}

// Filter columns for display (apply search filter)
function getFilteredColumns(groupId: ColumnGroup) {
  const cols = patentsStore.getColumnsByGroup(groupId);
  if (!searchFilter.value.trim()) return cols;

  const search = searchFilter.value.toLowerCase();
  return cols.filter(col =>
    col.label.toLowerCase().includes(search) ||
    col.description?.toLowerCase().includes(search)
  );
}

// Count total visible columns
const totalVisibleCount = computed(() =>
  patentsStore.columns.filter(c => c.visible).length
);

// Close dialog
function close() {
  emit('update:modelValue', false);
}
</script>

<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <q-card style="width: 450px; max-width: 90vw; max-height: 80vh;">
      <!-- Header -->
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">Column Visibility</div>
        <q-badge color="primary" class="q-ml-sm">
          {{ totalVisibleCount }} shown
        </q-badge>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <!-- Search and Reset -->
      <q-card-section class="q-pt-sm q-pb-none">
        <div class="row q-gutter-sm items-center">
          <q-input
            v-model="searchFilter"
            dense
            outlined
            placeholder="Search columns..."
            class="col"
            clearable
          >
            <template v-slot:prepend>
              <q-icon name="search" size="sm" />
            </template>
          </q-input>
          <q-btn
            flat
            dense
            color="secondary"
            label="Reset"
            icon="restart_alt"
            @click="patentsStore.resetColumnsToDefault()"
          />
        </div>
      </q-card-section>

      <!-- Column Groups -->
      <q-card-section class="q-pt-sm" style="max-height: 50vh; overflow-y: auto;">
        <q-list>
          <template v-for="group in filteredGroups" :key="group.id">
            <!-- Group Header -->
            <q-item
              clickable
              @click="toggleGroupExpansion(group.id)"
              class="rounded-borders q-mb-xs"
              :class="expandedGroups[group.id] ? 'bg-grey-2' : ''"
            >
              <q-item-section avatar>
                <q-checkbox
                  :model-value="getGroupCheckboxState(group.id)"
                  :indeterminate-value="null"
                  @update:model-value="toggleGroup(group.id)"
                  @click.stop
                />
              </q-item-section>
              <q-item-section avatar>
                <q-icon :name="group.icon" color="primary" />
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-medium">{{ group.label }}</q-item-label>
                <q-item-label v-if="group.description" caption>{{ group.description }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <div class="row items-center q-gutter-xs">
                  <q-badge color="grey-6" outline>
                    {{ getGroupVisibleCount(group.id) }}
                  </q-badge>
                  <q-icon
                    :name="expandedGroups[group.id] ? 'expand_less' : 'expand_more'"
                    size="sm"
                  />
                </div>
              </q-item-section>
            </q-item>

            <!-- Group Columns (expandable) -->
            <q-slide-transition>
              <div v-show="expandedGroups[group.id]">
                <q-list dense class="q-pl-lg q-mb-sm">
                  <q-item
                    v-for="column in getFilteredColumns(group.id)"
                    :key="column.name"
                    tag="label"
                    clickable
                    class="rounded-borders"
                  >
                    <q-item-section avatar>
                      <q-checkbox
                        :model-value="column.visible"
                        @update:model-value="patentsStore.toggleColumn(column.name)"
                        size="sm"
                      />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label>{{ column.label }}</q-item-label>
                      <q-item-label v-if="column.description" caption class="text-grey-6">
                        {{ column.description }}
                      </q-item-label>
                    </q-item-section>
                    <q-item-section side v-if="column.sortable">
                      <q-icon name="sort" size="xs" color="grey-5" />
                    </q-item-section>
                  </q-item>
                </q-list>
              </div>
            </q-slide-transition>
          </template>
        </q-list>
      </q-card-section>

      <!-- Footer -->
      <q-card-actions align="right" class="q-pt-none">
        <q-btn flat label="Done" color="primary" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.q-item--clickable:hover {
  background-color: rgba(0, 0, 0, 0.03);
}
</style>
