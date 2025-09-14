<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-btn
          v-if="$q.screen.lt.md"
          flat
          dense
          round
          icon="menu"
          @click="leftDrawerOpen = !leftDrawerOpen"
        />
        <TrialToolbar
          v-model:selected-trial="selectedTrial"
          v-model:summary-type="summaryType"
          v-model:event-type="eventType"
          @navigate="handleNavigation"
        />
      </q-toolbar>
    </q-header>

    <q-drawer
      v-if="$q.screen.lt.md"
      v-model="leftDrawerOpen"
      show-if-above
      bordered
      :width="300"
    >
      <TrialTreeView
        :trial="selectedTrial"
        v-model:view-type="treeViewType"
        v-model:selected="selectedNode"
        @node-click="handleNodeSelection"
      />
    </q-drawer>

    <q-page-container>
      <q-page class="q-pa-none">
        <div v-if="$q.screen.lt.sm" class="mobile-layout">
          <q-tabs
            v-model="mobileTab"
            dense
            class="text-grey"
            active-color="primary"
            indicator-color="primary"
            align="justify"
          >
            <q-tab name="tree" label="Hierarchy" />
            <q-tab name="summary" label="Summary" />
            <q-tab name="events" label="Events" />
          </q-tabs>

          <q-tab-panels v-model="mobileTab" animated class="full-height">
            <q-tab-panel name="tree">
              <TrialTreeView
                :trial="selectedTrial"
                v-model:view-type="treeViewType"
                v-model:selected="selectedNode"
                @node-click="handleNodeSelection"
              />
            </q-tab-panel>

            <q-tab-panel name="summary">
              <SummaryPane
                :node="selectedNode"
                :summary-type="summaryType"
              />
            </q-tab-panel>

            <q-tab-panel name="events">
              <EventsPane
                :node="selectedNode"
                :event-type="eventType"
              />
            </q-tab-panel>
          </q-tab-panels>
        </div>

        <div v-else-if="$q.screen.lt.md" class="tablet-layout full-height">
          <q-splitter
            horizontal
            v-model="tabletSplitter"
            :limits="[30, 70]"
            class="full-height"
          >
            <template v-slot:before>
              <SummaryPane
                :node="selectedNode"
                :summary-type="summaryType"
              />
            </template>

            <template v-slot:after>
              <EventsPane
                :node="selectedNode"
                :event-type="eventType"
              />
            </template>
          </q-splitter>
        </div>

        <div v-else class="desktop-layout">
          <q-splitter
            v-model="horizontalSplitter"
            :limits="[25, 45]"
            class="full-height"
          >
            <template v-slot:before>
              <TrialTreeView
                :trial="selectedTrial"
                v-model:view-type="treeViewType"
                v-model:selected="selectedNode"
                @node-click="handleNodeSelection"
              />
            </template>

            <template v-slot:after>
              <q-splitter
                horizontal
                v-model="verticalSplitter"
                :limits="[30, 70]"
                class="full-height"
              >
                <template v-slot:before>
                  <SummaryPane
                    :node="selectedNode"
                    :summary-type="summaryType"
                  />
                </template>

                <template v-slot:after>
                  <EventsPane
                    :node="selectedNode"
                    :event-type="eventType"
                  />
                </template>
              </q-splitter>
            </template>
          </q-splitter>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useTrialStore } from '@/stores/trials'
import TrialToolbar from '@/components/TrialToolbar.vue'
import TrialTreeView from '@/components/TrialTreeView.vue'
import SummaryPane from '@/components/SummaryPane.vue'
import EventsPane from '@/components/EventsPane.vue'

const $q = useQuasar()
const trialStore = useTrialStore()

const horizontalSplitter = ref(35)
const verticalSplitter = ref(50)
const tabletSplitter = ref(50)
const leftDrawerOpen = ref(false)
const mobileTab = ref('tree')

const selectedTrial = ref<number | null>(null)
const selectedNode = ref<any>(null)
const summaryType = ref('abridged')
const eventType = ref('objections')
const treeViewType = ref('standard')

onMounted(async () => {
  await trialStore.fetchTrials()
  if (trialStore.trials.length > 0) {
    selectedTrial.value = trialStore.trials[0].id
  }
})

watch(selectedTrial, async (newTrialId) => {
  if (newTrialId) {
    await trialStore.loadHierarchy(newTrialId, treeViewType.value)
    // Auto-select the root node
    if (trialStore.currentHierarchy) {
      selectedNode.value = trialStore.currentHierarchy
    }
  }
})

watch(selectedNode, async (newNode) => {
  if (newNode) {
    await trialStore.loadSummary(newNode.id, summaryType.value)
    await trialStore.loadEvents(newNode.id, eventType.value)
  }
})

watch(summaryType, async (newType) => {
  if (selectedNode.value) {
    await trialStore.loadSummary(selectedNode.value.id, newType)
  }
})

watch(eventType, async (newType) => {
  if (selectedNode.value) {
    await trialStore.loadEvents(selectedNode.value.id, newType)
  }
})

const handleNavigation = (direction: 'prev' | 'next') => {
  trialStore.navigateTrial(direction)
  selectedTrial.value = trialStore.currentTrial?.id || null
}

const handleNodeSelection = (node: any) => {
  selectedNode.value = node
  if ($q.screen.lt.sm) {
    mobileTab.value = 'summary'
  }
  if ($q.screen.lt.md) {
    leftDrawerOpen.value = false
  }
}
</script>

<style scoped>
.q-page {
  height: calc(100vh - 50px);
}

.mobile-layout,
.tablet-layout,
.desktop-layout {
  height: 100%;
}

.full-height {
  height: 100%;
}
</style>