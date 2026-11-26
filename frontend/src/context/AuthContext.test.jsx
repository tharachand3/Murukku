import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../app/registry.js';
import { RegistryProvider } from '../app/RegistryContext.jsx';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { ToastProvider } from './ToastContext.jsx';
import { api } from '../lib/api.js';
import { loadSession, saveSession } from '../lib/session.js';
import { installMock } from '../test/mockAdapter.js';

const user = { id: 8, name: 'Test Admin', email: 'admin@example.test', role: 'ADMIN' };

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <p data-testid="auth-status">{auth.status}</p>
      <p data-testid="auth-notice">{auth.notice ?? ''}</p>
      <button onClick={() => auth.login('admin@example.test', 'secret').catch(() => {})} type="button">
        Login
      </button>
      <button onClick={() => api.get('/protected').catch(() => {})} type="button">Request</button>
      <button onClick={auth.logout} type="button">Logout</button>
    </div>
  );
}

function renderAuth() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={createRegistry()}>
            <AuthProbe />
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('authentication context', () => {
  it('stores the login session, authorizes the next request, and clears on logout', async () => {
    const { calls } = installMock(api, {
      'POST /auth/login': { status: 200, data: { token: 'fresh-token', user } },
      'GET /protected': { status: 200, data: { ok: true } }
    });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'));
    expect(loadSession()).toEqual({ token: 'fresh-token', user });
    fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].headers.Authorization).toBe('Bearer fresh-token');
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(loadSession()).toBeNull();
    expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous');
  });

  it('clears a stored session after /auth/me returns 401', async () => {
    saveSession({ token: 'expired', user });
    installMock(api, {
      'GET /auth/me': { status: 401, data: { error: { code: 'UNAUTHORIZED', message: 'Expired' } } }
    });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous'));
    expect(loadSession()).toBeNull();
  });

  it('logs out with an expiry notice on protected 401 but excludes login 401', async () => {
    saveSession({ token: 'expired', user });
    installMock(api, {
      'GET /auth/me': { status: 200, data: { user } },
      'GET /protected': { status: 401, data: { error: { code: 'UNAUTHORIZED' } } },
      'POST /auth/login': { status: 401, data: { error: { code: 'UNAUTHORIZED' } } }
    });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'));
    fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    await waitFor(() => expect(screen.getByTestId('auth-notice')).toHaveTextContent(
      'Your session expired. Please sign in again.'
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous'));
    expect(screen.getByTestId('auth-notice')).toHaveTextContent(
      'Your session expired. Please sign in again.'
    );
  });

  it('does not set an expired-session notice when login itself returns 401', async () => {
    installMock(api, {
      'POST /auth/login': {
        status: 401,
        data: { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }
      }
    });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous'));
    expect(screen.getByTestId('auth-notice')).toBeEmptyDOMElement();
  });
});
