import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
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

app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found'
    }
  });
});

export { app };
