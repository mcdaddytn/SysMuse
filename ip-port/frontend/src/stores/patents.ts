import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Patent, PortfolioFilters, PaginationParams, GridColumn } from '@/types';
import { patentApi } from '@/services/api';

export const usePatentsStore = defineStore('patents', () => {
  // State
  const patents = ref<Patent[]>([]);
  const totalCount = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const pagination = ref<PaginationParams>({
    page: 1,
    rowsPerPage: 50,
    sortBy: 'score',
    descending: true
  });

  const filters = ref<PortfolioFilters>({});

  // Available columns with visibility settings
  // Per design: Affiliate and Super-Sector visible by default, Assignee hidden
  const columns = ref<GridColumn[]>([
    { name: 'patent_id', label: 'Patent ID', field: 'patent_id', sortable: true, align: 'left', visible: true },
    { name: 'patent_title', label: 'Title', field: 'patent_title', sortable: true, align: 'left', visible: true },
    { name: 'patent_date', label: 'Grant Date', field: 'patent_date', sortable: true, align: 'center', visible: true },
    { name: 'remaining_years', label: 'Years Left', field: 'remaining_years', sortable: true, align: 'center', visible: true,
      format: (val: unknown) => typeof val === 'number' ? val.toFixed(1) : String(val) },
    { name: 'affiliate', label: 'Affiliate', field: 'affiliate', sortable: true, align: 'left', visible: true },
    { name: 'super_sector', label: 'Super-Sector', field: 'super_sector', sortable: true, align: 'left', visible: true },
    { name: 'forward_citations', label: 'Fwd Citations', field: 'forward_citations', sortable: true, align: 'center', visible: true },
    { name: 'score', label: 'Score', field: 'score', sortable: true, align: 'center', visible: true,
      format: (val: unknown) => typeof val === 'number' ? val.toFixed(1) : String(val) },
    // Hidden by default
    { name: 'assignee', label: 'Assignee (Raw)', field: 'assignee', sortable: true, align: 'left', visible: false },
    { name: 'primary_sector', label: 'Primary Sector', field: 'primary_sector', sortable: true, align: 'left', visible: false },
    { name: 'competitor_citations', label: 'Competitor Cites', field: 'competitor_citations', sortable: true, align: 'center', visible: false },
    { name: 'v2_score', label: 'v2 Score', field: 'v2_score', sortable: true, align: 'center', visible: false },
    { name: 'v3_score', label: 'v3 Score', field: 'v3_score', sortable: true, align: 'center', visible: false }
  ]);

  // Getters
  const visibleColumns = computed(() =>
    columns.value.filter(c => c.visible)
  );

  const hasFilters = computed(() =>
    Object.values(filters.value).some(v =>
      v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : true)
    )
  );

  // Actions
  async function loadPatents() {
    loading.value = true;
    error.value = null;

    try {
      const response = await patentApi.getPatents(pagination.value, filters.value);
      patents.value = response.data;
      totalCount.value = response.total;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load patents';
      console.error('Failed to load patents:', err);
    } finally {
      loading.value = false;
    }
  }

  function updatePagination(newPagination: Partial<PaginationParams>) {
    pagination.value = { ...pagination.value, ...newPagination };
    loadPatents();
  }

  function updateFilters(newFilters: Partial<PortfolioFilters>) {
    filters.value = { ...filters.value, ...newFilters };
    pagination.value.page = 1; // Reset to first page on filter change
    loadPatents();
  }

  function clearFilters() {
    filters.value = {};
    pagination.value.page = 1;
    loadPatents();
  }

  function toggleColumn(columnName: string) {
    const column = columns.value.find(c => c.name === columnName);
    if (column) {
      column.visible = !column.visible;
      // Save to localStorage
      saveColumnPreferences();
    }
  }

  function saveColumnPreferences() {
    const visibility = columns.value.reduce((acc, col) => {
      acc[col.name] = col.visible ?? true;
      return acc;
    }, {} as Record<string, boolean>);
    localStorage.setItem('portfolio-columns', JSON.stringify(visibility));
  }

  function loadColumnPreferences() {
    const saved = localStorage.getItem('portfolio-columns');
    if (saved) {
      try {
        const visibility = JSON.parse(saved) as Record<string, boolean>;
        columns.value.forEach(col => {
          if (visibility[col.name] !== undefined) {
            col.visible = visibility[col.name];
          }
        });
      } catch {
        console.warn('Failed to load column preferences');
      }
    }
  }

  // Initialize
  loadColumnPreferences();

  return {
    // State
    patents,
    totalCount,
    loading,
    error,
    pagination,
    filters,
    columns,

    // Getters
    visibleColumns,
    hasFilters,

    // Actions
    loadPatents,
    updatePagination,
    updateFilters,
    clearFilters,
    toggleColumn
  };
});
