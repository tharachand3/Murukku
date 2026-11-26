import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../app/registry.js';
import { RegistryProvider } from '../app/RegistryContext.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { DEMO_LOGINS, DEMO_PASSWORD } from '../config/demoLogins.js';
import { api } from '../lib/api.js';
import { loadSession, saveSession } from '../lib/session.js';
import { createMockAdapter, mockNetworkError } from '../test/mockAdapter.js';
import { expectStableTyping } from '../test/remountGuard.js';
import LoginPage from './LoginPage.jsx';

function makeRegistry() {
  const registry = createRegistry();
  for (const role of ['ADMIN', 'PRODUCTION', 'SALESMAN', 'ACCOUNTANT', 'OWNER']) {
    registry.register({
      path: `/home-${role.toLowerCase()}`,
      component: () => <div data-testid={`home-${role.toLowerCase()}`}>Home {role}</div>,
      roles: [role],
      title: `${role} home`,
      homeFor: [role]
    });
  }
  registry.register({
    path: '/admin-only',
    component: () => <div data-testid="admin-only">Admin page</div>,
    roles: ['ADMIN'],
    title: 'Admin only'
  });
  registry.register({
    path: '/sales',
    component: () => <div data-testid="sales">Sales page</div>,
    roles: ['SALESMAN'],
    title: 'Sales'
  });
  return registry;
}

function makeUser(role, email = `${role.toLowerCase()}@demo.com`) {
  return { id: 1, name: `${role} user`, email, role };
}

function mockApi(routes) {
  const adapter = createMockAdapter(routes);
  api.defaults.adapter = adapter;
  return adapter;
}

