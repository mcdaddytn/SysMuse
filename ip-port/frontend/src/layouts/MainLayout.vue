<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { patentApi } from '@/services/api';

const router = useRouter();
const route = useRoute();
const leftDrawerOpen = ref(false);

// Cache stats for sidebar
const cacheStats = ref<{ llm: number; prosecution: number; ipr: number; family: number } | null>(null);
const cacheLoading = ref(false);

async function loadCacheStats() {
  cacheLoading.value = true;
  try {
    const summary = await patentApi.getEnrichmentSummary(5000);
    cacheStats.value = summary.enrichmentTotals;
  } catch (err) {
    console.error('Failed to load cache stats:', err);
  } finally {
    cacheLoading.value = false;
  }
}

onMounted(() => {
  loadCacheStats();
});

// TODO: Replace with actual auth store
const currentUser = ref({
  name: 'Demo User',
  email: 'demo@example.com',
  accessLevel: 'ADMIN' as const
});

const isAdmin = computed(() => currentUser.value?.accessLevel === 'ADMIN');

const navItems = computed(() => [
  { label: 'Patent Summary', icon: 'summarize', to: '/', show: true },
  { label: 'Aggregate View', icon: 'analytics', to: '/aggregates', show: true },
  { label: 'Focus Areas', icon: 'filter_center_focus', to: '/focus-areas', show: true },
  { label: 'Family Explorer', icon: 'account_tree', to: '/patent-families', show: true },
  { divider: true, show: true },
  { label: 'Base Score', icon: 'leaderboard', to: '/base-scoring', show: true },
  { label: 'v2 Scoring', icon: 'score', to: '/v2-scoring', show: true },
  { label: 'v3 Scoring', icon: 'how_to_vote', to: '/v3-scoring', show: true },
  { divider: true, show: true },
  { label: 'Sectors', icon: 'category', to: '/sectors', show: true },
  { label: 'Sector Management', icon: 'build', to: '/sector-management', show: true },
  { label: 'Prompt Templates', icon: 'auto_awesome', to: '/prompt-templates', show: true },
  { label: 'Job Queue', icon: 'queue', to: '/jobs', show: true },
  { label: 'LLM Scores', icon: 'psychology', to: '/llm-scores', show: true },
  { divider: true, show: isAdmin.value },
  { label: 'Admin', icon: 'admin_panel_settings', to: '/admin', show: isAdmin.value }
].filter(item => item.show));

function toggleDrawer() {
  leftDrawerOpen.value = !leftDrawerOpen.value;
}

function logout() {
  // TODO: Implement logout
  router.push('/login');
}
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <!-- Header -->
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-btn
          flat
          dense
          round
          icon="menu"
          aria-label="Menu"
          @click="toggleDrawer"
        />

        <q-toolbar-title>
          <span class="text-weight-bold">Patent Workstation</span>
        </q-toolbar-title>

        <!-- User Menu -->
        <q-btn flat round icon="account_circle">
          <q-menu>
            <q-list style="min-width: 200px">
              <q-item>
                <q-item-section>
                  <q-item-label>{{ currentUser?.name }}</q-item-label>
                  <q-item-label caption>{{ currentUser?.email }}</q-item-label>
                  <q-item-label caption class="text-primary">
                    {{ currentUser?.accessLevel }}
                  </q-item-label>
                </q-item-section>
              </q-item>
              <q-separator />
              <q-item clickable v-close-popup @click="logout">
                <q-item-section avatar>
                  <q-icon name="logout" />
                </q-item-section>
                <q-item-section>Logout</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </q-toolbar>
    </q-header>

    <!-- Left Drawer -->
    <q-drawer
      v-model="leftDrawerOpen"
      show-if-above
      bordered
      :width="240"
    >
      <q-list>
        <q-item-label header class="text-grey-8">
          Navigation
        </q-item-label>

        <template v-for="item in navItems" :key="item.to || 'divider'">
          <q-separator v-if="item.divider" />
          <q-item
            v-else
            clickable
            v-ripple
            :to="item.to"
            :active="route.path === item.to"
            active-class="bg-grey-3"
          >
            <q-item-section avatar>
              <q-icon :name="item.icon" />
            </q-item-section>
            <q-item-section>{{ item.label }}</q-item-section>
          </q-item>
        </template>
      </q-list>

      <!-- Cache Stats Footer -->
      <div class="absolute-bottom q-pa-md text-grey-6 text-caption">
        <template v-if="cacheLoading">
          <div>Loading cache stats...</div>
        </template>
        <template v-else-if="cacheStats">
          <div>LLM: {{ cacheStats.llm.toLocaleString() }}</div>
          <div>Pros: {{ cacheStats.prosecution.toLocaleString() }} | IPR: {{ cacheStats.ipr.toLocaleString() }}</div>
        </template>
        <template v-else>
          <div>Cache stats unavailable</div>
        </template>
      </div>
    </q-drawer>

    <!-- Main Content -->
    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.q-item--active {
  font-weight: 500;
}
</style>
