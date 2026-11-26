import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProductionTestProviders, prepareProductionTest } from '../../test/productionPageHelpers.jsx';
import BomsPage from './BomsPage.jsx';

const BOM = {
  id: 3,
  name: 'Murukku 200 g',
  version: 1,
  isActive: true,
  batchYieldQty: 200,
  finishedItem: {
    id: 5,
    name: 'Murukku 200 g',
    displayUnit: { code: 'packet' }
  },
  lines: [
    { itemId: 1, itemName: 'Flour', qtyPerBatch: 40000, qtyPerBatchDisplay: '40 kg', item: { id: 1, name: 'Flour', type: 'RAW', displayUnit: { code: 'kg' } } },
    { itemId: 2, itemName: 'Oil', qtyPerBatch: 10000, qtyPerBatchDisplay: '10 l', item: { id: 2, name: 'Oil', type: 'RAW', displayUnit: { code: 'l' } } },
    { itemId: 3, itemName: 'Spice', qtyPerBatch: 1200, qtyPerBatchDisplay: '1.2 kg', item: { id: 3, name: 'Spice', type: 'RAW', displayUnit: { code: 'kg' } } },
    { itemId: 4, itemName: 'Pouch', qtyPerBatch: 200, qtyPerBatchDisplay: '200 pcs', item: { id: 4, name: 'Pouch', type: 'PACKAGING', displayUnit: { code: 'pcs' } } },
    { itemId: 6, itemName: 'Carton', qtyPerBatch: 10, qtyPerBatchDisplay: '10 pcs', item: { id: 6, name: 'Carton', type: 'PACKAGING', displayUnit: { code: 'pcs' } } }
  ]
};

function planFor(batches) {
  const scale = batches === '0.5' ? 0.5 : 1;
  return {
    batchCount: batches,
    plannedOutputQty: 200 * scale,
    lines: BOM.lines.map((line) => ({
      itemId: line.itemId,
      itemName: line.itemName,
      plannedQty: line.qtyPerBatch * scale,
      plannedQtyDisplay: `${line.qtyPerBatch * scale / (line.item.displayUnit.code === 'kg' || line.item.displayUnit.code === 'l' ? 1000 : 1)} ${line.item.displayUnit.code}`
    }))
  };
}

function renderBoms({ flourStock = 100000 } = {}) {
  const { adapter } = prepareProductionTest({
    routes: {
      'GET /boms': { status: 200, data: [BOM] },
      'GET /stock/summary': {
        status: 200,
        data: [
          { itemId: 1, balanceBase: flourStock },
          { itemId: 2, balanceBase: 30000 },
          { itemId: 3, balanceBase: 5000 },
          { itemId: 4, balanceBase: 500 },
          { itemId: 6, balanceBase: 30 }
        ]
      },
      'GET /boms/3/plan': (config) => ({
        status: 200,
        data: planFor(config.params.batches ?? '1')
      })
    }
  });
  render(
    <MemoryRouter initialEntries={['/boms']}>
      <ProductionTestProviders>
        <Routes><Route element={<BomsPage />} path="/boms" /></Routes>
      </ProductionTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('BomsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows recipe yield and the full-batch plan in display units', async () => {
    const adapter = renderBoms();
    expect(await screen.findByText(/Expected yield per batch: 200 packet/)).toBeInTheDocument();
    expect(screen.getByText('40 kg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate plan' }));
    expect(await screen.findByText('Flour: 40 kg')).toBeInTheDocument();
    expect(screen.getByText('Oil: 10 l')).toBeInTheDocument();
    expect(screen.getByText('Spice: 1.2 kg')).toBeInTheDocument();
    expect(screen.getByText('Pouch: 200 pcs')).toBeInTheDocument();
    expect(screen.getByText('Carton: 10 pcs')).toBeInTheDocument();
    expect(screen.getByText('Planned output: 200 packet')).toBeInTheDocument();
    await waitFor(() => {
      expect(adapter.calls.find((call) => call.url === '/boms/3/plan')?.params).toEqual({ batches: '1' });
    });
  });

  it('halves the plan for half a batch and shows stock shortage from base integers', async () => {
    renderBoms({ flourStock: 19900 });
    await screen.findByText(/Expected yield per batch/);
    fireEvent.change(screen.getByLabelText('Batches'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate plan' }));
    expect(await screen.findByText('Planned output: 100 packet')).toBeInTheDocument();
    expect(screen.getByText('Flour: 20 kg')).toBeInTheDocument();
    expect(screen.getByText('Oil: 5 l')).toBeInTheDocument();
    expect(screen.getByText('Spice: 0.6 kg')).toBeInTheDocument();
    expect(screen.getByText('Pouch: 100 pcs')).toBeInTheDocument();
    expect(screen.getByText('Carton: 5 pcs')).toBeInTheDocument();
    expect(screen.getByText('Short by 0.1 kg')).toBeInTheDocument();
  });

  it('plans from a selected raw-material issue quantity', async () => {
    const adapter = renderBoms();
    await screen.findByText(/Expected yield per batch/);
    fireEvent.change(screen.getByLabelText('Planning mode'), { target: { value: 'issued' } });
    fireEvent.change(screen.getByLabelText('Issued quantity (kg)'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate plan' }));
    await waitFor(() => {
      const request = adapter.calls.find((call) => call.url === '/boms/3/plan');
      expect(request?.params).toEqual({ itemId: 1, qty: '20', unit: 'kg' });
    });
  });

  it('plans from a target packet count', async () => {
    const adapter = renderBoms();
    await screen.findByText(/Expected yield per batch/);
    fireEvent.change(screen.getByLabelText('Planning mode'), { target: { value: 'targetOutput' } });
    fireEvent.change(screen.getByLabelText('Target packets'), { target: { value: '400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate plan' }));
    await waitFor(() => {
      expect(adapter.calls.find((call) => call.url === '/boms/3/plan')?.params)
        .toEqual({ targetOutput: '400' });
    });
  });
});
