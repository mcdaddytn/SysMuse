<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import api from '@/services/api';

const props = defineProps<{
  patentId: string;
}>();

const loading = ref(false);
const data = ref<any>(null);
const error = ref<string | null>(null);

async function loadData() {
  loading.value = true;
  error.value = null;
  try {
    const { data: resp } = await api.get(`/patents/${props.patentId}/prosecution-detail`);
    data.value = resp;
  } catch (err: any) {
    error.value = err?.response?.data?.error || err.message || 'Failed to load prosecution detail';
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
watch(() => props.patentId, loadData);

function estoppelColor(severity: string): string {
  switch (severity) {
    case 'HIGH': return 'negative';
    case 'MEDIUM': return 'warning';
    case 'LOW': return 'grey-6';
    default: return 'grey-4';
  }
}

function basisColor(basis: string): string {
  switch (basis) {
    case '101': return 'red';
    case '102': return 'orange';
    case '103': return 'deep-orange';
    case '112': return 'purple';
    case 'double-patenting': return 'blue-grey';
    default: return 'grey';
  }
}
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="loading" class="flex flex-center q-pa-lg">
      <q-spinner color="primary" size="2em" />
      <span class="q-ml-sm text-grey">Loading claim-level prosecution analysis...</span>
    </div>

    <!-- Error -->
    <q-banner v-else-if="error" class="bg-negative text-white q-mb-md">
      {{ error }}
    </q-banner>

    <!-- Not analyzed yet -->
    <div v-else-if="!data?.cached" class="text-center text-grey q-pa-lg">
      <q-icon name="fact_check" size="3em" class="q-mb-sm" />
      <div>Claim-level prosecution analysis not yet available.</div>
      <div class="text-caption q-mt-xs">Run the "Prosecution Detail (Claims)" enrichment job to analyze this patent.</div>
    </div>

    <!-- Analysis results -->
    <template v-else>
      <!-- Summary cards -->
      <div class="row q-col-gutter-md q-mb-md">
        <div class="col-2">
          <q-card flat bordered>
            <q-card-section class="text-center">
              <div class="text-h4">{{ data.prosecutionScore || '—' }}</div>
              <div class="text-caption">Score (1-5)</div>
            </q-card-section>
          </q-card>
        </div>
        <div class="col-2">
          <q-card flat bordered>
            <q-card-section class="text-center">
              <div class="text-h4">{{ data.totalActions || 0 }}</div>
              <div class="text-caption">Office Actions</div>
            </q-card-section>
          </q-card>
        </div>
        <div class="col-2">
          <q-card flat bordered>
            <q-card-section class="text-center">
              <div class="text-h4">{{ data.totalRejections || 0 }}</div>
              <div class="text-caption">Rejections</div>
            </q-card-section>
          </q-card>
        </div>
        <div class="col-2">
          <q-card flat bordered>
            <q-card-section class="text-center">
              <div class="text-h4">{{ data.totalRCEs || 0 }}</div>
              <div class="text-caption">RCEs</div>
            </q-card-section>
          </q-card>
        </div>
        <div class="col-2">
          <q-card flat bordered>
            <q-card-section class="text-center">
              <div class="text-h4">{{ (data.estoppelArguments || []).length }}</div>
              <div class="text-caption">Estoppel Risks</div>
            </q-card-section>
          </q-card>
        </div>
        <div class="col-2">
          <q-card flat bordered>
            <q-card-section class="text-center">
              <div class="text-h4">{{ (data.citedPriorArt || []).length }}</div>
              <div class="text-caption">Prior Art Refs</div>
            </q-card-section>
          </q-card>
        </div>
      </div>

      <!-- Office Action Timeline -->
      <q-card flat bordered class="q-mb-md" v-if="(data.officeActions || []).length > 0">
        <q-card-section>
          <div class="text-subtitle1 text-weight-medium">Office Action Timeline</div>
        </q-card-section>
        <q-separator />
        <q-card-section>
          <q-timeline color="primary">
            <q-timeline-entry
              v-for="(oa, idx) in data.officeActions"
              :key="idx"
              :title="`${oa.actionType === 'final' ? 'Final' : 'Non-Final'} Rejection`"
              :subtitle="oa.mailDate"
              :icon="oa.actionType === 'final' ? 'warning' : 'description'"
              :color="oa.actionType === 'final' ? 'negative' : 'primary'"
            >
              <!-- Claim rejections -->
              <div v-if="(oa.claimRejections || []).length > 0" class="q-mb-sm">
                <q-badge
                  v-for="rej in oa.claimRejections"
                  :key="`${idx}-${rej.claimNumber}-${rej.statutoryBasis}`"
                  :color="basisColor(rej.statutoryBasis)"
                  class="q-mr-xs q-mb-xs"
                >
                  Cl.{{ rej.claimNumber }} &sect;{{ rej.statutoryBasis }}
                </q-badge>
              </div>
              <!-- Examiner reasoning -->
              <div v-if="oa.examinerReasoning" class="text-body2 text-grey-8">
                {{ oa.examinerReasoning }}
              </div>
            </q-timeline-entry>
          </q-timeline>
        </q-card-section>
      </q-card>

      <!-- Estoppel Risk Assessment -->
      <q-card flat bordered class="q-mb-md" v-if="(data.estoppelArguments || []).length > 0">
        <q-card-section>
          <div class="text-subtitle1 text-weight-medium">Prosecution Estoppel Risks</div>
        </q-card-section>
        <q-separator />
        <q-list separator>
          <q-item v-for="(est, idx) in data.estoppelArguments" :key="idx">
            <q-item-section avatar>
              <q-badge :color="estoppelColor(est.severity)" :label="est.severity" />
            </q-item-section>
            <q-item-section>
              <q-item-label>Claim {{ est.claimNumber }} — {{ est.argumentType }}</q-item-label>
              <q-item-label caption>{{ est.description }}</q-item-label>
              <q-item-label caption class="text-italic">Scope impact: {{ est.scopeImpact }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <!-- Narrowed Claims -->
      <q-card flat bordered class="q-mb-md" v-if="(data.narrowedClaims || []).length > 0">
        <q-card-section>
          <div class="text-subtitle1 text-weight-medium">Narrowing Amendments</div>
        </q-card-section>
        <q-separator />
        <q-list separator>
          <q-item v-for="(nc, idx) in data.narrowedClaims" :key="idx">
            <q-item-section>
              <q-item-label>Claim {{ nc.claimNumber }}</q-item-label>
              <q-item-label caption>{{ nc.narrowingDescription || nc.amendmentType }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <!-- Cited Prior Art -->
      <q-card flat bordered class="q-mb-md" v-if="(data.citedPriorArt || []).length > 0">
        <q-card-section>
          <div class="text-subtitle1 text-weight-medium">Cited Prior Art</div>
        </q-card-section>
        <q-separator />
        <q-list separator>
          <q-item v-for="(art, idx) in data.citedPriorArt" :key="idx">
            <q-item-section>
              <q-item-label>{{ art.designation }} <span class="text-caption">({{ art.referenceType }})</span></q-item-label>
              <q-item-label caption>
                Claims: {{ (art.relevantClaims || []).join(', ') || 'N/A' }}
                <span v-if="art.relevanceDescription"> — {{ art.relevanceDescription }}</span>
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-badge :color="art.citationPurpose === 'primary' ? 'deep-orange' : 'grey'" :label="art.citationPurpose || 'N/A'" />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <!-- Metadata -->
      <div class="text-caption text-grey-5 q-mt-md">
        Analyzed {{ data.analyzedAt ? new Date(data.analyzedAt).toLocaleDateString() : 'N/A' }}
        using {{ data.llmModel || 'N/A' }}
        &bull; {{ data.documentCount || 0 }} documents
        &bull; Sources: {{ (data.dataSources || []).join(', ') || 'N/A' }}
      </div>
    </template>
  </div>
</template>
