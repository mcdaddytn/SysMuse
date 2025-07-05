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
              v-model="formattedDateRange"
              :label="dateRangeLabel"
              filled
              readonly
              style="min-width: 250px"
            >
              <template v-slot:prepend>
                <q-btn
                  icon="chevron_left"
                  flat
                  round
                  dense
                  @click="changeDateRange(-1)"
                />
              </template>
              <template v-slot:append>
                <q-btn
                  icon="chevron_right"
                  flat
                  round
                  dense
                  @click="changeDateRange(1)"
                />
                <q-icon name="event" class="cursor-pointer">
                  <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                    <q-date
                      :model-value="currentStartDate"
                      @update:model-value="onDateSelected"
                      mask="YYYY-MM-DD"
                      :options="dateOptions"
                    />
                  </q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <div class="col-auto">
            <q-btn
              :label="copyButtonLabel"
              color="secondary"
              @click="copyFromPrevious"
              :disable="!selectedTeamMember"
            />
          </div>

          <div class="col-auto">
            <q-btn
              :label="switchButtonLabel"
              color="info"
              @click="switchMode"
              :disable="!selectedTeamMember"
            />
          </div>

          <div class="col-auto">
            <q-btn
              label="IT Activities"
              color="accent"
              @click="openITActivities"
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
              <th style="width: 150px">{{ projectedTimeLabel }}</th>
              <th style="width: 150px">{{ actualTimeLabel }}</th>
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
                >
                  <template v-slot:after-options>
                    <q-item 
                      clickable 
                      v-if="entry.matter"
                      @click="showNewTaskDialog(entry.matter)"
                    >
                      <q-item-section avatar>
                        <q-icon name="add" color="primary" />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label>Add New Task</q-item-label>
                      </q-item-section>
                    </q-item>
                  </template>
                </q-select>
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
                <q-input
                  v-model="entry.projectedTimeDisplay"
                  :type="timeInputType"
                  dense
                  filled
                  style="width: 120px"
                  @blur="updateProjectedTime(index, entry.projectedTimeDisplay)"
                  @keyup.enter="updateProjectedTime(index, entry.projectedTimeDisplay)"
                >
                  <template v-slot:append>
                    <div class="column">
                      <q-btn
                        icon="keyboard_arrow_up"
                        size="xs"
                        flat
                        dense
                        @click="adjustTime(index, 'projected', timeIncrement)"
                      />
                      <q-btn
                        icon="keyboard_arrow_down"
                        size="xs"
                        flat
                        dense
                        @click="adjustTime(index, 'projected', -timeIncrement)"
                      />
                    </div>
                  </template>
                  <q-tooltip v-if="selectedTeamMember">
                    {{ getTimeTooltip(entry.projectedTime) }}
                  </q-tooltip>
                </q-input>
              </td>
              <td>
                <q-input
                  v-model="entry.actualTimeDisplay"
                  :type="timeInputType"
                  dense
                  filled
                  style="width: 120px"
                  @blur="updateActualTime(index, entry.actualTimeDisplay)"
                  @keyup.enter="updateActualTime(index, entry.actualTimeDisplay)"
                >
                  <template v-slot:append>
                    <div class="column">
                      <q-btn
                        icon="keyboard_arrow_up"
                        size="xs"
                        flat
                        dense
                        @click="adjustTime(index, 'actual', timeIncrement)"
                      />
                      <q-btn
                        icon="keyboard_arrow_down"
                        size="xs"
                        flat
                        dense
                        @click="adjustTime(index, 'actual', -timeIncrement)"
                      />
                    </div>
                  </template>
                  <q-tooltip v-if="selectedTeamMember">
                    {{ getTimeTooltip(entry.actualTime) }}
                  </q-tooltip>
                </q-input>
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
                <span :class="{ 'text-negative': !isValidTotal(projectedTotal) }">
                  {{ formatTotalTime(projectedTotal) }}
                </span>
                <q-tooltip v-if="selectedTeamMember">
                  {{ getTotalTooltip(projectedTotal) }}
                </q-tooltip>
              </td>
              <td>
                <span :class="{ 'text-negative': !isValidTotal(actualTotal) }">
                  {{ formatTotalTime(actualTotal) }}
                </span>
                <q-tooltip v-if="selectedTeamMember">
                  {{ getTotalTooltip(actualTotal) }}
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

    <!-- New Task Dialog -->
    <new-task-dialog
      v-model="showTaskDialog"
      :matter="selectedMatterForTask"
      @task-created="onTaskCreated"
    />
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, watch } from 'vue';
import { date, Notify, Dialog } from 'quasar';
import { useRouter, useRoute } from 'vue-router';
import { api } from 'src/services/api';
import { 
  formatTime, 
  formatTimeWithTooltip, 
  parseTimeInput, 
  getTimeIncrementStep,
  getMaxTimeValue,
  isValidTotalTime
} from 'src/utils/timeUtils';
import NewTaskDialog from 'src/components/NewTaskDialog.vue';
import type { TeamMember, Matter, TimesheetEntry, Timesheet, TimeIncrementType, Task, DateIncrementType } from 'src/types/models';

