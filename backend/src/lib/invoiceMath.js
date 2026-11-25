import { calcLineGst, isInterState, sumInvoice } from './gst.js';

function assertPositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function assertNonNegativeSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

export function buildInvoiceLines({
  lines,
  sellerStateCode,
  placeOfSupplyStateCode
}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Invoice lines must contain at least one line');
  }

  const interState = isInterState(sellerStateCode, placeOfSupplyStateCode);
  const invoiceLines = lines.map((line) => {
    assertPositiveSafeInteger(line.qty, 'Quantity');
    assertPositiveSafeInteger(line.ratePaise, 'Rate in paise');
    assertNonNegativeSafeInteger(line.gstRateBp, 'GST rate in basis points');

    const taxableValuePaise = line.qty * line.ratePaise;
    if (!Number.isSafeInteger(taxableValuePaise)) {
      throw new RangeError('Line taxable value exceeds the safe integer range');
    }

    const tax = calcLineGst({
      taxablePaise: taxableValuePaise,
      gstRateBp: line.gstRateBp,
      interState
    });
    return {
      ...line,
      taxableValuePaise,
      cgstPaise: tax.cgstPaise,
      sgstPaise: tax.sgstPaise,
      igstPaise: tax.igstPaise,
      totalPaise: tax.totalPaise
    };
  });

  const totals = sumInvoice(invoiceLines.map((line) => ({
    taxablePaise: line.taxableValuePaise,
    gstRateBp: line.gstRateBp,
    interState
  })));

  return {
    isInterState: interState,
    lines: invoiceLines,
    totals: {
      taxableValuePaise: totals.taxablePaise,
      cgstPaise: totals.cgstPaise,
      sgstPaise: totals.sgstPaise,
      igstPaise: totals.igstPaise,
      totalPaise: totals.totalPaise
    }
  };
}
