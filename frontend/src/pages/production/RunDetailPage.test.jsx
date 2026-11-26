import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProductionTestProviders, prepareProductionTest } from '../../test/productionPageHelpers.jsx';
import { expectStableTyping } from '../../test/remountGuard.js';
import RunDetailPage from './RunDetailPage.jsx';

function run(status = 'ISSUED', overrides = {}) {
  const lines = [
    { itemId: 1, itemName: 'Flour', plannedQtyBase: 40000, plannedQtyDisplay: '40 kg', issuedQtyBase: 40000, issuedQtyDisplay: '40 kg', scrapQtyBase: 0, scrapQtyDisplay: '0 kg', item: { type: 'RAW', displayUnit: { code: 'kg' } }, variance: null },
    { itemId: 2, itemName: 'Oil', plannedQtyBase: 10000, plannedQtyDisplay: '10 l', issuedQtyBase: 10500, issuedQtyDisplay: '10.5 l', scrapQtyBase: 0, scrapQtyDisplay: '0 l', item: { type: 'RAW', displayUnit: { code: 'l' } }, variance: null },
    { itemId: 3, itemName: 'Spice', plannedQtyBase: 1200, plannedQtyDisplay: '1.2 kg', issuedQtyBase: 1200, issuedQtyDisplay: '1.2 kg', scrapQtyBase: 0, scrapQtyDisplay: '0 kg', item: { type: 'RAW', displayUnit: { code: 'kg' } }, variance: null },
    { itemId: 4, itemName: 'Pouch', plannedQtyBase: 200, plannedQtyDisplay: '200 pcs', issuedQtyBase: 0, issuedQtyDisplay: '0 pcs', scrapQtyBase: 0, scrapQtyDisplay: '0 pcs', item: { type: 'PACKAGING', displayUnit: { code: 'pcs' } }, variance: null },
    { itemId: 6, itemName: 'Carton', plannedQtyBase: 10, plannedQtyDisplay: '10 pcs', issuedQtyBase: 0, issuedQtyDisplay: '0 pcs', scrapQtyBase: 0, scrapQtyDisplay: '0 pcs', item: { type: 'PACKAGING', displayUnit: { code: 'pcs' } }, variance: null }
  ];
  return {
    id: 41,
    runNo: 'RUN/2026-27/0001',
    status,
    batchCount: '1',
    batchNo: null,
    notes: null,
    startedAt: '2026-11-26T10:00:00.000Z',
    completedAt: status === 'COMPLETED' ? '2026-11-26T12:00:00.000Z' : null,
    plannedOutputQty: 200,
    actualGoodQty: status === 'COMPLETED' ? 188 : null,
    rejectedFinishedQty: status === 'COMPLETED' ? 0 : null,
    toleranceBpUsed: 300,
    materialCostPaise: 405500,
    finishedItem: { id: 5, name: 'Murukku 200 g', displayUnit: { code: 'packet' } },
    lines,
    overheads: [],
    ledgerRows: [{
      id: 1,
      itemName: 'Flour',
      movementType: 'PRODUCTION_ISSUE',
      movementDate: '2026-11-26T10:00:00.000Z',
      qtyChangeDisplay: '-40 kg',
      batchNo: null
    }],
    auditHistory: [{ id: 1, action: 'CREATE', createdAt: '2026-11-26T10:00:00.000Z', user: { name: 'Production User' } }],
    ...overrides
  };
}

const VARIANCE = {
  runId: 41,
  runNo: 'RUN/2026-27/0001',
  toleranceBpUsed: 300,
  yield: { plannedOutputQty: 200, actualGoodQty: 188, bp: -600, pct: '-6.00', flagged: true },
  lines: [
    { itemId: 2, itemName: 'Oil', plannedQty: 10000, issuedQty: 10500, scrapQty: 0, bp: 500, pct: '5.00', flagged: true },
    { itemId: 4, itemName: 'Pouch', plannedQty: 200, issuedQty: 194, scrapQty: 6, bp: -300, pct: '-3.00', flagged: false },
    { itemId: 6, itemName: 'Carton', plannedQty: 10, issuedQty: 9, scrapQty: 0, bp: -1000, pct: '-10.00', flagged: true }
  ],
  alerts: [
    'Yield 188 vs 200 expected (-6.00%) - flagged',
    'Oil used 10.5 l vs 10 l planned (+5.00%) - flagged',
    'Carton used 9 pcs vs 10 pcs planned (-10.00%) - flagged'
  ]
};

const COST_SHEET = {
  run: { id: 41, runNo: 'RUN/2026-27/0001', status: 'COMPLETED' },
  materials: [],
  materialTotals: { plannedCostPaise: 405500, actualCostPaise: 405500, costVariancePaise: 0 },
  overheads: { rows: [], totalPaise: 180000 },
  totalCostPaise: 585500,
  perPacket: { materialPaise: '2156.9149', overheadPaise: '957.4468', totalPaise: '3114.3617', display: 'Rs 31.14' },
  price: { sellingPricePaise: 5000, display: 'Rs 50.00' },
  margin: { perPacketPaise: '1885.6383', bp: 3771, pctDisplay: '37.71%' }
};

