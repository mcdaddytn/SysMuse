<script setup lang="ts">
import { ref } from 'vue';

const selectedSector = ref('all');

const sectors = [
  { value: 'all', label: 'All Sectors' },
  { value: 'semiconductor', label: 'Semiconductor Manufacturing' },
  { value: 'networking', label: 'Networking & Communications' },
  { value: 'storage', label: 'Data Storage' },
  { value: 'enterprise', label: 'Enterprise Software' },
  { value: 'security', label: 'Cybersecurity' },
  { value: 'virtualization', label: 'Virtualization' }
];
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5 q-mr-md">Sector Rankings</div>
      <q-select
        v-model="selectedSector"
        :options="sectors"
        emit-value
        map-options
        outlined
        dense
        style="min-width: 250px"
      />
    </div>

    <div class="row q-gutter-md q-mb-md">
      <q-card v-for="sector in sectors.slice(1)" :key="sector.value" class="col-4">
        <q-card-section>
          <div class="text-h6">{{ sector.label }}</div>
          <div class="text-grey-6">0 patents</div>
        </q-card-section>
        <q-card-section>
          <q-btn
            flat
            color="primary"
            :label="`View ${sector.label} Rankings`"
            @click="selectedSector = sector.value"
          />
        </q-card-section>
      </q-card>
    </div>

    <q-card v-if="selectedSector !== 'all'">
      <q-card-section>
        <div class="text-h6">
          {{ sectors.find(s => s.value === selectedSector)?.label }} Patents
        </div>
        <div class="text-grey q-pa-xl text-center">
          Sector-filtered rankings will appear here.
        </div>
      </q-card-section>
    </q-card>
  </q-page>
</template>
