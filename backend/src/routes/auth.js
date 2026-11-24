import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../lib/errors.js';
import { login } from '../services/authService.js';

const router = Router();
const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1)
});

router.post('/login', async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(
      new AppError(400, 'VALIDATION_ERROR', 'Invalid login request', parsed.error.issues)
    );
  }

  try {
    const result = await login(parsed.data.email, parsed.data.password);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;
