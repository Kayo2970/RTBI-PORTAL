import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { EventPassItem, mergeAttendance } from '@/lib/local-data';
import { getAppBaseUrl } from '@/lib/app-url';
import { syncEditedWalletPass, WalletSyncAction } from '@/lib/wallet/pass-cache';
import { isPassArchived, PASS_RETENTION_DAYS } from '@/lib/pass-retention';
import { gateEventPassAction } from '@/lib/approval-gate';
import { markPassPending, submitPassApproval, PASS_SYSTEM_KEYS } from '@/lib/event-pass-approvals';

/** Edits to these fields change what the wallet pass shows; check-ins, email tracking etc. must not touch the wallet. */
const WALLET_RELEVANT_KEYS = new Set([
  'attendeeName', 'attendeeOrg', 'guestCategory', 'passType', 'roomOrVenue', 'eventId', 'eventName', 'eventDate', 'eventVenue',
  'validDays', 'validityDate', 'passColor', 'passGradient', 'textColor', 'labelColor', 'fontScale', 'showEventTitle',
  'qrFormat', 'qrAltText', 'qrDark', 'qrLight', 'qrEyeColor', 'qrShape', 'qrLogo', 'qrInWallet',
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession(request);
    const { id } = await params;
    const passes = await readCollection<EventPassItem>('event_passes');
    if (id && id !== 'all') {
      return NextResponse.json(passes.filter((p) => p.eventId === id));
    }
    return NextResponse.json(passes);
  } catch (err: any) {
    return apiError(err, 'event-passes-get', 500);
  }
}

