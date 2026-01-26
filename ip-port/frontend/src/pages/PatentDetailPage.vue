<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Patent } from '@/types';

const route = useRoute();
const router = useRouter();
const patentId = ref(route.params.id as string);
const loading = ref(true);
const error = ref<string | null>(null);
const activeTab = ref('overview');

// Patent data from API
const patent = ref<Patent | null>(null);

// Citation data
const citations = ref<{
  total_hits: number;
  citing_patent_ids: string[];
  citing_patents?: Array<{
    patent_id: string;
    patent_title: string;
    assignee: string;
    patent_date: string;
    affiliate?: string;
    in_portfolio?: boolean;
  }>;
  cached: boolean;
  message?: string;
  classification?: {
    competitor_citations: number;
    affiliate_citations: number;
    neutral_citations: number;
    competitor_count: number;
    competitor_names: string[];
  };
} | null>(null);
const loadingCitations = ref(false);

// Prosecution data
const prosecution = ref<any>(null);
const loadingProsecution = ref(false);

// PTAB/IPR data
const ptab = ref<any>(null);
const loadingPtab = ref(false);

// LLM analysis data
const llmData = ref<any>(null);
const loadingLlm = ref(false);

// Backward citations data
const backwardCitations = ref<any>(null);
const loadingBackward = ref(false);

// CPC descriptions
const cpcDescriptions = ref<Record<string, string | null>>({});

// Computed
const isExpired = computed(() => patent.value && patent.value.remaining_years <= 0);
const expirationDate = computed(() => {
  if (!patent.value?.patent_date) return null;
  const grant = new Date(patent.value.patent_date);
  grant.setFullYear(grant.getFullYear() + 20);
  return grant.toISOString().slice(0, 10);
});

// Super-sector color mapping
const sectorColors: Record<string, string> = {
  'Security': 'red-7',
  'Virtualization & Cloud': 'purple-7',
  'SDN & Network Infrastructure': 'blue-7',
  'Wireless & RF': 'teal-7',
  'Video & Streaming': 'orange-7',
  'Computing & Data': 'grey-7',
  'Semiconductor': 'indigo-7',
  'Imaging & Optics': 'cyan-7',
  'Audio': 'pink-7',
  'AI & Machine Learning': 'green-7',
  'Fault Tolerance & Reliability': 'amber-7'
};

function getSectorColor(sector: string): string {
  return sectorColors[sector] || 'grey-6';
}

// Load patent from API
async function loadPatent() {
  loading.value = true;
  error.value = null;

  try {
    const response = await fetch(`/api/patents/${patentId.value}`);
    if (!response.ok) {
      throw new Error('Patent not found');
    }
    patent.value = await response.json();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load patent';
    console.error('Failed to load patent:', err);
  } finally {
    loading.value = false;
  }
}

// Load citations when tab is selected
async function loadCitations() {
  if (citations.value || loadingCitations.value) return;

  loadingCitations.value = true;
  try {
    const response = await fetch(`/api/patents/${patentId.value}/citations`);
    if (response.ok) {
      citations.value = await response.json();
    }
  } catch (err) {
    console.error('Failed to load citations:', err);
  } finally {
    loadingCitations.value = false;
  }
}

// Load prosecution data
async function loadProsecution() {
  if (prosecution.value || loadingProsecution.value) return;
  loadingProsecution.value = true;
  try {
    const response = await fetch(`/api/patents/${patentId.value}/prosecution`);
    if (response.ok) {
      prosecution.value = await response.json();
    }
  } catch (err) {
    console.error('Failed to load prosecution:', err);
  } finally {
    loadingProsecution.value = false;
  }
}

// Load PTAB/IPR data
async function loadPtab() {
  if (ptab.value || loadingPtab.value) return;
  loadingPtab.value = true;
  try {
    const response = await fetch(`/api/patents/${patentId.value}/ptab`);
    if (response.ok) {
      ptab.value = await response.json();
    }
  } catch (err) {
    console.error('Failed to load PTAB data:', err);
  } finally {
    loadingPtab.value = false;
  }
}

// Load LLM analysis data
async function loadLlm() {
  if (llmData.value || loadingLlm.value) return;
  loadingLlm.value = true;
  try {
    const response = await fetch(`/api/patents/${patentId.value}/llm`);
    if (response.ok) {
      llmData.value = await response.json();
    }
  } catch (err) {
    console.error('Failed to load LLM data:', err);
  } finally {
    loadingLlm.value = false;
  }
}

// Load backward citations
async function loadBackwardCitations() {
  if (backwardCitations.value || loadingBackward.value) return;
  loadingBackward.value = true;
  try {
    const response = await fetch(`/api/patents/${patentId.value}/backward-citations`);
    if (response.ok) {
      backwardCitations.value = await response.json();
    }
  } catch (err) {
    console.error('Failed to load backward citations:', err);
  } finally {
    loadingBackward.value = false;
  }
}

