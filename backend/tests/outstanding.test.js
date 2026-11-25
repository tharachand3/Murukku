import { describe, expect, it } from 'vitest';
import { customerBalance, invoiceStatus } from '../src/lib/outstanding.js';

describe('customer outstanding calculations', () => {
  it('marks an unpaid invoice and reports its full balance outstanding', () => {
    expect(customerBalance({ postedInvoicesPaise: 787500, paymentsPaise: 0 }))
      .toEqual({ outstandingPaise: 787500, creditPaise: 0 });
    expect(invoiceStatus(787500, 0)).toBe('UNPAID');
  });

  it('reports a partial payment and the remaining due', () => {
    expect(customerBalance({ postedInvoicesPaise: 787500, paymentsPaise: 400000 }))
      .toEqual({ outstandingPaise: 387500, creditPaise: 0 });
    expect(invoiceStatus(787500, 400000)).toBe('PARTIAL');
  });

  it('marks an exactly paid invoice', () => {
    expect(customerBalance({ postedInvoicesPaise: 787500, paymentsPaise: 787500 }))
      .toEqual({ outstandingPaise: 0, creditPaise: 0 });
    expect(invoiceStatus(787500, 787500)).toBe('PAID');
  });

  it('reports excess payments as customer credit', () => {
    expect(customerBalance({ postedInvoicesPaise: 100000, paymentsPaise: 400000 }))
      .toEqual({ outstandingPaise: 0, creditPaise: 300000 });
    expect(invoiceStatus(100000, 400000)).toBe('PAID');
  });
});
