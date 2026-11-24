import jwt from 'jsonwebtoken';
import { CAPABILITY_MATRIX } from '../config/permissions.js';
import { config } from '../config/env.js';
import {
  forbidden as forbiddenError,
  unauthorized as unauthorizedError
} from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

export async function authenticate(req, _res, next) {
  try {
    const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
    if (!match) {
      return next(unauthorizedError());
    }

    let payload;
    try {
      payload = jwt.verify(match[1], config.JWT_SECRET);
    } catch {
      return next(unauthorizedError());
    }

    if (typeof payload !== 'object' || payload === null) {
      return next(unauthorizedError());
    }

    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return next(unauthorizedError());
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, isActive: true }
    });
    if (!user || !user.isActive) {
      return next(unauthorizedError());
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
      return next(unauthorizedError());
    }
    if (!roles.includes(req.user.role)) {
      return next(forbiddenError());
    }
    return next();
  };
}

export function requireCapability(name) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(unauthorizedError());
    }
    const allowedRoles = CAPABILITY_MATRIX[name];
    if (!allowedRoles?.includes(req.user.role)) {
      return next(forbiddenError());
    }
    return next();
  };
}
