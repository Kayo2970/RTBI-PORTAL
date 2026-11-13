import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { gateCertificateAction } from '@/lib/approval-gate';
import { listCustomFonts, saveUploadedFont, importGoogleFont, deleteCustomFont } from '@/lib/certificate-fonts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function authorise(request: Request, action: 'view' | 'design') {
  const user = await requireSession(request);
  const gate = await gateCertificateAction(user, action);
  if (!gate.allowed || gate.requiresApproval) return NextResponse.json({ error: "You don't have permission to manage certificate fonts." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try {
    const denied = await authorise(request, 'view');
    if (denied) return denied;
    return NextResponse.json({ fonts: await listCustomFonts() });
  } catch (err) {
    return apiError(err, 'certificate-fonts:list');
  }
}

/** Body: { name, dataUrl } to upload a font file, or { googleUrl } to import from Google Fonts. */
export async function POST(request: Request) {
  try {
    const denied = await authorise(request, 'design');
    if (denied) return denied;
    const body = await request.json();
    let id: string;
    if (typeof body.googleUrl === 'string' && body.googleUrl.trim()) id = await importGoogleFont(body.googleUrl);
    else if (typeof body.dataUrl === 'string') id = await saveUploadedFont(String(body.name || ''), body.dataUrl);
    else return NextResponse.json({ error: 'Upload a font file or paste a Google Fonts link.' }, { status: 400 });
    return NextResponse.json({ id, fonts: await listCustomFonts() });
  } catch (err: any) {
    if (/font|Google|Give the/i.test(err?.message || '')) return NextResponse.json({ error: err.message }, { status: 400 });
    return apiError(err, 'certificate-fonts:add');
  }
}

export async function DELETE(request: Request) {
  try {
    const denied = await authorise(request, 'design');
    if (denied) return denied;
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return NextResponse.json({ error: 'Invalid font.' }, { status: 400 });
    await deleteCustomFont(id);
    return NextResponse.json({ fonts: await listCustomFonts() });
  } catch (err) {
    return apiError(err, 'certificate-fonts:delete');
  }
}
