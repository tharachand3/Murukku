import { describe, expect, it } from 'vitest';
import { buildInvoiceLines } from '../../src/lib/invoiceMath.js';

const line = (overrides = {}) => ({
  itemId: 1,
  description: 'Murukku 200 g',
  hsnCode: '21069099',
  qty: 150,
  ratePaise: 5000,
  gstRateBp: 500,
  ...overrides
});

function build(lines, stateCodes = ['33', '33']) {
  return buildInvoiceLines({
    lines,
    sellerStateCode: stateCodes[0],
    placeOfSupplyStateCode: stateCodes[1]
  });
}

describe('invoiceMath', () => {
  it('calculates the benchmark intra-state invoice', () => {
    const invoice = build([line()]);
    expect(invoice).toMatchObject({
      isInterState: false,
      lines: [{
        taxableValuePaise: 750000,
        cgstPaise: 18750,
        sgstPaise: 18750,
        igstPaise: 0,
        totalPaise: 787500
      }],
      totals: {
        taxableValuePaise: 750000,
        cgstPaise: 18750,
        sgstPaise: 18750,
        igstPaise: 0,
        totalPaise: 787500
      }
    });
  });

  it('calculates IGST for an inter-state invoice', () => {
    const invoice = build([line({ qty: 120 })], ['33', '29']);
    expect(invoice).toMatchObject({
      isInterState: true,
      totals: {
        taxableValuePaise: 600000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 30000,
        totalPaise: 630000
      }
    });
  });

  it('sums different line rates after calculating tax per line', () => {
    const invoice = build([
      line({ qty: 100, ratePaise: 5000, gstRateBp: 500 }),
      line({ itemId: 2, qty: 200, ratePaise: 1000, gstRateBp: 1200 })
    ]);
    expect(invoice.totals).toEqual({
      taxableValuePaise: 700000,
      cgstPaise: 24500,
      sgstPaise: 24500,
      igstPaise: 0,
      totalPaise: 749000
    });
  });

  it('splits odd intra-state tax paise by flooring CGST', () => {
    const invoice = build([line({ qty: 1, ratePaise: 60 })]);
    expect(invoice.lines[0]).toMatchObject({
      taxableValuePaise: 60,
      cgstPaise: 1,
      sgstPaise: 2,
      totalPaise: 63
    });
  });

  it('rounds each line before summing invoice tax', () => {
    const invoice = build([
      line({ qty: 1, ratePaise: 130 }),
      line({ itemId: 2, qty: 1, ratePaise: 130 })
    ]);
    expect(invoice.lines.map(
      ({ totalPaise, taxableValuePaise }) => totalPaise - taxableValuePaise
    )).toEqual([7, 7]);
    expect(invoice.lines.map(({ cgstPaise, sgstPaise }) => [
      cgstPaise,
      sgstPaise
    ])).toEqual([[3, 4], [3, 4]]);
    expect(invoice.totals).toMatchObject({
      taxableValuePaise: 260,
      cgstPaise: 6,
      sgstPaise: 8,
      totalPaise: 274
    });
  });

  it('supports zero GST and rejects invalid invoice inputs', () => {
    expect(build([line({ gstRateBp: 0 })]).totals).toEqual({
      taxableValuePaise: 750000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      totalPaise: 750000
    });

    expect(() => build([])).toThrow('at least one line');
    expect(() => build([line({ qty: 0 })])).toThrow('Quantity');
    expect(() => build([line({ qty: 1.5 })])).toThrow('Quantity');
    expect(() => build([line({ ratePaise: 0 })])).toThrow('Rate in paise');
    expect(() => build([line({ gstRateBp: -1 })])).toThrow('GST rate');
    expect(() => build([line()], [undefined, '33'])).toThrow(/state codes/i);
    expect(() => build([line()], ['33', ''])).toThrow(/state codes/i);
  });
});
