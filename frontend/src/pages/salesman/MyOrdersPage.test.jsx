import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../../app/registry.js';
import { RegistryProvider } from '../../app/RegistryContext.jsx';
import { AuthProvider } from '../../context/AuthContext.jsx';
import { ToastProvider } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { enqueue } from '../../lib/orderQueue.js';
import { createMockAdapter, mockNetworkError } from '../../test/mockAdapter.js';
import MyOrdersPage from './MyOrdersPage.jsx';

const NOW = new Date('2026-11-26T12:00:00+05:30');

function order(overrides = {}) {
  return {
    id: 1,
    orderNo: 'ORD/2026-27/0001',
    status: 'SUBMITTED',
    customerName: 'Retailer A',
    createdAt: '2026-11-25T18:45:00.000Z',
    lineCount: 1,
    totalQty: 150,
    taxableTotalPaise: 750000,
    ...overrides
  };
}

function installRoutes(overrides = {}) {
  const adapter = createMockAdapter({
    'GET /orders': {
      status: 200,
      data: { items: [order()], page: 1, limit: 20, total: 1 }
    },
    'POST /orders': { status: 201, data: { order: { orderNo: 'ORD/2026-27/0002' } } },
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
            <MyOrdersPage now={NOW} />
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('MyOrdersPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
    installRoutes();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists status badges, taxable totals and IST timestamps', async () => {
    installRoutes({
      'GET /orders': {
        status: 200,
        data: {
          items: [
            order(),
            order({ id: 2, orderNo: 'ORD/2026-27/0002', status: 'DISPATCHED', totalQty: 88 })
          ],
          page: 1,
          limit: 20,
          total: 2
        }
      }
    });
    renderPage();

    expect(await screen.findByText('ORD/2026-27/0001')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('Dispatched')).toBeInTheDocument();
    expect(screen.getAllByText('Rs 7,500.00')).toHaveLength(2);
    expect(screen.getAllByText('26-Nov-2026 00:15')).toHaveLength(2);
  });

  it('adds the selected status parameter to the list request', async () => {
    const adapter = installRoutes();
    renderPage();
    await screen.findByText('ORD/2026-27/0001');
    fireEvent.click(screen.getByRole('button', { name: 'Submitted' }));

    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.url === '/orders')).toHaveLength(2);
    });
    expect(adapter.calls[1].params).toMatchObject({ status: 'SUBMITTED', page: 1 });
  });

  it('loads the next API page and appends its results', async () => {
    const adapter = installRoutes({
      'GET /orders': (config) => ({
        status: 200,
        data: config.params.page === 1
          ? { items: [order()], page: 1, limit: 1, total: 2 }
          : { items: [order({ id: 2, orderNo: 'ORD/2026-27/0002', customerName: 'Distributor B' })],
              page: 2, limit: 1, total: 2 }
      })
    });
    renderPage();
    await screen.findByText('ORD/2026-27/0001');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('ORD/2026-27/0002')).toBeInTheDocument();
    expect(screen.getByText('Retailer A')).toBeInTheDocument();
    expect(screen.getByText('Distributor B')).toBeInTheDocument();
    expect(adapter.calls[1].params).toMatchObject({ page: 2, limit: 1 });
  });

  it('shows the empty state and new-order link', async () => {
    installRoutes({
      'GET /orders': { status: 200, data: { items: [], page: 1, limit: 20, total: 0 } }
    });
    renderPage();
    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an order' })).toHaveAttribute('href', '/new-order');
  });

  it('refreshes every 60 seconds only while visible and cleans up on unmount', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const adapter = installRoutes();
    const view = renderPage();
    await waitFor(() => expect(adapter.calls.filter((call) => call.url === '/orders')).toHaveLength(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    await waitFor(() => expect(adapter.calls.filter((call) => call.url === '/orders')).toHaveLength(2));
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(adapter.calls.filter((call) => call.url === '/orders')).toHaveLength(2);
  });

  it('shows QueuePanel only when offline orders exist', async () => {
    const empty = renderPage();
    await screen.findByText('ORD/2026-27/0001');
    expect(screen.queryByRole('region', { name: 'Offline order queue' })).not.toBeInTheDocument();
    empty.unmount();

    enqueue({
      clientRef: 'ref-my-orders-001',
      customerId: 1,
      customerName: 'Retailer A',
      lines: [{ itemId: 10, name: 'Murukku', qty: 3 }]
    }, localStorage, NOW);
    installRoutes({ 'POST /orders': () => mockNetworkError() });
    renderPage();
    expect(await screen.findByRole('region', { name: 'Offline order queue' })).toBeInTheDocument();
    expect(screen.getByText('1 pending · 0 failed')).toBeInTheDocument();
  });
});
