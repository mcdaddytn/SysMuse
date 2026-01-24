<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();
const patentId = ref(route.params.id as string);
const loading = ref(true);
const activeTab = ref('overview');

// Mock patent data
const patent = ref({
  patent_id: patentId.value,
  patent_title: 'Loading...',
  patent_date: '',
  assignee: '',
  forward_citations: 0,
  remaining_years: 0,
  score: 0
});

onMounted(() => {
  // TODO: Load patent details from API
  setTimeout(() => {
    loading.value = false;
    patent.value = {
      patent_id: patentId.value,
      patent_title: 'Example Patent Title for Demonstration',
      patent_date: '2020-01-15',
      assignee: 'Broadcom Corporation',
      forward_citations: 42,
      remaining_years: 14.2,
      score: 87.5
    };
  }, 500);
});

function goBack() {
  router.back();
}
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <q-btn flat icon="arrow_back" @click="goBack" class="q-mr-md" />
      <div>
        <div class="text-h5">{{ patent.patent_id }}</div>
        <div class="text-subtitle1 text-grey-7">{{ patent.patent_title }}</div>
      </div>
      <q-space />
      <q-btn outline color="primary" label="Add to Watchlist" icon="bookmark_border" class="q-mr-sm" />
      <q-btn outline color="secondary" label="Queue Jobs" icon="queue" />
    </div>

    <q-tabs v-model="activeTab" class="text-primary q-mb-md">
      <q-tab name="overview" label="Overview" icon="info" />
      <q-tab name="citations" label="Citations" icon="format_quote" />
      <q-tab name="prosecution" label="Prosecution" icon="gavel" />
      <q-tab name="ptab" label="PTAB/IPR" icon="balance" />
      <q-tab name="llm" label="LLM Analysis" icon="psychology" />
      <q-tab name="vendor" label="Vendor Data" icon="integration_instructions" />
    </q-tabs>

    <q-tab-panels v-model="activeTab" animated>
      <!-- Overview -->
      <q-tab-panel name="overview">
        <div class="row q-gutter-md">
          <q-card class="col">
            <q-card-section>
              <div class="text-h6">Basic Information</div>
              <q-list>
                <q-item>
                  <q-item-section>
                    <q-item-label caption>Patent ID</q-item-label>
                    <q-item-label>{{ patent.patent_id }}</q-item-label>
                  </q-item-section>
                </q-item>
                <q-item>
                  <q-item-section>
                    <q-item-label caption>Grant Date</q-item-label>
                    <q-item-label>{{ patent.patent_date }}</q-item-label>
                  </q-item-section>
                </q-item>
                <q-item clickable @click="router.push({ path: '/', query: { assignee: patent.assignee } })">
                  <q-item-section>
                    <q-item-label caption>Assignee</q-item-label>
                    <q-item-label class="text-primary">{{ patent.assignee }}</q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <q-icon name="arrow_forward" />
                  </q-item-section>
                </q-item>
                <q-item>
                  <q-item-section>
                    <q-item-label caption>Remaining Years</q-item-label>
                    <q-item-label>{{ patent.remaining_years.toFixed(1) }} years</q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>

          <q-card class="col">
            <q-card-section>
              <div class="text-h6">Scores</div>
              <q-list>
                <q-item>
                  <q-item-section>
                    <q-item-label caption>Forward Citations</q-item-label>
                    <q-item-label>{{ patent.forward_citations }}</q-item-label>
                  </q-item-section>
                </q-item>
                <q-item>
                  <q-item-section>
                    <q-item-label caption>Base Score</q-item-label>
                    <q-item-label>
                      <q-badge color="primary">{{ patent.score.toFixed(1) }}</q-badge>
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
            <div class="text-h6">Forward Citations</div>
            <div class="text-grey q-pa-xl text-center">
              Citation data will be loaded from cache/API.
            </div>
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
  </q-page>
</template>
