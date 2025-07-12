<!-- src/pages/TeamMembersAdminPage.vue -->
<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="col">
        <h4 class="q-ma-none">Team Members Administration</h4>
      </div>
      <div class="col-auto">
        <q-btn 
          color="primary" 
          label="Add Team Member" 
          icon="add"
          @click="showAddDialog = true"
        />
      </div>
    </div>

    <!-- Team Members Table -->
    <q-table
      :rows="teamMembers"
      :columns="columns"
      row-key="id"
      :loading="loading"
      :pagination="{ rowsPerPage: 20 }"
      class="full-width"
    >
      <template v-slot:body-cell-isActive="props">
        <q-td :props="props">
          <q-chip :color="props.row.isActive ? 'positive' : 'negative'" text-color="white" dense>
            {{ props.row.isActive ? 'Active' : 'Inactive' }}
          </q-chip>
        </q-td>
      </template>
      
      <template v-slot:body-cell-workingHours="props">
        <q-td :props="props">
          {{ props.row.workingHours || (settings.workingHours + ' (default)') }}
        </q-td>
      </template>
      
      <template v-slot:body-cell-timeSettings="props">
        <q-td :props="props">
          {{ formatTimeSettings(props.row) }}
        </q-td>
      </template>
      
      <template v-slot:body-cell-userITActivity="props">
        <q-td :props="props">
          <q-chip 
            :color="getITActivityColor(props.row)" 
            text-color="white" 
            dense
          >
            {{ getITActivityText(props.row) }}
          </q-chip>
        </q-td>
      </template>
      
      <template v-slot:body-cell-actions="props">
        <q-td :props="props">
          <q-btn 
            flat 
            dense 
            color="primary" 
            icon="edit"
            @click="editTeamMember(props.row)"
          />
          <q-btn 
            flat 
            dense 
            color="negative" 
            icon="delete"
            @click="deleteTeamMember(props.row)"
          />
        </q-td>
      </template>
    </q-table>

    <!-- Add/Edit Dialog -->
    <q-dialog v-model="showAddDialog" @hide="resetForm">
      <q-card style="min-width: 600px">
        <q-card-section>
          <div class="text-h6">{{ editingTeamMember ? 'Edit Team Member' : 'Add New Team Member' }}</div>
        </q-card-section>

        <q-card-section>
          <q-form @submit="saveTeamMember" class="q-gutter-md">
            <div class="row q-gutter-md">
              <div class="col">
                <q-input
                  v-model="teamMemberForm.name"
                  label="Name *"
                  filled
                  :rules="[val => !!val || 'Name is required']"
                />
              </div>
              <div class="col">
                <q-input
                  v-model="teamMemberForm.email"
                  label="Email *"
                  type="email"
                  filled
                  :rules="[val => !!val || 'Email is required']"
                />
              </div>
            </div>
            
            <div class="row q-gutter-md">
              <div class="col">
                <q-input
                  v-model="teamMemberForm.title"
                  label="Title"
                  filled
                />
              </div>
              <div class="col">
                <q-select
                  v-model="teamMemberForm.role"
                  :options="roleOptions"
                  label="Role *"
                  filled
                  :rules="[val => !!val || 'Role is required']"
                />
              </div>
            </div>
            
            <div class="row q-gutter-md">
              <div class="col">
                <q-select
                  v-model="teamMemberForm.accessLevel"
                  :options="accessLevelOptions"
                  label="Access Level *"
                  filled
                  :rules="[val => !!val || 'Access level is required']"
                />
              </div>
              <div class="col">
                <q-toggle
                  v-model="teamMemberForm.isActive"
                  label="Active"
                  color="positive"
                />
              </div>
            </div>
            
            <!-- Override Settings Section -->
            <q-separator />
            <div class="text-subtitle1 q-mt-md">Override Settings (leave blank to use defaults)</div>
            
            <div class="row q-gutter-md">
              <div class="col">
                <q-input
                  v-model.number="teamMemberForm.workingHours"
                  label="Working Hours"
                  type="number"
                  filled
                  :hint="`Default: ${settings.workingHours} hours`"
                />
              </div>
              <div class="col">
                <q-select
                  v-model="teamMemberForm.timeIncrementType"
                  :options="timeIncrementTypeOptions"
                  label="Time Increment Type"
                  filled
                  clearable
                  :hint="`Default: ${settings.timeIncrementType}`"
                />
              </div>
            </div>
            
            <div class="row q-gutter-md">
              <div class="col">
                <q-input
                  v-model.number="teamMemberForm.timeIncrement"
                  label="Time Increment"
                  type="number"
                  filled
                  :hint="`Default: ${settings.timeIncrement}`"
                />
              </div>
              <div class="col">
                <q-select
                  v-model="teamMemberForm.userITActivity"
                  :options="itActivityOptions"
                  label="IT Activity Access"
                  filled
                  clearable
                  :hint="`Default: ${settings.userITActivity ? 'Enabled' : 'Disabled'}`"
                />
              </div>
            </div>
            
            <q-input
              v-model="teamMemberForm.password"
              :label="editingTeamMember ? 'New Password (leave blank to keep current)' : 'Password *'"
              type="password"
              filled
              :rules="editingTeamMember ? [] : [val => !!val || 'Password is required']"
            />
          </q-form>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showAddDialog = false" />
          <q-btn 
            color="primary" 
            label="Save" 
            @click="saveTeamMember"
            :loading="saving"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Delete Confirmation Dialog -->
    <q-dialog v-model="showDeleteDialog">
      <q-card>
        <q-card-section>
          <div class="text-h6">Confirm Delete</div>
        </q-card-section>

        <q-card-section>
          Are you sure you want to delete team member "{{ teamMemberToDelete?.name }}"?
          <div class="text-caption text-orange q-mt-sm" v-if="teamMemberToDelete">
            Warning: This will fail if the team member has associated timesheets or activities.
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showDeleteDialog = false" />
          <q-btn 
            color="negative" 
            label="Delete" 
            @click="confirmDelete"
            :loading="deleting"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import { api } from 'src/services/api';
