import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import {
  authenticate,
  requireCapability,
  requireRole
} from './middleware/auth.js';
import { AppError } from './lib/errors.js';
import authRouter from './routes/auth.js';
import healthRouter from './routes/health.js';

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode}`);
  });
  next();
});

app.use('/api', healthRouter);
app.use('/api/auth', authRouter);

if (process.env.NODE_ENV === 'test') {
  app.get('/api/_whoami', authenticate, (req, res) => {
    res.json({ user: req.user });
  });
  app.get('/api/_admin-only', authenticate, requireRole('ADMIN'), (_req, res) => {
    res.json({ ok: true });
  });
  app.get(
    '/api/_approve-only',
    authenticate,
    requireCapability('orders:approve'),
    (_req, res) => {
      res.json({ ok: true });
    }
  );
}

app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
      details: null
    }
  });
});

app.use((error, _req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const isAppError = error instanceof AppError;
  if (!isAppError) {
    console.error(error);
  }
  return res.status(isAppError ? error.statusCode : 500).json({
    error: {
      code: isAppError ? error.code : 'INTERNAL_SERVER_ERROR',
      message: isAppError ? error.message : 'Internal server error',
      details: isAppError ? error.details : null
    }
  });
});

export { app };
