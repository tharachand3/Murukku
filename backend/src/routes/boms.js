import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  cloneBom,
  createBom,
  getBom,
  listBoms,
  updateBom
} from '../services/bomService.js';

const router = Router();
const integerId = z.number().int().positive().max(2147483647);
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
});
const bomLineSchema = z.object({
  itemId: integerId,
  qty: z.string().trim().regex(/^\d+(?:\.\d+)?$/),
  unit: z.string().trim().min(1)
});
const bomFields = {
  name: z.string().trim().min(1),
  batchYieldQty: integerId,
  notes: z.string().trim().nullable().optional(),
  lines: z.array(bomLineSchema).min(1)
};
const createBomSchema = z.object({
  ...bomFields,
  finishedItemId: integerId
});
const updateBomSchema = z.object(bomFields);
const listQuerySchema = z.object({
  finishedItemId: z.coerce.number().int().positive().max(2147483647).optional(),
  active: z.enum(['true', 'false']).transform((value) => value === 'true').optional()
});
const cloneBomSchema = z.object({
  finishedItemId: integerId,
  name: z.string().trim().min(1),
  lineOverrides: z.array(bomLineSchema).default([]),
  replaceItems: z.array(z.object({
    fromItemId: integerId,
    toItemId: integerId,
    qty: z.string().trim().regex(/^\d+(?:\.\d+)?$/),
    unit: z.string().trim().min(1)
  })).default([]),
  batchYieldQty: integerId.optional()
});

router.get(
  '/',
  authenticate,
  requireCapability('bom:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listBoms(prisma, req.query));
  })
);

router.post(
  '/',
  authenticate,
  requireCapability('bom:write'),
  validate({ body: createBomSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createBom(req.user.id, req.body));
  })
);

router.get(
  '/:id',
  authenticate,
  requireCapability('bom:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getBom(prisma, req.params.id));
  })
);

router.put(
  '/:id',
  authenticate,
  requireCapability('bom:write'),
  validate({ params: idParamsSchema, body: updateBomSchema }),
  asyncHandler(async (req, res) => {
    res.json(await updateBom(req.user.id, req.params.id, req.body));
  })
);

router.post(
  '/:id/clone',
  authenticate,
  requireCapability('bom:write'),
  validate({ params: idParamsSchema, body: cloneBomSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await cloneBom(req.user.id, req.params.id, req.body));
  })
);

export default router;
