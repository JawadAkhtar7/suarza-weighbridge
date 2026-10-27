/**
 * One person's report.
 *
 * What is worth pinning is that every figure is counted from the records
 * rather than stored: the weighings they saved, the money they wrote down,
 * and the hours they were signed in — each bounded by the period asked for,
 * and each belonging to that person and nobody else.
 */

import request from 'supertest';
import type { Express } from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_API_KEY,
  completedWeighment,
  createUser,
  startDatabase,
  stopDatabase,
  testApp,
} from './helpers.js';
import { ingest } from '../src/services/ingest.service.js';
import { saveOperator } from '../src/services/roster.service.js';
import { buildUserReport } from '../src/services/user-report.service.js';
import { OperatorModel } from '../src/models/operator.model.js';
import { WeighmentModel } from '../src/models/weighment.model.js';
import { LogModel } from '../src/models/log.model.js';
import { ShiftCashModel } from '../src/models/shift-cash.model.js';

let app: Express;
let token: string;

const DAY = '2026-10-20';
const from = `${DAY}T00:00:00.000+05:00`;
const to = `${DAY}T23:59:59.999+05:00`;
const range = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };

beforeAll(async () => {
  await startDatabase();
  app = testApp();
  await createUser({ username: 'a-manager', password: 'manager-pw', role: 'MANAGER' });
  token = (
    await request(app).post('/auth/login').send({ username: 'a-manager', password: 'manager-pw' })
  ).body.token as string;
});
afterAll(stopDatabase);

afterEach(async () => {
  await Promise.all([
    WeighmentModel.deleteMany({}),
    LogModel.deleteMany({}),
    ShiftCashModel.deleteMany({}),
    OperatorModel.deleteMany({}),
  ]);
});

/** A weighing by somebody, at an hour of the Pakistan day. */
let slips = 0;
const weighedBy = (operator: string, clock: string, amount: number) =>
  completedWeighment({
    slip_number: `3010${(slips += 1)}`,
    operator_username: operator,
    amount_charged: amount,
    first_weight_at: `${DAY}T${clock}:00+05:00`,
    created_at: `${DAY}T${clock}:00+05:00`,
    updated_at: `${DAY}T${clock}:00+05:00`,
  });

const pushCash = (entry: Record<string, unknown>) =>
  request(app)
    .post('/api/sync/shift-cash')
    .set('x-api-key', TEST_API_KEY)
    .send({
      entries: [
        {
          id: `cash-${Math.random().toString(36).slice(2)}`,
          session_id: 'session-1',
          stage: 'START',
          operator: 'imran',
          person_name: '',
          person_taken: 0,
          person_given: 0,
          manager_name: '',
          manager_taken: 0,
          manager_given: 0,
          at: `${DAY}T09:30:00+05:00`,
          ...entry,
        },
      ],
    });

