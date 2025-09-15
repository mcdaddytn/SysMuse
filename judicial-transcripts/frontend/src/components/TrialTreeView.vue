<template>
  <div class="trial-tree-container">
    <div class="tree-header q-pa-sm">
      <q-input
        v-model="searchText"
        dense
        outlined
        placeholder="Search nodes..."
        class="q-mb-sm"
      >
        <template v-slot:prepend>
          <q-icon name="search" />
        </template>
        <template v-slot:append v-if="searchText">
          <q-icon
            name="clear"
            class="cursor-pointer"
            @click="searchText = ''"
          />
        </template>
      </q-input>

      <q-btn-toggle
        v-model="viewMode"
        toggle-color="primary"
        :options="[
          { label: 'Standard', value: 'standard' },
          { label: 'Session', value: 'session' }
        ]"
        dense
        class="full-width"
        @update:model-value="onViewModeChange"
      />
    </div>

    <q-separator />

    <div class="tree-content q-pa-sm">
      <q-tree
        v-if="treeData"
        :nodes="filteredNodes"
        :selected="selected"
        @update:selected="updateSelected"
        node-key="id"
        label-key="label"
        default-expand-all
        :filter="searchText"
        :filter-method="filterMethod"
      >
        <template v-slot:default-header="prop">
          <div
            class="row items-center full-width"
            @click="selectNode(prop.node)"
            @contextmenu.prevent="showContextMenu($event, prop.node)"
          >
            <q-icon
              :name="getNodeIcon(prop.node)"
              size="20px"
              class="q-mr-sm"
              :color="getNodeColor(prop.node)"
            />
            <div class="col">
              <div class="text-weight-medium">{{ prop.node.label || prop.node.name }}</div>
              <div class="text-caption text-grey-7" v-if="prop.node.description">
                {{ prop.node.description }}
              </div>
              <div class="text-caption text-grey-6" v-if="prop.node.startEventId && prop.node.endEventId">
                Events: {{ prop.node.startEventId }}-{{ prop.node.endEventId }}
              </div>
            </div>
          </div>
        </template>
      </q-tree>

      <div v-else class="text-center q-pa-md text-grey-6">
        No hierarchy loaded
      </div>
    </div>

    <q-menu
      v-model="contextMenuVisible"
      :target="contextMenuTarget"
      context-menu
    >
      <q-list dense style="min-width: 200px">
        <q-item clickable v-close-popup @click="viewFullText">
          <q-item-section avatar>
            <q-icon name="description" />
          </q-item-section>
          <q-item-section>View Full Text</q-item-section>
        </q-item>

        <q-item clickable v-close-popup @click="exportSection">
          <q-item-section avatar>
            <q-icon name="download" />
          </q-item-section>
          <q-item-section>Export Section</q-item-section>
        </q-item>

        <q-item clickable v-close-popup @click="copyEventRange">
          <q-item-section avatar>
            <q-icon name="content_copy" />
          </q-item-section>
          <q-item-section>Copy Event Range</q-item-section>
        </q-item>

        <q-separator />

        <q-item clickable v-close-popup @click="generateSummary">
          <q-item-section avatar>
            <q-icon name="auto_awesome" />
          </q-item-section>
          <q-item-section>Generate Summary</q-item-section>
        </q-item>

        <q-item clickable v-close-popup @click="navigateToSource">
          <q-item-section avatar>
            <q-icon name="open_in_new" />
          </q-item-section>
          <q-item-section>Navigate to Source</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useTrialStore } from '@/stores/trials'
import { useQuasar } from 'quasar'

interface Props {
  trial: number | null
  viewType: string
  selected: any
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:selected': [value: any]
  'nodeClick': [node: any]
  'update:viewType': [value: string]
}>()

const $q = useQuasar()
const trialStore = useTrialStore()

const searchText = ref('')
const viewMode = ref('standard')
const contextMenuVisible = ref(false)
const contextMenuTarget = ref(null)
const contextMenuNode = ref<any>(null)

const treeData = computed(() => trialStore.currentHierarchy)

const selected = computed({
  get: () => props.selected?.id || null,
  set: (value) => {
    const node = findNodeById(treeData.value, value)
    emit('update:selected', node)
  }
})

