import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { InventoryTestProviders, prepareInventoryTest } from '../../test/inventoryPageHelpers.jsx';
import PurchasesPage from './PurchasesPage.jsx';

const supplier = { id: 8, name: 'Flour Supplier' };
const purchase = {
  id: 11,
  number: 'PUR/2026-27/0001',
  purchaseDate: '2026-11-26T00:00:00.000Z',
  supplier,
  supplierInvoiceNo: 'FS-100',
  totalPaise: 270000,
  lines: [{ id: 1 }]
};

function renderPurchases(routes = {}) {
  const adapter = prepareInventoryTest({
    routes: {
      'GET /suppliers?active=true': { status: 200, data: [supplier] },
      'GET /purchases': { status: 200, data: { items: [purchase], page: 1, limit: 100 } },
      ...routes
    }
  }).adapter;
  render(
    <MemoryRouter initialEntries={['/purchases']}>
      <InventoryTestProviders>
        <Routes>
          <Route element={<PurchasesPage now={new Date('2026-11-26T12:00:00+05:30')} />} path="/purchases" />
        </Routes>
      </InventoryTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('PurchasesPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('filters purchases by supplier and shows the returned page total', async () => {
    const adapter = renderPurchases();
    expect(await screen.findByText('PUR/2026-27/0001')).toBeInTheDocument();
    expect(screen.getByText('Rs 2,700.00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.url === '/purchases')).toHaveLength(2);
    });
    expect(adapter.calls.filter((call) => call.url === '/purchases')[1].params)
      .toMatchObject({ supplierId: '8', page: 1, limit: 100 });
  });

  it('does not offer purchase creation to read-only roles', async () => {
    const adapter = prepareInventoryTest({
      role: 'ACCOUNTANT',
      routes: {
        'GET /suppliers?active=true': { status: 200, data: [supplier] },
        'GET /purchases': { status: 200, data: { items: [purchase], page: 1, limit: 100 } }
      }
    }).adapter;
    render(
      <MemoryRouter initialEntries={['/purchases']}>
        <InventoryTestProviders>
          <Routes><Route element={<PurchasesPage />} path="/purchases" /></Routes>
        </InventoryTestProviders>
      </MemoryRouter>
    );
    expect(await screen.findByText('PUR/2026-27/0001')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New purchase' })).not.toBeInTheDocument();
    expect(adapter.calls.some((call) => call.method === 'post')).toBe(false);
  });
});
