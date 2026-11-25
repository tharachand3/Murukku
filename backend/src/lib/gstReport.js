import { STATES } from './states.js';

export const B2CL_THRESHOLD_PAISE = 25_000_000;

const AMOUNT_FIELDS = [
  'taxableValuePaise',
  'igstPaise',
  'cgstPaise',
  'sgstPaise',
  'totalPaise'
];

const ZERO_AMOUNTS = Object.freeze({
  taxableValuePaise: 0,
  igstPaise: 0,
  cgstPaise: 0,
  sgstPaise: 0,
  totalPaise: 0
});

function safeInteger(value, name, { signed = false } = {}) {
  const valid = Number.isSafeInteger(value) && (signed || value >= 0);
  if (!valid) {
    throw new RangeError(`${name} must be a ${signed ? 'safe' : 'non-negative safe'} integer`);
  }
  return value;
}

function addSafe(left, right, name) {
  return safeInteger(left + right, name, { signed: true });
}

function negate(value) {
  return value === 0 ? 0 : -value;
}

function ratePct(gstRateBp) {
  safeInteger(gstRateBp, 'GST rate');
  const whole = Math.floor(gstRateBp / 100);
  const fraction = String(gstRateBp % 100).padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function placeOfSupply(stateCode) {
  return `${stateCode}-${STATES[stateCode] ?? 'Unknown'}`;
}

function classifyInvoice(invoice) {
  if (invoice.customer.gstin) return 'B2B';
  if (invoice.isInterState && invoice.totalPaise > B2CL_THRESHOLD_PAISE) return 'B2CL';
  return 'B2CS';
}

function addLineAmounts(target, line, sign = 1) {
  for (const field of AMOUNT_FIELDS) {
    target[field] = addSafe(
      target[field] ?? 0,
      safeInteger(line[field], field) * sign,
      field
    );
  }
  target.qty = addSafe(
    target.qty ?? 0,
    safeInteger(line.qty, 'Invoice line quantity') * sign,
    'Quantity'
  );
}

function groupedLines(lines, sign = 1) {
  const grouped = new Map();
  for (const line of lines) {
    safeInteger(line.gstRateBp, 'GST rate');
    const key = String(line.gstRateBp);
    if (!grouped.has(key)) {
      grouped.set(key, {
        gstRateBp: line.gstRateBp,
        ...ZERO_AMOUNTS,
        qty: 0
      });
    }
    addLineAmounts(grouped.get(key), line, sign);
  }
  return [...grouped.values()].sort((a, b) => a.gstRateBp - b.gstRateBp);
}

function compareText(left, right) {
  return String(left).localeCompare(String(right));
}

function compareDocuments(left, right) {
  const parse = (value) => {
    const match = /^(.*\/)?(\d+)$/.exec(value);
    return match
      ? { prefix: match[1] ?? '', serial: Number(match[2]) }
      : { prefix: value, serial: 0 };
  };
  const a = parse(left);
  const b = parse(right);
  return compareText(a.prefix, b.prefix) || a.serial - b.serial;
}

function compareRates(left, right) {
  const toBasisPoints = (rate) => {
    const [whole, fraction = ''] = rate.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  };
  return toBasisPoints(left) - toBasisPoints(right);
}

function invoiceRateRows(invoice) {
  return groupedLines(invoice.lines).map((line) => ({
    gstin: invoice.customer.gstin,
    receiverName: invoice.customer.name,
    invoiceNo: invoice.invoiceNo,
    invoiceDate: invoice.issueDate,
    invoiceValuePaise: safeInteger(invoice.totalPaise, 'Invoice total'),
    placeOfSupply: placeOfSupply(invoice.placeOfSupplyStateCode),
    reverseCharge: 'N',
    invoiceType: 'Regular',
    ratePct: ratePct(line.gstRateBp),
    taxableValuePaise: line.taxableValuePaise,
    igstPaise: line.igstPaise,
    cgstPaise: line.cgstPaise,
    sgstPaise: line.sgstPaise,
    cessPaise: 0
  }));
}

function creditNoteRateRows(creditNote) {
  return groupedLines(creditNote.invoice.lines).map((line) => ({
    gstin: creditNote.invoice.customer.gstin,
    receiverName: creditNote.invoice.customer.name,
    noteNo: creditNote.noteNo,
    noteDate: creditNote.noteDate,
    originalInvoiceNo: creditNote.invoice.invoiceNo,
    originalInvoiceDate: creditNote.invoice.issueDate,
    noteValuePaise: safeInteger(creditNote.totalPaise, 'Credit note total'),
    placeOfSupply: placeOfSupply(creditNote.invoice.placeOfSupplyStateCode),
    ratePct: ratePct(line.gstRateBp),
    taxableValuePaise: line.taxableValuePaise,
    igstPaise: line.igstPaise,
    cgstPaise: line.cgstPaise,
    sgstPaise: line.sgstPaise
  }));
}

function hsnKey(line) {
  return JSON.stringify([
    line.hsnCode ?? '',
    line.description,
    line.uqc,
    line.gstRateBp
  ]);
}

function addHsnLines(rows, invoice, sign) {
  for (const line of invoice.lines) {
    const key = hsnKey(line);
    if (!rows.has(key)) {
      rows.set(key, {
        hsnCode: line.hsnCode,
        description: line.description,
        uqc: line.uqc,
        qty: 0,
        gstRateBp: line.gstRateBp,
        totalValuePaise: 0,
        taxableValuePaise: 0,
        igstPaise: 0,
        cgstPaise: 0,
        sgstPaise: 0
      });
    }
    const row = rows.get(key);
    row.qty = addSafe(
      row.qty,
      safeInteger(line.qty, 'Invoice line quantity') * sign,
      'HSN quantity'
    );
    row.totalValuePaise = addSafe(
      row.totalValuePaise,
      safeInteger(line.totalPaise, 'Line total') * sign,
      'HSN total value'
    );
    for (const field of [
      'taxableValuePaise',
      'igstPaise',
      'cgstPaise',
      'sgstPaise'
    ]) {
      row[field] = addSafe(
        row[field],
        safeInteger(line[field], field) * sign,
        `HSN ${field}`
      );
    }
  }
}

function buildDocuments(invoices, creditNotes) {
  if (invoices.length === 0 && creditNotes.length === 0) return [];
  const documentRow = (description, values) => ({
    description,
    fromSerial: values.length ? [...values].sort(compareDocuments)[0] : null,
    toSerial: values.length ? [...values].sort(compareDocuments).at(-1) : null,
    totalNumber: values.length,
    cancelled: 0
  });
  return [
    documentRow('Invoices for outward supply', invoices.map(({ invoiceNo }) => invoiceNo)),
    documentRow('Credit notes', creditNotes.map(({ noteNo }) => noteNo))
  ];
}

function buildB2cs(invoices) {
  const rows = new Map();
  for (const invoice of invoices) {
    if (classifyInvoice(invoice) !== 'B2CS') continue;
    for (const line of groupedLines(invoice.lines)) {
      const supplyType = invoice.isInterState ? 'Inter-State' : 'Intra-State';
      const pos = placeOfSupply(invoice.placeOfSupplyStateCode);
      const key = JSON.stringify([supplyType, pos, line.gstRateBp]);
      if (!rows.has(key)) {
        rows.set(key, {
          supplyType,
          placeOfSupply: pos,
          ratePct: ratePct(line.gstRateBp),
          gstRateBp: line.gstRateBp,
          taxableValuePaise: 0,
          igstPaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          cessPaise: 0
        });
      }
      const row = rows.get(key);
      for (const field of ['taxableValuePaise', 'igstPaise', 'cgstPaise', 'sgstPaise']) {
        row[field] = addSafe(row[field], line[field], field);
      }
    }
  }
  return [...rows.values()]
    .sort((a, b) => compareText(a.supplyType, b.supplyType) ||
      compareText(a.placeOfSupply, b.placeOfSupply) ||
      a.gstRateBp - b.gstRateBp)
    .map(({ gstRateBp, ...row }) => row);
}

function buildInterstateUnregistered(invoices, creditNotes) {
  const rows = new Map();
  const apply = (invoice, sign) => {
    if (invoice.customer.gstin || !invoice.isInterState) return;
    const pos = placeOfSupply(invoice.placeOfSupplyStateCode);
    if (!rows.has(pos)) {
      rows.set(pos, { placeOfSupply: pos, taxableValuePaise: 0, igstPaise: 0 });
    }
    const row = rows.get(pos);
    for (const line of invoice.lines) {
      row.taxableValuePaise = addSafe(
        row.taxableValuePaise,
        safeInteger(line.taxableValuePaise, 'Taxable value') * sign,
        'Taxable value'
      );
      row.igstPaise = addSafe(
        row.igstPaise,
        safeInteger(line.igstPaise, 'IGST') * sign,
        'IGST'
      );
    }
  };
  invoices.forEach((invoice) => apply(invoice, 1));
  creditNotes.forEach((note) => apply(note.invoice, -1));
  return [...rows.values()]
    .filter((row) => row.taxableValuePaise !== 0 || row.igstPaise !== 0)
    .sort((a, b) => compareText(a.placeOfSupply, b.placeOfSupply));
}

function buildGstr3b(creditNotes, b2b, b2cl, b2cs) {
  const invoicesValues = [
    ...b2b,
    ...b2cl,
    ...b2cs
  ].reduce((totals, row) => {
    for (const field of ['taxableValuePaise', 'igstPaise', 'cgstPaise', 'sgstPaise']) {
      totals[field] = addSafe(totals[field], safeInteger(row[field], field), field);
    }
    return totals;
  }, { taxableValuePaise: 0, igstPaise: 0, cgstPaise: 0, sgstPaise: 0 });
  const creditsValues = creditNotes.reduce((totals, note) => {
    for (const line of note.invoice.lines) {
      for (const field of ['taxableValuePaise', 'igstPaise', 'cgstPaise', 'sgstPaise']) {
        totals[field] = addSafe(
          totals[field],
          safeInteger(line[field], field),
          field
        );
      }
    }
    return totals;
  }, { taxableValuePaise: 0, igstPaise: 0, cgstPaise: 0, sgstPaise: 0 });

  const invoicesRow = {
    description: 'Invoices issued',
    ...invoicesValues,
    cessPaise: 0
  };
  const creditsRow = {
    description: 'Less: credit notes',
    taxableValuePaise: negate(creditsValues.taxableValuePaise),
    igstPaise: negate(creditsValues.igstPaise),
    cgstPaise: negate(creditsValues.cgstPaise),
    sgstPaise: negate(creditsValues.sgstPaise),
    cessPaise: 0
  };
  const netRow = {
    description: '3.1(a) Outward taxable supplies (net)',
    taxableValuePaise: addSafe(invoicesRow.taxableValuePaise, creditsRow.taxableValuePaise, 'Taxable value'),
    igstPaise: addSafe(invoicesRow.igstPaise, creditsRow.igstPaise, 'IGST'),
    cgstPaise: addSafe(invoicesRow.cgstPaise, creditsRow.cgstPaise, 'CGST'),
    sgstPaise: addSafe(invoicesRow.sgstPaise, creditsRow.sgstPaise, 'SGST'),
    cessPaise: 0
  };
  return {
    rows: [invoicesRow, creditsRow, netRow],
    totals: {
      taxableValuePaise: netRow.taxableValuePaise,
      igstPaise: netRow.igstPaise,
      cgstPaise: netRow.cgstPaise,
      sgstPaise: netRow.sgstPaise,
      cessPaise: 0
    }
  };
}

function buildHsn(invoices, creditNotes) {
  const rows = new Map();
  invoices.forEach((invoice) => addHsnLines(rows, invoice, 1));
  creditNotes.forEach((note) => addHsnLines(rows, note.invoice, -1));
  const result = [...rows.values()]
    .filter((row) => row.qty !== 0 || row.totalValuePaise !== 0 ||
      row.taxableValuePaise !== 0 || row.igstPaise !== 0 ||
      row.cgstPaise !== 0 || row.sgstPaise !== 0)
    .sort((a, b) => compareText(a.hsnCode, b.hsnCode) ||
      compareText(a.description, b.description) ||
      compareText(a.uqc, b.uqc) ||
      a.gstRateBp - b.gstRateBp)
    .map(({ gstRateBp, ...row }) => ({ ...row, ratePct: ratePct(gstRateBp) }));
  return result;
}

function sumGstr1Rows(rows, fields = [
  'taxableValuePaise',
  'igstPaise',
  'cgstPaise',
  'sgstPaise',
  'cessPaise'
]) {
  return Object.fromEntries(fields.map((field) => [
    field,
    rows.reduce(
      (total, row) => addSafe(total, safeInteger(row[field] ?? 0, field), field),
      0
    )
  ]));
}

export function buildGstSections({ invoices, creditNotes, sellerStateCode }) {
  if (!Array.isArray(invoices) || !Array.isArray(creditNotes)) {
    throw new TypeError('invoices and creditNotes must be arrays');
  }
  if (typeof sellerStateCode !== 'string' || !sellerStateCode.trim()) {
    throw new TypeError('sellerStateCode must be a non-empty string');
  }
  const b2b = invoices
    .filter((invoice) => classifyInvoice(invoice) === 'B2B')
    .flatMap(invoiceRateRows)
    .sort((a, b) => compareText(a.invoiceDate, b.invoiceDate) ||
      compareText(a.invoiceNo, b.invoiceNo) ||
      compareRates(a.ratePct, b.ratePct));
  const b2cl = invoices
    .filter((invoice) => classifyInvoice(invoice) === 'B2CL')
    .flatMap(invoiceRateRows)
    .map(({ gstin, ...row }) => row)
    .sort((a, b) => compareText(a.invoiceDate, b.invoiceDate) ||
      compareText(a.invoiceNo, b.invoiceNo) ||
      compareRates(a.ratePct, b.ratePct));
  const b2cs = buildB2cs(invoices);
  const cdnr = creditNotes
    .filter((note) => Boolean(note.invoice.customer.gstin))
    .flatMap(creditNoteRateRows)
    .sort((a, b) => compareText(a.noteDate, b.noteDate) ||
      compareText(a.noteNo, b.noteNo) ||
      compareRates(a.ratePct, b.ratePct));
  const cdnur = creditNotes
    .filter((note) => !note.invoice.customer.gstin)
    .flatMap(creditNoteRateRows)
    .map(({ gstin, receiverName, ...row }) => row)
    .sort((a, b) => compareText(a.noteDate, b.noteDate) ||
      compareText(a.noteNo, b.noteNo) ||
      compareRates(a.ratePct, b.ratePct));
  const hsn = buildHsn(invoices, creditNotes);
  const gstr3b = buildGstr3b(creditNotes, b2b, b2cl, b2cs);
  const interstateUnregistered = buildInterstateUnregistered(invoices, creditNotes);
  const documents = buildDocuments(invoices, creditNotes);

  return [
    {
      key: 'gstr3b-outward',
      rows: gstr3b.rows,
      totals: gstr3b.totals
    },
    {
      key: 'gstr3b-interstate-unregistered',
      rows: interstateUnregistered,
      totals: sumGstr1Rows(interstateUnregistered, ['taxableValuePaise', 'igstPaise'])
    },
    { key: 'gstr1-b2b', rows: b2b, totals: sumGstr1Rows(b2b) },
    { key: 'gstr1-b2cl', rows: b2cl, totals: sumGstr1Rows(b2cl) },
    { key: 'gstr1-b2cs', rows: b2cs, totals: sumGstr1Rows(b2cs) },
    {
      key: 'gstr1-cdnr',
      rows: cdnr,
      totals: sumGstr1Rows(cdnr, [
        'taxableValuePaise',
        'igstPaise',
        'cgstPaise',
        'sgstPaise'
      ])
    },
    {
      key: 'gstr1-cdnur',
      rows: cdnur,
      totals: sumGstr1Rows(cdnur, [
        'taxableValuePaise',
        'igstPaise',
        'cgstPaise',
        'sgstPaise'
      ])
    },
    {
      key: 'gstr1-hsn',
      rows: hsn,
      totals: {
        qty: hsn.reduce((total, row) => addSafe(total, row.qty, 'HSN quantity'), 0),
        totalValuePaise: hsn.reduce((total, row) => addSafe(total, row.totalValuePaise, 'HSN total value'), 0),
        taxableValuePaise: hsn.reduce((total, row) => addSafe(total, row.taxableValuePaise, 'HSN taxable value'), 0),
        igstPaise: hsn.reduce((total, row) => addSafe(total, row.igstPaise, 'HSN IGST'), 0),
        cgstPaise: hsn.reduce((total, row) => addSafe(total, row.cgstPaise, 'HSN CGST'), 0),
        sgstPaise: hsn.reduce((total, row) => addSafe(total, row.sgstPaise, 'HSN SGST'), 0)
      }
    },
    {
      key: 'gstr1-docs',
      rows: documents,
      totals: {
        totalNumber: documents.reduce((total, row) => total + row.totalNumber, 0),
        cancelled: documents.reduce((total, row) => total + row.cancelled, 0)
      }
    }
  ];
}
