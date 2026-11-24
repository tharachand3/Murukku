import Decimal from 'decimal.js';

function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function addSafeIntegers(left, right, name) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return result;
}

export function isInterState(sellerStateCode, placeOfSupplyStateCode) {
  if (
    sellerStateCode === null ||
    sellerStateCode === undefined ||
    placeOfSupplyStateCode === null ||
    placeOfSupplyStateCode === undefined
  ) {
    throw new TypeError('Both state codes are required');
  }

  const seller = String(sellerStateCode).trim();
  const placeOfSupply = String(placeOfSupplyStateCode).trim();
  if (!seller || !placeOfSupply) {
    throw new TypeError('State codes cannot be empty');
  }
  return seller !== placeOfSupply;
}

export function calcLineGst({ taxablePaise, gstRateBp, interState }) {
  assertNonNegativeInteger(taxablePaise, 'Taxable paise');
  assertNonNegativeInteger(gstRateBp, 'GST rate in basis points');
  if (typeof interState !== 'boolean') {
    throw new TypeError('interState must be a boolean');
  }

  const taxPaise = new Decimal(taxablePaise)
    .times(gstRateBp)
    .div(10_000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

  if (!Number.isSafeInteger(taxPaise)) {
    throw new RangeError('Tax in paise exceeds the safe integer range');
  }

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  if (interState) {
    igstPaise = taxPaise;
  } else {
    cgstPaise = Number(BigInt(taxPaise) / 2n);
    sgstPaise = taxPaise - cgstPaise;
  }

  const totalPaise = addSafeIntegers(taxablePaise, taxPaise, 'Line total');
  return {
    cgstPaise,
    sgstPaise,
    igstPaise,
    taxPaise,
    totalPaise
  };
}

export function sumInvoice(lines) {
  if (!Array.isArray(lines)) {
    throw new TypeError('Invoice lines must be an array');
  }

  return lines.reduce(
    (totals, line) => {
      const taxablePaise = line.taxablePaise;
      const tax = calcLineGst(line);
      return {
        taxablePaise: addSafeIntegers(
          totals.taxablePaise,
          taxablePaise,
          'Invoice taxable value'
        ),
        cgstPaise: addSafeIntegers(totals.cgstPaise, tax.cgstPaise, 'Invoice CGST'),
        sgstPaise: addSafeIntegers(totals.sgstPaise, tax.sgstPaise, 'Invoice SGST'),
        igstPaise: addSafeIntegers(totals.igstPaise, tax.igstPaise, 'Invoice IGST'),
        taxPaise: addSafeIntegers(totals.taxPaise, tax.taxPaise, 'Invoice tax'),
        totalPaise: addSafeIntegers(
          totals.totalPaise,
          tax.totalPaise,
          'Invoice total'
        )
      };
    },
    {
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      taxPaise: 0,
      totalPaise: 0
    }
  );
}
