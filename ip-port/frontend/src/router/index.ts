import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import MainLayout from '@/layouts/MainLayout.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: MainLayout,
    children: [
      {
        path: '',
        name: 'patent-summary',
        component: () => import('@/pages/PortfolioPage.vue'),
        meta: { title: 'Patent Summary' }
      },
      {
        path: 'aggregates',
        name: 'aggregates',
        component: () => import('@/pages/AggregatesPage.vue'),
        meta: { title: 'Aggregate View' }
      },
      {
        path: 'base-scoring',
        name: 'base-scoring',
        component: () => import('@/pages/BaseScoringPage.vue'),
        meta: { title: 'Base Score Rankings' }
      },
      {
        path: 'v2-scoring',
        name: 'v2-scoring',
        component: () => import('@/pages/V2ScoringPage.vue'),
        meta: { title: 'v2 Scoring' }
      },
      {
        path: 'v3-scoring',
        name: 'v3-scoring',
        component: () => import('@/pages/V3ScoringPage.vue'),
        meta: { title: 'v3 Scoring' }
      },
      {
        path: 'sectors',
        name: 'sectors',
        component: () => import('@/pages/SectorRankingsPage.vue'),
        meta: { title: 'Sector Rankings' }
      },
      {
        path: 'sector-management',
        name: 'sector-management',
        component: () => import('@/pages/SectorManagementPage.vue'),
        meta: { title: 'Sector Management' }
      },
      {
        path: 'sector-management/:id',
        name: 'sector-management-detail',
        component: () => import('@/pages/SectorManagementPage.vue'),
        meta: { title: 'Sector Management' }
      },
      {
        path: 'focus-areas',
        name: 'focus-areas',
        component: () => import('@/pages/FocusAreasPage.vue'),
        meta: { title: 'Focus Areas' }
      },
      {
        path: 'focus-areas/:id',
        name: 'focus-area-detail',
        component: () => import('@/pages/FocusAreaDetailPage.vue'),
        meta: { title: 'Focus Area' }
      },
      {
        path: 'patent/:id',
        name: 'patent-detail',
        component: () => import('@/pages/PatentDetailPage.vue'),
        meta: { title: 'Patent Detail' }
      },
      {
        path: 'prompt-templates',
        name: 'prompt-templates',
        component: () => import('@/pages/PromptTemplatesPage.vue'),
        meta: { title: 'Prompt Templates' }
      },
      {
        path: 'jobs',
        name: 'jobs',
        component: () => import('@/pages/JobQueuePage.vue'),
        meta: { title: 'Job Queue' }
      },
      {
        path: 'llm-scores',
        name: 'llm-scores',
        component: () => import('@/pages/SectorScoresPage.vue'),
        meta: { title: 'LLM Sector Scores' }
      }
    ]
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { title: 'Login', public: true }
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

// Navigation guard for auth (to be implemented)
router.beforeEach((to, _from, next) => {
  // TODO: Check authentication
  // For now, allow all routes
  document.title = `${to.meta.title || 'Patent Summary'} - Patent Workstation`;
  next();
});

export default router;
