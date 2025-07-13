<!-- src/pages/SettingsPage.vue -->
<template>
  <q-page class="q-pa-md">
    <div class="q-mb-md">
      <div class="text-h4">Settings</div>
      <div class="text-subtitle1 text-grey-6">Configure global application settings</div>
    </div>

    <!-- Working Hours Configuration -->
    <q-card class="q-mb-md">
      <q-card-section>
        <div class="text-h6 q-mb-md">Working Hours Configuration</div>
        <div class="text-body2 text-grey-6 q-mb-md">
          Set default working hours and time tracking settings
        </div>
        
        <div class="row q-gutter-md">
          <div class="col">
            <q-input
              v-model.number="workingHours"
              type="number"
              label="Working Hours (per week)"
              filled
              @update:model-value="saveWorkingHours"
              :loading="savingWorkingHours"
              min="1"
              max="80"
            />
          </div>
          <div class="col">
            <q-select
              v-model="timeIncrementType"
              :options="timeIncrementTypeOptions"
              option-label="label"
              option-value="value"
              emit-value
              map-options
              label="Time Increment Type"
              filled
              @update:model-value="saveTimeIncrementType"
              :loading="savingTimeIncrementType"
            />
          </div>
        </div>
        
        <div class="row q-gutter-md q-mt-md">
          <div class="col">
            <q-input
              v-model.number="timeIncrement"
              type="number"
              label="Time Increment Value"
              filled
              @update:model-value="saveTimeIncrement"
              :loading="savingTimeIncrement"
              min="1"
              :hint="timeIncrementType === 'HOURS_MINUTES' ? 'Minutes (e.g., 15 for 15-minute intervals)' : 'Percentage (e.g., 1 for 1% intervals)'"
            />
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Access Control Configuration -->
    <q-card class="q-mb-md">
      <q-card-section>
        <div class="text-h6 q-mb-md">Access Control</div>
        <div class="text-body2 text-grey-6 q-mb-md">
          Configure user access to various features
        </div>
        
        <q-toggle
          v-model="userITActivity"
          label="Allow regular users to access IT Activities"
          @update:model-value="saveUserITActivity"
          :loading="savingUserITActivity"
        />
      </q-card-section>
    </q-card>

    <!-- Validation Configuration -->
    <q-card class="q-mb-md">
      <q-card-section>
        <div class="text-h6 q-mb-md">Timesheet Validation</div>
        <div class="text-body2 text-grey-6 q-mb-md">
          Set maximum hours for timesheet validation
        </div>
        
        <div class="row q-gutter-md">
          <div class="col">
            <q-input
              v-model.number="maxHoursPerDay"
              type="number"
              label="Maximum Hours per Day"
              filled
              @update:model-value="saveMaxHoursPerDay"
              :loading="savingMaxHoursPerDay"
              min="1"
              max="24"
            />
          </div>
          <div class="col">
            <q-input
              v-model.number="maxHoursPerWeek"
              type="number"
              label="Maximum Hours per Week"
              filled
              @update:model-value="saveMaxHoursPerWeek"
              :loading="savingMaxHoursPerWeek"
              min="1"
              max="168"
            />
          </div>
        </div>
        
        <div class="row q-gutter-md q-mt-md">
          <div class="col">
            <q-select
              v-model="projectedHoursWarning"
              :options="projectedHoursWarningOptions"
              option-label="label"
              option-value="value"
              emit-value
              map-options
              label="Projected Hours Warning"
              filled
              @update:model-value="saveProjectedHoursWarning"
              :loading="savingProjectedHoursWarning"
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
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Matter Search Configuration -->
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

    <!-- Timesheet Configuration -->
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
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { settingsService } from 'src/services/settings';

const $q = useQuasar();

// Settings values
const workingHours = ref(40);
const timeIncrementType = ref('HOURS_MINUTES');
const timeIncrement = ref(15);
const userITActivity = ref(false);
const maxHoursPerDay = ref(12);
const maxHoursPerWeek = ref(60);
const projectedHoursWarning = ref('Never');
const matterLookaheadMode = ref('INDIVIDUAL_STARTS_WITH');
const timesheetMode = ref('WEEKLY');

// Loading states
const savingWorkingHours = ref(false);
const savingTimeIncrementType = ref(false);
const savingTimeIncrement = ref(false);
const savingUserITActivity = ref(false);
const savingMaxHoursPerDay = ref(false);
const savingMaxHoursPerWeek = ref(false);
const savingProjectedHoursWarning = ref(false);
const savingMatterMode = ref(false);
const savingTimesheetMode = ref(false);

// Options
const timeIncrementTypeOptions = [
  { 
    label: 'Hours and Minutes', 
    value: 'HOURS_MINUTES',
    description: 'Track time in hours and minutes (e.g., 1.5 hours, 30 minutes)'
  },
  { 
    label: 'Percentage', 
    value: 'PERCENT',
    description: 'Track time as percentage of total working time'
  }
];

const projectedHoursWarningOptions = [
  {
    label: 'Never',
    value: 'Never',
    description: 'Never warn when projected hours are below target'
  },
  {
    label: 'Always',
    value: 'Always',
    description: 'Always warn when projected hours are below target'
  },
  {
    label: 'Past',
    value: 'Past',
    description: 'Only warn for past timesheet periods when projected hours are below target'
  }
];

