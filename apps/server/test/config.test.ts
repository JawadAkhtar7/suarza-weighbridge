/**
 * Configuration guards (brief §5).
 *
 * The database-name check earns its place: a URI without it connects to the
 * cluster default, silently, and every read and write then goes to the wrong
 * place with no error to notice.
 */

import { describe, expect, it } from 'vitest';
import { databaseNameFromUri, EXPECTED_DATABASE_NAME, loadConfig } from '../src/config.js';

const validEnv = {
  MONGODB_URI: 'mongodb+srv://user:pass@cluster0.example.mongodb.net/suarzaweightbridge',
  JWT_SECRET: 'a-sufficiently-long-secret',
  INGEST_API_KEY: 'a-long-enough-key',
} as NodeJS.ProcessEnv;

describe('databaseNameFromUri', () => {
  it('reads the database name from an SRV URI', () => {
    expect(databaseNameFromUri(validEnv.MONGODB_URI!)).toBe(EXPECTED_DATABASE_NAME);
  });

  it('reads it from a plain mongodb:// URI', () => {
    expect(databaseNameFromUri('mongodb://127.0.0.1:27017/suarzaweightbridge')).toBe(
      'suarzaweightbridge',
    );
  });

  it('reads it when query options follow', () => {
    expect(
      databaseNameFromUri('mongodb+srv://u:p@c.mongodb.net/suarzaweightbridge?retryWrites=true'),
    ).toBe('suarzaweightbridge');
  });

  it('returns null when the URI names no database', () => {
    expect(databaseNameFromUri('mongodb+srv://u:p@cluster0.example.mongodb.net')).toBeNull();
    expect(databaseNameFromUri('mongodb+srv://u:p@cluster0.example.mongodb.net/')).toBeNull();
  });
});

describe('loadConfig', () => {
  it('accepts a complete configuration', () => {
    const config = loadConfig(validEnv);
    expect(config.PORT).toBe(4000);
    expect(config.JWT_EXPIRES_IN).toBe('12h');
  });

  it('refuses a Mongo URI with no database name', () => {
    expect(() =>
      loadConfig({ ...validEnv, MONGODB_URI: 'mongodb+srv://u:p@cluster0.example.mongodb.net' }),
    ).toThrow(/must include the database name/i);
  });

  it('refuses a missing JWT secret rather than starting insecure', () => {
    const { JWT_SECRET: _omitted, ...withoutSecret } = validEnv;
    expect(() => loadConfig(withoutSecret as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
  });

  it('refuses a JWT secret that is too short to be worth having', () => {
    expect(() => loadConfig({ ...validEnv, JWT_SECRET: 'short' })).toThrow(/at least 16/);
  });

  it('refuses a missing ingest key — that route writes financial records', () => {
    const { INGEST_API_KEY: _omitted, ...withoutKey } = validEnv;
    expect(() => loadConfig(withoutKey as NodeJS.ProcessEnv)).toThrow(/INGEST_API_KEY/);
  });

  it('lists every problem at once, not one per restart', () => {
    try {
      loadConfig({ MONGODB_URI: 'mongodb://localhost/db' } as NodeJS.ProcessEnv);
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('JWT_SECRET');
      expect(message).toContain('INGEST_API_KEY');
    }
  });
});
