<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { companyApi, portfolioApi } from '@/services/api';
import type {
  CompanySummary,
  CompanyDetail,
  CompetitorRelationship,
  AffiliateDetail,
  AffiliateSuggestion,
  PatentCountResult,
} from '@/services/api';

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const companies = ref<CompanySummary[]>([]);
const selectedCompanyId = ref<string | null>(null);
const companyDetail = ref<CompanyDetail | null>(null);
const competitors = ref<CompetitorRelationship[]>([]);
const loading = ref(false);
const detailLoading = ref(false);
const competitorsLoading = ref(false);
const error = ref<string | null>(null);

// Create company dialog
const showCreateCompanyDialog = ref(false);
const newCompany = ref({ name: '', displayName: '', description: '', website: '' });

// Add affiliate dialog
const showAddAffiliateDialog = ref(false);
const newAffiliate = ref({ name: '', displayName: '', acquiredYear: null as number | null, notes: '', patterns: '' });

// Add pattern dialog
const showAddPatternDialog = ref(false);
const patternAffiliateId = ref('');
const newPattern = ref('');

// Add competitor dialog
const showAddCompetitorDialog = ref(false);
const competitorSearch = ref('');

// Discover competitors
const discovering = ref(false);
const discoveringData = ref(false);
const discoverSuggestions = ref<Array<{ name: string; slug: string; sectors: string[]; competingDivisions?: string[]; notes: string; strength?: number; citationCount?: number; patentsCited?: number; variants?: string[] }>>([]);
const showDiscoverDialog = ref(false);
const discoverSource = ref<'llm' | 'data'>('llm');
const discoverDataStats = ref<{ totalCiting: number; withData: number; withoutData: number } | null>(null);

// Discover affiliates
const discoveringAffiliates = ref(false);
const affiliateSuggestions = ref<AffiliateSuggestion[]>([]);
const showDiscoverAffiliatesDialog = ref(false);

// Bulk selection for discovery dialogs
const selectedCompetitorIdxs = ref(new Set<number>());
const selectedAffiliateIdxs = ref(new Set<number>());
const acceptingBulk = ref(false);

// Validate patterns
const validating = ref(false);
const validationResults = ref<Array<{ pattern: string; totalCount: number; filteredCount: number | null; sampleAssignees: string[] }>>([]);
const validationAffiliateName = ref('');
const validationCpcPrefixes = ref('');
const showValidateDialog = ref(false);

// Create portfolio dialog
const showCreatePortfolioDialog = ref(false);
const newPortfolio = ref({ name: '', displayName: '', description: '' });

// Import patents dialog
const showImportDialog = ref(false);
const importPortfolioId = ref('');
const importPortfolioName = ref('');
const importCpcPrefixes = ref('');
const importMaxPatents = ref(1000);
const importing = ref(false);
const importResult = ref<{ imported: number; alreadyExists: number; failed: number; totalInPortfolio: number } | null>(null);
const importNotification = ref<string | null>(null);

// Extract XMLs
const extracting = ref(false);

// Describe affiliates/competitors (LLM)
const describingAffiliates = ref(false);
const describingCompetitors = ref(false);
const togglingAllAffiliates = ref(false);

// ─────────────────────────────────────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────────────────────────────────────

const selectedCompany = computed(() =>
  companies.value.find(c => c.id === selectedCompanyId.value) || null
);

// Companies that have portfolios (primary companies vs pure competitors)
const primaryCompanies = computed(() =>
  companies.value.filter(c => c._count.portfolios > 0 || c._count.affiliates > 0)
);

const competitorCompanies = computed(() =>
  companies.value.filter(c => c._count.portfolios === 0 && c._count.affiliates === 0)
);

const affiliateTree = computed(() => {
  if (!companyDetail.value) return [];
  const affiliates = companyDetail.value.affiliates;
  const topLevel = affiliates.filter(a => !a.parentId);
  return topLevel.map(a => ({
    ...a,
    childAffiliates: affiliates.filter(c => c.parentId === a.id),
  }));
});

const allAffiliatesActive = computed(() =>
  companyDetail.value?.affiliates?.every(a => a.isActive) ?? true
);

// Filter competitor companies for the add competitor autocomplete
const availableCompetitors = computed(() => {
  const existingIds = new Set(competitors.value.map(r => r.competitorId));
  existingIds.add(selectedCompanyId.value || '');
  return companies.value
    .filter(c => !existingIds.has(c.id))
    .filter(c => !competitorSearch.value || c.displayName.toLowerCase().includes(competitorSearch.value.toLowerCase()))
    .slice(0, 20);
});

// ─────────────────────────────────────────────────────────────────────────────
// API calls
// ─────────────────────────────────────────────────────────────────────────────

