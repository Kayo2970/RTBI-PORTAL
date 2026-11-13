/**
 * account-activation.ts — server-only. Generates the "set up your account"
 * token sent when a member is first added to the Directory, and the
 * shared lookup used to consume it. Mirrors the passwordResets pattern in
 * forgot-password/reset-password (one dedicated collection, purge-then-
 * insert per email, expiry-checked on consume) — a long opaque token
 * instead of a short OTP, since this one is clicked from an email rather
 * than typed in, and given a much longer window (7 days, not 5 minutes)
 * since there's no urgency/security pressure like a password reset.
 */
import { randomBytes } from 'crypto';
import { mutateCollection } from './server-db';
import { dispatchEmail, generateWelcomeActivationEmailTemplate } from './email-service';
import { getAppBaseUrl } from './app-url';

const ACTIVATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// No APP_BASE_URL env var exists in this project yet (email CTAs elsewhere
// hardcode the same production domain) — matching that existing convention
// rather than introducing a new one for just this feature.
const APP_BASE_URL = 'https://leadsnextgencentre.online';

export interface ActivationToken {
  id: string;
  memberId: string;
  email: string;
  token: string;
  expiresAt: number;
  createdAt: string;
}

/**
 * Creates a fresh activation token for a member (purging any prior one for
 * the same member first, so only the most recently sent link works) and
 * emails them the "set up your account" link. Never throws on email
 * failure — the caller (member creation / resend routes) should already
 * be wrapping this in its own try/catch so a mail hiccup never blocks the
 * member record itself from being created.
 */
export async function createActivationTokenAndSendEmail(
  member: { id: string; name: string; email: string },
  actorName: string,
  originUrl?: string,
  req?: Request | null
) {
  const token = `act-${Date.now()}-${randomBytes(8).toString('hex')}`;
  const expiresAt = Date.now() + ACTIVATION_WINDOW_MS;

  const activationToken: ActivationToken = {
    // Random, not Date.now(): bulk adds create tokens in parallel within the same millisecond, and a shared id made
    // consuming one member's link delete the other members' tokens too.
    id: `token-${randomBytes(8).toString('hex')}`,
    memberId: member.id,
    email: member.email.toLowerCase(),
    token,
    expiresAt,
    createdAt: new Date().toISOString(),
  };

  // Earlier unexpired links for this member stay valid: a resend used to delete them, so the first (still-in-flight)
  // email's link was dead on arrival. Consuming any one link clears them all (see activate-account).
  await mutateCollection('accountActivations', (current) => {
    const live = (current || []).filter((t: any) => t.expiresAt > Date.now());
    return [activationToken, ...live];
  });

  const baseUrl = getAppBaseUrl(req, originUrl);
  const activationLink = `${baseUrl}/activate?token=${token}`;
  const template = generateWelcomeActivationEmailTemplate(member.name, activationLink);

  // dispatchEmail() never throws on an SMTP failure -- it logs the failure
  // into the emails collection and resolves normally either way, so its
  // return value is the only signal a caller has that the message didn't
  // actually go out. Ignoring it (as this used to) meant the admin was
  // always told "welcome email sent" even when delivery silently failed,
  // leaving the member with no way to ever see the activation link.
  const emailLog = await dispatchEmail({
    to: member.email,
    subject: template.subject,
    bodyText: template.bodyText,
    bodyHtml: template.bodyHtml,
    category: 'ACCOUNT_ACTIVATION',
    // Never sit in the 10-minute quiet buffer: people waited, hit "resend", and the delayed first email then arrived.
    immediate: true,
  });

  return { token, activationLink, emailSent: emailLog.status === 'SENT' || emailLog.status === 'BUFFERED', emailError: emailLog.errorMessage };
}
