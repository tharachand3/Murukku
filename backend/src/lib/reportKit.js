import { z } from 'zod';
import { AppError } from './errors.js';
import { financialYearOf } from './fy.js';
import { isValidIstDate, istDayRange } from './istDate.js';
import { CAPABILITY_MATRIX } from '../config/permissions.js';

export const COLUMN_TYPES = Object.freeze([
  'text',
  'date',
  'int',
  'money',
  'moneyDecimal',
  'decimal',
  'percentBp'
]);

const REPORT_GROUPS = new Set([
  'sales',
  'gst',
  'stock',
  'purchases',
  'production',
  'receivables',
  'costing'
]);

const istCalendarDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

export function formatIstDate(date) {
  const parts = Object.fromEntries(
    istCalendarDate.formatToParts(date).map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function defineReport(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('Report definition must be an object');
  }
  const {
    key,
    title,
    description,
    group,
    capability,
    filtersSchema,
    filterDocs,
    run
  } = definition;
  if (typeof key !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    throw new TypeError('Report key must be lowercase kebab-case');
  }
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new TypeError('Report title is required');
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new TypeError('Report description is required');
  }
  if (!REPORT_GROUPS.has(group)) {
    throw new TypeError('Unknown report group');
  }
  if (typeof capability !== 'string' || !CAPABILITY_MATRIX[capability]) {
    throw new TypeError('Report capability must exist in the permissions matrix');
  }
  if (!(filtersSchema instanceof z.ZodObject)) {
    throw new TypeError('Report filtersSchema must be a Zod object');
  }
  if (
    !Array.isArray(filterDocs) ||
    filterDocs.some((filter) => (
      !filter ||
      typeof filter.name !== 'string' ||
      typeof filter.type !== 'string' ||
      typeof filter.description !== 'string' ||
      (filter.required !== undefined && typeof filter.required !== 'boolean')
    ))
  ) {
    throw new TypeError('Report filterDocs must describe each filter');
  }
  if (typeof run !== 'function') {
    throw new TypeError('Report run must be a function');
  }
  return Object.freeze({ ...definition });
}

export const periodFilterShape = z.object({
  from: z.string().refine(isValidIstDate, 'Expected a valid YYYY-MM-DD IST date').optional(),
  to: z.string().refine(isValidIstDate, 'Expected a valid YYYY-MM-DD IST date').optional()
});

export function resolvePeriod({ from, to } = {}, now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
  const currentFyStartYear = financialYearOf(now).slice(0, 4);
  const fromDate = from ?? `${currentFyStartYear}-04-01`;
  const toDate = to ?? formatIstDate(now);
  if (!isValidIstDate(fromDate) || !isValidIstDate(toDate) || fromDate > toDate) {
    throw new AppError(400, 'INVALID_PERIOD', 'from must be earlier than or equal to to');
  }

  const { gte: start, lt: endExclusive } = istDayRange(fromDate, toDate);
  const dayCount = (endExclusive.getTime() - start.getTime()) / 86400000;
  if (dayCount > 731) {
    throw new AppError(422, 'PERIOD_TOO_LONG', 'Report periods cannot exceed 731 days');
  }
  return { fromDate, toDate, start, endExclusive };
}

export const pageFilterShape = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export function paginate(rows, { page, limit }) {
  if (!Array.isArray(rows)) {
    throw new TypeError('rows must be an array');
  }
  if (!Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError('page and limit must be positive safe integers');
  }
  const total = rows.length;
  return {
    rows: rows.slice((page - 1) * limit, page * limit),
    page: { page, limit, total, pages: Math.ceil(total / limit) }
  };
}

export function makeSection({ key, title, columns, rows, totals = null, page = null }) {
  if (typeof key !== 'string' || !key || typeof title !== 'string' || !title) {
    throw new TypeError('Section key and title are required');
  }
  if (!Array.isArray(columns) || !Array.isArray(rows)) {
    throw new TypeError('Section columns and rows must be arrays');
  }
  const columnKeys = new Set();
  for (const column of columns) {
    if (
      !column ||
      typeof column.key !== 'string' ||
      !column.key ||
      typeof column.label !== 'string' ||
      !COLUMN_TYPES.includes(column.type)
    ) {
      throw new TypeError('Section contains an invalid column');
    }
    if (columnKeys.has(column.key)) {
      throw new TypeError(`Duplicate section column: ${column.key}`);
    }
    columnKeys.add(column.key);
  }

  const normalizedRows = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError('Section rows must be objects');
    }
    for (const rowKey of Object.keys(row)) {
      if (!columnKeys.has(rowKey)) {
        throw new TypeError(`Row contains unknown column: ${rowKey}`);
      }
    }
    const normalized = {};
    for (const column of columns) {
      const value = Object.hasOwn(row, column.key) ? row[column.key] : null;
      if (
        value !== null &&
        ['money', 'int', 'percentBp'].includes(column.type) &&
        !Number.isSafeInteger(value)
      ) {
        throw new TypeError(`${column.key} must be a safe integer`);
      }
      if (
        value !== null &&
        ['moneyDecimal', 'decimal'].includes(column.type) &&
        typeof value !== 'string'
      ) {
        throw new TypeError(`${column.key} must be a decimal string`);
      }
      normalized[column.key] = value;
    }
    return normalized;
  });

  return { key, title, columns, rows: normalizedRows, totals, page };
}

export function sumMoneyColumns(rows, keys) {
  if (!Array.isArray(rows) || !Array.isArray(keys)) {
    throw new TypeError('rows and keys must be arrays');
  }
  const totals = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const row of rows) {
    for (const key of keys) {
      const value = row?.[key];
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${key} must be a safe integer`);
      }
      const total = totals[key] + value;
      if (!Number.isSafeInteger(total)) {
        throw new RangeError(`${key} total exceeds the safe integer range`);
      }
      totals[key] = total;
    }
  }
  return totals;
}
