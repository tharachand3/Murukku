import { describe, expect, it } from 'vitest';
import {
  ageingBucket,
  allocateReceivables,
  invoiceAgeDays
} from '../../src/lib/receivablesAgeing.js';

describe('receivables ageing', () => {
  it('uses whole calendar days and the inclusive bucket limits', () => {
    expect(invoiceAgeDays('2026-04-01', '2026-04-01')).toBe(0);
    expect(invoiceAgeDays('2026-03-01', '2026-04-01')).toBe(31);
    expect([0, 30, 31, 60, 61, 90, 91].map(ageingBucket))
      .toEqual(['0-30', '0-30', '31-60', '31-60', '61-90', '61-90', '91+']);
    expect(() => invoiceAgeDays('2026-04-02', '2026-04-01'))
      .toThrow('Invoice issue date cannot be after the as-of date');
  });

  it('applies linked payments directly, then unallocated money oldest-first', () => {
    const result = allocateReceivables({
      asOfDate: '2026-04-20',
      invoices: [
        {
          id: 2,
          customerId: 1,
          invoiceNo: 'INV/2',
          issueDate: '2026-04-15',
          totalPaise: 500,
          customer: { name: 'Retailer A', type: 'RETAILER' }
        },
        {
          id: 1,
          customerId: 1,
          invoiceNo: 'INV/1',
          issueDate: '2026-03-10',
          totalPaise: 1000,
          customer: { name: 'Retailer A', type: 'RETAILER' }
        }
      ],
      payments: [
        { customerId: 1, invoiceId: 1, amountPaise: 200 },
        { customerId: 1, invoiceId: null, amountPaise: 600 }
      ]
    });

    expect(result.invoices).toMatchObject([
      { invoiceNo: 'INV/1', ageDays: 41, bucket: '31-60', paidPaise: 800, duePaise: 200 },
      { invoiceNo: 'INV/2', ageDays: 5, bucket: '0-30', paidPaise: 0, duePaise: 500 }
    ]);
    expect(result.customers).toEqual([{
      customerId: 1,
      customerName: 'Retailer A',
      customerType: 'RETAILER',
      bucket0To30Paise: 500,
      bucket31To60Paise: 200,
      bucket61To90Paise: 0,
      bucket91PlusPaise: 0,
      outstandingPaise: 700,
      creditPaise: 0
    }]);
  });

  it('reallocates payments linked to excluded invoices and keeps excess as credit', () => {
    const result = allocateReceivables({
      asOfDate: '2026-04-20',
      invoices: [{
        id: 3,
        customerId: 1,
        invoiceNo: 'INV/3',
        issueDate: '2026-04-01',
        totalPaise: 400
      }],
      payments: [
        { customerId: 1, invoiceId: 99, amountPaise: 500 },
        { customerId: 1, invoiceId: 3, amountPaise: 100 }
      ]
    });

    expect(result.invoices[0]).toMatchObject({ paidPaise: 400, duePaise: 0 });
    expect(result.customers[0]).toMatchObject({
      outstandingPaise: 0,
      creditPaise: 200
    });
  });

  it('rejects unsafe financial values and invalid dates', () => {
    expect(() => allocateReceivables({
      asOfDate: '2026-02-30',
      invoices: [],
      payments: []
    })).toThrow('Date must be a valid YYYY-MM-DD calendar day');
    expect(() => allocateReceivables({
      asOfDate: '2026-04-20',
      invoices: [{ id: 1, customerId: 1, issueDate: '2026-04-01', totalPaise: 1.5 }],
      payments: []
    })).toThrow('invoice total must be a non-negative safe integer');
  });
});
