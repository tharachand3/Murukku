import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminTestProviders, prepareAdminTest } from '../../test/adminPageHelpers.jsx';
import ReportsCatalogPage from './ReportsCatalogPage.jsx';

function renderCatalog({ role = 'ADMIN', catalog = [], extraRoutes = {} } = {}) {
  const adapter = prepareAdminTest({
    role,
    routes: {
      'GET /reports': { status: 200, data: catalog },
      ...extraRoutes
    }
  }).adapter;
  render(
    <MemoryRouter initialEntries={['/reports']}>
      <AdminTestProviders>
        <Routes>
          <Route element={<ReportsCatalogPage />} path="/reports" />
        </Routes>
      </AdminTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('ReportsCatalogPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('renders the backend catalog grouped by its returned group and reports', async () => {
    renderCatalog({
      role: 'PRODUCTION',
      catalog: [
        {
          key: 'production-report',
          title: 'Production report',
          description: 'Run output and variance.',
          group: 'production'
        },
        {
          key: 'stock-summary',
          title: 'Stock summary',
          description: 'Current and period stock.',
          group: 'stock'
        }
      ]
    });

    expect(await screen.findByRole('heading', { name: 'Production' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stock' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Production report' })).toBeInTheDocument();
    const openLinks = screen.getAllByRole('link', { name: 'Open' });
    expect(openLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/reports/production-report',
      '/reports/stock-summary'
    ]);
  });

  it('shows an empty state when the role-filtered catalog has no reports', async () => {
    renderCatalog({ role: 'OWNER', catalog: [] });
    expect(await screen.findByText('No reports are available for your role.')).toBeInTheDocument();
  });

  it('shows a retry action when loading the catalog fails', async () => {
    const adapter = renderCatalog({
      extraRoutes: {
        'GET /reports': { status: 503, data: { error: { message: 'Reports unavailable' } } }
      }
    });
    expect(await screen.findByText('Reports unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.url === '/reports')).toHaveLength(2);
    });
  });
});
