import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';
import { env } from './env';

/**
 * Secrets at rest — PLAN.md §14.1.
 * AES-256-GCM, random 12-byte IV per value, format:
 *   v1:<keyId>:<iv>:<tag>:<ciphertext>   (each part base64)
 * MASTER_KEY comes from the environment only; keyId = MASTER_KEY_ID (rotation hook).
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const PARTS = 5;

export type KeyMaterial = { keyId: string; key: Buffer };

function defaultKeys(): KeyMaterial[] {
  return [{ keyId: env.MASTER_KEY_ID, key: Buffer.from(env.MASTER_KEY, 'base64') }];
}

function pickKey(keys: KeyMaterial[], keyId: string): Buffer {
  const found = keys.find((k) => k.keyId === keyId);
  if (!found) {
    // Do not echo key material — only the id.
    throw new Error(`No key available for key id "${keyId}"`);
  }
  return found.key;
}

export function encrypt(
  plaintext: string,
  opts: { keyId?: string; keys?: KeyMaterial[] } = {},
): string {
  const keys = opts.keys ?? defaultKeys();
  const keyId = opts.keyId ?? keys[0]?.keyId;
  if (!keyId) throw new Error('No encryption key configured');
  const key = pickKey(keys, keyId);
  const iv = randomBytes(IV_BYTES);
  const cipher: CipherGCM = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    keyId,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decrypt(payload: string, opts: { keys?: KeyMaterial[] } = {}): string {
  if (typeof payload !== 'string') throw new Error('Encrypted value must be a string');
  const parts = payload.split(':');
  if (parts.length !== PARTS) throw new Error('Malformed encrypted value');
  const [version, keyId, ivPart, tagPart, dataPart] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== VERSION) throw new Error(`Unsupported encrypted value version "${version}"`);

  const keys = opts.keys ?? defaultKeys();
  const key = pickKey(keys, keyId);

  const decipher: DecipherGCM = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch {
    // GCM authentication failed: tampered ciphertext or wrong key.
    throw new Error('Failed to decrypt value (tampered or wrong key)');
  }
}

/** Encrypt a possibly-null secret column value. */
export function encryptNullable(value: string | null | undefined): string | null {
  return value == null || value === '' ? null : encrypt(value);
}

/** Decrypt a possibly-null secret column value. */
export function decryptNullable(value: string | null | undefined): string | null {
  return value == null ? null : decrypt(value);
}
