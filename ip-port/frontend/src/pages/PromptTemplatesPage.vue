<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  promptTemplateApi,
  focusAreaApi,
  type PromptTemplate,
  type StructuredQuestion,
  type FieldOption,
  type AnswerTypeOption,
  type FocusArea
} from '@/services/api';

// Data
const templates = ref<PromptTemplate[]>([]);
const focusAreas = ref<FocusArea[]>([]);
const answerTypes = ref<AnswerTypeOption[]>([]);
const fieldOptions = ref<FieldOption[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// Selection & editing
const selectedTemplate = ref<PromptTemplate | null>(null);
const editing = ref(false);
const saving = ref(false);

// Filters
const filterObjectType = ref<string | null>(null);
const filterFocusArea = ref<string | null>(null);

const objectTypeOptions = [
  { value: 'patent', label: 'Patent' },
  { value: 'focus_area', label: 'Focus Area' }
];

// Editor form
const form = ref({
  name: '',
  description: '',
  templateType: 'FREE_FORM' as 'FREE_FORM' | 'STRUCTURED',
  objectType: 'patent',
  promptText: '',
  questions: [] as StructuredQuestion[],
  executionMode: 'PER_PATENT' as 'PER_PATENT' | 'COLLECTIVE',
  contextFields: [] as string[],
  llmModel: 'claude-sonnet-4-20250514',
  focusAreaId: null as string | null
});

const llmModelOptions = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-haiku-3-5-20241022', label: 'Claude Haiku 3.5' }
];

const executionModeOptions = [
  { value: 'PER_PATENT', label: 'Per Patent' },
  { value: 'COLLECTIVE', label: 'Collective' }
];

const contextFieldOptions = [
  'patent_title', 'abstract', 'patent_date', 'assignee', 'affiliate',
  'super_sector', 'primary_sector', 'cpc_codes', 'forward_citations',
  'remaining_years', 'score', 'competitor_citations', 'competitor_names',
  'summary', 'technology_category', 'prior_art_problem', 'technical_solution'
];

const answerTypeDefaults: Record<string, Partial<StructuredQuestion['constraints']>> = {
  INTEGER: { min: 1, max: 10 },
  FLOAT: { min: 0, max: 1 },
  TEXT: { maxSentences: 3 },
  TEXT_ARRAY: { maxItems: 5 },
  ENUM: { options: ['Option A', 'Option B'] },
  BOOLEAN: {}
};

// Filtered list
const filteredTemplates = computed(() => {
  return templates.value.filter(t => {
    if (filterObjectType.value && t.objectType !== filterObjectType.value) return false;
    if (filterFocusArea.value === 'none' && t.focusAreaId) return false;
    if (filterFocusArea.value && filterFocusArea.value !== 'none' && t.focusAreaId !== filterFocusArea.value) return false;
    return true;
  });
});

// Validation
const canSave = computed(() => {
  if (!form.value.name.trim()) return false;
  if (form.value.templateType === 'FREE_FORM' && !form.value.promptText?.trim()) return false;
  if (form.value.templateType === 'STRUCTURED' && form.value.questions.length === 0) return false;
  return true;
});

// Load data
async function loadTemplates() {
  loading.value = true;
  try {
    templates.value = await promptTemplateApi.getTemplates();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load templates';
  } finally {
    loading.value = false;
  }
}

async function loadMeta() {
  try {
    const [areas, types, fields] = await Promise.all([
      focusAreaApi.getFocusAreas(),
      promptTemplateApi.getAnswerTypes(),
      promptTemplateApi.getFields('patent')
    ]);
    focusAreas.value = areas;
    answerTypes.value = types;
    fieldOptions.value = fields;
  } catch (err) {
    console.error('Failed to load metadata:', err);
  }
}

// CRUD
function selectTemplate(t: PromptTemplate) {
  selectedTemplate.value = t;
  editing.value = false;
}

function startNew() {
  selectedTemplate.value = null;
  editing.value = true;
  form.value = {
    name: '',
    description: '',
    templateType: 'FREE_FORM',
    objectType: 'patent',
    promptText: '',
    questions: [],
    executionMode: 'PER_PATENT',
    contextFields: [],
    llmModel: 'claude-sonnet-4-20250514',
    focusAreaId: null
  };
}

