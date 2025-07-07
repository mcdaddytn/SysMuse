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
                  :options="filteredMatters"
                  option-label="name"
                  option-value="id"
                  dense
                  filled
                  use-input
                  @filter="filterMatters"
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
                  @update:model-value="(val) => handleTaskSelection(val, index)"
                  @mouseenter="showAssociatedActivitiesTooltip = index"
                  @mouseleave="showAssociatedActivitiesTooltip = null"
                >
                  <template v-slot:option="scope">
                    <q-item v-bind="scope.itemProps">
                      <q-item-section avatar v-if="scope.opt.isAddNew">
                        <q-icon name="add" color="primary" />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label :class="{ 'text-primary': scope.opt.isAddNew }">
                          {{ scope.opt.label || scope.opt }}
                        </q-item-label>
                      </q-item-section>
                    </q-item>
                  </template>
                  <q-tooltip 
                    v-if="getAssociatedActivities(entry).length > 0 && showAssociatedActivitiesTooltip === index"
                    anchor="top middle"
                    self="bottom middle"
                    :offset="[10, 10]"
                    max-width="400px"
                    class="bg-grey-9 text-white q-pa-md"
                  >
                    <div class="text-weight-bold q-mb-sm">Associated IT Activities:</div>
                    <div v-for="activity in getAssociatedActivities(entry)" :key="activity.id" class="q-mb-xs">
                      <div class="text-weight-medium">{{ activity.title }}</div>
                      <div class="text-caption">
                        {{ activity.activityType }} • {{ formatDateTime(activity.startDate) }}
                        <span v-if="activity.durationMinutes"> • {{ formatDuration(activity.durationMinutes) }}</span>
                      </div>
                    </div>
                  </q-tooltip>
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
                  type="text"
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
                        @mousedown="startSpinning(index, 'projected', timeIncrement)"
                        @mouseup="stopSpinning"
                        @mouseleave="stopSpinning"
                      />
                      <q-btn
                        icon="keyboard_arrow_down"
                        size="xs"
                        flat
                        dense
                        @click="adjustTime(index, 'projected', -timeIncrement)"
                        @mousedown="startSpinning(index, 'projected', -timeIncrement)"
                        @mouseup="stopSpinning"
                        @mouseleave="stopSpinning"
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
                  type="text"
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
                        @mousedown="startSpinning(index, 'actual', timeIncrement)"
                        @mouseup="stopSpinning"
                        @mouseleave="stopSpinning"
                      />
                      <q-btn
                        icon="keyboard_arrow_down"
                        size="xs"
                        flat
                        dense
                        @click="adjustTime(index, 'actual', -timeIncrement)"
                        @mousedown="startSpinning(index, 'actual', -timeIncrement)"
                        @mouseup="stopSpinning"
                        @mouseleave="stopSpinning"
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
import { defineComponent, ref, computed, onMounted, onUnmounted, watch } from 'vue';
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
  itActivityAssociations?: Array<{
    id: string;
    durationMinutes: number;
    itActivity: {
      id: string;
      title: string;
      activityType: string;
      startDate: string;
      teamMember: any;
    };
  }>;
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
    const initialDate = route.query.startDate as string | undefined || route.query.date as string | undefined;
    const fromITActivity = route.query.fromITActivity === 'true';

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
    const filteredMatters = ref<Matter[]>([]);
    const entries = ref<EntryRow[]>([]);
    const taskSuggestions = ref<Record<string, string[]>>({});
    const saving = ref(false);
    const loading = ref(false);
    const currentTimesheetId = ref<string | null>(null);
    const showTaskDialog = ref(false);
    const selectedMatterForTask = ref<Matter | null>(null);
    const showAssociatedActivitiesTooltip = ref<number | null>(null);

    // Spin control state
    const spinInterval = ref<NodeJS.Timeout | null>(null);
    const spinAcceleration = ref<NodeJS.Timeout | null>(null);
    const spinRate = ref(200); // Initial rate in milliseconds (5 times per second)

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
      
      if (timeIncrementType.value === 'PERCENT') {
        return total <= 100; // Error only when over 100%
      } else {
        // For time mode, allow up to working hours
        const maxHours = dateIncrementType.value === 'DAY' 
          ? selectedTeamMember.value.workingHours / 5 // Daily hours
          : selectedTeamMember.value.workingHours; // Weekly hours
        return total <= maxHours * 60;
      }
    }

    function hasValidationWarning(): { hasWarning: boolean; message: string } {
      if (!selectedTeamMember.value || !entries.value.some(e => e.matter)) {
        return { hasWarning: false, message: '' };
      }

      if (timeIncrementType.value === 'PERCENT') {
        // Error conditions (prevent save)
        if (projectedTotal.value > 100 || actualTotal.value > 100) {
          return {
            hasWarning: true,
            message: `Percentage totals cannot exceed 100% (Projected: ${projectedTotal.value}%, Actual: ${actualTotal.value}%).`
          };
        }
        
        // Warning conditions (allow save with confirmation)
        if (projectedTotal.value < 100 && projectedTotal.value > 0) {
          return {
            hasWarning: true,
            message: `Projected time is ${projectedTotal.value}% (less than 100%). Continue anyway?`
          };
        }
      } else {
        // Time mode validation
        const maxHours = dateIncrementType.value === 'DAY' 
          ? selectedTeamMember.value.workingHours / 5
          : selectedTeamMember.value.workingHours;
        const maxMinutes = maxHours * 60;
        
        if (projectedTotal.value > maxMinutes || actualTotal.value > maxMinutes) {
          return {
            hasWarning: true,
            message: `Time totals exceed working hours (Projected: ${formatTotalTime(projectedTotal.value)}, Actual: ${formatTotalTime(actualTotal.value)}).`
          };
        }
      }

      return { hasWarning: false, message: '' };
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

    function startSpinning(index: number, type: 'projected' | 'actual', increment: number): void {
      // Stop any existing spinning
      stopSpinning();
      
      // Reset spin rate to initial value
      spinRate.value = 200;
      
      // Set up continuous spinning after a short delay to allow for single clicks
      spinInterval.value = setTimeout(() => {
        // First increment after delay
        adjustTime(index, type, increment);
        
        // Then start continuous spinning
        spinInterval.value = setInterval(() => {
          adjustTime(index, type, increment);
        }, spinRate.value);
        
        // Set up acceleration after 1 second
        spinAcceleration.value = setTimeout(() => {
          accelerateSpinning(index, type, increment);
        }, 1000);
      }, 300); // 300ms delay to distinguish from single click
    }

    function accelerateSpinning(index: number, type: 'projected' | 'actual', increment: number): void {
      if (spinInterval.value) {
        clearInterval(spinInterval.value);
        spinRate.value = Math.max(50, spinRate.value * 0.7); // Accelerate to max 20 per second
        
        spinInterval.value = setInterval(() => {
          adjustTime(index, type, increment);
        }, spinRate.value);
        
        // Continue accelerating every 500ms until we reach minimum rate
        if (spinRate.value > 50) {
          spinAcceleration.value = setTimeout(() => {
            accelerateSpinning(index, type, increment);
          }, 500);
        }
      }
    }

    function stopSpinning(): void {
      if (spinInterval.value) {
        clearInterval(spinInterval.value);
        spinInterval.value = null;
      }
      if (spinAcceleration.value) {
        clearTimeout(spinAcceleration.value);
        spinAcceleration.value = null;
      }
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

    function filterMatters(val: string, update: (fn: () => void) => void): void {
      update(() => {
        if (val === '') {
          filteredMatters.value = matters.value;
        } else {
          const needle = val.toLowerCase();
          filteredMatters.value = matters.value.filter(matter => 
            matter.name.toLowerCase().includes(needle) ||
            matter.client.name.toLowerCase().includes(needle)
          );
        }
      });
    }

    function onMatterChange(index: number, matter: Matter): void {
      if (matter) {
        loadTasksForMatter(matter.id);
      }
    }

    function getTaskOptions(matter: Matter | null): Array<string | { label: string; value: string; isAddNew?: boolean }> {
      if (!matter) return [];
      const tasks = taskSuggestions.value[matter.id] || [];
      // Always include "Add New Task" option when matter is selected
      return [
        ...tasks,
        { label: 'Add New Task', value: '__ADD_NEW__', isAddNew: true }
      ];
    }

    function createTaskOption(val: string, index: number): void {
      entries.value[index].taskDescription = val;
    }

    function handleTaskSelection(val: any, index: number): void {
      if (val && typeof val === 'object' && val.isAddNew) {
        // Clear the selection first
        entries.value[index].taskDescription = '';
        // Show the dialog
        if (entries.value[index].matter) {
          showNewTaskDialog(entries.value[index].matter);
        }
      } else {
        // Normal task selection
        entries.value[index].taskDescription = val;
      }
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
        filteredMatters.value = response.data; // Initialize filtered matters
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

     const validation = hasValidationWarning();
     
     if (validation.hasWarning) {
       // Check if it's an error condition (over 100% in percentage mode)
       const isError = timeIncrementType.value === 'PERCENT' && 
                      (projectedTotal.value > 100 || actualTotal.value > 100);
       
       if (isError) {
         Dialog.create({
           title: 'Error',
           message: validation.message,
           persistent: true
         });
         return;
       }
       
       // Show warning with option to continue
       Dialog.create({
         title: 'Warning',
         message: validation.message,
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

   // Function to get associated IT activities for a timesheet entry
   function getAssociatedActivities(entry: EntryRow): any[] {
     if (!entry.itActivityAssociations) return [];
     return entry.itActivityAssociations.map(assoc => ({
       ...assoc.itActivity,
       durationMinutes: assoc.durationMinutes
     }));
   }

   // Utility functions for formatting
   function formatDateTime(dateString: string): string {
     return date.formatDate(new Date(dateString), 'MMM D, YYYY h:mm A');
   }

   function formatDuration(minutes: number): string {
     const hours = Math.floor(minutes / 60);
     const mins = minutes % 60;
     if (hours > 0) {
       return `${hours}h ${mins}m`;
     }
     return `${mins}m`;
   }

   onMounted(async () => {
     await Promise.all([loadTeamMembers(), loadMatters()]);
   });

   onUnmounted(() => {
     stopSpinning();
   });

   return {
     // State
     dateIncrementType,
     selectedTeamMember,
     currentStartDate,
     teamMembers,
     matters,
     filteredMatters,
     entries,
     urgencyOptions,
     saving,
     validationErrors,
     canSave,
     projectedTotal,
     actualTotal,
     showTaskDialog,
     selectedMatterForTask,
     showAssociatedActivitiesTooltip,
     
     // Computed
     dateRangeLabel,
     formattedDateRange,
     copyButtonLabel,
     switchButtonLabel,
     timeIncrementType,
     timeIncrement,
     projectedTimeLabel,
     actualTimeLabel,
     
     // Methods
     dateOptions,
     formatTotalTime,
     isValidTotal,
     hasValidationWarning,
     getTimeTooltip,
     getTotalTooltip,
     updateProjectedTime,
     updateActualTime,
     adjustTime,
     startSpinning,
     stopSpinning,
     changeDateRange,
     onDateSelected,
     switchMode,
     openITActivities,
     addEntry,
     removeEntry,
     filterMatters,
     onMatterChange,
     getTaskOptions,
     createTaskOption,
     handleTaskSelection,
     showNewTaskDialog,
     onTaskCreated,
     loadTimesheet,
     saveTimesheet,
     copyFromPrevious,
     getAssociatedActivities,
     formatDateTime,
     formatDuration,
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
    