import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';

const TYPES = [
  ['Raw', 'RAW'],
  ['Packaging', 'PACKAGING'],
  ['Finished', 'FINISHED']
];

function readArray(data, label) {
  if (!Array.isArray(data)) {
    throw new TypeError(`The server returned an invalid ${label} list`);
  }
  return data;
}

export default function StockPage() {
  const [type, setType] = useState('RAW');
  const stockRequest = useAsync(async () => {
    const { data } = await api.get('/stock/summary', { params: { type } });
    return { type, rows: readArray(data, 'stock') };
  }, [type]);
  const itemRequest = useAsync(async () => {
    const { data } = await api.get('/items');
    return readArray(data, 'item');
  }, []);
  const itemsById = new Map((itemRequest.data ?? []).map((item) => [item.id, item]));
  const rows = stockRequest.data?.type === type ? stockRequest.data.rows : [];
  const failure = stockRequest.error ?? itemRequest.error;

  const retry = () => {
    stockRequest.reload();
    itemRequest.reload();
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Stock</h1>
        <p className="mt-1 text-sm text-slate-600">Current ledger balances by item type.</p>
      </header>

      <div aria-label="Stock type" className="flex flex-wrap gap-2" role="tablist">
        {TYPES.map(([label, value]) => (
          <button
            aria-selected={type === value}
            className={`min-h-11 rounded-lg border px-4 font-medium ${
              type === value
                ? 'border-blue-700 bg-blue-700 text-white'
                : 'border-slate-300 bg-white text-slate-800'
            }`}
            key={value}
            onClick={() => setType(value)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {(stockRequest.loading || itemRequest.loading) && (
        <Spinner label="Loading stock balances" />
      )}
      {failure && <ErrorBox message={failure.message} onRetry={retry} />}
      {!stockRequest.loading && !stockRequest.error && !itemRequest.loading
        && !itemRequest.error && rows.length === 0 && (
          <EmptyState message={`No ${type.toLowerCase()} items have stock records.`} title="No stock items" />
        )}
      {!stockRequest.loading && !stockRequest.error && !itemRequest.loading
        && !itemRequest.error && rows.length > 0 && (
          <Table
            columns={[
              { key: 'code', label: 'Code' },
              { key: 'name', label: 'Item' },
              { key: 'balanceDisplay', label: 'On hand' },
              {
                key: 'reorder',
                label: 'Reorder status',
                render: (row) => {
                  const item = itemsById.get(row.itemId);
                  return item?.reorderLevelBase !== null
                    && item?.reorderLevelBase !== undefined
                    && row.balanceBase <= item.reorderLevelBase
                    ? <Badge tone="danger">Low</Badge>
                    : '—';
                }
              },
              {
                key: 'ledger',
                label: 'Ledger',
                render: (row) => (
                  <Link className="font-medium text-blue-800 underline" to={`/stock/${row.itemId}`}>
                    View ledger
                  </Link>
                )
              }
            ]}
            rows={rows}
          />
        )}
    </main>
  );
}
