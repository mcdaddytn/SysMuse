<template>
  <q-dialog
    v-model="dialogOpen"
    maximized
    persistent
    @escape-key="closeDialog"
  >
    <q-card>
      <q-card-section class="row items-center q-pb-none bg-primary text-white">
        <q-btn
          icon="arrow_back"
          flat
          round
          dense
          @click="closeDialog"
          class="q-mr-sm"
        >
          <q-tooltip>Back to Transcripts</q-tooltip>
        </q-btn>
        <div class="text-h6">Settings</div>
        <q-space />
        <q-btn
          icon="close"
          flat
          round
          dense
          @click="closeDialog"
        >
          <q-tooltip>Close Settings</q-tooltip>
        </q-btn>
      </q-card-section>

      <q-separator />

      <q-card-section class="q-pa-none" style="height: calc(100vh - 100px);">
        <q-splitter v-model="splitterModel" style="height: 100%;">
          <template v-slot:before>
            <q-tabs
              v-model="tab"
              vertical
              class="text-grey-7"
              active-color="primary"
              indicator-color="primary"
            >
              <q-tab name="general" label="General" icon="settings" />
              <q-tab name="llm" label="LLM Summaries" icon="auto_awesome" />
              <q-tab name="accumulators" label="Accumulators" icon="analytics" />
              <q-tab name="export" label="Export" icon="download" />
            </q-tabs>
          </template>

          <template v-slot:after>
            <q-tab-panels
              v-model="tab"
              animated
              swipeable
              vertical
              transition-prev="jump-up"
              transition-next="jump-up"
              class="q-pa-md"
            >
              <q-tab-panel name="general">
                <div class="text-h6 q-mb-md">General Settings</div>
                <q-list>
                  <q-item>
                    <q-item-section>
                      <q-item-label>Theme</q-item-label>
                      <q-item-label caption>Choose application theme</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-select
                        v-model="generalSettings.theme"
                        :options="['light', 'dark', 'auto']"
                        dense
                        outlined
                        style="min-width: 120px"
                      />
                    </q-item-section>
                  </q-item>
                  <q-item>
                    <q-item-section>
                      <q-item-label>Default Summary Type</q-item-label>
                      <q-item-label caption>Initial summary view on load</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-select
                        v-model="generalSettings.defaultSummary"
                        :options="summaryOptions"
                        dense
                        outlined
                        style="min-width: 150px"
                      />
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-tab-panel>

              <q-tab-panel name="llm">
                <div class="text-h6 q-mb-md">LLM Summary Configuration</div>

                <q-expansion-item
                  expand-separator
                  icon="description"
                  label="LLMSummary1 Context Files"
                  header-class="text-primary"
                  class="q-mb-md"
                >
                  <q-card>
                    <q-card-section>
                      <div class="q-mb-md">
                        <div class="row items-center q-mb-sm">
                          <div class="text-weight-medium">Configuration</div>
                          <q-btn
                            flat
                            dense
                            round
                            size="sm"
                            icon="more_horiz"
                            class="q-ml-xs"
                            @click="openContextModal('Configuration', llmConfig, 'llm1')"
                          >
                            <q-tooltip>View full configuration</q-tooltip>
                          </q-btn>
                        </div>
                        <q-input
                          v-model="llmConfig"
                          type="textarea"
                          outlined
                          readonly
                          rows="10"
                          class="code-editor"
                        />
                      </div>

                      <div class="q-mb-md">
                        <div class="row items-center q-mb-sm">
                          <div class="text-weight-medium">Plaintiff Opening Statement</div>
                          <q-btn
                            flat
                            dense
                            round
                            size="sm"
                            icon="more_horiz"
                            class="q-ml-xs"
                            @click="openContextModal('Plaintiff Opening Statement', plaintiffOpeningContext, 'llm1')"
                          >
                            <q-tooltip>View full context</q-tooltip>
                          </q-btn>
                        </div>
                        <q-input
                          v-model="plaintiffOpeningContext"
                          type="textarea"
                          outlined
                          readonly
                          rows="8"
                          class="code-editor"
                        />
                      </div>

                      <div class="q-mb-md">
                        <div class="row items-center q-mb-sm">
                          <div class="text-weight-medium">Plaintiff Closing Statement</div>
                          <q-btn
                            flat
                            dense
                            round
                            size="sm"
                            icon="more_horiz"
                            class="q-ml-xs"
                            @click="openContextModal('Plaintiff Closing Statement', plaintiffClosingContext, 'llm1')"
                          >
                            <q-tooltip>View full context</q-tooltip>
                          </q-btn>
                        </div>
                        <q-input
                          v-model="plaintiffClosingContext"
                          type="textarea"
                          outlined
                          readonly
                          rows="8"
                          class="code-editor"
                        />
                      </div>

                      <div class="q-mb-md">
                        <div class="row items-center q-mb-sm">
                          <div class="text-weight-medium">Defense Opening Statement</div>
                          <q-btn
                            flat
                            dense
                            round
                            size="sm"
                            icon="more_horiz"
                            class="q-ml-xs"
                            @click="openContextModal('Defense Opening Statement', defenseOpeningContext, 'llm1')"
                          >
                            <q-tooltip>View full context</q-tooltip>
                          </q-btn>
                        </div>
                        <q-input
                          v-model="defenseOpeningContext"
                          type="textarea"
                          outlined
                          readonly
                          rows="8"
                          class="code-editor"
                        />
                      </div>

                      <div class="q-mb-md">
                        <div class="row items-center q-mb-sm">
                          <div class="text-weight-medium">Defense Closing Statement</div>
                          <q-btn
                            flat
                            dense
                            round
                            size="sm"
                            icon="more_horiz"
                            class="q-ml-xs"
                            @click="openContextModal('Defense Closing Statement', defenseClosingContext, 'llm1')"
                          >
                            <q-tooltip>View full context</q-tooltip>
                          </q-btn>
                        </div>
                        <q-input
                          v-model="defenseClosingContext"
                          type="textarea"
                          outlined
                          readonly
                          rows="8"
                          class="code-editor"
                        />
                      </div>

                      <q-btn
                        label="Save Changes"
                        color="primary"
                        @click="saveLLMConfig"
                        :disable="true"
                      >
                        <q-tooltip>Editing will be enabled in a future update</q-tooltip>
                      </q-btn>
                    </q-card-section>
                  </q-card>
                </q-expansion-item>

                <q-expansion-item
                  expand-separator
                  icon="description"
                  label="LLMSummary2 Context Files"
                  header-class="text-primary"
                  class="q-mb-md"
                >
                  <q-card>
                    <q-card-section>
                      <div class="q-mb-md">
                        <div class="row items-center q-mb-sm">
                          <div class="text-weight-medium">Configuration</div>
                          <q-btn
                            flat
                            dense
                            round
                            size="sm"
                            icon="more_horiz"
                            class="q-ml-xs"
                            @click="openContextModal('Configuration', llm2Config, 'llm2')"
                          >
                            <q-tooltip>View full configuration</q-tooltip>
                          </q-btn>
                        </div>
                        <q-input
                          v-model="llm2Config"
                          type="textarea"
                          outlined
                          readonly
                          rows="10"
                          class="code-editor"
                        />
                      </div>

                      <div class="q-mb-md">
                        <div class="row items-center q-mb-sm">
                          <div class="text-weight-medium">Plaintiff Opening Statement</div>
                          <q-btn
                            flat
                            dense
                            round
                            size="sm"
                            icon="more_horiz"
                            class="q-ml-xs"
                            @click="openContextModal('Plaintiff Opening Statement', llm2PlaintiffOpeningContext, 'llm2')"
                          >
                            <q-tooltip>View full context</q-tooltip>
                          </q-btn>
                        </div>
                        <q-input
                          v-model="llm2PlaintiffOpeningContext"
                          type="textarea"
                          outlined
                          readonly
                          rows="8"
                          class="code-editor"
                        />
                      </div>

                      <div class="q-mb-md">
                        <div class="row items-center q-mb-sm">
                          <div class="text-weight-medium">Plaintiff Closing Statement</div>
                          <q-btn
                            flat
                            dense
                            round
                            size="sm"
                            icon="more_horiz"
                            class="q-ml-xs"
                            @click="openContextModal('Plaintiff Closing Statement', llm2PlaintiffClosingContext, 'llm2')"
                          >
                            <q-tooltip>View full context</q-tooltip>
                          </q-btn>
                        </div>
                        <q-input
                          v-model="llm2PlaintiffClosingContext"
                          type="textarea"
                          outlined
                          readonly
                          rows="8"
                          class="code-editor"
                        />
                      </div>

                      <div class="q-mb-md">
                        <div class="row items-center q-mb-sm">
                          <div class="text-weight-medium">Defense Opening Statement</div>
                          <q-btn
                            flat
                            dense
                            round
                            size="sm"
                            icon="more_horiz"
                            class="q-ml-xs"
                            @click="openContextModal('Defense Opening Statement', llm2DefenseOpeningContext, 'llm2')"
                          >
                            <q-tooltip>View full context</q-tooltip>
                          </q-btn>
                        </div>
                        <q-input
                          v-model="llm2DefenseOpeningContext"
                          type="textarea"
                          outlined
                          readonly
                          rows="8"
                          class="code-editor"
                        />
                      </div>

                      <div class="q-mb-md">
                        <div class="row items-center q-mb-sm">
                          <div class="text-weight-medium">Defense Closing Statement</div>
                          <q-btn
                            flat
                            dense
                            round
                            size="sm"
                            icon="more_horiz"
                            class="q-ml-xs"
                            @click="openContextModal('Defense Closing Statement', llm2DefenseClosingContext, 'llm2')"
                          >
                            <q-tooltip>View full context</q-tooltip>
                          </q-btn>
                        </div>
                        <q-input
                          v-model="llm2DefenseClosingContext"
                          type="textarea"
                          outlined
                          readonly
                          rows="8"
                          class="code-editor"
                        />
                      </div>

                      <q-btn
                        label="Save Changes"
                        color="primary"
                        @click="saveLLM2Config"
                        :disable="true"
                      >
                        <q-tooltip>Editing will be enabled in a future update</q-tooltip>
                      </q-btn>
                    </q-card-section>
                  </q-card>
                </q-expansion-item>

                <q-expansion-item
                  expand-separator
                  icon="add_circle"
                  label="Create New Summary Profile"
                  header-class="text-primary"
                >
                  <q-card>
                    <q-card-section>
                      <div class="q-mb-md">
                        <q-input
                          v-model="newProfile.name"
                          label="Profile Name"
                          outlined
                          hint="e.g., LLMSummary2"
                        />
                      </div>

                      <div class="q-mb-md">
                        <q-select
                          v-model="newProfile.copyFrom"
                          :options="['LLMSummary1', 'Create from scratch']"
                          label="Copy from existing profile"
                          outlined
                        />
                      </div>

                      <div class="q-mb-md">
                        <q-input
                          v-model="newProfile.description"
                          label="Description"
                          type="textarea"
                          outlined
                          rows="3"
                        />
                      </div>

                      <q-btn
                        label="Create Profile"
                        color="primary"
                        icon="add"
                        @click="createProfile"
                      />
                    </q-card-section>
                  </q-card>
                </q-expansion-item>
              </q-tab-panel>

              <q-tab-panel name="accumulators">
                <div class="text-h6 q-mb-md">Accumulator Configuration</div>

                <q-expansion-item
                  expand-separator
                  icon="gavel"
                  label="Objections Accumulator"
                  header-class="text-primary"
                  class="q-mb-md"
                >
                  <q-card>
                    <q-card-section>
                      <div class="text-weight-medium q-mb-sm">Current Configuration</div>
                      <q-input
                        v-model="objectionsAccumulator"
                        type="textarea"
                        outlined
                        readonly
                        rows="15"
                        class="code-editor"
                      />
                      <q-btn
                        label="Edit Configuration"
                        color="primary"
                        @click="editObjections"
                        :disable="true"
                        class="q-mt-md"
                      >
                        <q-tooltip>Editing will be enabled in a future update</q-tooltip>
                      </q-btn>
                    </q-card-section>
                  </q-card>
                </q-expansion-item>

                <q-expansion-item
                  expand-separator
                  icon="forum"
                  label="Interactions Accumulator"
                  header-class="text-primary"
                >
                  <q-card>
                    <q-card-section>
                      <div class="text-weight-medium q-mb-sm">Current Configuration</div>
                      <q-input
                        v-model="interactionsAccumulator"
                        type="textarea"
                        outlined
                        readonly
                        rows="15"
                        class="code-editor"
                      />
                      <q-btn
                        label="Edit Configuration"
                        color="primary"
                        @click="editInteractions"
                        :disable="true"
                        class="q-mt-md"
                      >
                        <q-tooltip>Editing will be enabled in a future update</q-tooltip>
                      </q-btn>
                    </q-card-section>
                  </q-card>
                </q-expansion-item>
              </q-tab-panel>

              <q-tab-panel name="export">
                <div class="text-h6 q-mb-md">Export Settings</div>
                <q-list>
                  <q-item>
                    <q-item-section>
                      <q-item-label>Default Export Format</q-item-label>
                      <q-item-label caption>Preferred format for exports</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-select
                        v-model="exportSettings.format"
                        :options="['JSON', 'CSV', 'TXT', 'PDF']"
                        dense
                        outlined
                        style="min-width: 120px"
                      />
                    </q-item-section>
                  </q-item>
                  <q-item>
                    <q-item-section>
                      <q-item-label>Include Metadata</q-item-label>
                      <q-item-label caption>Add metadata to exports</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-toggle v-model="exportSettings.includeMetadata" />
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-tab-panel>
            </q-tab-panels>
          </template>
        </q-splitter>
      </q-card-section>

      <q-separator />

      <q-card-actions align="right" class="bg-grey-2">
        <q-btn
          flat
          label="Back to Transcripts"
          icon="arrow_back"
          @click="closeDialog"
        />
        <q-space />
        <q-btn
          flat
          label="Cancel"
          @click="closeDialog"
        />
        <q-btn
          unelevated
          label="Apply Settings"
          color="primary"
          icon="check"
          @click="applySettings"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <!-- Context View Modal -->
  <q-dialog v-model="contextModalOpen">
    <q-card style="width: 900px; max-width: 90vw;">
      <q-card-section class="row items-center q-pb-none bg-primary text-white">
        <div class="text-h6">{{ modalTitle }}</div>
        <q-space />
        <q-btn
          icon="close"
          flat
          round
          dense
          @click="closeContextModal"
        />
      </q-card-section>

      <q-separator />

      <q-card-section class="q-pa-md" style="max-height: 70vh;">
        <q-input
          v-model="modalContent"
          type="textarea"
          outlined
          readonly
          autogrow
          rows="20"
          class="code-editor"
        />
      </q-card-section>

      <q-separator />

      <q-card-actions align="right" class="bg-grey-2">
        <q-btn
          flat
          label="Cancel"
          @click="closeContextModal"
        />
        <q-btn
          unelevated
          label="OK"
          color="primary"
          @click="closeContextModal"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useQuasar } from 'quasar'

