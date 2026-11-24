import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier
} from '../services/masterDataService.js';

const router = Router();
const activeFilter = z.enum(['true', 'false']).transform((value) => value === 'true');
const supplierFields = {
  name: z.string().trim().min(1),
  gstin: z.string().trim().nullable().optional(),
  stateCode: z.string().regex(/^\d{2}$/).nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  isActive: z.boolean().optional()
};
const createSupplierSchema = z.object(supplierFields);
const updateSupplierSchema = z.object(supplierFields).partial().refine(
  (input) => Object.keys(input).length > 0,
  'At least one supplier field is required'
);
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
});
const listQuerySchema = z.object({ active: activeFilter.optional() });

router.get(
  '/',
  authenticate,
  requireCapability('masters:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listSuppliers(prisma, req.query));
  })
);

router.get(
  '/:id',
  authenticate,
  requireCapability('masters:read'),
  validate({ params: idParamsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await getSupplier(prisma, req.params.id));
  })
);

router.post(
  '/',
  authenticate,
  requireCapability('masters:write'),
  validate({ body: createSupplierSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createSupplier(req.user.id, req.body));
  })
);

router.patch(
  '/:id',
  authenticate,
  requireCapability('masters:write'),
  validate({ params: idParamsSchema, body: updateSupplierSchema }),
  asyncHandler(async (req, res) => {
    res.json(await updateSupplier(req.user.id, req.params.id, req.body));
  })
);

export default router;
