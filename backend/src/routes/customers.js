import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createCustomer,
  getCustomer,
  getCustomerPrices,
  listCustomers,
  putCustomerPrices,
  updateCustomer
} from '../services/masterDataService.js';

const router = Router();
const activeFilter = z.enum(['true', 'false']).transform((value) => value === 'true');
const customerFields = {
  name: z.string().trim().min(1),
  type: z.enum(['RETAILER', 'DISTRIBUTOR']),
  gstin: z.string().trim().nullable().optional(),
  stateCode: z.string().regex(/^\d{2}$/),
  address: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  assignedSalesmanId: z.number().int().positive().max(2147483647).nullable().optional(),
  isActive: z.boolean().optional()
};
const createCustomerSchema = z.object(customerFields);
const updateCustomerSchema = z.object(customerFields).partial().refine(
  (input) => Object.keys(input).length > 0,
  'At least one customer field is required'
);
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
});
const listQuerySchema = z.object({
  type: z.enum(['RETAILER', 'DISTRIBUTOR']).optional(),
  active: activeFilter.optional()
});
const priceSchema = z.object({
  itemId: z.number().int().positive().max(2147483647),
  pricePaise: z.number().int().nonnegative().max(2147483647)
});
const customerPricesSchema = z.object({
  prices: z.array(priceSchema).min(1)
}).superRefine(({ prices }, context) => {
  const itemIds = new Set();
  for (const [index, price] of prices.entries()) {
    if (itemIds.has(price.itemId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each itemId may appear only once',
        path: ['prices', index, 'itemId']
      });
    }
    itemIds.add(price.itemId);
  }
});

router.get(
  '/',
  authenticate,
  requireCapability('masters:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listCustomers(prisma, req.user, req.query));
  })
);

router.post(
  '/',
  authenticate,
  requireCapability('masters:write'),
  validate({ body: createCustomerSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createCustomer(req.user.id, req.body));
  })
);

router.get(
  '/:id/prices',
  authenticate,
  requireCapability('masters:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getCustomerPrices(prisma, req.params.id, req.user));
  })
);

router.put(
  '/:id/prices',
  authenticate,
  requireCapability('masters:write'),
  validate({ params: idParamsSchema, body: customerPricesSchema }),
  asyncHandler(async (req, res) => {
    res.json(await putCustomerPrices(
      req.user.id,
      req.params.id,
      req.body.prices
    ));
  })
);

router.get(
  '/:id',
  authenticate,
  requireCapability('masters:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getCustomer(prisma, req.params.id, req.user));
  })
);

router.patch(
  '/:id',
  authenticate,
  requireCapability('masters:write'),
  validate({ params: idParamsSchema, body: updateCustomerSchema }),
  asyncHandler(async (req, res) => {
    res.json(await updateCustomer(req.user.id, req.params.id, req.body));
  })
);

export default router;
