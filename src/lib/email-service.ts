import nodemailer, { Transporter } from 'nodemailer';
import path from 'path';
import crypto from 'crypto';
import { mutateCollection, readCollection } from './server-db';
import { saveBase64File, readStoredFile, deleteStoredFilesForRecord } from './file-storage';
import { DirectSendTransport } from './direct-smtp-transport';
import { getAppBaseUrl } from './app-url';
import { applyEmailBackground, resolveEmailBackgroundUrl, type EmailBackgroundChoice, type EmailBackgroundSetting } from './email-background';
import { CAPABILITY_CATALOG, MODULE_CATALOG } from './permissions';

// Referenced as cid:rtbi-logo in wrapInMasterEmailTemplate — attach this
// to every sendMail() call so the header logo is embedded, not fetched
// from a remote URL.
const EMAIL_LOGO_ATTACHMENT = {
  filename: 'rtbi-logo.png',
  path: path.join(process.cwd(), 'src', 'assets', 'rtbi-email-logo.png'),
  cid: 'rtbi-logo',
};

export type EmailCategory =
  | 'AUTH_OTP'
  | 'ANNOUNCEMENT'
  | 'TASK_ASSIGNMENT'
  | 'TASK_DEADLINE_REMINDER'
  | 'SYSTEM'
  | 'DIRECT_MESSAGE'
  | 'GUEST_INVITE'
  | 'ACCOUNT_ACTIVATION'
  | 'BIRTHDAY'
  | 'DESIGN_APPROVAL'
  | 'APPROVAL_REQUEST'
  | 'EVENT_PASS'
  | 'EVENT_INVITATION'
  | 'GROUP_POLICY_GRANT'
  | 'PROPOSAL'
  | 'CERTIFICATE';

/**
 * Automatic-email switches (Super User, Email Management → Settings). Only emails the portal fires BY ITSELF are
 * switchable here. Security / account emails (sign-in codes, activation links) and anything a person explicitly
 * sends (direct messages, passes, certificates, test mails) are never blocked, so nobody gets locked out and a
 * deliberate "send" always sends.
 */
export interface AutoEmailType {
  key: EmailCategory;
  label: string;
  description: string;
  defaultEnabled: boolean;
}
export const AUTO_EMAIL_TYPES: AutoEmailType[] = [
  { key: 'TASK_ASSIGNMENT', label: 'Task assignments', description: 'Sent to the assignee when a task is created or reassigned.', defaultEnabled: true },
  { key: 'TASK_DEADLINE_REMINDER', label: 'Task deadline reminders', description: 'Daily reminder to assignees of tasks due tomorrow.', defaultEnabled: true },
  { key: 'APPROVAL_REQUEST', label: 'Approval requests & decisions', description: 'Sent to the people you ask for approval, and back to the requester with the decision.', defaultEnabled: true },
  { key: 'GROUP_POLICY_GRANT', label: 'Group policy access grants', description: 'Sent to members when a Super User gives them access through a group policy.', defaultEnabled: true },
  { key: 'ANNOUNCEMENT', label: 'Announcements', description: 'Sent to the audience of an approved announcement.', defaultEnabled: true },
  { key: 'PROPOSAL', label: 'Proposals', description: 'Sent to the person a proposal is addressed to, and back to the proposer with the reply.', defaultEnabled: true },
  { key: 'BIRTHDAY', label: 'Birthday greetings', description: 'Daily greeting to members whose birthday it is.', defaultEnabled: true },
  { key: 'DESIGN_APPROVAL', label: 'Design decisions', description: 'Sent to designers when their design is approved or rejected.', defaultEnabled: false },
];

export interface EmailPolicy {
  id: 'default';
  /** Pause every switchable automatic email at once. */
  paused: boolean;
  /** Per-type override of AUTO_EMAIL_TYPES[].defaultEnabled. */
  overrides: Record<string, boolean>;
  updatedAt?: string;
  updatedBy?: string;
}

export async function getEmailPolicy(): Promise<EmailPolicy> {
  try {
    const rows = await readCollection<EmailPolicy>('emailPolicy');
    if (rows && rows.length > 0) return { ...rows[0], id: 'default', paused: !!rows[0].paused, overrides: rows[0].overrides || {} };
  } catch (e) {
    console.error('[email-service] Failed to read emailPolicy:', e);
  }
  return { id: 'default', paused: false, overrides: {} };
}

export function isCategoryEnabledByPolicy(policy: EmailPolicy, category: EmailCategory): boolean {
  const type = AUTO_EMAIL_TYPES.find((t) => t.key === category);
  if (!type) return true; // not switchable: always sends
  if (policy.paused) return false;
  return policy.overrides[category] ?? type.defaultEnabled;
}

/** True if the portal may send an automatic email of this category right now. */
export async function isEmailCategoryEnabled(category: EmailCategory): Promise<boolean> {
  return isCategoryEnabledByPolicy(await getEmailPolicy(), category);
}

export async function updateEmailPolicy(patch: { paused?: boolean; overrides?: Record<string, boolean> }, actorName: string): Promise<EmailPolicy> {
  const current = await getEmailPolicy();
  const validKeys = new Set(AUTO_EMAIL_TYPES.map((t) => t.key as string));
  const overrides = { ...current.overrides };
  for (const [k, v] of Object.entries(patch.overrides || {})) {
    if (validKeys.has(k) && typeof v === 'boolean') overrides[k] = v;
  }
  const next: EmailPolicy = {
    id: 'default',
    paused: typeof patch.paused === 'boolean' ? patch.paused : current.paused,
    overrides,
    updatedAt: new Date().toISOString(),
    updatedBy: actorName,
  };
  await mutateCollection<EmailPolicy>('emailPolicy', () => [next]);
  return next;
}

export interface EmailLog {
  id: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  category: EmailCategory;
  status: 'SENT' | 'FAILED' | 'BUFFERED' | 'CANCELLED';
  sentAt: string;
  bufferedUntil?: string; // ISO timestamp when the 10-minute quiet buffer elapses
  attachmentsMeta?: Array<{ filename: string; contentType?: string; cid?: string }>;
  /** Storage keys of the attachment files held while the email waits in the buffer (deleted once it is sent or cancelled). */
  attachmentKeys?: string[];
  attachmentFolder?: string;
  // Diagnostics for "shows SENT but never arrives" — a resolved sendMail()
  // only means the SMTP server ACCEPTED the message for delivery, not that
  // it reached the recipient's inbox. These surface what the server
  // actually said, without needing shell/log access on the VPS.
  errorMessage?: string;       // set when the send itself threw (auth failure, connection refused, timeout, ...)
  smtpResponse?: string;       // the raw final SMTP response line, e.g. "250 2.0.0 OK ..."
  rejectedRecipients?: string[]; // addresses the SMTP server explicitly rejected, if any
}

export interface SendEmailPayload {
  /** Blurred picture behind the e-mail: 'default' (Email Settings, if set; the default when omitted), 'none', or a specific picture. */
  background?: EmailBackgroundChoice;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  badgeText?: string;
  badgeColor?: string;
  category: EmailCategory;
  // Files attached to the outgoing message, e.g. an approved event report
  // or design asset read straight off disk via file-storage.ts's
  // readStoredFile(). Not persisted on the EmailLog entry (only the fact
  // that an email was sent/failed is), since the file itself already lives
  // in data/uploads and re-storing it on every log entry would duplicate it.
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string; cid?: string }>;
  immediate?: boolean; // if true, bypasses the 10-minute quiet buffer (e.g. for urgent security OTPs or manual flush)
}

export interface EmailSettings {
  id: string; // 'default'
  /** Default blurred background picture for every e-mail (see email-background.ts). */
  background?: EmailBackgroundSetting;
  // 'direct_send' is the built-in outbound engine (src/lib/direct-smtp-transport.ts):
  // the app itself resolves each recipient's MX records and delivers straight
  // to their mail server, with no relay/API in between — the other four
  // options stay available and unaffected for whoever prefers a relay.
  provider: 'gmail' | 'outlook' | 'custom' | 'local_postfix' | 'direct_send';
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
  authUser: string;
  authPass: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  // HELO/EHLO identity used only by the 'direct_send' provider — must match
  // the reverse-DNS (PTR) record on the VPS's outbound IP, or most receiving
  // mail servers will reject the connection outright.
  heloHostname?: string;
  // Optional DKIM signing (nodemailer signs the message itself, independent
  // of whatever the relay/Postfix does) — the single most effective lever
  // this app can pull for automated mail landing in spam, since a relay
  // often doesn't sign on behalf of a domain that isn't its own. Requires
  // the matching public key published as a DNS TXT record at
  // `<dkimSelector>._domainkey.<dkimDomain>` — signing is skipped entirely
  // unless all three fields are set, so this is a no-op until configured.
  dkimDomain?: string;
  dkimSelector?: string;
  dkimPrivateKey?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  id: 'default',
  provider: 'gmail',
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  secure: false,
  authUser: process.env.ANNOUNCEMENT_FROM_EMAIL || 'portal@example.com',
  authPass: process.env.SMTP_PASS || '',
  fromName: process.env.ANNOUNCEMENT_FROM_NAME || 'RTBI Portal',
  fromEmail: process.env.ANNOUNCEMENT_FROM_EMAIL || 'portal@example.com',
  replyTo: process.env.ANNOUNCEMENT_FROM_EMAIL || 'portal@example.com',
  updatedAt: new Date().toISOString(),
};

export async function getEmailSettings(): Promise<EmailSettings> {
  try {
    const list = await readCollection<EmailSettings>('emailSettings');
    if (list && list.length > 0) {
      return { ...DEFAULT_EMAIL_SETTINGS, ...list[0] };
    }
  } catch (e) {
    console.error('[email-service] Failed to read emailSettings collection:', e);
  }
  return DEFAULT_EMAIL_SETTINGS;
}

/**
 * Nodemailer's DKIM signer (nodemailer/lib/dkim/sign.js) silently drops the
 * signature — no error, no log — if crypto.createSign().sign() throws on a
 * malformed key, e.g. a paste artifact where real line breaks became
 * literal "\n" text. The message still sends successfully with no
 * DKIM-Signature header at all, which the receiving server (correctly)
 * treats as a failed authentication check — a "config looks right, save
 * succeeded, send succeeded, but signing silently never happened" failure
 * mode that's nearly impossible to diagnose from the outside. Validating
 * here turns that into an immediate, specific error at save time instead.
 */
