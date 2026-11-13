import { NextResponse } from 'next/server';
import { performCardOcr } from '@/lib/visiting-card-ocr';
import { parseDataUrl } from '@/lib/file-storage';
import { requireSession, ForbiddenError } from '@/lib/session';
import { getAccessLevelSettingsServer, canAccessGuestDirectory } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

export const maxDuration = 60; // 60 seconds Next.js route execution timeout

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canAccessGuestDirectory(actor, settings)) throw new ForbiddenError();
    const body = await request.json();

    if (!body.frontData || typeof body.frontData !== 'string') {
      return NextResponse.json({ error: 'Front card photo is required for OCR scanning.' }, { status: 400 });
    }

    const { buffer: frontBuffer } = parseDataUrl(body.frontData);
    if (!frontBuffer || frontBuffer.length === 0) {
      return NextResponse.json({ error: 'Front card photo data is empty or invalid.' }, { status: 400 });
    }
    if (frontBuffer.length > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: 'Front card image exceeds the 10 MB maximum limit.' }, { status: 400 });
    }

    let backBuffer: Buffer | undefined;
    if (body.backData && typeof body.backData === 'string' && body.backData.length > 0) {
      const { buffer: bBuffer } = parseDataUrl(body.backData);
      if (bBuffer && bBuffer.length > 0 && bBuffer.length <= MAX_FILE_SIZE_BYTES) {
        backBuffer = bBuffer;
      }
    }

    const extracted = await performCardOcr(frontBuffer, backBuffer);
    return NextResponse.json(extracted);
  } catch (err: any) {
    return apiError(err, 'guests-ocr-api-post', 500);
  }
}
