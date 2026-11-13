import { NextResponse } from 'next/server';
import { readCollection } from '@/lib/server-db';
import { EmailLog, sweepExpiredBufferedEmails } from '@/lib/email-service';
import { requireSession } from '@/lib/session';
import { getAccessLevelSettingsServer, canManageEmailSettings } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// With a large history, reading + decrypting + sorting the whole collection on
// every request (every "Load more", every keystroke in search) is the slow
// part. Keep the sorted, slimmed rows for a few seconds; `fresh=1` bypasses it.
type SlimLog = Omit<EmailLog, 'bodyHtml'>;
const CACHE_TTL_MS = 5000;
let cache: { at: number; rows: SlimLog[]; counts: { total: number; sent: number; buffered: number; failed: number } } | null = null;
let lastSweepAt = 0;
const SWEEP_EVERY_MS = 15000;

async function loadRows(fresh: boolean) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  const all = (await readCollection<EmailLog>('emails')) || [];
  const counts = { total: all.length, sent: 0, buffered: 0, failed: 0 };
  for (const l of all) {
    if (l.status === 'SENT') counts.sent++;
    else if (l.status === 'BUFFERED') counts.buffered++;
    else if (l.status === 'FAILED') counts.failed++;
  }
  // bodyHtml is the heaviest field and the list/inspect UI only uses bodyText.
  const rows: SlimLog[] = all
    .map(({ bodyHtml: _bodyHtml, ...rest }) => rest)
    .sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));
  cache = { at: Date.now(), rows, counts };
  return cache;
}

// Paginated: returns one page of logs (newest first) with the filters applied
// server-side, so the browser never has to download or render the full history.
// Query: ?limit=50&offset=0&status=ALL|SENT|FAILED|BUFFERED|CANCELLED&category=ALL|<cat>&q=<text>
export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    const settings = await getAccessLevelSettingsServer();
    if (!canManageEmailSettings(actor, settings)) {
      return NextResponse.json({ error: 'You do not have permission to view email logs.' }, { status: 403 });
    }
    // Dispatching matured buffered emails must never delay or break the log
    // list, so it runs in the background (the 30s sweeper also covers it).
    if (Date.now() - lastSweepAt > SWEEP_EVERY_MS) {
      lastSweepAt = Date.now();
      sweepExpiredBufferedEmails().catch(() => {});
    }

    const params = new URL(request.url).searchParams;
    const limit = Math.min(Math.max(parseInt(params.get('limit') || '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(parseInt(params.get('offset') || '', 10) || 0, 0);
    const status = params.get('status') || 'ALL';
    const category = params.get('category') || 'ALL';
    const q = (params.get('q') || '').trim().toLowerCase();
    const fresh = params.get('fresh') === '1';

    const { rows, counts } = await loadRows(fresh);

    const matched = rows.filter(l => {
      if (status !== 'ALL' && l.status !== status) return false;
      if (category !== 'ALL' && l.category !== category) return false;
      return !q
        || (l.to || '').toLowerCase().includes(q)
        || (l.subject || '').toLowerCase().includes(q)
        || (l.category || '').toLowerCase().includes(q);
    });

    const logs = matched.slice(offset, offset + limit);

    return NextResponse.json({
      logs,
      total: matched.length,
      hasMore: offset + logs.length < matched.length,
      counts,
    });
  } catch (err: any) {
    return apiError(err, 'email-logs-api-get', 500);
  }
}
