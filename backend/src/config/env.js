import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  TZ: z.string().default('Asia/Kolkata')
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration:', result.error.issues
    .map(({ path, message }) => `${path.join('.')}: ${message}`)
    .join('; '));
  process.exit(1);
}

export const config = Object.freeze(result.data);
