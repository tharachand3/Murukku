import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../../components/ui/Card.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { formatBaseQuantity, quantityToBase } from '../../lib/productionQuantities.js';
import { toApiError } from '../../lib/apiError.js';

function readBoms(data) {
  if (!Array.isArray(data)) {
    throw new TypeError('The server returned an invalid recipe list');
  }
  return data;
}

function readStock(data) {
  if (!Array.isArray(data) || data.some((item) => !Number.isSafeInteger(item.balanceBase))) {
    throw new TypeError('The server returned invalid stock balances');
  }
  return data;
}

function readPlan(data) {
  if (!Array.isArray(data?.lines) || !Number.isSafeInteger(data.plannedOutputQty)) {
    throw new TypeError('The server returned an invalid production plan');
  }
  return data;
}

function validBatches(value) {
  if (!/^\d+(?:\.\d{1,4})?$/.test(value)) return false;
  const [whole, fraction = ''] = value.split('.');
  const scaled = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0') || '0');
  return scaled >= 1n && scaled <= 1000000n;
}

function validPositiveInteger(value) {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

export default function BomsPage() {
  const bomsRequest = useAsync(async () => {
    const { data } = await api.get('/boms', { params: { active: true } });
    return readBoms(data);
  }, []);
  const stockRequest = useAsync(async () => {
    const { data } = await api.get('/stock/summary');
    return readStock(data);
  }, []);
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState('batches');
  const [batches, setBatches] = useState('1');
  const [targetOutput, setTargetOutput] = useState('');
  const [issueItemId, setIssueItemId] = useState('');
  const [issueQty, setIssueQty] = useState('');
  const [plan, setPlan] = useState(null);
  const [planInput, setPlanInput] = useState(null);
  const [planError, setPlanError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [planning, setPlanning] = useState(false);
  const planningRef = useRef(false);

  const boms = bomsRequest.data ?? [];
  const selectedBom = boms.find((bom) => String(bom.id) === selectedId) ?? boms[0] ?? null;
  const rawLines = useMemo(
    () => selectedBom?.lines.filter((line) => line.item.type === 'RAW') ?? [],
    [selectedBom]
  );
  const stockById = useMemo(
    () => new Map((stockRequest.data ?? []).map((item) => [item.itemId, item.balanceBase])),
    [stockRequest.data]
  );

  useEffect(() => {
    if (boms.length > 0 && !boms.some((bom) => String(bom.id) === selectedId)) {
      setSelectedId(String(boms[0].id));
    }
  }, [boms, selectedId]);

  useEffect(() => {
    setPlan(null);
    setPlanInput(null);
    setPlanError('');
    setValidationError('');
    const firstRaw = selectedBom?.lines.find((line) => line.item.type === 'RAW');
    setIssueItemId(firstRaw ? String(firstRaw.itemId) : '');
    setIssueQty(firstRaw ? firstRaw.qtyPerBatchDisplay.split(' ')[0] : '');
  }, [selectedId, selectedBom?.id]);

  const calculatePlan = async (input = null) => {
    if (!selectedBom || planningRef.current) return;
    const selectedMode = input?.mode ?? mode;
    const values = input ?? { mode, batches, targetOutput, issueItemId, issueQty };
    const params = {};
    let validationMessage = '';
    if (selectedMode === 'batches') {
      if (!validBatches(values.batches)) {
        validationMessage = 'Enter batches from 0.0001 to 100, using up to 4 decimal places.';
      } else {
        params.batches = values.batches;
      }
    } else if (selectedMode === 'targetOutput') {
      if (!validPositiveInteger(values.targetOutput)) {
        validationMessage = 'Enter a positive whole-number packet target.';
      } else {
        params.targetOutput = values.targetOutput;
      }
    } else {
      const line = rawLines.find((entry) => String(entry.itemId) === values.issueItemId);
      if (!line || !values.issueQty.trim()) {
        validationMessage = 'Choose a raw material and enter the quantity issued.';
      } else {
        try {
          const baseQty = formatBaseQuantity(
            quantityToBase(values.issueQty, line.item.displayUnit.code, { allowZero: false }),
            line.item.displayUnit.code
          );
          params.itemId = line.itemId;
          params.qty = baseQty;
          params.unit = line.item.displayUnit.code;
        } catch (error) {
          validationMessage = error.message;
        }
      }
    }
    setValidationError(validationMessage);
    setPlanError('');
    if (validationMessage) return;

    setPlanInput({ ...values });
    planningRef.current = true;
    setPlanning(true);
    try {
      const { data } = await api.get(`/boms/${selectedBom.id}/plan`, { params });
      setPlan(readPlan(data));
    } catch (error) {
      setPlanError(toApiError(error).message);
    } finally {
      planningRef.current = false;
      setPlanning(false);
    }
  };

  const retryPlan = () => calculatePlan(planInput);

  if (bomsRequest.loading) {
    return <p className="p-4 text-sm text-slate-600" role="status">Loading recipes…</p>;
  }
  if (bomsRequest.error) {
    return (
      <ErrorBox
        loading={bomsRequest.loading}
        message={bomsRequest.error.message}
        onRetry={bomsRequest.reload}
      />
    );
  }
  if (boms.length === 0) {
    return <EmptyState title="No active recipes" message="An active BOM is needed to plan a production run." />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Recipes (BOM)</h1>
        <p className="mt-1 text-sm text-slate-600">View active recipes, plan a batch, and compare material stock.</p>
      </header>

      <Card>
        <Select
          label="Active recipe"
          onChange={(event) => {
            setSelectedId(event.target.value);
            setPlan(null);
          }}
          value={selectedBom ? String(selectedBom.id) : ''}
        >
          {boms.map((bom) => (
            <option key={bom.id} value={bom.id}>
              {bom.finishedItem.name} — {bom.name} (v{bom.version})
            </option>
          ))}
        </Select>
        {selectedBom && (
          <div className="mt-4">
            <h2 className="text-lg font-semibold text-slate-900">{selectedBom.name}</h2>
            <p className="mt-1 text-sm text-slate-600">
              Expected yield per batch: {formatBaseQuantity(
                selectedBom.batchYieldQty,
                selectedBom.finishedItem.displayUnit.code
              )} {selectedBom.finishedItem.displayUnit.code} of {selectedBom.finishedItem.name}
            </p>
            {selectedBom.notes && <p className="mt-2 text-sm text-slate-600">{selectedBom.notes}</p>}
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-3 py-3" scope="col">Material</th>
                    <th className="px-3 py-3" scope="col">Type</th>
                    <th className="px-3 py-3" scope="col">Per batch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedBom.lines.map((line) => (
                    <tr key={line.itemId}>
                      <td className="px-3 py-3 font-medium text-slate-900">{line.itemName}</td>
                      <td className="px-3 py-3">{line.item.type}</td>
                      <td className="px-3 py-3">{line.qtyPerBatchDisplay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900">Plan calculator</h2>
        <form
          className="mt-4 grid gap-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            calculatePlan();
          }}
        >
          <Select label="Planning mode" onChange={(event) => setMode(event.target.value)} value={mode}>
            <option value="batches">Number of batches</option>
            <option value="targetOutput">Target packets</option>
            <option value="issued">Raw material issued</option>
          </Select>
          {mode === 'batches' && (
            <Input
              inputMode="decimal"
              label="Batches"
              onChange={(event) => setBatches(event.target.value)}
              value={batches}
            />
          )}
          {mode === 'targetOutput' && (
            <Input
              inputMode="numeric"
              label="Target packets"
              onChange={(event) => setTargetOutput(event.target.value)}
              value={targetOutput}
            />
          )}
          {mode === 'issued' && (
            <>
              <Select
                label="Raw material issued"
                onChange={(event) => {
                  setIssueItemId(event.target.value);
                  const line = rawLines.find((entry) => String(entry.itemId) === event.target.value);
                  setIssueQty(line ? line.qtyPerBatchDisplay.split(' ')[0] : '');
                }}
                value={issueItemId}
              >
                {rawLines.map((line) => (
                  <option key={line.itemId} value={line.itemId}>{line.item.name}</option>
                ))}
              </Select>
              <Input
                inputMode="decimal"
                label={`Issued quantity (${rawLines.find((line) => String(line.itemId) === issueItemId)?.item.displayUnit.code ?? ''})`}
                onChange={(event) => setIssueQty(event.target.value)}
                value={issueQty}
              />
            </>
          )}
          <div className="md:col-span-2">
            <button
              className="min-h-11 rounded-lg bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
              disabled={planning}
              type="submit"
            >
              {planning ? 'Planning…' : 'Calculate plan'}
            </button>
          </div>
        </form>
        {validationError && <p className="mt-3 text-sm text-red-800" role="alert">{validationError}</p>}
        {planError && (
          <div className="mt-3">
            <ErrorBox loading={planning} message={planError} onRetry={retryPlan} />
          </div>
        )}
        {stockRequest.loading && <p className="mt-4 text-sm text-slate-600" role="status">Loading stock balances…</p>}
        {stockRequest.error && (
          <div className="mt-3">
            <ErrorBox
              loading={stockRequest.loading}
              message={stockRequest.error.message}
              onRetry={stockRequest.reload}
            />
          </div>
        )}
        {plan && !stockRequest.error && stockRequest.data && (
          <div className="mt-5">
            <p className="font-semibold text-slate-900">
              Planned output: {formatBaseQuantity(plan.plannedOutputQty, selectedBom.finishedItem.displayUnit.code)} {selectedBom.finishedItem.displayUnit.code}
            </p>
            <div className="mt-3 space-y-2">
              {plan.lines.map((line) => {
                const bomLine = selectedBom.lines.find((entry) => entry.itemId === line.itemId);
                const stockBase = stockById.get(line.itemId);
                const shortage = Number.isSafeInteger(stockBase)
                  ? Math.max(0, line.plannedQty - stockBase)
                  : null;
                return (
                  <div className="flex flex-wrap justify-between gap-2 rounded-lg border border-slate-200 p-3" key={line.itemId}>
                    <span>{line.itemName}: {line.plannedQtyDisplay}</span>
                    <span className="text-sm text-slate-600">
                      Current stock: {Number.isSafeInteger(stockBase)
                        ? formatBaseQuantity(stockBase, bomLine.item.displayUnit.code)
                        : 'Unavailable'} {bomLine.item.displayUnit.code}
                    </span>
                    {shortage !== null && shortage > 0 && (
                      <span className="w-full font-medium text-red-800">
                        Short by {formatBaseQuantity(shortage, bomLine.item.displayUnit.code)} {bomLine.item.displayUnit.code}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
