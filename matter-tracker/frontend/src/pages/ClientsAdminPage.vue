<!-- src/pages/ClientsAdminPage.vue -->
<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="col">
        <h4 class="q-ma-none">Clients Administration</h4>
      </div>
      <div class="col-auto">
        <q-btn 
          color="primary" 
          label="Add Client" 
          icon="add"
          @click="showAddDialog = true"
        />
      </div>
    </div>

    <!-- Clients Table -->
    <q-table
      :rows="clients"
      :columns="columns"
      row-key="id"
      :loading="loading"
      :pagination="{ rowsPerPage: 20 }"
      class="full-width"
    >
      <template v-slot:body-cell-actions="props">
        <q-td :props="props">
          <q-btn 
            flat 
            dense 
            color="primary" 
            icon="edit"
            @click="editClient(props.row)"
          />
          <q-btn 
            flat 
            dense 
            color="negative" 
            icon="delete"
            @click="deleteClient(props.row)"
          />
        </q-td>
      </template>
    </q-table>

    <!-- Add/Edit Dialog -->
    <q-dialog v-model="showAddDialog" @hide="resetForm">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">{{ editingClient ? 'Edit Client' : 'Add New Client' }}</div>
        </q-card-section>

        <q-card-section>
          <q-form @submit="saveClient" class="q-gutter-md">
            <q-input
              v-model="clientForm.name"
              label="Client Name *"
              filled
              :rules="[val => !!val || 'Client name is required']"
            />
            
            <q-input
              v-model="clientForm.description"
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
            @click="saveClient"
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
          Are you sure you want to delete client "{{ clientToDelete?.name }}"?
          <div class="text-caption text-orange q-mt-sm" v-if="clientToDelete">
            Warning: This will fail if the client has associated matters.
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
import type { Client } from 'src/types/models';

const $q = useQuasar();

// Data
const clients = ref<Client[]>([]);
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const showAddDialog = ref(false);
const showDeleteDialog = ref(false);
const editingClient = ref<Client | null>(null);
const clientToDelete = ref<Client | null>(null);

// Form data
const clientForm = ref({
  name: '',
  description: ''
});

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
async function loadClients() {
  loading.value = true;
  try {
    const response = await api.get('/api/clients');
    clients.value = response.data;
  } catch (error) {
    console.error('Failed to load clients:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to load clients'
    });
  } finally {
    loading.value = false;
  }
}

function editClient(client: Client) {
  editingClient.value = client;
  clientForm.value = {
    name: client.name,
    description: client.description || ''
  };
  showAddDialog.value = true;
}

function deleteClient(client: Client) {
  clientToDelete.value = client;
  showDeleteDialog.value = true;
}

async function saveClient() {
  saving.value = true;
  try {
    if (editingClient.value) {
      // Update existing client
      await api.put(`/api/clients/${editingClient.value.id}`, clientForm.value);
      $q.notify({
        type: 'positive',
        message: 'Client updated successfully'
      });
    } else {
      // Create new client
      await api.post('/api/clients', clientForm.value);
      $q.notify({
        type: 'positive',
        message: 'Client created successfully'
      });
    }
    
    showAddDialog.value = false;
    await loadClients();
  } catch (error) {
    console.error('Failed to save client:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to save client'
    });
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!clientToDelete.value) return;
  
  deleting.value = true;
  try {
    await api.delete(`/api/clients/${clientToDelete.value.id}`);
    $q.notify({
      type: 'positive',
      message: 'Client deleted successfully'
    });
    
    showDeleteDialog.value = false;
    await loadClients();
  } catch (error: any) {
    console.error('Failed to delete client:', error);
    const message = error.response?.data?.message || 'Failed to delete client';
    $q.notify({
      type: 'negative',
      message
    });
  } finally {
    deleting.value = false;
  }
}

function resetForm() {
  editingClient.value = null;
  clientForm.value = {
    name: '',
    description: ''
  };
}

onMounted(() => {
  loadClients();
});
</script>