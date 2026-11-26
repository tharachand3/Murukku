import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../lib/api.js';
import { AdminTestProviders, prepareAdminTest } from '../../../test/adminPageHelpers.jsx';
import InvoicesPage from './InvoicesPage.jsx';

const CUSTOMERS = [
  { id: 10, name: 'Retailer A', type: 'RETAILER' },
  { id: 11, name: 'Distributor B', type: 'DISTRIBUTOR' }
];

function invoice(overrides = {}) {
  return {
    id: 7,
    invoiceNo: 'INV/2026-27/0001',
    issueDate: '2026-11-26T10:00:00.000Z',
    customer: { id: 10, name: 'Retailer A' },
    taxableValuePaise: 750000,
    cgstPaise: 18750,
    sgstPaise: 18750,
    igstPaise: 0,
    totalPaise: 787500,
    status: 'POSTED',
    ...overrides
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderInvoices({ routes = {}, initialPath = '/invoices' } = {}) {
  const adapter = prepareAdminTest({
    routes: {
      'GET /customers': { status: 200, data: CUSTOMERS },
      'GET /invoices': { status: 200, data: { items: [invoice()], page: 1, limit: 20, total: 1 } },
      ...routes
    }
  }).adapter;
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AdminTestProviders>
        <LocationProbe />
        <InvoicesPage />
      </AdminTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('InvoicesPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('lists invoice totals and filters by status, customer, date range and invoice number', async () => {
    const adapter = renderInvoices();
    expect(await screen.findByText('INV/2026-27/0001')).toBeInTheDocument();
    expect(screen.getByText('Rs 7,500.00')).toBeInTheDocument();
    expect(screen.getByText('Rs 375.00')).toBeInTheDocument();
    expect(screen.getByText('Rs 7,875.00')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CANCELLED' } });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Retailer A' } });
    fireEvent.change(screen.getByLabelText('Invoice number'), { target: { value: 'INV/2026-27' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.method === 'get' && call.url === '/invoices'))
        .toHaveLength(2);
    });
    const request = adapter.calls.filter(
      (call) => call.method === 'get' && call.url === '/invoices'
    )[1];
    expect(request.params).toMatchObject({
      status: 'CANCELLED',
      customerId: '10',
      from: '2026-11-01',
      to: '2026-11-26',
      q: 'INV/2026-27'
    });
    expect(new URLSearchParams(screen.getByTestId('location-search').textContent).get('status'))
      .toBe('CANCELLED');
  });

  it('paginates using server page metadata', async () => {
    const adapter = renderInvoices({
      routes: {
        'GET /invoices': (config) => ({
          status: 200,
          data: config.params.page === 1
            ? { items: [invoice()], page: 1, limit: 20, total: 21 }
            : {
                items: [invoice({ id: 8, invoiceNo: 'INV/2026-27/0002' })],
                page: 2,
                limit: 20,
                total: 21
              }
        })
      }
    });
    expect(await screen.findByText('INV/2026-27/0001')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('INV/2026-27/0002')).toBeInTheDocument();
    expect(adapter.calls.filter((call) => call.method === 'get' && call.url === '/invoices')[1].params)
      .toMatchObject({ page: 2, limit: 20 });
  });
});
