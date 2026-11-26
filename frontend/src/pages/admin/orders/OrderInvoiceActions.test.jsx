import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminTestProviders, prepareAdminTest } from '../../../test/adminPageHelpers.jsx';
import OrderInvoiceActions from './OrderInvoiceActions.jsx';

function renderActions({ role = 'ADMIN', order, routes = {} }) {
  const adapter = prepareAdminTest({ role, routes }).adapter;
  render(
    <MemoryRouter initialEntries={['/orders/21']}>
      <AdminTestProviders>
        <Routes>
          <Route
            element={<OrderInvoiceActions order={order} />}
            path="/orders/:id"
          />
          <Route path="/invoices/:id" element={<p>Invoice detail destination</p>} />
        </Routes>
      </AdminTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('OrderInvoiceActions', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('creates an invoice once with the backend payload and navigates to it', async () => {
    let finishCreate;
    const adapter = renderActions({
      order: { id: 21, status: 'APPROVED', invoice: null },
      routes: {
        'POST /invoices': () => new Promise((resolve) => {
          finishCreate = () => resolve({
            status: 201,
            data: { id: 7, invoiceNo: 'INV/2026-27/0001' }
          });
        })
      }
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Create GST invoice' }));
    const confirm = screen.getByRole('button', { name: 'Create invoice' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.method === 'post' && call.url === '/invoices'))
        .toHaveLength(1);
    });
    expect(adapter.calls.find((call) => call.url === '/invoices').data).toEqual({ orderId: 21 });
    finishCreate();
    expect(await screen.findByText('Invoice detail destination')).toBeInTheDocument();
  });

  it('links an already invoiced order to its invoice', async () => {
    renderActions({
      order: {
        id: 21,
        status: 'DISPATCHED',
        invoice: { id: 7, invoiceNo: 'INV/2026-27/0001' }
      }
    });
    expect(await screen.findByRole('link', { name: 'Open invoice INV/2026-27/0001' }))
      .toHaveAttribute('href', '/invoices/7');
  });

  it('does not expose invoice creation to read-only roles', async () => {
    const adapter = renderActions({
      role: 'ACCOUNTANT',
      order: { id: 21, status: 'APPROVED', invoice: null }
    });
    await waitFor(() => {
      expect(adapter.calls.some((call) => call.url === '/auth/me')).toBe(true);
    });
    expect(screen.queryByRole('button', { name: 'Create GST invoice' })).not.toBeInTheDocument();
  });
});
