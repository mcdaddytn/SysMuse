// src/router/routes.ts
import { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: () => import('pages/LoginPage.vue'),
    name: 'login'
  },
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { 
        path: '', 
        component: () => import('pages/TimesheetPage.vue'),
        name: 'timesheet'
      },
      { 
        path: '/it-activities', 
        component: () => import('pages/ITActivityPage.vue'),
        name: 'it-activities'
      },
      { 
        path: '/settings', 
        component: () => import('pages/SettingsPage.vue'),
        name: 'settings'
      },
    ],
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;