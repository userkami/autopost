import { NextResponse } from 'next/server';
import { checkDatabase } from '@/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await checkDatabase();

  const body = {
    status: db.ok ? ('ok' as const) : ('degraded' as const),
    app: env.APP_NAME,
    version: '0.1.0',
    uptimeSeconds: Math.round(process.uptime()),
    db,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: db.ok ? 200 : 503 });
}
