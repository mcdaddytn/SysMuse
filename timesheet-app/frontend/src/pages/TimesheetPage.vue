<!-- src/pages/TimesheetPage.vue -->
<template>
  <q-page class="q-pa-md">
    <div class="timesheet-container">
      <!-- Header Section -->
      <div class="header-section q-mb-md">
        <div class="row q-gutter-md items-center">
          <div class="col-auto">
            <q-select
              v-model="selectedTeamMember"
              :options="teamMembers"
              option-label="name"
              option-value="id"
              label="Team Member"
              filled
              style="min-width: 250px"
              @update:model-value="loadTimesheet"
            />
          </div>
          
          <div class="col-auto">
            <q-input
              v-model="formattedWeekRange"
              label="Week"
              filled
              readonly
              style="min-width: 200px"
            >
              <template v-slot:prepend>
                <q-btn
                  icon="chevron_left"
                  flat
                  round
                  dense
                  @click="changeWeek(-1)"
                />
              </template>
              <template v-slot:append>
                <q-btn
                  icon="chevron_right"
                  flat
                  round
                  dense
                  @click="changeWeek(1)"
                />
                <q-icon name="event" class="cursor-pointer">
                  <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                    <q-date
                      :model-value="currentWeekStart"
                      @update:model-value="onDateSelected"
                      mask="YYYY-MM-DD"
                      :options="sundayOnly"
                      :navigation-min-year-month="'2024/01'"
                      :navigation-max-year-month="'2026/12'"
                    />
                  </q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <div class="col-auto">
            <q-btn
              label="Copy from Last Week"
              color="secondary"
              @click="copyFromLastWeek"
              :disable="!selectedTeamMember"
            />
          </div>

          <q-space />

          <div class="col-auto">
            <q-btn
              label="Save"
              color="primary"
              @click="saveTimesheet"
              :disable="!canSave"
              :loading="saving"
            />
          </div>
        </div>
      </div>

      <!-- Timesheet Grid -->
      <div class="timesheet-grid">
        <q-markup-table separator="cell" flat bordered>
          <thead>
            <tr class="bg-primary text-white">
              <th style="width: 250px">Matter</th>
              <th style="width: 300px">Task</th>
              <th style="width: 120px">Urgency</th>
              <th style="width: 150px">Projected Hours</th>
              <th style="width: 150px">Actual Hours</th>
              <th style="width: 50px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, index) in entries" :key="index">
              <td>
                <q-select
                  v-model="entry.matter"
                  :options="matters"
                  option-label="name"
                  option-value="id"
                  dense
                  filled
                  @update:model-value="(val) => onMatterChange(index, val)"
                >
                  <template v-slot:option="scope">
                    <q-item v-bind="scope.itemProps">
                      <q-item-section>
                        <q-item-label>{{ scope.opt.name }}</q-item-label>
                        <q-item-label caption>{{ scope.opt.client.name }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </template>
                  <template v-slot:selected-item="scope">
                    <q-tooltip>
                      {{ scope.opt.description || scope.opt.name }}
                    </q-tooltip>
                    {{ scope.opt.name }}
                  </template>
                </q-select>
              </td>
              <td>
                <q-select
                  v-model="entry.taskDescription"
                  :options="getTaskOptions(entry.matter)"
                  use-input
                  hide-selected
                  fill-input
                  new-value-mode="add"
                  dense
                  filled
                  @new-value="(val) => createTaskOption(val, index)"
                />
              </td>
              <td>
                <q-select
                  v-model="entry.urgency"
                  :options="urgencyOptions"
                  dense
                  filled
                />
              </td>
              <td>
                <div class="row items-center">
                  <q-input
                    v-model.number="entry.projectedHours"
                    type="number"
                    min="0"
                    max="100"
                    suffix="%"
                    dense
                    filled
                    style="width: 100px"
                    @update:model-value="validatePercentage"
                  >
                    <q-tooltip v-if="selectedTeamMember">
                      {{ calculateHours(entry.projectedHours) }} hours
                    </q-tooltip>
                  </q-input>
                </div>
              </td>
              <td>
                <div class="row items-center">
                  <q-input
                    v-model.number="entry.actualHours"
                    type="number"
                    min="0"
                    max="100"
                    suffix="%"
                    dense
                    filled
                    style="width: 100px"
                    @update:model-value="validatePercentage"
                  >
                    <q-tooltip v-if="selectedTeamMember">
                      {{ calculateHours(entry.actualHours) }} hours
                    </q-tooltip>
                  </q-input>
                </div>
              </td>
              <td>
                <q-btn
                  icon="delete"
                  flat
                  round
                  dense
                  size="sm"
                  color="negative"
                  @click="removeEntry(index)"
                />
              </td>
            </tr>
            <!-- Add New Row -->
            <tr>
              <td colspan="6" class="text-center">
                <q-btn
                  label="Add Entry"
                  icon="add"
                  flat
                  color="primary"
                  @click="addEntry"
                />
              </td>
            </tr>
            <!-- Totals Row -->
            <tr class="bg-grey-2 text-weight-bold">
              <td colspan="3" class="text-right">Total:</td>
              <td>
                <span :class="{ 'text-negative': projectedTotal !== 100 }">
                  {{ projectedTotal }}%
                </span>
                <q-tooltip v-if="selectedTeamMember">
                  {{ calculateHours(projectedTotal) }} hours
                </q-tooltip>
              </td>
              <td>
                <span :class="{ 'text-negative': actualTotal !== 100 }">
                  {{ actualTotal }}%
                </span>
                <q-tooltip v-if="selectedTeamMember">
                  {{ calculateHours(actualTotal) }} hours
                </q-tooltip>
              </td>
              <td></td>
            </tr>
          </tbody>
        </q-markup-table>
      </div>

      <!-- Validation Messages -->
      <div v-if="validationErrors.length > 0" class="q-mt-md">
        <q-banner class="bg-negative text-white">
          <template v-slot:avatar>
            <q-icon name="error" />
          </template>
          <div v-for="error in validationErrors" :key="error">
            {{ error }}
          </div>
        </q-banner>
      </div>
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, watch } from 'vue';
import { date, Notify, Dialog } from 'quasar';
import { api } from 'src/services/api';
import type { TeamMember, Matter, TimesheetEntry, Timesheet } from 'src/types/models';

