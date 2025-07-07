<template>
  <q-page class="q-pa-md">
    <div class="q-mb-md">
      <div class="row items-center justify-between q-mb-md">
        <div class="text-h4">IT Activity Tracker</div>
        <div class="row items-center q-gutter-md">
          <q-btn
            label="Back to Timesheets"
            color="primary"
            outline
            @click="returnToTimesheet"
          />
        </div>
      </div>

      <!-- Filters -->
      <div class="row items-center q-gutter-md q-mb-md">
        <div style="min-width: 200px">
          <q-select
            v-model="selectedTeamMember"
            :options="teamMembers"
            option-label="name"
            option-value="id"
            label="Team Member"
            filled
            @update:model-value="onTeamMemberChange"
          />
        </div>

        <div style="min-width: 150px">
          <q-input
            v-model="startDate"
            type="date"
            label="Start Date"
            filled
            @update:model-value="loadActivities"
          />
        </div>

        <div style="min-width: 150px">
          <q-input
            v-model="endDate"
            type="date"
            label="End Date"
            filled
            @update:model-value="loadActivities"
          />
        </div>

        <div style="min-width: 150px">
          <q-select
            v-model="activityTypeFilter"
            :options="activityTypeOptions"
            label="Activity Type"
            filled
            clearable
            @update:model-value="loadActivities"
          />
        </div>

        <div style="min-width: 150px">
          <q-select
            v-model="associationFilter"
            :options="associationOptions"
            label="Association Status"
            filled
            clearable
            @update:model-value="loadActivities"
          />
        </div>

        <q-btn
          icon="refresh"
          flat
          round
          @click="loadActivities"
          :loading="loading"
        />
      </div>

      <!-- Statistics Cards -->
      <div class="row q-gutter-md q-mb-md" v-if="statistics">
        <q-card class="col">
          <q-card-section>
            <div class="text-h6">Total Activities</div>
            <div class="text-h4 text-primary">{{ statistics.activityCounts.total }}</div>
          </q-card-section>
        </q-card>
        
        <q-card class="col">
          <q-card-section>
            <div class="text-h6">Calendar Events</div>
            <div class="text-h4 text-blue">{{ statistics.activityCounts.calendar }}</div>
          </q-card-section>
        </q-card>
        
        <q-card class="col">
          <q-card-section>
            <div class="text-h6">Emails</div>
            <div class="text-h4 text-green">{{ statistics.activityCounts.email }}</div>
          </q-card-section>
        </q-card>
        
        <q-card class="col">
          <q-card-section>
            <div class="text-h6">Documents</div>
            <div class="text-h4 text-orange">{{ statistics.activityCounts.document }}</div>
          </q-card-section>
        </q-card>
        
        <q-card class="col">
          <q-card-section>
            <div class="text-h6">Associated</div>
            <div class="text-h4 text-positive">{{ statistics.associationStatus.associated }}</div>
            <div class="text-caption">{{ statistics.associationStatus.associationRate }}% rate</div>
          </q-card-section>
        </q-card>
        
        <q-card class="col">
          <q-card-section>
            <div class="text-h6">Total Time</div>
            <div class="text-h4 text-purple">{{ statistics.totalDuration.hours }}h</div>
            <div class="text-caption">{{ statistics.totalDuration.minutes }} minutes</div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Activities Table -->
    <div>
      <q-table
        v-model:pagination="pagination"
        :rows="activities"
        :columns="columns"
        :loading="loading"
        :filter="tableFilter"
        binary-state-sort
        @request="onRequest"
      >
        <template v-slot:top-right>
          <q-input
            borderless
            dense
            debounce="300"
            v-model="tableFilter"
            placeholder="Search activities..."
          >
            <template v-slot:append>
              <q-icon name="search" />
            </template>
          </q-input>
        </template>

        <template v-slot:body-cell-activityType="props">
          <q-td :props="props">
            <q-chip
              :color="getActivityTypeColor(props.value)"
              text-color="white"
              :icon="getActivityTypeIcon(props.value)"
              size="sm"
            >
              {{ getActivityTypeLabel(props.value) }}
            </q-chip>
          </q-td>
        </template>

        <template v-slot:body-cell-title="props">
          <q-td :props="props" style="max-width: 300px">
            <div 
              class="text-weight-medium cursor-pointer"
              @mouseenter="showGridMetadataTooltip = props.row.id"
              @mouseleave="showGridMetadataTooltip = null"
            >
              {{ props.value }}
              <q-tooltip 
                v-if="props.row.metadata && showGridMetadataTooltip === props.row.id"
                anchor="top middle"
                self="bottom middle"
                :offset="[10, 10]"
                max-width="400px"
                class="bg-grey-9 text-white q-pa-md"
              >
                <div v-html="formatMetadataForTooltip(props.row.metadata)"></div>
              </q-tooltip>
            </div>
            <div class="text-caption text-grey-6" v-if="props.row.description">
              {{ truncateText(props.row.description, 80) }}
            </div>
          </q-td>
        </template>

        <template v-slot:body-cell-startDate="props">
          <q-td :props="props">
            <div>{{ formatDateTime(props.value) }}</div>
            <div class="text-caption text-grey-6" v-if="props.row.endDate">
              End: {{ formatDateTime(props.row.endDate) }}
            </div>
          </q-td>
        </template>

        <template v-slot:body-cell-duration="props">
          <q-td :props="props">
            <span v-if="props.row.endDate && props.row.activityType === 'CALENDAR'">
              {{ calculateDuration(props.row.startDate, props.row.endDate) }}
            </span>
            <span v-else-if="props.row.durationMinutes">
              {{ formatDuration(props.row.durationMinutes) }}
            </span>
            <span v-else class="text-grey-5">-</span>
          </q-td>
        </template>

        <template v-slot:body-cell-association="props">
          <q-td :props="props">
            <div v-if="props.row.isAssociated" class="text-positive">
              <q-icon name="check_circle" size="sm" />
              Associated
              <div class="text-caption" v-if="props.row.matter">
                {{ props.row.matter.name }}
              </div>
            </div>
            <div v-else class="text-grey-6">
              <q-icon name="radio_button_unchecked" size="sm" />
              Not Associated
            </div>
          </q-td>
        </template>

        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              v-if="!props.row.isAssociated"
              icon="link"
              flat
              round
              dense
              size="sm"
              color="primary"
              @click="showAssociateDialog(props.row)"
            >
              <q-tooltip>Associate with Matter/Task</q-tooltip>
            </q-btn>
            <q-btn
              v-else
              icon="link_off"
              flat
              round
              dense
              size="sm"
              color="negative"
              @click="unassociateActivity(props.row)"
            >
              <q-tooltip>Remove Association</q-tooltip>
            </q-btn>
          </q-td>
        </template>
      </q-table>
    </div>

    <!-- Associate Activity Dialog -->
    <q-dialog v-model="showAssociation" persistent>
      <q-card style="min-width: 500px">
        <q-card-section>
          <div class="text-h6">Associate Activity with Matter</div>
          <div class="text-subtitle2 text-grey-6" v-if="selectedActivity">
            {{ getActivityTypeLabel(selectedActivity.activityType) }}: {{ selectedActivity.title }}
          </div>
        </q-card-section>

        <q-card-section>
          <q-form @submit="associateActivity" class="q-gutter-md">
            <q-select
              v-model="associationForm.matter"
              :options="filteredMatters"
              option-label="name"
              option-value="id"
              label="Matter"
              filled
              use-input
              @filter="filterMatters"
              :rules="[val => !!val || 'Matter is required']"
              @update:model-value="onMatterChange"
            >
              <template v-slot:option="scope">
                <q-item v-bind="scope.itemProps">
                  <q-item-section>
                    <q-item-label>{{ scope.opt.name }}</q-item-label>
                    <q-item-label caption>{{ scope.opt.client?.name }}</q-item-label>
                  </q-item-section>
                </q-item>
              </template>
            </q-select>

            <q-select
              v-model="associationForm.task"
              :options="availableTasks"
              option-label="description"
              option-value="id"
              label="Task"
              filled
              use-input
              fill-input
              new-value-mode="add"
              @new-value="createTaskOption"
              @update:model-value="handleTaskSelection"
              :rules="[val => !!val || 'Task is required']"
            >
              <template v-slot:option="scope">
                <q-item v-bind="scope.itemProps">
                  <q-item-section avatar v-if="scope.opt.isAddNew">
                    <q-icon name="add" color="primary" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label :class="{ 'text-primary': scope.opt.isAddNew }">
                      {{ scope.opt.label || scope.opt.description }}
                    </q-item-label>
                  </q-item-section>
                </q-item>
              </template>
            </q-select>

            <!-- Metadata display with hover popup -->
            <q-input
              v-if="selectedActivity?.metadata"
              :model-value="formatMetadataForDisplay(selectedActivity.metadata)"
              label="Metadata"
              filled
              readonly
              class="q-mb-sm"
            >
              <q-tooltip 
                :model-value="showMetadataTooltip"
                @update:model-value="showMetadataTooltip = $event"
                anchor="top middle"
                self="bottom middle"
                :offset="[10, 10]"
                max-width="400px"
                class="bg-grey-9 text-white q-pa-md"
              >
                <div v-html="formatMetadataForTooltip(selectedActivity.metadata)"></div>
              </q-tooltip>
              <template v-slot:prepend>
                <q-icon 
                  name="info" 
                  @mouseenter="showMetadataTooltip = true"
                  @mouseleave="showMetadataTooltip = false"
                  style="cursor: pointer"
                />
              </template>
            </q-input>

            <!-- Horizontal layout for duration, urgency, and timesheet date -->
            <div class="row q-gutter-md">
              <q-input
                v-model="associationForm.durationDisplay"
                type="text"
                label="Duration"
                filled
                style="width: 140px"
                @blur="updateDurationFromDisplay"
                @keyup.enter="updateDurationFromDisplay"
                placeholder="00:00"
              >
                <template v-slot:append>
                  <div class="column">
                    <q-btn
                      icon="keyboard_arrow_up"
                      size="xs"
                      flat
                      dense
                      @click="adjustDuration(getTimeIncrement())"
                      @mousedown="startSpinning(getTimeIncrement())"
                      @mouseup="stopSpinning"
                      @mouseleave="stopSpinning"
                    />
                    <q-btn
                      icon="keyboard_arrow_down"
                      size="xs"
                      flat
                      dense
                      @click="adjustDuration(-getTimeIncrement())"
                      @mousedown="startSpinning(-getTimeIncrement())"
                      @mouseup="stopSpinning"
                      @mouseleave="stopSpinning"
                    />
                  </div>
                </template>
              </q-input>

              <q-select
                v-model="associationForm.urgency"
                :options="urgencyOptions"
                label="Urgency"
                filled
                style="width: 120px"
              />

              <q-input
                v-model="associationForm.timesheetDate"
                type="date"
                label="Timesheet Date"
                filled
                style="width: 160px"
                :rules="[val => !!val || 'Timesheet date is required']"
              />
            </div>

            <div v-if="selectedActivity && selectedActivity.activityType === 'CALENDAR' && selectedActivity.endDate" 
                 class="q-pa-sm bg-blue-1 rounded-borders">
              <div class="text-caption text-blue-8">
                <q-icon name="info" size="sm" class="q-mr-xs" />
                Calculated duration from calendar event: {{ calculateDuration(selectedActivity.startDate, selectedActivity.endDate) }}
              </div>
            </div>
          </q-form>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey" @click="closeAssociateDialog" />
          <q-btn 
            label="Associate Task" 
            color="primary" 
            @click="associateActivity"
            :disable="!canAssociate"
            :loading="associating"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

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
import { useQuasar } from 'quasar';
import { useRoute, useRouter } from 'vue-router';
import { api } from 'src/services/api';
import { 
  formatTime, 
  parseTimeInput,
  getTimeIncrementStep,
  getMaxTimeValue
} from 'src/utils/timeUtils';
import NewTaskDialog from 'src/components/NewTaskDialog.vue';

