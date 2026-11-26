import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminTestProviders, prepareAdminTest } from '../../test/adminPageHelpers.jsx';
import { expectStableTyping } from '../../test/remountGuard.js';
import ReportPage from './ReportPage.jsx';

const NOW = new Date('2026-11-26T06:30:00.000Z');
const PERIOD_FILTERS = [
  { name: 'from', type: 'date', description: 'First inclusive IST calendar day' },
  { name: 'to', type: 'date', description: 'Last inclusive IST calendar day' }
];
const SALES_COLUMNS = [
  { key: 'invoiceNo', label: 'Invoice no.', type: 'text' },
  { key: 'totalPaise', label: 'Total', type: 'money' }
];

function catalogEntry({
  key = 'sales-register',
  title = 'Sales register',
  group = 'sales',
  filters = PERIOD_FILTERS,
  sections = [{ key: 'invoices', title: 'Invoices' }],
  exportFormats = ['csv', 'xlsx', 'pdf']
} = {}) {
  return {
    key,
    title,
    description: 'Report details.',
    group,
    capability: 'reports:read',
    filters,
    exportFormats,
    sections
  };
}

function reportResponse({
  key = 'sales-register',
  sections = [{
    key: 'invoices',
    title: 'Invoices',
    columns: SALES_COLUMNS,
    rows: [{ invoiceNo: 'INV/2026-27/0001', totalPaise: 787500 }],
    totals: { totalPaise: 787500 },
    page: null
  }],
  period = { from: '2026-04-01', to: '2026-11-26' }
} = {}) {
  return {
    report: { key, title: 'Mock report', description: 'Report details.', group: 'sales' },
    filters: {},
    period,
    generatedAt: '2026-11-26T06:30:00.000Z',
    sections
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="current-search">{location.search}</output>;
}

function renderReport({
  key = 'sales-register',
  role = 'ADMIN',
  catalog = [catalogEntry({ key })],
  response = reportResponse({ key }),
  routes = {},
  initialPath = `/reports/${key}`,
  now = NOW
} = {}) {
  const adapter = prepareAdminTest({
    role,
    routes: {
      'GET /reports': { status: 200, data: catalog },
      [`GET /reports/${key}`]: { status: 200, data: response },
      ...routes
    }
  }).adapter;

  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AdminTestProviders>
        <Routes>
          <Route
            element={<><ReportPage now={now} /><LocationProbe /></>}
            path="/reports/:key"
          />
        </Routes>
      </AdminTestProviders>
    </MemoryRouter>
  );
  return adapter;
}

