<script setup lang="ts">
import { computed } from 'vue';
import { usePatentsStore } from '@/stores/patents';
import GenericColumnSelector from './GenericColumnSelector.vue';
import type { GridColumnMeta, GridColumnGroup } from '@/types';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const patentsStore = usePatentsStore();

// Adapt patents store columns to GridColumnMeta format
const columnMeta = computed<GridColumnMeta[]>(() =>
  patentsStore.columns.map(col => ({
    name: col.name,
    label: col.label,
    group: col.group,
    defaultVisible: true,
    description: col.description,
  }))
);

// Adapt patents store groups to GridColumnGroup format
const columnGroups = computed<GridColumnGroup[]>(() =>
  patentsStore.columnGroups.map(g => ({
    id: g.id,
    label: g.label,
    icon: g.icon,
    description: g.description,
    defaultExpanded: g.defaultExpanded,
  }))
);

// Build a Set of currently visible column names from the store
const visibleColumns = computed(() =>
  new Set(patentsStore.columns.filter(c => c.visible).map(c => c.name))
);

// Delegate toggle actions back to the patents store
function onToggleColumn(name: string) {
  patentsStore.toggleColumn(name);
}

function onToggleGroup(groupId: string) {
  const isFullyVisible = patentsStore.isGroupFullyVisible(groupId);
  patentsStore.toggleGroupColumns(groupId, !isFullyVisible);
}

function onReset() {
  patentsStore.resetColumnsToDefault();
}
</script>

<template>
  <GenericColumnSelector
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    :columns="columnMeta"
    :groups="columnGroups"
    :visible-columns="visibleColumns"
    @toggle-column="onToggleColumn"
    @toggle-group="onToggleGroup"
    @reset="onReset"
  />
</template>
