import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { portfolioApi, companyApi, type PortfolioSummary, type CompanySummary } from '@/services/api';

const STORAGE_KEY = 'ip-port-selected-portfolio';

export const usePortfolioStore = defineStore('portfolio', () => {
  // State
  const portfolios = ref<PortfolioSummary[]>([]);
  const companies = ref<CompanySummary[]>([]);
  const selectedPortfolioId = ref<string | null>(localStorage.getItem(STORAGE_KEY));
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const selectedPortfolio = computed(() =>
    portfolios.value.find(p => p.id === selectedPortfolioId.value) || null
  );

  // Legacy compat — all portfolios now use DB. These always return the same values.
  const isJsonPipeline = computed(() => false);
  const isDbRecords = computed(() => false);

  // Group portfolios by company for the selector dropdown
  const portfoliosByCompany = computed(() => {
    const groups: Array<{
      companyId: string;
      companyName: string;
      portfolios: PortfolioSummary[];
    }> = [];

    const companyMap = new Map<string, PortfolioSummary[]>();
    const companyNames = new Map<string, string>();

    for (const p of portfolios.value) {
      const cId = p.companyId;
      if (!companyMap.has(cId)) {
        companyMap.set(cId, []);
        companyNames.set(cId, p.company?.displayName || 'Unknown');
      }
      companyMap.get(cId)!.push(p);
    }

    for (const [companyId, ports] of companyMap) {
      groups.push({
        companyId,
        companyName: companyNames.get(companyId) || 'Unknown',
        portfolios: ports,
      });
    }

    return groups;
  });

  // Actions
  const lastLoadedAt = ref(0);

  async function loadPortfolios() {
    loading.value = true;
    error.value = null;
    try {
      portfolios.value = await portfolioApi.list();
      // Auto-select first portfolio if none selected or selection no longer valid
      if (!selectedPortfolioId.value || !portfolios.value.find(p => p.id === selectedPortfolioId.value)) {
        if (portfolios.value.length > 0) {
          selectPortfolio(portfolios.value[0].id);
        }
      }
      lastLoadedAt.value = Date.now();
    } catch (err: unknown) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function refreshIfStale() {
    if (Date.now() - lastLoadedAt.value > 30000) {
      await loadPortfolios();
    }
  }

  async function loadCompanies() {
    try {
      companies.value = await companyApi.list();
    } catch (err: unknown) {
      console.error('Failed to load companies:', (err as Error).message);
    }
  }

  function selectPortfolio(id: string | null) {
    selectedPortfolioId.value = id;
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  return {
    // State
    portfolios,
    companies,
    selectedPortfolioId,
    loading,
    error,
    // Getters
    selectedPortfolio,
    isJsonPipeline,
    isDbRecords,
    portfoliosByCompany,
    // Actions
    loadPortfolios,
    loadCompanies,
    selectPortfolio,
    refreshIfStale,
  };
});