function normalizeAndValidateDkimKey(rawKey: string): string {
  let key = rawKey.trim();
  if (!key.includes('\n') && key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n');
  }
  try {
    crypto.createPrivateKey(key);
  } catch {
    throw new Error(
      'DKIM Private Key is not a valid PEM private key. Make sure you pasted the whole block, ' +
      'including the -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines, with real line breaks.'
    );
  }
  return key;
}

export async function updateEmailSettings(settings: Partial<EmailSettings>, actorName: string): Promise<EmailSettings> {
  const current = await getEmailSettings();
  const updated: EmailSettings = {
    ...current,
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy: actorName,
  };

  if (updated.dkimPrivateKey) {
    updated.dkimPrivateKey = normalizeAndValidateDkimKey(updated.dkimPrivateKey);
  }

  await mutateCollection<EmailSettings>('emailSettings', () => [updated]);
  return updated;
}

async function buildTransporter(overrideSettings?: EmailSettings): Promise<{ transporter: Transporter; settings: EmailSettings; effectiveHost: string; effectivePort: number }> {
  const settings = overrideSettings || await getEmailSettings();

  const dkim = settings.dkimDomain && settings.dkimSelector && settings.dkimPrivateKey
    ? {
        domainName: settings.dkimDomain.trim(),
        keySelector: settings.dkimSelector.trim(),
        privateKey: settings.dkimPrivateKey,
      }
    : undefined;

  if (settings.provider === 'direct_send') {
    // Built-in engine: no host/port/auth to configure — it connects
    // straight to each recipient's own mail server. DKIM signing (above)
    // still applies here exactly as it does for every other provider,
    // since Nodemailer signs the message before handing it to any
    // transport, not just its own SMTPTransport.
    const heloHostname = (settings.heloHostname || settings.dkimDomain || 'localhost').trim();
    const t = nodemailer.createTransport(
      new DirectSendTransport({ heloHostname }),
      dkim ? { dkim } : undefined,
    );
    return { transporter: t, settings, effectiveHost: `direct-send via ${heloHostname}`, effectivePort: 25 };
  }

  let host = settings.smtpHost;
  let port = settings.smtpPort;
  let secure = settings.secure;
  let auth: { user: string; pass: string } | undefined = undefined;

  const cleanedPass = (settings.authPass || '').replace(/\s+/g, '');

  if (settings.provider === 'gmail') {
    host = 'smtp.gmail.com';
    port = settings.smtpPort || 587;
    if (settings.authUser && settings.authPass) {
      auth = { user: settings.authUser.trim(), pass: cleanedPass };
    }
  } else if (settings.provider === 'outlook') {
    host = 'smtp.office365.com';
    port = settings.smtpPort || 587;
    if (settings.authUser && settings.authPass) {
      auth = { user: settings.authUser.trim(), pass: cleanedPass };
    }
  } else if (settings.provider === 'custom') {
    host = settings.smtpHost || 'smtp.gmail.com';
    port = settings.smtpPort || 587;
    if (settings.authUser && settings.authPass) {
      auth = { user: settings.authUser.trim(), pass: cleanedPass };
    }
  } else if (settings.provider === 'local_postfix') {
    host = process.env.SMTP_HOST || 'localhost';
    port = Number(process.env.SMTP_PORT) || 25;
    secure = false;
    auth = undefined;
  }

  const t = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
    dkim,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    family: 4, // Force IPv4 to prevent Microsoft/Gmail IPv6 SPF/DKIM block (Error 450 4.7.26)
  } as any);

  return { transporter: t, settings, effectiveHost: host, effectivePort: port };
}

// Subjects land in <title> verbatim below and can carry user-supplied text
// (an event/task/announcement title) — escape it so that text can't break
// out of the tag and corrupt the rest of the <head>.
function escapeHtmlForTitle(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Master Institutional Email Wrapper Template
 * Clean, standard corporate email layout (inspired by PayPal/Stripe transactional notices) with:
 * 1. Minimalist Institution Header Banner & RTBI Logo
 * 2. Styled Content Area (plain white container, high contrast, clean typography)
 * 3. Optional Badge Header Tag (can be omitted completely for clean direct emails & invites)
 * 4. Standardized Institutional Footer with Copyright & IP Licensing Notice for Kayomarz Pavri
 */
export function wrapInMasterEmailTemplate(options: {
  // The HTML <title> — spam filters (SpamAssassin's HTML_TITLE_SUBJ_DIFF rule)
  // penalize a <title> that doesn't match the email's Subject header, since
  // that mismatch is a common bulk-mail template fingerprint. Every caller
  // should pass its actual subject line here.
  pageTitle: string;
  headerTitle?: string;
  headerSubtitle?: string;
  badgeText?: string;
  badgeColor?: string;
  bodyContentHtml: string;
}): string {
  const isOmittedBadge = !options.badgeText || ['NONE', 'None', 'NO_BADGE', 'none'].includes(options.badgeText.trim());

  const badgeHtml = isOmittedBadge
    ? ''
    : `<span style="font-size: 11px; font-weight: 700; color: ${options.badgeColor || '#CC3D19'}; background: #FEF4F1; border: 1px solid #FAC9BD; padding: 4px 10px; border-radius: 6px; display: inline-block; margin-bottom: 16px;">${options.badgeText}</span>`;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtmlForTitle(options.pageTitle)}</title>
    </head>
    <body style="background-color: #FEF7F6; margin: 0; padding: 24px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #2B1D3C; width: 100%; box-sizing: border-box;">
      <div style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border: 1px solid #E9E2F0; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);">
        
        <!-- Header Banner with Clean Typography Branding -->
        <div style="background-color: #1C0F2A; padding: 24px 32px; text-align: center;">
          <div style="display: inline-block; padding: 5px 12px; background: rgba(232, 104, 72, 0.12); border: 1px solid rgba(232, 104, 72, 0.25); border-radius: 6px; margin-bottom: 8px;">
            <span style="color: #E86848; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase;">RTBI PORTAL</span>
          </div>
          <p style="color: #A594B8; font-size: 12px; margin: 4px 0 0 0; font-weight: 500;">Ramaiah University of Applied Sciences &middot; Operations Portal</p>
        </div>

        <!-- Main Content Area -->
        <div style="padding: 28px 32px;">
          ${badgeHtml}
          ${options.headerTitle ? `<h3 style="margin-top: 0; color: #1C0F2A; font-size: 18px; font-weight: 700; margin-bottom: ${options.headerSubtitle ? '4px' : '18px'};">${options.headerTitle}</h3>` : ''}
          ${options.headerSubtitle ? `<p style="color: #76648B; font-size: 13px; margin-top: 0; margin-bottom: 18px; font-weight: 400;">${options.headerSubtitle}</p>` : ''}

          <div style="color: #422C5C; font-size: 14px; line-height: 1.65;">
            ${options.bodyContentHtml}
          </div>
        </div>

        <!-- Standardized Institutional Footer -->
        <div style="background-color: #FEF7F6; border-top: 1px solid #E9E2F0; padding: 20px 28px; text-align: center; font-size: 11px; color: #76648B; line-height: 1.6;">
          <p style="margin: 0 0 6px 0; color: #574769; font-weight: 600;">© 2026 RTBI Portal &middot; MSRUAS Internal Operations Portal</p>
          <p style="margin: 0 0 6px 0; color: #A594B8;">This is an automated operational notice. Authorised recipient access only.</p>
          <div style="border-top: 1px solid #E9E2F0; padding-top: 8px; margin-top: 8px; color: #76648B; font-size: 10px;">
            All Intellectual Property, Copyrights & Licensing belong exclusively to <strong style="color: #CC3D19;">Kayomarz Pavri</strong>.
          </div>
        </div>

      </div>
    </body>
    </html>
  `;
}

/**
 * Turns a raw Nodemailer/SMTP failure into a plain-English diagnosis. The
 * #1 real-world cause of "I entered the correct company email and password
 * but it still won't send through Outlook" is that Microsoft 365 disables
 * SMTP AUTH (plain username/password sign-in) tenant-wide by default as of
 * 2023 — no password is ever accepted until an admin re-enables it for that
 * specific mailbox. Nodemailer surfaces Microsoft's own rejection text
 * (e.g. "535 5.7.139 ... SmtpClientAuthenticationDisabled") verbatim, which
 * reads like a generic auth error unless it's translated here.
 */
function diagnoseSmtpFailure(err: any, provider: string): string {
  const raw = err?.message || String(err);
  const code = String(err?.code || err?.responseCode || '');
  let diagnosis = '';

  if (/SmtpClientAuthentication is disabled/i.test(raw) || /5\.7\.139/.test(raw)) {
    diagnosis =
      'Microsoft 365 has SMTP AUTH (plain username/password sign-in) turned OFF for this mailbox by default — ' +
      'this is a tenant setting, not a wrong password. An admin must enable it: Microsoft 365 admin center → ' +
      'Users → Active users → select this mailbox → Mail → "Manage email apps" → turn on Authenticated SMTP ' +
      '(or run Set-CASMailbox -Identity <email> -SmtpClientAuthenticationDisabled $false in Exchange Online PowerShell). ' +
      'No amount of re-entering the password will fix this until that switch is flipped.';
  } else if (provider === 'outlook' && /535|Invalid login|Username and Password not accepted/i.test(raw)) {
    diagnosis =
      'Outlook/Microsoft 365 rejected the sign-in. If this account has multi-factor authentication (MFA) enabled, ' +
      'the regular account password will not work over SMTP — an admin needs to either create an app password ' +
      'for this mailbox or enable SMTP AUTH as described above. Also confirm there is no typo in the email or password.';
  } else if (/535|Invalid login|Username and Password not accepted/i.test(raw)) {
    diagnosis = 'The mail server rejected the username/password combination — double-check for typos, and whether an app-specific password is required.';
  } else if (/ETIMEDOUT|ESOCKET|ECONNREFUSED|EHOSTUNREACH/i.test(code + raw)) {
    diagnosis =
      `Could not reach the ${provider === 'outlook' ? 'Outlook/Microsoft 365' : 'mail'} server at all — this is a network-reachability ` +
      'failure, not a credentials problem. The most common cause is a hosting provider blocking outbound SMTP ports ' +
      '(587/465) by default to prevent spam abuse; contact your VPS/hosting support to have it unblocked, or try the ' +
      '"Direct Send" provider instead.';
  } else if (/STARTTLS/i.test(raw)) {
    diagnosis = 'The server requires STARTTLS but the connection did not negotiate it — confirm the port is 587 with "secure" off (STARTTLS), not 465.';
  }

  return diagnosis ? `${diagnosis}\n\nRaw server response: ${raw}` : raw;
}

/**
 * `draftSettings` lets the caller test whatever is currently typed into the
 * Settings form — including a provider switch or new credentials that
 * haven't been saved yet. Without this, "Test Connection" always verified
 * the last-*saved* config, silently ignoring in-progress edits: selecting
 * Outlook and testing it could report success/failure for a stale Gmail
 * config underneath, with no way to tell the two apart from the result.
 * Fields the draft leaves unset (DKIM, replyTo, ...) still fall back to
 * whatever is already persisted.
 */
export async function testEmailConnection(testRecipient: string, draftSettings?: Partial<EmailSettings>): Promise<{ success: boolean; message: string }> {
  try {
    const persisted = await getEmailSettings();
    const effectiveSettings: EmailSettings = draftSettings ? { ...persisted, ...draftSettings } : persisted;
    const { transporter: t, settings, effectiveHost, effectivePort } = await buildTransporter(effectiveSettings);
    await t.verify();

    const from = `${settings.fromName || 'RTBI Portal'} <${settings.fromEmail || 'portal@example.com'}>`;

    const bodyHtml = wrapInMasterEmailTemplate({
      pageTitle: `[RTBI Test Email] SMTP Client Verification`,
      headerTitle: `SMTP Connection Verified`,
      headerSubtitle: `Diagnostic Health Check Successful`,
      badgeText: `SMTP Operational`,
      badgeColor: `#15803d`,
      bodyContentHtml: `
        <p style="margin-top: 0; color: #1C0F2A; font-weight: 600;">Your RTBI Portal email client and SMTP server settings are operational.</p>
        <div style="background: #ffffff; border: 1px solid #E9E2F0; padding: 14px 18px; border-radius: 10px; margin: 16px 0; font-size: 12px;">
          <p style="margin: 0 0 6px 0; color: #76648B;"><strong>Service Provider:</strong> <span style="color: #CC3D19; font-weight: 700;">${settings.provider.toUpperCase()}</span></p>
          <p style="margin: 0 0 6px 0; color: #76648B;"><strong>SMTP Host & Port:</strong> <span style="color: #1C0F2A; font-family: monospace;">${effectiveHost}:${effectivePort}</span></p>
          <p style="margin: 0; color: #76648B;"><strong>Sender Name:</strong> <span style="color: #1C0F2A;">${settings.fromName}</span></p>
        </div>
        <p style="color: #76648B; font-size: 11px; margin-bottom: 0;">Diagnostic executed at ${new Date().toLocaleString()}</p>
      `
    });

    const info = await t.sendMail({
      from,
      to: testRecipient,
      subject: `[RTBI Test Email] SMTP Client Verification`,
      text: `Hello,\n\nThis is a test notification verifying that your RTBI Portal email client and SMTP server (${settings.provider.toUpperCase()} @ ${effectiveHost}) are properly configured and operational.\n\nSent at: ${new Date().toLocaleString()}`,
      html: bodyHtml,
      xMailer: false,
    });

    if (info.rejected && info.rejected.length > 0) {
      return {
        success: false,
        message: `SMTP server rejected the recipient (${info.rejected.join(', ')}). Server said: ${info.response || 'no response text'}`,
      };
    }

    return {
      success: true,
      message: `SMTP accepted the message for ${testRecipient} (server said: "${info.response || 'OK'}"). This confirms the SMTP handoff worked.`,
    };
  } catch (err: any) {
    console.error('[email-service] SMTP Connection Test Failed:', err);
    const provider = draftSettings?.provider || (await getEmailSettings()).provider;
    return { success: false, message: err ? diagnoseSmtpFailure(err, provider) : 'Failed to establish connection to SMTP server.' };
  }
}

