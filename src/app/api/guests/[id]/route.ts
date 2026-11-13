import { NextResponse } from 'next/server';
import { mutateCollection, readCollection } from '@/lib/server-db';
import { deleteStoredFile, deleteStoredFilesForRecord, saveBase64File } from '@/lib/file-storage';
import { requireSession, ForbiddenError } from '@/lib/session';
import { getAccessLevelSettingsServer, canEditGuestRecord, canRemoveGuestContact } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const { id } = await params;
    const settings = await getAccessLevelSettingsServer();
    const existingGuests = await readCollection<any>('guests');
    const existingGuest = existingGuests.find((g: any) => g.id === id);
    if (!canEditGuestRecord(existingGuest, actor, settings)) throw new ForbiddenError();
    const body = await request.json();

    let previousFrontStorageKey: string | undefined;
    let previousBackStorageKey: string | undefined;

    const frontData = body.visitingCardFrontData || body.visitingCardData;
    const frontFileName = body.visitingCardFrontFileName || body.visitingCardFileName || 'card_front.jpg';
    if (typeof frontData === 'string' && frontData.startsWith('data:')) {
      const approxSize = Math.ceil((frontData.length * 3) / 4);
      if (approxSize > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json({ error: 'Front visiting card image exceeds the 10 MB maximum limit.' }, { status: 400 });
      }
      const stored = await saveBase64File('guests', id, 0, frontFileName, frontData);
      body.visitingCardFrontUrl = stored.url;
      body.visitingCardFrontStorageKey = stored.storageKey;
      body.visitingCardUrl = stored.url;
      body.visitingCardStorageKey = stored.storageKey;
    }
    delete body.visitingCardData;
    delete body.visitingCardFileName;
    delete body.visitingCardFrontData;
    delete body.visitingCardFrontFileName;

    if (typeof body.visitingCardBackData === 'string' && body.visitingCardBackData.startsWith('data:')) {
      const approxSize = Math.ceil((body.visitingCardBackData.length * 3) / 4);
      if (approxSize > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json({ error: 'Back visiting card image exceeds the 10 MB maximum limit.' }, { status: 400 });
      }
      const stored = await saveBase64File('guests', id, 1, body.visitingCardBackFileName || 'card_back.jpg', body.visitingCardBackData);
      body.visitingCardBackUrl = stored.url;
      body.visitingCardBackStorageKey = stored.storageKey;
    }
    delete body.visitingCardBackData;
    delete body.visitingCardBackFileName;

    const updated = await mutateCollection('guests', (current) => {
      const idx = current.findIndex((g: any) => g.id === id);
      if (idx === -1) return [...current, { id, ...body }];
      const next = [...current];
      if (body.visitingCardFrontStorageKey && next[idx].visitingCardFrontStorageKey && next[idx].visitingCardFrontStorageKey !== body.visitingCardFrontStorageKey) {
        previousFrontStorageKey = next[idx].visitingCardFrontStorageKey;
      }
      if (body.visitingCardBackStorageKey && next[idx].visitingCardBackStorageKey && next[idx].visitingCardBackStorageKey !== body.visitingCardBackStorageKey) {
        previousBackStorageKey = next[idx].visitingCardBackStorageKey;
      }
      next[idx] = { ...next[idx], ...body };
      return next;
    });

    if (previousFrontStorageKey) {
      await deleteStoredFile(previousFrontStorageKey);
    }
    if (previousBackStorageKey) {
      await deleteStoredFile(previousBackStorageKey);
    }

    const target = updated.find((g: any) => g.id === id);
    return NextResponse.json(target);
  } catch (err: any) {
    return apiError(err, 'guests-id-api-patch', 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canRemoveGuestContact(actor, settings)) throw new ForbiddenError();
    const { id } = await params;
    let found = false;
    await mutateCollection('guests', (current) => {
      const filtered = current.filter((g: any) => g.id !== id);
      found = filtered.length < current.length;
      return filtered;
    });
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await deleteStoredFilesForRecord('guests', id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return apiError(err, 'guests-id-api-delete', 500);
  }
}
