<template>
  <div class="summary-container">
    <div class="summary-header q-pa-md">
      <div class="text-h6">{{ nodeTitle }}</div>
      <div class="summary-stats text-caption text-grey-7 q-mt-xs">
        <q-chip dense square color="grey-3" text-color="grey-8" size="sm">
          <q-icon name="event" size="xs" class="q-mr-xs" />
          Events: {{ eventRange }}
        </q-chip>
        <q-chip dense square color="grey-3" text-color="grey-8" size="sm" class="q-ml-xs">
          <q-icon name="schedule" size="xs" class="q-mr-xs" />
          {{ duration }}
        </q-chip>
        <q-chip dense square color="grey-3" text-color="grey-8" size="sm" class="q-ml-xs">
          <q-icon name="people" size="xs" class="q-mr-xs" />
          {{ speakerCount }} speakers
        </q-chip>
      </div>
    </div>

    <q-separator />

    <div class="summary-content q-pa-md">
      <div v-if="loading" class="text-center q-pa-lg">
        <q-spinner-dots color="primary" size="40px" />
        <div class="text-grey-6 q-mt-md">Loading summary...</div>
      </div>

      <div v-else-if="error" class="text-center q-pa-lg">
        <q-icon name="error_outline" size="48px" color="negative" />
        <div class="text-negative q-mt-md">{{ error }}</div>
      </div>

      <div v-else-if="summaryContent" class="summary-text">
        <div
          v-for="(paragraph, index) in formattedContent"
          :key="index"
          class="summary-paragraph q-mb-md"
        >
          <div v-if="paragraph.speaker" class="speaker-label text-weight-bold q-mb-xs">
            {{ paragraph.speaker }}:
          </div>
          <div class="paragraph-text" style="white-space: pre-wrap;">{{ paragraph.text }}</div>
        </div>

        <div v-if="hasMore" class="text-center q-mt-lg">
          <q-btn
            outline
            color="primary"
            label="Load More"
            @click="loadMore"
            :loading="loadingMore"
          />
        </div>
      </div>

      <div v-else class="text-center q-pa-lg text-grey-6">
        Select a node to view its summary
      </div>
    </div>

    <q-separator />

    <div class="summary-footer q-pa-sm">
      <q-btn-group flat>
        <q-btn flat icon="content_copy" @click="copySummary">
          <q-tooltip>Copy Summary</q-tooltip>
        </q-btn>
        <q-btn flat icon="download" @click="exportSummary">
          <q-tooltip>Export</q-tooltip>
        </q-btn>
        <q-btn flat icon="zoom_in" @click="increaseFontSize">
          <q-tooltip>Increase Font</q-tooltip>
        </q-btn>
        <q-btn flat icon="zoom_out" @click="decreaseFontSize">
          <q-tooltip>Decrease Font</q-tooltip>
        </q-btn>
      </q-btn-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useTrialStore } from '@/stores/trials'
import { useQuasar } from 'quasar'

interface Props {
  node: any
  summaryType: string
}

const props = defineProps<Props>()
const $q = useQuasar()
const trialStore = useTrialStore()

const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const summaryContent = ref<any>(null)
const fontSize = ref(14)
const hasMore = ref(false)

const nodeTitle = computed(() => {
  if (!props.node) return 'No Selection'
  return props.node.label || props.node.name || props.node.type || 'Unnamed Node'
})

const eventRange = computed(() => {
  if (!props.node) return 'N/A'
  return `${props.node.startEventId || 0}-${props.node.endEventId || 0}`
})

const duration = computed(() => {
  if (!summaryContent.value?.duration) return 'N/A'
  const minutes = Math.floor(summaryContent.value.duration / 60)
  return `${minutes} minutes`
})

const speakerCount = computed(() => {
  return summaryContent.value?.speakers?.length || 0
})

const formattedContent = computed(() => {
  if (!summaryContent.value?.content) return []

  const paragraphs = []
  const lines = summaryContent.value.content.split('\n')
  let currentParagraph: any = { text: '' }

  for (const line of lines) {
    const speakerMatch = line.match(/^([A-Z\s.]+):\s*(.*)$/)
    if (speakerMatch) {
      if (currentParagraph.text) {
        paragraphs.push(currentParagraph)
      }
      currentParagraph = {
        speaker: speakerMatch[1].trim(),
        text: speakerMatch[2]
      }
    } else if (line.trim()) {
      // Preserve newlines by adding a line break if text already exists
      if (currentParagraph.text) {
        currentParagraph.text += '\n'
      }
      currentParagraph.text += line.trim()
    } else if (currentParagraph.text) {
      // Empty line creates a new paragraph
      paragraphs.push(currentParagraph)
      currentParagraph = { text: '' }
    }
  }

  if (currentParagraph.text) {
    paragraphs.push(currentParagraph)
  }

  return paragraphs
})

const loadSummary = async () => {
  if (!props.node) return

  loading.value = true
  error.value = null

  try {
    summaryContent.value = await trialStore.loadSummary(
      props.node.id,
      props.summaryType
    )
    hasMore.value = summaryContent.value?.hasMore || false
  } catch (err: any) {
    error.value = err.message || 'Failed to load summary'
    summaryContent.value = null
  } finally {
    loading.value = false
  }
}

const loadMore = async () => {
  loadingMore.value = true
  try {
    const moreContent = await trialStore.loadMoreSummary(props.node.id)
    if (moreContent) {
      summaryContent.value.content += '\n\n' + moreContent.content
      hasMore.value = moreContent.hasMore || false
    }
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: 'Failed to load more content'
    })
  } finally {
    loadingMore.value = false
  }
}

const copySummary = () => {
  if (summaryContent.value?.content) {
    navigator.clipboard.writeText(summaryContent.value.content)
    $q.notify({
      type: 'positive',
      message: 'Summary copied to clipboard'
    })
  }
}

const exportSummary = async () => {
  if (!props.node) return

  try {
    await trialStore.exportSummary(props.node.id, props.summaryType)
    $q.notify({
      type: 'positive',
      message: 'Summary exported successfully'
    })
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: 'Export failed'
    })
  }
}

const increaseFontSize = () => {
  if (fontSize.value < 24) {
    fontSize.value += 2
  }
}

const decreaseFontSize = () => {
  if (fontSize.value > 10) {
    fontSize.value -= 2
  }
}

watch(() => props.node, loadSummary, { immediate: true })
watch(() => props.summaryType, loadSummary)
</script>

<style scoped>
.summary-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
}

.summary-header {
  flex-shrink: 0;
}

.summary-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.summary-content {
  flex: 1;
  overflow-y: auto;
}

.summary-text {
  font-family: 'Courier New', monospace;
  line-height: 1.6;
}

.summary-paragraph {
  padding: 8px;
  border-left: 3px solid transparent;
  transition: all 0.2s;
}

.summary-paragraph:hover {
  background-color: #f5f5f5;
  border-left-color: var(--q-primary);
}

.speaker-label {
  color: #1976d2;
  font-size: 0.9em;
  text-transform: uppercase;
}

.paragraph-text {
  font-size: v-bind(fontSize + 'px');
}

.summary-footer {
  flex-shrink: 0;
  border-top: 1px solid #e0e0e0;
}
</style>