import { defineStore } from 'pinia'
import { api } from '@/services/api'

interface Trial {
  id: number
  shortName: string
  fullName: string
  startDate: string
  endDate: string
}

interface HierarchyNode {
  id: number
  label: string
  type: string
  stats: string
  startEventId: number
  endEventId: number
  children?: HierarchyNode[]
}

interface Summary {
  content: string
  duration: number
  speakers: string[]
  hasMore: boolean
  metadata?: any
}

interface Event {
  id: number
  type: string
  startEventId: number
  endEventId: number
  confidence?: number
  ruling?: string
  transcriptLines: Array<{
    speaker?: string
    text: string
  }>
}

interface TrialState {
  trials: Trial[]
  currentTrial: Trial | null
  currentHierarchy: HierarchyNode | null
  selectedNode: HierarchyNode | null
  currentSummary: Summary | null
  currentEvents: Event[]
  summaryType: string
  eventType: string
  viewType: string
  loading: boolean
  error: string | null
}

export const useTrialStore = defineStore('trials', {
  state: (): TrialState => ({
    trials: [],
    currentTrial: null,
    currentHierarchy: null,
    selectedNode: null,
    currentSummary: null,
    currentEvents: [],
    summaryType: 'abridged',
    eventType: 'objections',
    viewType: 'standard',
    loading: false,
    error: null
  }),

  actions: {
    async fetchTrials() {
      this.loading = true
      this.error = null
      try {
        const response = await api.getTrials()
        // The API returns { trials: [...] } so we need to extract the trials array
        this.trials = response.data.trials || response.data
        // Sort trials by shortName to ensure proper alphanumeric order
        this.trials.sort((a, b) => a.shortName.localeCompare(b.shortName))
        if (this.trials.length > 0 && !this.currentTrial) {
          this.currentTrial = this.trials[0]
        }
      } catch (error: any) {
        this.error = error.message || 'Failed to fetch trials'
        console.error('Error fetching trials:', error)
      } finally {
        this.loading = false
      }
    },

    async loadHierarchy(trialId: number, viewType: string = 'standard') {
      this.loading = true
      this.error = null
      try {
        const response = await api.getHierarchy(trialId, viewType)
        // Extract the hierarchy array from the response
        this.currentHierarchy = response.data.hierarchy?.[0] || response.data
        this.viewType = viewType
        this.currentTrial = this.trials.find(t => t.id === trialId) || null
      } catch (error: any) {
        this.error = error.message || 'Failed to load hierarchy'
        console.error('Error loading hierarchy:', error)
      } finally {
        this.loading = false
      }
    },

    async loadSummary(nodeId: number, summaryType: string): Promise<Summary | null> {
      try {
        const response = await api.getSummary(
          this.currentTrial?.id || 0,
          nodeId,
          summaryType
        )
        // Extract the content from the response
        if (response.data?.content) {
          // Calculate duration from metadata if available
          let duration = 0
          const metadata = response.data.content.metadata || {}

          if (metadata.startTime && metadata.endTime) {
            const start = new Date(`1970-01-01T${metadata.startTime}`).getTime()
            const end = new Date(`1970-01-01T${metadata.endTime}`).getTime()
            duration = (end - start) / 1000 // Convert to seconds
          } else if (metadata.duration) {
            duration = metadata.duration
          }

          // Extract speakers from metadata or content
          let speakers = metadata.speakers || []
          if (!speakers.length && metadata.speaker) {
            speakers = [metadata.speaker]
          }

          // Also try to extract speakers from the content text
          if (!speakers.length && response.data.content.text) {
            const speakerMatches = response.data.content.text.match(/^([A-Z][A-Z\s.]+):/gm)
            if (speakerMatches) {
              speakers = Array.from(new Set(speakerMatches.map((m: string) => m.replace(':', '').trim())))
            }
          }

          this.currentSummary = {
            content: response.data.content.text || '',
            duration,
            speakers,
            hasMore: false,
            metadata
          }
        } else {
          this.currentSummary = null
        }
        this.summaryType = summaryType
        return this.currentSummary
      } catch (error: any) {
        console.error('Error loading summary:', error)
        this.currentSummary = null
        return null
      }
    },

    async loadMoreSummary(nodeId: number): Promise<Summary | null> {
      try {
        const response = await api.getSummary(
          this.currentTrial?.id || 0,
          nodeId,
          this.summaryType,
          { offset: this.currentSummary?.content.length || 0 }
        )
        return response.data
      } catch (error: any) {
        console.error('Error loading more summary:', error)
        return null
      }
    },

    async loadEvents(nodeId: number, eventType: string): Promise<Event[]> {
      try {
        const response = await api.getEvents(
          this.currentTrial?.id || 0,
          nodeId,
          eventType
        )
        // Extract events array from response
        this.currentEvents = response.data?.events || []
        this.eventType = eventType
        return this.currentEvents
      } catch (error: any) {
        console.error('Error loading events:', error)
        this.currentEvents = []
        return []
      }
    },

    selectNode(node: HierarchyNode) {
      this.selectedNode = node
    },

    navigateTrial(direction: 'prev' | 'next') {
      const currentIndex = this.trials.findIndex(
        t => t.id === this.currentTrial?.id
      )

      if (direction === 'prev' && currentIndex > 0) {
        this.currentTrial = this.trials[currentIndex - 1]
      } else if (direction === 'next' && currentIndex < this.trials.length - 1) {
        this.currentTrial = this.trials[currentIndex + 1]
      }
    },

    async exportCurrentView() {
      if (!this.currentTrial || !this.selectedNode) {
        throw new Error('No trial or node selected')
      }

      try {
        const response = await api.exportData({
          trialId: this.currentTrial.id,
          nodeId: this.selectedNode.id,
          summaryType: this.summaryType,
          eventType: this.eventType,
          format: 'json'
        })

        const blob = new Blob([JSON.stringify(response.data, null, 2)], {
          type: 'application/json'
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `trial-${this.currentTrial.id}-node-${this.selectedNode.id}.json`
        link.click()
        URL.revokeObjectURL(url)
      } catch (error: any) {
        console.error('Error exporting data:', error)
        throw error
      }
    },

    async exportNode(nodeId: number) {
      if (!this.currentTrial) {
        throw new Error('No trial selected')
      }

      try {
        const response = await api.exportNode(this.currentTrial.id, nodeId)
        const blob = new Blob([JSON.stringify(response.data, null, 2)], {
          type: 'application/json'
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `node-${nodeId}.json`
        link.click()
        URL.revokeObjectURL(url)
      } catch (error: any) {
        console.error('Error exporting node:', error)
        throw error
      }
    },

    async exportSummary(nodeId: number, summaryType: string) {
      if (!this.currentTrial) {
        throw new Error('No trial selected')
      }

      try {
        const response = await api.exportSummary(
          this.currentTrial.id,
          nodeId,
          summaryType
        )
        const blob = new Blob([response.data.content], {
          type: 'text/plain'
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `summary-${nodeId}-${summaryType}.txt`
        link.click()
        URL.revokeObjectURL(url)
      } catch (error: any) {
        console.error('Error exporting summary:', error)
        throw error
      }
    },

    async refreshCurrentData() {
      if (this.currentTrial) {
        await this.loadHierarchy(this.currentTrial.id, this.viewType)
        if (this.selectedNode) {
          await this.loadSummary(this.selectedNode.id, this.summaryType)
          await this.loadEvents(this.selectedNode.id, this.eventType)
        }
      }
    }
  },

  getters: {
    trialOptions: (state): Trial[] => state.trials,

    availableSummaries: (state) => {
      return [
        { label: 'Abridged', value: 'abridged' },
        { label: 'Abridged 2', value: 'abridged2' },
        { label: 'Full Text', value: 'fulltext' }
      ]
    },

    nodeById: (state) => (id: number): HierarchyNode | null => {
      const findNode = (node: HierarchyNode | null): HierarchyNode | null => {
        if (!node) return null
        if (node.id === id) return node
        if (node.children) {
          for (const child of node.children) {
            const found = findNode(child)
            if (found) return found
          }
        }
        return null
      }
      return findNode(state.currentHierarchy)
    }
  }
})