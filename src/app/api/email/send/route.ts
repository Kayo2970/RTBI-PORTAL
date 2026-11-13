import { NextResponse } from 'next/server';
import { dispatchEmail, SendEmailPayload } from '@/lib/email-service';
import { readCollection } from '@/lib/server-db';
import { Member } from '@/lib/local-data';
import { requireSession } from '@/lib/session';
import { apiError } from '@/lib/api-error';
import { cleanBackgroundChoice } from '@/lib/email-background';

/**
 * Client-supplied attachments arrive as base64 (JSON has no Buffer type) —
 * decode here into the Buffer shape dispatchEmail/nodemailer expect. 
 */
function decodeAttachments(
  raw: unknown
): SendEmailPayload['attachments'] {
  if (!Array.isArray(raw)) return undefined;
  const decoded = raw
    .filter((a) => a && typeof a === 'object' && typeof a.filename === 'string' && typeof a.contentBase64 === 'string')
    .map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.contentBase64, 'base64'),
      contentType: typeof a.contentType === 'string' ? a.contentType : undefined,
    }));
  return decoded.length > 0 ? decoded : undefined;
}

// This route is used by real app features beyond the admin Email Management
// panel (e.g. member-termination notices from Directory, guest-invite
// mail-merge sends), so it is gated with requireSession only — any signed-in
// member may dispatch mail through it. The specific workflows that call it
// each already enforce their own permission check before reaching here
// (e.g. canTerminateMember, canManageGuestInvites); the admin Email
// Management page itself is a normal authenticated feature too.
export async function POST(request: Request) {
  try {
    const sessionUser = await requireSession(request);
    const body = await request.json();
    const {
      scope,
      recipientEmail,
      to,
      subject,
      bodyText,
      bodyHtml: bodyHtmlIn,
      body: rawBody,
      content,
      category,
      badgeText,
      badgeColor,
      attachments: rawAttachments,
      background: rawBackground,
    } = body;
    let bodyHtml = bodyHtmlIn;
    const background = cleanBackgroundChoice(rawBackground);

    const attachments = decodeAttachments(rawAttachments) || [];

    const emailTo = recipientEmail || to;
    const finalSubject = subject;
    const textContent = bodyText || rawBody || content;

    if (!finalSubject || !textContent) {
      return NextResponse.json({ error: 'Subject and email content are required' }, { status: 400 });
    }

    // 1. Single recipient dispatch (explicit SINGLE, or to/recipientEmail passed directly)
    if (scope === 'SINGLE' || (!scope && emailTo) || (scope !== 'ALL' && scope !== 'All Members' && emailTo)) {
      if (!emailTo) {
        return NextResponse.json({ error: 'Recipient email address is required' }, { status: 400 });
      }
      const log = await dispatchEmail({
        to: emailTo,
        subject: finalSubject,
        bodyText: textContent,
        bodyHtml,
        badgeText: badgeText || (category === 'EVENT_INVITATION' || category === 'EVENT_PASS' ? 'Official Event Pass' : undefined),
        badgeColor,
        category: category || (category === 'EVENT_INVITATION' || category === 'EVENT_PASS' ? category : 'DIRECT_MESSAGE'),
        attachments: attachments.length > 0 ? attachments : undefined,
        background,
      });
      return NextResponse.json({ count: 1, dispatched: [log] });
    }

    // 2. Scope broadcast dispatch
    const members = await readCollection<Member>('members');
    let targetMembers = members || [];

    if (scope !== 'ALL' && scope !== 'All Members') {
      targetMembers = targetMembers.filter(m => m.division === scope || m.role === scope);
    }

    const recipientEmails = Array.from(new Set(targetMembers.map(m => m.email).filter(Boolean)));
    if (recipientEmails.length === 0) {
      return NextResponse.json({ error: 'No members found matching the selected target scope' }, { status: 404 });
    }

    const dispatchedLogs = [];
    for (const email of recipientEmails) {
      const log = await dispatchEmail({
        to: email,
        subject,
        bodyText,
        bodyHtml,
        badgeText,
        badgeColor,
        category: category || 'ANNOUNCEMENT',
        attachments: attachments.length > 0 ? attachments : undefined,
        background,
      });
      dispatchedLogs.push(log);
    }

    return NextResponse.json({ count: dispatchedLogs.length, dispatched: dispatchedLogs });
  } catch (err: any) {
    return apiError(err, 'email-send-api-post', 500);
  }
}
