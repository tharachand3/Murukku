import { describe, expect, it } from 'vitest';
import { aggregatePurchaseLines, ratePerDisplayUnit } from '../../src/lib/purchaseAgg.js';

describe('purchase aggregation', () => {
  it('groups distinct purchases by supplier and quantities/amounts by item', () => {
    const lines = [
      {
        purchaseId: 1,
        supplierId: 1,
        supplierName: 'Demo Flour Mills',
        supplierGstin: null,
        itemId: 1,
        itemCode: 'FLOUR',
        itemName: 'Flour',
        unit: 'kg',
        baseFactor: 1000,
        qty: 60000,
        amountPaise: 270000
      },
      {
        purchaseId: 2,
        supplierId: 1,
        supplierName: 'Demo Flour Mills',
        supplierGstin: null,
        itemId: 1,
        itemCode: 'FLOUR',
        itemName: 'Flour',
        unit: 'kg',
        baseFactor: 1000,
        qty: 10000,
        amountPaise: 46000
      },
      {
        purchaseId: 2,
        supplierId: 1,
        supplierName: 'Demo Flour Mills',
        supplierGstin: null,
        itemId: 2,
        itemCode: 'POUCH200',
        itemName: 'Pouch',
        unit: 'pcs',
        baseFactor: 1,
        qty: 100,
        amountPaise: 26000
      }
    ];

    expect(aggregatePurchaseLines(lines)).toEqual({
      bySupplier: [{
        supplierName: 'Demo Flour Mills',
        supplierGstin: null,
        purchases: 2,
        lines: 3,
        amountPaise: 342000
      }],
      byItem: [
        {
          itemCode: 'FLOUR',
          itemName: 'Flour',
          unit: 'kg',
          qty: '70',
          amountPaise: 316000,
          avgRatePerUnit: '45.1429'
        },
        {
          itemCode: 'POUCH200',
          itemName: 'Pouch',
          unit: 'pcs',
          qty: '100',
          amountPaise: 26000,
          avgRatePerUnit: '2.6'
        }
      ]
    });
  });

  it('returns no summaries for empty input and formats display-unit rates to four places', () => {
    expect(aggregatePurchaseLines([])).toEqual({ bySupplier: [], byItem: [] });
    expect(ratePerDisplayUnit('0.25005', 1000)).toBe('2.5005');
    expect(ratePerDisplayUnit('4.5', 1000)).toBe('45');
  });
});
