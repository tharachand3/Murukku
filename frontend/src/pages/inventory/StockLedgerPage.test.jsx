import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryTestProviders, prepareInventoryTest } from '../../test/inventoryPageHelpers.jsx';
import StockLedgerPage from './StockLedgerPage.jsx';

const ledger = {
  displayUnit: 'kg',
  openingBalance: 100000,
  openingBalanceDisplay: '100 kg',
  closingBalance: 160000,
  closingBalanceDisplay: '160 kg',
  rows: [
    {
      id: 1, date: '2026-11-01T04:30:00.000Z', movementType: 'OPENING',
      sourceRef: 'OPENING/1', sourceType: 'OPENING', qtyInDisplay: '100 kg',
      qtyOutDisplay: '0 kg', balanceDisplay: '100 kg', note: null
    },
    {
      id: 2, date: '2026-11-26T04:30:00.000Z', movementType: 'PURCHASE',
      sourceRef: 'PUR/2026-27/0001', sourceType: 'PURCHASE', qtyInDisplay: '60 kg',
      qtyOutDisplay: '0 kg', balanceDisplay: '160 kg', note: null
    }
  ]
};

function renderLedger(routes = {}) {
  const adapter = prepareInventoryTest({
    routes: {
      'GET /items/7': { status: 200, data: { id: 7, name: 'Flour' } },
      'GET /stock/ledger': { status: 200, data: ledger },
      'GET /reports/stock-ledger/export': {
        status: 200,
        data: new Blob(['csv']),
        headers: { 'content-disposition': 'attachment; filename="flour.csv"' }
      },
      ...routes
    }
  }).adapter;
  render(
    <MemoryRouter initialEntries={['/stock/7']}>
      <InventoryTestProviders>
        <Routes>
          <Route element={<StockLedgerPage now={new Date('2026-11-26T12:00:00+05:30')} />} path="/stock/:itemId" />
        </Routes>
      </InventoryTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('StockLedgerPage', () => {
  let originalCreateObjectURL;
  let originalRevokeObjectURL;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:ledger');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('shows running balances, opening and closing values in display units', async () => {
    renderLedger();
    expect(await screen.findByText('Stock ledger · Flour')).toBeInTheDocument();
    expect(screen.getAllByText('100 kg').length).toBeGreaterThan(0);
    expect(screen.getAllByText('160 kg').length).toBeGreaterThan(0);
    expect(screen.getByText('PUR/2026-27/0001 (PURCHASE)')).toBeInTheDocument();
    expect(screen.getByText('26-Nov-2026 10:00')).toBeInTheDocument();
  });

  it('keeps the active date filter node mounted while its ledger query refreshes', async () => {
    const adapter = renderLedger();
    await screen.findByText('Stock ledger · Flour');
    const from = screen.getByLabelText('From');
    from.focus();
    fireEvent.change(from, { target: { value: '2026-04-02' } });

    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.url === '/stock/ledger')).toHaveLength(2);
    });
    expect(from.isConnected).toBe(true);
    expect(document.activeElement).toBe(from);
    expect(screen.getByLabelText('From')).toBe(from);
  });

  it('downloads the selected export through the authenticated report endpoint', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const adapter = renderLedger();
    await screen.findByText('Stock ledger · Flour');
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => {
      expect(adapter.calls.some((call) => call.url === '/reports/stock-ledger/export')).toBe(true);
    });
    const request = adapter.calls.find((call) => call.url === '/reports/stock-ledger/export');
    expect(request.params).toMatchObject({
      format: 'csv', itemId: 7, from: '2026-04-01', to: '2026-11-26'
    });
    expect(request.headers.Authorization).toBe('Bearer step51-test-token');
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ledger');
    expect(click).toHaveBeenCalledOnce();
  });
});
