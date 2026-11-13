import { NextResponse } from 'next/server';
import { saveBase64File } from '@/lib/file-storage';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';

export const maxDuration = 60; // 60s execution limit for large uploads

const MAX_ATTACHMENT_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per file
const MAX_ATTACHMENTS = 5;

/**
 * Uploads reference attachments for a design-brief task, independent of task
 * creation/editing itself — the Tasks page calls this first (awaited) so the
 * task record only ever gets real url/storageKey values, never inline base64.
 * `recordId` is a client-generated id (real once the task exists, or a
 * throwaway one at create time); `startIndex` lets a later call append more
 * files onto an existing task without overwriting earlier ones on disk.
 */
export async function POST(request: Request) {
  try {
    // Any signed-in member may attach a file to a task they're working with —
    // the underlying task's own edit permission already gates whether they
    // can touch that task in the first place elsewhere.
    await requireSession(request);
    const { recordId, files, startIndex } = await request.json();
    if (!recordId || typeof recordId !== 'string') {
      return NextResponse.json({ error: 'Missing recordId.' }, { status: 400 });
    }

    const list = Array.isArray(files) ? files : [];
    if (list.length === 0) {
      return NextResponse.json({ files: [] });
    }
    if (list.length > MAX_ATTACHMENTS) {
      return NextResponse.json({ error: `Maximum ${MAX_ATTACHMENTS} attachments allowed per task.` }, { status: 400 });
    }

    const base = typeof startIndex === 'number' && startIndex >= 0 ? startIndex : 0;
    const stored: { name: string; url: string; storageKey: string; type?: string }[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (typeof f?.dataUrl !== 'string' || !f.dataUrl.startsWith('data:')) continue;
      const approxBytes = Math.floor((f.dataUrl.length * 3) / 4);
      if (approxBytes > MAX_ATTACHMENT_FILE_BYTES) {
        return NextResponse.json(
          { error: `"${f.name || 'File'}" exceeds the 15 MB per-file limit.` },
          { status: 400 }
        );
      }
      const result = await saveBase64File('tasks', recordId, base + i, f.name || 'file', f.dataUrl);
      stored.push({ name: f.name || 'file', url: result.url, storageKey: result.storageKey, type: f.type });
    }

    return NextResponse.json({ files: stored }, { status: 201 });
  } catch (err: any) {
    return apiError(err, 'tasks-attachments-api-post', 400);
  }
}
