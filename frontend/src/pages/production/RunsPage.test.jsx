import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProductionTestProviders, prepareProductionTest } from '../../test/productionPageHelpers.jsx';
import RunsPage from './RunsPage.jsx';

const RUNS = {
  items: [{
    id: 41,
    runNo: 'RUN/2026-27/0001',
    product: { id: 5, name: 'Murukku 200 g' },
    status: 'COMPLETED',
    startedAt: '2026-11-26T10:00:00.000Z',
    plannedOutputQtyDisplay: '200 packet',
    actualGoodQtyDisplay: '188 packet',
    flagsCount: 2
  }],
  page: 1,
  limit: 20,
  total: 1
};

function LocationSearch() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderRuns({ role = 'PRODUCTION', route } = {}) {
  const { adapter } = prepareProductionTest({
    role,
    routes: {
      'GET /production/runs': route ?? { status: 200, data: RUNS }
    }
  });
  render(
    <MemoryRouter initialEntries={['/production']}>
      <ProductionTestProviders>
        <LocationSearch />
        <Routes><Route element={<RunsPage />} path="/production" /></Routes>
      </ProductionTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('RunsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows product, output, status, flags and a new-run link', async () => {
    renderRuns();
    expect(await screen.findByText('RUN/2026-27/0001')).toBeInTheDocument();
    expect(screen.getByText('Murukku 200 g')).toBeInTheDocument();
    expect(screen.getByText('200 packet')).toBeInTheDocument();
    expect(screen.getByText('188 packet')).toBeInTheDocument();
    expect(screen.getByText('Flagged (2)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New run' })).toHaveAttribute('href', '/production/new');
  });

  it('filters runs by status and sends the selected query to the API', async () => {
    const adapter = renderRuns({
      route: (config) => ({ status: 200, data: RUNS })
    });
    await screen.findByText('RUN/2026-27/0001');
    fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'ISSUED' } });
    await waitFor(() => {
      const request = adapter.calls.filter((call) => call.url === '/production/runs').at(-1);
      expect(request?.params).toMatchObject({ status: 'ISSUED', page: 1, limit: 20 });
    });
    expect(new URLSearchParams(screen.getByTestId('location-search').textContent).get('status'))
      .toBe('ISSUED');
  });

  it('keeps accountant read-only with no new-run link', async () => {
    renderRuns({ role: 'ACCOUNTANT' });
    expect(await screen.findByText('RUN/2026-27/0001')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New run' })).not.toBeInTheDocument();
  });
});
