/**
 * Dummy users (brief §6). `[PLACEHOLDER]` — there is no registration flow.
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
  { username: 'operator', password: 'operator', role: 'OPERATOR', displayName: 'Operator' },
  { username: 'manager', password: 'manager', role: 'MANAGER', displayName: 'Manager' },
  { username: 'admin', password: 'admin', role: 'ADMIN', displayName: 'Administrator' },
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
