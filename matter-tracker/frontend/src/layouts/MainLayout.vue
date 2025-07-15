<!-- src/layouts/MainLayout.vue - Role-based navigation without left drawer -->
<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated>
      <q-toolbar>
        <q-toolbar-title>
          Matter Tracker
        </q-toolbar-title>

        <div class="q-gutter-sm">
          <!-- Timesheet - Available to all users -->
          <q-btn 
            flat 
            label="Timesheet" 
            :color="$route.name === 'timesheet' ? 'white' : 'grey-4'"
            @click="$router.push('/')"
          />
          
          <!-- IT Activities - Only if globally enabled or user is admin/manager -->
          <q-btn 
            v-if="showITActivities"
            flat 
            label="IT Activities" 
            :color="$route.name === 'it-activities' ? 'white' : 'grey-4'"
            @click="$router.push('/it-activities')"
          />
          
          <!-- Settings - Only for admins -->
          <q-btn 
            v-if="isAdmin"
            flat 
            label="Settings" 
            :color="$route.name === 'settings' ? 'white' : 'grey-4'"
            @click="$router.push('/settings')"
          />
          
          <!-- Reporting - Only for admins -->
          <q-btn 
            v-if="isAdmin"
            flat 
            label="Reporting" 
            :color="$route.name === 'reporting' ? 'white' : 'grey-4'"
            @click="$router.push('/reporting')"
          />
          
          <!-- Admin pages - Only for admins -->
          <q-btn 
            v-if="currentUser?.accessLevel === 'ADMIN'"
            flat 
            label="Admin" 
            :color="$route.name?.includes('admin') ? 'white' : 'grey-4'"
            icon="admin_panel_settings"
          >
            <q-menu>
              <q-list style="min-width: 150px">
                <q-item clickable v-close-popup @click="$router.push('/admin/clients')">
                  <q-item-section avatar>
                    <q-icon name="business" />
                  </q-item-section>
                  <q-item-section>Clients</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="$router.push('/admin/matters')">
                  <q-item-section avatar>
                    <q-icon name="folder" />
                  </q-item-section>
                  <q-item-section>Matters</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="$router.push('/admin/team-members')">
                  <q-item-section avatar>
                    <q-icon name="people" />
                  </q-item-section>
                  <q-item-section>Team Members</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>

          <!-- User menu -->
          <q-btn 
            flat 
            round 
            icon="account_circle"
          >
            <q-menu>
              <q-list style="min-width: 200px">
                <q-item>
                  <q-item-section>
                    <q-item-label>{{ currentUser?.name || 'Unknown User' }}</q-item-label>
                    <q-item-label caption>{{ currentUser?.title || currentUser?.role }}</q-item-label>
                  </q-item-section>
                </q-item>
                <q-separator />
                <q-item clickable v-close-popup @click="goToResetPassword">
                  <q-item-section avatar>
                    <q-icon name="lock_reset" />
                  </q-item-section>
                  <q-item-section>Reset Password</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="logout">
                  <q-item-section avatar>
                    <q-icon name="logout" />
                  </q-item-section>
                  <q-item-section>Logout</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { settingsService } from 'src/services/settings';
import { authService } from 'src/services/auth';
import type { AuthUser } from 'src/types/models';

const router = useRouter();
const $q = useQuasar();

const currentUser = ref<AuthUser | null>(null);
const userITActivity = ref('MANAGER');

// Computed properties for role-based access
const isAdmin = computed(() => {
  return currentUser.value?.accessLevel === 'ADMIN';
});

const isManagerOrAdmin = computed(() => {
  return currentUser.value?.accessLevel === 'ADMIN' || currentUser.value?.accessLevel === 'MANAGER';
});

const showITActivities = computed(() => {
  // Check individual user override first
  const userOverride = currentUser.value?.userITActivity;
  if (userOverride !== null && userOverride !== undefined) {
    return userOverride;
  }
  
  // Check global access level setting
  const globalAccessLevel = userITActivity.value;
  const currentUserLevel = currentUser.value?.accessLevel;
  
  if (globalAccessLevel === 'NONE') {
    return false;
  } else if (globalAccessLevel === 'USER') {
    return true; // Everyone can access
  } else if (globalAccessLevel === 'MANAGER') {
    return currentUserLevel === 'MANAGER' || currentUserLevel === 'ADMIN';
  } else if (globalAccessLevel === 'ADMIN') {
    return currentUserLevel === 'ADMIN';
  }
  
  // Fallback to false if setting is invalid
  return false;
});

// Load current user info (auth already checked by router guard)
async function loadCurrentUser() {
  try {
    currentUser.value = await authService.getCurrentUser();
  } catch (error) {
    console.error('Failed to load user info:', error);
    // Router guard will handle redirecting to login
  }
}

// Load settings to check IT Activities access
async function loadSettings() {
  try {
    const accessLevel = await settingsService.getSetting('userITActivity');
    userITActivity.value = accessLevel;
  } catch (error) {
    console.error('Failed to load settings:', error);
    // Default to MANAGER if we can't load the setting
    userITActivity.value = 'MANAGER';
  }
}

// Logout function
async function logout() {
  try {
    await authService.logout();
    
    $q.notify({
      type: 'positive',
      message: 'Logged out successfully'
    });
    
    router.push('/login');
  } catch (error) {
    console.error('Logout failed:', error);
    $q.notify({
      type: 'negative',
      message: 'Logout failed'
    });
  }
}

// Navigate to reset password page
function goToResetPassword() {
  router.push('/reset-password');
}

onMounted(() => {
  loadCurrentUser();
  loadSettings();
});
</script>