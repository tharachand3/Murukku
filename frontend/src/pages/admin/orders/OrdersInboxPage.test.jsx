import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRegistry } from '../../../app/registry.js';
import { RegistryProvider } from '../../../app/RegistryContext.jsx';
import { AuthProvider } from '../../../context/AuthContext.jsx';
import { ToastProvider } from '../../../context/ToastContext.jsx';
import { api } from '../../../lib/api.js';
import { saveSession } from '../../../lib/session.js';
import { createMockAdapter } from '../../../test/mockAdapter.js';
import OrdersInboxPage from './OrdersInboxPage.jsx';

const ADMIN = { id: 1, name: 'Admin User', email: 'admin@demo.com', role: 'ADMIN' };
const CUSTOMERS = [
  { id: 10, name: 'Retailer A', type: 'RETAILER' },
  { id: 11, name: 'Distributor B', type: 'DISTRIBUTOR' }
];

function order(overrides = {}) {
  return {
    id: 21,
    orderNo: 'ORD/2026-27/0001',
    status: 'SUBMITTED',
    statusLabel: 'Submitted',
    customerName: 'Retailer A',
    salesmanName: 'Salesman A',
    createdAt: '2026-11-26T10:00:00.000Z',
    totalQty: 150,
    taxableTotalPaise: 750000,
    ...overrides
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderInbox(routes = {}, initialPath = '/orders') {
  saveSession({ token: 'admin-token', user: ADMIN });
  const adapter = createMockAdapter({
    'GET /auth/me': { status: 200, data: { user: ADMIN } },
    'GET /customers': { status: 200, data: CUSTOMERS },
    'GET /orders': {
      status: 200,
      data: { items: [order()], page: 1, limit: 20, total: 1 }
    },
    ...routes
  });
  api.defaults.adapter = adapter;
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={createRegistry()}>
            <LocationProbe />
            <Routes>
              <Route element={<OrdersInboxPage now={new Date('2026-11-26T12:00:00+05:30')} />} path="/orders" />
            </Routes>
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  return adapter;
}

describe('OrdersInboxPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('requests SUBMITTED orders by default', async () => {
    const adapter = renderInbox();
    expect(await screen.findByText('ORD/2026-27/0001')).toBeInTheDocument();
    await waitFor(() => {
      expect(adapter.calls.find((call) => call.method === 'get' && call.url === '/orders')).toBeTruthy();
    });
    const request = adapter.calls.find((call) => call.method === 'get' && call.url === '/orders');
    expect(request.params).toMatchObject({ status: 'SUBMITTED', page: 1, limit: 20 });
    expect(new URLSearchParams(screen.getByTestId('location-search').textContent).get('status'))
      .toBe('SUBMITTED');
  });

  it('updates the status filter in the URL and sends it to the API', async () => {
    const adapter = renderInbox();
    await screen.findByText('ORD/2026-27/0001');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'APPROVED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.method === 'get' && call.url === '/orders')).toHaveLength(2);
    });
    const request = adapter.calls.filter((call) => call.method === 'get' && call.url === '/orders')[1];
    expect(request.params).toMatchObject({ status: 'APPROVED', page: 1 });
    expect(new URLSearchParams(screen.getByTestId('location-search').textContent).get('status'))
      .toBe('APPROVED');
  });

  it('applies customer, date and salesman filters using the backend query fields', async () => {
    const adapter = renderInbox();
    await screen.findByText('ORD/2026-27/0001');
    fireEvent.change(screen.getByLabelText('Search customer'), { target: { value: 'Retailer A' } });
    fireEvent.change(screen.getByLabelText('Salesman ID'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.method === 'get' && call.url === '/orders')).toHaveLength(2);
    });
    const request = adapter.calls.filter((call) => call.method === 'get' && call.url === '/orders')[1];
    expect(request.params).toMatchObject({
      customerId: '10',
      from: '2026-11-01',
      to: '2026-11-26',
      salesmanId: '7'
    });
    const query = new URLSearchParams(screen.getByTestId('location-search').textContent);
    expect(query.get('customerId')).toBe('10');
    expect(query.get('salesmanId')).toBe('7');
  });

  it('uses the API page values with pagination', async () => {
    const adapter = renderInbox({
      'GET /orders': (config) => ({
        status: 200,
        data: config.params.page === 1
          ? { items: [order()], page: 1, limit: 20, total: 21 }
          : { items: [order({ id: 22, orderNo: 'ORD/2026-27/0002', customerName: 'Distributor B' })],
              page: 2, limit: 20, total: 21 }
      })
    });
    await screen.findByText('ORD/2026-27/0001');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('ORD/2026-27/0002')).toBeInTheDocument();
    expect(adapter.calls.filter((call) => call.method === 'get' && call.url === '/orders')[1].params)
      .toMatchObject({ page: 2, limit: 20 });
  });
});
