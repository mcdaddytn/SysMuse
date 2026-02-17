<script setup lang="ts">
import { computed } from 'vue';
import type { ScoredPatent, MergedSectorTemplate, ScoringQuestionWithLevel } from '@/services/api';

const props = defineProps<{
  patent: ScoredPatent;
  template: MergedSectorTemplate | null;
}>();

// Group questions by sourceLevel
const groupedQuestions = computed(() => {
  if (!props.template) return [];

  const levels: Array<{ level: string; label: string; questions: ScoringQuestionWithLevel[] }> = [];
  const levelOrder = ['portfolio', 'super_sector', 'sector', 'sub_sector'] as const;
  const levelLabels: Record<string, string> = {
    portfolio: 'Portfolio',
    super_sector: 'Super-Sector',
    sector: 'Sector',
    sub_sector: 'Sub-Sector',
  };

  for (const lvl of levelOrder) {
    const qs = props.template.questions.filter(q => q.sourceLevel === lvl);
    if (qs.length > 0) {
      levels.push({ level: lvl, label: levelLabels[lvl], questions: qs });
    }
  }
  return levels;
});

// Build a lookup: fieldName → metric from the patent's metrics array
const metricsMap = computed(() => {
  const map = new Map<string, { score: number; reasoning: string }>();
  for (const m of props.patent.metrics || []) {
    map.set(m.fieldName, { score: m.score, reasoning: m.reasoning });
  }
  return map;
});

// Compute the formula display
const formulaDisplay = computed(() => {
  if (!props.template) return '';
  const totalWeight = props.template.questions.reduce((s, q) => s + q.weight, 0);
  return `= ${props.patent.compositeScore.toFixed(1)}`;
});

function getScoreColor(score: number): string {
  if (score >= 7) return 'positive';
  if (score >= 5) return 'primary';
  if (score >= 3) return 'warning';
  return 'negative';
}

function getBadgeColor(score: number): string {
  if (score >= 60) return 'positive';
  if (score >= 45) return 'primary';
  if (score >= 30) return 'warning';
  return 'grey';
}

function formatWeight(w: number): string {
  return (w * 100).toFixed(0) + '%';
}
</script>

<template>
  <div class="tooltip-content">
    <!-- Header -->
    <div class="tooltip-header q-mb-sm">
      <div class="row items-start no-wrap">
        <div class="col">
          <div class="tooltip-title text-subtitle2 text-weight-bold">
            {{ patent.patentTitle }}
          </div>
          <div class="text-caption text-grey-4 q-mt-xs">
            US {{ patent.patentId }}
            <span v-if="patent.assignee"> &middot; {{ patent.assignee }}</span>
            <span v-if="patent.patentDate"> &middot; {{ patent.patentDate }}</span>
          </div>
        </div>
      </div>
    </div>

    <q-separator dark class="q-my-sm" />

    <!-- Score summary -->
    <div class="row items-center q-gutter-sm q-mb-sm">
      <q-badge
        :color="getBadgeColor(patent.compositeScore)"
        class="text-body2 q-pa-xs"
        style="font-size: 1.1em; padding: 4px 10px;"
      >
        {{ patent.compositeScore.toFixed(1) }}
      </q-badge>
      <q-chip
        v-if="patent.withClaims"
        dense
        size="sm"
        color="blue-8"
        text-color="white"
        label="Claims"
      />
      <span v-if="template" class="text-caption text-grey-5">
        {{ template.inheritanceChain.join(' > ') }}
      </span>
    </div>

    <!-- Formula breakdown grouped by sourceLevel -->
    <template v-if="template && groupedQuestions.length > 0">
      <div
        v-for="group in groupedQuestions"
        :key="group.level"
        class="q-mb-xs"
      >
        <div class="text-caption text-weight-bold q-mb-xs" style="color: #aaa;">
          {{ group.label }}
        </div>
        <div
          v-for="q in group.questions"
          :key="q.fieldName"
          class="question-row"
        >
          <div class="question-name">{{ q.displayName }}</div>
          <div class="question-weight text-grey-5">{{ formatWeight(q.weight) }}</div>
          <div class="question-score">
            <template v-if="metricsMap.get(q.fieldName)">
              <q-badge
                :color="getScoreColor(metricsMap.get(q.fieldName)!.score)"
                :label="metricsMap.get(q.fieldName)!.score + '/10'"
                dense
              />
            </template>
            <span v-else class="text-grey-6">-</span>
          </div>
        </div>
      </div>

      <q-separator dark class="q-my-sm" />

      <!-- Composite calculation -->
      <div class="text-caption text-grey-5">
        Composite {{ formulaDisplay }}
      </div>
    </template>


    <!-- Generic metrics row -->
    <template v-if="patent.eligibilityScore != null || patent.validityScore != null">
      <q-separator dark class="q-my-sm" />
      <div class="row q-gutter-xs">
        <q-badge v-if="patent.eligibilityScore != null" color="grey-8" dense>
          Elig: {{ patent.eligibilityScore }}
        </q-badge>
        <q-badge v-if="patent.validityScore != null" color="grey-8" dense>
          Valid: {{ patent.validityScore }}
        </q-badge>
        <q-badge v-if="patent.enforcementClarity != null" color="grey-8" dense>
          Enf: {{ patent.enforcementClarity }}
        </q-badge>
        <q-badge v-if="patent.claimBreadth != null" color="grey-8" dense>
          Breadth: {{ patent.claimBreadth }}
        </q-badge>
        <q-badge v-if="patent.designAroundDifficulty != null" color="grey-8" dense>
          DA: {{ patent.designAroundDifficulty }}
        </q-badge>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tooltip-content {
  padding: 14px;
  min-width: 400px;
  max-width: 550px;
  max-height: 700px;
  overflow-y: auto;
  font-size: 0.95em;
}

.tooltip-title {
  line-height: 1.3;
  max-height: 2.6em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.question-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.95em;
  padding: 2px 0;
}

.question-name {
  flex: 1;
  color: #ddd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.question-weight {
  min-width: 32px;
  text-align: right;
  font-size: 0.85em;
}

.question-score {
  min-width: 45px;
  text-align: right;
}
</style>
