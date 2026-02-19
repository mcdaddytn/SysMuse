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
const discoverSuggestions = ref<Array<{ name: string; slug: string; sectors: string[]; notes: string }>>([]);
const showDiscoverDialog = ref(false);

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

async function acceptCompetitorSuggestion(suggestion: { name: string; slug: string; sectors: string[] }) {
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
    // Create competitor relationship
    await companyApi.addCompetitor(selectedCompanyId.value, {
      competitorId: company.id,
      sectors: suggestion.sectors,
      discoverySource: 'LLM_SUGGESTED',
    });
    discoverSuggestions.value = discoverSuggestions.value.filter(s => s.slug !== suggestion.slug);
    await loadCompetitors(selectedCompanyId.value);
    await loadCompanies();
  } catch (err: unknown) {
    error.value = (err as Error).message;
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

    <div class="row q-col-gutter-md">
      <!-- ═══════════ LEFT PANEL: Company List ═══════════ -->
      <div class="col-12 col-md-3">
        <q-card flat bordered>
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
            </q-item-label>
            <q-list separator dense style="max-height: 400px; overflow-y: auto">
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
      <div class="col-12 col-md-5">
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
                <q-btn flat dense icon="person_add" color="primary" class="q-mr-sm"
                  @click="showAddAffiliateDialog = true">
                  <q-tooltip>Add Affiliate</q-tooltip>
                </q-btn>
              </div>
            </q-card-section>
          </q-card>

          <!-- Portfolios -->
          <q-card v-if="companyDetail?.portfolios?.length" flat bordered class="q-mb-md">
            <q-card-section class="q-pb-sm">
              <div class="text-subtitle1 text-weight-medium">Portfolios</div>
            </q-card-section>
            <q-separator />
            <q-list dense separator>
              <q-item v-for="p in companyDetail.portfolios" :key="p.id">
                <q-item-section>
                  <q-item-label>{{ p.displayName }}</q-item-label>
                  <q-item-label caption>
                    {{ p.dataSourceType === 'JSON_PIPELINE' ? 'ElasticSearch' : 'DB Records' }}
                    &middot; {{ p._count?.patents ?? p.patentCount ?? 0 }} patents
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-badge :color="p.dataSourceType === 'JSON_PIPELINE' ? 'primary' : 'secondary'" outline>
                    {{ p.dataSourceType === 'JSON_PIPELINE' ? 'ES' : 'DB' }}
                  </q-badge>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card>

          <!-- Affiliates Tree -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section class="q-pb-sm">
              <div class="text-subtitle1 text-weight-medium">Affiliates & Patterns</div>
            </q-card-section>
            <q-separator />

            <q-card-section v-if="detailLoading" class="text-center">
              <q-spinner size="2em" />
            </q-card-section>

            <div v-else-if="affiliateTree.length">
              <div v-for="group in affiliateTree" :key="group.id" class="q-pa-sm">
                <!-- Top-level affiliate -->
                <div class="row items-center q-pa-xs">
                  <q-icon name="business" class="q-mr-sm text-grey-6" />
                  <div class="text-weight-medium">{{ group.displayName }}</div>
                  <q-badge v-if="group.acquiredYear" color="grey-4" text-color="grey-8" class="q-ml-sm">
                    {{ group.acquiredYear }}
                  </q-badge>
                  <q-space />
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
                  <div class="row items-center q-pa-xs">
                    <q-icon name="subdirectory_arrow_right" class="q-mr-sm text-grey-5" size="xs" />
                    <div>{{ child.displayName }}</div>
                    <q-badge v-if="child.acquiredYear" color="grey-4" text-color="grey-8" class="q-ml-sm">
                      {{ child.acquiredYear }}
                    </q-badge>
                    <q-space />
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
      <div class="col-12 col-md-4">
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
            <q-btn flat dense icon="auto_awesome" color="accent" :loading="discovering"
              @click="discoverCompetitors">
              <q-tooltip>Discover Competitors (LLM)</q-tooltip>
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

          <q-list v-else-if="competitors.length" separator dense style="max-height: 600px; overflow-y: auto">
            <q-item v-for="r in competitors" :key="r.id">
              <q-item-section>
                <q-item-label>{{ r.competitor.displayName }}</q-item-label>
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
        </q-card-section>
        <q-card-section>
          <q-list v-if="discoverSuggestions.length" separator>
            <q-item v-for="(s, i) in discoverSuggestions" :key="i">
              <q-item-section>
                <q-item-label>{{ s.name }}</q-item-label>
                <q-item-label caption>
                  Sectors: {{ s.sectors?.join(', ') || 'General' }}
                </q-item-label>
                <q-item-label caption v-if="s.notes" class="text-grey-6">{{ s.notes }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn flat dense color="primary" label="Accept" @click="acceptCompetitorSuggestion(s)" />
              </q-item-section>
            </q-item>
          </q-list>
          <div v-else class="text-grey text-center">No new competitors discovered.</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Close" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Error banner -->
    <q-banner v-if="error" class="bg-red-1 text-red-8 q-mt-md" rounded>
      {{ error }}
      <template v-slot:action>
        <q-btn flat dense label="Dismiss" @click="error = null" />
      </template>
    </q-banner>
  </q-page>
</template>
