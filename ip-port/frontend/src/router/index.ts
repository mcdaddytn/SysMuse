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
        name: 'portfolio',
        component: () => import('@/pages/PortfolioPage.vue'),
        meta: { title: 'Portfolio' }
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
        path: 'patent/:id',
        name: 'patent-detail',
        component: () => import('@/pages/PatentDetailPage.vue'),
        meta: { title: 'Patent Detail' }
      },
      {
        path: 'jobs',
        name: 'jobs',
        component: () => import('@/pages/JobQueuePage.vue'),
        meta: { title: 'Job Queue' }
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
  document.title = `${to.meta.title || 'Portfolio'} - Patent Workstation`;
  next();
});

export default router;
