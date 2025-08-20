<!-- src/pages/ReportingPage.vue -->
<template>
  <q-page class="q-pa-md">
    <div class="reporting-container">
      <!-- Header Section -->
      <div class="header-section q-mb-md">
        <div class="row q-gutter-md items-center">
          <div class="col-auto">
            <h4 class="q-ma-none">Team Summary Report</h4>
          </div>
          
          <q-space />
          
          <!-- Date Range Controls -->
          <div class="col-auto">
            <q-input
              v-model="formattedDateRange"
              label="Week"
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
        </div>
      </div>

      <!-- Team Summary Table -->
      <div class="report-table">
        <q-table
          flat
          bordered
          :rows="reportData"
          :columns="reportColumns"
          :loading="loading"
          :pagination="{ rowsPerPage: 0 }"
          class="team-summary-table"
        >
          <template v-slot:header="props">
            <q-tr :props="props">
              <q-th
                v-for="col in props.cols"
                :key="col.name"
                :props="props"
                :class="{ 'cursor-pointer': col.sortable }"
                @click="col.sortable ? onSort(col.name) : null"
              >
                {{ col.label }}
                <q-icon
                  v-if="col.sortable && sortField === col.name"
                  :name="sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'"
                  size="sm"
                  class="q-ml-xs"
                />
              </q-th>
            </q-tr>
          </template>

          <template v-slot:body="props">
            <q-tr :props="props">
              <q-td
                v-for="col in props.cols"
                :key="col.name"
                :props="props"
                :class="{ 'cursor-pointer': col.name === 'teamMemberName' }"
              >
                <span v-if="col.name === 'teamMemberName'">
                  {{ col.value }}
                  <q-tooltip 
                    v-if="props.row.timesheetDetails && props.row.timesheetDetails.length > 0"
                    max-width="650px"
                    class="bg-grey-9 text-white q-pa-md"
                  >
                    <div class="text-weight-bold q-mb-md">{{ props.row.teamMemberName }} - Timesheet Details</div>
                    <q-markup-table flat bordered dense class="timesheet-details-table">
                      <thead>
                        <tr class="bg-grey-8">
                          <th class="text-left">Matter</th>
                          <th class="text-left">Task</th>
                          <th class="text-center">Urgency</th>
                          <th class="text-right">Projected</th>
                          <th class="text-right">Actual</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="detail in props.row.timesheetDetails" :key="`${detail.matterName}-${detail.taskDescription}`">
                          <td class="text-left">
                            <div class="text-weight-medium">{{ detail.matterName }}</div>
                            <div class="text-caption text-grey-4">{{ detail.clientName }}</div>
                          </td>
                          <td class="text-left">{{ detail.taskDescription }}</td>
                          <td class="text-center">
                            <q-badge 
                              :color="getUrgencyColor(detail.urgency)"
                              :label="detail.urgency"
                              class="q-px-sm"
                            />
                          </td>
                          <td class="text-right">{{ formatHours(detail.projectedTime) }}</td>
                          <td class="text-right">{{ formatHours(detail.actualTime) }}</td>
                        </tr>
                      </tbody>
                    </q-markup-table>
                  </q-tooltip>
                </span>
                <span v-else>
                  {{ col.value }}
                </span>
              </q-td>
            </q-tr>
          </template>
        </q-table>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="q-mt-md text-center">
        <q-spinner size="50px" color="primary" />
        <div class="q-mt-sm">Loading team summary...</div>
      </div>

      <!-- No Data State -->
      <div v-else-if="reportData.length === 0" class="q-mt-md text-center">
        <q-icon name="assessment" size="64px" color="grey-5" />
        <div class="q-mt-sm text-grey-6">
          No timesheet data available for this period
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { date } from 'quasar';
import { api } from 'src/services/api';
import { Notify } from 'quasar';

interface TimesheetEntryDetail {
  matterName: string;
  clientName: string;
  taskDescription: string;
  urgency: string;
  projectedTime: number;
  actualTime: number;
}

interface TeamSummaryData {
  teamMemberName: string;
  projectedTotal: number;
  actualTotal: number;
  hotProjected: number;
  hotActual: number;
  mediumProjected: number;
  mediumActual: number;
  mildProjected: number;
  mildActual: number;
  timesheetDetails: TimesheetEntryDetail[];
}

// State
const currentStartDate = ref<string>('');
const reportData = ref<TeamSummaryData[]>([]);
const loading = ref(false);
const sortField = ref<string>('teamMemberName');
const sortOrder = ref<'asc' | 'desc'>('asc');

// Initialize to current week's Sunday
const initializeDate = (): void => {
  const today = new Date();
  const day = today.getDay();
  if (day !== 0) {
    today.setDate(today.getDate() - day);
  }
  currentStartDate.value = date.formatDate(today, 'YYYY-MM-DD');
};

// Computed properties
const formattedDateRange = computed(() => {
  const startDate = date.extractDate(currentStartDate.value, 'YYYY-MM-DD');
  const endDate = date.addToDate(startDate, { days: 6 });
  return `${date.formatDate(startDate, 'MMM D')} - ${date.formatDate(endDate, 'MMM D, YYYY')}`;
});