function renderRunPage({ role = 'PRODUCTION', initialRun = run(), routes = {} } = {}) {
  let currentRun = initialRun;
  const { adapter } = prepareProductionTest({
    role,
    routes: {
      'GET /production/runs/41': () => ({ status: 200, data: currentRun }),
      'GET /production/runs/41/variance': { status: 200, data: VARIANCE },
      'GET /costing/runs/41/sheet': { status: 200, data: COST_SHEET },
      ...routes
    }
  });
  render(
    <MemoryRouter initialEntries={['/production/runs/41']}>
      <ProductionTestProviders>
        <Routes><Route element={<RunDetailPage />} path="/production/runs/:id" /></Routes>
      </ProductionTestProviders>
    </MemoryRouter>
  );
  return {
    adapter,
    setRun: (next) => { currentRun = next; }
  };
}

function fillCompletion() {
  fireEvent.change(screen.getByLabelText('Good packets'), { target: { value: '188' } });
  fireEvent.change(screen.getByLabelText('Rejected packets'), { target: { value: '0' } });
  fireEvent.change(screen.getAllByLabelText('Used quantity (pcs)')[0], { target: { value: '188' } });
  fireEvent.change(screen.getAllByLabelText('Scrap quantity (pcs)')[0], { target: { value: '6' } });
  const cartonUsed = screen.getAllByLabelText('Used quantity (pcs)')[1];
  fireEvent.change(cartonUsed, { target: { value: '9' } });
}

