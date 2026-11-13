import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { purgeMemberArtifacts } from '@/lib/cascade-delete';
import { createActivationTokenAndSendEmail } from '@/lib/account-activation';
import { requireSession, invalidateAllSessionsForMember } from '@/lib/session';
import { getAccessLevelSettingsServer, canAddMember, canEditDirectory, canTerminateMember } from '@/lib/permissions-server';
import { isRootSuperUser, countActiveSuperUsersServer, PRIVILEGED_FIELDS } from '@/lib/member-guard';
import { apiError } from '@/lib/api-error';

/**
 * Bulk member create/update/delete — one read-modify-write of members.json
 * per call instead of one per row. The CSV roster importer and the
 * Directory page's bulk-edit/bulk-delete tools used to loop a single-record
 * request per member: importing 100 people meant 100 sequential HTTP round
 * trips, 100 full rewrites of members.json, and (for create) 100 sequential
 * activation-email sends. These endpoints do the write once; only the
 * per-member activation emails on create still go out individually (email
 * delivery is inherently per-recipient), but now in parallel rather than
 * blocking each other.
 */

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canAddMember(actor, settings)) {
      return NextResponse.json({ error: "You don't have permission to add members." }, { status: 403 });
    }
    const body = await request.json();
    const incoming: any[] = Array.isArray(body?.members) ? body.members : [];
    if (incoming.length === 0) {
      return NextResponse.json({ error: 'No members provided.' }, { status: 400 });
    }

    const skipped: { email: string; reason: string }[] = [];
    const createdIds: string[] = [];

    const updated = await mutateCollection('members', (current) => {
      const seenEmails = new Set((current || []).map((m: any) => (m.email || '').toLowerCase()));
      const next = [...(current || [])];
      for (const member of incoming) {
        const email = (member.email || '').toLowerCase();
        if (!email || !member.name) {
          skipped.push({ email: member.email || '(missing)', reason: 'Missing name or email.' });
          continue;
        }
        if (seenEmails.has(email)) {
          skipped.push({ email: member.email, reason: 'Email already exists.' });
          continue;
        }
        seenEmails.add(email);
        const payload = { ...member, mustSetupPassword: true };
        next.push(payload);
        createdIds.push(payload.id);
      }
      return next;
    });

    const createdMembers = updated.filter((m: any) => createdIds.includes(m.id));

    // Dispatch activation emails in parallel rather than one at a time — a
    // failure on one member's email must not affect (or wait on) anyone
    // else's. Same withholding rule as the single-create route: a
    // pending_create submission gets no welcome email until it's approved.
    const host = request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');
    const origin = request.headers.get('origin') || (host ? `${proto}://${host}` : undefined);

    const activationResults = await Promise.all(
      createdMembers.map(async (created: any) => {
        if (!created.email || created.approvalStatus === 'pending_create') {
          return { id: created.id, activationEmailSent: false };
        }
        try {
          const result = await createActivationTokenAndSendEmail({ id: created.id, name: created.name, email: created.email }, 'Super User', origin, request);
          return { id: created.id, activationLink: result.activationLink, activationEmailSent: result.emailSent, activationEmailError: result.emailError };
        } catch (emailErr) {
          console.error(`[members-bulk-api] Welcome email dispatch failed for ${created.email}:`, emailErr);
          return { id: created.id, activationEmailSent: false, activationEmailError: emailErr instanceof Error ? emailErr.message : String(emailErr) };
        }
      })
    );
    const activationById = new Map(activationResults.map(r => [r.id, r]));

    return NextResponse.json({
      created: createdMembers.map((m: any) => ({ ...m, ...activationById.get(m.id) })),
      skipped,
    }, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'members-bulk-api-post', 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireSession(request);
    const body = await request.json();
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    const updates = body?.updates && typeof body.updates === 'object' ? { ...body.updates } : {};
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No member ids provided.' }, { status: 400 });
    }
    delete updates.passwordHash; // never settable through this route

    const settings = await getAccessLevelSettingsServer();
    const hasDirectoryEdit = canEditDirectory(actor, settings);
    const touchesPrivilegedField = PRIVILEGED_FIELDS.some(f => f in updates);
    if (touchesPrivilegedField && !hasDirectoryEdit) {
      return NextResponse.json({ error: "You don't have permission to change a member's tier, role, status, or department." }, { status: 403 });
    }
    if (!touchesPrivilegedField && !hasDirectoryEdit) {
      return NextResponse.json({ error: "You don't have permission to bulk-edit member records." }, { status: 403 });
    }
    if (updates.status === 'Terminated' && !canTerminateMember(actor, settings)) {
      return NextResponse.json({ error: "You don't have permission to terminate members." }, { status: 403 });
    }

    const idSet = new Set(ids);
    const updated = await mutateCollection('members', (current) => {
      const next = current.map((m: any) => {
        if (!idSet.has(m.id)) return m;
        const merged = { ...m, ...updates };
        // Invariant: The root Super User always remains a Super User (tier 1, Active)
        if (isRootSuperUser(m) || isRootSuperUser(merged)) {
          merged.tier = 1;
          if (merged.status === 'Terminated') merged.status = 'Active';
        }
        return merged;
      });
      if (countActiveSuperUsersServer(next) < 1) {
        throw new Error('Action blocked: System must always maintain at least one active Super User .');
      }
      return next;
    });

    if (updates.status === 'Terminated') {
      await Promise.all(ids.map(id => invalidateAllSessionsForMember(id)));
    }

    return NextResponse.json(updated.filter((m: any) => idSet.has(m.id)));
  } catch (err: any) {
    return apiError(err, 'members-bulk-api-patch', 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canEditDirectory(actor, settings)) {
      return NextResponse.json({ error: "You don't have permission to delete members." }, { status: 403 });
    }
    const body = await request.json();
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No member ids provided.' }, { status: 400 });
    }

    const idSet = new Set(ids);
    let deletedIds: string[] = [];
    const deletedEmails = new Map<string, string | undefined>();
    await mutateCollection('members', (current) => {
      // The root Super User is always protected from bulk delete — never bypassable
      // via this endpoint (the single-record route's `force` escape hatch is
      // deliberately not offered here).
      const toDelete = new Set(Array.from(idSet).filter(id => {
        const target = current.find((m: any) => m.id === id);
        return target && !isRootSuperUser(target);
      }));
      const filtered = current.filter((m: any) => !toDelete.has(m.id));
      if (countActiveSuperUsersServer(filtered) < 1) {
        throw new Error('Action blocked: System must always maintain at least one active Super User .');
      }
      deletedIds = Array.from(toDelete);
      current.forEach((m: any) => { if (toDelete.has(m.id)) deletedEmails.set(m.id, m.email); });
      return filtered;
    });

    await Promise.all(deletedIds.map(id => invalidateAllSessionsForMember(id)));
    for (const id of deletedIds) await purgeMemberArtifacts(id, deletedEmails.get(id));

    return NextResponse.json({ success: true, deletedIds });
  } catch (err: any) {
    return apiError(err, 'members-bulk-api-delete', 500);
  }
}
