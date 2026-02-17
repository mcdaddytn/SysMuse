<script setup lang="ts">
import { ref, computed } from 'vue';
import type { GridColumnMeta, GridColumnGroup } from '@/types';

const props = defineProps<{
  modelValue: boolean;
  columns: GridColumnMeta[];
  groups: GridColumnGroup[];
  visibleColumns: Set<string>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'toggle-column': [name: string];
  'toggle-group': [groupId: string];
  'reset': [];
}>();

// Track expanded state of each group
const expandedGroups = ref<Record<string, boolean>>(
  props.groups.reduce((acc, group) => {
    acc[group.id] = group.defaultExpanded ?? true;
    return acc;
  }, {} as Record<string, boolean>)
);

// Search filter
const searchFilter = ref('');

// Filtered groups based on search
const filteredGroups = computed(() => {
  if (!searchFilter.value.trim()) return props.groups;

  const search = searchFilter.value.toLowerCase();
  return props.groups.filter(group => {
    if (group.label.toLowerCase().includes(search)) return true;
    const groupCols = props.columns.filter(c => c.group === group.id);
    return groupCols.some(col =>
      col.label.toLowerCase().includes(search) ||
      col.description?.toLowerCase().includes(search)
    );
  });
});

function getGroupColumns(groupId: string) {
  const cols = props.columns.filter(c => c.group === groupId);
  if (!searchFilter.value.trim()) return cols;

  const search = searchFilter.value.toLowerCase();
  return cols.filter(col =>
    col.label.toLowerCase().includes(search) ||
    col.description?.toLowerCase().includes(search)
  );
}

function getGroupVisibleCount(groupId: string): string {
  const groupCols = props.columns.filter(c => c.group === groupId);
  const visCount = groupCols.filter(c => props.visibleColumns.has(c.name)).length;
  return `${visCount}/${groupCols.length}`;
}

function getGroupCheckboxState(groupId: string): boolean | null {
  const groupCols = props.columns.filter(c => c.group === groupId);
  const visCount = groupCols.filter(c => props.visibleColumns.has(c.name)).length;
  if (visCount === groupCols.length) return true;
  if (visCount === 0) return false;
  return null;
}

function toggleGroupExpansion(groupId: string) {
  expandedGroups.value[groupId] = !expandedGroups.value[groupId];
}

const totalVisibleCount = computed(() => props.visibleColumns.size);
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
            @click="emit('reset')"
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
                  @update:model-value="emit('toggle-group', group.id)"
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
                    v-for="column in getGroupColumns(group.id)"
                    :key="column.name"
                    tag="label"
                    clickable
                    class="rounded-borders"
                  >
                    <q-item-section avatar>
                      <q-checkbox
                        :model-value="visibleColumns.has(column.name)"
                        @update:model-value="emit('toggle-column', column.name)"
                        size="sm"
                      />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label>{{ column.label }}</q-item-label>
                      <q-item-label v-if="column.description" caption class="text-grey-6">
                        {{ column.description }}
                      </q-item-label>
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
