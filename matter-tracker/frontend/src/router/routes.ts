// src/router/routes.ts
import { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
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
    ],
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;