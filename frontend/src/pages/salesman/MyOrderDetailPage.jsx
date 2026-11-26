import { Link, useParams } from 'react-router-dom';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { formatDateTimeIST } from '../../lib/date.js';
import { formatPaise } from '../../lib/money.js';

const TIMELINE_STEPS = [
  ['SUBMITTED', 'Submitted'],
  ['APPROVED', 'Approved'],
  ['INVOICED', 'Invoiced'],
  ['DISPATCHED', 'Dispatched']
];

function reachedStep(order) {
  const activeIndex = TIMELINE_STEPS.findIndex(([status]) => status === order.status);
  if (activeIndex >= 0) return activeIndex;
  if (order.status === 'REJECTED') return 0;
  if (order.status === 'CANCELLED') {
    return order.timeline?.some((entry) => entry.action === 'APPROVE') ? 1 : 0;
  }
  return -1;
}

function stepTime(order, status) {
  if (status === 'SUBMITTED') return order.createdAt;
  if (status === 'DISPATCHED') return null;
  const action = {
    APPROVED: 'APPROVE',
    INVOICED: 'INVOICE'
  }[status];
  const entries = order.timeline?.filter((entry) => entry.action === action) ?? [];
  return entries[entries.length - 1]?.at ?? null;
}

export default function MyOrderDetailPage() {
  const { id } = useParams();
  const orderRequest = useAsync(async () => {
    const { data } = await api.get(`/orders/${id}`);
    return data;
  }, [id]);
  const order = orderRequest.data;

  if (orderRequest.loading) {
    return <p className="p-4 text-sm text-slate-600" role="status">Loading order…</p>;
  }
  if (orderRequest.error) {
    const message = orderRequest.error.status === 404 ? 'Order not found' : orderRequest.error.message;
    return (
      <div className="mx-auto max-w-4xl space-y-4 pb-24">
        <ErrorBox loading={orderRequest.loading} message={message} onRetry={orderRequest.reload} />
        <Link className="inline-flex min-h-11 items-center text-blue-800 underline" to="/my-orders">
          Back to my orders
        </Link>
      </div>
    );
  }
  if (!order) {
    return <EmptyState title="Order not found" />;
  }

  const lastReached = reachedStep(order);
  const dispatchedAt = order.dispatches?.[order.dispatches.length - 1]?.dispatchDate;

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-24">
      <Link className="inline-flex min-h-11 items-center text-sm font-medium text-blue-800 underline" to="/my-orders">
        Back to my orders
      </Link>

      <header className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{order.orderNo}</h1>
            <p className="mt-1 text-slate-800">{order.customer?.name}</p>
            <p className="mt-1 text-sm text-slate-500">{formatDateTimeIST(order.createdAt)}</p>
          </div>
          <StatusBadge status={order.status} />
        </div>
      </header>

      {order.status === 'REJECTED' && (
        <section className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900" role="alert">
          <h2 className="font-semibold">Order rejected</h2>
          <p className="mt-1">{order.rejectReason || 'No rejection reason was provided.'}</p>
        </section>
      )}
      {order.status === 'CANCELLED' && (
        <section className="rounded-xl border border-slate-300 bg-slate-100 p-4 text-slate-800">
          This order has been cancelled.
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Order timeline</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-4">
          {TIMELINE_STEPS.map(([status, label], index) => {
            const complete = index <= lastReached;
            const at = stepTime(order, status);
            return (
              <li
                aria-current={index === lastReached ? 'step' : undefined}
                className={`rounded-lg border p-3 ${
                  complete ? 'border-green-300 bg-green-50 text-green-900' : 'border-slate-200 text-slate-500'
                }`}
                data-complete={complete}
                key={status}
              >
                <p className="font-medium">{label}</p>
                {at && <p className="mt-1 text-xs">{formatDateTimeIST(at)}</p>}
                {status === 'DISPATCHED' && dispatchedAt && (
                  <p className="mt-1 text-xs">{formatDateTimeIST(dispatchedAt)}</p>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Order lines</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-2 py-3" scope="col">Product</th>
                <th className="px-2 py-3" scope="col">Requested qty</th>
                <th className="px-2 py-3" scope="col">Requested price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {order.lines.map((line) => (
                <tr key={line.lineId}>
                  <td className="px-2 py-3 font-medium text-slate-900">{line.name}</td>
                  <td className="px-2 py-3">
                    {line.qtyDisplay}
                    {line.approvedQty !== null && line.approvedQty !== line.qty && (
                      <p className="mt-1 text-xs font-medium text-blue-800">
                        Approved {line.approvedQty} of {line.qty}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    {formatPaise(line.pricePaise)}
                    {line.approvedPricePaise !== null && line.approvedPricePaise !== line.pricePaise && (
                      <p className="mt-1 text-xs font-medium text-blue-800">
                        Approved price: {formatPaise(line.approvedPricePaise)}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 flex justify-between gap-3 border-t border-slate-100 pt-4 font-semibold">
          <span>Taxable total</span>
          <span>{formatPaise(order.taxableTotalPaise)}</span>
        </p>
        <p className="mt-1 text-xs text-slate-500">GST is added when the invoice is raised</p>
      </section>

      {order.invoice && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Invoice</h2>
          <p className="mt-2">{order.invoice.invoiceNo}</p>
        </section>
      )}

      {order.dispatches?.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Dispatches</h2>
          <ul className="mt-2 space-y-2">
            {order.dispatches.map((dispatch) => (
              <li className="text-sm text-slate-700" key={dispatch.dispatchNo}>
                {dispatch.dispatchNo} · {formatDateTimeIST(dispatch.dispatchDate)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
