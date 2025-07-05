<!-- src/layouts/MainLayout.vue - Updated navigation -->
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
            label="Timesheet" 
            :color="$route.name === 'timesheet' ? 'white' : 'grey-4'"
            @click="$router.push('/')"
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
        <q-item-label header>Navigation</q-item-label>

        <q-item 
          clickable 
          v-ripple 
          :active="$route.name === 'timesheet'"
          @click="$router.push('/')"
        >
          <q-item-section avatar>
            <q-icon name="schedule" />
          </q-item-section>
          <q-item-section>
            <q-item-label>Timesheet</q-item-label>
            <q-item-label caption>Track time in weekly or daily mode</q-item-label>
          </q-item-section>
        </q-item>

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

        <!-- ... rest of navigation items ... -->
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>
