import { AuthProvider } from '../context/AuthContext.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { RegistryProvider } from '../app/RegistryContext.jsx';
import { createRegistry } from '../app/registry.js';
import { api } from '../lib/api.js';
import { saveSession } from '../lib/session.js';
import { createMockAdapter } from './mockAdapter.js';

export function prepareProductionTest({ role = 'PRODUCTION', routes = {} } = {}) {
  const user = {
    id: 2,
    name: 'Production User',
    email: `${role.toLowerCase()}@demo.com`,
    role
  };
  saveSession({ token: 'step52-test-token', user });
  const adapter = createMockAdapter({
    'GET /auth/me': { status: 200, data: { user } },
    ...routes
  });
  api.defaults.adapter = adapter;
  return { adapter, user };
}

export function ProductionTestProviders({ children }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <RegistryProvider value={createRegistry()}>{children}</RegistryProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
