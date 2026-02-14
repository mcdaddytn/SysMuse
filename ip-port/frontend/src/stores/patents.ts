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
  // Reorganized: Citations (factual data) and Scores (numeric metrics) are separate.
  // "Attorney Questions" and "LLM Analysis" merged into "LLM Text" (text) and scores go to "Scores".
  const columnGroups: ColumnGroupInfo[] = [
    { id: 'core', label: 'Core Info', icon: 'info', defaultExpanded: true },
    { id: 'entity', label: 'Entity & Sector', icon: 'business', defaultExpanded: true },
    { id: 'citations', label: 'Citations', icon: 'format_quote', defaultExpanded: true, description: 'Forward citation counts and competitor breakdown' },
    { id: 'scores', label: 'Scores', icon: 'analytics', defaultExpanded: true, description: 'Numeric scores used in ranking metrics' },
    { id: 'llmText', label: 'LLM Text', icon: 'psychology', defaultExpanded: false, description: 'AI-generated text analysis and classification' }
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
    { name: 'primary_sub_sector_name', label: 'Sub-Sector', field: 'primary_sub_sector_name', sortable: true, align: 'left', visible: false, group: 'entity',
      description: 'CPC-based sub-sector for LLM scoring (from inventive designation)' },
    { name: 'sub_sector_match_type', label: 'Match Type', field: 'sub_sector_match_type', sortable: true, align: 'center', visible: false, group: 'entity',
      description: 'How sub-sector was assigned: inventive (high), primary (medium), fallback (low)' },
    { name: 'assignee', label: 'Assignee (Raw)', field: 'assignee', sortable: true, align: 'left', visible: false, group: 'entity',
      description: 'Original assignee name from USPTO' },

    // Citations group (factual citation data)
    { name: 'forward_citations', label: 'Fwd Citations', field: 'forward_citations', sortable: true, align: 'center', visible: true, group: 'citations' },
    { name: 'competitor_citations', label: 'Competitor Cites', field: 'competitor_citations', sortable: true, align: 'center', visible: true, group: 'citations',
      description: 'Citations from competitor patents' },
    { name: 'affiliate_citations', label: 'Affiliate Cites', field: 'affiliate_citations', sortable: true, align: 'center', visible: false, group: 'citations',
      description: 'Citations from portfolio affiliate patents' },
    { name: 'neutral_citations', label: 'Neutral Cites', field: 'neutral_citations', sortable: true, align: 'center', visible: false, group: 'citations',
      description: 'Citations from non-competitor, non-affiliate patents' },
    { name: 'competitor_count', label: 'Competitors', field: 'competitor_count', sortable: true, align: 'center', visible: true, group: 'citations',
      description: 'Distinct competitor companies citing this patent' },
    { name: 'competitor_names', label: 'Competitor Names', field: 'competitor_names', sortable: false, align: 'left', visible: false, group: 'citations',
      description: 'Names of competitor companies citing this patent',
      format: (val: unknown) => Array.isArray(val) ? val.join(', ') : String(val || '') },
    { name: 'adjusted_forward_citations', label: 'Adj. Fwd Cites', field: 'adjusted_forward_citations', sortable: true, align: 'center', visible: false, group: 'citations',
      description: 'Forward citations weighted by source: competitor ×1.5, neutral ×1.0, affiliate ×0.25',
      format: (val: unknown) => typeof val === 'number' ? val.toFixed(1) : String(val) },
    { name: 'competitor_density', label: 'Comp. Density', field: 'competitor_density', sortable: true, align: 'center', visible: false, group: 'citations',
      description: 'Fraction of external citations from competitors (0-1)',
      format: (val: unknown) => typeof val === 'number' ? (val * 100).toFixed(0) + '%' : String(val) },

    // Scores group (all numeric metrics used in rankings)
    { name: 'score', label: 'Base Score', field: 'score', sortable: true, align: 'center', visible: true, group: 'scores',
      format: (val: unknown) => typeof val === 'number' ? val.toFixed(1) : String(val) },
    { name: 'v2_score', label: 'v2 Score', field: 'v2_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'Legacy 3-weight formula score' },
    { name: 'v3_score', label: 'v3 Score', field: 'v3_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'V3 multi-metric weighted score' },
    { name: 'consensus_score', label: 'Consensus', field: 'consensus_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'Team consensus score' },
    { name: 'eligibility_score', label: 'Eligibility (101)', field: 'eligibility_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'Patent eligibility strength (1-5)' },
    { name: 'validity_score', label: 'Validity Score', field: 'validity_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'Strength against prior art invalidity (1-5)' },
    { name: 'claim_breadth', label: 'Claim Breadth', field: 'claim_breadth', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'Scope of patent claims (1-5)' },
    { name: 'enforcement_clarity', label: 'Enforcement Clarity', field: 'enforcement_clarity', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'How easily infringement can be detected (1-5)' },
    { name: 'design_around_difficulty', label: 'Design-Around', field: 'design_around_difficulty', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'How hard to avoid infringing (1-5)' },
    { name: 'claim_clarity_score', label: 'Claim Clarity', field: 'claim_clarity_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'How clear and well-defined claim boundaries are (1-5)' },
    { name: 'evidence_accessibility_score', label: 'Evidence Access', field: 'evidence_accessibility_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'How accessible is infringement evidence (1-5)' },
    { name: 'market_relevance_score', label: 'Market Relevance', field: 'market_relevance_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'Current market applicability (1-5)' },
    { name: 'trend_alignment_score', label: 'Trend Alignment', field: 'trend_alignment_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'Alignment with current technology trends (1-5)' },
    { name: 'investigation_priority_score', label: 'Investigation Priority', field: 'investigation_priority_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'Priority for infringement investigation (1-5)' },
    { name: 'llm_confidence', label: 'LLM Confidence', field: 'llm_confidence', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'AI confidence in analysis (1-5)' },
    { name: 'legal_viability_score', label: 'Legal Viability', field: 'legal_viability_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'Composite legal strength score (0-100)' },
    { name: 'enforcement_potential_score', label: 'Enforcement Potential', field: 'enforcement_potential_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'Composite enforcement ability score (0-100)' },
    { name: 'market_value_score', label: 'Market Value', field: 'market_value_score', sortable: true, align: 'center', visible: false, group: 'scores',
      description: 'Composite commercial relevance score (0-100)' },

    // LLM Text group (AI-generated text and classifications)
    { name: 'llm_summary', label: 'LLM Summary', field: 'llm_summary', sortable: false, align: 'left', visible: false, group: 'llmText',
      description: 'AI-generated technology summary' },
    { name: 'llm_prior_art_problem', label: 'Prior Art Problem', field: 'llm_prior_art_problem', sortable: false, align: 'left', visible: false, group: 'llmText',
      description: 'What problem in prior art does this patent solve?' },
    { name: 'llm_technical_solution', label: 'Technical Solution', field: 'llm_technical_solution', sortable: false, align: 'left', visible: false, group: 'llmText',
      description: 'How does the technical solution work?' },
    { name: 'llm_technology_category', label: 'Tech Category', field: 'llm_technology_category', sortable: true, align: 'left', visible: false, group: 'llmText',
      description: 'Technology domain classification' },
    { name: 'llm_implementation_type', label: 'Implementation', field: 'llm_implementation_type', sortable: true, align: 'left', visible: false, group: 'llmText',
      description: 'Hardware, software, method, etc.' },
    { name: 'llm_standards_relevance', label: 'Standards', field: 'llm_standards_relevance', sortable: true, align: 'left', visible: false, group: 'llmText',
      description: 'Relevance to industry standards' },
    { name: 'llm_market_segment', label: 'Market Segment', field: 'llm_market_segment', sortable: true, align: 'left', visible: false, group: 'llmText',
      description: 'Target market segment' },
    { name: 'llm_detection_method', label: 'Detection Method', field: 'llm_detection_method', sortable: true, align: 'left', visible: false, group: 'llmText',
      description: 'How infringement would be detected' },
    { name: 'llm_implementation_complexity', label: 'Complexity', field: 'llm_implementation_complexity', sortable: true, align: 'left', visible: false, group: 'llmText',
      description: 'Implementation complexity level' },
    { name: 'llm_claim_type_primary', label: 'Claim Type', field: 'llm_claim_type_primary', sortable: true, align: 'left', visible: false, group: 'llmText',
      description: 'Primary claim type (method, system, apparatus, etc.)' },
    { name: 'llm_geographic_scope', label: 'Geo Scope', field: 'llm_geographic_scope', sortable: true, align: 'left', visible: false, group: 'llmText',
      description: 'Geographic deployment scope' },
    { name: 'llm_lifecycle_stage', label: 'Lifecycle Stage', field: 'llm_lifecycle_stage', sortable: true, align: 'left', visible: false, group: 'llmText',
      description: 'Technology lifecycle stage' },

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

  function setFilters(newFilters: PortfolioFilters) {
    // Replace filters completely (not merge)
    filters.value = newFilters;
    pagination.value.page = 1;
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
    setFilters,
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
