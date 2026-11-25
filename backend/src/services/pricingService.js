import { badRequest, notFound, AppError } from '../lib/errors.js';
import { pickPrice } from '../lib/pricing.js';

const POSTGRES_INT_MAX = 2147483647;

function assertPositiveId(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > POSTGRES_INT_MAX) {
    throw badRequest(`${name} must be a positive integer`);
  }
}

export async function resolvePrices(db, customerId, itemIds) {
  assertPositiveId(customerId, 'customerId');
  if (!Array.isArray(itemIds)) {
    throw badRequest('itemIds must be an array');
  }
  for (const itemId of itemIds) {
    assertPositiveId(itemId, 'itemId');
  }

  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return new Map();
  }

  const [customerPrices, items] = await Promise.all([
    db.customerPrice.findMany({
      where: { customerId, itemId: { in: uniqueItemIds } },
      select: { itemId: true, pricePaise: true }
    }),
    db.item.findMany({
      where: { id: { in: uniqueItemIds } },
      select: {
        id: true,
        type: true,
        isActive: true,
        sellingPricePaise: true
      }
    })
  ]);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const customerPriceByItemId = new Map(
    customerPrices.map(({ itemId, pricePaise }) => [itemId, pricePaise])
  );
  const resolved = new Map();

  for (const itemId of uniqueItemIds) {
    const item = itemById.get(itemId);
    if (!item || !item.isActive || item.type !== 'FINISHED') {
      throw notFound('Active finished item not found', { itemId });
    }

    const price = pickPrice({
      customerPricePaise: customerPriceByItemId.get(itemId),
      defaultPricePaise: item.sellingPricePaise
    });
    if (price) {
      resolved.set(itemId, price);
    }
  }

  return resolved;
}

export async function resolvePrice(db, customerId, itemId) {
  const resolved = await resolvePrices(db, customerId, [itemId]);
  const price = resolved.get(itemId);
  if (!price) {
    throw new AppError(
      422,
      'NO_PRICE',
      'No customer or default price is set for this item',
      { customerId, itemId }
    );
  }
  return price;
}
