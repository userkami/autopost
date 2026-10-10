import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request, type Dispatcher } from 'undici';
import { ProviderError, providerErrorFromStatus, toProviderError } from './providers/errors';

const PRIVATE_V4_RANGES: Array<[number, number]> = [
  [ip4ToInt('0.0.0.0'), ip4ToInt('0.255.255.255')],
  [ip4ToInt('10.0.0.0'), ip4ToInt('10.255.255.255')],
  [ip4ToInt('100.64.0.0'), ip4ToInt('100.127.255.255')], // CGNAT (RFC 6598)
  [ip4ToInt('127.0.0.0'), ip4ToInt('127.255.255.255')],
  [ip4ToInt('169.254.0.0'), ip4ToInt('169.254.255.255')], // link-local incl. 169.254.169.254
  [ip4ToInt('172.16.0.0'), ip4ToInt('172.31.255.255')],
  [ip4ToInt('192.168.0.0'), ip4ToInt('192.168.255.255')],
  [ip4ToInt('224.0.0.0'), ip4ToInt('255.255.255.255')],
];

function ip4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const value = ip4ToInt(ip);
  return PRIVATE_V4_RANGES.some(([start, end]) => value >= start && value <= end);
}

/**
 * Reject IPv6 loopback, unspecified, unique-local (fc00::/7), link-local
 * (fe80::/10), multicast (ff00::/8), and — critically — IPv4-mapped/embedded
 * addresses (::ffff:a.b.c.d, ::a.b.c.d) whose IPv4 part is private, since those
 * bypass a naive IPv4 check.
 */
function isBlockedV6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::1' || normalized === '::') return true;
  const firstGroup = normalized.split(':')[0] ?? '';
  if (/^f[cd]/.test(firstGroup)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(firstGroup)) return true; // fe80::/10 link-local
  if (/^ff/.test(firstGroup)) return true; // ff00::/8 multicast

  // IPv4-mapped (::ffff:1.2.3.4) or IPv4-compatible (::1.2.3.4) forms.
  const mapped = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) {
    return isIP(mapped[1]) === 4 ? isPrivateV4(mapped[1]) : true;
  }
  return false;
}

export function assertPublicIp(ip: string): void {
  const family = isIP(ip);
  if (family === 0) throw new ProviderError('bad_request', 'Resolved address is not a valid IP address');
  if (family === 4 && isPrivateV4(ip)) throw new ProviderError('bad_request', 'URL resolves to a private network address');
  if (family === 6 && isBlockedV6(ip)) throw new ProviderError('bad_request', 'URL resolves to a private network address');
}

export async function resolvePublicHost(hostname: string): Promise<string[]> {
  const direct = isIP(hostname);
  const addresses = direct ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: false });
  const ips = addresses.map((entry) => entry.address);
  if (ips.length === 0) throw new ProviderError('bad_request', 'URL host did not resolve');
  ips.forEach(assertPublicIp);
  return ips;
}

export async function assertSafeHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ProviderError('bad_request', 'Invalid URL');
  }
  if (url.protocol !== 'https:') throw new ProviderError('bad_request', 'Only HTTPS URLs are allowed');
  if (url.username || url.password) throw new ProviderError('bad_request', 'URL credentials are not allowed');
  await resolvePublicHost(url.hostname);
  return url;
}

export type SafeFetchOptions = {
  method?: Dispatcher.HttpMethod;
  headers?: Record<string, string>;
  body?: Dispatcher.RequestOptions['body'];
  signal?: AbortSignal;
  maxBytes?: number;
};

/**
 * SSRF-safe HTTP helper for user-supplied URLs: validate scheme and resolved
 * IPs before every request, disable redirects, and cap response size.
 */
export async function safeFetchBuffer(input: string, opts: SafeFetchOptions = {}): Promise<{ bytes: Buffer; headers: Headers; status: number }> {
  const url = await assertSafeHttpUrl(input);
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  try {
    const response = await request(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      signal: opts.signal,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) throw providerErrorFromStatus(response.statusCode);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) throw new ProviderError('bad_request', 'Downloaded content exceeded the size limit');
      chunks.push(buffer);
    }
    return { bytes: Buffer.concat(chunks), headers: new Headers(response.headers as HeadersInit), status: response.statusCode };
  } catch (error) {
    throw toProviderError(error, 'HTTP request failed');
  }
}