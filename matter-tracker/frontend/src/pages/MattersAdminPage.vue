<!-- src/pages/MattersAdminPage.vue -->
<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="col">
        <h4 class="q-ma-none">Matters Administration</h4>
      </div>
      <div class="col-auto">
        <q-btn 
          color="primary" 
          label="Add Matter" 
          icon="add"
          @click="showAddDialog = true"
        />
      </div>
    </div>

    <!-- Matters Table -->
    <q-table
      :rows="matters"
      :columns="columns"
      row-key="id"
      :loading="loading"
      :pagination="{ rowsPerPage: 20 }"
      class="full-width"
    >
      <template v-slot:body-cell-client="props">
        <q-td :props="props">
          {{ props.row.client?.name || 'Unknown Client' }}
        </q-td>
      </template>
      
      <template v-slot:body-cell-actions="props">
        <q-td :props="props">
          <q-btn 
            flat 
            dense 
            color="primary" 
            icon="edit"
            @click="editMatter(props.row)"
          />
          <q-btn 
            flat 
            dense 
            color="negative" 
            icon="delete"
            @click="deleteMatter(props.row)"
          />
        </q-td>
      </template>
    </q-table>

    <!-- Add/Edit Dialog -->
    <q-dialog v-model="showAddDialog" @hide="resetForm">
      <q-card style="min-width: 500px">
        <q-card-section>
          <div class="text-h6">{{ editingMatter ? 'Edit Matter' : 'Add New Matter' }}</div>
        </q-card-section>

        <q-card-section>
          <q-form @submit="saveMatter" class="q-gutter-md">
            <q-input
              v-model="matterForm.name"
              label="Matter Name *"
              filled
              :rules="[val => !!val || 'Matter name is required']"
            />
            
            <q-select
              v-model="matterForm.clientId"
              :options="clientOptions"
              option-value="id"
              option-label="name"
              emit-value
              map-options
              label="Client *"
              filled
              :rules="[val => !!val || 'Client is required']"
            />
            
            <q-input
              v-model="matterForm.description"
              label="Description"
              filled
              type="textarea"
              rows="3"
            />
          </q-form>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" @click="showAddDialog = false" />
          <q-btn 
            color="primary" 
            label="Save" 
            @click="saveMatter"
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
          Are you sure you want to delete matter "{{ matterToDelete?.name }}"?
          <div class="text-caption text-orange q-mt-sm" v-if="matterToDelete">
            Warning: This will fail if the matter has associated timesheet entries or tasks.
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
import type { Matter, Client } from 'src/types/models';

const $q = useQuasar();

// Data
const matters = ref<Matter[]>([]);
const clients = ref<Client[]>([]);
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const showAddDialog = ref(false);
const showDeleteDialog = ref(false);
const editingMatter = ref<Matter | null>(null);
const matterToDelete = ref<Matter | null>(null);

// Form data
const matterForm = ref({
  name: '',
  description: '',
  clientId: ''
});

// Computed
const clientOptions = ref<{ id: string; name: string }[]>([]);

// Table columns
const columns = [
  {
    name: 'name',
    required: true,
    label: 'Matter Name',
    align: 'left',
    field: 'name',
    sortable: true
  },
  {
    name: 'client',
    label: 'Client',
    align: 'left',
    field: 'client',
    sortable: true
  },
  {
    name: 'description',
    label: 'Description',
    align: 'left',
    field: 'description',
    sortable: true
  },
  {
    name: 'createdAt',
    label: 'Created',
    align: 'left',
    field: 'createdAt',
    sortable: true,
    format: (val: string) => new Date(val).toLocaleDateString()
  },
  {
    name: 'actions',
    label: 'Actions',
    align: 'center',
    field: 'actions'
  }
];

// Methods
async function loadMatters() {
  loading.value = true;
  try {
    const response = await api.get('/matters');
    matters.value = response.data;
  } catch (error) {
    console.error('Failed to load matters:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to load matters'
    });
  } finally {
    loading.value = false;
  }
}

async function loadClients() {
  try {
    const response = await api.get('/clients');
    clients.value = response.data;
    clientOptions.value = response.data.map((client: Client) => ({
      id: client.id,
      name: client.name
    }));
  } catch (error) {
    console.error('Failed to load clients:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to load clients'
    });
  }
}

function editMatter(matter: Matter) {
  editingMatter.value = matter;
  matterForm.value = {
    name: matter.name,
    description: matter.description || '',
    clientId: matter.clientId
  };
  showAddDialog.value = true;
}

function deleteMatter(matter: Matter) {
  matterToDelete.value = matter;
  showDeleteDialog.value = true;
}

async function saveMatter() {
  if (!matterForm.value.name || !matterForm.value.clientId) {
    $q.notify({
      type: 'negative',
      message: 'Please fill in all required fields'
    });
    return;
  }

  saving.value = true;
  try {
    if (editingMatter.value) {
      // Update existing matter
      await api.put(`/matters/${editingMatter.value.id}`, matterForm.value);
      $q.notify({
        type: 'positive',
        message: 'Matter updated successfully'
      });
    } else {
      // Create new matter
      await api.post('/matters', matterForm.value);
      $q.notify({
        type: 'positive',
        message: 'Matter created successfully'
      });
    }
    
    showAddDialog.value = false;
    await loadMatters();
  } catch (error) {
    console.error('Failed to save matter:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save matter'
    });
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!matterToDelete.value) return;
  
  deleting.value = true;
  try {
    await api.delete(`/matters/${matterToDelete.value.id}`);
    $q.notify({
      type: 'positive',
      message: 'Matter deleted successfully'
    });
    
    showDeleteDialog.value = false;
    await loadMatters();
  } catch (error: any) {
    console.error('Failed to delete matter:', error);
    const message = error.response?.data?.message || 'Failed to delete matter';
    $q.notify({
      type: 'negative',
      message
    });
  } finally {
    deleting.value = false;
  }
}

function resetForm() {
  editingMatter.value = null;
  matterForm.value = {
    name: '',
    description: '',
    clientId: ''
  };
}

onMounted(() => {
  loadMatters();
  loadClients();
});
</script>