interface EntryRow {
  matter: Matter | null;
  taskDescription: string;
  urgency: 'HOT' | 'MEDIUM' | 'MILD';
  projectedHours: number;
  actualHours: number;
}

export default defineComponent({
  name: 'TimesheetPage',
  setup() {
    // Ensure we start with a proper Sunday
    const getInitialSunday = (): string => {
      const today = new Date();
      const day = today.getDay();
      if (day !== 0) {
        today.setDate(today.getDate() - day);
      }
      return date.formatDate(today, 'YYYY-MM-DD');
    };

    const selectedTeamMember = ref<TeamMember | null>(null);
    const currentWeekStart = ref<string>(getInitialSunday());
    const teamMembers = ref<TeamMember[]>([]);
    const matters = ref<Matter[]>([]);
    const entries = ref<EntryRow[]>([]);
    const taskSuggestions = ref<Record<string, string[]>>({});
    const saving = ref(false);
    const loading = ref(false);
    const currentTimesheetId = ref<string | null>(null);

    const urgencyOptions = ['HOT', 'MEDIUM', 'MILD'];

    const validationErrors = computed(() => {
      const errors: string[] = [];
      
      // Check for duplicate entries
      const entryKeys = entries.value
        .filter(e => e.matter && e.taskDescription)
        .map(e => `${e.matter?.id}-${e.taskDescription}`);
      const uniqueKeys = new Set(entryKeys);
      if (uniqueKeys.size !== entryKeys.length) {
        errors.push('Duplicate entries found for the same matter and task');
      }

      // Check individual percentages (just for display, not blocking)
      entries.value.forEach((entry, index) => {
        if (entry.projectedHours < 0 || entry.projectedHours > 100) {
          errors.push(`Row ${index + 1}: Projected hours must be between 0 and 100`);
        }
        if (entry.actualHours < 0 || entry.actualHours > 100) {
          errors.push(`Row ${index + 1}: Actual hours must be between 0 and 100`);
        }
      });

      return errors;
    });

    const canSave = computed(() => {
      return selectedTeamMember.value && 
             entries.value.some(e => e.matter);
    });

    const projectedTotal = computed(() => {
      return entries.value.reduce((sum, entry) => sum + (entry.projectedHours || 0), 0);
    });

    const actualTotal = computed(() => {
      return entries.value.reduce((sum, entry) => sum + (entry.actualHours || 0), 0);
    });

    const formattedWeekRange = computed(() => {
      const start = date.extractDate(currentWeekStart.value, 'YYYY-MM-DD');
      const end = date.addToDate(start, { days: 6 });
      return `${date.formatDate(start, 'MMM D')} - ${date.formatDate(end, 'MMM D, YYYY')}`;
    });

    function sundayOnly(dateValue: string | Date): boolean {
      // Quasar might pass a Date object or string
      let checkDate: Date;
      if (typeof dateValue === 'string') {
        // Use date.extractDate for consistent parsing with Quasar
        checkDate = date.extractDate(dateValue, 'YYYY-MM-DD');
      } else {
        checkDate = dateValue;
      }
      return checkDate.getDay() === 0;
    }

    function calculateHours(percentage: number): string {
      if (!selectedTeamMember.value) return '0';
      const hours = (percentage / 100) * selectedTeamMember.value.workingHours;
      return hours.toFixed(1);
    }

    function changeWeek(direction: number): void {
      // Use Quasar's date utilities for consistent date handling
      const current = date.extractDate(currentWeekStart.value, 'YYYY-MM-DD');
      const newDate = date.addToDate(current, { days: direction * 7 });
      
      // Ensure we're on a Sunday
      const day = newDate.getDay();
      if (day !== 0) {
        // Adjust to previous Sunday
        const daysToSubtract = day;
        newDate.setDate(newDate.getDate() - daysToSubtract);
      }
      
      currentWeekStart.value = date.formatDate(newDate, 'YYYY-MM-DD');
      loadTimesheet();
    }

    function onDateSelected(dateValue: string): void {
      if (!dateValue) return;
      
      // Use Quasar's date utilities
      const selectedDate = date.extractDate(dateValue, 'YYYY-MM-DD');
      const day = selectedDate.getDay();
      
      if (day !== 0) {
        // Adjust to previous Sunday
        const daysToSubtract = day;
        selectedDate.setDate(selectedDate.getDate() - daysToSubtract);
      }
      
      currentWeekStart.value = date.formatDate(selectedDate, 'YYYY-MM-DD');
      loadTimesheet();
    }

    function addEntry(): void {
      entries.value.push({
        matter: null,
        taskDescription: '',
        urgency: 'MEDIUM',
        projectedHours: 0,
        actualHours: 0,
      });
    }

    function removeEntry(index: number): void {
      entries.value.splice(index, 1);
    }

    function onMatterChange(index: number, matter: Matter): void {
      // Load task suggestions for this matter
      if (matter) {
        loadTasksForMatter(matter.id);
      }
    }

    function getTaskOptions(matter: Matter | null): string[] {
      if (!matter) return [];
      return taskSuggestions.value[matter.id] || [];
    }

    function createTaskOption(val: string, index: number): void {
      entries.value[index].taskDescription = val;
    }

    function validatePercentage(): void {
      // Percentages are validated through computed properties
    }

    async function loadTeamMembers(): Promise<void> {
      try {
        const response = await api.get('/team-members');
        teamMembers.value = response.data;
      } catch (error) {
        Notify.create({
          type: 'negative',
          message: 'Failed to load team members',
        });
      }
    }

    async function loadMatters(): Promise<void> {
      try {
        const response = await api.get('/matters');
        matters.value = response.data;
      } catch (error) {
        Notify.create({
          type: 'negative',
          message: 'Failed to load matters',
        });
      }
    }

    async function loadTasksForMatter(matterId: string): Promise<void> {
      try {
        const response = await api.get(`/tasks/matter/${matterId}`);
        taskSuggestions.value[matterId] = response.data.map((t: any) => t.description);
      } catch (error) {
        console.error('Failed to load tasks for matter:', error);
      }
    }

    async function loadTimesheet(): Promise<void> {
      if (!selectedTeamMember.value) return;

      loading.value = true;
      try {
        const response = await api.get(
          `/timesheets/${selectedTeamMember.value.id}/${currentWeekStart.value}`
        );
        const timesheet: Timesheet = response.data;
        currentTimesheetId.value = timesheet.id;

        // Convert timesheet entries to EntryRow format
        entries.value = timesheet.entries.map(entry => ({
          matter: entry.matter,
          taskDescription: entry.taskDescription,
          urgency: entry.urgency,
          projectedHours: entry.projectedHours,
          actualHours: entry.actualHours,
        }));

        // Load task suggestions for all matters
        const matterIds = new Set(entries.value.map(e => e.matter?.id).filter(Boolean));
        for (const matterId of matterIds) {
          if (matterId) {
            await loadTasksForMatter(matterId);
          }
        }

        // Add empty row if no entries
        if (entries.value.length === 0) {
          addEntry();
        }
      } catch (error) {
        // Silently handle - just start with empty timesheet
        entries.value = [];
        addEntry();
      } finally {
        loading.value = false;
      }
    }

    async function saveTimesheet(): Promise<void> {
      if (!selectedTeamMember.value || !entries.value.some(e => e.matter)) return;

      // Show warning if totals don't sum to 100%
      if (projectedTotal.value !== 100 || actualTotal.value !== 100) {
        Dialog.create({
          title: 'Warning',
          message: `Projected hours: ${projectedTotal.value}%, Actual hours: ${actualTotal.value}%. Both should total 100%. Continue anyway?`,
          cancel: true,
          persistent: true
        }).onCancel(() => {
          return;
        }).onOk(async () => {
          await performSave();
        });
      } else {
        await performSave();
      }
    }

    async function performSave(): Promise<void> {
      saving.value = true;
      try {
        const validEntries = entries.value
          .filter(e => e.matter && e.taskDescription)
          .map(e => ({
            matterId: e.matter!.id,
            taskDescription: e.taskDescription,
            urgency: e.urgency,
            projectedHours: e.projectedHours || 0,
            actualHours: e.actualHours || 0,
          }));

        await api.post(
          `/timesheets/${selectedTeamMember.value!.id}/${currentWeekStart.value}`,
          { entries: validEntries }
        );

        Notify.create({
          type: 'positive',
          message: 'Timesheet saved successfully',
        });
      } catch (error: any) {
        Notify.create({
          type: 'negative',
          message: error.response?.data?.error || 'Failed to save timesheet',
        });
      } finally {
        saving.value = false;
      }
    }

    async function copyFromLastWeek(): Promise<void> {
      if (!selectedTeamMember.value) return;

      // Check if current week has data
      const hasData = entries.value.some(e => e.matter);
      if (hasData) {
        Dialog.create({
          title: 'Confirm Copy',
          message: 'This will overwrite the current week\'s data. Continue?',
          cancel: true,
        }).onOk(async () => {
          await performCopyFromLastWeek();
        });
      } else {
        await performCopyFromLastWeek();
      }
    }

    async function performCopyFromLastWeek(): Promise<void> {
      loading.value = true;
      try {
        const response = await api.post(
          `/timesheets/${selectedTeamMember.value!.id}/${currentWeekStart.value}/copy-from-previous`
        );

        await loadTimesheet();
        
        Notify.create({
          type: 'positive',
          message: 'Copied data from last week',
        });
      } catch (error: any) {
        Notify.create({
          type: 'negative',
          message: error.response?.data?.error || 'Failed to copy from last week',
        });
      } finally {
        loading.value = false;
      }
    }

    onMounted(async () => {
      // Debug: Check what day we're starting with
      const startDate = currentWeekStart.value;
      const parsedDate = date.extractDate(startDate, 'YYYY-MM-DD');
      console.log('Initial date:', startDate, 'Day of week:', parsedDate.getDay(), '(0=Sunday)');
      
      await Promise.all([loadTeamMembers(), loadMatters()]);
    });

    return {
      selectedTeamMember,
      currentWeekStart,
      teamMembers,
      matters,
      entries,
      urgencyOptions,
      saving,
      validationErrors,
      canSave,
      projectedTotal,
      actualTotal,
      formattedWeekRange,
      sundayOnly,
      calculateHours,
      changeWeek,
      onDateSelected,
      addEntry,
      removeEntry,
      onMatterChange,
      getTaskOptions,
      createTaskOption,
      validatePercentage,
      loadTimesheet,
      saveTimesheet,
      copyFromLastWeek,
    };
  },
});
</script>

<style scoped>
.timesheet-container {
  max-width: 1400px;
  margin: 0 auto;
}

.timesheet-grid {
  overflow-x: auto;
}

.q-table th {
  font-weight: 600;
  text-align: left;
}
</style>