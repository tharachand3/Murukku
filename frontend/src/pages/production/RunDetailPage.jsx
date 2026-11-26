import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { Textarea } from '../../components/ui/Textarea.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { fieldErrors, toApiError } from '../../lib/apiError.js';
import { formatDateTimeIST } from '../../lib/date.js';
import { formatPaise, parseRupeesToPaise } from '../../lib/money.js';
import {
  formatBaseQuantity,
  formatSignedVariance,
  quantityToBase,
  varianceBasisPoints
} from '../../lib/productionQuantities.js';

const INTEGER_MAX = 2147483647;

function readRun(data) {
  if (!Array.isArray(data?.lines)) {
    throw new TypeError('The server returned an invalid production run');
  }
  return data;
}

function readVariance(data) {
  if (!Array.isArray(data?.alerts) || !Array.isArray(data?.lines) || !data.yield) {
    throw new TypeError('The server returned invalid run variance');
  }
  return data;
}

function readCostSheet(data) {
  if (!Number.isSafeInteger(data?.totalCostPaise) || !data.materialTotals || !data.overheads) {
    throw new TypeError('The server returned an invalid run cost sheet');
  }
  return data;
}

function parseNonNegativeInteger(value) {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= INTEGER_MAX ? parsed : null;
}

function expiryAtNoonIST(value) {
  return value ? new Date(`${value}T12:00:00+05:30`).toISOString() : undefined;
}

function formatVariance(bp) {
  return `${formatSignedVariance(bp)}`;
}

