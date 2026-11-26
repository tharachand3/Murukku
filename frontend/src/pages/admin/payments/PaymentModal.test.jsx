import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminTestProviders, prepareAdminTest } from '../../../test/adminPageHelpers.jsx';
import { PaymentModal } from './PaymentModal.jsx';

function renderPaymentModal(routes = {}, duePaise = 387500) {
  const adapter = prepareAdminTest({ routes }).adapter;
  render(
    <MemoryRouter>
      <AdminTestProviders>
        <PaymentModal
          customerId={10}
          duePaise={duePaise}
          invoiceId={7}
          onClose={() => {}}
          open
        />
      </AdminTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('PaymentModal', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('prefills the due and sends a rupee amount as integer paise', async () => {
    const adapter = renderPaymentModal({
      'POST /payments': {
        status: 201,
        data: { payment: { receiptNo: 'RCT/2026-27/0002' } }
      }
    }, 487500);
    expect(await screen.findByDisplayValue('4875.00')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /Amount \(Rs\)/ }), {
      target: { value: '4000' }
    });
    fireEvent.change(screen.getByLabelText('Payment mode'), { target: { value: 'UPI' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Reference/ }), {
      target: { value: 'UPI-7788' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
    await waitFor(() => {
      expect(adapter.calls.find((call) => call.method === 'post' && call.url === '/payments')?.data)
        .toEqual({
          customerId: 10,
          invoiceId: 7,
          amountPaise: 400000,
          mode: 'UPI',
          reference: 'UPI-7788'
        });
    });
  });

  it('blocks UPI payment without a reference before sending', async () => {
    const adapter = renderPaymentModal();
    await screen.findByDisplayValue('3875.00');
    fireEvent.change(screen.getByLabelText('Payment mode'), { target: { value: 'UPI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
    expect(await screen.findByText('Enter a reference of at least 3 characters for this mode.'))
      .toBeInTheDocument();
    expect(adapter.calls.some((call) => call.method === 'post' && call.url === '/payments'))
      .toBe(false);
  });

  it('shows the server due amount for an OVERPAYMENT response', async () => {
    const adapter = renderPaymentModal({
      'POST /payments': {
        status: 422,
        data: {
          error: {
            code: 'OVERPAYMENT',
            message: 'Payment exceeds the outstanding amount',
            details: { dueSoFarPaise: 300000 }
          }
        }
      }
    });
    await screen.findByDisplayValue('3875.00');
    fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
    expect(await screen.findByText(
      'Payment exceeds the outstanding amount. Current due: Rs 3,000.00.'
    )).toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/payments')).toBe(true);
  });

  it('does not send a duplicate payment while the first request is pending', async () => {
    let finishPayment;
    const adapter = renderPaymentModal({
      'POST /payments': () => new Promise((resolve) => {
        finishPayment = () => resolve({
          status: 201,
          data: { payment: { receiptNo: 'RCT/2026-27/0002' } }
        });
      })
    });
    await screen.findByDisplayValue('3875.00');
    const dialog = screen.getByRole('dialog', { name: 'Record payment' });
    const submit = within(dialog).getByRole('button', { name: 'Save payment' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.method === 'post' && call.url === '/payments'))
        .toHaveLength(1);
    });
    finishPayment();
  });
});