export const BUFFER_DELAY_MS = 10 * 60 * 1000; // 10 minutes quiet buffer

interface BufferedEmailEntry {
  id: string;
  payload: SendEmailPayload;
  queuedAt: string;
  bufferedUntil: string;
  timer: NodeJS.Timeout | null;
  /** Attachments held on disk (restored at send time) — set when this entry was rebuilt from the database. */
  persistedAttachments?: number;
}

// Shared via globalThis: Next.js loads this module once per route chunk, and separate copies
// each had their own "already sending" set — so one email could be dispatched twice.
const globalForEmail = globalThis as unknown as {
  __rtbiBufferedEmails?: Map<string, BufferedEmailEntry>;
  __rtbiSendingInProgress?: Set<string>;
  __rtbiSweeperStarted?: boolean;
};
const bufferedEmails: Map<string, BufferedEmailEntry> = (globalForEmail.__rtbiBufferedEmails ??= new Map());
const sendingInProgress: Set<string> = (globalForEmail.__rtbiSendingInProgress ??= new Set());

function ensureSweeperInterval(): void {
  if (globalForEmail.__rtbiSweeperStarted || typeof setInterval === 'undefined') return;
  globalForEmail.__rtbiSweeperStarted = true;
  const interval = setInterval(() => {
    sweepExpiredBufferedEmails().catch(err => {
      console.error('[email-service] Background sweeper tick error:', err);
    });
  }, 30000);
  if (interval.unref) interval.unref();
}

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#CC3D19;');
}

export async function sweepExpiredBufferedEmails(): Promise<number> {
  ensureSweeperInterval();
  let dispatchedCount = 0;
  try {
    const list = await readCollection<EmailLog>('emails');
    const bufferedList = (list || []).filter(item => item.status === 'BUFFERED');
    if (bufferedList.length === 0) return 0;

    const now = Date.now();
    for (const item of bufferedList) {
      if (sendingInProgress.has(item.id)) continue;
      const untilMs = item.bufferedUntil ? new Date(item.bufferedUntil).getTime() : 0;
      const remainingMs = Math.max(0, untilMs - now);

      if (remainingMs === 0) {
        // 10 minutes have elapsed! Trigger SMTP send immediately
        dispatchedCount++;
        const entry = bufferedEmails.get(item.id);
        if (entry?.timer) clearTimeout(entry.timer);
        bufferedEmails.delete(item.id);

        sendBufferedEmailNow(item.id).catch(err => {
          console.error(`[email-service] Failed to dispatch matured buffered email ${item.id}:`, err);
        });
      } else if (!bufferedEmails.has(item.id)) {
        // Re-arm timer if missing in memory (e.g. after server boot)
        const timer = setTimeout(() => {
          sendBufferedEmailNow(item.id).catch(err => {
            console.error(`[email-service] Failed to dispatch scheduled buffered email ${item.id}:`, err);
          });
        }, remainingMs);
        if (timer.unref) timer.unref();

        bufferedEmails.set(item.id, {
          id: item.id,
          payload: {
            to: item.to,
            subject: item.subject,
            bodyText: item.bodyText,
            bodyHtml: item.bodyHtml,
            category: item.category,
          },
          queuedAt: item.sentAt || new Date().toISOString(),
          bufferedUntil: item.bufferedUntil || new Date(now + remainingMs).toISOString(),
          timer,
          persistedAttachments: item.attachmentKeys?.length || 0,
        });
      }
    }
  } catch (err) {
    console.error('[email-service] Failed to sweep buffered emails from DB:', err);
  }
  return dispatchedCount;
}

export async function restoreBufferedQueue(): Promise<void> {
  await sweepExpiredBufferedEmails();
}

async function executeSmtpSend(payload: SendEmailPayload): Promise<{
  status: 'SENT' | 'FAILED';
  errorMessage?: string;
  smtpResponse?: string;
  rejectedRecipients?: string[];
}> {
  let finalBodyHtml = payload.bodyHtml || payload.bodyText;
  let finalBodyText = payload.bodyText;
  let status: 'SENT' | 'FAILED' = 'FAILED';
  let errorMessage: string | undefined;
  let smtpResponse: string | undefined;
  let rejectedRecipients: string[] | undefined;

  let transporter: Transporter | undefined;
  try {
    const { transporter: t, settings } = await buildTransporter();
    transporter = t;
    const from = `${settings.fromName || 'RTBI Portal'} <${settings.fromEmail || 'portal@example.com'}>`;
    const domain = (settings.fromEmail || 'portal.example.com').split('@')[1] || 'portal.example.com';
    const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2, 9)}@${domain}>`;

    const isBulkCategory = payload.category === 'ANNOUNCEMENT' || payload.category === 'GUEST_INVITE' || payload.category === 'CERTIFICATE';
    const unsubscribeAddress = settings.replyTo || settings.fromEmail;
    const headers: Record<string, string> = {
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'OOF, AutoReply, Async, All',
      'Message-ID': messageId,
      'X-Entity-Ref-ID': messageId,
      'X-Priority': '3',
      'Importance': 'normal',
    };
    if (isBulkCategory && unsubscribeAddress) {
      headers['List-Unsubscribe'] = `<mailto:${unsubscribeAddress}?subject=Unsubscribe>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }

    if (isBulkCategory && unsubscribeAddress) {
      const unsubscribeMailto = `mailto:${unsubscribeAddress}?subject=Unsubscribe`;
      const unsubscribeHtml = `<div style="text-align:center;padding:12px 20px 4px;font-size:10px;color:#A594B8;">Don't want these emails? <a href="${unsubscribeMailto}" style="color:#CC3D19;">Unsubscribe</a>.</div>`;
      finalBodyHtml = finalBodyHtml.includes('</body>')
        ? finalBodyHtml.replace('</body>', `${unsubscribeHtml}</body>`)
        : `${finalBodyHtml}${unsubscribeHtml}`;
      finalBodyText = `${finalBodyText}\n\n---\nDon't want these emails? Unsubscribe: ${unsubscribeMailto}`;
    }

    const info = await t.sendMail({
      from,
      to: payload.to,
      subject: payload.subject,
      text: finalBodyText,
      html: finalBodyHtml,
      replyTo: settings.replyTo || settings.fromEmail,
      xMailer: false,
      headers,
      attachments: payload.attachments,
    });

    smtpResponse = info.response;
    if (info.rejected && info.rejected.length > 0) {
      const rejectedList = info.rejected.map(String);
      rejectedRecipients = rejectedList;
      if (!info.accepted || info.accepted.length === 0) {
        status = 'FAILED';
        errorMessage = `SMTP server rejected all recipients: ${rejectedList.join(', ')}`;
      } else {
        status = 'SENT';
      }
    } else {
      status = 'SENT';
    }
  } catch (err) {
    const provider = (await getEmailSettings()).provider;
    errorMessage = diagnoseSmtpFailure(err, provider);
    console.error(`[email-service] Failed to send to ${payload.to}:`, errorMessage);
  } finally {
    // A fresh transporter is built per send, so it must be released or its sockets leak until the mail host starts refusing us.
    try { transporter?.close(); } catch { /* already closed */ }
  }

  return { status, errorMessage, smtpResponse, rejectedRecipients };
}

