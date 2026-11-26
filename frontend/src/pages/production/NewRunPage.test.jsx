import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProductionTestProviders, prepareProductionTest } from '../../test/productionPageHelpers.jsx';
import { expectStableTyping } from '../../test/remountGuard.js';
import NewRunPage from './NewRunPage.jsx';

const BOM = {
  id: 3,
  name: 'Murukku 200 g',
  version: 1,
  finishedItem: { id: 5, name: 'Murukku 200 g', displayUnit: { code: 'packet' } },
  lines: [
    { itemId: 1, itemName: 'Flour', qtyPerBatchDisplay: '40 kg', item: { id: 1, name: 'Flour', type: 'RAW', displayUnit: { code: 'kg' } } },
    { itemId: 2, itemName: 'Oil', qtyPerBatchDisplay: '10 l', item: { id: 2, name: 'Oil', type: 'RAW', displayUnit: { code: 'l' } } },
    { itemId: 3, itemName: 'Spice', qtyPerBatchDisplay: '1.2 kg', item: { id: 3, name: 'Spice', type: 'RAW', displayUnit: { code: 'kg' } } },
    { itemId: 4, itemName: 'Pouch', qtyPerBatchDisplay: '200 pcs', item: { id: 4, name: 'Pouch', type: 'PACKAGING', displayUnit: { code: 'pcs' } } },
    { itemId: 6, itemName: 'Carton', qtyPerBatchDisplay: '10 pcs', item: { id: 6, name: 'Carton', type: 'PACKAGING', displayUnit: { code: 'pcs' } } }
  ]
};

const PLAN = {
  batchCount: '1',
  plannedOutputQty: 200,
  lines: [
    { itemId: 1, itemName: 'Flour', plannedQty: 40000, plannedQtyDisplay: '40 kg' },
    { itemId: 2, itemName: 'Oil', plannedQty: 10000, plannedQtyDisplay: '10 l' },
    { itemId: 3, itemName: 'Spice', plannedQty: 1200, plannedQtyDisplay: '1.2 kg' },
    { itemId: 4, itemName: 'Pouch', plannedQty: 200, plannedQtyDisplay: '200 pcs' },
    { itemId: 6, itemName: 'Carton', plannedQty: 10, plannedQtyDisplay: '10 pcs' }
  ]
};

function renderNewRun({ oilStock = 30000, createRun } = {}) {
  const { adapter } = prepareProductionTest({
    routes: {
      'GET /boms': { status: 200, data: [BOM] },
      'GET /stock/summary': {
        status: 200,
        data: [
          { itemId: 1, balanceBase: 100000 },
          { itemId: 2, balanceBase: oilStock },
          { itemId: 3, balanceBase: 5000 }
        ]
      },
      'GET /boms/3/plan': { status: 200, data: PLAN },
      'POST /production/runs': createRun ?? { status: 201, data: { id: 41 } }
    }
  });
  render(
    <MemoryRouter initialEntries={['/production/new']}>
      <ProductionTestProviders>
        <Routes>
          <Route element={<NewRunPage />} path="/production/new" />
          <Route element={<p>RUN_DESTINATION</p>} path="/production/runs/:id" />
        </Routes>
      </ProductionTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('NewRunPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps batch and issue quantity inputs stable while typing', async () => {
    const user = userEvent.setup();
    renderNewRun();
    await screen.findByText('Start production run');
    const batches = screen.getByLabelText('Batches');
    await user.clear(batches);
    await expectStableTyping(user, () => screen.getByLabelText('Batches'), '2.5');
    fireEvent.click(screen.getByRole('button', { name: 'Preview plan' }));
    await screen.findByText(/expected output 200 packet/);
    const issue = screen.getByLabelText('Issue quantity (l)');
    await user.clear(issue);
    await expectStableTyping(user, () => screen.getByLabelText('Issue quantity (l)'), '10.5');
  });

  it('previews the BOM, shows oil over-plan, and submits the backend issue shape once', async () => {
    const adapter = renderNewRun();
    await screen.findByText('Start production run');
    fireEvent.click(screen.getByRole('button', { name: 'Preview plan' }));
    expect(await screen.findByText(/expected output 200 packet/)).toBeInTheDocument();
    const oilInput = screen.getByLabelText('Issue quantity (l)');
    fireEvent.change(oilInput, { target: { value: '10.5' } });
    expect(screen.getByText('Over/under plan: +5.00%')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Start run and issue materials' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(await screen.findByText('RUN_DESTINATION')).toBeInTheDocument();
    await waitFor(() => {
      const request = adapter.calls.find((call) => call.method === 'post' && call.url === '/production/runs');
      expect(request?.data).toEqual({
        bomId: 3,
        batchCount: '1',
        issues: [
          { itemId: 1, qty: '40', unit: 'kg' },
          { itemId: 2, qty: '10.5', unit: 'l' },
          { itemId: 3, qty: '1.2', unit: 'kg' }
        ]
      });
    });
    expect(adapter.calls.filter((call) => call.method === 'post' && call.url === '/production/runs'))
      .toHaveLength(1);
  });

  it('blocks an issue quantity above current stock before sending', async () => {
    const adapter = renderNewRun({ oilStock: 10000 });
    await screen.findByText('Start production run');
    fireEvent.click(screen.getByRole('button', { name: 'Preview plan' }));
    await screen.findByText(/expected output 200 packet/);
    fireEvent.change(screen.getByLabelText('Issue quantity (l)'), { target: { value: '10.5' } });
    expect(screen.getByText('Above stock by 0.5 l')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start run and issue materials' }));
    expect(screen.getAllByText(/Above stock by 0.5 l/)).toHaveLength(2);
    expect(adapter.calls.some((call) => call.method === 'post' && call.url === '/production/runs'))
      .toBe(false);
  });

  it('validates batch count before calling the plan endpoint', async () => {
    const adapter = renderNewRun();
    await screen.findByText('Start production run');
    fireEvent.change(screen.getByLabelText('Batches'), { target: { value: '100.00001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview plan' }));
    expect(await screen.findByText('Enter batches from 0.0001 to 100, using up to 4 decimal places.'))
      .toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/boms/3/plan')).toBe(false);
  });
});
