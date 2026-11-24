import jwt from 'jsonwebtoken';
import { CAPABILITY_MATRIX } from '../config/permissions.js';
import { config } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

function unauthorized() {
  return new AppError(401, 'UNAUTHORIZED', 'Authentication required');
}

function forbidden() {
  return new AppError(403, 'FORBIDDEN', 'Insufficient permissions');
}

export async function authenticate(req, _res, next) {
  try {
    const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
    if (!match) {
      return next(unauthorized());
    }

    let payload;
    try {
      payload = jwt.verify(match[1], config.JWT_SECRET);
    } catch {
      return next(unauthorized());
    }

    if (typeof payload !== 'object' || payload === null) {
      return next(unauthorized());
    }

    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return next(unauthorized());
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, isActive: true }
    });
    if (!user || !user.isActive) {
      return next(unauthorized());
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(forbidden());
    }
    return next();
  };
}

export function requireCapability(name) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(unauthorized());
    }
    const allowedRoles = CAPABILITY_MATRIX[name];
    if (!allowedRoles?.includes(req.user.role)) {
      return next(forbidden());
    }
    return next();
  };
}
