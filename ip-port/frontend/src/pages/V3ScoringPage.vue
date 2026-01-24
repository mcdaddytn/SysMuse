<script setup lang="ts">
import { ref } from 'vue';

const activeTab = ref('my-weights');
</script>

<template>
  <q-page padding>
    <div class="text-h5 q-mb-md">v3 Scoring - Consensus Voting</div>

    <q-tabs v-model="activeTab" class="text-primary q-mb-md">
      <q-tab name="my-weights" label="My Weights" icon="tune" />
      <q-tab name="consensus" label="Consensus View" icon="how_to_vote" />
      <q-tab name="all-users" label="All Users" icon="group" />
    </q-tabs>

    <q-tab-panels v-model="activeTab" animated>
      <q-tab-panel name="my-weights">
        <q-card>
          <q-card-section>
            <div class="text-h6">Your Personal Weight Settings</div>
            <p class="text-grey-6">
              Adjust your weights to see how patents rank according to your preferences.
              Your weights contribute to the overall consensus score.
            </p>
            <!-- Similar sliders as V2 page -->
            <div class="text-grey q-pa-xl text-center">
              Weight sliders and personal ranking view will appear here.
            </div>
          </q-card-section>
        </q-card>
      </q-tab-panel>

      <q-tab-panel name="consensus">
        <q-card>
          <q-card-section>
            <div class="text-h6">Team Consensus Rankings</div>
            <p class="text-grey-6">
              This view shows the aggregated team consensus based on all users' weights.
              Available to Manager and Admin users.
            </p>
            <div class="text-grey q-pa-xl text-center">
              Consensus ranking view will appear here.
            </div>
          </q-card-section>
        </q-card>
      </q-tab-panel>

      <q-tab-panel name="all-users">
        <q-card>
          <q-card-section>
            <div class="text-h6">All Users' Weights (Admin Only)</div>
            <p class="text-grey-6">
              View and compare how different team members have set their weights.
            </p>
            <div class="text-grey q-pa-xl text-center">
              User weights comparison view will appear here.
            </div>
          </q-card-section>
        </q-card>
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>
