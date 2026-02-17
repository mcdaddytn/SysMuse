import { ref, computed } from 'vue';
import type { GridColumnMeta, GridColumnGroup } from '@/types';

export interface UseGridColumnsOptions {
  storageKey: string;
  columns: GridColumnMeta[];
  groups: GridColumnGroup[];
}

export function useGridColumns(options: UseGridColumnsOptions) {
  const { storageKey, columns, groups } = options;

  const defaultVisible = new Set(
    columns.filter(c => c.defaultVisible).map(c => c.name)
  );

  function loadVisibility(): Set<string> {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore corrupt data */ }
    return new Set(defaultVisible);
  }

  const visibleColumns = ref<Set<string>>(loadVisibility());
  const showColumnDialog = ref(false);

  function saveVisibility() {
    localStorage.setItem(storageKey, JSON.stringify([...visibleColumns.value]));
  }

  function toggleColumn(name: string) {
    const s = new Set(visibleColumns.value);
    if (s.has(name)) s.delete(name);
    else s.add(name);
    visibleColumns.value = s;
    saveVisibility();
  }

  function toggleGroup(groupId: string) {
    const groupCols = columns.filter(c => c.group === groupId);
    const allVisible = groupCols.every(c => visibleColumns.value.has(c.name));
    const s = new Set(visibleColumns.value);
    for (const col of groupCols) {
      if (allVisible) s.delete(col.name);
      else s.add(col.name);
    }
    visibleColumns.value = s;
    saveVisibility();
  }

  function resetVisibility() {
    visibleColumns.value = new Set(defaultVisible);
    saveVisibility();
  }

  function groupCheckState(groupId: string): boolean | null {
    const groupCols = columns.filter(c => c.group === groupId);
    const visCount = groupCols.filter(c => visibleColumns.value.has(c.name)).length;
    if (visCount === groupCols.length) return true;
    if (visCount === 0) return false;
    return null;
  }

  function groupVisibleCount(groupId: string): string {
    const groupCols = columns.filter(c => c.group === groupId);
    const visCount = groupCols.filter(c => visibleColumns.value.has(c.name)).length;
    return `${visCount}/${groupCols.length}`;
  }

  function isVisible(name: string): boolean {
    return visibleColumns.value.has(name);
  }

  const visibleCount = computed(() => visibleColumns.value.size);

  return {
    visibleColumns,
    showColumnDialog,
    visibleCount,
    toggleColumn,
    toggleGroup,
    resetVisibility,
    groupCheckState,
    groupVisibleCount,
    isVisible,
    columns,
    groups,
  };
}
