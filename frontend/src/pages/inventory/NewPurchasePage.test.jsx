import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { InventoryTestProviders, prepareInventoryTest } from '../../test/inventoryPageHelpers.jsx';
import NewPurchasePage from './NewPurchasePage.jsx';

const suppliers = [{ id: 8, name: 'Flour Supplier', isActive: true }];
const items = [
  {
    id: 4, name: 'Flour', type: 'RAW',
    baseUnit: { code: 'g', dimension: 'MASS' },
    displayUnit: { code: 'kg' }
  },
  {
    id: 5, name: 'Pouch', type: 'PACKAGING',
    baseUnit: { code: 'pcs', dimension: 'COUNT' },
    displayUnit: { code: 'pcs' }
  },
  {
    id: 6, name: 'Oil', type: 'RAW',
    baseUnit: { code: 'ml', dimension: 'VOLUME' },
    displayUnit: { code: 'l' }
  }
];
const saved = {
  id: 12,
  number: 'PUR/2026-27/0001',
  totalPaise: 270000,
  totalDisplay: '2,700.00',
  lines: [{
    id: 21,
    item: { name: 'Flour' },
    qtyDisplay: '60 kg',
    rateDisplay: '4.5 paise/g',
    amountPaise: 270000,
    amountDisplay: '2,700.00'
  }]
};

function renderNewPurchase(routes = {}) {
  const adapter = prepareInventoryTest({
    routes: {
      'GET /suppliers?active=true': { status: 200, data: suppliers },
      'GET /items?active=true': { status: 200, data: items },
      'POST /purchases': { status: 201, data: saved },
      ...routes
    }
  }).adapter;
  render(
    <MemoryRouter initialEntries={['/purchases/new']}>
      <InventoryTestProviders>
        <Routes>
          <Route element={<NewPurchasePage now={new Date('2026-11-26T12:00:00+05:30')} />} path="/purchases/new" />
        </Routes>
      </InventoryTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

function fillFlourPurchase() {
  fireEvent.change(screen.getByRole('combobox', { name: /Supplier/ }), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText(/Item/), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '60' } });
  fireEvent.change(screen.getByLabelText(/Rate per unit/), { target: { value: '45' } });
}

describe('NewPurchasePage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('estimates Rs 2,700.00, sends decimal strings and shows server-returned amounts', async () => {
    const adapter = renderNewPurchase();
    await screen.findByRole('combobox', { name: /Supplier/ });
    fillFlourPurchase();
    expect(screen.getByText('Estimated amount: Rs 2,700.00')).toBeInTheDocument();
    expect(screen.getByText('Estimated total: Rs 2,700.00')).toBeInTheDocument();
    const unit = screen.getByLabelText(/Unit/);
    expect(Array.from(unit.options).map((option) => option.value)).toEqual(['kg', 'g']);

    fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
    expect(await screen.findByText('PUR/2026-27/0001')).toBeInTheDocument();
    expect(screen.getByText('Server total: Rs 2,700.00')).toBeInTheDocument();
    expect(screen.getByText('Rs 2,700.00')).toBeInTheDocument();
    await waitFor(() => expect(adapter.calls.some((call) => call.method === 'post')).toBe(true));
    const request = adapter.calls.find((call) => call.method === 'post');
    expect(request.data).toMatchObject({
      supplierId: 8,
      purchaseDate: '2026-11-26',
      lines: [{
        itemId: 4,
        qty: '60',
        unit: 'kg',
        ratePerUnitRupees: '45'
      }]
    });
  });

  it('offers only units with the selected item dimension', async () => {
    renderNewPurchase();
    await screen.findByLabelText(/^Item/);
    fireEvent.change(screen.getByLabelText(/^Item/), { target: { value: '5' } });
    expect(Array.from(screen.getByLabelText(/Unit/).options).map((option) => option.value))
      .toEqual(['pcs', 'packet']);
    fireEvent.change(screen.getByLabelText(/^Item/), { target: { value: '6' } });
    expect(Array.from(screen.getByLabelText(/Unit/).options).map((option) => option.value))
      .toEqual(['l', 'ml']);
  });

  it('blocks future purchase dates before sending a request', async () => {
    const adapter = renderNewPurchase();
    await screen.findByRole('combobox', { name: /Supplier/ });
    fillFlourPurchase();
    fireEvent.change(screen.getByLabelText(/Purchase date/), { target: { value: '2026-11-27' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
    expect(await screen.findByText('Purchase date must be today or earlier.')).toBeInTheDocument();
    expect(adapter.calls.some((call) => call.method === 'post')).toBe(false);
  });

  it('shows the backend inactive-supplier message', async () => {
    const adapter = renderNewPurchase({
      'POST /purchases': {
        status: 422,
        data: { error: { code: 'UNPROCESSABLE_ENTITY', message: 'Supplier is inactive' } }
      }
    });
    await screen.findByRole('combobox', { name: /Supplier/ });
    fillFlourPurchase();
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
    expect(await screen.findByText('Supplier is inactive')).toBeInTheDocument();
    expect(adapter.calls.filter((call) => call.method === 'post')).toHaveLength(1);
  });
});
