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
import bomsRouter from './routes/boms.js';
import itemsRouter from './routes/items.js';
import customersRouter from './routes/customers.js';
import suppliersRouter from './routes/suppliers.js';
import settingsRouter from './routes/settings.js';
import usersRouter from './routes/users.js';
import productionRouter from './routes/production.js';
import catalogRouter from './routes/catalog.js';
import ordersRouter from './routes/orders.js';
import invoicesRouter from './routes/invoices.js';
import dispatchesRouter from './routes/dispatches.js';
import paymentsRouter from './routes/payments.js';
import creditNotesRouter from './routes/creditNotes.js';
import costingRouter from './routes/costing.js';
import reportsRouter from './routes/reports.js';
import dashboardRouter from './routes/dashboard.js';
import publicInvoicesRouter from './routes/publicInvoices.js';
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
app.use('/api/public', publicInvoicesRouter);
app.use('/api/auth', authRouter);
app.use('/api/audit', auditRouter);
app.use('/api/stock', stockRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/boms', bomsRouter);
app.use('/api/items', itemsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/users', usersRouter);
app.use('/api/production', productionRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/dispatches', dispatchesRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/credit-notes', creditNotesRouter);
app.use('/api/costing', costingRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/dashboard', dashboardRouter);

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
