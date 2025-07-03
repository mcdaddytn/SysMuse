<!-- src/main.ts -->
<script lang="ts">
import { createApp } from 'vue';
import { Quasar, Notify, Dialog, Loading } from 'quasar';
import router from './router';

// Import icon libraries
import '@quasar/extras/material-icons/material-icons.css';

// Import Quasar css
import 'quasar/src/css/index.sass';

// Import your app component
import App from './App.vue';

const app = createApp(App);

app.use(Quasar, {
  plugins: {
    Notify,
    Dialog,
    Loading,
  },
  config: {
    notify: {
      position: 'top-right',
      timeout: 3000,
      textColor: 'white',
      actions: [{ icon: 'close', color: 'white' }],
    },
  },
});

app.use(router);

app.mount('#app');
</script>

<!-- Additional CSS for better styling (add to TimesheetPage.vue or global styles) -->
<style lang="scss">
// Global styles
.q-table {
  .q-table__top,
  .q-table__bottom,
  thead tr:first-child th {
    background-color: $primary;
    color: white;
  }

  tbody tr:hover {
    background-color: rgba(0, 0, 0, 0.03);
  }

  .q-field--filled .q-field__control {
    padding: 0 8px;
  }
}

// Make inputs more compact in table
.timesheet-grid {
  .q-field--dense .q-field__control,
  .q-field--dense .q-field__marginal {
    height: 36px;
  }

  .q-select__dropdown-icon {
    size: 20px;
  }

  td {
    padding: 4px 8px;
  }
}

// Responsive design
@media (max-width: 1200px) {
  .timesheet-container {
    .header-section {
      .row {
        flex-wrap: wrap;
        
        .col-auto {
          margin-bottom: 8px;
        }
      }
    }
  }
}

// Print styles
@media print {
  .header-section button,
  .q-btn[icon="delete"] {
    display: none !important;
  }

  .q-field--filled {
    .q-field__control {
      background: transparent !important;
      border: 1px solid #ddd;
    }
  }
}
</style>

