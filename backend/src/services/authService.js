import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

function invalidCredentials() {
  return new AppError(401, 'UNAUTHORIZED', 'Invalid email or password');
}

export async function login(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail }
  });

  if (!user) {
    throw invalidCredentials();
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches || !user.isActive) {
    throw invalidCredentials();
  }

  const token = jwt.sign(
    { sub: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '12h' }
  );

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
