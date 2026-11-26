import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { InventoryTestProviders, prepareInventoryTest } from '../../test/inventoryPageHelpers.jsx';
import { expectStableTyping } from '../../test/remountGuard.js';
import AdjustmentsPage from './AdjustmentsPage.jsx';

const flour = {
  id: 4, name: 'Flour', type: 'RAW',
  baseUnit: { code: 'g', dimension: 'MASS' },
  displayUnit: { code: 'kg' }
};
const stock = [{ itemId: 4, balanceBase: 160000, balanceDisplay: '160 kg' }];
const adjustment = {
  id: 3,
  number: 'ADJ/2026-27/0001',
  item: { name: 'Flour' },
  direction: 'OUT',
  qtyDisplay: '2 kg',
  reason: 'DAMAGE',
  createdBy: { name: 'Production User' }
};

function renderAdjustments({ role = 'PRODUCTION', routes = {} } = {}) {
  const adapter = prepareInventoryTest({
    role,
    routes: {
      'GET /items?active=true': { status: 200, data: [flour] },
      'GET /stock/summary': { status: 200, data: stock },
      'GET /stock/adjustments': { status: 200, data: { items: [adjustment], page: 1, limit: 20 } },
      'POST /stock/adjustments': {
        status: 201,
        data: { ...adjustment, balanceAfterDisplay: '158 kg' }
      },
      ...routes
    }
  }).adapter;
  render(
    <MemoryRouter initialEntries={['/stock/adjustments']}>
      <InventoryTestProviders>
        <Routes><Route element={<AdjustmentsPage />} path="/stock/adjustments" /></Routes>
      </InventoryTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('AdjustmentsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps adjustment quantity and note stable while typing', async () => {
    const user = userEvent.setup();
    renderAdjustments();
    await screen.findByText('ADJ/2026-27/0001');
    await expectStableTyping(user, () => screen.getByLabelText(/Quantity/), '12.5');
    await expectStableTyping(user, () => screen.getByLabelText('Note'), 'Spillage near mixer');
  });

  it('posts the OUT adjustment payload and shows the new document number', async () => {
    const adapter = renderAdjustments();
    await screen.findByText('ADJ/2026-27/0001');
    fireEvent.change(screen.getByLabelText(/Item/), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'DAMAGE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(await screen.findByText(/ADJ\/2026-27\/0001 recorded\. Balance: 158 kg\./)).toBeInTheDocument();
    const request = adapter.calls.find((call) => call.method === 'post');
    expect(request.data).toEqual({
      itemId: 4, direction: 'OUT', qty: '2', unit: 'kg', reason: 'DAMAGE'
    });
  });

  it('warns above balance and preserves the server insufficient-stock message', async () => {
    const adapter = renderAdjustments({
      routes: {
        'POST /stock/adjustments': {
          status: 422,
          data: {
            error: {
              code: 'INSUFFICIENT_STOCK',
              message: 'Insufficient stock for "Flour"',
              details: { itemId: 4, shortBy: 2000 }
            }
          }
        }
      }
    });
    await screen.findByText('ADJ/2026-27/0001');
    fireEvent.change(screen.getByLabelText(/Item/), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '162' } });
    expect(screen.getByText(/above the current balance/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(await screen.findByText(/Insufficient stock for "Flour" Short by 2000 base units\./)).toBeInTheDocument();
    await waitFor(() => expect(adapter.calls.filter((call) => call.method === 'post')).toHaveLength(1));
  });

  it.each(['OWNER', 'ACCOUNTANT'])('shows only the list for %s', async (role) => {
    renderAdjustments({ role });
    expect(await screen.findByText('ADJ/2026-27/0001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save adjustment' })).not.toBeInTheDocument();
  });
});
