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
  planBom,
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
const planQuerySchema = z.object({
  batches: z.string().trim().regex(/^\d+(?:\.\d+)?$/).optional(),
  targetOutput: z.string().trim().regex(/^\d+$/).transform(Number)
    .refine(Number.isSafeInteger, 'targetOutput must be a positive safe integer').optional(),
  itemId: z.coerce.number().int().positive().max(2147483647).optional(),
  qty: z.string().trim().regex(/^\d+(?:\.\d+)?$/).optional(),
  unit: z.string().trim().min(1).optional()
}).strict().superRefine((query, context) => {
  const hasBatches = query.batches !== undefined;
  const hasTargetOutput = query.targetOutput !== undefined;
  const hasIssueFields = ['itemId', 'qty', 'unit'].some(
    (field) => query[field] !== undefined
  );
  const hasCompleteIssue = query.itemId !== undefined &&
    query.qty !== undefined &&
    query.unit !== undefined;
  if (
    Number(hasBatches) + Number(hasTargetOutput) + Number(hasIssueFields) !== 1 ||
    (hasIssueFields && !hasCompleteIssue)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide exactly one planning mode: batches, targetOutput, or itemId/qty/unit'
    });
  }
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

router.get(
  '/:id/plan',
  authenticate,
  requireCapability('bom:read'),
  validate({ params: idParamsSchema, query: planQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await planBom(prisma, req.params.id, req.query));
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
