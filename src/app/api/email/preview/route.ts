import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { buildEmailHtml, type EmailCategory } from '@/lib/email-service';
import { cleanBackgroundChoice } from '@/lib/email-background';

const CATEGORIES = new Set<EmailCategory>(['CERTIFICATE', 'DIRECT_MESSAGE', 'ANNOUNCEMENT', 'GUEST_INVITE', 'EVENT_PASS', 'EVENT_INVITATION', 'SYSTEM']);

/**
 * POST { subject, bodyText, bodyHtml?, category?, badgeText?, badgeColor?, background? } → { html }
 * (`bodyHtml` = an e-mail that brings its own HTML, like an event-pass invitation; it is returned with the background applied.)
 * The finished e-mail exactly as it would be sent (same builder as dispatchEmail), so a send dialog can show a real
 * preview — including the blurred background — before anything goes out. Nothing is sent or stored.
 */
export async function POST(request: Request) {
  try {
    await requireSession(request);
    const body = await request.json();
    const subject = typeof body.subject === 'string' ? body.subject.slice(0, 300) : '';
    const bodyText = typeof body.bodyText === 'string' ? body.bodyText.slice(0, 20000) : '';
    const bodyHtml = typeof body.bodyHtml === 'string' && body.bodyHtml.length <= 600_000 ? body.bodyHtml : undefined;
    const category: EmailCategory = CATEGORIES.has(body.category) ? body.category : 'DIRECT_MESSAGE';
    const html = await buildEmailHtml({
      to: 'preview@example.com',
      subject,
      bodyText,
      bodyHtml,
      category,
      badgeText: typeof body.badgeText === 'string' ? body.badgeText.slice(0, 80) : undefined,
      badgeColor: typeof body.badgeColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(body.badgeColor) ? body.badgeColor : undefined,
      background: cleanBackgroundChoice(body.background),
    });
    return NextResponse.json({ html });
  } catch (err: any) {
    return apiError(err, 'email-preview', 500);
  }
}
