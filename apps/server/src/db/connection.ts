/** MongoDB Atlas connection (brief §5: Mongo is used for data only). */

import mongoose from 'mongoose';

export interface ConnectOptions {
  uri: string;
  /** Fail fast on deploy rather than hanging if Atlas network access is wrong. */
  serverSelectionTimeoutMS?: number;
  /** Extra attempts after the first. Zero makes the connect single-shot. */
  retries?: number;
  onRetry?: (attempt: number, delayMs: number, reason: string) => void;
}

/** Waits between attempts: 1s, 2s, 4s, 8s. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

/**
 * A wrong password or an unauthorised user will say exactly the same thing on
 * the fifth attempt as on the first. Retrying those only delays the one message
 * that would have told the operator what to fix.
 */
function isCredentialFailure(error: unknown): boolean {
  const { code, codeName } = (error ?? {}) as { code?: number; codeName?: string };
  // 18 AuthenticationFailed, 8000 Atlas's own auth error, 13 Unauthorized.
  return code === 18 || code === 8000 || code === 13 || codeName === 'AuthenticationFailed';
}

/**
 * Connects, retrying transient failures.
 *
 * The retries exist for one common case: a free-tier Atlas cluster auto-pauses
 * when idle, and waking it takes longer than any sane selection timeout. Without
 * them the first connect of the day fails, the process exits, and every tier
 * above it reports "cloud unreachable" for a cluster that was merely asleep.
 * A droplet booting before its network is up, and an Atlas failover, both look
 * the same from here.
 */
export async function connectDatabase({
  uri,
  serverSelectionTimeoutMS = 15_000,
  retries = RETRY_DELAYS_MS.length,
  onRetry,
}: ConnectOptions): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  // Mongoose buffers commands while disconnected and they time out later with
  // an unhelpful error; failing the call outright is easier to diagnose.
  mongoose.set('bufferCommands', false);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS });
      return mongoose;
    } catch (error) {
      lastError = error;
      if (isCredentialFailure(error) || attempt === retries) break;

      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
      onRetry?.(attempt + 1, delay, (error as Error).message);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/** Never log the URI itself — it carries the password. */
export function describeConnection(): string {
  const { host, name } = mongoose.connection;
  return `${host ?? 'unknown host'} / ${name ?? 'unknown database'}`;
}
