import { describe, expect, it } from 'vitest';
import {
  aggregateByCustomer,
  aggregateByProduct,
  shareBp
} from '../../src/lib/salesAgg.js';

function invoice({
  customerId = 1,
  customerName = `Customer ${customerId}`,
  customerType = 'RETAILER',
  customerGstin = null,
  stateName = 'Tamil Nadu',
  issueDate = '2026-11-26',
  taxableValuePaise = 100,
  cgstPaise = 0,
  sgstPaise = 0,
  igstPaise = 0,
  totalPaise = taxableValuePaise + cgstPaise + sgstPaise + igstPaise,
  qty = 1
} = {}) {
  return {
    customerId,
    customerName,
    customerType,
    customerGstin,
    stateName,
    issueDate,
    taxableValuePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    totalPaise,
    qty
  };
}

function line({
  itemId = 1,
  itemCode = `SKU-${itemId}`,
  itemName = `Product ${itemId}`,
  hsnCode = '21069099',
  unit = 'packet',
  invoiceId = 1,
  qty = 1,
  taxableValuePaise = 100,
  cgstPaise = 0,
  sgstPaise = 0,
  igstPaise = 0,
  totalPaise = taxableValuePaise + cgstPaise + sgstPaise + igstPaise
} = {}) {
  return {
    itemId,
    itemCode,
    itemName,
    hsnCode,
    unit,
    invoiceId,
    qty,
    taxableValuePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    totalPaise
  };
}

describe('sales aggregation helpers', () => {
  it('rounds average invoice values half up using integer arithmetic', () => {
    const thirds = aggregateByCustomer([
      invoice({ totalPaise: 33 }),
      invoice({ totalPaise: 33 }),
      invoice({ totalPaise: 34 })
    ]);
    expect(thirds[0].avgInvoicePaise).toBe(33);

    const halves = aggregateByCustomer([
      invoice({ totalPaise: 2 }),
      invoice({ totalPaise: 3 })
    ]);
    expect(halves[0].avgInvoicePaise).toBe(3);
  });

  it('groups customer sales and sorts by total descending then name', () => {
    const rows = aggregateByCustomer([
      invoice({ customerId: 1, customerName: 'Retailer Z', totalPaise: 100 }),
      invoice({ customerId: 2, customerName: 'Distributor', totalPaise: 250 }),
      invoice({ customerId: 3, customerName: 'Retailer A', totalPaise: 100 })
    ]);
    expect(rows.map(({ customerName, totalPaise }) => [customerName, totalPaise]))
      .toEqual([
        ['Distributor', 250],
        ['Retailer A', 100],
        ['Retailer Z', 100]
      ]);
    expect(aggregateByCustomer([])).toEqual([]);
  });

  it('counts distinct invoice ids for products and sorts by sales total', () => {
    const rows = aggregateByProduct([
      line({ itemId: 1, invoiceId: 10, qty: 2, totalPaise: 100 }),
      line({ itemId: 1, invoiceId: 10, qty: 3, totalPaise: 150 }),
      line({ itemId: 1, invoiceId: 11, qty: 1, totalPaise: 50 }),
      line({ itemId: 2, itemName: 'High seller', totalPaise: 500 })
    ]);
    expect(rows[0]).toMatchObject({
      itemId: 2,
      itemName: 'High seller',
      invoices: 1,
      totalPaise: 500
    });
    expect(rows[1]).toMatchObject({
      itemId: 1,
      invoices: 2,
      qty: 6,
      totalPaise: 300
    });
    expect(aggregateByProduct([])).toEqual([]);
  });

  it('calculates shares in integer basis points with half-up rounding', () => {
    expect(shareBp(787500, 1249500)).toBe(6303);
    expect(shareBp(462000, 1249500)).toBe(3697);
    expect(shareBp(1, 0)).toBe(0);
  });
});