describe('what the report counts', () => {
  it('counts only this person, and only inside the period', async () => {
    await saveOperator({
      name: 'Imran Shah',
      username: 'imran',
      password: 'pass-one',
      role: 'OPERATOR',
    });

    await ingest(
      [
        weighedBy('imran', '09:00', 300),
        weighedBy('imran', '14:00', 500),
        // Somebody else, the same day.
        weighedBy('bilal', '10:00', 900),
        // Imran again, but the day before.
        completedWeighment({
          slip_number: '301099',
          operator_username: 'imran',
          amount_charged: 700,
          first_weight_at: '2026-10-19T09:00:00+05:00',
          created_at: '2026-10-19T09:00:00+05:00',
          updated_at: '2026-10-19T09:00:00+05:00',
        }),
      ],
      [],
    );

    const report = await buildUserReport({ operator: 'imran', ...range });

    expect(report.operator_name).toBe('Imran Shah');
    expect(report.weighments).toBe(2);
    expect(report.takings).toBe(800);
  });

  it('leaves voided tickets out, as every other figure does', async () => {
    const kept = weighedBy('imran', '09:00', 300);
    const voided = weighedBy('imran', '11:00', 400);
    await ingest([kept, voided], []);

    await WeighmentModel.updateOne(
      { slip_number: voided.slip_number },
      { $set: { status: 'VOID' } },
    );

    const report = await buildUserReport({ operator: 'imran', ...range });

    // A voided ticket took no money, so the day reads as the one that stood.
    expect(report.weighments).toBe(1);
    expect(report.takings).toBe(300);
  });

  it('lists a weighing with the truck it was for', async () => {
    await ingest([weighedBy('imran', '09:00', 300)], []);

    const report = await buildUserReport({ operator: 'imran', ...range });
    const [line] = report.activities;

    expect(line).toMatchObject({
      kind: 'WEIGHMENT',
      amount: 300,
      vehicle_type: 'truck',
      vehicle_plate: 'LES-1234',
    });
    expect(line?.slip_number).toBeTruthy();
  });

  it('keeps a weighing from the small hours on the right side of the window', async () => {
    // 02:00 in Pakistan is the previous evening in UTC; it belongs to this day.
    await ingest([weighedBy('imran', '02:00', 100), weighedBy('imran', '23:00', 200)], []);

    const report = await buildUserReport({ operator: 'imran', ...range });
    expect(report.weighments).toBe(2);
    expect(report.activities).toHaveLength(2);
  });

  it('adds up the money both ways, and gives each direction its own line', async () => {
    await pushCash({ person_name: 'Bilal', person_taken: 4000 });
    await pushCash({ manager_name: 'Mr Khan', manager_given: 2500, manager_taken: 500 });

    const report = await buildUserReport({ operator: 'imran', ...range });

    expect(report.money_taken).toBe(4500);
    expect(report.money_given).toBe(2500);

    /* Three lines, not two movements: the second entry moved money both
       ways, and each direction is its own fact. */
    const money = report.activities.filter((line) => line.kind.startsWith('MONEY_'));
    expect(money).toHaveLength(3);
    expect(money.filter((line) => line.kind === 'MONEY_GIVEN')).toHaveLength(1);
    expect(money.find((line) => line.amount === 4000)?.counterpart).toBe('Bilal');
  });

  it('shows the other side of a handover in the other person’s report', async () => {
    /*
     * A handover has two sides and is written down by one of them. Imran
     * recording "took 4,000 from Bilal" is the same event as Bilal giving
     * Imran 4,000 — so it belongs in Bilal's report too, the other way
     * round, or the money would leave his account and appear nowhere.
     */
    await saveOperator({
      name: 'Imran Shah',
      username: 'imran',
      password: 'pass-one',
      role: 'OPERATOR',
    });
    await saveOperator({
      name: 'Bilal Khan',
      username: 'bilal',
      password: 'pass-two',
      role: 'OPERATOR',
    });

    await pushCash({ person_name: 'Bilal Khan', person_taken: 4000 });

    const imran = await buildUserReport({ operator: 'imran', ...range });
    expect(imran.money_taken).toBe(4000);
    expect(imran.money_given).toBe(0);

    const bilal = await buildUserReport({ operator: 'bilal', ...range });
    expect(bilal.money_given).toBe(4000);
    expect(bilal.money_taken).toBe(0);

    const [line] = bilal.activities;
    expect(line).toMatchObject({
      kind: 'MONEY_GIVEN',
      amount: 4000,
      /* Said out loud: it is not his own record. */
      recorded_by: 'Imran Shah',
      counterpart: 'Imran Shah',
    });
  });

  it('mirrors a handover with the manager, who is an account like any other', async () => {
    await saveOperator({
      name: 'Imran Shah',
      username: 'imran',
      password: 'pass-one',
      role: 'OPERATOR',
    });
    await saveOperator({
      name: 'Mr Khan',
      username: 'boss',
      password: 'pass-two',
      role: 'ADMIN',
    });

    // Imran gave the manager 2,500 at the end of the day.
    await pushCash({ manager_name: 'Mr Khan', manager_given: 2500 });

    const boss = await buildUserReport({ operator: 'boss', ...range });

    expect(boss.money_taken).toBe(2500);
    expect(boss.activities[0]).toMatchObject({ kind: 'MONEY_TAKEN', recorded_by: 'Imran Shah' });
  });

  it('matches the name whatever case it was typed in', async () => {
    await saveOperator({
      name: 'Bilal Khan',
      username: 'bilal',
      password: 'pass-two',
      role: 'OPERATOR',
    });

    await pushCash({ person_name: 'bilal khan', person_given: 1500 });

    const bilal = await buildUserReport({ operator: 'bilal', ...range });
    expect(bilal.money_taken).toBe(1500);
  });

  it('leaves the other person alone when the name belongs to nobody', async () => {
    await saveOperator({
      name: 'Bilal Khan',
      username: 'bilal',
      password: 'pass-two',
      role: 'OPERATOR',
    });

    // A driver, a relative, somebody with no account at all.
    await pushCash({ person_name: 'Someone Else', person_taken: 4000 });

    const bilal = await buildUserReport({ operator: 'bilal', ...range });
    expect(bilal.activities).toEqual([]);
    expect(bilal.money_given).toBe(0);
  });

  it('leaves out money somebody else wrote down', async () => {
    await pushCash({ operator: 'bilal', person_taken: 9000 });

    const report = await buildUserReport({ operator: 'imran', ...range });
    expect(report.money_taken).toBe(0);
    expect(report.activities).toEqual([]);
  });

  it('reports the hours they were signed in, and says when one is still open', async () => {
    await request(app)
      .post('/api/sync/operator-logs')
      .set('x-api-key', TEST_API_KEY)
      .send({
        entries: [
          {
            id: 'start-1',
            kind: 'SHIFT_START',
            at: `${DAY}T08:00:00+05:00`,
            username: 'imran',
            name: 'Imran Shah',
            role: 'OPERATOR',
            session_id: 'session-1',
            detail: null,
          },
          {
            id: 'end-1',
            kind: 'SHIFT_END',
            at: `${DAY}T20:00:00+05:00`,
            username: 'imran',
            name: 'Imran Shah',
            role: 'OPERATOR',
            session_id: 'session-1',
            detail: null,
          },
          {
            id: 'start-2',
            kind: 'SHIFT_START',
            at: `${DAY}T21:00:00+05:00`,
            username: 'imran',
            name: 'Imran Shah',
            role: 'OPERATOR',
            session_id: 'session-2',
            detail: null,
          },
        ],
      });

    const report = await buildUserReport({ operator: 'imran', ...range });
    const shifts = report.activities.filter((line) => line.kind.startsWith('SHIFT_'));

    expect(shifts.map((line) => line.kind)).toEqual(['SHIFT_START', 'SHIFT_END', 'SHIFT_START']);
  });

  it('tells one story, newest first, whatever the lines came from', async () => {
    await ingest([weighedBy('imran', '09:00', 300)], []);
    await pushCash({ person_name: 'Bilal', person_taken: 4000 });
    await request(app)
      .post('/api/sync/operator-logs')
      .set('x-api-key', TEST_API_KEY)
      .send({
        entries: [
          {
            id: 'start-only',
            kind: 'SHIFT_START',
            at: `${DAY}T08:00:00+05:00`,
            username: 'imran',
            name: 'Imran Shah',
            role: 'OPERATOR',
            session_id: 'session-1',
            detail: null,
          },
        ],
      });

    const report = await buildUserReport({ operator: 'imran', ...range });

    // Newest first: 09:30 the money, 09:00 the truck, 08:00 the shift.
    expect(report.activities.map((line) => line.kind)).toEqual([
      'MONEY_TAKEN',
      'WEIGHMENT',
      'SHIFT_START',
    ]);
  });

  it('answers with zeroes for somebody who did nothing, rather than failing', async () => {
    const report = await buildUserReport({ operator: 'nobody', ...range });

    expect(report).toMatchObject({ weighments: 0, takings: 0, money_taken: 0, money_given: 0 });
    expect(report.activities).toEqual([]);
    expect(report.truncated).toBe(false);
  });
});

describe('the route', () => {
  it('is behind the dashboard guard', async () => {
    const anonymous = await request(app).get(`/api/reports/user?operator=imran`);
    const signedIn = await request(app)
      .get(`/api/reports/user?operator=imran&from=${range.from}&to=${range.to}`)
      .set('authorization', `Bearer ${token}`);

    expect(anonymous.status).toBe(401);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.operator).toBe('imran');
  });
});
