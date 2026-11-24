import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { config } from '../src/config/env.js';
import { app } from '../src/app.js';

const prisma = new PrismaClient();
const password = 'AuthTest@123';
const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const testEmails = {
  admin: `admin-${runId}@test.invalid`,
  salesman: `salesman-${runId}@test.invalid`,
  inactive: `inactive-${runId}@test.invalid`
};
const testUsers = {};

async function createUser(email, role, isActive = true) {
  const passwordHash = await bcrypt.hash(password, 4);
  return prisma.user.create({
    data: {
      name: email.split('@')[0],
      email,
      passwordHash,
      role,
      isActive
    }
  });
}

function tokenFor(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

beforeAll(async () => {
  testUsers.admin = await createUser(testEmails.admin, 'ADMIN');
  testUsers.salesman = await createUser(testEmails.salesman, 'SALESMAN');
  testUsers.inactive = await createUser(testEmails.inactive, 'ADMIN');
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { in: Object.values(testEmails) } }
  });
  await prisma.$disconnect();
});

describe('authentication and authorization', () => {
  it('logs in with valid credentials and exposes the authenticated user', async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmails.admin, password });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.token).toEqual(expect.any(String));
    expect(loginResponse.body.user).toEqual({
      id: testUsers.admin.id,
      name: testUsers.admin.name,
      email: testEmails.admin,
      role: 'ADMIN'
    });
    expect(jwt.verify(loginResponse.body.token, config.JWT_SECRET)).toMatchObject({
      sub: testUsers.admin.id,
      role: 'ADMIN'
    });

    const whoamiResponse = await request(app)
      .get('/api/_whoami')
      .set('Authorization', `Bearer ${loginResponse.body.token}`);
    expect(whoamiResponse.status).toBe(200);
    expect(whoamiResponse.body.user.email).toBe(testEmails.admin);
  });

  it('returns the same credential error for an unknown email and a wrong password', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmails.admin, password: 'wrong-password' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: `unknown-${runId}@test.invalid`, password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe('Invalid email or password');
    expect(unknownEmail.body.error.message).toBe('Invalid email or password');
  });

  it('rejects a protected request without a token', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('forbids a salesman from an admin-only route', async () => {
    const token = tokenFor(testUsers.salesman);
    const response = await request(app)
      .get('/api/_admin-only')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('enforces capability permissions for protected actions', async () => {
    const salesmanResponse = await request(app)
      .get('/api/_approve-only')
      .set('Authorization', `Bearer ${tokenFor(testUsers.salesman)}`);
    const adminResponse = await request(app)
      .get('/api/_approve-only')
      .set('Authorization', `Bearer ${tokenFor(testUsers.admin)}`);

    expect(salesmanResponse.status).toBe(403);
    expect(adminResponse.status).toBe(200);
  });

  it('rejects a token after its user is deactivated', async () => {
    const token = tokenFor(testUsers.inactive);
    await prisma.user.update({
      where: { id: testUsers.inactive.id },
      data: { isActive: false }
    });

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });

  it('rejects a valid token whose user has been deleted', async () => {
    const deletedUser = await createUser(`deleted-${runId}@test.invalid`, 'ADMIN');
    const token = tokenFor(deletedUser);
    await prisma.user.delete({ where: { id: deletedUser.id } });

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });
});
