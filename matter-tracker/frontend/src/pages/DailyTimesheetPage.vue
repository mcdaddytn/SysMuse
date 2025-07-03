<!-- src/pages/DailyTimesheetPage.vue -->
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
              v-model="formattedDay"
              label="Day"
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
                  @click="changeDay(-1)"
                />
              </template>
              <template v-slot:append>
                <q-btn
                  icon="chevron_right"
                  flat
                  round
                  dense
                  @click="changeDay(1)"
                />
                <q-icon name="event" class="cursor-pointer">
                  <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                    <q-date
                      :model-value="currentDay"
                      @update:model-value="onDateSelected"
                      mask="YYYY-MM-DD"
                    />
                  </q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <div class="col-auto">
            <q-btn
              label="Copy from Previous Day"
              color="secondary"
              @click="copyFromPreviousDay"
              :disable="!selectedTeamMember"
            />
          </div>

          <div class="col-auto">
            <q-btn
              label="Switch to Weekly"
              color="info"
              @click="switchToWeekly"
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
import { defineComponent, ref, computed, onMounted } from 'vue';
import { date, Notify, Dialog } from 'quasar';
import { useRouter } from 'vue-router';
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
import type { TeamMember, Matter, TimesheetEntry, Timesheet, TimeIncrementType, Task } from 'src/types/models';

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
  name: 'DailyTimesheetPage',
  components: {
    NewTaskDialog,
  },
  setup() {
    const router = useRouter();

    const getInitialDay = (): string => {
      const today = new Date();
      return date.formatDate(today, 'YYYY-MM-DD');
    };

    const selectedTeamMember = ref<TeamMember | null>(null);
    const currentDay = ref<string>(getInitialDay());
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

    const formattedDay = computed(() => {
      const dayDate = date.extractDate(currentDay.value, 'YYYY-MM-DD');
      return date.formatDate(dayDate, 'dddd, MMMM D, YYYY');
    });

    function formatTotalTime(total: number): string {
      return formatTime(total, timeIncrementType.value);
    }

    function isValidTotal(total: number): boolean {
      if (!selectedTeamMember.value) return true;
      
      // For daily timesheets, we need to adjust the validation
      // A day might be less than 100% or full working hours
      if (timeIncrementType.value === 'PERCENT') {
        return total <= 100; // Allow partial days
      } else {
        // For time mode, allow up to working hours per day
        const dailyHours = selectedTeamMember.value.workingHours / 5; // Assume 5-day work week
        return total <= dailyHours * 60;
      }
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

    function changeDay(direction: number): void {
      const current = date.extractDate(currentDay.value, 'YYYY-MM-DD');
      const newDate = date.addToDate(current, { days: direction });
      currentDay.value = date.formatDate(newDate, 'YYYY-MM-DD');
      loadTimesheet();
    }

    function onDateSelected(dateValue: string): void {
      if (!dateValue) return;
      currentDay.value = dateValue;
      loadTimesheet();
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

    function switchToWeekly(): void {
      router.push('/');
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
          `/timesheets/${selectedTeamMember.value.id}/${currentDay.value}/DAY`
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

      await performSave();
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
          `/timesheets/${selectedTeamMember.value!.id}/${currentDay.value}/DAY`,
          { 
            entries: validEntries,
            dateIncrementType: 'DAY',
            timeIncrementType: timeIncrementType.value,
            timeIncrement: timeIncrement.value,
          }
        );

        Notify.create({
          type: 'positive',
          message: 'Daily timesheet saved successfully',
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

    async function copyFromPreviousDay(): Promise<void> {
      if (!selectedTeamMember.value) return;

      const hasData = entries.value.some(e => e.matter);
      if (hasData) {
        Dialog.create({
          title: 'Confirm Copy',
          message: 'This will overwrite the current day\'s data. Continue?',
          cancel: true,
        }).onOk(async () => {
          await performCopyFromPreviousDay();
        });
      } else {
        await performCopyFromPreviousDay();
      }
    }

    async function performCopyFromPreviousDay(): Promise<void> {
      loading.value = true;
      try {
        await api.post(
          `/timesheets/${selectedTeamMember.value!.id}/${currentDay.value}/DAY/copy-from-previous`
        );

        await loadTimesheet();
        
        Notify.create({
          type: 'positive',
          message: 'Copied data from previous day',
        });
      } catch (error: any) {
        Notify.create({
          type: 'negative',
          message: error.response?.data?.error || 'Failed to copy from previous day',
        });
      } finally {
        loading.value = false;
      }
    }

    onMounted(async () => {
      await Promise.all([loadTeamMembers(), loadMatters()]);
    });

    return {
      selectedTeamMember,
      currentDay,
      teamMembers,
      matters,
      entries,
      urgencyOptions,
      saving,
      validationErrors,
      canSave,
      projectedTotal,
      actualTotal,
      formattedDay,
      timeIncrementType,
      timeIncrement,
      timeInputType,
      projectedTimeLabel,
      actualTimeLabel,
      showTaskDialog,
      selectedMatterForTask,
      formatTotalTime,
      isValidTotal,
      getTimeTooltip,
      getTotalTooltip,
      updateProjectedTime,
      updateActualTime,
      adjustTime,
      changeDay,
      onDateSelected,
      addEntry,
      removeEntry,
      onMatterChange,
      getTaskOptions,
      createTaskOption,
      showNewTaskDialog,
      onTaskCreated,
      switchToWeekly,
      loadTimesheet,
      saveTimesheet,
      copyFromPreviousDay,
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