interface EntryRow {
  matter: Matter | null;
  taskDescription: string;
  urgency: 'HOT' | 'MEDIUM' | 'MILD';
  projectedTime: number;
  actualTime: number;
  projectedTimeDisplay: string;
  actualTimeDisplay: string;
}

export default defineComponent({
  name: 'TimesheetPage',
  components: {
    NewTaskDialog,
  },
  setup() {
    const router = useRouter();
    const route = useRoute();

    // Parse query parameters for initialization
    const initialMode = (route.query.mode as DateIncrementType) || 'WEEK';
    const initialTeamMemberId = route.query.teamMemberId as string | undefined;
    const initialDate = route.query.date as string | undefined;

    // Get initial date based on mode
    const getInitialDate = (mode: DateIncrementType): string => {
      if (initialDate) {
        const parsedDate = new Date(initialDate);
        if (mode === 'WEEK') {
          // Adjust to Sunday if needed
          const day = parsedDate.getDay();
          if (day !== 0) {
            parsedDate.setDate(parsedDate.getDate() - day);
          }
        }
        return date.formatDate(parsedDate, 'YYYY-MM-DD');
      }
      
      const today = new Date();
      if (mode === 'WEEK') {
        const day = today.getDay();
        if (day !== 0) {
          today.setDate(today.getDate() - day);
        }
      }
      return date.formatDate(today, 'YYYY-MM-DD');
    };

    // State
    const dateIncrementType = ref<DateIncrementType>(initialMode);
    const selectedTeamMember = ref<TeamMember | null>(null);
    const currentStartDate = ref<string>(getInitialDate(initialMode));
    const teamMembers = ref<TeamMember[]>([]);
    const matters = ref<Matter[]>([]);
    const entries = ref<EntryRow[]>([]);
    const taskSuggestions = ref<Record<string, string[]>>({});
    const saving = ref(false);
    const loading = ref(false);
    const currentTimesheetId = ref<string | null>(null);
    const showTaskDialog = ref(false);
    const selectedMatterForTask = ref<Matter | null>(null);

    const urgencyOptions = ['HOT', 'MEDIUM', 'MILD'];

    // Computed properties
    const dateRangeLabel = computed(() => {
      return dateIncrementType.value === 'WEEK' ? 'Week' : 'Day';
    });

    const formattedDateRange = computed(() => {
      const startDate = date.extractDate(currentStartDate.value, 'YYYY-MM-DD');
      
      if (dateIncrementType.value === 'WEEK') {
        const endDate = date.addToDate(startDate, { days: 6 });
        return `${date.formatDate(startDate, 'MMM D')} - ${date.formatDate(endDate, 'MMM D, YYYY')}`;
      } else {
        return date.formatDate(startDate, 'dddd, MMMM D, YYYY');
      }
    });

    const copyButtonLabel = computed(() => {
      return dateIncrementType.value === 'WEEK' ? 'Copy from Last Week' : 'Copy from Yesterday';
    });

    const switchButtonLabel = computed(() => {
      return dateIncrementType.value === 'WEEK' ? 'Switch to Daily' : 'Switch to Weekly';
    });

    const timeIncrementType = computed((): TimeIncrementType => {
      return selectedTeamMember.value?.timeIncrementType || 'PERCENT';
    });

    const timeIncrement = computed((): number => {
      return getTimeIncrementStep(timeIncrementType.value, selectedTeamMember.value?.timeIncrement || 1);
    });

    const timeInputType = computed((): string => {
      return timeIncrementType.value === 'PERCENT' ? 'number' : 'text';
    });

    const projectedTimeLabel = computed((): string => {
      return timeIncrementType.value === 'PERCENT' ? 'Projected (%)' : 'Projected Time';
    });

    const actualTimeLabel = computed((): string => {
      return timeIncrementType.value === 'PERCENT' ? 'Actual (%)' : 'Actual Time';
    });

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

      return errors;
    });

    const canSave = computed(() => {
      return selectedTeamMember.value && 
             entries.value.some(e => e.matter);
    });

    const projectedTotal = computed(() => {
      return entries.value.reduce((sum, entry) => sum + (entry.projectedTime || 0), 0);
    });

    const actualTotal = computed(() => {
      return entries.value.reduce((sum, entry) => sum + (entry.actualTime || 0), 0);
    });

    // Methods
    function dateOptions(dateStr: string): boolean {
      if (dateIncrementType.value === 'WEEK') {
        // Only Sundays for weekly mode
        const parts = dateStr.split('/');
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const day = parseInt(parts[2]);
        const checkDate = new Date(year, month, day);
        return checkDate.getDay() === 0;
      }
      // All dates for daily mode
      return true;
    }

    function formatTotalTime(total: number): string {
      return formatTime(total, timeIncrementType.value);
    }

    function isValidTotal(total: number): boolean {
      if (!selectedTeamMember.value) return true;
      
      if (dateIncrementType.value === 'DAY') {
        // For daily timesheets, we need to adjust the validation
        if (timeIncrementType.value === 'PERCENT') {
          return total <= 100; // Allow partial days
        } else {
          // For time mode, allow up to working hours per day
          const dailyHours = selectedTeamMember.value.workingHours / 5; // Assume 5-day work week
          return total <= dailyHours * 60;
        }
      }
      
      return isValidTotalTime(total, timeIncrementType.value, selectedTeamMember.value.workingHours);
    }

    function getTimeTooltip(timeValue: number): string {
      if (!selectedTeamMember.value) return '';
      const formatted = formatTimeWithTooltip(timeValue, timeIncrementType.value, selectedTeamMember.value);
      return formatted.tooltip;
    }

    function getTotalTooltip(total: number): string {
      if (!selectedTeamMember.value) return '';
      const formatted = formatTimeWithTooltip(total, timeIncrementType.value, selectedTeamMember.value);
      return formatted.tooltip;
    }

    function updateDisplayTime(entry: EntryRow): void {
      entry.projectedTimeDisplay = formatTime(entry.projectedTime, timeIncrementType.value);
      entry.actualTimeDisplay = formatTime(entry.actualTime, timeIncrementType.value);
    }

    function updateProjectedTime(index: number, displayValue: string): void {
      const parsedValue = parseTimeInput(displayValue, timeIncrementType.value);
      entries.value[index].projectedTime = parsedValue;
      updateDisplayTime(entries.value[index]);
    }

    function updateActualTime(index: number, displayValue: string): void {
      const parsedValue = parseTimeInput(displayValue, timeIncrementType.value);
      entries.value[index].actualTime = parsedValue;
      updateDisplayTime(entries.value[index]);
    }

    function adjustTime(index: number, type: 'projected' | 'actual', increment: number): void {
      const entry = entries.value[index];
      const maxValue = selectedTeamMember.value ? getMaxTimeValue(timeIncrementType.value, selectedTeamMember.value.workingHours) : 100;
      
      if (type === 'projected') {
        entry.projectedTime = Math.max(0, Math.min(maxValue, entry.projectedTime + increment));
      } else {
        entry.actualTime = Math.max(0, Math.min(maxValue, entry.actualTime + increment));
      }
      
      updateDisplayTime(entry);
    }

    function changeDateRange(direction: number): void {
      const current = date.extractDate(currentStartDate.value, 'YYYY-MM-DD');
      const increment = dateIncrementType.value === 'WEEK' ? 7 : 1;
      const newDate = date.addToDate(current, { days: direction * increment });
      
      if (dateIncrementType.value === 'WEEK') {
        // Ensure we're on a Sunday
        const day = newDate.getDay();
        if (day !== 0) {
          newDate.setDate(newDate.getDate() - day);
        }
      }
      
      currentStartDate.value = date.formatDate(newDate, 'YYYY-MM-DD');
      loadTimesheet();
    }

    function onDateSelected(dateValue: string): void {
      if (!dateValue) return;
      
      const selectedDate = date.extractDate(dateValue, 'YYYY-MM-DD');
      
      if (dateIncrementType.value === 'WEEK') {
        const day = selectedDate.getDay();
        if (day !== 0) {
          selectedDate.setDate(selectedDate.getDate() - day);
        }
      }
      
      currentStartDate.value = date.formatDate(selectedDate, 'YYYY-MM-DD');
      loadTimesheet();
    }

    function switchMode(): void {
      dateIncrementType.value = dateIncrementType.value === 'WEEK' ? 'DAY' : 'WEEK';
      
      // Adjust date if switching to weekly mode and not on Sunday
      if (dateIncrementType.value === 'WEEK') {
        const current = date.extractDate(currentStartDate.value, 'YYYY-MM-DD');
        const day = current.getDay();
        if (day !== 0) {
          current.setDate(current.getDate() - day);
          currentStartDate.value = date.formatDate(current, 'YYYY-MM-DD');
        }
      }
      
      loadTimesheet();
    }

    function openITActivities(): void {
      if (!selectedTeamMember.value) return;
      
      // Calculate end date based on mode
      const startDate = currentStartDate.value;
      let endDate: string;
      
      if (dateIncrementType.value === 'WEEK') {
        const end = date.addToDate(date.extractDate(startDate, 'YYYY-MM-DD'), { days: 6 });
        endDate = date.formatDate(end, 'YYYY-MM-DD');
      } else {
        endDate = startDate;
      }
      
      router.push({
        path: '/it-activities',
        query: {
          teamMemberId: selectedTeamMember.value.id,
          startDate,
          endDate,
          returnTo: 'timesheet',
          returnMode: dateIncrementType.value,
        },
      });
    }

    function addEntry(): void {
      const newEntry: EntryRow = {
        matter: null,
        taskDescription: '',
        urgency: 'MEDIUM',
        projectedTime: 0,
        actualTime: 0,
        projectedTimeDisplay: formatTime(0, timeIncrementType.value),
        actualTimeDisplay: formatTime(0, timeIncrementType.value),
      };
      entries.value.push(newEntry);
    }

    function removeEntry(index: number): void {
      entries.value.splice(index, 1);
    }

    function onMatterChange(index: number, matter: Matter): void {
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

    function showNewTaskDialog(matter: Matter): void {
      selectedMatterForTask.value = matter;
      showTaskDialog.value = true;
    }

    function onTaskCreated(task: Task): void {
      if (!taskSuggestions.value[task.matterId]) {
        taskSuggestions.value[task.matterId] = [];
      }
      taskSuggestions.value[task.matterId].push(task.description);
      
      Notify.create({
        type: 'positive',
        message: 'Task created successfully',
      });
    }

    async function loadTeamMembers(): Promise<void> {
      try {
        const response = await api.get('/team-members');
        teamMembers.value = response.data;
        
        // Set initial team member if provided
        if (initialTeamMemberId) {
          selectedTeamMember.value = teamMembers.value.find(tm => tm.id === initialTeamMemberId) || null;
          if (selectedTeamMember.value) {
            await loadTimesheet();
          }
        }
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
          `/timesheets/${selectedTeamMember.value.id}/${currentStartDate.value}/${dateIncrementType.value}`
        );
        const timesheet: Timesheet = response.data;
        currentTimesheetId.value = timesheet.id;

        // Convert timesheet entries to EntryRow format
        entries.value = timesheet.entries.map(entry => {
          const entryRow: EntryRow = {
            matter: entry.matter,
            taskDescription: entry.taskDescription,
            urgency: entry.urgency,
            projectedTime: entry.projectedTime,
            actualTime: entry.actualTime,
            projectedTimeDisplay: formatTime(entry.projectedTime, timesheet.timeIncrementType),
            actualTimeDisplay: formatTime(entry.actualTime, timesheet.timeIncrementType),
          };
          return entryRow;
        });

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
        entries.value = [];
        addEntry();
      } finally {
        loading.value = false;
      }
    }

    async function saveTimesheet(): Promise<void> {
     if (!selectedTeamMember.value || !entries.value.some(e => e.matter)) return;

     // Show warning if totals are invalid
     const projectedValid = isValidTotal(projectedTotal.value);
     const actualValid = isValidTotal(actualTotal.value);
     
     if (!projectedValid || !actualValid) {
       const message = timeIncrementType.value === 'PERCENT' 
         ? `Time totals don't equal 100% (Projected: ${projectedTotal.value}%, Actual: ${actualTotal.value}%).`
         : `Time totals exceed working hours (Projected: ${formatTotalTime(projectedTotal.value)}, Actual: ${formatTotalTime(actualTotal.value)}).`;
       
       Dialog.create({
         title: 'Warning',
         message: message + ' Continue anyway?',
         cancel: true,
         persistent: true
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
           projectedTime: e.projectedTime,
           actualTime: e.actualTime,
         }));

       await api.post(
         `/timesheets/${selectedTeamMember.value!.id}/${currentStartDate.value}/${dateIncrementType.value}`,
         { 
           entries: validEntries,
           dateIncrementType: dateIncrementType.value,
           timeIncrementType: timeIncrementType.value,
           timeIncrement: timeIncrement.value,
         }
       );

       Notify.create({
         type: 'positive',
         message: 'Timesheet saved successfully',
       });
     } catch (error: any) {
       console.error('Save error:', error.response?.data);
       Notify.create({
         type: 'negative',
         message: error.response?.data?.error || 'Failed to save timesheet',
       });
     } finally {
       saving.value = false;
     }
   }

   async function copyFromPrevious(): Promise<void> {
     if (!selectedTeamMember.value) return;

     const hasData = entries.value.some(e => e.matter);
     if (hasData) {
       Dialog.create({
         title: 'Confirm Copy',
         message: `This will overwrite the current ${dateIncrementType.value.toLowerCase()}'s data. Continue?`,
         cancel: true,
       }).onOk(async () => {
         await performCopyFromPrevious();
       });
     } else {
       await performCopyFromPrevious();
     }
   }

   async function performCopyFromPrevious(): Promise<void> {
     loading.value = true;
     try {
       await api.post(
         `/timesheets/${selectedTeamMember.value!.id}/${currentStartDate.value}/${dateIncrementType.value}/copy-from-previous`
       );

       await loadTimesheet();
       
       Notify.create({
         type: 'positive',
         message: `Copied data from previous ${dateIncrementType.value.toLowerCase()}`,
       });
     } catch (error: any) {
       Notify.create({
         type: 'negative',
         message: error.response?.data?.error || `Failed to copy from previous ${dateIncrementType.value.toLowerCase()}`,
       });
     } finally {
       loading.value = false;
     }
   }

   onMounted(async () => {
     await Promise.all([loadTeamMembers(), loadMatters()]);
   });

   return {
     // State
     dateIncrementType,
     selectedTeamMember,
     currentStartDate,
     teamMembers,
     matters,
     entries,
     urgencyOptions,
     saving,
     validationErrors,
     canSave,
     projectedTotal,
     actualTotal,
     showTaskDialog,
     selectedMatterForTask,
     
     // Computed
     dateRangeLabel,
     formattedDateRange,
     copyButtonLabel,
     switchButtonLabel,
     timeIncrementType,
     timeIncrement,
     timeInputType,
     projectedTimeLabel,
     actualTimeLabel,
     
     // Methods
     dateOptions,
     formatTotalTime,
     isValidTotal,
     getTimeTooltip,
     getTotalTooltip,
     updateProjectedTime,
     updateActualTime,
     adjustTime,
     changeDateRange,
     onDateSelected,
     switchMode,
     openITActivities,
     addEntry,
     removeEntry,
     onMatterChange,
     getTaskOptions,
     createTaskOption,
     showNewTaskDialog,
     onTaskCreated,
     loadTimesheet,
     saveTimesheet,
     copyFromPrevious,
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

.column {
 display: flex;
 flex-direction: column;
 gap: 1px;
}
</style>    
    