import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminTestProviders, prepareAdminTest } from '../../../test/adminPageHelpers.jsx';
import { expectStableTyping } from '../../../test/remountGuard.js';
import InvoiceDetailPage from './InvoiceDetailPage.jsx';

function invoice(overrides = {}) {
  return {
    id: 7,
    invoiceNo: 'INV/2026-27/0001',
    financialYear: '2026-27',
    orderId: 21,
    order: { id: 21, orderNo: 'ORD/2026-27/0001' },
    customerId: 10,
    customer: {
      id: 10,
      name: 'Retailer A',
      gstin: '33ABCDE1234F1Z5',
      stateCode: '33',
      stateName: 'Tamil Nadu',
      address: 'Trichy'
    },
    snapshot: {
      seller: {
        name: 'Sri Murugan Snacks',
        gstin: '33ABCDE1234F1Z5',
        stateCode: '33',
        address: 'Factory'
      },
      buyer: {
        name: 'Retailer A',
        gstin: '33ABCDE1234F1Z5',
        stateCode: '33',
        stateName: 'Tamil Nadu',
        address: 'Trichy'
      },
      orderNo: 'ORD/2026-27/0001'
    },
    issueDate: '2026-11-26T10:00:00.000Z',
    placeOfSupplyStateCode: '33',
    isInterState: false,
    taxableValuePaise: 750000,
    cgstPaise: 18750,
    sgstPaise: 18750,
    igstPaise: 0,
    totalPaise: 787500,
    totalDisplay: 'Rs 7,875.00',
    status: 'POSTED',
    cancelledAt: null,
    cancelReason: null,
    creditNote: null,
    lines: [{
      id: 1,
      itemId: 5,
      description: 'Murukku 200 g',
      hsnCode: '21069099',
      qty: 150,
      qtyDisplay: '150 packets',
      ratePaise: 5000,
      taxableValuePaise: 750000,
      gstRateBp: 500,
      cgstPaise: 18750,
      sgstPaise: 18750,
      igstPaise: 0,
      totalPaise: 787500
    }],
    ...overrides
  };
}

function dispatchStatus(lines = [{
  itemId: 5,
  name: 'Murukku 200 g',
  invoicedQty: 150,
  dispatchedQty: 0,
  remainingQty: 150,
  display: '150 packets'
}]) {
  return { invoiceId: 7, invoiceNo: 'INV/2026-27/0001', fullyDispatched: false, lines };
}

function customerOutstanding(overrides = {}) {
  return {
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
      paidPaise: 400000,
      duePaise: 387500,
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
    }],
    ...overrides
  };
}

function renderInvoicePage({
  role = 'ADMIN',
  invoiceData = invoice(),
  dispatchData = dispatchStatus(),
  outstandingData = customerOutstanding(),
  routes = {}
} = {}) {
  let currentInvoice = invoiceData;
  const defaultRoutes = {
    'GET /invoices/7': () => ({ status: 200, data: currentInvoice }),
    'GET /invoices/7/dispatch-status': { status: 200, data: dispatchData },
    'GET /payments/outstanding/10': { status: 200, data: outstandingData }
  };
  const adapter = prepareAdminTest({
    role,
    routes: { ...defaultRoutes, ...routes }
  }).adapter;
  render(
    <MemoryRouter initialEntries={['/invoices/7']}>
      <AdminTestProviders>
        <Routes>
          <Route element={<InvoiceDetailPage />} path="/invoices/:id" />
        </Routes>
      </AdminTestProviders>
    </MemoryRouter>
  );
  return {
    adapter,
    setCurrentInvoice: (value) => { currentInvoice = value; }
  };
}

