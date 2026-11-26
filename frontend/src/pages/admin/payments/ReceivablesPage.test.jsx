import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminTestProviders, prepareAdminTest } from '../../../test/adminPageHelpers.jsx';
import CustomerReceivablesPage from './CustomerReceivablesPage.jsx';
import ReceivablesPage from './ReceivablesPage.jsx';

const summary = {
  items: [
    {
      customer: { id: 10, name: 'Retailer A', type: 'RETAILER' },
      invoicedPaise: 787500,
      paidPaise: 400000,
      outstandingPaise: 387500,
      outstandingDisplay: 'Rs 3,875.00'
    },
    {
      customer: { id: 11, name: 'Distributor B', type: 'DISTRIBUTOR' },
      invoicedPaise: 630000,
      paidPaise: 600000,
      outstandingPaise: 30000,
      outstandingDisplay: 'Rs 300.00'
    }
  ],
  totals: {
    invoicedPaise: 1417500,
    paidPaise: 1000000,
    outstandingPaise: 417500,
    creditPaise: 0
  }
};

const detail = {
  customer: { id: 10, name: 'Retailer A', type: 'RETAILER' },
  invoicedPaise: 787500,
  invoicedDisplay: 'Rs 7,875.00',
  paidPaise: 400000,
  paidDisplay: 'Rs 4,000.00',
  outstandingPaise: 387500,
  outstandingDisplay: 'Rs 3,875.00',
  creditPaise: 0,
  creditDisplay: 'Rs 0.00',
  invoices: [{
    id: 7,
    invoiceNo: 'INV/2026-27/0001',
    issueDate: '2026-11-26T10:00:00.000Z',
    totalPaise: 787500,
    totalDisplay: 'Rs 7,875.00',
    paidPaise: 400000,
    paidDisplay: 'Rs 4,000.00',
    duePaise: 387500,
    dueDisplay: 'Rs 3,875.00',
    status: 'PARTIAL'
  }],
  payments: [{
    id: 44,
    receiptNo: 'RCT/2026-27/0001',
    invoiceNo: 'INV/2026-27/0001',
    amountPaise: 400000,
    paymentDate: '2026-11-26T10:00:00.000Z',
    mode: 'UPI',
    reference: 'UPI-7788'
  }]
};

function renderReceivables({ role = 'ADMIN', routes = {} } = {}) {
  const adapter = prepareAdminTest({
    role,
    routes: {
      'GET /payments/outstanding': { status: 200, data: summary },
      'GET /payments/outstanding/10': { status: 200, data: detail },
      ...routes
    }
  }).adapter;
  render(
    <MemoryRouter initialEntries={['/receivables']}>
      <AdminTestProviders>
        <Routes>
          <Route element={<ReceivablesPage />} path="/receivables" />
          <Route element={<CustomerReceivablesPage />} path="/receivables/:customerId" />
        </Routes>
      </AdminTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('Receivables pages', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('lists Retailer A outstanding largest first and opens the customer view', async () => {
    renderReceivables();
    expect(await screen.findByText('Total outstanding: Rs 4,175.00')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByRole('link', { name: 'Retailer A' })).toBeInTheDocument();
    expect(within(rows[1]).getByText('Rs 3,875.00')).toBeInTheDocument();
    expect(within(rows[2]).getByRole('link', { name: 'Distributor B' })).toBeInTheDocument();
    fireEvent.click(within(rows[1]).getByRole('link', { name: 'Retailer A' }));
    expect(await screen.findByRole('heading', { name: 'Retailer A' })).toBeInTheDocument();
    expect(screen.getByText('PARTIAL')).toBeInTheDocument();
    expect(screen.getByText('RCT/2026-27/0001')).toBeInTheDocument();
    expect(screen.getByText('Credit balance')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByRole('dialog', { name: 'Record payment' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('3875.00')).toBeInTheDocument();
  });

  it('keeps customer payment actions hidden for read-only roles', async () => {
    renderReceivables({ role: 'OWNER' });
    const link = await screen.findByRole('link', { name: 'Retailer A' });
    fireEvent.click(link);
    expect(await screen.findByText('PARTIAL')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });
});
