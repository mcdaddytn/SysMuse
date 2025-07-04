// src/router/routes.ts - Updated with IT Activity route

import { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { 
        path: '', 
        component: () => import('pages/WeeklyTimesheetPage.vue'),
        name: 'weekly-timesheet'
      },
      { 
        path: '/daily', 
        component: () => import('pages/DailyTimesheetPage.vue'),
        name: 'daily-timesheet'
      },
      { 
        path: '/it-activities', 
        component: () => import('pages/ITActivityPage.vue'),
        name: 'it-activities'
      },
    ],
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;