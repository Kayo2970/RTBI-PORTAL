/** Renders + sends one event-pass email (boarding-pass PNG inline). Shared by /api/email/send and approved dispatch requests. */
import { dispatchEmail } from './email-service';
import { readCollection } from './server-db';
import { renderBoardingPassPng } from './pass-image';
import { getPassTheme } from './pass-theme';
import type { EventPassItem } from './local-data';
import { cleanBackgroundChoice } from './email-background';
import { getAppBaseUrl } from './app-url';

export interface PassEmailPayload {
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  passSerial: string;
  category?: string;
  badgeText?: string;
  badgeColor?: string;
  background?: unknown;
}

/**
 * Renders the pass image for inline attachment (one retry). If it still fails, the email's `cid:` reference is swapped
 * for the hosted image URL so the recipient never sees a broken picture.
 */
export async function buildPassImageAttachment(pass: EventPassItem, origin: string, bodyHtml?: string) {
  // Never let a localhost/loopback origin (dev browser, proxy-internal URL) reach a recipient: swap it for the live site URL.
  const liveOrigin = getAppBaseUrl(null, origin);
  if (bodyHtml) bodyHtml = bodyHtml.replace(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/gi, liveOrigin);
  origin = liveOrigin;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const png = await renderBoardingPassPng(pass, `${origin}/pass/${pass.serialNumber}`, await getPassTheme(pass.eventId));
      return { attachments: [{ filename: `${pass.serialNumber}.png`, content: png, contentType: 'image/png', cid: 'leads-pass-image' }], bodyHtml };
    } catch (err) {
      lastErr = err;
    }
  }
  console.warn('[pass-email] Boarding-pass image could not be rendered, using hosted image link:', lastErr);
  return {
    attachments: undefined,
    bodyHtml: bodyHtml?.split('cid:leads-pass-image').join(`${origin}/api/pass/${encodeURIComponent(pass.serialNumber)}/image`),
  };
}

export async function sendPassEmailFromPayload(p: PassEmailPayload | undefined, origin: string) {
  if (!p || !p.to || !p.subject || !p.bodyText) throw new Error('Pass email request is incomplete.');
  let attachments: { filename: string; content: Buffer; contentType: string; cid: string }[] | undefined;
  let bodyHtml = p.bodyHtml;
  try {
    const passes = await readCollection<EventPassItem>('event_passes');
    const pass = passes.find((x) => x.serialNumber.toLowerCase() === String(p.passSerial).toLowerCase());
    if (pass && pass.status !== 'Cancelled') {
      const built = await buildPassImageAttachment(pass, origin, bodyHtml);
      attachments = built.attachments;
      bodyHtml = built.bodyHtml;
    }
  } catch (err) {
    console.warn('[pass-email-send] Boarding-pass image skipped:', err);
  }
  return dispatchEmail({
    to: p.to,
    subject: p.subject,
    bodyText: p.bodyText,
    bodyHtml,
    badgeText: p.badgeText || 'Official Event Pass',
    badgeColor: p.badgeColor,
    category: (p.category as any) || 'EVENT_INVITATION',
    attachments,
    background: cleanBackgroundChoice(p.background),
  });
}
