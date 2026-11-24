import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import {
  authenticate,
  requireCapability,
  requireRole
} from './middleware/auth.js';
import { notFound } from './lib/errors.js';
import authRouter from './routes/auth.js';
import auditRouter from './routes/audit.js';
import healthRouter from './routes/health.js';
import stockRouter from './routes/stock.js';
import purchasesRouter from './routes/purchases.js';
import itemsRouter from './routes/items.js';
import customersRouter from './routes/customers.js';
import suppliersRouter from './routes/suppliers.js';
import settingsRouter from './routes/settings.js';
import usersRouter from './routes/users.js';
import { errorHandler } from './middleware/errorHandler.js';

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
app.use('/api/audit', auditRouter);
app.use('/api/stock', stockRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/items', itemsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/users', usersRouter);

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

app.use((_req, _res, next) => next(notFound('Route not found')));
app.use(errorHandler);

export { app };
