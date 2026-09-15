import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // better-sqlite3 is a native addon; running suites in one process avoids
    // repeatedly loading it and keeps temp DB files predictable.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
