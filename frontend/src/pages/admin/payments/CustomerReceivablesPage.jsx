import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button.jsx';
import { Card } from '../../../components/ui/Card.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../../components/ui/ErrorBox.jsx';
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useAsync } from '../../../hooks/useAsync.js';
import { api } from '../../../lib/api.js';
import { formatDateIST, formatDateTimeIST } from '../../../lib/date.js';
import { formatPaise } from '../../../lib/money.js';
import { PaymentModal } from './PaymentModal.jsx';

function readCustomerOutstanding(data) {
  if (!Array.isArray(data?.invoices) || !Array.isArray(data?.payments)) {
    throw new TypeError('The server returned invalid customer receivables');
  }
  return data;
}

export default function CustomerReceivablesPage() {
  const { customerId } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const request = useAsync(async () => {
    const { data } = await api.get(`/payments/outstanding/${customerId}`);
    return readCustomerOutstanding(data);
  }, [customerId]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  if (request.loading) {
    return <p className="p-4 text-sm text-slate-600" role="status">Loading customer balance…</p>;
  }
  if (request.error) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <ErrorBox loading={request.loading} message={request.error.message} onRetry={request.reload} />
        <Link className="inline-flex min-h-11 items-center text-blue-800 underline" to="/receivables">
          Back to receivables
        </Link>
      </div>
    );
  }
  if (!request.data) {
    return <EmptyState title="Customer balance unavailable" />;
  }

  const data = request.data;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <Link className="inline-flex min-h-11 items-center text-sm font-medium text-blue-800 underline" to="/receivables">
        Back to receivables
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{data.customer.name}</h1>
        <p className="mt-1 text-sm text-slate-600">Customer receivables and payment history</p>
      </header>

      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Invoiced</dt><dd className="font-semibold">{formatPaise(data.invoicedPaise)}</dd></div>
          <div><dt className="text-slate-500">Paid</dt><dd className="font-semibold">{formatPaise(data.paidPaise)}</dd></div>
          <div><dt className="text-slate-500">Outstanding</dt><dd className="font-semibold">{formatPaise(data.outstandingPaise)}</dd></div>
          <div><dt className="text-slate-500">Credit balance</dt><dd className="font-semibold">{formatPaise(data.creditPaise)}</dd></div>
        </dl>
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Invoices</h2>
        {data.invoices.length === 0 ? (
          <EmptyState title="No posted invoices for this customer" />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-600">
                <tr>
                  {['Invoice', 'Date', 'Total', 'Paid', 'Due', 'Status', 'Action'].map((label) => (
                    <th className="whitespace-nowrap px-3 py-3" key={label} scope="col">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-3 py-3">
                      <Link className="font-medium text-blue-800 underline" to={`/invoices/${invoice.id}`}>
                        {invoice.invoiceNo}
                      </Link>
                    </td>
                    <td className="px-3 py-3">{formatDateIST(invoice.issueDate)}</td>
                    <td className="px-3 py-3">{formatPaise(invoice.totalPaise)}</td>
                    <td className="px-3 py-3">{formatPaise(invoice.paidPaise)}</td>
                    <td className="px-3 py-3">{formatPaise(invoice.duePaise)}</td>
                    <td className="px-3 py-3"><StatusBadge status={invoice.status} /></td>
                    <td className="px-3 py-3">
                      {isAdmin && invoice.duePaise > 0 && (
                        <Button
                          onClick={() => setSelectedInvoice(invoice)}
                          variant="secondary"
                        >
                          Record payment
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Payment history</h2>
        {data.payments.length === 0 ? (
          <EmptyState title="No payments recorded" />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-600">
                <tr>
                  {['Receipt', 'Date', 'Invoice', 'Amount', 'Mode', 'Reference'].map((label) => (
                    <th className="whitespace-nowrap px-3 py-3" key={label} scope="col">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-3 py-3">{payment.receiptNo}</td>
                    <td className="px-3 py-3">{formatDateTimeIST(payment.paymentDate)}</td>
                    <td className="px-3 py-3">{payment.invoiceNo ?? 'Unallocated'}</td>
                    <td className="px-3 py-3">{formatPaise(payment.amountPaise)}</td>
                    <td className="px-3 py-3">{payment.mode}</td>
                    <td className="px-3 py-3">{payment.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isAdmin && selectedInvoice && (
        <PaymentModal
          customerId={data.customer.id}
          duePaise={selectedInvoice.duePaise}
          invoiceId={selectedInvoice.id}
          onClose={() => setSelectedInvoice(null)}
          onSaved={() => {
            setSelectedInvoice(null);
            request.reload();
          }}
          open
        />
      )}
    </div>
  );
}
