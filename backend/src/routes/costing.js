import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  getAverageRates,
  getCostBreakdown
} from '../services/costingService.js';
import { getProductCosting, getRunCostSheet } from '../services/costSheetService.js';
import { isValidIstDate } from '../lib/istDate.js';

const router = Router();
const dateOnlySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value, context) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'asOf must be a valid ISO date' });
      return z.NEVER;
    }
    return date;
  });
const dateTimeSchema = z.string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const asOfSchema = z.union([dateOnlySchema, dateTimeSchema]).optional();
const listQuerySchema = z.object({
  type: z.enum(['RAW', 'PACKAGING', 'FINISHED']).optional(),
  asOf: asOfSchema
});
const detailQuerySchema = z.object({ asOf: asOfSchema });
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
});
const costSheetParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
}).strict();
const periodDateSchema = z.string().refine(isValidIstDate, {
  message: 'Date must be a valid YYYY-MM-DD IST calendar day'
});
const productCostingQuerySchema = z.object({
  from: periodDateSchema.optional(),
  to: periodDateSchema.optional(),
  finishedItemId: z.coerce.number().int().positive().max(2147483647).optional()
}).strict();

router.get(
  '/runs/:id/sheet',
  authenticate,
  requireCapability('costing:read'),
  validate({ params: costSheetParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getRunCostSheet(prisma, req.params.id));
  })
);

router.get(
  '/products',
  authenticate,
  requireCapability('costing:read'),
  validate({ query: productCostingQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await getProductCosting(prisma, req.query));
  })
);

router.get(
  '/average-rates',
  authenticate,
  requireCapability('costing:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await getAverageRates(prisma, req.query));
  })
);

router.get(
  '/items/:id',
  authenticate,
  requireCapability('costing:read'),
  validate({ params: idParamsSchema, query: detailQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await getCostBreakdown(prisma, req.params.id, req.query.asOf));
  })
);

export default router;
