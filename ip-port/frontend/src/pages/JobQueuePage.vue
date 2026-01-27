<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { patentApi, type EnrichmentSummary, type EnrichmentTierData } from '@/services/api';

const activeTab = ref('enrichment');

// ─── Enrichment Overview ────────────────────────────────────────────────────
const enrichmentData = ref<EnrichmentSummary | null>(null);
const enrichmentLoading = ref(false);
const enrichmentError = ref<string | null>(null);
const selectedTierSize = ref(5000);
const tierSizeOptions = [
  { value: 1000, label: '1,000' },
  { value: 2000, label: '2,000' },
  { value: 3000, label: '3,000' },
  { value: 5000, label: '5,000' }
];

async function loadEnrichmentSummary() {
  enrichmentLoading.value = true;
  enrichmentError.value = null;
  try {
    enrichmentData.value = await patentApi.getEnrichmentSummary(selectedTierSize.value);
  } catch (err) {
    enrichmentError.value = err instanceof Error ? err.message : 'Failed to load enrichment summary';
  } finally {
    enrichmentLoading.value = false;
  }
}

function enrichmentPct(count: number, total: number): number {
  return total > 0 ? Math.round(count / total * 1000) / 10 : 0;
}

function coverageColor(pct: number): string {
  if (pct >= 80) return 'positive';
  if (pct >= 50) return 'warning';
  if (pct >= 20) return 'orange';
  return 'negative';
}

// Metric descriptions for tooltips
const metricDescriptions: Record<string, string> = {
  'Patents': 'Number of patents in this tier',
  'v1 Score Range': 'Pre-screening score (v1): weighted combination of competitor citations (40%), forward citations (20%), remaining years (27%), and competitor count (13%), multiplied by a year-remaining decay factor. Range 0-100.',
  'Expired': 'Patents with 0 or fewer years of remaining term',
  'Active 3yr+': 'Patents with at least 3 years of remaining term',
  'Avg Years Left': 'Average remaining patent term in years across the tier',
  'Median Years Left': 'Median remaining patent term in years across the tier',
  'Avg Forward Cites': 'Average number of forward citations (patents that cite this patent) from the PatentsView database',
  'Avg Competitor Cites': 'Average number of forward citations originating from known competitor companies, identified via the citation classification pipeline',
  'LLM Coverage': 'Patents with AI-generated analysis (summary, legal scores, classification) from the LLM enrichment pipeline',
  'Prosecution': 'Patents with prosecution history data retrieved from the USPTO File Wrapper API',
  'IPR / PTAB': 'Patents checked for inter partes review (IPR) and Patent Trial & Appeal Board (PTAB) proceedings',
  'Families': 'Patents with backward citation (parent patent) data from the patent families pipeline',
};

// ─── Job Queue (existing) ───────────────────────────────────────────────────
const statusFilter = ref('all');
const jobs = ref<Array<{
  id: string;
  type: string;
  status: string;
  patentId: string;
  createdAt: string;
  completedAt?: string;
}>>([]);