import type { 
  TeamMember, 
  Matter, 
  Task, 
  ITActivity,
  ITActivityType,
  Urgency
} from 'src/types/models';

interface ActivityStatistics {
  activityCounts: {
    calendar: number;
    email: number;
    document: number;
    total: number;
  };
  associationStatus: {
    associated: number;
    unassociated: number;
    associationRate: number;
  };
  totalDuration: {
    minutes: number;
    hours: number;
  };
}

interface AssociationForm {
  matter: Matter | null;
  task: Task | string | null;
  durationDisplay: string; // hh:mm format
  durationMinutes: number; // calculated from display
  urgency: Urgency;
  timesheetDate: string;
}

export default defineComponent({
  name: 'ITActivityPage',
  components: {
    NewTaskDialog,
  },
  setup() {
    const $q = useQuasar();
    const route = useRoute();
    const router = useRouter();
    
    // Parse query parameters from timesheet
    const returnTo = route.query.returnTo as string | undefined;
    const returnMode = route.query.returnMode as string | undefined;
    const initialTeamMemberId = route.query.teamMemberId as string | undefined;
    const initialStartDate = route.query.startDate as string | undefined;
    const initialEndDate = route.query.endDate as string | undefined;
    
    // Reactive state
    const selectedTeamMember = ref<TeamMember | null>(null);
    const startDate = ref(initialStartDate || date.formatDate(date.subtractFromDate(new Date(), { days: 7 }), 'YYYY-MM-DD'));
    const endDate = ref(initialEndDate || date.formatDate(new Date(), 'YYYY-MM-DD'));
    const activityTypeFilter = ref<ITActivityType | null>(null); // Default to All
    const associationFilter = ref<boolean | null>(null);
    const tableFilter = ref('');
    const loading = ref(false);
    const associating = ref(false);
    
    const teamMembers = ref<TeamMember[]>([]);
    const matters = ref<Matter[]>([]);
    const filteredMatters = ref<Matter[]>([]);
    const activities = ref<ITActivity[]>([]);
    const statistics = ref<ActivityStatistics | null>(null);
    const availableTasks = ref<Task[]>([]);
    
    const showAssociation = ref(false);
    const selectedActivity = ref<ITActivity | null>(null);
    const associationForm = ref<AssociationForm>({
      matter: null,
      task: null,
      durationDisplay: '00:00',
      durationMinutes: 0,
      urgency: 'MEDIUM',
      timesheetDate: date.formatDate(new Date(), 'YYYY-MM-DD'),
    });

    // Spin control state
    const spinInterval = ref<NodeJS.Timeout | null>(null);
    const spinAcceleration = ref<NodeJS.Timeout | null>(null);
    const spinRate = ref(200); // Initial rate in milliseconds
    
    const showTaskDialog = ref(false);
    const selectedMatterForTask = ref<Matter | null>(null);
    const showMetadataTooltip = ref(false);
    const showGridMetadataTooltip = ref<string | null>(null);

    // Table configuration
    const pagination = ref({
      page: 1,
      rowsPerPage: 25,
      rowsNumber: 0,
    });

    const columns = [
      {
        name: 'activityType',
        label: 'Type',
        field: 'activityType',
        align: 'left',
        sortable: true,
        style: 'width: 100px',
      },
      {
        name: 'title',
        label: 'Title/Description',
        field: 'title',
        align: 'left',
        sortable: true,
        style: 'min-width: 250px',
      },
      {
        name: 'startDate',
        label: 'Date/Time',
        field: 'startDate',
        align: 'left',
        sortable: true,
        style: 'width: 180px',
      },
      {
        name: 'duration',
        label: 'Duration',
        field: (row: ITActivity) => row.durationMinutes || 0,
        align: 'center',
        sortable: true,
        style: 'width: 100px',
      },
      {
        name: 'association',
        label: 'Association',
        field: 'isAssociated',
        align: 'left',
        sortable: true,
        style: 'width: 150px',
      },
      {
        name: 'actions',
        label: 'Actions',
        field: '',
        align: 'center',
        style: 'width: 80px',
      },
    ];

    // Options for dropdowns
    const activityTypeOptions = [
      { label: 'All Activity Types', value: null },
      { label: 'Calendar Events', value: 'CALENDAR' },
      { label: 'Emails', value: 'EMAIL' },
      { label: 'Documents', value: 'DOCUMENT' },
    ];

    const associationOptions = [
      { label: 'All', value: null },
      { label: 'Associated', value: true },
      { label: 'Not Associated', value: false },
    ];

    const urgencyOptions = ['HOT', 'MEDIUM', 'MILD'];
    
    function goBack(): void {
      if (returnTo === 'timesheet' && selectedTeamMember.value) {
        router.push({
          path: '/',
          query: {
            mode: returnMode || 'WEEK',
            teamMemberId: selectedTeamMember.value.id,
            date: startDate.value,
          },
        });
      } else {
        router.push('/');
      }
    }    

    // Computed properties
    const canAssociate = computed(() => {
      return associationForm.value.matter && 
             associationForm.value.task; // Removed duration requirement
    });

    // Helper functions
    function getActivityTypeColor(type: ITActivityType): string {
      switch (type) {
        case 'CALENDAR': return 'blue';
        case 'EMAIL': return 'green';
        case 'DOCUMENT': return 'orange';
        default: return 'grey';
      }
    }

    function getActivityTypeIcon(type: ITActivityType): string {
      switch (type) {
        case 'CALENDAR': return 'event';
        case 'EMAIL': return 'email';
        case 'DOCUMENT': return 'description';
        default: return 'help';
      }
    }

    function getActivityTypeLabel(type: ITActivityType): string {
      switch (type) {
        case 'CALENDAR': return 'Calendar';
        case 'EMAIL': return 'Email';
        case 'DOCUMENT': return 'Document';
        default: return 'Unknown';
      }
    }

    function formatDateTime(dateTime: string): string {
      return date.formatDate(new Date(dateTime), 'MMM D, YYYY HH:mm');
    }

    function calculateDuration(start: string, end: string): string {
      const startTime = new Date(start);
      const endTime = new Date(end);
      const diffMs = endTime.getTime() - startTime.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      
      if (diffHours > 0) {
        return `${diffHours}h ${diffMinutes}m`;
      } else {
        return `${diffMinutes}m`;
      }
    }

    function formatDuration(minutes: number): string {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      
      if (hours > 0) {
        return `${hours}h ${mins}m`;
      } else {
        return `${mins}m`;
      }
    }

    function truncateText(text: string, maxLength: number): string {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength) + '...';
    }

    function getTimeIncrement(): number {
      // Use 15-minute increments for duration spin controls
      return 15;
    }

    function formatMinutesToHHMM(minutes: number): string {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    }

    function parseHHMMToMinutes(timeStr: string): number {
      const parts = timeStr.split(':');
      if (parts.length !== 2) return 0;
      
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      
      return (hours * 60) + minutes;
    }

    function updateDurationFromDisplay(): void {
      const minutes = parseHHMMToMinutes(associationForm.value.durationDisplay);
      associationForm.value.durationMinutes = minutes;
      // Update display to ensure proper formatting
      associationForm.value.durationDisplay = formatMinutesToHHMM(minutes);
    }

    function adjustDuration(increment: number): void {
      const newMinutes = Math.max(0, associationForm.value.durationMinutes + increment);
      associationForm.value.durationMinutes = newMinutes;
      associationForm.value.durationDisplay = formatMinutesToHHMM(newMinutes);
    }

    function startSpinning(increment: number): void {
      stopSpinning();
      spinRate.value = 200;
      
      spinInterval.value = setTimeout(() => {
        adjustDuration(increment);
        
        spinInterval.value = setInterval(() => {
          adjustDuration(increment);
        }, spinRate.value);
        
        spinAcceleration.value = setTimeout(() => {
          accelerateSpinning(increment);
        }, 1000);
      }, 300);
    }

    function accelerateSpinning(increment: number): void {
      if (spinInterval.value) {
        clearInterval(spinInterval.value);
        spinRate.value = Math.max(50, spinRate.value * 0.7);
        
        spinInterval.value = setInterval(() => {
          adjustDuration(increment);
        }, spinRate.value);
        
        if (spinRate.value > 50) {
          spinAcceleration.value = setTimeout(() => {
            accelerateSpinning(increment);
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

    // Data loading functions (stub implementations)
    async function loadTeamMembers(): Promise<void> {
      try {
        console.log('Loading team members');
        const response = await api.get('/team-members');
        //console.log('Loading team members, response.data: ', response.data);
        teamMembers.value = response.data;
        console.log('Loaded team members');
        
        // Set initial team member if provided
        if (initialTeamMemberId) {
          console.log('Loading team member initialTeamMemberId: ', initialTeamMemberId);
          selectedTeamMember.value = teamMembers.value.find(tm => tm.id === initialTeamMemberId) || null;
          if (selectedTeamMember.value) {
            await loadActivities();
          }
        }
      } catch (error) {
        Notify.create({
          type: 'negative',
          message: 'Failed to load team members',
          position: 'top'
        });
      }
    }
    
    async function loadMatters(): Promise<void> {
      try {
        console.log('Loading matters...');
        const response = await api.get('/matters');
        matters.value = response.data;
        filteredMatters.value = response.data; // Initialize filtered matters
        console.log(`Loaded ${matters.value.length} matters`);
      } catch (error) {
        console.error('Error loading matters:', error);
        Notify.create({
          type: 'negative',
          message: 'Failed to load matters',
          position: 'top'
        });
      }
    }

    async function loadActivities(): Promise<void> {
      if (!selectedTeamMember.value) return;
      
      loading.value = true;
      try {
        console.log('🔄 Loading activities from API...');
        console.log('📋 Parameters:', {
          teamMemberId: selectedTeamMember.value.id,
          startDate: startDate.value,
          endDate: endDate.value,
          activityType: activityTypeFilter.value,
          isAssociated: associationFilter.value
        });
        
        // Build query parameters
        const params = new URLSearchParams({
          teamMemberId: selectedTeamMember.value.id,
          startDate: startDate.value,
          endDate: endDate.value
        });
        
        if (activityTypeFilter.value) {
          params.append('activityType', activityTypeFilter.value);
        }
        
        if (associationFilter.value !== null) {
          params.append('isAssociated', associationFilter.value.toString());
        }
        
        console.log('🔗 API URL:', `/it-activities?${params.toString()}`);
        
        const response = await api.get(`/it-activities?${params.toString()}`);
        activities.value = response.data;
        
        console.log('✅ Loaded activities:', activities.value.length, 'items');
        console.log('📋 Activities data:', activities.value);
        
        await loadStatistics();
      } catch (error) {
        console.error('❌ Error loading activities:', error);
        Notify.create({
          type: 'negative',
          message: 'Failed to load activities',
          position: 'top'
        });
        // Clear activities on error
        activities.value = [];
      } finally {
        loading.value = false;
      }
    }

    async function loadStatistics(): Promise<void> {
      if (!selectedTeamMember.value) return;
      
      try {
        console.log('🔄 Loading statistics from API...');
        
        const response = await api.get(`/it-activities/stats/${selectedTeamMember.value.id}?startDate=${startDate.value}&endDate=${endDate.value}`);
        statistics.value = response.data;
        
        console.log('✅ Loaded statistics:', statistics.value);
      } catch (error) {
        console.error('❌ Error loading statistics:', error);
        // Set default empty statistics on error
        statistics.value = {
          activityCounts: {
            calendar: 0,
            email: 0,
            document: 0,
            total: 0
          },
          associationStatus: {
            associated: 0,
            unassociated: 0,
            associationRate: 0
          },
          totalDuration: {
            minutes: 0,
            hours: 0
          }
        };
      }
    }

    async function loadTasksForMatter(matterId: string): Promise<void> {
      try {
        console.log('Loading tasks for matter:', matterId);
        const response = await api.get(`/tasks/matter/${matterId}`);
        const tasks = response.data;
        console.log(`Loaded ${tasks.length} tasks for matter ${matterId}`);
        
        // Always include "Add New Task" option
        availableTasks.value = [
          ...tasks,
          { label: 'Add New Task', value: '__ADD_NEW__', isAddNew: true }
        ] as any;
      } catch (error) {
        console.error('Error loading tasks:', error);
        Notify.create({
          type: 'negative',
          message: 'Failed to load tasks for selected matter',
          position: 'top'
        });
        // Still provide the "Add New Task" option even if loading fails
        availableTasks.value = [
          { label: 'Add New Task', value: '__ADD_NEW__', isAddNew: true }
        ] as any;
      }
    }

    // Event handlers
    function onTeamMemberChange(): void {
      loadActivities();
    }

    function onRequest(props: any): void {
      // Handle table pagination/sorting
      pagination.value = props.pagination;
      loadActivities();
    }

    async function showAssociateDialog(activity: ITActivity): Promise<void> {
      selectedActivity.value = activity;
      
      // Pre-fill duration for calendar events
      if (activity.activityType === 'CALENDAR' && activity.endDate) {
        const startTime = new Date(activity.startDate);
        const endTime = new Date(activity.endDate);
        const diffMs = endTime.getTime() - startTime.getTime();
        const totalMinutes = Math.floor(diffMs / (1000 * 60));
        
        associationForm.value.durationMinutes = totalMinutes;
        associationForm.value.durationDisplay = formatMinutesToHHMM(totalMinutes);
      } else {
        associationForm.value.durationMinutes = 60; // Default to 1 hour
        associationForm.value.durationDisplay = '01:00';
      }
      
      // Set timesheet date to activity date
      associationForm.value.timesheetDate = date.formatDate(new Date(activity.startDate), 'YYYY-MM-DD');
      
      // Reset matter and task
      associationForm.value.matter = null;
      associationForm.value.task = null;
      
      showAssociation.value = true;
    }

    function closeAssociateDialog(): void {
      showAssociation.value = false;
      selectedActivity.value = null;
      stopSpinning(); // Stop any active spinning
      associationForm.value = {
        matter: null,
        task: null,
        durationDisplay: '00:00',
        durationMinutes: 0,
        urgency: 'MEDIUM',
        timesheetDate: date.formatDate(new Date(), 'YYYY-MM-DD'),
      };
    }

    function onMatterChange(): void {
      if (associationForm.value.matter) {
        loadTasksForMatter(associationForm.value.matter.id);
      }
      associationForm.value.task = null;
    }

    function createTaskOption(val: string): void {
      associationForm.value.task = val;
    }

    function handleTaskSelection(val: any): void {
      if (val && typeof val === 'object' && val.isAddNew) {
        // Clear the selection first
        associationForm.value.task = null;
        // Show the dialog
        if (associationForm.value.matter) {
          showNewTaskDialog(associationForm.value.matter);
        }
      } else {
        // Normal task selection
        associationForm.value.task = val;
      }
    }

    function showNewTaskDialog(matter: Matter): void {
      selectedMatterForTask.value = matter;
      showTaskDialog.value = true;
    }

    function onTaskCreated(task: Task): void {
      // Refresh the tasks for the matter
      if (associationForm.value.matter) {
        loadTasksForMatter(associationForm.value.matter.id);
      }
      // Select the new task
      associationForm.value.task = task;
      
      Notify.create({
        type: 'positive',
        message: 'Task created successfully',
      });
    }

    async function associateActivity(): Promise<void> {
      console.log('🔄 associateActivity: Starting association process');
      console.log('📋 associateActivity: selectedActivity.value =', selectedActivity.value);
      console.log('📋 associateActivity: canAssociate.value =', canAssociate.value);
      
      if (!selectedActivity.value || !canAssociate.value) {
        console.log('❌ associateActivity: Cannot associate - missing activity or invalid form');
        return;
      }
      
      associating.value = true;
      try {
        // Use activity duration if available, otherwise use form values
        let totalMinutes: number;
        
        console.log('📋 associateActivity: associationForm.value =', associationForm.value);
        
        if (selectedActivity.value.activityType === 'CALENDAR' && selectedActivity.value.endDate) {
          const startTime = new Date(selectedActivity.value.startDate);
          const endTime = new Date(selectedActivity.value.endDate);
          const diffMs = endTime.getTime() - startTime.getTime();
          totalMinutes = Math.floor(diffMs / (1000 * 60));
          console.log('🕒 associateActivity: Using calendar duration - totalMinutes =', totalMinutes);
        } else {
          totalMinutes = associationForm.value.durationMinutes;
          console.log('🕒 associateActivity: Using form duration - durationMinutes =', totalMinutes);
        }
        
        const requestData = {
          matterId: associationForm.value.matter!.id,
          taskId: typeof associationForm.value.task === 'string' ? null : associationForm.value.task?.id,
          taskDescription: typeof associationForm.value.task === 'string' 
            ? associationForm.value.task 
            : associationForm.value.task!.description,
          durationMinutes: totalMinutes,
          urgency: associationForm.value.urgency,
          timesheetDate: associationForm.value.timesheetDate
        };
        
        console.log('📤 associateActivity: Sending API request with data:', requestData);
        console.log('🔗 associateActivity: API URL:', `/it-activities/${selectedActivity.value.id}/associate`);
        
        const response = await api.post(`/it-activities/${selectedActivity.value.id}/associate`, requestData);
        
        console.log('✅ associateActivity: API response received:', response.data);
        
        // Update the activity in the local state
        const activityIndex = activities.value.findIndex(a => a.id === selectedActivity.value!.id);
        console.log('🔍 associateActivity: Looking for activity in local state, index:', activityIndex);
        
        if (activityIndex !== -1) {
          activities.value[activityIndex] = {
            ...activities.value[activityIndex],
            isAssociated: true,
            matterId: associationForm.value.matter!.id,
            matter: associationForm.value.matter!,
            durationMinutes: totalMinutes
          };
          console.log('✅ associateActivity: Updated local activity state');
        }
        
        Notify.create({
          type: 'positive',
          message: response.data.message || 'Activity associated with timesheet successfully',
          position: 'top'
        });
        
        console.log('🚪 associateActivity: Closing dialog and loading statistics');
        closeAssociateDialog();
        await loadStatistics();
        
        console.log('✅ associateActivity: Association process completed successfully');
        
      } catch (error) {
        console.error('❌ associateActivity: Error during association:', error);
        console.error('❌ associateActivity: Error details:', error.response?.data);
        
        Notify.create({
          type: 'negative',
          message: error.response?.data?.error || 'Failed to associate activity',
          position: 'top'
        });
      } finally {
        associating.value = false;
        console.log('🏁 associateActivity: Process finished');
      }
    }

    async function unassociateActivity(activity: ITActivity): Promise<void> {
      Dialog.create({
        title: 'Remove Association',
        message: `Are you sure you want to remove the association for "${activity.title}"? This will not delete the timesheet entry.`,
        cancel: true,
        persistent: true
      }).onOk(async () => {
        try {
          console.log('Unassociating activity:', activity.id);
          
          // In real implementation, this would call the API
          // await api.post(`/it-activities/${activity.id}/unassociate`);
          
          // Update the activity in the local state
          const activityIndex = activities.value.findIndex(a => a.id === activity.id);
          if (activityIndex !== -1) {
            activities.value[activityIndex] = {
              ...activities.value[activityIndex],
              isAssociated: false,
              matterId: undefined,
              matter: undefined,
              taskId: undefined,
              task: undefined,
              durationMinutes: undefined
            };
          }
          
          Notify.create({
            type: 'positive',
            message: 'Activity association removed',
            position: 'top'
          });
          
          await loadStatistics(); // Refresh statistics
          
        } catch (error) {
          console.error('Error unassociating activity:', error);
          Notify.create({
            type: 'negative',
            message: 'Failed to remove association',
            position: 'top'
          });
        }
      });
    }

    // Metadata formatting functions
    function formatMetadataForDisplay(metadata: any): string {
      if (!metadata || typeof metadata !== 'object') return '';
      
      const pairs: string[] = [];
      for (const [key, value] of Object.entries(metadata)) {
        if (value !== null && value !== undefined && value !== '') {
          const displayValue = Array.isArray(value) 
            ? value.join(', ') 
            : String(value);
          pairs.push(`${key}: ${displayValue}`);
        }
      }
      return pairs.join(', ');
    }

    function formatMetadataForTooltip(metadata: any): string {
      if (!metadata || typeof metadata !== 'object') return '';
      
      function formatObject(obj: any, indent: number = 0): string[] {
        const lines: string[] = [];
        const spaces = '&nbsp;'.repeat(indent * 2);
        
        for (const [key, value] of Object.entries(obj)) {
          if (value === null || value === undefined || value === '') continue;
          
          if (Array.isArray(value)) {
            lines.push(`${spaces}<strong>${key}:</strong>`);
            value.forEach((item, index) => {
              if (typeof item === 'object') {
                lines.push(`${spaces}&nbsp;&nbsp;${index + 1}:`);
                lines.push(...formatObject(item, indent + 2));
              } else {
                lines.push(`${spaces}&nbsp;&nbsp;• ${item}`);
              }
            });
          } else if (typeof value === 'object') {
            lines.push(`${spaces}<strong>${key}:</strong>`);
            lines.push(...formatObject(value, indent + 1));
          } else {
            lines.push(`${spaces}<strong>${key}:</strong> ${value}`);
          }
        }
        return lines;
      }
      
      return formatObject(metadata).join('<br/>');
    }

    // Navigation functions
    function returnToTimesheet(): void {
      if (returnTo === 'timesheet') {
        // Pass back the current context to the timesheet
        router.push({
          path: '/',
          query: {
            teamMemberId: selectedTeamMember.value?.id,
            startDate: startDate.value,
            mode: returnMode,
            fromITActivity: 'true'
          }
        });
      } else {
        // Default navigation
        router.push('/');
      }
    }

    // Lifecycle
    onMounted(() => {
      loadTeamMembers();
      loadMatters();
    });

    onUnmounted(() => {
      stopSpinning();
    });

    // Watch for team member changes
    watch(selectedTeamMember, () => {
      if (selectedTeamMember.value) {
        loadActivities();
      }
    });

    return {
      // State
      selectedTeamMember,
      startDate,
      endDate,
      activityTypeFilter,
      associationFilter,
      tableFilter,
      loading,
      associating,
      teamMembers,
      matters,
      filteredMatters,
      activities,
      statistics,
      availableTasks,
      showAssociation,
      selectedActivity,
      associationForm,
      pagination,
      columns,
      showMetadataTooltip,
      showGridMetadataTooltip,

      // Options
      activityTypeOptions,
      associationOptions,
      urgencyOptions,

      // Computed
      canAssociate,

      // Methods
      getActivityTypeColor,
      getActivityTypeIcon,
      getActivityTypeLabel,
      formatDateTime,
      calculateDuration,
      formatDuration,
      truncateText,
      getTimeIncrement,
      formatMinutesToHHMM,
      parseHHMMToMinutes,
      updateDurationFromDisplay,
      adjustDuration,
      startSpinning,
      stopSpinning,
      filterMatters,
      onTeamMemberChange,
      onRequest,
      loadActivities,
      showAssociateDialog,
      closeAssociateDialog,
      onMatterChange,
      createTaskOption,
      handleTaskSelection,
      showNewTaskDialog,
      onTaskCreated,
      associateActivity,
      unassociateActivity,
      showTaskDialog,
      selectedMatterForTask,
      formatMetadataForDisplay,
      formatMetadataForTooltip,
      returnToTimesheet,
    };
  }
});
</script>

<style scoped>
.q-table th {
  position: sticky;
  top: 0;
  background: white;
  z-index: 1;
}

.q-table__container {
  max-height: 70vh;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
</style>