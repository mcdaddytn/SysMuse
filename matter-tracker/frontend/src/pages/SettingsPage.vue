<!-- src/pages/SettingsPage.vue -->
<template>
  <q-page class="q-pa-md">
    <div class="q-mb-md">
      <div class="text-h4">Settings</div>
      <div class="text-subtitle1 text-grey-6">Configure global application settings</div>
    </div>

    <q-card class="q-mb-md">
      <q-card-section>
        <div class="text-h6 q-mb-md">Matter Search Configuration</div>
        <div class="text-body2 text-grey-6 q-mb-md">
          Configure how matter searches work in the application
        </div>
        
        <q-select
          v-model="matterLookaheadMode"
          :options="matterLookaheadModeOptions"
          option-label="label"
          option-value="value"
          emit-value
          map-options
          label="Matter Search Mode"
          filled
          @update:model-value="saveMatterLookaheadMode"
          :loading="savingMatterMode"
        >
          <template v-slot:option="scope">
            <q-item v-bind="scope.itemProps">
              <q-item-section>
                <q-item-label>{{ scope.opt.label }}</q-item-label>
                <q-item-label caption>{{ scope.opt.description }}</q-item-label>
              </q-item-section>
            </q-item>
          </template>
        </q-select>
      </q-card-section>
    </q-card>

    <q-card class="q-mb-md">
      <q-card-section>
        <div class="text-h6 q-mb-md">Timesheet Configuration</div>
        <div class="text-body2 text-grey-6 q-mb-md">
          Configure the timesheet display and behavior
        </div>
        
        <q-select
          v-model="timesheetMode"
          :options="timesheetModeOptions"
          option-label="label"
          option-value="value"
          emit-value
          map-options
          label="Timesheet Mode"
          filled
          @update:model-value="saveTimesheetMode"
          :loading="savingTimesheetMode"
        >
          <template v-slot:option="scope">
            <q-item v-bind="scope.itemProps">
              <q-item-section>
                <q-item-label>{{ scope.opt.label }}</q-item-label>
                <q-item-label caption>{{ scope.opt.description }}</q-item-label>
              </q-item-section>
            </q-item>
          </template>
        </q-select>
      </q-card-section>
    </q-card>

    <q-card>
      <q-card-section>
        <div class="text-h6 q-mb-md">Current Settings</div>
        <q-list>
          <q-item>
            <q-item-section avatar>
              <q-icon name="search" />
            </q-item-section>
            <q-item-section>
              <q-item-label>Matter Search Mode</q-item-label>
              <q-item-label caption>{{ getCurrentMatterModeLabel() }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item>
            <q-item-section avatar>
              <q-icon name="schedule" />
            </q-item-section>
            <q-item-section>
              <q-item-label>Timesheet Mode</q-item-label>
              <q-item-label caption>{{ getCurrentTimesheetModeLabel() }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { settingsService } from 'src/services/settings';
import type { MatterLookaheadMode, TimesheetMode } from 'src/types/models';

const $q = useQuasar();

const matterLookaheadMode = ref<MatterLookaheadMode>('INDIVIDUAL_STARTS_WITH');
const timesheetMode = ref<TimesheetMode>('WEEKLY');
const savingMatterMode = ref(false);
const savingTimesheetMode = ref(false);

const matterLookaheadModeOptions = [
  {
    label: 'Individual Starts With',
    value: 'INDIVIDUAL_STARTS_WITH',
    description: 'Search matches start of client name OR matter name'
  },
  {
    label: 'Combined Starts With',
    value: 'COMBINED_STARTS_WITH',
    description: 'Search matches start of combined "Client Matter" string'
  },
  {
    label: 'Individual Contains',
    value: 'INDIVIDUAL_CONTAINS',
    description: 'Search matches anywhere in client name OR matter name'
  },
  {
    label: 'Combined Contains',
    value: 'COMBINED_CONTAINS',
    description: 'Search matches anywhere in combined "Client Matter" string'
  }
];

const timesheetModeOptions = [
  {
    label: 'Weekly Only',
    value: 'WEEKLY',
    description: 'Show weekly timesheet view only'
  },
  {
    label: 'Daily Only',
    value: 'DAILY',
    description: 'Show daily timesheet view only'
  },
  {
    label: 'Both Weekly and Daily',
    value: 'BOTH',
    description: 'Allow switching between weekly and daily views'
  }
];

async function loadSettings() {
  try {
    matterLookaheadMode.value = await settingsService.getMatterLookaheadMode();
    timesheetMode.value = await settingsService.getTimesheetMode();
  } catch (error) {
    console.error('Error loading settings:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to load settings'
    });
  }
}

async function saveMatterLookaheadMode(mode: MatterLookaheadMode) {
  savingMatterMode.value = true;
  try {
    await settingsService.setMatterLookaheadMode(mode);
    $q.notify({
      type: 'positive',
      message: 'Matter search mode updated'
    });
  } catch (error) {
    console.error('Error saving matter lookahead mode:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save matter search mode'
    });
  } finally {
    savingMatterMode.value = false;
  }
}

async function saveTimesheetMode(mode: TimesheetMode) {
  savingTimesheetMode.value = true;
  try {
    await settingsService.setTimesheetMode(mode);
    $q.notify({
      type: 'positive',
      message: 'Timesheet mode updated'
    });
  } catch (error) {
    console.error('Error saving timesheet mode:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save timesheet mode'
    });
  } finally {
    savingTimesheetMode.value = false;
  }
}

function getCurrentMatterModeLabel(): string {
  const option = matterLookaheadModeOptions.find(opt => opt.value === matterLookaheadMode.value);
  return option ? option.label : 'Unknown';
}

function getCurrentTimesheetModeLabel(): string {
  const option = timesheetModeOptions.find(opt => opt.value === timesheetMode.value);
  return option ? option.label : 'Unknown';
}

onMounted(() => {
  loadSettings();
});
</script>