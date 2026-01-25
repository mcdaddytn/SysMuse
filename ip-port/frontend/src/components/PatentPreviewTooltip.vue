<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { patentApi, type PatentPreview } from '@/services/api';

const props = defineProps<{
  patentId: string;
  showLink?: boolean;
}>();

const emit = defineEmits<{
  click: [patentId: string];
}>();

// State
const preview = ref<PatentPreview | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const hasLoaded = ref(false);

// Computed
const statusColor = computed(() => {
  if (!preview.value) return 'grey';
  return preview.value.remaining_years > 0 ? 'green' : 'red';
});

const statusLabel = computed(() => {
  if (!preview.value) return '';
  return preview.value.remaining_years > 0 ? 'Active' : 'Expired';
});

const truncatedCpcCodes = computed(() => {
  if (!preview.value?.cpc_codes) return [];
  return preview.value.cpc_codes.slice(0, 5);
});

const hasMoreCpcCodes = computed(() => {
  if (!preview.value?.cpc_codes) return false;
  return preview.value.cpc_codes.length > 5;
});

// Load preview on first hover
async function loadPreview() {
  if (hasLoaded.value) return;

  loading.value = true;
  error.value = null;

  try {
    preview.value = await patentApi.getPatentPreview(props.patentId);
    hasLoaded.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load';
    console.error('Failed to load patent preview:', err);
  } finally {
    loading.value = false;
  }
}

// Reset when patentId changes
watch(() => props.patentId, () => {
  preview.value = null;
  hasLoaded.value = false;
  error.value = null;
});

function handleClick() {
  emit('click', props.patentId);
}
</script>

<template>
  <span class="patent-preview-trigger">
    <slot>
      <span
        class="patent-id-text"
        :class="{ 'clickable': showLink }"
        @click.stop="showLink && handleClick()"
      >
        {{ patentId }}
      </span>
    </slot>

    <q-tooltip
      class="patent-preview-tooltip"
      anchor="top middle"
      self="bottom middle"
      :offset="[0, 8]"
      @before-show="loadPreview"
    >
      <!-- Loading State -->
      <div v-if="loading" class="q-pa-md text-center">
        <q-spinner size="sm" color="white" />
        <div class="text-caption q-mt-xs">Loading...</div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="q-pa-md">
        <div class="text-negative">
          <q-icon name="error" class="q-mr-xs" />
          {{ error }}
        </div>
      </div>

      <!-- Content -->
      <div v-else-if="preview" class="preview-content">
        <!-- Header -->
        <div class="preview-header q-mb-sm">
          <div class="row items-start no-wrap">
            <div class="col">
              <div class="text-subtitle2 text-weight-bold preview-title">
                {{ preview.patent_title }}
              </div>
              <div class="text-caption text-grey-4 q-mt-xs">
                US {{ preview.patent_id }} | {{ preview.patent_date }}
              </div>
            </div>
            <q-badge
              :color="statusColor"
              :label="statusLabel"
              class="q-ml-sm"
            />
          </div>
        </div>

        <q-separator dark class="q-my-sm" />

        <!-- Info Grid -->
        <div class="preview-grid">
          <!-- Assignee/Affiliate -->
          <div class="preview-row">
            <div class="preview-label">
              <q-icon name="business" size="xs" class="q-mr-xs" />
              Assignee
            </div>
            <div class="preview-value">
              {{ preview.assignee }}
              <span v-if="preview.affiliate !== preview.assignee" class="text-grey-5">
                ({{ preview.affiliate }})
              </span>
            </div>
          </div>

          <!-- Sector -->
          <div class="preview-row">
            <div class="preview-label">
              <q-icon name="category" size="xs" class="q-mr-xs" />
              Sector
            </div>
            <div class="preview-value">
              <q-badge color="blue-8" :label="preview.super_sector" />
              <span v-if="preview.primary_sector" class="text-grey-5 q-ml-xs">
                {{ preview.primary_sector }}
              </span>
            </div>
          </div>

          <!-- Stats -->
          <div class="preview-row">
            <div class="preview-label">
              <q-icon name="format_quote" size="xs" class="q-mr-xs" />
              Citations
            </div>
            <div class="preview-value">
              {{ preview.forward_citations }} forward citations
            </div>
          </div>

          <div class="preview-row">
            <div class="preview-label">
              <q-icon name="schedule" size="xs" class="q-mr-xs" />
              Life
            </div>
            <div class="preview-value">
              {{ preview.remaining_years > 0 ? preview.remaining_years.toFixed(1) + ' years remaining' : 'Expired' }}
            </div>
          </div>

          <!-- CPC Codes -->
          <div v-if="truncatedCpcCodes.length" class="preview-row">
            <div class="preview-label">
              <q-icon name="label" size="xs" class="q-mr-xs" />
              CPC
            </div>
            <div class="preview-value cpc-codes">
              <q-badge
                v-for="cpc in truncatedCpcCodes"
                :key="cpc"
                color="grey-8"
                :label="cpc"
                class="q-mr-xs q-mb-xs"
              />
              <span v-if="hasMoreCpcCodes" class="text-grey-5">
                +{{ preview.cpc_codes.length - 5 }} more
              </span>
            </div>
          </div>
        </div>

        <!-- Footer hint -->
        <div v-if="showLink" class="text-caption text-grey-5 text-center q-mt-sm">
          Click to view details
        </div>
      </div>

      <!-- Not Found State -->
      <div v-else class="q-pa-md text-center">
        <q-icon name="search_off" size="sm" />
        <div class="text-caption q-mt-xs">Patent not found in portfolio</div>
      </div>
    </q-tooltip>
  </span>
</template>

<style scoped>
.patent-preview-trigger {
  display: inline;
}

.patent-id-text {
  font-family: 'Fira Code', monospace;
  font-size: 0.9em;
}

.patent-id-text.clickable {
  color: var(--q-primary);
  cursor: pointer;
}

.patent-id-text.clickable:hover {
  text-decoration: underline;
}

.patent-preview-tooltip {
  max-width: 420px;
  background: #1e1e1e;
  border: 1px solid #444;
}

.preview-content {
  padding: 12px;
  min-width: 340px;
}

.preview-title {
  line-height: 1.3;
  max-height: 2.6em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.preview-header {
  padding-bottom: 4px;
}

.preview-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-row {
  display: flex;
  gap: 8px;
  font-size: 0.85em;
}

.preview-label {
  min-width: 70px;
  color: #999;
  display: flex;
  align-items: flex-start;
}

.preview-value {
  flex: 1;
  color: #eee;
}

.cpc-codes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}
</style>
