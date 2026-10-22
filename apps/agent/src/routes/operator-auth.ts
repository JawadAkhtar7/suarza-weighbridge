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
import { loginRequestSchema, shiftCashInputSchema } from '@suarza/shared';
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

  /**
   * The names behind the usernames, for the soft copy of a slip.
   *
   * No password hashes and no session: a weighing records the username of
   * whoever saved it, and the slip on screen should say "Imran Shah" rather
   * than "imran". Read by the print tab too, which is a window of its own
   * with no session in it.
   */
  app.get('/operator/directory', () => ({ operators: operators.list() }));

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

  /**
   * The cash taken over at the start of a shift.
   *
   * Its own route rather than part of the sign-in, because the operator types
   * it a moment AFTER signing in — the shift has already begun, a truck may
   * already be on the bridge, and making the sign-in wait on a form would be
   * a gate in front of the weighing screen rather than a note beside it.
   *
   * It updates the entry the sign-in already wrote, so a shift has one start
   * however many times this is sent.
   */
  /** Everything this shift has written down so far, oldest first. */
  app.get('/operator/shift/cash', (request) => {
    const token = bearer(request);
    const session = token ? operators.session(token) : undefined;
    if (!session) {
      throw new AppError('INVALID_CREDENTIALS', 'No shift is running on this screen.');
    }
    return { entries: operators.cashEntries(session.session_id) };
  });

  /**
   * Write down one handing-over of money.
   *
   * Its own route rather than part of the sign-in, because the operator
   * types it a moment AFTER signing in — the shift has already begun, a
   * truck may already be on the bridge, and making the sign-in wait on a
   * form would be a gate in front of the weighing screen rather than a note
   * beside it.
   *
   * Every call appends. Cash changes hands more than twice in a day, and the
   * second time must not erase the first.
   */
  app.post('/operator/shift/cash', (request) => {
    const token = bearer(request);
    const session = token ? operators.session(token) : undefined;
    if (!session) {
      throw new AppError('INVALID_CREDENTIALS', 'No shift is running on this screen.');
    }

    const { stage, ...movement } = parse(shiftCashInputSchema, request.body);
    const entry = operators.recordCash(session.session_id, session.username, stage, movement);
    request.log.info({ username: session.username, stage }, 'Shift cash recorded');
    deps.onOperatorLog?.();
    return { entry };
  });

  app.post('/operator/auth/logout', (request) => {
    const token = bearer(request);
    const session = token ? operators.session(token) : undefined;

    /* The closing handover is optional and, when there is one, it is a
       movement like any other — written down as its own row before the
       shift closes. An operator who skips it has still gone home. */
    if (session && request.body && Object.keys(request.body as object).length > 0) {
      const { stage, ...movement } = parse(shiftCashInputSchema, {
        stage: 'END',
        ...(request.body as object),
      });
      operators.recordCash(session.session_id, session.username, stage, movement);
    }

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