import { settingsService } from 'src/services/settings';
import type { TeamMember, Settings } from 'src/types/models';

const $q = useQuasar();

// Data
const teamMembers = ref<TeamMember[]>([]);
const settings = ref<Settings>({} as Settings);
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const showAddDialog = ref(false);
const showDeleteDialog = ref(false);
const editingTeamMember = ref<TeamMember | null>(null);
const teamMemberToDelete = ref<TeamMember | null>(null);

// Form data
const teamMemberForm = ref({
  name: '',
  email: '',
  title: '',
  role: '',
  accessLevel: '',
  workingHours: null as number | null,
  timeIncrementType: null as string | null,
  timeIncrement: null as number | null,
  userITActivity: null as boolean | null,
  isActive: true,
  password: ''
});

// Options
const roleOptions = [
  'PARALEGAL',
  'ASSOCIATE', 
  'TECHNICAL_SUPPORT',
  'PARTNER',
  'SENIOR_PARTNER'
];

const accessLevelOptions = [
  'USER',
  'MANAGER',
  'ADMIN'
];

const timeIncrementTypeOptions = [
  'PERCENT',
  'HOURS_MINUTES'
];

const itActivityOptions = [
  { label: 'Enabled', value: true },
  { label: 'Disabled', value: false }
];

// Table columns
const columns = [
  {
    name: 'name',
    required: true,
    label: 'Name',
    align: 'left',
    field: 'name',
    sortable: true
  },
  {
    name: 'email',
    label: 'Email',
    align: 'left',
    field: 'email',
    sortable: true
  },
  {
    name: 'role',
    label: 'Role',
    align: 'left',
    field: 'role',
    sortable: true
  },
  {
    name: 'accessLevel',
    label: 'Access Level',
    align: 'left',
    field: 'accessLevel',
    sortable: true
  },
  {
    name: 'workingHours',
    label: 'Working Hours',
    align: 'left',
    field: 'workingHours'
  },
  {
    name: 'timeSettings',
    label: 'Time Settings',
    align: 'left',
    field: 'timeSettings'
  },
  {
    name: 'userITActivity',
    label: 'IT Activity',
    align: 'center',
    field: 'userITActivity'
  },
  {
    name: 'isActive',
    label: 'Status',
    align: 'center',
    field: 'isActive',
    sortable: true
  },
  {
    name: 'actions',
    label: 'Actions',
    align: 'center',
    field: 'actions'
  }
];

// Methods
function formatTimeSettings(teamMember: TeamMember): string {
  const type = teamMember.timeIncrementType || settings.value.timeIncrementType;
  const increment = teamMember.timeIncrement || settings.value.timeIncrement;
  return `${type} (${increment}${type === 'HOURS_MINUTES' ? ' min' : '%'})`;
}

