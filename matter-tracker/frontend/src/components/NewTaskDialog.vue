<!-- src/components/NewTaskDialog.vue -->
<template>
  <q-dialog v-model="dialogVisible" persistent>
    <q-card style="min-width: 400px">
      <q-card-section>
        <div class="text-h6">Add New Task</div>
        <div class="text-subtitle2 text-grey-6">
          {{ matter?.name }} - {{ matter?.client?.name }}
        </div>
      </q-card-section>

      <q-card-section>
        <q-form @submit="onSubmit" class="q-gutter-md">
          <q-input
            v-model="form.description"
            label="Task Description"
            filled
            :rules="[val => !!val || 'Task description is required']"
            autofocus
          />
        </q-form>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn
          label="Cancel"
          flat
          @click="onCancel"
        />
        <q-btn
          label="Add Task"
          color="primary"
          @click="onSubmit"
          :loading="loading"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue';
import { api } from 'src/services/api';
import { Notify } from 'quasar';
import type { Matter, Task } from 'src/types/models';

export default defineComponent({
  name: 'NewTaskDialog',
  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
    matter: {
      type: Object as () => Matter | null,
      default: null,
    },
  },
  emits: ['update:modelValue', 'task-created'],
  setup(props, { emit }) {
    const form = ref({
      description: '',
    });
    const loading = ref(false);

    const dialogVisible = computed({
      get: () => props.modelValue,
      set: (val) => emit('update:modelValue', val),
    });

    function resetForm() {
      form.value = {
        description: '',
      };
    }

    function onCancel() {
      resetForm();
      dialogVisible.value = false;
    }

    async function onSubmit() {
      if (!form.value.description || !props.matter) {
        Notify.create({
          type: 'negative',
          message: 'Please fill in the task description',
        });
        return;
      }

      loading.value = true;
      try {
        const response = await api.post('/timesheets/tasks', {
          matterId: props.matter.id,
          description: form.value.description,
        });

        const newTask: Task = response.data;
        
        emit('task-created', newTask);
        resetForm();
        dialogVisible.value = false;
      } catch (error: any) {
        Notify.create({
          type: 'negative',
          message: error.response?.data?.error || 'Failed to add task',
        });
      } finally {
        loading.value = false;
      }
    }

    // Reset form when dialog opens
    watch(dialogVisible, (newVal) => {
      if (newVal) {
        resetForm();
      }
    });

    return {
      form,
      loading,
      dialogVisible,
      onCancel,
      onSubmit,
    };
  },
});
</script>
