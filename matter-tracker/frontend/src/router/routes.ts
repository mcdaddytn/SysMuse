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
      { 
        path: '/reporting', 
        component: () => import('pages/ReportingPage.vue'),
        name: 'reporting'
      },
      { 
        path: '/reset-password', 
        component: () => import('pages/PasswordResetPage.vue'),
        name: 'reset-password'
      },
      { 
        path: '/admin/clients', 
        component: () => import('pages/ClientsAdminPage.vue'),
        name: 'admin-clients'
      },
      { 
        path: '/admin/matters', 
        component: () => import('pages/MattersAdminPage.vue'),
        name: 'admin-matters'
      },
      { 
        path: '/admin/team-members', 
        component: () => import('pages/TeamMembersAdminPage.vue'),
        name: 'admin-team-members'
      },
    ],
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;