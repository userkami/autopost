import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';

const validEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/autoblog',
  AUTH_SECRET: 'a'.repeat(32),
  MASTER_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // base64 of 32 zero bytes
};

describe('parseEnv', () => {
  it('parses a minimal valid environment with defaults', () => {
    const env = parseEnv({ ...validEnv });
    expect(env.APP_NAME).toBe('AutoBlog');
    expect(env.APP_URL).toBe('http://localhost:3000');
    expect(env.ENABLE_MOCK_PROVIDERS).toBe(false);
    expect(env.WORKER_CONCURRENCY).toBe(3);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.ADMIN_EMAILS).toBe('');
  });

  it('coerces boolean strings correctly (the "false" is not truthy)', () => {
    expect(parseEnv({ ...validEnv, ENABLE_MOCK_PROVIDERS: 'false' }).ENABLE_MOCK_PROVIDERS).toBe(
      false,
    );
    expect(parseEnv({ ...validEnv, ENABLE_MOCK_PROVIDERS: 'true' }).ENABLE_MOCK_PROVIDERS).toBe(
      true,
    );
  });

  it('treats empty optional strings as undefined', () => {
    const env = parseEnv({ ...validEnv, SMTP_URL: '', AUTH_GOOGLE_ID: '' });
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.AUTH_GOOGLE_ID).toBeUndefined();
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when AUTH_SECRET is too short', () => {
    expect(() => parseEnv({ ...validEnv, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });

  it('throws when MASTER_KEY is not 32 bytes of base64', () => {
    expect(() => parseEnv({ ...validEnv, MASTER_KEY: 'not-base64!!' })).toThrow(/MASTER_KEY/);
    expect(() =>
      parseEnv({ ...validEnv, MASTER_KEY: Buffer.from('too short').toString('base64') }),
    ).toThrow(/MASTER_KEY/);
  });

  it('throws on an invalid LOG_LEVEL', () => {
    expect(() => parseEnv({ ...validEnv, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
