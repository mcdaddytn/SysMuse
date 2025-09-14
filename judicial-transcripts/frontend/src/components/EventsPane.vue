<template>
  <div class="events-container">
    <div class="events-header q-pa-md">
      <div class="row items-center">
        <div class="col">
          <div class="text-h6">{{ eventTypeLabel }}</div>
          <div class="text-caption text-grey-7">
            {{ totalEvents }} total
            <span v-if="eventStats">
              ({{ eventStats }})
            </span>
          </div>
        </div>
        <div class="col-auto">
          <q-btn-group flat dense>
            <q-btn
              flat
              round
              size="sm"
              icon="filter_list"
              @click="showFilters = !showFilters"
            >
              <q-tooltip>Toggle Filters</q-tooltip>
            </q-btn>
            <q-btn
              flat
              round
              size="sm"
              icon="sort"
              @click="toggleSort"
            >
              <q-tooltip>Sort</q-tooltip>
            </q-btn>
          </q-btn-group>
        </div>
      </div>

      <q-slide-transition>
        <div v-show="showFilters" class="q-mt-md">
          <q-select
            v-model="confidenceFilter"
            :options="confidenceOptions"
            label="Min Confidence"
            dense
            outlined
            class="q-mb-sm"
          />
          <q-select
            v-if="eventType === 'objections'"
            v-model="rulingFilter"
            :options="rulingOptions"
            label="Ruling Type"
            dense
            outlined
            multiple
            use-chips
          />
        </div>
      </q-slide-transition>
    </div>

    <q-separator />

    <div class="events-content q-pa-sm">
      <div v-if="loading" class="text-center q-pa-lg">
        <q-spinner-dots color="primary" size="40px" />
        <div class="text-grey-6 q-mt-md">Loading events...</div>
      </div>

      <div v-else-if="error" class="text-center q-pa-lg">
        <q-icon name="error_outline" size="48px" color="negative" />
        <div class="text-negative q-mt-md">{{ error }}</div>
      </div>

      <div v-else-if="filteredEvents.length > 0">
        <q-list separator>
          <q-item
            v-for="event in paginatedEvents"
            :key="event.id"
            clickable
            @click="selectEvent(event)"
            :class="{ 'bg-blue-1': selectedEvent?.id === event.id }"
          >
            <q-item-section>
              <q-item-label class="text-weight-medium">
                {{ event.name || event.type }}
              </q-item-label>
              <q-item-label caption v-if="event.description">
                {{ event.description }}
              </q-item-label>
              <div class="event-summary-text q-mt-sm" v-if="event.text">
                {{ truncateText(event.text, 200) }}
              </div>
              <q-item-label caption class="q-mt-xs">
                Events: {{ event.startEventId }}-{{ event.endEventId }}
              </q-item-label>
            </q-item-section>
            <q-item-section side top>
              <q-btn
                flat
                round
                size="sm"
                icon="open_in_new"
                @click.stop="openEvent(event)"
              >
                <q-tooltip>View in context</q-tooltip>
              </q-btn>
            </q-item-section>
          </q-item>
        </q-list>

        <div v-if="hasMorePages" class="q-pa-md text-center">
          <q-pagination
            v-model="currentPage"
            :max="totalPages"
            direction-links
            boundary-links
            color="primary"
            active-design="unelevated"
            active-color="primary"
            active-text-color="white"
          />
        </div>
      </div>

      <div v-else class="text-center q-pa-lg text-grey-6">
        <q-icon name="inbox" size="48px" color="grey-5" />
        <div class="q-mt-md">No events found</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useTrialStore } from '@/stores/trials'
import { useQuasar } from 'quasar'

interface Props {
  node: any
  eventType: string
}

const props = defineProps<Props>()
const $q = useQuasar()
const trialStore = useTrialStore()

const loading = ref(false)
const error = ref<string | null>(null)
const events = ref<any[]>([])
const showFilters = ref(false)
const confidenceFilter = ref(0)
const rulingFilter = ref<string[]>([])
const sortOrder = ref<'asc' | 'desc'>('asc')
const currentPage = ref(1)
const pageSize = 20
const selectedEvent = ref<any>(null)

const eventTypeLabel = computed(() => {
  const labels: Record<string, string> = {
    objections: 'Objections',
    exhibits: 'Exhibits',
    sidebar: 'Sidebar Conferences',
    all: 'All Events'
  }
  return labels[props.eventType] || 'Events'
})

