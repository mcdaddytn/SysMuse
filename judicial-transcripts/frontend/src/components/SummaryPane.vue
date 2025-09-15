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
        <div v-if="isLLMFallback" class="llm-fallback-notice q-pa-md q-mb-md">
          <q-banner class="bg-orange-2 text-grey-9" rounded>
            <template v-slot:avatar>
              <q-icon name="info" color="orange-8" />
            </template>
            <div class="text-weight-bold text-grey-9">LLM Summary Not Available</div>
            <div class="text-body2 q-mt-xs text-grey-8">Showing Abridged summary as fallback</div>
            <template v-slot:action>
              <q-btn
                flat
                label="Request Generation"
                color="black"
                icon="auto_awesome"
                @click="requestLLMGeneration"
                class="text-weight-medium"
              />
            </template>
          </q-banner>
        </div>

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
const isLLMFallback = ref(false)

const nodeTitle = computed(() => {
  if (!props.node) return 'No Selection'
  return props.node.label || props.node.name || props.node.type || 'Unnamed Node'
})

const eventRange = computed(() => {
  if (!props.node) return 'N/A'
  return `${props.node.startEventId || 0}-${props.node.endEventId || 0}`
})

const duration = computed(() => {
  // Try summary metadata first (from API response)
  if (summaryContent.value?.metadata?.startTime && summaryContent.value?.metadata?.endTime) {
    // These are time strings like "10:30:45 AM"
    const startTime = summaryContent.value.metadata.startTime
    const endTime = summaryContent.value.metadata.endTime
    return `${startTime} - ${endTime}`
  }

  // Try to calculate duration from event range if available
  if (summaryContent.value?.duration && summaryContent.value.duration > 0) {
    const minutes = Math.floor(summaryContent.value.duration / 60)
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`
    }
    return `${minutes} minutes`
  }

  // Try node metadata
  if (props.node?.metadata?.duration) {
    const minutes = Math.floor(props.node.metadata.duration / 60)
    return `${minutes} minutes`
  }

  // If node has time info, use it
  if (props.node?.startTime && props.node?.endTime) {
    const start = new Date(props.node.startTime).getTime()
    const end = new Date(props.node.endTime).getTime()
    const minutes = Math.floor((end - start) / 60000)
    return `${minutes} minutes`
  }

  // If we have event count, show that instead
  if (props.node?.stats?.eventCount) {
    return `${props.node.stats.eventCount} events`
  }

  return 'Duration unavailable'
})

const speakerCount = computed(() => {
  // First check node stats if available
  if (props.node?.stats?.speakerCount) {
    return props.node.stats.speakerCount
  }
  // Get speakers from summary metadata
  if (summaryContent.value?.metadata?.speaker) {
    // At least one speaker from metadata
    return 1
  }
  if (summaryContent.value?.speakers?.length) {
    return summaryContent.value.speakers.length
  }
  // Get speakers from node metadata if available
  if (props.node?.metadata?.speakers?.length) {
    return props.node.metadata.speakers.length
  }
  // Count unique speakers in the content if available
  if (summaryContent.value?.content) {
    const speakerMatches = summaryContent.value.content.match(/^([A-Z][A-Z\s.]+):/gm)
    if (speakerMatches) {
      const uniqueSpeakers = new Set(speakerMatches.map((m: string) => m.replace(':', '').trim()))
      return uniqueSpeakers.size
    }
  }
  return 0
})

const formattedContent = computed(() => {
  if (!summaryContent.value?.content) return []

  let content = summaryContent.value.content

  // Check if this is an LLM fallback response and extract the actual content
  isLLMFallback.value = false
  if (props.summaryType === 'llmsummary1' && content.includes('[LLM Summary not available')) {
    isLLMFallback.value = true
    // Remove the fallback notice lines from the content
    const lines = content.split('\n')
    const contentStart = lines.findIndex(line => !line.startsWith('['))
    if (contentStart > 0) {
      content = lines.slice(contentStart).join('\n')
    }
  }

  const paragraphs = []
  const lines = content.split('\n')
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
  if (!props.node || !props.node.id) return

  loading.value = true
  error.value = null

  try {
    const result = await trialStore.loadSummary(
      props.node.id,
      props.summaryType
    )
    // Handle the nested response structure
    if (result) {
      summaryContent.value = result
      hasMore.value = result.hasMore || false
    } else {
      summaryContent.value = null
    }
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

const requestLLMGeneration = () => {
  $q.dialog({
    title: 'Request LLM Summary Generation',
    message: 'This feature is not yet implemented. LLM summary generation will be available in a future update.',
    ok: true
  })
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