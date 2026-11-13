import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { parseDataUrl, saveBase64File } from '@/lib/file-storage';
import { apiError } from '@/lib/api-error';
import { EMAIL_BACKGROUND_CATEGORY, clampBlur, getBlurredBackgroundPath, isEmailBackgroundKey } from '@/lib/email-background';

const MAX_BYTES = 6 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * POST { dataUrl } — stores a picture to use behind e-mails and returns its storage key (used by the Email Settings
 * default and by the per-send "custom picture" choice on the mail-merge screens).
 */
export async function POST(request: Request) {
  try {
    await requireSession(request);
    const { dataUrl } = await request.json();
    if (typeof dataUrl !== 'string') return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
    const { mime, buffer } = parseDataUrl(dataUrl);
    const ext = EXT[mime];
    if (!ext) return NextResponse.json({ error: 'Please upload a JPG, PNG or WebP image.' }, { status: 400 });
    if (buffer.length === 0 || buffer.length > MAX_BYTES) return NextResponse.json({ error: 'Image must be under 6 MB.' }, { status: 400 });
    const recordId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const stored = await saveBase64File(EMAIL_BACKGROUND_CATEGORY, recordId, 0, `background.${ext}`, dataUrl);
    return NextResponse.json({ storageKey: stored.storageKey });
  } catch (err: any) {
    return apiError(err, 'email-background-upload', 500);
  }
}

/** GET ?key=email-backgrounds/…&blur=12 — the blurred picture as it will appear in the e-mail (for the live preview). */
export async function GET(request: Request) {
  try {
    await requireSession(request);
    const params = new URL(request.url).searchParams;
    const key = params.get('key') || '';
    if (!isEmailBackgroundKey(key)) return NextResponse.json({ error: 'Unknown picture.' }, { status: 400 });
    const path = await getBlurredBackgroundPath(key, clampBlur(params.get('blur')));
    if (!path) return NextResponse.json({ error: 'Could not prepare the picture.' }, { status: 500 });
    return NextResponse.json({ url: path });
  } catch (err: any) {
    return apiError(err, 'email-background-preview', 500);
  }
}
