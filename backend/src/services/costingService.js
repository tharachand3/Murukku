import Decimal from 'decimal.js';
import { badRequest } from '../lib/errors.js';

const CostDecimal = Decimal.clone({ precision: 40 });
const PRICED_RECEIPT_TYPES = ['OPENING', 'PURCHASE', 'SALES_RETURN'];
const POSTGRES_INT_MAX = 2147483647;

export async function getAverageRate(db, itemId, { asOf } = {}) {
  if (!Number.isSafeInteger(itemId) || itemId <= 0 || itemId > POSTGRES_INT_MAX) {
    throw badRequest('itemId must be a positive integer');
  }
  if (asOf !== undefined && (!(asOf instanceof Date) || Number.isNaN(asOf.getTime()))) {
    throw badRequest('asOf must be a valid Date');
  }

  const movements = await db.stockMovement.findMany({
    where: {
      itemId,
      movementType: { in: PRICED_RECEIPT_TYPES },
      ratePaisePerBase: { not: null },
      ...(asOf ? { movementDate: { lte: asOf } } : {})
    },
    select: {
      qtyChange: true,
      ratePaisePerBase: true
    }
  });

  let totalQty = new CostDecimal(0);
  let totalValue = new CostDecimal(0);
  for (const movement of movements) {
    const qty = new CostDecimal(movement.qtyChange);
    const rate = new CostDecimal(movement.ratePaisePerBase.toString());
    totalQty = totalQty.plus(qty);
    totalValue = totalValue.plus(rate.times(qty));
  }

  return totalQty.isZero()
    ? new CostDecimal(0)
    : totalValue.div(totalQty);
}
