<template>
  <q-toolbar>
    <q-btn
      flat
      round
      icon="chevron_left"
      @click="previousTrial"
      :disable="!hasPrevious"
    >
      <q-tooltip>Previous Trial</q-tooltip>
    </q-btn>

    <q-select
      v-model="trial"
      :options="trialOptions"
      option-label="shortName"
      option-value="id"
      emit-value
      map-options
      style="min-width: 250px"
      dense
      outlined
      dark
      class="q-mx-sm"
    />

    <q-btn
      flat
      round
      icon="chevron_right"
      @click="nextTrial"
      :disable="!hasNext"
    >
      <q-tooltip>Next Trial</q-tooltip>
    </q-btn>

    <q-space />

    <q-select
      v-model="summary"
      :options="summaryOptions"
      label="Summary"
      dense
      outlined
      dark
      style="min-width: 150px"
      class="q-mr-sm"
    />

    <q-select
      v-model="events"
      :options="eventOptions"
      label="Events"
      dense
      outlined
      dark
      style="min-width: 150px"
      class="q-mr-md"
    />

    <q-btn-group flat>
      <q-btn flat round icon="download" @click="exportData">
        <q-tooltip>Export Data</q-tooltip>
      </q-btn>
      <q-btn flat round icon="refresh" @click="refreshData">
        <q-tooltip>Refresh</q-tooltip>
      </q-btn>
      <q-btn flat round icon="settings" @click="showSettings">
        <q-tooltip>Settings</q-tooltip>
      </q-btn>
    </q-btn-group>
  </q-toolbar>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTrialStore } from '@/stores/trials'
import { useQuasar } from 'quasar'

interface Props {
  selectedTrial: number | null
  summaryType: string
  eventType: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:selectedTrial': [value: number | null]
  'update:summaryType': [value: string]
  'update:eventType': [value: string]
  'navigate': [direction: 'prev' | 'next']
}>()

const $q = useQuasar()
const trialStore = useTrialStore()

const trial = computed({
  get: () => props.selectedTrial,
  set: (value) => emit('update:selectedTrial', value)
})

const summary = computed({
  get: () => props.summaryType,
  set: (value) => emit('update:summaryType', value)
})

const events = computed({
  get: () => props.eventType,
  set: (value) => emit('update:eventType', value)
})

const trialOptions = computed(() => trialStore.trials)

const summaryOptions = ref([
  { label: 'Abridged', value: 'abridged' },
  { label: 'Abridged 2', value: 'abridged2' },
  { label: 'Full Text', value: 'fulltext' }
])

const eventOptions = ref([
  { label: 'Objections', value: 'objections' },
  { label: 'Interactions', value: 'interactions' }
])

const currentTrialIndex = computed(() => {
  if (!props.selectedTrial) return -1
  return trialStore.trials.findIndex(t => t.id === props.selectedTrial)
})

const hasPrevious = computed(() => currentTrialIndex.value > 0)
const hasNext = computed(() =>
  currentTrialIndex.value < trialStore.trials.length - 1 &&
  currentTrialIndex.value >= 0
)

const previousTrial = () => {
  if (hasPrevious.value) {
    emit('navigate', 'prev')
  }
}

const nextTrial = () => {
  if (hasNext.value) {
    emit('navigate', 'next')
  }
}

const exportData = async () => {
  try {
    await trialStore.exportCurrentView()
    $q.notify({
      type: 'positive',
      message: 'Data exported successfully'
    })
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: 'Export failed'
    })
  }
}

const refreshData = async () => {
  await trialStore.refreshCurrentData()
  $q.notify({
    type: 'info',
    message: 'Data refreshed'
  })
}

const showSettings = () => {
  $q.dialog({
    title: 'Settings',
    message: 'Settings panel coming soon',
    ok: true
  })
}
</script>