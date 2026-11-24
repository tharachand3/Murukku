import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';

function invalidCredentials() {
  return new AppError(401, 'UNAUTHORIZED', 'Invalid email or password');
}

export async function login(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail }
  });

  const passwordMatches = user
    ? await bcrypt.compare(password, user.passwordHash)
    : false;
  if (!user || !passwordMatches || !user.isActive) {
    await writeAudit(prisma, {
      userId: user?.id,
      action: 'LOGIN_FAILURE',
      entity: 'User',
      entityId: user?.id,
      after: { email: normalizedEmail }
    });
    throw invalidCredentials();
  }

  const token = jwt.sign(
    { sub: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '12h' }
  );

  await writeAudit(prisma, {
    userId: user.id,
    action: 'LOGIN',
    entity: 'User',
    entityId: user.id,
    after: { email: user.email, role: user.role }
  });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  };
}
