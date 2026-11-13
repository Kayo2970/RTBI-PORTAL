import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { canManageBackup } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { buildStorageReport, deleteOrphans, deletePreRestoreSnapshots } from '@/lib/storage-report';

export const dynamic = 'force-dynamic';

/** GET: storage usage + orphan report (Super User only). */
export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!canManageBackup(actor)) {
      return NextResponse.json({ error: 'You do not have permission to view storage usage.' }, { status: 403 });
    }
    const report = await buildStorageReport();
    // Keep the payload small: top 200 orphans only
    return NextResponse.json({ ...report, orphans: report.orphans.slice(0, 200), orphanCount: report.orphans.length });
  } catch (err: any) {
    return apiError(err, 'admin-storage-get', 500);
  }
}

/** POST { action: 'delete-orphans' | 'delete-snapshots' } */
export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    if (!canManageBackup(actor)) {
      return NextResponse.json({ error: 'You do not have permission to clean up storage.' }, { status: 403 });
    }
    const { action } = await request.json();
    if (action === 'delete-orphans') return NextResponse.json(await deleteOrphans());
    if (action === 'delete-snapshots') return NextResponse.json({ deleted: await deletePreRestoreSnapshots() });
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    return apiError(err, 'admin-storage-post', 500);
  }
}
