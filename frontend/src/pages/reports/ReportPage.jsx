import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { DateRange } from '../../components/ui/DateRange.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ErrorBox } from '../../components/ui/ErrorBox.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../lib/api.js';
import { toApiError } from '../../lib/apiError.js';
import { downloadAuthenticatedFile } from '../../lib/download.js';
import { todayIST, formatDateIST, formatDateTimeIST } from '../../lib/date.js';
import { cellTone, formatCellDisplay } from '../../lib/reportFormat.js';
import {
  canLoadReportLookup,
  reportFilterDefault,
  reportEnumLabel,
  reportFilterLabel,
  reportFilterUi,
  reportLookupItemTypes,
  reportLookupOptionLabel
} from '../../lib/reportFilterUi.js';
import './reportPrint.css';

const EMPTY_ARRAY = [];
const PERIOD_ERROR_CODES = new Set(['INVALID_PERIOD', 'PERIOD_TOO_LONG', 'TOO_MANY_ROWS']);
const NUMERIC_TYPES = new Set(['int', 'money', 'moneyDecimal', 'decimal', 'percentBp']);

function readCatalog(data) {
  if (!Array.isArray(data)) {
    throw new TypeError('The server returned an invalid reports catalog');
  }
  return data;
}

function readReport(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.sections)
    || data.sections.some((section) => (
      !section || !Array.isArray(section.columns) || !Array.isArray(section.rows)
    ))) {
    throw new TypeError('The server returned an invalid report');
  }
  return data;
}

function thisFinancialYearRange(today) {
  const [yearText, monthText] = today.split('-');
  const year = Number(yearText);
  const startYear = Number(monthText) >= 4 ? year : year - 1;
  return { from: `${startYear}-04-01`, to: today };
}

function createDraft(searchParams, report, defaultRange, today) {
  const draft = {};
  for (const filter of report.filters ?? EMPTY_ARRAY) {
    const { name } = filter;
    const queryValue = searchParams.get(name);
    const ui = reportFilterUi(report.key, filter);
    if (ui.kind === 'period') {
      draft[name] = queryValue ?? defaultRange[name];
    } else {
      draft[name] = queryValue ?? reportFilterDefault(report.key, name, today);
    }
  }
  return draft;
}

function visibleFilters(report, role) {
  return (report?.filters ?? EMPTY_ARRAY).filter((filter) => {
    const ui = reportFilterUi(report.key, filter);
    return ui.kind !== 'lookup' || canLoadReportLookup(role, filter.name);
  });
}

function buildFilterParams(draft, report, filters, defaultRange, today) {
  const params = {};
  const periodNames = new Set(filters
    .filter((filter) => reportFilterUi(report.key, filter).kind === 'period')
    .map(({ name }) => name));
  if (periodNames.has('from') && periodNames.has('to')
    && (draft.from !== defaultRange.from || draft.to !== defaultRange.to)) {
    if (draft.from) params.from = draft.from;
    if (draft.to) params.to = draft.to;
  }

  for (const filter of filters) {
    const { name } = filter;
    const kind = reportFilterUi(report.key, filter).kind;
    if (kind === 'period' || kind === 'page') {
      if (name === 'page' && Number(draft.page) > 1) {
        params.page = draft.page;
      }
      continue;
    }
    if (kind === 'limit') {
      if (draft.limit && draft.limit !== '50') params.limit = draft.limit;
      continue;
    }
    const value = draft[name] ?? '';
    const filterDefault = reportFilterDefault(report.key, name, today);
    if (kind === 'date') {
      if (value && value !== filterDefault) params[name] = value;
      continue;
    }
    if (kind === 'checkbox') {
      if (value === 'true') params[name] = 'true';
      continue;
    }
    if (value !== '' && value !== filterDefault) {
      params[name] = value;
    }
  }
  return params;
}

