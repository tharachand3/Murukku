import PDFDocument from 'pdfkit';
import { paiseToRupeesString } from '../lib/money.js';

const PAGE_MARGIN = 28;
const FOOTER_HEIGHT = 22;
const BODY_FONT_SIZE = 8;

function money(value) {
  return `Rs ${paiseToRupeesString(value)}`;
}

function fitCellText(doc, value, width, fontSize = BODY_FONT_SIZE) {
  const original = String(value ?? '');
  let text = original;
  const maxHeight = (fontSize + 2) * 3;
  while (
    text.length > 3 &&
    doc.heightOfString(text, { width: Math.max(1, width - 4), fontSize }) > maxHeight
  ) {
    text = `${text.slice(0, -4).trimEnd()}...`;
  }
  return text;
}

function lineColumns(interState) {
  const columns = [
    { key: 'srNo', label: 'Sr', width: 23, numeric: true },
    { key: 'description', label: 'Description', width: 100 },
    { key: 'hsnCode', label: 'HSN', width: 42 },
    { key: 'qty', label: 'Qty', width: 30, numeric: true },
    { key: 'unit', label: 'Unit', width: 32 },
    { key: 'ratePaise', label: 'Rate', width: 49, money: true, numeric: true },
    { key: 'taxableValuePaise', label: 'Taxable', width: 54, money: true, numeric: true }
  ];
  if (interState) {
    columns.push(
      { key: 'igstRate', label: 'IGST %', width: 32 },
      { key: 'igstPaise', label: 'IGST Amt', width: 48, money: true, numeric: true }
    );
  } else {
    columns.push(
      { key: 'cgstRate', label: 'CGST %', width: 32 },
      { key: 'cgstPaise', label: 'CGST Amt', width: 48, money: true, numeric: true },
      { key: 'sgstRate', label: 'SGST %', width: 32 },
      { key: 'sgstPaise', label: 'SGST Amt', width: 48, money: true, numeric: true }
    );
  }
  columns.push({ key: 'totalPaise', label: 'Total', width: 55, money: true, numeric: true });

  const availableWidth = 595.28 - PAGE_MARGIN * 2;
  const widthTotal = columns.reduce((total, { width }) => total + width, 0);
  return columns.map((column) => ({
    ...column,
    width: column.width * availableWidth / widthTotal
  }));
}

function lineCellValue(line, column) {
  if (column.money) {
    return money(line[column.key]);
  }
  if (column.key === 'cgstRate' || column.key === 'sgstRate') {
    return line.gstRatePct;
  }
  if (column.key === 'igstRate') {
    return line.gstRatePct;
  }
  return line[column.key] ?? '';
}

function drawTableHeader(doc, columns, y) {
  const headerHeight = 24;
  doc.save().fillColor('#e8edf2').rect(PAGE_MARGIN, y, 595.28 - PAGE_MARGIN * 2, headerHeight).fill().restore();
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor('#111111');
  let x = PAGE_MARGIN;
  for (const column of columns) {
    doc.text(column.label, x + 2, y + 5, {
      width: column.width - 4,
      height: headerHeight - 7,
      align: column.numeric ? 'right' : 'left'
    });
    x += column.width;
  }
  doc.moveTo(PAGE_MARGIN, y + headerHeight).lineTo(595.28 - PAGE_MARGIN, y + headerHeight)
    .lineWidth(0.5).strokeColor('#65717c').stroke();
  return y + headerHeight;
}

