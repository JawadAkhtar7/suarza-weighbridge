/** JWT auth for the manager dashboard (brief §10). */

import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthUser, UserRole } from '@suarza/shared';
import { roleCan } from '@suarza/shared';
import { ApiError } from '../errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface JwtPayload {
  sub: string;
  role: UserRole;
  name: string;
}

export function requireAuth(secret: string): RequestHandler {
  return (req, _res, next) => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      next(new ApiError('UNAUTHORIZED', 'Sign in to continue.'));
      return;
    }

    try {
      const payload = jwt.verify(header.slice('Bearer '.length), secret) as JwtPayload;
      req.user = { username: payload.sub, role: payload.role, display_name: payload.name };
      next();
    } catch {
      // Expired and tampered tokens are the same thing to a client: sign in again.
      next(new ApiError('UNAUTHORIZED', 'Your session has expired. Sign in again.'));
    }
  };
}

/** Role gating (brief §10). ADMIN holds every capability. */
export function requireCapability(capability: string): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new ApiError('UNAUTHORIZED', 'Sign in to continue.'));
      return;
    }
    if (!roleCan(req.user.role, capability)) {
      next(new ApiError('FORBIDDEN', 'Your account does not have access to this.'));
      return;
    }
    next();
  };
}