export default function RunDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isWriter = user?.role === 'PRODUCTION' || user?.role === 'ADMIN';
  const canReadCosts = ['ADMIN', 'ACCOUNTANT', 'OWNER'].includes(user?.role);
  const runRequest = useAsync(async () => {
    const { data } = await api.get(`/production/runs/${id}`);
    return readRun(data);
  }, [id]);
  const run = runRequest.data;
  const varianceRequest = useAsync(async () => {
    const { data } = await api.get(`/production/runs/${id}/variance`);
    return readVariance(data);
  }, [id], { immediate: run?.status === 'COMPLETED' });
  const costRequest = useAsync(async () => {
    const { data } = await api.get(`/costing/runs/${id}/sheet`);
    return readCostSheet(data);
  }, [id], { immediate: canReadCosts && run?.status === 'COMPLETED' });

  const [pendingAction, setPendingAction] = useState('');
  const pendingRef = useRef(false);
  const [completionError, setCompletionError] = useState('');
  const [completionFields, setCompletionFields] = useState({});
  const [completionSaved, setCompletionSaved] = useState(false);
  const [goodQty, setGoodQty] = useState('');
  const [rejectedQty, setRejectedQty] = useState('0');
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');
  const [packagingDrafts, setPackagingDrafts] = useState({});
  const [editBatchNo, setEditBatchNo] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editError, setEditError] = useState('');
  const [actionError, setActionError] = useState('');
  const [overheadKind, setOverheadKind] = useState('LABOUR');
  const [overheadAmount, setOverheadAmount] = useState('');
  const [overheadNote, setOverheadNote] = useState('');
  const [overheadError, setOverheadError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');

  const packagingLines = useMemo(
    () => run?.lines.filter((line) => line.item.type === 'PACKAGING' && line.issuedQtyBase === 0) ?? [],
    [run]
  );
  const overheads = run?.overheads ?? [];
  const overheadTotalPaise = overheads.reduce((sum, row) => sum + row.amountPaise, 0);

  useEffect(() => {
    if (!run) return;
    setGoodQty('');
    setRejectedQty('0');
    setBatchNo(run.batchNo ?? '');
    setExpiryDate('');
    setCompletionNotes(run.notes ?? '');
    setEditBatchNo(run.batchNo ?? '');
    setEditNotes(run.notes ?? '');
    setPackagingDrafts(Object.fromEntries(
      run.lines
        .filter((line) => line.item.type === 'PACKAGING' && line.issuedQtyBase === 0)
        .map((line) => [
          line.itemId,
          {
            qty: formatBaseQuantity(line.plannedQtyBase, line.item.displayUnit.code),
            scrapQty: '0'
          }
        ])
    ));
  }, [run?.id]);

  const completePreview = useMemo(() => {
    if (!run) return null;
    const actualGood = parseNonNegativeInteger(goodQty);
    const yieldBp = actualGood === null
      ? null
      : varianceBasisPoints(run.plannedOutputQty, actualGood);
    const lines = packagingLines.map((line) => {
      const draft = packagingDrafts[line.itemId] ?? { qty: '', scrapQty: '0' };
      try {
        const qty = quantityToBase(draft.qty, line.item.displayUnit.code);
        const scrap = quantityToBase(draft.scrapQty, line.item.displayUnit.code);
        const actualQty = qty + scrap;
        if (!Number.isSafeInteger(actualQty) || actualQty > INTEGER_MAX) {
          throw new RangeError('Total quantity exceeds the supported range.');
        }
        return {
          line,
          actualQty,
          bp: varianceBasisPoints(line.plannedQtyBase, actualQty),
          error: ''
        };
      } catch (error) {
        return { line, actualQty: null, bp: null, error: error.message };
      }
    });
    return { actualGood, yieldBp, lines };
  }, [run, goodQty, packagingDrafts, packagingLines]);

  const refreshRun = () => {
    runRequest.reload();
    varianceRequest.reload();
    costRequest.reload();
  };

  const startAction = (name) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingAction(name);
    setActionError('');
    return true;
  };

  const finishAction = () => {
    pendingRef.current = false;
    setPendingAction('');
  };

  const submitCompletion = async (event) => {
    event.preventDefault();
    if (!run || !startAction('complete')) return;
    setCompletionError('');
    setCompletionFields({});
    const actualGoodQty = parseNonNegativeInteger(goodQty);
    const rejectedFinishedQty = parseNonNegativeInteger(rejectedQty);
    const errors = {};
    if (actualGoodQty === null) errors.actualGoodQty = 'Enter a whole number from 0 to 2147483647.';
    if (rejectedFinishedQty === null) errors.rejectedFinishedQty = 'Enter a whole number from 0 to 2147483647.';

    const consumption = [];
    for (const line of packagingLines) {
      const draft = packagingDrafts[line.itemId] ?? { qty: '', scrapQty: '0' };
      try {
        const qtyBase = quantityToBase(draft.qty, line.item.displayUnit.code);
        const scrapBase = quantityToBase(draft.scrapQty, line.item.displayUnit.code);
        if (qtyBase + scrapBase > INTEGER_MAX) {
          throw new RangeError('Total quantity exceeds the supported range.');
        }
        consumption.push({
          itemId: line.itemId,
          qty: formatBaseQuantity(qtyBase, line.item.displayUnit.code),
          unit: line.item.displayUnit.code,
          scrapQty: formatBaseQuantity(scrapBase, line.item.displayUnit.code),
          scrapUnit: line.item.displayUnit.code
        });
      } catch (error) {
        errors[`consumption.${line.itemId}`] = error.message;
      }
    }

    if (Object.keys(errors).length > 0) {
      setCompletionFields(errors);
      finishAction();
      return;
    }

    const payload = {
      actualGoodQty,
      rejectedFinishedQty,
      consumption,
      ...(batchNo.trim() ? { batchNo: batchNo.trim() } : {}),
      ...(expiryDate ? { expiryDate: expiryAtNoonIST(expiryDate) } : {}),
      ...(completionNotes.trim() ? { notes: completionNotes.trim() } : {})
    };
    try {
      await api.post(`/production/runs/${id}/complete`, payload);
      setCompletionSaved(true);
      refreshRun();
    } catch (error) {
      const apiError = toApiError(error);
      let message = apiError.message;
      if (apiError.code === 'INSUFFICIENT_STOCK' && apiError.details?.shortBy > 0) {
        const line = run.lines.find((entry) => entry.itemId === apiError.details.itemId);
        const shortage = line
          ? `${formatBaseQuantity(apiError.details.shortBy, line.item.displayUnit.code)} ${line.item.displayUnit.code}`
          : String(apiError.details.shortBy);
        message = `${apiError.message}. Short by ${shortage}.`;
      }
      setCompletionError(message);
      setCompletionFields(fieldErrors(apiError.details));
    } finally {
      finishAction();
    }
  };

  const saveEdits = async (event) => {
    event.preventDefault();
    if (!run || !startAction('edit')) return;
    setEditError('');
    try {
      await api.patch(`/production/runs/${id}`, {
        notes: editNotes.trim() || null,
        batchNo: editBatchNo.trim() || null
      });
      runRequest.reload();
    } catch (error) {
      setEditError(toApiError(error).message);
    } finally {
      finishAction();
    }
  };

  const addOverhead = async (event) => {
    event.preventDefault();
    if (!run || !startAction('overhead')) return;
    setOverheadError('');
    let amountPaise;
    try {
      amountPaise = parseRupeesToPaise(overheadAmount);
      if (amountPaise < 1) throw new TypeError('Enter an amount greater than zero.');
    } catch (error) {
      setOverheadError(error.message);
      finishAction();
      return;
    }
    try {
      await api.post(`/production/runs/${id}/overheads`, {
        kind: overheadKind,
        amountPaise,
        ...(overheadNote.trim() ? { note: overheadNote.trim() } : {})
      });
      setOverheadAmount('');
      setOverheadNote('');
      refreshRun();
    } catch (error) {
      setOverheadError(toApiError(error).message);
    } finally {
      finishAction();
    }
  };

  const deleteOverhead = async () => {
    if (!deleteTarget || !startAction('delete-overhead')) return;
    try {
      await api.delete(`/production/runs/${id}/overheads/${deleteTarget.id}`);
      setDeleteTarget(null);
      refreshRun();
    } catch (error) {
      setActionError(toApiError(error).message);
    } finally {
      finishAction();
    }
  };

  const cancelRun = async (event) => {
    event.preventDefault();
    if (!run || !startAction('cancel')) return;
    const reason = cancelReason.trim();
    if (!reason) {
      setCancelError('Enter a cancellation reason.');
      finishAction();
      return;
    }
    setCancelError('');
    try {
      await api.post(`/production/runs/${id}/cancel`, { reason });
      setCancelOpen(false);
      setCancelReason('');
      refreshRun();
    } catch (error) {
      setCancelError(toApiError(error).message);
    } finally {
      finishAction();
    }
  };

  if (runRequest.loading) {
    return <p className="p-4 text-sm text-slate-600" role="status">Loading production run…</p>;
  }
  if (runRequest.error) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <ErrorBox loading={runRequest.loading} message={runRequest.error.message} onRetry={runRequest.reload} />
        <Link className="inline-flex min-h-11 items-center text-blue-800 underline" to="/production">
          Back to production runs
        </Link>
      </div>
    );
  }
  if (!run) {
    return <EmptyState title="Production run not found" />;
  }

  const varianceByItemId = new Map((varianceRequest.data?.lines ?? []).map((line) => [line.itemId, line]));
  const canEdit = isWriter && ['ISSUED', 'COMPLETED'].includes(run.status);
  const canManageOverheads = isWriter && ['ISSUED', 'COMPLETED'].includes(run.status);
  const completeYieldFlagged = completePreview?.yieldBp !== null
    && completePreview?.yieldBp !== undefined
    && Math.abs(completePreview.yieldBp) > run.toleranceBpUsed;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <Link className="inline-flex min-h-11 items-center text-sm font-medium text-blue-800 underline" to="/production">
        Back to production runs
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{run.runNo}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {run.finishedItem.name} · Started {formatDateTimeIST(run.startedAt)}
          </p>
        </div>
        <StatusBadge status={run.status} />
      </header>

      {actionError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{actionError}</p>}

      <Card>
        <h2 className="font-semibold text-slate-900">Run summary</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-slate-500">Product</dt><dd className="font-medium">{run.finishedItem.name}</dd></div>
          <div><dt className="text-slate-500">Batches</dt><dd className="font-medium">{run.batchCount}</dd></div>
          <div><dt className="text-slate-500">Planned output</dt><dd className="font-medium">{formatBaseQuantity(run.plannedOutputQty, run.finishedItem.displayUnit.code)} {run.finishedItem.displayUnit.code}</dd></div>
          <div><dt className="text-slate-500">Good output</dt><dd className="font-medium">{run.actualGoodQty === null ? '—' : `${run.actualGoodQty} ${run.finishedItem.displayUnit.code}`}</dd></div>
          {run.batchNo && <div><dt className="text-slate-500">Batch number</dt><dd className="font-medium">{run.batchNo}</dd></div>}
          {run.expiryDate && <div><dt className="text-slate-500">Expiry</dt><dd className="font-medium">{formatDateTimeIST(run.expiryDate)}</dd></div>}
          {run.notes && <div className="sm:col-span-2"><dt className="text-slate-500">Notes</dt><dd className="font-medium">{run.notes}</dd></div>}
        </dl>
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Material and packaging lines</h2>
        {run.lines.length === 0 ? (
          <EmptyState title="No run lines" />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-600">
                <tr>
                  {['Item', 'Type', 'Planned', 'Issued', 'Scrap', 'Variance'].map((label) => (
                    <th className="whitespace-nowrap px-3 py-3" key={label} scope="col">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {run.lines.map((line) => {
                  const variance = varianceByItemId.get(line.itemId)
                    ?? (line.variance ? { ...line.variance, issuedQty: line.issuedQtyBase } : null);
                  return (
                    <tr key={line.itemId}>
                      <td className="px-3 py-3 font-medium text-slate-900">{line.itemName}</td>
                      <td className="px-3 py-3">{line.item.type}</td>
                      <td className="px-3 py-3">{line.plannedQtyDisplay}</td>
                      <td className="px-3 py-3">{line.issuedQtyDisplay}</td>
                      <td className="px-3 py-3">{line.scrapQtyDisplay}</td>
                      <td className="px-3 py-3">
                        {variance ? (
                          <span className="inline-flex flex-wrap items-center gap-2">
                            <span>{formatVariance(variance.bp)}</span>
                            {variance.flagged && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">Flagged</span>}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {run.status === 'COMPLETED' && (
        <Card>
          <h2 className="font-semibold text-slate-900">Variance results</h2>
          {varianceRequest.loading && <p className="mt-3 text-sm text-slate-600" role="status">Loading variance…</p>}
          {varianceRequest.error && (
            <div className="mt-3">
              <ErrorBox loading={varianceRequest.loading} message={varianceRequest.error.message} onRetry={varianceRequest.reload} />
            </div>
          )}
          {varianceRequest.data && (
            <>
              <p className="mt-3 text-sm">
                Yield: {varianceRequest.data.yield.actualGoodQty} vs {varianceRequest.data.yield.plannedOutputQty} expected
                {' '}({formatVariance(varianceRequest.data.yield.bp)})
                {varianceRequest.data.yield.flagged && <span className="ml-2 rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">Flagged</span>}
              </p>
              <div className="mt-3 space-y-2" role="status">
                {varianceRequest.data.alerts.length === 0
                  ? <p className="text-sm text-slate-600">No variance alerts.</p>
                  : varianceRequest.data.alerts.map((alert) => <p className="text-sm text-red-800" key={alert}>{alert}</p>)}
              </div>
            </>
          )}
          {completionSaved && <p className="mt-3 text-sm font-medium text-green-800">Run completed successfully.</p>}
        </Card>
      )}

      {run.status === 'COMPLETED' && canReadCosts && (
        <Card>
          <h2 className="font-semibold text-slate-900">Run cost</h2>
          {costRequest.loading && <p className="mt-3 text-sm text-slate-600" role="status">Loading run cost…</p>}
          {costRequest.error && (
            <div className="mt-3">
              <ErrorBox loading={costRequest.loading} message={costRequest.error.message} onRetry={costRequest.reload} />
            </div>
          )}
          {costRequest.data && (
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-slate-500">Material</dt><dd className="font-medium">{formatPaise(costRequest.data.materialTotals.actualCostPaise)}</dd></div>
              <div><dt className="text-slate-500">Overhead</dt><dd className="font-medium">{formatPaise(costRequest.data.overheads.totalPaise)}</dd></div>
              <div><dt className="text-slate-500">Total</dt><dd className="font-medium">{formatPaise(costRequest.data.totalCostPaise)}</dd></div>
              <div><dt className="text-slate-500">Cost per packet</dt><dd className="font-medium">{costRequest.data.perPacket?.display ?? 'Not available'}</dd></div>
              {costRequest.data.margin && (
                <div><dt className="text-slate-500">Margin</dt><dd className="font-medium">{costRequest.data.margin.pctDisplay}</dd></div>
              )}
            </dl>
          )}
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Overheads</h2>
          <p className="font-medium">{formatPaise(overheadTotalPaise)}</p>
        </div>
        {overheads.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No overheads recorded for this run.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {overheads.map((row) => (
              <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={row.id}>
                <div>
                  <p className="font-medium">{row.kindLabel ?? row.kind} · {formatPaise(row.amountPaise)}</p>
                  {row.note && <p className="text-sm text-slate-600">{row.note}</p>}
                </div>
                {canManageOverheads && (
                  <Button
                    disabled={pendingAction !== ''}
                    onClick={() => setDeleteTarget(row)}
                    variant="danger"
                  >
                    Delete overhead
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManageOverheads && (
          <form className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-3" noValidate onSubmit={addOverhead}>
            <Select label="Overhead type" onChange={(event) => setOverheadKind(event.target.value)} value={overheadKind}>
              <option value="LABOUR">Labour</option>
              <option value="POWER_GAS">Power / gas</option>
              <option value="OTHER">Other</option>
            </Select>
            <Input
              error={overheadError && !overheadError.startsWith('Request') ? overheadError : ''}
              inputMode="decimal"
              label="Amount (Rs)"
              onChange={(event) => setOverheadAmount(event.target.value)}
              value={overheadAmount}
            />
            <Input
              label="Note (optional)"
              maxLength={200}
              onChange={(event) => setOverheadNote(event.target.value)}
              value={overheadNote}
            />
            {overheadError && <p className="text-sm text-red-800 md:col-span-3" role="alert">{overheadError}</p>}
            <div className="md:col-span-3">
              <Button disabled={pendingAction !== ''} loading={pendingAction === 'overhead'} type="submit">
                Add overhead
              </Button>
            </div>
          </form>
        )}
      </Card>

      {canEdit && (
        <Card>
          <h2 className="font-semibold text-slate-900">Edit run notes and batch</h2>
          <form className="mt-3 grid gap-3 md:grid-cols-2" noValidate onSubmit={saveEdits}>
            <Input label="Batch number" onChange={(event) => setEditBatchNo(event.target.value)} value={editBatchNo} />
            <Textarea label="Notes" onChange={(event) => setEditNotes(event.target.value)} value={editNotes} />
            {editError && <p className="text-sm text-red-800 md:col-span-2" role="alert">{editError}</p>}
            <Button disabled={pendingAction !== ''} loading={pendingAction === 'edit'} type="submit">
              Save run details
            </Button>
          </form>
        </Card>
      )}

      {run.status === 'ISSUED' && isWriter && (
        <Card>
          <h2 className="font-semibold text-slate-900">Complete run</h2>
          <form className="mt-4 space-y-4" noValidate onSubmit={submitCompletion}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                error={completionFields.actualGoodQty}
                inputMode="numeric"
                label="Good packets"
                min="0"
                onChange={(event) => setGoodQty(event.target.value)}
                type="number"
                value={goodQty}
              />
              <Input
                error={completionFields.rejectedFinishedQty}
                inputMode="numeric"
                label="Rejected packets"
                min="0"
                onChange={(event) => setRejectedQty(event.target.value)}
                type="number"
                value={rejectedQty}
              />
              <Input label="Batch number (optional)" onChange={(event) => setBatchNo(event.target.value)} value={batchNo} />
              <Input label="Expiry date (optional)" onChange={(event) => setExpiryDate(event.target.value)} type="date" value={expiryDate} />
              <Textarea label="Completion notes (optional)" onChange={(event) => setCompletionNotes(event.target.value)} value={completionNotes} />
            </div>
            {packagingLines.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-medium text-slate-900">Packaging consumption and scrap</h3>
                {packagingLines.map((line) => {
                  const draft = packagingDrafts[line.itemId] ?? { qty: '', scrapQty: '0' };
                  const error = completionFields[`consumption.${line.itemId}`]
                    ?? completionFields[`consumption.${packagingLines.indexOf(line)}.qty`];
                  const preview = completePreview?.lines.find((entry) => entry.line.itemId === line.itemId);
                  const flagged = preview?.bp !== null && preview?.bp !== undefined
                    && Math.abs(preview.bp) > run.toleranceBpUsed;
                  return (
                    <div className="grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-3" key={line.itemId}>
                      <div>
                        <p className="font-medium text-slate-900">{line.itemName}</p>
                        <p className="mt-1 text-sm text-slate-600">Planned {line.plannedQtyDisplay}</p>
                      </div>
                      <Input
                        error={error}
                        inputMode="decimal"
                        label={`Used quantity (${line.item.displayUnit.code})`}
                        onChange={(event) => {
                          setPackagingDrafts((current) => ({
                            ...current,
                            [line.itemId]: { ...draft, qty: event.target.value }
                          }));
                          setCompletionFields((current) => ({
                            ...current,
                            [`consumption.${line.itemId}`]: undefined
                          }));
                        }}
                        value={draft.qty}
                      />
                      <Input
                        error={error}
                        inputMode="decimal"
                        label={`Scrap quantity (${line.item.displayUnit.code})`}
                        onChange={(event) => {
                          setPackagingDrafts((current) => ({
                            ...current,
                            [line.itemId]: { ...draft, scrapQty: event.target.value }
                          }));
                        }}
                        value={draft.scrapQty}
                      />
                      <p className={`text-sm md:col-span-3 ${flagged ? 'font-semibold text-red-800' : 'text-slate-600'}`}>
                        {preview?.bp === null || preview?.bp === undefined
                          ? preview?.error ?? 'Enter used and scrap quantities to preview variance.'
                          : `Total used including scrap: ${formatBaseQuantity(preview.actualQty, line.item.displayUnit.code)} ${line.item.displayUnit.code} (${formatVariance(preview.bp)})${flagged ? ' · Flagged' : ''}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
            <div className={`rounded-lg p-3 text-sm ${
              completePreview?.yieldBp === null || completePreview?.yieldBp === undefined
                ? 'bg-slate-50 text-slate-700'
                : completeYieldFlagged ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'
            }`}>
              {completePreview?.yieldBp === null || completePreview?.yieldBp === undefined
                ? 'Enter good packets to preview yield variance.'
                : `Yield: ${completePreview.actualGood} vs ${run.plannedOutputQty} planned (${formatVariance(completePreview.yieldBp)})${completeYieldFlagged ? ' · Flagged' : ''}`}
            </div>
            {completionError && <p className="text-sm text-red-800" role="alert">{completionError}</p>}
            <Button disabled={pendingAction !== ''} loading={pendingAction === 'complete'} type="submit">
              Complete production run
            </Button>
          </form>
        </Card>
      )}

      {run.status === 'ISSUED' && isWriter && (
        <Button
          disabled={pendingAction !== ''}
          onClick={() => {
            setCancelError('');
            setCancelReason('');
            setCancelOpen(true);
          }}
          variant="danger"
        >
          Cancel run
        </Button>
      )}

      {run.status === 'ISSUED' && (
        <Modal
          onClose={() => {
            if (pendingAction !== 'cancel') setCancelOpen(false);
          }}
          open={cancelOpen}
          persistent={pendingAction === 'cancel'}
          title="Cancel production run"
        >
          <form className="space-y-4" noValidate onSubmit={cancelRun}>
            <Textarea
              error={cancelError}
              label="Reason"
              onChange={(event) => {
                setCancelReason(event.target.value);
                setCancelError('');
              }}
              required
              value={cancelReason}
            />
            <div className="flex justify-end gap-2">
              <Button disabled={pendingAction !== ''} onClick={() => setCancelOpen(false)} variant="secondary">
                Keep run open
              </Button>
              <Button disabled={pendingAction !== ''} loading={pendingAction === 'cancel'} type="submit" variant="danger">
                Confirm cancellation
              </Button>
            </div>
          </form>
        </Modal>
      )}

      <Card>
        <h2 className="font-semibold text-slate-900">Stock ledger</h2>
        {run.ledgerRows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No ledger movements are recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-600">
                <tr>
                  {['Date (IST)', 'Item', 'Movement', 'Quantity', 'Batch'].map((label) => (
                    <th className="px-3 py-3" key={label} scope="col">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {run.ledgerRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-3">{formatDateTimeIST(row.movementDate)}</td>
                    <td className="px-3 py-3">{row.itemName}</td>
                    <td className="px-3 py-3">{row.movementType}</td>
                    <td className="px-3 py-3">{row.qtyChangeDisplay}</td>
                    <td className="px-3 py-3">{row.batchNo ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {Array.isArray(run.auditHistory) && (
        <Card>
          <h2 className="font-semibold text-slate-900">Audit history</h2>
          {run.auditHistory.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No audit history available.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {run.auditHistory.map((entry) => (
                <li className="rounded-lg border border-slate-200 p-3 text-sm" key={entry.id}>
                  <span className="font-medium">{entry.action}</span>
                  {' · '}{entry.user?.name ?? 'User'}{' · '}{formatDateTimeIST(entry.createdAt)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ConfirmDialog
        confirmText="Delete overhead"
        loading={pendingAction === 'delete-overhead'}
        message="Delete this overhead entry? The run cost will be recalculated."
        onCancel={() => {
          if (pendingAction !== 'delete-overhead') setDeleteTarget(null);
        }}
        onConfirm={deleteOverhead}
        open={Boolean(deleteTarget)}
        title="Confirm overhead deletion"
      />
    </div>
  );
}
