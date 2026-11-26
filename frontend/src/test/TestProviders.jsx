import { MemoryRouter } from 'react-router-dom';
import { RegistryProvider } from '../app/RegistryContext.jsx';
import { createRegistry } from '../app/registry.js';
import { AuthProvider } from '../context/AuthContext.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';

export function TestProviders({ children, registry = createRegistry(), initialEntries = ['/'] }) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={registry}>{children}</RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}
