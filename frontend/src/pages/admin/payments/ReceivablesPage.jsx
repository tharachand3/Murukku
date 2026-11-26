import { Link } from 'react-router-dom';
import { Card } from '../../../components/ui/Card.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../../components/ui/ErrorBox.jsx';
import { Table } from '../../../components/ui/Table.jsx';
import { useAsync } from '../../../hooks/useAsync.js';
import { api } from '../../../lib/api.js';
import { formatPaise } from '../../../lib/money.js';

function readOutstanding(data) {
  if (!Array.isArray(data?.items)) {
    throw new TypeError('The server returned an invalid receivables list');
  }
  return data;
}

function columns() {
  return [
    {
      key: 'customer',
      label: 'Customer',
      render: (entry) => (
        <Link
          className="font-medium text-blue-800 underline"
          to={`/receivables/${entry.customer.id}`}
        >
          {entry.customer.name}
        </Link>
      )
    },
    { key: 'invoicedPaise', label: 'Invoiced', render: (entry) => formatPaise(entry.invoicedPaise) },
    { key: 'paidPaise', label: 'Paid', render: (entry) => formatPaise(entry.paidPaise) },
    {
      key: 'outstandingPaise',
      label: 'Outstanding',
      render: (entry) => formatPaise(entry.outstandingPaise)
    }
  ];
}

export default function ReceivablesPage() {
  const request = useAsync(async () => {
    const { data } = await api.get('/payments/outstanding');
    return readOutstanding(data);
  }, []);

  if (request.loading) {
    return <p className="p-4 text-sm text-slate-600" role="status">Loading receivables…</p>;
  }
  if (request.error) {
    return (
      <ErrorBox loading={request.loading} message={request.error.message} onRetry={request.reload} />
    );
  }
  if (!request.data) {
    return (
      <EmptyState
        title="Receivables unavailable"
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Receivables</h1>
        <p className="mt-1 text-sm text-slate-600">Customers with outstanding posted invoices.</p>
      </header>
      <Card>
        <p className="text-lg font-semibold text-slate-900">
          Total outstanding: {formatPaise(request.data.totals.outstandingPaise)}
        </p>
      </Card>
      {request.data.items.length === 0 ? (
        <EmptyState
          title="No outstanding receivables"
          message="Customers with a positive invoice balance will appear here."
        />
      ) : (
        <Table columns={columns()} rows={request.data.items} />
      )}
    </div>
  );
}
