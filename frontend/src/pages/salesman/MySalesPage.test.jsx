import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRegistry } from '../../app/registry.js';
import { RegistryProvider } from '../../app/RegistryContext.jsx';
import { AuthProvider } from '../../context/AuthContext.jsx';
import { ToastProvider } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { createMockAdapter } from '../../test/mockAdapter.js';
import MySalesPage from './MySalesPage.jsx';

const NOW = new Date('2026-11-26T12:00:00+05:30');
const salesRows = [
  {
    customerId: 1,
    customerName: 'Retailer A',
    orders: 1,
    totalQty: 150,
    taxableValuePaise: 750000,
    lastOrderAt: '2026-11-25T18:45:00.000Z'
  },
  {
    customerId: 2,
    customerName: 'Distributor B',
    orders: 2,
    totalQty: 5,
    taxableValuePaise: 12500,
    lastOrderAt: '2026-11-24T18:45:00.000Z'
  }
];

function installRoutes(overrides = {}) {
  const adapter = createMockAdapter({
    'GET /orders/my/customer-sales': {
      status: 200,
      data: { items: salesRows, totals: { orders: 3, totalQty: 155, taxableValuePaise: 762500 } }
    },
    ...overrides
  });
  api.defaults.adapter = adapter;
  return adapter;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={createRegistry()}>
            <MySalesPage now={NOW} />
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('MySalesPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    installRoutes();
  });

  it('shows customer sales and computes the correct integer-paise totals row', async () => {
    renderPage();
    expect(await screen.findByText('Retailer A')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('Rs 7,500.00')).toBeInTheDocument();
    expect(screen.getByText('155')).toBeInTheDocument();
    expect(screen.getByText('Rs 7,625.00')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('sends the selected financial-year date range', async () => {
    const adapter = installRoutes();
    renderPage();
    await screen.findByText('Retailer A');
    fireEvent.click(screen.getByRole('button', { name: 'This FY' }));

    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.url === '/orders/my/customer-sales')).toHaveLength(2);
    });
    expect(adapter.calls[1].params).toMatchObject({
      from: '2026-04-01',
      to: '2026-11-26'
    });
  });

  it('sends custom from and to dates to the customer-sales endpoint', async () => {
    const adapter = installRoutes();
    renderPage();
    await screen.findByText('Retailer A');
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    let from = await screen.findByLabelText('From');
    fireEvent.change(from, { target: { value: '2026-11-20' } });
    let to = await screen.findByLabelText('To');
    fireEvent.change(to, { target: { value: '2026-11-25' } });

    await waitFor(() => {
      const request = adapter.calls.filter((call) => call.url === '/orders/my/customer-sales').at(-1);
      expect(request.params).toMatchObject({ from: '2026-11-20', to: '2026-11-25' });
    });
  });

  it('shows the empty state when the selected period has no sales', async () => {
    installRoutes({
      'GET /orders/my/customer-sales': {
        status: 200,
        data: { items: [], totals: { orders: 0, totalQty: 0, taxableValuePaise: 0 } }
      }
    });
    renderPage();
    expect(await screen.findByText('No customer sales')).toBeInTheDocument();
  });
});