function startEdit() {
  if (!selectedTemplate.value) return;
  const t = selectedTemplate.value;
  form.value = {
    name: t.name,
    description: t.description || '',
    templateType: t.templateType || 'FREE_FORM',
    objectType: t.objectType || 'patent',
    promptText: t.promptText || '',
    questions: (t.questions as StructuredQuestion[] | null) || [],
    executionMode: t.executionMode,
    contextFields: [...t.contextFields],
    llmModel: t.llmModel,
    focusAreaId: t.focusAreaId || null
  };
  editing.value = true;
}

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  error.value = null;
  try {
    const payload = {
      name: form.value.name,
      description: form.value.description || undefined,
      templateType: form.value.templateType,
      objectType: form.value.objectType,
      promptText: form.value.templateType === 'FREE_FORM' ? form.value.promptText : undefined,
      questions: form.value.templateType === 'STRUCTURED' ? form.value.questions : undefined,
      executionMode: form.value.executionMode,
      contextFields: form.value.contextFields,
      llmModel: form.value.llmModel,
      focusAreaId: form.value.focusAreaId || undefined
    };

    if (selectedTemplate.value) {
      const updated = await promptTemplateApi.updateTemplate(selectedTemplate.value.id, payload);
      const idx = templates.value.findIndex(t => t.id === updated.id);
      if (idx >= 0) templates.value[idx] = updated;
      selectedTemplate.value = updated;
    } else {
      const created = await promptTemplateApi.createTemplate(payload);
      templates.value.unshift(created);
      selectedTemplate.value = created;
    }
    editing.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save template';
  } finally {
    saving.value = false;
  }
}

async function deleteSelected() {
  if (!selectedTemplate.value) return;
  if (!confirm(`Delete template "${selectedTemplate.value.name}"?`)) return;
  try {
    await promptTemplateApi.deleteTemplate(selectedTemplate.value.id);
    templates.value = templates.value.filter(t => t.id !== selectedTemplate.value!.id);
    selectedTemplate.value = null;
    editing.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete template';
  }
}

// Structured questions helpers
function addQuestion() {
  form.value.questions.push({
    fieldName: '',
    question: '',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 10 },
    description: ''
  });
}

function removeQuestion(idx: number) {
  form.value.questions.splice(idx, 1);
}

function onAnswerTypeChange(idx: number) {
  const q = form.value.questions[idx];
  q.constraints = { ...answerTypeDefaults[q.answerType] };
}

function insertVariable(variable: string) {
  form.value.promptText += variable;
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'DRAFT': return 'grey';
    case 'RUNNING': return 'blue';
    case 'COMPLETE': return 'green';
    case 'ERROR': return 'red';
    default: return 'grey';
  }
}

