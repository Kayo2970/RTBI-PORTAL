import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { saveBase64File } from '@/lib/file-storage';
import { fanOutAutoApproval } from '@/lib/approval-sync';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';

export const maxDuration = 60; // 60s execution limit for large uploads (up to 25 MB)

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export async function GET(request: Request) {
  try {
    await requireSession(request);
    const items = await readCollection('designs');
    return NextResponse.json(items);
  } catch (err: any) {
    return apiError(err, 'designs-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession(request); // any signed-in member may submit a design
    const item = await request.json();

    if (!item.title || !item.fileName || !item.fileSize) {
      return NextResponse.json({ error: 'Title, file name, and file size are required.' }, { status: 400 });
    }

    if (item.fileSize > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'File size exceeds the maximum limit of 25 MB.' },
        { status: 400 }
      );
    }

    const now = new Date();
    const submittedAt = item.submittedAt || now.toISOString();
    const expiresAt = item.expiresAt || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const id = item.id || 'des_' + Date.now();

    const newDesign = {
      ...item,
      id,
      submittedAt,
      expiresAt,
      isExpired: false,
    };

    // Persist the uploaded asset as a real file on disk under data/uploads/ instead
    // of keeping its full base64 payload inline in designs.json.
    if (typeof newDesign.fileData === 'string' && newDesign.fileData.startsWith('data:')) {
      const stored = await saveBase64File('designs', id, 0, newDesign.fileName, newDesign.fileData);
      newDesign.fileUrl = stored.url;
      newDesign.storageKey = stored.storageKey;
      delete newDesign.fileData;
    }

    const updated = await mutateCollection('designs', (current) => {
      const idx = current.findIndex((d: any) => d.id === newDesign.id);
      if (idx >= 0) {
        current[idx] = newDesign;
        return [...current];
      }
      return [newDesign, ...current];
    });

    const created = updated.find((d: any) => d.id === newDesign.id);

    // Fan-out an approval request to the default approvers (Approvals inbox + approval email).
    if (created) {
      try {
        await fanOutAutoApproval({
          entityType: 'design',
          entityId: created.id,
          entityTitle: created.title,
          eventId: created.eventId,
          requesterId: created.designerId || '',
          requesterName: created.designerName || 'A designer',
          requesterEmail: created.designerEmail,
          message: 'This design submission needs your review.',
        });
      } catch (approvalErr) {
        console.error('[designs-api] Approval fan-out failed:', approvalErr);
      }
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'designs-api-post', 500);
  }
}
