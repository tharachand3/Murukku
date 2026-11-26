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

import OrdersInboxPage from '../pages/admin/orders/OrdersInboxPage.jsx';

registerRoute({
  path: '/orders',
  component: OrdersInboxPage,
  roles: ['ADMIN', 'OWNER', 'ACCOUNTANT'],
  title: 'Orders',
  nav: { label: 'Orders', group: 'Sales', order: 10, mobile: false },
  homeFor: ['ADMIN']
});

import OrderDetailPage from '../pages/admin/orders/OrderDetailPage.jsx';

registerRoute({
  path: '/orders/:id',
  component: OrderDetailPage,
  roles: ['ADMIN', 'OWNER', 'ACCOUNTANT'],
  title: 'Order details',
  nav: null
});

import ShortagesPage from '../pages/admin/orders/ShortagesPage.jsx';

registerRoute({
  path: '/shortages',
  component: ShortagesPage,
  roles: ['ADMIN', 'OWNER'],
  title: 'Shortages',
  nav: { label: 'Shortages', group: 'Sales', order: 20, mobile: false }
});

import InvoicesPage from '../pages/admin/invoices/InvoicesPage.jsx';

registerRoute({
  path: '/invoices',
  component: InvoicesPage,
  roles: ['ADMIN', 'ACCOUNTANT', 'OWNER'],
  title: 'Invoices',
  nav: { label: 'Invoices', group: 'Sales', order: 30, mobile: false }
});

import InvoiceDetailPage from '../pages/admin/invoices/InvoiceDetailPage.jsx';

registerRoute({
  path: '/invoices/:id',
  component: InvoiceDetailPage,
  roles: ['ADMIN', 'ACCOUNTANT', 'OWNER'],
  title: 'Invoice details',
  nav: null
});

import PaymentsPage from '../pages/admin/payments/PaymentsPage.jsx';

registerRoute({
  path: '/payments',
  component: PaymentsPage,
  roles: ['ADMIN', 'ACCOUNTANT', 'OWNER'],
  title: 'Payments',
  nav: { label: 'Payments', group: 'Accounts', order: 10, mobile: false }
});

import ReceivablesPage from '../pages/admin/payments/ReceivablesPage.jsx';

registerRoute({
  path: '/receivables',
  component: ReceivablesPage,
  roles: ['ADMIN', 'ACCOUNTANT', 'OWNER'],
  title: 'Receivables',
  nav: { label: 'Receivables', group: 'Accounts', order: 20, mobile: false }
});

import CustomerReceivablesPage from '../pages/admin/payments/CustomerReceivablesPage.jsx';

registerRoute({
  path: '/receivables/:customerId',
  component: CustomerReceivablesPage,
  roles: ['ADMIN', 'ACCOUNTANT', 'OWNER'],
  title: 'Customer receivables',
  nav: null
});

import RunsPage from '../pages/production/RunsPage.jsx';

registerRoute({
  path: '/production',
  component: RunsPage,
  roles: ['PRODUCTION', 'ADMIN', 'ACCOUNTANT', 'OWNER'],
  title: 'Production runs',
  nav: { label: 'Production runs', group: 'Production', order: 10, mobile: false },
  homeFor: ['PRODUCTION']
});

import BomsPage from '../pages/production/BomsPage.jsx';

registerRoute({
  path: '/boms',
  component: BomsPage,
  roles: ['PRODUCTION', 'ADMIN', 'ACCOUNTANT', 'OWNER'],
  title: 'Recipes (BOM)',
  nav: { label: 'Recipes (BOM)', group: 'Production', order: 20, mobile: false }
});

import NewRunPage from '../pages/production/NewRunPage.jsx';

registerRoute({
  path: '/production/new',
  component: NewRunPage,
  roles: ['PRODUCTION', 'ADMIN'],
  title: 'New production run',
  nav: null
});

import RunDetailPage from '../pages/production/RunDetailPage.jsx';

registerRoute({
  path: '/production/runs/:id',
  component: RunDetailPage,
  roles: ['PRODUCTION', 'ADMIN', 'ACCOUNTANT', 'OWNER'],
  title: 'Production run details',
  nav: null
});

import StockPage from '../pages/inventory/StockPage.jsx';

registerRoute({
  path: '/stock',
  component: StockPage,
  roles: ['ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER'],
  title: 'Stock',
  nav: { label: 'Stock', group: 'Inventory', order: 10, mobile: false }
});

import StockLedgerPage from '../pages/inventory/StockLedgerPage.jsx';

registerRoute({
  path: '/stock/:itemId',
  component: StockLedgerPage,
  roles: ['ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER'],
  title: 'Stock ledger',
  nav: null
});

import PurchasesPage from '../pages/inventory/PurchasesPage.jsx';

registerRoute({
  path: '/purchases',
  component: PurchasesPage,
  roles: ['ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER'],
  title: 'Purchases',
  nav: { label: 'Purchases', group: 'Inventory', order: 20, mobile: false }
});

import NewPurchasePage from '../pages/inventory/NewPurchasePage.jsx';

registerRoute({
  path: '/purchases/new',
  component: NewPurchasePage,
  roles: ['PRODUCTION', 'ADMIN'],
  title: 'New purchase',
  nav: null
});

import AdjustmentsPage from '../pages/inventory/AdjustmentsPage.jsx';

registerRoute({
  path: '/stock/adjustments',
  component: AdjustmentsPage,
  roles: ['ADMIN', 'PRODUCTION', 'ACCOUNTANT', 'OWNER'],
  title: 'Stock adjustments',
  nav: { label: 'Adjustments', group: 'Inventory', order: 30, mobile: false }
});
