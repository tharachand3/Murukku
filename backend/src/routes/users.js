import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../config/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createUser,
  listUsers,
  resetUserPassword,
  updateUser
} from '../services/userService.js';

const router = Router();
const idParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(2147483647)
});
const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8),
  role: z.enum(ROLES)
});
const updateUserSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional()
}).refine(
  (input) => Object.keys(input).length > 0,
  'At least one user field is required'
);
const resetPasswordSchema = z.object({
  password: z.string().min(8)
});

router.get(
  '/',
  authenticate,
  requireCapability('users:manage'),
  asyncHandler(async (_req, res) => {
    res.json(await listUsers(prisma));
  })
);

router.post(
  '/',
  authenticate,
  requireCapability('users:manage'),
  validate({ body: createUserSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createUser(req.user.id, req.body));
  })
);

router.patch(
  '/:id',
  authenticate,
  requireCapability('users:manage'),
  validate({ params: idParamsSchema, body: updateUserSchema }),
  asyncHandler(async (req, res) => {
    res.json(await updateUser(req.user.id, req.params.id, req.body));
  })
);

router.post(
  '/:id/reset-password',
  authenticate,
  requireCapability('users:manage'),
  validate({ params: idParamsSchema, body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    res.json(await resetUserPassword(req.user.id, req.params.id, req.body.password));
  })
);

export default router;