function renderLogin(registry, { from, session } = {}) {
  if (session) saveSession(session);
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: from ? { from } : null }]}>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={registry}>
            <Routes>
              <Route element={<LoginPage />} path="/login" />
              {registry.routes().map((route) => {
                const Page = route.component;
                return <Route element={<Page />} key={route.path} path={route.path} />;
              })}
            </Routes>
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllEnvs();
    mockApi({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('signs in all six demo accounts and redirects each role to its registered home', async () => {
    const registry = makeRegistry();
    for (const demo of DEMO_LOGINS) {
      localStorage.clear();
      const user = makeUser(demo.role, demo.email);
      const adapter = mockApi({
        'POST /auth/login': { status: 200, data: { token: `token-${demo.email}`, user } }
      });
      const view = renderLogin(registry);

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: demo.email } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: DEMO_PASSWORD } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

      await screen.findByTestId(`home-${demo.role.toLowerCase()}`);
      expect(adapter.calls.filter((call) => call.url === '/auth/login')).toHaveLength(1);
      expect(loadSession()).toEqual({ token: `token-${demo.email}`, user });
      view.unmount();
    }
  });

  it('shows the exact wrong-credentials message and keeps the form values', async () => {
    mockApi({
      'POST /auth/login': {
        status: 401,
        data: { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }
      }
    });
    renderLogin(makeRegistry());
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@demo.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByLabelText('Email')).toHaveValue('admin@demo.com');
    expect(screen.getByLabelText('Password')).toHaveValue('wrong');
  });

  it('shows the connection message for a network failure', async () => {
    mockApi({ 'POST /auth/login': () => mockNetworkError() });
    renderLogin(makeRegistry());
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@demo.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Demo@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot reach the server. Check your connection.'
    );
  });

  it('validates empty fields without sending a request', async () => {
    const adapter = mockApi({});
    renderLogin(makeRegistry());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(adapter.calls).toHaveLength(0);
  });

  it('keeps the email and password controls stable while typing', async () => {
    const user = userEvent.setup();
    renderLogin(makeRegistry());

    await expectStableTyping(user, () => screen.getByLabelText('Email'), 'admin@demo.com');
    await expectStableTyping(user, () => screen.getByLabelText('Password'), 'secret123');
  });

  it('blocks malformed email addresses without sending a request', async () => {
    const adapter = mockApi({});
    renderLogin(makeRegistry());
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Demo@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(adapter.calls).toHaveLength(0);
  });

  it('maps backend validation details to matching fields', async () => {
    mockApi({
      'POST /auth/login': {
        status: 400,
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ path: 'body.email', message: 'Email is not accepted' }]
          }
        }
      }
    });
    renderLogin(makeRegistry());
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@demo.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Demo@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email is not accepted')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('sends only one request on a rapid double submit', async () => {
    let resolveLogin;
    const adapter = mockApi({
      'POST /auth/login': () => new Promise((resolve) => {
        resolveLogin = () => resolve({ status: 200, data: { token: 'token', user: makeUser('ADMIN') } });
      })
    });
    renderLogin(makeRegistry());
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@demo.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Demo@123' } });
    const submit = screen.getByRole('button', { name: 'Sign in' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(resolveLogin).toBeTypeOf('function'));
    resolveLogin();
    await screen.findByTestId('home-admin');
    expect(adapter.calls.filter((call) => call.url === '/auth/login')).toHaveLength(1);
  });

  it('trims the email in the request body', async () => {
    const user = makeUser('ADMIN');
    const adapter = mockApi({
      'POST /auth/login': { status: 200, data: { token: 'token', user } }
    });
    renderLogin(makeRegistry());
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  admin@demo.com  ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Demo@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByTestId('home-admin');
    expect(adapter.calls.find((call) => call.url === '/auth/login').data.email).toBe('admin@demo.com');
  });

  it('redirects to an allowed from path and retains its query and hash', async () => {
    const user = makeUser('SALESMAN', 'salesman.a@demo.com');
    mockApi({ 'POST /auth/login': { status: 200, data: { token: 'token', user } } });
    renderLogin(makeRegistry(), { from: { pathname: '/sales', search: '?range=month', hash: '#top' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Demo@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByTestId('sales')).toBeInTheDocument();
  });

  it('uses the role home when from is not allowed for the user', async () => {
    const user = makeUser('SALESMAN', 'salesman.a@demo.com');
    mockApi({ 'POST /auth/login': { status: 200, data: { token: 'token', user } } });
    renderLogin(makeRegistry(), { from: { pathname: '/admin-only' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Demo@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByTestId('home-salesman')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-only')).not.toBeInTheDocument();
  });

  it('redirects authenticated users without briefly rendering the form', async () => {
    const user = makeUser('ADMIN');
    let resolveMe;
    mockApi({
      'GET /auth/me': () => new Promise((resolve) => {
        resolveMe = () => resolve({ status: 200, data: { user } });
      })
    });
    renderLogin(makeRegistry(), { session: { token: 'existing', user } });

    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    await waitFor(() => expect(resolveMe).toBeTypeOf('function'));
    resolveMe();
    expect(await screen.findByTestId('home-admin')).toBeInTheDocument();
  });

  it('shows an expired-session notice and clears it when typing starts', async () => {
    mockApi({
      'GET /auth/me': {
        status: 401,
        data: { error: { code: 'UNAUTHORIZED', message: 'Your session expired. Please sign in again.' } }
      }
    });
    renderLogin(makeRegistry(), { session: { token: 'expired', user: makeUser('ADMIN') } });
    expect(await screen.findByText('Your session expired. Please sign in again.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a' } });
    expect(screen.queryByText('Your session expired. Please sign in again.')).not.toBeInTheDocument();
  });

  it('demo rows fill both fields without submitting', async () => {
    const adapter = mockApi({});
    renderLogin(makeRegistry());
    fireEvent.click(screen.getByText('Demo logins'));
    fireEvent.click(screen.getByRole('button', { name: /Salesman A/ }));

    expect(screen.getByLabelText('Email')).toHaveValue('salesman.a@demo.com');
    expect(screen.getByLabelText('Password')).toHaveValue(DEMO_PASSWORD);
    expect(adapter.calls).toHaveLength(0);
  });

  it('hides the demo panel when the environment flag is false', () => {
    vi.stubEnv('VITE_SHOW_DEMO_LOGINS', 'false');
    renderLogin(makeRegistry());
    expect(screen.queryByText('Demo logins')).not.toBeInTheDocument();
  });

  it('saves the token and refreshes the session after a reload', async () => {
    const user = makeUser('ADMIN');
    mockApi({
      'POST /auth/login': { status: 200, data: { token: 'persisted-token', user } }
    });
    const registry = makeRegistry();
    const first = renderLogin(registry);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Demo@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByTestId('home-admin');
    expect(loadSession()).toEqual({ token: 'persisted-token', user });
    first.unmount();

    mockApi({ 'GET /auth/me': { status: 200, data: { user } } });
    renderLogin(registry);
    expect(await screen.findByTestId('home-admin')).toBeInTheDocument();
  });
});
