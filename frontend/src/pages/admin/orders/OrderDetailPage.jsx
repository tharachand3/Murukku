import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button.jsx';
import { Card } from '../../../components/ui/Card.jsx';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../../components/ui/ErrorBox.jsx';
import { Input } from '../../../components/ui/Input.jsx';
import { Modal } from '../../../components/ui/Modal.jsx';
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx';
import { Textarea } from '../../../components/ui/Textarea.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useAsync } from '../../../hooks/useAsync.js';
import { api } from '../../../lib/api.js';
import { fieldErrors, toApiError } from '../../../lib/apiError.js';
import { formatDateTimeIST } from '../../../lib/date.js';
import { formatPaise, parseRupeesToPaise, paiseToInput } from '../../../lib/money.js';
import OrderInvoiceActions from './OrderInvoiceActions.jsx';

function readOrder(data) {
  if (!Array.isArray(data?.lines)) {
    throw new TypeError('The server returned an invalid order');
  }
  return data;
}

function readAvailability(data) {
  if (!Array.isArray(data?.lines)) {
    throw new TypeError('The server returned invalid order availability');
  }
  return data;
}

function initialDrafts(lines) {
  return Object.fromEntries(lines.map((line) => [
    line.lineId,
    {
      approvedQty: String(line.approvedQty ?? line.qty),
      approvedPrice: paiseToInput(line.approvedPricePaise ?? line.pricePaise)
    }
  ]));
}

