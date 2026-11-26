import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from './App.jsx';
import { registry } from './app/registry.js';
import { RegistryProvider } from './app/RegistryContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { api } from './lib/api.js';
import { saveSession } from './lib/session.js';
import { installMock } from './test/mockAdapter.js';

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={registry}>
            <App />
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('application routes', () => {
  it('sends anonymous root visitors to the sign-in stub', async () => {
    installMock(api, {});
    renderApp('/');
    await waitFor(() => expect(
      screen.getByText('Sign-in screen arrives in step 47')
    ).toBeInTheDocument());
  });

  it('loads the public status page and preserves the health check', async () => {
    installMock(api, {
      'GET /health': { status: 200, data: { status: 'ok' } }
    });
    renderApp('/status');
    await waitFor(() => expect(screen.getByText('API: connected')).toBeInTheDocument());
  });

  it('shows the server error and retries the health request', async () => {
    let attempts = 0;
    const { calls } = installMock(api, {
      'GET /health': () => {
        attempts += 1;
        return attempts === 1
          ? {
            status: 503,
            data: { error: { code: 'UNAVAILABLE', message: 'Health service unavailable' } }
          }
          : { status: 200, data: { status: 'ok' } };
      }
    });
    renderApp('/status');
    await waitFor(() => expect(screen.getByText(/Health service unavailable/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('API: connected')).toBeInTheDocument());
    expect(calls).toHaveLength(2);
  });

  it('redirects an authenticated root visitor to their registered home page', async () => {
    const user = { id: 2, name: 'Owner User', email: 'owner@test', role: 'OWNER' };
    saveSession({ token: 'owner-token', user });
    installMock(api, {
      'GET /auth/me': { status: 200, data: { user } }
    });
    renderApp('/');
    await waitFor(() => expect(screen.getByText('Welcome, Owner User')).toBeInTheDocument());
    expect(screen.getAllByText('Owner')).toHaveLength(2);
  });
});
