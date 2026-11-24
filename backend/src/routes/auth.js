import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { login } from '../services/authService.js';

const router = Router();
const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1)
});

router.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const result = await login(req.body.email, req.body.password);
    res.json(result);
  })
);

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;
