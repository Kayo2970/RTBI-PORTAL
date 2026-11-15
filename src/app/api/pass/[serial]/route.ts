import { NextRequest, NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { EventPassItem } from '@/lib/local-data';
import { getPassTheme } from '@/lib/pass-theme';
import { lookupPassBySerial } from '@/lib/pass-lookup';
import { readCentreSocials } from '@/lib/centre-socials';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serial: string }> }
) {
  try {
    const { serial } = await params;
    if (!serial) {
      return NextResponse.json({ error: 'Serial is required' }, { status: 400 });
    }

    // 30+ days after the event: no personal data, no view tracking — just a thank-you payload
    const lookup = await lookupPassBySerial(serial);
    if (lookup?.archived) {
      return NextResponse.json({
        archived: true,
        eventName: lookup.pass.eventName,
        socials: await readCentreSocials(),
      });
    }

    const now = new Date().toISOString();
    let foundPass: EventPassItem | null = null;

    // Mutate and record "Pass Viewed" state as attendee visits public pass page
    await mutateCollection<EventPassItem>('event_passes', (current = []) => {
      const idx = current.findIndex(
        (p) =>
          p.serialNumber.toLowerCase() === serial.toLowerCase() ||
          p.id.toLowerCase() === serial.toLowerCase()
      );

      if (idx === -1) return current;

      const existing = current[idx];
      const updatedPass: EventPassItem = {
        ...existing,
        emailStatus: 'Pass Viewed',
        emailReceivedAt: existing.emailReceivedAt || now,
        passViewed: true,
        passViewedAt: existing.passViewedAt || now,
        lastPassViewedAt: now,
        passViewCount: (existing.passViewCount || 0) + 1,
      };

      foundPass = updatedPass;
      const copy = [...current];
      copy[idx] = updatedPass;
      return copy;
    });

    if (!foundPass) {
      // Fallback read in case mutation couldn't find it (rare race condition)
      const passes = await readCollection<EventPassItem>('event_passes');
      const matched = passes.find(
        (p) =>
          p.serialNumber.toLowerCase() === serial.toLowerCase() ||
          p.id.toLowerCase() === serial.toLowerCase()
      );
      if (!matched) {
        return NextResponse.json({ error: 'Event pass not found' }, { status: 404 });
      }
      foundPass = matched;
    }

    // Public endpoint: never expose the attendee's contact details or internal notes
    const { attendeeEmail, attendeePhone, notes, issuedByEmail, qrPayload, ...publicPass } =
      foundPass as EventPassItem;
    const finalPass = publicPass as EventPassItem;

    return NextResponse.json({
      pass: finalPass,
      theme: await getPassTheme(finalPass.eventId),
      status: finalPass.status,
      valid: finalPass.status !== 'Cancelled',
      emailStatus: finalPass.emailStatus,
      passViewed: finalPass.passViewed,
      passViewedAt: finalPass.passViewedAt,
    });
  } catch (err: any) {
    console.error('Error fetching public pass:', err);
    return NextResponse.json({ error: 'Internal error loading pass' }, { status: 500 });
  }
}
