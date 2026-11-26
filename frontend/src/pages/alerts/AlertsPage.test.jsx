import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminTestProviders, prepareAdminTest } from '../../test/adminPageHelpers.jsx';
import AlertsPage from './AlertsPage.jsx';

const NOW = new Date('2026-11-26T12:00:00+05:30');
const RUN = {
  runId: 7,
  runNo: 'RUN/2026-27/0001',
  completedAt: '2026-11-26T09:30:00.000Z',
  alertCount: 3
};
const VARIANCE = {
  items: [RUN],
  page: 1,
  limit: 100,
  total: 1
};
const VARIANCE_ALERTS = [
  'Yield 188 vs 200 expected (-6.00%) - flagged',
  'Oil used 19.5 l vs 20 l planned (+5.00%) - flagged',
  'Cartons used 9 pcs vs 10 pcs planned (-10.00%) - flagged'
];
const SHORTAGES = {
  items: [{
    itemId: 5,
    name: 'Murukku 200 g',
    totalShortPackets: 32,
    suggestedBatches: 1,
    message: 'Short by 32 packets of Murukku 200 g'
  }],
  totalShortPackets: 32
};

function makeItems(levels = { flour: 150000, oil: 10000, pouches: null }) {
  return [
    {
      id: 1,
      name: 'Flour',
      type: 'RAW',
      isActive: true,
      reorderLevelBase: levels.flour,
      baseUnit: { code: 'g' },
      displayUnit: { code: 'kg' }
    },
    {
      id: 2,
      name: 'Oil',
      type: 'RAW',
      isActive: true,
      reorderLevelBase: levels.oil,
      baseUnit: { code: 'ml' },
      displayUnit: { code: 'l' }
    },
    {
      id: 3,
      name: 'Pouches',
      type: 'PACKAGING',
      isActive: true,
      reorderLevelBase: levels.pouches,
      baseUnit: { code: 'pcs' },
      displayUnit: { code: 'pcs' }
    }
  ];
}

const STOCK = [
  { itemId: 1, balanceBase: 120000, balanceDisplay: '120 kg' },
  { itemId: 2, balanceBase: 19500, balanceDisplay: '19.5 l' },
  { itemId: 3, balanceBase: 306, balanceDisplay: '306 pcs' }
];

function renderAlerts({ role = 'ADMIN', routes = {} } = {}) {
  const adapter = prepareAdminTest({
    role,
    routes: {
      'GET /production/variance': { status: 200, data: VARIANCE },
      'GET /production/runs/7/variance': {
        status: 200,
        data: { runId: RUN.runId, runNo: RUN.runNo, alerts: VARIANCE_ALERTS }
      },
      'GET /stock/summary': { status: 200, data: STOCK },
      'GET /items': { status: 200, data: makeItems() },
      'GET /orders/shortages': { status: 200, data: SHORTAGES },
      'PATCH /items/1': { status: 200, data: { id: 1 } },
      ...routes
    }
  }).adapter;

  const view = render(
    <MemoryRouter initialEntries={['/alerts']}>
      <AdminTestProviders>
        <Routes>
          <Route element={<AlertsPage now={NOW} />} path="/alerts" />
        </Routes>
      </AdminTestProviders>
    </MemoryRouter>
  );
  return { adapter, ...view };
}

async function flushAsyncUpdates() {
  await act(async () => {
    for (let index = 0; index < 20; index += 1) {
      await Promise.resolve();
    }
  });
}

