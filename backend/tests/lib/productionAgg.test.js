import { describe, expect, it } from 'vitest';
import { wastageByItem, yieldByProduct } from '../../src/lib/productionAgg.js';

describe('production aggregation', () => {
  it('groups scrap and excess material by item using stored rates', () => {
    expect(wastageByItem([
      {
        itemId: 1,
        itemCode: 'POUCH200',
        itemName: 'Pouch',
        unit: 'pcs',
        baseFactor: 1,
        plannedQty: 200,
        issuedQty: 200,
        scrapQty: 6,
        ratePaisePerBase: '250'
      },
      {
        itemId: 2,
        itemCode: 'OIL',
        itemName: 'Oil',
        unit: 'ml',
        baseFactor: 1000,
        plannedQty: 10000,
        issuedQty: 10500,
        scrapQty: 0,
        ratePaisePerBase: '14'
      }
    ])).toEqual([
      {
        itemId: 2,
        itemCode: 'OIL',
        itemName: 'Oil',
        unit: 'ml',
        scrapBase: 0,
        scrapValuePaise: 0,
        excessBase: 500,
        excessValuePaise: 7000
      },
      {
        itemId: 1,
        itemCode: 'POUCH200',
        itemName: 'Pouch',
        unit: 'pcs',
        scrapBase: 6,
        scrapValuePaise: 1500,
        excessBase: 0,
        excessValuePaise: 0
      }
    ]);
  });

  it('sums product output across runs and never reports a negative shortfall', () => {
    expect(yieldByProduct([
      {
        productId: 1,
        productCode: 'MURUKKU200',
        productName: 'Murukku',
        plannedOutputQty: 200,
        actualGoodQty: 188
      },
      {
        productId: 1,
        productCode: 'MURUKKU200',
        productName: 'Murukku',
        plannedOutputQty: 100,
        actualGoodQty: 110
      }
    ])).toEqual([{
      productId: 1,
      productCode: 'MURUKKU200',
      productName: 'Murukku',
      runs: 2,
      plannedOutput: 300,
      goodOutput: 298,
      shortfall: 12,
      shortfallBp: -67
    }]);
    expect(yieldByProduct([])).toEqual([]);
    expect(wastageByItem([])).toEqual([]);
  });
});