interface Props {
  modelValue: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const $q = useQuasar()
const dialogOpen = ref(props.modelValue)
const tab = ref('general')
const splitterModel = ref(20)

const generalSettings = ref({
  theme: 'light',
  defaultSummary: 'abridged'
})

const summaryOptions = ['abridged', 'abridged2', 'fulltext', 'llmsummary1']

const exportSettings = ref({
  format: 'JSON',
  includeMetadata: true
})

const llmConfig = ref('')
const plaintiffOpeningContext = ref('')
const plaintiffClosingContext = ref('')
const defenseOpeningContext = ref('')
const defenseClosingContext = ref('')

const llm2Config = ref('')
const llm2PlaintiffOpeningContext = ref('')
const llm2PlaintiffClosingContext = ref('')
const llm2DefenseOpeningContext = ref('')
const llm2DefenseClosingContext = ref('')

const objectionsAccumulator = ref('')
const interactionsAccumulator = ref('')

const contextModalOpen = ref(false)
const modalTitle = ref('')
const modalContent = ref('')
const modalSource = ref('')

const newProfile = ref({
  name: '',
  copyFrom: 'LLMSummary1',
  description: ''
})

watch(() => props.modelValue, (newVal) => {
  dialogOpen.value = newVal
})

watch(dialogOpen, (newVal) => {
  emit('update:modelValue', newVal)
})

onMounted(async () => {
  // Load LLM configuration
  try {
    const response = await fetch('http://localhost:3001/config/llm-summaries.json')
    if (response.ok) {
      const config = await response.json()
      llmConfig.value = JSON.stringify(config.summaryTypes.LLMSummary1, null, 2)
      llm2Config.value = JSON.stringify(config.summaryTypes.LLMSummary2, null, 2)
    }
  } catch (error) {
    console.error('Failed to load LLM config:', error)
    llmConfig.value = '{\n  "description": "Opening and closing statement strategic analysis",\n  "outputDir": "LLMSummary1",\n  "llmProfile": "claude-sonnet",\n  "outputFormat": "1-2 pages"\n}'
    llm2Config.value = '{\n  "description": "Opening and closing statement strategic analysis with judge context",\n  "outputDir": "LLMSummary2",\n  "llmProfile": "claude-sonnet",\n  "outputFormat": "1-2 pages"\n}'
  }

  // Load LLMSummary1 context templates
  try {
    const [poResponse, pcResponse, doResponse, dcResponse] = await Promise.all([
      fetch('http://localhost:3001/templates/plaintiff-opening-context.txt'),
      fetch('http://localhost:3001/templates/plaintiff-closing-context.txt'),
      fetch('http://localhost:3001/templates/defense-opening-context.txt'),
      fetch('http://localhost:3001/templates/defense-closing-context.txt')
    ])

    if (poResponse.ok) plaintiffOpeningContext.value = await poResponse.text()
    if (pcResponse.ok) plaintiffClosingContext.value = await pcResponse.text()
    if (doResponse.ok) defenseOpeningContext.value = await doResponse.text()
    if (dcResponse.ok) defenseClosingContext.value = await dcResponse.text()
  } catch (error) {
    console.error('Failed to load context templates:', error)
    // Fallback to abbreviated versions if files can't be loaded
    plaintiffOpeningContext.value = `Analyze the plaintiff's opening statement from an intellectual property trial.

ANALYSIS REQUIREMENTS:
1. STRATEGIC POSITIONING: How does the plaintiff frame the case narrative?
2. LEGAL FRAMEWORK: Which legal elements are emphasized?
3. PERSUASIVE TECHNIQUES: Storytelling methods and narrative structure
4. KEY CASE THEORIES: Primary theory of infringement or liability
5. ANTICIPATED DEFENSES: How does the plaintiff preempt defense arguments?
6. JURY PSYCHOLOGY: Appeals to fairness and justice

Provide specific quotes and examples. Focus on strategic choices. Aim for 1-2 pages.`

    plaintiffClosingContext.value = `Analyze the plaintiff's closing statement from an intellectual property trial.

ANALYSIS REQUIREMENTS:
1. EVIDENCE SYNTHESIS: How does the plaintiff connect evidence to legal elements?
2. PROMISE FULFILLMENT: Does the closing deliver on opening statement promises?
3. DEFENSE REBUTTAL: How does the plaintiff address defense arguments?
4. DAMAGES ARGUMENT: How is the damages calculation justified?
5. JURY INSTRUCTIONS APPLICATION: How are specific jury instructions referenced?
6. EMOTIONAL CRESCENDO: What final emotional appeals are made?

Provide specific quotes and examples. Focus on persuasive technique. Aim for 1-2 pages.`

    defenseOpeningContext.value = `Analyze the defense opening statement from an intellectual property trial.

ANALYSIS REQUIREMENTS:
1. DEFENSIVE POSITIONING: How does the defense reframe the plaintiff's narrative?
2. DOUBT CREATION: Where does the defense plant seeds of doubt?
3. TECHNICAL DEFENSES: How are non-infringement arguments previewed?
4. CREDIBILITY ATTACKS: How is the plaintiff's motivation questioned?
5. AFFIRMATIVE DEFENSES: What legitimate business justifications are offered?
6. JURY SYMPATHY: How does the defense connect with jury values?

Provide specific quotes and examples. Focus on strategic choices. Aim for 1-2 pages.`

    defenseClosingContext.value = `Analyze the defense closing statement from an intellectual property trial.

ANALYSIS REQUIREMENTS:
1. BURDEN OF PROOF EXPLOITATION: How does the defense emphasize what plaintiff failed to prove?
2. EVIDENCE DECONSTRUCTION: Which plaintiff evidence is attacked as insufficient?
3. ALTERNATIVE NARRATIVE: What competing story has crystallized during trial?
4. DAMAGES DEMOLITION: How are plaintiff's damages theories attacked?
5. JURY INSTRUCTION LEVERAGE: Which instructions favor the defense?
6. FINAL PERSUASION: What emotional counters to plaintiff's appeals?

Provide specific quotes and examples. Focus on strategic advantages. Aim for 1-2 pages.`
  }

  // Load LLMSummary2 context templates
  try {
    const [llm2PoResponse, llm2PcResponse, llm2DoResponse, llm2DcResponse] = await Promise.all([
      fetch('http://localhost:3001/templates/llm2-plaintiff-opening-context.txt'),
      fetch('http://localhost:3001/templates/llm2-plaintiff-closing-context.txt'),
      fetch('http://localhost:3001/templates/llm2-defense-opening-context.txt'),
      fetch('http://localhost:3001/templates/llm2-defense-closing-context.txt')
    ])

    if (llm2PoResponse.ok) llm2PlaintiffOpeningContext.value = await llm2PoResponse.text()
    if (llm2PcResponse.ok) llm2PlaintiffClosingContext.value = await llm2PcResponse.text()
    if (llm2DoResponse.ok) llm2DefenseOpeningContext.value = await llm2DoResponse.text()
    if (llm2DcResponse.ok) llm2DefenseClosingContext.value = await llm2DcResponse.text()
  } catch (error) {
    console.error('Failed to load LLMSummary2 context templates:', error)
    // Use fallback with {{judgeSummary}} added
    llm2PlaintiffOpeningContext.value = `Analyze the plaintiff's opening statement from an intellectual property trial.

TRIAL CONTEXT:
{{trialSummary}}

JUDGE PROFILE:
{{judgeSummary}}

ANALYSIS REQUIREMENTS:
1. STRATEGIC POSITIONING: How does the plaintiff frame the case narrative?
2. LEGAL FRAMEWORK: Which legal elements are emphasized?
3. PERSUASIVE TECHNIQUES: Storytelling methods and narrative structure
4. KEY CASE THEORIES: Primary theory of infringement or liability
5. ANTICIPATED DEFENSES: How does the plaintiff preempt defense arguments?
6. JURY PSYCHOLOGY: Appeals to fairness and justice

Provide specific quotes and examples. Focus on strategic choices. Aim for 1-2 pages.`

    llm2PlaintiffClosingContext.value = `Analyze the plaintiff's closing statement from an intellectual property trial.

TRIAL CONTEXT:
{{trialSummary}}

JUDGE PROFILE:
{{judgeSummary}}

ANALYSIS REQUIREMENTS:
1. EVIDENCE SYNTHESIS: How does the plaintiff connect evidence to legal elements?
2. PROMISE FULFILLMENT: Does the closing deliver on opening statement promises?
3. DEFENSE REBUTTAL: How does the plaintiff address defense arguments?
4. DAMAGES ARGUMENT: How is the damages calculation justified?
5. JURY INSTRUCTIONS APPLICATION: How are specific jury instructions referenced?
6. EMOTIONAL CRESCENDO: What final emotional appeals are made?

Provide specific quotes and examples. Focus on persuasive technique. Aim for 1-2 pages.`

    llm2DefenseOpeningContext.value = `Analyze the defense opening statement from an intellectual property trial.

TRIAL CONTEXT:
{{trialSummary}}

JUDGE PROFILE:
{{judgeSummary}}

ANALYSIS REQUIREMENTS:
1. DEFENSIVE POSITIONING: How does the defense reframe the plaintiff's narrative?
2. DOUBT CREATION: Where does the defense plant seeds of doubt?
3. TECHNICAL DEFENSES: How are non-infringement arguments previewed?
4. CREDIBILITY ATTACKS: How is the plaintiff's motivation questioned?
5. AFFIRMATIVE DEFENSES: What legitimate business justifications are offered?
6. JURY SYMPATHY: How does the defense connect with jury values?

Provide specific quotes and examples. Focus on strategic choices. Aim for 1-2 pages.`

    llm2DefenseClosingContext.value = `Analyze the defense closing statement from an intellectual property trial.

TRIAL CONTEXT:
{{trialSummary}}

JUDGE PROFILE:
{{judgeSummary}}

ANALYSIS REQUIREMENTS:
1. BURDEN OF PROOF EXPLOITATION: How does the defense emphasize what plaintiff failed to prove?
2. EVIDENCE DECONSTRUCTION: Which plaintiff evidence is attacked as insufficient?
3. ALTERNATIVE NARRATIVE: What competing story has crystallized during trial?
4. DAMAGES DEMOLITION: How are plaintiff's damages theories attacked?
5. JURY INSTRUCTION LEVERAGE: Which instructions favor the defense?
6. FINAL PERSUASION: What emotional counters to plaintiff's appeals?

Provide specific quotes and examples. Focus on strategic advantages. Aim for 1-2 pages.`
  }

  // Mock accumulator configurations
  objectionsAccumulator.value = JSON.stringify({
    "name": "Objections Accumulator",
    "type": "objections",
    "patterns": [
      {
        "pattern": "objection",
        "confidence": 0.9,
        "contextWindow": 5
      },
      {
        "pattern": "I object",
        "confidence": 0.95,
        "contextWindow": 3
      }
    ],
    "rulingPatterns": [
      "sustained",
      "overruled",
      "granted",
      "denied"
    ],
    "aggregation": {
      "groupBy": "speaker",
      "countBy": "ruling",
      "timeWindow": "session"
    }
  }, null, 2)

  interactionsAccumulator.value = JSON.stringify({
    "name": "Interactions Accumulator",
    "type": "interactions",
    "patterns": [
      {
        "type": "judge-attorney",
        "triggers": ["Your Honor", "counsel", "objection"],
        "minExchanges": 2
      },
      {
        "type": "attorney-witness",
        "triggers": ["question", "answer", "testimony"],
        "minExchanges": 3
      }
    ],
    "metrics": {
      "intensity": true,
      "duration": true,
      "speakerChanges": true
    }
  }, null, 2)
})

const openContextModal = (title: string, content: string, source: string) => {
  modalTitle.value = title
  modalContent.value = content
  modalSource.value = source
  contextModalOpen.value = true
}

const closeContextModal = () => {
  contextModalOpen.value = false
}

const saveLLMConfig = () => {
  $q.notify({
    type: 'info',
    message: 'LLM configuration editing will be available in a future update'
  })
}

const saveLLM2Config = () => {
  $q.notify({
    type: 'info',
    message: 'LLMSummary2 configuration editing will be available in a future update'
  })
}

const createProfile = () => {
  if (!newProfile.value.name) {
    $q.notify({
      type: 'warning',
      message: 'Please enter a profile name'
    })
    return
  }

  $q.notify({
    type: 'info',
    message: `Profile creation feature coming soon. Would create: ${newProfile.value.name}`
  })

  // Reset form
  newProfile.value = {
    name: '',
    copyFrom: 'LLMSummary1',
    description: ''
  }
}

const editObjections = () => {
  $q.notify({
    type: 'info',
    message: 'Objections accumulator editing will be available in a future update'
  })
}

const editInteractions = () => {
  $q.notify({
    type: 'info',
    message: 'Interactions accumulator editing will be available in a future update'
  })
}

const closeDialog = () => {
  dialogOpen.value = false
}

const applySettings = () => {
  // Here you would save the settings
  // For now, just show a success message
  $q.notify({
    type: 'positive',
    message: 'Settings applied successfully'
  })
  dialogOpen.value = false
}
</script>

<style scoped>
.code-editor {
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
}

.code-editor :deep(textarea) {
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 1.4;
}
</style>