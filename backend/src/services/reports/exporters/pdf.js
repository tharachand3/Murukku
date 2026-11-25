import PDFDocument from 'pdfkit';
import { formatCellDisplay } from '../../../lib/exportFormat.js';

const MARGIN = 28;
const FOOTER_SPACE = 32;
const HEADER_FONT_SIZE = 8;
const BODY_FONT_SIZE = 8;
const LINE_HEIGHT = 10;

const NUMERIC_TYPES = new Set([
  'int',
  'money',
  'moneyDecimal',
  'percentBp',
  'decimal'
]);

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

function displayValue(value, type) {
  return formatCellDisplay(value, type);
}

function truncateToLines(doc, value, width, maxHeight) {
  let text = String(value ?? '');
  const options = { width, lineGap: 0 };
  if (doc.heightOfString(text, options) <= maxHeight) {
    return text;
  }
  while (text.length > 1 && doc.heightOfString(`${text}...`, options) > maxHeight) {
    text = text.slice(0, Math.max(1, Math.floor(text.length * 0.9)));
  }
  return `${text}...`;
}

function columnWidths(columns, availableWidth) {
  const weights = columns.map((column) => (
    Number.isFinite(column.width) && column.width > 0 ? column.width : 80
  ));
  const total = weights.reduce((sum, width) => sum + width, 0);
  return weights.map((width) => availableWidth * width / total);
}

function cellText(section, row, column) {
  if (row === null) {
    return '';
  }
  return displayValue(row[column.key], column.type);
}

function drawRow(doc, section, row, widths, y, { header = false, totals = false } = {}) {
  const padding = 3;
  const maxHeight = LINE_HEIGHT * 3;
  const fontSize = header ? HEADER_FONT_SIZE : BODY_FONT_SIZE;
  doc.font(header || totals ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);

  const texts = section.columns.map((column, index) => {
    let value;
    if (header) {
      value = column.label;
    } else if (totals && index === 0) {
      value = 'Total';
    } else {
      value = cellText(section, row, column);
    }
    return truncateToLines(doc, value, Math.max(8, widths[index] - padding * 2), maxHeight);
  });
  const height = Math.max(
    20,
    ...texts.map((text, index) => (
      Math.min(maxHeight, doc.heightOfString(text, {
        width: Math.max(8, widths[index] - padding * 2),
        lineGap: 0
      })) + padding * 2
    ))
  );

  let x = MARGIN;
  for (let index = 0; index < section.columns.length; index += 1) {
    const width = widths[index];
    doc.rect(x, y, width, height).strokeColor('#b7c0cc').lineWidth(0.35).stroke();
    doc.fillColor('#17212b').text(texts[index], x + padding, y + padding, {
      width: Math.max(8, width - padding * 2),
      height: height - padding * 2,
      lineGap: 0,
      align: !header && NUMERIC_TYPES.has(section.columns[index].type) ? 'right' : 'left',
      ellipsis: true
    });
    x += width;
  }
  return y + height;
}

function makeTotalRow(section) {
  const totals = section.totals ?? {};
  return Object.fromEntries(section.columns.map((column) => [
    column.key,
    Object.hasOwn(totals, column.key) ? totals[column.key] : null
  ]));
}

function renderReportHeader(doc, result) {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#17212b')
    .text(result.title ?? 'Report', MARGIN, MARGIN, { width: doc.page.width - MARGIN * 2 });
  let y = doc.y + 8;
  const period = JSON.stringify(result.period ?? {});
  const generated = formatIstTimestamp(result.generatedAt);
  doc.font('Helvetica').fontSize(9).fillColor('#4b5563')
    .text(`Period: ${period}`, MARGIN, y);
  y = doc.y + 2;
  doc.text(`Generated at (IST): ${generated}`, MARGIN, y);
  return doc.y + 14;
}

export async function toPdf(result, { orientation = 'landscape' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: orientation,
      margins: { top: MARGIN, right: MARGIN, bottom: MARGIN + FOOTER_SPACE, left: MARGIN },
      bufferPages: true,
      info: { Title: result.title ?? 'Report' }
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    try {
      let y = renderReportHeader(doc, result);
      for (const section of result.sections ?? []) {
        const availableWidth = doc.page.width - MARGIN * 2;
        const widths = columnWidths(section.columns, availableWidth);
        const drawSectionTitle = () => {
          doc.font('Helvetica-Bold').fontSize(12).fillColor('#17212b')
            .text(section.title, MARGIN, y, { width: availableWidth });
          y = doc.y + 5;
        };
        const drawColumnHeader = () => {
          y = drawRow(doc, section, null, widths, y, { header: true });
        };
        if (y + 60 > doc.page.height - MARGIN - FOOTER_SPACE) {
          doc.addPage();
          y = MARGIN;
        }
        drawSectionTitle();
        drawColumnHeader();

        const rows = section.rows ?? [];
        for (const row of rows) {
          const nextHeight = Math.min(LINE_HEIGHT * 3 + 6, 40);
          if (y + nextHeight > doc.page.height - MARGIN - FOOTER_SPACE) {
            doc.addPage();
            y = MARGIN;
            drawColumnHeader();
          }
          y = drawRow(doc, section, row, widths, y);
        }
        if (section.totals) {
          if (y + 24 > doc.page.height - MARGIN - FOOTER_SPACE) {
            doc.addPage();
            y = MARGIN;
            drawColumnHeader();
          }
          y = drawRow(doc, section, makeTotalRow(section), widths, y, { totals: true });
        }
        y += 14;
      }

      const range = doc.bufferedPageRange();
      for (let index = range.start; index < range.start + range.count; index += 1) {
        doc.switchToPage(index);
        doc.font('Helvetica').fontSize(8).fillColor('#4b5563')
          .text(
            `Page ${index + 1} of ${range.count}`,
            MARGIN,
            doc.page.height - MARGIN - 10,
            { width: doc.page.width - MARGIN * 2, align: 'center' }
          );
      }
      doc.end();
    } catch (error) {
      reject(error);
      doc.end();
    }
  });
}
