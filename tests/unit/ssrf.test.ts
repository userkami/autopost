import { describe, expect, it } from 'vitest';
import { assertPublicIp, assertSafeHttpUrl, resolvePublicHost } from '@/lib/ssrf';

/**
 * SSRF guard tests (PLAN.md §14.3, §17 Phase 2 acceptance).
 * Table of hostile inputs plus scheme/credential/direct-IP cases.
 */
describe('ssrf guard (PLAN.md §14.3)', () => {
  const hostileIps = [
    '127.0.0.1',
    '127.1',
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1', // CGNAT
    '169.254.169.254', // cloud metadata
    '224.0.0.1', // multicast
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:10.0.0.1', // IPv4-mapped private
  ];

  it.each(hostileIps)('rejects hostile IP %s', (ip) => {
    expect(() => assertPublicIp(ip)).toThrow();
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])(
    'allows public IP %s',
    (ip) => {
      expect(() => assertPublicIp(ip)).not.toThrow();
    },
  );

  it('rejects non-http(s) and credentialed URLs', async () => {
    await expect(assertSafeHttpUrl('ftp://example.com/file')).rejects.toThrow(/HTTPS/i);
    await expect(assertSafeHttpUrl('http://example.com')).rejects.toThrow(/HTTPS/i);
    await expect(assertSafeHttpUrl('https://user:pass@example.com')).rejects.toThrow(/credentials/i);
    await expect(assertSafeHttpUrl('not a url')).rejects.toThrow(/Invalid URL/i);
  });

  it('rejects direct IP URL hosts and resolves hostname lists', async () => {
    await expect(resolvePublicHost('127.0.0.1')).rejects.toThrow();
    await expect(resolvePublicHost('169.254.169.254')).rejects.toThrow();
    await expect(assertSafeHttpUrl('https://127.0.0.1/admin')).rejects.toThrow();
  });

  it('rejects bracketed IPv6 loopback', async () => {
    await expect(assertSafeHttpUrl('https://[::1]/')).rejects.toThrow();
  });
});