import { NextResponse } from 'next/server';
import { readStoredFile, guessMimeType } from '@/lib/file-storage';

// NOTE: intentionally NOT gated with requireSession. Every avatar/attachment
// across the app is rendered as a plain `<img src="/api/files/...">`
// (dashboard-shell.tsx, settings/page.tsx, ...), and a browser <img> tag
// cannot attach an Authorization header — gating this route the same way as
// the rest of the API would break every image in the live app. This route's
// only real protection is the unguessability of its storage keys (random,
// non-sequential). Properly closing this (a short-lived signed URL query
// param, or switching this one route to a session cookie) is a follow-up,
// not something to bolt on here without also reworking how these URLs are
// generated and rendered.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  try {
    const { key } = await params;
    const storageKey = key.join('/');
    // Attachments held for queued emails are private — never served over this public route.
    if (key[0] === 'email-attachments') return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    const buffer = await readStoredFile(storageKey);
    const fileName = key[key.length - 1]?.replace(/^\d+__/, '') || 'file';
    const download = new URL(request.url).searchParams.get('download') === '1';

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': guessMimeType(fileName),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  }
}
