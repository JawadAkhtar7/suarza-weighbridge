/**
 * The roster, and the filter it feeds.
 *
 * Two things worth pinning: that a shift holds one person — a yard does not
 * have two morning operators, and the records could not be read against them
 * if it did — and that filtering by shift agrees with the hours the manager
 * has set, including after they change.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearDatabase, completedWeighment, startDatabase, stopDatabase } from './helpers.js';
import { ingest } from '../src/services/ingest.service.js';
import { listWeighments } from '../src/services/weighment.service.js';
import {
  listRoster,
  operatorNamesByShift,
  removeOperator,
  setOperator,
  setShiftTimings,
  shiftTimings,
} from '../src/services/roster.service.js';
import { weighmentQuerySchema } from '@suarza/shared';

beforeAll(startDatabase);
afterAll(stopDatabase);
afterEach(clearDatabase);

const query = (overrides: Record<string, unknown> = {}) =>
  weighmentQuerySchema.parse({ page: 1, page_size: 50, ...overrides });

/**
 * A weighing at a given hour of the bridge's own day.
 *
 * Its own slip number, because the fixture's default is a constant and
 * ingesting four of those is ingesting one record four times.
 */
let slipCounter = 0;
const at = (clock: string) =>
  completedWeighment({
    slip_number: `20268${(slipCounter += 1)}`,
    first_weight_at: `2026-10-16T${clock}:00+05:00`,
    created_at: `2026-10-16T${clock}:00+05:00`,
    updated_at: `2026-10-16T${clock}:00+05:00`,
  });

describe('the roster', () => {
  it('starts with the hours the client asked for and nobody on them', async () => {
    const roster = await listRoster();
    expect(roster.shift_timings).toEqual({ MORNING: 8 * 60, NIGHT: 20 * 60 });
    expect(roster.operators).toEqual([]);
  });

  it('holds one person per shift, replacing rather than refusing', async () => {
    /*
     * A yard runs one person per shift, and a manager naming a second plainly
     * means the first has left. Making them delete the old one first would be
     * a rule to explain rather than a job to do.
     */
    await setOperator({ name: 'Imran', shift: 'MORNING' });
    await setOperator({ name: 'Bilal', shift: 'NIGHT' });
    await setOperator({ name: 'Kashif', shift: 'MORNING' });

    const roster = await listRoster();
    expect(roster.operators).toHaveLength(2);
    expect(await operatorNamesByShift()).toEqual({ MORNING: 'Kashif', NIGHT: 'Bilal' });
  });

  it('leaves a shift with nobody on it when the operator is removed', async () => {
    const imran = await setOperator({ name: 'Imran', shift: 'MORNING' });
    await removeOperator(imran.id);

    // Null rather than absent, so a caller can say "Morning shift" with no
    // name rather than having to decide what a missing entry means.
    expect(await operatorNamesByShift()).toEqual({ MORNING: null, NIGHT: null });
  });

  it('refuses to remove an operator it does not have', async () => {
    await expect(removeOperator('nobody')).rejects.toThrow(/no operator/i);
  });

  it('refuses two shifts starting at the same moment', async () => {
    // One shift would get the whole day and the other none, which is not a
    // roster so much as a way to make every filter answer the same.
    await expect(setShiftTimings({ MORNING: 480, NIGHT: 480 })).rejects.toThrow(/same time/i);
  });

  it('remembers changed hours', async () => {
    await setShiftTimings({ MORNING: 6 * 60, NIGHT: 18 * 60 });
    expect(await shiftTimings()).toEqual({ MORNING: 360, NIGHT: 1080 });
  });
});

describe('filtering the dashboard by shift', () => {
  it('divides the day at the configured hours', async () => {
    await ingest([at('09:00'), at('13:30'), at('21:00'), at('02:00')], []);

    const morning = await listWeighments(query({ shift: 'MORNING' }));
    const night = await listWeighments(query({ shift: 'NIGHT' }));

    expect(morning.total).toBe(2);
    expect(night.total).toBe(2);
    // Both halves, and nothing counted twice or lost between them.
    expect(morning.total + night.total).toBe((await listWeighments(query())).total);
  });

  it('labels every row with its shift and whoever is on it', async () => {
    await setOperator({ name: 'Imran', shift: 'MORNING' });
    await ingest([at('09:00')], []);

    const [row] = (await listWeighments(query())).rows;
    expect(row!.shift).toBe('MORNING');
    expect(row!.operator_name).toBe('Imran');
  });

  it('says nobody is rostered rather than inventing a name', async () => {
    await ingest([at('21:00')], []);
    const [row] = (await listWeighments(query())).rows;
    expect(row!.shift).toBe('NIGHT');
    expect(row!.operator_name).toBeNull();
  });

  it('re-reads past weighings when the hours change', async () => {
    /*
     * The reason the shift is worked out rather than stored. A weighing at
     * 07:00 is night under the default hours and morning under a yard that
     * opens at six — and correcting the hours has to correct the history, not
     * only what happens next.
     */
    await ingest([at('07:00')], []);
    expect((await listWeighments(query({ shift: 'NIGHT' }))).total).toBe(1);

    await setShiftTimings({ MORNING: 6 * 60, NIGHT: 18 * 60 });

    expect((await listWeighments(query({ shift: 'NIGHT' }))).total).toBe(0);
    expect((await listWeighments(query({ shift: 'MORNING' }))).total).toBe(1);
  });

  it('paginates within a shift', async () => {
    await ingest([at('09:00'), at('10:00'), at('11:00')], []);

    const first = await listWeighments(query({ shift: 'MORNING', page: 1, page_size: 2 }));
    const second = await listWeighments(query({ shift: 'MORNING', page: 2, page_size: 2 }));

    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(1);
    // The total is the shift's, not the page's — the pager depends on it.
    expect(first.total).toBe(3);
  });
});