/** Creates a pass. Never sends email — dispatch is always an explicit, separate action. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionUser = await requireSession(request);
    const { id: eventId } = await params;
    const item: EventPassItem = await request.json();

    if (!item.attendeeName || !item.passType) {
      return NextResponse.json({ error: 'Attendee name and pass type are required' }, { status: 400 });
    }

    // Chain of command: decided here from the stored Group Policies, never from what the browser claims.
    const gate = await gateEventPassAction(sessionUser, 'issue');
    if (!gate.allowed) {
      return NextResponse.json({ error: "You don't have permission to issue event passes." }, { status: 403 });
    }
    // Never trust approval bookkeeping fields coming from the client
    delete (item as any).approvalStatus; delete (item as any).pendingChanges;
    delete (item as any).submittedBy; delete (item as any).submittedByEmail;
    delete (item as any).approvalPolicyName; delete (item as any).approverName;
    if (gate.requiresApproval) {
      item.approvalStatus = 'pending_create';
      item.submittedBy = sessionUser.name;
      item.submittedByEmail = sessionUser.email;
      item.approvalPolicyName = gate.policyName;
      item.approverName = gate.approverName;
    }

    await mutateCollection<EventPassItem>('event_passes', (current = []) => {
      const idx = current.findIndex((p) => p.id === item.id || p.serialNumber === item.serialNumber);
      if (idx >= 0) {
        const copy = [...current];
        copy[idx] = item;
        return copy;
      }
      return [item, ...current];
    });

    if (gate.requiresApproval) {
      await submitPassApproval({
        action: 'issue',
        pass: item,
        actor: sessionUser,
        gate,
        message: `${sessionUser.name} wants to issue a ${item.passType} pass to ${item.attendeeName} for ${item.eventName}. The pass is held back until you approve${gate.policyName ? ` (policy: ${gate.policyName})` : ''}.`,
      });
    }

    return NextResponse.json(item, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'event-passes-post', 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionUser = await requireSession(request);
    const body = await request.json();
    const { passId, id, serialNumber, ...updates } = body;
    const targetId = passId || id || serialNumber;

    if (!targetId) {
      return NextResponse.json({ error: 'passId is required' }, { status: 400 });
    }

    // Approval bookkeeping is server-owned
    for (const k of ['approvalStatus', 'pendingChanges', 'submittedBy', 'submittedByEmail', 'approvalPolicyName', 'approverName']) delete (updates as any)[k];

    // Only real edits are gated; scanner check-ins, email tracking and wallet bookkeeping stay open to their own flows.
    const editKeys = Object.keys(updates).filter((k) => !PASS_SYSTEM_KEYS.has(k));
    if (editKeys.length > 0) {
      const gate = await gateEventPassAction(sessionUser, 'edit');
      if (!gate.allowed) {
        return NextResponse.json({ error: "You don't have permission to edit event passes." }, { status: 403 });
      }
      if (gate.requiresApproval) {
        const existing = (await readCollection<EventPassItem>('event_passes')).find((p) => p.id === targetId || p.serialNumber === targetId);
        if (!existing) return NextResponse.json({ error: 'Pass not found' }, { status: 404 });
        if (existing.approvalStatus) {
          return NextResponse.json({ error: 'This pass already has a change waiting for approval.' }, { status: 409 });
        }
        const changes: Record<string, unknown> = {};
        for (const k of editKeys) changes[k] = (updates as any)[k];
        const pending = await markPassPending(existing.id, 'pending_edit', sessionUser, gate, changes);
        await submitPassApproval({
          action: 'edit',
          pass: existing,
          actor: sessionUser,
          gate,
          message: `${sessionUser.name} wants to change ${existing.attendeeName}'s pass (${editKeys.join(', ')}). Nothing changes until you approve${gate.policyName ? ` (policy: ${gate.policyName})` : ''}.`,
          payload: { fields: editKeys },
        });
        return NextResponse.json({ ...(pending || existing), approvalPending: true, walletUpdated: false, walletAction: 'none' });
      }
    }

    let updatedPass: EventPassItem | null = null;
    await mutateCollection<EventPassItem>('event_passes', (current = []) => {
      const idx = current.findIndex((p) => p.id === targetId || p.serialNumber === targetId);
      if (idx === -1) return current;
      const copy = [...current];
      const existing = copy[idx];

      const newStatus = updates.status || existing.status;
      const now = new Date().toISOString();

      const merged: EventPassItem = {
        ...existing,
        ...updates,
        status: newStatus,
        // Merge per-day attendance instead of overwriting so concurrent scanners can't clobber each other
        ...(Array.isArray(updates.attendance)
          ? { attendance: mergeAttendance(existing.attendance, updates.attendance) }
          : {}),
        ...(newStatus === 'Checked In' && existing.status !== 'Checked In'
          ? {
              checkedInAt: updates.checkedInAt || now,
              checkedInBy: updates.checkedInBy || sessionUser.name,
            }
          : {}),
      };

      // A null in the update means "clear this optional field"
      for (const [k, v] of Object.entries(updates)) {
        if (v === null) delete (merged as unknown as Record<string, unknown>)[k];
      }

      // Re-generate QR verification payload if key attributes changed
      if (
        updates.attendeeName !== undefined ||
        updates.passType !== undefined ||
        updates.eventId !== undefined
      ) {
        merged.qrPayload = JSON.stringify({
          passId: merged.id,
          serial: merged.serialNumber,
          eventId: merged.eventId,
          attendee: merged.attendeeName,
          type: merged.passType,
          issuedAt: merged.issuedAt,
        });
      }

      copy[idx] = merged;
      updatedPass = merged;
      return copy;
    });

    if (!updatedPass) {
      return NextResponse.json({ error: 'Pass not found' }, { status: 404 });
    }

    // Keep the wallet copy in step: re-issue if no guest has taken it yet, otherwise update it in place
    let walletUpdated = false;
    let walletNotice: string | undefined;
    let walletAction: WalletSyncAction = 'none';
    const target = updatedPass as EventPassItem | null;
    if (target && Object.keys(updates).some((k) => WALLET_RELEVANT_KEYS.has(k))) {
      const sync = await syncEditedWalletPass(target.id, getAppBaseUrl(request));
      walletAction = sync.action;
      walletUpdated = sync.action !== 'none';
      walletNotice = sync.error;
    }

    return NextResponse.json({
      ...(updatedPass as any),
      walletUpdated,
      walletAction,
      walletNotice,
    });
  } catch (err: any) {
    return apiError(err, 'event-passes-patch', 500);
  }
}

/** Verify QR Token / Serial lookup */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession(request);
    const { query } = await request.json(); // query can be raw QR payload string or serialNumber
    if (!query) {
      return NextResponse.json({ error: 'Verification query is required' }, { status: 400 });
    }

    let parsedPayload: any = null;
    try {
      parsedPayload = JSON.parse(query);
    } catch {
      // not json, treat as plain serial string
    }

    let rawTarget = parsedPayload?.serial || query.trim();
    // If a full pass URL slipped through unparsed (e.g. https://.../pass/LEADS-EVT-XXXX),
    // fall back to extracting the serial from the URL server-side too.
    if (/^https?:\/\//i.test(rawTarget)) {
      try {
        const url = new URL(rawTarget);
        const queryParam = url.searchParams.get('pass');
        if (queryParam) {
          rawTarget = decodeURIComponent(queryParam);
        } else {
          const segments = url.pathname.split('/').filter(Boolean);
          const passIndex = segments.indexOf('pass');
          const serialSegment = passIndex !== -1 ? segments[passIndex + 1] : segments[segments.length - 1];
          if (serialSegment) rawTarget = decodeURIComponent(serialSegment);
        }
      } catch {
        // leave rawTarget as-is
      }
    }
    const targetSerial = rawTarget;
    const targetPassId = parsedPayload?.passId;

    const passes = await readCollection<EventPassItem>('event_passes');
    const matched = passes.find(
      (p) =>
        (targetPassId && p.id === targetPassId) ||
        p.serialNumber.toLowerCase() === targetSerial.toLowerCase() ||
        (parsedPayload?.attendee &&
          p.attendeeName.toLowerCase() === parsedPayload.attendee.toLowerCase() &&
          p.eventId === parsedPayload.eventId)
    );

    if (!matched) {
      return NextResponse.json(
        {
          valid: false,
          reason: 'Pass not found or invalid QR signature.',
        },
        { status: 404 }
      );
    }

    const eventRows = await readCollection<any>('events');
    if (isPassArchived(matched, eventRows.find((e: any) => e.id === matched.eventId))) {
      return NextResponse.json(
        { valid: false, reason: `This pass expired ${PASS_RETENTION_DAYS} days after the event.` },
        { status: 410 }
      );
    }

    return NextResponse.json({
      valid: true,
      pass: matched,
      status: matched.status,
      isAlreadyCheckedIn: (matched.attendance || []).length > 0,
      isCancelled: matched.status === 'Cancelled',
      attendance: matched.attendance || [],
    });
  } catch (err: any) {
    return apiError(err, 'event-passes-verify', 500);
  }
}