/** Adds the blurred background (this send's choice, else the Email Settings default) to a finished e-mail. */
async function withBackground(html: string, payload: SendEmailPayload): Promise<string> {
  try {
    const choice = payload.background;
    if (choice === 'none') return html;
    const url = await resolveEmailBackgroundUrl(choice && choice !== 'default' ? undefined : await getEmailSettings(), choice);
    return url ? applyEmailBackground(html, url) : html;
  } catch (err) {
    console.error('[email-service] Could not apply the e-mail background; sending without it:', err);
    return html;
  }
}

/**
 * The finished HTML of an e-mail exactly as it will be sent: the caller's own HTML, or the standard RTBI template around the
 * text, with the blurred background (this send's choice, else the Email Settings default). Also used for the send-dialog preview.
 */
export async function buildEmailHtml(payload: SendEmailPayload): Promise<string> {
  let badgeTextToUse: string | undefined = payload.badgeText;
  if (!badgeTextToUse) {
    if (payload.category === 'ANNOUNCEMENT') badgeTextToUse = 'Official Announcement';
    else if (payload.category === 'TASK_ASSIGNMENT') badgeTextToUse = 'Task Assignment';
    else if (payload.category === 'TASK_DEADLINE_REMINDER') badgeTextToUse = 'Deadline Reminder';
    else if (payload.category === 'ACCOUNT_ACTIVATION') badgeTextToUse = 'Account Notice';
    else if (payload.category === 'BIRTHDAY') badgeTextToUse = 'Greetings';
    else if (payload.category === 'EVENT_PASS' || payload.category === 'EVENT_INVITATION') badgeTextToUse = 'Official Event Pass';
    else if (payload.category === 'GROUP_POLICY_GRANT') badgeTextToUse = 'Special Access Granted';
    else if (payload.category === 'CERTIFICATE') badgeTextToUse = 'Certificate of Participation';
    else badgeTextToUse = undefined;
  }

  const defaultFormattedHtml = wrapInMasterEmailTemplate({
    pageTitle: payload.subject,
    headerTitle: payload.subject,
    badgeText: badgeTextToUse,
    badgeColor: payload.badgeColor,
    bodyContentHtml: `<div style="white-space: pre-wrap; font-size: 14px; line-height: 1.7; color: #2B1D3C;">${payload.bodyText}</div>`
  });

  return withBackground(payload.bodyHtml || defaultFormattedHtml, payload);
}

