import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { api } from '../../lib/api.js';
import { fieldErrors, toApiError } from '../../lib/apiError.js';
import { formatBaseQuantity, formatSignedVariance, quantityToBase, varianceBasisPoints } from '../../lib/productionQuantities.js';
import { useAsync } from '../../hooks/useAsync.js';

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

function issuePayload(lines, drafts, stockById) {
  const issues = [];
  const errors = {};
  for (const [index, line] of lines.entries()) {
    const text = drafts[line.itemId] ?? '';
    try {
      const qtyBase = quantityToBase(text, line.item.displayUnit.code, { allowZero: false });
      const stockBase = stockById.get(line.itemId);
      if (!Number.isSafeInteger(stockBase)) {
        errors[line.itemId] = 'Current stock balance is unavailable.';
      } else if (qtyBase > stockBase) {
        errors[line.itemId] = `Above stock by ${formatBaseQuantity(
          qtyBase - stockBase,
          line.item.displayUnit.code
        )} ${line.item.displayUnit.code}.`;
      } else {
        issues.push({
          itemId: line.itemId,
          qty: formatBaseQuantity(qtyBase, line.item.displayUnit.code),
          unit: line.item.displayUnit.code
        });
      }
    } catch (error) {
      errors[line.itemId] = error.message || `Enter a valid issue quantity for line ${index + 1}.`;
    }
  }
  return { issues, errors };
}