function paramsFromUrl(searchParams, filters, role) {
  const params = {};
  for (const filter of filters) {
    const ui = reportFilterUi(filter.reportKey, filter);
    if (ui.kind === 'lookup' && !canLoadReportLookup(role, filter.name)) {
      continue;
    }
    const value = searchParams.get(filter.name);
    if (value !== null && value !== '') {
      params[filter.name] = value;
    }
  }
  return params;
}

function validLookupList(data, endpoint) {
  if (!Array.isArray(data)) {
    throw new TypeError(`The server returned an invalid ${endpoint} list`);
  }
  return data;
}

function displayPeriod(period) {
  if (period?.from && period?.to) {
    return `${formatDateIST(period.from)} – ${formatDateIST(period.to)}`;
  }
  if (period?.asOf) {
    return `As of ${formatDateIST(period.asOf)}`;
  }
  return null;
}

function ReportTable({ section }) {
  const totals = section.totals && typeof section.totals === 'object'
    ? section.totals
    : null;
  const columns = section.columns;
  const hasTotals = totals && Object.keys(totals).length > 0;
  const labelColumn = columns.find((column) => (
    column.type === 'text' && !Object.hasOwn(totals ?? {}, column.key)
  ))?.key ?? columns[0]?.key;
  if (section.rows.length === 0 && !hasTotals) {
    return <EmptyState message="There are no rows for these filters." title="No report rows" />;
  }

  const renderCell = (column, value) => {
    const tone = cellTone(column, value);
    const alignment = NUMERIC_TYPES.has(column.type) ? 'text-right' : 'text-left';
    const toneClass = tone === 'danger' ? 'text-red-700' : 'text-slate-800';
    return (
      <td
        className={`whitespace-nowrap px-4 py-3 ${alignment} ${toneClass}`}
        data-tone={tone ?? undefined}
        key={column.key}
      >
        {formatCellDisplay(value, column.type)}
      </td>
    );
  };

  return (
    <div className="report-table-scroll overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                className={`whitespace-nowrap px-4 py-3 font-semibold text-slate-700 ${
                  NUMERIC_TYPES.has(column.type) ? 'text-right' : 'text-left'
                }`}
                key={column.key}
                scope="col"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {section.rows.map((row) => (
            <tr key={row.id ?? row.key ?? JSON.stringify(row)}>
              {columns.map((column) => renderCell(column, row[column.key]))}
            </tr>
          ))}
          {hasTotals && (
            <tr className="bg-slate-50 font-semibold">
              {columns.map((column) => (
                renderCell(
                  column,
                  Object.hasOwn(totals, column.key)
                    ? totals[column.key]
                    : column.key === labelColumn
                      ? 'Total'
                      : null
                )
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function FilterControl({
  filter,
  reportKey,
  value,
  options,
  disabled,
  onChange
}) {
  const ui = reportFilterUi(reportKey, filter);
  const label = reportFilterLabel(filter);
  if (ui.kind === 'page' || ui.kind === 'period') {
    return null;
  }
  if (ui.kind === 'lookup' || ui.kind === 'enum' || ui.kind === 'limit') {
    const entries = ui.kind === 'lookup'
      ? options
      : ui.kind === 'limit'
        ? ['25', '50', '100', '200'].map((entry) => ({ value: entry, label: entry }))
        : ui.values.map((entry) => ({ value: entry, label: reportEnumLabel(entry) }));
    return (
      <Select
        disabled={disabled}
        label={label}
        onChange={(event) => onChange(filter.name, event.target.value)}
        value={value}
      >
        {ui.kind !== 'limit' && <option value="">{ui.kind === 'lookup' ? 'All' : 'Select all'}</option>}
        {entries.map((entry) => (
          <option key={entry.value ?? entry.id} value={entry.value ?? entry.id}>
            {entry.label ?? reportLookupOptionLabel(filter.name, entry)}
          </option>
        ))}
      </Select>
    );
  }
  if (ui.kind === 'checkbox') {
    return (
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
        <input
          checked={value === 'true'}
          disabled={disabled}
          onChange={(event) => onChange(filter.name, event.target.checked ? 'true' : 'false')}
          type="checkbox"
        />
        {label}
      </label>
    );
  }
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3"
        disabled={disabled}
        onChange={(event) => onChange(filter.name, event.target.value)}
        type={ui.kind === 'date' ? 'date' : 'text'}
        value={value}
      />
      <span className="mt-1 block text-xs font-normal text-slate-500">{filter.description}</span>
    </label>
  );
}

export default function ReportPage({ now = new Date() }) {
  const { key: reportKey } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const today = todayIST(now);
  const defaultRange = thisFinancialYearRange(today);
  const [draft, setDraft] = useState({});
  const [filterError, setFilterError] = useState('');
  const [activeSectionKey, setActiveSectionKey] = useState('');
  const [csvSectionKey, setCsvSectionKey] = useState('');
  const [downloading, setDownloading] = useState('');

  useEffect(() => {
    document.body.classList.add('report-print-active');
    return () => document.body.classList.remove('report-print-active');
  }, []);

  const catalogRequest = useAsync(async () => {
    const { data } = await api.get('/reports');
    return readCatalog(data);
  }, []);
  const reports = catalogRequest.data ?? EMPTY_ARRAY;
  const report = reports.find((entry) => entry.key === reportKey) ?? null;
  const filters = visibleFilters(report, user?.role);
  const draftKey = `${reportKey}:${searchKey}:${defaultRange.from}:${defaultRange.to}`;

  useEffect(() => {
    if (report) {
      setDraft(createDraft(searchParams, report, defaultRange, today));
      setFilterError('');
    }
  // `draftKey` includes the URL and default range; report definitions are stable catalog data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, report]);

  const requestParams = paramsFromUrl(
    searchParams,
    filters.map((filter) => ({ ...filter, reportKey })),
    user?.role
  );
  const requestKey = JSON.stringify({ reportKey, params: requestParams });
  const reportRequest = useAsync(async () => {
    const { data } = await api.get(`/reports/${reportKey}`, { params: requestParams });
    return { response: readReport(data), queryKey: requestKey };
  }, [reportKey, catalogRequest.data, requestKey], { immediate: Boolean(report) });

  const lookupEndpoints = Array.from(new Set(filters
    .filter((filter) => reportFilterUi(reportKey, filter).kind === 'lookup')
    .map((filter) => reportFilterUi(reportKey, filter).endpoint)));
  const lookupKey = lookupEndpoints.join(',');
  const lookupsRequest = useAsync(async () => {
    const entries = await Promise.all(lookupEndpoints.map(async (endpoint) => {
      const { data } = await api.get(endpoint);
      return [endpoint, validLookupList(data, endpoint)];
    }));
    return Object.fromEntries(entries);
  }, [lookupKey], { immediate: Boolean(report) && lookupEndpoints.length > 0 });

  const currentResult = reportRequest.data?.queryKey === requestKey
    ? reportRequest.data.response
    : null;
  const sections = currentResult?.sections ?? EMPTY_ARRAY;
  const activeSection = sections.find(({ key: sectionKey }) => sectionKey === activeSectionKey)
    ?? sections[0]
    ?? null;
  const availableFormats = report?.exportFormats ?? EMPTY_ARRAY;
  const csvSection = sections.some(({ key: sectionKey }) => sectionKey === csvSectionKey)
    ? csvSectionKey
    : sections[0]?.key ?? '';
  const lookupData = lookupsRequest.data ?? {};
  const lookupFailure = lookupsRequest.error;

  useEffect(() => {
    if (currentResult) {
      setActiveSectionKey(currentResult.sections[0]?.key ?? '');
      setCsvSectionKey(currentResult.sections[0]?.key ?? '');
    }
  }, [currentResult?.report?.key, currentResult?.filters, currentResult?.generatedAt]);

  const changeDraft = (name, value) => {
    setDraft((current) => ({ ...current, [name]: value }));
    setFilterError('');
  };

  const applyFilters = (event) => {
    event.preventDefault();
    const hasPeriod = filters.some(({ name }) => name === 'from')
      && filters.some(({ name }) => name === 'to');
    if (hasPeriod && (!draft.from || !draft.to || draft.from > draft.to)) {
      setFilterError('from must be earlier than or equal to to');
      return;
    }
    const missingRequired = filters.find((filter) => (
      filter.required && !draft[filter.name]
    ));
    if (missingRequired) {
      setFilterError(`${reportFilterLabel(missingRequired)} is required.`);
      return;
    }
    const next = buildFilterParams(draft, report, filters, defaultRange, today);
    setSearchParams(next);
    setActiveSectionKey('');
    setFilterError('');
  };

  const onPage = (page) => {
    const next = new URLSearchParams();
    for (const filter of filters) {
      const value = searchParams.get(filter.name);
      if (value !== null && value !== '') next.set(filter.name, value);
    }
    if (page > 1) next.set('page', String(page));
    setSearchParams(next);
  };

  const download = async (format) => {
    setDownloading(format);
    const params = { ...requestParams, format };
    if (format === 'csv' && sections.length > 1 && csvSection) {
      params.section = csvSection;
    }
    try {
      await downloadAuthenticatedFile(
        `/reports/${reportKey}/export`,
        params,
        `${reportKey}.${format}`
      );
    } catch (error) {
      toast.error(toApiError(error).message);
    } finally {
      setDownloading('');
    }
  };

  const periodError = reportRequest.error
    && PERIOD_ERROR_CODES.has(reportRequest.error.code);

  if (catalogRequest.loading) {
    return <main className="mx-auto max-w-7xl"><Spinner label="Loading report catalog" /></main>;
  }
  if (catalogRequest.error) {
    return (
      <main className="mx-auto max-w-7xl">
        <ErrorBox
          loading={catalogRequest.loading}
          message={catalogRequest.error.message}
          onRetry={catalogRequest.reload}
        />
      </main>
    );
  }
  if (!report) {
    return (
      <main className="report-page mx-auto max-w-7xl space-y-4">
        <Link className="text-sm font-medium text-blue-700 hover:underline" to="/reports">
          Back to reports
        </Link>
        <EmptyState message="This report is unavailable for your role." title="Report not found" />
      </main>
    );
  }

  const hasPeriodRange = filters.some(({ name }) => name === 'from')
    && filters.some(({ name }) => name === 'to');
  const lookupOptions = (filter) => {
    const ui = reportFilterUi(reportKey, filter);
    const entries = lookupData[ui.endpoint] ?? EMPTY_ARRAY;
    const itemTypes = reportLookupItemTypes(reportKey, filter.name);
    return entries
      .filter((entry) => !itemTypes || itemTypes.includes(entry.type))
      .map((entry) => ({
        ...entry,
        value: entry.id,
        label: reportLookupOptionLabel(filter.name, entry)
      }));
  };
  const generatedAt = currentResult?.generatedAt
    ? formatDateTimeIST(currentResult.generatedAt)
    : null;
  const periodLabel = currentResult ? displayPeriod(currentResult.period) : null;

  return (
    <main className="report-page mx-auto max-w-7xl space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link className="text-sm font-medium text-blue-700 hover:underline" to="/reports">
            Back to reports
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{report.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{report.description}</p>
          {periodLabel && (
            <p className="mt-2 text-sm text-slate-700">Period: {periodLabel}</p>
          )}
          {generatedAt && (
            <p className="mt-1 text-sm text-slate-600">Generated at (IST): {generatedAt}</p>
          )}
        </div>
        <Button
          className="report-print-hide"
          onClick={() => window.print()}
          variant="secondary"
        >
          Print
        </Button>
      </header>

      {filters.length > 0 && (
        <form
          className="report-print-hide space-y-4 rounded-xl border border-slate-200 bg-white p-4"
          onSubmit={applyFilters}
        >
          {hasPeriodRange && (
            <DateRange
              from={draft.from ?? defaultRange.from}
              now={now}
              onChange={(range) => {
                setDraft((current) => ({ ...current, ...range }));
                setFilterError('');
              }}
              to={draft.to ?? defaultRange.to}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filters.map((filter) => {
              if (reportFilterUi(reportKey, filter).kind === 'period') return null;
              return (
                <FilterControl
                  disabled={lookupsRequest.loading}
                  filter={filter}
                  key={filter.name}
                  onChange={changeDraft}
                  options={lookupOptions(filter)}
                  reportKey={reportKey}
                  value={draft[filter.name] ?? ''}
                />
              );
            })}
          </div>
          {lookupFailure && (
            <ErrorBox
              loading={lookupsRequest.loading}
              message={lookupFailure.message}
              onRetry={lookupsRequest.reload}
            />
          )}
          {filterError && <p className="text-sm text-red-700" role="alert">{filterError}</p>}
          {periodError && (
            <ErrorBox
              loading={reportRequest.loading}
              message={reportRequest.error.message}
              onRetry={reportRequest.reload}
            />
          )}
          <Button
            disabled={reportRequest.loading}
            loading={reportRequest.loading}
            type="submit"
          >
            Apply filters
          </Button>
        </form>
      )}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="report-print-hide flex flex-wrap items-center justify-between gap-3">
          {sections.length > 1 && (
            <div aria-label="Report sections" className="flex flex-wrap gap-2" role="tablist">
              {sections.map((section) => (
                <button
                  aria-selected={activeSection?.key === section.key}
                  className={`min-h-11 rounded-lg px-4 text-sm font-medium ${
                    activeSection?.key === section.key
                      ? 'bg-blue-100 text-blue-900'
                      : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                  key={section.key}
                  onClick={() => setActiveSectionKey(section.key)}
                  role="tab"
                  type="button"
                >
                  {section.title}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            {sections.length > 1 && availableFormats.includes('csv') && (
              <Select
                label="CSV section"
                onChange={(event) => setCsvSectionKey(event.target.value)}
                value={csvSection}
              >
                {sections.map((section) => (
                  <option key={section.key} value={section.key}>{section.title}</option>
                ))}
              </Select>
            )}
            {availableFormats.map((format) => {
              const label = format === 'xlsx' ? 'Excel' : format.toUpperCase();
              return (
                <Button
                  disabled={Boolean(downloading)}
                  key={format}
                  loading={downloading === format}
                  onClick={() => download(format)}
                  variant="secondary"
                >
                  Download {label}
                </Button>
              );
            })}
          </div>
        </div>

        {reportRequest.loading && <Spinner label="Loading report" />}
        {reportRequest.error && !periodError && (
          <ErrorBox
            loading={reportRequest.loading}
            message={reportRequest.error.message}
            onRetry={reportRequest.reload}
          />
        )}
        {!reportRequest.loading && currentResult && sections.length === 0 && (
          <EmptyState message="This report has no sections to display." title="No report sections" />
        )}
        {!reportRequest.loading && currentResult && activeSection && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">{activeSection.title}</h2>
            <ReportTable section={activeSection} />
            {activeSection.page && activeSection.page.pages > 1 && (
              <nav
                aria-label="Report pagination"
                className="report-print-hide flex items-center justify-between gap-3"
              >
                <Button
                  disabled={reportRequest.loading || activeSection.page.page <= 1}
                  onClick={() => onPage(activeSection.page.page - 1)}
                  variant="secondary"
                >
                  Previous
                </Button>
                <span aria-live="polite" className="text-sm text-slate-700">
                  Page {activeSection.page.page} of {activeSection.page.pages}
                </span>
                <Button
                  disabled={reportRequest.loading
                    || activeSection.page.page >= activeSection.page.pages}
                  onClick={() => onPage(activeSection.page.page + 1)}
                  variant="secondary"
                >
                  Next
                </Button>
              </nav>
            )}
          </>
        )}
        {!reportRequest.loading && !currentResult && !reportRequest.error && (
          <EmptyState message="Apply the filters to load this report." title="Report not loaded" />
        )}
      </section>
    </main>
  );
}
