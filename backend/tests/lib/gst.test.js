import { describe, expect, it } from 'vitest';
import {
  calcLineGst,
  isInterState,
  sumInvoice
} from '../../src/lib/gst.js';

describe('GST helpers', () => {
  it('splits intra-state tax evenly and assigns the odd paise to SGST', () => {
    expect(
      calcLineGst({
        taxablePaise: 750000,
        gstRateBp: 500,
        interState: false
      })
    ).toEqual({
      cgstPaise: 18750,
      sgstPaise: 18750,
      igstPaise: 0,
      taxPaise: 37500,
      totalPaise: 787500
    });

    expect(
      calcLineGst({
        taxablePaise: 6,
        gstRateBp: 5000,
        interState: false
      })
    ).toMatchObject({ cgstPaise: 1, sgstPaise: 2, taxPaise: 3 });
    expect(
      calcLineGst({
        taxablePaise: 1,
        gstRateBp: 5000,
        interState: true
      })
    ).toMatchObject({ igstPaise: 1, taxPaise: 1 });
  });

  it('calculates interstate IGST', () => {
    expect(
      calcLineGst({
        taxablePaise: 600000,
        gstRateBp: 500,
        interState: true
      })
    ).toMatchObject({
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 30000,
      totalPaise: 630000
    });
  });

  it('compares state codes and sums per-line invoice totals', () => {
    expect(isInterState('33', '33')).toBe(false);
    expect(isInterState('33', '29')).toBe(true);
    expect(
      sumInvoice([
        { taxablePaise: 750000, gstRateBp: 500, interState: false },
        { taxablePaise: 600000, gstRateBp: 500, interState: true }
      ])
    ).toEqual({
      taxablePaise: 1350000,
      cgstPaise: 18750,
      sgstPaise: 18750,
      igstPaise: 30000,
      taxPaise: 67500,
      totalPaise: 1417500
    });
  });
});
