import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { createActivationTokenAndSendEmail } from '@/lib/account-activation';
import { requireSession } from '@/lib/session';
import { getAccessLevelSettingsServer, canAddMember } from '@/lib/permissions-server';
import { parseJsonBody, MemberWriteSchema } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

const MemberCreateSchema = MemberWriteSchema.extend({
  id: MemberWriteSchema.shape.id.unwrap(),
  name: MemberWriteSchema.shape.name.unwrap(),
  email: MemberWriteSchema.shape.email.unwrap(),
});

export async function GET(request: Request) {
  try {
    await requireSession(request);
    const members = await readCollection<any>('members');
    // passwordHash must never leave the server — this endpoint returned it to
    // any caller (and any caller at all, before the requireSession above).
    // Activation/reset badges on the client need to know whether a password
    // is set without ever seeing the hash itself.
    return NextResponse.json(members.map(({ passwordHash, ...safe }: any) => ({ ...safe, hasPassword: !!passwordHash })));
  } catch (err: any) {
    return apiError(err, 'members-api-get');
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canAddMember(actor, settings)) {
      return NextResponse.json({ error: "You don't have permission to add members." }, { status: 403 });
    }
    const member = await parseJsonBody(request, MemberCreateSchema);
    const newMemberPayload = {
      ...member,
      mustSetupPassword: true,
    };
    const updated = await mutateCollection('members', (current) => {
      if ((current || []).some((m: any) => m.email?.toLowerCase() === member.email?.toLowerCase())) {
        throw new Error(`Member with email ${member.email} already exists`);
      }
      return [...(current || []), newMemberPayload];
    });
    const created = updated.find((m: any) => m.id === member.id);

    let activationLink = '';
    let activationEmailSent = false;
    let activationEmailError: string | undefined;
    // A submission awaiting Centre Head sign-off (approvalStatus 'pending_create',
    // see local-data.ts's submitMemberCreate) can't log in yet, so the welcome
    // email is deliberately withheld until approveMemberCreate dispatches it.
    if (created && created.email && created.approvalStatus !== 'pending_create') {
      try {
        const host = request.headers.get('host');
        const proto = request.headers.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');
        const origin = request.headers.get('origin') || (host ? `${proto}://${host}` : undefined);

        const result = await createActivationTokenAndSendEmail({ id: created.id, name: created.name, email: created.email }, 'Super User', origin, request);
        activationLink = result.activationLink;
        activationEmailSent = result.emailSent;
        activationEmailError = result.emailError;
      } catch (emailErr) {
        console.error('[members-api] Welcome email dispatch failed:', emailErr);
        activationEmailError = emailErr instanceof Error ? emailErr.message : String(emailErr);
      }
    }

    return NextResponse.json({ ...created, activationLink, activationEmailSent, activationEmailError }, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'members-api-post', 400);
  }
}
