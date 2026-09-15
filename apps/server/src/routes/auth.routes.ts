/** Manager login (brief §10). No registration. */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginRequestSchema } from '@suarza/shared';
import { login } from '../services/auth.service.js';
import { parse } from './helpers.js';
import { ApiError } from '../errors.js';

export interface AuthRouterOptions {
  secret: string;
  expiresIn: string;
}

export function authRouter(options: AuthRouterOptions): Router {
  const router = Router();

  // This endpoint is public on the internet and guards every record in the
  // system, so it is the one place brute force is actually worth stopping.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new ApiError('RATE_LIMITED', 'Too many sign-in attempts. Try again in a few minutes.'));
    },
  });

  router.post('/auth/login', limiter, async (req, res) => {
    const credentials = parse(loginRequestSchema, req.body);
    res.json(await login(credentials.username, credentials.password, options));
  });

  return router;
}
