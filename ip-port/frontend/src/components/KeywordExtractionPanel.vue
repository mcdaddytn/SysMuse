<script setup lang="ts">
import { ref, computed } from 'vue';
import { focusAreaApi, type KeywordResult } from '@/services/api';

const props = defineProps<{
  focusAreaId: string;
  patentCount: number;
}>();

const emit = defineEmits<{
  addTerm: [expression: string, termType: string];
}>();

// State
const keywords = ref<KeywordResult[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const hasExtracted = ref(false);

// Options
const titleOnly = ref(true);
const includeNgrams = ref(true);
const minFrequency = ref(2);

// Selection
const selectedTerms = ref<Set<string>>(new Set());

// Computed
const canExtract = computed(() => props.patentCount >= 2);

const selectedKeywords = computed(() =>
  keywords.value.filter(k => selectedTerms.value.has(k.term))
);

const combinedExpression = computed(() =>
  Array.from(selectedTerms.value).join(' OR ')
);

// Extract keywords
async function extractKeywords() {
  if (!canExtract.value) return;

  loading.value = true;
  error.value = null;

  try {
    const result = await focusAreaApi.extractKeywordsFromFocusArea(props.focusAreaId, {
      titleOnly: titleOnly.value,
      includeNgrams: includeNgrams.value,
      minFrequency: minFrequency.value,
      maxTerms: 50
    });

    keywords.value = result.keywords;
    hasExtracted.value = true;
    selectedTerms.value.clear();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to extract keywords';
    console.error('Keyword extraction failed:', err);
  } finally {
    loading.value = false;
  }
}

// Toggle term selection
function toggleTerm(term: string) {
  if (selectedTerms.value.has(term)) {
    selectedTerms.value.delete(term);
  } else {
    selectedTerms.value.add(term);
  }
  // Trigger reactivity
  selectedTerms.value = new Set(selectedTerms.value);
}

// Add selected as search term
function addAsSearchTerm() {
  if (selectedTerms.value.size === 0) return;
  emit('addTerm', combinedExpression.value, 'KEYWORD');
  selectedTerms.value.clear();
}

// Format contrast score for display
function formatContrast(score: number): string {
  if (score >= 100) return '>100x';
  if (score >= 10) return `${Math.round(score)}x`;
  return `${score.toFixed(1)}x`;
}

// Get color based on contrast score
function getContrastColor(score: number): string {
  if (score >= 50) return 'green';
  if (score >= 10) return 'teal';
  if (score >= 5) return 'blue';
  return 'grey';
}
</script>

<template>
  <q-card flat bordered>
    <q-card-section>
      <div class="row items-center q-mb-md">
        <div class="text-subtitle2">Keyword Extraction</div>
        <q-space />
        <q-badge v-if="hasExtracted" color="primary" outline>
          {{ keywords.length }} terms found
        </q-badge>
      </div>

      <!-- Options -->
      <div class="row q-gutter-md q-mb-md">
        <q-toggle v-model="titleOnly" label="Titles only (faster)" dense />
        <q-toggle v-model="includeNgrams" label="Include phrases" dense />
        <q-input
          v-model.number="minFrequency"
          type="number"
          label="Min frequency"
          dense
          outlined
          style="width: 100px"
          :min="1"
          :max="10"
        />
      </div>

      <!-- Extract Button -->
      <q-btn
        :label="hasExtracted ? 'Re-extract Keywords' : 'Extract Keywords'"
        color="primary"
        :loading="loading"
        :disable="!canExtract"
        icon="auto_awesome"
        @click="extractKeywords"
      />

      <div v-if="!canExtract" class="text-caption text-grey-6 q-mt-xs">
        Add at least 2 patents to extract keywords
      </div>

      <!-- Error -->
      <q-banner v-if="error" class="q-mt-md bg-negative text-white">
        {{ error }}
      </q-banner>

      <!-- Results -->
      <div v-if="hasExtracted && keywords.length > 0" class="q-mt-md">
        <div class="text-caption text-grey-7 q-mb-sm">
          Click keywords to select. Higher contrast = more distinctive.
        </div>

        <!-- Keywords Grid -->
        <div class="keywords-grid">
          <q-chip
            v-for="kw in keywords"
            :key="kw.term"
            :color="selectedTerms.has(kw.term) ? 'primary' : 'grey-3'"
            :text-color="selectedTerms.has(kw.term) ? 'white' : 'grey-9'"
            clickable
            @click="toggleTerm(kw.term)"
          >
            <span class="keyword-term">{{ kw.term }}</span>
            <q-badge
              :color="getContrastColor(kw.contrastScore)"
              class="q-ml-xs"
            >
              {{ formatContrast(kw.contrastScore) }}
            </q-badge>

            <q-tooltip>
              <div class="text-weight-bold q-mb-xs">{{ kw.term }}</div>
              <div>Frequency: {{ kw.frequency }} patents</div>
              <div>Coverage: {{ (kw.selectedRatio * 100).toFixed(0) }}% of selected</div>
              <div>Corpus: {{ (kw.corpusRatio * 100).toFixed(1) }}% of portfolio</div>
              <div>Contrast: {{ formatContrast(kw.contrastScore) }} more common in selected</div>
            </q-tooltip>
          </q-chip>
        </div>

        <!-- Selection Actions -->
        <div v-if="selectedTerms.size > 0" class="q-mt-md q-pa-sm bg-blue-1 rounded-borders">
          <div class="row items-center">
            <div class="col">
              <div class="text-caption text-grey-7">Selected terms:</div>
              <code class="text-primary">{{ combinedExpression }}</code>
            </div>
            <q-btn
              color="primary"
              icon="add"
              label="Add as Search Term"
              @click="addAsSearchTerm"
            />
          </div>
        </div>
      </div>

      <!-- No Results -->
      <div v-else-if="hasExtracted && keywords.length === 0" class="q-mt-md text-center text-grey-6">
        <q-icon name="search_off" size="2em" />
        <div>No distinctive keywords found</div>
      </div>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.keywords-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
}

.keyword-term {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

code {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'Fira Code', monospace;
  font-size: 0.9em;
}
</style>
