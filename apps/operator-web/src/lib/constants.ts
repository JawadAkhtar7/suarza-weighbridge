/** Operator app constants. */

/** Live-weight poll interval (brief §13-M2: ~300ms over loopback). */
export const LIVE_WEIGHT_POLL_MS = 300;

/** Sync status changes slowly; polling it as hard as the weight is wasteful. */
export const SYNC_STATUS_POLL_MS = 5000;

/**
 * Until operator login lands (brief §10), saves are attributed to this user.
 * It is the audit actor on every record, so it is named here rather than
 * scattered as a string literal across the call sites.
 */
export const DEFAULT_OPERATOR_USERNAME = 'operator';

export const HOTKEYS = {
  capture: 'F2',
  slip: 'F3',
  reset: 'F4',
  save: 'F9',
} as const;
