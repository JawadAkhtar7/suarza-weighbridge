/**
 * The accounts, and the shift filter they used to be tangled with.
 *
 * Two separate subjects, which is the point of the change they survived: an
 * account says who may sign in and what they may do, and a shift is a range
 * of hours read off the clock. Neither decides the other any more.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearDatabase, completedWeighment, startDatabase, stopDatabase } from './helpers.js';
import { ingest } from '../src/services/ingest.service.js';
import { listWeighments } from '../src/services/weighment.service.js';
import { getAnalytics } from '../src/services/analytics.service.js';
import {
  listRoster,
  operatorAccountsForSync,
  removeOperator,
  saveOperator,
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
const at = (clock: string, overrides: Record<string, unknown> = {}) =>
  completedWeighment({
    slip_number: `20268${(slipCounter += 1)}`,
    first_weight_at: `2026-10-16T${clock}:00+05:00`,
    created_at: `2026-10-16T${clock}:00+05:00`,
    updated_at: `2026-10-16T${clock}:00+05:00`,
    ...overrides,
  });

const person = (overrides: Record<string, unknown> = {}) => ({
  name: 'Imran Shah',
  username: 'imran',
  password: 'morning-pass',
  role: 'OPERATOR' as const,
  ...overrides,
});

describe('the accounts', () => {
  it('starts with nobody', async () => {
    expect((await listRoster()).operators).toEqual([]);
  });

  it('holds as many people as the yard has', async () => {
    /*
     * The thing the roster could not do. It had two shifts and an
     * administrator, one person in each, so a third operator or somebody
     * covering a week had nowhere to go.
     */
    await saveOperator(person());
    await saveOperator(person({ name: 'Bilal Khan', username: 'bilal' }));
    await saveOperator(person({ name: 'Mr Khan', username: 'boss', role: 'ADMIN' }));

    const { operators } = await listRoster();
    expect(operators).toHaveLength(3);
    expect(operators.filter((o) => o.role === 'ADMIN')).toHaveLength(1);
  });

  it('keeps the password to itself and only says whether there is one', async () => {
    const saved = await saveOperator(person());

    expect(saved).toMatchObject({ username: 'imran', has_password: true, role: 'OPERATOR' });
    // The DTO goes to a browser; nothing resembling a password may be on it.
    expect(JSON.stringify(saved)).not.toContain('morning-pass');
  });

  it('leaves the password alone when the manager only fixes a spelling', async () => {
    const saved = await saveOperator(person({ name: 'Imrn' }));
    const before = await operatorAccountsForSync();

    const fixed = await saveOperator({
      id: saved.id,
      name: 'Imran Shah',
      username: 'imran',
      role: 'OPERATOR',
    });

    expect(fixed.name).toBe('Imran Shah');
    expect(fixed.has_password).toBe(true);
    expect((await operatorAccountsForSync())[0]?.password_hash).toBe(before[0]?.password_hash);
  });

  it('can hand somebody administrator access without touching anything else', async () => {
    const saved = await saveOperator(person());

    const promoted = await saveOperator({
      id: saved.id,
      name: saved.name,
      username: 'imran',
      role: 'ADMIN',
    });

    expect(promoted.role).toBe('ADMIN');
    expect(promoted.has_password).toBe(true);
  });

  it('refuses a username somebody else already has', async () => {
    await saveOperator(person());

    await expect(saveOperator(person({ name: 'Bilal Khan', username: 'imran' }))).rejects.toThrow(
      /already in use/i,
    );
  });

  it('lets somebody keep their own username while being edited', async () => {
    const saved = await saveOperator(person());
    await expect(
      saveOperator({ id: saved.id, name: 'Imran S', username: 'imran', role: 'OPERATOR' }),
    ).resolves.toMatchObject({ username: 'imran' });
  });

  it('refuses a new account with no password, which could not sign in anywhere', async () => {
    await expect(
      saveOperator({ name: 'Imran Shah', username: 'imran', role: 'OPERATOR' }),
    ).rejects.toThrow(/password/i);
  });

  it('removes somebody who has left', async () => {
    const saved = await saveOperator(person());
    await removeOperator(saved.id);
    expect((await listRoster()).operators).toEqual([]);
  });

  it('refuses to remove somebody it does not have', async () => {
    await expect(removeOperator('nobody')).rejects.toThrow(/no operator/i);
  });

  it('sends the bridge only the accounts that can actually sign in', async () => {
    await saveOperator(person());
    const accounts = await operatorAccountsForSync();

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ username: 'imran', role: 'OPERATOR' });
    expect(accounts[0]?.password_hash).toMatch(/^\$2[aby]\$/);
  });
});

describe('naming the person who weighed it', () => {
  it('names them by the username on the record', async () => {
    await saveOperator(person());
    await ingest([at('21:00', { operator_username: 'imran' })], []);

    const [row] = (await listWeighments(query())).rows;
    expect(row!.operator_name).toBe('Imran Shah');
  });

  it('names nobody when the username belongs to no account', async () => {
    /*
     * The shared login the app used before anybody signed in. There is no
     * roster to fall back to now — and falling back to one was wrong
     * anyway, since it named whoever held that hour rather than whoever
     * actually saved the record.
     */
    await ingest([at('21:00', { operator_username: 'operator' })], []);
    expect((await listWeighments(query())).rows[0]?.operator_name).toBeNull();
  });
});

describe('filtering the dashboard by shift', () => {
  it('divides the day at eight and eight', async () => {
    await ingest([at('09:00'), at('13:30'), at('21:00'), at('02:00')], []);

    const morning = await listWeighments(query({ shift: 'MORNING' }));
    const night = await listWeighments(query({ shift: 'NIGHT' }));

    expect(morning.total).toBe(2);
    expect(night.total).toBe(2);
    // Both halves, and nothing counted twice or lost between them.
    expect(morning.total + night.total).toBe((await listWeighments(query())).total);
  });

  it('labels every row with the shift its own clock falls in', async () => {
    await ingest([at('09:00')], []);
    expect((await listWeighments(query())).rows[0]?.shift).toBe('MORNING');
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

describe('the figures above the table', () => {
  it('follows the shift filter, instead of counting both', async () => {
    /*
     * The bug this pins: choosing a shift re-filtered the table and left the
     * tiles and the charts counting the whole day, so the figures above the
     * rows quietly answered a different question from the rows themselves.
     */
    await ingest([at('09:00'), at('21:00')], []);

    const whole = await getAnalytics(query());
    const morning = await getAnalytics(query({ shift: 'MORNING' }));
    const night = await getAnalytics(query({ shift: 'NIGHT' }));

    expect(whole.total_weighments).toBe(2);
    expect(morning.total_weighments).toBe(1);
    expect(night.total_weighments).toBe(1);
    expect(morning.total_revenue + night.total_revenue).toBe(whole.total_revenue);
  });

  it('agrees with the table it sits above, down to the row', async () => {
    await ingest([at('09:00'), at('13:30'), at('21:00'), at('02:00')], []);

    const figures = await getAnalytics(query({ shift: 'NIGHT' }));
    const rows = await listWeighments(query({ shift: 'NIGHT' }));

    expect(figures.total_weighments).toBe(rows.total);
  });
});
