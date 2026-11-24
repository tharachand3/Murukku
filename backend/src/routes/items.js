import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createItem,
  getItem,
  listItems,
  updateItem
} from '../services/masterDataService.js';

const router = Router();
const activeFilter = z.enum(['true', 'false']).transform((value) => value === 'true');
const itemFields = {
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.enum(['RAW', 'PACKAGING', 'FINISHED']),
  baseUnitId: z.number().int().positive().max(2147483647),
  displayUnitId: z.number().int().positive().max(2147483647),
  hsnCode: z.string().trim().nullable().optional(),
  gstRateBp: z.number().int().min(0).max(2800),
  packsPerCarton: z.number().int().positive().max(2147483647).nullable().optional(),
  sellingPricePaise: z.number().int().nonnegative().max(2147483647).nullable().optional(),
  reorderLevelBase: z.number().int().nonnegative().max(2147483647).nullable().optional(),
  isActive: z.boolean().optional()
};
const createItemSchema = z.object({
  ...itemFields,
  gstRateBp: itemFields.gstRateBp.default(0)
});
const updateItemSchema = z.object(itemFields).partial().refine(
  (input) => Object.keys(input).length > 0,
  'At least one item field is required'
);
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
});
const listQuerySchema = z.object({
  type: z.enum(['RAW', 'PACKAGING', 'FINISHED']).optional(),
  active: activeFilter.optional()
});

router.get(
  '/',
  authenticate,
  requireCapability('masters:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listItems(prisma, req.query));
  })
);

router.get(
  '/:id',
  authenticate,
  requireCapability('masters:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getItem(prisma, req.params.id));
  })
);

router.post(
  '/',
  authenticate,
  requireCapability('masters:write'),
  validate({ body: createItemSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createItem(req.user.id, req.body));
  })
);

router.patch(
  '/:id',
  authenticate,
  requireCapability('masters:write'),
  validate({ params: idParamsSchema, body: updateItemSchema }),
  asyncHandler(async (req, res) => {
    res.json(await updateItem(req.user.id, req.params.id, req.body));
  })
);

export default router;