describe('ReportPage', () => {
  let originalCreateObjectURL;
  let originalRevokeObjectURL;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('renders the sales row and server totals while omitting the unchanged default period', async () => {
    const adapter = renderReport();

    expect(await screen.findByText('INV/2026-27/0001')).toBeInTheDocument();
    expect(screen.getAllByText('Rs 7,875.00')).toHaveLength(2);
    expect(screen.getAllByText('Total')).toHaveLength(2);
    expect(screen.getByText(/Generated at \(IST\): 26-Nov-2026/)).toBeInTheDocument();
    const reportCall = adapter.calls.find((call) => call.url === '/reports/sales-register');
    expect(reportCall.params).toEqual({});
  });

  it('puts a changed period in the URL and sends the same dates to the report API', async () => {
    const adapter = renderReport();
    await screen.findByText('INV/2026-27/0001');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-04-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.url === '/reports/sales-register')).toHaveLength(2);
    });
    expect(screen.getByTestId('current-search')).toHaveTextContent(
      '?from=2026-04-02&to=2026-11-26'
    );
    expect(adapter.calls.filter((call) => call.url === '/reports/sales-register')[1].params)
      .toEqual({ from: '2026-04-02', to: '2026-11-26' });
  });

  it('submits an enum and a customer lookup selection as report filters', async () => {
    const filters = [
      ...PERIOD_FILTERS,
      { name: 'customerId', type: 'int', description: 'Filter to one customer' },
      { name: 'status', type: 'text', description: 'ALL, POSTED, or CANCELLED' },
      { name: 'taxType', type: 'text', description: 'ALL, INTRA, or INTER state tax' }
    ];
    const adapter = renderReport({
      catalog: [catalogEntry({ filters })],
      routes: {
        'GET /customers': { status: 200, data: [{ id: 7, name: 'Retailer A' }] }
      }
    });
    await screen.findByText('INV/2026-27/0001');
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Tax type'), { target: { value: 'INTRA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(adapter.calls.filter((call) => call.url === '/reports/sales-register')).toHaveLength(2);
    });
    expect(adapter.calls.filter((call) => call.url === '/reports/sales-register')[1].params)
      .toEqual({ customerId: '7', taxType: 'INTRA' });
    expect(screen.getByTestId('current-search')).toHaveTextContent('customerId=7');
    expect(screen.getByTestId('current-search')).toHaveTextContent('taxType=INTRA');
  });

  it('keeps free-text report filters stable while typing', async () => {
    const user = userEvent.setup();
    renderReport({
      catalog: [catalogEntry({
        filters: [
          ...PERIOD_FILTERS,
          { name: 'searchTerm', type: 'text', description: 'Search report rows' }
        ]
      })]
    });
    await screen.findByText('INV/2026-27/0001');
    await expectStableTyping(user, () => screen.getByRole('textbox', { name: /Search Term/ }), 'invoice search');
  });

  it('shows API sections as tabs and switches the visible table', async () => {
    const sections = [
      {
        key: 'gstr1-b2b',
        title: 'Registered recipients',
        columns: [{ key: 'invoiceNo', label: 'Invoice', type: 'text' }],
        rows: [{ invoiceNo: 'B2B-001' }],
        totals: null,
        page: null
      },
      {
        key: 'gstr1-hsn',
        title: 'HSN summary',
        columns: [{ key: 'hsnCode', label: 'HSN', type: 'text' }],
        rows: [{ hsnCode: '1905' }],
        totals: null,
        page: null
      },
      {
        key: 'gstr1-docs',
        title: 'Documents issued',
        columns: [{ key: 'serial', label: 'Serial', type: 'text' }],
        rows: [{ serial: 'DOC-01' }],
        totals: null,
        page: null
      }
    ];
    renderReport({
      key: 'gst-summary',
      catalog: [catalogEntry({
        key: 'gst-summary',
        title: 'GST summary',
        group: 'gst',
        sections: sections.map(({ key, title }) => ({ key, title }))
      })],
      response: reportResponse({ key: 'gst-summary', sections })
    });

    expect(await screen.findByText('B2B-001')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    fireEvent.click(screen.getByRole('tab', { name: 'HSN summary' }));
    expect(screen.getByText('1905')).toBeInTheDocument();
    expect(screen.queryByText('B2B-001')).not.toBeInTheDocument();
  });

  it('requests page two while preserving the active filters', async () => {
    const filters = [
      ...PERIOD_FILTERS,
      { name: 'status', type: 'text', description: 'Invoice status' },
      { name: 'page', type: 'int', description: 'Page number' },
      { name: 'limit', type: 'int', description: 'Rows per page' }
    ];
    const adapter = renderReport({
      catalog: [catalogEntry({ filters })],
      initialPath: '/reports/sales-register?from=2026-04-01&to=2026-11-26&status=POSTED',
      routes: {
        'GET /reports/sales-register': (config) => {
          const page = Number(config.params?.page ?? 1);
          return {
            status: 200,
            data: reportResponse({
              sections: [{
                key: 'invoices',
                title: 'Invoices',
                columns: SALES_COLUMNS,
                rows: [{ invoiceNo: `PAGE-${page}`, totalPaise: 100 }],
                totals: null,
                page: { page, limit: 50, total: 60, pages: 2 }
              }]
            })
          };
        }
      }
    });

    expect(await screen.findByText('PAGE-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('PAGE-2');
    expect(adapter.calls.filter((call) => call.url === '/reports/sales-register')[1].params)
      .toEqual({
        from: '2026-04-01',
        to: '2026-11-26',
        status: 'POSTED',
        page: '2'
      });
  });

  it('downloads the selected CSV section through the authenticated helper', async () => {
    const sections = [
      {
        key: 'gstr3b-outward',
        title: 'Outward taxable supplies',
        columns: [{ key: 'label', label: 'Category', type: 'text' }],
        rows: [{ label: 'Taxable' }],
        totals: null,
        page: null
      },
      {
        key: 'gstr1-hsn',
        title: 'HSN summary',
        columns: [{ key: 'hsnCode', label: 'HSN', type: 'text' }],
        rows: [{ hsnCode: '1905' }],
        totals: null,
        page: null
      },
      {
        key: 'gstr1-docs',
        title: 'Documents issued',
        columns: [{ key: 'serial', label: 'Serial', type: 'text' }],
        rows: [{ serial: 'DOC-01' }],
        totals: null,
        page: null
      }
    ];
    const adapter = renderReport({
      key: 'gst-summary',
      catalog: [catalogEntry({
        key: 'gst-summary',
        title: 'GST summary',
        group: 'gst',
        sections: sections.map(({ key, title }) => ({ key, title }))
      })],
      response: reportResponse({ key: 'gst-summary', sections }),
      initialPath: '/reports/gst-summary?from=2026-04-01&to=2026-11-26',
      routes: {
        'GET /reports/gst-summary/export': {
          status: 200,
          data: new Blob(['csv']),
          headers: { 'content-disposition': 'attachment; filename="gst-summary.csv"' }
        }
      }
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await screen.findByText('Taxable');
    fireEvent.change(screen.getByLabelText('CSV section'), {
      target: { value: 'gstr1-hsn' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

    await waitFor(() => {
      expect(adapter.calls.some((call) => call.url === '/reports/gst-summary/export')).toBe(true);
    });
    const exportCall = adapter.calls.find((call) => call.url === '/reports/gst-summary/export');
    expect(exportCall.params).toEqual({
      from: '2026-04-01',
      to: '2026-11-26',
      format: 'csv',
      section: 'gstr1-hsn'
    });
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('downloads the sales register CSV with the current period and triggers a file download', async () => {
    const adapter = renderReport({
      initialPath: '/reports/sales-register?from=2026-04-01&to=2026-11-26',
      routes: {
        'GET /reports/sales-register/export': {
          status: 200,
          data: new Blob(['csv']),
          headers: { 'content-disposition': 'attachment; filename="sales-register.csv"' }
        }
      }
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await screen.findByText('INV/2026-27/0001');
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => {
      expect(adapter.calls.some((call) => call.url === '/reports/sales-register/export')).toBe(true);
    });

    const exportCall = adapter.calls.find((call) => call.url === '/reports/sales-register/export');
    expect(exportCall.params).toEqual({
      from: '2026-04-01',
      to: '2026-11-26',
      format: 'csv'
    });
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('does not request lookup data for hidden ID filters', async () => {
    const filters = [
      ...PERIOD_FILTERS,
      { name: 'customerId', type: 'int', description: 'Filter to one customer' }
    ];
    const adapter = renderReport({
      role: 'SALESMAN',
      catalog: [catalogEntry({ filters })]
    });

    expect(await screen.findByText('INV/2026-27/0001')).toBeInTheDocument();
    expect(screen.queryByLabelText('Customer')).not.toBeInTheDocument();
    expect(adapter.calls.some((call) => call.url === '/customers')).toBe(false);
    expect(adapter.calls.find((call) => call.url === '/reports/sales-register').params)
      .toEqual({});
  });

  it.each([
    ['INVALID_PERIOD', 'from must be earlier than or equal to to'],
    ['PERIOD_TOO_LONG', 'Report periods cannot exceed 731 days'],
    ['TOO_MANY_ROWS', 'The report exceeds the maximum row count']
  ])('shows the server message for %s beside the filters', async (code, message) => {
    renderReport({
      routes: {
        'GET /reports/sales-register': {
          status: code === 'INVALID_PERIOD' ? 400 : 422,
          data: { error: { code, message } }
        }
      }
    });

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('blocks an inverted date range before making another request', async () => {
    const adapter = renderReport();
    await screen.findByText('INV/2026-27/0001');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-27' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(screen.getByText('from must be earlier than or equal to to')).toBeInTheDocument();
    expect(adapter.calls.filter((call) => call.url === '/reports/sales-register')).toHaveLength(1);
  });
});
