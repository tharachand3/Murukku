import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button.jsx';
import { Card } from '../../../components/ui/Card.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../../components/ui/ErrorBox.jsx';
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAsync } from '../../../hooks/useAsync.js';
import { api } from '../../../lib/api.js';
import { toApiError } from '../../../lib/apiError.js';
import { formatDateIST, formatDateTimeIST } from '../../../lib/date.js';
import { formatPaise } from '../../../lib/money.js';
import CancelInvoiceModal from './CancelInvoiceModal.jsx';
import DispatchModal from './DispatchModal.jsx';
import ShareModal from './ShareModal.jsx';
import { PaymentModal } from '../payments/PaymentModal.jsx';

function readInvoice(data) {
  if (!Array.isArray(data?.lines)) {
    throw new TypeError('The server returned an invalid invoice');
  }
  return data;
}

function filenameFromDisposition(disposition, invoiceNo) {
  const fallback = `${invoiceNo.replaceAll('/', '-')}.pdf`;
  if (typeof disposition !== 'string') return fallback;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const quoted = disposition.match(/filename="([^"]+)"/i);
  const plain = disposition.match(/filename=([^;]+)/i);
  const value = encoded?.[1] ?? quoted?.[1] ?? plain?.[1]?.trim();
  if (!value) return fallback;
  try {
    return decodeURIComponent(value.replace(/^"|"$/g, ''));
  } catch {
    return value.replace(/^"|"$/g, '');
  }
}

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'ADMIN';
  const invoiceRequest = useAsync(async () => {
    const { data } = await api.get(`/invoices/${id}`);
    return readInvoice(data);
  }, [id]);
  const dispatchRequest = useAsync(async () => {
    const { data } = await api.get(`/invoices/${id}/dispatch-status`);
    if (!Array.isArray(data?.lines)) {
      throw new TypeError('The server returned invalid dispatch status');
    }
    return data;
  }, [id]);
  const invoice = invoiceRequest.data;
  const remainingDispatchLines = useMemo(
    () => dispatchRequest.data?.lines?.filter((line) => line.remainingQty > 0) ?? [],
    [dispatchRequest.data]
  );
  const outstandingRequest = useAsync(async () => {
    if (!invoice?.customerId) return null;
    const { data } = await api.get(`/payments/outstanding/${invoice.customerId}`);
    return data;
  }, [id, invoice?.customerId], { immediate: Boolean(invoice?.customerId) });
  const [shareOpen, setShareOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const downloadPending = useRef(false);

  const reload = () => {
    invoiceRequest.reload();
    dispatchRequest.reload();
    if (invoice?.customerId) outstandingRequest.reload();
  };

  const downloadPdf = async () => {
    if (downloadPending.current) return;
    downloadPending.current = true;
    setDownloading(true);
    try {
      const response = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
      const disposition = response.headers?.get?.('content-disposition')
        ?? response.headers?.['content-disposition'];
      const filename = filenameFromDisposition(disposition, invoice.invoiceNo);
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      toast.error(toApiError(error).message);
    } finally {
      downloadPending.current = false;
      setDownloading(false);
    }
  };

  if (invoiceRequest.loading) {
    return <p className="p-4 text-sm text-slate-600" role="status">Loading invoice…</p>;
  }
  if (invoiceRequest.error) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <ErrorBox
          loading={invoiceRequest.loading}
          message={invoiceRequest.error.message}
          onRetry={invoiceRequest.reload}
        />
        <Link className="inline-flex min-h-11 items-center text-blue-800 underline" to="/invoices">
          Back to invoices
        </Link>
      </div>
    );
  }
  if (!invoice) {
    return <EmptyState title="Invoice not found" />;
  }

  const buyer = invoice.customer ?? invoice.snapshot?.buyer ?? {};
  const seller = invoice.snapshot?.seller ?? {};
  const customerBalance = outstandingRequest.data;
  const invoiceBalance = customerBalance?.invoices?.find((row) => row.id === invoice.id);
  const duePaise = customerBalance
    ? invoiceBalance?.duePaise ?? 0
    : null;
  const linkedPayments = customerBalance?.payments?.filter(
    (payment) => payment.invoiceNo === invoice.invoiceNo
  ) ?? [];
  const canDispatch = invoice.status === 'POSTED'
    && dispatchRequest.data?.lines?.some((line) => line.remainingQty > 0);
  const taxColumns = invoice.isInterState ? ['IGST'] : ['CGST', 'SGST'];

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <Link className="inline-flex min-h-11 items-center text-sm font-medium text-blue-800 underline" to="/invoices">
        Back to invoices
      </Link>
      {invoice.status === 'CANCELLED' && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900" role="alert">
          <p className="font-semibold">CANCELLED invoice</p>
          {invoice.cancelReason && <p className="mt-1 text-sm">Reason: {invoice.cancelReason}</p>}
        </div>
      )}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{invoice.invoiceNo}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Issued {formatDateIST(invoice.issueDate)} · Order{' '}
            <Link className="text-blue-800 underline" to={`/orders/${invoice.orderId}`}>
              {invoice.order?.orderNo ?? `#${invoice.orderId}`}
            </Link>
          </p>
        </div>
        <StatusBadge status={invoice.status} />
      </header>

      <Card>
        <h2 className="font-semibold text-slate-900">Invoice parties and tax</h2>
        <div className="mt-3 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <h3 className="font-medium text-slate-800">Customer</h3>
            <p>{buyer.name}</p>
            <p>GSTIN: {buyer.gstin || 'Not registered'}</p>
            <p>{[buyer.address, buyer.stateName, buyer.stateCode].filter(Boolean).join(', ')}</p>
          </div>
          <div>
            <h3 className="font-medium text-slate-800">Seller</h3>
            <p>{seller.name}</p>
            <p>GSTIN: {seller.gstin || 'Not available'}</p>
            <p>
              Place of supply: {buyer.stateName || 'State'} ({invoice.placeOfSupplyStateCode})
              {' · '}
              {invoice.isInterState ? 'IGST' : 'CGST + SGST'}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Invoice lines</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-600">
              <tr>
                {['Item', 'HSN', 'Quantity', 'Rate', 'Taxable', ...taxColumns].map((label) => (
                  <th className="whitespace-nowrap px-3 py-3" key={label} scope="col">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-3 py-3 font-medium text-slate-900">{line.description}</td>
                  <td className="px-3 py-3">{line.hsnCode}</td>
                  <td className="px-3 py-3">{line.qtyDisplay}</td>
                  <td className="px-3 py-3">{formatPaise(line.ratePaise)}</td>
                  <td className="px-3 py-3">{formatPaise(line.taxableValuePaise)}</td>
                  {invoice.isInterState ? (
                    <td className="px-3 py-3">{formatPaise(line.igstPaise)}</td>
                  ) : (
                    <>
                      <td className="px-3 py-3">{formatPaise(line.cgstPaise)}</td>
                      <td className="px-3 py-3">{formatPaise(line.sgstPaise)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto mt-4 grid max-w-sm grid-cols-2 gap-2 text-sm">
          <dt>Taxable</dt><dd className="text-right">{formatPaise(invoice.taxableValuePaise)}</dd>
          {invoice.isInterState ? (
            <><dt>IGST</dt><dd className="text-right">{formatPaise(invoice.igstPaise)}</dd></>
          ) : (
            <>
              <dt>CGST</dt><dd className="text-right">{formatPaise(invoice.cgstPaise)}</dd>
              <dt>SGST</dt><dd className="text-right">{formatPaise(invoice.sgstPaise)}</dd>
            </>
          )}
          <dt className="font-bold">Total</dt>
          <dd className="text-right font-bold">{formatPaise(invoice.totalPaise)}</dd>
        </dl>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Dispatch status</h2>
            {dispatchRequest.data && (
              <p className="mt-1 text-sm text-slate-600">
                {dispatchRequest.data.fullyDispatched ? 'Fully dispatched' : 'Dispatch pending'}
              </p>
            )}
          </div>
          {isAdmin && canDispatch && (
            <Button onClick={() => setDispatchOpen(true)}>Dispatch</Button>
          )}
        </div>
        {dispatchRequest.loading && (
          <p className="mt-3 text-sm text-slate-600" role="status">Loading dispatch status…</p>
        )}
        {dispatchRequest.error && (
          <div className="mt-3">
            <ErrorBox
              loading={dispatchRequest.loading}
              message={dispatchRequest.error.message}
              onRetry={dispatchRequest.reload}
            />
          </div>
        )}
        {dispatchRequest.data?.lines.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-3 py-3" scope="col">Item</th>
                  <th className="px-3 py-3" scope="col">Invoiced</th>
                  <th className="px-3 py-3" scope="col">Dispatched</th>
                  <th className="px-3 py-3" scope="col">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dispatchRequest.data.lines.map((line) => (
                  <tr key={line.itemId}>
                    <td className="px-3 py-3">{line.name}</td>
                    <td className="px-3 py-3">{line.invoicedQty}</td>
                    <td className="px-3 py-3">{line.dispatchedQty}</td>
                    <td className="px-3 py-3">{line.display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!dispatchRequest.loading && !dispatchRequest.error
          && dispatchRequest.data?.lines.length === 0 && (
            <EmptyState title="No dispatch lines" />
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Payments</h2>
        {outstandingRequest.loading && (
          <p className="mt-3 text-sm text-slate-600" role="status">Loading invoice payments…</p>
        )}
        {outstandingRequest.error && (
          <div className="mt-3">
            <ErrorBox
              loading={outstandingRequest.loading}
              message={outstandingRequest.error.message}
              onRetry={outstandingRequest.reload}
            />
          </div>
        )}
        {!outstandingRequest.loading && !outstandingRequest.error && customerBalance && (
          <>
            <p className="mt-2 text-sm">
              Due: {duePaise === null ? 'Loading balance…' : formatPaise(duePaise)}
            </p>
            {linkedPayments.length === 0 ? (
              <EmptyState title="No payments linked to this invoice" />
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {linkedPayments.map((payment) => (
                  <li className="flex flex-wrap justify-between gap-2 py-2 text-sm" key={payment.id}>
                    <span>{payment.receiptNo} · {formatDateTimeIST(payment.paymentDate)} · {payment.mode}</span>
                    <span>{formatPaise(payment.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {isAdmin && invoice.status === 'POSTED' && duePaise > 0 && (
          <Button
            className="mt-3"
            disabled={outstandingRequest.loading || outstandingRequest.error}
            onClick={() => setPaymentOpen(true)}
            variant="secondary"
          >
            Record payment
          </Button>
        )}
      </Card>

      {invoice.creditNote && (
        <Card>
          <h2 className="font-semibold text-slate-900">Credit note</h2>
          <p className="mt-2 text-sm">
            {invoice.creditNote.noteNo} · {formatPaise(invoice.creditNote.totalPaise)} ·{' '}
            {formatDateTimeIST(invoice.creditNote.createdAt)}
          </p>
        </Card>
      )}

      {isAdmin && (
        <div className="flex flex-wrap gap-3">
          <Button disabled={downloading} loading={downloading} onClick={downloadPdf} variant="secondary">
            Download PDF
          </Button>
          <Button onClick={() => setShareOpen(true)} variant="secondary">Share</Button>
          {invoice.status === 'POSTED' && (
            <Button onClick={() => setCancelOpen(true)} variant="danger">Cancel invoice</Button>
          )}
        </div>
      )}
      {!isAdmin && (
        <Button disabled={downloading} loading={downloading} onClick={downloadPdf} variant="secondary">
          Download PDF
        </Button>
      )}

      {isAdmin && (
        <>
          <ShareModal
            invoiceId={invoice.id}
            onClose={() => setShareOpen(false)}
            open={shareOpen}
          />
          <DispatchModal
            invoiceId={invoice.id}
            lines={remainingDispatchLines}
            onClose={() => setDispatchOpen(false)}
            onSaved={() => {
              setDispatchOpen(false);
              dispatchRequest.reload();
            }}
            open={dispatchOpen}
          />
          <PaymentModal
            customerId={invoice.customerId}
            duePaise={duePaise ?? 0}
            invoiceId={invoice.id}
            onClose={() => setPaymentOpen(false)}
            onSaved={() => {
              setPaymentOpen(false);
              outstandingRequest.reload();
            }}
            open={paymentOpen}
          />
          <CancelInvoiceModal
            invoiceId={invoice.id}
            onClose={() => setCancelOpen(false)}
            onSaved={() => {
              setCancelOpen(false);
              reload();
            }}
            open={cancelOpen}
          />
        </>
      )}
    </div>
  );
}
