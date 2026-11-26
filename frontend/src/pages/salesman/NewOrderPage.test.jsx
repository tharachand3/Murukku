import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../../app/registry.js';
import { RegistryProvider } from '../../app/RegistryContext.jsx';
import { QueuePanel } from '../../components/salesman/QueuePanel.jsx';
import { AuthProvider } from '../../context/AuthContext.jsx';
import { ToastProvider } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { createMockAdapter, mockNetworkError } from '../../test/mockAdapter.js';
import { enqueue, flush, list } from '../../lib/orderQueue.js';
import NewOrderPage from './NewOrderPage.jsx';

const customers = [
  { id: 1, name: 'Retailer A', type: 'RETAILER', stateCode: '33' },
  { id: 2, name: 'Distributor B', type: 'DISTRIBUTOR', stateCode: '29' }
];
const catalogItems = [
  { itemId: 10, code: 'MURUKKU', name: 'Murukku', pricePaise: 5000, priceSource: 'DEFAULT' },
  { itemId: 11, code: 'CHIPS', name: 'Banana chips', pricePaise: 3500, priceSource: 'DEFAULT' }
];
const availability = [
  { itemId: 10, name: 'Murukku', availablePackets: 88 },
  { itemId: 11, name: 'Banana chips', availablePackets: 500 }
];
const salesman = { id: 3, name: 'Salesman A', email: 'salesman.a@demo.com', role: 'SALESMAN' };

function installRoutes(overrides = {}) {
  const adapter = createMockAdapter({
    'GET /customers': { status: 200, data: customers },
    'GET /catalog/order-items': { status: 200, data: catalogItems },
    'GET /stock/finished-availability': { status: 200, data: availability },
    'POST /orders': {
      status: 201,
      data: { duplicate: false, order: { id: 1, orderNo: 'ORD/2026-27/0001' } }
    },
    ...overrides
  });
  api.defaults.adapter = adapter;
  return adapter;
}

function renderWithProviders(page = <NewOrderPage />) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={createRegistry()}>
            {page}
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

async function chooseCustomer(label = 'Retailer A (RETAILER)') {
  const input = await screen.findByLabelText('Customer');
  fireEvent.change(input, { target: { value: label } });
  await screen.findByText('Murukku');
}

async function setQuantity(name, value) {
  fireEvent.change(screen.getByRole('textbox', { name: `${name} quantity` }), {
    target: { value: String(value) }
  });
}

