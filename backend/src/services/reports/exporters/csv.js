import { AppError } from '../../../lib/errors.js';
import { formatCell } from '../../../lib/exportFormat.js';

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function totalsRow(section) {
  if (!section.totals) {
    return null;
  }
  return section.columns.map((column, index) => (
    index === 0
      ? 'Total'
      : Object.hasOwn(section.totals, column.key)
        ? formatCell(section.totals[column.key], column.type)
        : ''
  ));
}

export function toCsv(result, { sectionKey } = {}) {
  if (!result || !Array.isArray(result.sections) || result.sections.length === 0) {
    return '\uFEFF';
  }
  let section = result.sections[0];
  if (sectionKey !== undefined) {
    section = result.sections.find((candidate) => candidate.key === sectionKey);
    if (!section) {
      throw new AppError(400, 'UNKNOWN_SECTION', 'Unknown report section');
    }
  }
  const records = [
    section.columns.map((column) => column.label),
    ...section.rows.map((row) => section.columns.map((column) =>
      formatCell(row[column.key], column.type)
    ))
  ];
  const total = totalsRow(section);
  if (total) {
    records.push(total);
  }
  return `\uFEFF${records.map((record) => record.map(escapeCsv).join(',')).join('\r\n')}\r\n`;
}