function drawInvoiceHeader(doc, model) {
  const pageWidth = 595.28;
  const width = pageWidth - PAGE_MARGIN * 2;
  let y = PAGE_MARGIN;
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111')
    .text(model.company.name || 'Company', PAGE_MARGIN, y, { width: 250 });
  doc.font('Helvetica').fontSize(8);
  y += 18;
  doc.text(`GSTIN: ${model.company.gstin || '-'}`, PAGE_MARGIN, y);
  y += 12;
  doc.text(`State: ${model.company.stateDisplay || '-'}`, PAGE_MARGIN, y);
  y += 12;
  if (model.company.address) {
    doc.text(model.company.address, PAGE_MARGIN, y, { width: 250, height: 24 });
    y += Math.min(24, doc.heightOfString(model.company.address, { width: 250 })) + 3;
  }

  doc.font('Helvetica-Bold').fontSize(14)
    .text('TAX INVOICE', pageWidth - 210, PAGE_MARGIN + 4, {
      width: 180,
      align: 'right'
    });
  const boxY = Math.max(y + 5, PAGE_MARGIN + 48);
  const boxHeight = 53;
  doc.roundedRect(PAGE_MARGIN, boxY, width, boxHeight, 3).lineWidth(0.7).strokeColor('#66717a').stroke();
  doc.font('Helvetica-Bold').fontSize(8).text(`Invoice: ${model.invoice.invoiceNo}`, PAGE_MARGIN + 8, boxY + 7);
  doc.font('Helvetica').text(`Date: ${model.invoice.issueDateDisplay}`, PAGE_MARGIN + 8, boxY + 21);
  doc.text(`Status: ${model.invoice.status}`, PAGE_MARGIN + 8, boxY + 35);
  doc.text(`Place of supply: ${model.supply.placeOfSupply}`, PAGE_MARGIN + 250, boxY + 7);
  doc.text(`Tax type: ${model.supply.taxType}`, PAGE_MARGIN + 250, boxY + 21);
  doc.text(`Reverse charge: ${model.supply.reverseCharge}`, PAGE_MARGIN + 250, boxY + 35);

  const billY = boxY + boxHeight + 9;
  doc.roundedRect(PAGE_MARGIN, billY, width, 63, 3).lineWidth(0.7).strokeColor('#66717a').stroke();
  doc.font('Helvetica-Bold').fontSize(8).text('Bill to', PAGE_MARGIN + 8, billY + 6);
  doc.font('Helvetica-Bold').text(model.customer.name || '-', PAGE_MARGIN + 8, billY + 19, { width: 250 });
  doc.font('Helvetica').text(`GSTIN: ${model.customer.gstin || '-'}`, PAGE_MARGIN + 8, billY + 33);
  doc.text(`State: ${model.customer.stateDisplay || '-'}`, PAGE_MARGIN + 285, billY + 6);
  doc.text(`Phone: ${model.customer.phone || '-'}`, PAGE_MARGIN + 285, billY + 20);
  doc.text(model.customer.address || '', PAGE_MARGIN + 285, billY + 34, { width: 230, height: 24 });
  return billY + 72;
}

function drawTotals(doc, model, y) {
  const x = 340;
  const labelWidth = 112;
  const valueWidth = 110;
  const rows = [
    ['Taxable value', model.totals.taxableValuePaise],
    ...(model.supply.taxType === 'IGST'
      ? [['IGST', model.totals.igstPaise]]
      : [['CGST', model.totals.cgstPaise], ['SGST', model.totals.sgstPaise]]),
    ['Invoice total', model.totals.totalPaise]
  ];
  const height = rows.length * 15 + 8;
  doc.roundedRect(x, y, labelWidth + valueWidth + 8, height, 3).lineWidth(0.6).strokeColor('#66717a').stroke();
  rows.forEach(([label, amount], index) => {
    const rowY = y + 5 + index * 15;
    doc.font(index === rows.length - 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    doc.text(label, x + 6, rowY, { width: labelWidth });
    doc.text(money(amount), x + 6 + labelWidth, rowY, { width: valueWidth, align: 'right' });
  });
  return y + height + 10;
}

function drawTextSection(doc, title, content, y, { bold = false } = {}) {
  const width = 595.28 - PAGE_MARGIN * 2;
  const text = String(content ?? '');
  doc.font('Helvetica-Bold').fontSize(8).text(title, PAGE_MARGIN, y);
  y += 11;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
  const fitted = fitCellText(doc, text, width, 8);
  doc.text(fitted, PAGE_MARGIN, y, { width, height: 32, lineGap: 1 });
  return y + Math.min(34, doc.heightOfString(fitted, { width })) + 8;
}

function drawTaxSummary(doc, model, y) {
  const width = 595.28 - PAGE_MARGIN * 2;
  const headers = ['Rate %', 'Taxable value', 'CGST', 'SGST', 'IGST'];
  const widths = [60, 130, 95, 95, width - 380];
  const rows = model.taxSummary.map((summary) => [
    summary.ratePct,
    money(summary.taxableValuePaise),
    money(summary.cgstPaise),
    money(summary.sgstPaise),
    money(summary.igstPaise)
  ]);
  doc.font('Helvetica-Bold').fontSize(7).text('Tax summary', PAGE_MARGIN, y);
  y += 12;
  const height = 16;
  const drawRow = (values, bold = false) => {
    let x = PAGE_MARGIN;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7);
    values.forEach((value, index) => {
      doc.text(String(value), x + 2, y + 4, {
        width: widths[index] - 4,
        height: height - 5,
        align: index === 0 ? 'left' : 'right'
      });
      x += widths[index];
    });
    doc.moveTo(PAGE_MARGIN, y + height).lineTo(PAGE_MARGIN + width, y + height)
      .lineWidth(0.3).strokeColor('#aab2b8').stroke();
    y += height;
  };
  drawRow(headers, true);
  rows.forEach((row) => drawRow(row));
  return y + 7;
}

