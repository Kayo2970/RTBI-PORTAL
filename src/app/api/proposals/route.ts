import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { saveBase64File, deleteStoredFilesForRecord } from '@/lib/file-storage';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { fanOutAutoApproval, type ApprovalPanelMember } from '@/lib/approval-sync';
import { getAccessLevelSettingsServer, canApproveProposal } from '@/lib/permissions-server';
import { viewProposalAs, viewProposalsAs } from '@/lib/proposals-server';
import { MAX_PROPOSAL_FILES, MAX_PROPOSAL_FILE_BYTES, PROPOSAL_RECIPIENT_GROUPS, type ProposalItem } from '@/lib/proposals';
import type { Member } from '@/lib/local-data';

export const maxDuration = 60; // large attachment uploads

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const [items, members, settings] = await Promise.all([
      readCollection<ProposalItem>('proposals'),
      readCollection<Member>('members'),
      getAccessLevelSettingsServer(),
    ]);
    return NextResponse.json(viewProposalsAs(items, actor, members, settings));
  } catch (err: any) {
    return apiError(err, 'proposals-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    // Any signed-in member may write a proposal.
    const actor = await requireSession(request);
    const body = await request.json();

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!title || title.length > 200) return NextResponse.json({ error: 'A title (max 200 characters) is required.' }, { status: 400 });
    if (!text || text.length > 20000) return NextResponse.json({ error: 'The proposal text (max 20,000 characters) is required.' }, { status: 400 });

    const members = await readCollection<Member>('members');
    const activeIds = new Set(members.filter(m => m.status !== 'Terminated').map(m => m.id));
    const groups: string[] = (Array.isArray(body.recipients?.groups) ? body.recipients.groups : [])
      .filter((g: unknown): g is string => typeof g === 'string' && (PROPOSAL_RECIPIENT_GROUPS as readonly string[]).includes(g));
    const memberIds: string[] = (Array.isArray(body.recipients?.memberIds) ? body.recipients.memberIds : [])
      .filter((m: unknown): m is string => typeof m === 'string' && activeIds.has(m));
    if (groups.length === 0 && memberIds.length === 0) {
      return NextResponse.json({ error: 'Choose at least one recipient group or member.' }, { status: 400 });
    }

    const files = Array.isArray(body.attachments) ? body.attachments : [];
    if (files.length > MAX_PROPOSAL_FILES) {
      return NextResponse.json({ error: `Maximum ${MAX_PROPOSAL_FILES} attachments allowed per proposal.` }, { status: 400 });
    }
    for (const f of files) {
      if (typeof f?.dataUrl !== 'string' || !f.dataUrl.startsWith('data:')) {
        return NextResponse.json({ error: 'Invalid attachment.' }, { status: 400 });
      }
      if (Math.floor((f.dataUrl.length * 3) / 4) > MAX_PROPOSAL_FILE_BYTES) {
        return NextResponse.json({ error: `"${f.name || 'File'}" exceeds the 10 MB per-file limit.` }, { status: 400 });
      }
    }

    // Server-generated id and author — never trust the client for either.
    const id = 'prop_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const attachments = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const stored = await saveBase64File('proposals', id, i, String(f.name || 'file'), f.dataUrl);
        attachments.push({ name: String(f.name || 'file'), url: stored.url, storageKey: stored.storageKey, type: typeof f.type === 'string' ? f.type : undefined });
      }
    } catch (e) {
      await deleteStoredFilesForRecord('proposals', id);
      throw e;
    }

    const item: ProposalItem = {
      id,
      title,
      body: text,
      authorId: actor.id,
      authorName: actor.name,
      authorEmail: actor.email,
      createdAt: new Date().toISOString(),
      recipients: { groups, memberIds },
      attachments,
      status: 'Pending Approval',
      responses: [],
    };
    await mutateCollection('proposals', (current) => [item, ...current]);

    // Ask the authorised approvers (Centre Head, Advisors, department Heads) to review it.
    try {
      const settings = await getAccessLevelSettingsServer();
      const panel: ApprovalPanelMember[] = members
        .filter(m => m.status !== 'Terminated' && m.id !== actor.id && canApproveProposal(m as any, settings))
        .map(m => ({ id: m.id, name: m.name, email: m.email, label: 'Proposal Approver' }));
      await fanOutAutoApproval({
        entityType: 'proposal',
        entityId: id,
        entityTitle: title,
        requesterId: actor.id,
        requesterName: actor.name,
        requesterEmail: actor.email,
        message: 'A new proposal needs approval before it is shared with its recipients.',
        customPanel: panel,
      });
    } catch (approvalErr) {
      console.error('[proposals-api] Approval fan-out failed:', approvalErr);
    }

    const settings = await getAccessLevelSettingsServer();
    return NextResponse.json(viewProposalAs(item, actor, members, settings), { status: 201 });
  } catch (err: any) {
    return apiError(err, 'proposals-api-post', 400);
  }
}
