import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createOrder } from '../services/orderService.js';
import {
  getOrderDetails,
  listCustomerSales,
  listOrders
} from '../services/orderService.js';
import { requireAnyCapability } from '../middleware/auth.js';
import { isValidIstDate } from '../lib/istDate.js';
import { prisma } from '../lib/prisma.js';
import { checkOrderAvailability } from '../services/availabilityService.js';
import {
  approveOrder,
  cancelOrder,
  editOrder,
  rejectOrder
} from '../services/orderService.js';
import { buildOrderInvoiceDraft } from '../services/gstService.js';

const router = Router();
const dateSchema = z.string().refine(
  isValidIstDate,
  'Expected a valid YYYY-MM-DD date'
);
const listQuerySchema = z.object({
  status: z.enum([
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
    'INVOICED',
    'DISPATCHED',
    'CANCELLED'
  ]).optional(),
  customerId: z.coerce.number().int().positive().max(2147483647).optional(),
  salesmanId: z.coerce.number().int().positive().max(2147483647).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
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
const customerSalesQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional()
}).superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`from` must be earlier than or equal to `to`',
      path: ['from']
    });
  }
});
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
});
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
const lineOverrideSchema = z.object({
  lineId: z.number().int().positive().max(2147483647),
  approvedQty: z.number().int().min(0).max(100000).optional(),
  approvedPricePaise: z.number().int().min(1).max(10000000).optional()
}).strict();
const lineOverridesSchema = z.array(lineOverrideSchema).min(1).max(50)
  .superRefine((lines, context) => {
    const seen = new Set();
    lines.forEach((line, index) => {
      if (seen.has(line.lineId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'lineId values must be unique',
          path: [index, 'lineId']
        });
      }
      seen.add(line.lineId);
    });
  });
const noteSchema = z.string().trim().max(300).optional();
const editOrderSchema = z.object({
  lines: lineOverridesSchema,
  note: noteSchema
}).strict();
const approveOrderSchema = z.preprocess(
  (value) => value === undefined ? {} : value,
  z.object({
    lines: lineOverridesSchema.optional(),
    note: noteSchema
  }).strict()
);
const reasonSchema = z.object({
  reason: z.string().trim().min(3).max(300)
}).strict();

router.get(
  '/',
  authenticate,
  requireAnyCapability('orders:read:own', 'orders:read:all'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listOrders(prisma, req.query, req.user));
  })
);

router.get(
  '/my/customer-sales',
  authenticate,
  requireCapability('orders:read:own'),
  validate({ query: customerSalesQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listCustomerSales(prisma, req.user, req.query));
  })
);

router.get(
  '/:id/availability',
  authenticate,
  requireCapability('orders:availability'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await checkOrderAvailability(prisma, req.params.id));
  })
);

router.get(
  '/:id/invoice-preview',
  authenticate,
  requireCapability('invoices:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await buildOrderInvoiceDraft(prisma, req.params.id));
  })
);

router.get(
  '/:id',
  authenticate,
  requireAnyCapability('orders:read:own', 'orders:read:all'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getOrderDetails(prisma, req.params.id, req.user));
  })
);

router.patch(
  '/:id/lines',
  authenticate,
  requireCapability('orders:approve'),
  validate({ params: idParamsSchema, body: editOrderSchema }),
  asyncHandler(async (req, res) => {
    res.json(await editOrder(req.user, req.params.id, req.body));
  })
);

router.post(
  '/:id/approve',
  authenticate,
  requireCapability('orders:approve'),
  validate({ params: idParamsSchema, body: approveOrderSchema }),
  asyncHandler(async (req, res) => {
    res.json(await approveOrder(req.user, req.params.id, req.body));
  })
);

router.post(
  '/:id/reject',
  authenticate,
  requireCapability('orders:approve'),
  validate({ params: idParamsSchema, body: reasonSchema }),
  asyncHandler(async (req, res) => {
    res.json(await rejectOrder(req.user, req.params.id, req.body));
  })
);

router.post(
  '/:id/cancel',
  authenticate,
  requireCapability('orders:approve'),
  validate({ params: idParamsSchema, body: reasonSchema }),
  asyncHandler(async (req, res) => {
    res.json(await cancelOrder(req.user, req.params.id, req.body));
  })
);

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
