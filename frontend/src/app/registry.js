import { ROLES } from '../config/roles.js';
import HomePage from '../pages/HomePage.jsx';
import { setDefaultRegistry } from './RegistryContext.jsx';

const GROUP_ORDER = ['Orders', 'Sales', 'Production', 'Inventory', 'Accounts', 'Reports', 'Admin'];

export function createRegistry() {
  const definitions = [];

  function register(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new TypeError('A route definition is required');
    }
    const { path, component, roles, title, nav = null, homeFor = [] } = definition;
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError('Route path must start with /');
    }
    if (definitions.some((route) => route.path === path)) {
      throw new Error(`Duplicate route path: ${path}`);
    }
    if (!component) {
      throw new TypeError('Route component is required');
    }
    if (typeof title !== 'string' || !title.trim()) {
      throw new TypeError('Route title is required');
    }
    if (!Array.isArray(roles) || roles.length === 0 || roles.some((role) => !ROLES.includes(role))) {
      throw new TypeError('Route roles must be a non-empty subset of ROLES');
    }
    if (!Array.isArray(homeFor) || homeFor.some((role) => !roles.includes(role))) {
      throw new TypeError('homeFor roles must be included in route roles');
    }
    if (nav !== null && (!nav || typeof nav !== 'object' || typeof nav.label !== 'string'
      || typeof nav.group !== 'string')) {
      throw new TypeError('Navigation requires label and group');
    }

    const route = {
      ...definition,
      path,
      component,
      roles: [...roles],
      title: title.trim(),
      nav: nav ? { ...nav, order: nav.order ?? 100 } : null,
      homeFor: [...homeFor]
    };
    definitions.push(route);
    return route;
  }

  function routes() {
    return [...definitions];
  }

  function routesForRole(role) {
    return definitions.filter((route) => route.roles.includes(role));
  }

  function navForRole(role) {
    return routesForRole(role)
      .filter((route) => route.nav)
      .sort((left, right) => {
        const leftGroup = GROUP_ORDER.indexOf(left.nav.group);
        const rightGroup = GROUP_ORDER.indexOf(right.nav.group);
        const groupOrder = (leftGroup === -1 ? GROUP_ORDER.length : leftGroup)
          - (rightGroup === -1 ? GROUP_ORDER.length : rightGroup);
        return groupOrder
          || left.nav.order - right.nav.order
          || left.nav.label.localeCompare(right.nav.label);
      });
  }

  function homePathFor(role) {
    return routesForRole(role).find((route) => route.homeFor.includes(role))?.path ?? '/home';
  }

  return { register, routes, routesForRole, navForRole, homePathFor };
}

export const registry = createRegistry();
setDefaultRegistry(registry);

export function registerRoute(definition) {
  return registry.register(definition);
}

// Append new pages below this line (import + registerRoute). Never reorder.
registerRoute({
  path: '/home',
  component: HomePage,
  roles: ROLES,
  title: 'Home',
  nav: { label: 'Home', group: 'Orders', order: 0, mobile: true },
  homeFor: ROLES
});

import NewOrderPage from '../pages/salesman/NewOrderPage.jsx';

registerRoute({
  path: '/new-order',
  component: NewOrderPage,
  roles: ['SALESMAN'],
  title: 'New order',
  nav: { label: 'New order', group: 'Orders', order: 10, mobile: true },
  homeFor: ['SALESMAN']
});

import MyOrdersPage from '../pages/salesman/MyOrdersPage.jsx';

registerRoute({
  path: '/my-orders',
  component: MyOrdersPage,
  roles: ['SALESMAN'],
  title: 'My orders',
  nav: { label: 'My orders', group: 'Orders', order: 20, mobile: true }
});

import MyOrderDetailPage from '../pages/salesman/MyOrderDetailPage.jsx';

registerRoute({
  path: '/my-orders/:id',
  component: MyOrderDetailPage,
  roles: ['SALESMAN'],
  title: 'Order details',
  nav: null
});

import MySalesPage from '../pages/salesman/MySalesPage.jsx';

registerRoute({
  path: '/my-sales',
  component: MySalesPage,
  roles: ['SALESMAN'],
  title: 'My sales',
  nav: { label: 'My sales', group: 'Orders', order: 30, mobile: true }
});
