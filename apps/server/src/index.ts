/**
 * Server entrypoint (runs under PM2 on the DigitalOcean droplet — brief §14).
 *
 * The database connects before the HTTP listener opens: a server that accepts
 * an ingest it cannot store would tell the agent a record was safe when it was
 * not, and the agent would stop retrying it.
 */

import { loadConfig } from './config.js';
import { connectDatabase, describeConnection, disconnectDatabase } from './db/connection.js';
import { seedUsers } from './services/auth.service.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();

  await connectDatabase({
    uri: config.MONGODB_URI,
    onRetry: (attempt, delayMs, reason) =>
      console.warn(
        `MongoDB not reachable (attempt ${attempt}): ${reason}\n` +
          `Retrying in ${delayMs / 1000}s — a paused free-tier cluster takes a moment to wake.`,
      ),
  });
  console.info(`Connected to MongoDB: ${describeConnection()}`);

  const created = await seedUsers();
  if (created > 0) console.info(`Seeded ${created} user account(s)`);

  const app = buildApp({ config, serveManagerWeb: config.SERVE_MANAGER_WEB });

  const server = app.listen(config.PORT, () => {
    console.info(`Suarza weighbridge server listening on port ${config.PORT}`);
    console.info(`Public receipts at ${config.APP_DOMAIN}/r/:slip`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`${signal} received — shutting down`);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

main().catch((error: unknown) => {
  const message = (error as Error).message;
  console.error(`Server failed to start: ${message}`);
  // The message above is a timeout either way, so say which of the two very
  // different causes it usually is rather than leaving it to be guessed.
  if (/Server selection timed out/i.test(message)) {
    console.error(
      'MongoDB could not be reached. Usual causes: this machine is not in the\n' +
        "Atlas IP access list, the cluster is paused, or there is no network.",
    );
  }
  process.exit(1);
});
