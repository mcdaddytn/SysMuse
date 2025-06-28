<!-- quasar.conf.js (configuration file) -->
<script lang="javascript">
module.exports = function (ctx) {
  return {
    supportTS: {
      tsCheckerConfig: {
        eslint: {
          enabled: true,
          files: './src/**/*.{ts,tsx,js,jsx,vue}',
        },
      },
    },

    boot: [],

    css: ['app.scss'],

    extras: [
      'material-icons',
      'mdi-v6',
      'fontawesome-v6',
    ],

    build: {
      vueRouterMode: 'history',

      env: {
        API_URL: ctx.dev
          ? 'http://localhost:3000/api'
          : 'https://your-production-api.com/api',
      },
    },

    devServer: {
      server: {
        type: 'http',
      },
      port: 8080,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },

    framework: {
      plugins: ['Notify', 'Dialog', 'Loading'],
      config: {
        dark: false,
      },
    },
  };
};
</script>