async function sendImmediateEmail(payload: SendEmailPayload): Promise<EmailLog> {
  const bodyHtml = await buildEmailHtml(payload);
  const result = await executeSmtpSend({
    ...payload,
    bodyHtml,
  });

  const newEmail: EmailLog = {
    id: `email-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    to: payload.to,
    subject: payload.subject,
    bodyText: payload.bodyText,
    bodyHtml,
    category: payload.category,
    status: result.status,
    sentAt: new Date().toISOString(),
    errorMessage: result.errorMessage,
    smtpResponse: result.smtpResponse,
    rejectedRecipients: result.rejectedRecipients,
    attachmentsMeta: payload.attachments?.map(a => ({ filename: a.filename, contentType: a.contentType, ...(a.cid ? { cid: a.cid } : {}) })),
  };

  try {
    await mutateCollection<EmailLog>('emails', (current) => [newEmail, ...(current || [])]);
  } catch (err) {
    console.error('[email-service] Failed to persist email to database:', err);
  }

  return newEmail;
}

// ── Buffered-email attachments ─────────────────────────────────────────────────
// A buffered email can be sent by a different server process/module instance than the one that queued it (scheduled
// certificate sends, a restart, the 30s sweeper...). Attachments only lived in memory, so such sends went out without
// the PDF. They are therefore written to disk, under an unguessable folder, until the email is sent or cancelled.

const ATTACHMENT_CATEGORY = 'email-attachments';

async function persistAttachments(payload: SendEmailPayload): Promise<{ keys: string[]; folder: string } | null> {
  const files = (payload.attachments || []).filter((a) => a.content);
  if (files.length === 0) return null;
  const folder = crypto.randomBytes(16).toString('hex');
  try {
    const keys: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const buf = Buffer.isBuffer(files[i].content) ? files[i].content : Buffer.from(String(files[i].content));
      const saved = await saveBase64File(ATTACHMENT_CATEGORY, folder, i, files[i].filename, `data:application/octet-stream;base64,${buf.toString('base64')}`);
      keys.push(saved.storageKey);
    }
    return { keys, folder };
  } catch (err) {
    console.error('[email-service] Failed to persist email attachments:', err);
    return null;
  }
}

async function loadPersistedAttachments(log: EmailLog): Promise<SendEmailPayload['attachments']> {
  if (!log.attachmentKeys?.length) return undefined;
  const out: NonNullable<SendEmailPayload['attachments']> = [];
  for (let i = 0; i < log.attachmentKeys.length; i++) {
    try {
      out.push({
        filename: log.attachmentsMeta?.[i]?.filename || `attachment-${i + 1}`,
        contentType: log.attachmentsMeta?.[i]?.contentType,
        cid: log.attachmentsMeta?.[i]?.cid,
        content: await readStoredFile(log.attachmentKeys[i]),
      });
    } catch (err) {
      console.error(`[email-service] Attachment ${log.attachmentKeys[i]} could not be read for email ${log.id}:`, err);
    }
  }
  return out;
}

async function discardPersistedAttachments(log: EmailLog): Promise<void> {
  if (log.attachmentFolder) await deleteStoredFilesForRecord(ATTACHMENT_CATEGORY, log.attachmentFolder);
}

export async function sendBufferedEmailNow(id: string): Promise<EmailLog | null> {
  if (sendingInProgress.has(id)) return null;
  sendingInProgress.add(id);

  try {
    const entry = bufferedEmails.get(id);
    if (entry?.timer) {
      clearTimeout(entry.timer);
    }
    bufferedEmails.delete(id);

    const currentLogs = await readCollection<EmailLog>('emails');
    const target = currentLogs.find(l => l.id === id);
    if (!target || target.status === 'CANCELLED' || target.status === 'SENT') {
      return null;
    }

    console.log(`[email-service] Dispatching buffered email ${id} to ${target.to} via SMTP...`);

    const payloadToSend: SendEmailPayload = entry?.payload || {
      to: target.to,
      subject: target.subject,
      bodyText: target.bodyText,
      bodyHtml: target.bodyHtml,
      category: target.category,
    };
    // This process may not be the one that queued the email (or may have restarted): restore its files from disk.
    if (!payloadToSend.attachments?.length && target.attachmentKeys?.length) {
      payloadToSend.attachments = await loadPersistedAttachments(target);
      if (target.attachmentsMeta?.length && payloadToSend.attachments?.length !== target.attachmentKeys.length) {
        const failed: EmailLog = { ...target, status: 'FAILED', sentAt: new Date().toISOString(), errorMessage: 'The attachment could not be read, so the email was not sent without it.' };
        await mutateCollection<EmailLog>('emails', (current) => (current || []).map((item) => (item.id === id ? failed : item)));
        return failed;
      }
    }

    const sendResult = await executeSmtpSend(payloadToSend);

    const updatedLog: EmailLog = {
      ...target,
      status: sendResult.status,
      sentAt: new Date().toISOString(),
      smtpResponse: sendResult.smtpResponse,
      errorMessage: sendResult.errorMessage,
      rejectedRecipients: sendResult.rejectedRecipients,
    };

    await mutateCollection<EmailLog>('emails', (current) => {
      return (current || []).map(item => item.id === id ? updatedLog : item);
    });
    if (sendResult.status === 'SENT') await discardPersistedAttachments(target);

    console.log(`[email-service] Buffered email ${id} dispatch complete. Result: ${sendResult.status} (SMTP: ${sendResult.smtpResponse || sendResult.errorMessage || 'OK'})`);
    return updatedLog;
  } finally {
    sendingInProgress.delete(id);
  }
}

export const flushBufferedEmail = sendBufferedEmailNow;

export async function cancelBufferedEmail(id: string): Promise<boolean> {
  await restoreBufferedQueue();
  const entry = bufferedEmails.get(id);
  if (entry?.timer) {
    clearTimeout(entry.timer);
  }
  bufferedEmails.delete(id);

  let found = false;
  let cancelled: EmailLog | undefined;
  await mutateCollection<EmailLog>('emails', (current) => {
    return (current || []).map(item => {
      if (item.id === id) {
        found = true;
        cancelled = item;
        return {
          ...item,
          status: 'CANCELLED',
          errorMessage: 'Cancelled by administrator before 10-minute dispatch',
        };
      }
      return item;
    });
  });

  if (cancelled) await discardPersistedAttachments(cancelled);
  return found;
}

/** `only` / `except` narrow a bulk action to (or away from) one category, e.g. certificates have their own Mailroom tab. */
export interface BufferedScope { only?: EmailCategory; except?: EmailCategory }
function scopedBufferedIds(scope?: BufferedScope): string[] {
  return Array.from(bufferedEmails.entries())
    .filter(([, e]) => (!scope?.only || e.payload.category === scope.only) && (!scope?.except || e.payload.category !== scope.except))
    .map(([id]) => id);
}

export async function flushAllBufferedEmails(scope?: BufferedScope): Promise<number> {
  await restoreBufferedQueue();
  const ids = scopedBufferedIds(scope);
  // Send in small parallel batches so a large queue doesn't outlast the HTTP
  // request, and one failing email can't abort the rest of the flush.
  const BATCH = 5;
  for (let i = 0; i < ids.length; i += BATCH) {
    const results = await Promise.allSettled(ids.slice(i, i + BATCH).map(id => sendBufferedEmailNow(id)));
    results.forEach((r, idx) => {
      if (r.status === 'rejected') console.error(`[email-service] Flush failed for buffered email ${ids[i + idx]}:`, r.reason);
    });
  }
  return ids.length;
}

export async function cancelAllBufferedEmails(scope?: BufferedScope): Promise<number> {
  await restoreBufferedQueue();
  const ids = scopedBufferedIds(scope);
  for (const id of ids) {
    await cancelBufferedEmail(id);
  }
  return ids.length;
}

export async function getBufferedEmails(): Promise<Array<{
  id: string;
  to: string;
  subject: string;
  category: EmailCategory;
  queuedAt: string;
  bufferedUntil: string;
  remainingMs: number;
  remainingSeconds: number;
  hasAttachments: boolean;
  attachmentCount: number;
}>> {
  await restoreBufferedQueue();
  const now = Date.now();
  return Array.from(bufferedEmails.values()).map(entry => {
    const untilMs = new Date(entry.bufferedUntil).getTime();
    const remainingMs = Math.max(0, untilMs - now);
    return {
      id: entry.id,
      to: entry.payload.to,
      subject: entry.payload.subject,
      category: entry.payload.category,
      queuedAt: entry.queuedAt,
      bufferedUntil: entry.bufferedUntil,
      remainingMs,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      hasAttachments: Boolean((entry.payload.attachments && entry.payload.attachments.length > 0) || entry.persistedAttachments),
      attachmentCount: entry.payload.attachments?.length || entry.persistedAttachments || 0,
    };
  });
}

/**
 * Universal Outgoing Email Dispatcher
 *
 * ALL outgoing emails across the RTBI Portal (announcements, passes, invitations,
 * group policy grants, approvals, direct broadcasts, reports, etc.) enter the
 * 10-minute quiet buffer before being dispatched to recipients.
 *
 * Only explicit urgent bypasses (payload.immediate = true or 5-min AUTH_OTP security codes)
 * bypass the quiet buffer.
 */
export async function dispatchEmail(payload: SendEmailPayload): Promise<EmailLog> {
  // Automatic-email switches (see getEmailPolicy): a switched-off type is logged as CANCELLED and never sent.
  if (!(await isEmailCategoryEnabled(payload.category))) {
    const cancelled: EmailLog = {
      id: `email-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      to: payload.to,
      subject: payload.subject,
      bodyText: payload.bodyText,
      bodyHtml: '',
      category: payload.category,
      status: 'CANCELLED',
      sentAt: new Date().toISOString(),
      errorMessage: 'Not sent: this type of automatic email is switched off in Email Management → Settings.',
    };
    try { await mutateCollection<EmailLog>('emails', (current) => [cancelled, ...(current || [])]); } catch { /* log is best-effort */ }
    return cancelled;
  }
  await restoreBufferedQueue();

  // If immediate flag is true OR it's a 5-min security OTP, send immediately via SMTP
  if (payload.immediate || payload.category === 'AUTH_OTP') {
    return sendImmediateEmail(payload);
  }

  // Otherwise, all emails go through the 10-minute quiet buffer!
  const id = `email-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const queuedAt = new Date().toISOString();
  const bufferedUntil = new Date(Date.now() + BUFFER_DELAY_MS).toISOString();

  const finalBodyHtml = await buildEmailHtml(payload);
  const finalBodyText = payload.bodyText;

  const newEmail: EmailLog = {
    id,
    to: payload.to,
    subject: payload.subject,
    bodyText: finalBodyText,
    bodyHtml: finalBodyHtml,
    category: payload.category,
    status: 'BUFFERED',
    sentAt: queuedAt,
    bufferedUntil,
    attachmentsMeta: payload.attachments?.map(a => ({ filename: a.filename, contentType: a.contentType, ...(a.cid ? { cid: a.cid } : {}) })),
  };
  const persisted = await persistAttachments(payload);
  if (persisted) {
    newEmail.attachmentKeys = persisted.keys;
    newEmail.attachmentFolder = persisted.folder;
  }

  try {
    await mutateCollection<EmailLog>('emails', (current) => [newEmail, ...(current || [])]);
  } catch (err) {
    console.error('[email-service] Failed to persist buffered email to database:', err);
  }

  const timer = setTimeout(() => {
    sendBufferedEmailNow(id).catch(err => {
      console.error(`[email-service] Error sending buffered email ${id}:`, err);
    });
  }, BUFFER_DELAY_MS);

  bufferedEmails.set(id, {
    id,
    payload: {
      ...payload,
      bodyHtml: finalBodyHtml,
      bodyText: finalBodyText,
    },
    queuedAt,
    bufferedUntil,
    timer,
  });

  return newEmail;
}

export function generateGroupPolicyGrantEmailTemplate(
  memberName: string,
  policy: {
    tag: string;
    name: string;
    description?: string;
    capabilities?: string[];
    moduleAccess?: Partial<Record<string, { view?: 'OWN' | 'ALL'; edit?: 'OWN' | 'ALL' | 'NONE' }>>;
    expiresAt?: string;
    createdBy?: string;
  },
  allottedByName: string
): { subject: string; bodyText: string; bodyHtml: string } {
  const baseUrl = getAppBaseUrl();
  const dashboardUrl = `${baseUrl}/dashboard`;

  let validityText = 'Permanent Administrative Grant (Ongoing until revoked)';
  let durationBadge = 'Permanent Access';
  let isTimeLimited = false;

  if (policy.expiresAt) {
    isTimeLimited = true;
    const expiryDate = new Date(policy.expiresAt);
    const now = new Date();
    const diffMs = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const formattedDate = expiryDate.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    if (diffDays > 0) {
      validityText = `Valid until ${formattedDate} (${diffDays} day${diffDays === 1 ? '' : 's'} remaining)`;
      durationBadge = `Time-Limited (${diffDays} day${diffDays === 1 ? '' : 's'})`;
    } else {
      validityText = `Valid until ${formattedDate}`;
      durationBadge = 'Time-Limited Access';
    }
  }

  // Resolve capability items
  const capabilitiesList = (policy.capabilities || []).map(capKey => {
    const found = CAPABILITY_CATALOG.find(c => c.key === capKey);
    return {
      key: capKey,
      label: found?.label || capKey,
      module: found?.module || 'General',
      description: found?.description || '',
    };
  });

  // Resolve module access items
  const moduleAccessList: Array<{ module: string; view?: string; edit?: string }> = [];
  if (policy.moduleAccess) {
    for (const [key, grant] of Object.entries(policy.moduleAccess)) {
      if (grant && (grant.view || grant.edit)) {
        const foundMod = MODULE_CATALOG.find(m => m.key === key);
        moduleAccessList.push({
          module: foundMod?.label || key,
          view: grant.view,
          edit: grant.edit,
        });
      }
    }
  }

  const subject = `[RTBI Special Access] ${policy.name} (${policy.tag})`;

  const capsText = capabilitiesList.length > 0
    ? capabilitiesList.map(c => `  - ${c.label} [${c.module}]: ${c.description}`).join('\n')
    : '  - No specific capability tags assigned';

  const modAccessText = moduleAccessList.length > 0
    ? moduleAccessList.map(m => `  - ${m.module}: View=${m.view || 'Default'}, Edit=${m.edit || 'Default'}`).join('\n')
    : '';

  const bodyText = `Dear ${memberName},\n\n` +
    `You have been allotted special access privileges in the RTBI Portal ERP under Group Policy: "${policy.name}" (${policy.tag}).\n\n` +
    `AUTHORITY & GRANT DETAILS:\n` +
    `- Allotted By: ${allottedByName}\n` +
    `- Access Duration: ${validityText}\n` +
    (policy.description ? `- Policy Purpose: ${policy.description}\n` : '') +
    `\nPRIVILEGES & PERMISSIONS ALLOTTED:\n` +
    `${capsText}\n` +
    (modAccessText ? `\nMODULE ACCESS PERMISSIONS:\n${modAccessText}\n` : '') +
    `\nPlease access your elevated dashboard here:\n${dashboardUrl}\n\n` +
    `Security Note: If you believe this access was allotted in error, please immediately contact your Centre Administrator.\n\n` +
    `Regards,\nRTBI Access Management & Information Security`;

  const capsHtml = capabilitiesList.map(c => `
    <div style="padding: 10px 14px; background: #ffffff; border: 1px solid #E9E2F0; border-radius: 8px; margin-bottom: 8px;">
      <div style="font-weight: 700; color: #1C0F2A; font-size: 13px;">${escapeHtml(c.label)}</div>
      <div style="font-size: 11px; color: #76648B; margin-top: 2px;">
        <span style="display: inline-block; padding: 2px 6px; background: #FDF0EC; border-radius: 4px; font-weight: 600; color: #574769; margin-right: 6px;">${escapeHtml(c.module)}</span>
        ${escapeHtml(c.description)}
      </div>
    </div>
  `).join('');

  const modAccessHtml = moduleAccessList.map(m => `
    <div style="padding: 8px 12px; background: #ffffff; border: 1px solid #E9E2F0; border-radius: 8px; margin-bottom: 6px; font-size: 12px;">
      <strong style="color: #1C0F2A;">${escapeHtml(m.module)}:</strong>
      <span style="color: #CC3D19; margin-left: 6px;">View: ${m.view || 'Default'}</span> &middot;
      <span style="color: #10b981; margin-left: 4px;">Edit: ${m.edit || 'Default'}</span>
    </div>
  `).join('');

  const bodyContentHtml = `
    <p style="margin-top: 0; color: #1C0F2A; font-size: 15px; font-weight: 600; line-height: 1.5;">
      Dear ${escapeHtml(memberName)},
    </p>
    <p style="color: #422C5C; font-size: 13px; line-height: 1.6;">
      You have been granted special access permissions in the RTBI Portal ERP under Group Policy: <strong>${escapeHtml(policy.name)}</strong> (<code style="background: #FDF0EC; padding: 2px 5px; border-radius: 4px; color: #EA7153;">${escapeHtml(policy.tag)}</code>).
    </p>

    <!-- Authority & Validity Notice Card -->
    <div style="background: ${isTimeLimited ? '#fffbeb' : '#FEF7F6'}; border: 1px solid ${isTimeLimited ? '#fde68a' : '#E9E2F0'}; border-radius: 12px; padding: 14px 18px; margin: 18px 0;">
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <tr>
          <td style="padding: 4px 0; color: #76648B; width: 130px; font-weight: 600;">Allotted By:</td>
          <td style="padding: 4px 0; color: #1C0F2A; font-weight: 700;">${escapeHtml(allottedByName)}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #76648B; font-weight: 600;">Grant Duration:</td>
          <td style="padding: 4px 0; color: ${isTimeLimited ? '#b45309' : '#1C0F2A'}; font-weight: 700;">
            ${isTimeLimited ? '⏰ ' : '🛡️ '}${escapeHtml(validityText)}
          </td>
        </tr>
        ${policy.description ? `
        <tr>
          <td style="padding: 4px 0; color: #76648B; font-weight: 600;">Description:</td>
          <td style="padding: 4px 0; color: #574769;">${escapeHtml(policy.description)}</td>
        </tr>
        ` : ''}
      </table>
    </div>

    <!-- Privileges & Capabilities -->
    <div style="margin: 20px 0 16px;">
      <h4 style="margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #574769;">
        Special Privileges & Capabilities Allotted:
      </h4>
      ${capsHtml || '<p style="font-size: 12px; color: #A594B8; font-style: italic;">No capability tags attached.</p>'}
    </div>

    ${moduleAccessList.length > 0 ? `
    <div style="margin: 16px 0;">
      <h4 style="margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #574769;">
        Module View & Edit Permissions:
      </h4>
      ${modAccessHtml}
    </div>
    ` : ''}

    <!-- Call to action button -->
    <div style="text-align: center; margin: 28px 0 16px;">
      <a href="${dashboardUrl}" target="_blank" style="display: inline-block; background: #EA7153; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 700; font-size: 13px; box-shadow: 0 4px 12px rgba(234, 113, 83, 0.25);">
        Open RTBI Portal &rarr;
      </a>
    </div>

    <p style="margin: 16px 0 0; font-size: 11px; color: #76648B; text-align: center; line-height: 1.5;">
      Security Notice: This elevated privilege was provisioned by ${escapeHtml(allottedByName)} via RTBI Group Policy Management. If you believe this grant was allotted in error, please report this immediately to your Administrator.
    </p>
  `;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: `Special Access Permission Allotted`,
    headerSubtitle: isTimeLimited ? `Temporary Elevated Privileges Assigned` : `Administrative Privileges Granted`,
    badgeText: isTimeLimited ? `SPECIAL ACCESS (${durationBadge.toUpperCase()})` : `PRIVILEGE GRANT`,
    badgeColor: isTimeLimited ? `#d97706` : `#EA7153`,
    bodyContentHtml,
  });

  return { subject, bodyText, bodyHtml };
}

