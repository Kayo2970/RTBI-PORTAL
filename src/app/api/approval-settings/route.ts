import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession } from '@/lib/session';
import { isSuperUser } from '@/lib/permissions-server';
import { getDefaultApproverIds } from '@/lib/approval-sync';
import { parseJsonBody } from '@/lib/validation';
import { apiError } from '@/lib/api-error';

/**
 * Who automatic approval requests go to. A Super User picks the default approvers here (Approvals module);
 * with nobody picked, requests go to every CEO and Super User (see lib/approval-sync.ts resolveApprovalPanel).
 */
async function staffCandidates() {
  const members = await readCollection<any>('members');
  return members
    .filter((m: any) => m.status !== 'Terminated' && m.email && typeof m.tier === 'number' && m.tier <= 3)
    .map((m: any) => ({ id: m.id, name: m.name, role: m.role || '', tier: m.tier }));
}

export async function GET(request: Request) {
  try {
    await requireSession(request);
    const [approverIds, candidates] = await Promise.all([getDefaultApproverIds(), staffCandidates()]);
    const valid = new Set(candidates.map((c) => c.id));
    return NextResponse.json({ approverIds: approverIds.filter((id) => valid.has(id)), candidates });
  } catch (err: any) {
    return apiError(err, 'approval-settings-get', 500);
  }
}

const Schema = z.object({ approverIds: z.array(z.string().max(128)).max(100) }).strict();

export async function PUT(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!isSuperUser(actor)) {
      return NextResponse.json({ error: 'Only a Super User can choose the default approvers.' }, { status: 403 });
    }
    const { approverIds } = await parseJsonBody(request, Schema);
    const valid = new Set((await staffCandidates()).map((c) => c.id));
    const clean = Array.from(new Set(approverIds.filter((id) => valid.has(id))));
    await mutateCollection('approvalSettings', () => [{ id: 'default', approverIds: clean, updatedAt: new Date().toISOString(), updatedBy: actor.name }]);
    return NextResponse.json({ approverIds: clean });
  } catch (err: any) {
    return apiError(err, 'approval-settings-put', 500);
  }
}
