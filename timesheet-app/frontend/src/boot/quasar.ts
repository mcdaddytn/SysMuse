// src/boot/quasar.ts (for Quasar configuration)

import { Quasar, Notify, Dialog } from 'quasar';

export default {
  config: {
    notify: {
      position: 'top-right',
      timeout: 3000,
      textColor: 'white',
      actions: [{ icon: 'close', color: 'white' }],
    },
  },
  plugins: {
    Notify,
    Dialog,
  },
};