const matterLookaheadModeOptions = [
  { 
    label: 'Individual Starts With', 
    value: 'INDIVIDUAL_STARTS_WITH',
    description: 'Search both client and matter names with starts-with matching'
  },
  { 
    label: 'Combined Starts With', 
    value: 'COMBINED_STARTS_WITH',
    description: 'Search combined "Client - Matter" strings with starts-with matching'
  },
  { 
    label: 'Individual Contains', 
    value: 'INDIVIDUAL_CONTAINS',
    description: 'Search both client and matter names with contains matching'
  },
  { 
    label: 'Combined Contains', 
    value: 'COMBINED_CONTAINS',
    description: 'Search combined "Client - Matter" strings with contains matching'
  }
];

const timesheetModeOptions = [
  { 
    label: 'Weekly Only', 
    value: 'WEEKLY',
    description: 'Show only weekly timesheets'
  },
  { 
    label: 'Daily Only', 
    value: 'DAILY',
    description: 'Show only daily timesheets'
  },
  { 
    label: 'Both Weekly and Daily', 
    value: 'BOTH',
    description: 'Allow switching between weekly and daily views'
  }
];

// Load all settings
async function loadSettings() {
  try {
    const settings = await settingsService.getSettings();
    
    workingHours.value = settings.workingHours || 40;
    timeIncrementType.value = settings.timeIncrementType || 'HOURS_MINUTES';
    timeIncrement.value = settings.timeIncrement || 15;
    userITActivity.value = settings.userITActivity || false;
    maxHoursPerDay.value = settings.maxHoursPerDay || 12;
    maxHoursPerWeek.value = settings.maxHoursPerWeek || 60;
    projectedHoursWarning.value = settings.projectedHoursWarning || 'Never';
    matterLookaheadMode.value = settings.matterLookaheadMode || 'INDIVIDUAL_STARTS_WITH';
    timesheetMode.value = settings.timesheetMode || 'WEEKLY';
  } catch (error) {
    console.error('Failed to load settings:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to load settings'
    });
  }
}

// Save individual settings
async function saveWorkingHours() {
  savingWorkingHours.value = true;
  try {
    await settingsService.updateSetting('workingHours', workingHours.value);
    $q.notify({
      type: 'positive',
      message: 'Working hours updated successfully'
    });
  } catch (error) {
    console.error('Failed to save working hours:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save working hours'
    });
  } finally {
    savingWorkingHours.value = false;
  }
}

async function saveTimeIncrementType() {
  savingTimeIncrementType.value = true;
  try {
    await settingsService.updateSetting('timeIncrementType', timeIncrementType.value);
    $q.notify({
      type: 'positive',
      message: 'Time increment type updated successfully'
    });
  } catch (error) {
    console.error('Failed to save time increment type:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save time increment type'
    });
  } finally {
    savingTimeIncrementType.value = false;
  }
}

async function saveTimeIncrement() {
  savingTimeIncrement.value = true;
  try {
    await settingsService.updateSetting('timeIncrement', timeIncrement.value);
    $q.notify({
      type: 'positive',
      message: 'Time increment updated successfully'
    });
  } catch (error) {
    console.error('Failed to save time increment:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save time increment'
    });
  } finally {
    savingTimeIncrement.value = false;
  }
}

async function saveUserITActivity() {
  savingUserITActivity.value = true;
  try {
    await settingsService.updateSetting('userITActivity', userITActivity.value);
    $q.notify({
      type: 'positive',
      message: 'IT Activity access updated successfully'
    });
  } catch (error) {
    console.error('Failed to save IT Activity access:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save IT Activity access'
    });
  } finally {
    savingUserITActivity.value = false;
  }
}

async function saveMaxHoursPerDay() {
  savingMaxHoursPerDay.value = true;
  try {
    await settingsService.updateSetting('maxHoursPerDay', maxHoursPerDay.value);
    $q.notify({
      type: 'positive',
      message: 'Max hours per day updated successfully'
    });
  } catch (error) {
    console.error('Failed to save max hours per day:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save max hours per day'
    });
  } finally {
    savingMaxHoursPerDay.value = false;
  }
}

async function saveMaxHoursPerWeek() {
  savingMaxHoursPerWeek.value = true;
  try {
    await settingsService.updateSetting('maxHoursPerWeek', maxHoursPerWeek.value);
    $q.notify({
      type: 'positive',
      message: 'Max hours per week updated successfully'
    });
  } catch (error) {
    console.error('Failed to save max hours per week:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save max hours per week'
    });
  } finally {
    savingMaxHoursPerWeek.value = false;
  }
}

async function saveProjectedHoursWarning() {
  savingProjectedHoursWarning.value = true;
  try {
    await settingsService.updateSetting('projectedHoursWarning', projectedHoursWarning.value);
    $q.notify({
      type: 'positive',
      message: 'Projected hours warning setting updated successfully'
    });
  } catch (error) {
    console.error('Failed to save projected hours warning setting:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save projected hours warning setting'
    });
  } finally {
    savingProjectedHoursWarning.value = false;
  }
}

async function saveMatterLookaheadMode() {
  savingMatterMode.value = true;
  try {
    await settingsService.updateSetting('matterLookaheadMode', matterLookaheadMode.value);
    $q.notify({
      type: 'positive',
      message: 'Matter search mode updated successfully'
    });
  } catch (error) {
    console.error('Failed to save matter search mode:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save matter search mode'
    });
  } finally {
    savingMatterMode.value = false;
  }
}

async function saveTimesheetMode() {
  savingTimesheetMode.value = true;
  try {
    await settingsService.updateSetting('timesheetMode', timesheetMode.value);
    $q.notify({
      type: 'positive',
      message: 'Timesheet mode updated successfully'
    });
  } catch (error) {
    console.error('Failed to save timesheet mode:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save timesheet mode'
    });
  } finally {
    savingTimesheetMode.value = false;
  }
}

onMounted(() => {
  loadSettings();
});
</script>