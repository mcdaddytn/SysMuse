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
            @click="$router.push('/')"
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
            <div class="text-weight-medium">{{ props.value }}</div>
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
              :options="matters"
              option-label="name"
              option-value="id"
              label="Matter"
              filled
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
              :rules="[val => !!val || 'Task is required']"
            />

            <div class="row q-gutter-md">
              <div class="col-6">
                <q-input
                  v-model="associationForm.hours"
                  type="number"
                  label="Hours"
                  filled
                  min="0"
                  max="24"
                  step="0.25"
                  :rules="[val => val >= 0 || 'Hours must be positive']"
                  @update:model-value="updateDuration"
                />
              </div>
              <div class="col-6">
                <q-input
                  v-model="associationForm.minutes"
                  type="number"
                  label="Minutes"
                  filled
                  min="0"
                  max="59"
                  :rules="[val => val >= 0 && val <= 59 || 'Minutes must be 0-59']"
                  @update:model-value="updateDuration"
                />
              </div>
            </div>

            <q-select
              v-model="associationForm.urgency"
              :options="urgencyOptions"
              label="Urgency"
              filled
            />

            <q-input
              v-model="associationForm.timesheetDate"
              type="date"
              label="Timesheet Date"
              filled
              :rules="[val => !!val || 'Timesheet date is required']"
            />

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
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, watch } from 'vue';
import { date, Notify, Dialog } from 'quasar';
import { useQuasar } from 'quasar';
import { useRoute, useRouter } from 'vue-router';
import { api } from 'src/services/api';

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
  hours: number;
  minutes: number;
  urgency: Urgency;
  timesheetDate: string;
}