function getITActivityColor(teamMember: TeamMember): string {
  const access = teamMember.userITActivity ?? settings.value.userITActivity;
  if (teamMember.userITActivity !== null && teamMember.userITActivity !== undefined) {
    return access ? 'positive' : 'negative';
  }
  return 'grey-6'; // Default
}

function getITActivityText(teamMember: TeamMember): string {
  const access = teamMember.userITActivity ?? settings.value.userITActivity;
  if (teamMember.userITActivity !== null && teamMember.userITActivity !== undefined) {
    return access ? 'Enabled' : 'Disabled';
  }
  return access ? 'Default (On)' : 'Default (Off)';
}

async function loadTeamMembers() {
  loading.value = true;
  try {
    const response = await api.get('/api/team-members');
    teamMembers.value = response.data;
  } catch (error) {
    console.error('Failed to load team members:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to load team members'
    });
  } finally {
    loading.value = false;
  }
}

async function loadSettings() {
  try {
    settings.value = await settingsService.getAllSettings();
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

function editTeamMember(teamMember: TeamMember) {
  editingTeamMember.value = teamMember;
  teamMemberForm.value = {
    name: teamMember.name,
    email: teamMember.email,
    title: teamMember.title || '',
    role: teamMember.role,
    accessLevel: teamMember.accessLevel,
    workingHours: teamMember.workingHours,
    timeIncrementType: teamMember.timeIncrementType,
    timeIncrement: teamMember.timeIncrement,
    userITActivity: teamMember.userITActivity,
    isActive: teamMember.isActive,
    password: ''
  };
  showAddDialog.value = true;
}

function deleteTeamMember(teamMember: TeamMember) {
  teamMemberToDelete.value = teamMember;
  showDeleteDialog.value = true;
}

async function saveTeamMember() {
  if (!teamMemberForm.value.name || !teamMemberForm.value.email || !teamMemberForm.value.role || !teamMemberForm.value.accessLevel) {
    $q.notify({
      type: 'negative',
      message: 'Please fill in all required fields'
    });
    return;
  }

  if (!editingTeamMember.value && !teamMemberForm.value.password) {
    $q.notify({
      type: 'negative',
      message: 'Password is required for new team members'
    });
    return;
  }

  saving.value = true;
  try {
    const payload = { ...teamMemberForm.value };
    
    // Remove null values to use defaults
    if (payload.workingHours === null) delete payload.workingHours;
    if (payload.timeIncrementType === null) delete payload.timeIncrementType;
    if (payload.timeIncrement === null) delete payload.timeIncrement;
    if (payload.userITActivity === null) delete payload.userITActivity;
    
    // Don't send empty password for edits
    if (editingTeamMember.value && !payload.password) {
      delete payload.password;
    }
    
    if (editingTeamMember.value) {
      // Update existing team member
      await api.put(`/api/team-members/${editingTeamMember.value.id}`, payload);
      $q.notify({
        type: 'positive',
        message: 'Team member updated successfully'
      });
    } else {
      // Create new team member
      await api.post('/api/team-members', payload);
      $q.notify({
        type: 'positive',
        message: 'Team member created successfully'
      });
    }
    
    showAddDialog.value = false;
    await loadTeamMembers();
  } catch (error: any) {
    console.error('Failed to save team member:', error);
    const message = error.response?.data?.message || 'Failed to save team member';
    $q.notify({
      type: 'negative',
      message
    });
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!teamMemberToDelete.value) return;
  
  deleting.value = true;
  try {
    await api.delete(`/api/team-members/${teamMemberToDelete.value.id}`);
    $q.notify({
      type: 'positive',
      message: 'Team member deleted successfully'
    });
    
    showDeleteDialog.value = false;
    await loadTeamMembers();
  } catch (error: any) {
    console.error('Failed to delete team member:', error);
    const message = error.response?.data?.message || 'Failed to delete team member';
    $q.notify({
      type: 'negative',
      message
    });
  } finally {
    deleting.value = false;
  }
}

function resetForm() {
  editingTeamMember.value = null;
  teamMemberForm.value = {
    name: '',
    email: '',
    title: '',
    role: '',
    accessLevel: '',
    workingHours: null,
    timeIncrementType: null,
    timeIncrement: null,
    userITActivity: null,
    isActive: true,
    password: ''
  };
}

onMounted(() => {
  loadTeamMembers();
  loadSettings();
});
</script>