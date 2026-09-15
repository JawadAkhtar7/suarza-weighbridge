/** MongoDB Atlas connection (brief §5: Mongo is used for data only). */

import mongoose from 'mongoose';

export interface ConnectOptions {
  uri: string;
  /** Fail fast on deploy rather than hanging if Atlas network access is wrong. */
  serverSelectionTimeoutMS?: number;
}

export async function connectDatabase({
  uri,
  serverSelectionTimeoutMS = 15_000,
}: ConnectOptions): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  // Mongoose buffers commands while disconnected and they time out later with
  // an unhelpful error; failing the call outright is easier to diagnose.
  mongoose.set('bufferCommands', false);

  await mongoose.connect(uri, { serverSelectionTimeoutMS });
  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/** Never log the URI itself — it carries the password. */
export function describeConnection(): string {
  const { host, name } = mongoose.connection;
  return `${host ?? 'unknown host'} / ${name ?? 'unknown database'}`;
}
