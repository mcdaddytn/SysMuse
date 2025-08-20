<!-- src/pages/PasswordResetPage.vue -->
<template>
  <q-page class="flex flex-center">
    <div class="q-pa-md" style="width: 100%; max-width: 400px;">
      <q-card>
        <q-card-section>
          <div class="text-h5 q-mb-md text-center">Reset Password</div>
          <div class="text-body2 text-grey-6 text-center q-mb-md">
            Change your password for {{ currentUser?.name || 'your account' }}
          </div>
        </q-card-section>

        <q-card-section>
          <q-form @submit="resetPassword" class="q-gutter-md">
            <q-input
              v-model="currentPassword"
              :type="showCurrentPassword ? 'text' : 'password'"
              label="Current Password *"
              filled
              :rules="[val => !!val || 'Current password is required']"
            >
              <template v-slot:append>
                <q-btn
                  :icon="showCurrentPassword ? 'visibility_off' : 'visibility'"
                  flat
                  round
                  dense
                  @click="showCurrentPassword = !showCurrentPassword"
                  :tabindex="-1"
                />
              </template>
            </q-input>

            <q-input
              v-model="newPassword"
              :type="showNewPassword ? 'text' : 'password'"
              label="New Password *"
              filled
              :rules="[
                val => !!val || 'New password is required',
                val => val.length >= 6 || 'Password must be at least 6 characters'
              ]"
            >
              <template v-slot:append>
                <q-btn
                  :icon="showNewPassword ? 'visibility_off' : 'visibility'"
                  flat
                  round
                  dense
                  @click="showNewPassword = !showNewPassword"
                  :tabindex="-1"
                />
              </template>
            </q-input>

            <q-input
              v-model="confirmPassword"
              :type="showConfirmPassword ? 'text' : 'password'"
              label="Confirm New Password *"
              filled
              :rules="[
                val => !!val || 'Please confirm your password',
                val => val === newPassword || 'Passwords do not match'
              ]"
            >
              <template v-slot:append>
                <q-btn
                  :icon="showConfirmPassword ? 'visibility_off' : 'visibility'"
                  flat
                  round
                  dense
                  @click="showConfirmPassword = !showConfirmPassword"
                  :tabindex="-1"
                />
              </template>
            </q-input>

            <div class="q-mt-lg">
              <q-btn
                type="submit"
                color="primary"
                label="Update Password"
                class="full-width"
                :loading="loading"
              />
            </div>
          </q-form>
        </q-card-section>

        <q-card-actions align="center">
          <q-btn
            flat
            label="Cancel"
            @click="goBack"
          />
        </q-card-actions>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { api } from 'src/services/api';
import { authService } from 'src/services/auth';
import type { AuthUser } from 'src/types/models';

const router = useRouter();
const $q = useQuasar();

// State
const currentUser = ref<AuthUser | null>(null);
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const showCurrentPassword = ref(false);
const showNewPassword = ref(false);
const showConfirmPassword = ref(false);
const loading = ref(false);

// Load current user info
async function loadCurrentUser() {
  try {
    currentUser.value = await authService.getCurrentUser();
  } catch (error) {
    console.error('Failed to load current user:', error);
    router.push('/login');
  }
}

// Reset password
async function resetPassword() {
  if (!currentUser.value) return;

  loading.value = true;
  try {
    await api.post('/auth/reset-password', {
      userId: currentUser.value.id,
      currentPassword: currentPassword.value,
      newPassword: newPassword.value
    });

    $q.notify({
      type: 'positive',
      message: 'Password updated successfully'
    });

    // Clear form
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    
    // Redirect back to timesheet
    router.push('/');
  } catch (error: any) {
    console.error('Password reset failed:', error);
    $q.notify({
      type: 'negative',
      message: error.response?.data?.error || 'Failed to update password'
    });
  } finally {
    loading.value = false;
  }
}

// Go back to previous page
function goBack() {
  router.back();
}

onMounted(() => {
  loadCurrentUser();
});
</script>

<style scoped>
.q-card {
  border-radius: 8px;
}
</style>