describe('RunDetailPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('previews yield and packaging variances and submits consumption with scrap', async () => {
    let currentRun = run();
    const { adapter } = renderRunPage({
      routes: {
        'GET /production/runs/41': () => ({ status: 200, data: currentRun }),
        'POST /production/runs/41/complete': (config) => {
          currentRun = run('COMPLETED');
          return { status: 200, data: { ...currentRun, ledgerRows: [] } };
        }
      }
    });
    expect(await screen.findByText('RUN/2026-27/0001')).toBeInTheDocument();
    fillCompletion();
    expect(screen.getByText('Yield: 188 vs 200 planned (-6.00%) · Flagged')).toBeInTheDocument();
    expect(screen.getByText('Total used including scrap: 194 pcs (-3.00%)')).toBeInTheDocument();
    expect(screen.getByText('Total used including scrap: 9 pcs (-10.00%) · Flagged')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Complete production run' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(await screen.findByText(/Yield 188 vs 200 expected \(-6.00%\) - flagged/)).toBeInTheDocument();
    expect(screen.getByText(/Oil used 10.5 l vs 10 l planned \(\+5.00%\) - flagged/)).toBeInTheDocument();
    const oilRow = screen.getByRole('row', { name: /Oil RAW/ });
    expect(within(oilRow).getByText('+5.00%')).toBeInTheDocument();
    expect(within(oilRow).getByText('Flagged')).toBeInTheDocument();
    const pouchRow = screen.getByRole('row', { name: /Pouch PACKAGING/ });
    expect(within(pouchRow).getByText('-3.00%')).toBeInTheDocument();
    expect(within(pouchRow).queryByText('Flagged')).not.toBeInTheDocument();
    const post = adapter.calls.find((call) => call.method === 'post' && call.url === '/production/runs/41/complete');
    expect(post.data).toEqual({
      actualGoodQty: 188,
      rejectedFinishedQty: 0,
      consumption: [
        { itemId: 4, qty: '188', unit: 'pcs', scrapQty: '6', scrapUnit: 'pcs' },
        { itemId: 6, qty: '9', unit: 'pcs', scrapQty: '0', scrapUnit: 'pcs' }
      ]
    });
    expect(adapter.calls.filter((call) => call.method === 'post' && call.url === '/production/runs/41/complete'))
      .toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Complete production run' })).not.toBeInTheDocument();
  });

  it('shows a readable packaging stock shortage and leaves the run open', async () => {
    const { adapter } = renderRunPage({
      routes: {
        'POST /production/runs/41/complete': {
          status: 422,
          data: {
            error: {
              code: 'INSUFFICIENT_STOCK',
              message: 'Insufficient stock for "Pouch"',
              details: { itemId: 4, itemName: 'Pouch', available: 190, requested: 194, shortBy: 4 }
            }
          }
        }
      }
    });
    await screen.findByText('RUN/2026-27/0001');
    fillCompletion();
    fireEvent.click(screen.getByRole('button', { name: 'Complete production run' }));
    expect(await screen.findByText('Insufficient stock for "Pouch". Short by 4 pcs.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete production run' })).toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/production/runs/41/complete')).toBe(true);
  });

  it('shows completed run cost only for roles allowed to read costing', async () => {
    const accountant = renderRunPage({ role: 'ACCOUNTANT', initialRun: run('COMPLETED') });
    expect(await screen.findByText('Rs 31.14')).toBeInTheDocument();
    expect(screen.getByText('37.71%')).toBeInTheDocument();
    expect(accountant.adapter.calls.some((call) => call.url === '/costing/runs/41/sheet')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Complete production run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add overhead' })).not.toBeInTheDocument();

    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    renderRunPage({ role: 'OWNER', initialRun: run('COMPLETED') });
    expect(await screen.findByText('Rs 31.14')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add overhead' })).not.toBeInTheDocument();

    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    const production = renderRunPage({ role: 'PRODUCTION', initialRun: run('COMPLETED') });
    expect(await screen.findByText('Variance results')).toBeInTheDocument();
    expect(screen.queryByText('Run cost')).not.toBeInTheDocument();
    expect(production.adapter.calls.some((call) => call.url === '/costing/runs/41/sheet')).toBe(false);
  });

  it('adds overhead in paise and confirms overhead deletion', async () => {
    let currentRun = run('ISSUED', {
      overheads: [{ id: 12, kind: 'LABOUR', kindLabel: 'Labour', amountPaise: 120000, note: 'Shift labour' }]
    });
    const { adapter } = renderRunPage({
      routes: {
        'GET /production/runs/41': () => ({ status: 200, data: currentRun }),
        'POST /production/runs/41/overheads': () => {
          currentRun = run('ISSUED', {
            overheads: [...currentRun.overheads, {
              id: 13,
              kind: 'LABOUR',
              kindLabel: 'Labour',
              amountPaise: 120000,
              note: 'Shift labour'
            }]
          });
          return { status: 201, data: { overhead: { id: 13 }, cost: {} } };
        },
        'DELETE /production/runs/41/overheads/12': () => {
          currentRun = run('ISSUED', { overheads: currentRun.overheads.filter((entry) => entry.id !== 12) });
          return { status: 200, data: { cost: {} } };
        }
      }
    });
    await screen.findByText('Shift labour');
    const user = userEvent.setup();
    await expectStableTyping(user, () => screen.getByLabelText('Amount (Rs)'), '1200');
    await expectStableTyping(user, () => screen.getByLabelText('Note (optional)'), 'Shift labour');
    fireEvent.click(screen.getByRole('button', { name: 'Add overhead' }));
    await waitFor(() => {
      expect(adapter.calls.find((call) => call.method === 'post' && call.url === '/production/runs/41/overheads')?.data)
        .toEqual({ kind: 'LABOUR', amountPaise: 120000, note: 'Shift labour' });
    });
    await screen.findAllByRole('button', { name: 'Delete overhead' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete overhead' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Confirm overhead deletion' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete overhead' }));
    await waitFor(() => {
      expect(adapter.calls.some((call) => call.method === 'delete' && call.url === '/production/runs/41/overheads/12'))
        .toBe(true);
    });

  });

  it('keeps production completion quantities and notes stable while typing', async () => {
    const user = userEvent.setup();
    renderRunPage();
    await screen.findByText('RUN/2026-27/0001');
    await expectStableTyping(user, () => screen.getByLabelText('Good packets'), '188');
    await expectStableTyping(user, () => screen.getByLabelText('Rejected packets'), '2');
    await expectStableTyping(
      user,
      () => screen.getByLabelText('Completion notes (optional)'),
      'Evening production shift'
    );
  });

  it('shows the server message when a completion is rejected as already closed', async () => {
    renderRunPage({
      routes: {
        'POST /production/runs/41/complete': {
          status: 409,
          data: {
            error: {
              code: 'RUN_NOT_OPEN',
              message: 'Production run is not open for completion',
              details: { runId: 41, status: 'COMPLETED' }
            }
          }
        }
      }
    });
    await screen.findByText('RUN/2026-27/0001');
    fillCompletion();
    fireEvent.click(screen.getByRole('button', { name: 'Complete production run' }));
    expect(await screen.findByText('Production run is not open for completion')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete production run' })).toBeInTheDocument();
  });

  it('requires a cancellation reason before posting and sends it to the API', async () => {
    let finishCancel;
    const { adapter } = renderRunPage({
      routes: {
        'POST /production/runs/41/cancel': () => new Promise((resolve) => {
          finishCancel = () => resolve({ status: 200, data: {} });
        })
      }
    });
    await screen.findByText('RUN/2026-27/0001');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel production run' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm cancellation' }));
    expect(await within(dialog).findByText('Enter a cancellation reason.')).toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/production/runs/41/cancel')).toBe(false);
    const user = userEvent.setup();
    await expectStableTyping(user, () => within(dialog).getByRole('textbox', { name: 'Reason' }), 'Wrong batch selected');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm cancellation' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => {
      const calls = adapter.calls.filter((call) => call.url === '/production/runs/41/cancel');
      expect(calls).toHaveLength(1);
      expect(calls[0].data).toEqual({ reason: 'Wrong batch selected' });
    });
    finishCancel();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Cancel production run' })).not.toBeInTheDocument();
    });
  });
});
