<!-- src/pages/LoginPage.vue -->
<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>
      <q-page class="flex flex-center">
    <q-card class="q-pa-lg" style="min-width: 400px">
      <q-card-section>
        <div class="text-h4 text-center q-mb-md">Matter Tracker</div>
        <div class="text-h6 text-center q-mb-lg">Login</div>
        
        <q-form @submit="login" class="q-gutter-md">
          <q-input
            v-model="email"
            type="email"
            label="Email"
            filled
            :rules="[val => !!val || 'Email is required']"
            autocomplete="email"
          />
          
          <q-input
            v-model="password"
            type="password"
            label="Password"
            filled
            :rules="[val => !!val || 'Password is required']"
            autocomplete="current-password"
          />
          
          <q-btn
            type="submit"
            color="primary"
            label="Login"
            class="full-width"
            :loading="loading"
          />
        </q-form>
      </q-card-section>
      
      <q-card-section class="text-center">
        <div class="text-caption">
          Demo Credentials:
        </div>
        <div class="text-body2 q-mt-sm">
          <strong>Admin:</strong> sarah.johnson@firm.com / password123<br>
          <strong>Manager:</strong> michael.chen@firm.com / password123<br>
          <strong>User:</strong> emily.rodriguez@firm.com / password123<br>
          <strong>User:</strong> david.thompson@firm.com / password123<br>
          <strong>User:</strong> jessica.williams@firm.com / password123
        </div>
      </q-card-section>
    </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { authService } from 'src/services/auth';
import type { LoginRequest } from 'src/types/models';

const router = useRouter();
const $q = useQuasar();

const email = ref('');
const password = ref('');
const loading = ref(false);

async function login() {
  loading.value = true;
  
  try {
    const loginData: LoginRequest = {
      email: email.value,
      password: password.value
    };
    
    const user = await authService.login(loginData);
    
    $q.notify({
      type: 'positive',
      message: `Welcome back, ${user.name}!`
    });
    
    // Redirect to timesheet page
    router.push('/');
    
  } catch (error: any) {
    console.error('Login failed:', error);
    
    const errorMessage = error.response?.data?.error || 'Login failed. Please try again.';
    
    $q.notify({
      type: 'negative',
      message: errorMessage
    });
  } finally {
    loading.value = false;
  }
}
</script>