const filteredNodes = computed(() => {
  if (!treeData.value) return []
  // If treeData is already an array, return it; otherwise wrap it
  return Array.isArray(treeData.value) ? treeData.value : [treeData.value]
})

const getNodeIcon = (node: any) => {
  const iconMap: Record<string, string> = {
    TRIAL: 'account_balance',
    TRIAL_ROOT: 'account_balance',
    CASE_INTRO: 'description',
    OPENING_STATEMENTS_PERIOD: 'gavel',
    OPENING_STATEMENT_PLAINTIFF: 'person',
    OPENING_STATEMENT_DEFENSE: 'person_outline',
    WITNESS_TESTIMONY: 'record_voice_over',
    WITNESS_TESTIMONY_DEFENSE: 'record_voice_over',
    WITNESS_EXAMINATION: 'question_answer',
    DIRECT_EXAMINATION: 'question_answer',
    CROSS_EXAMINATION: 'forum',
    REDIRECT_EXAMINATION: 'replay',
    CLOSING_STATEMENTS_PERIOD: 'campaign',
    JURY_DELIBERATION: 'groups',
    JURY_INSTRUCTIONS: 'menu_book',
    VERDICT: 'fact_check',
    SESSION: 'event',
    BREAK: 'pause',
    SIDEBAR: 'forum'
  }
  return iconMap[node.type] || 'folder'
}

const getNodeColor = (node: any) => {
  const colorMap: Record<string, string> = {
    OPENING_STATEMENTS_PERIOD: 'primary',
    WITNESS_TESTIMONY_PERIOD: 'secondary',
    CLOSING_ARGUMENTS_PERIOD: 'accent',
    JURY_INSTRUCTIONS: 'warning',
    VERDICT: 'positive'
  }
  return colorMap[node.type] || 'grey-7'
}

const filterMethod = (node: any, filter: string) => {
  const filt = filter.toLowerCase()
  return (
    node.label?.toLowerCase().includes(filt) ||
    node.type?.toLowerCase().includes(filt) ||
    node.stats?.toLowerCase().includes(filt)
  )
}

const findNodeById = (node: any, id: string | number): any => {
  if (!node) return null
  if (node.id === id) return node
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeById(child, id)
      if (found) return found
    }
  }
  return null
}

const selectNode = (node: any) => {
  console.log('[TrialTreeView] selectNode called with:', node)
  // Just emit the nodeClick event since we're not using v-model
  emit('nodeClick', node)
  console.log('[TrialTreeView] Emitted nodeClick with node:', node)
}

const updateSelected = (value: any) => {
  selected.value = value
}

const showContextMenu = (event: MouseEvent, node: any) => {
  contextMenuTarget.value = event.target as any
  contextMenuNode.value = node
  contextMenuVisible.value = true
}

const viewFullText = () => {
  if (contextMenuNode.value) {
    window.open(`/api/trials/${props.trial}/nodes/${contextMenuNode.value.id}/fulltext`, '_blank')
  }
}

const exportSection = async () => {
  if (contextMenuNode.value) {
    await trialStore.exportNode(contextMenuNode.value.id)
    $q.notify({
      type: 'positive',
      message: 'Section exported successfully'
    })
  }
}

const copyEventRange = () => {
  if (contextMenuNode.value) {
    const range = `${contextMenuNode.value.startEventId}-${contextMenuNode.value.endEventId}`
    navigator.clipboard.writeText(range)
    $q.notify({
      type: 'info',
      message: 'Event range copied to clipboard'
    })
  }
}

const generateSummary = () => {
  $q.notify({
    type: 'info',
    message: 'Summary generation will be available in a future update'
  })
}

const navigateToSource = () => {
  if (contextMenuNode.value) {
    window.open(`/api/trials/${props.trial}/events/${contextMenuNode.value.startEventId}`, '_blank')
  }
}

watch(() => props.viewType, (newType) => {
  viewMode.value = newType
})

const onViewModeChange = (newMode: string) => {
  emit('update:viewType', newMode)
  // Reload hierarchy with new view
  if (props.trial) {
    trialStore.loadHierarchy(props.trial, newMode)
  }
}
</script>

<style scoped>
.trial-tree-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
}

.tree-header {
  flex-shrink: 0;
}

.tree-content {
  flex: 1;
  overflow-y: auto;
}

.q-tree {
  color: #333;
}
</style>