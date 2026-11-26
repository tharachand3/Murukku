import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../../components/ui/ErrorBox.jsx';
import { Input } from '../../../components/ui/Input.jsx';
import { Pagination } from '../../../components/ui/Pagination.jsx';
import { Select } from '../../../components/ui/Select.jsx';
import { Table } from '../../../components/ui/Table.jsx';
import { useAsync } from '../../../hooks/useAsync.js';
import { api } from '../../../lib/api.js';
import { formatDateTimeIST } from '../../../lib/date.js';
import { formatPaise } from '../../../lib/money.js';

const PAGE_SIZE = 20;
const MODES = ['CASH', 'UPI', 'BANK', 'CHEQUE'];

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

function paymentColumns() {
  return [
    { key: 'receiptNo', label: 'Receipt' },
    {
      key: 'paymentDate',
      label: 'Date (IST)',
      render: (payment) => formatDateTimeIST(payment.paymentDate)
    },
    { key: 'customer', label: 'Customer', render: (payment) => payment.customer.name },
    {
      key: 'invoice',
      label: 'Invoice',
      render: (payment) => payment.invoice?.invoiceNo ?? 'Unallocated'
    },
    { key: 'amountPaise', label: 'Amount', render: (payment) => formatPaise(payment.amountPaise) },
    { key: 'mode', label: 'Mode' },
    { key: 'reference', label: 'Reference', render: (payment) => payment.reference ?? '—' }
  ];
}

export default function PaymentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modeDraft, setModeDraft] = useState('');
  const [customerDraft, setCustomerDraft] = useState('');
  const [fromDraft, setFromDraft] = useState('');
  const [toDraft, setToDraft] = useState('');
  const [filterError, setFilterError] = useState('');
  const customersRequest = useAsync(async () => {
    const { data } = await api.get('/customers');
    return readArray(data, 'customer');
  }, []);

  const mode = searchParams.get('mode') ?? '';
  const customerId = searchParams.get('customerId') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const page = positiveInteger(searchParams.get('page') ?? '1') ?? 1;
  const params = { page, limit: PAGE_SIZE };
  if (mode) params.mode = mode;
  if (customerId) params.customerId = customerId;
  if (from) params.from = from;
  if (to) params.to = to;
  const queryKey = JSON.stringify(params);
  const paymentsRequest = useAsync(async () => {
    const { data } = await api.get('/payments', { params });
    if (!Array.isArray(data?.items)) {
      throw new TypeError('The server returned an invalid payment list');
    }
    return { ...data, queryKey };
  }, [queryKey]);
  const payments = paymentsRequest.data?.queryKey === queryKey ? paymentsRequest.data : null;
  const customers = customersRequest.data ?? [];

  useEffect(() => {
    setModeDraft(mode);
    setFromDraft(from);
    setToDraft(to);
    setFilterError('');
  }, [searchParams.toString()]);

  useEffect(() => {
    if (!customersRequest.data) return;
    const selected = customers.find((customer) => String(customer.id) === customerId);
    setCustomerDraft(selected?.name ?? '');
  }, [customerId, customersRequest.data]);

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
    if (modeDraft && !MODES.includes(modeDraft)) {
      setFilterError('Choose a valid payment mode.');
      return;
    }
    if (fromDraft && toDraft && fromDraft > toDraft) {
      setFilterError('The start date must be on or before the end date.');
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete('mode');
    next.delete('customerId');
    next.delete('from');
    next.delete('to');
    next.set('page', '1');
    if (modeDraft) next.set('mode', modeDraft);
    if (matches.length === 1) next.set('customerId', String(matches[0].id));
    if (fromDraft) next.set('from', fromDraft);
    if (toDraft) next.set('to', toDraft);
    setFilterError('');
    setSearchParams(next);
  };

  const goToPage = (nextPage) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(nextPage));
    setSearchParams(next);
  };
  const pages = payments ? Math.max(1, Math.ceil(payments.total / payments.limit)) : 1;

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
          <p className="mt-1 text-sm text-slate-600">Receipts matching the selected filters.</p>
        </div>
        <Button
          disabled={paymentsRequest.loading}
          loading={paymentsRequest.loading}
          onClick={paymentsRequest.reload}
          variant="secondary"
        >
          Refresh
        </Button>
      </header>

      <form
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4"
        onSubmit={applyFilters}
      >
        <Select
          disabled={paymentsRequest.loading}
          label="Payment mode"
          onChange={(event) => setModeDraft(event.target.value)}
          value={modeDraft}
        >
          <option value="">All modes</option>
          {MODES.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        <div>
          <Input
            disabled={customersRequest.loading || paymentsRequest.loading}
            id="payment-customer-filter"
            label="Customer"
            list="payment-customer-options"
            onChange={(event) => setCustomerDraft(event.target.value)}
            value={customerDraft}
          />
          <datalist id="payment-customer-options">
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
          disabled={paymentsRequest.loading}
          label="From"
          onChange={(event) => setFromDraft(event.target.value)}
          type="date"
          value={fromDraft}
        />
        <Input
          disabled={paymentsRequest.loading}
          label="To"
          onChange={(event) => setToDraft(event.target.value)}
          type="date"
          value={toDraft}
        />
        <div className="flex items-end md:col-span-4">
          <Button
            disabled={paymentsRequest.loading || customersRequest.loading}
            type="submit"
          >
            Apply filters
          </Button>
        </div>
        {filterError && (
          <p className="text-sm text-red-700 md:col-span-4" role="alert">{filterError}</p>
        )}
      </form>

      {paymentsRequest.loading && (
        <p className="text-sm text-slate-600" role="status">Loading payments…</p>
      )}
      {paymentsRequest.error && (
        <ErrorBox
          loading={paymentsRequest.loading}
          message={paymentsRequest.error.message}
          onRetry={paymentsRequest.reload}
        />
      )}
      {!paymentsRequest.loading && !paymentsRequest.error && payments && (
        <p className="font-semibold text-slate-900">
          Total for filtered payments: {formatPaise(payments.totalAmountPaise)}
        </p>
      )}
      {!paymentsRequest.loading && !paymentsRequest.error && payments?.items.length === 0 && (
        <EmptyState title="No payments found" message="Try changing the filters or check again later." />
      )}
      {payments?.items.length > 0 && (
        <>
          <Table columns={paymentColumns()} rows={payments.items} />
          {pages > 1 && (
            <fieldset className="min-w-0 border-0 p-0" disabled={paymentsRequest.loading}>
              <Pagination page={payments.page} pages={pages} onPage={goToPage} />
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}
