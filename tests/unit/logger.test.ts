import { describe, expect, it } from 'vitest';
import { createLogger } from '@/lib/logger';

function captureLogger() {
  const lines: string[] = [];
  const log = createLogger({ level: 'info' }, { write: (chunk: string) => void lines.push(chunk) });
  return { log, lines };
}

describe('createLogger', () => {
  it('redacts secret-looking fields (PLAN.md §14.10)', () => {
    const { log, lines } = captureLogger();
    log.info(
      {
        api_key_enc: 'v1:abc:secret-ciphertext',
        authorization: 'Bearer sk-super-secret',
        refresh_token_enc: 'v1:abc:token',
        nested: { apiKey: 'sk-nested-secret' },
      },
      'provider call',
    );

    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('secret-ciphertext');
    expect(serialized).not.toContain('sk-super-secret');
    expect(serialized).not.toContain('sk-nested-secret');
    expect(serialized).not.toContain('v1:abc:token');
    expect(parsed.api_key_enc).toBe('[REDACTED]');
    expect(parsed.authorization).toBe('[REDACTED]');
    expect(parsed.refresh_token_enc).toBe('[REDACTED]');
    expect((parsed.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect(parsed.msg).toBe('provider call');
  });

  it('leaves non-secret fields intact', () => {
    const { log, lines } = captureLogger();
    log.warn({ blogId: 'abc-123', attempt: 2 }, 'retrying');
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.blogId).toBe('abc-123');
    expect(parsed.attempt).toBe(2);
    expect(parsed.level).toBe(40);
  });
});
