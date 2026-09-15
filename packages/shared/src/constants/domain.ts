/** Core domain enums and constants shared by all three tiers (brief §6, §7). */

export const WEIGHMENT_STATUSES = ['OPEN', 'COMPLETED', 'VOID'] as const;
export type WeighmentStatus = (typeof WEIGHMENT_STATUSES)[number];

export const WEIGHT_SOURCES = ['SERIAL', 'MANUAL'] as const;
export type WeightSource = (typeof WEIGHT_SOURCES)[number];

export const AUDIT_ACTIONS = [
  'CREATED',
  'SECOND_WEIGHT',
  'COMPLETED',
  'VOIDED',
  'REPRINTED',
  'MANUAL_WEIGHT',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const USER_ROLES = ['OPERATOR', 'MANAGER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const DEFAULT_STATION_ID = 'A';
export const DEFAULT_CURRENCY = 'PKR';

/** Store UTC, display Pakistan time (brief §6 "Timestamps"). */
export const DISPLAY_TIMEZONE = 'Asia/Karachi';

/** Unit conversion bases (brief §2). 1 maund = 40 kg (Pakistan standard). */
export const KG_PER_TON = 1000;
export const KG_PER_MAUND = 40;
