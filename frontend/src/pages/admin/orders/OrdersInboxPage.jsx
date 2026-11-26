import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../../components/ui/ErrorBox.jsx';
import { Input } from '../../../components/ui/Input.jsx';
import { Pagination } from '../../../components/ui/Pagination.jsx';
import { Select } from '../../../components/ui/Select.jsx';
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx';
import { Table } from '../../../components/ui/Table.jsx';
import { useAsync } from '../../../hooks/useAsync.js';
import { api } from '../../../lib/api.js';
import { formatDateTimeIST } from '../../../lib/date.js';
import { formatPaise } from '../../../lib/money.js';

const PAGE_SIZE = 20;
const STATUSES = [
  ['Submitted', 'SUBMITTED'],
  ['Approved', 'APPROVED'],
  ['Invoiced', 'INVOICED'],
  ['Dispatched', 'DISPATCHED'],
  ['Rejected', 'REJECTED'],
  ['Cancelled', 'CANCELLED']
];

function readArray(data, label) {
  if (!Array.isArray(data)) {
    throw new TypeError(`The server returned an invalid ${label} list`);
  }
  return data;
}

function positiveInteger(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function makeColumns() {
  return [
    { key: 'orderNo', label: 'Order' },
    {
      key: 'createdAt',
      label: 'Date (IST)',
      render: (order) => formatDateTimeIST(order.createdAt)
    },
    { key: 'customerName', label: 'Customer' },
    { key: 'salesmanName', label: 'Salesman' },
    { key: 'totalQty', label: 'Packets' },
    {
      key: 'taxableTotalPaise',
      label: 'Taxable total',
      render: (order) => formatPaise(order.taxableTotalPaise)
    },
    {
      key: 'status',
      label: 'Status',
      render: (order) => <StatusBadge status={order.status} />
    },
    {
      key: 'review',
      label: 'Action',
      render: (order) => (
        <Link className="font-medium text-blue-800 underline" to={`/orders/${order.id}`}>
          Review
        </Link>
      )
    }
  ];
}

export default function OrdersInboxPage({ now = new Date() }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusDraft, setStatusDraft] = useState('SUBMITTED');
  const [customerDraft, setCustomerDraft] = useState('');
  const [fromDraft, setFromDraft] = useState('');
  const [toDraft, setToDraft] = useState('');
  const [salesmanDraft, setSalesmanDraft] = useState('');
  const [filterError, setFilterError] = useState('');
  const customersRequest = useAsync(async () => {
    const { data } = await api.get('/customers');
    return readArray(data, 'customer');
  }, []);

  const status = searchParams.get('status') ?? 'SUBMITTED';
  const customerId = searchParams.get('customerId');
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const salesmanId = searchParams.get('salesmanId');
  const page = positiveInteger(searchParams.get('page') ?? '1') ?? 1;
  const params = { page, limit: PAGE_SIZE };
  if (status !== 'ALL') params.status = status;
  if (customerId) params.customerId = customerId;
  if (from) params.from = from;
  if (to) params.to = to;
  if (salesmanId) params.salesmanId = salesmanId;
  const queryKey = JSON.stringify(params);

  const ordersRequest = useAsync(async () => {
    const { data } = await api.get('/orders', { params });
    if (!Array.isArray(data?.items)) {
      throw new TypeError('The server returned an invalid order list');
    }
    return { ...data, queryKey };
  }, [queryKey]);
  const orders = ordersRequest.data?.queryKey === queryKey ? ordersRequest.data : null;
  const customers = customersRequest.data ?? [];
  const customerIdParam = customerId ?? '';

  useEffect(() => {
    if (searchParams.has('status')) return;
    const next = new URLSearchParams(searchParams);
    next.set('status', 'SUBMITTED');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setStatusDraft(status);
    setFromDraft(from);
    setToDraft(to);
    setSalesmanDraft(salesmanId ?? '');
    setFilterError('');
  }, [searchParams.toString()]);

  useEffect(() => {
    if (!customersRequest.data) return;
    const selected = customers.find((customer) => String(customer.id) === customerIdParam);
    setCustomerDraft(selected?.name ?? '');
  }, [customerIdParam, customersRequest.data]);

  const applyFilters = (event) => {
    event.preventDefault();
    const typedCustomer = customerDraft.trim();
    const matchingCustomers = typedCustomer
      ? customers.filter((customer) => customer.name.toLocaleLowerCase() === typedCustomer.toLocaleLowerCase())
      : [];
    if (typedCustomer && matchingCustomers.length !== 1) {
      setFilterError('Choose a customer from the suggestions or clear the customer search.');
      return;
    }
    if (salesmanDraft.trim() && positiveInteger(salesmanDraft.trim()) === null) {
      setFilterError('Enter a valid positive salesman ID.');
      return;
    }
    if (fromDraft && toDraft && fromDraft > toDraft) {
      setFilterError('The start date must be on or before the end date.');
      return;
    }

    const next = new URLSearchParams(searchParams);
    next.set('status', statusDraft);
    next.delete('customerId');
    next.delete('from');
    next.delete('to');
    next.delete('salesmanId');
    next.set('page', '1');
    if (matchingCustomers.length === 1) {
      next.set('customerId', String(matchingCustomers[0].id));
    }
    if (fromDraft) next.set('from', fromDraft);
    if (toDraft) next.set('to', toDraft);
    if (salesmanDraft.trim()) next.set('salesmanId', salesmanDraft.trim());
    setFilterError('');
    setSearchParams(next);
  };

  const goToPage = (nextPage) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(nextPage));
    setSearchParams(next);
  };
  const pageCount = orders
    ? Math.max(1, Math.ceil(orders.total / orders.limit))
    : 1;
  const columns = makeColumns();

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Orders inbox</h1>
          <p className="mt-1 text-sm text-slate-600">Review submitted orders and their approval status.</p>
        </div>
        <Button
          disabled={ordersRequest.loading || ordersRequest.refreshing}
          loading={ordersRequest.loading}
          onClick={() => ordersRequest.reload({ silent: true })}
          variant="secondary"
        >
          Refresh
        </Button>
      </header>

      <form
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-3"
        onSubmit={applyFilters}
      >
        <Select
          disabled={ordersRequest.loading}
          label="Status"
          onChange={(event) => setStatusDraft(event.target.value)}
          value={statusDraft}
        >
          <option value="SUBMITTED">Submitted</option>
          {STATUSES.filter(([, value]) => value !== 'SUBMITTED').map(([label, value]) => (
            <option key={value} value={value}>{label}</option>
          ))}
          <option value="ALL">All statuses</option>
        </Select>
        <div>
          <Input
            disabled={customersRequest.loading || ordersRequest.loading}
            id="customer-filter"
            label="Search customer"
            list="order-customer-options"
            onChange={(event) => setCustomerDraft(event.target.value)}
            value={customerDraft}
          />
          <datalist id="order-customer-options">
            {customers.map((customer) => (
              <option key={customer.id} value={customer.name} />
            ))}
          </datalist>
          {customersRequest.loading && (
            <p className="mt-1 text-xs text-slate-500" role="status">Loading customers…</p>
          )}
          {customersRequest.error && (
            <ErrorBox
              loading={customersRequest.loading}
              message={customersRequest.error.message}
              onRetry={customersRequest.reload}
            />
          )}
        </div>
        <Input
          disabled={ordersRequest.loading}
          inputMode="numeric"
          label="Salesman ID"
          min="1"
          onChange={(event) => setSalesmanDraft(event.target.value)}
          pattern="0*[1-9][0-9]*"
          placeholder="Filter by salesman ID"
          type="text"
          value={salesmanDraft}
        />
        <Input
          disabled={ordersRequest.loading}
          label="From"
          onChange={(event) => setFromDraft(event.target.value)}
          type="date"
          value={fromDraft}
        />
        <Input
          disabled={ordersRequest.loading}
          label="To"
          onChange={(event) => setToDraft(event.target.value)}
          type="date"
          value={toDraft}
        />
        <div className="flex items-end">
          <Button disabled={ordersRequest.loading || customersRequest.loading} type="submit">
            Apply filters
          </Button>
        </div>
        {filterError && (
          <p className="text-sm text-red-700 md:col-span-3" role="alert">{filterError}</p>
        )}
      </form>

      {ordersRequest.loading && (
        <p className="text-sm text-slate-600" role="status">Loading orders…</p>
      )}
      {ordersRequest.error && (
        <ErrorBox
          loading={ordersRequest.loading}
          message={ordersRequest.error.message}
          onRetry={ordersRequest.reload}
        />
      )}
      {!ordersRequest.loading && !ordersRequest.error && orders && orders.items.length === 0 && (
        <EmptyState title="No orders found" message="Try changing the filters or check again later." />
      )}
      {orders && orders.items.length > 0 && (
        <>
          <Table columns={columns} rows={orders.items} />
          {pageCount > 1 && (
            <fieldset className="min-w-0 border-0 p-0" disabled={ordersRequest.loading}>
              <Pagination page={orders.page} pages={pageCount} onPage={goToPage} />
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}