export function resolvePolicyRecipients(policy: any, members: any[]): Array<{ id: string; name: string; email: string }> {
  if (!policy || policy.enabled === false) return [];
  const activeMembers = (members || []).filter((m: any) => m.status !== 'Terminated' && m.email);
  return activeMembers.filter((m: any) => {
    if (Array.isArray(policy.targetMemberIds) && policy.targetMemberIds.includes(m.id)) return true;
    if (Array.isArray(policy.targetDivisions) && policy.targetDivisions.length > 0 && policy.targetDivisions.includes(m.division)) return true;
    if (Array.isArray(policy.targetTiers) && policy.targetTiers.length > 0 && policy.targetTiers.includes(m.tier)) return true;
    if (policy.targetDesignationKeyword && typeof policy.targetDesignationKeyword === 'string' && policy.targetDesignationKeyword.trim()) {
      const kw = policy.targetDesignationKeyword.trim().toLowerCase();
      if ((m.role || '').toLowerCase().includes(kw)) return true;
    }
    return false;
  }).map((m: any) => ({ id: m.id, name: m.name, email: m.email }));
}

export function generateOtpEmailTemplate(name: string, otp: string): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `RTBI Portal Security Code: ${otp}`;
  const bodyText = `Hello ${name},\n\n` +
    `You requested a password reset for your RTBI Portal account.\n\n` +
    `Verification Code: ${otp}\n\n` +
    `This code is valid for 5 minutes. If you did not request this code, please ignore this email.\n\n` +
    `Regards,\nRTBI Portal, MSRUAS`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: `Password Reset Request`,
    headerSubtitle: `Security Verification Code`,
    badgeText: `Security Verification`,
    badgeColor: `#CC3D19`,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello <strong>${name}</strong>,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">You requested a password reset for your RTBI Portal account. Use the verification code below to complete your password update:</p>

      <div style="text-align: center; margin: 28px 0;">
        <span style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #1C0F2A; background: #FEF7F6; border: 1px solid #D5CBE1; padding: 14px 28px; border-radius: 10px; display: inline-block;">
          ${otp}
        </span>
        <p style="color: #76648B; font-size: 12px; margin-top: 10px;">Valid for 5 minutes</p>
      </div>

      <p style="color: #76648B; font-size: 12px; line-height: 1.5; margin-bottom: 0;">If you did not request this code, you can safely ignore this message.</p>
    `
  });

  return { subject, bodyText, bodyHtml };
}

/**
 * Template Generator: Welcome / Account Activation.
 * Sent once, right when a member is first added to the Directory — the
 * account exists (in the members collection) but has no passwordHash yet,
 * so this link is the only way in until the recipient sets their own
 * password. The link carries a long-lived opaque token (see
 * src/lib/account-activation.ts), not a short OTP, since it's meant to be
 * clicked from an inbox rather than typed in.
 */
export function generateWelcomeActivationEmailTemplate(name: string, activationLink: string): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `RTBI Portal Account Activation: ${name}`;
  const bodyText = `Hello ${name},\n\n` +
    `An account has been created for you on the RTBI Portal Operations Dashboard.\n\n` +
    `Set your password and activate your account:\n${activationLink}\n\n` +
    `Regards,\nRTBI Portal, MSRUAS`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: `Account Activation`,
    headerSubtitle: `RTBI Operations Portal`,
    badgeText: `Account Setup`,
    badgeColor: `#CC3D19`,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello <strong>${name}</strong>,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">You have been added to the RTBI Portal roster. Select the link below to set your account password:</p>

      <div style="text-align: center; margin: 28px 0;">
        <a href="${activationLink}" style="display: inline-block; background: #CC3D19; color: #ffffff; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 10px; text-decoration: none;">
          Set Up My Account
        </a>
      </div>

      <p style="color: #76648B; font-size: 12px; line-height: 1.5; margin-bottom: 0;">If the button does not open, copy and paste this link into your browser:<br /><span style="word-break: break-all; color: #CC3D19;">${activationLink}</span></p>
    `
  });

  return { subject, bodyText, bodyHtml };
}

/**
 * Template Generator: Welcome Email when added to Directory
 */
export function generateNewMemberWelcomeTemplate(member: {
  name: string;
  email: string;
  role: string;
  division?: string;
  department?: string;
}): { subject: string; bodyText: string; bodyHtml: string } {
  const roleStr = member.role || 'Member';
  const divisionStr = member.division || 'Core Committee';
  const departmentStr = member.department ? ` (${member.department})` : '';
  const baseUrl = getAppBaseUrl();

  const subject = `RTBI Portal Account Created: ${member.name}`;
  const bodyText = `Hello ${member.name},\n\n` +
    `Welcome to RTBI Portal. You have officially been registered as a member on the RTBI Operations Dashboard.\n\n` +
    `Account Summary:\n` +
    `• Designation / Role: ${roleStr}\n` +
    `• Division: ${divisionStr}${departmentStr}\n` +
    `• Registered Email: ${member.email}\n\n` +
    `Password Setup:\n` +
    `When you log in for the first time at ${baseUrl} using your email (${member.email}), you will be prompted directly to set your password.\n\n` +
    `Regards,\nRTBI Portal, MSRUAS`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: `Welcome to RTBI Portal`,
    headerSubtitle: `Member Registration Notice`,
    badgeText: `Official Notice`,
    badgeColor: `#CC3D19`,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello <strong>${member.name}</strong>,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">You have officially been registered as a member of <strong>RTBI Portal</strong>. Here are your onboarding details:</p>

      <div style="background: #FEF7F6; border: 1px solid #E9E2F0; border-left: 4px solid #CC3D19; padding: 18px 22px; border-radius: 10px; margin: 20px 0; font-size: 13px;">
        <p style="margin: 0 0 8px 0; color: #76648B;"><strong>Designation / Role:</strong> <span style="color: #1C0F2A; font-weight: 700; font-size: 14px;">${roleStr}</span></p>
        <p style="margin: 0 0 8px 0; color: #76648B;"><strong>Division:</strong> <span style="color: #1C0F2A; font-weight: 600;">${divisionStr}${departmentStr}</span></p>
        <p style="margin: 0; color: #76648B;"><strong>Registered Email:</strong> <span style="color: #CC3D19; font-family: monospace; font-weight: 600;">${member.email}</span></p>
      </div>

      <div style="background: #FEF4F1; border: 1px solid #FAC9BD; padding: 16px 20px; border-radius: 10px; margin: 20px 0;">
        <h4 style="margin: 0 0 6px 0; color: #CC3D19; font-size: 14px; font-weight: 700;">Password Setup Instructions</h4>
        <p style="margin: 0; color: #422C5C; font-size: 13px; line-height: 1.5;">When you log in for the first time, simply enter your registered email address (<strong>${member.email}</strong>). You will be prompted directly to set up your password.</p>
      </div>

      <div style="text-align: center; margin: 28px 0;">
        <a href="${baseUrl}" style="display: inline-block; background: #CC3D19; color: #ffffff; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 10px; text-decoration: none;">
          Log In & Set Up Password &rarr;
        </a>
      </div>

      <p style="color: #76648B; font-size: 12px; line-height: 1.5; margin-bottom: 0;">If you have any questions or require assistance, please reach out to your Administrator.</p>
    `
  });

  return { subject, bodyText, bodyHtml };
}

/**
 * Template Generator: Email Change Confirmation OTP.
 */
export function generateEmailChangeOtpTemplate(name: string, otp: string, newEmail: string): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `RTBI Portal Email Verification Code: ${otp}`;
  const bodyText = `Hello ${name},\n\n` +
    `A request was made to update your login email to: ${newEmail}\n\n` +
    `Verification Code: ${otp}\n\n` +
    `Valid for 5 minutes. If you did not request this, please ignore this email.\n\n` +
    `Regards,\nRTBI Portal, MSRUAS`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: `Email Address Update`,
    headerSubtitle: `Security Verification Code`,
    badgeText: `Security Verification`,
    badgeColor: `#CC3D19`,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello <strong>${name}</strong>,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">A request was made to update your login email to <strong style="color: #1C0F2A;">${newEmail}</strong>. Use the verification code below to authorize this change:</p>

      <div style="text-align: center; margin: 28px 0;">
        <span style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #1C0F2A; background: #FEF7F6; border: 1px solid #D5CBE1; padding: 14px 28px; border-radius: 10px; display: inline-block;">
          ${otp}
        </span>
        <p style="color: #76648B; font-size: 12px; margin-top: 10px;">Valid for 5 minutes</p>
      </div>

      <p style="color: #76648B; font-size: 12px; line-height: 1.5; margin-bottom: 0;">If you did not request this change, you can safely ignore this message.</p>
    `
  });

  return { subject, bodyText, bodyHtml };
}

/**
 * Template Generator: Email Change OTP — step 2 of 2, sent to the NEW
 * address the member is trying to move to, after they've already proven
 * ownership of the old one. Confirms the OLD address in the copy so the
 * recipient has context even if this lands in an inbox they haven't used
 * with this account before.
 */
export function generateNewEmailConfirmationOtpTemplate(name: string, otp: string, oldEmail: string): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `RTBI Portal — Confirm This Is Your New Email: ${otp}`;
  const bodyText = `Hello ${name},\n\n` +
    `This is the second and final step of moving your RTBI Portal login email away from ${oldEmail} to this address.\n\n` +
    `Verification Code: ${otp}\n\n` +
    `Valid for 5 minutes. If you did not request this, please ignore this email — no change will be made without this code.\n\n` +
    `Regards,\nRTBI Portal, MSRUAS`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: `Confirm Your New Email`,
    headerSubtitle: `Final Step — Security Verification Code`,
    badgeText: `Security Verification`,
    badgeColor: `#CC3D19`,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello <strong>${name}</strong>,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">This is the second and final step of moving your RTBI Portal login email away from <strong style="color: #1C0F2A;">${oldEmail}</strong> to this address. Use the code below to confirm you can receive mail here:</p>

      <div style="text-align: center; margin: 28px 0;">
        <span style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #1C0F2A; background: #FEF7F6; border: 1px solid #D5CBE1; padding: 14px 28px; border-radius: 10px; display: inline-block;">
          ${otp}
        </span>
        <p style="color: #76648B; font-size: 12px; margin-top: 10px;">Valid for 5 minutes</p>
      </div>

      <p style="color: #76648B; font-size: 12px; line-height: 1.5; margin-bottom: 0;">If you did not request this change, you can safely ignore this message — no change will be made without this code.</p>
    `
  });

  return { subject, bodyText, bodyHtml };
}

/**
 * Template Generator: Announcement Alert
 */
export function generateAnnouncementEmailTemplate(memberName: string, title: string, content: string, author: string): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `RTBI Notice: ${title}`;
  const baseUrl = getAppBaseUrl();
  const bodyText = `Hello ${memberName},\n\nA new announcement has been published on the RTBI Portal by ${author}:\n\n` +
    `Title: ${title}\n\n` +
    `Details: ${content}\n\n` +
    `Regards,\nRTBI Portal`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: title,
    headerSubtitle: `Published by ${author}`,
    badgeText: `Official Announcement`,
    badgeColor: `#CC3D19`,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #422C5C;">Hello <strong>${memberName}</strong>,</p>
      <p style="color: #1C0F2A; white-space: pre-wrap; font-size: 14px; line-height: 1.7;">${content}</p>
      <div style="margin-top: 24px; padding-top: 18px; border-top: 1px solid #E9E2F0; text-align: center;">
        <a href="${baseUrl}/dashboard/announcements" style="background: #CC3D19; color: #ffffff; padding: 10px 20px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 12px; display: inline-block;">View in Dashboard &rarr;</a>
      </div>
    `
  });

  return { subject, bodyText, bodyHtml };
}

/**
 * Template Generator: Task Assignment Alert
 */
export function generateTaskEmailTemplate(memberName: string, taskTitle: string, eventName: string, dueDate: string, creatorName: string): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `RTBI Task Assignment: ${taskTitle}`;
  const baseUrl = getAppBaseUrl();
  const bodyText = `Hello ${memberName},\n\nYou have been assigned a new task on RTBI Portal.\n\n` +
    `Task: ${taskTitle}\n` +
    `Context: ${eventName || 'RTBI Operations'}\n` +
    `Due Date: ${dueDate}\n` +
    `Assigned By: ${creatorName || 'RTBI Portal'}\n\n` +
    `Please log in to your dashboard to view details and update progress.`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: taskTitle,
    headerSubtitle: `Assigned by ${creatorName || 'RTBI Portal'}`,
    badgeText: `Task Assignment`,
    badgeColor: `#CC3D19`,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #422C5C;">Hello <strong>${memberName}</strong>,</p>
      <p style="color: #422C5C; font-size: 14px;">You have been assigned a deliverable on the RTBI Portal:</p>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #422C5C; margin: 16px 0;">
        <tr>
          <td style="padding: 8px 0; color: #76648B; width: 120px;">Context:</td>
          <td style="padding: 8px 0; font-weight: 600; color: #1C0F2A;">${eventName || 'RTBI Operations'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #76648B;">Due Date:</td>
          <td style="padding: 8px 0; font-weight: 700; color: #1C0F2A;">${dueDate}</td>
        </tr>
      </table>

      <div style="margin-top: 20px; text-align: center;">
        <a href="${baseUrl}/dashboard/tasks" style="background: #CC3D19; color: #ffffff; padding: 10px 20px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 12px; display: inline-block;">Open Tasks Desk &rarr;</a>
      </div>
    `
  });

  return { subject, bodyText, bodyHtml };
}

/**
 * Template Generator: Task Deadline Reminder (sent 1 day before dueDate)
 */
export function generateTaskDeadlineReminderEmailTemplate(memberName: string, taskTitle: string, eventName: string, dueDate: string): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `Deadline Tomorrow: ${taskTitle}`;
  const baseUrl = getAppBaseUrl();
  const bodyText = `Hello ${memberName},\n\nThis is a reminder that the following task is due tomorrow.\n\n` +
    `Task: ${taskTitle}\n` +
    `Context: ${eventName || 'RTBI Operations'}\n` +
    `Due Date: ${dueDate}\n\n` +
    `Please log in to your dashboard to review and complete it in time.`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: taskTitle,
    headerSubtitle: `Due ${dueDate}`,
    badgeText: `Deadline Reminder`,
    badgeColor: `#d97706`,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #422C5C;">Hello <strong>${memberName}</strong>,</p>
      <p style="color: #422C5C; font-size: 14px;">This is a reminder that the following task is due <strong>tomorrow</strong>:</p>

      <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #422C5C; margin: 16px 0;">
        <tr>
          <td style="padding: 8px 0; color: #76648B; width: 120px;">Context:</td>
          <td style="padding: 8px 0; font-weight: 600; color: #1C0F2A;">${eventName || 'RTBI Operations'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #76648B;">Due Date:</td>
          <td style="padding: 8px 0; font-weight: 700; color: #d97706;">${dueDate}</td>
        </tr>
      </table>

      <div style="margin-top: 20px; text-align: center;">
        <a href="${baseUrl}/dashboard/tasks" style="background: #d97706; color: #ffffff; padding: 10px 20px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 12px; display: inline-block;">Open Tasks Desk &rarr;</a>
      </div>
    `
  });

  return { subject, bodyText, bodyHtml };
}

export function generateBirthdayEmailTemplate(memberName: string): { subject: string; bodyText: string; bodyHtml: string } {
  const firstName = memberName.split(' ')[0] || memberName;
  const subject = `Happy Birthday, ${firstName}!`;
  const bodyText = `Hello ${memberName},\n\n` +
    `Wishing you a very Happy Birthday from all of us at RTBI Portal!\n\n` +
    `Warm regards,\nRTBI Portal, MSRUAS`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: `Happy Birthday, ${firstName}!`,
    headerSubtitle: `From everyone at RTBI Portal`,
    badgeText: `Greetings`,
    badgeColor: `#CC3D19`,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Dear <strong>${memberName}</strong>,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">On behalf of the entire RTBI Portal family, we wish you a wonderful birthday! Thank you for your energy and dedication.</p>
      <p style="color: #76648B; font-size: 13px; line-height: 1.6; margin-bottom: 0;">Have a fantastic year ahead!</p>
    `
  });

  return { subject, bodyText, bodyHtml };
}

/**
 * Template Generator: Design Captions Approved (sent with the design asset
 * re-attached and the approved Instagram/LinkedIn caption text inline, once
 * the caption reviewer marks captionStatus 'approved' — see
 * reviewDesignCaptions in local-data.ts).
 */
export function generateCaptionsApprovedEmailTemplate(
  designTitle: string,
  designerName: string,
  instagramCaption?: string,
  linkedinCaption?: string
): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `Captions Approved: ${designTitle}`;
  const captionBlockText = [
    instagramCaption ? `Instagram caption:\n${instagramCaption}` : '',
    linkedinCaption ? `LinkedIn caption:\n${linkedinCaption}` : '',
  ].filter(Boolean).join('\n\n');
  const bodyText = `Hello,\n\n` +
    `The captions for design "${designTitle}", submitted by ${designerName}, have been approved and the design is now ready to post.\n\n` +
    `${captionBlockText}\n\n` +
    `The final asset is attached to this email.\n\n` +
    `Regards,\nRTBI Portal, MSRUAS`;

  const captionBlockHtml = (label: string, text?: string) => text ? `
      <div style="background: #FEF7F6; border-left: 3px solid #E86848; padding: 10px 14px; border-radius: 4px; margin: 10px 0;">
        <p style="margin: 0 0 4px; color: #1C0F2A; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em;">${label}</p>
        <p style="margin: 0; color: #422C5C; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${text}</p>
      </div>
    ` : '';

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: `Captions Approved`,
    headerSubtitle: designTitle,
    badgeText: `Ready to Post`,
    badgeColor: `#15803d`,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">The captions for design <strong>${designTitle}</strong>, submitted by <strong>${designerName}</strong>, have been approved and the design is now ready to post.</p>
      ${captionBlockHtml('Instagram Caption', instagramCaption)}
      ${captionBlockHtml('LinkedIn Caption', linkedinCaption)}
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">The final asset is attached to this email.</p>
    `
  });

  return { subject, bodyText, bodyHtml };
}

/**
 * Template Generator: Design Style Approved (sent with the design asset
 * attached once the Design Head marks it Style Approved). Doubles as the
 * Centre Head's approval-of-record notice, so it names who submitted the
 * design, when, and who approved it, alongside the attached final asset.
 */
export function generateDesignApprovedEmailTemplate(
  designTitle: string,
  designerName: string,
  submittedAt?: string,
  approvedByName?: string
): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `Design Approved: ${designTitle}`;
  const submittedAtFormatted = submittedAt ? new Date(submittedAt).toLocaleString() : undefined;

  const bodyText = `Hello,\n\n` +
    `The design "${designTitle}", submitted by ${designerName}` +
    (submittedAtFormatted ? ` on ${submittedAtFormatted}` : '') +
    `, has been Style Approved` +
    (approvedByName ? ` by ${approvedByName}` : '') +
    `.\n\n` +
    `The final asset is attached to this email.\n\n` +
    `Regards,\nRTBI Portal, MSRUAS`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: `Design Approved`,
    headerSubtitle: designTitle,
    badgeText: `Style Approved`,
    badgeColor: `#15803d`,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">The design <strong>${designTitle}</strong> has been Style Approved${approvedByName ? ` by <strong>${approvedByName}</strong>` : ''}.</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">Submitted by <strong>${designerName}</strong>${submittedAtFormatted ? ` on <strong>${submittedAtFormatted}</strong>` : ''}.</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">The final asset is attached to this email.</p>
    `
  });

  return { subject, bodyText, bodyHtml };
}


/**
 * Template Generator: Design Decision Notification (sent to the designer who
 * submitted the file, every time a proofread or style decision is recorded
 * against their submission — approved or rejected/changes requested). This
 * is the designer-facing counterpart to generateDesignApprovedEmailTemplate
 * (which notifies the Centre Head/Advisor/GG Campus Head of Events instead).
 */
export function generateDesignDecisionEmailTemplate(
  designTitle: string,
  designerName: string,
  stage: 'Proofreading' | 'Style Approval',
  approved: boolean,
  decidedByName: string,
  comments?: string
): { subject: string; bodyText: string; bodyHtml: string } {
  const outcome = approved ? 'Approved' : (stage === 'Proofreading' ? 'Changes Requested' : 'Rejected');
  const subject = `${stage} ${outcome}: ${designTitle}`;
  const bodyText = `Hello ${designerName},\n\n` +
    `Your design submission "${designTitle}" has been reviewed at the ${stage} stage by ${decidedByName}.\n\n` +
    `Decision: ${outcome}\n` +
    (comments ? `Comments:\n${comments}\n\n` : '\n') +
    (approved
      ? `No further action is needed from you at this stage.\n\n`
      : `Please review the feedback above and resubmit or update your design accordingly.\n\n`) +
    `Regards,\nRTBI Portal, MSRUAS`;

  const badgeColor = approved ? '#15803d' : '#be123c';

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: `${stage} ${outcome}`,
    headerSubtitle: designTitle,
    badgeText: outcome,
    badgeColor,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello <strong>${designerName}</strong>,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">Your design submission <strong>${designTitle}</strong> has been reviewed at the <strong>${stage}</strong> stage by <strong>${decidedByName}</strong>.</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">Decision: <strong style="color: ${badgeColor};">${outcome}</strong></p>
      ${comments ? `
      <div style="background: #FEF7F6; border-left: 3px solid ${badgeColor}; padding: 10px 14px; border-radius: 4px; margin: 10px 0;">
        <p style="margin: 0 0 4px; color: #1C0F2A; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em;">Comments</p>
        <p style="margin: 0; color: #422C5C; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${comments}</p>
      </div>` : ''}
      <p style="color: #76648B; font-size: 13px; line-height: 1.6;">${approved ? 'No further action is needed from you at this stage.' : 'Please review the feedback above and resubmit or update your design accordingly.'}</p>
    `
  });

  return { subject, bodyText, bodyHtml };
}

