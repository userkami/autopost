import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { blogConnections, blogs, users } from '@/db/schema';
import { db } from '@/db';
import { getCurrentUser } from '@/lib/guards';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const [userData, blogsData, connectionsData] = await Promise.all([
    db.select().from(users).where(eq(users.id, user.id)).limit(1),
    db.select().from(blogs).where(eq(blogs.userId, user.id)),
    db.select().from(blogConnections).where(eq(blogConnections.userId, user.id)),
  ]);

  const exportData = {
    user: userData[0] ? { ...userData[0], password: undefined } : null,
    blogs: blogsData,
    blogConnections: connectionsData.map(c => ({ ...c, refreshTokenEnc: undefined })),
    exportedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(exportData, null, 2);

  return new NextResponse(json, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="autoblog-export.json"',
    },
  });
}