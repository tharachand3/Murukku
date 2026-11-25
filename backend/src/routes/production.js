import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  cancelRun,
  completeRun,
  getRunDetails,
  listRuns,
  startRun,
  updateRun
} from '../services/productionService.js';
import { getRunVariance, listRunVariances } from '../services/varianceService.js';

const router = Router();
const integerId = z.number().int().positive().max(2147483647);
const decimalString = /^\d+(?:\.\d+)?$/;
const issueSchema = z.object({
  itemId: integerId,
  qty: z.string().trim().regex(decimalString),
  unit: z.string().trim().min(1)
});
const consumptionSchema = z.object({
  itemId: integerId,
  qty: z.string().trim().regex(decimalString),
  unit: z.string().trim().min(1),
  scrapQty: z.string().trim().regex(decimalString).default('0'),
  scrapUnit: z.string().trim().min(1).optional()
});
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
});
const startRunSchema = z.object({
  bomId: integerId.optional(),
  finishedItemId: integerId.optional(),
  batchCount: z.string().trim().regex(decimalString).default('1'),
  batchNo: z.string().trim().nullable().optional(),
  notes: z.string().nullable().optional(),
  issues: z.array(issueSchema).optional()
}).superRefine((input, context) => {
  if ((input.bomId === undefined) === (input.finishedItemId === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide exactly one of bomId or finishedItemId'
    });
  }
});
const completeRunSchema = z.object({
  actualGoodQty: z.number().int().min(0).max(2147483647),
  rejectedFinishedQty: z.number().int().min(0).max(2147483647).default(0),
  batchNo: z.string().trim().min(1).nullable().optional(),
  expiryDate: z.union([z.coerce.date(), z.null()]).optional(),
  notes: z.string().nullable().optional(),
  consumption: z.array(consumptionSchema).optional()
});
const varianceListQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  flaggedOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50)
}).superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`from` must be earlier than or equal to `to`',
      path: ['from']
    });
  }
});
const runListQuerySchema = z.object({
  status: z.enum(['ISSUED', 'COMPLETED', 'CANCELLED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  finishedItemId: z.coerce.number().int().positive().max(2147483647).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50)
}).superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`from` must be earlier than or equal to `to`',
      path: ['from']
    });
  }
});
const updateRunSchema = z.object({
  notes: z.string().nullable().optional(),
  batchNo: z.string().trim().min(1).nullable().optional()
}).strict().refine((input) => Object.keys(input).length > 0, {
  message: 'Provide notes or batchNo'
});
const cancelRunSchema = z.object({
  reason: z.string().trim().min(1)
}).strict();

router.get(
  '/runs',
  authenticate,
  requireCapability('production:read'),
  validate({ query: runListQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listRuns(prisma, req.query));
  })
);

router.get(
  '/runs/:id',
  authenticate,
  requireCapability('production:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getRunDetails(prisma, req.params.id));
  })
);

router.get(
  '/variance',
  authenticate,
  requireCapability('production:read'),
  validate({ query: varianceListQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listRunVariances(prisma, {
      ...req.query,
      flaggedOnly: req.query.flaggedOnly ?? false
    }));
  })
);

router.get(
  '/runs/:id/variance',
  authenticate,
  requireCapability('production:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getRunVariance(prisma, req.params.id));
  })
);

router.post(
  '/runs',
  authenticate,
  requireCapability('production:write'),
  validate({ body: startRunSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await startRun(req.user.id, req.body));
  })
);

router.post(
  '/runs/:id/complete',
  authenticate,
  requireCapability('production:write'),
  validate({ params: idParamsSchema, body: completeRunSchema }),
  asyncHandler(async (req, res) => {
    res.json(await completeRun(req.user.id, req.params.id, req.body));
  })
);

router.patch(
  '/runs/:id',
  authenticate,
  requireCapability('production:write'),
  validate({ params: idParamsSchema, body: updateRunSchema }),
  asyncHandler(async (req, res) => {
    res.json(await updateRun(req.user.id, req.params.id, req.body));
  })
);

router.post(
  '/runs/:id/cancel',
  authenticate,
  requireCapability('production:write'),
  validate({ params: idParamsSchema, body: cancelRunSchema }),
  asyncHandler(async (req, res) => {
    res.json(await cancelRun(req.user.id, req.params.id, req.body.reason));
  })
);

export default router;
