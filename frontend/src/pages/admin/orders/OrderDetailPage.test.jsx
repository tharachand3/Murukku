import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../../../app/registry.js';
import { RegistryProvider } from '../../../app/RegistryContext.jsx';
import { AuthProvider } from '../../../context/AuthContext.jsx';
import { ToastProvider } from '../../../context/ToastContext.jsx';
import { api } from '../../../lib/api.js';
import { saveSession } from '../../../lib/session.js';
import { createMockAdapter } from '../../../test/mockAdapter.js';
import { expectStableAcrossRefresh, expectStableTyping } from '../../../test/remountGuard.js';
import OrderDetailPage from './OrderDetailPage.jsx';

const ADMIN = { id: 1, name: 'Admin User', email: 'admin@demo.com', role: 'ADMIN' };

function RefreshingOrderDetail() {
  const [, setRefreshTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setRefreshTick((tick) => tick + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);
  return <OrderDetailPage />;
}

function order(status = 'SUBMITTED', customerName = 'Retailer A', overrides = {}) {
  const qty = customerName === 'Retailer A' ? 150 : 120;
  const totalPaise = qty * 5000;
  return {
    id: customerName === 'Retailer A' ? 21 : 22,
    orderNo: customerName === 'Retailer A' ? 'ORD/2026-27/0001' : 'ORD/2026-27/0002',
    status,
    statusLabel: status,
    customer: { id: customerName === 'Retailer A' ? 10 : 11, name: customerName },
    salesman: { id: 7, name: 'Salesman A' },
    createdAt: '2026-11-26T10:00:00.000Z',
    rejectReason: null,
    lines: [{
      lineId: 31,
      itemId: 5,
      name: 'Murukku 200 g',
      qty,
      qtyDisplay: `${qty} packets`,
      pricePaise: 5000,
      priceDisplay: 'Rs 50.00',
      approvedQty: status === 'SUBMITTED' ? null : qty,
      approvedQtyDisplay: status === 'SUBMITTED' ? null : `${qty} packets`,
      approvedPricePaise: status === 'SUBMITTED' ? null : 5000,
      effectiveQty: qty,
      effectivePricePaise: 5000,
      lineTotalPaise: totalPaise
    }],
    taxableTotalPaise: totalPaise,
    timeline: status === 'APPROVED'
      ? [{ action: 'APPROVE', by: 'Admin User', at: '2026-11-26T11:00:00.000Z' }]
      : [],
    ...overrides
  };
}

function availability(customerName = 'Retailer A') {
  const requestedQty = customerName === 'Retailer A' ? 150 : 120;
  const free = customerName === 'Retailer A' ? 238 : 88;
  const shortBy = Math.max(0, requestedQty - free);
  return {
    orderId: customerName === 'Retailer A' ? 21 : 22,
    orderNo: customerName === 'Retailer A' ? 'ORD/2026-27/0001' : 'ORD/2026-27/0002',
    status: 'SUBMITTED',
    allCovered: shortBy === 0,
    totalShortPackets: shortBy,
    message: shortBy ? `Short by ${shortBy} packets of Murukku 200 g` : 'Stock covers this order',
    lines: [{
      lineId: 31,
      itemId: 5,
      name: 'Murukku 200 g',
      requestedQty,
      effectiveQty: requestedQty,
      onHand: free,
      reservedByOthers: 0,
      free,
      shortBy,
      covered: shortBy === 0
    }]
  };
}

function renderDetail({
  role = 'ADMIN',
  customerName = 'Retailer A',
  routes = {},
  backgroundRefresh = false
} = {}) {
  const user = { ...ADMIN, role };
  const orderId = customerName === 'Retailer A' ? 21 : 22;
  saveSession({ token: 'test-token', user });
  const adapter = createMockAdapter({
    'GET /auth/me': { status: 200, data: { user } },
    [`GET /orders/${orderId}`]: { status: 200, data: order('SUBMITTED', customerName) },
    [`GET /orders/${orderId}/availability`]: { status: 200, data: availability(customerName) },
    ...routes
  });
  api.defaults.adapter = adapter;
  render(
    <MemoryRouter initialEntries={[`/orders/${orderId}`]}>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={createRegistry()}>
            <Routes>
              <Route
                element={backgroundRefresh ? <RefreshingOrderDetail /> : <OrderDetailPage />}
                path="/orders/:id"
              />
            </Routes>
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  return { adapter, orderId };
}

describe('OrderDetailPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows Retailer A as covered from the availability response', async () => {
    renderDetail();
    expect(await screen.findByText('Covered')).toBeInTheDocument();
    expect(screen.getByText('On hand: 238 · Reserved by other approved orders: 0 · Free: 238'))
      .toBeInTheDocument();
  });

  it('shows Distributor B short by 32 packets', async () => {
    renderDetail({ customerName: 'Distributor B' });
    expect(await screen.findByText('Short by 32')).toBeInTheDocument();
    expect(screen.getByText(/Short by 32 packets of Murukku 200 g/)).toBeInTheDocument();
  });

  it('recalculates the approved taxable total when quantity changes', async () => {
    renderDetail();
    const quantity = await screen.findByLabelText('Approved quantity for Murukku 200 g');
    fireEvent.change(quantity, { target: { value: '88' } });
    expect(screen.getByText('Rs 4,400.00')).toBeInTheDocument();
    expect(screen.getByText('Covered')).toBeInTheDocument();
  });

  it('keeps approval quantity and price controls stable while typing', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText('Covered');
    const quantity = screen.getByLabelText('Approved quantity for Murukku 200 g');
    await user.clear(quantity);
    await expectStableTyping(user, () => screen.getByLabelText('Approved quantity for Murukku 200 g'), '88');
    await expectStableTyping(
      user,
      () => screen.getByLabelText('Approved price for Murukku 200 g in rupees'),
      '48'
    );
  });

  it('sends the real approve payload and reloads the updated status', async () => {
    let approved = false;
    const routes = {
      'GET /orders/21': () => ({
        status: 200,
        data: order(approved ? 'APPROVED' : 'SUBMITTED')
      }),
      'POST /orders/21/approve': () => {
        approved = true;
        return { status: 200, data: order('APPROVED') };
      }
    };
    const { adapter } = renderDetail({ routes });
    await screen.findByText('Covered');
    fireEvent.change(screen.getByLabelText('Approved quantity for Murukku 200 g'), {
      target: { value: '88' }
    });
    fireEvent.change(screen.getByLabelText('Approved price for Murukku 200 g in rupees'), {
      target: { value: '48' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));

    await waitFor(() => {
      expect(adapter.calls.find((call) => call.method === 'post' && call.url === '/orders/21/approve'))
        .toBeTruthy();
    });
    const request = adapter.calls.find((call) => call.method === 'post' && call.url === '/orders/21/approve');
    expect(request.data).toEqual({
      lines: [{ lineId: 31, approvedQty: 88, approvedPricePaise: 4800 }]
    });
    expect(await screen.findByText('APPROVED')).toBeInTheDocument();
  });

  it.each([409, 422])('shows stock guidance for INSUFFICIENT_STOCK HTTP %s and sets quantity to free stock', async (status) => {
    const details = availability('Distributor B');
    const { adapter } = renderDetail({
      customerName: 'Distributor B',
      routes: {
        'POST /orders/22/approve': {
          status,
          data: {
            error: {
              code: 'INSUFFICIENT_STOCK',
              message: details.message,
              details
            }
          }
        }
      }
    });
    await screen.findByText('Short by 32');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));

    expect(await screen.findByText(/Approving more than the free stock is refused\. Reduce to 88, reject, or wait for production\./))
      .toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/orders/22/approve')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Set to free stock' }));
    expect(screen.getByLabelText('Approved quantity for Murukku 200 g')).toHaveValue('88');
    expect(screen.getByText('Rs 4,400.00')).toBeInTheDocument();
  });

  it('requires a three-character rejection reason and sends the reason', async () => {
    let updatedOrder;
    const routes = {
      'POST /orders/21/reject': () => {
        updatedOrder = order('REJECTED', 'Retailer A', { rejectReason: 'No stock available' });
        return { status: 200, data: updatedOrder };
      },
      'GET /orders/21': () => ({
        status: 200,
        data: updatedOrder ?? order()
      })
    };
    const { adapter } = renderDetail({ routes });
    await screen.findByText('Covered');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(await screen.findByText('Enter a rejection reason between 3 and 300 characters.'))
      .toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/orders/21/reject')).toBe(false);

    const user = userEvent.setup();
    await expectStableTyping(user, () => screen.getByRole('textbox', { name: 'Reason' }), 'No stock available');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    await waitFor(() => {
      expect(adapter.calls.find((call) => call.url === '/orders/21/reject')?.data)
        .toEqual({ reason: 'No stock available' });
    });
    expect(await screen.findByText('REJECTED')).toBeInTheDocument();
  });

  it('keeps rejection typing stable across a 70-second order-page refresh interval', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDetail({ backgroundRefresh: true });
    await screen.findByText('Covered');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const text = 'No stock available, please review';
    await expectStableAcrossRefresh(
      user,
      () => screen.getByRole('textbox', { name: 'Reason' }),
      text,
      Math.ceil(70000 / text.length)
    );
  });

  it('does not send duplicate approval requests on repeated confirmation clicks', async () => {
    let completeApproval;
    const routes = {
      'POST /orders/21/approve': () => new Promise((resolve) => {
        completeApproval = () => resolve({ status: 200, data: order('APPROVED') });
      })
    };
    const { adapter } = renderDetail({ routes });
    await screen.findByText('Covered');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const confirmButton = screen.getByRole('button', { name: 'Confirm approval' });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.method === 'post' && call.url === '/orders/21/approve'))
        .toHaveLength(1);
    });
    completeApproval();
    expect(await screen.findByText('APPROVED')).toBeInTheDocument();
  });

  it('keeps OWNER read-only and does not show approval or rejection actions', async () => {
    const { adapter } = renderDetail({ role: 'OWNER' });
    expect(await screen.findByText('Covered')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/orders/21/approve')).toBe(false);
  });

  it('does not call the availability endpoint for ACCOUNTANT', async () => {
    const { adapter } = renderDetail({ role: 'ACCOUNTANT' });
    expect(await screen.findByText('Stock availability is restricted to Admin and Owner roles.'))
      .toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/orders/21/availability')).toBe(false);
  });
});
