import { AdminTestProviders, prepareAdminTest } from './adminPageHelpers.jsx';

export function prepareInventoryTest(options) {
  return prepareAdminTest(options);
}

export function InventoryTestProviders({ children }) {
  return <AdminTestProviders>{children}</AdminTestProviders>;
}
