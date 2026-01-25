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
  }>;
  cached: boolean;
  message?: string;
} | null>(null);
const loadingCitations = ref(false);

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

// Watch for tab changes to lazy-load data
function onTabChange(tab: string) {
  if (tab === 'citations') {
    loadCitations();
  }
}

onMounted(() => {
  loadPatent();
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
        <q-card>
          <q-card-section>
            <div class="row items-center q-mb-md">
              <div class="text-h6">Forward Citations</div>
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
              <q-btn
                color="primary"
                label="Queue Citation Analysis"
                icon="queue"
                class="q-mt-md"
                @click="console.log('Queue citation job for', patentId)"
              />
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
                clickable
                @click="router.push({ name: 'patent-detail', params: { id: citing.patent_id } })"
              >
                <q-item-section>
                  <q-item-label>US{{ citing.patent_id }}</q-item-label>
                  <q-item-label caption class="ellipsis">{{ citing.patent_title }}</q-item-label>
                </q-item-section>
                <q-item-section side top>
                  <q-item-label caption>{{ citing.patent_date }}</q-item-label>
                  <q-item-label caption class="text-grey-6">{{ citing.assignee }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-icon name="chevron_right" />
                </q-item-section>
              </q-item>

              <!-- Show IDs if no detailed data -->
              <template v-if="!citations.citing_patents?.length && citations.citing_patent_ids?.length">
                <q-item
                  v-for="citingId in citations.citing_patent_ids"
                  :key="citingId"
                  clickable
                  @click="router.push({ name: 'patent-detail', params: { id: citingId } })"
                >
                  <q-item-section>
                    <q-item-label>US{{ citingId }}</q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <q-icon name="chevron_right" />
                  </q-item-section>
                </q-item>
              </template>
            </q-list>
          </q-card-section>
        </q-card>
      </q-tab-panel>

      <!-- Prosecution -->
      <q-tab-panel name="prosecution">
        <q-card>
          <q-card-section>
            <div class="text-h6">Prosecution History</div>
            <div class="text-grey q-pa-xl text-center">
              File wrapper data will be loaded from USPTO ODP API.
            </div>
          </q-card-section>
        </q-card>
      </q-tab-panel>

      <!-- PTAB -->
      <q-tab-panel name="ptab">
        <q-card>
          <q-card-section>
            <div class="text-h6">PTAB/IPR Proceedings</div>
            <div class="text-grey q-pa-xl text-center">
              PTAB data will be loaded from USPTO ODP API.
            </div>
          </q-card-section>
        </q-card>
      </q-tab-panel>

      <!-- LLM Analysis -->
      <q-tab-panel name="llm">
        <q-card>
          <q-card-section>
            <div class="text-h6">LLM Analysis Results</div>
            <div class="text-grey q-pa-xl text-center">
              LLM analysis results will appear here.
              <br /><br />
              <q-btn color="primary" label="Run New Analysis" icon="psychology" />
            </div>
          </q-card-section>
        </q-card>
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
