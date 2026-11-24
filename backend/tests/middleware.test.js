import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { asyncHandler } from '../src/lib/asyncHandler.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const prisma = new PrismaClient();
const email = `unique-${Date.now()}-${Math.random().toString(36).slice(2)}@test.invalid`;
const missingEmail = `missing-${Date.now()}-${Math.random().toString(36).slice(2)}@test.invalid`;
const boundaryApp = express();

boundaryApp.get('/duplicate', asyncHandler(async (_req, res) => {
  await prisma.user.create({
    data: {
      name: 'Duplicate attempt',
      email,
      passwordHash: 'unused',
      role: 'ADMIN'
    }
  });
  res.sendStatus(201);
}));
boundaryApp.get('/missing', asyncHandler(async (_req, res) => {
  await prisma.user.delete({ where: { email: missingEmail } });
  res.sendStatus(204);
}));
boundaryApp.get('/unknown-error', () => {
  throw new Error('private error detail');
});
boundaryApp.use(errorHandler);

beforeAll(async () => {
  await prisma.user.create({
    data: {
      name: 'Unique fixture',
      email,
      passwordHash: 'unused',
      role: 'ADMIN'
    }
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

describe('central error handler', () => {
  it('maps a Prisma unique violation to DUPLICATE with status 409', async () => {
    const response = await request(boundaryApp).get('/duplicate');

    expect(response.status).toBe(409);
    expect(response.body.error).toEqual({
      code: 'DUPLICATE',
      message: 'Resource already exists',
      details: null
    });
  });

  it('maps a missing Prisma record to NOT_FOUND with status 404', async () => {
    const response = await request(boundaryApp).get('/missing');

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Resource not found',
      details: null
    });
  });

  it('hides unknown error details while logging the stack', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(boundaryApp).get('/unknown-error');
      expect(response.status).toBe(500);
      expect(response.body.error).toEqual({
        code: 'INTERNAL',
        message: 'Internal server error',
        details: null
      });
      expect(JSON.stringify(response.body)).not.toContain('private error detail');
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