export default defineComponent({
  name: 'ITActivityPage',
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
    const activities = ref<ITActivity[]>([]);
    const statistics = ref<ActivityStatistics | null>(null);
    const availableTasks = ref<Task[]>([]);
    
    const showAssociation = ref(false);
    const selectedActivity = ref<ITActivity | null>(null);
    const associationForm = ref<AssociationForm>({
      matter: null,
      task: null,
      hours: 0,
      minutes: 0,
      urgency: 'MEDIUM',
      timesheetDate: date.formatDate(new Date(), 'YYYY-MM-DD'),
    });

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
      { label: 'Calendar Events', value: 'CALENDAR' },
      { label: 'Emails', value: 'EMAIL' },
      { label: 'Documents', value: 'DOCUMENT' },
    ];

    const associationOptions = [
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

    function updateDuration(): void {
      // Auto-calculate duration when hours/minutes change
      const totalMinutes = (associationForm.value.hours * 60) + associationForm.value.minutes;
      // This is just for display purposes; the actual calculation happens in the form
    }

    // Data loading functions (stub implementations)
    async function loadTeamMembers(): Promise<void> {
      try {
        console.log('Loading team members');
        const response = await api.get('/team-members');
        console.log('Loading team members, response.data: ', response.data);
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
        // Mock data for now
        matters.value = [
          {
            id: '1',
            name: 'ABC Corp Contract Review',
            description: 'Contract review and negotiation',
            clientId: '1',
            client: { id: '1', name: 'ABC Corporation', createdAt: '', updatedAt: '' },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ];
      } catch (error) {
        console.error('Error loading matters:', error);
      }
    }

    async function loadActivities(): Promise<void> {
      if (!selectedTeamMember.value) return;
      
      loading.value = true;
      try {
        console.log('Loading activities...');
        // Mock data - in real implementation, this would call the API
        activities.value = [
          {
            id: '1',
            teamMemberId: selectedTeamMember.value.id,
            teamMember: selectedTeamMember.value,
            activityType: 'CALENDAR',
            title: 'Client Meeting - ABC Corp Strategy Review',
            description: 'Quarterly strategy review meeting with ABC Corp leadership team',
            startDate: date.formatDate(new Date(), 'YYYY-MM-DDTHH:mm:ss'),
            endDate: date.formatDate(date.addToDate(new Date(), { hours: 2 }), 'YYYY-MM-DDTHH:mm:ss'),
            metadata: {
              meetingType: 'meeting',
              location: 'Conference Room B',
              attendees: ['john.client@abccorp.com']
            },
            isAssociated: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ];
        
        await loadStatistics();
      } catch (error) {
        console.error('Error loading activities:', error);
        Notify.create({
          type: 'negative',
          message: 'Failed to load activities',
          position: 'top'
        });
      } finally {
        loading.value = false;
      }
    }

    async function loadStatistics(): Promise<void> {
      if (!selectedTeamMember.value) return;
      
      try {
        console.log('Loading statistics...');
        // Mock data - in real implementation, this would call the API
        statistics.value = {
          activityCounts: {
            calendar: 15,
            email: 23,
            document: 8,
            total: 46
          },
          associationStatus: {
            associated: 12,
            unassociated: 34,
            associationRate: 26
          },
          totalDuration: {
            minutes: 540,
            hours: 9
          }
        };
      } catch (error) {
        console.error('Error loading statistics:', error);
      }
    }

    async function loadTasksForMatter(matterId: string): Promise<void> {
      try {
        console.log('Loading tasks for matter:', matterId);
        // Mock data
        availableTasks.value = [
          {
            id: '1',
            description: 'Contract Review',
            matterId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ];
      } catch (error) {
        console.error('Error loading tasks:', error);
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
        
        associationForm.value.hours = Math.floor(totalMinutes / 60);
        associationForm.value.minutes = totalMinutes % 60;
      } else {
        associationForm.value.hours = 1;
        associationForm.value.minutes = 0;
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
      associationForm.value = {
        matter: null,
        task: null,
        hours: 0,
        minutes: 0,
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

    async function associateActivity(): Promise<void> {
      if (!selectedActivity.value || !canAssociate.value) return;
      
      associating.value = true;
      try {
        // Use activity duration if available, otherwise use form values
        let totalMinutes: number;
        
        if (selectedActivity.value.activityType === 'CALENDAR' && selectedActivity.value.endDate) {
          const startTime = new Date(selectedActivity.value.startDate);
          const endTime = new Date(selectedActivity.value.endDate);
          const diffMs = endTime.getTime() - startTime.getTime();
          totalMinutes = Math.floor(diffMs / (1000 * 60));
        } else {
          totalMinutes = (associationForm.value.hours * 60) + associationForm.value.minutes;
        }
        
        const response = await api.post(`/it-activities/${selectedActivity.value.id}/associate`, {
          matterId: associationForm.value.matter!.id,
          taskId: typeof associationForm.value.task === 'string' ? null : associationForm.value.task?.id,
          taskDescription: typeof associationForm.value.task === 'string' 
            ? associationForm.value.task 
            : associationForm.value.task!.description,
          durationMinutes: totalMinutes,
          urgency: associationForm.value.urgency,
          timesheetDate: associationForm.value.timesheetDate
        });
        
        // Update the activity in the local state
        const activityIndex = activities.value.findIndex(a => a.id === selectedActivity.value!.id);
        if (activityIndex !== -1) {
          activities.value[activityIndex] = {
            ...activities.value[activityIndex],
            isAssociated: true,
            matterId: associationForm.value.matter!.id,
            matter: associationForm.value.matter!,
            durationMinutes: totalMinutes
          };
        }
        
        Notify.create({
          type: 'positive',
          message: response.data.message || 'Activity associated with timesheet successfully',
          position: 'top'
        });
        
        closeAssociateDialog();
        await loadStatistics();
        
      } catch (error) {
        console.error('Error associating activity:', error);
        Notify.create({
          type: 'negative',
          message: 'Failed to associate activity',
          position: 'top'
        });
      } finally {
        associating.value = false;
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

    // Lifecycle
    onMounted(() => {
      loadTeamMembers();
      loadMatters();
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
      activities,
      statistics,
      availableTasks,
      showAssociation,
      selectedActivity,
      associationForm,
      pagination,
      columns,

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
      updateDuration,
      onTeamMemberChange,
      onRequest,
      loadActivities,
      showAssociateDialog,
      closeAssociateDialog,
      onMatterChange,
      createTaskOption,
      associateActivity,
      unassociateActivity,
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
</style>