import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { startRun } from '../services/productionService.js';

const router = Router();
const integerId = z.number().int().positive().max(2147483647);
const decimalString = /^\d+(?:\.\d+)?$/;
const issueSchema = z.object({
  itemId: integerId,
  qty: z.string().trim().regex(decimalString),
  unit: z.string().trim().min(1)
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

router.post(
  '/runs',
  authenticate,
  requireCapability('production:write'),
  validate({ body: startRunSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await startRun(req.user.id, req.body));
  })
);

export default router;
