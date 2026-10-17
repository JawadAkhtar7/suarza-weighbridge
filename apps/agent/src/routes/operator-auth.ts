/**
 * Starting and ending a shift at the window.
 *
 * The credentials are the manager's — set in the dashboard, pulled down with
 * the other lists — but the sign-in itself happens here, on the weighbridge
 * PC, against the local copy. That is deliberate and is the whole design: a
 * shift begins at six in the morning, and a yard that cannot weigh a truck
 * because the internet is down is not a yard anybody can run.
 *
 * What this protects is the SCREEN, not the API. Everything here listens on
 * loopback only, and the one thing on this machine worth a password — the
 * station settings — has had its own since before this existed. The point of
 * the gate is that the shift is named: the log says who was at the window and
 * from when, and the records they save carry their username.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loginRequestSchema } from '@suarza/shared';
import type { AgentDeps } from '../server.js';
import { AppError } from '../errors.js';
import { toSession } from '../db/operators.js';
import { parse } from './helpers.js';

/** `Authorization: Bearer <token>`, or null. */
function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim() || null;
}

export function registerOperatorAuthRoutes(app: FastifyInstance, deps: AgentDeps): void {
  const operators = deps.operators;
  if (!operators) return;

  /**
   * Whether this bridge can sign anybody in at all.
   *
   * A bridge that has never pulled the accounts down — a new install, or one
   * whose cloud is not configured — has none, and locking the operator out
   * of the weighing screen until a manager can be reached would be a worse
   * failure than no sign-in at all. The screen asks this first and lets the
   * operator past when the answer is no, saying so plainly.
   */
  app.get('/operator/auth', (request) => {
    const token = bearer(request);
    const row = token ? operators.session(token) : undefined;
    return {
      required: operators.count() > 0,
      session: row ? toSession(row) : null,
    };
  });

  app.post('/operator/auth/login', (request) => {
    const credentials = parse(loginRequestSchema, request.body);
    const account = operators.verify(credentials.username, credentials.password);

    if (!account) {
      request.log.warn({ username: credentials.username }, 'Shift start refused');
      throw new AppError('INVALID_CREDENTIALS', 'That username and password do not match.');
    }

    const session = operators.startShift(account);
    request.log.info({ username: account.username, slot: account.slot }, 'Shift started');
    // Not awaited and not required: the manager's log can catch up.
    deps.onOperatorLog?.();
    return { session };
  });

  app.post('/operator/auth/logout', (request) => {
    const token = bearer(request);
    const ended = token ? operators.endShift(token) : null;
    if (ended) {
      request.log.info({ username: ended.username }, 'Shift ended');
      deps.onOperatorLog?.();
    }
    /* A token the agent has never heard of still answers "you are signed
       out", which is true and is what the screen needs to act on. */
    return { ended: Boolean(ended) };
  });
}
