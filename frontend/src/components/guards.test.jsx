import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../app/registry.js';
import { RegistryProvider } from '../app/RegistryContext.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { saveSession } from '../lib/session.js';
import { api } from '../lib/api.js';
import { installMock } from '../test/mockAdapter.js';
import { RequireAuth, RequireRole } from './guards.jsx';

function LoginTarget() {
  const location = useLocation();
  return <p>Login target {location.state?.from?.pathname}</p>;
}

function renderGuard(initialEntry, { token, role } = {}) {
  if (token) {
    saveSession({ token, user: { id: 1, name: 'User', email: 'user@test', role } });
  }
  installMock(api, {
    'GET /auth/me': { status: 200, data: { user: { id: 1, name: 'User', role } } }
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={createRegistry()}>
            <Routes>
              <Route element={<LoginTarget />} path="/login" />
              <Route
                element={<RequireAuth><p>Protected content</p></RequireAuth>}
                path="/auth-only"
              />
              <Route
                element={<RequireAuth><RequireRole roles={['ADMIN']}><p>Role content</p></RequireRole></RequireAuth>}
                path="/role"
              />
            </Routes>
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('route guards', () => {
  it('redirects anonymous users to login while preserving the original path', async () => {
    renderGuard('/auth-only');
    await waitFor(() => expect(screen.getByText('Login target /auth-only')).toBeInTheDocument());
  });

  it('shows forbidden for the wrong role and content for an allowed role', async () => {
    const wrong = renderGuard('/role', { token: 'sales-token', role: 'SALESMAN' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument());
    wrong.unmount();

    saveSession({ token: 'admin-token', user: { id: 1, role: 'ADMIN' } });
    installMock(api, {
      'GET /auth/me': { status: 200, data: { user: { id: 1, role: 'ADMIN' } } }
    });
    renderGuard('/role', { token: 'admin-token', role: 'ADMIN' });
    await waitFor(() => expect(screen.getByText('Role content')).toBeInTheDocument());
  });
});