async function loadCompanies() {
  loading.value = true;
  error.value = null;
  try {
    companies.value = await companyApi.list();
    if (!selectedCompanyId.value && primaryCompanies.value.length) {
      selectedCompanyId.value = primaryCompanies.value[0].id;
    }
  } catch (err: unknown) {
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

async function loadCompanyDetail(id: string) {
  detailLoading.value = true;
  try {
    companyDetail.value = await companyApi.get(id);
  } catch (err: unknown) {
    error.value = (err as Error).message;
  } finally {
    detailLoading.value = false;
  }
}

async function loadCompetitors(id: string) {
  competitorsLoading.value = true;
  try {
    competitors.value = await companyApi.getCompetitors(id);
  } catch (err: unknown) {
    console.error('Load competitors error:', (err as Error).message);
  } finally {
    competitorsLoading.value = false;
  }
}

async function createCompany() {
  try {
    const slug = newCompany.value.name || newCompany.value.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const created = await companyApi.create({
      name: slug,
      displayName: newCompany.value.displayName,
      description: newCompany.value.description || undefined,
      website: newCompany.value.website || undefined,
    });
    showCreateCompanyDialog.value = false;
    newCompany.value = { name: '', displayName: '', description: '', website: '' };
    await loadCompanies();
    selectedCompanyId.value = created.id;
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

async function deleteCompany(id: string) {
  if (!confirm('Delete this company and all its affiliates, portfolios, and competitor relationships?')) return;
  try {
    await companyApi.remove(id);
    if (selectedCompanyId.value === id) {
      selectedCompanyId.value = null;
      companyDetail.value = null;
      competitors.value = [];
    }
    await loadCompanies();
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

async function addAffiliate() {
  if (!selectedCompanyId.value) return;
  try {
    const patterns = newAffiliate.value.patterns
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean);
    await companyApi.addAffiliate(selectedCompanyId.value, {
      name: newAffiliate.value.name,
      displayName: newAffiliate.value.displayName,
      acquiredYear: newAffiliate.value.acquiredYear || undefined,
      notes: newAffiliate.value.notes || undefined,
      patterns,
    });
    showAddAffiliateDialog.value = false;
    newAffiliate.value = { name: '', displayName: '', acquiredYear: null, notes: '', patterns: '' };
    await loadCompanyDetail(selectedCompanyId.value);
    await loadCompanies();
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

async function toggleAffiliateActive(affiliate: AffiliateDetail) {
  if (!selectedCompanyId.value) return;
  try {
    await companyApi.updateAffiliate(selectedCompanyId.value, affiliate.id, { isActive: !affiliate.isActive });
    await loadCompanyDetail(selectedCompanyId.value);
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

async function toggleAllAffiliatesActive() {
  if (!selectedCompanyId.value) return;
  togglingAllAffiliates.value = true;
  try {
    await companyApi.bulkToggleAffiliatesActive(selectedCompanyId.value, !allAffiliatesActive.value);
    await loadCompanyDetail(selectedCompanyId.value);
  } catch (err: unknown) {
    error.value = (err as Error).message;
  } finally {
    togglingAllAffiliates.value = false;
  }
}

async function describeAffiliates() {
  if (!selectedCompanyId.value) return;
  describingAffiliates.value = true;
  try {
    await companyApi.describeAffiliates(selectedCompanyId.value);
    await loadCompanyDetail(selectedCompanyId.value);
  } catch (err: unknown) {
    error.value = (err as Error).message;
  } finally {
    describingAffiliates.value = false;
  }
}

async function describeCompetitors() {
  if (!selectedCompanyId.value) return;
  describingCompetitors.value = true;
  try {
    competitors.value = await companyApi.describeCompetitors(selectedCompanyId.value);
  } catch (err: unknown) {
    error.value = (err as Error).message;
  } finally {
    describingCompetitors.value = false;
  }
}

async function removeAffiliate(affiliateId: string) {
  if (!selectedCompanyId.value) return;
  if (!confirm('Delete this affiliate and all its patterns?')) return;
  try {
    await companyApi.removeAffiliate(selectedCompanyId.value, affiliateId);
    await loadCompanyDetail(selectedCompanyId.value);
    await loadCompanies();
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

async function addPattern() {
  if (!selectedCompanyId.value || !patternAffiliateId.value || !newPattern.value) return;
  try {
    await companyApi.addPattern(selectedCompanyId.value, patternAffiliateId.value, newPattern.value);
    showAddPatternDialog.value = false;
    newPattern.value = '';
    await loadCompanyDetail(selectedCompanyId.value);
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

async function removePattern(affiliateId: string, patternId: string) {
  if (!selectedCompanyId.value) return;
  try {
    await companyApi.removePattern(selectedCompanyId.value, affiliateId, patternId);
    await loadCompanyDetail(selectedCompanyId.value);
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

async function addCompetitor(competitorId: string) {
  if (!selectedCompanyId.value) return;
  try {
    await companyApi.addCompetitor(selectedCompanyId.value, { competitorId });
    await loadCompetitors(selectedCompanyId.value);
    await loadCompanies();
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

async function removeCompetitor(competitorId: string) {
  if (!selectedCompanyId.value) return;
  try {
    await companyApi.removeCompetitor(selectedCompanyId.value, competitorId);
    await loadCompetitors(selectedCompanyId.value);
    await loadCompanies();
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

async function discoverCompetitors() {
  if (!selectedCompanyId.value) return;
  discovering.value = true;
  discoverSuggestions.value = [];
  discoverSource.value = 'llm';
  discoverDataStats.value = null;
  selectedCompetitorIdxs.value = new Set();
  try {
    const result = await companyApi.discoverCompetitors(selectedCompanyId.value);
    discoverSuggestions.value = result.suggestions;
    showDiscoverDialog.value = true;
  } catch (err: unknown) {
    error.value = (err as Error).message;
  } finally {
    discovering.value = false;
  }
}

async function discoverCompetitorsFromData() {
  if (!selectedCompanyId.value || !companyDetail.value?.portfolios?.length) return;
  discoveringData.value = true;
  discoverSuggestions.value = [];
  discoverSource.value = 'data';
  discoverDataStats.value = null;
  selectedCompetitorIdxs.value = new Set();

  // Use the first portfolio
  const portfolio = companyDetail.value.portfolios[0];
  try {
    const result = await companyApi.discoverCompetitorsData(selectedCompanyId.value, portfolio.id);
    discoverSuggestions.value = result.suggestions;
    discoverDataStats.value = {
      totalCiting: result.totalCitingPatentsAnalyzed,
      withData: result.patentsWithCitingData,
      withoutData: result.patentsWithoutCitingData,
    };
    showDiscoverDialog.value = true;
  } catch (err: unknown) {
    error.value = (err as Error).message;
  } finally {
    discoveringData.value = false;
  }
}

async function acceptCompetitorSuggestion(suggestion: { name: string; slug: string; sectors: string[]; competingDivisions?: string[]; strength?: number; notes?: string }) {
  if (!selectedCompanyId.value) return;
  try {
    // Create the company if it doesn't exist
    let company: CompanySummary;
    try {
      company = await companyApi.create({ name: suggestion.slug, displayName: suggestion.name });
    } catch {
      // Already exists — find it
      const all = await companyApi.list();
      const found = all.find(c => c.name === suggestion.slug);
      if (!found) throw new Error('Could not find or create company');
      company = found;
    }
    // Create competitor relationship — merge competingDivisions into sectors
    const source = discoverSource.value === 'data' ? 'CITATION_DATA' : 'LLM_SUGGESTED';
    const allSectors = [...new Set([...(suggestion.sectors || []), ...(suggestion.competingDivisions || [])])];
    const notesWithDivisions = suggestion.competingDivisions?.length
      ? `${suggestion.notes || ''}${suggestion.notes ? ' | ' : ''}Competes with: ${suggestion.competingDivisions.join(', ')}`
      : suggestion.notes;
    await companyApi.addCompetitor(selectedCompanyId.value, {
      competitorId: company.id,
      sectors: allSectors,
      discoverySource: source,
      notes: notesWithDivisions || undefined,
    });
    discoverSuggestions.value = discoverSuggestions.value.filter(s => s.slug !== suggestion.slug);
    await loadCompetitors(selectedCompanyId.value);
    await loadCompanies();
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

async function createPortfolio() {
  if (!selectedCompanyId.value) return;
  try {
    const slug = newPortfolio.value.name || newPortfolio.value.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await portfolioApi.create({
      name: slug,
      displayName: newPortfolio.value.displayName,
      description: newPortfolio.value.description || undefined,
      companyId: selectedCompanyId.value,
    });
    showCreatePortfolioDialog.value = false;
    newPortfolio.value = { name: '', displayName: '', description: '' };
    await loadCompanyDetail(selectedCompanyId.value);
    await loadCompanies();
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

async function openImportDialog(portfolio: { id: string; displayName: string }) {
  importPortfolioId.value = portfolio.id;
  importPortfolioName.value = portfolio.displayName;
  importCpcPrefixes.value = '';
  importMaxPatents.value = 1000;
  importResult.value = null;
  showImportDialog.value = true;
}

async function importPatents() {
  if (!importPortfolioId.value) return;
  importing.value = true;
  importResult.value = null;
  try {
    const cpcPrefixes = importCpcPrefixes.value.split(',').map(s => s.trim()).filter(Boolean);
    const result = await portfolioApi.importPatents(importPortfolioId.value, {
      cpcPrefixes: cpcPrefixes.length ? cpcPrefixes : undefined,
      maxPatents: importMaxPatents.value,
    });
    showImportDialog.value = false;
    importResult.value = result;
    // Show result as a temporary notification
    error.value = null;
    importNotification.value = `Imported ${result.imported} new patents (${result.alreadyExists} already existed). Portfolio now has ${result.totalInPortfolio} total. Hydration running in background.`;
    setTimeout(() => { importNotification.value = null; }, 10000);
    // Refresh company detail to update portfolio patent count
    if (selectedCompanyId.value) {
      await loadCompanyDetail(selectedCompanyId.value);
    }
  } catch (err: unknown) {
    error.value = (err as Error).message;
  } finally {
    importing.value = false;
  }
}

async function extractXmls(portfolio: { id: string; displayName: string }) {
  extracting.value = true;
  try {
    const startResult = await portfolioApi.extractXmls(portfolio.id);
    if (startResult.status === 'running') {
      importNotification.value = `USPTO bulk extraction for "${portfolio.displayName}" already in progress...`;
    } else {
      importNotification.value = `USPTO bulk extraction for "${portfolio.displayName}" started (${startResult.totalPatents} patents). This may take several minutes...`;
    }

    // Poll for completion
    const pollInterval = setInterval(async () => {
      try {
        const status = await portfolioApi.getExtractXmlsStatus(portfolio.id);
        if (status.status === 'completed') {
          clearInterval(pollInterval);
          extracting.value = false;
          const r = status.result!;
          importNotification.value = `USPTO bulk extraction complete: ${r.extracted} extracted, ${r.alreadyExist} already existed, ${r.notFound} not found.`;
          setTimeout(() => { importNotification.value = null; }, 15000);
        } else if (status.status === 'failed') {
          clearInterval(pollInterval);
          extracting.value = false;
          error.value = `Extraction failed: ${status.error}`;
          importNotification.value = null;
        } else {
          // Still running — show latest log
          const lastLog = status.logs[status.logs.length - 1];
          if (lastLog) importNotification.value = `Extracting USPTO data: ${lastLog}`;
        }
      } catch {
        // Poll error — keep trying
      }
    }, 5000);

    // Safety timeout: stop polling after 30 minutes
    setTimeout(() => { clearInterval(pollInterval); extracting.value = false; }, 30 * 60 * 1000);
  } catch (err: unknown) {
    error.value = (err as Error).message;
    extracting.value = false;
  }
}

async function discoverAffiliates() {
  if (!selectedCompanyId.value) return;
  discoveringAffiliates.value = true;
  affiliateSuggestions.value = [];
  selectedAffiliateIdxs.value = new Set();
  try {
    const result = await companyApi.discoverAffiliates(selectedCompanyId.value);
    affiliateSuggestions.value = result.suggestions;
    showDiscoverAffiliatesDialog.value = true;
  } catch (err: unknown) {
    error.value = (err as Error).message;
  } finally {
    discoveringAffiliates.value = false;
  }
}

async function acceptAffiliateSuggestion(suggestion: AffiliateSuggestion) {
  if (!selectedCompanyId.value) return;
  try {
    // Resolve parent slug to parentId if provided
    let parentId: string | undefined;
    if (suggestion.parent && companyDetail.value) {
      const parentAffiliate = companyDetail.value.affiliates.find(
        a => a.name === suggestion.parent
      );
      if (parentAffiliate) parentId = parentAffiliate.id;
    }

    await companyApi.addAffiliate(selectedCompanyId.value, {
      name: suggestion.name,
      displayName: suggestion.displayName,
      acquiredYear: suggestion.acquiredYear || undefined,
      parentId,
      notes: suggestion.notes || undefined,
      description: suggestion.description || undefined,
      patterns: suggestion.patterns,
    });
    affiliateSuggestions.value = affiliateSuggestions.value.filter(s => s.name !== suggestion.name);
    await loadCompanyDetail(selectedCompanyId.value);
    await loadCompanies();
  } catch (err: unknown) {
    error.value = (err as Error).message;
  }
}

function toggleAllCompetitors() {
  if (selectedCompetitorIdxs.value.size === discoverSuggestions.value.length) {
    selectedCompetitorIdxs.value = new Set();
  } else {
    selectedCompetitorIdxs.value = new Set(discoverSuggestions.value.map((_, i) => i));
  }
}

function toggleAllAffiliates() {
  if (selectedAffiliateIdxs.value.size === affiliateSuggestions.value.length) {
    selectedAffiliateIdxs.value = new Set();
  } else {
    selectedAffiliateIdxs.value = new Set(affiliateSuggestions.value.map((_, i) => i));
  }
}

function toggleCompetitorIdx(idx: number) {
  const s = new Set(selectedCompetitorIdxs.value);
  if (s.has(idx)) s.delete(idx); else s.add(idx);
  selectedCompetitorIdxs.value = s;
}

function toggleAffiliateIdx(idx: number) {
  const s = new Set(selectedAffiliateIdxs.value);
  if (s.has(idx)) s.delete(idx); else s.add(idx);
  selectedAffiliateIdxs.value = s;
}

async function acceptSelectedCompetitors() {
  acceptingBulk.value = true;
  try {
    // Process in reverse index order to avoid index drift
    const indices = [...selectedCompetitorIdxs.value].sort((a, b) => b - a);
    for (const idx of indices) {
      const s = discoverSuggestions.value[idx];
      if (s) await acceptCompetitorSuggestion(s);
    }
    selectedCompetitorIdxs.value = new Set();
  } finally {
    acceptingBulk.value = false;
  }
}

async function acceptSelectedAffiliates() {
  acceptingBulk.value = true;
  try {
    // Sort parents-first so parentId lookups succeed for children
    const selected = [...selectedAffiliateIdxs.value]
      .map(idx => affiliateSuggestions.value[idx])
      .filter(Boolean);
    const parentFirst = selected.sort((a, b) => {
      const aIsParent = !a.parent ? 0 : 1;
      const bIsParent = !b.parent ? 0 : 1;
      return aIsParent - bIsParent;
    });
    for (const s of parentFirst) {
      await acceptAffiliateSuggestion(s);
    }
    selectedAffiliateIdxs.value = new Set();
  } finally {
    acceptingBulk.value = false;
  }
}

async function validateAffiliatePatterns(affiliate: AffiliateDetail) {
  if (!selectedCompanyId.value) return;
  const patterns = affiliate.patterns.map(p => p.pattern);
  if (!patterns.length) {
    error.value = 'No patterns to validate';
    return;
  }
  validating.value = true;
  validationResults.value = [];
  validationAffiliateName.value = affiliate.displayName;
  validationCpcPrefixes.value = '';
  showValidateDialog.value = true;
  try {
    const cpcPrefixes = validationCpcPrefixes.value.split(',').map(s => s.trim()).filter(Boolean);
    const result = await companyApi.validatePatterns(
      selectedCompanyId.value,
      patterns,
      cpcPrefixes.length ? cpcPrefixes : undefined,
    );
    validationResults.value = result.results;
  } catch (err: unknown) {
    error.value = (err as Error).message;
  } finally {
    validating.value = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchers & Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

watch(selectedCompanyId, (id) => {
  if (id) {
    loadCompanyDetail(id);
    loadCompetitors(id);
  }
});

onMounted(() => loadCompanies());
</script>

<template>
  <q-page padding>
    <div class="text-h5 q-mb-md">Company & Portfolio Admin</div>

    <!-- Import success notification -->
    <q-banner v-if="importNotification" class="bg-green-1 text-green-8 q-mb-md" rounded>
      {{ importNotification }}
      <template v-slot:action>
        <q-btn flat dense label="Dismiss" @click="importNotification = null" />
      </template>
    </q-banner>

    <!-- Error banner -->
    <q-banner v-if="error" class="bg-red-1 text-red-8 q-mb-md" rounded>
      {{ error }}
      <template v-slot:action>
        <q-btn flat dense label="Dismiss" @click="error = null" />
      </template>
    </q-banner>

    <div class="row q-col-gutter-md">
      <!-- ═══════════ LEFT PANEL: Company List ═══════════ -->
      <div class="col-12 col-md-3">
        <q-card flat bordered style="max-height: calc(100vh - 130px); overflow-y: auto">
          <q-card-section class="row items-center q-pb-sm">
            <div class="text-h6">Companies</div>
            <q-space />
            <q-btn flat dense icon="add" color="primary" @click="showCreateCompanyDialog = true">
              <q-tooltip>Add Company</q-tooltip>
            </q-btn>
          </q-card-section>

          <q-separator />

          <q-card-section v-if="loading" class="text-center">
            <q-spinner size="2em" />
          </q-card-section>

          <template v-else>
            <!-- Primary companies (have portfolios/affiliates) -->
            <q-item-label header class="text-caption text-grey-7">
              Primary ({{ primaryCompanies.length }})
              <q-tooltip>Companies you manage with portfolios and affiliates</q-tooltip>
            </q-item-label>
            <q-list separator dense>
              <q-item
                v-for="c in primaryCompanies"
                :key="c.id"
                clickable
                :active="selectedCompanyId === c.id"
                active-class="bg-blue-1"
                @click="selectedCompanyId = c.id"
              >
                <q-item-section>
                  <q-item-label>{{ c.displayName }}</q-item-label>
                  <q-item-label caption>
                    {{ c._count.affiliates }} affiliates &middot;
                    {{ c._count.portfolios }} portfolios &middot;
                    {{ c._count.competitorsOf }} competitors
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn flat dense round icon="delete" size="xs" color="negative"
                    @click.stop="deleteCompany(c.id)">
                    <q-tooltip>Delete</q-tooltip>
                  </q-btn>
                </q-item-section>
              </q-item>
            </q-list>

            <!-- Competitor-only companies -->
            <q-item-label header class="text-caption text-grey-7">
              Competitors ({{ competitorCompanies.length }})
              <q-tooltip>Companies added via competitor discovery relationships</q-tooltip>
            </q-item-label>
            <q-list separator dense>
              <q-item
                v-for="c in competitorCompanies"
                :key="c.id"
                clickable
                dense
                :active="selectedCompanyId === c.id"
                active-class="bg-blue-1"
                @click="selectedCompanyId = c.id"
              >
                <q-item-section>
                  <q-item-label class="text-caption">{{ c.displayName }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </template>
        </q-card>
      </div>

      <!-- ═══════════ CENTER PANEL: Company Detail ═══════════ -->
      <div class="col-12 col-md-5" style="max-height: calc(100vh - 130px); overflow-y: auto">
        <q-card v-if="!selectedCompanyId" flat bordered>
          <q-card-section class="text-grey text-center q-py-xl">
            Select a company from the left panel
          </q-card-section>
        </q-card>

        <template v-else>
          <!-- Company Header -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section>
              <div class="row items-center">
                <div>
                  <div class="text-h6">{{ companyDetail?.displayName || 'Loading...' }}</div>
                  <div v-if="companyDetail?.description" class="text-caption text-grey">
                    {{ companyDetail.description }}
                  </div>
                  <div v-if="companyDetail?.website" class="text-caption">
                    <a :href="companyDetail.website" target="_blank" class="text-primary">{{ companyDetail.website }}</a>
                  </div>
                </div>
                <q-space />
                <q-btn flat dense icon="auto_awesome" color="accent" class="q-mr-xs"
                  :loading="discoveringAffiliates"
                  @click="discoverAffiliates">
                  <q-tooltip>Discover Affiliates (LLM)</q-tooltip>
                </q-btn>
                <q-btn flat dense icon="person_add" color="primary" class="q-mr-sm"
                  @click="showAddAffiliateDialog = true">
                  <q-tooltip>Add Affiliate</q-tooltip>
                </q-btn>
              </div>
            </q-card-section>
          </q-card>

          <!-- Portfolios -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section class="row items-center q-pb-sm">
              <div class="text-subtitle1 text-weight-medium">Portfolios</div>
              <q-space />
              <q-btn flat dense icon="add" size="sm" color="primary"
                @click="showCreatePortfolioDialog = true">
                <q-tooltip>Create Portfolio</q-tooltip>
              </q-btn>
            </q-card-section>
            <q-separator />
            <q-list v-if="companyDetail?.portfolios?.length" dense separator>
              <q-item v-for="p in companyDetail.portfolios" :key="p.id">
                <q-item-section>
                  <q-item-label>{{ p.displayName }}</q-item-label>
                  <q-item-label caption>
                    {{ p._count?.patents ?? p.patentCount ?? 0 }} patents
                  </q-item-label>
                </q-item-section>
                <q-item-section side class="row no-wrap items-center q-gutter-xs">
                  <q-btn flat dense round icon="download" size="xs" color="primary"
                    @click="openImportDialog(p)">
                    <q-tooltip>Import Patents from PatentsView</q-tooltip>
                  </q-btn>
                  <q-btn flat dense round icon="description" size="xs" color="accent"
                    :loading="extracting"
                    @click="extractXmls(p)">
                    <q-tooltip>Extract USPTO bulk data (for claims)</q-tooltip>
                  </q-btn>
                </q-item-section>
              </q-item>
            </q-list>
            <q-card-section v-else class="text-grey text-center">
              No portfolios yet. Create one to start importing patents.
            </q-card-section>
          </q-card>

          <!-- Affiliates Tree -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section class="row items-center q-pb-sm">
              <div class="text-subtitle1 text-weight-medium">Affiliates & Patterns</div>
              <q-space />
              <q-btn flat dense icon="auto_awesome" size="sm" color="accent"
                :loading="describingAffiliates"
                @click="describeAffiliates"
                :disable="!companyDetail?.affiliates?.length">
                <q-tooltip>Describe All (LLM + web search)</q-tooltip>
              </q-btn>
              <q-btn flat dense size="sm"
                :icon="allAffiliatesActive ? 'toggle_on' : 'toggle_off'"
                :color="allAffiliatesActive ? 'positive' : 'grey'"
                :loading="togglingAllAffiliates"
                @click="toggleAllAffiliatesActive"
                :disable="!companyDetail?.affiliates?.length">
                <q-tooltip>{{ allAffiliatesActive ? 'Deactivate All' : 'Activate All' }}</q-tooltip>
              </q-btn>
            </q-card-section>
            <q-separator />

            <q-card-section v-if="detailLoading" class="text-center">
              <q-spinner size="2em" />
            </q-card-section>

            <div v-else-if="affiliateTree.length">
              <div v-for="group in affiliateTree" :key="group.id" class="q-pa-sm">
                <!-- Top-level affiliate -->
                <div class="row items-center q-pa-xs" :class="{ 'text-grey-5': !group.isActive }">
                  <q-icon name="business" class="q-mr-sm" :class="group.isActive ? 'text-grey-6' : 'text-grey-4'" />
                  <div class="text-weight-medium">
                    {{ group.displayName }}
                    <q-tooltip v-if="group.description || group.notes" anchor="top middle" self="bottom middle" max-width="400px">
                      <div v-if="group.description">{{ group.description }}</div>
                      <div v-if="group.notes" class="text-caption text-grey-4 q-mt-xs">{{ group.notes }}</div>
                    </q-tooltip>
                  </div>
                  <q-badge v-if="group.acquiredYear" color="grey-4" text-color="grey-8" class="q-ml-sm">
                    {{ group.acquiredYear }}
                  </q-badge>
                  <q-badge v-if="!group.isActive" color="grey-4" text-color="grey-7" class="q-ml-sm">
                    inactive
                  </q-badge>
                  <q-space />
                  <q-btn flat dense round :icon="group.isActive ? 'toggle_on' : 'toggle_off'" size="xs"
                    :color="group.isActive ? 'positive' : 'grey'"
                    @click="toggleAffiliateActive(group)">
                    <q-tooltip>{{ group.isActive ? 'Deactivate (exclude from imports)' : 'Activate (include in imports)' }}</q-tooltip>
                  </q-btn>
                  <q-btn flat dense round icon="fact_check" size="xs" color="accent"
                    @click="validateAffiliatePatterns(group)"
                    :disable="!group.patterns.length">
                    <q-tooltip>Validate Patterns (PatentsView)</q-tooltip>
                  </q-btn>
                  <q-btn flat dense round icon="add" size="xs" color="primary"
                    @click="patternAffiliateId = group.id; showAddPatternDialog = true">
                    <q-tooltip>Add Pattern</q-tooltip>
                  </q-btn>
                  <q-btn flat dense round icon="delete" size="xs" color="negative"
                    @click="removeAffiliate(group.id)">
                    <q-tooltip>Remove Affiliate</q-tooltip>
                  </q-btn>
                </div>

                <!-- Patterns for top-level -->
                <div class="q-ml-xl q-mb-xs">
                  <q-chip v-for="pat in group.patterns" :key="pat.id"
                    removable dense size="sm" color="grey-3"
                    @remove="removePattern(group.id, pat.id)">
                    {{ pat.pattern }}
                  </q-chip>
                </div>

                <!-- Child affiliates -->
                <div v-for="child in group.childAffiliates" :key="child.id" class="q-ml-lg">
                  <div class="row items-center q-pa-xs" :class="{ 'text-grey-5': !child.isActive }">
                    <q-icon name="subdirectory_arrow_right" class="q-mr-sm text-grey-5" size="xs" />
                    <div>
                      {{ child.displayName }}
                      <q-tooltip v-if="child.description || child.notes" anchor="top middle" self="bottom middle" max-width="400px">
                        <div v-if="child.description">{{ child.description }}</div>
                        <div v-if="child.notes" class="text-caption text-grey-4 q-mt-xs">{{ child.notes }}</div>
                      </q-tooltip>
                    </div>
                    <q-badge v-if="child.acquiredYear" color="grey-4" text-color="grey-8" class="q-ml-sm">
                      {{ child.acquiredYear }}
                    </q-badge>
                    <q-badge v-if="!child.isActive" color="grey-4" text-color="grey-7" class="q-ml-sm">
                      inactive
                    </q-badge>
                    <q-space />
                    <q-btn flat dense round :icon="child.isActive ? 'toggle_on' : 'toggle_off'" size="xs"
                      :color="child.isActive ? 'positive' : 'grey'"
                      @click="toggleAffiliateActive(child)">
                      <q-tooltip>{{ child.isActive ? 'Deactivate' : 'Activate' }}</q-tooltip>
                    </q-btn>
                    <q-btn flat dense round icon="fact_check" size="xs" color="accent"
                      @click="validateAffiliatePatterns(child)"
                      :disable="!child.patterns.length">
                      <q-tooltip>Validate Patterns</q-tooltip>
                    </q-btn>
                    <q-btn flat dense round icon="add" size="xs" color="primary"
                      @click="patternAffiliateId = child.id; showAddPatternDialog = true">
                      <q-tooltip>Add Pattern</q-tooltip>
                    </q-btn>
                    <q-btn flat dense round icon="delete" size="xs" color="negative"
                      @click="removeAffiliate(child.id)">
                      <q-tooltip>Remove</q-tooltip>
                    </q-btn>
                  </div>
                  <div class="q-ml-xl q-mb-xs">
                    <q-chip v-for="pat in child.patterns" :key="pat.id"
                      removable dense size="sm" color="grey-3"
                      @remove="removePattern(child.id, pat.id)">
                      {{ pat.pattern }}
                    </q-chip>
                  </div>
                </div>

                <q-separator v-if="affiliateTree.indexOf(group) < affiliateTree.length - 1" class="q-my-xs" />
              </div>
            </div>

            <q-card-section v-else class="text-grey text-center">
              No affiliates yet. Add one to get started.
            </q-card-section>
          </q-card>
        </template>
      </div>

      <!-- ═══════════ RIGHT PANEL: Competitors ═══════════ -->
      <div class="col-12 col-md-4" style="max-height: calc(100vh - 130px); overflow-y: auto">
        <q-card v-if="!selectedCompanyId" flat bordered>
          <q-card-section class="text-grey text-center q-py-xl">
            Select a company to view competitors
          </q-card-section>
        </q-card>

        <q-card v-else flat bordered>
          <q-card-section class="row items-center q-pb-sm">
            <div class="text-h6">
              Competitors
              <q-badge color="primary" class="q-ml-sm">{{ competitors.length }}</q-badge>
            </div>
            <q-space />
            <q-btn flat dense icon="description" color="blue-grey" :loading="describingCompetitors"
              @click="describeCompetitors"
              :disable="!competitors.length">
              <q-tooltip>Describe All (LLM + web search)</q-tooltip>
            </q-btn>
            <q-btn flat dense icon="query_stats" color="teal" :loading="discoveringData"
              @click="discoverCompetitorsFromData"
              :disable="!companyDetail?.portfolios?.length">
              <q-tooltip>Discover from Citations (data-driven)</q-tooltip>
            </q-btn>
            <q-btn flat dense icon="auto_awesome" color="accent" :loading="discovering"
              @click="discoverCompetitors">
              <q-tooltip>Discover via AI (LLM + web search)</q-tooltip>
            </q-btn>
            <q-btn flat dense icon="add" color="primary"
              @click="showAddCompetitorDialog = true; competitorSearch = ''">
              <q-tooltip>Add Competitor</q-tooltip>
            </q-btn>
          </q-card-section>

          <q-separator />

          <q-card-section v-if="competitorsLoading" class="text-center">
            <q-spinner size="2em" />
          </q-card-section>

          <q-list v-else-if="competitors.length" separator dense>
            <q-item v-for="r in competitors" :key="r.id">
              <q-item-section>
                <q-item-label>
                  {{ r.competitor.displayName }}
                  <q-tooltip v-if="r.notes" anchor="top middle" self="bottom middle" max-width="400px">
                    {{ r.notes }}
                    <div v-if="r.strength" class="text-caption q-mt-xs">Strength: {{ (r.strength * 100).toFixed(0) }}%</div>
                  </q-tooltip>
                </q-item-label>
                <q-item-label caption>
                  <q-chip v-for="s in r.sectors" :key="s" dense size="xs" color="grey-3">{{ s }}</q-chip>
                  <span v-if="r.discoverySource !== 'MANUAL'" class="q-ml-xs text-grey-5">
                    {{ r.discoverySource.toLowerCase().replace(/_/g, ' ') }}
                  </span>
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn flat dense round icon="close" size="xs" color="negative"
                  @click="removeCompetitor(r.competitorId)">
                  <q-tooltip>Remove</q-tooltip>
                </q-btn>
              </q-item-section>
            </q-item>
          </q-list>

          <q-card-section v-else class="text-grey text-center">
            No competitors defined yet.
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- ═══════════ DIALOGS ═══════════ -->

    <!-- Create Company -->
    <q-dialog v-model="showCreateCompanyDialog">
      <q-card style="min-width: 400px">
        <q-card-section class="text-h6">Create Company</q-card-section>
        <q-card-section>
          <q-input v-model="newCompany.displayName" label="Display Name" dense outlined class="q-mb-sm"
            hint="e.g., Netflix, Amazon" autofocus />
          <q-input v-model="newCompany.name" label="Slug (auto-generated if empty)" dense outlined class="q-mb-sm"
            hint="e.g., netflix, amazon" />
          <q-input v-model="newCompany.description" label="Description" dense outlined class="q-mb-sm" />
          <q-input v-model="newCompany.website" label="Website" dense outlined />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Create" @click="createCompany"
            :disable="!newCompany.displayName" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Affiliate -->
    <q-dialog v-model="showAddAffiliateDialog">
      <q-card style="min-width: 450px">
        <q-card-section class="text-h6">Add Affiliate</q-card-section>
        <q-card-section>
          <q-input v-model="newAffiliate.name" label="Name (key)" dense outlined class="q-mb-sm"
            hint="e.g., Avago, VMware" />
          <q-input v-model="newAffiliate.displayName" label="Display Name" dense outlined class="q-mb-sm" />
          <q-input v-model.number="newAffiliate.acquiredYear" label="Acquired Year" dense outlined
            type="number" class="q-mb-sm" clearable />
          <q-input v-model="newAffiliate.notes" label="Notes" dense outlined class="q-mb-sm" />
          <q-input v-model="newAffiliate.patterns" label="Assignee Patterns (one per line)" dense outlined
            type="textarea" rows="4" class="q-mb-sm"
            hint="Enter one assignee match string per line" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Add" @click="addAffiliate"
            :disable="!newAffiliate.name || !newAffiliate.displayName" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Pattern -->
    <q-dialog v-model="showAddPatternDialog">
      <q-card style="min-width: 350px">
        <q-card-section class="text-h6">Add Pattern</q-card-section>
        <q-card-section>
          <q-input v-model="newPattern" label="Assignee Pattern" dense outlined autofocus />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Add" @click="addPattern" :disable="!newPattern" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Competitor from existing companies -->
    <q-dialog v-model="showAddCompetitorDialog">
      <q-card style="min-width: 400px">
        <q-card-section class="text-h6">Add Competitor</q-card-section>
        <q-card-section>
          <q-input v-model="competitorSearch" dense outlined placeholder="Search companies..." class="q-mb-md" autofocus />
          <q-list dense separator style="max-height: 300px; overflow-y: auto">
            <q-item v-for="c in availableCompetitors" :key="c.id" clickable @click="addCompetitor(c.id); showAddCompetitorDialog = false">
              <q-item-section>
                <q-item-label>{{ c.displayName }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon name="add" color="primary" />
              </q-item-section>
            </q-item>
            <q-item v-if="!availableCompetitors.length">
              <q-item-section class="text-grey text-center">No matching companies</q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Discover Competitors Results -->
    <q-dialog v-model="showDiscoverDialog" full-width>
      <q-card>
        <q-card-section class="text-h6">
          Discovered Competitors for "{{ selectedCompany?.displayName }}"
          <q-badge :color="discoverSource === 'data' ? 'teal' : 'accent'" class="q-ml-sm">
            {{ discoverSource === 'data' ? 'Citation Data' : 'AI Discovery' }}
          </q-badge>
        </q-card-section>

        <!-- Data stats banner -->
        <q-banner v-if="discoverDataStats" class="bg-blue-1 q-mx-md q-mb-sm" rounded dense>
          Analyzed {{ discoverDataStats.totalCiting.toLocaleString() }} citing patents
          across {{ discoverDataStats.withData }} patents with data.
          <span v-if="discoverDataStats.withoutData > 0" class="text-orange-8">
            {{ discoverDataStats.withoutData }} patents have no citing data yet — run enrichment to improve results.
          </span>
        </q-banner>

        <q-card-section>
          <!-- Select all / none header -->
          <div v-if="discoverSuggestions.length" class="row items-center q-mb-sm">
            <q-btn flat dense size="sm" :label="selectedCompetitorIdxs.size === discoverSuggestions.length ? 'Select None' : 'Select All'"
              @click="toggleAllCompetitors()" />
            <span class="text-caption text-grey q-ml-sm">({{ selectedCompetitorIdxs.size }} selected)</span>
          </div>
          <q-list v-if="discoverSuggestions.length" separator style="max-height: 60vh; overflow-y: auto">
            <q-item v-for="(s, i) in discoverSuggestions" :key="i">
              <q-item-section side>
                <q-checkbox :model-value="selectedCompetitorIdxs.has(i)" @update:model-value="toggleCompetitorIdx(i)" dense />
              </q-item-section>
              <q-item-section>
                <q-item-label>
                  {{ s.name }}
                  <q-badge v-if="s.strength" :color="s.strength > 0.5 ? 'red' : s.strength > 0.2 ? 'orange' : 'grey'" class="q-ml-sm">
                    {{ Math.round(s.strength * 100) }}%
                  </q-badge>
                </q-item-label>
                <q-item-label caption>
                  <template v-if="s.citationCount">
                    {{ s.citationCount }} citations across {{ s.patentsCited }} patents
                  </template>
                  <template v-else>
                    Sectors: {{ s.sectors?.join(', ') || 'General' }}
                  </template>
                </q-item-label>
                <q-item-label v-if="s.competingDivisions?.length" caption class="text-blue-6">
                  Competes with: {{ s.competingDivisions.join(', ') }}
                </q-item-label>
                <q-item-label caption v-if="s.notes" class="text-grey-6">{{ s.notes }}</q-item-label>
                <q-item-label v-if="s.variants?.length" caption class="text-grey-5">
                  Variants: {{ s.variants.join(', ') }}
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
          <div v-else class="text-grey text-center">No new competitors discovered.</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Close" v-close-popup />
          <q-btn v-if="selectedCompetitorIdxs.size > 0" color="primary"
            :label="`Accept Selected (${selectedCompetitorIdxs.size})`"
            :loading="acceptingBulk"
            @click="acceptSelectedCompetitors()" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Discover Affiliates Results -->
    <q-dialog v-model="showDiscoverAffiliatesDialog" full-width>
      <q-card>
        <q-card-section class="text-h6">
          Discovered Affiliates for "{{ selectedCompany?.displayName }}"
        </q-card-section>
        <q-card-section>
          <!-- Select all / none header -->
          <div v-if="affiliateSuggestions.length" class="row items-center q-mb-sm">
            <q-btn flat dense size="sm" :label="selectedAffiliateIdxs.size === affiliateSuggestions.length ? 'Select None' : 'Select All'"
              @click="toggleAllAffiliates()" />
            <span class="text-caption text-grey q-ml-sm">({{ selectedAffiliateIdxs.size }} selected)</span>
          </div>
          <q-list v-if="affiliateSuggestions.length" separator style="max-height: 60vh; overflow-y: auto">
            <q-item v-for="(s, i) in affiliateSuggestions" :key="i" class="q-py-sm">
              <q-item-section side>
                <q-checkbox :model-value="selectedAffiliateIdxs.has(i)" @update:model-value="toggleAffiliateIdx(i)" dense />
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-medium">
                  {{ s.displayName }}
                  <q-badge v-if="s.parent" color="blue-grey-7" class="q-ml-sm" dense>
                    &larr; {{ s.parent }}
                  </q-badge>
                </q-item-label>
                <q-item-label caption>
                  <span v-if="s.acquiredYear" class="q-mr-sm">Acquired {{ s.acquiredYear }}</span>
                  <span v-if="s.patterns.length">Patterns: {{ s.patterns.join(', ') }}</span>
                </q-item-label>
                <q-item-label v-if="s.description" caption class="text-blue-grey-6">{{ s.description }}</q-item-label>
                <q-item-label v-if="s.notes" caption class="text-grey-6">{{ s.notes }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
          <div v-else class="text-grey text-center">No new affiliates discovered.</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Close" v-close-popup />
          <q-btn v-if="selectedAffiliateIdxs.size > 0" color="primary"
            :label="`Accept Selected (${selectedAffiliateIdxs.size})`"
            :loading="acceptingBulk"
            @click="acceptSelectedAffiliates()" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Validate Patterns Results -->
    <q-dialog v-model="showValidateDialog" full-width>
      <q-card>
        <q-card-section class="row items-center">
          <div class="text-h6">Pattern Validation: {{ validationAffiliateName }}</div>
          <q-space />
          <q-input v-model="validationCpcPrefixes" dense outlined label="CPC Prefixes (comma-separated)"
            style="width: 280px" hint="e.g. H04N, H04L" />
        </q-card-section>
        <q-card-section>
          <q-spinner v-if="validating" size="2em" class="q-mb-md" />
          <q-markup-table v-else-if="validationResults.length" flat bordered dense separator="cell">
            <thead>
              <tr>
                <th class="text-left">Pattern</th>
                <th class="text-right">Total Patents</th>
                <th class="text-right">CPC Filtered</th>
                <th class="text-left">Sample Assignee Names</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in validationResults" :key="r.pattern">
                <td class="text-weight-medium">{{ r.pattern }}</td>
                <td class="text-right">{{ r.totalCount.toLocaleString() }}</td>
                <td class="text-right">{{ r.filteredCount !== null ? r.filteredCount.toLocaleString() : '—' }}</td>
                <td>
                  <q-chip v-for="name in r.sampleAssignees" :key="name" dense size="xs" color="grey-3">
                    {{ name }}
                  </q-chip>
                  <span v-if="!r.sampleAssignees.length" class="text-grey">No results</span>
                </td>
              </tr>
            </tbody>
          </q-markup-table>
          <div v-else class="text-grey text-center">No validation results.</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Create Portfolio -->
    <q-dialog v-model="showCreatePortfolioDialog">
      <q-card style="min-width: 400px">
        <q-card-section class="text-h6">Create Portfolio</q-card-section>
        <q-card-section>
          <q-input v-model="newPortfolio.displayName" label="Display Name" dense outlined class="q-mb-sm"
            hint="e.g., Netflix Video" autofocus />
          <q-input v-model="newPortfolio.name" label="Slug (auto-generated if empty)" dense outlined class="q-mb-sm"
            hint="e.g., netflix-video" />
          <q-input v-model="newPortfolio.description" label="Description" dense outlined />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Create" @click="createPortfolio"
            :disable="!newPortfolio.displayName" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Import Patents -->
    <q-dialog v-model="showImportDialog">
      <q-card style="min-width: 500px">
        <q-card-section class="text-h6">Import Patents: {{ importPortfolioName }}</q-card-section>
        <q-card-section>
          <div class="text-caption text-grey q-mb-md">
            Imports patents from PatentsView using this company's affiliate patterns.
          </div>
          <q-input v-model="importCpcPrefixes" label="CPC Prefixes (comma-separated)" dense outlined class="q-mb-sm"
            hint="Leave empty for all patents, or filter e.g. H04N, H04L" />
          <q-input v-model.number="importMaxPatents" label="Max Patents" dense outlined type="number" class="q-mb-sm"
            hint="Maximum number of patents to import (default 1000)" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Close" v-close-popup />
          <q-btn color="primary" label="Import" @click="importPatents"
            :loading="importing" :disable="importing" />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </q-page>
</template>
