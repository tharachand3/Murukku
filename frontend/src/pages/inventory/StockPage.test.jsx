import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { InventoryTestProviders, prepareInventoryTest } from '../../test/inventoryPageHelpers.jsx';
import StockPage from './StockPage.jsx';

const stock = [
  { itemId: 1, code: 'FLOUR', name: 'Flour', type: 'RAW', balanceBase: 120000, balanceDisplay: '120 kg' },
  { itemId: 2, code: 'OIL', name: 'Oil', type: 'RAW', balanceBase: 19000, balanceDisplay: '19 l' }
];
const items = [
  { id: 1, reorderLevelBase: 130000 },
  { id: 2, reorderLevelBase: null }
];

function renderStock(routes = {}) {
  const adapter = prepareInventoryTest({
    routes: {
      'GET /stock/summary': { status: 200, data: stock },
      'GET /items': { status: 200, data: items },
      ...routes
    }
  }).adapter;
  render(
    <MemoryRouter initialEntries={['/stock']}>
      <InventoryTestProviders>
        <Routes>
          <Route element={<StockPage />} path="/stock" />
        </Routes>
      </InventoryTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('StockPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows API display balances and only marks low items with a configured reorder level', async () => {
    const adapter = renderStock();
    expect(await screen.findByText('120 kg')).toBeInTheDocument();
    expect(screen.getByText('19 l')).toBeInTheDocument();
    expect(screen.getAllByText('Low')).toHaveLength(1);
    expect(adapter.calls.find((call) => call.url === '/stock/summary').params).toEqual({ type: 'RAW' });

    fireEvent.click(screen.getByRole('tab', { name: 'Packaging' }));
    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.url === '/stock/summary')).toHaveLength(2);
    });
    expect(adapter.calls.filter((call) => call.url === '/stock/summary')[1].params).toEqual({ type: 'PACKAGING' });
  });

  it('shows loading errors with a retry action', async () => {
    const adapter = renderStock({
      'GET /stock/summary': { status: 503, data: { error: { message: 'Stock unavailable' } } }
    });
    expect(await screen.findByText('Stock unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.url === '/stock/summary')).toHaveLength(2);
    });
  });
});