onMounted(() => {
  loadTemplates();
  loadMeta();
});
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div>
        <div class="text-h5">Prompt Templates</div>
        <div class="text-caption text-grey">Reusable LLM prompt templates for patent analysis and scoring</div>
      </div>
      <q-space />
      <q-btn color="primary" icon="add" label="New Template" @click="startNew" />
    </div>

    <!-- Error Banner -->
    <q-banner v-if="error" class="bg-red-1 text-red q-mb-md" rounded>
      {{ error }}
      <template #action>
        <q-btn flat label="Dismiss" @click="error = null" />
      </template>
    </q-banner>

    <div class="row q-col-gutter-md" style="min-height: 600px">
      <!-- Left: Template List -->
      <div class="col-12 col-md-4">
        <!-- Filters -->
        <q-card flat bordered class="q-mb-sm">
          <q-card-section class="q-py-sm">
            <div class="row q-gutter-sm">
              <q-select
                v-model="filterObjectType"
                :options="[{ value: null, label: 'All Types' }, ...objectTypeOptions]"
                emit-value
                map-options
                outlined
                dense
                class="col"
                label="Object Type"
              />
              <q-select
                v-model="filterFocusArea"
                :options="[
                  { value: null, label: 'All' },
                  { value: 'none', label: 'Unbound (Library)' },
                  ...focusAreas.map(fa => ({ value: fa.id, label: fa.name }))
                ]"
                emit-value
                map-options
                outlined
                dense
                class="col"
                label="Focus Area"
              />
            </div>
          </q-card-section>
        </q-card>

        <!-- List -->
        <q-card flat bordered>
          <q-card-section v-if="loading" class="text-center q-pa-lg">
            <q-spinner size="md" />
          </q-card-section>
          <q-list v-else-if="filteredTemplates.length > 0" separator>
            <q-item
              v-for="t in filteredTemplates"
              :key="t.id"
              clickable
              :active="selectedTemplate?.id === t.id"
              active-class="bg-blue-1"
              @click="selectTemplate(t)"
            >
              <q-item-section>
                <q-item-label class="text-weight-medium">{{ t.name }}</q-item-label>
                <q-item-label caption>
                  <q-badge
                    :label="t.templateType === 'STRUCTURED' ? 'Structured' : 'Free-form'"
                    :color="t.templateType === 'STRUCTURED' ? 'purple-2' : 'blue-2'"
                    :text-color="t.templateType === 'STRUCTURED' ? 'purple-9' : 'blue-9'"
                    class="q-mr-xs"
                  />
                  <q-badge
                    :label="t.objectType"
                    color="grey-3"
                    text-color="grey-8"
                    class="q-mr-xs"
                  />
                  <span v-if="t.focusArea">{{ t.focusArea.name }}</span>
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge :color="getStatusColor(t.status)" :label="t.status" />
              </q-item-section>
            </q-item>
          </q-list>
          <q-card-section v-else class="text-center q-pa-lg text-grey-6">
            <q-icon name="auto_awesome" size="2em" />
            <div class="q-mt-sm">No templates{{ filterObjectType || filterFocusArea ? ' match filters' : ' yet' }}</div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Right: Detail / Editor -->
      <div class="col-12 col-md-8">
        <!-- Editor Mode -->
        <q-card v-if="editing" flat bordered>
          <q-card-section class="q-pb-sm">
            <div class="text-subtitle1 text-weight-medium">
              {{ selectedTemplate ? 'Edit Template' : 'New Template' }}
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <!-- Basic Fields -->
            <div class="row q-gutter-sm q-mb-sm">
              <q-input v-model="form.name" label="Name *" outlined dense class="col" />
              <q-select
                v-model="form.templateType"
                :options="[{ value: 'FREE_FORM', label: 'Free-form' }, { value: 'STRUCTURED', label: 'Structured Questions' }]"
                emit-value
                map-options
                outlined
                dense
                label="Template Type"
                class="col-4"
              />
            </div>
            <q-input v-model="form.description" label="Description" outlined dense class="q-mb-sm" />

            <div class="row q-gutter-sm q-mb-sm">
              <q-select
                v-model="form.objectType"
                :options="objectTypeOptions"
                emit-value
                map-options
                outlined
                dense
                label="Object Type"
                class="col"
              />
              <q-select
                v-model="form.executionMode"
                :options="executionModeOptions"
                emit-value
                map-options
                outlined
                dense
                label="Execution Mode"
                class="col"
              />
              <q-select
                v-model="form.llmModel"
                :options="llmModelOptions"
                emit-value
                map-options
                outlined
                dense
                label="Model"
                class="col"
              />
            </div>

            <q-select
              v-model="form.focusAreaId"
              :options="[{ value: null, label: '(None - Library template)' }, ...focusAreas.map(fa => ({ value: fa.id, label: fa.name }))]"
              emit-value
              map-options
              outlined
              dense
              label="Bind to Focus Area (optional)"
              class="q-mb-sm"
            />

            <q-select
              v-model="form.contextFields"
              :options="contextFieldOptions"
              label="Context Fields"
              outlined
              dense
              multiple
              use-chips
              class="q-mb-md"
            />

            <!-- FREE_FORM: Prompt Text -->
            <template v-if="form.templateType === 'FREE_FORM'">
              <div class="text-caption text-weight-medium q-mb-xs">Prompt Text *</div>
              <div class="row q-gutter-xs q-mb-xs">
                <q-chip
                  v-for="f in fieldOptions.slice(0, 10)"
                  :key="f.field"
                  dense
                  clickable
                  size="sm"
                  color="blue-1"
                  text-color="blue-9"
                  @click="insertVariable(f.placeholder)"
                >
                  {{ f.placeholder }}
                </q-chip>
                <q-chip
                  v-if="fieldOptions.length > 10"
                  dense
                  size="sm"
                  color="grey-2"
                >
                  +{{ fieldOptions.length - 10 }} more
                </q-chip>
              </div>
              <q-input
                v-model="form.promptText"
                outlined
                type="textarea"
                rows="12"
                class="prompt-textarea"
                placeholder="Analyze this patent...&#10;&#10;Patent: {patent.patent_id} - {patent.patent_title}&#10;Abstract: {patent.abstract}&#10;&#10;Return JSON: { ... }"
              />
            </template>

            <!-- STRUCTURED: Question Editor -->
            <template v-else>
              <div class="row items-center q-mb-sm">
                <div class="text-caption text-weight-medium">Questions *</div>
                <q-space />
                <q-btn flat dense size="sm" icon="add" label="Add Question" @click="addQuestion" />
              </div>

              <div v-if="form.questions.length === 0" class="text-center q-pa-lg text-grey-5 bg-grey-1 rounded-borders">
                No questions yet. Click "Add Question" to define structured output fields.
              </div>

              <q-card
                v-for="(q, idx) in form.questions"
                :key="idx"
                flat
                bordered
                class="q-mb-sm"
              >
                <q-card-section class="q-py-sm">
                  <div class="row q-gutter-sm">
                    <q-input
                      v-model="q.fieldName"
                      label="Field Name"
                      outlined
                      dense
                      class="col-3"
                      placeholder="e.g., relevance_score"
                      :rules="[v => /^[a-z][a-z0-9_]*$/.test(v) || 'lowercase_snake_case']"
                    />
                    <q-select
                      v-model="q.answerType"
                      :options="answerTypes.length > 0 ? answerTypes.map(a => ({ value: a.value, label: a.label })) : [
                        { value: 'INTEGER', label: 'Integer' },
                        { value: 'FLOAT', label: 'Float' },
                        { value: 'BOOLEAN', label: 'Boolean' },
                        { value: 'TEXT', label: 'Text' },
                        { value: 'ENUM', label: 'Enum' },
                        { value: 'TEXT_ARRAY', label: 'Text Array' }
                      ]"
                      emit-value
                      map-options
                      outlined
                      dense
                      label="Answer Type"
                      class="col-2"
                      @update:model-value="onAnswerTypeChange(idx)"
                    />
                    <q-input
                      v-model="q.question"
                      label="Question"
                      outlined
                      dense
                      class="col"
                      placeholder="e.g., How relevant is this patent to the focus area?"
                    />
                    <q-btn flat dense round icon="delete" color="negative" @click="removeQuestion(idx)" class="self-center" />
                  </div>

                  <!-- Constraints row -->
                  <div class="row q-gutter-sm q-mt-xs">
                    <q-input
                      v-if="q.answerType === 'INTEGER' || q.answerType === 'FLOAT'"
                      v-model.number="q.constraints!.min"
                      label="Min"
                      type="number"
                      outlined
                      dense
                      class="col-2"
                    />
                    <q-input
                      v-if="q.answerType === 'INTEGER' || q.answerType === 'FLOAT'"
                      v-model.number="q.constraints!.max"
                      label="Max"
                      type="number"
                      outlined
                      dense
                      class="col-2"
                    />
                    <q-input
                      v-if="q.answerType === 'TEXT'"
                      v-model.number="q.constraints!.maxSentences"
                      label="Max Sentences"
                      type="number"
                      outlined
                      dense
                      class="col-2"
                    />
                    <q-input
                      v-if="q.answerType === 'TEXT_ARRAY'"
                      v-model.number="q.constraints!.maxItems"
                      label="Max Items"
                      type="number"
                      outlined
                      dense
                      class="col-2"
                    />
                    <q-input
                      v-if="q.answerType === 'ENUM'"
                      :model-value="q.constraints?.options?.join(', ')"
                      @update:model-value="(v: string) => { q.constraints = { ...q.constraints, options: v.split(',').map((s: string) => s.trim()).filter(Boolean) }; }"
                      label="Options (comma-separated)"
                      outlined
                      dense
                      class="col"
                    />
                    <q-input
                      v-model="q.description"
                      label="Description (optional)"
                      outlined
                      dense
                      class="col"
                    />
                  </div>
                </q-card-section>
              </q-card>
            </template>

            <!-- Actions -->
            <div class="row q-mt-md q-gutter-sm">
              <q-btn outline label="Cancel" @click="editing = false" />
              <q-space />
              <q-btn
                v-if="selectedTemplate"
                flat
                color="negative"
                icon="delete"
                label="Delete"
                @click="deleteSelected"
              />
              <q-btn
                color="primary"
                icon="save"
                label="Save"
                :loading="saving"
                :disable="!canSave"
                @click="save"
              />
            </div>
          </q-card-section>
        </q-card>

        <!-- View Mode -->
        <q-card v-else-if="selectedTemplate" flat bordered>
          <q-card-section>
            <div class="row items-center q-mb-sm">
              <div class="text-h6">{{ selectedTemplate.name }}</div>
              <q-space />
              <q-btn flat icon="edit" label="Edit" @click="startEdit" />
            </div>

            <div v-if="selectedTemplate.description" class="text-body2 text-grey-7 q-mb-md">
              {{ selectedTemplate.description }}
            </div>

            <div class="row q-gutter-sm q-mb-md">
              <q-badge
                :label="selectedTemplate.templateType === 'STRUCTURED' ? 'Structured' : 'Free-form'"
                :color="selectedTemplate.templateType === 'STRUCTURED' ? 'purple-2' : 'blue-2'"
                :text-color="selectedTemplate.templateType === 'STRUCTURED' ? 'purple-9' : 'blue-9'"
              />
              <q-badge :label="selectedTemplate.objectType" color="grey-3" text-color="grey-8" />
              <q-badge
                :label="selectedTemplate.executionMode === 'PER_PATENT' ? 'Per Patent' : 'Collective'"
                :color="selectedTemplate.executionMode === 'PER_PATENT' ? 'blue-2' : 'purple-2'"
              />
              <q-badge :label="selectedTemplate.llmModel" color="grey-3" text-color="grey-8" />
              <q-badge :color="getStatusColor(selectedTemplate.status)" :label="selectedTemplate.status" />
              <q-badge
                v-if="selectedTemplate.focusArea"
                :label="selectedTemplate.focusArea.name"
                color="teal-2"
                text-color="teal-9"
              />
            </div>

            <!-- Free-form: show prompt text -->
            <template v-if="selectedTemplate.templateType !== 'STRUCTURED'">
              <div class="text-caption text-weight-medium q-mb-xs">Prompt Text</div>
              <div class="prompt-display q-mb-md">
                <pre class="prompt-text">{{ selectedTemplate.promptText }}</pre>
              </div>
            </template>

            <!-- Structured: show questions -->
            <template v-else-if="selectedTemplate.questions">
              <div class="text-caption text-weight-medium q-mb-xs">
                Questions ({{ (selectedTemplate.questions as StructuredQuestion[]).length }})
              </div>
              <q-list bordered separator class="rounded-borders q-mb-md">
                <q-item v-for="(q, idx) in (selectedTemplate.questions as StructuredQuestion[])" :key="idx">
                  <q-item-section>
                    <q-item-label class="text-weight-medium">
                      {{ q.fieldName }}
                      <q-badge :label="q.answerType" color="grey-3" text-color="grey-8" class="q-ml-xs" />
                    </q-item-label>
                    <q-item-label caption>{{ q.question }}</q-item-label>
                    <q-item-label v-if="q.description" caption class="text-grey-5">{{ q.description }}</q-item-label>
                    <q-item-label v-if="q.constraints && Object.keys(q.constraints).length > 0" caption class="text-blue-grey-5">
                      Constraints: {{ JSON.stringify(q.constraints) }}
                    </q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </template>

            <div v-if="selectedTemplate.contextFields.length > 0" class="q-mb-md">
              <div class="text-caption text-weight-medium q-mb-xs">Context Fields</div>
              <div class="row q-gutter-xs">
                <q-chip v-for="f in selectedTemplate.contextFields" :key="f" dense size="sm" color="grey-2">{{ f }}</q-chip>
              </div>
            </div>

            <!-- Stats -->
            <div v-if="selectedTemplate.lastRunAt" class="text-caption text-grey q-mt-md">
              Last run: {{ new Date(selectedTemplate.lastRunAt).toLocaleString() }}
              | {{ selectedTemplate.completedCount }}/{{ selectedTemplate.totalCount }} complete
            </div>
          </q-card-section>
        </q-card>

        <!-- Empty State -->
        <q-card v-else flat bordered>
          <q-card-section class="text-center q-pa-xl text-grey-5">
            <q-icon name="auto_awesome" size="3em" />
            <div class="q-mt-md text-h6 text-grey-6">Select or create a template</div>
            <div class="text-body2 text-grey-5 q-mt-sm">
              Templates define reusable LLM prompts that can be executed against patents in focus areas.
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<style scoped>
.prompt-display {
  background: #f8f9fa;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
}
.prompt-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.85em;
  line-height: 1.5;
}
.prompt-textarea :deep(textarea) {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.85em;
  line-height: 1.5;
}
</style>
