import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { isValidIstDate } from '../lib/istDate.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { prisma } from '../lib/prisma.js';
import {
  createDispatch,
  getDispatchDetails,
  listDispatches
} from '../services/dispatchService.js';

const router = Router();
const dateSchema = z.string().refine(
  isValidIstDate,
  'Expected a valid YYYY-MM-DD date'
);
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
});
const dispatchLineSchema = z.object({
  itemId: z.number().int().positive().max(2147483647),
  qty: z.number().int().min(1).max(2147483647)
}).strict();
const dispatchDateSchema = z.string().datetime({ offset: true })
  .refine((value) => new Date(value) <= new Date(), 'dispatchDate cannot be in the future')
  .transform((value) => new Date(value));
const createDispatchSchema = z.object({
  invoiceId: z.number().int().positive().max(2147483647),
  dispatchDate: dispatchDateSchema.optional(),
  vehicleNo: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(300).optional(),
  lines: z.array(dispatchLineSchema).min(1).max(50).optional()
}).strict();
const listQuerySchema = z.object({
  invoiceId: z.coerce.number().int().positive().max(2147483647).optional(),
  customerId: z.coerce.number().int().positive().max(2147483647).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
}).superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`from` must be earlier than or equal to `to`',
      path: ['from']
    });
  }
});

router.post(
  '/',
  authenticate,
  requireCapability('dispatch:write'),
  validate({ body: createDispatchSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createDispatch(req.user, req.body));
  })
);

router.get(
  '/',
  authenticate,
  requireCapability('dispatch:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listDispatches(prisma, req.query));
  })
);

router.get(
  '/:id',
  authenticate,
  requireCapability('dispatch:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getDispatchDetails(prisma, req.params.id));
  })
);

export default router;
