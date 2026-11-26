import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRegistry } from '../../../app/registry.js';
import { RegistryProvider } from '../../../app/RegistryContext.jsx';
import { AuthProvider } from '../../../context/AuthContext.jsx';
import { ToastProvider } from '../../../context/ToastContext.jsx';
import { api } from '../../../lib/api.js';
import { saveSession } from '../../../lib/session.js';
import { createMockAdapter } from '../../../test/mockAdapter.js';
import ShortagesPage from './ShortagesPage.jsx';

const ADMIN = { id: 1, name: 'Admin User', email: 'admin@demo.com', role: 'ADMIN' };

function renderShortages(response) {
  saveSession({ token: 'admin-token', user: ADMIN });
  const adapter = createMockAdapter({
    'GET /auth/me': { status: 200, data: { user: ADMIN } },
    'GET /orders/shortages': response
  });
  api.defaults.adapter = adapter;
  render(
    <MemoryRouter initialEntries={['/shortages']}>
      <ToastProvider>
        <AuthProvider>
          <RegistryProvider value={createRegistry()}>
            <Routes>
              <Route element={<ShortagesPage />} path="/shortages" />
            </Routes>
          </RegistryProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  return adapter;
}

describe('ShortagesPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows stock allocation, the suggested batch count, and order links', async () => {
    renderShortages({
      status: 200,
      data: {
        items: [{
          itemId: 5,
          name: 'Murukku 200 g',
          onHand: 88,
          reservedByApproved: 0,
          free: 88,
          openDemand: 120,
          totalShortPackets: 32,
          suggestedBatches: 1,
          message: 'Short by 32 packets of Murukku 200 g',
          orders: [{
            orderId: 22,
            orderNo: 'ORD/2026-27/0002',
            customerName: 'Distributor B',
            qty: 120,
            allocated: 88,
            shortBy: 32
          }]
        }],
        totalShortPackets: 32
      }
    });

    expect(await screen.findByText('Short by 32 packets of Murukku 200 g. Suggested: 1 batch.'))
      .toBeInTheDocument();
    for (const [label, value] of [['On hand', '88'], ['Free', '88'], ['Open demand', '120'], ['Short packets', '32']]) {
      expect(within(screen.getByText(label).parentElement).getByText(value, { exact: true }))
        .toBeInTheDocument();
    }
    const distributorOrder = screen.getByRole('row', { name: /Distributor B/ });
    expect(within(distributorOrder).getByText('120')).toBeInTheDocument();
    expect(within(distributorOrder).getByText('88')).toBeInTheDocument();
    expect(within(distributorOrder).getByText('32')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ORD/2026-27/0002' })).toHaveAttribute('href', '/orders/22');
  });

  it('shows an empty state when no orders have shortages', async () => {
    renderShortages({ status: 200, data: { items: [], totalShortPackets: 0 } });
    expect(await screen.findByText('No open order shortages')).toBeInTheDocument();
  });
});
