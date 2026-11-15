import { NextRequest, NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { EventPassItem } from '@/lib/local-data';

export const dynamic = 'force-dynamic';

// 1x1 transparent GIF (43 bytes)
const TRANSPARENT_1X1_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  try {
    const { serial } = await params;
    if (serial) {
      const now = new Date().toISOString();
      await mutateCollection<EventPassItem>('event_passes', (current = []) => {
        const idx = current.findIndex(
          (p) =>
            p.serialNumber.toLowerCase() === serial.toLowerCase() ||
            p.id.toLowerCase() === serial.toLowerCase()
        );
        if (idx === -1) return current;

        const existing = current[idx];
        // Only advance to 'Email Received' if not already marked 'Pass Viewed'
        if (existing.emailStatus !== 'Pass Viewed') {
          const copy = [...current];
          copy[idx] = {
            ...existing,
            emailStatus: 'Email Received',
            emailReceivedAt: existing.emailReceivedAt || now,
          };
          return copy;
        }
        return current;
      });
    }
  } catch (err) {
    console.error('[pass-track-pixel] Failed to record email received event:', err);
  }

  // Always return transparent GIF so email client renders without any broken image placeholder
  return new NextResponse(TRANSPARENT_1X1_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRANSPARENT_1X1_GIF.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
