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
import { formatDateIST } from '../../../lib/date.js';
import { formatPaise } from '../../../lib/money.js';

const PAGE_SIZE = 20;
const STATUSES = [
  ['Posted', 'POSTED'],
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

function invoiceColumns() {
  return [
    {
      key: 'invoiceNo',
      label: 'Invoice',
      render: (invoice) => (
        <Link className="font-medium text-blue-800 underline" to={`/invoices/${invoice.id}`}>
          {invoice.invoiceNo}
        </Link>
      )
    },
    {
      key: 'issueDate',
      label: 'Date (IST)',
      render: (invoice) => formatDateIST(invoice.issueDate)
    },
    { key: 'customer', label: 'Customer', render: (invoice) => invoice.customer.name },
    {
      key: 'taxableValuePaise',
      label: 'Taxable',
      render: (invoice) => formatPaise(invoice.taxableValuePaise)
    },
    {
      key: 'gst',
      label: 'GST',
      render: (invoice) => formatPaise(
        invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise
      )
    },
    {
      key: 'totalPaise',
      label: 'Total',
      render: (invoice) => formatPaise(invoice.totalPaise)
    },
    {
      key: 'status',
      label: 'Status',
      render: (invoice) => <StatusBadge status={invoice.status} />
    }
  ];
}

export default function InvoicesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusDraft, setStatusDraft] = useState('ALL');
  const [customerDraft, setCustomerDraft] = useState('');
  const [fromDraft, setFromDraft] = useState('');
  const [toDraft, setToDraft] = useState('');
  const [queryDraft, setQueryDraft] = useState('');
  const [filterError, setFilterError] = useState('');
  const customersRequest = useAsync(async () => {
    const { data } = await api.get('/customers');
    return readArray(data, 'customer');
  }, []);

  const status = searchParams.get('status') ?? 'ALL';
  const customerId = searchParams.get('customerId') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const q = searchParams.get('q') ?? '';
  const page = positiveInteger(searchParams.get('page') ?? '1') ?? 1;
  const params = { page, limit: PAGE_SIZE };
  if (status !== 'ALL') params.status = status;
  if (customerId) params.customerId = customerId;
  if (from) params.from = from;
  if (to) params.to = to;
  if (q) params.q = q;
  const queryKey = JSON.stringify(params);
  const invoicesRequest = useAsync(async () => {
    const { data } = await api.get('/invoices', { params });
    if (!Array.isArray(data?.items)) {
      throw new TypeError('The server returned an invalid invoice list');
    }
    return { ...data, queryKey };
  }, [queryKey]);
  const invoices = invoicesRequest.data?.queryKey === queryKey ? invoicesRequest.data : null;
  const customers = customersRequest.data ?? [];
  const customerIdParam = customerId;

  useEffect(() => {
    setStatusDraft(status);
    setFromDraft(from);
    setToDraft(to);
    setQueryDraft(q);
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
    const matches = typedCustomer
      ? customers.filter((customer) => (
        customer.name.toLocaleLowerCase() === typedCustomer.toLocaleLowerCase()
      ))
      : [];
    if (typedCustomer && matches.length !== 1) {
      setFilterError('Choose a customer from the suggestions or clear the customer search.');
      return;
    }
    if (fromDraft && toDraft && fromDraft > toDraft) {
      setFilterError('The start date must be on or before the end date.');
      return;
    }
    if (statusDraft !== 'ALL' && !STATUSES.some(([, value]) => value === statusDraft)) {
      setFilterError('Choose a valid invoice status.');
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete('status');
    next.delete('customerId');
    next.delete('from');
    next.delete('to');
    next.delete('q');
    next.set('page', '1');
    if (statusDraft !== 'ALL') next.set('status', statusDraft);
    if (matches.length === 1) next.set('customerId', String(matches[0].id));
    if (fromDraft) next.set('from', fromDraft);
    if (toDraft) next.set('to', toDraft);
    if (queryDraft.trim()) next.set('q', queryDraft.trim());
    setFilterError('');
    setSearchParams(next);
  };

  const goToPage = (nextPage) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(nextPage));
    setSearchParams(next);
  };
  const pages = invoices ? Math.max(1, Math.ceil(invoices.total / invoices.limit)) : 1;

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Invoices</h1>
          <p className="mt-1 text-sm text-slate-600">GST invoices and credit-note status.</p>
        </div>
        <Button
          disabled={invoicesRequest.loading}
          loading={invoicesRequest.loading}
          onClick={invoicesRequest.reload}
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
          disabled={invoicesRequest.loading}
          label="Status"
          onChange={(event) => setStatusDraft(event.target.value)}
          value={statusDraft}
        >
          <option value="ALL">All statuses</option>
          {STATUSES.map(([label, value]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <div>
          <Input
            disabled={customersRequest.loading || invoicesRequest.loading}
            id="invoice-customer-filter"
            label="Customer"
            list="invoice-customer-options"
            onChange={(event) => setCustomerDraft(event.target.value)}
            value={customerDraft}
          />
          <datalist id="invoice-customer-options">
            {customers.map((customer) => (
              <option key={customer.id} value={customer.name} />
            ))}
          </datalist>
          {customersRequest.error && (
            <ErrorBox
              loading={customersRequest.loading}
              message={customersRequest.error.message}
              onRetry={customersRequest.reload}
            />
          )}
        </div>
        <Input
          disabled={invoicesRequest.loading}
          label="Invoice number"
          onChange={(event) => setQueryDraft(event.target.value)}
          value={queryDraft}
        />
        <Input
          disabled={invoicesRequest.loading}
          label="From"
          onChange={(event) => setFromDraft(event.target.value)}
          type="date"
          value={fromDraft}
        />
        <Input
          disabled={invoicesRequest.loading}
          label="To"
          onChange={(event) => setToDraft(event.target.value)}
          type="date"
          value={toDraft}
        />
        <div className="flex items-end">
          <Button
            disabled={invoicesRequest.loading || customersRequest.loading}
            type="submit"
          >
            Apply filters
          </Button>
        </div>
        {filterError && (
          <p className="text-sm text-red-700 md:col-span-3" role="alert">{filterError}</p>
        )}
      </form>

      {invoicesRequest.loading && (
        <p className="text-sm text-slate-600" role="status">Loading invoices…</p>
      )}
      {invoicesRequest.error && (
        <ErrorBox
          loading={invoicesRequest.loading}
          message={invoicesRequest.error.message}
          onRetry={invoicesRequest.reload}
        />
      )}
      {!invoicesRequest.loading && !invoicesRequest.error && invoices?.items.length === 0 && (
        <EmptyState title="No invoices found" message="Try changing the filters or check again later." />
      )}
      {invoices?.items.length > 0 && (
        <>
          <Table columns={invoiceColumns()} rows={invoices.items} />
          {pages > 1 && (
            <fieldset className="min-w-0 border-0 p-0" disabled={invoicesRequest.loading}>
              <Pagination page={invoices.page} pages={pages} onPage={goToPage} />
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}
