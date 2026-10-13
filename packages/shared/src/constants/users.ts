/**
 * The seed user list (brief §6). There is no registration flow.
 *
 * The list is config-driven on purpose: the agent and the server each read
 * their user list from env/config at boot and fall back to these seeds, so
 * real users drop in later without a code change. Passwords are never stored
 * in plaintext anywhere — these are the *seed* plaintexts, hashed at first
 * boot by whichever tier owns the user store.
 */

import type { UserRole } from './domain.js';

export interface SeedUser {
  username: string;
  /** Seed password, hashed on first boot. `[PLACEHOLDER]`. */
  password: string;
  role: UserRole;
  displayName: string;
}

export const SEED_USERS: readonly SeedUser[] = [
  { username: 'suarza', password: 'Pakistan1!', role: 'ADMIN', displayName: 'Suarza' },
] as const;

/**
 * The accounts this system used to ship with, and their shipped passwords.
 *
 * `operator/operator`, `manager/manager` and `admin/admin` went out with
 * every early build and are written down in the brief, so anyone who can
 * reach the dashboard can reach it as an administrator. Adding a real login
 * beside them would change nothing: the way in is the weakest account, not
 * the newest one.
 *
 * The server removes each of these on boot, and ONLY while its password is
 * still the published one — see removeDefaultUsers. An account someone has
 * since given a real password to is somebody's account and is left alone.
 */
export const RETIRED_SEED_USERS: readonly { username: string; password: string }[] = [
  { username: 'operator', password: 'operator' },
  { username: 'manager', password: 'manager' },
  { username: 'admin', password: 'admin' },
] as const;

/** Route gating (brief §10). ADMIN sees everything, including Settings. */
export const ROLE_CAPABILITIES: Record<UserRole, readonly string[]> = {
  OPERATOR: ['weighing'],
  // The ledger is the money side: managers keep it, operators never see it.
  MANAGER: ['dashboard', 'ledger'],
  ADMIN: ['weighing', 'dashboard', 'ledger', 'settings'],
};

export function roleCan(role: UserRole, capability: string): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
