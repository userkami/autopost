import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loginLimiter, testConnectionLimiter, bloggerConnectLimiter } from '@/lib/ratelimit';

/**
 * Rate limit middleware for API routes (PLAN.md §14.7).
 * In-memory limiters — sufficient for single VPS.
 */

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
}

function rateLimitResponse(limit: string, remaining: string, resetMs: number) {
  const res = new NextResponse(null, { status: 429 });
  res.headers.set('X-RateLimit-Limit', limit);
  res.headers.set('X-RateLimit-Remaining', remaining);
  res.headers.set('X-RateLimit-Reset', String(resetMs));
  res.headers.set('Retry-After', Math.ceil((resetMs - Date.now()) / 1000).toString());
  return res;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = getClientIp(request);

  // Auth endpoints
  if (pathname.startsWith('/api/auth/')) {
    const key = `login:${ip}`;
    if (!loginLimiter.check(key)) {
      return rateLimitResponse('10', '0', Date.now() + 60_000);
    }
    const res = NextResponse.next();
    res.headers.set('X-RateLimit-Limit', '10');
    res.headers.set('X-RateLimit-Remaining', '9');
    return res;
  }

  // Blogger connect/callback
  if (pathname.startsWith('/api/blogger/')) {
    const key = `blogger:${ip}`;
    if (!bloggerConnectLimiter.check(key)) {
      return rateLimitResponse('10', '0', Date.now() + 60_000);
    }
    const res = NextResponse.next();
    res.headers.set('X-RateLimit-Limit', '10');
    res.headers.set('X-RateLimit-Remaining', '9');
    return res;
  }

  // Provider test endpoints
  if (pathname.startsWith('/api/connections/test')) {
    const key = `test:${ip}`;
    if (!testConnectionLimiter.check(key)) {
      return rateLimitResponse('10', '0', Date.now() + 60_000);
    }
    const res = NextResponse.next();
    res.headers.set('X-RateLimit-Limit', '10');
    res.headers.set('X-RateLimit-Remaining', '9');
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/auth/:path*', '/api/blogger/:path*', '/api/connections/test'],
};