function parsedQuantity(value) {
  if (!/^\d+$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity <= 100000 ? quantity : null;
}

function validateApproval(lines, drafts) {
  const fieldErrorsByLine = {};
  const overrides = [];
  for (const [index, line] of lines.entries()) {
    const draft = drafts[line.lineId] ?? {
      approvedQty: String(line.approvedQty ?? line.qty),
      approvedPrice: paiseToInput(line.approvedPricePaise ?? line.pricePaise)
    };
    const qty = parsedQuantity(draft.approvedQty);
    if (qty === null) {
      fieldErrorsByLine[`${line.lineId}.approvedQty`] = 'Enter a whole quantity from 0 to 100000.';
    }
    let pricePaise = null;
    try {
      pricePaise = parseRupeesToPaise(draft.approvedPrice);
    } catch {
      fieldErrorsByLine[`${line.lineId}.approvedPrice`] = 'Enter a valid rupee amount.';
    }
    if (pricePaise !== null && (pricePaise < 1 || pricePaise > 10000000)) {
      fieldErrorsByLine[`${line.lineId}.approvedPrice`] = 'Price must be between Rs 0.01 and Rs 100,000.00.';
    }
    if (qty !== null && pricePaise !== null
      && pricePaise >= 1 && pricePaise <= 10000000) {
      overrides.push({ lineId: line.lineId, approvedQty: qty, approvedPricePaise: pricePaise });
    } else {
      fieldErrorsByLine[`line-${index}`] = 'Check the quantity and price for this line.';
    }
  }
  return { errors: fieldErrorsByLine, overrides };
}

function lineTotal(lines, drafts) {
  let total = 0n;
  for (const line of lines) {
    const draft = drafts[line.lineId] ?? {
      approvedQty: String(line.approvedQty ?? line.qty),
      approvedPrice: paiseToInput(line.approvedPricePaise ?? line.pricePaise)
    };
    const qty = parsedQuantity(draft.approvedQty);
    let pricePaise;
    try {
      pricePaise = parseRupeesToPaise(draft.approvedPrice);
    } catch {
      return null;
    }
    if (qty === null || pricePaise < 1 || pricePaise > 10000000) return null;
    total += BigInt(qty) * BigInt(pricePaise);
  }
  return total;
}

function roleFieldError(errors, lineIndex, field, lineId) {
  return errors[`${lineId}.${field}`]
    ?? errors[`lines.${lineIndex}.${field}`]
    ?? errors[`lines.${lineIndex}.${field === 'approvedPrice' ? 'approvedPricePaise' : field}`];
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const canReadAvailability = isAdmin || user?.role === 'OWNER';
  const orderRequest = useAsync(async () => {
    const { data } = await api.get(`/orders/${id}`);
    return readOrder(data);
  }, [id]);
  const availabilityRequest = useAsync(async () => {
    const { data } = await api.get(`/orders/${id}/availability`);
    return readAvailability(data);
  }, [id], { immediate: canReadAvailability });
  const order = orderRequest.data;
  const [drafts, setDrafts] = useState({});
  const [fieldIssues, setFieldIssues] = useState({});
  const [operationError, setOperationError] = useState('');
  const [insufficientStock, setInsufficientStock] = useState(null);
  const [actionSuccess, setActionSuccess] = useState('');
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const pendingRef = useRef(false);

  useEffect(() => {
    if (order) setDrafts(initialDrafts(order.lines));
  }, [order]);

  const totalPaise = useMemo(
    () => order ? lineTotal(order.lines, drafts) : null,
    [order, drafts]
  );
  const availability = availabilityRequest.data;
  const availabilityByLine = useMemo(
    () => new Map((availability?.lines ?? []).map((line) => [line.lineId, line])),
    [availability]
  );
  const editable = isAdmin && order?.status === 'SUBMITTED';
  const approvedBy = order?.timeline?.find((entry) => entry.action === 'APPROVE');

  const reload = () => {
    orderRequest.reload();
    if (canReadAvailability) availabilityRequest.reload();
  };

  const startApproval = () => {
    if (!order || pendingRef.current) return;
    const validation = validateApproval(order.lines, drafts);
    setFieldIssues(validation.errors);
    setOperationError('');
    setInsufficientStock(null);
    if (Object.keys(validation.errors).length > 0) return;
    setApproveOpen(true);
  };

  const approve = async () => {
    if (!order || pendingRef.current) return;
    const validation = validateApproval(order.lines, drafts);
    setFieldIssues(validation.errors);
    if (Object.keys(validation.errors).length > 0) {
      setApproveOpen(false);
      return;
    }
    pendingRef.current = true;
    setPendingAction('approve');
    setOperationError('');
    setInsufficientStock(null);
    try {
      const { data } = await api.post(`/orders/${id}/approve`, { lines: validation.overrides });
      orderRequest.setData(readOrder(data));
      setApproveOpen(false);
      setActionSuccess('Order approved.');
      reload();
    } catch (error) {
      const apiError = toApiError(error);
      setApproveOpen(false);
      setOperationError(apiError.message);
      if (apiError.code === 'INSUFFICIENT_STOCK') {
        const details = apiError.details;
        if (Array.isArray(details?.lines)) {
          setInsufficientStock(details);
          availabilityRequest.setData(details);
        }
      }
      const serverFields = fieldErrors(apiError.details);
      if (Object.keys(serverFields).length > 0) setFieldIssues(serverFields);
    } finally {
      pendingRef.current = false;
      setPendingAction('');
    }
  };

  const reject = async (event) => {
    event.preventDefault();
    if (!order || pendingRef.current) return;
    const reason = rejectReason.trim();
    if (reason.length < 3 || reason.length > 300) {
      setRejectError('Enter a rejection reason between 3 and 300 characters.');
      return;
    }
    pendingRef.current = true;
    setPendingAction('reject');
    setRejectError('');
    setOperationError('');
    try {
      const { data } = await api.post(`/orders/${id}/reject`, { reason });
      orderRequest.setData(readOrder(data));
      setRejectOpen(false);
      setRejectReason('');
      setActionSuccess('Order rejected.');
      reload();
    } catch (error) {
      const apiError = toApiError(error);
      const serverFields = fieldErrors(apiError.details);
      setRejectError(serverFields.reason ?? apiError.message);
    } finally {
      pendingRef.current = false;
      setPendingAction('');
    }
  };

  const setToFreeStock = () => {
    const freeByLine = new Map(
      (insufficientStock?.lines ?? [])
        .filter((line) => line.shortBy > 0)
        .map((line) => [line.lineId, line.free])
    );
    setDrafts((current) => {
      const next = { ...current };
      for (const [lineId, free] of freeByLine) {
        const line = order?.lines.find((entry) => entry.lineId === lineId);
        if (!line || !Number.isSafeInteger(free)) continue;
        const draft = current[lineId] ?? {
          approvedQty: String(line.approvedQty ?? line.qty),
          approvedPrice: paiseToInput(line.approvedPricePaise ?? line.pricePaise)
        };
        const currentQty = parsedQuantity(draft.approvedQty) ?? line.qty;
        next[lineId] = {
          ...draft,
          approvedQty: String(Math.min(currentQty, free))
        };
      }
      return next;
    });
    setInsufficientStock(null);
    setOperationError('');
  };

  if (orderRequest.loading) {
    return <p className="p-4 text-sm text-slate-600" role="status">Loading order…</p>;
  }
  if (orderRequest.error) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <ErrorBox
          loading={orderRequest.loading}
          message={orderRequest.error.status === 404 ? 'Order not found' : orderRequest.error.message}
          onRetry={orderRequest.reload}
        />
        <Link className="inline-flex min-h-11 items-center text-blue-800 underline" to="/orders">
          Back to orders
        </Link>
      </div>
    );
  }
  if (!order) {
    return <EmptyState title="Order not found" />;
  }

  const editTotal = totalPaise === null ? null : formatPaise(totalPaise.toString());
  const shortLines = (insufficientStock?.lines ?? []).filter((line) => line.shortBy > 0);
  const freeGuidance = shortLines.length === 1
    ? `Reduce to ${shortLines[0].free}`
    : 'Reduce each line to its free stock';

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <Link className="inline-flex min-h-11 items-center text-sm font-medium text-blue-800 underline" to="/orders">
        Back to orders
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{order.orderNo}</h1>
          <p className="mt-1 text-slate-600">Order details and stock cover</p>
        </div>
        <StatusBadge status={order.status} />
      </header>

      <Card>
        <h2 className="font-semibold text-slate-900">Customer and order</h2>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <p><span className="font-medium">Customer:</span> {order.customer?.name}</p>
          <p><span className="font-medium">Salesman:</span> {order.salesman?.name}</p>
          <p><span className="font-medium">Submitted:</span> {formatDateTimeIST(order.createdAt)}</p>
          {approvedBy && (
            <p>
              <span className="font-medium">Approved by:</span> {approvedBy.by || 'Admin'}
              {approvedBy.at && ` · ${formatDateTimeIST(approvedBy.at)}`}
            </p>
          )}
        </div>
        {order.rejectReason && (
          <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
            Rejection reason: {order.rejectReason}
          </p>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Stock availability</h2>
            {availability?.message && <p className="mt-1 text-sm text-slate-600">{availability.message}</p>}
          </div>
        </div>
        {!canReadAvailability && (
          <p className="mt-3 text-sm text-slate-600">Stock availability is restricted to Admin and Owner roles.</p>
        )}
        {canReadAvailability && availabilityRequest.loading && (
          <p className="mt-3 text-sm text-slate-600" role="status">Loading stock availability…</p>
        )}
        {canReadAvailability && availabilityRequest.error && (
          <div className="mt-3">
            <ErrorBox
              loading={availabilityRequest.loading}
              message={availabilityRequest.error.message}
              onRetry={availabilityRequest.reload}
            />
          </div>
        )}
        {canReadAvailability && availability && (
          <div className="mt-4 space-y-3">
            {availability.lines.map((stockLine) => {
              const orderLine = order.lines.find((line) => line.lineId === stockLine.lineId);
              const draftQty = editable && orderLine
                ? parsedQuantity((drafts[stockLine.lineId] ?? {}).approvedQty ?? '')
                : stockLine.effectiveQty;
              const draftShortBy = draftQty === null
                ? stockLine.shortBy
                : Math.max(0, draftQty - stockLine.free);
              const covered = draftShortBy === 0;
              return (
                <div className="rounded-lg border border-slate-200 p-3" key={stockLine.lineId}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">{stockLine.name}</p>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      covered ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {covered ? 'Covered' : `Short by ${draftShortBy}`}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    On hand: {stockLine.onHand} · Reserved by other approved orders: {stockLine.reservedByOthers} · Free: {stockLine.free}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {operationError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900" role="alert">
          <p>{operationError}</p>
          {insufficientStock && (
            <div className="mt-2 space-y-2">
              <p>
                Approving more than the free stock is refused. {freeGuidance}, reject, or wait for production.
              </p>
              <Button onClick={setToFreeStock} variant="secondary">Set to free stock</Button>
            </div>
          )}
        </div>
      )}
      {actionSuccess && (
        <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900" role="status">
          {actionSuccess}
        </p>
      )}

      <Card>
        <h2 className="font-semibold text-slate-900">Order lines</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-3 py-3" scope="col">Product</th>
                <th className="px-3 py-3" scope="col">Requested qty</th>
                <th className="px-3 py-3" scope="col">Requested price</th>
                {editable && <th className="px-3 py-3" scope="col">Approved qty</th>}
                {editable && <th className="px-3 py-3" scope="col">Approved price (Rs)</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {order.lines.map((line, index) => {
                const draft = drafts[line.lineId] ?? {
                  approvedQty: String(line.approvedQty ?? line.qty),
                  approvedPrice: paiseToInput(line.approvedPricePaise ?? line.pricePaise)
                };
                const stockLine = availabilityByLine.get(line.lineId);
                const quantityError = roleFieldError(fieldIssues, index, 'approvedQty', line.lineId)
                  ?? fieldIssues[`line-${index}`];
                const priceError = roleFieldError(fieldIssues, index, 'approvedPrice', line.lineId)
                  ?? fieldIssues[`line-${index}`];
                return (
                  <tr key={line.lineId}>
                    <td className="px-3 py-3 font-medium text-slate-900">{line.name}</td>
                    <td className="px-3 py-3">
                      {line.qtyDisplay}
                      {!editable && line.approvedQty !== null && (
                        <p className="mt-1 text-xs text-blue-800">
                          Approved {line.approvedQtyDisplay}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {formatPaise(line.pricePaise)}
                      {!editable && line.approvedPricePaise !== null && (
                        <p className="mt-1 text-xs text-blue-800">
                          Approved price {formatPaise(line.approvedPricePaise)}
                        </p>
                      )}
                    </td>
                    {editable && (
                      <td className="min-w-40 px-3 py-3">
                        <Input
                          aria-label={`Approved quantity for ${line.name}`}
                          disabled={pendingAction !== ''}
                          error={quantityError}
                          id={`approved-qty-${line.lineId}`}
                          label={`Approved quantity for ${line.name}`}
                          max="100000"
                          min="0"
                          onChange={(event) => {
                            setDrafts((current) => ({
                              ...current,
                              [line.lineId]: { ...draft, approvedQty: event.target.value }
                            }));
                            setFieldIssues({});
                            setOperationError('');
                            setInsufficientStock(null);
                            setActionSuccess('');
                          }}
                          type="number"
                          value={draft.approvedQty}
                        />
                        {stockLine && parsedQuantity(draft.approvedQty) !== null
                          && parsedQuantity(draft.approvedQty) > stockLine.free && (
                            <p className="mt-1 text-xs text-amber-800" role="status">
                              Above free stock by {parsedQuantity(draft.approvedQty) - stockLine.free}.
                            </p>
                        )}
                      </td>
                    )}
                    {editable && (
                      <td className="min-w-48 px-3 py-3">
                        <Input
                          error={priceError}
                          disabled={pendingAction !== ''}
                          id={`approved-price-${line.lineId}`}
                          inputMode="decimal"
                          label={`Approved price for ${line.name} in rupees`}
                          onChange={(event) => {
                            setDrafts((current) => ({
                              ...current,
                              [line.lineId]: { ...draft, approvedPrice: event.target.value }
                            }));
                            setFieldIssues({});
                            setOperationError('');
                            setInsufficientStock(null);
                            setActionSuccess('');
                          }}
                          type="text"
                          value={draft.approvedPrice}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && (
          <p className="mt-4 flex justify-between gap-3 border-t border-slate-100 pt-4 font-semibold">
            <span>Approved taxable total</span>
            <span>{editTotal ?? 'Check line quantities and prices'}</span>
          </p>
        )}
        {!editable && (
          <p className="mt-4 flex justify-between gap-3 border-t border-slate-100 pt-4 font-semibold">
            <span>Taxable total</span>
            <span>{formatPaise(order.taxableTotalPaise)}</span>
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">GST is added when the invoice is raised</p>
      </Card>

      {editable && (
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={pendingAction !== '' || availabilityRequest.loading || !availability}
            onClick={startApproval}
          >
            Approve
          </Button>
          <Button
            disabled={pendingAction !== ''}
            onClick={() => {
              setRejectError('');
              setRejectReason('');
              setRejectOpen(true);
            }}
            variant="danger"
          >
            Reject
          </Button>
        </div>
      )}

      <OrderInvoiceActions order={order} onChanged={reload} />

      <ConfirmDialog
        confirmText="Confirm approval"
        loading={pendingAction === 'approve'}
        message={`Approve ${order.lines.reduce((sum, line) => (
          sum + (parsedQuantity((drafts[line.lineId] ?? {}).approvedQty ?? '') ?? 0)
        ), 0)} packets for ${editTotal ?? 'the calculated taxable total'}?`}
        onCancel={() => {
          if (!pendingAction) setApproveOpen(false);
        }}
        onConfirm={approve}
        open={approveOpen}
        title="Confirm order approval"
        variant="primary"
      />

      <Modal
        onClose={() => {
          if (!pendingAction) setRejectOpen(false);
        }}
        open={rejectOpen}
        persistent={pendingAction === 'reject'}
        title="Reject order"
      >
        <form className="space-y-4" noValidate onSubmit={reject}>
          <Textarea
            error={rejectError}
            id="rejection-reason"
            label="Reason"
            maxLength={300}
            minLength={3}
            onChange={(event) => {
              setRejectReason(event.target.value);
              setRejectError('');
            }}
            required
            value={rejectReason}
          />
          <div className="flex justify-end gap-2">
            <Button
              disabled={pendingAction === 'reject'}
              onClick={() => setRejectOpen(false)}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button loading={pendingAction === 'reject'} type="submit" variant="danger">
              Confirm rejection
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
