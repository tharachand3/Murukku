import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { QueuePanel } from '../../components/salesman/QueuePanel.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { QtyStepper } from '../../components/ui/QtyStepper.jsx';
import { SearchSelect } from '../../components/ui/SearchSelect.jsx';
import { Textarea } from '../../components/ui/Textarea.jsx';
import { useOrderQueue } from '../../hooks/useOrderQueue.js';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { fieldErrors, toApiError } from '../../lib/apiError.js';
import { formatPaise } from '../../lib/money.js';
import { createClientRef, enqueue, list as listQueuedOrders } from '../../lib/orderQueue.js';

function customerLabel(customer) {
  return `${customer.name} (${customer.type})`;
}

function readArray(data, label) {
  if (!Array.isArray(data)) {
    throw new TypeError(`The server returned an invalid ${label} list`);
  }
  return data;
}

function clientErrorMessage(error) {
  return error?.message ?? 'Could not save this order offline.';
}

export default function NewOrderPage() {
  const queue = useOrderQueue();
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [quantities, setQuantities] = useState({});
  const [notes, setNotes] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitFields, setSubmitFields] = useState({});
  const [offlineMessage, setOfflineMessage] = useState('');
  const [success, setSuccess] = useState(null);
  const [pending, setPending] = useState(false);
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' || navigator.onLine
  ));
  const submitting = useRef(false);

  const customersRequest = useAsync(async () => {
    const { data } = await api.get('/customers', { params: { active: true } });
    return readArray(data, 'customer');
  }, []);

  const availabilityRequest = useAsync(async () => {
    const { data } = await api.get('/stock/finished-availability');
    return readArray(data, 'finished availability');
  }, []);

  useEffect(() => {
    const setOnline = () => setIsOnline(true);
    const setOffline = () => setIsOnline(false);
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOffline);
    return () => {
      window.removeEventListener('online', setOnline);
      window.removeEventListener('offline', setOffline);
    };
  }, []);

  useEffect(() => {
    if (customersRequest.data?.length === 1 && !selectedCustomerId) {
      setSelectedCustomerId(String(customersRequest.data[0].id));
    }
    if (selectedCustomerId && customersRequest.data
      && !customersRequest.data.some((customer) => String(customer.id) === selectedCustomerId)) {
      setSelectedCustomerId('');
    }
  }, [customersRequest.data, selectedCustomerId]);

  const loadCatalog = useCallback(async () => {
    if (!selectedCustomerId) return null;
    const { data } = await api.get('/catalog/order-items', {
      params: { customerId: Number(selectedCustomerId) }
    });
    const items = readArray(data, 'catalog');
    return {
      customerId: selectedCustomerId,
      items: items.filter((item) => item.type === undefined || item.type === 'FINISHED')
    };
  }, [selectedCustomerId]);
  const catalogRequest = useAsync(loadCatalog, [selectedCustomerId], {
    immediate: Boolean(selectedCustomerId)
  });

  const customers = customersRequest.data ?? [];
  const selectedCustomer = customers.find((customer) => String(customer.id) === selectedCustomerId);
  const catalog = catalogRequest.data?.customerId === selectedCustomerId
    ? catalogRequest.data.items
    : [];
  const stockByItemId = useMemo(
    () => new Map((availabilityRequest.data ?? []).map((item) => [item.itemId, item])),
    [availabilityRequest.data]
  );
  const selectedLines = catalog
    .filter((item) => Number.isSafeInteger(quantities[item.itemId]) && quantities[item.itemId] > 0)
    .map((item) => ({ ...item, qty: quantities[item.itemId] }));
  const totalPackets = selectedLines.reduce((total, line) => total + line.qty, 0);
  const taxableTotalPaise = selectedLines.reduce(
    (total, line) => total + BigInt(line.qty) * BigInt(line.pricePaise),
    0n
  );

  const changeQuantity = (itemId, quantity) => {
    setQuantities((current) => ({ ...current, [itemId]: quantity }));
    setSubmitError('');
    setSubmitFields({});
    setOfflineMessage('');
  };

  const saveOffline = (order) => {
    try {
      enqueue(order);
      queue.refresh();
      const pendingCount = listQueuedOrders()
        .filter((item) => item.state === 'PENDING' || item.state === 'SENDING').length;
      setOfflineMessage(`Saved offline - it will be sent when you are back online (${pendingCount} pending)`);
      setSubmitError('');
      setSubmitFields({});
    } catch (error) {
      setSubmitError(`Could not save this order offline: ${clientErrorMessage(error)}`);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting.current || !selectedCustomer || selectedLines.length === 0) return;

    submitting.current = true;
    setPending(true);
    setSubmitError('');
    setSubmitFields({});
    setOfflineMessage('');
    const order = {
      clientRef: createClientRef(),
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      lines: selectedLines.map((line) => ({
        itemId: line.itemId,
        name: line.name,
        qty: line.qty
      })),
      notes: notes.trim()
    };
    const body = {
      customerId: order.customerId,
      clientRef: order.clientRef,
      ...(order.notes ? { notes: order.notes } : {}),
      lines: order.lines.map(({ itemId, qty }) => ({ itemId, qty }))
    };

    try {
      if (!isOnline) {
        saveOffline(order);
        return;
      }
      const { data } = await api.post('/orders', body);
      const orderNo = data?.order?.orderNo;
      if (typeof orderNo !== 'string' || !orderNo) {
        throw new Error('The server response did not include an order number');
      }
      setSuccess({ orderNo, taxableTotalPaise: taxableTotalPaise.toString() });
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.isNetwork) {
        saveOffline(order);
      } else {
        setSubmitFields(apiError.status === 400 ? fieldErrors(apiError.details) : {});
        setSubmitError(apiError.message);
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const startNewOrder = () => {
    setQuantities({});
    setNotes('');
    setSubmitError('');
    setSubmitFields({});
    setOfflineMessage('');
    setSuccess(null);
  };

  if (success) {
    return (
      <div className="mx-auto max-w-2xl pb-24">
        <section className="rounded-xl border border-green-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-green-800">Order submitted</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{success.orderNo}</h1>
          <p className="mt-3 text-slate-700">Taxable total: {formatPaise(success.taxableTotalPaise)}</p>
          <p className="mt-1 text-sm text-slate-600">GST is added when the invoice is raised</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={startNewOrder}>New order</Button>
            <Link
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-800"
              to="/my-orders"
            >
              My orders
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-36">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">New order</h1>
        <p className="mt-1 text-sm text-slate-600">Choose a customer and enter packet quantities.</p>
      </header>

      {!isOnline && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          You are offline. Orders will be saved on this device.
        </p>
      )}
      {submitError && (
        <div className="mb-4 space-y-2" role="alert">
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{submitError}</p>
          {Object.entries(submitFields).map(([field, message]) => (
            <p className="text-sm text-red-800" key={field}>{field}: {message}</p>
          ))}
        </div>
      )}
      {offlineMessage && (
        <p className="mb-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900" role="status">
          {offlineMessage}
        </p>
      )}
      <QueuePanel queue={queue} />

      {availabilityRequest.loading && (
        <p className="mb-4 text-sm text-slate-600" role="status">Loading finished-stock availability…</p>
      )}
      {customersRequest.loading && (
        <p className="mb-4 text-sm text-slate-600" role="status">Loading customers…</p>
      )}
      {customersRequest.error && (
        <div className="mb-4">
          <ErrorBox message={customersRequest.error.message} onRetry={customersRequest.reload} />
        </div>
      )}
      {!customersRequest.loading && !customersRequest.error && customers.length === 0 && (
        <EmptyState title="No assigned customers" message="Ask an administrator to assign customers to your account." />
      )}

      {customers.length > 0 && (
        <form className="space-y-5" noValidate onSubmit={handleSubmit}>
          <SearchSelect
            error={submitFields.customerId}
            label="Customer"
            onChange={(event) => {
              const next = customers.find((customer) => customerLabel(customer) === event.target.value);
              setSelectedCustomerId(next ? String(next.id) : '');
              setQuantities({});
              setSubmitError('');
              setSubmitFields({});
              setOfflineMessage('');
            }}
            options={customers.map((customer) => ({
              value: customerLabel(customer),
              label: customerLabel(customer)
            }))}
            value={selectedCustomer ? customerLabel(selectedCustomer) : ''}
          />

          {availabilityRequest.error && (
            <ErrorBox
              message={availabilityRequest.error.message}
              onRetry={availabilityRequest.reload}
            />
          )}

          {selectedCustomerId && catalogRequest.loading && (
            <p className="text-sm text-slate-600" role="status">Loading products and prices…</p>
          )}
          {selectedCustomerId && catalogRequest.error && (
            <ErrorBox message={catalogRequest.error.message} onRetry={catalogRequest.reload} />
          )}
          {selectedCustomerId && !catalogRequest.loading && !catalogRequest.error && catalog.length === 0 && (
            <EmptyState title="No products available" message="There are no priced finished goods for this customer." />
          )}

          {catalog.length > 0 && (
            <section aria-label="Finished goods" className="space-y-3">
              {catalog.map((item) => {
                const qty = quantities[item.itemId] ?? 0;
                const stock = stockByItemId.get(item.itemId);
                const availablePackets = stock?.freePackets ?? stock?.availablePackets;
                const freePackets = Number.isSafeInteger(availablePackets)
                  ? Math.max(0, availablePackets)
                  : null;
                return (
                  <article className="rounded-xl border border-slate-200 bg-white p-4" key={item.itemId}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 className="font-semibold text-slate-900">{item.name}</h2>
                        <p className="mt-1 text-sm text-slate-600">{formatPaise(item.pricePaise)}</p>
                      </div>
                      <QtyStepper
                        label={`${item.name} quantity`}
                        max={100000}
                        onChange={(value) => changeQuantity(item.itemId, value)}
                        value={qty}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-800"
                        disabled={qty >= 99991}
                        onClick={() => changeQuantity(item.itemId, Math.min(100000, qty + 10))}
                        type="button"
                      >
                        +10
                      </button>
                      {freePackets !== null && qty > freePackets && (
                        <p className="text-sm text-amber-800">Low stock: {freePackets} free</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          )}

          <details className="rounded-lg border border-slate-200 bg-white p-4">
            <summary className="min-h-11 cursor-pointer py-2 font-medium text-slate-800">Optional notes</summary>
            <Textarea
              label="Notes"
              maxLength={500}
              onChange={(event) => setNotes(event.target.value)}
              value={notes}
            />
          </details>

          <section className="sticky bottom-16 z-20 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
              <span>{selectedLines.length} lines · {totalPackets} packets</span>
              <span className="font-semibold text-slate-900">{formatPaise(taxableTotalPaise.toString())}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">GST is added when the invoice is raised</p>
            <Button
              className="mt-3 w-full"
              disabled={!selectedCustomer || selectedLines.length === 0 || pending}
              loading={pending}
              minHeight44
              type="submit"
            >
              {pending ? 'Submitting…' : 'Submit order'}
            </Button>
          </section>
        </form>
      )}
    </div>
  );
}
