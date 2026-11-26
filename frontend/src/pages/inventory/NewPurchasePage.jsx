import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { toApiError, fieldErrors } from '../../lib/apiError.js';
import { todayIST } from '../../lib/date.js';
import { formatPaise } from '../../lib/money.js';
import { mulToPaise, parseDecimal, toBaseUnits, UNIT_BASE_FACTORS } from '../../lib/decimal.js';

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

function newLine(id) {
  return { id, itemId: '', qty: '', unit: '', ratePerUnitRupees: '', batchNo: '', expiryDate: '' };
}

export default function NewPurchasePage({ now = new Date() }) {
  const today = todayIST(now);
  const nextLineId = useRef(2);
  const [supplierId, setSupplierId] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([newLine(1)]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [savedPurchase, setSavedPurchase] = useState(null);
  const masterRequest = useAsync(async () => {
    const [supplierResponse, itemResponse] = await Promise.all([
      api.get('/suppliers?active=true'),
      api.get('/items?active=true')
    ]);
    return {
      suppliers: readArray(supplierResponse.data, 'supplier'),
      items: readArray(itemResponse.data, 'item')
        .filter((item) => item.type === 'RAW' || item.type === 'PACKAGING')
    };
  }, []);
  const suppliers = masterRequest.data?.suppliers ?? [];
  const items = masterRequest.data?.items ?? [];
  const itemsById = new Map(items.map((item) => [String(item.id), item]));
  const lineEstimates = lines.map((line) => {
    try {
      return estimateLine(line);
    } catch {
      return null;
    }
  });
  const estimatedTotal = lineEstimates.every((amount) => amount !== null)
    ? lineEstimates.reduce((total, amount) => total + BigInt(amount), 0n)
    : null;

  const updateLine = (id, patch) => {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  };

  const chooseItem = (line, itemId) => {
    const item = itemsById.get(itemId);
    const units = item ? (UNITS_BY_DIMENSION[item.baseUnit.dimension] ?? []) : [];
    const unit = item && units.includes(item.displayUnit.code)
      ? item.displayUnit.code
      : (units[0] ?? '');
    updateLine(line.id, { itemId, unit });
  };

  function estimateLine(line) {
    if (!line.itemId || !line.qty || !line.ratePerUnitRupees) return null;
    const factor = UNIT_BASE_FACTORS[line.unit];
    if (!factor) return null;
    return mulToPaise(line.qty, line.ratePerUnitRupees, {
      baseFactor: factor,
      unitFactor: factor
    });
  }

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitError(null);
    const supplier = suppliers.find((entry) => String(entry.id) === supplierId);
    if (!supplier) {
      setSubmitError({ message: 'Choose an active supplier.', fields: {} });
      return;
    }
    if (!purchaseDate || purchaseDate > today) {
      setSubmitError({ message: 'Purchase date must be today or earlier.', fields: {} });
      return;
    }
    if (lines.length === 0) {
      setSubmitError({ message: 'Add at least one purchase line.', fields: {} });
      return;
    }

    let payloadLines;
    try {
      payloadLines = lines.map((line) => {
        const item = itemsById.get(line.itemId);
        if (!item) throw new TypeError('Choose an active RAW or PACKAGING item for every line.');
        const allowedUnits = UNITS_BY_DIMENSION[item.baseUnit.dimension] ?? [];
        if (!allowedUnits.includes(line.unit)) {
          throw new TypeError(`Choose a ${item.baseUnit.dimension.toLowerCase()} unit for ${item.name}.`);
        }
        toBaseUnits(line.qty, UNIT_BASE_FACTORS[line.unit]);
        const rate = parseDecimal(line.ratePerUnitRupees);
        if (rate.n < 0n) throw new RangeError('Rate cannot be negative.');
        estimateLine(line);
        return {
          itemId: item.id,
          qty: line.qty.trim(),
          unit: line.unit,
          ratePerUnitRupees: line.ratePerUnitRupees.trim(),
          ...(line.batchNo.trim() ? { batchNo: line.batchNo.trim() } : {}),
          ...(line.expiryDate ? { expiryDate: line.expiryDate } : {})
        };
      });
    } catch (error) {
      setSubmitError({ message: error.message, fields: {} });
      return;
    }

    const payload = {
      supplierId: supplier.id,
      purchaseDate,
      ...(supplierInvoiceNo.trim() ? { supplierInvoiceNo: supplierInvoiceNo.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      lines: payloadLines
    };
    setSubmitting(true);
    try {
      const { data } = await api.post('/purchases', payload);
      setSavedPurchase(data);
    } catch (error) {
      const apiError = toApiError(error);
      setSubmitError({
        message: apiError.message,
        fields: fieldErrors(apiError.details)
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (masterRequest.loading) return <Spinner label="Loading purchase form" />;
  if (masterRequest.error) {
    return <ErrorBox message={masterRequest.error.message} onRetry={masterRequest.reload} />;
  }
  if (savedPurchase) {
    return (
      <main className="mx-auto max-w-4xl space-y-5 pb-8">
        <header>
          <h1 className="text-2xl font-bold text-slate-900">Purchase recorded</h1>
          <p className="mt-1 text-sm text-slate-600">Saved values below are returned by the server.</p>
        </header>
        <section className="space-y-4 rounded-xl border border-green-200 bg-white p-5">
          <p className="text-xl font-semibold text-green-800">{savedPurchase.number}</p>
          <p className="text-lg font-semibold">Server total: {formatPaise(savedPurchase.totalPaise)}</p>
          <div className="space-y-2">
            {savedPurchase.lines.map((line) => (
              <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-2" key={line.id}>
                <span>{line.item.name} · {line.qtyDisplay} · {line.rateDisplay}</span>
                <span>{formatPaise(line.amountPaise)}</span>
              </div>
            ))}
          </div>
          <Link className="font-medium text-blue-800 underline" to="/purchases">View purchases</Link>
        </section>
      </main>
    );
  }

  const serverFields = submitError?.fields ?? {};

  return (
    <main className="mx-auto max-w-5xl space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">New purchase</h1>
        <p className="mt-1 text-sm text-slate-600">Estimates are for guidance; saved amounts come from the server.</p>
      </header>
      {(suppliers.length === 0 || items.length === 0) && (
        <EmptyState
          message={suppliers.length === 0
            ? 'An active supplier is required to record a purchase.'
            : 'No active RAW or PACKAGING items are available to purchase.'}
          title="Purchase setup incomplete"
        />
      )}
      <form className="space-y-5" onSubmit={submit}>
        {submitError && (
          <div>
            <ErrorBox message={submitError.message} />
            {Object.entries(serverFields).map(([field, message]) => (
              <p className="mt-1 text-sm text-red-700" key={field}>{field}: {message}</p>
            ))}
          </div>
        )}
        <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
          <Select
            error={serverFields.supplierId}
            label="Supplier"
            onChange={(event) => setSupplierId(event.target.value)}
            required
            value={supplierId}
          >
            <option value="">Choose supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </Select>
          <Input
            error={serverFields.purchaseDate}
            label="Purchase date"
            max={today}
            onChange={(event) => {
              const value = event.target.value;
              setPurchaseDate(value);
              setSubmitError(value > today
                ? { message: 'Purchase date must be today or earlier.', fields: {} }
                : null);
            }}
            required
            type="date"
            value={purchaseDate}
          />
          <Input
            error={serverFields.supplierInvoiceNo}
            label="Supplier invoice number"
            onChange={(event) => setSupplierInvoiceNo(event.target.value)}
            value={supplierInvoiceNo}
          />
          <Input label="Notes" onChange={(event) => setNotes(event.target.value)} value={notes} />
        </section>

        {lines.length === 0 ? (
          <EmptyState title="No purchase lines" message="Add at least one item to continue." />
        ) : (
          <section className="space-y-4">
            <p className="text-right font-semibold" role="status">
              Estimated total: {estimatedTotal === null ? '—' : formatPaise(estimatedTotal.toString())}
            </p>
            {lines.map((line, index) => {
              const item = itemsById.get(line.itemId);
              const unitOptions = item ? (UNITS_BY_DIMENSION[item.baseUnit.dimension] ?? []) : [];
              let estimate = lineEstimates[index];
              let estimateError = '';
              try {
                if (line.qty && line.ratePerUnitRupees) estimateLine(line);
              } catch (error) {
                estimateError = error.message;
              }
              return (
                <fieldset className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2 lg:grid-cols-3" key={line.id}>
                  <legend className="px-2 font-semibold">Line {index + 1}</legend>
                  <Select
                    error={serverFields[`lines.${index}.itemId`]}
                    label="Item"
                    onChange={(event) => chooseItem(line, event.target.value)}
                    required
                    value={line.itemId}
                  >
                    <option value="">Choose item</option>
                    {items.map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.name} ({entry.type})</option>
                    ))}
                  </Select>
                  <Input
                    error={serverFields[`lines.${index}.qty`]}
                    inputMode="decimal"
                    label="Quantity"
                    onChange={(event) => updateLine(line.id, { qty: event.target.value })}
                    required
                    type="text"
                    value={line.qty}
                  />
                  <Select
                    label="Unit"
                    onChange={(event) => updateLine(line.id, { unit: event.target.value })}
                    required
                    value={line.unit}
                  >
                    {unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </Select>
                  <Input
                    error={serverFields[`lines.${index}.ratePerUnitRupees`]}
                    inputMode="decimal"
                    label="Rate per unit (Rs)"
                    onChange={(event) => updateLine(line.id, { ratePerUnitRupees: event.target.value })}
                    required
                    type="text"
                    value={line.ratePerUnitRupees}
                  />
                  <Input
                    label="Batch number (optional)"
                    onChange={(event) => updateLine(line.id, { batchNo: event.target.value })}
                    value={line.batchNo}
                  />
                  <Input
                    label="Expiry date (optional)"
                    onChange={(event) => updateLine(line.id, { expiryDate: event.target.value })}
                    type="date"
                    value={line.expiryDate}
                  />
                  <p className="self-end text-sm text-slate-700" role="status">
                    Estimated amount: {estimate === null ? '—' : formatPaise(estimate)}
                    {estimateError && <span className="block text-red-700">{estimateError}</span>}
                  </p>
                  <Button
                    disabled={submitting}
                    onClick={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}
                    type="button"
                    variant="secondary"
                  >
                    Remove line
                  </Button>
                </fieldset>
              );
            })}
          </section>
        )}

        <div className="flex flex-wrap justify-between gap-3">
          <Button
            disabled={submitting}
            onClick={() => {
              const id = nextLineId.current;
              nextLineId.current += 1;
              setLines((current) => [...current, newLine(id)]);
            }}
            type="button"
            variant="secondary"
          >
            Add line
          </Button>
          <Button disabled={submitting || suppliers.length === 0 || items.length === 0} loading={submitting} type="submit">
            Save purchase
          </Button>
        </div>
      </form>
    </main>
  );
}
