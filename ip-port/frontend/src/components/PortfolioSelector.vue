<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { usePortfolioStore } from '@/stores/portfolio';

const store = usePortfolioStore();

const emit = defineEmits<{
  change: [portfolioId: string | null];
}>();

// Build grouped options for QSelect
const options = computed(() => {
  const result: Array<{ label: string; value: string; disable?: boolean }> = [];
  for (const group of store.portfoliosByCompany) {
    // Group header (disabled separator)
    result.push({
      label: group.companyName,
      value: `__group__${group.companyId}`,
      disable: true,
    });
    // Portfolio items
    for (const p of group.portfolios) {
      const suffix = p.dataSourceType === 'JSON_PIPELINE' ? ' (ES)' : ` (${p._count?.patents ?? p.patentCount ?? 0})`;
      result.push({
        label: `  ${p.displayName}${suffix}`,
        value: p.id,
      });
    }
  }
  return result;
});

const selectedValue = computed({
  get: () => store.selectedPortfolioId,
  set: (val) => {
    store.selectPortfolio(val);
    emit('change', val);
  },
});

onMounted(async () => {
  await store.refreshIfStale();
});
</script>

<template>
  <q-select
    v-model="selectedValue"
    :options="options.filter(o => !o.disable)"
    outlined
    dense
    emit-value
    map-options
    option-value="value"
    option-label="label"
    label="Portfolio"
    style="min-width: 200px"
    :loading="store.loading"
  >
    <template #option="{ opt, itemProps }">
      <q-item v-if="opt.disable" dense class="text-weight-bold text-caption text-grey-7" style="padding: 4px 12px; min-height: 28px">
        {{ opt.label }}
      </q-item>
      <q-item v-else v-bind="itemProps">
        <q-item-section>
          <q-item-label>{{ opt.label }}</q-item-label>
        </q-item-section>
      </q-item>
    </template>
  </q-select>
</template>
