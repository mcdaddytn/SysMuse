<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const email = ref('');
const password = ref('');
const loading = ref(false);

async function login() {
  loading.value = true;
  // TODO: Implement actual login
  setTimeout(() => {
    loading.value = false;
    router.push('/');
  }, 500);
}
</script>

<template>
  <q-page class="flex flex-center">
    <q-card style="min-width: 350px">
      <q-card-section class="bg-primary text-white">
        <div class="text-h6">Patent Portfolio Workstation</div>
        <div class="text-subtitle2">Sign in to continue</div>
      </q-card-section>

      <q-card-section>
        <q-form @submit="login">
          <q-input
            v-model="email"
            label="Email"
            type="email"
            outlined
            class="q-mb-md"
          />
          <q-input
            v-model="password"
            label="Password"
            type="password"
            outlined
            class="q-mb-md"
          />
          <q-btn
            type="submit"
            color="primary"
            label="Login"
            :loading="loading"
            class="full-width"
          />
        </q-form>
      </q-card-section>

      <q-card-section class="text-grey-6 text-caption">
        Demo credentials: demo@example.com / demo123
      </q-card-section>
    </q-card>
  </q-page>
</template>
