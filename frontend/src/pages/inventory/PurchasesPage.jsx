import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { DateRange } from '../../components/ui/DateRange.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { formatDateTimeIST, rangePreset } from '../../lib/date.js';
import { formatPaise } from '../../lib/money.js';

const PAGE_SIZE = 100;

function readArray(data, label) {
  if (!Array.isArray(data)) {
    throw new TypeError(`The server returned an invalid ${label} list`);
  }
  return data;
}

function istDayBounds(range) {
  return {
    from: `${range.from}T00:00:00+05:30`,
    to: `${range.to}T23:59:59.999+05:30`
  };
}

export default function PurchasesPage({ now = new Date() }) {
  const { user } = useAuth();
  const [range, setRange] = useState(() => rangePreset('thisFY', now));
  const [supplierDraft, setSupplierDraft] = useState('');
  const [filter, setFilter] = useState(() => ({
    range: rangePreset('thisFY', now),
    supplierId: ''
  }));
  const [filterError, setFilterError] = useState('');
  const filterValid = filter.range.from && filter.range.to && filter.range.from <= filter.range.to;
  const params = filterValid
    ? { page: 1, limit: PAGE_SIZE, ...istDayBounds(filter.range) }
    : null;
  if (params && filter.supplierId) params.supplierId = filter.supplierId;
  const queryKey = JSON.stringify(params);
  const purchasesRequest = useAsync(async () => {
    const { data } = await api.get('/purchases', { params });
    if (!Array.isArray(data?.items)) {
      throw new TypeError('The server returned an invalid purchase list');
    }
    return { ...data, queryKey };
  }, [queryKey], { immediate: Boolean(params) });
  const suppliersRequest = useAsync(async () => {
    const { data } = await api.get('/suppliers?active=true');
    return readArray(data, 'supplier');
  }, []);
  const purchases = purchasesRequest.data?.queryKey === queryKey ? purchasesRequest.data : null;
  const suppliers = suppliersRequest.data ?? [];
  const totalPaise = (purchases?.items ?? []).reduce(
    (total, purchase) => total + purchase.totalPaise,
    0
  );
  const failure = purchasesRequest.error ?? suppliersRequest.error;

  const applyFilters = (event) => {
    event.preventDefault();
    if (!range.from || !range.to || range.from > range.to) {
      setFilterError('Enter a valid period with the start date on or before the end date.');
      return;
    }
    setFilterError('');
    setFilter({ range, supplierId: supplierDraft });
  };
  const retry = () => {
    purchasesRequest.reload();
    suppliersRequest.reload();
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Purchases</h1>
          <p className="mt-1 text-sm text-slate-600">Supplier receipts and inventory costs.</p>
        </div>
        {['ADMIN', 'PRODUCTION'].includes(user?.role) && (
          <Link className="inline-flex min-h-11 items-center rounded-lg bg-blue-700 px-4 font-medium text-white" to="/purchases/new">
            New purchase
          </Link>
        )}
      </header>

      <form className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2" onSubmit={applyFilters}>
        <DateRange from={range.from} now={now} onChange={setRange} to={range.to} />
        <div className="space-y-3">
          <Select label="Supplier" onChange={(event) => setSupplierDraft(event.target.value)} value={supplierDraft}>
            <option value="">All suppliers</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </Select>
          {filterError && <p className="text-sm text-red-700" role="alert">{filterError}</p>}
          <Button disabled={purchasesRequest.loading} loading={purchasesRequest.loading} type="submit">
            Apply filters
          </Button>
        </div>
      </form>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Purchase receipts</h2>
          {purchases && <p className="font-semibold">Page total: {formatPaise(totalPaise)}</p>}
        </div>
        {(purchasesRequest.loading || suppliersRequest.loading) && (
          <Spinner label="Loading purchases" />
        )}
        {failure && <ErrorBox message={failure.message} onRetry={retry} />}
        {purchases && !purchasesRequest.loading && purchases.items.length === 0 && (
          <EmptyState message="No purchases match this period and supplier." title="No purchase receipts" />
        )}
        {purchases && !purchasesRequest.loading && purchases.items.length > 0 && (
          <Table
            columns={[
              { key: 'number', label: 'Purchase' },
              { key: 'purchaseDate', label: 'Date (IST)', render: (row) => formatDateTimeIST(row.purchaseDate) },
              { key: 'supplier', label: 'Supplier', render: (row) => row.supplier.name },
              { key: 'supplierInvoiceNo', label: 'Supplier invoice', render: (row) => row.supplierInvoiceNo || '—' },
              { key: 'lineCount', label: 'Lines', render: (row) => row.lines.length },
              { key: 'totalPaise', label: 'Total', render: (row) => formatPaise(row.totalPaise) }
            ]}
            rows={purchases.items}
          />
        )}
      </section>
    </main>
  );
}
