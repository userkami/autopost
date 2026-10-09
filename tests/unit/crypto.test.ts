import { describe, expect, it } from 'vitest';
import { decrypt, decryptNullable, encrypt, encryptNullable, type KeyMaterial } from '@/lib/crypto';

const KEY_A: KeyMaterial = { keyId: 'v1', key: Buffer.alloc(32, 1) };
const KEY_B: KeyMaterial = { keyId: 'v1', key: Buffer.alloc(32, 2) };

describe('crypto (AES-256-GCM, PLAN.md §14.1)', () => {
  it('round-trips with the default env key', () => {
    const payload = encrypt('hello secret 🔐');
    expect(payload.startsWith('v1:')).toBe(true);
    expect(decrypt(payload)).toBe('hello secret 🔐');
  });

  it('produces the v1:<keyId>:<iv>:<tag>:<ciphertext> format', () => {
    const payload = encrypt('x', { keys: [KEY_A] });
    const parts = payload.split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('v1');
    expect(parts[1]).toBe('v1');
    expect(Buffer.from(parts[2]!, 'base64')).toHaveLength(12); // IV
    expect(Buffer.from(parts[3]!, 'base64')).toHaveLength(16); // GCM tag
    // fresh IV per value: encrypting twice differs
    expect(encrypt('x', { keys: [KEY_A] })).not.toBe(encrypt('x', { keys: [KEY_A] }));
  });

  it('rejects tampered ciphertext', () => {
    const payload = encrypt('important', { keys: [KEY_A] });
    const parts = payload.split(':');
    const data = Buffer.from(parts[4]!, 'base64');
    data[0] = data[0]! ^ 0xff;
    parts[4] = data.toString('base64');
    expect(() => decrypt(parts.join(':'), { keys: [KEY_A] })).toThrow(/tampered or wrong key/);
  });

  it('rejects a tampered auth tag', () => {
    const payload = encrypt('important', { keys: [KEY_A] });
    const parts = payload.split(':');
    const tag = Buffer.from(parts[3]!, 'base64');
    tag[0] = tag[0]! ^ 0xff;
    parts[3] = tag.toString('base64');
    expect(() => decrypt(parts.join(':'), { keys: [KEY_A] })).toThrow(/tampered or wrong key/);
  });

  it('fails to decrypt with the wrong key', () => {
    const payload = encrypt('secret', { keys: [KEY_A] });
    expect(() => decrypt(payload, { keys: [KEY_B] })).toThrow(/tampered or wrong key/);
  });

  it('fails on an unknown key id (no silent defaults)', () => {
    const payload = encrypt('secret', { keys: [{ keyId: 'v9', key: KEY_A.key }] });
    expect(() => decrypt(payload)).toThrow(/No key available for key id "v9"/);
  });

  it('rejects malformed payloads', () => {
    expect(() => decrypt('not-encrypted')).toThrow(/Malformed/);
    expect(() => decrypt('a:b:c')).toThrow(/Malformed/);
    expect(() => decrypt('v9:v1:a:b:c')).toThrow(/Unsupported/);
  });

  it('never leaks plaintext into the payload', () => {
    const payload = encrypt('hunter2-password', { keys: [KEY_A] });
    expect(payload).not.toContain('hunter2');
  });

  it('encryptNullable/decryptNullable handle empty and null values', () => {
    expect(encryptNullable(null)).toBeNull();
    expect(encryptNullable(undefined)).toBeNull();
    expect(encryptNullable('')).toBeNull();
    const enc = encryptNullable('key');
    expect(decryptNullable(enc)).toBe('key');
    expect(decryptNullable(null)).toBeNull();
  });
});
