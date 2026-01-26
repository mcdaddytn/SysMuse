import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Patent, PortfolioFilters, PaginationParams, GridColumn, ColumnGroup, ColumnGroupInfo } from '@/types';
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

  // Column group definitions
  const columnGroups: ColumnGroupInfo[] = [
    { id: 'core', label: 'Core Info', icon: 'info', defaultExpanded: true },
    { id: 'entity', label: 'Entity & Sector', icon: 'business', defaultExpanded: true },
    { id: 'citations', label: 'Citations & Scores', icon: 'analytics', defaultExpanded: true },
    { id: 'attorney', label: 'Attorney Questions', icon: 'gavel', defaultExpanded: false, description: 'Structured attorney review fields' },
    { id: 'llm', label: 'LLM Analysis', icon: 'psychology', defaultExpanded: false, description: 'AI-generated patent analysis' },
    { id: 'focusArea', label: 'Focus Area', icon: 'filter_center_focus', defaultExpanded: false, description: 'Context-specific columns' }
  ];

  // Available columns with visibility settings and group assignments
  // Per design: Affiliate and Super-Sector visible by default, Assignee hidden
  const columns = ref<GridColumn[]>([
    // Core Info group
    { name: 'patent_id', label: 'Patent ID', field: 'patent_id', sortable: true, align: 'left', visible: true, group: 'core' },
    { name: 'patent_title', label: 'Title', field: 'patent_title', sortable: true, align: 'left', visible: true, group: 'core' },
    { name: 'patent_date', label: 'Grant Date', field: 'patent_date', sortable: true, align: 'center', visible: true, group: 'core' },
    { name: 'remaining_years', label: 'Years Left', field: 'remaining_years', sortable: true, align: 'center', visible: true, group: 'core',
      format: (val: unknown) => typeof val === 'number' ? val.toFixed(1) : String(val) },
    { name: 'expiration_date', label: 'Expiration', field: 'expiration_date', sortable: true, align: 'center', visible: false, group: 'core' },

    // Entity & Sector group
    { name: 'affiliate', label: 'Affiliate', field: 'affiliate', sortable: true, align: 'left', visible: true, group: 'entity' },
    { name: 'super_sector', label: 'Super-Sector', field: 'super_sector', sortable: true, align: 'left', visible: true, group: 'entity' },
    { name: 'primary_sector', label: 'Primary Sector', field: 'primary_sector', sortable: true, align: 'left', visible: false, group: 'entity' },
    { name: 'assignee', label: 'Assignee (Raw)', field: 'assignee', sortable: true, align: 'left', visible: false, group: 'entity',
      description: 'Original assignee name from USPTO' },

    // Citations & Scores group
    { name: 'forward_citations', label: 'Fwd Citations', field: 'forward_citations', sortable: true, align: 'center', visible: true, group: 'citations' },
    { name: 'competitor_citations', label: 'Competitor Cites', field: 'competitor_citations', sortable: true, align: 'center', visible: true, group: 'citations',
      description: 'Citations from competitor patents' },
    { name: 'affiliate_citations', label: 'Affiliate Cites', field: 'affiliate_citations', sortable: true, align: 'center', visible: false, group: 'citations',
      description: 'Citations from portfolio affiliate patents' },
    { name: 'neutral_citations', label: 'Neutral Cites', field: 'neutral_citations', sortable: true, align: 'center', visible: false, group: 'citations',
      description: 'Citations from non-competitor, non-affiliate patents' },
    { name: 'competitor_count', label: 'Competitors', field: 'competitor_count', sortable: true, align: 'center', visible: true, group: 'citations',
      description: 'Distinct competitor companies citing this patent' },
    { name: 'score', label: 'Score', field: 'score', sortable: true, align: 'center', visible: true, group: 'citations',
      format: (val: unknown) => typeof val === 'number' ? val.toFixed(1) : String(val) },
    { name: 'v2_score', label: 'v2 Score', field: 'v2_score', sortable: true, align: 'center', visible: false, group: 'citations',
      description: 'Legacy 3-weight formula score' },
    { name: 'v3_score', label: 'v3 Score', field: 'v3_score', sortable: true, align: 'center', visible: false, group: 'citations',
      description: 'V3 multi-metric weighted score' },
    { name: 'consensus_score', label: 'Consensus', field: 'consensus_score', sortable: true, align: 'center', visible: false, group: 'citations',
      description: 'Team consensus score' },

    // Attorney Questions group (all hidden by default)
    { name: 'attorney_summary', label: 'Summary', field: 'attorney_summary', sortable: false, align: 'left', visible: false, group: 'attorney',
      description: 'High-level summary for non-technical audience' },
    { name: 'prior_art_problem', label: 'Prior Art Problem', field: 'prior_art_problem', sortable: false, align: 'left', visible: false, group: 'attorney',
      description: 'What problem in prior art does this solve?' },
    { name: 'technical_solution', label: 'Technical Solution', field: 'technical_solution', sortable: false, align: 'left', visible: false, group: 'attorney',
      description: 'How does the technical solution work?' },
    { name: 'eligibility_score', label: 'Eligibility (101)', field: 'eligibility_score', sortable: true, align: 'center', visible: false, group: 'attorney',
      description: 'Patent eligibility strength (1-5)' },
    { name: 'validity_score', label: 'Validity Score', field: 'validity_score', sortable: true, align: 'center', visible: false, group: 'attorney',
      description: 'Strength against prior art invalidity (1-5)' },

    // LLM Analysis group (all hidden by default)
    { name: 'claim_breadth', label: 'Claim Breadth', field: 'claim_breadth', sortable: true, align: 'center', visible: false, group: 'llm',
      description: 'Scope of patent claims (1-5)' },
    { name: 'enforcement_clarity', label: 'Enforcement Clarity', field: 'enforcement_clarity', sortable: true, align: 'center', visible: false, group: 'llm',
      description: 'How easily infringement can be detected (1-5)' },
    { name: 'design_around', label: 'Design-Around Difficulty', field: 'design_around', sortable: true, align: 'center', visible: false, group: 'llm',
      description: 'How hard to avoid infringing (1-5)' },
    { name: 'market_relevance', label: 'Market Relevance', field: 'market_relevance', sortable: true, align: 'center', visible: false, group: 'llm',
      description: 'Current market applicability (1-5)' },
    { name: 'llm_confidence', label: 'LLM Confidence', field: 'llm_confidence', sortable: true, align: 'center', visible: false, group: 'llm',
      description: 'AI confidence in analysis (1-5)' }
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
      saveColumnPreferences();
    }
  }

  function setColumnVisibility(columnName: string, visible: boolean) {
    const column = columns.value.find(c => c.name === columnName);
    if (column) {
      column.visible = visible;
      saveColumnPreferences();
    }
  }

  function toggleGroupColumns(groupId: ColumnGroup, visible: boolean) {
    columns.value.forEach(col => {
      if (col.group === groupId) {
        col.visible = visible;
      }
    });
    saveColumnPreferences();
  }

  function getColumnsByGroup(groupId: ColumnGroup): GridColumn[] {
    return columns.value.filter(col => col.group === groupId);
  }

  function isGroupFullyVisible(groupId: ColumnGroup): boolean {
    const groupCols = getColumnsByGroup(groupId);
    return groupCols.length > 0 && groupCols.every(col => col.visible);
  }

  function isGroupPartiallyVisible(groupId: ColumnGroup): boolean {
    const groupCols = getColumnsByGroup(groupId);
    const visibleCount = groupCols.filter(col => col.visible).length;
    return visibleCount > 0 && visibleCount < groupCols.length;
  }

  function resetColumnsToDefault() {
    // Reset to default visibility based on original definitions
    const defaults: Record<string, boolean> = {
      patent_id: true, patent_title: true, patent_date: true, remaining_years: true,
      affiliate: true, super_sector: true,
      forward_citations: true, competitor_citations: true, competitor_count: true, score: true
    };
    columns.value.forEach(col => {
      col.visible = defaults[col.name] ?? false;
    });
    saveColumnPreferences();
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
    columnGroups,

    // Getters
    visibleColumns,
    hasFilters,

    // Actions
    loadPatents,
    updatePagination,
    updateFilters,
    clearFilters,
    toggleColumn,
    setColumnVisibility,
    toggleGroupColumns,
    getColumnsByGroup,
    isGroupFullyVisible,
    isGroupPartiallyVisible,
    resetColumnsToDefault
  };
});