describe('AlertsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows server variance texts for production and omits inaccessible sections', async () => {
    const { adapter } = renderAlerts({ role: 'PRODUCTION' });

    expect(await screen.findByText(VARIANCE_ALERTS[0])).toBeInTheDocument();
    expect(screen.getByText(VARIANCE_ALERTS[1])).toBeInTheDocument();
    expect(screen.getByText(VARIANCE_ALERTS[2])).toBeInTheDocument();
    expect(screen.queryByText(/Pouches used/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View run' })).toHaveAttribute(
      'href',
      '/production/runs/7'
    );
    expect(screen.queryByText('Reorder levels')).not.toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/orders/shortages')).toBe(false);
    expect(adapter.calls.some((call) => call.method === 'patch')).toBe(false);
  });

  it('shows only low stock items and the admin hint when no levels are configured', async () => {
    const firstRender = renderAlerts();

    expect(await screen.findByText('Balance: 120 kg')).toBeInTheDocument();
    expect(screen.getByText('Reorder level: 150 kg')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Low stock' })).queryByText('Oil'))
      .not.toBeInTheDocument();
    firstRender.unmount();

    const { unmount } = renderAlerts({
      routes: {
        'GET /items': { status: 200, data: makeItems({ flour: null, oil: null, pouches: null }) }
      }
    });
    expect(await screen.findByText('Set a reorder level to get warnings.')).toBeInTheDocument();
    unmount();
  });

  it('summarizes the loaded variance, low-stock, and shortage alerts', async () => {
    renderAlerts();
    expect(await screen.findByText('3 things need attention')).toBeInTheDocument();
    expect(screen.getByText('Short by 32 packets of Murukku 200 g - suggested 1 batch.'))
      .toBeInTheDocument();
  });

  it('saves exact base units once on a double click and reloads the affected sections', async () => {
    const items = makeItems({ flour: null, oil: null, pouches: null });
    const { adapter } = renderAlerts({
      routes: {
        'GET /items': () => ({ status: 200, data: items }),
        'PATCH /items/1': (config) => {
          const body = JSON.parse(config.data);
          items[0].reorderLevelBase = body.reorderLevelBase;
          return { status: 200, data: items[0] };
        }
      }
    });
    expect(await screen.findByText('Reorder levels')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reorder levels'));

    const flourInput = await screen.findByRole('textbox', { name: 'Flour reorder level (kg)' });
    fireEvent.change(flourInput, { target: { value: '150' } });
    const saveButton = screen.getAllByRole('button', { name: 'Save' })[0];
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await screen.findByText('Reorder level saved.');
    expect(adapter.calls.filter((call) => call.method === 'patch' && call.url === '/items/1'))
      .toHaveLength(1);
    expect(adapter.calls.find((call) => call.method === 'patch').data)
      .toEqual({ reorderLevelBase: 150000 });
    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.method === 'get' && call.url === '/items'))
        .toHaveLength(4);
    });
  });

  it('blocks reorder levels with more than three decimal places without sending a request', async () => {
    const { adapter } = renderAlerts({
      routes: { 'GET /items': { status: 200, data: makeItems({ flour: null, oil: null, pouches: null }) } }
    });
    expect(await screen.findByText('Reorder levels')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reorder levels'));
    const flourInput = await screen.findByRole('textbox', { name: 'Flour reorder level (kg)' });
    fireEvent.change(flourInput, { target: { value: '0.0005' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(await screen.findByText('Enter a non-negative value with up to 3 decimal places.'))
      .toBeInTheDocument();
    expect(adapter.calls.some((call) => call.method === 'patch')).toBe(false);
  });

  it.each(['OWNER', 'ACCOUNTANT'])('%s does not see the reorder editor or save actions', async (role) => {
    const { adapter } = renderAlerts({ role });
    expect(await screen.findByText(VARIANCE_ALERTS[0])).toBeInTheDocument();
    expect(screen.queryByText('Reorder levels')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(adapter.calls.some((call) => call.method === 'patch')).toBe(false);
    expect(adapter.calls.some((call) => call.url === '/orders/shortages'))
      .toBe(role === 'OWNER');
  });

  it('retries only the failed variance section while other sections remain available', async () => {
    let attempts = 0;
    const { adapter } = renderAlerts({
      role: 'PRODUCTION',
      routes: {
        'GET /production/variance': () => {
          attempts += 1;
          return attempts === 1
            ? { status: 503, data: { error: { message: 'Variance unavailable' } } }
            : { status: 200, data: VARIANCE };
        }
      }
    });

    expect(await screen.findByText('Variance unavailable')).toBeInTheDocument();
    expect(await screen.findByText('Balance: 120 kg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(VARIANCE_ALERTS[0])).toBeInTheDocument();
    expect(adapter.calls.filter((call) => call.url === '/production/variance')).toHaveLength(2);
    expect(adapter.calls.filter((call) => call.url === '/stock/summary')).toHaveLength(1);
    expect(adapter.calls.filter((call) => call.url === '/items')).toHaveLength(1);
    expect(adapter.calls.some((call) => call.url === '/orders/shortages')).toBe(false);
  });

  it('refreshes every 60 seconds while mounted and clears the timer on unmount', async () => {
    vi.useFakeTimers();
    const { adapter, unmount } = renderAlerts({ role: 'PRODUCTION' });
    await flushAsyncUpdates();
    const initialVarianceCalls = adapter.calls.filter(
      (call) => call.url === '/production/variance'
    ).length;
    expect(initialVarianceCalls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    await flushAsyncUpdates();
    expect(adapter.calls.filter((call) => call.url === '/production/variance'))
      .toHaveLength(initialVarianceCalls + 1);

    unmount();
    const callsAfterUnmount = adapter.calls.filter(
      (call) => call.url === '/production/variance'
    ).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(adapter.calls.filter((call) => call.url === '/production/variance'))
      .toHaveLength(callsAfterUnmount);
  });
});