export function renderInvoicePdf(model) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: { Title: `Tax Invoice ${model.invoice.invoiceNo}` }
    });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    try {
      let y = drawInvoiceHeader(doc, model);
      const columns = lineColumns(model.supply.taxType === 'IGST');
      y += 4;
      y = drawTableHeader(doc, columns, y);

      for (const line of model.lines) {
        const values = columns.map((column) => fitCellText(
          doc,
          lineCellValue(line, column),
          column.width
        ));
        const cellHeights = values.map((value, index) => doc.heightOfString(value, {
          width: columns[index].width - 4,
          fontSize: BODY_FONT_SIZE
        }));
        const rowHeight = Math.max(17, ...cellHeights.map((height) => height + 5));
        if (y + rowHeight > doc.page.height - PAGE_MARGIN - FOOTER_HEIGHT) {
          doc.addPage();
          y = PAGE_MARGIN + 4;
          y = drawTableHeader(doc, columns, y);
        }
        let x = PAGE_MARGIN;
        doc.font('Helvetica').fontSize(BODY_FONT_SIZE).fillColor('#111111');
        values.forEach((value, index) => {
          doc.text(value, x + 2, y + 3, {
            width: columns[index].width - 4,
            height: rowHeight - 5,
            align: columns[index].numeric ? 'right' : 'left',
            lineGap: 1
          });
          x += columns[index].width;
        });
        y += rowHeight;
        doc.moveTo(PAGE_MARGIN, y).lineTo(595.28 - PAGE_MARGIN, y)
          .lineWidth(0.25).strokeColor('#c7cdd2').stroke();
      }

      y += 8;
      if (y + 90 > doc.page.height - PAGE_MARGIN - FOOTER_HEIGHT) {
        doc.addPage();
        y = PAGE_MARGIN + 5;
      }
      y = drawTotals(doc, model, y);
      y = drawTaxSummary(doc, model, y);
      y = drawTextSection(doc, 'Amount in words', model.amountInWords, y, { bold: true });
      if (model.cancellation) {
        y = drawTextSection(
          doc,
          'Cancellation',
          `Cancelled by credit note ${model.cancellation.creditNoteNo ?? '-'} on ${model.cancellation.cancelledAtDisplay}. Reason: ${model.cancellation.reason ?? '-'}`,
          y
        );
      }
      if (model.dispatches.length) {
        y = drawTextSection(
          doc,
          'Dispatch references',
          model.dispatches.map(({ dispatchNo, dispatchDateDisplay }) =>
            `${dispatchNo} (${dispatchDateDisplay})`
          ).join(', '),
          y
        );
      }
      if (model.orderNo) {
        y = drawTextSection(doc, 'Order reference', model.orderNo, y);
      }
      for (const note of model.notes) {
        y = drawTextSection(doc, 'Note', note, y);
        if (y > doc.page.height - PAGE_MARGIN - FOOTER_HEIGHT) {
          doc.addPage();
          y = PAGE_MARGIN + 5;
        }
      }

      const pages = doc.bufferedPageRange();
      for (let index = 0; index < pages.count; index += 1) {
        doc.switchToPage(pages.start + index);
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        if (model.cancellation) {
          doc.save();
          doc.rotate(-32, { origin: [pageWidth / 2, pageHeight / 2] });
          doc.fillColor('#c62828').fillOpacity(0.14).font('Helvetica-Bold').fontSize(48)
            .text('CANCELLED', 20, pageHeight / 2 - 25, {
              width: pageWidth - 40,
              align: 'center',
              lineBreak: false
            });
          doc.restore();
        }
        doc.font('Helvetica').fontSize(7).fillColor('#444444')
          .text(`Page ${index + 1} of ${pages.count}`, PAGE_MARGIN, pageHeight - 18, {
            width: pageWidth - PAGE_MARGIN * 2,
            align: 'center'
          });
      }
      doc.end();
    } catch (error) {
      doc.destroy(error);
    }
  });
}
