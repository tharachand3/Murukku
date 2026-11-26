import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { getDashboardSummary } from '../src/services/dashboardService.js';
import { apiGet, seedBenchmarkMasters } from './helpers/benchmark.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { db, resetDb } from './helpers/db.js';

let benchmark;

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  benchmark = await runBenchmarkFull(app);
}, 120000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('owner dashboard summary', () => {
  it('returns the benchmark dashboard values without serializing BigInt', async () => {
    const response = await apiGet(app, benchmark.tokens.owner, '/api/dashboard/summary');

    expect(response.status).toBe(200);
    expect(response.body.today).toMatchObject({
      orders: { count: 2, taxablePaise: 1350000 },
      invoices: { count: 1, totalPaise: 787500 },
      payments: { count: 1, amountPaise: 400000 },
      dispatches: { count: 1 }
    });
    expect(response.body.pendingApproval.count).toBe(1);
    expect(response.body.stock.finished.find(({ itemId }) => itemId === benchmark.ids.murukku))
      .toMatchObject({ balanceBase: 88 });
    expect(response.body.stock.raw.find(({ itemId }) => itemId === benchmark.ids.flour))
      .toMatchObject({ balanceBase: 120000, display: '120 kg' });
    expect(response.body.stock.low).toEqual([]);
    expect(response.body.shortages).toMatchObject({
      totalShortPackets: 32,
      items: [{ shortPackets: 32, suggestedBatches: 1 }]
    });
    expect(response.body.variance.last30Days).toMatchObject({
      completedRuns: 1,
      flaggedRuns: 1
    });
    expect(response.body.variance.recentAlerts[0].alerts).toContain(
      'Yield 188 vs 200 expected (-6.00%) - flagged'
    );
    expect(response.body.costing).toMatchObject({
      latestRun: {
        costPerPacketPaise: expect.any(String),
        costPerPacketDisplay: 'Rs 31.14'
      },
      sellingPricePaise: expect.any(Number),
      marginBp: 3771
    });
    expect(response.body.receivables).toMatchObject({
      outstandingPaise: 387500,
      creditPaise: 0,
      over90Paise: 0,
      topCustomers: [{ name: 'Retailer A', outstandingPaise: 387500 }]
    });
    expect(() => JSON.stringify(response.body)).not.toThrow();
  });

  it('flags active raw stock at or below its configured reorder level', async () => {
    const update = await request(app)
      .patch(`/api/items/${benchmark.ids.flour}`)
      .set('Authorization', `Bearer ${benchmark.tokens.admin}`)
      .send({ reorderLevelBase: 150000 });

    expect(update.status).toBe(200);
    const response = await apiGet(app, benchmark.tokens.owner, '/api/dashboard/summary');
    expect(response.body.stock.low).toContainEqual(expect.objectContaining({
      itemId: benchmark.ids.flour,
      name: 'Flour',
      balanceBase: 120000,
      reorderLevelBase: 150000,
      display: '120 kg'
    }));
  });

  it('allows only OWNER and ADMIN and requires authentication', async () => {
    for (const role of ['owner', 'admin']) {
      const response = await apiGet(app, benchmark.tokens[role], '/api/dashboard/summary');
      expect(response.status).toBe(200);
    }
    for (const role of ['accountant', 'production', 'salesmanA']) {
      const response = await apiGet(app, benchmark.tokens[role], '/api/dashboard/summary');
      expect(response.status).toBe(403);
    }
    const anonymous = await request(app).get('/api/dashboard/summary');
    expect(anonymous.status).toBe(401);
  });

  it('returns zeroes and empty arrays when there is no data', async () => {
    await resetDb();
    const summary = await getDashboardSummary(prisma, {
      now: new Date('2026-11-26T12:00:00.000Z')
    });

    expect(summary.today).toMatchObject({
      orders: { count: 0, taxablePaise: 0 },
      invoices: { count: 0, totalPaise: 0 },
      payments: { count: 0, amountPaise: 0 },
      dispatches: { count: 0 }
    });
    expect(summary.pendingApproval).toMatchObject({ count: 0, oldestOrderDate: null });
    expect(summary.stock).toEqual({ finished: [], raw: [], packaging: [], low: [] });
    expect(summary.shortages).toEqual({ totalShortPackets: 0, items: [] });
    expect(summary.variance).toEqual({
      last30Days: { completedRuns: 0, flaggedRuns: 0 },
      recentAlerts: []
    });
    expect(summary.costing).toEqual({
      product: null,
      latestRun: null,
      sellingPricePaise: null,
      marginBp: null
    });
    expect(summary.receivables).toEqual({
      outstandingPaise: 0,
      creditPaise: 0,
      over90Paise: 0,
      topCustomers: []
    });
  });
});