/**
 * Template Generator: Design Resubmitted Notification (sent to the same
 * reviewers who rejected a design — faculty proofreaders, or the Centre
 * Head/Advisor/GG Campus Head of Events panel — once the designer replaces
 * the file to address the feedback). Counterpart to the request/approved
 * templates above, but for the "revised and resubmitted" step in between.
 */
export function generateDesignResubmittedEmailTemplate(
  designTitle: string,
  designerName: string,
  stage: 'Proofreading' | 'Style Approval',
  designLink: string
): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `Design Resubmitted: ${designTitle}`;
  const feedbackLabel = stage === 'Proofreading' ? 'proofread feedback' : 'style feedback';
  const bodyText = `Hello,\n\n` +
    `${designerName} has revised and resubmitted the design "${designTitle}" following your earlier ${feedbackLabel}.\n\n` +
    `Please review the updated asset here:\n${designLink}\n\n` +
    `Regards,\nRTBI Design Portal`;

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: 'Design Resubmitted',
    headerSubtitle: designTitle,
    badgeText: 'Revised & Resubmitted',
    badgeColor: '#EA7153',
    bodyContentHtml: `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;"><strong>${designerName}</strong> has revised and resubmitted the design <strong>${designTitle}</strong> following your earlier ${feedbackLabel}.</p>
      <div style="text-align: center; margin: 24px 0 12px;">
        <a href="${designLink}" target="_blank" style="display: inline-block; background: #EA7153; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 12px; font-weight: 600; font-size: 14px;">
          Review Updated Design
        </a>
      </div>
    `
  });

  return { subject, bodyText, bodyHtml };
}

