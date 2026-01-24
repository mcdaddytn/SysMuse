<script setup lang="ts">
import { ref, computed, watch } from 'vue';

// Weight sliders
const citationWeight = ref(50);
const yearsWeight = ref(30);
const competitorWeight = ref(20);

// Normalize weights to 100%
const normalizedWeights = computed(() => {
  const total = citationWeight.value + yearsWeight.value + competitorWeight.value;
  if (total === 0) return { citation: 33.3, years: 33.3, competitor: 33.4 };
  return {
    citation: (citationWeight.value / total) * 100,
    years: (yearsWeight.value / total) * 100,
    competitor: (competitorWeight.value / total) * 100
  };
});

// TODO: Fetch scored patents and recalculate on weight change
watch([citationWeight, yearsWeight, competitorWeight], () => {
  console.log('Weights changed:', normalizedWeights.value);
  // Recalculate scores...
});
</script>

<template>
  <q-page padding>
    <div class="text-h5 q-mb-md">v2 Scoring - Simple Weighted Rankings</div>

    <div class="row q-gutter-lg">
      <!-- Weight Controls -->
      <q-card class="col-3">
        <q-card-section>
          <div class="text-h6 q-mb-md">Weight Controls</div>

          <div class="q-mb-lg">
            <div class="row justify-between">
              <span>Citation Weight</span>
              <span class="text-primary">{{ normalizedWeights.citation.toFixed(1) }}%</span>
            </div>
            <q-slider
              v-model="citationWeight"
              :min="0"
              :max="100"
              label
              color="primary"
            />
          </div>

          <div class="q-mb-lg">
            <div class="row justify-between">
              <span>Years Remaining Weight</span>
              <span class="text-primary">{{ normalizedWeights.years.toFixed(1) }}%</span>
            </div>
            <q-slider
              v-model="yearsWeight"
              :min="0"
              :max="100"
              label
              color="secondary"
            />
          </div>

          <div class="q-mb-lg">
            <div class="row justify-between">
              <span>Competitor Citation Weight</span>
              <span class="text-primary">{{ normalizedWeights.competitor.toFixed(1) }}%</span>
            </div>
            <q-slider
              v-model="competitorWeight"
              :min="0"
              :max="100"
              label
              color="accent"
            />
          </div>

          <q-separator class="q-my-md" />

          <q-btn outline color="primary" label="Save Preset" class="full-width q-mb-sm" />
          <q-btn outline color="grey" label="Reset to Default" class="full-width" />
        </q-card-section>
      </q-card>

      <!-- Rankings Grid -->
      <q-card class="col">
        <q-card-section>
          <div class="text-h6 q-mb-md">Patent Rankings (by v2 Score)</div>
          <div class="text-grey-6">
            Rankings will update in real-time as you adjust weights.
            <br />
            Connect to backend API to see actual patent data.
          </div>

          <!-- Placeholder for rankings table -->
          <q-table
            :rows="[]"
            :columns="[
              { name: 'rank', label: 'Rank', field: 'rank', align: 'center' },
              { name: 'change', label: 'Change', field: 'change', align: 'center' },
              { name: 'patent_id', label: 'Patent ID', field: 'patent_id', align: 'left' },
              { name: 'title', label: 'Title', field: 'title', align: 'left' },
              { name: 'score', label: 'v2 Score', field: 'score', align: 'center' }
            ]"
            row-key="patent_id"
            flat
            bordered
            class="q-mt-md"
          >
            <template v-slot:no-data>
              <div class="full-width row flex-center text-grey q-pa-xl">
                <q-icon size="2em" name="pending" class="q-mr-sm" />
                Waiting for API connection...
              </div>
            </template>
          </q-table>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>
