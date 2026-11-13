import { NextResponse } from 'next/server';
import { requireSession, ForbiddenError } from '@/lib/session';
import { gateFormAction } from '@/lib/approval-gate';
import { saveBase64File, parseDataUrl } from '@/lib/file-storage';
import { apiError } from '@/lib/api-error';

const MAX_BYTES = 6 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Stores a public-form header / background picture on disk and returns its servable /api/files URL. */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const gate = await gateFormAction(actor, 'EDIT');
    if (!gate.allowed) throw new ForbiddenError();
    const { dataUrl, kind } = await request.json();
    if (typeof dataUrl !== 'string' || (kind !== 'header' && kind !== 'background')) {
      return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
    }
    const { mime, buffer } = parseDataUrl(dataUrl);
    const ext = EXT[mime];
    if (!ext) return NextResponse.json({ error: 'Please upload a JPG, PNG, WebP or GIF image.' }, { status: 400 });
    if (buffer.length === 0 || buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be under 6 MB.' }, { status: 400 });
    }
    const recordId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const stored = await saveBase64File('form-images', recordId, 0, `${kind}.${ext}`, dataUrl);
    return NextResponse.json({ url: stored.url });
  } catch (err: any) {
    return apiError(err, 'forms-image-upload', 500);
  }
}
