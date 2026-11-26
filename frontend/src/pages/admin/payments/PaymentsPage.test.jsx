import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminTestProviders, prepareAdminTest } from '../../../test/adminPageHelpers.jsx';
import PaymentsPage from './PaymentsPage.jsx';

const CUSTOMERS = [
  { id: 10, name: 'Retailer A', type: 'RETAILER' },
  { id: 11, name: 'Distributor B', type: 'DISTRIBUTOR' }
];

function payment(overrides = {}) {
  return {
    id: 44,
    receiptNo: 'RCT/2026-27/0001',
    customer: { id: 10, name: 'Retailer A', type: 'RETAILER' },
    invoice: { id: 7, invoiceNo: 'INV/2026-27/0001' },
    amountPaise: 400000,
    paymentDate: '2026-11-26T10:00:00.000Z',
    mode: 'UPI',
    reference: 'UPI-7788',
    ...overrides
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderPayments(routes = {}) {
  const adapter = prepareAdminTest({
    routes: {
      'GET /customers': { status: 200, data: CUSTOMERS },
      'GET /payments': {
        status: 200,
        data: {
          items: [payment()],
          page: 1,
          limit: 20,
          total: 1,
          totalAmountPaise: 400000,
          totalAmountDisplay: 'Rs 4,000.00'
        }
      },
      ...routes
    }
  }).adapter;
  render(
    <MemoryRouter initialEntries={['/payments']}>
      <AdminTestProviders>
        <LocationProbe />
        <PaymentsPage />
      </AdminTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('PaymentsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows filtered-set total and applies mode, customer and date filters', async () => {
    const adapter = renderPayments();
    expect(await screen.findByText('RCT/2026-27/0001')).toBeInTheDocument();
    expect(screen.getByText('Total for filtered payments: Rs 4,000.00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Payment mode'), { target: { value: 'UPI' } });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Retailer A' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.method === 'get' && call.url === '/payments'))
        .toHaveLength(2);
    });
    expect(adapter.calls.filter((call) => call.method === 'get' && call.url === '/payments')[1].params)
      .toMatchObject({
        mode: 'UPI',
        customerId: '10',
        from: '2026-11-01',
        to: '2026-11-26'
      });
    expect(new URLSearchParams(screen.getByTestId('location-search').textContent).get('mode'))
      .toBe('UPI');
  });

  it('shows a zero total with the empty state when no payments match', async () => {
    renderPayments({
      'GET /payments': {
        status: 200,
        data: {
          items: [],
          page: 1,
          limit: 20,
          total: 0,
          totalAmountPaise: 0,
          totalAmountDisplay: 'Rs 0.00'
        }
      }
    });
    expect(await screen.findByText('No payments found')).toBeInTheDocument();
    expect(screen.getByText('Total for filtered payments: Rs 0.00')).toBeInTheDocument();
  });
});
