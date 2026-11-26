import { Link } from 'react-router-dom';
import { Card } from '../../../components/ui/Card.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../../components/ui/ErrorBox.jsx';
import { useAsync } from '../../../hooks/useAsync.js';
import { api } from '../../../lib/api.js';

function readShortages(data) {
  if (!Array.isArray(data?.items)) {
    throw new TypeError('The server returned an invalid shortage list');
  }
  return data;
}

function suggestedBatchText(suggestedBatches) {
  if (!Number.isSafeInteger(suggestedBatches)) {
    return 'No active recipe is available to estimate batches.';
  }
  return `Suggested: ${suggestedBatches} ${suggestedBatches === 1 ? 'batch' : 'batches'}.`;
}

export default function ShortagesPage() {
  const shortagesRequest = useAsync(async () => {
    const { data } = await api.get('/orders/shortages');
    return readShortages(data);
  }, []);

  if (shortagesRequest.loading) {
    return <p className="p-4 text-sm text-slate-600" role="status">Loading order shortages…</p>;
  }
  if (shortagesRequest.error) {
    return (
      <ErrorBox
        loading={shortagesRequest.loading}
        message={shortagesRequest.error.message}
        onRetry={shortagesRequest.reload}
      />
    );
  }
  if (!shortagesRequest.data || shortagesRequest.data.items.length === 0) {
    return (
      <EmptyState
        title="No open order shortages"
        message="Submitted orders are currently covered by free finished stock."
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Order shortages</h1>
          <p className="mt-1 text-sm text-slate-600">
            Open submitted demand allocated against free finished stock.
          </p>
        </div>
        <button
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 disabled:opacity-60"
          disabled={shortagesRequest.loading}
          onClick={shortagesRequest.reload}
          type="button"
        >
          Refresh
        </button>
      </header>

      <div className="space-y-4">
        {shortagesRequest.data.items.map((item) => (
          <Card key={item.itemId}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{item.name}</h2>
                <p className="mt-1 font-medium text-red-800">
                  {item.message}. {suggestedBatchText(item.suggestedBatches)}
                </p>
              </div>
              <p className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-800">
                Short by {item.totalShortPackets} packets
              </p>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <div><dt className="text-slate-500">On hand</dt><dd className="font-semibold">{item.onHand}</dd></div>
              <div><dt className="text-slate-500">Reserved</dt><dd className="font-semibold">{item.reservedByApproved}</dd></div>
              <div><dt className="text-slate-500">Free</dt><dd className="font-semibold">{item.free}</dd></div>
              <div><dt className="text-slate-500">Open demand</dt><dd className="font-semibold">{item.openDemand}</dd></div>
              <div><dt className="text-slate-500">Short packets</dt><dd className="font-semibold text-red-800">{item.totalShortPackets}</dd></div>
            </dl>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-3 py-3" scope="col">Order</th>
                    <th className="px-3 py-3" scope="col">Customer</th>
                    <th className="px-3 py-3" scope="col">Demand</th>
                    <th className="px-3 py-3" scope="col">Allocated</th>
                    <th className="px-3 py-3" scope="col">Short</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {item.orders.map((order) => (
                    <tr key={order.orderId}>
                      <td className="px-3 py-3">
                        <Link className="font-medium text-blue-800 underline" to={`/orders/${order.orderId}`}>
                          {order.orderNo}
                        </Link>
                      </td>
                      <td className="px-3 py-3">{order.customerName}</td>
                      <td className="px-3 py-3">{order.qty}</td>
                      <td className="px-3 py-3">{order.allocated}</td>
                      <td className="px-3 py-3 font-semibold text-red-800">{order.shortBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
