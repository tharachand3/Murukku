import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';

const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
};

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw badRequest('Password must contain at least 8 characters');
  }
}

export async function listUsers(db) {
  return db.user.findMany({
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    select: USER_PUBLIC_SELECT
  });
}

export async function createUser(userId, input) {
  validatePassword(input.password);
  const passwordHash = await bcrypt.hash(input.password, 10);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: input.name,
        email: input.email.trim().toLowerCase(),
        passwordHash,
        role: input.role
      },
      select: USER_PUBLIC_SELECT
    });
    await writeAudit(tx, {
      userId,
      action: 'CREATE',
      entity: 'User',
      entityId: user.id,
      after: user
    });
    return user;
  });
}

export async function updateUser(actorId, id, input) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id },
      select: USER_PUBLIC_SELECT
    });
    if (!before) {
      throw notFound('User not found');
    }
    if (
      actorId === id &&
      (input.isActive === false || input.role !== undefined && input.role !== 'ADMIN')
    ) {
      throw conflict('An admin cannot deactivate or demote himself');
    }

    const after = await tx.user.update({
      where: { id },
      data: input,
      select: USER_PUBLIC_SELECT
    });
    await writeAudit(tx, {
      userId: actorId,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      before,
      after
    });
    return after;
  });
}

export async function resetUserPassword(actorId, id, password) {
  validatePassword(password);
  const passwordHash = await bcrypt.hash(password, 10);

  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id },
      select: USER_PUBLIC_SELECT
    });
    if (!before) {
      throw notFound('User not found');
    }
    const after = await tx.user.update({
      where: { id },
      data: { passwordHash },
      select: USER_PUBLIC_SELECT
    });
    await writeAudit(tx, {
      userId: actorId,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      before,
      after
    });
    return after;
  });
}