const statusOptions = [
  { value: 'all', label: 'All Jobs' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' }
];

const columns = [
  { name: 'id', label: 'Job ID', field: 'id', align: 'left' as const },
  { name: 'type', label: 'Type', field: 'type', align: 'left' as const },
  { name: 'patentId', label: 'Patent', field: 'patentId', align: 'left' as const },
  { name: 'status', label: 'Status', field: 'status', align: 'center' as const },
  { name: 'createdAt', label: 'Created', field: 'createdAt', align: 'center' as const },
  { name: 'actions', label: 'Actions', field: 'actions', align: 'center' as const }
];

function getStatusColor(status: string) {
  switch (status) {
    case 'PENDING': return 'grey';
    case 'RUNNING': return 'blue';
    case 'COMPLETED': return 'positive';
    case 'FAILED': return 'negative';
    default: return 'grey';
  }
}

onMounted(() => {
  loadEnrichmentSummary();
});
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5 q-mr-md">Jobs &amp; Enrichment</div>
    </div>

    <!-- Tab Navigation -->
    <q-tabs v-model="activeTab" class="q-mb-md" align="left" active-color="primary">
      <q-tab name="enrichment" label="Enrichment Overview" icon="analytics" />
      <q-tab name="jobs" label="Job Queue" icon="list" />
    </q-tabs>

    <q-tab-panels v-model="activeTab" animated>
      <!-- ═══ Enrichment Overview Tab ═══ -->
      <q-tab-panel name="enrichment" class="q-pa-none">
        <!-- Tier size selector -->
        <div class="row items-center q-mb-md q-gutter-md">
          <span class="text-subtitle2">Tier Size:</span>
          <q-select
            v-model="selectedTierSize"
            :options="tierSizeOptions"
            emit-value
            map-options
            outlined
            dense
            style="min-width: 120px"
            @update:model-value="loadEnrichmentSummary"
          />
          <q-btn flat icon="refresh" label="Refresh" :loading="enrichmentLoading" @click="loadEnrichmentSummary" />
        </div>

        <!-- Loading -->
        <div v-if="enrichmentLoading && !enrichmentData" class="row justify-center q-pa-xl">
          <q-spinner size="lg" color="primary" />
        </div>

        <!-- Error -->
        <q-banner v-else-if="enrichmentError" class="bg-negative text-white q-mb-md">
          {{ enrichmentError }}
          <template v-slot:action>
            <q-btn flat label="Retry" @click="loadEnrichmentSummary" />
          </template>
        </q-banner>

        <!-- Data -->
        <template v-else-if="enrichmentData">
          <!-- Overall Summary Cards -->
          <div class="row q-gutter-md q-mb-lg">
            <q-card class="col">
              <q-card-section class="text-center">
                <div class="text-h4">{{ enrichmentData.totalPatents.toLocaleString() }}</div>
                <div class="text-grey-6">Total Patents</div>
              </q-card-section>
            </q-card>
            <q-card class="col">
              <q-card-section>
                <div class="row items-center justify-between q-mb-xs">
                  <span class="text-weight-medium">LLM Analysis</span>
                  <span class="text-caption">{{ enrichmentData.enrichmentTotals.llm.toLocaleString() }} / {{ enrichmentData.totalPatents.toLocaleString() }}</span>
                </div>
                <q-linear-progress
                  :value="enrichmentData.enrichmentTotals.llm / enrichmentData.totalPatents"
                  :color="coverageColor(enrichmentPct(enrichmentData.enrichmentTotals.llm, enrichmentData.totalPatents))"
                  size="20px"
                  rounded
                >
                  <div class="absolute-full flex flex-center">
                    <span class="text-caption text-white text-weight-bold">{{ enrichmentPct(enrichmentData.enrichmentTotals.llm, enrichmentData.totalPatents) }}%</span>
                  </div>
                </q-linear-progress>
              </q-card-section>
            </q-card>
            <q-card class="col">
              <q-card-section>
                <div class="row items-center justify-between q-mb-xs">
                  <span class="text-weight-medium">Prosecution</span>
                  <span class="text-caption">{{ enrichmentData.enrichmentTotals.prosecution.toLocaleString() }} / {{ enrichmentData.totalPatents.toLocaleString() }}</span>
                </div>
                <q-linear-progress
                  :value="enrichmentData.enrichmentTotals.prosecution / enrichmentData.totalPatents"
                  :color="coverageColor(enrichmentPct(enrichmentData.enrichmentTotals.prosecution, enrichmentData.totalPatents))"
                  size="20px"
                  rounded
                >
                  <div class="absolute-full flex flex-center">
                    <span class="text-caption text-white text-weight-bold">{{ enrichmentPct(enrichmentData.enrichmentTotals.prosecution, enrichmentData.totalPatents) }}%</span>
                  </div>
                </q-linear-progress>
              </q-card-section>
            </q-card>
            <q-card class="col">
              <q-card-section>
                <div class="row items-center justify-between q-mb-xs">
                  <span class="text-weight-medium">IPR / PTAB</span>
                  <span class="text-caption">{{ enrichmentData.enrichmentTotals.ipr.toLocaleString() }} / {{ enrichmentData.totalPatents.toLocaleString() }}</span>
                </div>
                <q-linear-progress
                  :value="enrichmentData.enrichmentTotals.ipr / enrichmentData.totalPatents"
                  :color="coverageColor(enrichmentPct(enrichmentData.enrichmentTotals.ipr, enrichmentData.totalPatents))"
                  size="20px"
                  rounded
                >
                  <div class="absolute-full flex flex-center">
                    <span class="text-caption text-white text-weight-bold">{{ enrichmentPct(enrichmentData.enrichmentTotals.ipr, enrichmentData.totalPatents) }}%</span>
                  </div>
                </q-linear-progress>
              </q-card-section>
            </q-card>
            <q-card class="col">
              <q-card-section>
                <div class="row items-center justify-between q-mb-xs">
                  <span class="text-weight-medium">Families</span>
                  <span class="text-caption">{{ enrichmentData.enrichmentTotals.family.toLocaleString() }} / {{ enrichmentData.totalPatents.toLocaleString() }}</span>
                </div>
                <q-linear-progress
                  :value="enrichmentData.enrichmentTotals.family / enrichmentData.totalPatents"
                  :color="coverageColor(enrichmentPct(enrichmentData.enrichmentTotals.family, enrichmentData.totalPatents))"
                  size="20px"
                  rounded
                >
                  <div class="absolute-full flex flex-center">
                    <span class="text-caption text-white text-weight-bold">{{ enrichmentPct(enrichmentData.enrichmentTotals.family, enrichmentData.totalPatents) }}%</span>
                  </div>
                </q-linear-progress>
              </q-card-section>
            </q-card>
          </div>

          <!-- Tier Comparison Table -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section class="q-pb-none">
              <div class="text-subtitle1">Tier Comparison</div>
              <div class="text-caption text-grey-7">Patents ranked by v1 pre-screening score, broken into tiers of {{ selectedTierSize.toLocaleString() }}. Hover metric names for definitions.</div>
            </q-card-section>
            <q-card-section>
              <div class="tier-table-scroll">
                <table class="tier-table">
                  <thead>
                    <tr>
                      <th class="metric-col">Metric</th>
                      <th v-for="tier in enrichmentData.tiers" :key="tier.tierLabel">{{ tier.tierLabel }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <!-- Basic Stats -->
                    <tr>
                      <td class="metric-col text-weight-medium metric-label">
                        Patents
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]">{{ metricDescriptions['Patents'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-count'">{{ tier.count.toLocaleString() }}</td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-medium metric-label">
                        v1 Score Range
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]" max-width="350px">{{ metricDescriptions['v1 Score Range'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-score'">{{ tier.scoreRange }}</td>
                    </tr>
                    <tr class="section-separator">
                      <td class="metric-col text-weight-medium metric-label">
                        Expired
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]">{{ metricDescriptions['Expired'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-expired'">
                        {{ tier.expired.toLocaleString() }}
                        <span class="text-grey-6">({{ Math.round(tier.expired / tier.count * 100) }}%)</span>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-medium metric-label">
                        Active 3yr+
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]">{{ metricDescriptions['Active 3yr+'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-active'">
                        {{ tier.active3yr.toLocaleString() }}
                        <span class="text-grey-6">({{ Math.round(tier.active3yr / tier.count * 100) }}%)</span>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-medium metric-label">
                        Avg Years Left
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]">{{ metricDescriptions['Avg Years Left'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-yravg'">{{ tier.yearsRemaining.avg }}</td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-medium metric-label">
                        Median Years Left
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]">{{ metricDescriptions['Median Years Left'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-yrmed'">{{ tier.yearsRemaining.median }}</td>
                    </tr>
                    <tr class="section-separator">
                      <td class="metric-col text-weight-medium metric-label">
                        Avg Forward Cites
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]">{{ metricDescriptions['Avg Forward Cites'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-fc'">{{ tier.forwardCitations.avg }}</td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-medium metric-label">
                        Avg Competitor Cites
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]" max-width="350px">{{ metricDescriptions['Avg Competitor Cites'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-cc'">{{ tier.competitorCitations.avg }}</td>
                    </tr>

                    <!-- Enrichment Coverage -->
                    <tr class="section-separator">
                      <td class="metric-col text-weight-bold metric-label">
                        LLM Coverage
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]" max-width="350px">{{ metricDescriptions['LLM Coverage'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-llm'">
                        <div class="enrichment-cell">
                          <q-linear-progress
                            :value="tier.enrichment.llmPct / 100"
                            :color="coverageColor(tier.enrichment.llmPct)"
                            size="16px"
                            rounded
                            class="q-mb-xs"
                          />
                          <span class="text-caption">{{ tier.enrichment.llm.toLocaleString() }} ({{ tier.enrichment.llmPct }}%)</span>
                          <q-badge v-if="tier.enrichment.llmPct < 20" color="negative" floating>!</q-badge>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold metric-label">
                        Prosecution
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]" max-width="350px">{{ metricDescriptions['Prosecution'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-pros'">
                        <div class="enrichment-cell">
                          <q-linear-progress
                            :value="tier.enrichment.prosecutionPct / 100"
                            :color="coverageColor(tier.enrichment.prosecutionPct)"
                            size="16px"
                            rounded
                            class="q-mb-xs"
                          />
                          <span class="text-caption">{{ tier.enrichment.prosecution.toLocaleString() }} ({{ tier.enrichment.prosecutionPct }}%)</span>
                          <q-badge v-if="tier.enrichment.prosecutionPct < 20" color="negative" floating>!</q-badge>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold metric-label">
                        IPR / PTAB
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]" max-width="350px">{{ metricDescriptions['IPR / PTAB'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-ipr'">
                        <div class="enrichment-cell">
                          <q-linear-progress
                            :value="tier.enrichment.iprPct / 100"
                            :color="coverageColor(tier.enrichment.iprPct)"
                            size="16px"
                            rounded
                            class="q-mb-xs"
                          />
                          <span class="text-caption">{{ tier.enrichment.ipr.toLocaleString() }} ({{ tier.enrichment.iprPct }}%)</span>
                          <q-badge v-if="tier.enrichment.iprPct < 20" color="negative" floating>!</q-badge>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td class="metric-col text-weight-bold metric-label">
                        Families
                        <q-tooltip anchor="center right" self="center left" :offset="[8, 0]" max-width="350px">{{ metricDescriptions['Families'] }}</q-tooltip>
                      </td>
                      <td v-for="tier in enrichmentData.tiers" :key="tier.tierLabel + '-fam'">
                        <div class="enrichment-cell">
                          <q-linear-progress
                            :value="tier.enrichment.familyPct / 100"
                            :color="coverageColor(tier.enrichment.familyPct)"
                            size="16px"
                            rounded
                            class="q-mb-xs"
                          />
                          <span class="text-caption">{{ tier.enrichment.family.toLocaleString() }} ({{ tier.enrichment.familyPct }}%)</span>
                          <q-badge v-if="tier.enrichment.familyPct < 20" color="negative" floating>!</q-badge>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </q-card-section>
          </q-card>
        </template>
      </q-tab-panel>

      <!-- ═══ Job Queue Tab ═══ -->
      <q-tab-panel name="jobs" class="q-pa-none">
        <div class="row items-center q-mb-md">
          <q-select
            v-model="statusFilter"
            :options="statusOptions"
            emit-value
            map-options
            outlined
            dense
            style="min-width: 150px"
          />
          <q-space />
          <q-btn color="primary" label="New Job" icon="add" />
        </div>

        <!-- Stats Cards -->
        <div class="row q-gutter-md q-mb-md">
          <q-card class="col">
            <q-card-section class="text-center">
              <div class="text-h4">0</div>
              <div class="text-grey-6">Pending</div>
            </q-card-section>
          </q-card>
          <q-card class="col">
            <q-card-section class="text-center">
              <div class="text-h4 text-blue">0</div>
              <div class="text-grey-6">Running</div>
            </q-card-section>
          </q-card>
          <q-card class="col">
            <q-card-section class="text-center">
              <div class="text-h4 text-positive">0</div>
              <div class="text-grey-6">Completed (24h)</div>
            </q-card-section>
          </q-card>
          <q-card class="col">
            <q-card-section class="text-center">
              <div class="text-h4 text-negative">0</div>
              <div class="text-grey-6">Failed</div>
            </q-card-section>
          </q-card>
        </div>

        <!-- Jobs Table -->
        <q-table
          :rows="jobs"
          :columns="columns"
          row-key="id"
          flat
          bordered
        >
          <template v-slot:body-cell-status="props">
            <q-td :props="props">
              <q-badge :color="getStatusColor(props.row.status)">
                {{ props.row.status }}
              </q-badge>
            </q-td>
          </template>

          <template v-slot:body-cell-actions="props">
            <q-td :props="props">
              <q-btn
                v-if="props.row.status === 'FAILED'"
                flat
                dense
                icon="refresh"
                color="primary"
              />
              <q-btn
                v-if="props.row.status === 'PENDING'"
                flat
                dense
                icon="cancel"
                color="negative"
              />
            </q-td>
          </template>

          <template v-slot:no-data>
            <div class="full-width row flex-center text-grey q-pa-xl">
              <q-icon size="2em" name="inbox" class="q-mr-sm" />
              No jobs in queue
            </div>
          </template>
        </q-table>
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<style scoped>
.tier-table-scroll {
  overflow-x: auto;
}

.tier-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.tier-table th,
.tier-table td {
  padding: 8px 12px;
  text-align: center;
  border-bottom: 1px solid #e0e0e0;
  white-space: nowrap;
}

.tier-table th {
  background: #f5f5f5;
  font-weight: 600;
  position: sticky;
  top: 0;
}

.tier-table .metric-col {
  text-align: left;
  min-width: 160px;
  position: sticky;
  left: 0;
  background: #fff;
  z-index: 1;
}

.tier-table th.metric-col {
  background: #f5f5f5;
  z-index: 2;
}

.tier-table tr.section-separator td {
  border-top: 2px solid #bdbdbd;
}

.metric-label {
  cursor: help;
  border-bottom: 1px dotted #9e9e9e;
}

.enrichment-cell {
  position: relative;
  min-width: 140px;
}
</style>