const confidenceOptions = [
  { label: 'All', value: 0 },
  { label: '50%+', value: 0.5 },
  { label: '70%+', value: 0.7 },
  { label: '90%+', value: 0.9 },
  { label: '95%+', value: 0.95 }
]

const rulingOptions = [
  'SUSTAINED',
  'OVERRULED',
  'WITHDRAWN',
  'MOOT'
]

const filteredEvents = computed(() => {
  let filtered = [...events.value]

  if (confidenceFilter.value > 0) {
    filtered = filtered.filter(e =>
      (e.confidence || 0) >= confidenceFilter.value
    )
  }

  if (rulingFilter.value.length > 0 && props.eventType === 'objections') {
    filtered = filtered.filter(e =>
      rulingFilter.value.includes(e.ruling)
    )
  }

  if (sortOrder.value === 'desc') {
    filtered.reverse()
  }

  return filtered
})

const totalEvents = computed(() => filteredEvents.value.length)

const eventStats = computed(() => {
  if (props.eventType !== 'objections' || totalEvents.value === 0) {
    return null
  }

  const sustained = filteredEvents.value.filter(e => e.ruling === 'SUSTAINED').length
  const overruled = filteredEvents.value.filter(e => e.ruling === 'OVERRULED').length

  return `${sustained} sustained, ${overruled} overruled`
})

const paginatedEvents = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  const end = start + pageSize
  return filteredEvents.value.slice(start, end)
})

const totalPages = computed(() =>
  Math.ceil(filteredEvents.value.length / pageSize)
)

const hasMorePages = computed(() => totalPages.value > 1)

const getEventIcon = (event: any) => {
  const iconMap: Record<string, string> = {
    objection: 'gavel',
    exhibit: 'description',
    sidebar: 'forum',
    break: 'pause',
    default: 'event'
  }
  return iconMap[event.type?.toLowerCase()] || iconMap.default
}

const getEventColor = (event: any) => {
  if (event.type === 'objection') {
    return event.ruling === 'SUSTAINED' ? 'positive' : 'negative'
  }
  return 'primary'
}

const getEventHeaderClass = (event: any) => {
  if (event.confidence && event.confidence < 0.7) {
    return 'bg-orange-1'
  }
  return ''
}

const getRulingColor = (ruling: string) => {
  const colorMap: Record<string, string> = {
    SUSTAINED: 'positive',
    OVERRULED: 'negative',
    WITHDRAWN: 'warning',
    MOOT: 'grey'
  }
  return colorMap[ruling] || 'grey'
}

const loadEvents = async () => {
  if (!props.node) return

  loading.value = true
  error.value = null

  try {
    events.value = await trialStore.loadEvents(
      props.node.id,
      props.eventType
    )
    currentPage.value = 1
  } catch (err: any) {
    error.value = err.message || 'Failed to load events'
    events.value = []
  } finally {
    loading.value = false
  }
}

const toggleSort = () => {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
}

const openEvent = (event: any) => {
  window.open(
    `/api/trials/${trialStore.currentTrial?.id}/events/${event.startEventId}`,
    '_blank'
  )
}

const truncateText = (text: string, maxLength: number) => {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

const selectEvent = (event: any) => {
  selectedEvent.value = event
}

const copyEvent = (event: any) => {
  const text = event.text || event.name || ''
  navigator.clipboard.writeText(text)
  $q.notify({
    type: 'positive',
    message: 'Event copied to clipboard'
  })
}

const bookmarkEvent = (event: any) => {
  $q.notify({
    type: 'info',
    message: 'Bookmarking will be available in a future update'
  })
}

watch(() => props.node, loadEvents, { immediate: true })
watch(() => props.eventType, loadEvents)
</script>

<style scoped>
.events-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
}

.events-header {
  flex-shrink: 0;
}

.events-content {
  flex: 1;
  overflow-y: auto;
}

.event-transcript {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  max-height: 300px;
  overflow-y: auto;
}

.transcript-line {
  margin-bottom: 8px;
}

.speaker-name {
  font-weight: bold;
  color: #1976d2;
  text-transform: uppercase;
}

.event-summary-text {
  font-size: 12px;
  line-height: 1.4;
  color: #666;
  white-space: pre-wrap;
}
</style>