describe('NewOrderPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
    installRoutes();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the assigned customers and customer-priced finished catalog', async () => {
    const adapter = installRoutes({
      'GET /catalog/order-items': {
        status: 200,
        data: [{ ...catalogItems[0], pricePaise: 4800, priceSource: 'CUSTOMER' }]
      }
    });
    renderWithProviders();
    await chooseCustomer();

    expect(await screen.findByText('Rs 48.00')).toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/customers')).toBe(true);
    expect(adapter.calls.find((call) => call.url === '/catalog/order-items').params.customerId).toBe(1);
    expect(adapter.calls.some((call) => call.url === '/items')).toBe(false);
  });

  it('shows Rs 7,500.00 for 150 Murukku packets at 5000 paise each', async () => {
    renderWithProviders();
    await chooseCustomer();
    await setQuantity('Murukku', 150);

    expect(screen.getByText('Rs 7,500.00')).toBeInTheDocument();
    expect(screen.getByText('1 lines · 150 packets')).toBeInTheDocument();
  });

  it('shows only finished catalog items and never requests stock summary', async () => {
    const adapter = installRoutes({
      'GET /catalog/order-items': {
        status: 200,
        data: [
          catalogItems[0],
          { itemId: 20, name: 'Raw flour', type: 'RAW', pricePaise: 4200 }
        ]
      }
    });
    renderWithProviders();
    await chooseCustomer();

    expect(screen.getByText('Murukku')).toBeInTheDocument();
    expect(screen.queryByText('Raw flour')).not.toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/stock/summary')).toBe(false);
    expect(adapter.calls.some((call) => call.url === '/stock/finished-availability')).toBe(true);
  });

  it('preselects the only assigned customer', async () => {
    installRoutes({
      'GET /customers': { status: 200, data: [customers[0]] }
    });
    renderWithProviders();
    expect(await screen.findByLabelText('Customer')).toHaveValue('Retailer A (RETAILER)');
    expect(await screen.findByText('Murukku')).toBeInTheDocument();
  });

  it('keeps submit disabled without a customer or a positive quantity', async () => {
    renderWithProviders();
    await screen.findByLabelText('Customer');
    expect(screen.getByRole('button', { name: 'Submit order' })).toBeDisabled();
    await chooseCustomer();
    expect(screen.getByRole('button', { name: 'Submit order' })).toBeDisabled();
    await setQuantity('Murukku', 1);
    expect(screen.getByRole('button', { name: 'Submit order' })).toBeEnabled();
  });

  it('submits the clientRef and only lines with a positive quantity', async () => {
    const adapter = installRoutes();
    renderWithProviders();
    await chooseCustomer();
    await setQuantity('Murukku', 2);
    await setQuantity('Banana chips', 0);
    fireEvent.click(screen.getByRole('button', { name: 'Submit order' }));

    await screen.findByText('ORD/2026-27/0001');
    const request = adapter.calls.find((call) => call.method === 'post' && call.url === '/orders');
    expect(request.data.clientRef).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(request.data).toMatchObject({
      customerId: 1,
      lines: [{ itemId: 10, qty: 2 }]
    });
    expect(request.data.lines).toHaveLength(1);
  });

  it('shows the server order number in the successful confirmation', async () => {
    renderWithProviders();
    await chooseCustomer();
    await setQuantity('Murukku', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Submit order' }));

    expect(await screen.findByText('ORD/2026-27/0001')).toBeInTheDocument();
    expect(screen.getByText('Taxable total: Rs 50.00')).toBeInTheDocument();
    expect(screen.getByText('GST is added when the invoice is raised')).toBeInTheDocument();
  });

  it('queues a network-failed order locally and shows the offline confirmation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-26T12:00:00.000Z'));
    const adapter = installRoutes({ 'POST /orders': () => mockNetworkError() });
    renderWithProviders();
    await chooseCustomer();
    await setQuantity('Murukku', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Submit order' }));

    expect(await screen.findByText(/Saved offline - it will be sent when you are back online/)).toBeInTheDocument();
    const queued = JSON.parse(localStorage.getItem('oda.orderQueue'));
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      customerId: 1,
      customerName: 'Retailer A',
      lines: [{ itemId: 10, name: 'Murukku', qty: 1 }],
      state: 'PENDING'
    });
    expect(adapter.calls.filter((call) => call.method === 'post')).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a server 422 error and does not enqueue the order', async () => {
    installRoutes({
      'POST /orders': {
        status: 422,
        data: { error: { code: 'NO_PRICE', message: 'No price for this customer' } }
      }
    });
    renderWithProviders();
    await chooseCustomer();
    await setQuantity('Murukku', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Submit order' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No price for this customer');
    expect(localStorage.getItem('oda.orderQueue')).toBeNull();
  });

  it('sends one request when submit is tapped twice', async () => {
    let finish;
    const adapter = installRoutes({
      'POST /orders': () => new Promise((resolve) => {
        finish = () => resolve({
          status: 201,
          data: { order: { id: 1, orderNo: 'ORD/2026-27/0001' } }
        });
      })
    });
    renderWithProviders();
    await chooseCustomer();
    await setQuantity('Murukku', 1);
    const submit = screen.getByRole('button', { name: 'Submit order' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(finish).toBeTypeOf('function'));
    finish();
    expect(await screen.findByText('ORD/2026-27/0001')).toBeInTheDocument();
    expect(adapter.calls.filter((call) => call.method === 'post')).toHaveLength(1);
  });

  it('shows a low-stock hint without blocking order submission', async () => {
    const adapter = installRoutes();
    renderWithProviders();
    await chooseCustomer();
    await setQuantity('Murukku', 89);

    expect(screen.getByText('Low stock: 88 free')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Submit order' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByText('ORD/2026-27/0001')).toBeInTheDocument();
    expect(adapter.calls.some((call) => call.method === 'post')).toBe(true);
  });

  it('Send now flushes a queued order and clears it from the panel', async () => {
    const queuedStorage = enqueue({
      clientRef: 'ref-panel-001',
      customerId: 1,
      customerName: 'Retailer A',
      lines: [{ itemId: 10, name: 'Murukku', qty: 3 }]
    }, localStorage, new Date('2026-11-26T12:00:00.000Z'));
    const adapter = installRoutes();

    function QueueHarness() {
      const [items, setItems] = useState(list());
      const queue = {
        items,
        pendingCount: items.filter((item) => item.state === 'PENDING').length,
        failedCount: items.filter((item) => item.state === 'FAILED').length,
        flushing: false,
        error: null,
        refresh: () => setItems(list()),
        flush: async () => {
          const result = await flush(api);
          setItems(list());
          return result;
        }
      };
      return <QueuePanel queue={queue} />;
    }

    renderWithProviders(<QueueHarness />);
    expect(queuedStorage.clientRef).toBe('ref-panel-001');
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(screen.queryByText('Retailer A')).not.toBeInTheDocument());
    expect(adapter.calls.filter((call) => call.method === 'post')).toHaveLength(1);
    expect(list()).toEqual([]);
  });
});
