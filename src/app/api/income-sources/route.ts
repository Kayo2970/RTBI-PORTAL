import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { getAccessLevelSettingsServer, isCentreHead, isFinanceHead } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

async function canManageIncomeSources(actor: any) {
  const settings = await getAccessLevelSettingsServer();
  return isCentreHead(actor, settings) || isFinanceHead(actor, settings) || actor?.tier === 1;
}

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(await canManageIncomeSources(actor), 'You do not have permission to view income sources.');
    const items = await readCollection('incomeSources');
    return NextResponse.json(items);
  } catch (err: any) {
    return apiError(err, 'income-sources-api-get', 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(await canManageIncomeSources(actor), 'You do not have permission to add income sources.');

    const item = await request.json();
    if (!item.id || !item.name || typeof item.amount !== 'number') {
      return NextResponse.json({ error: 'id, name, and numeric amount are required.' }, { status: 400 });
    }

    const updated = await mutateCollection('incomeSources', (current) => {
      const idx = current.findIndex((i: any) => i.id === item.id);
      if (idx >= 0) {
        current[idx] = item;
        return [...current];
      }
      return [item, ...current];
    });

    const created = updated.find((i: any) => i.id === item.id);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'income-sources-api-post', 500);
  }
}
