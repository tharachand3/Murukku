import ExcelJS from 'exceljs';
import { excelValue } from '../../../lib/exportFormat.js';

const MAX_SHEET_NAME = 31;

function uniqueSheetName(title, used) {
  const cleaned = (title || 'Section')
    .replace(/[\[\]:*?/\\]/g, '')
    .trim()
    .slice(0, MAX_SHEET_NAME) || 'Section';
  let name = cleaned;
  let suffixNumber = 2;
  while (used.has(name.toLocaleLowerCase())) {
    const suffix = ` (${suffixNumber})`;
    name = `${cleaned.slice(0, MAX_SHEET_NAME - suffix.length)}${suffix}`;
    suffixNumber += 1;
  }
  used.add(name.toLocaleLowerCase());
  return name;
}

function fillRow(row, values, bold = false) {
  values.forEach((value, index) => {
    const cell = row.getCell(index + 1);
    cell.value = value.value;
    if (value.numFmt) {
      cell.numFmt = value.numFmt;
    }
    if (bold) {
      cell.font = { ...cell.font, bold: true };
    }
  });
  if (bold) {
    row.font = { bold: true };
  }
}

export async function toXlsx(result) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Order-to-Audit System';
  const usedNames = new Set();
  for (const section of result.sections ?? []) {
    const worksheet = workbook.addWorksheet(uniqueSheetName(section.title, usedNames));
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.columns = section.columns.map((column) => ({
      key: column.key,
      width: Math.max(10, Math.min(40, column.width ?? column.label.length + 2))
    }));
    const header = worksheet.addRow(section.columns.map((column) => column.label));
    header.font = { bold: true };
    for (const row of section.rows) {
      const values = section.columns.map((column) => (
        excelValue(row[column.key], column.type)
      ));
      const added = worksheet.addRow([]);
      fillRow(added, values);
    }
    if (section.totals) {
      const values = section.columns.map((column, index) => (
        index === 0
          ? { value: 'Total' }
          : Object.hasOwn(section.totals, column.key)
            ? excelValue(section.totals[column.key], column.type)
            : { value: null }
      ));
      const totals = worksheet.addRow([]);
      fillRow(totals, values, true);
    }
  }

  const info = workbook.addWorksheet(uniqueSheetName('Report info', usedNames));
  info.addRows([
    ['Title', result.title ?? ''],
    ['Period', JSON.stringify(result.period ?? {})],
    ['Generated at (IST)', formatIstTimestamp(result.generatedAt)],
    ['Filters', JSON.stringify(result.filters ?? {})]
  ]);
  info.getColumn(1).width = 22;
  info.getColumn(2).width = 60;
  info.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function formatIstTimestamp(value) {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(value));
}