/**
 * Template Generator: Approval Request Decision (sent to the requester
 * once their request is approved or rejected by a reviewer).
 */
export function generateApprovalDecisionEmailTemplate(
  requesterName: string,
  entityTitle: string,
  entityType: string,
  approved: boolean,
  decidedByName: string,
  comments?: string
): { subject: string; bodyText: string; bodyHtml: string } {
  const typeCapitalized = entityType ? (entityType.charAt(0).toUpperCase() + entityType.slice(1).replace('-', ' ')) : 'Request';
  const outcome = approved ? 'Approved' : 'Rejected';
  const subject = `Approval Request ${outcome}: ${entityTitle} (${typeCapitalized})`;

  const bodyText = `Hello ${requesterName},\n\n` +
    `Your approval request for ${typeCapitalized} "${entityTitle}" has been ${outcome.toLowerCase()} by ${decidedByName}.\n\n` +
    `Decision: ${outcome}\n` +
    (comments ? `Reviewer Comments:\n${comments}\n\n` : '\n') +
    (approved
      ? `Your request has been approved. No further action is required.\n\n`
      : `Please review the comments above and make any necessary adjustments.\n\n`) +
    `Regards,\nRTBI Portal, MSRUAS`;

  const badgeColor = approved ? '#15803d' : '#be123c';

  const bodyHtml = wrapInMasterEmailTemplate({
    pageTitle: subject,
    headerTitle: `${typeCapitalized} ${outcome}`,
    headerSubtitle: entityTitle,
    badgeText: outcome.toUpperCase(),
    badgeColor,
    bodyContentHtml: `
      <p style="margin-top: 0; color: #1C0F2A; font-size: 14px;">Hello <strong>${requesterName}</strong>,</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">Your approval request for <strong>${typeCapitalized}</strong> "<strong>${entityTitle}</strong>" has been reviewed and <strong>${outcome.toLowerCase()}</strong> by <strong>${decidedByName}</strong>.</p>
      <p style="color: #422C5C; font-size: 14px; line-height: 1.6;">Decision: <strong style="color: ${badgeColor};">${outcome}</strong></p>
      ${comments ? `
      <div style="background: #FEF7F6; border-left: 3px solid ${badgeColor}; padding: 10px 14px; border-radius: 4px; margin: 10px 0;">
        <p style="margin: 0 0 4px; color: #1C0F2A; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em;">Reviewer Comments</p>
        <p style="margin: 0; color: #422C5C; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${comments}</p>
      </div>` : ''}
      <p style="color: #76648B; font-size: 13px; line-height: 1.6;">${approved ? 'Your request has been approved. No further action is required.' : 'Please review the comments above and make any necessary adjustments.'}</p>
    `
  });

  return { subject, bodyText, bodyHtml };
}

