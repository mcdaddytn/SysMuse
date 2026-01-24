<script setup lang="ts">
import { ref } from 'vue';

const statusFilter = ref('all');
const jobs = ref<Array<{
  id: string;
  type: string;
  status: string;
  patentId: string;
  createdAt: string;
  completedAt?: string;
}>>([]);

const statusOptions = [
  { value: 'all', label: 'All Jobs' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' }
];

const columns = [
  { name: 'id', label: 'Job ID', field: 'id', align: 'left' as const },
  { name: 'type', label: 'Type', field: 'type', align: 'left' as const },
  { name: 'patentId', label: 'Patent', field: 'patentId', align: 'left' as const },
  { name: 'status', label: 'Status', field: 'status', align: 'center' as const },
  { name: 'createdAt', label: 'Created', field: 'createdAt', align: 'center' as const },
  { name: 'actions', label: 'Actions', field: 'actions', align: 'center' as const }
];

function getStatusColor(status: string) {
  switch (status) {
    case 'PENDING': return 'grey';
    case 'RUNNING': return 'blue';
    case 'COMPLETED': return 'positive';
    case 'FAILED': return 'negative';
    default: return 'grey';
  }
}
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5 q-mr-md">Job Queue</div>
      <q-select
        v-model="statusFilter"
        :options="statusOptions"
        emit-value
        map-options
        outlined
        dense
        style="min-width: 150px"
      />
      <q-space />
      <q-btn color="primary" label="New Job" icon="add" />
    </div>

    <!-- Stats Cards -->
    <div class="row q-gutter-md q-mb-md">
      <q-card class="col">
        <q-card-section class="text-center">
          <div class="text-h4">0</div>
          <div class="text-grey-6">Pending</div>
        </q-card-section>
      </q-card>
      <q-card class="col">
        <q-card-section class="text-center">
          <div class="text-h4 text-blue">0</div>
          <div class="text-grey-6">Running</div>
        </q-card-section>
      </q-card>
      <q-card class="col">
        <q-card-section class="text-center">
          <div class="text-h4 text-positive">0</div>
          <div class="text-grey-6">Completed (24h)</div>
        </q-card-section>
      </q-card>
      <q-card class="col">
        <q-card-section class="text-center">
          <div class="text-h4 text-negative">0</div>
          <div class="text-grey-6">Failed</div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Jobs Table -->
    <q-table
      :rows="jobs"
      :columns="columns"
      row-key="id"
      flat
      bordered
    >
      <template v-slot:body-cell-status="props">
        <q-td :props="props">
          <q-badge :color="getStatusColor(props.row.status)">
            {{ props.row.status }}
          </q-badge>
        </q-td>
      </template>

      <template v-slot:body-cell-actions="props">
        <q-td :props="props">
          <q-btn
            v-if="props.row.status === 'FAILED'"
            flat
            dense
            icon="refresh"
            color="primary"
            @click="console.log('Retry', props.row.id)"
          />
          <q-btn
            v-if="props.row.status === 'PENDING'"
            flat
            dense
            icon="cancel"
            color="negative"
            @click="console.log('Cancel', props.row.id)"
          />
        </q-td>
      </template>

      <template v-slot:no-data>
        <div class="full-width row flex-center text-grey q-pa-xl">
          <q-icon size="2em" name="inbox" class="q-mr-sm" />
          No jobs in queue
        </div>
      </template>
    </q-table>
  </q-page>
</template>