describe('InvoiceDetailPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows benchmark taxable value, CGST, SGST and total', async () => {
    renderInvoicePage();
    expect(await screen.findByText('INV/2026-27/0001')).toBeInTheDocument();
    expect(screen.getAllByText('Rs 7,500.00')).toHaveLength(2);
    expect(screen.getAllByText('Rs 187.50')).toHaveLength(4);
    expect(screen.getByText('Rs 7,875.00')).toBeInTheDocument();
    expect(screen.getAllByText('GSTIN: 33ABCDE1234F1Z5')).toHaveLength(2);
    expect(screen.getByText(/CGST \+ SGST/)).toBeInTheDocument();
  });

  it('shows only IGST tax fields for an inter-state invoice', async () => {
    renderInvoicePage({
      invoiceData: invoice({
        isInterState: true,
        placeOfSupplyStateCode: '29',
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 37500,
        lines: [{
          ...invoice().lines[0],
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 37500
        }]
      })
    });
    expect(await screen.findByText('INV/2026-27/0001')).toBeInTheDocument();
    expect(screen.getAllByText('IGST')).toHaveLength(2);
    expect(screen.queryByText('CGST')).not.toBeInTheDocument();
    expect(screen.queryByText('SGST')).not.toBeInTheDocument();
    expect(screen.getAllByText('Rs 375.00')).toHaveLength(2);
  });

  it('downloads the PDF as an authenticated blob with the server filename', async () => {
    const createObjectURL = vi.fn(() => 'blob:invoice-file');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    let downloadName = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      downloadName = this.download;
    });
    const blob = new Blob(['pdf-bytes'], { type: 'application/pdf' });
    const { adapter } = renderInvoicePage({
      routes: {
        'GET /invoices/7/pdf': {
          status: 200,
          data: blob,
          headers: { 'content-disposition': 'attachment; filename="INV-2026-27-0001.pdf"' }
        }
      }
    });
    await screen.findByText('INV/2026-27/0001');
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(downloadName).toBe('INV-2026-27-0001.pdf'));
    const request = adapter.calls.find((call) => call.url === '/invoices/7/pdf');
    expect(request.headers.Authorization).toBe('Bearer step51-test-token');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:invoice-file');
  });

  it('shows all share actions and the link expiry', async () => {
    renderInvoicePage({
      routes: {
        'GET /invoices/7/share': {
          status: 200,
          data: {
            invoiceNo: 'INV/2026-27/0001',
            expiresAt: '2026-12-03T10:00:00.000Z',
            pdfUrl: 'https://example.test/api/public/invoices/token/pdf',
            whatsappUrl: 'https://wa.me/?text=invoice',
            mailtoUrl: 'mailto:retailer@example.test?subject=Invoice'
          }
        }
      }
    });
    await screen.findByText('INV/2026-27/0001');
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('link', { name: 'WhatsApp' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', expect.stringContaining('mailto:'));
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByText(/Link expires/)).toHaveTextContent('03-Dec-2026');
  });

  it('dispatches only positive partial quantities and skips zero rows', async () => {
    const lines = [
      { itemId: 5, name: 'Murukku 200 g', invoicedQty: 150, dispatchedQty: 0, remainingQty: 150, display: '150 packets' },
      { itemId: 6, name: 'Carton', invoicedQty: 4, dispatchedQty: 0, remainingQty: 4, display: '4 pcs' }
    ];
    const { adapter } = renderInvoicePage({
      invoiceData: invoice({
        lines: [
          invoice().lines[0],
          { ...invoice().lines[0], id: 2, itemId: 6, description: 'Carton', qty: 4, qtyDisplay: '4 pcs' }
        ]
      }),
      dispatchData: dispatchStatus(lines),
      routes: { 'POST /dispatches': { status: 201, data: { dispatch: { dispatchNo: 'DSP/2026-27/0001' } } } }
    });
    await screen.findByText('INV/2026-27/0001');
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }));
    const dialog = screen.getByRole('dialog', { name: 'Dispatch invoice' });
    const firstQty = within(dialog).getByLabelText('Murukku 200 g (remaining 150)');
    const secondQty = within(dialog).getByLabelText('Carton (remaining 4)');
    expect(firstQty).toHaveValue('150');
    fireEvent.change(firstQty, { target: { value: '100' } });
    fireEvent.change(secondQty, { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save dispatch' }));
    await waitFor(() => {
      expect(adapter.calls.find((call) => call.method === 'post' && call.url === '/dispatches')?.data)
        .toEqual({ invoiceId: 7, lines: [{ itemId: 5, qty: 100 }] });
    });
  });

  it('keeps dispatch quantity, vehicle number, and notes stable while typing', async () => {
    const user = userEvent.setup();
    renderInvoicePage();
    await screen.findByText('INV/2026-27/0001');
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }));
    const dialog = screen.getByRole('dialog', { name: 'Dispatch invoice' });

    const quantity = within(dialog).getByLabelText('Murukku 200 g (remaining 150)');
    await user.clear(quantity);
    await expectStableTyping(
      user,
      () => within(dialog).getByLabelText('Murukku 200 g (remaining 150)'),
      '88'
    );
    await expectStableTyping(user, () => within(dialog).getByLabelText('Vehicle number (optional)'), 'TN 45 AB 1234');
    await expectStableTyping(user, () => within(dialog).getByLabelText('Notes (optional)'), 'Deliver after noon');
  });

  it('explains stock shortage fields returned by the dispatch API', async () => {
    renderInvoicePage({
      routes: {
        'POST /dispatches': {
          status: 422,
          data: {
            error: {
              code: 'INSUFFICIENT_STOCK',
              message: 'Insufficient free stock for "Murukku 200 g"',
              details: { itemId: 5, itemName: 'Murukku 200 g', shortBy: 12, reservedByOthers: 20 }
            }
          }
        }
      }
    });
    await screen.findByText('INV/2026-27/0001');
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }));
    const dialog = screen.getByRole('dialog', { name: 'Dispatch invoice' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save dispatch' }));
    expect(await within(dialog).findByText(/Short by 12 packets\. 20 packets are reserved by other orders\./))
      .toBeInTheDocument();
  });

  it('asks for a valid cancellation reason and shows the credit note after success', async () => {
    let currentInvoice = invoice();
    let finishCancel;
    const routes = {
      'GET /invoices/7': () => ({ status: 200, data: currentInvoice }),
      'POST /invoices/7/cancel': (config) => new Promise((resolve) => {
        finishCancel = () => {
          currentInvoice = invoice({
            status: 'CANCELLED',
            cancelReason: config.data.reason,
            creditNote: {
              noteNo: 'CN/2026-27/0001',
              totalPaise: 787500,
              createdAt: '2026-11-26T12:00:00.000Z'
            }
          });
          resolve({
            status: 200,
            data: {
              invoice: { id: 7, status: 'CANCELLED' },
              creditNote: { noteNo: 'CN/2026-27/0001' }
            }
          });
        };
      })
    };
    const { adapter } = renderInvoicePage({ routes });
    await screen.findByText('INV/2026-27/0001');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invoice' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel invoice' });
    expect(within(dialog).getByText(
      'This creates a credit note and returns dispatched goods to stock. This cannot be undone.'
    )).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel invoice' }));
    expect(await within(dialog).findByText('Enter a cancellation reason between 5 and 300 characters.'))
      .toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/invoices/7/cancel')).toBe(false);
    const user = userEvent.setup();
    await expectStableTyping(
      user,
      () => within(dialog).getByRole('textbox', { name: 'Reason' }),
      'Customer requested cancellation'
    );
    const submit = within(dialog).getByRole('button', { name: 'Cancel invoice' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.method === 'post' && call.url === '/invoices/7/cancel'))
        .toHaveLength(1);
    });
    expect(adapter.calls.find((call) => call.url === '/invoices/7/cancel').data)
      .toEqual({ reason: 'Customer requested cancellation' });
    finishCancel();
    expect(await screen.findByText(/CN\/2026-27\/0001/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('CANCELLED invoice');
  });

  it('keeps accountant read-only while allowing authenticated PDF download', async () => {
    renderInvoicePage({ role: 'ACCOUNTANT' });
    expect(await screen.findByText('INV/2026-27/0001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dispatch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel invoice' })).not.toBeInTheDocument();
  });
});