const reportColumns = computed(() => [
  {
    name: 'teamMemberName',
    label: 'Team Member',
    field: 'teamMemberName',
    sortable: true,
    align: 'left'
  },
  {
    name: 'projectedTotal',
    label: 'Projected Total',
    field: 'projectedTotal',
    sortable: true,
    align: 'right',
    format: (val: number) => formatHours(val)
  },
  {
    name: 'actualTotal',
    label: 'Actual Total',
    field: 'actualTotal',
    sortable: true,
    align: 'right',
    format: (val: number) => formatHours(val)
  },
  {
    name: 'hotProjected',
    label: 'Hot Projected',
    field: 'hotProjected',
    sortable: true,
    align: 'right',
    format: (val: number) => formatHours(val)
  },
  {
    name: 'hotActual',
    label: 'Hot Actual',
    field: 'hotActual',
    sortable: true,
    align: 'right',
    format: (val: number) => formatHours(val)
  },
  {
    name: 'mediumProjected',
    label: 'Medium Projected',
    field: 'mediumProjected',
    sortable: true,
    align: 'right',
    format: (val: number) => formatHours(val)
  },
  {
    name: 'mediumActual',
    label: 'Medium Actual',
    field: 'mediumActual',
    sortable: true,
    align: 'right',
    format: (val: number) => formatHours(val)
  },
  {
    name: 'mildProjected',
    label: 'Mild Projected',
    field: 'mildProjected',
    sortable: true,
    align: 'right',
    format: (val: number) => formatHours(val)
  },
  {
    name: 'mildActual',
    label: 'Mild Actual',
    field: 'mildActual',
    sortable: true,
    align: 'right',
    format: (val: number) => formatHours(val)
  }
]);

// Methods
function dateOptions(dateStr: string): boolean {
  // Only Sundays for weekly mode
  const parts = dateStr.split('/');
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1;
  const day = parseInt(parts[2]);
  const checkDate = new Date(year, month, day);
  return checkDate.getDay() === 0;
}

function formatHours(minutes: number): string {
  if (minutes === 0) return '0h';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

function getUrgencyColor(urgency: string): string {
  switch (urgency) {
    case 'HOT':
      return 'red';
    case 'MEDIUM':
      return 'orange';
    case 'MILD':
      return 'blue';
    default:
      return 'grey';
  }
}

function changeDateRange(direction: number): void {
  const current = date.extractDate(currentStartDate.value, 'YYYY-MM-DD');
  const newDate = date.addToDate(current, { days: direction * 7 });
  
  // Ensure we're on a Sunday
  const day = newDate.getDay();
  if (day !== 0) {
    newDate.setDate(newDate.getDate() - day);
  }
  
  currentStartDate.value = date.formatDate(newDate, 'YYYY-MM-DD');
  loadReportData();
}

function onDateSelected(dateValue: string): void {
  if (!dateValue) return;
  
  const selectedDate = date.extractDate(dateValue, 'YYYY-MM-DD');
  const day = selectedDate.getDay();
  if (day !== 0) {
    selectedDate.setDate(selectedDate.getDate() - day);
  }
  
  currentStartDate.value = date.formatDate(selectedDate, 'YYYY-MM-DD');
  loadReportData();
}

function onSort(field: string): void {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortField.value = field;
    sortOrder.value = 'asc';
  }
  
  // Sort the data
  reportData.value.sort((a, b) => {
    const aVal = a[field as keyof TeamSummaryData];
    const bVal = b[field as keyof TeamSummaryData];
    
    let comparison = 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      comparison = aVal.localeCompare(bVal);
    } else if (typeof aVal === 'number' && typeof bVal === 'number') {
      comparison = aVal - bVal;
    }
    
    return sortOrder.value === 'asc' ? comparison : -comparison;
  });
}

async function loadReportData(): Promise<void> {
  loading.value = true;
  try {
    const response = await api.get(`/reports/team-summary/${currentStartDate.value}`);
    reportData.value = response.data;
    
    // Apply current sort
    if (sortField.value) {
      onSort(sortField.value);
    }
  } catch (error: any) {
    console.error('Failed to load report data:', error);
    Notify.create({
      type: 'negative',
      message: error.response?.data?.error || 'Failed to load report data'
    });
    reportData.value = [];
  } finally {
    loading.value = false;
  }
}

// Initialize and load data
onMounted(() => {
  initializeDate();
  loadReportData();
});
</script>

<style scoped>
.reporting-container {
  max-width: 1400px;
  margin: 0 auto;
}

.report-table {
  overflow-x: auto;
}

.team-summary-table .q-th {
  font-weight: 600;
  background-color: #f5f5f5;
}

.team-summary-table .q-th.cursor-pointer:hover {
  background-color: #e0e0e0;
}

.team-summary-table .q-td {
  white-space: nowrap;
}

.timesheet-details-table {
  background-color: transparent;
  min-width: 600px;
}

.timesheet-details-table .q-table__card {
  background-color: transparent;
  box-shadow: none;
}

.timesheet-details-table th {
  background-color: rgba(255, 255, 255, 0.1);
  color: white;
  font-weight: 600;
  font-size: 0.75rem;
  padding: 8px 6px;
}

.timesheet-details-table td {
  background-color: rgba(255, 255, 255, 0.05);
  color: white;
  font-size: 0.75rem;
  padding: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
</style>