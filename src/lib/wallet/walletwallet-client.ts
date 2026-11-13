// WALLETWALLET_API_BASE exists only so tests can point at a local fake server
const API_BASE = process.env.WALLETWALLET_API_BASE || 'https://api.walletwallet.dev';

// Public origin WalletWallet fetches pass images (logo, member photo) from. It must be
// reachable from the internet, so set WALLET_PUBLIC_ORIGIN (or APP_URL) in production —
// the localhost fallback only works for local previews that don't hit WalletWallet.
const SITE_ORIGIN = (process.env.WALLET_PUBLIC_ORIGIN || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3030').replace(/\/+$/, '');
import { gradientStops, luminance, posterFields } from '@/lib/wallet-poster-spec';
import type { PassBarcodeFormat } from '@/lib/local-data';

// Fixed org-wide details shown on the back of every pass — same for every
// member, so they live here rather than on the Member record. Sourced
// verbatim from the pass design finalized in the WalletWallet dashboard;
// double-check these before relying on them (the office email/phone as
// given look like they may have a stray character — see docs/wallet-setup.md).
const ORG_NAME = 'RTBI';
const ORG_EMAIL = 'LEADS.NGC.@MSRUAS.AC.IN'; // TODO(RTBI): replace with the incubator's contact email
const ORG_PHONE = '+91 804536666';
const ORG_ADDRESS = 'RTBI M. S. Ramaiah University of Applied Sciences is University House, New BEL Road, MSR Nagar, Bengaluru - 560054.';

// Pass branding — pale-blue-on-green design finalized in the WalletWallet
// dashboard (see the "Style" tab there to tweak further).
const COLOR_PRESET = 'green';
const CUSTOM_COLOR = '#ebf9ff';

export interface WalletCardMember {
  name: string;
  designation?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  // Icon isn't included — Apple/Google Wallet back fields are plain
  // label/value text with no icon slot, so only label+url matter here.
  customLinks?: { label: string; url: string }[];
  photoUrl?: string;
}

export interface WalletWalletPass {
  serialNumber: string;
  /** base64-encoded .pkpass file contents. */
  applePass: string;
  googleSaveUrl: string;
  shareUrl: string;
}

/**
 * Creates a wallet pass (Apple + Google, one call) via WalletWallet
 * (https://walletwallet.dev/docs/) — see src/lib/wallet/walletwallet-config.ts
 * for where the API key comes from.
 *
 * Field layout matches the design finalized in the WalletWallet dashboard:
 * the primary field's LABEL is the member's designation and its VALUE is
 * their name (so the name renders large, with the designation as the small
 * caption above it), phone/email up front as secondary fields, and the back
 * carries the org's own contact details plus the member's LinkedIn.
 *
 * Uses the member's VPS-hosted photo for the pass thumbnail & icon when available.
 */
export async function createWalletPass(apiKey: string, member: WalletCardMember, cardUrl: string): Promise<WalletWalletPass> {
  const logoUrl = `${SITE_ORIGIN}/images/rtbi-icon.png`;
  const memberPhoto = member.photoUrl
    ? (member.photoUrl.startsWith('http') ? member.photoUrl : `${SITE_ORIGIN}${member.photoUrl}`)
    : logoUrl;

  const secondaryFields = [] as { label: string; value: string }[];
  if (member.phone) secondaryFields.push({ label: 'Phone Number', value: member.phone });
  if (member.email) secondaryFields.push({ label: 'Email ID', value: member.email });

  const backFields = [
    { label: 'Email ID', value: ORG_EMAIL },
    { label: 'Office Mobile Number', value: ORG_PHONE },
    { label: 'Address', value: ORG_ADDRESS },
  ] as { label: string; value: string; changeMessage?: string }[];
  if (member.linkedin) backFields.push({ label: 'LinkedIn', value: member.linkedin });
  for (const link of member.customLinks || []) {
    backFields.push({ label: link.label, value: link.url });
  }
  backFields.push({ label: 'Full Card', value: cardUrl });
  // Placeholder field WalletWallet uses to push a notification to already-
  // installed passes when this pass is updated — %@ is filled in by them.
  backFields.push({ label: 'Notifications', value: ' ', changeMessage: '%@' });

  const res = await fetch(`${API_BASE}/api/passes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      organizationName: ORG_NAME,
      colorPreset: COLOR_PRESET,
      color: CUSTOM_COLOR,
      logoURL: logoUrl,
      iconURL: memberPhoto,
      wideLogoURL: logoUrl,
      thumbnailURL: memberPhoto,
      barcodeValue: cardUrl,
      barcodeFormat: 'QR',
      primaryFields: [{ label: member.designation || ORG_NAME, value: member.name }],
      secondaryFields,
      backFields,
    }),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(`WalletWallet pass creation failed: ${detail.error || res.statusText}`);
  }

  return res.json();
}

export interface WalletEventPassData {
  serialNumber: string;
  /** WalletWallet's own serial for an already-created pass; defaults to serialNumber. */
  walletSerial?: string;
  eventName: string;
  eventDate?: string;
  eventVenue?: string;
  attendeeName: string;
  guestCategory?: string;
  roomOrVenue?: string;
  passType: string;
  validityDate?: string;
  validDays?: string[];
  passColor?: string;
  passGradient?: string;
  /**
   * Event pass theme. Images are sent to WalletWallet as PUBLIC HTTPS URLs (it fetches and re-hosts them
   * once at creation — same approach as the LEADS logo). Values are storage paths such as
   * "/api/files/pass-themes/<eventId>/2__wallet-<ts>.jpg" or absolute https URLs.
   */
  themeBackgroundUrl?: string;
  themeLogoUrl?: string;
  themeColor?: string;
  attendeeOrg?: string;
  /** Public URL of the designed 690×1010 poster artwork (/api/pass/<serial>/wallet-poster?v=…). */
  posterUrl?: string;
  barcodeFormat?: PassBarcodeFormat;
  barcodeAltText?: 'serial' | 'name' | 'none';
  /** The QR is drawn into the poster artwork: send no native barcode. */
  qrInWallet?: boolean;
  /** The designer chose Hide for the event title: keep the event name out of the pass's visible texts too. */
  hideEventTitle?: boolean;
}

/** Days from now until the pass's last valid day (+1 so it stays valid through that day), 1..3650. */
function expirationDaysFor(eventPass: WalletEventPassData): number | undefined {
  const days = [...(eventPass.validDays || [])].sort();
  const last = days[days.length - 1];
  if (!last) return undefined;
  const ms = new Date(`${last}T23:59:59`).getTime() - Date.now();
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(3650, Math.max(1, Math.ceil(ms / 86_400_000) + 1));
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1)/i;

/** Public origin WalletWallet's servers can reach (override with WALLET_PUBLIC_ORIGIN; never a private/local host). */
export function walletPublicOrigin(): string {
  const raw = (process.env.WALLET_PUBLIC_ORIGIN || SITE_ORIGIN).replace(/\/+$/, '');
  try {
    return PRIVATE_HOST.test(new URL(raw).hostname) ? '' : raw;
  } catch {
    return '';
  }
}

/** Turn a stored upload path into the absolute public HTTPS URL WalletWallet fetches. Empty when not reachable. */
export function walletImageUrl(pathOrUrl?: string): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https:\/\//i.test(pathOrUrl)) {
    try {
      return PRIVATE_HOST.test(new URL(pathOrUrl).hostname) ? undefined : pathOrUrl;
    } catch {
      return undefined;
    }
  }
  const origin = walletPublicOrigin();
  return origin ? `${origin}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}` : undefined;
}

/** Blend a hex colour toward `#0b1526` by `t` (0..1). */
function darken(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#0b1526';
  const n = parseInt(m[1], 16);
  const to = [0x0b, 0x15, 0x26];
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c, i) => Math.round(c + (to[i] - c) * t));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The wallet's base `color`. Apple derives the text/label colours from it (light base → dark text), and the
 * poster layout is designed for white text, so a poster pass must always carry a DARK base colour — taken from the
 * pass's own gradient/colour, never from the event theme's base colour (which can be white for the portal card).
 */
export function walletBaseColor(eventPass: WalletEventPassData, poster: boolean): string {
  if (!poster) return eventPass.themeColor || eventPass.passColor || '#0b1526';
  const start = gradientStops(eventPass.passGradient)[0] || eventPass.passColor || '#0b1526';
  return luminance(start) > 0.2 ? darken(start, 0.85) : start;
}

/**
 * Theme/validity fields shared by pass create + update. `backgroundURL` is the designed poster (690×1010 portrait);
 * with a background, iOS 27 switches to Apple's poster layout.
 */
function themeBody(eventPass: WalletEventPassData): Record<string, unknown> {
  const bg = walletImageUrl(eventPass.posterUrl) || walletImageUrl(eventPass.themeBackgroundUrl);
  const out: Record<string, unknown> = { color: walletBaseColor(eventPass, Boolean(bg)) };
  if (bg) out.backgroundURL = bg;
  const logo = walletImageUrl(eventPass.themeLogoUrl);
  if (logo) {
    out.logoURL = logo;
    out.iconURL = logo;
  }
  const exp = expirationDaysFor(eventPass);
  if (exp) out.expirationDays = exp;
  return out;
}


/** Barcode settings: format + the small caption under it. */
function barcodeBody(eventPass: WalletEventPassData, passUrl: string): Record<string, unknown> {
  if (eventPass.qrInWallet) return {};
  const out: Record<string, unknown> = { barcodeValue: passUrl, barcodeFormat: eventPass.barcodeFormat || 'QR' };
  const alt = eventPass.barcodeAltText ?? 'serial';
  if (alt === 'serial') out.barcodeAltText = eventPass.serialNumber;
  else if (alt === 'name') out.barcodeAltText = eventPass.attendeeName.slice(0, 128);
  return out;
}

type WalletField = { label: string; value: string; changeMessage?: string };

/**
 * Field layout for an event pass. With a background the pass renders in Apple's iOS 27 poster layout, which
 * only shows: one header field, up to four primary fields and up to two footer fields (secondaryFields are
 * NOT shown), always in white text with light labels. Without a background we keep the classic layout.
 */
function buildEventFields(eventPass: WalletEventPassData, passUrl: string, opts: { live: boolean; notification?: string }) {
  const cm = opts.live ? { changeMessage: '%@' } : {};
  const f = (label: string, value: string): WalletField => ({ label, value, ...cm });
  const venue = eventPass.roomOrVenue || eventPass.eventVenue || 'Main Auditorium';
  const validity = eventPass.validityDate || eventPass.eventDate || '2026';
  const days = eventPass.validDays?.length || 0;
  const poster = Boolean(walletImageUrl(eventPass.posterUrl) || walletImageUrl(eventPass.themeBackgroundUrl));

  const backFields: WalletField[] = [
    { label: 'Event Name', value: eventPass.eventName },
    { label: 'Venue', value: venue },
    { label: 'Pass Serial ID', value: eventPass.serialNumber },
    { label: 'Valid On', value: validity },
    { label: 'Issuing Authority', value: 'RTBI • RUAS' },
    { label: 'Access Policy', value: 'One pass, one QR — valid on every day shown. Non-transferable. Present at event check-in.' },
    { label: 'Digital Pass Link', value: passUrl },
    { label: 'Notifications', value: opts.notification ?? (opts.live ? 'Pass details updated.' : ' '), changeMessage: '%@' },
  ];

  if (poster) {
    // Short fields only: Apple draws them in one row, over the dark fade baked into the poster artwork.
    const pf = posterFields({
      attendeeName: eventPass.attendeeName,
      guestCategory: eventPass.guestCategory,
      passType: String(eventPass.passType),
      eventName: eventPass.eventName,
      venue,
      validity,
      validDays: eventPass.validDays,
      serial: eventPass.serialNumber,
      validDaysCount: days,
    });
    return {
      headerFields: [f(pf.header.label, pf.header.value)],
      primaryFields: pf.primary.map((x) => f(x.label, x.value)),
      footerFields: pf.footer.map((x) => ({ label: x.label, value: x.value })),
      // Clear classic-layout fields on live updates (e.g. a poster was just added)
      ...(opts.live ? { secondaryFields: [] as WalletField[] } : {}),
      backFields,
    };
  }
  return {
    headerFields: [f('ACCESS', (eventPass.passType || 'VIP PASS').toUpperCase())],
    primaryFields: [f((eventPass.guestCategory || 'GUEST ATTENDEE').toUpperCase(), eventPass.attendeeName)],
    secondaryFields: [f('ROOM / VENUE', venue), f('VALIDITY', validity)],
    ...(opts.live ? { footerFields: [] as WalletField[] } : {}),
    backFields,
  };
}

/**
 * The complete WalletWallet request body for an event pass. Create (POST) and update (PUT) both use it:
 * WalletWallet replaces the stored body on PUT, so an update must carry the full specification.
 */
export function buildPassBody(
  eventPass: WalletEventPassData,
  passUrl: string,
  opts: { live: boolean; notification?: string }
): Record<string, unknown> {
  const logoUrl = `${SITE_ORIGIN}/images/rtbi-icon.png`;
  const themed = themeBody(eventPass);
  const poster = Boolean(themed.backgroundURL);
  return {
    organizationName: ORG_NAME,
    logoText: poster ? 'RTBI' : 'RTBI',
    // iOS shows the description as the title of the "Add pass" sheet, so it follows the Hide choice too
    description: (eventPass.hideEventTitle ? `${eventPass.attendeeName} — ${eventPass.passType}` : `${eventPass.eventName} — ${eventPass.attendeeName}`).slice(0, 200),
    logoURL: logoUrl,
    iconURL: logoUrl,
    ...themed,
    ...barcodeBody(eventPass, passUrl),
    ...buildEventFields(eventPass, passUrl, opts),
  };
}

function debugLog(label: string, body: unknown) {
  if (process.env.WALLET_DEBUG === '1') console.log(`[wallet-debug] ${label}`, JSON.stringify(body));
}

/**
 * Creates an event access pass (Apple Wallet .pkpass + Google Wallet save link) via WalletWallet API.
 */
export async function createEventWalletPass(
  apiKey: string,
  eventPass: WalletEventPassData,
  passUrl: string
): Promise<WalletWalletPass> {
  const body = buildPassBody(eventPass, passUrl, { live: false });
  debugLog('POST /api/passes', body);

  const res = await fetch(`${API_BASE}/api/passes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(`WalletWallet event pass creation failed: ${detail.error || res.statusText}`);
  }

  return res.json();
}

/**
 * Updates an issued event access pass (Apple Wallet + Google Wallet) via WalletWallet API
 * (PUT /api/passes/:serialNumber) with the full specification; installed passes get a live push.
 */
export async function updateEventWalletPass(
  apiKey: string,
  eventPass: WalletEventPassData,
  passUrl: string,
  notificationMsg?: string
): Promise<{ success: boolean; detail?: any }> {
  const body = buildPassBody(eventPass, passUrl, { live: true, notification: notificationMsg });
  debugLog('PUT /api/passes/' + (eventPass.walletSerial || eventPass.serialNumber), body);

  const res = await fetch(`${API_BASE}/api/passes/${encodeURIComponent(eventPass.walletSerial || eventPass.serialNumber)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(`Wallet pass update failed: ${detail.error || res.statusText}`);
  }

  const data = await res.json().catch(() => ({}));
  return { success: true, detail: data };
}

/**
 * Pushes a live lock-screen update / notification to an issued Apple & Google Wallet pass
 * via WalletWallet PUT /api/passes/:serialNumber.
 */
export async function updateEventPassPushNotification(
  apiKey: string,
  serialNumber: string,
  message: string,
  additionalFields?: { [key: string]: string }
): Promise<{ success: boolean; detail?: any }> {
  const updatePayload: any = {
    backFields: [
      { label: 'Notifications', value: message, changeMessage: '%@' },
    ],
  };

  if (additionalFields?.roomOrVenue) {
    updatePayload.secondaryFields = [
      { label: 'ROOM / VENUE', value: additionalFields.roomOrVenue, changeMessage: '%@' },
    ];
  }

  const res = await fetch(`${API_BASE}/api/passes/${encodeURIComponent(serialNumber)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updatePayload),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(`Push notification update failed: ${detail.error || res.statusText}`);
  }

  const data = await res.json().catch(() => ({}));
  return { success: true, detail: data };
}




/**
 * Revokes an issued event pass on every device (DELETE /api/passes/:serialNumber).
 * A 404 means it was never issued / already revoked, which is fine.
 */
export async function revokeEventWalletPass(apiKey: string, serialNumber: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/passes/${encodeURIComponent(serialNumber)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok && res.status !== 404) {
    const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(`WalletWallet pass revoke failed: ${detail.error || res.statusText}`);
  }
}