// Load CPC descriptions for the patent's codes
async function loadCpcDescriptions() {
  if (!patent.value?.cpc_codes?.length) return;
  try {
    const codes = patent.value.cpc_codes.join(',');
    const response = await fetch(`/api/patents/cpc-descriptions?codes=${encodeURIComponent(codes)}`);
    if (response.ok) {
      cpcDescriptions.value = await response.json();
    }
  } catch (err) {
    console.error('Failed to load CPC descriptions:', err);
  }
}

// Watch for tab changes to lazy-load data
function onTabChange(tab: string) {
  if (tab === 'citations') {
    loadCitations();
    loadBackwardCitations();
  }
  if (tab === 'prosecution') loadProsecution();
  if (tab === 'ptab') loadPtab();
  if (tab === 'llm') loadLlm();
}

onMounted(async () => {
  await loadPatent();
  loadCpcDescriptions();
});

function goBack() {
  router.back();
}

function openUSPTO() {
  window.open(`https://patents.google.com/patent/US${patentId.value}`, '_blank');
}
</script>

<template>
  <q-page padding>
    <!-- Loading State -->
    <div v-if="loading" class="flex flex-center q-pa-xl">
      <q-spinner color="primary" size="3em" />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="q-pa-xl text-center">
      <q-icon name="error" color="negative" size="3em" class="q-mb-md" />
      <div class="text-h6 text-negative">{{ error }}</div>
      <q-btn flat color="primary" label="Go Back" @click="goBack" class="q-mt-md" />
    </div>

    <!-- Patent Details -->
    <template v-else-if="patent">
      <!-- Header -->
      <div class="row items-center q-mb-md">
        <q-btn flat icon="arrow_back" @click="goBack" class="q-mr-md" />
        <div class="col">
          <div class="row items-center q-gutter-sm">
            <span class="text-h5">US{{ patent.patent_id }}</span>
            <q-badge v-if="isExpired" color="negative">Expired</q-badge>
            <q-badge v-else color="positive">Active</q-badge>
            <q-chip
              dense
              :color="getSectorColor(patent.super_sector)"
              text-color="white"
              size="sm"
            >
              {{ patent.super_sector }}
            </q-chip>
          </div>
          <div class="text-subtitle1 text-grey-7">{{ patent.patent_title }}</div>
        </div>
        <q-space />
        <q-btn outline color="primary" icon="open_in_new" label="Google Patents" class="q-mr-sm" @click="openUSPTO" />
        <q-btn outline color="secondary" label="Queue Jobs" icon="queue" />
      </div>

      <q-tabs v-model="activeTab" class="text-primary q-mb-md" @update:model-value="onTabChange">
        <q-tab name="overview" label="Overview" icon="info" />
        <q-tab name="citations" label="Citations" icon="format_quote">
          <q-badge v-if="patent.forward_citations > 0" color="primary" floating>
            {{ patent.forward_citations }}
          </q-badge>
        </q-tab>
        <q-tab name="prosecution" label="Prosecution" icon="gavel" />
        <q-tab name="ptab" label="PTAB/IPR" icon="balance" />
        <q-tab name="llm" label="LLM Analysis" icon="psychology" />
        <q-tab name="vendor" label="Vendor Data" icon="integration_instructions" />
      </q-tabs>

      <q-tab-panels v-model="activeTab" animated>
        <!-- Overview -->
        <q-tab-panel name="overview">
          <!-- Abstract -->
          <q-card class="q-mb-md" flat bordered>
            <q-card-section>
              <div class="text-subtitle2 q-mb-sm">Abstract</div>
              <div v-if="patent.abstract" class="text-body2" style="white-space: pre-line;">{{ patent.abstract }}</div>
              <div v-else class="text-body2 text-grey-5 text-italic">Abstract not cached. View on Google Patents.</div>
            </q-card-section>
          </q-card>

          <div class="row q-gutter-md">
            <!-- Basic Information Card -->
            <q-card class="col-12 col-md-6">
              <q-card-section>
                <div class="text-h6 q-mb-sm">Basic Information</div>
                <q-list dense>
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>Patent ID</q-item-label>
                      <q-item-label>US{{ patent.patent_id }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>Grant Date</q-item-label>
                      <q-item-label>{{ patent.patent_date }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>Expiration Date</q-item-label>
                      <q-item-label :class="isExpired ? 'text-negative' : ''">
                        {{ expirationDate }}
                        <span v-if="!isExpired" class="text-grey-6">
                          ({{ patent.remaining_years.toFixed(1) }} years remaining)
                        </span>
                      </q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-separator spaced />
                  <q-item clickable @click="router.push({ path: '/', query: { affiliates: patent.affiliate } })">
                    <q-item-section>
                      <q-item-label caption>Affiliate</q-item-label>
                      <q-item-label class="text-primary text-weight-medium">{{ patent.affiliate }}</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-icon name="filter_list" color="grey-6" />
                    </q-item-section>
                  </q-item>
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>Assignee (Raw)</q-item-label>
                      <q-item-label class="text-grey-7">{{ patent.assignee }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-card-section>
            </q-card>

            <!-- Classification Card -->
            <q-card class="col-12 col-md-6">
              <q-card-section>
                <div class="text-h6 q-mb-sm">Classification</div>
                <q-list dense>
                  <q-item clickable @click="router.push({ path: '/', query: { superSectors: patent.super_sector } })">
                    <q-item-section>
                      <q-item-label caption>Super-Sector</q-item-label>
                      <q-item-label>
                        <q-chip
                          dense
                          :color="getSectorColor(patent.super_sector)"
                          text-color="white"
                          size="sm"
                        >
                          {{ patent.super_sector }}
                        </q-chip>
                      </q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-icon name="filter_list" color="grey-6" />
                    </q-item-section>
                  </q-item>
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>Primary Sector</q-item-label>
                      <q-item-label>{{ patent.primary_sector }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-separator spaced />
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>CPC Codes</q-item-label>
                      <div class="q-gutter-xs q-mt-xs">
                        <q-chip
                          v-for="cpc in patent.cpc_codes"
                          :key="cpc"
                          dense
                          outline
                          size="sm"
                        >
                          {{ cpc }}
                          <q-tooltip v-if="cpcDescriptions[cpc]" :delay="300" max-width="300px">
                            <strong>{{ cpc }}</strong><br />
                            {{ cpcDescriptions[cpc] }}
                          </q-tooltip>
                          <q-tooltip v-else :delay="300">
                            {{ cpc }}
                          </q-tooltip>
                        </q-chip>
                      </div>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-card-section>
            </q-card>

            <!-- Scores Card -->
            <q-card class="col-12 col-md-6">
              <q-card-section>
                <div class="text-h6 q-mb-sm">Metrics</div>
                <q-list dense>
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>Forward Citations</q-item-label>
                      <q-item-label class="text-h6">{{ patent.forward_citations }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="patent.competitor_citations">
                    <q-item-section>
                      <q-item-label caption>Competitor Citations</q-item-label>
                      <q-item-label class="text-h6 text-primary">{{ patent.competitor_citations }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-separator spaced />
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>Base Score</q-item-label>
                      <q-item-label>
                        <q-badge
                          :color="patent.score > 100 ? 'positive' : patent.score > 50 ? 'warning' : 'grey'"
                          class="text-body1"
                        >
                          {{ patent.score?.toFixed(1) || '0' }}
                        </q-badge>
                      </q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-card-section>
            </q-card>
          </div>
        </q-tab-panel>

      <!-- Citations -->
      <q-tab-panel name="citations">
        <!-- Classification Summary -->
        <q-card v-if="citations?.classification" class="q-mb-md" flat bordered>
          <q-card-section>
            <div class="text-subtitle2 q-mb-sm">Forward Citation Breakdown</div>
            <div class="row q-gutter-md">
              <div class="text-center">
                <div class="text-h5 text-primary">{{ citations.classification.competitor_citations }}</div>
                <div class="text-caption">Competitor</div>
              </div>
              <div class="text-center">
                <div class="text-h5 text-orange">{{ citations.classification.affiliate_citations }}</div>
                <div class="text-caption">Affiliate</div>
              </div>
              <div class="text-center">
                <div class="text-h5 text-grey">{{ citations.classification.neutral_citations }}</div>
                <div class="text-caption">Neutral</div>
              </div>
              <div class="text-center">
                <div class="text-h5">{{ citations.total_hits }}</div>
                <div class="text-caption">Total Forward</div>
              </div>
              <q-separator vertical class="q-mx-sm" />
              <div class="text-center">
                <div class="text-h5 text-deep-purple">{{ backwardCitations?.parent_count ?? '...' }}</div>
                <div class="text-caption">Backward (Parents)</div>
              </div>
            </div>
            <div v-if="citations.classification.competitor_names?.length" class="q-mt-sm">
              <span class="text-caption text-grey-7">Competitors: </span>
              <q-chip
                v-for="name in citations.classification.competitor_names"
                :key="name"
                dense
                outline
                size="sm"
                class="q-mr-xs"
              >{{ name }}</q-chip>
            </div>
          </q-card-section>
        </q-card>

        <!-- Forward Citations -->
        <q-card class="q-mb-md">
          <q-card-section>
            <div class="row items-center q-mb-md">
              <q-icon name="arrow_forward" color="primary" size="sm" class="q-mr-sm" />
              <div class="text-h6">Forward Citations</div>
              <div class="text-caption text-grey-6 q-ml-sm">(patents that cite this patent)</div>
              <q-space />
              <q-badge color="primary" class="q-ml-sm">
                {{ citations?.total_hits ?? patent.forward_citations }} total
              </q-badge>
            </div>

            <!-- Loading -->
            <div v-if="loadingCitations" class="flex flex-center q-pa-lg">
              <q-spinner color="primary" size="2em" />
              <span class="q-ml-sm text-grey">Loading citation data...</span>
            </div>

            <!-- Not Cached -->
            <div v-else-if="citations?.cached === false" class="text-center q-pa-lg">
              <q-icon name="hourglass_empty" color="warning" size="3em" class="q-mb-md" />
              <div class="text-body1 text-grey-7">{{ citations.message }}</div>
            </div>

            <!-- No Citations -->
            <div v-else-if="!citations?.total_hits" class="text-center q-pa-lg">
              <q-icon name="format_quote" color="grey-4" size="3em" class="q-mb-md" />
              <div class="text-body1 text-grey-7">No forward citations found for this patent.</div>
            </div>

            <!-- Citation List -->
            <q-list v-else separator>
              <q-item
                v-for="citing in (citations.citing_patents || [])"
                :key="citing.patent_id"
                :clickable="citing.in_portfolio"
                @click="citing.in_portfolio && router.push({ name: 'patent-detail', params: { id: citing.patent_id } })"
              >
                <q-item-section avatar>
                  <q-icon
                    :name="citing.in_portfolio ? 'link' : 'link_off'"
                    :color="citing.in_portfolio ? 'primary' : 'grey-4'"
                    size="sm"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label :class="citing.in_portfolio ? 'text-primary cursor-pointer' : 'text-grey-7'">
                    US{{ citing.patent_id }}
                  </q-item-label>
                  <q-item-label v-if="citing.patent_title" caption class="ellipsis">{{ citing.patent_title }}</q-item-label>
                </q-item-section>
                <q-item-section side top>
                  <q-item-label caption>{{ citing.patent_date }}</q-item-label>
                  <q-item-label caption class="text-grey-6">{{ citing.affiliate || citing.assignee }}</q-item-label>
                </q-item-section>
                <q-item-section v-if="citing.in_portfolio" side>
                  <q-icon name="chevron_right" />
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>

        <!-- Backward Citations (Parents) -->
        <q-card>
          <q-card-section>
            <div class="row items-center q-mb-md">
              <q-icon name="arrow_back" color="deep-purple" size="sm" class="q-mr-sm" />
              <div class="text-h6">Backward Citations</div>
              <div class="text-caption text-grey-6 q-ml-sm">(patents cited by this patent)</div>
              <q-space />
              <q-badge v-if="backwardCitations?.cached" color="deep-purple" class="q-ml-sm">
                {{ backwardCitations.parent_count }} parents
              </q-badge>
            </div>

            <!-- Loading -->
            <div v-if="loadingBackward" class="flex flex-center q-pa-lg">
              <q-spinner color="deep-purple" size="2em" />
              <span class="q-ml-sm text-grey">Loading backward citations...</span>
            </div>

            <!-- Not Cached -->
            <div v-else-if="!backwardCitations?.cached" class="text-center q-pa-lg">
              <q-icon name="hourglass_empty" color="warning" size="3em" class="q-mb-md" />
              <div class="text-body1 text-grey-7">
                {{ backwardCitations?.message || 'Backward citation data not yet cached for this patent.' }}
              </div>
            </div>

            <!-- No Parents -->
            <div v-else-if="backwardCitations.parent_count === 0" class="text-center q-pa-lg">
              <q-icon name="source" color="grey-4" size="3em" class="q-mb-md" />
              <div class="text-body1 text-grey-7">No parent patents found.</div>
            </div>

            <!-- Parent Patent List -->
            <q-list v-else separator>
              <q-item
                v-for="parent in backwardCitations.parent_patents"
                :key="parent.patent_id"
                :clickable="parent.in_portfolio"
                @click="parent.in_portfolio && router.push({ name: 'patent-detail', params: { id: parent.patent_id } })"
              >
                <q-item-section avatar>
                  <q-icon
                    :name="parent.in_portfolio ? 'link' : 'open_in_new'"
                    :color="parent.in_portfolio ? 'deep-purple' : 'grey-4'"
                    size="sm"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label :class="parent.in_portfolio ? 'text-deep-purple cursor-pointer' : 'text-grey-7'">
                    US{{ parent.patent_id }}
                  </q-item-label>
                  <q-item-label v-if="parent.patent_title" caption class="ellipsis">{{ parent.patent_title }}</q-item-label>
                </q-item-section>
                <q-item-section side top>
                  <q-item-label caption>{{ parent.patent_date }}</q-item-label>
                  <q-item-label caption class="text-grey-6">{{ parent.affiliate || parent.assignee }}</q-item-label>
                </q-item-section>
                <q-item-section v-if="parent.in_portfolio" side>
                  <q-icon name="chevron_right" />
                </q-item-section>
                <q-item-section v-else-if="parent.patent_id" side>
                  <q-btn
                    flat
                    dense
                    icon="open_in_new"
                    size="sm"
                    color="grey-6"
                    tag="a"
                    :href="`https://patents.google.com/patent/US${parent.patent_id}`"
                    target="_blank"
                    @click.stop
                  />
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </q-tab-panel>

      <!-- Prosecution -->
      <q-tab-panel name="prosecution">
        <!-- Loading -->
        <div v-if="loadingProsecution" class="flex flex-center q-pa-lg">
          <q-spinner color="primary" size="2em" />
          <span class="q-ml-sm text-grey">Loading prosecution history...</span>
        </div>

        <!-- Not Cached -->
        <q-card v-else-if="!prosecution?.cached">
          <q-card-section class="text-center q-pa-xl">
            <q-icon name="gavel" color="grey-4" size="3em" class="q-mb-md" />
            <div class="text-body1 text-grey-7">
              {{ prosecution?.message || 'Prosecution history not yet retrieved for this patent.' }}
            </div>
          </q-card-section>
        </q-card>

        <!-- Has Data -->
        <template v-else>
          <!-- Score Summary -->
          <q-card class="q-mb-md" flat bordered>
            <q-card-section>
              <div class="row items-center q-gutter-md">
                <div class="text-center">
                  <q-circular-progress
                    :value="(prosecution.prosecution_quality_score / 5) * 100"
                    size="60px"
                    :thickness="0.2"
                    :color="prosecution.prosecution_quality_score >= 4 ? 'positive' : prosecution.prosecution_quality_score >= 3 ? 'warning' : 'negative'"
                    track-color="grey-3"
                  >
                    {{ prosecution.prosecution_quality_score }}
                  </q-circular-progress>
                  <div class="text-caption q-mt-xs">Quality Score</div>
                </div>
                <div>
                  <q-badge :color="prosecution.prosecution_quality_score >= 4 ? 'positive' : prosecution.prosecution_quality_score >= 3 ? 'warning' : 'negative'">
                    {{ prosecution.prosecution_quality_category }}
                  </q-badge>
                </div>
              </div>
            </q-card-section>
          </q-card>

          <!-- Details -->
          <div class="row q-gutter-md">
            <q-card class="col-12 col-md-5">
              <q-card-section>
                <div class="text-subtitle2 q-mb-sm">Filing Details</div>
                <q-list dense>
                  <q-item v-if="prosecution.application_number">
                    <q-item-section>
                      <q-item-label caption>Application Number</q-item-label>
                      <q-item-label>{{ prosecution.application_number }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="prosecution.filing_date">
                    <q-item-section>
                      <q-item-label caption>Filing Date</q-item-label>
                      <q-item-label>{{ prosecution.filing_date }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="prosecution.grant_date">
                    <q-item-section>
                      <q-item-label caption>Grant Date</q-item-label>
                      <q-item-label>{{ prosecution.grant_date }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="prosecution.time_to_grant_months">
                    <q-item-section>
                      <q-item-label caption>Time to Grant</q-item-label>
                      <q-item-label>{{ prosecution.time_to_grant_months }} months</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-card-section>
            </q-card>

            <q-card class="col-12 col-md-5">
              <q-card-section>
                <div class="text-subtitle2 q-mb-sm">Prosecution Metrics</div>
                <q-list dense>
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>Office Actions</q-item-label>
                      <q-item-label>{{ prosecution.office_actions_count }} ({{ prosecution.non_final_rejections }} non-final, {{ prosecution.final_rejections }} final)</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>RCEs Filed</q-item-label>
                      <q-item-label>{{ prosecution.rce_count }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>Continuations / Divisionals</q-item-label>
                      <q-item-label>{{ prosecution.continuation_count }} / {{ prosecution.divisional_count }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item>
                    <q-item-section>
                      <q-item-label caption>Total Documents</q-item-label>
                      <q-item-label>{{ prosecution.total_documents }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-card-section>
            </q-card>
          </div>

          <!-- Key Events Timeline -->
          <q-card v-if="prosecution.key_events?.length" class="q-mt-md">
            <q-card-section>
              <div class="text-subtitle2 q-mb-sm">Key Events</div>
              <q-timeline color="primary" layout="dense">
                <q-timeline-entry
                  v-for="(event, i) in prosecution.key_events"
                  :key="i"
                  :subtitle="event.date || 'No date'"
                  :color="event.type === 'rejection' ? 'negative' : event.type === 'allowance' ? 'positive' : event.type === 'response' ? 'info' : 'grey'"
                  :icon="event.type === 'rejection' ? 'cancel' : event.type === 'allowance' ? 'check_circle' : event.type === 'response' ? 'reply' : 'description'"
                >
                  {{ event.description }}
                </q-timeline-entry>
              </q-timeline>
            </q-card-section>
          </q-card>
        </template>
      </q-tab-panel>

      <!-- PTAB -->
      <q-tab-panel name="ptab">
        <!-- Loading -->
        <div v-if="loadingPtab" class="flex flex-center q-pa-lg">
          <q-spinner color="primary" size="2em" />
          <span class="q-ml-sm text-grey">Loading PTAB/IPR data...</span>
        </div>

        <!-- Not Cached -->
        <q-card v-else-if="!ptab?.cached">
          <q-card-section class="text-center q-pa-xl">
            <q-icon name="balance" color="grey-4" size="3em" class="q-mb-md" />
            <div class="text-body1 text-grey-7">
              {{ ptab?.message || 'IPR/PTAB data not yet retrieved for this patent.' }}
            </div>
          </q-card-section>
        </q-card>

        <!-- Has Data -->
        <template v-else>
          <!-- Risk Summary -->
          <q-card class="q-mb-md" flat bordered>
            <q-card-section>
              <div class="row items-center q-gutter-md">
                <div class="text-center">
                  <q-circular-progress
                    :value="(ptab.ipr_risk_score / 5) * 100"
                    size="60px"
                    :thickness="0.2"
                    :color="ptab.ipr_risk_score >= 4 ? 'positive' : ptab.ipr_risk_score >= 3 ? 'warning' : 'negative'"
                    track-color="grey-3"
                  >
                    {{ ptab.ipr_risk_score }}
                  </q-circular-progress>
                  <div class="text-caption q-mt-xs">IPR Risk Score</div>
                </div>
                <div>
                  <q-badge :color="ptab.ipr_risk_score >= 4 ? 'positive' : ptab.ipr_risk_score >= 3 ? 'warning' : 'negative'">
                    {{ ptab.ipr_risk_category }}
                  </q-badge>
                  <div class="q-mt-xs text-caption text-grey-7">
                    (5 = no IPR history, 1 = claims invalidated)
                  </div>
                </div>
              </div>
            </q-card-section>
          </q-card>

          <!-- No IPR History -->
          <q-card v-if="!ptab.has_ipr_history">
            <q-card-section class="text-center q-pa-lg">
              <q-icon name="verified" color="positive" size="3em" class="q-mb-md" />
              <div class="text-h6 text-positive">No IPR Proceedings</div>
              <div class="text-body2 text-grey-7">This patent has no Inter Partes Review history at the PTAB.</div>
            </q-card-section>
          </q-card>

          <!-- Has IPR History -->
          <template v-else>
            <div class="row q-gutter-md q-mb-md">
              <q-card class="col-12 col-md-5">
                <q-card-section>
                  <div class="text-subtitle2 q-mb-sm">Petition Summary</div>
                  <q-list dense>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Petitions Filed</q-item-label>
                        <q-item-label class="text-h6">{{ ptab.petitions_filed }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Instituted</q-item-label>
                        <q-item-label>{{ ptab.petitions_instituted }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Denied</q-item-label>
                        <q-item-label>{{ ptab.petitions_denied }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Settled</q-item-label>
                        <q-item-label>{{ ptab.petitions_settled }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </q-card-section>
              </q-card>

              <q-card class="col-12 col-md-5">
                <q-card-section>
                  <div class="text-subtitle2 q-mb-sm">Claims</div>
                  <q-list dense>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Claims Challenged</q-item-label>
                        <q-item-label>{{ ptab.claims_challenged }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Claims Invalidated</q-item-label>
                        <q-item-label :class="ptab.claims_invalidated > 0 ? 'text-negative' : ''">{{ ptab.claims_invalidated }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item>
                      <q-item-section>
                        <q-item-label caption>Claims Upheld</q-item-label>
                        <q-item-label :class="ptab.claims_upheld > 0 ? 'text-positive' : ''">{{ ptab.claims_upheld }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </q-card-section>
              </q-card>
            </div>

            <!-- Petitioners -->
            <q-card v-if="ptab.petitioner_names?.length" class="q-mb-md">
              <q-card-section>
                <div class="text-subtitle2 q-mb-sm">Petitioners</div>
                <q-chip v-for="name in ptab.petitioner_names" :key="name" outline dense>{{ name }}</q-chip>
              </q-card-section>
            </q-card>

            <!-- Trial Details -->
            <q-card v-if="ptab.details?.length">
              <q-card-section>
                <div class="text-subtitle2 q-mb-sm">Trial Details</div>
                <q-list separator>
                  <q-item v-for="trial in ptab.details" :key="trial.trial_number">
                    <q-item-section>
                      <q-item-label class="text-weight-bold">{{ trial.trial_number }}</q-item-label>
                      <q-item-label caption>{{ trial.petitioner }} &middot; {{ trial.trial_type }}</q-item-label>
                      <q-item-label caption>Status: {{ trial.status }}</q-item-label>
                    </q-item-section>
                    <q-item-section side top>
                      <q-item-label caption>Filed: {{ trial.filing_date || 'N/A' }}</q-item-label>
                      <q-item-label v-if="trial.outcome" caption>{{ trial.outcome }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-card-section>
            </q-card>
          </template>
        </template>
      </q-tab-panel>

      <!-- LLM Analysis -->
      <q-tab-panel name="llm">
        <!-- Loading -->
        <div v-if="loadingLlm" class="flex flex-center q-pa-lg">
          <q-spinner color="primary" size="2em" />
          <span class="q-ml-sm text-grey">Loading LLM analysis...</span>
        </div>

        <!-- Not Cached -->
        <q-card v-else-if="!llmData?.cached">
          <q-card-section class="text-center q-pa-xl">
            <q-icon name="psychology" color="grey-4" size="3em" class="q-mb-md" />
            <div class="text-body1 text-grey-7">
              {{ llmData?.message || 'LLM analysis not yet available for this patent.' }}
            </div>
            <div class="text-caption text-grey-5 q-mt-sm">
              Analysis is generated in batch. This patent may not yet have been processed.
            </div>
          </q-card-section>
        </q-card>

        <!-- Has LLM Data -->
        <template v-else>
          <!-- Attorney Text Fields -->
          <q-card v-if="llmData.summary || llmData.prior_art_problem || llmData.technical_solution" class="q-mb-md" flat bordered>
            <q-card-section>
              <div class="text-subtitle2 q-mb-sm">AI Summary</div>
              <div v-if="llmData.summary" class="text-body2 q-mb-md" style="white-space: pre-line;">{{ llmData.summary }}</div>
            </q-card-section>
            <q-separator v-if="llmData.prior_art_problem" />
            <q-card-section v-if="llmData.prior_art_problem">
              <div class="text-subtitle2 q-mb-sm">Prior Art Problem</div>
              <div class="text-body2" style="white-space: pre-line;">{{ llmData.prior_art_problem }}</div>
            </q-card-section>
            <q-separator v-if="llmData.technical_solution" />
            <q-card-section v-if="llmData.technical_solution">
              <div class="text-subtitle2 q-mb-sm">Technical Solution</div>
              <div class="text-body2" style="white-space: pre-line;">{{ llmData.technical_solution }}</div>
            </q-card-section>
          </q-card>

          <div class="row q-gutter-md q-mb-md">
            <!-- Scores Card -->
            <q-card class="col-12 col-md-5">
              <q-card-section>
                <div class="text-subtitle2 q-mb-sm">Quality Scores</div>
                <q-list dense>
                  <q-item v-if="llmData.eligibility_score">
                    <q-item-section>
                      <q-item-label caption>Eligibility (101)</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge
                        :color="llmData.eligibility_score >= 4 ? 'positive' : llmData.eligibility_score >= 3 ? 'warning' : 'negative'"
                      >
                        {{ llmData.eligibility_score }} / 5
                      </q-badge>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.validity_score">
                    <q-item-section>
                      <q-item-label caption>Validity</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge
                        :color="llmData.validity_score >= 4 ? 'positive' : llmData.validity_score >= 3 ? 'warning' : 'negative'"
                      >
                        {{ llmData.validity_score }} / 5
                      </q-badge>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.claim_breadth">
                    <q-item-section>
                      <q-item-label caption>Claim Breadth</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge
                        :color="llmData.claim_breadth >= 4 ? 'positive' : llmData.claim_breadth >= 3 ? 'warning' : 'negative'"
                      >
                        {{ llmData.claim_breadth }} / 5
                      </q-badge>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.enforcement_clarity">
                    <q-item-section>
                      <q-item-label caption>Enforcement Clarity</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge
                        :color="llmData.enforcement_clarity >= 4 ? 'positive' : llmData.enforcement_clarity >= 3 ? 'warning' : 'negative'"
                      >
                        {{ llmData.enforcement_clarity }} / 5
                      </q-badge>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.design_around_difficulty">
                    <q-item-section>
                      <q-item-label caption>Design-Around Difficulty</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge
                        :color="llmData.design_around_difficulty >= 4 ? 'positive' : llmData.design_around_difficulty >= 3 ? 'warning' : 'negative'"
                      >
                        {{ llmData.design_around_difficulty }} / 5
                      </q-badge>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.claim_clarity_score">
                    <q-item-section>
                      <q-item-label caption>Claim Clarity</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge
                        :color="llmData.claim_clarity_score >= 4 ? 'positive' : llmData.claim_clarity_score >= 3 ? 'warning' : 'negative'"
                      >
                        {{ llmData.claim_clarity_score }} / 5
                      </q-badge>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.evidence_accessibility_score">
                    <q-item-section>
                      <q-item-label caption>Evidence Accessibility</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge
                        :color="llmData.evidence_accessibility_score >= 4 ? 'positive' : llmData.evidence_accessibility_score >= 3 ? 'warning' : 'negative'"
                      >
                        {{ llmData.evidence_accessibility_score }} / 5
                      </q-badge>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.trend_alignment_score">
                    <q-item-section>
                      <q-item-label caption>Trend Alignment</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge
                        :color="llmData.trend_alignment_score >= 4 ? 'positive' : llmData.trend_alignment_score >= 3 ? 'warning' : 'negative'"
                      >
                        {{ llmData.trend_alignment_score }} / 5
                      </q-badge>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.investigation_priority_score">
                    <q-item-section>
                      <q-item-label caption>Investigation Priority</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge
                        :color="llmData.investigation_priority_score >= 4 ? 'positive' : llmData.investigation_priority_score >= 3 ? 'warning' : 'negative'"
                      >
                        {{ llmData.investigation_priority_score }} / 5
                      </q-badge>
                    </q-item-section>
                  </q-item>
                  <q-separator spaced v-if="llmData.confidence" />
                  <q-item v-if="llmData.confidence">
                    <q-item-section>
                      <q-item-label caption>AI Confidence</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge color="grey-7">{{ llmData.confidence }} / 5</q-badge>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-card-section>
            </q-card>

            <!-- Classification Card -->
            <q-card class="col-12 col-md-5">
              <q-card-section>
                <div class="text-subtitle2 q-mb-sm">Classification</div>
                <q-list dense>
                  <q-item v-if="llmData.technology_category">
                    <q-item-section>
                      <q-item-label caption>Technology Category</q-item-label>
                      <q-item-label>{{ llmData.technology_category }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.implementation_type">
                    <q-item-section>
                      <q-item-label caption>Implementation Type</q-item-label>
                      <q-item-label>{{ llmData.implementation_type }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.standards_relevance">
                    <q-item-section>
                      <q-item-label caption>Standards Relevance</q-item-label>
                      <q-item-label>{{ llmData.standards_relevance }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.market_segment">
                    <q-item-section>
                      <q-item-label caption>Market Segment</q-item-label>
                      <q-item-label>{{ llmData.market_segment }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.market_relevance_score">
                    <q-item-section>
                      <q-item-label caption>Market Relevance Score</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-badge
                        :color="llmData.market_relevance_score >= 4 ? 'positive' : llmData.market_relevance_score >= 3 ? 'warning' : 'negative'"
                      >
                        {{ llmData.market_relevance_score }} / 5
                      </q-badge>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.detection_method">
                    <q-item-section>
                      <q-item-label caption>Detection Method</q-item-label>
                      <q-item-label>{{ llmData.detection_method }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.implementation_complexity">
                    <q-item-section>
                      <q-item-label caption>Implementation Complexity</q-item-label>
                      <q-item-label>{{ llmData.implementation_complexity }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.claim_type_primary">
                    <q-item-section>
                      <q-item-label caption>Primary Claim Type</q-item-label>
                      <q-item-label>{{ llmData.claim_type_primary }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.geographic_scope">
                    <q-item-section>
                      <q-item-label caption>Geographic Scope</q-item-label>
                      <q-item-label>{{ llmData.geographic_scope }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.lifecycle_stage">
                    <q-item-section>
                      <q-item-label caption>Lifecycle Stage</q-item-label>
                      <q-item-label>{{ llmData.lifecycle_stage }}</q-item-label>
                    </q-item-section>
                  </q-item>
                  <q-separator spaced v-if="llmData.product_types?.length || llmData.likely_implementers?.length || llmData.standards_bodies?.length" />
                  <q-item v-if="llmData.product_types?.length">
                    <q-item-section>
                      <q-item-label caption>Product Types</q-item-label>
                      <div class="q-gutter-xs q-mt-xs">
                        <q-chip v-for="pt in llmData.product_types" :key="pt" size="sm" dense color="blue-1" text-color="blue-9">{{ pt }}</q-chip>
                      </div>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.likely_implementers?.length">
                    <q-item-section>
                      <q-item-label caption>Likely Implementers</q-item-label>
                      <div class="q-gutter-xs q-mt-xs">
                        <q-chip v-for="li in llmData.likely_implementers" :key="li" size="sm" dense color="orange-1" text-color="orange-9">{{ li }}</q-chip>
                      </div>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="llmData.standards_bodies?.length">
                    <q-item-section>
                      <q-item-label caption>Standards Bodies</q-item-label>
                      <div class="q-gutter-xs q-mt-xs">
                        <q-chip v-for="sb in llmData.standards_bodies" :key="sb" size="sm" dense color="teal-1" text-color="teal-9">{{ sb }}</q-chip>
                      </div>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-card-section>
            </q-card>
          </div>

          <!-- Source Info -->
          <q-card v-if="llmData.source || llmData.imported_at" flat bordered>
            <q-card-section class="q-py-sm">
              <div class="text-caption text-grey-6">
                <span v-if="llmData.source">Source: {{ llmData.source }}</span>
                <span v-if="llmData.source && llmData.imported_at"> &middot; </span>
                <span v-if="llmData.imported_at">Imported: {{ new Date(llmData.imported_at).toLocaleDateString() }}</span>
              </div>
            </q-card-section>
          </q-card>
        </template>
      </q-tab-panel>

      <!-- Vendor Data -->
      <q-tab-panel name="vendor">
        <q-card>
          <q-card-section>
            <div class="text-h6">Vendor Data (Patlytics, etc.)</div>
            <div class="text-grey q-pa-xl text-center">
              Third-party vendor data will appear here.
              <br /><br />
              <q-btn color="primary" label="Request Patlytics Data" icon="cloud_download" />
            </div>
          </q-card-section>
        </q-card>
      </q-tab-panel>
    </q-tab-panels>
    </template>
  </q-page>
</template>

<style scoped>
</style>
