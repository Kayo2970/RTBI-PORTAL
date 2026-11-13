import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { hashPassword } from '@/lib/password';
import { parseJsonBody } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

const ActivateAccountSchema = z.object({
  token: z.string().trim().min(1).max(256),
  newPassword: z.string().min(4).max(256),
  dateOfBirth: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth is not in a valid format.')]).optional(),
  phone: z.string().trim().min(7, 'Enter a valid mobile number.').max(32),
}).strict();

/** Validates an activation token and returns who it belongs to, without consuming it — lets the /activate page greet the member by name before they submit a password. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ valid: false, error: 'No activation token provided.' }, { status: 400 });
  }

  const activations = await readCollection('accountActivations');
  const matched = activations.find((a: any) => a.token === token);

  if (!matched) {
    return NextResponse.json({ valid: false, error: 'This activation link is invalid. It may have already been used — try signing in, or ask an admin to resend it.' }, { status: 404 });
  }

  if (Date.now() > matched.expiresAt) {
    return NextResponse.json({ valid: false, error: 'This activation link has expired. Ask an admin to resend it.' }, { status: 410 });
  }

  const members = await readCollection('members');
  const member = members.find((m: any) => m.id === matched.memberId);
  if (!member) {
    return NextResponse.json({ valid: false, error: 'The account this link belongs to no longer exists.' }, { status: 404 });
  }

  return NextResponse.json({
    valid: true,
    name: member.name,
    email: member.email,
    role: member.role,
    division: member.division,
    cardSlug: member.cardSlug,
  });
}

/** Consumes an activation token — sets the member's first real password and deletes the token. */
export async function POST(request: Request) {
  try {
    const { token, newPassword, dateOfBirth, phone } = await parseJsonBody(request, ActivateAccountSchema);

    const activations = await readCollection('accountActivations');
    const matched = activations.find((a: any) => a.token === token);
    if (!matched) {
      return NextResponse.json({ error: 'This activation link is invalid or has already been used.' }, { status: 404 });
    }
    if (Date.now() > matched.expiresAt) {
      return NextResponse.json({ error: 'This activation link has expired. Ask an admin to resend it.' }, { status: 410 });
    }

    let memberName = 'User';
    let memberFound = false;
    let activatedMember: any = null;
    await mutateCollection('members', (current) =>
      (current || []).map((m: any) => {
        if (m.id === matched.memberId) {
          memberFound = true;
          memberName = m.name;
          const slug = m.cardSlug || m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          activatedMember = {
            ...m,
            passwordHash: hashPassword(newPassword),
            mustSetupPassword: false,
            ...(dateOfBirth ? { dateOfBirth } : {}),
            phone,
            cardPhone: m.cardPhone || phone,
            cardSlug: slug,
            cardEnabled: true,
          };
          return activatedMember;
        }
        return m;
      })
    );

    if (!memberFound) {
      return NextResponse.json({ error: 'The account this link belongs to no longer exists.' }, { status: 404 });
    }

    await mutateCollection('accountActivations', (current) => (current || []).filter((a: any) => a.memberId !== matched.memberId));

    await mutateCollection('auditLogs', (current) => [
      {
        id: `audit-${Date.now()}`,
        action: 'ACCOUNT_ACTIVATED',
        user: memberName,
        details: `${memberName} activated their account and set a password.`,
        timestamp: new Date().toISOString(),
      },
      ...(current || []),
    ]);

    return NextResponse.json({
      success: true,
      message: 'Account activated! You can now sign in with your new password.',
      member: {
        id: activatedMember?.id,
        name: activatedMember?.name,
        email: activatedMember?.email,
        role: activatedMember?.role,
        phone: activatedMember?.phone,
        cardSlug: activatedMember?.cardSlug,
        tier: activatedMember?.tier,
      },
    });
  } catch (err: any) {
    return apiError(err, 'activate-account-api');
  }
}
