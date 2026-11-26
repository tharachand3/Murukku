import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../app/registry.js';
import { RegistryProvider } from '../../app/RegistryContext.jsx';
import { ROLES } from '../../config/roles.js';
import { AuthProvider } from '../../context/AuthContext.jsx';
import { ToastProvider } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { saveSession } from '../../lib/session.js';
import { installMock } from '../../test/mockAdapter.js';
import AppShell from './AppShell.jsx';

function Home() {
  return <Outlet />;
}

function renderShell(role) {
  const currentUser = { id: 1, name: 'Test User', role };
  saveSession({ token: `${role}-token`, user: currentUser });
  installMock(api, {
    'GET /auth/me': { status: 200, data: { user: currentUser } }
  });
  const registry = createRegistry();
  registry.register({
    path: '/home',
    component: Home,
    roles: [...ROLES],
    title: 'Home',
    nav: { label: 'Home', group: 'Orders', order: 0, mobile: true },
    homeFor: [...ROLES]
  });
  for (const [path, label, order] of [
    ['/new-order', 'New order', 1],
    ['/my-orders', 'My orders', 2],
    ['/my-sales', 'My sales', 3]
  ]) {
    registry.register({
      path,
      component: Home,
      roles: ['SALESMAN'],
      title: label,
      nav: { label, group: 'Orders', order, mobile: true },
      homeFor: path === '/new-order' ? ['SALESMAN'] : []
    });
  }
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={registry}>
            <Routes>
              <Route element={<AppShell />} path="/">
                <Route element={<p>Home content</p>} path="home" />
              </Route>
            </Routes>
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('role-based app shell', () => {
  it('shows the fixed salesman tab navigation', async () => {
    renderShell('SALESMAN');
    await waitFor(() => expect(screen.getByText('Test User')).toBeInTheDocument());
    const bottomNav = screen.getByRole('navigation', { name: 'Sales navigation' });
    expect(bottomNav).toHaveClass('md:hidden');
    expect(bottomNav.querySelectorAll('a')).toHaveLength(3);
    expect(screen.getByRole('navigation', { name: 'Sales navigation tabs' })).toHaveClass('md:flex');
    expect(screen.getByText('Home content')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Staff navigation' })).not.toBeInTheDocument();
  });

  it('shows the staff sidebar for administrators', async () => {
    renderShell('ADMIN');
    await waitFor(() => expect(screen.getByText('Test User')).toBeInTheDocument());
    expect(screen.getByRole('navigation', { name: 'Staff navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sales navigation' })).not.toBeInTheDocument();
  });
});
