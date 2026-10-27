/**
 * The manager's pocket.
 *
 * The arithmetic is the whole of it, and the direction is the part that
 * must not be wrong: the same document means opposite things depending on
 * who wrote it down. An operator recording "took 4,000 from the manager" is
 * money the manager GAVE, and getting that backwards would be a pocket that
 * fills as it empties.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startDatabase, stopDatabase } from './helpers.js';
import { ShiftCashModel } from '../src/models/shift-cash.model.js';
import { managerPocket, recordManagerCash } from '../src/services/manager-cash.service.js';
import { saveOperator } from '../src/services/roster.service.js';
import { OperatorModel } from '../src/models/operator.model.js';
import { newId } from '@suarza/shared';

beforeAll(startDatabase);
afterAll(stopDatabase);
afterEach(async () => {
  await Promise.all([ShiftCashModel.deleteMany({}), OperatorModel.deleteMany({})]);
});

const BOSS = { username: 'a-manager', displayName: 'Mr Khan' };

/*
 * An hour either side of now.
 *
 * `recordManagerCash` stamps the moment it is called, as it should, so a
 * window around a fixed date in the past would exclude the very thing
 * under test.
 */
const whole = {
  from: new Date(Date.now() - 3_600_000),
  to: new Date(Date.now() + 3_600_000),
};

/** A movement as a bridge pushes it up: written by an operator. */
const operatorWrote = (entry: Record<string, unknown>) =>
  ShiftCashModel.create({
    _id: newId(),
    session_id: 'session-1',
    operator: 'imran',
    stage: 'START',
    person_name: '',
    person_taken: 0,
    person_given: 0,
    manager_name: '',
    manager_taken: 0,
    manager_given: 0,
    at: new Date(),
    ...entry,
  });

describe('what the manager is holding', () => {
  it('starts empty', async () => {
    const pocket = await managerPocket(BOSS, whole.from, whole.to);
    expect(pocket).toMatchObject({ all_time_net: 0, range_net: 0 });
    expect(pocket.movements).toEqual([]);
  });

  it('adds what the manager takes and subtracts what they give', async () => {
    await recordManagerCash(BOSS, { person_name: 'Imran Shah', taken: 9000, given: 0 });
    await recordManagerCash(BOSS, { person_name: 'Imran Shah', taken: 0, given: 2000 });

    const pocket = await managerPocket(BOSS, whole.from, whole.to);

    expect(pocket.all_time_taken).toBe(9000);
    expect(pocket.all_time_given).toBe(2000);
    expect(pocket.all_time_net).toBe(7000);
  });

  it('reads an operator’s record from the manager’s side, not the operator’s', async () => {
    /* Imran took 4,000 FROM the manager: the manager is 4,000 lighter. */
    await operatorWrote({ person_name: 'Mr Khan', person_taken: 4000 });
    /* And gave 6,000 TO the manager: the manager is 6,000 heavier. */
    await operatorWrote({ person_name: 'Mr Khan', person_given: 6000 });

    const pocket = await managerPocket(BOSS, whole.from, whole.to);

    expect(pocket.all_time_given).toBe(4000);
    expect(pocket.all_time_taken).toBe(6000);
    expect(pocket.all_time_net).toBe(2000);
  });

  it('still reads entries from when the form asked about "the manager" apart', async () => {
    await operatorWrote({ manager_name: 'Mr Khan', manager_given: 2500, manager_taken: 500 });

    const pocket = await managerPocket(BOSS, whole.from, whole.to);

    // They gave the manager 2,500 and took 500 back.
    expect(pocket.all_time_taken).toBe(2500);
    expect(pocket.all_time_given).toBe(500);
  });

  it('ignores a handover between two other people', async () => {
    await operatorWrote({ person_name: 'Bilal Khan', person_taken: 7000 });

    const pocket = await managerPocket(BOSS, whole.from, whole.to);
    expect(pocket.all_time_net).toBe(0);
    expect(pocket.movements).toEqual([]);
  });

  it('says whose record each movement is', async () => {
    await recordManagerCash(BOSS, { person_name: 'Imran Shah', taken: 1000, given: 0 });
    await operatorWrote({ person_name: 'Mr Khan', person_given: 3000 });

    const pocket = await managerPocket(BOSS, whole.from, whole.to);
    const mine = pocket.movements.find((line) => line.amount === 1000);
    const theirs = pocket.movements.find((line) => line.amount === 3000);

    expect(mine?.recorded_by).toBeNull();
    expect(theirs?.recorded_by).toBe('imran');
  });
});

describe('the administrator at the bridge', () => {
  it('counts money handed to an admin account as money in the pocket', async () => {
    /*
     * The yard has one manager, who runs the office and also works the
     * window under an administrator account. Money handed to that account
     * is money handed to the manager — a pocket that ignored it would be
     * missing the half of the takings that arrive at the bridge.
     */
    await saveOperator({
      name: 'Zeeshan',
      username: 'admin',
      password: 'pass-admin',
      role: 'ADMIN',
    });

    await operatorWrote({ person_name: 'Zeeshan', person_given: 5000 });

    const pocket = await managerPocket(BOSS, whole.from, whole.to);

    expect(pocket.all_time_taken).toBe(5000);
    expect(pocket.all_time_net).toBe(5000);
    expect(pocket.movements[0]).toMatchObject({ kind: 'MONEY_TAKEN', recorded_by: 'imran' });
  });

  it('counts what the admin account itself wrote down', async () => {
    await saveOperator({
      name: 'Zeeshan',
      username: 'admin',
      password: 'pass-admin',
      role: 'ADMIN',
    });

    /* Zeeshan, at the window, taking the day's cash from Imran. */
    await operatorWrote({ operator: 'admin', person_name: 'Imran Shah', person_taken: 4000 });

    const pocket = await managerPocket(BOSS, whole.from, whole.to);
    expect(pocket.all_time_taken).toBe(4000);
  });

  it('still ignores a handover between two operators', async () => {
    await saveOperator({
      name: 'Zeeshan',
      username: 'admin',
      password: 'pass-admin',
      role: 'ADMIN',
    });

    await operatorWrote({ person_name: 'Bilal Khan', person_taken: 7000 });

    expect((await managerPocket(BOSS, whole.from, whole.to)).all_time_net).toBe(0);
  });
});

describe('the period beside it', () => {
  it('keeps the pocket whole while the range counts only its own days', async () => {
    /*
     * The reason there are two figures. A pocket does not reset at
     * midnight; a day's movement does. Showing only the second would have
     * a manager reading zero on a quiet morning while holding a week's
     * takings.
     */
    /* Last week's 5,000, which is in the pocket but not in this range. */
    await ShiftCashModel.create({
      _id: newId(),
      session_id: 'manager:a-manager',
      operator: 'a-manager',
      stage: 'START',
      person_name: 'Imran Shah',
      person_taken: 5000,
      person_given: 0,
      manager_name: '',
      manager_taken: 0,
      manager_given: 0,
      at: new Date(Date.now() - 7 * 24 * 3_600_000),
    });
    await recordManagerCash(BOSS, { person_name: 'Imran Shah', taken: 1200, given: 0 });

    const pocket = await managerPocket(BOSS, whole.from, whole.to);

    expect(pocket.all_time_net).toBe(6200);
    expect(pocket.range_net).toBe(1200);
    expect(pocket.movements).toHaveLength(1);
  });
});
