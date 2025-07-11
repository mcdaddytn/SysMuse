import { route } from 'quasar/wrappers';
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from 'vue-router';

import routes from './routes';
import { authService } from 'src/services/auth';

export default route(function (/* { store, ssrContext } */) {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : (process.env.VUE_ROUTER_MODE === 'history' ? createWebHistory : createWebHashHistory);

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Leave this as is and make changes in quasar.config.js instead!
    // quasar.config.js -> build -> vueRouterMode
    // quasar.config.js -> build -> publicPath
    history: createHistory(process.env.VUE_ROUTER_BASE),
  });

  // Add authentication guard
  Router.beforeEach(async (to, from, next) => {
    // Skip auth check for login page
    if (to.name === 'login') {
      return next();
    }

    // Check if user is authenticated
    const isAuthenticated = await authService.isAuthenticated();
    
    if (isAuthenticated) {
      next();
    } else {
      console.log('Router guard: User not authenticated, redirecting to login');
      next({ name: 'login' });
    }
  });

  return Router;
});
