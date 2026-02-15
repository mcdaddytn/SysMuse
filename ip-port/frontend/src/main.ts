import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { Quasar, Notify, Dialog, Loading } from 'quasar';
import router from './router';
import App from './App.vue';

// Quasar styles
import '@quasar/extras/material-icons/material-icons.css';
import 'quasar/dist/quasar.css';

// Global grid scrollbar styles (always-visible on macOS)
import './assets/grid-scrollbars.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(Quasar, {
  plugins: {
    Notify,
    Dialog,
    Loading
  },
  config: {
    notify: {
      position: 'top-right',
      timeout: 3000
    }
  }
});

app.mount('#app');
