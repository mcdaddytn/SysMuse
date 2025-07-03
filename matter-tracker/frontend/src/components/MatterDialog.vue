
// src/components/MatterDialog.vue

<template>
  <q-dialog v-model="dialogVisible" persistent>
    <q-card style="min-width: 400px">
      <q-card-section>
        <div class="text-h6">Add New Matter</div>
      </q-card-section>

      <q-card-section>
        <q-form @submit="onSubmit" class="q-gutter-md">
          <q-input
            v-model="form.name"
            label="Matter Name"
            filled
            :rules="[val => !!val || 'Matter name is required']"
          />

          <q-input
            v-model="form.description"
            label="Description"
            type="textarea"
            filled
            rows="3"
          />

          <q-input
            v-model="form.clientName"
            label="Client Name"
            filled
            :rules="[val => !!val || 'Client name is required']"
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
          label="Add"
          color="primary"
          @click="onSubmit"
          :loading="loading"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue';
import { api } from 'src/services/api';
import { Notify } from 'quasar';

export default defineComponent({
  name: 'MatterDialog',
  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
  },
  emits: ['update:modelValue', 'matter-added'],
  setup(props, { emit }) {
    const form = ref({
      name: '',
      description: '',
      clientName: '',
    });
    const loading = ref(false);

    const dialogVisible = computed({
      get: () => props.modelValue,
      set: (val) => emit('update:modelValue', val),
    });

    function resetForm() {
      form.value = {
        name: '',
        description: '',
        clientName: '',
      };
    }

    function onCancel() {
      resetForm();
      dialogVisible.value = false;
    }

    async function onSubmit() {
      if (!form.value.name || !form.value.clientName) {
        Notify.create({
          type: 'negative',
          message: 'Please fill in all required fields',
        });
        return;
      }

      loading.value = true;
      try {
        const response = await api.post('/matters', form.value);
        emit('matter-added', response.data);
        Notify.create({
          type: 'positive',
          message: 'Matter added successfully',
        });
        resetForm();
        dialogVisible.value = false;
      } catch (error) {
        Notify.create({
          type: 'negative',
          message: 'Failed to add matter',
        });
      } finally {
        loading.value = false;
      }
    }

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
