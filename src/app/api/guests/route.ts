import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { saveBase64File } from '@/lib/file-storage';
import { requireSession, ForbiddenError } from '@/lib/session';
import { getAccessLevelSettingsServer, canAccessGuestDirectory } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function GET(request: Request) {
  try {
    await requireSession(request);
    const guests = await readCollection('guests');
    return NextResponse.json(guests);
  } catch (err: any) {
    return apiError(err, 'guests-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canAccessGuestDirectory(actor, settings)) throw new ForbiddenError();
    const guest = await request.json();

    if (!guest.name || !guest.id) {
      return NextResponse.json({ error: 'Guest name and id are required.' }, { status: 400 });
    }

    // Handle legacy visitingCardData or new visitingCardFrontData (front of card)
    const frontData = guest.visitingCardFrontData || guest.visitingCardData;
    const frontFileName = guest.visitingCardFrontFileName || guest.visitingCardFileName || 'card_front.jpg';
    if (typeof frontData === 'string' && frontData.startsWith('data:')) {
      const approxSize = Math.ceil((frontData.length * 3) / 4);
      if (approxSize > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json({ error: 'Front visiting card image exceeds the 10 MB maximum limit.' }, { status: 400 });
      }
      const stored = await saveBase64File('guests', guest.id, 0, frontFileName, frontData);
      guest.visitingCardFrontUrl = stored.url;
      guest.visitingCardFrontStorageKey = stored.storageKey;
      guest.visitingCardUrl = stored.url;
      guest.visitingCardStorageKey = stored.storageKey;
    }
    delete guest.visitingCardData;
    delete guest.visitingCardFileName;
    delete guest.visitingCardFrontData;
    delete guest.visitingCardFrontFileName;

    // Handle back of card image (optional)
    if (typeof guest.visitingCardBackData === 'string' && guest.visitingCardBackData.startsWith('data:')) {
      const approxSize = Math.ceil((guest.visitingCardBackData.length * 3) / 4);
      if (approxSize > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json({ error: 'Back visiting card image exceeds the 10 MB maximum limit.' }, { status: 400 });
      }
      const stored = await saveBase64File('guests', guest.id, 1, guest.visitingCardBackFileName || 'card_back.jpg', guest.visitingCardBackData);
      guest.visitingCardBackUrl = stored.url;
      guest.visitingCardBackStorageKey = stored.storageKey;
    }
    delete guest.visitingCardBackData;
    delete guest.visitingCardBackFileName;

    const updated = await mutateCollection('guests', (current) => {
      const idx = current.findIndex((g: any) => g.id === guest.id);
      if (idx >= 0) {
        current[idx] = guest;
        return [...current];
      }
      return [guest, ...current];
    });

    const created = updated.find((g: any) => g.id === guest.id);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'guests-api-post', 500);
  }
}
