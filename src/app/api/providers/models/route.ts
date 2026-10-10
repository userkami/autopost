import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { aiConnections } from '@/db/schema';
import { db } from '@/db';
import { getCurrentUser } from '@/lib/guards';
import { settings } from '@/lib/settings';
import { decryptConnection } from '@/lib/connections';
import { fetchModels } from '@/lib/providers/registry';
import { toProviderError } from '@/lib/providers/errors';
import { logger } from '@/lib/logger';

/**
 * GET /api/providers/models?connectionId=...&role=text|image
 * "Fetch models" (PLAN.md §8.6). Same-origin authenticated JSON route; the
 * connection is loaded scoped by user_id (PLAN.md §14.4) and the key is never
 * returned (§14.2).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get('connectionId') ?? '';
  const role = searchParams.get('role') === 'image' ? 'image' : 'text';

  const [row] = await db
    .select()
    .from(aiConnections)
    .where(and(eq(aiConnections.id, connectionId), eq(aiConnections.userId, user.id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

  try {
    const customEndpointsAllowed = await settings.get('custom_endpoints_allowed');
    const models = await fetchModels(decryptConnection(row), role, { customEndpointsAllowed });
    return NextResponse.json({ models });
  } catch (error) {
    const providerError = toProviderError(error, 'Could not fetch models');
    logger.warn({ provider: row.provider, kind: providerError.kind }, 'fetch models failed');
    return NextResponse.json({ error: providerError.message }, { status: 400 });
  }
}