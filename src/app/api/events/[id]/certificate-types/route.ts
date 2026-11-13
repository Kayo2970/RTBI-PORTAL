import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { gateCertificateAction } from '@/lib/approval-gate';
import { createCertificateType, deleteCertificateType, getCertificateTypes, renameCertificateType } from '@/lib/certificate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function authorise(request: Request, action: 'view' | 'design') {
  const user = await requireSession(request);
  const gate = await gateCertificateAction(user, action);
  if (!gate.allowed || gate.requiresApproval) {
    return { error: NextResponse.json({ error: "You don't have permission to change certificate types." }, { status: 403 }) };
  }
  return { user };
}

const userError = (err: any) => (/^(Give|That|An event|The default|Certificates of|Certificate type)/.test(err?.message || '') ? NextResponse.json({ error: err.message }, { status: 400 }) : null);

/** The certificate types (designs) this event has; the default one always exists. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorise(request, 'view');
    if (auth.error) return auth.error;
    const { id } = await params;
    return NextResponse.json({ types: await getCertificateTypes(id) });
  } catch (err) {
    return apiError(err, 'certificate-types:get');
  }
}

/** Body: { name, copyFrom? } — adds a type, optionally starting from another type's design. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorise(request, 'design');
    if (auth.error) return auth.error;
    const { id } = await params;
    const body = await request.json();
    const types = await createCertificateType(id, body.name, typeof body.copyFrom === 'string' ? body.copyFrom : null);
    return NextResponse.json({ types, created: types[types.length - 1] });
  } catch (err) {
    return userError(err) || apiError(err, 'certificate-types:create');
  }
}

/** Body: { typeId, name } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorise(request, 'design');
    if (auth.error) return auth.error;
    const { id } = await params;
    const body = await request.json();
    return NextResponse.json({ types: await renameCertificateType(id, String(body.typeId || ''), body.name) });
  } catch (err) {
    return userError(err) || apiError(err, 'certificate-types:rename');
  }
}

/** ?typeId=… — refused for the default type and for types that already have certificates. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorise(request, 'design');
    if (auth.error) return auth.error;
    const { id } = await params;
    return NextResponse.json({ types: await deleteCertificateType(id, new URL(request.url).searchParams.get('typeId') || '') });
  } catch (err) {
    return userError(err) || apiError(err, 'certificate-types:delete');
  }
}
