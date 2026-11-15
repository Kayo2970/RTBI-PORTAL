import { NextRequest, NextResponse } from 'next/server';
import { getWalletWalletApiKey } from '@/lib/wallet/walletwallet-config';
import { updateEventPassPushNotification } from '@/lib/wallet/walletwallet-client';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { EventPassItem } from '@/lib/local-data';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession(request);
    const { id: eventId } = await params;
    const body = await request.json();
    const { message, passIds, guestCategory, targetType } = body;

    if (!message || !message.trim()) {
      return NextResponse.json({ error: 'Broadcast message cannot be empty' }, { status: 400 });
    }

    const apiKey = await getWalletWalletApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'WalletWallet API key not configured on this server.' },
        { status: 503 }
      );
    }

    const allPasses = await readCollection<EventPassItem>('event_passes');
    const eventPasses = allPasses.filter((p) => p.eventId === eventId);

    let targetPasses: EventPassItem[] = [];

    if (targetType === 'single' && passIds && passIds.length > 0) {
      targetPasses = eventPasses.filter((p) => passIds.includes(p.id) || passIds.includes(p.serialNumber));
    } else if (targetType === 'category' && guestCategory) {
      targetPasses = eventPasses.filter(
        (p) => (p.guestCategory || '').toLowerCase() === guestCategory.toLowerCase()
      );
    } else {
      // Default: broadcast to all active event passes
      targetPasses = eventPasses.filter((p) => p.status === 'Active');
    }

    if (targetPasses.length === 0) {
      return NextResponse.json(
        { error: 'No matching passes found to broadcast push update to.' },
        { status: 404 }
      );
    }

    const results = {
      total: targetPasses.length,
      successful: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const pass of targetPasses) {
      try {
        const serial = pass.walletSerialNumber;
        if (!serial) {
          // Never added to a wallet — nothing to push to
          results.total -= 1;
          continue;
        }
        await updateEventPassPushNotification(
          apiKey,
          serial,
          message.trim(),
          pass.roomOrVenue ? { roomOrVenue: pass.roomOrVenue } : undefined
        );
        results.successful += 1;
      } catch (err: any) {
        results.failed += 1;
        results.errors.push(`${pass.attendeeName} (${pass.serialNumber || pass.id}): ${err.message || 'Push failed'}`);
      }
    }


    return NextResponse.json({
      success: true,
      message: `Push broadcast completed: ${results.successful}/${results.total} passes notified.`,
      results,
    });
  } catch (error: any) {
    console.error('Error broadcasting push notification:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to dispatch push notification broadcast.' },
      { status: 500 }
    );
  }
}
