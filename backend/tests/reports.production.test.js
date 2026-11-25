import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { currentFinancialYear } from '../src/lib/fy.js';
import { formatIstDate } from '../src/lib/reportKit.js';
import { prisma } from '../src/lib/prisma.js';
import { apiGet, apiPost, seedBenchmarkMasters } from './helpers/benchmark.js';
import { runBenchmarkFull } from './helpers/benchmarkFull.js';
import { runSecondProductionRun } from './helpers/benchmarkExtras.js';
import { db, resetDb } from './helpers/db.js';

const fy = currentFinancialYear();
let benchmark;
let secondRunId;

function section(response, key) {
  return response.body.sections.find((candidate) => candidate.key === key);
}

function rowForCode(rows, code) {
  return rows.find((row) => row.itemCode === code);
}

function shiftIstDate(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+05:30`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIstDate(date);
}

function atIstTime(dateText, time) {
  return new Date(`${dateText}T${time}+05:30`);
}

beforeAll(async () => {
  await resetDb();
  await seedBenchmarkMasters();
  benchmark = await runBenchmarkFull(app);
}, 120000);

afterAll(async () => {
  await Promise.all([db.$disconnect(), prisma.$disconnect()]);
});

describe('production report', () => {
  it('reports stored benchmark yield, material variance, cost, and wastage', async () => {
    const report = await apiGet(app, benchmark.tokens.production, '/api/reports/production-report');
    expect(report.status).toBe(200);
    const runRows = section(report, 'runs').rows;
    expect(runRows).toHaveLength(1);
    expect(runRows[0]).toMatchObject({
      runNo: `RUN/${fy}/0001`,
      productCode: 'MURUKKU200',
      status: 'COMPLETED',
      batches: '1',
      plannedOutput: 200,
      goodOutput: 188,
      rejected: 0,
      yieldVarianceBp: -600,
      yieldFlagged: 'YES',
      flaggedLines: 2,
      materialCostPaise: 405500,
      overheadCostPaise: 180000,
      totalCostPaise: 585500,
      costPerPacketPaise: '3114.3617'
    });

    const consumption = section(report, 'consumption').rows;
    expect(consumption).toHaveLength(5);
    expect(rowForCode(consumption, 'FLOUR')).toMatchObject({
      plannedQty: '40',
      issuedQty: '40',
      scrapQty: '0',
      varianceQty: '0',
      varianceBp: 0,
      flagged: 'NO',
      plannedCostPaise: 172500,
      actualCostPaise: 172500,
      costVariancePaise: 0
    });
    expect(rowForCode(consumption, 'OIL')).toMatchObject({
      plannedQty: '10',
      issuedQty: '10.5',
      varianceQty: '0.5',
      varianceBp: 500,
      flagged: 'YES',
      plannedCostPaise: 140000,
      actualCostPaise: 147000,
      costVariancePaise: 7000
    });
    expect(rowForCode(consumption, 'POUCH200')).toMatchObject({
      plannedQty: '200',
      issuedQty: '194',
      scrapQty: '6',
      varianceQty: '-6',
      varianceBp: -300,
      flagged: 'NO',
      plannedCostPaise: 50000,
      actualCostPaise: 48500,
      costVariancePaise: -1500
    });
    expect(rowForCode(consumption, 'CARTON')).toMatchObject({
      plannedQty: '10',
      issuedQty: '9',
      varianceQty: '-1',
      varianceBp: -1000,
      flagged: 'YES',
      plannedCostPaise: 15000,
      actualCostPaise: 13500,
      costVariancePaise: -1500
    });

    const wastage = section(report, 'wastage');
    expect(rowForCode(wastage.rows, 'POUCH200')).toMatchObject({
      scrapQty: '6',
      scrapValuePaise: 1500
    });
    expect(rowForCode(wastage.rows, 'OIL')).toMatchObject({
      excessQty: '0.5',
      excessValuePaise: 7000
    });
    expect(wastage.totals).toEqual({
      scrapValuePaise: 1500,
      excessValuePaise: 7000
    });
    expect(section(report, 'yield').rows).toEqual([{
      productCode: 'MURUKKU200',
      productName: 'Murukku 200 g',
      runs: 1,
      plannedOutput: 200,
      goodOutput: 188,
      shortfall: 12,
      shortfallBp: -600
    }]);

    const second = await runSecondProductionRun(app, benchmark);
    secondRunId = second.runId;
    const withSecondRun = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/production-report'
    );
    expect(section(withSecondRun, 'runs').rows).toHaveLength(2);
    expect(section(withSecondRun, 'runs').rows[1]).toMatchObject({
      yieldFlagged: 'NO',
      flaggedLines: 0
    });
    expect(section(withSecondRun, 'runs').totals).toEqual({
      materialCostPaise: 606250,
      overheadCostPaise: 180000,
      totalCostPaise: 786250,
      goodOutput: 288
    });
    expect(section(withSecondRun, 'yield').rows[0]).toMatchObject({
      runs: 2,
      plannedOutput: 300,
      goodOutput: 288,
      shortfall: 12,
      shortfallBp: -400
    });
    const secondPage = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/production-report?limit=1&page=2'
    );
    expect(section(secondPage, 'runs').rows[0]).toMatchObject({
      runNo: `RUN/${fy}/0002`
    });
    expect(section(secondPage, 'consumption').rows.every(
      (row) => row.runNo === `RUN/${fy}/0002`
    )).toBe(true);

    const flagged = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/production-report?flaggedOnly=true'
    );
    expect(section(flagged, 'runs').rows.map((row) => row.runNo))
      .toEqual([`RUN/${fy}/0001`]);

    const changedTolerance = await request(app)
      .put('/api/settings/VARIANCE_TOLERANCE_BP')
      .set('Authorization', `Bearer ${benchmark.tokens.admin}`)
      .send({ value: '1500' });
    expect(changedTolerance.status).toBe(200);
    const storedFlags = await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/production-report'
    );
    expect(section(storedFlags, 'runs').rows[0].yieldFlagged).toBe('YES');
    expect(rowForCode(section(storedFlags, 'consumption').rows, 'OIL').flagged).toBe('YES');
    const restoredTolerance = await request(app)
      .put('/api/settings/VARIANCE_TOLERANCE_BP')
      .set('Authorization', `Bearer ${benchmark.tokens.admin}`)
      .send({ value: '300' });
    expect(restoredTolerance.status).toBe(200);
  });

  it('includes issued runs only when requested, with nullable completion fields', async () => {
    const started = await apiPost(app, benchmark.tokens.production, '/api/production/runs', {
      finishedItemId: benchmark.ids.murukku,
      batchCount: '1',
      issues: []
    });
    expect(started.status).toBe(201);
    const defaults = await apiGet(
      app,
      benchmark.tokens.production,
      '/api/reports/production-report'
    );
    expect(section(defaults, 'runs').rows).toHaveLength(2);

    const issued = await apiGet(
      app,
      benchmark.tokens.production,
      '/api/reports/production-report?status=ISSUED'
    );
    expect(section(issued, 'runs').rows).toHaveLength(1);
    expect(section(issued, 'runs').rows[0]).toMatchObject({
      status: 'ISSUED',
      goodOutput: null,
      completedDate: null,
      yieldFlagged: 'NO',
      costPerPacketPaise: null
    });
  });

  it('uses completion date for period boundaries and supports product filtering', async () => {
    const today = formatIstDate(new Date());
    const yesterday = shiftIstDate(today, -1);
    await db.productionRun.update({
      where: { id: benchmark.ids.runId },
      data: { completedAt: atIstTime(yesterday, '23:30:00') }
    });
    await db.productionRun.update({
      where: { id: secondRunId },
      data: { completedAt: atIstTime(today, '00:30:00') }
    });

    const latePeriod = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/production-report?from=${yesterday}&to=${yesterday}`
    );
    expect(section(latePeriod, 'runs').rows.map((row) => row.runNo))
      .toEqual([`RUN/${fy}/0001`]);

    const nextDay = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/production-report?from=${today}&to=${today}&finishedItemId=${benchmark.ids.murukku}`
    );
    expect(section(nextDay, 'runs').rows.map((row) => row.runNo))
      .toEqual([`RUN/${fy}/0002`]);
    const noProduct = await apiGet(
      app,
      benchmark.tokens.accountant,
      `/api/reports/production-report?from=${today}&to=${today}&finishedItemId=2147483647`
    );
    expect(section(noProduct, 'runs').rows).toEqual([]);
  });

  it('enforces production:read roles and strict query validation', async () => {
    for (const role of ['production', 'admin', 'accountant', 'owner']) {
      expect((await apiGet(
        app,
        benchmark.tokens[role],
        '/api/reports/production-report'
      )).status).toBe(200);
    }
    expect((await apiGet(
      app,
      benchmark.tokens.salesmanA,
      '/api/reports/production-report'
    )).status).toBe(403);
    expect((await request(app).get('/api/reports/production-report')).status).toBe(401);
    expect((await apiGet(
      app,
      benchmark.tokens.accountant,
      '/api/reports/production-report?unknown=true'
    )).status).toBe(400);
  });
});
