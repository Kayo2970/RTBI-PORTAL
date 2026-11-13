/**
 * "Save Contact" that opens the phone's own Contacts app instead of leaving a downloaded .vcf behind.
 *  - Android: an `intent:` URL (action INSERT, contacts MIME type) opens the Contacts editor pre-filled.
 *    Android intents can't carry a photo; the inline/vCard route is the fallback.
 *  - iOS and others: the vCard is opened inline so Safari shows its native "Add to Contacts" sheet.
 *  - Desktop: normal download.
 */
export interface SaveContactFields {
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  title?: string;
  /** Free text kept in the contact's Notes field (e.g. LinkedIn + custom links). */
  notes?: string;
}

/** Escape a value for an Android `intent:` URI extra (S.key=value;). */
function intentValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, ' ').replace(/;/g, '%3B').replace(/=/g, '%3D').replace(/#/g, '%23');
}

export function buildAndroidContactIntent(c: SaveContactFields): string {
  const extras: Array<[string, string | undefined]> = [
    ['name', c.name],
    ['phone', c.phone],
    ['email', c.email],
    ['company', c.company],
    ['job_title', c.title],
    ['notes', c.notes],
  ];
  const body = extras
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `S.${k}=${intentValue(v!.trim())};`)
    .join('');
  return `intent:#Intent;action=android.intent.action.INSERT;type=vnd.android.cursor.dir/contact;${body}end`;
}

export type ContactPlatform = 'android' | 'ios' | 'desktop';

export function detectContactPlatform(ua: string): ContactPlatform {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua))) return 'ios';
  return 'desktop';
}

/** Open the contact in the phone's Contacts app (or download on desktop). `inlineUrl` serves the vCard inline. */
export function saveContactToPhone(opts: {
  contact: SaveContactFields;
  inlineUrl: string;
  downloadFallback: () => void;
}): void {
  const platform = detectContactPlatform(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (platform === 'android') {
    let left = false;
    const onHide = () => {
      if (document.visibilityState === 'hidden') left = true;
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', () => (left = true), { once: true });
    window.location.href = buildAndroidContactIntent(opts.contact);
    // Still here after a moment = the browser blocked the intent (in-app browsers) -> open the vCard inline
    window.setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (!left) window.location.href = opts.inlineUrl;
    }, 1400);
    return;
  }
  if (platform === 'ios') {
    window.location.href = opts.inlineUrl;
    return;
  }
  opts.downloadFallback();
}
