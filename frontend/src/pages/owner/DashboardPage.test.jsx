import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminTestProviders, prepareAdminTest } from '../../test/adminPageHelpers.jsx';
import DashboardPage from './DashboardPage.jsx';

function dashboardSummary(overrides = {}) {
  return {
    generatedAt: '2026-11-26T06:30:00.000Z',
    today: {
      date: '2026-11-26',
      orders: { count: 2, taxablePaise: 1350000 },
      invoices: { count: 1, totalPaise: 787500 },
      payments: { count: 1, amountPaise: 400000 },
      dispatches: { count: 1 }
    },
    pendingApproval: { count: 1, oldestOrderDate: '2026-11-26' },
    stock: {
      finished: [{ itemId: 10, name: 'Murukku 200g', balanceBase: 88, display: '88 packets' }],
      raw: [],
      packaging: [],
      low: []
    },
    shortages: {
      totalShortPackets: 32,
      items: [{ itemId: 10, name: 'Murukku 200g', shortPackets: 32, suggestedBatches: 1 }]
    },
    variance: {
      last30Days: { completedRuns: 1, flaggedRuns: 1 },
      recentAlerts: [{
        runId: 1,
        runNo: 'PR/2026-27/0001',
        date: '2026-11-26',
        alerts: ['Yield 188 vs 200 expected (-6.00%) - flagged']
      }]
    },
    costing: {
      product: { itemId: 10, name: 'Murukku 200g' },
      latestRun: {
        runNo: 'PR/2026-27/0001',
        costPerPacketPaise: '3114.0000',
        costPerPacketDisplay: 'Rs 31.14'
      },
      sellingPricePaise: 5000,
      marginBp: 3771
    },
    receivables: {
      outstandingPaise: 387500,
      creditPaise: 0,
      over90Paise: 0,
      topCustomers: [{ customerId: 1, name: 'Retailer A', outstandingPaise: 387500 }]
    },
    ...overrides
  };
}

function renderDashboard({ role = 'ADMIN', data = dashboardSummary(), route } = {}) {
  const { adapter } = prepareAdminTest({
    role,
    routes: {
      'GET /dashboard/summary': route ?? { status: 200, data }
    }
  });
  const view = render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AdminTestProviders>
        <DashboardPage />
      </AdminTestProviders>
    </MemoryRouter>
  );
  return { ...view, adapter };
}

describe('DashboardPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the benchmark summary values', async () => {
    renderDashboard();

    expect(await screen.findByText('Taxable value: Rs 13,500.00')).toBeInTheDocument();
    expect(screen.getByText('Short by 32 packets - suggested 1 batch')).toBeInTheDocument();
    expect(screen.getByText('Rs 31.14')).toBeInTheDocument();
    expect(screen.getByText('37.71%')).toBeInTheDocument();
    expect(screen.getAllByText('Rs 3,875.00')).toHaveLength(2);
    expect(screen.getByText('Yield 188 vs 200 expected (-6.00%) - flagged')).toBeInTheDocument();
  });

  it('shows a Low chip only for items listed as low stock', async () => {
    const data = dashboardSummary({
      stock: {
        finished: [{ itemId: 10, name: 'Murukku 200g', balanceBase: 88, display: '88 packets' }],
        raw: [
          { itemId: 20, name: 'Flour', balanceBase: 120000, display: '120 kg' },
          { itemId: 21, name: 'Oil', balanceBase: 19500, display: '19.5 kg' }
        ],
        packaging: [],
        low: [{
          itemId: 20,
          name: 'Flour',
          balanceBase: 120000,
          reorderLevelBase: 150000,
          display: '120 kg'
        }]
      }
    });
    renderDashboard({ data });

    expect(await screen.findByText('Low')).toBeInTheDocument();
    const stockRow = (name) => screen.getAllByText(name)
      .map((node) => node.closest('[data-stock-item]'))
      .find(Boolean);
    expect(stockRow('Flour')).toHaveTextContent('Low');
    expect(stockRow('Oil')).not.toHaveTextContent('Low');
    expect(stockRow('Murukku 200g')).not.toHaveTextContent('Low');
  });

  it('shows friendly empty states for an empty summary', async () => {
    const data = dashboardSummary({
      today: {
        date: '2026-11-26',
        orders: { count: 0, taxablePaise: 0 },
        invoices: { count: 0, totalPaise: 0 },
        payments: { count: 0, amountPaise: 0 },
        dispatches: { count: 0 }
      },
      pendingApproval: { count: 0, oldestOrderDate: null },
      stock: { finished: [], raw: [], packaging: [], low: [] },
      shortages: { totalShortPackets: 0, items: [] },
      variance: { last30Days: { completedRuns: 0, flaggedRuns: 0 }, recentAlerts: [] },
      costing: { product: null, latestRun: null, sellingPricePaise: null, marginBp: null },
      receivables: { outstandingPaise: 0, creditPaise: 0, over90Paise: 0, topCustomers: [] }
    });
    renderDashboard({ data });

    expect(await screen.findByText('No stock items')).toBeInTheDocument();
    expect(screen.getByText('No flagged production runs')).toBeInTheDocument();
    expect(screen.getByText('No completed production run')).toBeInTheDocument();
    expect(screen.getByText('No packet shortages')).toBeInTheDocument();
    expect(screen.getByText('No customers have outstanding balances.')).toBeInTheDocument();
  });

  it('shows the server error and retries the failed request', async () => {
    let attempts = 0;
    const route = () => {
      attempts += 1;
      return attempts === 1
        ? { status: 503, data: { error: { message: 'Dashboard temporarily unavailable' } } }
        : { status: 200, data: dashboardSummary() };
    };
    renderDashboard({ route });

    expect(await screen.findByText('Dashboard temporarily unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Short by 32 packets - suggested 1 batch')).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('refreshes every 60 seconds while visible and cleans up on unmount', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-11-26T12:00:00+05:30'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const { adapter, unmount } = renderDashboard();
    const summaryCalls = () => adapter.calls.filter((call) => call.url === '/dashboard/summary');

    await waitFor(() => expect(summaryCalls()).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    await waitFor(() => expect(summaryCalls()).toHaveLength(2));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(summaryCalls()).toHaveLength(2);
  });

  it('links admins to submitted orders for pending approval', async () => {
    renderDashboard({ role: 'ADMIN' });

    expect(await screen.findByRole('link', { name: 'Review submitted orders' }))
      .toHaveAttribute('href', '/orders?status=SUBMITTED');
  });

  it('does not show the pending approval link to owners', async () => {
    renderDashboard({ role: 'OWNER' });

    expect(await screen.findByText('Submitted orders awaiting review')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review submitted orders' })).not.toBeInTheDocument();
  });
});
