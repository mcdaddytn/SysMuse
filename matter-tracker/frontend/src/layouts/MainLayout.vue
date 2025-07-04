<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated>
      <q-toolbar>
        <q-btn
          flat
          dense
          round
          icon="menu"
          aria-label="Menu"
          @click="toggleLeftDrawer"
        />

        <q-toolbar-title>
          Matter Tracker
        </q-toolbar-title>

        <div class="q-gutter-sm">
          <q-btn 
            flat 
            label="Weekly Timesheet" 
            :color="$route.name === 'weekly-timesheet' ? 'white' : 'grey-4'"
            @click="$router.push('/')"
          />
          <q-btn 
            flat 
            label="Daily Timesheet" 
            :color="$route.name === 'daily-timesheet' ? 'white' : 'grey-4'"
            @click="$router.push('/daily')"
          />
          <q-btn 
            flat 
            label="IT Activities" 
            :color="$route.name === 'it-activities' ? 'white' : 'grey-4'"
            @click="$router.push('/it-activities')"
          />
        </div>
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="leftDrawerOpen"
      show-if-above
      bordered
    >
      <q-list>
        <q-item-label
          header
        >
          Navigation
        </q-item-label>

        <q-item 
          clickable 
          v-ripple 
          :active="$route.name === 'weekly-timesheet'"
          @click="$router.push('/')"
        >
          <q-item-section avatar>
            <q-icon name="calendar_view_week" />
          </q-item-section>
          <q-item-section>
            <q-item-label>Weekly Timesheet</q-item-label>
            <q-item-label caption>Traditional weekly time tracking</q-item-label>
          </q-item-section>
        </q-item>

        <q-item 
          clickable 
          v-ripple 
          :active="$route.name === 'daily-timesheet'"
          @click="$router.push('/daily')"
        >
          <q-item-section avatar>
            <q-icon name="today" />
          </q-item-section>
          <q-item-section>
            <q-item-label>Daily Timesheet</q-item-label>
            <q-item-label caption>Single day time tracking</q-item-label>
          </q-item-section>
        </q-item>

        <q-separator />

        <q-item 
          clickable 
          v-ripple 
          :active="$route.name === 'it-activities'"
          @click="$router.push('/it-activities')"
        >
          <q-item-section avatar>
            <q-icon name="computer" />
          </q-item-section>
          <q-item-section>
            <q-item-label>IT Activities</q-item-label>
            <q-item-label caption>Track Outlook, Email & OneDrive activities</q-item-label>
          </q-item-section>
        </q-item>

        <q-separator />

        <q-item-label header>
          Quick Actions
        </q-item-label>

        <q-item clickable v-ripple>
          <q-item-section avatar>
            <q-icon name="add" />
          </q-item-section>
          <q-item-section>
            <q-item-label>Add New Matter</q-item-label>
          </q-item-section>
        </q-item>

        <q-item clickable v-ripple>
          <q-item-section avatar>
            <q-icon name="assessment" />
          </q-item-section>
          <q-item-section>
            <q-item-label>Reports</q-item-label>
          </q-item-section>
        </q-item>

        <q-item clickable v-ripple>
          <q-item-section avatar>
            <q-icon name="settings" />
          </q-item-section>
          <q-item-section>
            <q-item-label>Settings</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';

export default defineComponent({
  name: 'MainLayout',

  setup() {
    const leftDrawerOpen = ref(false);

    return {
      leftDrawerOpen,
      toggleLeftDrawer() {
        leftDrawerOpen.value = !leftDrawerOpen.value;
      }
    };
  }
});
</script>