import { NextResponse } from 'next/server';
import { invalidateSession } from '@/lib/session';

/**
 * Real server-side sign-out: deletes the session row so the token stops
 * being accepted by any route immediately, not just in the tab that clicked
 * Sign Out. Previously logout only cleared the client's localStorage — the
 * server had no notion of a session at all, so a copied/stolen token stayed
 * live indefinitely.
 */
export async function POST(request: Request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  const token = match ? match[1].trim() : null;
  await invalidateSession(token);
  return NextResponse.json({ success: true });
}