export default function NewRunPage() {
  const navigate = useNavigate();
  const bomsRequest = useAsync(async () => {
    const { data } = await api.get('/boms', { params: { active: true } });
    return readBoms(data);
  }, []);
  const stockRequest = useAsync(async () => {
    const { data } = await api.get('/stock/summary');
    return readStock(data);
  }, []);
  const [selectedId, setSelectedId] = useState('');
  const [batches, setBatches] = useState('1');
  const [plan, setPlan] = useState(null);
  const [issueDrafts, setIssueDrafts] = useState({});
  const [issueErrors, setIssueErrors] = useState({});
  const [planError, setPlanError] = useState('');
  const [planValidation, setPlanValidation] = useState('');
  const [formError, setFormError] = useState('');
  const [serverFieldErrors, setServerFieldErrors] = useState({});
  const [planning, setPlanning] = useState(false);
  const [pending, setPending] = useState(false);
  const planningRef = useRef(false);
  const pendingRef = useRef(false);

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
  const currentPlanLines = useMemo(() => {
    const planById = new Map((plan?.lines ?? []).map((line) => [line.itemId, line]));
    return rawLines.filter((line) => planById.has(line.itemId)).map((line) => ({
      ...line,
      plannedQty: planById.get(line.itemId).plannedQty
    }));
  }, [plan, rawLines]);

  useEffect(() => {
    if (boms.length > 0 && !boms.some((bom) => String(bom.id) === selectedId)) {
      setSelectedId(String(boms[0].id));
    }
  }, [boms, selectedId]);

  useEffect(() => {
    setPlan(null);
    setIssueDrafts({});
    setIssueErrors({});
    setPlanError('');
    setPlanValidation('');
  }, [selectedId]);

  const calculatePlan = async () => {
    if (!selectedBom || planningRef.current) return;
    if (!validBatches(batches)) {
      setPlanValidation('Enter batches from 0.0001 to 100, using up to 4 decimal places.');
      return;
    }
    planningRef.current = true;
    setPlanning(true);
    setPlanError('');
    setPlanValidation('');
    setFormError('');
    try {
      const { data } = await api.get(`/boms/${selectedBom.id}/plan`, { params: { batches } });
      const nextPlan = readPlan(data);
      setPlan(nextPlan);
      const plannedById = new Map(nextPlan.lines.map((line) => [line.itemId, line]));
      setIssueDrafts(Object.fromEntries(rawLines.map((line) => [
        line.itemId,
        formatBaseQuantity(plannedById.get(line.itemId)?.plannedQty ?? 0, line.item.displayUnit.code)
      ])));
      setIssueErrors({});
    } catch (error) {
      setPlanError(toApiError(error).message);
    } finally {
      planningRef.current = false;
      setPlanning(false);
    }
  };

  const submitRun = async (event) => {
    event.preventDefault();
    if (pendingRef.current || !selectedBom || !plan) return;
    const result = issuePayload(currentPlanLines, issueDrafts, stockById);
    setIssueErrors(result.errors);
    setServerFieldErrors({});
    setFormError('');
    if (Object.keys(result.errors).length > 0) return;

    pendingRef.current = true;
    setPending(true);
    try {
      const { data } = await api.post('/production/runs', {
        bomId: selectedBom.id,
        batchCount: batches,
        issues: result.issues
      });
      if (!Number.isSafeInteger(data?.id) || data.id < 1) {
        throw new TypeError('The server returned an invalid production run');
      }
      navigate(`/production/runs/${data.id}`);
    } catch (error) {
      const apiError = toApiError(error);
      let message = apiError.message;
      if (apiError.code === 'INSUFFICIENT_STOCK' && apiError.details?.shortBy > 0) {
        const line = selectedBom.lines.find((entry) => entry.itemId === apiError.details.itemId);
        const shortage = line
          ? `${formatBaseQuantity(apiError.details.shortBy, line.item.displayUnit.code)} ${line.item.displayUnit.code}`
          : String(apiError.details.shortBy);
        message = `${apiError.message}. Short by ${shortage}.`;
      }
      setFormError(message);
      setServerFieldErrors(fieldErrors(apiError.details));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  if (bomsRequest.loading) {
    return <p className="p-4 text-sm text-slate-600" role="status">Loading active recipes…</p>;
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
    return <EmptyState title="No active recipes" message="Create or activate a BOM before starting a run." />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Start production run</h1>
        <p className="mt-1 text-sm text-slate-600">Plan the batch, adjust raw issues, and check stock before issuing.</p>
      </header>

      <Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Product and active recipe"
            onChange={(event) => {
              setSelectedId(event.target.value);
              setPlan(null);
            }}
            value={selectedBom ? String(selectedBom.id) : ''}
          >
            {boms.map((bom) => (
              <option key={bom.id} value={bom.id}>{bom.finishedItem.name} — {bom.name}</option>
            ))}
          </Select>
          <Input
            error={planValidation}
            hint="0.0001 to 100 batches, up to 4 decimal places."
            inputMode="decimal"
            label="Batches"
            onChange={(event) => {
              setBatches(event.target.value);
              setPlan(null);
              setPlanError('');
              setPlanValidation('');
            }}
            value={batches}
          />
        </div>
        <Button className="mt-4" disabled={planning} loading={planning} onClick={calculatePlan}>
          Preview plan
        </Button>
        {planError && (
          <div className="mt-3">
            <ErrorBox
              loading={planning}
              message={planError}
              onRetry={calculatePlan}
            />
          </div>
        )}
        {stockRequest.loading && <p className="mt-3 text-sm text-slate-600" role="status">Loading stock balances…</p>}
        {stockRequest.error && (
          <div className="mt-3">
            <ErrorBox
              loading={stockRequest.loading}
              message={stockRequest.error.message}
              onRetry={stockRequest.reload}
            />
          </div>
        )}
      </Card>

      {plan && selectedBom && (
        <Card>
          <h2 className="font-semibold text-slate-900">Plan preview</h2>
          <p className="mt-1 text-sm text-slate-600">
            {plan.batchCount} batch(es) · expected output {plan.plannedOutputQty} {selectedBom.finishedItem.displayUnit.code}
          </p>
          <form className="mt-4 space-y-4" noValidate onSubmit={submitRun}>
            {currentPlanLines.map((line) => {
              const stockBase = stockById.get(line.itemId);
              let enteredBase = null;
              let variance = null;
              try {
                enteredBase = quantityToBase(issueDrafts[line.itemId] ?? '', line.item.displayUnit.code, {
                  allowZero: false
                });
                variance = varianceBasisPoints(line.plannedQty, enteredBase);
              } catch {
                enteredBase = null;
              }
              const issueError = issueErrors[line.itemId] ?? serverFieldErrors[`issues.${line.itemId}.qty`];
              return (
                <div className="grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-[1fr_1fr_1fr]" key={line.itemId}>
                  <div>
                    <p className="font-medium text-slate-900">{line.item.name}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Plan: {formatBaseQuantity(line.plannedQty, line.item.displayUnit.code)} {line.item.displayUnit.code}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Stock: {Number.isSafeInteger(stockBase)
                        ? `${formatBaseQuantity(stockBase, line.item.displayUnit.code)} ${line.item.displayUnit.code}`
                        : 'Unavailable'}
                    </p>
                  </div>
                  <Input
                    error={issueError}
                    inputMode="decimal"
                    label={`Issue quantity (${line.item.displayUnit.code})`}
                    onChange={(event) => {
                      setIssueDrafts((current) => ({ ...current, [line.itemId]: event.target.value }));
                      setIssueErrors((current) => ({ ...current, [line.itemId]: undefined }));
                      setFormError('');
                    }}
                    value={issueDrafts[line.itemId] ?? ''}
                  />
                  <p className={`self-center text-sm font-medium ${
                    variance === null ? 'text-slate-600' : variance > 0 ? 'text-amber-800' : variance < 0 ? 'text-blue-800' : 'text-slate-600'
                  }`}>
                    Over/under plan: {variance === null ? 'Enter a valid quantity' : formatSignedVariance(variance)}
                    {enteredBase !== null && Number.isSafeInteger(stockBase) && enteredBase > stockBase && (
                      <span className="mt-1 block text-red-800">
                        Above stock by {formatBaseQuantity(enteredBase - stockBase, line.item.displayUnit.code)} {line.item.displayUnit.code}
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
            {plan.lines.filter((line) => selectedBom.lines.find((entry) => entry.itemId === line.itemId)?.item.type === 'PACKAGING')
              .map((line) => (
                <p className="text-sm text-slate-600" key={line.itemId}>
                  {line.itemName}: {line.plannedQtyDisplay} — issued when you complete the run.
                </p>
              ))}
            {formError && <p className="text-sm text-red-800" role="alert">{formError}</p>}
            <Button
              disabled={pending || stockRequest.loading || Boolean(stockRequest.error)}
              loading={pending}
              type="submit"
            >
              Start run and issue materials
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
