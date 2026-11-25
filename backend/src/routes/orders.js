import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createOrder } from '../services/orderService.js';

const router = Router();
const lineSchema = z.object({
  itemId: z.number().int().positive().max(2147483647),
  qty: z.number().int().min(1).max(100000)
}).strict();
const orderSchema = z.object({
  clientRef: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  customerId: z.number().int().positive().max(2147483647),
  notes: z.string().max(500).optional(),
  lines: z.array(lineSchema).min(1).max(50)
}).strict();

router.post(
  '/',
  authenticate,
  requireCapability('orders:create'),
  validate({ body: orderSchema }),
  asyncHandler(async (req, res) => {
    const result = await createOrder(req.user, req.body);
    res.status(result.duplicate ? 200 : 201).json(result);
  })
);

export default router;
