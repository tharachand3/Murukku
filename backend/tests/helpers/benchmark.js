import bcrypt from 'bcryptjs';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { db } from './db.js';

const DEMO_PASSWORD = 'Demo@123';
const DEMO_EMAILS = [
  'admin@demo.com',
  'production@demo.com',
  'salesman.a@demo.com',
  'salesman.b@demo.com',
  'accountant@demo.com',
  'owner@demo.com'
];

export const BENCH = Object.freeze({
  opening: {
    FLOUR: 100000,
    OIL: 30000,
    SPICE: 5000,
    POUCH200: 500,
    CARTON: 30,
    MURUKKU200: 50
  },
  afterPurchase: {
    FLOUR: 160000,
    purchaseQty: 60000,
    purchaseRatePaisePerBase: '4.5',
    purchaseAmountPaise: 270000,
    flourAverageRatePaisePerBase: '4.3125'
  },
  afterIssue: {
    FLOUR: 120000,
    OIL: 19500,
    SPICE: 3800,
    POUCH200: 500,
    CARTON: 30,
    MURUKKU200: 50
  },
  afterRun: {
    FLOUR: 120000,
    OIL: 19500,
    SPICE: 3800,
    POUCH200: 306,
    CARTON: 21,
    MURUKKU200: 238
  },
  materialCostPaise: {
    FLOUR: 172500,
    OIL: 147000,
    SPICE: 24000,
    POUCH200: 48500,
    CARTON: 13500,
    total: 405500
  },
  variance: {
    yield: { bp: -600, flagged: true },
    FLOUR: { bp: 0, flagged: false },
    OIL: { bp: 500, flagged: true },
    SPICE: { bp: 0, flagged: false },
    POUCH200: { bp: -300, flagged: false },
    CARTON: { bp: -1000, flagged: true }
  }
});

export async function seedBenchmarkMasters() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 4);
  await db.$transaction(async (tx) => {
    await seed(tx);
    await tx.user.updateMany({
      where: { email: { in: DEMO_EMAILS } },
      data: { passwordHash }
    });
  }, { maxWait: 60000, timeout: 60000 });
}

export async function loginAs(app, email) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: DEMO_PASSWORD });
  if (response.status !== 200 || typeof response.body.token !== 'string') {
    throw new Error(`Could not log in ${email}: ${JSON.stringify(response.body)}`);
  }
  return response.body.token;
}

export function apiGet(app, token, path) {
  return request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`);
}

export function apiPost(app, token, path, body) {
  return request(app)
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}
