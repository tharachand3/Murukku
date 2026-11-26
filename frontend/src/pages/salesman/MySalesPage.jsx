import { useState } from 'react';
import { DateRange } from '../../components/ui/DateRange.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { formatPaise } from '../../lib/money.js';
import { rangePreset } from '../../lib/date.js';

const SALES_COLUMNS = [
  { key: 'customerName', label: 'Customer' },
  { key: 'orders', label: 'Orders' },
  { key: 'totalQty', label: 'Packets' },
  {
    key: 'taxableValuePaise',
    label: 'Taxable value',
    render: (row) => formatPaise(row.taxableValuePaise)
  }
];

export default function MySalesPage({ now = new Date() }) {
  const [period, setPeriod] = useState('thisMonth');
  const [range, setRange] = useState(() => rangePreset('thisMonth', now));
  const customRangeInvalid = period === 'custom'
    && (!range.from || !range.to || range.from > range.to);
  const queryKey = `${period}|${range.from}|${range.to}`;

  const salesRequest = useAsync(async () => {
    const params = {};
    if (range.from) params.from = range.from;
    if (range.to) params.to = range.to;
    const { data } = await api.get('/orders/my/customer-sales', { params });
    if (!Array.isArray(data?.items)) {
      throw new TypeError('The server returned an invalid customer sales list');
    }
    return { ...data, key: queryKey };
  }, [queryKey, range.from, range.to], { immediate: !customRangeInvalid });

  const sales = salesRequest.data?.key === queryKey ? salesRequest.data : null;
  const rows = sales?.items ?? [];
  const totals = rows.reduce((result, row) => ({
    orders: result.orders + row.orders,
    totalQty: result.totalQty + row.totalQty,
    taxableValuePaise: result.taxableValuePaise + BigInt(row.taxableValuePaise)
  }), { orders: 0, totalQty: 0, taxableValuePaise: 0n });
  const tableRows = rows.length > 0
    ? [
        ...rows,
        {
          customerName: 'Total',
          orders: totals.orders,
          totalQty: totals.totalQty,
          taxableValuePaise: totals.taxableValuePaise.toString(),
          key: 'totals'
        }
      ]
    : [];

  const selectPreset = (preset) => {
    setPeriod(preset);
    if (preset !== 'custom') setRange(rangePreset(preset, now));
  };

  const changeCustomRange = (nextRange) => {
    setPeriod('custom');
    setRange(nextRange);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-24">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">My sales</h1>
        <p className="mt-1 text-sm text-slate-600">Customer-wise order sales for the selected period.</p>
      </header>

      <section aria-label="Sales period" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-2">
          {[
            ['Today', 'today'],
            ['This month', 'thisMonth'],
            ['This FY', 'thisFY'],
            ['Custom', 'custom']
          ].map(([label, value]) => (
            <button
              aria-pressed={period === value}
              className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${
                period === value
                  ? 'border-blue-700 bg-blue-50 text-blue-900'
                  : 'border-slate-300 text-slate-700'
              }`}
              disabled={salesRequest.loading}
              key={value}
              onClick={() => selectPreset(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {period === 'custom' && !salesRequest.loading && (
          <DateRange from={range.from} to={range.to} onChange={changeCustomRange} now={now} />
        )}
      </section>

      {customRangeInvalid && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          Select a valid start and end date for the custom period.
        </p>
      )}
      {salesRequest.loading && (
        <p className="text-sm text-slate-600" role="status">Loading customer sales…</p>
      )}
      {salesRequest.error && (
        <ErrorBox
          loading={salesRequest.loading}
          message={salesRequest.error.message}
          onRetry={salesRequest.reload}
        />
      )}
      {!salesRequest.loading && !salesRequest.error && sales && rows.length === 0 && (
        <EmptyState title="No customer sales" message="No orders were found for this period." />
      )}
      {sales && rows.length > 0 && (
        <section className="space-y-3">
          <Table columns={SALES_COLUMNS} rows={tableRows} />
          {Array.isArray(sales.products) && sales.products.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-semibold text-slate-900">Product-wise sales</h2>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {sales.products.map((product) => (
                  <li key={product.itemId}>
                    {product.itemName}: {product.totalQty} packets · {formatPaise(product.taxableValuePaise)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}
    </div>
  );
}
