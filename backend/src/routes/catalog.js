import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { paiseToRupeesString } from '../lib/money.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getCustomer } from '../services/masterDataService.js';
import { getBalance } from '../services/ledgerService.js';
import { resolvePrices } from '../services/pricingService.js';

const router = Router();
const querySchema = z.object({
  customerId: z.coerce.number().int().positive().max(2147483647)
});

router.get(
  '/order-items',
  authenticate,
  requireCapability('catalog:read'),
  validate({ query: querySchema }),
  asyncHandler(async (req, res) => {
    const customer = await getCustomer(prisma, req.query.customerId, req.user);
    if (!customer.isActive) {
      throw new AppError(
        422,
        'CUSTOMER_INACTIVE',
        'Customer is inactive',
        { customerId: customer.id }
      );
    }

    const items = await prisma.item.findMany({
      where: { type: 'FINISHED', isActive: true },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        packsPerCarton: true,
        gstRateBp: true
      }
    });
    const prices = await resolvePrices(
      prisma,
      customer.id,
      items.map(({ id }) => id)
    );
    const orderItems = [];

    for (const item of items) {
      const price = prices.get(item.id);
      if (!price) {
        continue;
      }
      orderItems.push({
        itemId: item.id,
        code: item.code,
        name: item.name,
        packsPerCarton: item.packsPerCarton,
        gstRateBp: item.gstRateBp,
        pricePaise: price.pricePaise,
        priceDisplay: `Rs ${paiseToRupeesString(price.pricePaise)}`,
        priceSource: price.source,
        availablePackets: await getBalance(prisma, item.id)
      });
    }

    res.json(orderItems);
  })
);

export default router;
