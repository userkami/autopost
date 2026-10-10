import { describe, expect, it } from 'vitest';
import { decrypt } from '@/lib/crypto';
import {
  decryptConnection,
  encryptAiConnectionSecrets,
  toPublicAiConnection,
  toPublicImageHost,
} from '@/lib/connections';

/**
 * No-secret-leak tests (PLAN.md §14.2, §17 Phase 2 acceptance): serialized
 * connection shapes must never include an encrypted secret or a plaintext key.
 */
describe('connection serializers never leak secrets (PLAN.md §14.2)', () => {
  const secret = 'sk-super-secret-value-123';
  const { apiKeyEnc } = encryptAiConnectionSecrets({ apiKey: secret });

  const aiRow = {
    id: 'ai-1',
    userId: 'user-1',
    provider: 'openai' as const,
    label: 'My OpenAI',
    baseUrl: null,
    apiKeyEnc,
    extraEnc: null,
    lastTestAt: null,
    lastTestStatus: null,
    lastTestError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('omits encrypted fields from the public AI connection shape', () => {
    const publicShape = toPublicAiConnection(aiRow);
    expect(publicShape).not.toHaveProperty('apiKeyEnc');
    expect(publicShape).not.toHaveProperty('extraEnc');
    expect(publicShape.hasKey).toBe(true);

    const serialized = JSON.stringify(publicShape);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(apiKeyEnc);
    expect(serialized).not.toContain('_enc');
  });

  it('omits encrypted fields from the public image host shape', () => {
    const hostShape = toPublicImageHost({
      id: 'h-1',
      userId: 'user-1',
      provider: 'imgbb',
      label: 'imgbb',
      configEnc: 'v1:k:iv:tag:ct',
      lastTestAt: null,
      lastTestStatus: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const serialized = JSON.stringify(hostShape);
    expect(serialized).not.toContain('configEnc');
    expect(serialized).not.toContain('v1:k:iv:tag:ct');
  });

  it('round-trips the stored key only through the internal decrypt path', () => {
    expect(decryptConnection(aiRow).apiKey).toBe(secret);
    expect(decrypt(apiKeyEnc)).toBe(secret);
  });
});