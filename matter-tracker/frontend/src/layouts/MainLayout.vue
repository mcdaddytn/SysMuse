<!-- src/layouts/MainLayout.vue -->
<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-toolbar-title>
          <q-icon name="schedule" class="q-mr-sm" />
          Timesheet Tracker
        </q-toolbar-title>

        <q-btn
          flat
          round
          dense
          icon="add"
          @click="showMatterDialog = true"
        >
          <q-tooltip>Add New Matter</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>

    <matter-dialog
      v-model="showMatterDialog"
      @matter-added="onMatterAdded"
    />
  </q-layout>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import MatterDialog from 'src/components/MatterDialog.vue';

export default defineComponent({
  name: 'MainLayout',
  components: {
    MatterDialog,
  },
  setup() {
    const showMatterDialog = ref(false);

    function onMatterAdded(matter: any) {
      // Refresh matters list or emit event
      window.location.reload(); // Simple solution for now
    }

    return {
      showMatterDialog,
      onMatterAdded,
    };
  },
});
</script>

