import { useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { toApiError, fieldErrors } from '../../lib/apiError.js';
import { toBaseUnits, UNIT_BASE_FACTORS } from '../../lib/decimal.js';

const REASONS = ['DAMAGE', 'EXPIRY', 'COUNT_CORRECTION', 'SPILLAGE', 'OTHER'];
const UNITS_BY_DIMENSION = {
  MASS: ['kg', 'g'],
  VOLUME: ['l', 'ml'],
  COUNT: ['pcs', 'packet']
};

function readArray(data, label) {
  if (!Array.isArray(data)) {
    throw new TypeError(`The server returned an invalid ${label} list`);
  }
  return data;
}

export default function AdjustmentsPage() {
  const { user } = useAuth();
  const canAdjust = ['ADMIN', 'PRODUCTION'].includes(user?.role);
  const [itemId, setItemId] = useState('');
  const [direction, setDirection] = useState('OUT');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [reason, setReason] = useState('DAMAGE');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [savedAdjustment, setSavedAdjustment] = useState(null);
  const itemsRequest = useAsync(async () => {
    const { data } = await api.get('/items?active=true');
    return readArray(data, 'item');
  }, []);
  const stockRequest = useAsync(async () => {
    const { data } = await api.get('/stock/summary');
    return readArray(data, 'stock');
  }, []);
  const adjustmentsRequest = useAsync(async () => {
    const { data } = await api.get('/stock/adjustments', { params: { page: 1, limit: 20 } });
    return readArray(data?.items, 'adjustment');
  }, []);
  const items = itemsRequest.data ?? [];
  const stock = stockRequest.data ?? [];
  const adjustments = adjustmentsRequest.data ?? [];
  const selectedItem = items.find((item) => String(item.id) === itemId);
  const selectedStock = stock.find((entry) => String(entry.itemId) === itemId);
  const unitOptions = selectedItem
    ? (UNITS_BY_DIMENSION[selectedItem.baseUnit.dimension] ?? [])
    : [];
  const failure = itemsRequest.error ?? stockRequest.error ?? adjustmentsRequest.error;

  let baseQuantity = null;
  let quantityError = '';
  if (qty && unit && UNIT_BASE_FACTORS[unit]) {
    try {
      baseQuantity = toBaseUnits(qty, UNIT_BASE_FACTORS[unit]);
    } catch (error) {
      quantityError = error.message;
    }
  }
  const warnsShortage = direction === 'OUT'
    && baseQuantity !== null
    && selectedStock
    && baseQuantity > selectedStock.balanceBase;

  const chooseItem = (nextItemId) => {
    const item = items.find((entry) => String(entry.id) === nextItemId);
    const options = item ? (UNITS_BY_DIMENSION[item.baseUnit.dimension] ?? []) : [];
    setItemId(nextItemId);
    setUnit(item && options.includes(item.displayUnit.code) ? item.displayUnit.code : (options[0] ?? ''));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitError(null);
    setSavedAdjustment(null);
    if (!selectedItem) {
      setSubmitError({ message: 'Choose an active item.', fields: {} });
      return;
    }
    if (!unitOptions.includes(unit)) {
      setSubmitError({ message: 'Choose a unit matching the selected item.', fields: {} });
      return;
    }
    try {
      toBaseUnits(qty, UNIT_BASE_FACTORS[unit]);
    } catch (error) {
      setSubmitError({ message: error.message, fields: {} });
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post('/stock/adjustments', {
        itemId: selectedItem.id,
        direction,
        qty: qty.trim(),
        unit,
        reason,
        ...(note.trim() ? { note: note.trim() } : {})
      });
      setSavedAdjustment(data);
      setQty('');
      setNote('');
      stockRequest.reload();
      adjustmentsRequest.reload();
    } catch (error) {
      const apiError = toApiError(error);
      const shortBy = apiError.code === 'INSUFFICIENT_STOCK'
        && Number.isSafeInteger(apiError.details?.shortBy)
        ? ` Short by ${apiError.details.shortBy} base units.`
        : '';
      setSubmitError({
        message: `${apiError.message}${shortBy}`,
        fields: fieldErrors(apiError.details)
      });
    } finally {
      setSubmitting(false);
    }
  };

  const retry = () => {
    itemsRequest.reload();
    stockRequest.reload();
    adjustmentsRequest.reload();
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Stock adjustments</h1>
        <p className="mt-1 text-sm text-slate-600">Corrections are recorded as new ledger movements.</p>
      </header>

      {(itemsRequest.loading || stockRequest.loading || adjustmentsRequest.loading) && (
        <Spinner label="Loading adjustment data" />
      )}
      {failure && <ErrorBox message={failure.message} onRetry={retry} />}

      {savedAdjustment && (
        <section className="rounded-xl border border-green-200 bg-green-50 p-4" role="status">
          <p className="font-semibold text-green-900">
            {savedAdjustment.number} recorded. Balance: {savedAdjustment.balanceAfterDisplay}.
          </p>
        </section>
      )}

      {canAdjust && !itemsRequest.loading && !itemsRequest.error && (
        <form className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" onSubmit={submit}>
          <h2 className="text-lg font-semibold">Record adjustment</h2>
          {submitError && (
            <div role="alert">
              <ErrorBox message={submitError.message} />
              {Object.entries(submitError.fields ?? {}).map(([field, message]) => (
                <p className="mt-1 text-sm text-red-700" key={field}>{field}: {message}</p>
              ))}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Select label="Item" onChange={(event) => chooseItem(event.target.value)} required value={itemId}>
              <option value="">Choose item</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.type})</option>)}
            </Select>
            <Select label="Direction" onChange={(event) => setDirection(event.target.value)} value={direction}>
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
            </Select>
            <Input
              error={quantityError}
              inputMode="decimal"
              label="Quantity"
              onChange={(event) => setQty(event.target.value)}
              required
              type="text"
              value={qty}
            />
            <Select label="Unit" onChange={(event) => setUnit(event.target.value)} required value={unit}>
              {unitOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
            <Select label="Reason" onChange={(event) => setReason(event.target.value)} required value={reason}>
              {REASONS.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
            </Select>
            <Input label="Note" onChange={(event) => setNote(event.target.value)} value={note} />
          </div>
          <p className="text-sm text-slate-700">
            Current balance: {selectedStock?.balanceDisplay ?? (selectedItem ? 'Loading balance…' : 'Choose an item')}
          </p>
          {warnsShortage && (
            <p className="text-sm font-medium text-amber-800" role="alert">
              This OUT adjustment is above the current balance. The server will reject insufficient stock.
            </p>
          )}
          <Button disabled={submitting || !selectedStock} loading={submitting} type="submit">
            Save adjustment
          </Button>
        </form>
      )}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Recent adjustments</h2>
        {!adjustmentsRequest.loading && !adjustmentsRequest.error && adjustments.length === 0 && (
          <EmptyState message="No stock adjustments have been recorded." title="No adjustments" />
        )}
        {!adjustmentsRequest.loading && !adjustmentsRequest.error && adjustments.length > 0 && (
          <Table
            columns={[
              { key: 'number', label: 'Adjustment' },
              { key: 'item', label: 'Item', render: (row) => row.item.name },
              { key: 'direction', label: 'Direction' },
              { key: 'qtyDisplay', label: 'Quantity' },
              { key: 'reason', label: 'Reason' },
              { key: 'user', label: 'User', render: (row) => row.createdBy?.name ?? '—' }
            ]}
            rows={adjustments}
          />
        )}
      </section>
    </main>
  );
}
