/**
 * Scheduled pass emails (server only). "Preview & dispatch passes" can hand a batch to the server to be emailed at a
 * chosen time instead of right now, so it still goes out if the browser is closed. Each pass email is built and sent
 * exactly the way a live dispatch does it (same template, boarding-pass image attachment, universal 10-minute hold,
 * 'Email Sent' status on the pass). Checked every minute from instrumentation.ts.
 */
import { readCollection, mutateCollection } from '@/lib/server-db';
import { buildPassEmail, EventPassItem } from '@/lib/local-data';
import { dispatchEmail } from '@/lib/email-service';
import type { EmailBackgroundChoice } from '@/lib/email-background';
import { buildPassImageAttachment } from '@/lib/pass-email-send';
import { getAppBaseUrl } from '@/lib/app-url';

export interface PassEmailScheduleItem {
  passId: string;
  email: string;
  /** Per-person wording (the person's message was edited on its own); absent = the shared template. */
  subjectTemplate?: string;
  bodyTemplate?: string;
}

export interface PassEmailSchedule {
  id: string;
  items: PassEmailScheduleItem[];
  /** Shared wording and extra buttons chosen when scheduling. */
  template: { subjectTemplate?: string; bodyTemplate?: string; includeMap?: boolean; mapUrl?: string; includeWhatsapp?: boolean; whatsappUrl?: string };
  /** Blurred e-mail background chosen when scheduling (absent = the Email Settings default). */
  background?: EmailBackgroundChoice;
  sendAt: string;
  origin: string;
  eventNames: string[];
  createdBy: string;
  createdByEmail?: string;
  createdAt: string;
  status: 'Scheduled' | 'Running' | 'Done' | 'Failed' | 'Cancelled';
  sent?: number;
  failed?: number;
  skipped?: number;
  error?: string;
  finishedAt?: string;
}

async function sendOne(item: PassEmailScheduleItem, schedule: PassEmailSchedule): Promise<'sent' | 'skipped' | 'failed'> {
  const passes = await readCollection<EventPassItem>('event_passes');
  const pass = passes.find((p) => p.id === item.passId);
  // Deleted, cancelled or awaiting an approval decision since it was scheduled: leave it out.
  if (!pass || pass.status === 'Cancelled' || pass.approvalStatus) return 'skipped';
  try {
    // Schedules saved before the fix may carry a localhost origin; always link to the live site.
    const origin = getAppBaseUrl(null, schedule.origin);
    const { subject, bodyText, bodyHtml } = buildPassEmail(pass, origin, {
      ...schedule.template,
      ...(item.subjectTemplate !== undefined ? { subjectTemplate: item.subjectTemplate } : {}),
      ...(item.bodyTemplate !== undefined ? { bodyTemplate: item.bodyTemplate } : {}),
    });
    const built = await buildPassImageAttachment(pass, origin, bodyHtml);
    await dispatchEmail({
      to: item.email,
      subject,
      bodyText,
      bodyHtml: built.bodyHtml,
      category: 'EVENT_INVITATION',
      badgeText: 'Official Event Pass',
      badgeColor: '#0284c7',
      attachments: built.attachments,
      background: schedule.background,
    });
    const now = new Date().toISOString();
    await mutateCollection<EventPassItem>('event_passes', (cur = []) =>
      cur.map((p) => (p.id === pass.id ? { ...p, emailStatus: p.emailStatus === 'Pass Viewed' ? 'Pass Viewed' : 'Email Sent', emailSentAt: now } : p))
    );
    return 'sent';
  } catch (err) {
    console.error(`[pass-email-scheduler] Failed for pass ${item.passId}:`, err);
    return 'failed';
  }
}

export async function runDuePassEmailSchedules(now: Date = new Date()): Promise<number> {
  const claimed: PassEmailSchedule[] = [];
  await mutateCollection<PassEmailSchedule>('passEmailSchedules', (current = []) =>
    current.map((s) => {
      if (s.status === 'Scheduled' && new Date(s.sendAt).getTime() <= now.getTime()) {
        claimed.push(s);
        return { ...s, status: 'Running' as const };
      }
      return s;
    })
  );
  for (const s of claimed) {
    let patch: Partial<PassEmailSchedule>;
    try {
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      for (const item of s.items) {
        const r = await sendOne(item, s);
        if (r === 'sent') sent++;
        else if (r === 'failed') failed++;
        else skipped++;
        await new Promise((res) => setTimeout(res, 250)); // gentle pacing, like the live dispatch
      }
      patch = { status: 'Done', sent, failed, skipped };
    } catch (err: any) {
      patch = { status: 'Failed', error: err?.message || 'Failed to send.' };
    }
    await mutateCollection<PassEmailSchedule>('passEmailSchedules', (cur = []) =>
      cur.map((x) => (x.id === s.id ? { ...x, ...patch, finishedAt: new Date().toISOString() } : x))
    );
  }
  return claimed.length;
}

let timer: NodeJS.Timeout | null = null;

export function startPassEmailScheduler(): void {
  if (timer) return;
  const tick = () =>
    runDuePassEmailSchedules()
      .then((n) => n && console.log(`[pass-emails] ran ${n} scheduled send(s)`))
      .catch((err) => console.error('[pass-emails] scheduled send failed:', err));
  setTimeout(tick, 35_000);
  timer = setInterval(tick, 60_000);
  timer.unref?.();
}
