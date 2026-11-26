import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRegistry } from '../../app/registry.js';
import { RegistryProvider } from '../../app/RegistryContext.jsx';
import { AuthProvider } from '../../context/AuthContext.jsx';
import { ToastProvider } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { createMockAdapter } from '../../test/mockAdapter.js';
import MyOrderDetailPage from './MyOrderDetailPage.jsx';

function detail(status = 'INVOICED', overrides = {}) {
  return {
    id: 1,
    orderNo: 'ORD/2026-27/0001',
    status,
    statusLabel: status,
    customer: { id: 1, name: 'Retailer A' },
    createdAt: '2026-11-25T18:45:00.000Z',
    rejectReason: null,
    lines: [{
      lineId: 1,
      itemId: 10,
      name: 'Murukku',
      qty: 120,
      qtyDisplay: '120 packets',
      pricePaise: 5000,
      approvedQty: 88,
      approvedQtyDisplay: '88 packets',
      approvedPricePaise: 4800,
      lineTotalPaise: 600000
    }],
    taxableTotalPaise: 422400,
    invoice: { id: 4, invoiceNo: 'INV/2026-27/0001', status: 'POSTED', totalPaise: 443520 },
    dispatches: [{ dispatchNo: 'DSP/2026-27/0001', dispatchDate: '2026-11-26T06:00:00.000Z' }],
    timeline: [
      { at: '2026-11-25T18:45:00.000Z', action: 'CREATE', note: null },
      { at: '2026-11-25T19:00:00.000Z', action: 'APPROVE', note: null },
      { at: '2026-11-25T20:00:00.000Z', action: 'INVOICE', note: 'INV/2026-27/0001' },
      { at: '2026-11-26T06:01:00.000Z', action: 'UPDATE', note: null }
    ],
    ...overrides
  };
}

function renderDetail(response) {
  const adapter = createMockAdapter({
    'GET /orders/1': response
  });
  api.defaults.adapter = adapter;
  return render(
    <MemoryRouter initialEntries={['/my-orders/1']}>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={createRegistry()}>
            <Routes>
              <Route element={<MyOrderDetailPage />} path="/my-orders/:id" />
            </Routes>
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('MyOrderDetailPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows a rejected order reason prominently', async () => {
    renderDetail({
      status: 200,
      data: detail('REJECTED', {
        rejectReason: 'Insufficient stock this week',
        invoice: null,
        dispatches: []
      })
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient stock this week');
    expect(screen.getByText('Order rejected')).toBeInTheDocument();
  });

  it('shows requested quantities and a partial approval as Approved 88 of 120', async () => {
    renderDetail({ status: 200, data: detail() });
    expect(await screen.findByText('Approved 88 of 120')).toBeInTheDocument();
    expect(screen.getByText('Approved price: Rs 48.00')).toBeInTheDocument();
    expect(screen.getByText('Rs 50.00')).toBeInTheDocument();
  });

  it.each([
    ['INVOICED', 'Invoiced', 2],
    ['DISPATCHED', 'Dispatched', 3]
  ])('highlights timeline steps through %s', async (status, currentLabel, completedCount) => {
    renderDetail({ status: 200, data: detail(status) });
    await screen.findByText('ORD/2026-27/0001');

    const currentStep = screen.getByText(currentLabel).closest('li');
    expect(currentStep).toHaveAttribute('aria-current', 'step');
    expect(document.querySelectorAll('li[data-complete="true"]')).toHaveLength(completedCount + 1);
  });

  it('shows invoice and dispatch references', async () => {
    renderDetail({ status: 200, data: detail('DISPATCHED') });
    expect(await screen.findByText('INV/2026-27/0001')).toBeInTheDocument();
    expect(screen.getByText(/DSP\/2026-27\/0001/)).toBeInTheDocument();
  });

  it('shows the friendly not-found message when the backend returns 404', async () => {
    renderDetail({
      status: 404,
      data: { error: { code: 'NOT_FOUND', message: 'Order not found' } }
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Order not found');
    expect(screen.getByRole('link', { name: 'Back to my orders' })).toHaveAttribute('href', '/my-orders');
  });
});
