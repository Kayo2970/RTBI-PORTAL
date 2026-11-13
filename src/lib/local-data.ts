import { trackSync } from './sync-status';
import { averageScore } from './rating-criteria';
import { buildStudentFinalScores } from './final-score';
import type { StartupProfile } from './startup-profile';
import { FALLBACK_ORIGIN } from './app-origin';
import { passEmailButtonsHtml } from '@/lib/pass-email-buttons';
import { mergePassTemplate, DEFAULT_PASS_EMAIL_SUBJECT, DEFAULT_PASS_EMAIL_BODY, IMAGE_MARKER, DETAILS_MARKER, safeHttpUrl } from '@/lib/pass-email-template';

// -------------------------------------------------------------
// Session token — attached to every authenticated API call so the server
// can resolve who's actually calling (see src/lib/session.ts). Previously
// no identity was sent at all; routes trusted whatever the request body said.
// -------------------------------------------------------------
const SESSION_TOKEN_KEY = 'rtbi_session_token';

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

export function setSessionToken(token: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(SESSION_TOKEN_KEY, token);
  else localStorage.removeItem(SESSION_TOKEN_KEY);
}

/**
 * Real sign-out: invalidates the session token server-side (best-effort,
 * fire-and-forget — a network hiccup here shouldn't block the local logout
 * the user is already mid-action on) before clearing it locally. Previously
 * "logout" only ever cleared localStorage, so a copied token kept working
 * indefinitely even after the user who copied it signed out.
 */
export function signOutClient(): void {
  if (typeof window === 'undefined') return;
  const token = getSessionToken();
  if (token) {
    fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }).catch(() => {});
  }
  setSessionToken(null);
  localStorage.removeItem('user');
}

/**
 * Clean wipe of all local client storage (localStorage + sessionStorage).
 */
export function clearAllLocalMemory(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getSessionToken();
  return { ...(extra || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** Mirrors the four portal tiers: 1 = Super User, 2 = CEO, 3 = Employee, 4 = Startup. */
export type MemberDivision = 'Super User' | 'CEO' | 'Employee' | 'Startup';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  tier: number;
  division: MemberDivision;
  committee?: string; // Legacy fallback
  department?: string;
  program?: string; // e.g. "B.Tech Computer Science Engineering", "MBA"
  batch?: string; // e.g. "Class of 2025" for Alumni
  passwordHash?: string; // scrypt hash ("salt:hash"), set via password.ts — never plaintext
  hasPassword?: boolean; // client-side only: server derives this from passwordHash and strips the hash itself before sending member data to the browser
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  // Collected once at account activation (or added later from Directory /
  // Settings) — the member's own contact number, stored in the Directory.
  // Separate from cardPhone, which is what shows on the public visiting
  // card and can be edited independently of this.
  phone?: string;
  // "YYYY-MM-DD". Collected once at account activation (or added later from
  // Settings) — used only to match month+day for the daily birthday email
  // (see src/lib/birthday-scheduler.ts). Optional: older members activated
  // before this field existed simply won't get a birthday email until set.
  dateOfBirth?: string;
  // Undefined/'Active' = normal login access. 'Terminated' = login is blocked
  // (see /api/auth/login) but the member row itself, and every historical
  // record that references it by id/name/email, is left untouched.
  status?: 'Active' | 'Terminated';
  terminatedAt?: string;
  terminatedBy?: string;
  avatarData?: string;       // transient: base64 data URL sent on upload, converted server-side
  avatarFileName?: string;   // transient: original filename, paired with avatarData
  avatarUrl?: string;        // servable path under /api/files, backed by a real file on disk
  avatarStorageKey?: string; // path relative to data/uploads
  mustSetupPassword?: boolean; // Super User admin override: user must set password without OTP on next login
  // Who added this record and when — powers the restricted "uploader" edit
  // rule (see permissions.ts's canEditMemberRecordRow): a non-admin editor
  // (Group-Policy-granted EDIT_DIRECTORY, not full base leadership) may edit
  // ONLY the record they personally created, ONLY once, and ONLY within
  // SELF_EDIT_WINDOW_MS of createdAt. createdBy is the adder's email (stable
  // even if their name later changes), matching the createdBy convention
  // already used on EventItem/TaskItem.
  createdBy?: string;
  createdAt?: string;
  selfEditUsedAt?: string; // set the moment a restricted editor spends their one edit
  // Approval workflow for a roster addition submitted by an Executive role
  // (President/Vice President/Chief Coordinator) who is trusted to add
  // members but never bypasses Centre Head sign-off — see permissions.ts's
  // getMemberApprovalRequirement. Absent/'approved' means a normal,
  // immediately-effective member (every member before this feature, and any
  // added directly by base leadership or an unconditional policy grant). The
  // welcome/activation email is deliberately deferred until approval — see
  // submitMemberCreate/approveMemberCreate below and /api/members's POST.
  approvalStatus?: 'pending_create' | 'approved' | 'rejected';
  submittedBy?: string;
  submittedByEmail?: string;
  decidedBy?: string;
  decidedAt?: string;
  rejectionReason?: string;
  // Digital Visiting Card (self-service, public share page at /card/[slug]).
  // Prefixed `card*` to avoid colliding with Guest.visitingCard* (a scanned
  // photo of someone else's physical card, unrelated feature).
  // Startup (tier 4) company profile — logo, about-us, sector/stage etc. — built during account activation.
  startupProfile?: StartupProfile;
  cardEnabled?: boolean; // public page 404s until true
  cardSlug?: string;     // stable URL segment, generated once server-side, immutable
  // Designation normally mirrors `role` (the Directory-set designation) so
  // the card can't show something out of sync with the ERP. The one
  // exception: a Super User (tier 1) may type a free-text override here —
  // gated server-side in members/[id]/route.ts, same treatment as
  // the Super User's custom-role override.
  cardDesignationOverride?: string;
  cardPhone?: string;
  cardSocials?: {
    linkedin?: string;
    // Arbitrary extra links a member wants on their card beyond LinkedIn —
    // each with its own label and either a preset icon key (see
    // src/lib/custom-link-icons.ts) or an uploaded icon image. The upload
    // sub-fields mirror cardPhotoData/cardPhotoFileName/cardPhotoUrl/
    // cardPhotoStorageKey below exactly (transient data URL in, servable
    // URL out). Capped at 5 entries — enforced in validation.ts.
    customLinks?: {
      label: string;
      url: string;
      icon: string;
      customIconUrl?: string;
      customIconStorageKey?: string;
      customIconData?: string;
      customIconFileName?: string;
    }[];
  };
  cardPhotoData?: string;       // transient: base64 data URL sent on upload
  cardPhotoFileName?: string;   // transient: original filename, paired with cardPhotoData
  cardPhotoUrl?: string;        // servable path under /api/files
  cardPhotoStorageKey?: string;
  cardViews?: number;
  // Cached WalletWallet pass (see src/lib/wallet/card-wallet-pass.ts) — set
  // server-side only, never through the members PATCH route/schema.
  // Regenerated automatically when cardPassContentHash no longer matches
  // the member's current card fields.
  cardPassSerial?: string;
  cardPassContentHash?: string;
  cardPassAppleUrl?: string;
  cardPassAppleStorageKey?: string;
  cardPassGoogleSaveUrl?: string;
  // ISO timestamps of each real WalletWallet API call spent regenerating
  // this member's pass — powers the 2-per-15-days rate limit (Super Users
  // exempt) in src/lib/wallet/card-wallet-pass.ts. Pruned to the current
  // 15-day window on each write.
  cardPassGenerations?: string[];
}

// A person encountered outside the org (event guest, sponsor contact, vendor,
// etc.) — sourced from a visiting card, kept in a directory of its own,
// separate from the Member roster and from the ad-hoc Mail Merge tool
// (displayed name — internally still "Guest Invites"/GUEST_INVITES).
export interface Guest {
  id: string;
  name: string;
  organization?: string;
  designation?: string;
  phone?: string;       // Mobile number
  telephone?: string;   // Landline / Telephone number
  email?: string;
  website?: string; // company website
  address?: string;
  linkedin?: string; // LinkedIn profile URL
  notes?: string;
  metBy?: string; // name of the member who met them
  visitingCardData?: string; // transient: base64 data URL sent on upload, converted server-side
  visitingCardFrontData?: string; // transient base64 for front card photo (compulsory in card mode)
  visitingCardBackData?: string;  // transient base64 for back card photo (optional)
  visitingCardFileName?: string;
  visitingCardFrontFileName?: string;
  visitingCardBackFileName?: string;
  visitingCardUrl?: string;  // servable path under /api/files, backed by a real file on disk (defaults to front card)
  visitingCardFrontUrl?: string;
  visitingCardBackUrl?: string;
  visitingCardStorageKey?: string;
  visitingCardFrontStorageKey?: string;
  visitingCardBackStorageKey?: string;
  createdAt: string;
  // Same restricted "uploader" edit rule as Member.createdBy — see
  // permissions.ts's canEditGuestRecord. Email of whoever added this guest.
  createdBy?: string;
  selfEditUsedAt?: string;
}

export interface EventCommittee {
  id: string;
  name: string; // e.g. "Stage & Audio-Visual", "Hospitality & Logistics", "Design & Media"
  leadMemberId?: string;
  leadMemberName?: string;
  memberIds: string[]; // Students participating in this event committee
  // Approval workflow, scoped to this one committee sub-record rather than
  // the whole event. Unlike EventItem's version, there is no policy-tag
  // delegation here -- the approver is always fixed to Centre Head or GG
  // Campus Head of Events (see permissions.ts's isCommitteeApprover), since
  // that's the specific oversight the feature was built for: President and
  // Vice President can create committees and allot students to them, but
  // neither role bypasses this approval the way they do for the event
  // itself. Absent/'approved' means a normal, immediately-effective
  // committee (every committee before this feature, and any created by an
  // approver).
  approvalStatus?: 'pending_create' | 'pending_members' | 'approved' | 'rejected';
  pendingMemberIds?: string[]; // for pending_members: staged roster, applied on approval
  submittedBy?: string;
  submittedByEmail?: string;
  decidedBy?: string;
  decidedAt?: string;
  rejectionReason?: string;
}

export interface EventSponsor {
  id: string;
  name: string;
  // Optional: a sponsor can be added before the amount is finalized, then
  // edited later once the contribution is confirmed.
  amount?: number;
  notes?: string;
}

export interface EventItem {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  // When true, startDate/endDate are placeholders (empty) — the event is
  // confirmed to happen but exact dates aren't set yet. Every date-range
  // display/sort/day-grid-match site must check this before trusting
  // startDate/endDate (see formatEventDateRange below).
  datesTBD?: boolean;
  // Optional: when prep work (bookings, committee formation, design briefs,
  // sponsor outreach...) actually starts, distinct from startDate/endDate
  // (the event's live/on-ground dates). Lets an event be created and shared
  // early — e.g. "planningStartDate: Feb 1" while the event itself runs in
  // March — without pretending the event itself starts on the planning date.
  // Absent/blank means no separate planning phase is tracked; every
  // date-range/timeline display falls back to startDate in that case. Not
  // meaningful (and not shown) when datesTBD is set.
  planningStartDate?: string;
  status: 'planned' | 'active' | 'completed' | 'archived';
  location?: string;
  campus?: 'GG Campus' | 'RTC Campus' | 'Both Campuses';
  committees: EventCommittee[];
  // True for an auto-synced Indian public holiday / festival (see
  // src/lib/holiday-scheduler.ts) rather than a real RTBI event — the
  // Calendar page badges these differently and they're excluded from
  // event-approval/committee/sponsor workflows.
  isHoliday?: boolean;
  // Set server-side when a user explicitly deletes this event's auto-generated
  // 'holiday_social_approval' or 'event_social_post' task (see DELETE
  // /api/tasks/[id]) — tells holiday-scheduler.ts / event-social-scheduler.ts
  // never to recreate that task for this same event on their next run, so a
  // deleted task stays deleted instead of coming back as a "zombie" on the
  // next boot/weekly/daily catch-up.
  socialTaskDismissed?: boolean;
  posterTaskDismissed?: boolean;
  dismissedAutoTaskTypes?: string[];
  // External sponsor contributions. In the Budget module, sponsor money is
  // drawn down against an event's actual spend before the Centre's own
  // budget is counted as used — see getEventSponsorTotal() and the Budget
  // page's getLineItemActual().
  sponsors?: EventSponsor[];
  createdBy?: string;
  // Group Policy approval workflow — set only when the creator/editor's grant came
  // from a policy tag marked "requires approval." Absent/'approved' means normal,
  // immediately-effective events (every event created before this feature, and
  // every one created by someone with a built-in or non-approval-gated grant).
  approvalStatus?: 'pending_create' | 'pending_edit' | 'pending_delete' | 'approved' | 'rejected';
  pendingChange?: Partial<EventItem>; // for pending_edit: the proposed diff, applied on approval
  approverType?: 'CENTER_HEAD' | 'SPECIFIC_MEMBER' | 'POLICY_TAG';
  approverMemberId?: string;
  approverPolicyTagId?: string;
  approvalPolicyName?: string;
  submittedBy?: string;
  submittedByEmail?: string;
  decidedBy?: string;
  decidedAt?: string;
  rejectionReason?: string;
}

export type EventGuestCategory =
  | 'Student'
  | 'Faculty'
  | 'VIP Dignitary'
  | 'Keynote Speaker'
  | 'Industry Partner'
  | 'Alumni'
  | 'Press / Media'
  | 'Organizer / Crew'
  | 'Special Guest'
  | 'Other'
  | string;



// -------------------------------------------------------------
// Multi-day pass validity helpers (one pass, one QR, many days)
// -------------------------------------------------------------
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Expand an inclusive ISO date range into a list of ISO days (capped at 62 days). */
export function expandDateRange(start?: string, end?: string): string[] {
  if (!start || !ISO_DAY_RE.test(start)) return [];
  const last = end && ISO_DAY_RE.test(end) && end >= start ? end : start;
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${last}T00:00:00Z`);
  while (cursor <= stop && days.length < 62) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Human label for a set of valid days, e.g. "10 Oct – 12 Oct 2026" or "10, 12 & 14 Oct 2026". */
export function formatValidDaysLabel(days: string[]): string {
  const sorted = [...days].filter((d) => ISO_DAY_RE.test(d)).sort();
  if (sorted.length === 0) return '';
  const fmt = (iso: string, withYear = false) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  if (sorted.length === 1) return fmt(sorted[0], true);
  const contiguous = expandDateRange(sorted[0], sorted[sorted.length - 1]).length === sorted.length;
  if (contiguous) return `${fmt(sorted[0])} – ${fmt(sorted[sorted.length - 1], true)}`;
  return sorted.map((d) => fmt(d)).join(', ') + ` ${sorted[sorted.length - 1].slice(0, 4)}`;
}


/**
 * Per-event look of event passes: used by the portal keycard/wallet preview, the emailed
 * boarding-pass image and the Apple/Google Wallet pass, so all three always match.
 * Stored server-side under data/uploads/pass-themes/<eventId>/ (deleted with the event).
 */
export interface PassTheme {
  backgroundUrl?: string;   // /api/files/... full-bleed poster artwork
  backgroundKey?: string;   // storageKey of the above
  walletBackgroundUrl?: string; // 690x1010 portrait crop of the artwork, fetched by WalletWallet (public URL)
  walletBackgroundKey?: string;
  /** Emailed boarding-pass ticket. Default (unset/true) = reuse the background above; false = its own design. */
  emailUseBackground?: boolean;
  emailArtworkUrl?: string; // 1160x420 cover crop used inside the ticket card
  emailArtworkKey?: string;
  emailOverlay?: number;
  emailBackgroundColor?: string;
  emailForegroundColor?: string;
  emailLabelColor?: string;
  logoUrl?: string;
  logoKey?: string;
  backgroundColor?: string; // fallback / tint colour behind the artwork (hex)
  foregroundColor?: string; // value text colour (hex)
  labelColor?: string;      // small-caps label colour (hex)
  overlay?: number;         // 0..0.9 darkening layer over the artwork for legibility
  /** Event default for printing the event title on the wallet poster (a pass can override). Unset = auto: only when there is no artwork. */
  showEventTitle?: boolean;
  /** Same idea for the portal 3D card: show (default) or hide the event title on its front. Pass overrides event. */
  showPortalTitle?: boolean;
  updatedAt?: string;
}

export const DEFAULT_PASS_THEME: Required<Pick<PassTheme, 'backgroundColor' | 'foregroundColor' | 'labelColor' | 'overlay'>> = {
  backgroundColor: '#160B2C',
  foregroundColor: '#ffffff',
  labelColor: '#F5A78F',
  overlay: 0.35,
};

export type PassQrShape = 'square' | 'rounded' | 'dots';

export type EventPassType =
  | 'VIP Pass'
  | 'Guest Pass'
  | 'Executive Delegate'
  | 'Student Delegate'
  | 'Keynote Speaker'
  | 'Press / Media'
  | 'Organizer'
  | 'Other'
  | string;

export interface PassAttendanceRecord {
  day: string; // e.g. "Day 1", "Day 2", "2026-10-13"
  date?: string;
  timestamp: string;
  scannedBy: string;
  checkedInBy?: string;
  session?: string;
}

/** Days a pass is valid on. Legacy passes (no validDays) return []. */
export function getPassValidDays(pass: Pick<EventPassItem, 'validDays'>): string[] {
  return Array.isArray(pass.validDays) ? pass.validDays.filter((d) => ISO_DAY_RE.test(d)).sort() : [];
}

/** Attendance progress for a pass, used for "Checked In (2/3 days)" style badges. */
export function getPassAttendanceSummary(pass: EventPassItem): { attended: number; total: number } {
  const validDays = getPassValidDays(pass);
  const attended = (pass.attendance || []).length;
  return { attended, total: validDays.length || Math.max(attended, 1) };
}

/** Merge attendance records by day key (case-insensitive); later records win. */
export function mergeAttendance(
  current: PassAttendanceRecord[] = [],
  incoming: PassAttendanceRecord[] = []
): PassAttendanceRecord[] {
  const out = [...current];
  incoming.forEach((rec) => {
    const idx = out.findIndex((a) => a.day.toLowerCase() === rec.day.toLowerCase());
    if (idx >= 0) out[idx] = { ...out[idx], ...rec, timestamp: out[idx].timestamp };
    else out.push(rec);
  });
  return out;
}

export function isPassValidOn(pass: EventPassItem, isoDay: string): boolean {
  const days = getPassValidDays(pass);
  return days.length === 0 || days.includes(isoDay);
}

export type PassEmailStatus = 'Not Sent' | 'Email Sent' | 'Email Received' | 'Pass Viewed';

export type PassBarcodeFormat = 'QR' | 'PDF417' | 'Aztec' | 'Code128';

/** Everything about a pass's QR that a designer can change. */
export interface PassQrOptions {
  format: PassBarcodeFormat;
  altText: 'serial' | 'name' | 'none';
  dark: string;
  light: string;
  /** Colour of the three corner eyes; '' = same as the dots. */
  eye: string;
  shape: PassQrShape;
  /** RTBI logo in the centre of the QR. */
  logo: boolean;
  /** Draw the styled QR into the wallet artwork instead of Apple/Google's native black-on-white barcode. */
  inWallet: boolean;
}

export const DEFAULT_QR_OPTIONS: PassQrOptions = {
  format: 'QR', altText: 'serial', dark: '#361C6A', light: '#ffffff', eye: '', shape: 'square', logo: true, inWallet: true,
};

type PassQrFields = Pick<EventPassItem, 'qrFormat' | 'qrAltText' | 'qrDark' | 'qrLight' | 'qrEyeColor' | 'qrShape' | 'qrLogo' | 'qrInWallet'>;

export function qrOptionsFromPass(p: Partial<PassQrFields>): PassQrOptions {
  return {
    format: p.qrFormat || DEFAULT_QR_OPTIONS.format,
    altText: p.qrAltText || DEFAULT_QR_OPTIONS.altText,
    dark: p.qrDark || DEFAULT_QR_OPTIONS.dark,
    light: p.qrLight || DEFAULT_QR_OPTIONS.light,
    eye: p.qrEyeColor || '',
    shape: p.qrShape || DEFAULT_QR_OPTIONS.shape,
    logo: p.qrLogo !== false,
    // Default ON: the QR you design is the one drawn on the portal card, the emailed ticket AND the wallet pass
    inWallet: p.qrInWallet !== false,
  };
}

/** Pass fields for the options; defaults are stored as undefined so a PATCH can clear a previous choice. */
export function qrFieldsFromOptions(o: PassQrOptions): PassQrFields {
  const d = DEFAULT_QR_OPTIONS;
  return {
    qrFormat: o.format !== d.format ? o.format : undefined,
    qrAltText: o.altText !== d.altText ? o.altText : undefined,
    qrDark: o.dark.toLowerCase() !== d.dark.toLowerCase() ? o.dark : undefined,
    qrLight: o.light.toLowerCase() !== d.light.toLowerCase() ? o.light : undefined,
    qrEyeColor: o.eye || undefined,
    qrShape: o.shape !== d.shape ? o.shape : undefined,
    qrLogo: o.logo ? undefined : false,
    qrInWallet: o.inWallet ? undefined : false,
  };
}

export interface EventPassItem {
  id: string;
  serialNumber: string;
  eventId: string;
  eventName: string;
  eventDate?: string;
  eventVenue?: string;
  attendeeName: string;
  guestCategory?: EventGuestCategory;
  roomOrVenue?: string;
  attendeeEmail?: string;
  attendeePhone?: string;
  attendeeOrg?: string;
  passType: EventPassType;
  accessTier?: string;
  validityDate?: string;
  /** ISO dates (YYYY-MM-DD) this single pass is valid on. One pass / one QR covers all of them. */
  validDays?: string[];
  seatOrZone?: string;
  notes?: string;
  issuedBy: string;
  issuedByEmail?: string;
  issuedAt: string;
  status: 'Active' | 'Checked In' | 'Cancelled';
  checkedInAt?: string;
  checkedInBy?: string;
  passColor?: string;
  passGradient?: string;
  /** Optional per-pass text/label colours (hex). Override the event theme; unset = auto. */
  textColor?: string;
  labelColor?: string;
  /** Text size multiplier for the designed artwork (wallet poster, ticket). 1 = normal. */
  fontScale?: number;
  /** Print the event title on the wallet poster artwork. Unset = auto (only when the event has no artwork of its own). */
  showEventTitle?: boolean;
  /** Same idea for the portal 3D card: show (default) or hide the event title on its front. Pass overrides event. */
  showPortalTitle?: boolean;
  /** false = paint the portal card with the pass colours/gradient instead of the event artwork (unset = artwork shown). */
  showCardArtwork?: boolean;
  /** QR customisation: wallet barcode format, caption under it, and QR colours on the portal card / ticket. */
  qrFormat?: PassBarcodeFormat;
  qrAltText?: 'serial' | 'name' | 'none';
  qrDark?: string;
  qrLight?: string;
  qrEyeColor?: string;
  qrShape?: PassQrShape;
  /** false hides the centre logo (default shown). */
  qrLogo?: boolean;
  qrInWallet?: boolean;
  attendance?: PassAttendanceRecord[];
  qrPayload: string;
  walletAppleUrl?: string;
  walletGoogleSaveUrl?: string;
  /** Serial assigned by WalletWallet when the wallet pass was created (used for live updates / revoke). */
  walletSerialNumber?: string;
  /**
   * Group Policy approval gate (same pattern as events): a pass created / edited / deleted by someone whose access comes
   * only from a policy that requires approval stays in a pending state until the designated approver signs off.
   * Enforced on the SERVER (lib/approval-gate.ts), not just in the browser.
   */
  approvalStatus?: 'pending_create' | 'pending_edit' | 'pending_delete';
  /** Staged edit awaiting approval (applied on approval). */
  pendingChanges?: Record<string, unknown>;
  submittedBy?: string;
  submittedByEmail?: string;
  approvalPolicyName?: string;
  approverName?: string;
  /** First time the Apple/Google pass was served to a guest (after that, edits are pushed in place instead of re-issuing). */
  walletInstalledAt?: string;
  /** Edited after the wallet pass was created but before any guest took it: rebuilt on the next Add. */
  walletStale?: boolean;
  /** Last successful wallet create/update, and the last error text (cleared on success). */
  walletSyncedAt?: string;
  walletLastError?: string;
  /** Set by the retention scheduler once cached wallet/theme files were removed (event end + 30 days). */
  archivedAt?: string;

  // Email delivery & pass viewing analytics
  emailStatus?: PassEmailStatus;
  emailSentAt?: string;
  emailReceivedAt?: string;
  passViewed?: boolean;
  passViewedAt?: string;
  lastPassViewedAt?: string;
  passViewCount?: number;
}

export interface TaskItem {
  id: string;
  title: string;
  event?: string;
  eventId?: string;
  eventCampus?: 'GG Campus' | 'RTC Campus' | 'Both Campuses';
  eventCommitteeId?: string;
  eventCommitteeName?: string;
  assignee: string;
  assigneeId?: string;
  assigneeEmail?: string;
  // 'group' is an ad-hoc set of individual students picked directly for this
  // task (assigneeIds) — unlike 'committee', it isn't tied to any event's
  // formal EventCommittee record and doesn't require an event at all.
  assigneeType: 'individual' | 'committee' | 'group';
  assigneeIds?: string[]; // set when assigneeType === 'group'
  dueDate: string;
  status: 'Assigned' | 'In Progress' | 'Completed' | 'Pending Extension';
  /** ISO timestamp the task was assigned/created. Older tasks don't have it (see getTaskAssignedDate for the fallback). */
  assignedAt?: string;
  /** ISO timestamp the task was marked Completed (cleared if it is reopened). Not recorded for tasks completed before this existed. */
  completedAt?: string;
  /** True once an extension request on this task was approved; originalDueDate is the deadline before the first extension. */
  extensionGranted?: boolean;
  originalDueDate?: string;
  creatorName?: string;
  extensionReason?: string;
  decidedBy?: string;
  decidedAt?: string;
  ratingScore?: number;
  ratedAt?: string;
  // Set once by task-deadline-scheduler.ts after it emails the assignee(s) a
  // reminder the day before dueDate — the idempotency guard that stops the
  // same task from being reminded on every subsequent daily check.
  deadlineReminderSentAt?: string;
  // Set by syncDesignTask() when this task was auto-created/completed from a
  // Style-Approved Design Portal submission — lets the Ratings page grant
  // Design Heads evaluation rights on it (see permissions.ts) without
  // relying on a fragile title-string match.
  isDesignDeliverable?: boolean;
  isSocialMediaPost?: boolean;
  designCategory?: 'Poster' | 'Postage' | 'Banner' | 'Social Media' | 'Brochure' | 'Certificates' | 'Other';
  workflowType?: 'design_caption_draft' | 'design_caption_review' | 'design_social_posting'
    | 'holiday_social_approval' | 'holiday_design_social'
    // Auto-created the day an event's dates lapse (see event-social-scheduler.ts) —
    // assigned to the senior Head of Design + Core Committee, asking for social
    // media coverage of the just-concluded event.
    | 'event_social_post'
    // Auto-created once an event is approved and dated (see
    // runEventPosterTasks in event-social-scheduler.ts) — a single
    // INDIVIDUAL task (not group/committee) assigned to whoever holds the
    // Head of Design / Social Media Head role, asking for the event's
    // poster/promotional assets ahead of time. Distinct from
    // 'event_social_post', which is post-event recap content assigned to a
    // whole pool.
    | 'event_poster_request'
    // Auto-created the moment an 'event_social_post' task is marked Completed
    // (see updateTask below) — assigned as a group to the Centre Head, Advisor,
    // and GG Campus Events Head, asking them to pick the student who should
    // prepare the report (via the existing delegateAutoTask reassignment flow).
    // Converts in place to 'event_report_request' once that delegation is
    // approved — see updateTask's chain reaction below.
    | 'event_report_assignment'
    // What 'event_report_assignment' becomes once one of the three panel
    // members delegates it to a specific student — that student now submits
    // the formal event report (see EventReportItem) for the same event.
    | 'event_report_request'
    // Administrative task created when a procurement request is approved —
    // assigned to the Centre Head to procure materials. Strictly excluded
    // from ratings and reviews.
    | 'procurement'
    // Auto-created after an event ends for an event committee that was never
    // given any task (see committee-review-scheduler.ts) — arrives already
    // Completed so reviewers rate the committee's overall performance in the
    // Ratings queue, fanning out to every member like any committee task.
    | 'committee_performance_review';
  procurementId?: string;
  isProcurement?: boolean;
  // Only set on workflowType 'design_social_posting' tasks — distinguishes
  // the two separate posting tasks (one per platform) created once captions
  // are approved, so each can be assigned, viewed, and marked complete
  // independently of the other.
  platform?: 'instagram' | 'linkedin';
  designId?: string;
  draftInstagramCaption?: string;
  draftLinkedinCaption?: string;
  approvedInstagramCaption?: string;
  approvedLinkedinCaption?: string;
  // Group Policy approval workflow — mirrors EventItem's fields. Set only when
  // the creator/editor's grant is not one of Tasks' built-in trusted roles
  // (Base Leadership, any Head role, GG Campus tier) or came from an
  // approval-required policy tag; absent/'approved' means a normal,
  // immediately-effective task.
  approvalStatus?: 'pending_create' | 'pending_edit' | 'approved' | 'rejected';
  pendingChange?: Partial<TaskItem>; // for pending_edit: the proposed diff, applied on approval
  approverType?: 'CENTER_HEAD' | 'SPECIFIC_MEMBER' | 'POLICY_TAG';
  approverMemberId?: string;
  approverPolicyTagId?: string;
  approvalPolicyName?: string;
  submittedBy?: string;
  submittedByEmail?: string;
  rejectionReason?: string;
  allottedBy?: string;
  allottedAt?: string;
  // Full history of who this task was routed through and in what order —
  // submitted-for-review, approved/rejected, and delegated/reassigned steps
  // each append an entry rather than overwriting the last one, so the whole
  // chain stays visible even after several rounds (e.g. a committee task
  // sent for review, approved, then later delegated to someone else and
  // approved again). Visible to the Centre Head / GG Campus Events Head —
  // see canViewTaskDelegationTrail in permissions.ts.
  delegationTrail?: TaskDelegationEvent[];
  // 'design' marks a task the creator (typically a Faculty member/professor)
  // flagged as needing a real creative brief up front, rather than a title
  // alone — see briefDescription/attachments below. Purely a UI/creation-time
  // affordance: it doesn't change any approval or visibility rule.
  taskCategory?: 'general' | 'design' | 'reportWriting';
  // Free-text brief of what the requester wants from the deliverable — only
  // collected/shown when taskCategory === 'design', but stored generically
  // in case a future task type wants the same field.
  briefDescription?: string;
  // Optional reference link to an editable Canva file/template — same
  // taskCategory === 'design' scope as briefDescription above, surfaced to
  // the designer who picks this brief up from the Design Portal's "Design
  // Task Requests" queue (src/app/dashboard/designs/page.tsx).
  canvaLink?: string;
  // Reference files (mockup examples, logos, style guides, past posters...)
  // the requester attaches for the designer to work from. Stored server-side
  // as real files under data/uploads/tasks/<taskId>/ (see saveBase64File) —
  // this array only ever holds name/url/storageKey/type, never raw bytes.
  attachments?: ReceiptFile[];
  // Individual acknowledgment trail — which specific member id(s) have
  // personally acknowledged this task (see acknowledgeTask/hasAcknowledgedTask
  // below). For a 'group'/'committee' task with several assignees, each one
  // must acknowledge for themselves: one member acknowledging never marks it
  // acknowledged for the others, and only ever the acting member's own id is
  // ever appended here — never a groupmate's, and never by leadership acting
  // on someone else's behalf. The legacy acknowledged/acknowledgedAt/
  // acknowledgedByEmail fields below still record the very first
  // acknowledgment on the task for backward-compatible audit display.
  acknowledgedByIds?: string[];
  acknowledged?: boolean;
  acknowledgedAt?: string;
  acknowledgedByEmail?: string;
}

/** Check if a member belongs to Faculty or holds a professor title. */
export function isFacultyMember(member: { division?: string; role?: string } | null | undefined): boolean {
  if (!member) return false;
  const role = (member.role || '').toLowerCase();
  return role.includes('faculty') || role.includes('professor') || role.includes('prof.');
}

/** Check if a member belongs to the student Social Media team. Professors/Faculty are strictly excluded. */
export function isSocialMediaTeamMember(member: { division?: string; department?: string; committee?: string; role?: string; status?: string } | null | undefined): boolean {
  if (!member || isFacultyMember(member) || member.status === 'Terminated') return false;
  const dept = (member.department || '').toLowerCase();
  const comm = (member.committee || '').toLowerCase();
  const role = (member.role || '').toLowerCase();
  return (
    dept.includes('social media') ||
    comm.includes('social media') ||
    role.includes('social media')
  );
}

/** Check if a member is the Head or Senior Head of Social Media. */
export function isSocialMediaHeadOrSrHead(member: { division?: string; department?: string; committee?: string; role?: string; status?: string } | null | undefined): boolean {
  if (!member || isFacultyMember(member) || member.status === 'Terminated') return false;
  if (!isSocialMediaTeamMember(member)) return false;
  const role = (member.role || '').toLowerCase();
  return role.includes('head') || role.includes('lead');
}

/** Check if a member is the Head of Social Media (non-senior). */
export function isSocialMediaHead(member: { division?: string; department?: string; committee?: string; role?: string; status?: string } | null | undefined): boolean {
  if (!member || isFacultyMember(member) || member.status === 'Terminated') return false;
  if (!isSocialMediaTeamMember(member)) return false;
  const role = (member.role || '').toLowerCase();
  return (role.includes('head') || role.includes('lead')) && !role.includes('senior') && !role.includes('sr');
}

/** Check if a member is the Senior Head of Social Media. */
export function isSocialMediaSrHead(member: { division?: string; department?: string; committee?: string; role?: string; status?: string } | null | undefined): boolean {
  if (!member || isFacultyMember(member) || member.status === 'Terminated') return false;
  if (!isSocialMediaTeamMember(member)) return false;
  const role = (member.role || '').toLowerCase();
  return (role.includes('head') || role.includes('lead')) && (role.includes('senior') || role.includes('sr.') || role.includes('sr '));
}

/** Check if a task is a social media posting/design deliverable task. */
export function isSocialMediaPostTask(task: {
  title?: string;
  workflowType?: string;
  taskCategory?: string;
  isSocialMediaPost?: boolean;
  platform?: string;
} | null | undefined): boolean {
  if (!task) return false;
  if (task.workflowType === 'design_social_posting' || task.workflowType === 'holiday_design_social' || task.workflowType === 'event_social_post') {
    return true;
  }
  if (task.isSocialMediaPost === true) return true;
  if (task.platform === 'instagram' || task.platform === 'linkedin') return true;
  const title = (task.title || '').toLowerCase();
  return title.includes('social media') || title.includes('[social media posting]');
}

export interface TaskDelegationEvent {
  action: 'submitted_for_review' | 'approved' | 'rejected' | 'delegated';
  actorName: string;
  actorEmail?: string;
  // The person the task was routed to (the requested reviewer on
  // 'submitted_for_review'/'delegated') or reassigned to (on 'approved',
  // when the approval merged a pending assignee change).
  targetName?: string;
  note?: string;
  at: string;
}

/**
 * A General Secretary's post-event writeup, uploaded as a finished file
 * (Word/PDF) rather than authored in-app. Requires sign-off from BOTH the
 * Centre Head and the GG Campus Head of Events independently — mirrors the
 * dual-reviewer requirement already used for Ratings — before it's
 * considered approved. Once both have signed off, the server emails the
 * uploaded file as an attachment to the Centre Head, the GG Campus Head of
 * Events, and the President (see /api/event-reports/[id]'s PATCH handler).
 */
export interface EventReportItem {
  id: string;
  eventId: string;
  eventTitle: string;
  fileUrl?: string;
  storageKey?: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  submittedBy: string;
  submittedByEmail: string;
  submittedAt: string;
  centreHeadApproved: boolean;
  centreHeadApprovedBy?: string;
  centreHeadApprovedAt?: string;
  eventsHeadGgApproved: boolean;
  eventsHeadGgApprovedBy?: string;
  eventsHeadGgApprovedAt?: string;
  status: 'pending_review' | 'approved' | 'rejected';
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  centreHeadComments?: string;
  eventsHeadGgComments?: string;
  reviewerComments?: string;
  // Whether the final approved-attachment email actually went out — set by
  // the server once both approvals land (see the honest-delivery-status
  // precedent in account-activation.ts). A false value with emailError set
  // means the report IS approved but nobody was actually emailed yet.
  emailSent?: boolean;
  emailError?: string;
  // Report Writing rubric scores (see rating-criteria.ts's RATING_CRITERIA.
  // reportWriting), entered by whichever of the Centre Head / GG Campus Head
  // of Events reviews the report — same trust level as approving it. Feeds
  // the decay-weighted Final Score on the Ratings page (report-scoring.ts).
  reportScores?: Record<string, number>;
  reportScore?: number;
  scoredBy?: string;
  scoredAt?: string;
}

/**
 * An ad-hoc, requester-picks-anyone sign-off request: "please approve this
 * Task/Committee/Event/Member for me" sent to one specific member, distinct
 * from the built-in Group Policy approval gates on TaskItem/EventItem/
 * EventCommittee/Member (approvalStatus/approverType/etc.), which only fire
 * for members whose sole grant for that action came from an
 * approval-required policy tag. This is a manual request any member can
 * raise on any task/committee/event/member they can see, addressed to any
 * other member of their choosing (typically the Centre Head or GG Campus
 * Events Head) — it never blocks or gates the underlying record, it's purely
 * a tracked ask-and-answer AFTER the thing already exists. This is what
 * covers a roster addition made by an Executive role (President/Vice
 * President/Chief Coordinator): they add the member immediately by their own
 * designation (see permissions.ts's getMemberApprovalRequirement), then can
 * raise one of these afterward for oversight — never a pre-approval gate.
 */
export interface ApprovalRequest {
  id: string;
  entityType: 'task' | 'committee' | 'event' | 'member' | 'design' | 'event-report' | 'announcement' | 'procurement' | 'form' | 'event-pass' | 'proposal';
  entityId: string;
  entityTitle: string;
  /** For 'event-pass' requests: what the requester wants to do (issue / edit / delete / dispatch) and the data needed to carry it out once approved. */
  action?: 'issue' | 'edit' | 'delete' | 'dispatch' | 'reissue';
  payload?: Record<string, unknown>;
  // Set for 'task' (its parent event, if any) and 'committee' (its owning
  // event) so the UI can deep-link back to where the item actually lives.
  eventId?: string;
  requesterId: string;
  requesterName: string;
  requesterEmail?: string;
  targetMemberId: string;
  targetMemberName: string;
  targetMemberEmail?: string;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
  // Set on rows created automatically by the server (see approval-sync.ts)
  // when Events/Festivals/Tasks/Designs/Event-Reports/Announcements need
  // sign-off from the Centre Head, Advisor, or GG Campus Events Head — one
  // row is fanned out per eligible approver so any one of them can act, and
  // whichever decides first resolves the other sibling rows automatically.
  autoGenerated?: boolean;
  approverLabel?: string;
}

export interface RatingItem {
  id: string;
  /** Auto-generated when the task was completed late with no extension (see describeTaskLateness). */
  lateNote?: string;
  taskId: string;
  taskTitle: string;
  eventId?: string;
  eventName?: string;
  targetId: string; // Member ID
  targetName: string; // Member Name
  raterName: string;
  // Which reviewer slot this rating fills — see permissions.ts's
  // resolveRatingReviewerRole. SUPER_USER, CENTRE_HEAD, ADVISOR, and GG_HEAD are
  // averaged together into the task's ratingScore (see recomputeTaskAggregateScore below);
  // DESIGN_HEAD is the design-deliverable lane.
  reviewerRole?: 'SUPER_USER' | 'CENTRE_HEAD' | 'ADVISOR' | 'GG_HEAD' | 'DESIGN_HEAD';
  // Which 5-criterion rubric this rating was scored against (see
  // rating-criteria.ts) — General/Design/Report Writing. Undefined on
  // ratings created before this field existed.
  criteriaSet?: 'general' | 'design' | 'reportWriting';
  // The actual per-criterion scores (keyed by RATING_CRITERIA[criteriaSet]'s
  // `key`s), populated for every rating submitted after this field existed.
  scores?: Record<string, number>;
  // Legacy fixed 4-criteria fields. Still populated (as a best-effort
  // projection of `scores`, see projectLegacyRatingFields) on every new
  // rating so existing analytics/exports built around exactly these 4
  // fields (report-generator.ts, reports/page.tsx, student-profile-modal.tsx)
  // keep working unchanged; on ratings created before criteriaSet existed,
  // these are the only scores that ever existed.
  quality: number;
  timeliness: number;
  initiative: number;
  collaboration: number;
  overallScore: number;
  notes?: string;
  quarter?: string; // e.g. "2026-Q3"
  createdAt: string;
  updatedAt?: string;
  // True ONLY on the master bookkeeping row a committee/group task's rating
  // is originally submitted against (targetId/targetName is the committee's
  // or group's placeholder string, not a real person — see addRating below,
  // which immediately fans this out into one real per-member row each via
  // propagateCommitteeRating/propagateGroupRating). This row is kept around
  // so the app can detect "has this reviewer already scored this task" and
  // show a live running average in the Task Evaluation Queue, but it must
  // never be treated as if it were a real rated person: every place that
  // lists, aggregates, or exports ratings by target should filter it out.
  isGroupPlaceholder?: boolean;
}

export interface ReceiptFile {
  name: string;
  dataUrl?: string; // legacy: inline base64 — new uploads use url/storageKey instead
  url?: string; // servable path under /api/files, backed by a real file on disk
  storageKey?: string; // path relative to data/uploads
  type?: string;
}

export interface ReimbursementItem {
  id: string;
  memberName: string;
  memberEmail: string;
  amount: number;
  category: string;
  description: string;
  receiptUrl?: string;
  receiptData?: string; // Legacy fallback
  receiptFiles?: ReceiptFile[]; // Up to 3 attached bills & supporting documents
  status: 'Pending' | 'Verified by Centre Head' | 'Under Review' | 'Approved' | 'Denied';
  bankDetails: string; // Summary string formatted for legacy/display
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  submittedAt: string;
  centreHeadVerified?: boolean;
  centreHeadVerifiedBy?: string;
  centreHeadVerifiedAt?: string;
  firstPassReviewer?: string;
  finalApprover?: string;
  decidedAt?: string;
  eventId?: string;
  eventName?: string;
}

export interface BudgetLineItem {
  id?: string;
  eventId?: string;  // set when the line item points at an existing event
  eventName: string; // display label
  category?: string; // 'Event' | 'Operational' | 'Equipment' | 'Marketing' | 'Logistics' | 'Other'
  amount: number;    // Proposed / Amount alias for compatibility
  proposedAmount?: number;
  actualAmount?: number;
  variance?: number;
}

export interface BudgetItem {
  id: string;
  // Indian financial year, 'YYYY-YYYY' (Apr 1 - Mar 31), e.g. "2026-2027"
  financialYear?: string;
  type: 'annual' | 'event' | 'monthly';
  eventId?: string;  // set when type === 'event'
  eventName?: string;
  month?: string;    // set when type === 'monthly', 'YYYY-MM'
  amount: number;    // Proposed amount alias
  proposedAmount?: number;
  actualAmount?: number;
  variance?: number;
  lineItems?: BudgetLineItem[];
  notes?: string;
  submittedBy: string;
  submittedByEmail?: string;
  submittedAt: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  // Stage-1 checkpoint: the Centre Head must verify a Pending budget before
  // the Finance Head can give the stage-2 final decision, mirroring the
  // Reimbursement module's Centre-Head-verify -> Finance-Head-approve flow.
  centreHeadVerified?: boolean;
  centreHeadVerifiedBy?: string;
  centreHeadVerifiedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNotes?: string;
}

export interface ProcurementItemLine {
  name: string;
  quantity: number;
  unit?: string;
  notes?: string;
}

// A materials request any member can raise for an event or a task — approved
// or rejected only by the Centre Head or the Advisor (see
// permissions.ts's canDecideProcurementRequest), never the wider leadership
// panel other modules use. Once Approved or Completed it's visible to
// everybody; while Pending or Rejected it's visible only to the requester
// and to whoever can decide it (see permissions.ts's canViewProcurementRequest).
// 'Completed' is a distinct stage after 'Approved' — set once the items have
// actually been procured/issued to the requester, by the same Centre
// Head/Advisor gate (see permissions.ts's canDecideProcurementRequest).
export interface ProcurementRequestItem {
  id: string;
  requesterId?: string;
  requesterName: string;
  requesterEmail: string;
  eventId?: string;
  eventName?: string;
  taskId?: string;
  taskTitle?: string;
  items: ProcurementItemLine[];
  justification?: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Completed';
  decidedBy?: string;
  decidedAt?: string;
  decisionNotes?: string;
  completedBy?: string;
  completedAt?: string;
  submittedAt: string;
  // The correlated Task assigned to the Centre Head to procure the items
  procurementTaskId?: string;
  // Set server-side by /api/procurement-requests's POST handler once the
  // Centre Head + Advisor approval email actually goes out.
  approvalEmailSent?: boolean;
  approvalEmailError?: string;
  // Set server-side by /api/procurement-requests/[id]'s PATCH handler once
  // the requester is emailed the decision.
  decisionEmailSent?: boolean;
  decisionEmailError?: string;
}

export interface IncomeSourceItem {
  id: string;
  name: string; // e.g. "TCS Sponsorship", "Alumni Innovation Grant"
  amount: number;
  type?: 'sponsor' | 'grant' | 'donation' | 'other';
  eventId?: string; // Linked event ID (optional: if omitted, this is General Centre Income)
  eventName?: string; // Linked event title
  financialYear: string; // e.g. "2026-2027"
  notes?: string;
  receivedDate?: string;
  submittedBy?: string;
  createdAt: string;
}


export interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  scope: string; // 'All Members' | 'Advisory Board' | 'Core Committee' | 'Training Associate' | 'Alumni'
  authorName: string;
  publishedAt: string;
  editedAt?: string;
  status?: 'Pending Approval' | 'Approved' | 'Rejected';
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  emailSent?: boolean;
}

export interface FormField {
  id: string;
  label: string;
  // 'multiselect' is a multiple-choice question where the respondent can
  // tick one OR several of the listed options (stored as string[] in the
  // submission), as distinct from 'select' (exactly one option, a string)
  // and 'checkbox' (a single yes/no toggle).
  type: 'text' | 'email' | 'textarea' | 'select' | 'checkbox' | 'multiselect' | 'number' | 'scale';
  options?: string[];
  required: boolean;
  /**
   * Pre-filled answer shown on the public form (respondents can still change it). `string` for text-like
   * fields, a single option for 'select', `string[]` for 'multiselect', `true` for a ticked 'checkbox'.
   */
  defaultValue?: string | string[] | boolean;
  /** Take the default from the linked event instead of a typed value (text-like fields only). */
  defaultSource?: 'event_name' | 'event_date' | 'event_venue';
  /** Show the default to respondents but don't let them change it (only applies when the default resolves to something). */
  lockDefault?: boolean;
}

export interface FormEventInfo {
  name?: string;
  date?: string;
  venue?: string;
}

/** A pre-filled answer is locked (read-only for respondents) unless the builder explicitly turned the lock off. */
export function hasLockedDefault(field: FormField): boolean {
  return field.lockDefault !== false && (field.defaultValue !== undefined || field.defaultSource !== undefined);
}

/** The value a public form should start this field with (typed default or the linked event's detail). */
export function resolveFieldDefault(field: FormField, event?: FormEventInfo | null): string | string[] | boolean | undefined {
  if (field.defaultSource) {
    const v = field.defaultSource === 'event_name' ? event?.name : field.defaultSource === 'event_date' ? event?.date : event?.venue;
    if (v) return v;
    // No linked event (or it lacks that detail): fall back to a typed value if there is one
  }
  return field.defaultValue;
}

export interface PublicFormItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** Optional banner line shown at the top of the public form. */
  headerText?: string;
  /** Optional banner picture across the top of the public form (uploaded, or an image link). */
  headerImageUrl?: string;
  /** How the header picture is framed in the banner: focal point (0-100 each), zoom (100-300 %) and banner height (px). */
  headerPosX?: number;
  headerPosY?: number;
  headerZoom?: number;
  headerHeight?: number;
  /** Optional picture used instead of the standard animated background on the public form only. */
  backgroundImageUrl?: string;
  /** Blur applied to the background picture, in px (0 = sharp). */
  backgroundBlur?: number;
  /** How much the background picture is darkened, 0-80 (%). */
  backgroundDim?: number;
  fields: FormField[];
  committee: string;
  createdBy: string;
  // Stamped by the server on creation (never trusted from the client). Training Associates can only see/edit the forms
  // they created, matched on createdById; createdByDivision routes their approvals (see approval-sync.ts).
  createdById?: string;
  createdByDivision?: string;
  createdAt: string;
  isSample?: boolean;
  status: 'active' | 'archived';
  // ISO UTC timestamp after which the public form stops accepting responses and shows a "currently closed"
  // message instead. Unset = never closes. See isFormClosed().
  closeAt?: string;
  eventId?: string;
  eventName?: string;
  // Set when this form was built from a FormTemplateItem via the "Start from
  // Template" picker. Drives template-exclusive features — e.g. the
  // Feedback Form Template's "download filled Word copy" button only shows
  // for forms whose sourceTemplateId matches that specific template's id.
  sourceTemplateId?: string;
  // Group Policy approval workflow — mirrors EventItem/TaskItem's fields. A
  // form's public link (/forms/[slug]) only actually resolves once it's
  // 'approved' (or carries no approvalStatus at all, i.e. was built before
  // this feature, or by someone in Forms' trusted role set).
  approvalStatus?: 'pending_create' | 'pending_edit' | 'pending_delete' | 'approved' | 'rejected';
  pendingChange?: Partial<PublicFormItem>;
  approverType?: 'CENTER_HEAD' | 'SPECIFIC_MEMBER' | 'POLICY_TAG';
  approverMemberId?: string;
  approverPolicyTagId?: string;
  approvalPolicyName?: string;
  submittedBy?: string;
  submittedByEmail?: string;
  decidedBy?: string;
  decidedAt?: string;
  rejectionReason?: string;
}

export interface FormTemplateItem {
  id: string;
  name: string;
  description?: string;
  fields: FormField[];
  createdBy: string;
  createdAt: string;
  /** Built-in template the admin has edited (saved copy overrides the in-code one). */
  customized?: boolean;
  /** Built-in template the admin has deleted (hidden until restored). Only meaningful on built-in ids. */
  deleted?: boolean;
}

export interface FormSubmissionItem {
  id: string;
  formId: string;
  slug: string;
  data: Record<string, any>;
  submittedAt: string;
  isSample?: boolean;
}

export interface DesignProofreadReview {
  proofreaderId: string;
  proofreaderName: string;
  status: 'Pending Proofread' | 'Proofread Approved' | 'Changes Requested';
  comments?: string;
  reviewedAt?: string;
}

export interface DesignSubmissionItem {
  id: string;
  title: string;
  description?: string;
  category: 'Poster' | 'Postage' | 'Banner' | 'Social Media' | 'Brochure' | 'Certificates' | 'Other';
  fileData?: string;      // legacy: inline base64 — new uploads use fileUrl/storageKey instead
  fileUrl?: string;       // servable path under /api/files, backed by a real file on disk
  storageKey?: string;    // path relative to data/uploads
  fileName: string;
  fileSize: number;       // Size in bytes (must be <= 25 * 1024 * 1024)
  fileType: string;       // MIME type (e.g. image/png, application/pdf)
  designerId: string;
  designerName: string;
  designerEmail: string;
  submittedAt: string;    // ISO timestamp
  // ISO timestamp the stored file gets purged at (see processDesignRetention
  // in server-db.ts) — submittedAt + 30 days by default, but reset to
  // styleDecidedAt + 30 days once Style Approved (see updateDesignStyleReview).
  expiresAt: string;
  isExpired?: boolean;
  proofreadRequested: boolean;
  assignedProofreaderId?: string;
  assignedProofreaderName?: string;
  assignedProofreaderEmail?: string;
  assignedProofreaderIds?: string[];
  assignedProofreaders?: { id: string; name: string; email: string; role?: string }[];
  review?: DesignProofreadReview;
  styleStatus?: 'Pending' | 'Style Approved' | 'Style Rejected';
  styleFeedback?: string;
  styleDecidedBy?: string;
  styleDecidedAt?: string;
  // Whether the "Style Approved" attachment email to the Centre Head / GG
  // Campus Head of Events actually went out — set by /api/designs/[id]'s
  // PATCH handler the moment styleStatus first becomes 'Style Approved'.
  // A false value with styleApprovalEmailError set means the design IS
  // approved but nobody was actually emailed the asset yet.
  styleApprovalEmailSent?: boolean;
  styleApprovalEmailError?: string;
  // Whether the designer-facing decision-notification email (sent on every
  // proofread or style approve/reject) went out — set by /api/designs/[id]'s
  // PATCH handler. Separate from styleApprovalEmailSent, which notifies the
  // approvers, not the submitter.
  designerDecisionEmailSent?: boolean;
  designerDecisionEmailError?: string;
  eventId?: string;
  eventName?: string;
  // Set once a Style Approved design linked to an event auto-creates a
  // matching Completed task (see updateDesignStyleReview) — lets repeat
  // approvals (e.g. approved -> changes requested -> re-approved) reuse the
  // same task instead of creating a duplicate each time.
  linkedTaskId?: string;
  // The design-brief Task (Tasks module, taskCategory === 'design') this
  // submission was made in response to — set only when the designer
  // submitted via the Design Portal's "Design Task Requests" queue rather
  // than an ad-hoc upload. addDesign() seeds linkedTaskId from this so
  // syncDesignTask() completes THIS same task on approval instead of
  // spawning a new standalone "Design Approved: ..." task.
  sourceTaskId?: string;
  workflowStage?: 'caption_required' | 'caption_approval' | 'posting_required' | 'completed';
  captionTaskId?: string;
  captionApprovalTaskId?: string;
  postingInstagramTaskId?: string;
  postingLinkedinTaskId?: string;
  postingInstagramDone?: boolean;
  postingLinkedinDone?: boolean;
  draftInstagramCaption?: string;
  draftLinkedinCaption?: string;
  approvedInstagramCaption?: string;
  approvedLinkedinCaption?: string;
  captionStatus?: 'pending_submission' | 'pending_approval' | 'approved' | 'changes_requested';
  // Whether the "Captions Approved" email (design asset + approved caption
  // text) to the Centre Head / Advisor / GG Campus Head of Events actually
  // went out — set by /api/designs/[id]'s PATCH handler the moment
  // captionStatus first becomes 'approved'. Mirrors styleApprovalEmailSent/
  // styleApprovalEmailError above.
  captionApprovalEmailSent?: boolean;
  captionApprovalEmailError?: string;
  captionReviewComments?: string;
  isSample?: boolean;
  // Optional automated OCR + spell-check pass run client-side at upload time
  // (see /api/designs/ocr-scan). Purely advisory — never validated or
  // enforced server-side, just carried along for the Proofreading Desk to
  // show what the automated pass already flagged.
  ocrScan?: OcrScanResult;
}

export interface OcrScanIssue {
  word: string;
  suggestions: string[];
  pageIndex: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrScanPageImage {
  dataUrl: string;
  // Pixel dimensions of the ORIGINAL page the bbox coordinates above were
  // measured against — not necessarily the dataUrl's own resolution, which
  // may be downscaled for payload size. Highlight boxes are positioned by
  // percentage, so this is all a consumer needs regardless of preview size.
  width: number;
  height: number;
}

export interface OcrScanResult {
  extractedText: string;
  pageCount: number;
  totalPages: number;
  partial: boolean; // true if a PDF had more pages than were scanned
  issues: OcrScanIssue[];
  pageImages: OcrScanPageImage[];
  scannedAt: string;
}

export interface AuditLogItem {
  id: string;
  action: string;
  actorName: string;
  actorEmail: string;
  target?: string;
  details: string;
  timestamp: string;
}

/**
 * Access Level Settings: the thresholds/keywords behind the hardcoded tier
 * and role rules in permissions.ts (Base Leadership, Core Committee, "Head"
 * designation, Sector Head, Finance Head), editable by the Super User from
 * the Group Policies page's "Built-in Access Rules" panel instead of living
 * only as numbers/regexes in code. Always exactly one record (id: 'default').
 *
 * Tier 1 (Super User) itself is deliberately NOT represented here and never
 * will be — it's the one access rule that stays permanently hardcoded, so
 * there's no configuration that can ever lock the real Super User out.
 */
export interface AccessLevelSettings {
  id: string; // always 'default'
  baseLeadershipMaxTier: number; // tier <= this counts as "Base Leadership"
  coreCommitteeTier: number; // tier === this counts as "Core Committee"
  sectorHeadMaxTier: number; // tier <= this counts as Leadership / CEO outright
  headKeyword: string; // whole-word, case-insensitive match against Member.role
  sectorHeadKeywords: string; // comma-separated phrases, e.g. "ceo, director, head, lead"
  financeKeyword: string; // whole-word, case-insensitive match against role or department
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_ACCESS_LEVEL_SETTINGS: AccessLevelSettings = {
  id: 'default',
  baseLeadershipMaxTier: 3,
  coreCommitteeTier: 3,
  sectorHeadMaxTier: 2,
  headKeyword: 'head',
  sectorHeadKeywords: 'ceo, director, head, lead',
  financeKeyword: 'finance',
};

/**
 * Site-wide lockdown switch. When enabled, every dashboard page renders a
 * generic "Page Not Found" screen instead of its real content for everyone
 * except the Super User (tier 1, hardcoded — same as access-level settings,
 * there is no configuration that can lock the real Super User out).
 */
export interface SystemSettings {
  id: string; // always 'default'
  lockdownEnabled: boolean;
  lockdownEnabledAt?: string;
  lockdownEnabledBy?: string;
  dismissedAutoTaskIds?: string[];
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  id: 'default',
  lockdownEnabled: false,
  dismissedAutoTaskIds: [],
};

export const initialSystemSettings: SystemSettings[] = [DEFAULT_SYSTEM_SETTINGS];

/**
 * Group Policy: a dynamically Super-User-managed access "tag." Grants a set of
 * capability keys to any member matching ANY of its non-empty target criteria
 * (division / tier / designation keyword / explicit member) — no code change
 * required to grant or revoke access. See permissions.ts's hasCapability() for
 * the resolution logic and CAPABILITY_CATALOG for the grantable capabilities.
 */

// Every module a Group Policy can target with a View/Edit access override —
// see GroupPolicy.moduleAccess and permissions.ts's MODULE_CATALOG (which
// pairs each key with a label/description for the Group Policies UI).
export type ModuleAccessKey =
  | 'EVENTS'
  | 'TASKS'
  | 'DIRECTORY'
  | 'GUEST_DIRECTORY'
  | 'DESIGNS'
  | 'REIMBURSEMENTS'
  | 'BUDGET'
  | 'FORMS'
  | 'ANNOUNCEMENTS'
  | 'RATINGS'
  | 'REPORTS'
  | 'EVENT_REPORTS'
  | 'FESTIVALS'
  | 'VISITING_CARD'
  | 'GUEST_INVITES'
  | 'APPROVALS'
  | 'BACKUP'
  | 'EMAIL'
  | 'EVENT_PASSES'
  | 'POLICIES'
  | 'PROCUREMENT';

export interface GroupPolicy {
  id: string;
  tag: string; // short unique code, e.g. "JUNIOR_EVENT_LEAD" — used for display/reference
  name: string; // human-readable name, e.g. "Junior Event Lead Access"
  description?: string;
  capabilities: string[]; // capability keys from CAPABILITY_CATALOG this tag grants
  targetDivisions: MemberDivision[];
  targetTiers: number[];
  targetDesignationKeyword?: string; // substring match against Member.role, case-insensitive
  targetMemberIds: string[]; // explicit individual overrides
  enabled: boolean;
  // If set, the policy stops granting anything once this ISO timestamp passes —
  // for a temporary grant instead of a permanent one. Enforced everywhere
  // enabled policies are matched (permissions.ts's isPolicyActive()); the
  // record itself is never deleted, so it's easy to see what expired and when.
  expiresAt?: string;
  // If set, restricts members matching this policy's targeting to seeing only
  // events they created or are listed on a committee for, instead of the default
  // (unrestricted) visibility every member has today. Purely restrictive — never
  // grants visibility beyond the default, only narrows it for the targeted group.
  eventVisibilityScope?: 'OWN_ONLY';
  // Generalizes eventVisibilityScope (kept above for back-compat with policies
  // saved before this field existed — permissions.ts's resolver honors both)
  // to every module: per module, a policy can grant/restrict a View scope
  // ('ALL' grants full-roster visibility beyond a member's built-in default;
  // 'OWN' restricts them to only records they created, purely narrowing —
  // never below what an explicit 'ALL' grant elsewhere gives them) and set an
  // Edit override ('ALL' grants unrestricted edit; 'OWN' limits edit to
  // records they created, one-time within a 24h window, for modules that
  // track a creator; 'NONE' revokes edit outright, overriding whatever a
  // member's tier/role would otherwise allow — the Super User's "cannot edit
  // in view" lever). Absent = inherit that module's built-in default
  // entirely, so nothing regresses for any policy saved before this existed.
  moduleAccess?: Partial<Record<ModuleAccessKey, { view?: 'OWN' | 'ALL'; edit?: 'OWN' | 'ALL' | 'NONE' }>>;
  // If set, any capability this policy grants only takes effect once a designated
  // approver signs off — the grantee's action lands in a pending state instead of
  // applying immediately. See permissions.ts's getApprovalRequirement().
  requiresApproval?: boolean;
  approverType?: 'CENTER_HEAD' | 'SPECIFIC_MEMBER' | 'POLICY_TAG';
  approverMemberId?: string; // when approverType === 'SPECIFIC_MEMBER'
  approverPolicyTagId?: string; // when approverType === 'POLICY_TAG' — id of another GroupPolicy
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

// Shared default password ("Kayo29") every seeded account starts with, scrypt-hashed —
// members should change this from Settings once they can log in. Precomputed once via
// password.ts's hashPassword('Kayo29') rather than computed at import time.
const DEFAULT_PASSWORD_HASH = '039e521fbfd304a0a97bf0ad345fa30c:fabe61e51b9670355e96fa18763974f718215fdff2533c42e3da9fb81bd21f62780271331c4c3fa2f1a10cf452a180b13b45d2aa41604ed02620cb7bf8af2135';

// Real organization roster starts empty — created dynamically via Setup Wizard and Directory
const initialMembersRaw: Member[] = [];

export const initialMembers: Member[] = [];

export const initialEvents: EventItem[] = [];

export const initialTasks: TaskItem[] = [];

export const initialRatings: RatingItem[] = [];

export const initialReimbursements: ReimbursementItem[] = [];

export const initialBudgets: BudgetItem[] = [];

export const initialAnnouncements: AnnouncementItem[] = [];

export const initialForms: PublicFormItem[] = [];

// Fixed, stable id (never regenerated) so the "download filled Word copy"
// feature and src/lib/docx-fill.ts can reliably recognize a form built from
// this exact template, even though applying a template regenerates every
// field's id — see PublicFormItem.sourceTemplateId.
export const FEEDBACK_FORM_TEMPLATE_ID = 'tmpl_feedback_form';

// Field labels here are matched by exact string in src/lib/docx-fill.ts to
// map submitted answers onto the right blank/checkbox in the original
// Feedback_Events.docx — keep them in sync if either side changes.
export const initialFormTemplates: FormTemplateItem[] = [
  {
    id: 'tmpl_event_registration',
    name: 'Event Registration Template',
    description: 'Standard participant registration form with contact details, department, and year of study.',
    createdBy: 'System',
    createdAt: '2026-01-01',
    fields: [
      { id: 'f_full_name', label: 'Full Name', type: 'text', required: true },
      { id: 'f_email', label: 'University / Professional Email', type: 'email', required: true },
      { id: 'f_phone', label: 'Contact Phone / WhatsApp', type: 'text', required: true },
      { id: 'f_dept', label: 'Department / Faculty', type: 'text', required: true },
      { id: 'f_year', label: 'Year / Semester of Study', type: 'select', options: ['1st Year', '2nd Year', '3rd Year', '4th Year', 'Post-Graduate', 'Faculty / Staff', 'External Guest'], required: true },
      { id: 'f_reg_no', label: 'Student / Employee ID No.', type: 'text', required: false },
      { id: 'f_expectations', label: 'Expectations or Questions for this Event', type: 'textarea', required: false },
    ],
  },
  {
    id: FEEDBACK_FORM_TEMPLATE_ID,
    name: 'Feedback Form Template',
    description: 'The standard RTBI event feedback form — matches the official feedback form, including the option to download each response as a filled copy of that Word document.',
    createdBy: 'System',
    createdAt: '2026-01-01',
    fields: [
      { id: 'f_event_name', label: 'Name of Event', type: 'text', required: true },
      // An event has exactly one type, so this is a single choice (the Word copy
      // still ticks the matching box — see 'eventtype' in lib/docx-fill.ts).
      { id: 'f_event_type', label: 'Type of Event', type: 'select', options: ['MDP', 'FDP', 'Workshop', 'Guest Lecture', 'Seminar/Conference', 'Other'], required: true },
      { id: 'f_date', label: 'Date', type: 'text', required: true },
      { id: 'f_duration', label: 'Duration', type: 'text', required: true },
      { id: 'f_resource_persons', label: 'Resource Person(s)', type: 'text', required: true },
      { id: 'f_participant_name', label: 'Participant Name', type: 'text', required: true },
      { id: 'f_designation', label: 'Designation/Program/Semester', type: 'text', required: true },
      { id: 'f_department', label: 'Department', type: 'text', required: true },
      { id: 'f_rate_relevance', label: 'Relevance of the topic', type: 'scale', required: true },
      { id: 'f_rate_clarity', label: 'Clarity of objectives', type: 'scale', required: true },
      { id: 'f_rate_content', label: 'Content quality & depth', type: 'scale', required: true },
      { id: 'f_rate_practical', label: 'Practical applicability', type: 'scale', required: true },
      { id: 'f_rate_effectiveness', label: 'Effectiveness of resource person', type: 'scale', required: true },
      { id: 'f_rate_tools', label: 'Use of tools/technology', type: 'scale', required: true },
      { id: 'f_rate_interaction', label: 'Interaction & engagement', type: 'scale', required: true },
      { id: 'f_rate_organization', label: 'Organization & coordination', type: 'scale', required: true },
      { id: 'f_rate_overall', label: 'Overall satisfaction', type: 'scale', required: true },
      // These were plain checkboxes labeled only "Yes" with no visible "No"
      // option and no `required` enforcement at all (see the 'checkbox'
      // render branch in src/app/forms/[slug]/page.tsx) — an unanswered
      // question was indistinguishable from an explicit "No". A Yes/No
      // select forces a real choice and is properly enforced as required,
      // same as f_enhance_knowledge/f_apply_learning below.
      { id: 'f_lo_understand', label: 'Understand key concepts clearly', type: 'select', options: ['Yes', 'No'], required: true },
      { id: 'f_lo_apply', label: 'Apply learning in practical/academic context', type: 'select', options: ['Yes', 'No'], required: true },
      { id: 'f_lo_tools', label: 'Use relevant tools/techniques introduced', type: 'select', options: ['Yes', 'No'], required: true },
      { id: 'f_lo_problemsolving', label: 'Enhance problem-solving/decision-making ability', type: 'select', options: ['Yes', 'No'], required: true },
      { id: 'f_lo_industry', label: 'Relate concepts to industry practices', type: 'select', options: ['Yes', 'No'], required: true },
      { id: 'f_takeaways', label: 'Key Takeaways from the Session', type: 'textarea', required: true },
      { id: 'f_valuable', label: 'Most Valuable Aspect of the Event', type: 'textarea', required: true },
      { id: 'f_suggestions', label: 'Suggestions for Improvement', type: 'textarea', required: true },
      { id: 'f_future_topics', label: 'Topics you would like in future sessions', type: 'textarea', required: true },
      { id: 'f_enhance_knowledge', label: 'Did the event enhance your knowledge/skills?', type: 'select', options: ['Yes', 'No'], required: true },
      { id: 'f_apply_learning', label: 'Will you apply the learning in future?', type: 'select', options: ['Yes', 'No'], required: true },
      { id: 'f_overall_rating', label: 'Overall Rating (Out of 5)', type: 'scale', required: true },
    ],
  },
  {
    id: 'tmpl_hackathon_workshop',
    name: 'Hackathon & Technical Workshop Registration',
    description: 'Registration form for hackathons, project challenges, and tech workshops.',
    createdBy: 'System',
    createdAt: '2026-01-01',
    fields: [
      { id: 'f_lead_name', label: 'Participant / Lead Name', type: 'text', required: true },
      { id: 'f_lead_email', label: 'Email Address', type: 'email', required: true },
      { id: 'f_phone_num', label: 'WhatsApp / Phone Number', type: 'text', required: true },
      { id: 'f_participation_type', label: 'Participation Type', type: 'select', options: ['Individual / Solo', 'Team Leader', 'Team Member'], required: true },
      { id: 'f_team_name', label: 'Team Name (if participating in team)', type: 'text', required: false },
      { id: 'f_tech_stack', label: 'Technical Domain / Track of Interest', type: 'multiselect', options: ['AI & Machine Learning', 'Web & Mobile Development', 'Cloud & DevOps', 'Cybersecurity', 'UI/UX Design', 'IoT & Robotics'], required: true },
      { id: 'f_portfolio_url', label: 'GitHub / Portfolio / LinkedIn Profile URL', type: 'text', required: false },
      { id: 'f_experience_summary', label: 'Brief Summary of Past Projects or Skills', type: 'textarea', required: false },
    ],
  },
  {
    id: 'tmpl_quick_survey',
    name: 'Quick Event Survey',
    description: 'Concise 6-question survey to capture attendee satisfaction and feedback.',
    createdBy: 'System',
    createdAt: '2026-01-01',
    fields: [
      { id: 'f_survey_name', label: 'Your Name (optional)', type: 'text', required: false },
      { id: 'f_survey_email', label: 'Your Email (optional)', type: 'email', required: false },
      { id: 'f_session_rating', label: 'Overall Rating of this Event', type: 'scale', required: true },
      { id: 'f_content_relevance', label: 'Relevance and Value of Content', type: 'scale', required: true },
      { id: 'f_best_part', label: 'What did you find most useful or inspiring?', type: 'textarea', required: false },
      { id: 'f_suggested_improvements', label: 'Suggestions or Topics for Future Sessions', type: 'textarea', required: false },
    ],
  },
];

export const initialSubmissions: FormSubmissionItem[] = [];

export const initialDesigns: DesignSubmissionItem[] = [];

export const initialGroupPolicies: GroupPolicy[] = [];

export const initialGuests: Guest[] = [];

export const initialAccessLevelSettings: AccessLevelSettings[] = [DEFAULT_ACCESS_LEVEL_SETTINGS];

export const initialIncomeSources: IncomeSourceItem[] = [];


// -------------------------------------------------------------
// Server Sync & Per-Collection API Helpers
// -------------------------------------------------------------

// Timestamp of the most recent local write to each collection (by localStorage
// key). Lets a sync poll tell whether its response is stale relative to a
// mutation that happened while the request was in flight — see hydrateIfStale.
const lastLocalWriteAt: Record<string, number> = {};

/** Record that `key` was just written locally (called at the end of every
 * saveX()/direct localStorage.setItem write in this file). */
function markLocalWrite(key: string): void {
  lastLocalWriteAt[key] = Date.now();
}

// In-flight optimistic task mutations so background polls to /api/data
// never overwrite or resurrect a task while its server update is still resolving.
const pendingTaskOptimisticUpdates = new Map<string, { updates: Partial<TaskItem>; previousTask?: TaskItem; timestamp: number }>();

export function registerOptimisticTaskUpdate(id: string, updates: Partial<TaskItem>, previousTask?: TaskItem): void {
  pendingTaskOptimisticUpdates.set(id, { updates, previousTask, timestamp: Date.now() });
  markLocalWrite('rtbi_tasks');
}

export function clearOptimisticTaskUpdate(id: string): void {
  pendingTaskOptimisticUpdates.delete(id);
}

// How long to distrust a sync poll's response for a collection after we
// wrote to it locally. The mutation's own POST/PATCH/DELETE is fire-and-forget
// (never awaited by its caller), so comparing the poll's *start* time against
// our write time isn't quite enough: a poll's GET can reach the server and
// read the file before our own write's request does, even if our write
// started first from the client. A flat suppression window sidesteps that —
// it's vastly more time than a same-server POST needs to land (well under a
// second in practice), while staying far short of the 7s poll cadence, so
// the very next poll after this one is guaranteed to see our change.
const STALE_HYDRATE_SUPPRESSION_MS = 4000;

/**
 * Write a collection fetched from the server into localStorage, verbatim —
 * including a legitimately empty array — UNLESS we wrote to this collection
 * locally within the last `STALE_HYDRATE_SUPPRESSION_MS`. Without that guard,
 * a poll that was in flight (or raced our own write at the server) when the
 * user made a change (e.g. created an event, approved a design) can resolve
 * carrying the server's PRE-change state, silently reverting the just-made
 * change in the UI even though it saved successfully — the next poll, well
 * after our write, doesn't have this problem and will correctly reflect it.
 * The bundled sample data is never written here; it only ever appears as
 * each getX()'s own in-memory fallback before the first sync resolves (see
 * below) — that's the true first-run/offline experience. Once a sync
 * resolves, even to an empty collection, that's what's shown from then on.
 */
function hydrateIfStale(key: string, serverArray: unknown, requestStartedAt: number): boolean {
  if (!Array.isArray(serverArray)) return false;
  const writtenAt = lastLocalWriteAt[key];
  if (writtenAt !== undefined && requestStartedAt - writtenAt < STALE_HYDRATE_SUPPRESSION_MS) return false;

  let arrayToPersist: any = serverArray;
  // If hydrating tasks, merge any active in-flight optimistic updates so a background poll
  // cannot temporarily revert an in-flight task completion or edit before the server write settles.
  if (key === 'rtbi_tasks' && pendingTaskOptimisticUpdates.size > 0) {
    const now = Date.now();
    arrayToPersist = (serverArray as any[]).map((task: any) => {
      const pending = pendingTaskOptimisticUpdates.get(task.id);
      if (pending && now - pending.timestamp < 45000) {
        return { ...task, ...pending.updates };
      }
      return task;
    });
  }

  try {
    const json = JSON.stringify(arrayToPersist);
    // Identical to what is already stored: skip the write (and the re-render it triggers) — most 7s polls change nothing.
    if (localStorage.getItem(key) === json) return false;
    localStorage.setItem(key, json);
    return true;
  } catch (e) {
    console.warn(`[hydrateIfStale] Failed to write ${key} to localStorage:`, e);
    return false;
  }
}

/**
 * Fetch all collections from the server and hydrate localStorage.
 * Server data wins over anything not written locally since this request
 * started (see hydrateIfStale) — this is safe to call repeatedly (polling).
 * Before the first sync ever resolves, each getX() shows bundled sample data
 * from memory without persisting it (see the "Do NOT seed localStorage here"
 * getters below) — that's the true first-run/offline experience. Once a sync
 * resolves, even to an empty collection, that's what's shown from then on.
 */
let syncInFlight: Promise<boolean> | null = null;
let hasSyncedOnce = false;

export function syncWithServer(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  // Share one request between overlapping callers (poll + visibility/focus
  // triggers firing together on resume).
  if (!syncInFlight) {
    syncInFlight = doSyncWithServer().finally(() => { syncInFlight = null; });
  }
  return syncInFlight;
}

async function doSyncWithServer(): Promise<boolean> {
  const requestStartedAt = Date.now();
  // iOS Safari can leave a fetch hanging forever after the page was
  // suspended/resumed; without a timeout the in-flight guard would then
  // block every later sync and the UI would stay stale indefinitely.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('/api/data', { cache: 'no-store', headers: authHeaders(), signal: controller.signal });
    if (res.status === 401 && getSessionToken()) {
      // The server no longer recognises this session (signed out elsewhere, password reset by an admin, terminated...).
      // Tell the app shell so it can send the person back to the login page instead of showing stale data forever.
      window.dispatchEvent(new Event('rtbi-session-expired'));
      return false;
    }
    if (!res.ok) return false;
    const data = await res.json();
    if (data && typeof data === 'object') {
      const hydrated = [
        hydrateIfStale('rtbi_members', data.members, requestStartedAt),
        hydrateIfStale('rtbi_events', data.events, requestStartedAt),
        hydrateIfStale('rtbi_tasks', data.tasks, requestStartedAt),
        hydrateIfStale('rtbi_ratings', data.ratings, requestStartedAt),
        hydrateIfStale('rtbi_reimbursements', data.reimbursements, requestStartedAt),
        hydrateIfStale('rtbi_announcements', data.announcements, requestStartedAt),
        hydrateIfStale('rtbi_custom_forms', data.forms, requestStartedAt),
        hydrateIfStale('rtbi_form_templates', data.formTemplates, requestStartedAt),
        hydrateIfStale('rtbi_form_submissions', data.submissions, requestStartedAt),
        hydrateIfStale('rtbi_designs', data.designs, requestStartedAt),
        hydrateIfStale('rtbi_group_policies', data.groupPolicies, requestStartedAt),
        hydrateIfStale('rtbi_access_level_settings', data.accessLevelSettings, requestStartedAt),
        hydrateIfStale('rtbi_system_settings', data.systemSettings, requestStartedAt),
        hydrateIfStale('rtbi_guests', data.guests, requestStartedAt),
        hydrateIfStale('rtbi_budgets', data.budgets, requestStartedAt),
        hydrateIfStale('rtbi_income_sources', data.incomeSources, requestStartedAt),
        hydrateIfStale('rtbi_audit_logs', data.auditLogs, requestStartedAt),
        hydrateIfStale('rtbi_approval_requests', data.approvalRequests, requestStartedAt),
        hydrateIfStale('rtbi_event_passes', data.event_passes || data.eventPasses, requestStartedAt),
        hydrateIfStale('rtbi_event_reports', data.eventReports, requestStartedAt),
      ];
      const changed = hydrated.some(Boolean);
      // Notify every open page in this tab to re-read localStorage and re-render.
      // The native 'storage' event only fires in OTHER tabs/windows — it never
      // fires in the tab that made the write, so this custom event is the only
      // signal same-tab pages get that a poll just pulled in fresh server data.
      // Skipped on polls where nothing changed (first sync always notifies).
      if (changed || !hasSyncedOnce) window.dispatchEvent(new Event('rtbi-data-sync'));
      hasSyncedOnce = true;
      return true;
    }
  } catch (err) {
    console.warn('[sync] Server sync skipped (offline or starting up):', err);
  } finally {
    clearTimeout(timeout);
  }
  return false;
}

/**
 * Fire-and-forget helper for targeted per-collection server calls.
 * Does NOT send the entire database — only touches the one record that changed.
 */
export type UploadProgressCallback = (loaded: number, total: number) => void;

/**
 * XMLHttpRequest, not fetch — fetch() gives no way to observe request-body
 * upload progress. Used only when a caller passes onProgress (i.e. the body
 * carries a file), so every other call site keeps the plain fetch() path.
 */
function xhrJson(method: 'POST' | 'PATCH', url: string, body: any, onProgress: UploadProgressCallback): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    const token = getSessionToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error(`${method} ${url} succeeded (${xhr.status}) but returned a non-JSON response — the upload may have been altered by a server proxy.`));
        }
        return;
      }
      console.warn(`[api] ${method} ${url} failed:`, xhr.status);
      // A response body that isn't JSON here almost always means the request
      // never reached this app's own route handler (which always returns
      // JSON, even on failure) — something in front of it (a reverse proxy's
      // own upload size limit, most commonly) rejected the request outright
      // and sent back its own HTML error page instead.
      let detail = '';
      try {
        const parsed = JSON.parse(xhr.responseText);
        detail = parsed?.error || parsed?.message || '';
      } catch {
        // not JSON — a proxy/server error page, not this app's own response
      }
      if (!detail) {
        detail = xhr.status === 413
          ? 'The file was rejected as too large before it reached the app — this is a server/reverse-proxy upload size limit (separate from this app\'s own limit), not this app rejecting it. Ask whoever manages the server to raise it.'
          : `${method} ${url} failed with status ${xhr.status || 'unknown'} and no readable response (server proxy limit, timeout, or connectivity issue).`;
      }
      reject(new Error(detail));
    };
    xhr.onerror = () => {
      console.warn(`[api] ${method} ${url} error`);
      reject(new Error(`${method} ${url} — the connection failed or was reset mid-upload (a large file may have been rejected by a server proxy before reaching the app).`));
    };
    xhr.send(JSON.stringify(body));
  });
}

// Friendly noun for the sync-status pill, keyed by the collection segment of
// the endpoint (e.g. '/api/reimbursements' -> 'reimbursements'). Falls back
// to a generic "changes" for anything not worth naming individually.
const SYNC_LABELS: Record<string, string> = {
  members: 'member details',
  reimbursements: 'reimbursement claim',
  guests: 'guest record',
  designs: 'design',
  events: 'event',
  budgets: 'budget request',
  tasks: 'task',
  announcements: 'announcement',
  forms: 'form',
  submissions: 'form response',
  ratings: 'rating',
  'group-policies': 'group policy',
  'event-reports': 'event report',
  'event_passes': 'event pass',
  'passes': 'event pass',
};
function syncLabelFor(endpoint: string): string {
  const collection = endpoint.replace(/^\/api\//, '').split('/')[0];
  return SYNC_LABELS[collection] || 'changes';
}

/**
 * Build a detailed, technical error message from a failed fetch response —
 * HTTP method, URL, status, and the server's own error text if the body is
 * JSON with an `error`/`message` field (route handlers return that shape on
 * failure). Falls back to the raw response text, then to just the status,
 * so there's always something concrete to show and copy — never a blind
 * "Failed to save X." with no way to tell what actually went wrong.
 */
async function describeFailedResponse(method: string, url: string, res: Response): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        detail = parsed?.error || parsed?.message || text;
      } catch {
        detail = text;
      }
    }
  } catch {
    // response body already consumed or unreadable — fall through with no detail
  }
  const base = `${method} ${url} → ${res.status} ${res.statusText}`;
  return detail ? `${base}: ${detail}` : base;
}

async function serverPost(endpoint: string, body: any, onProgress?: UploadProgressCallback): Promise<any> {
  if (typeof window === 'undefined') return null;
  if (onProgress) return xhrJson('POST', endpoint, body, onProgress);
  // File uploads (above) already get their own FileDropzone progress UI —
  // only plain background writes get the global sync-status pill, so the
  // same action is never narrated by two different pieces of UI at once.
  return trackSync(syncLabelFor(endpoint), 'Saving', async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await describeFailedResponse('POST', endpoint, res);
      console.warn(`[api] ${detail}`);
      throw new Error(detail);
    }
    return res.json();
  }, (result) => result !== null);
}

async function serverPatch(endpoint: string, id: string, updates: any, onProgress?: UploadProgressCallback): Promise<any> {
  if (typeof window === 'undefined') return null;
  if (onProgress) return xhrJson('PATCH', `${endpoint}/${id}`, updates, onProgress);
  return trackSync(syncLabelFor(endpoint), 'Updating', async () => {
    const url = `${endpoint}/${id}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const detail = await describeFailedResponse('PATCH', url, res);
      console.warn(`[api] ${detail}`);
      throw new Error(detail);
    }
    return res.json();
  }, (result) => result !== null);
}

/**
 * One request that acts on many records at once (bulk create/update/delete),
 * instead of a loop of per-record serverPost/serverPatch/serverDelete calls
 * — see /api/members/bulk's doc comment for why that loop was a real
 * problem (N sequential round trips + N full-collection rewrites for what
 * should be one of each).
 */
async function serverBulkRequest(method: 'POST' | 'PATCH' | 'DELETE', endpoint: string, body: any): Promise<any> {
  if (typeof window === 'undefined') return null;
  return trackSync(syncLabelFor(endpoint), method === 'DELETE' ? 'Removing' : method === 'POST' ? 'Saving' : 'Updating', async () => {
    const res = await fetch(endpoint, {
      method,
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await describeFailedResponse(method, endpoint, res);
      console.warn(`[api] ${detail}`);
      throw new Error(detail);
    }
    return res.json();
  }, (result) => result !== null);
}

async function serverDelete(endpoint: string, id: string, queryParams?: Record<string, string>): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  return trackSync(syncLabelFor(endpoint), 'Removing', async () => {
    const qs = queryParams ? `?${new URLSearchParams(queryParams).toString()}` : '';
    const url = `${endpoint}/${id}${qs}`;
    const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) {
      const detail = await describeFailedResponse('DELETE', url, res);
      console.warn(`[api] ${detail}`);
      throw new Error(detail);
    }
    return true;
  }, (result) => result === true);
}

// -------------------------------------------------------------
// Storage & Accessors
// -------------------------------------------------------------

export function getMembers(): Member[] {
  if (typeof window === 'undefined') return [];
  const saved = localStorage.getItem('rtbi_members');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      console.error(e);
    }
  }
  return [];
}

export function saveMembers(members: Member[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_members', JSON.stringify(members));
  markLocalWrite('rtbi_members');
  // Note: Mutations call targeted per-member endpoints (/api/members, /api/members/[id])
}

export async function addMember(member: Omit<Member, 'id'>): Promise<Member & { activationLink?: string; activationEmailSent?: boolean; activationEmailError?: string }> {
  const current = getMembers();
  const existing = current.find(m => m.email.toLowerCase() === member.email.toLowerCase());
  if (existing) {
    throw new Error(`A member with email ${member.email} already exists in the roster.`);
  }

  const newMember: Member = {
    ...member,
    mustSetupPassword: true,
    id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
  };

  const serverResult = await serverPost('/api/members', newMember);
  const createdMember: Member & { activationLink?: string; activationEmailSent?: boolean; activationEmailError?: string } = {
    ...newMember,
    ...(serverResult || {}),
  };

  current.push(createdMember);
  saveMembers(current);
  logAuditEvent('MEMBER_ADDED', 'System / Admin', `Added member ${createdMember.name} to ${createdMember.division}`);
  return createdMember;
}

/**
 * Submit a new member for Centre Head sign-off instead of adding them to the
 * roster immediately — used when the adder's access came from
 * getMemberApprovalRequirement's approval-required path (every Executive
 * role's addition, per that function's built-in rule). The record is created
 * right away with approvalStatus 'pending_create' so it can be tracked and
 * decided on, but the welcome/activation email is deliberately NOT sent yet
 * (see /api/members's POST, which skips dispatch for a pending_create
 * payload) — the member can't log in until a Centre Head approves.
 */
export async function submitMemberCreate(
  member: Omit<Member, 'id'>,
  submittedBy: string,
  submittedByEmail: string
): Promise<Member> {
  const current = getMembers();
  const existing = current.find(m => m.email.toLowerCase() === member.email.toLowerCase());
  if (existing) {
    throw new Error(`A member with email ${member.email} already exists in the roster.`);
  }

  const newMember: Member = {
    ...member,
    mustSetupPassword: true,
    approvalStatus: 'pending_create',
    submittedBy,
    submittedByEmail,
    id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
  };

  const serverResult = await serverPost('/api/members', newMember);
  const createdMember: Member = { ...newMember, ...(serverResult || {}) };

  current.push(createdMember);
  saveMembers(current);
  logAuditEvent('MEMBER_CREATE_SUBMITTED', submittedBy, `Submitted new member "${createdMember.name}" for Centre Head approval before joining the roster`, submittedByEmail);
  return createdMember;
}

/**
 * Approve a pending member addition — marks the record approved and, only
 * now, actually dispatches the welcome/activation email that submitMemberCreate
 * deliberately withheld (reusing the same resend-activation endpoint the
 * Directory page's "Resend Welcome Email" action already calls).
 */
export async function approveMemberCreate(id: string, actorName: string): Promise<Member | null> {
  const current = getMembers();
  const target = current.find(m => m.id === id);
  if (!target || target.approvalStatus !== 'pending_create') return null;

  const result = updateMember(id, {
    approvalStatus: 'approved',
    decidedBy: actorName,
    decidedAt: new Date().toISOString(),
  }, actorName);
  logAuditEvent('MEMBER_APPROVED', actorName, `Approved the addition of "${target.name}" to the roster`);

  try {
    await fetch(`/api/members/${id}/resend-activation`, { method: 'POST', headers: authHeaders() });
  } catch (e) {
    console.error('[approveMemberCreate] Failed to dispatch the welcome email:', e);
  }
  return result;
}

/** Reject a pending member addition. The record is kept (marked 'rejected') for
 *  audit purposes rather than deleted, and stays hidden from the normal roster —
 *  visible only to its submitter and the Centre Head, same visibility rule as a
 *  rejected event/task. No welcome email is ever sent for a rejected addition. */
export function rejectMemberCreate(id: string, actorName: string, reason?: string): Member | null {
  const current = getMembers();
  const target = current.find(m => m.id === id);
  if (!target || target.approvalStatus !== 'pending_create') return null;

  const result = updateMember(id, {
    approvalStatus: 'rejected',
    decidedBy: actorName,
    decidedAt: new Date().toISOString(),
    rejectionReason: reason,
  }, actorName);
  logAuditEvent('MEMBER_REJECTED', actorName, `Rejected the addition of "${target.name}" to the roster${reason ? `: ${reason}` : ''}`);
  return result;
}

/**
 * `bypassSuperUserProtection` lifts the "Super User accounts can't be
 * deleted" guard — reserved for the root Super User deleting another
 * Super User account (never their own). The
 * caller is responsible for that identity check (and for blocking
 * self-deletion) before setting this; deleteMember itself just trusts the
 * flag, matching how every other admin action in this app is gated
 * client-side rather than re-checked here.
 */
export function isRootSuperUser(member: { id?: string; name?: string; email?: string } | null | undefined): boolean {
  if (!member) return false;
  return member.id === 'm1';
}

export function countActiveSuperUsers(members: Array<{ id: string; tier?: number; role?: string; status?: string; name?: string; email?: string }>): number {
  return members.filter(m => (m.tier === 1 || m.role === 'Super User' || isRootSuperUser(m)) && m.status !== 'Terminated').length;
}

export function deleteMember(id: string, actorName: string = 'System / Admin', bypassSuperUserProtection: boolean = false): void {
  const current = getMembers();
  const target = current.find(m => m.id === id);
  if (!target) return;
  const isProtectedTarget = isRootSuperUser(target);
  if (isProtectedTarget && !bypassSuperUserProtection) {
    throw new Error('The root Super User account is protected and cannot be deleted.');
  }

  const simulatedList = current.filter(m => m.id !== id);
  if (countActiveSuperUsers(simulatedList) < 1) {
    throw new Error('Action blocked: System must always maintain at least one active Super User .');
  }

  const updated = current.filter(m => m.id !== id);
  saveMembers(updated);
  serverDelete('/api/members', id, bypassSuperUserProtection ? { force: 'true' } : undefined);
  logAuditEvent(
    'MEMBER_DELETED',
    actorName,
    `Removed member ${target.name} (${target.email})${isProtectedTarget ? ' — Super User account' : ''}`
  );
}

export function syncActiveSessionUser(member: Member): void {
  if (typeof window === 'undefined') return;
  const saved = localStorage.getItem('user');
  if (!saved) return;
  try {
    const activeUser = JSON.parse(saved);
    const isTarget =
      (activeUser.id && activeUser.id === member.id) ||
      (activeUser.email && activeUser.email.toLowerCase() === member.email.toLowerCase());
    if (isTarget) {
      const updatedSessionUser = {
        ...activeUser,
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        tier: member.tier,
        division: member.division,
        department: member.department,
        program: member.program,
        batch: member.batch,
        avatarUrl: member.avatarUrl,
        dateOfBirth: member.dateOfBirth,
        bankName: member.bankName,
        accountNumber: member.accountNumber,
        ifscCode: member.ifscCode,
      };
      delete (updatedSessionUser as any).passwordHash;
      localStorage.setItem('user', JSON.stringify(updatedSessionUser));
      window.dispatchEvent(new Event('rtbi-data-sync'));
    }
  } catch (e) {
    console.error('Failed to sync active session user:', e);
  }
}

export function bulkUpdateMembers(
  ids: string[],
  updates: Partial<Pick<Member, 'division' | 'role' | 'batch' | 'tier'>>,
  actorName: string
): Member[] {
  const current = getMembers();
  const targetIdSet = new Set(ids);
  let updatedCount = 0;

  const updated = current.map(m => {
    if (targetIdSet.has(m.id)) {
      updatedCount++;
      const next = { ...m, ...updates };
      // Security: The root Super User always remains Tier 1 Super User
      if (isRootSuperUser(m)) {
        next.tier = 1;
        next.role = m.role || 'Super User';
        next.status = 'Active';
      }
      return next;
    }
    return m;
  });

  if (countActiveSuperUsers(updated) < 1) {
    throw new Error('Action blocked: System must always maintain at least one active Super User.');
  }

  saveMembers(updated);
  // One PATCH for the whole selection instead of one per member — see
  // /api/members/bulk's doc comment.
  serverBulkRequest('PATCH', '/api/members/bulk', { ids, updates }).catch(err =>
    console.warn('[api] Bulk member update failed to sync to server:', err)
  );
  ids.forEach(id => {
    const full = updated.find(m => m.id === id);
    if (full) syncActiveSessionUser(full);
  });
  const changeSummary = Object.entries(updates)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}='${v}'`)
    .join(', ');
  logAuditEvent('BULK_MEMBERS_UPDATED', actorName, `Bulk updated ${updatedCount} members with: ${changeSummary}`);
  return updated;
}

export function bulkDeleteMembers(ids: string[], actorName: string): Member[] {
  const current = getMembers();
  const targetIdSet = new Set(ids);
  // Protect the root Super User
  current.filter(m => isRootSuperUser(m)).forEach(m => targetIdSet.delete(m.id));

  const updated = current.filter(m => !targetIdSet.has(m.id));
  if (countActiveSuperUsers(updated) < 1) {
    throw new Error('Action blocked: System must always maintain at least one active Super User.');
  }

  saveMembers(updated);
  // One DELETE for the whole selection instead of one per member — see
  // /api/members/bulk's doc comment.
  serverBulkRequest('DELETE', '/api/members/bulk', { ids: Array.from(targetIdSet) }).catch(err =>
    console.warn('[api] Bulk member delete failed to sync to server:', err)
  );
  logAuditEvent('BULK_MEMBERS_DELETED', actorName, `Bulk removed ${current.length - updated.length} members`);
  return updated;
}

/**
 * Bulk member creation — used by the CSV roster importer so N new members
 * cost one round trip and one members.json rewrite instead of N of each
 * (each with its own sequential activation-email send blocking the next
 * row). Activation emails still go out per member, but in parallel — see
 * /api/members/bulk's POST handler.
 */
export async function bulkAddMembers(
  members: Omit<Member, 'id'>[]
): Promise<{ created: (Member & { activationEmailSent?: boolean; activationEmailError?: string })[]; skipped: { email: string; reason: string }[] }> {
  const current = getMembers();
  const seenEmails = new Set(current.map(m => m.email.toLowerCase()));
  const payload = members
    .filter(m => {
      const email = (m.email || '').toLowerCase();
      if (!email || seenEmails.has(email)) return false;
      seenEmails.add(email);
      return true;
    })
    .map(m => ({ ...m, mustSetupPassword: true, id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5) }));

  const clientSkipped = members
    .filter(m => !payload.some(p => p.email.toLowerCase() === m.email.toLowerCase()))
    .map(m => ({ email: m.email, reason: 'Email already exists.' }));

  if (payload.length === 0) {
    return { created: [], skipped: clientSkipped };
  }

  const result = await serverBulkRequest('POST', '/api/members/bulk', { members: payload });
  const created: Member[] = result?.created || [];
  const skipped: { email: string; reason: string }[] = [...clientSkipped, ...(result?.skipped || [])];

  saveMembers([...current, ...created]);
  logAuditEvent('MEMBERS_BULK_IMPORTED', 'System / Admin', `Bulk imported ${created.length} new members${skipped.length ? ` (${skipped.length} skipped)` : ''}`);
  return { created, skipped };
}

export function updateMember(id: string, updates: Partial<Member>, actorName: string): Member | null {
  const current = getMembers();
  const idx = current.findIndex(m => m.id === id);
  if (idx === -1) return null;

  const target = current[idx];
  const finalUpdates = { ...updates };

  // Safety Invariant 1: The root Super User ALWAYS remains a Super User (Tier 1, Active)
  if (isRootSuperUser(target)) {
    finalUpdates.tier = 1;
    if (finalUpdates.status === 'Terminated') {
      finalUpdates.status = 'Active';
    }
  }

  // Safety Invariant 2: At least one active Super User  must always remain
  const simulatedList = current.map((m, i) => i === idx ? { ...m, ...finalUpdates } : m);
  if (countActiveSuperUsers(simulatedList) < 1) {
    throw new Error('Action blocked: System must always maintain at least one active Super User .');
  }

  current[idx] = { ...current[idx], ...finalUpdates };
  saveMembers(current);
  // Send the full merged member, not just the diff, so a server-side upsert (a
  // client-only sample member that was never POSTed) creates a complete record.
  serverPatch('/api/members', id, current[idx]);
  syncActiveSessionUser(current[idx]);
  logAuditEvent('MEMBER_UPDATED', actorName, `Updated member details for ${current[idx].name}`);
  return current[idx];
}

/**
 * Dedicated avatar-upload path (distinct from the general updateMember) so the
 * settings page gets an awaited, real-failure-reporting call with upload
 * progress — a photo that fails to reach the server must be reported as a
 * failure, never silently treated as "saved."
 */
export async function updateMemberAvatar(id: string, avatarData: string, avatarFileName: string, onProgress?: UploadProgressCallback): Promise<{ avatarUrl: string; avatarStorageKey?: string }> {
  const serverResult = await serverPatch('/api/members', id, { avatarData, avatarFileName }, onProgress);
  if (!serverResult || !serverResult.avatarUrl) {
    throw new Error('The photo failed to upload to the server. Please check your connection and try again.');
  }
  return { avatarUrl: serverResult.avatarUrl, avatarStorageKey: serverResult.avatarStorageKey };
}

/**
 * Digital Visiting Card: update text/toggle fields (no photo). Awaits the
 * server response (unlike the fire-and-forget updateMember) because the
 * server is what mints `cardSlug` on first publish — the caller needs that
 * slug back immediately to show the public link/QR without waiting on the
 * next poll cycle.
 */
export async function updateMemberCard(
  id: string,
  changes: Partial<Pick<Member, 'cardEnabled' | 'cardDesignationOverride' | 'cardPhone' | 'cardSocials'>>,
  actorName: string
): Promise<Member | null> {
  const serverResult = await serverPatch('/api/members', id, changes);
  if (!serverResult) return null;

  const members = getMembers();
  const idx = members.findIndex(m => m.id === id);
  if (idx !== -1) {
    members[idx] = { ...members[idx], ...serverResult };
    saveMembers(members);
  }

  logAuditEvent('MEMBER_UPDATED', actorName, `Updated digital visiting card details for ${serverResult.name}`);
  return serverResult;
}

/** Digital Visiting Card: dedicated photo-upload path, mirrors updateMemberAvatar. */
export async function updateMemberCardPhoto(id: string, cardPhotoData: string, cardPhotoFileName: string, onProgress?: UploadProgressCallback): Promise<{ cardPhotoUrl: string; cardPhotoStorageKey?: string }> {
  const serverResult = await serverPatch('/api/members', id, { cardPhotoData, cardPhotoFileName }, onProgress);
  if (!serverResult || !serverResult.cardPhotoUrl) {
    throw new Error('The photo failed to upload to the server. Please check your connection and try again.');
  }
  return { cardPhotoUrl: serverResult.cardPhotoUrl, cardPhotoStorageKey: serverResult.cardPhotoStorageKey };
}

/**
 * Revoke a member's dashboard access without deleting them — every historical
 * record (tasks, ratings, reimbursements, event committees, audit log) keeps
 * referencing this member by id/name/email exactly as before, since none of
 * those are live foreign keys. Login is blocked server-side in /api/auth/login.
 */
export function terminateMember(id: string, actorName: string): Member | null {
  const current = getMembers();
  const idx = current.findIndex(m => m.id === id);
  if (idx === -1) return null;

  const target = current[idx];
  if (isRootSuperUser(target)) {
    throw new Error('The root Super User account is protected and cannot be terminated.');
  }

  const simulatedList = current.map((m, i) => i === idx ? { ...m, status: 'Terminated' as const } : m);
  if (countActiveSuperUsers(simulatedList) < 1) {
    throw new Error('Action blocked: System must always maintain at least one active Super User.');
  }

  current[idx] = {
    ...current[idx],
    status: 'Terminated',
    terminatedAt: new Date().toISOString(),
    terminatedBy: actorName,
  };
  saveMembers(current);
  serverPatch('/api/members', id, current[idx]);
  logAuditEvent(
    'MEMBER_TERMINATED',
    actorName,
    `Terminated ${current[idx].name} (${current[idx].email}) — dashboard access revoked, historical records retained`,
    current[idx].email
  );
  return current[idx];
}

/** Restore a terminated member's dashboard access. */
export function reactivateMember(id: string, actorName: string): Member | null {
  const current = getMembers();
  const idx = current.findIndex(m => m.id === id);
  if (idx === -1) return null;

  current[idx] = {
    ...current[idx],
    status: 'Active',
    terminatedAt: undefined,
    terminatedBy: undefined,
  };
  saveMembers(current);
  serverPatch('/api/members', id, current[idx]);
  logAuditEvent(
    'MEMBER_REACTIVATED',
    actorName,
    `Reactivated ${current[idx].name} (${current[idx].email}) — dashboard access restored`,
    current[idx].email
  );
  return current[idx];
}

// -------------------------------------------------------------
// Guest Directory (visiting-card contacts — separate from Members)
// -------------------------------------------------------------

export function getGuests(): Guest[] {
  if (typeof window === 'undefined') return initialGuests;
  const saved = localStorage.getItem('rtbi_guests');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  return initialGuests;
}

export function saveGuests(guests: Guest[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_guests', JSON.stringify(guests));
  markLocalWrite('rtbi_guests');
}

export async function addGuest(guest: Omit<Guest, 'id' | 'createdAt'>, actorName: string, onProgress?: UploadProgressCallback): Promise<Guest> {
  const newGuest: Guest = {
    ...guest,
    id: 'guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    createdAt: new Date().toISOString(),
  };

  // The server converts visitingCardData (base64) to a real file on disk and
  // returns storageKey/visitingCardUrl — awaited so a failed card upload is
  // reported as a real failure instead of silently "succeeding" locally.
  const serverResult = await serverPost('/api/guests', newGuest, onProgress);
  if (!serverResult) {
    throw new Error('The guest record failed to reach the server. Please check your connection and try again.');
  }

  const createdGuest: Guest = { ...newGuest, ...serverResult };

  const current = getGuests();
  current.unshift(createdGuest);
  saveGuests(current);
  logAuditEvent('GUEST_ADDED', actorName, `Added guest "${createdGuest.name}"${createdGuest.organization ? ` (${createdGuest.organization})` : ''} to the Guest Directory`);
  return createdGuest;
}

export async function updateGuest(id: string, updates: Partial<Guest>, actorName: string, onProgress?: UploadProgressCallback): Promise<Guest | null> {
  const current = getGuests();
  const idx = current.findIndex(g => g.id === id);
  if (idx === -1) return null;

  const updatedGuest = { ...current[idx], ...updates };
  const serverResult = await serverPatch('/api/guests', id, updatedGuest, onProgress);
  if (!serverResult) {
    throw new Error('The update failed to reach the server. Please check your connection and try again.');
  }

  current[idx] = { ...updatedGuest, ...serverResult };
  saveGuests(current);
  logAuditEvent('GUEST_UPDATED', actorName, `Updated guest record for "${current[idx].name}"`);
  return current[idx];
}

export function deleteGuest(id: string, actorName: string): void {
  const current = getGuests();
  const target = current.find(g => g.id === id);
  if (!target) return;

  const updated = current.filter(g => g.id !== id);
  saveGuests(updated);
  serverDelete('/api/guests', id);
  logAuditEvent('GUEST_DELETED', actorName, `Removed guest "${target.name}" from the Guest Directory`);
}

// -------------------------------------------------------------
// Events
// -------------------------------------------------------------

/**
 * Events that passes can be issued for: only events created in the Events module.
 * Public holidays / festivals auto-synced from the holiday calendar feed are excluded.
 */

/**
 * Events that passes can be issued for: only events created in the Events module.
 * Public holidays / festivals auto-synced from the holiday calendar feed are excluded.
 */
export function getPassIssuableEvents(): EventItem[] {
  return getEvents().filter((e) => !e.isHoliday && !String(e.id).startsWith('holiday_'));
}

export function getEvents(): EventItem[] {
  if (typeof window === 'undefined') return initialEvents;
  const saved = localStorage.getItem('rtbi_events');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Ensure committees array exists
      return parsed.map((e: any) => ({
        ...e,
        committees: Array.isArray(e.committees) ? e.committees : []
      }));
    } catch (e) {
      console.error(e);
    }
  }
  // Do NOT seed localStorage here — return sample data without writing
  return initialEvents;
}

export function getEventById(id: string): EventItem | null {
  const events = getEvents();
  return events.find(e => e.id === id) || null;
}

/**
 * Whether `event` is a Festival/Holiday rather than a regular event — there's no
 * separate Festival entity, so this is the single source of truth for the
 * heuristic: either the automated weekly holiday sync flagged it directly
 * (see holiday-scheduler.ts), or its description mentions "festival"/"holiday".
 * Used to keep festivals off the main Events page while still letting them
 * appear in dropdowns (Tasks, Announcements, etc.) that intentionally list them.
 */
export function isFestivalEvent(event: EventItem): boolean {
  return !!event.isHoliday || !!(event.description && (
    event.description.toLowerCase().includes('festival') ||
    event.description.toLowerCase().includes('holiday')
  ));
}

/**
 * Check if an event is approved and ready to appear in dropdowns across the application:
 * 1. For regular events: approvalStatus is 'approved' or undefined (not 'pending_create', 'pending_delete', or 'rejected').
 * 2. For festival/holiday events: the post for the festival must be explicitly approved
 *    (e.g. a holiday_design_social task exists or holiday_social_approval task was completed with approval).
 */
export function isApprovedEvent(event: EventItem, tasks?: TaskItem[]): boolean {
  if (!event) return false;

  // 1. Regular event approval check
  if (event.approvalStatus === 'pending_create' || event.approvalStatus === 'rejected') {
    return false;
  }

  // 2. Festival / Holiday event post approval check
  const isFestival = isFestivalEvent(event);

  if (isFestival) {
    const allTasks = tasks || getTasks();
    const festivalTasks = allTasks.filter(t => 
      t.eventId === event.id ||
      t.event === event.title ||
      (t.title && t.title.toLowerCase().includes(event.title.toLowerCase()))
    );

    // Look for design task resulting from an approved festival post
    const hasApprovedDesignPost = festivalTasks.some(t => 
      t.workflowType === 'holiday_design_social' ||
      (t.isDesignDeliverable && t.workflowType !== 'holiday_social_approval' && t.status === 'Completed')
    );
    if (hasApprovedDesignPost) return true;

    // Look for festival social approval task
    const approvalTask = festivalTasks.find(t => t.workflowType === 'holiday_social_approval');
    if (approvalTask) {
      if (approvalTask.status === 'Completed' && hasApprovedDesignPost) {
        return true;
      }
      return false;
    }

    // If no post task has been created or approved for this festival yet, it's not approved for dropdowns
    return false;
  }

  return true;
}

export function getApprovedEvents(tasks?: TaskItem[]): EventItem[] {
  const events = getEvents();
  const allTasks = tasks || getTasks();
  return events.filter(e => isApprovedEvent(e, allTasks));
}

export function saveEvents(events: EventItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_events', JSON.stringify(events));
  markLocalWrite('rtbi_events');
  // Individual mutations use targeted serverPost/serverPatch/serverDelete
}

export function addEvent(event: Omit<EventItem, 'id' | 'committees'> & { committees?: EventCommittee[] }): EventItem {
  const events = getEvents();
  const newEvent: EventItem = {
    ...event,
    id: 'e_' + Date.now(),
    committees: event.committees || []
  };
  events.unshift(newEvent);
  saveEvents(events);
  serverPost('/api/events', newEvent);
  logAuditEvent('EVENT_CREATED', event.createdBy || 'User', `Created new event: ${newEvent.title}`);
  return newEvent;
}

export function updateEvent(id: string, updates: Partial<EventItem>, actorName: string): EventItem | null {
  const events = getEvents();
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return null;

  const dateChanged =
    ('startDate' in updates && updates.startDate !== events[idx].startDate) ||
    ('datesTBD' in updates && updates.datesTBD !== events[idx].datesTBD);

  events[idx] = { ...events[idx], ...updates };
  saveEvents(events);
  // Send the full merged event, not just the diff, so a server-side upsert (a
  // client-only sample event that was never POSTed) creates a complete record.
  serverPatch('/api/events', id, events[idx]);
  logAuditEvent('EVENT_UPDATED', actorName, `Updated event: ${events[idx].title}`);
  if (dateChanged) syncBudgetLineItemsForEvent(id);
  return events[idx];
}

export function deleteEvent(id: string, actorName: string): boolean {
  const events = getEvents();
  const target = events.find(e => e.id === id);
  if (!target) return false;

  const updated = events.filter(e => e.id !== id);
  saveEvents(updated);
  removeApprovalRequestsForEntity('event', id);
  serverDelete('/api/events', id);
  logAuditEvent('EVENT_DELETED', actorName, `Deleted event: ${target.title}`);
  return true;
}

/**
 * Submit a deletion request for sign-off instead of deleting immediately — used
 * when the requester's EVENTS_DELETE grant came from an approval-required Group
 * Policy (this is also how every Executive role's delete request is routed,
 * per getEventApprovalRequirement's built-in "always needs Centre Head sign-off"
 * rule). The event stays fully visible/unaffected until the deletion is approved
 * (removed) or rejected (reverts to 'approved', no data lost).
 */
export function submitEventDelete(
  id: string,
  submittedBy: string,
  submittedByEmail: string,
  approval: { approverType?: GroupPolicy['approverType']; approverMemberId?: string; approverPolicyTagId?: string; policyName?: string }
): EventItem | null {
  const events = getEvents();
  const target = events.find(e => e.id === id);
  if (!target) return null;

  const result = updateEvent(id, {
    approvalStatus: 'pending_delete',
    approverType: approval.approverType,
    approverMemberId: approval.approverMemberId,
    approverPolicyTagId: approval.approverPolicyTagId,
    approvalPolicyName: approval.policyName,
    submittedBy,
    submittedByEmail,
  }, submittedBy);
  logAuditEvent('EVENT_DELETE_SUBMITTED', submittedBy, `Submitted deletion of event "${target.title}" for approval`, submittedByEmail);
  return result;
}

/**
 * Submit an edit to an already-approved event for sign-off instead of applying it
 * immediately — used when the editor's EVENTS_EDIT grant came from an
 * approval-required Group Policy. The event keeps showing its last-approved values
 * to everyone else until the change is approved (merged in) or rejected (discarded).
 */
export function submitEventEdit(
  id: string,
  changes: Partial<EventItem>,
  submittedBy: string,
  submittedByEmail: string,
  approval: { approverType?: GroupPolicy['approverType']; approverMemberId?: string; approverPolicyTagId?: string; policyName?: string }
): EventItem | null {
  const events = getEvents();
  const target = events.find(e => e.id === id);
  if (!target) return null;

  const result = updateEvent(id, {
    pendingChange: changes,
    approvalStatus: 'pending_edit',
    approverType: approval.approverType,
    approverMemberId: approval.approverMemberId,
    approverPolicyTagId: approval.approverPolicyTagId,
    approvalPolicyName: approval.policyName,
    submittedBy,
    submittedByEmail,
  }, submittedBy);
  logAuditEvent('EVENT_EDIT_SUBMITTED', submittedBy, `Submitted an edit to event "${target.title}" for approval`, submittedByEmail);
  return result;
}

/** Approve a pending event creation, edit, or deletion. For a pending edit, merges
 *  the staged pendingChange into the record; for a pending creation, simply marks
 *  it approved; for a pending deletion, actually removes the event now. */
export function approveEvent(id: string, actorName: string, note?: string): EventItem | null {
  const events = getEvents();
  const target = events.find(e => e.id === id);
  if (!target) return null;

  if (target.approvalStatus === 'pending_delete') {
    deleteEvent(id, actorName);
    logAuditEvent('EVENT_APPROVED', actorName, `Approved and completed the deletion of event "${target.title}"`);
    return null;
  }

  const isEdit = target.approvalStatus === 'pending_edit';
  const result = updateEvent(id, {
    ...(isEdit ? target.pendingChange : {}),
    approvalStatus: 'approved',
    pendingChange: undefined,
    decidedBy: actorName,
    decidedAt: new Date().toISOString(),
  }, actorName);
  markApprovalRequestsDecided('event', id, 'approved', actorName, note);
  logAuditEvent('EVENT_APPROVED', actorName, `Approved ${isEdit ? 'an edit to' : 'the creation of'} event "${target.title}"`);
  return result;
}

/** Reject a pending event creation, edit, or deletion. A rejected creation is
 *  marked 'rejected' (kept for audit, hidden from general view). A rejected edit
 *  or deletion simply reverts to 'approved' — the original event stands, nothing
 *  is lost. */
export function rejectEvent(id: string, actorName: string, reason?: string): EventItem | null {
  const events = getEvents();
  const target = events.find(e => e.id === id);
  if (!target) return null;

  const isCreate = target.approvalStatus === 'pending_create';
  const result = updateEvent(id, {
    approvalStatus: isCreate ? 'rejected' : 'approved',
    pendingChange: undefined,
    decidedBy: actorName,
    decidedAt: new Date().toISOString(),
    rejectionReason: reason,
  }, actorName);
  markApprovalRequestsDecided('event', id, 'rejected', actorName, reason);
  const kind = target.approvalStatus === 'pending_delete' ? 'the deletion of' : isCreate ? 'the creation of' : 'an edit to';
  logAuditEvent('EVENT_REJECTED', actorName, `Rejected ${kind} event "${target.title}"${reason ? `: ${reason}` : ''}`);
  return result;
}

export interface UnifiedSponsor {
  name: string;
  amount: number;
  type?: string;
  tier?: string;
  notes?: string;
  source: 'event' | 'income_source';
  incomeSourceId?: string;
}

/** Get all sponsors for an event, unifying direct event.sponsors and linked IncomeSourceItems. */
export function getEventSponsors(eventId: string): UnifiedSponsor[] {
  const events = getEvents();
  const event = events.find(e => e.id === eventId);
  const list: UnifiedSponsor[] = [];

  if (event && event.sponsors) {
    event.sponsors.forEach(sp => {
      list.push({
        name: sp.name,
        amount: Number(sp.amount) || 0,
        type: 'sponsor',
        tier: (sp as any).tier,
        notes: 'Direct Event Sponsor',
        source: 'event',
      });
    });
  }

  const incomeSources = getIncomeSources();
  incomeSources.filter(inc => inc.eventId === eventId).forEach(inc => {
    const exists = list.some(s => s.name.toLowerCase() === inc.name.toLowerCase() && s.amount === Number(inc.amount));
    if (!exists) {
      list.push({
        name: inc.name,
        amount: Number(inc.amount) || 0,
        type: inc.type || 'sponsor',
        notes: inc.notes || 'Budget Income Source',
        source: 'income_source',
        incomeSourceId: inc.id,
      });
    }
  });

  return list;
}

/** Total confirmed sponsor contribution for an event (from event.sponsors & linked income sources). */
export function getEventSponsorTotal(event: Pick<EventItem, 'id' | 'sponsors'>): number {
  if (!event.id) {
    return (event.sponsors || []).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  }
  const sponsors = getEventSponsors(event.id);
  return sponsors.reduce((sum, s) => sum + s.amount, 0);
}

/** Human-readable date range for an event, honoring a "dates to be decided" placeholder. */
export function formatEventDateRange(event: Pick<EventItem, 'startDate' | 'endDate' | 'datesTBD'>): string {
  if (event.datesTBD || !event.startDate || !event.endDate) return 'Dates To Be Decided';
  return event.startDate === event.endDate ? event.startDate : `${event.startDate} – ${event.endDate}`;
}

/**
 * Sort key for an event's start date, pushing "dates to be decided" events to
 * the end of a chronological sort instead of letting `new Date('').getTime()`
 * (NaN) produce an unstable order.
 */
export function getEventSortTime(event: Pick<EventItem, 'startDate' | 'datesTBD'>): number {
  if (event.datesTBD || !event.startDate) return Number.MAX_SAFE_INTEGER;
  return new Date(event.startDate).getTime();
}

/**
 * True when the event has a planning/prep start date worth displaying.
 * Planning is intentionally independent of the event's own date(s) — prep
 * work can (and often does) start before the event's actual date is even
 * locked in, so this stays true whenever planningStartDate is set and either
 * the event date is still "To Be Decided" or there's no startDate yet at
 * all. Once a real startDate exists, the planning date only counts as a
 * genuine lead-up phase if it actually falls before it.
 */
export function hasEventPlanningPhase(event: Pick<EventItem, 'startDate' | 'planningStartDate' | 'datesTBD'>): boolean {
  if (!event.planningStartDate) return false;
  if (event.datesTBD || !event.startDate) return true;
  return event.planningStartDate < event.startDate;
}

/** Short, human-readable note on when prep work begins, for list/card views. Empty string when there's no planning phase to show. */
export function formatEventPlanningNote(event: Pick<EventItem, 'startDate' | 'planningStartDate' | 'datesTBD'>): string {
  return hasEventPlanningPhase(event) ? `Prep work from ${event.planningStartDate}` : '';
}

/**
 * Derives the effective status of an event: if its end date (or start date) has passed,
 * treat it as completed (unless explicitly archived).
 */
export function getEffectiveEventStatus(event: EventItem, tasks?: TaskItem[]): EventItem['status'] {
  if (event.status === 'archived') return 'archived';
  const today = new Date().toISOString().split('T')[0];
  const compareDate = event.endDate || event.startDate;
  if (compareDate && compareDate < today) {
    return 'completed';
  }
  return event.status;
}

export function addEventCommittee(eventId: string, committeeName: string, actorName: string, initialMemberIds?: string[]): { event: EventItem; committee: EventCommittee } | null {
  const events = getEvents();
  const event = events.find(e => e.id === eventId);
  if (!event) return null;

  // Unique id, generated here — callers that need the committee they just
  // created must use the `committee` returned below, NOT re-look it up by
  // name (nothing stops two committees on the same event sharing a name,
  // and a name-based re-lookup after this call can silently resolve to the
  // WRONG committee, corrupting which members a task/rating gets attached
  // to — see the tasks/page.tsx caller this was fixed alongside).
  const newComm: EventCommittee = {
    id: 'comm_' + Date.now(),
    name: committeeName,
    memberIds: initialMemberIds ? [...initialMemberIds] : []
  };
  event.committees.push(newComm);
  saveEvents(events);
  // Committees are nested in event — patch the whole event object (full record,
  // so a server-side upsert of a client-only sample event stays complete).
  serverPatch('/api/events', eventId, event);
  logAuditEvent('EVENT_COMMITTEE_ADDED', actorName, `Added committee "${committeeName}" with ${newComm.memberIds.length} members to event "${event.title}"`);
  return { event, committee: newComm };
}

export function updateEventCommitteeMembers(eventId: string, committeeId: string, memberIds: string[], actorName: string): EventItem | null {
  const events = getEvents();
  const event = events.find(e => e.id === eventId);
  if (!event) return null;

  const comm = event.committees.find(c => c.id === committeeId);
  if (!comm) return null;

  comm.memberIds = memberIds;
  saveEvents(events);
  serverPatch('/api/events', eventId, event);
  logAuditEvent('EVENT_COMMITTEE_UPDATED', actorName, `Updated member assignments for committee "${comm.name}" in event "${event.title}"`);
  return event;
}

/** Submit a new committee for sign-off instead of creating it immediately —
 *  used when the creator isn't Centre Head or GG Campus Head of Events (see
 *  isCommitteeApprover). The committee exists but is hidden from the normal
 *  roster/task-assignment flows until approved. */
export function submitEventCommitteeCreate(eventId: string, committeeName: string, submittedBy: string, submittedByEmail: string, initialMemberIds?: string[]): EventItem | null {
  const events = getEvents();
  const event = events.find(e => e.id === eventId);
  if (!event) return null;

  const newComm: EventCommittee = {
    id: 'comm_' + Date.now(),
    name: committeeName,
    memberIds: [],
    pendingMemberIds: initialMemberIds && initialMemberIds.length > 0 ? [...initialMemberIds] : undefined,
    approvalStatus: 'pending_create',
    submittedBy,
    submittedByEmail,
  };
  event.committees.push(newComm);
  saveEvents(events);
  serverPatch('/api/events', eventId, event);
  logAuditEvent('EVENT_COMMITTEE_CREATE_SUBMITTED', submittedBy, `Submitted committee "${committeeName}" with ${initialMemberIds?.length || 0} proposed students for event "${event.title}" for approval`, submittedByEmail);
  return event;
}

/** Submit a committee's student roster for sign-off instead of applying it
 *  immediately. The committee keeps showing its last-approved roster to
 *  everyone else until the change is approved (applied) or rejected
 *  (discarded, original roster stands). */
export function submitEventCommitteeMembers(eventId: string, committeeId: string, memberIds: string[], submittedBy: string, submittedByEmail: string): EventItem | null {
  const events = getEvents();
  const event = events.find(e => e.id === eventId);
  if (!event) return null;

  const comm = event.committees.find(c => c.id === committeeId);
  if (!comm) return null;

  comm.pendingMemberIds = memberIds;
  comm.approvalStatus = 'pending_members';
  comm.submittedBy = submittedBy;
  comm.submittedByEmail = submittedByEmail;
  saveEvents(events);
  serverPatch('/api/events', eventId, event);
  logAuditEvent('EVENT_COMMITTEE_MEMBERS_SUBMITTED', submittedBy, `Submitted a roster update for committee "${comm.name}" in event "${event.title}" for approval`, submittedByEmail);
  return event;
}

/** Approve a pending committee creation or roster update. For a roster
 *  update, applies the staged pendingMemberIds; for a creation, simply
 *  marks it approved (roster stays empty until members are assigned). */
export function approveEventCommittee(eventId: string, committeeId: string, actorName: string): EventItem | null {
  const events = getEvents();
  const event = events.find(e => e.id === eventId);
  if (!event) return null;

  const comm = event.committees.find(c => c.id === committeeId);
  if (!comm) return null;

  const isMembersUpdate = comm.approvalStatus === 'pending_members';
  if (isMembersUpdate || (comm.approvalStatus === 'pending_create' && comm.pendingMemberIds && comm.pendingMemberIds.length > 0)) {
    comm.memberIds = comm.pendingMemberIds || [];
  }
  comm.approvalStatus = 'approved';
  comm.pendingMemberIds = undefined;
  comm.decidedBy = actorName;
  comm.decidedAt = new Date().toISOString();
  saveEvents(events);
  serverPatch('/api/events', eventId, event);
  logAuditEvent('EVENT_COMMITTEE_APPROVED', actorName, `Approved ${isMembersUpdate ? 'a roster update for' : 'the creation of'} committee "${comm.name}" in event "${event.title}"`);
  return event;
}

/** Reject a pending committee creation or roster update. A rejected
 *  creation is removed outright (an empty, permanently-rejected committee
 *  has no audit value worth keeping). A rejected roster update simply
 *  reverts to 'approved' — the original roster stands, nothing is lost. */
export function rejectEventCommittee(eventId: string, committeeId: string, actorName: string, reason?: string): EventItem | null {
  const events = getEvents();
  const event = events.find(e => e.id === eventId);
  if (!event) return null;

  const comm = event.committees.find(c => c.id === committeeId);
  if (!comm) return null;

  if (comm.approvalStatus === 'pending_create') {
    event.committees = event.committees.filter(c => c.id !== committeeId);
    saveEvents(events);
    serverPatch('/api/events', eventId, event);
    logAuditEvent('EVENT_COMMITTEE_REJECTED', actorName, `Rejected the creation of committee "${comm.name}" in event "${event.title}"${reason ? `: ${reason}` : ''}`);
    return event;
  }

  comm.approvalStatus = 'approved';
  comm.pendingMemberIds = undefined;
  comm.decidedBy = actorName;
  comm.decidedAt = new Date().toISOString();
  comm.rejectionReason = reason;
  saveEvents(events);
  serverPatch('/api/events', eventId, event);
  logAuditEvent('EVENT_COMMITTEE_REJECTED', actorName, `Rejected a roster update for committee "${comm.name}" in event "${event.title}"${reason ? `: ${reason}` : ''}`);
  return event;
}

export function deleteEventCommittee(eventId: string, committeeId: string, actorName: string): EventItem | null {
  const events = getEvents();
  const event = events.find(e => e.id === eventId);
  if (!event) return null;

  event.committees = event.committees.filter(c => c.id !== committeeId);
  saveEvents(events);
  serverPatch('/api/events', eventId, event);
  logAuditEvent('EVENT_COMMITTEE_DELETED', actorName, `Removed committee from event "${event.title}"`);
  return event;
}

export function getEventCommittees(eventId?: string): EventCommittee[] {
  const events = getEvents();
  if (eventId) {
    const event = events.find(e => e.id === eventId);
    return event?.committees || [];
  }
  return events.flatMap(e => e.committees || []);
}

export function getCommittees(eventId?: string): string[] {
  const committees = getEventCommittees(eventId);
  const names = new Set<string>();
  committees.forEach(c => {
    if (c.name) names.add(c.name);
  });
  if (names.size === 0) {
    return ['Logistics & Venue Committee', 'Technical & AV Committee', 'Design & Media Committee'];
  }
  return Array.from(names);
}

// -------------------------------------------------------------
// Event Passes & Tickets (On-the-spot manual issuance + QR check-in)
// -------------------------------------------------------------
const EVENT_PASSES_STORAGE_KEY = 'rtbi_event_passes';

export function getEventPasses(eventId?: string): EventPassItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(EVENT_PASSES_STORAGE_KEY);
    const passes: EventPassItem[] = raw ? JSON.parse(raw) : [];
    if (eventId) {
      return passes.filter((p) => p.eventId === eventId);
    }
    return passes;
  } catch (e) {
    console.error('Failed to load event passes:', e);
    return [];
  }
}

export function saveEventPasses(passes: EventPassItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(EVENT_PASSES_STORAGE_KEY, JSON.stringify(passes));
  } catch (e) {
    console.error('Failed to save event passes:', e);
  }
}

/** Pull the server's copy of every pass (it owns approval state) and tell open screens to re-render. */
export async function reconcilePassesFromServer(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const res = await fetch('/api/events/all/passes', { cache: 'no-store', headers: authHeaders() });
    if (!res.ok) return;
    const rows = await res.json();
    if (Array.isArray(rows)) {
      saveEventPasses(rows);
      window.dispatchEvent(new Event('rtbi-data-sync'));
    }
  } catch {
    /* offline — keep the local copy */
  }
}

/** Surface the outcome of the server-side approval gate (held for approval / refused) to whichever screen is open. */
export function notifyPassApproval(message: string, kind: 'pending' | 'error'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('rtbi-pass-approval', { detail: { message, kind } }));
}

/** Issuing a pass NEVER sends email (emailStatus starts 'Not Sent'); dispatch is always an explicit action. */
export function addEventPass(
  passData: Omit<EventPassItem, 'id' | 'serialNumber' | 'issuedAt' | 'status' | 'qrPayload'>
): EventPassItem {
  const passes = getEventPasses();
  const id = `pass-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const serialNumber = `RTBI-EVT-2026-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const issuedAt = new Date().toISOString();
  
  // Cryptographic/verification token payload
  const qrPayload = JSON.stringify({
    passId: id,
    serial: serialNumber,
    eventId: passData.eventId,
    attendee: passData.attendeeName,
    type: passData.passType,
    issuedAt,
  });

  const newPass: EventPassItem = {
    ...passData,
    id,
    serialNumber,
    issuedAt,
    status: 'Active',
    qrPayload,
    emailStatus: 'Not Sent',
    passViewed: false,
    passViewCount: 0,
  };

  passes.unshift(newPass);
  saveEventPasses(passes);

  // Sync with backend API
  fetch(`/api/events/${passData.eventId}/passes`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(newPass),
  })
    .then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await reconcilePassesFromServer();
        notifyPassApproval(data.error || 'The pass could not be issued.', 'error');
        return;
      }
      const saved = await res.json().catch(() => null);
      if (saved?.approvalStatus === 'pending_create') {
        await reconcilePassesFromServer();
        notifyPassApproval(`Pass for ${saved.attendeeName} is waiting for approval${saved.approverName ? ` from ${saved.approverName}` : ''}. It is not active until approved.`, 'pending');
      }
    })
    .catch((err) => console.warn('Failed to sync event pass creation with server:', err));

  logAuditEvent(
    'EVENT_PASS_ISSUED' as any,
    passData.issuedBy,
    `Issued on-the-spot ${passData.passType} "${serialNumber}" to ${passData.attendeeName} for event "${passData.eventName}"`
  );

  return newPass;
}

export function updateEventPassStatus(
  passId: string,
  status: 'Active' | 'Checked In' | 'Cancelled',
  actorName: string,
  attendanceRecords?: PassAttendanceRecord[] | PassAttendanceRecord
): EventPassItem | null {
  const passes = getEventPasses();
  const idx = passes.findIndex((p) => p.id === passId || p.serialNumber === passId);
  if (idx === -1) return null;

  const now = new Date().toISOString();
  const currentAttendance = [...(passes[idx].attendance || [])];
  if (attendanceRecords) {
    const toAdd = Array.isArray(attendanceRecords) ? attendanceRecords : [attendanceRecords];
    toAdd.forEach((rec) => {
      const existingIdx = currentAttendance.findIndex((a) => a.day.toLowerCase() === rec.day.toLowerCase());
      if (existingIdx >= 0) {
        currentAttendance[existingIdx] = rec;
      } else {
        currentAttendance.push(rec);
      }
    });
  }

  passes[idx] = {
    ...passes[idx],
    status,
    ...(status === 'Checked In' ? { checkedInAt: now, checkedInBy: actorName } : {}),
    ...(currentAttendance.length > 0 ? { attendance: currentAttendance } : {}),
  };

  saveEventPasses(passes);

  fetch(`/api/events/${passes[idx].eventId}/passes`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      passId: passes[idx].id,
      status,
      checkedInBy: actorName,
      checkedInAt: now,
      attendance: currentAttendance,
    }),
  }).catch((err) => console.warn('Failed to sync pass status update with server:', err));

  logAuditEvent(
    'EVENT_PASS_STATUS_CHANGED' as any,
    actorName,
    `Marked pass "${passes[idx].serialNumber}" (${passes[idx].attendeeName}) as ${status}${
      attendanceRecords ? ` for ${Array.isArray(attendanceRecords) ? attendanceRecords.map((a) => a.day).join(', ') : attendanceRecords.day}` : ''
    }`
  );

  return passes[idx];
}

export function deleteEventPass(passId: string, actorName: string = 'Staff'): boolean {
  const passes = getEventPasses();
  const target = passes.find((p) => p.id === passId || p.serialNumber === passId);
  if (!target) return false;

  const updated = passes.filter((p) => p.id !== target.id);
  saveEventPasses(updated);

  fetch(`/api/events/${target.eventId}/passes/${target.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await reconcilePassesFromServer();
        notifyPassApproval(data.error || 'The pass could not be deleted.', 'error');
      } else if (data.approvalPending) {
        await reconcilePassesFromServer();
        notifyPassApproval(`Deleting ${target.attendeeName}'s pass is waiting for approval. The pass stays active until it is approved.`, 'pending');
      }
    })
    .catch((err) => console.warn('Failed to sync event pass deletion with server:', err));

  logAuditEvent(
    'EVENT_PASS_DELETED' as any,
    actorName,
    `Deleted pass "${target.serialNumber}" (${target.attendeeName}) for event "${target.eventName}"`
  );

  return true;
}

export interface BulkPassDeleteResult {
  /** Removed straight away. */
  deleted: number;
  /** Sent for approval — the pass stays active until it is approved. */
  pending: number;
  failed: Array<{ name: string; error: string }>;
}

/**
 * Deletes many passes at once. They disappear locally straight away; the server then handles each one with its own
 * permission / approval rules (so some may come back as "waiting for approval", or be refused), and the screen is
 * reconciled with the server's copy once at the end instead of nagging per pass.
 */
export async function deleteEventPassesBulk(
  passIds: string[],
  actorName: string = 'Staff',
  onProgress?: (done: number, total: number) => void
): Promise<BulkPassDeleteResult> {
  const all = getEventPasses();
  const targets = passIds.map((id) => all.find((p) => p.id === id)).filter((p): p is EventPassItem => !!p);
  const result: BulkPassDeleteResult = { deleted: 0, pending: 0, failed: [] };
  if (targets.length === 0) return result;

  const gone = new Set(targets.map((p) => p.id));
  saveEventPasses(all.filter((p) => !gone.has(p.id)));

  let done = 0;
  for (let i = 0; i < targets.length; i += 4) {
    await Promise.all(
      targets.slice(i, i + 4).map(async (t) => {
        try {
          const res = await fetch(`/api/events/${t.eventId}/passes/${t.id}`, { method: 'DELETE', headers: authHeaders() });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) result.failed.push({ name: t.attendeeName, error: data.error || `HTTP ${res.status}` });
          else if (data.approvalPending) result.pending++;
          else result.deleted++;
        } catch (err: any) {
          result.failed.push({ name: t.attendeeName, error: err?.message || 'Network error' });
        }
        done++;
        onProgress?.(done, targets.length);
      })
    );
  }

  if (result.failed.length > 0 || result.pending > 0) await reconcilePassesFromServer();
  logAuditEvent(
    'EVENT_PASS_DELETED' as any,
    actorName,
    `Bulk-deleted ${result.deleted} pass${result.deleted === 1 ? '' : 'es'}${result.pending ? `, ${result.pending} sent for approval` : ''}${result.failed.length ? `, ${result.failed.length} failed` : ''}: ${targets.slice(0, 5).map((t) => t.serialNumber).join(', ')}${targets.length > 5 ? ` and ${targets.length - 5} more` : ''}`
  );
  return result;
}

export async function updateEventPass(
  passId: string,
  updates: Partial<EventPassItem>,
  actorName: string
): Promise<{ pass: EventPassItem; walletUpdated?: boolean; walletAction?: 'none' | 'queued' | 'updated'; walletError?: string; approvalPending?: boolean; refused?: string } | null> {
  const passes = getEventPasses();
  const idx = passes.findIndex((p) => p.id === passId || p.serialNumber === passId);
  if (idx === -1) return null;

  const original = passes[idx];
  const updated: EventPassItem = {
    ...original,
    ...updates,
  };

  // Re-generate QR payload if core fields changed
  if (
    updates.attendeeName !== undefined ||
    updates.passType !== undefined ||
    updates.eventId !== undefined
  ) {
    updated.qrPayload = JSON.stringify({
      passId: updated.id,
      serial: updated.serialNumber,
      eventId: updated.eventId,
      attendee: updated.attendeeName,
      type: updated.passType,
      issuedAt: updated.issuedAt,
    });
  }

  passes[idx] = updated;
  saveEventPasses(passes);

  let walletUpdated = false;
  let walletAction: 'none' | 'queued' | 'updated' = 'none';
  let walletError: string | undefined;
  let approvalPending = false;
  let refused: string | undefined;

  try {
    const res = await fetch(`/api/events/${updated.eventId}/passes`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      // JSON drops `undefined`, so a cleared option (e.g. text colour back to auto) is sent as null and removed server-side
      body: JSON.stringify({
        passId: updated.id,
        ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, v === undefined ? null : v])),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      refused = data.error || `The change was refused (HTTP ${res.status}).`;
      await reconcilePassesFromServer();
      notifyPassApproval(refused as string, 'error');
    } else {
      const data = await res.json();
      if (data.approvalPending) {
        approvalPending = true;
        await reconcilePassesFromServer();
        notifyPassApproval(`Your change to ${original.attendeeName}'s pass is waiting for approval${data.approverName ? ` from ${data.approverName}` : ''}. The pass keeps its current design until it is approved.`, 'pending');
      }
      if (data.walletUpdated) walletUpdated = true;
      if (data.walletAction) walletAction = data.walletAction;
      if (data.walletNotice) walletError = data.walletNotice;
    }
  } catch (err: any) {
    console.warn('Failed to sync event pass update with server:', err);
    walletError = err?.message;
  }

  logAuditEvent(
    'EVENT_PASS_UPDATED' as any,
    actorName,
    `Updated pass details for "${updated.serialNumber}" (${updated.attendeeName})`
  );

  return { pass: updated, walletUpdated, walletAction, walletError, approvalPending, refused };
}


/**
 * Builds the pass invitation email. ONE message for every send path: an editable subject/body template
 * (see lib/pass-email-template.ts) wrapped in the designed layout — header, wide boarding-pass ticket, details
 * table, wallet / calendar buttons. Pure, so the preview in the dispatch screens is exactly what is sent.
 * `forPreview` omits the tracking pixel and points the inline ticket at a real URL instead of `cid:`.
 */
export function buildPassEmail(
  pass: EventPassItem,
  origin: string,
  opts: { forPreview?: boolean; subjectTemplate?: string; bodyTemplate?: string; includeMap?: boolean; mapUrl?: string; includeWhatsapp?: boolean; whatsappUrl?: string } = {}
): { subject: string; bodyText: string; bodyHtml: string } {
  const passUrl = `${origin}/pass/${pass.serialNumber}`;
  const trackPixelUrl = `${origin}/api/pass/${pass.serialNumber}/track`;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const days = getPassValidDays(pass);
  const validDays = days.length > 0 ? formatValidDaysLabel(days) : pass.validityDate || pass.eventDate || '2026';
  const venue = pass.roomOrVenue || pass.eventVenue || 'Main Auditorium';
  const vars: Record<string, string> = {
    name: pass.attendeeName,
    first_name: (pass.attendeeName || '').trim().split(/\s+/)[0] || pass.attendeeName,
    event_name: pass.eventName,
    pass_type: String(pass.passType),
    guest_category: pass.guestCategory || 'Guest Attendee',
    room_or_venue: venue,
    valid_days: validDays,
    event_date: pass.validityDate || pass.eventDate || '2026',
    serial_number: pass.serialNumber,
    pass_link: passUrl,
  };

  const subject = mergePassTemplate(opts.subjectTemplate || DEFAULT_PASS_EMAIL_SUBJECT, vars)
    .split(IMAGE_MARKER).join('').split(DETAILS_MARKER).join('').trim();
  const merged = mergePassTemplate(opts.bodyTemplate || DEFAULT_PASS_EMAIL_BODY, vars);

  // Optional extras: a venue map link (explicit link, else a Google Maps search of the venue) and a WhatsApp group invite
  const mapUrl = opts.includeMap
    ? safeHttpUrl(opts.mapUrl) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue, pass.eventVenue].filter((v, i, a) => v && a.indexOf(v) === i).join(', '))}`
    : undefined;
  const whatsappUrl = opts.includeWhatsapp ? safeHttpUrl(opts.whatsappUrl) : undefined;

  const detailRows: Array<[string, string]> = [
    ['Pass Tier', String(pass.passType)],
    ['Category', pass.guestCategory || 'Guest Attendee'],
    ['Venue / Room', venue],
    ['Valid On', validDays],
    ['Serial ID', pass.serialNumber],
  ];

  const imageSrc = opts.forPreview ? `${origin}/api/pass/${encodeURIComponent(pass.serialNumber)}/image` : 'cid:rtbi-pass-image';
  const imageBlock = `<div style="text-align:center;margin:18px 0;"><a href="${passUrl}"><img src="${imageSrc}" alt="Your event pass — ${esc(pass.serialNumber)}" width="552" style="display:block;width:100%;max-width:552px;height:auto;margin:0 auto;border-radius:16px;" /></a></div>`;
  const detailsBlock = `<table role="presentation" style="width:100%;font-size:13px;color:#D5CBE1;border-collapse:collapse;margin:14px 0;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;">${detailRows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:9px 14px;color:#A594B8;${i ? 'border-top:1px solid rgba(255,255,255,0.07);' : ''}">${k}</td><td style="padding:9px 14px;font-weight:bold;color:${k === 'Serial ID' ? '#f59e0b' : '#ffffff'};${k === 'Serial ID' ? 'font-family:monospace;' : ''}${i ? 'border-top:1px solid rgba(255,255,255,0.07);' : ''}">${esc(v)}</td></tr>`
    )
    .join('')}</table>`;

  const paragraphs = (text: string) =>
    text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p style="margin:0 0 14px 0;font-size:14px;color:#D5CBE1;line-height:1.6;">${esc(p).replace(/\n/g, '<br/>')}</p>`)
      .join('');

  const hasImage = merged.includes(IMAGE_MARKER);
  const hasDetails = merged.includes(DETAILS_MARKER);
  const messageHtml = merged
    .split(/(\[\[PASS_IMAGE\]\]|\[\[PASS_DETAILS\]\])/)
    .map((part) => (part === IMAGE_MARKER ? imageBlock : part === DETAILS_MARKER ? detailsBlock : paragraphs(part)))
    .join('');

  const detailsText = detailRows.map(([k, v]) => `• ${k}: ${v}`).join('\n');
  const bodyText = (merged.split(IMAGE_MARKER).join('').split(DETAILS_MARKER).join(detailsText) + (hasDetails ? '' : `\n\n${detailsText}`))
    .replace(/\n{3,}/g, '\n\n')
    .trim() + `\n\nYour digital pass: ${passUrl}${mapUrl ? `\nVenue location: ${mapUrl}` : ''}${whatsappUrl ? `\nJoin the event WhatsApp group: ${whatsappUrl}` : ''}`;

  const bodyHtml = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#1C0F2A;color:#FEF7F6;border-radius:16px;">
      <div style="text-align:center;margin-bottom:20px;">
        <span style="display:inline-block;padding:4px 12px;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#E86848;background:rgba(232, 104, 72,0.15);border-radius:20px;">Official Event Pass</span>
        <h1 style="margin:16px 0 8px 0;font-size:22px;color:#ffffff;">${esc(pass.eventName)}</h1>
        <p style="margin:0;color:#A594B8;font-size:14px;">RTBI • RUAS</p>
      </div>
      ${hasImage ? '' : imageBlock}
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:20px;margin-bottom:8px;">
        ${messageHtml}
        ${hasDetails ? '' : detailsBlock}
      </div>
      ${passEmailButtonsHtml(origin, pass.serialNumber, { mapUrl, whatsappUrl })}
      <p style="margin:0;font-size:12px;color:#76648B;text-align:center;border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;">
        Please present your digital pass or QR code at official event turnstiles upon arrival.<br/>
        &copy; ${new Date().getFullYear()} RTBI &bull; MSRUAS
      </p>
      ${opts.forPreview ? '' : `<img src="${trackPixelUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:none;outline:none;" />`}
    </div>
  `;

  return { subject, bodyText, bodyHtml };
}

/**
 * Dispatches a personalized pass invitation email to the attendee
 * with turnstile access details and digital wallet links.
 */
export async function dispatchPassEmail(
  pass: EventPassItem,
  targetEmail?: string,
  template?: { subjectTemplate?: string; bodyTemplate?: string; includeMap?: boolean; mapUrl?: string; includeWhatsapp?: boolean; whatsappUrl?: string },
  /** Blurred e-mail background for this send: 'none' or a custom picture; omit for the Email Settings default. */
  background?: 'none' | { storageKey: string; blur: number }
): Promise<{ success: boolean; error?: string; pending?: boolean }> {
  const recipient = (targetEmail || pass.attendeeEmail || '').trim();
  if (!recipient) {
    return { success: false, error: 'No recipient email address provided.' };
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : FALLBACK_ORIGIN;
  const { subject, bodyText, bodyHtml } = buildPassEmail(pass, origin, template || {});

  try {
    const res = await fetch('/api/email/send', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        scope: 'SINGLE',
        recipientEmail: recipient,
        to: recipient,
        subject,
        bodyText,
        bodyHtml,
        category: 'EVENT_INVITATION',
        badgeText: 'Official Event Pass',
        badgeColor: '#CC3D19',
        passSerial: pass.serialNumber, // server renders + attaches the boarding-pass image (cid:rtbi-pass-image)
        ...(background ? { background } : {}),
        metadata: {
          passId: pass.id,
          serialNumber: pass.serialNumber,
          eventId: pass.eventId,
          eventName: pass.eventName,
        },
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || `HTTP ${res.status} error during dispatch.` };
    }
    const sendData = await res.json().catch(() => ({}));
    if (sendData?.approvalPending) {
      // Held for the designated approver — nothing was sent, so don't mark the pass as emailed.
      notifyPassApproval(`Emailing ${pass.attendeeName}'s pass is waiting for approval. It is sent once the approver accepts.`, 'pending');
      return { success: true, pending: true } as { success: boolean; error?: string; pending?: boolean };
    }

    // Record 'Email Sent' state
    const now = new Date().toISOString();
    const newStatus: PassEmailStatus = pass.emailStatus === 'Pass Viewed' ? 'Pass Viewed' : 'Email Sent';
    
    // Update local cache
    const passes = getEventPasses();
    const idx = passes.findIndex(p => p.id === pass.id);
    if (idx >= 0) {
      passes[idx] = {
        ...passes[idx],
        emailStatus: newStatus,
        emailSentAt: now,
      };
      saveEventPasses(passes);
    }

    // Sync status to backend
    fetch(`/api/events/${pass.eventId}/passes`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        passId: pass.id,
        emailStatus: newStatus,
        emailSentAt: now,
      }),
    }).catch(err => console.warn('Failed to sync pass email status with server:', err));

    logAuditEvent(
      'EVENT_PASS_EMAILED' as any,
      pass.issuedBy || 'Staff',
      `Dispatched pass ${pass.serialNumber} via email to ${recipient}`
    );

    return { success: true };
  } catch (err: any) {
    console.error('Failed to dispatch pass email:', err);
    return { success: false, error: err?.message || 'Network error dispatching email.' };
  }
}

export function updateEventPassEmailStatus(
  passId: string,
  status: PassEmailStatus,
  timestamp?: string
): EventPassItem | null {
  const passes = getEventPasses();
  const idx = passes.findIndex(p => p.id === passId || p.serialNumber === passId);
  if (idx === -1) return null;

  const now = timestamp || new Date().toISOString();
  passes[idx] = {
    ...passes[idx],
    emailStatus: status,
    ...(status === 'Email Sent' ? { emailSentAt: now } : {}),
    ...(status === 'Email Received' ? { emailReceivedAt: now } : {}),
    ...(status === 'Pass Viewed' ? { passViewed: true, passViewedAt: passes[idx].passViewedAt || now, lastPassViewedAt: now } : {}),
  };
  saveEventPasses(passes);

  fetch(`/api/events/${passes[idx].eventId}/passes`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      passId: passes[idx].id,
      emailStatus: status,
      ...(status === 'Email Sent' ? { emailSentAt: now } : {}),
      ...(status === 'Email Received' ? { emailReceivedAt: now } : {}),
      ...(status === 'Pass Viewed' ? { passViewed: true, passViewedAt: passes[idx].passViewedAt, lastPassViewedAt: now } : {}),
    }),
  }).catch(err => console.warn('Failed to sync pass status update with server:', err));

  return passes[idx];
}

// -------------------------------------------------------------
// Event Reports (General Secretary submission -> dual approval -> email)
// -------------------------------------------------------------

export function getEventReports(): EventReportItem[] {
  if (typeof window === 'undefined') return [];
  const saved = localStorage.getItem('rtbi_event_reports');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      console.error(e);
    }
  }
  return [];
}

export function saveEventReports(reports: EventReportItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_event_reports', JSON.stringify(reports));
  markLocalWrite('rtbi_event_reports');
}

/** Submit a finished report file for an event. POSTs first so the server
 *  writes the file to disk and returns fileUrl/storageKey, matching the
 *  addDesign/addGuest upload pattern. */
export async function addEventReport(
  report: {
    eventId: string;
    eventTitle: string;
    fileData: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    submittedBy: string;
    submittedByEmail: string;
  },
  onProgress?: UploadProgressCallback
): Promise<EventReportItem> {
  if (report.fileSize > 25 * 1024 * 1024) {
    throw new Error('File size exceeds the 25 MB limit.');
  }

  const newReport = {
    id: 'evrep_' + Date.now(),
    eventId: report.eventId,
    eventTitle: report.eventTitle,
    fileData: report.fileData,
    fileName: report.fileName,
    fileSize: report.fileSize,
    fileType: report.fileType,
    submittedBy: report.submittedBy,
    submittedByEmail: report.submittedByEmail,
    submittedAt: new Date().toISOString(),
    centreHeadApproved: false,
    eventsHeadGgApproved: false,
    status: 'pending_review' as const,
  };

  const serverResult = await serverPost('/api/event-reports', newReport, onProgress);
  if (!serverResult) {
    throw new Error('The report failed to upload to the server. Please check your connection and try again.');
  }

  const created: EventReportItem = { ...newReport, ...serverResult };
  delete (created as any).fileData;

  const current = getEventReports();
  current.unshift(created);
  saveEventReports(current);
  logAuditEvent('EVENT_REPORT_SUBMITTED', report.submittedBy, `Submitted event report for "${report.eventTitle}"`, report.submittedByEmail);

  return created;
}

/** Replace the file on a rejected report and put it back up for review,
 *  resetting both approvals -- mirrors updateDesignFile's re-submission
 *  pattern. */
export async function resubmitEventReport(
  id: string,
  fileData: string,
  fileName: string,
  fileSize: number,
  fileType: string,
  actorName: string,
  onProgress?: UploadProgressCallback
): Promise<EventReportItem | null> {
  if (fileSize > 25 * 1024 * 1024) {
    throw new Error('File size exceeds the 25 MB limit.');
  }

  const serverResult = await serverPatch('/api/event-reports', id, {
    fileData,
    fileName,
    fileSize,
    fileType,
    status: 'pending_review',
    centreHeadApproved: false,
    centreHeadApprovedBy: undefined,
    centreHeadApprovedAt: undefined,
    eventsHeadGgApproved: false,
    eventsHeadGgApprovedBy: undefined,
    eventsHeadGgApprovedAt: undefined,
    rejectedBy: undefined,
    rejectedAt: undefined,
    rejectionReason: undefined,
    emailSent: undefined,
    emailError: undefined,
  }, onProgress);
  if (!serverResult) return null;

  const current = getEventReports();
  const idx = current.findIndex(r => r.id === id);
  if (idx !== -1) {
    current[idx] = { ...current[idx], ...serverResult };
    saveEventReports(current);
  }
  logAuditEvent('EVENT_REPORT_RESUBMITTED', actorName, `Resubmitted event report "${serverResult.eventTitle || ''}"`);
  return current[idx] || null;
}

/** Approve a report as Centre Head or GG Campus Head of Events. Both are
 *  required before the server marks it fully approved and emails the
 *  attachment -- see /api/event-reports/[id]'s PATCH handler. */
export async function approveEventReport(id: string, as: 'centre_head' | 'gg_events_head', actorName: string, comments?: string): Promise<EventReportItem | null> {
  const patch: any = as === 'centre_head'
    ? { centreHeadApproved: true, centreHeadApprovedBy: actorName, centreHeadApprovedAt: new Date().toISOString(), centreHeadComments: comments, reviewerComments: comments }
    : { eventsHeadGgApproved: true, eventsHeadGgApprovedBy: actorName, eventsHeadGgApprovedAt: new Date().toISOString(), eventsHeadGgComments: comments, reviewerComments: comments };

  const serverResult = await serverPatch('/api/event-reports', id, patch);
  if (!serverResult) return null;

  const current = getEventReports();
  const idx = current.findIndex(r => r.id === id);
  if (idx !== -1) {
    current[idx] = { ...current[idx], ...serverResult };
    saveEventReports(current);
  }
  if (serverResult.status === 'approved' || serverResult.status === 'Approved') {
    markApprovalRequestsDecided('event-report', id, 'approved', actorName, comments);
  }
  logAuditEvent('EVENT_REPORT_APPROVED', actorName, `${as === 'centre_head' ? 'Centre Head' : 'GG Campus Head of Events'} approved event report "${serverResult.eventTitle || ''}"${serverResult.status === 'approved' ? ' -- now fully approved' : ''}`);
  return current[idx] || null;
}

/** Score a report against the Report Writing rubric (Clarity, Flow/Structure,
 *  Timeliness of Submission, Number of Errors, Geotagged Photos & Pictures — see rating-criteria.ts). Either
 *  reviewer (Centre Head or GG Campus Head of Events) can enter or edit the
 *  score, same trust level as approving the report. Feeds the decay-weighted
 *  Final Score leaderboard on the Ratings page (report-scoring.ts). */
export async function scoreEventReport(id: string, reportScores: Record<string, number>, actorName: string): Promise<EventReportItem | null> {
  const patch = {
    reportScores,
    reportScore: averageScore(reportScores),
    scoredBy: actorName,
    scoredAt: new Date().toISOString(),
  };

  const serverResult = await serverPatch('/api/event-reports', id, patch);
  if (!serverResult) return null;

  const current = getEventReports();
  const idx = current.findIndex(r => r.id === id);
  if (idx !== -1) {
    current[idx] = { ...current[idx], ...serverResult };
    saveEventReports(current);
  }
  logAuditEvent('EVENT_REPORT_SCORED', actorName, `Scored event report "${serverResult.eventTitle || ''}" ${patch.reportScore}/5.0 on the Report Writing rubric`);
  return current[idx] || null;
}

export async function rejectEventReport(id: string, actorName: string, reason?: string): Promise<EventReportItem | null> {
  const serverResult = await serverPatch('/api/event-reports', id, {
    status: 'rejected',
    rejectedBy: actorName,
    rejectedAt: new Date().toISOString(),
    rejectionReason: reason,
  });
  if (!serverResult) return null;

  const current = getEventReports();
  const idx = current.findIndex(r => r.id === id);
  if (idx !== -1) {
    current[idx] = { ...current[idx], ...serverResult };
    saveEventReports(current);
  }
  markApprovalRequestsDecided('event-report', id, 'rejected', actorName, reason);
  logAuditEvent('EVENT_REPORT_REJECTED', actorName, `Rejected event report "${serverResult.eventTitle || ''}"${reason ? `: ${reason}` : ''}`);
  return current[idx] || null;
}

export async function deleteEventReport(id: string, actorName: string): Promise<boolean> {
  const target = getEventReports().find(r => r.id === id);
  const ok = await serverDelete('/api/event-reports', id);
  if (ok) {
    saveEventReports(getEventReports().filter(r => r.id !== id));
    removeApprovalRequestsForEntity('event-report', id);
    logAuditEvent('EVENT_REPORT_DELETED', actorName, `Deleted event report${target ? ` for "${target.eventTitle}"` : ''}`);
  }
  return ok;
}

// -------------------------------------------------------------
// Manual Approval Requests (ask a specific member to approve a
// task/committee/event)
// -------------------------------------------------------------

export function getApprovalRequests(): ApprovalRequest[] {
  if (typeof window === 'undefined') return [];
  const saved = localStorage.getItem('rtbi_approval_requests');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  return [];
}

export function saveApprovalRequests(requests: ApprovalRequest[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_approval_requests', JSON.stringify(requests));
  markLocalWrite('rtbi_approval_requests');
  window.dispatchEvent(new CustomEvent('rtbi-data-sync'));
}

/**
 * Automatically purges any tracked approval requests for an entity that has been deleted,
 * so no dead cards or broken links remain in the Approvals queue.
 */
export function removeApprovalRequestsForEntity(entityType: ApprovalRequest['entityType'], entityId: string): void {
  const requests = getApprovalRequests();
  const next = requests.filter(r => !(r.entityType === entityType && r.entityId === entityId));
  if (next.length !== requests.length) {
    saveApprovalRequests(next);
  }
}

/** Ask a specific member to approve a task/committee/event. Purely a tracked
 *  ask-and-answer — never gates or blocks the underlying record. */
export function requestApproval(input: {
  entityType: ApprovalRequest['entityType'];
  entityId: string;
  entityTitle: string;
  eventId?: string;
  requesterId: string;
  requesterName: string;
  requesterEmail?: string;
  targetMemberId: string;
  targetMemberName: string;
  targetMemberEmail?: string;
  message?: string;
}): ApprovalRequest {
  const requests = getApprovalRequests();
  const newRequest: ApprovalRequest = {
    ...input,
    id: 'apr_' + Date.now(),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  requests.unshift(newRequest);
  saveApprovalRequests(requests);
  serverPost('/api/approval-requests', newRequest);
  logAuditEvent(
    'APPROVAL_REQUESTED',
    input.requesterName,
    `Asked ${input.targetMemberName} to approve ${input.entityType} "${input.entityTitle}"`,
    input.requesterEmail
  );
  return newRequest;
}

/** Helper to sync ApprovalRequest status when an underlying entity is decided. */
export function markApprovalRequestsDecided(
  entityType: ApprovalRequest['entityType'],
  entityId: string,
  decision: 'approved' | 'rejected',
  actorName: string,
  decisionNote?: string
): void {
  const requests = getApprovalRequests();
  let changed = false;
  const now = new Date().toISOString();
  const next = requests.map(r => {
    if (r.entityType === entityType && r.entityId === entityId && r.status === 'pending') {
      changed = true;
      return {
        ...r,
        status: decision,
        decidedBy: actorName,
        decidedAt: now,
        decisionNote: decisionNote || (decision === 'approved' ? `Approved by ${actorName}` : `Rejected by ${actorName}`),
      };
    }
    return r;
  });
  if (changed) {
    saveApprovalRequests(next);
  }
}

/** The target member approves or rejects a pending request. */
export function decideApprovalRequest(
  id: string,
  decision: 'approved' | 'rejected',
  actorName: string,
  decisionNote?: string
): ApprovalRequest | null {
  const requests = getApprovalRequests();
  const idx = requests.findIndex(r => r.id === id);
  if (idx === -1) return null;

  const target = requests[idx];
  const now = new Date().toISOString();

  // Cascade to sibling autoGenerated requests for the same entity if applicable
  const updatedRequests = requests.map(r => {
    if (r.id === id || (target.autoGenerated && r.autoGenerated && r.entityType === target.entityType && r.entityId === target.entityId && r.status === 'pending')) {
      return {
        ...r,
        status: decision,
        decidedBy: actorName,
        decidedAt: now,
        decisionNote: r.id === id ? decisionNote : (decisionNote || (decision === 'approved' ? `Approved by ${actorName}` : `Rejected by ${actorName}`)),
      };
    }
    return r;
  });

  saveApprovalRequests(updatedRequests);
  const updatedTarget = updatedRequests.find(r => r.id === id) || updatedRequests[idx];
  serverPatch('/api/approval-requests', id, updatedTarget);
  logAuditEvent(
    decision === 'approved' ? 'APPROVAL_REQUEST_APPROVED' : 'APPROVAL_REQUEST_REJECTED',
    actorName,
    `${decision === 'approved' ? 'Approved' : 'Rejected'} the request to approve ${target.entityType} "${target.entityTitle}"`
  );
  return updatedTarget;
}

/** Withdraw a request the current user sent (only meaningful while pending). */
export function deleteApprovalRequest(id: string, actorName: string): boolean {
  const requests = getApprovalRequests();
  const target = requests.find(r => r.id === id);
  if (!target) return false;

  saveApprovalRequests(requests.filter(r => r.id !== id));
  serverDelete('/api/approval-requests', id);
  logAuditEvent('APPROVAL_REQUEST_WITHDRAWN', actorName, `Withdrew the approval request sent to ${target.targetMemberName} for "${target.entityTitle}"`);
  return true;
}

// -------------------------------------------------------------
// Tasks & Visibility Rule
// -------------------------------------------------------------

export function getTasks(): TaskItem[] {
  if (typeof window === 'undefined') return initialTasks;
  const saved = localStorage.getItem('rtbi_tasks');
  if (saved) {
    try {
      const parsed: TaskItem[] = JSON.parse(saved);
      // Auto-generated tasks must ONLY be created after the day the event is done, never before it.
      // Filter out pre-event poster auto-tasks and auto-tasks for events that haven't concluded yet.
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const events = getEvents();

      // Track events that already have a completed auto-generated or design task
      const completedAutoEventIds = new Set(
        parsed
          .filter(t => (t.workflowType === 'event_social_post' || t.workflowType === 'holiday_design_social') && t.status === 'Completed' && t.eventId)
          .map(t => t.eventId!)
      );

      const filtered = parsed.filter(t => {
        if (t.workflowType === 'event_poster_request' || (typeof t.id === 'string' && t.id.startsWith('task_event_poster_'))) {
          return false;
        }
        if (t.workflowType === 'event_social_post' || (typeof t.id === 'string' && t.id.startsWith('task_event_social_'))) {
          const ev = events.find(e => e.id === t.eventId);
          if (ev) {
            const evEnd = (ev.endDate && ev.endDate.trim()) || (ev.startDate && ev.startDate.trim());
            if (!evEnd || evEnd >= todayStr || ev.datesTBD) return false;
          }
        }
        // Deduplicate tasks created by the design portal for already completed auto-generated tasks
        if (t.eventId && completedAutoEventIds.has(t.eventId)) {
          if (typeof t.title === 'string' && t.title.startsWith('Design Approved:')) return false;
          if (t.workflowType === 'design_caption_draft' || t.workflowType === 'design_caption_review' || t.workflowType === 'design_social_posting') return false;
        }
        return true;
      });
      if (filtered.length !== parsed.length) {
        localStorage.setItem('rtbi_tasks', JSON.stringify(filtered));
      }
      if (pendingTaskOptimisticUpdates.size > 0) {
        const now = Date.now();
        return filtered.map(t => {
          const pending = pendingTaskOptimisticUpdates.get(t.id);
          if (pending && now - pending.timestamp < 45000) {
            return { ...t, ...pending.updates };
          }
          return t;
        });
      }
      return filtered;
    } catch (e) {
      console.error(e);
    }
  }
  // Do NOT seed localStorage here — return sample data without writing
  return initialTasks;
}

export function saveTasks(tasks: TaskItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_tasks', JSON.stringify(tasks));
  markLocalWrite('rtbi_tasks');
  window.dispatchEvent(new CustomEvent('rtbi-data-sync'));
}

/**
 * Uploads design-brief attachments to disk under data/uploads/tasks/<recordId>/
 * and returns their real url/storageKey — awaited by the Tasks page BEFORE
 * calling addTask/updateTask, so TaskItem.attachments only ever holds real
 * file references, never inline base64 sitting in localStorage. `recordId`
 * can be a client-generated placeholder at creation time (it only names the
 * storage folder, it doesn't have to match the eventual task id); pass the
 * count of attachments the task already has as `startIndex` when appending
 * more files during an edit, so earlier files aren't overwritten on disk.
 */
export async function uploadTaskAttachments(
  recordId: string,
  files: { name: string; dataUrl: string; type?: string }[],
  startIndex = 0
): Promise<ReceiptFile[]> {
  if (files.length === 0) return [];
  const res = await fetch('/api/tasks/attachments', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ recordId, files, startIndex }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to upload attachment(s). Please check your connection and try again.');
  }
  return (data.files || []) as ReceiptFile[];
}

const localDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 'YYYY-MM-DD' the task was assigned: its recorded assignedAt, else the timestamp baked into manual task ids ('t_<ms>'), else undefined. */
export function getTaskAssignedDate(task: Pick<TaskItem, 'id' | 'assignedAt'>): string | undefined {
  if (task.assignedAt) {
    const d = new Date(task.assignedAt);
    if (!Number.isNaN(d.getTime())) return localDateStr(d);
  }
  const m = /^t_(\d{12,})$/.exec(task.id || '');
  if (m) {
    const d = new Date(Number(m[1]));
    if (!Number.isNaN(d.getTime())) return localDateStr(d);
  }
  return undefined;
}

/** Whether an extension request on this task was approved (older tasks: inferred from an approving decision on a requested extension). */
export function wasTaskExtensionGranted(task: Pick<TaskItem, 'extensionGranted' | 'decidedBy' | 'extensionReason'>): boolean {
  if (task.extensionGranted) return true;
  return !!task.extensionReason && !!task.decidedBy && !/\(denied\)/i.test(task.decidedBy);
}

export interface TaskLateness {
  daysLate: number;
  dueDate: string;
  completedOn: string;
  assignedOn?: string;
}

/**
 * Set when a task was completed after its deadline and no extension was granted. Null when it was on time, still open,
 * had an extension, or has no recorded completion time (tasks completed before completion times were recorded).
 */
export function getTaskLateness(task: TaskItem | undefined | null): TaskLateness | null {
  if (!task || task.status !== 'Completed' || !task.completedAt || !task.dueDate) return null;
  if (wasTaskExtensionGranted(task)) return null;
  const completed = new Date(task.completedAt);
  if (Number.isNaN(completed.getTime())) return null;
  const completedOn = localDateStr(completed);
  const daysLate = Math.round((new Date(`${completedOn}T00:00:00`).getTime() - new Date(`${task.dueDate}T00:00:00`).getTime()) / 86400000);
  if (daysLate <= 0) return null;
  return { daysLate, dueDate: task.dueDate, completedOn, assignedOn: getTaskAssignedDate(task) };
}

/** Human-readable line for ratings/reports: how late it was, with the deadline and when the task was assigned. */
export function describeTaskLateness(l: TaskLateness): string {
  const days = `${l.daysLate} day${l.daysLate === 1 ? '' : 's'}`;
  return `Submitted ${days} after the deadline (due ${l.dueDate}, completed ${l.completedOn}, no extension)${l.assignedOn ? ` · task assigned ${l.assignedOn}` : ''}`;
}

export function addTask(task: Omit<TaskItem, 'id' | 'status'> & { status?: TaskItem['status'] }): TaskItem {
  const tasks = getTasks();

  // Creating the task with a specific-member review requirement already
  // (e.g. a Super User assigning a committee task who also wants a chosen
  // reviewer to sign off first) — start the delegation trail right away.
  const trail: TaskDelegationEvent[] = [...(task.delegationTrail || [])];
  if (task.approvalStatus === 'pending_create' && task.approverType === 'SPECIFIC_MEMBER' && task.approverMemberId) {
    const reviewer = getMembers().find(m => m.id === task.approverMemberId);
    trail.push({
      action: 'submitted_for_review',
      actorName: task.submittedBy || task.creatorName || 'User',
      actorEmail: task.submittedByEmail,
      targetName: reviewer?.name,
      at: new Date().toISOString(),
    });
  }

  const newTask: TaskItem = {
    ...task,
    id: 't_' + Date.now(),
    status: task.status || 'Assigned',
    assignedAt: task.assignedAt || new Date().toISOString(),
    delegationTrail: trail.length > 0 ? trail : undefined,
  };
  tasks.unshift(newTask);
  saveTasks(tasks);
  serverPost('/api/tasks', newTask);
  logAuditEvent('TASK_CREATED', task.creatorName || 'User', `Assigned task: ${newTask.title} to ${newTask.assignee}`);
  return newTask;
}

export function updateTask(id: string, updates: Partial<TaskItem>, actorName: string): TaskItem | null {
  const tasks = getTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return null;

  const previousStatus = tasks[idx].status;
  const previousApprovalStatus = tasks[idx].approvalStatus;

  // Unapproved or rejected tasks cannot have their status advanced (e.g. marked Completed or In Progress) until approved.
  const isUnapproved = previousApprovalStatus === 'pending_create' || previousApprovalStatus === 'pending_edit' || previousApprovalStatus === 'rejected';
  if (isUnapproved && updates.status && updates.status !== previousStatus && updates.approvalStatus !== 'approved') {
    delete updates.status;
  }

  // An event report request can only be completed by uploading the report
  if (updates.status === 'Completed' && previousStatus !== 'Completed' && getEventReportCompletionBlocker(tasks[idx])) {
    delete updates.status;
  }

  tasks[idx] = { ...tasks[idx], ...updates };
  if (updates.status === 'Completed' && previousStatus !== 'Completed') {
    tasks[idx].completedAt = new Date().toISOString();
  } else if (updates.status && updates.status !== 'Completed' && previousStatus === 'Completed') {
    delete tasks[idx].completedAt;
  }

  // Chain reaction: the moment the Centre Head / Advisor / GG Campus Events
  // Head's "who should prepare this report" assignment task is delegated to
  // a specific student and that delegation is approved, the task converts in
  // place into the real "submit the event report" request for that student
  // — see spawnEventReportRequestTask below for how the assignment task
  // itself gets created, and delegateAutoTask for how it's handed off.
  if (
    updates.approvalStatus === 'approved' &&
    previousApprovalStatus === 'pending_edit' &&
    tasks[idx].workflowType === 'event_report_assignment'
  ) {
    tasks[idx] = {
      ...tasks[idx],
      workflowType: 'event_report_request',
      title: `Submit event report for "${tasks[idx].event || 'the event'}"`,
    };
  }

  saveTasks(tasks);
  // Send the full merged task, not just the diff, so a server-side upsert (a
  // client-only sample task that was never POSTed) creates a complete record.
  serverPatch('/api/tasks', id, tasks[idx]);
  logAuditEvent('TASK_UPDATED', actorName, `Updated task: ${tasks[idx].title}`);

  // Chain reaction: the moment the event-lapse social media task is marked
  // Completed, auto-generate the follow-on "who should prepare the report"
  // assignment task for the Centre Head / Advisor / GG Campus Events Head —
  // see spawnEventReportRequestTask below.
  if (
    updates.status === 'Completed' &&
    previousStatus !== 'Completed' &&
    tasks[idx].workflowType === 'event_social_post' &&
    tasks[idx].eventId
  ) {
    spawnEventReportRequestTask(tasks[idx].eventId!, tasks[idx].event, actorName);
  }

  // Bi-directional completion: if a procurement task is marked Completed, mark the corresponding procurement request Completed
  if (
    updates.status === 'Completed' &&
    previousStatus !== 'Completed' &&
    (tasks[idx].workflowType === 'procurement' || tasks[idx].procurementId || tasks[idx].isProcurement)
  ) {
    const procId = tasks[idx].procurementId || tasks[idx].id.replace(/^task_procurement_/, '');
    const procRequests = getProcurementRequests();
    const reqIdx = procRequests.findIndex(r => r.id === procId || r.procurementTaskId === tasks[idx].id);
    if (reqIdx !== -1 && procRequests[reqIdx].status !== 'Completed') {
      procRequests[reqIdx] = {
        ...procRequests[reqIdx],
        status: 'Completed',
        completedBy: actorName,
        completedAt: new Date().toISOString(),
      };
      saveProcurementRequests(procRequests);
      serverPatch('/api/procurement-requests', procRequests[reqIdx].id, procRequests[reqIdx]);
    }
  }

  // Bi-directional completion: if a design_social_posting task is marked Completed, mark the corresponding design posting completed
  if (
    updates.status === 'Completed' &&
    previousStatus !== 'Completed' &&
    tasks[idx].workflowType === 'design_social_posting' &&
    tasks[idx].designId
  ) {
    const designs = getDesigns();
    const dIdx = designs.findIndex(d => d.id === tasks[idx].designId);
    if (dIdx !== -1) {
      designs[dIdx].postingInstagramDone = true;
      designs[dIdx].postingLinkedinDone = true;
      designs[dIdx].workflowStage = 'completed';
      saveDesigns(designs);
      serverPatch('/api/designs', designs[dIdx].id, designs[dIdx]);
    }
  }

  return tasks[idx];
}

/**
 * Auto-creates the "event report for this event: who should prepare it?"
 * task for the Centre Head / Advisor / GG Campus Events Head the moment the
 * corresponding event_social_post task is completed — see updateTask above.
 * Whichever of them acts uses the existing delegateAutoTask reassignment
 * flow to hand this off to the student who should write the report; once
 * that delegation is approved, updateTask's chain reaction above converts
 * this same task record into the real 'event_report_request' now assigned to
 * that student. Deterministic id keyed off the event, so a second completion
 * (e.g. re-marking the same task Completed) never double-creates it.
 */
function spawnEventReportRequestTask(eventId: string, eventTitle: string | undefined, actorName: string): void {
  const id = 'task_event_report_' + eventId;
  const tasks = getTasks();
  if (tasks.some(t => t.id === id)) return;

  const members = getMembers().filter(m => m.status !== 'Terminated');
  const centreHead = members.find(m => {
    const role = (m.role || '').toLowerCase();
    return m.tier <= 2 || role.includes('ceo') || role.includes('director') || role.includes('head');
  }) || members.find(m => m.tier === 1);
  const advisor = members.find(m => /\badvisor\b/.test((m.role || '').toLowerCase()));
  const eventsHeadGg = members.find(m => {
    const role = (m.role || '').toLowerCase();
    if (role.includes('finance')) return false;
    return m.tier === 2.5 || (role.includes('events head') && role.includes('gg')) || (role.includes('head of events') && role.includes('gg'));
  });

  const seen = new Set<string>();
  let pool = [centreHead, advisor, eventsHeadGg].filter((m): m is Member => !!m).filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  // Never leave the task with no one able to see/answer it.
  if (pool.length === 0) pool = members.filter(m => m.tier <= 2);

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 3);

  const newTask: TaskItem = {
    id,
    title: `Event report for "${eventTitle || 'the event'}": who would you like to allot this task to?`,
    event: eventTitle,
    eventId,
    assignee: pool.map(m => m.name).join(', ') || 'Centre Head',
    assigneeType: 'group',
    assigneeIds: pool.map(m => m.id),
    dueDate: dueDate.toISOString().slice(0, 10),
    status: 'Assigned',
    creatorName: 'Event Scheduler',
    workflowType: 'event_report_assignment',
  };
  const next = [newTask, ...tasks];
  saveTasks(next);
  serverPost('/api/tasks', newTask);
  logAuditEvent('EVENT_REPORT_TASK_CREATED', actorName, `Asked the Centre Head, Advisor, and GG Campus Events Head who should prepare the event report for "${eventTitle}"`);
}

/**
 * Ask the Centre Head / GG Campus Events Head to reassign an auto-generated
 * event-lapse task (the social post task or the event report request) to a
 * specific member — used by whoever it's currently assigned to when they
 * want to delegate it instead of doing it themselves. Goes through the same
 * pending_edit / approveTask sign-off flow as any other task edit, and is
 * deliberately always routed through approval (approverType: 'CENTER_HEAD')
 * regardless of the delegator's own role.
 */
export function delegateAutoTask(
  taskId: string,
  target: { id: string; name: string; email: string },
  actorName: string,
  actorEmail: string
): TaskItem | null {
  return submitTaskEdit(
    taskId,
    { assignee: target.name, assigneeId: target.id, assigneeEmail: target.email, assigneeType: 'individual' },
    actorName,
    actorEmail,
    { approverType: 'CENTER_HEAD', policyName: 'Auto-Generated Task Delegation' }
  );
}

/**
 * Direct allotment function for Social Media Head and Sr Head:
 * Allows allotting an auto-created social media task to a team member or taking it up themselves,
 * immediately assigning the task without a redundant approval step.
 */
export function allotSocialMediaTask(
  taskId: string,
  target: { id: string; name: string; email: string },
  actorName: string,
  actorEmail?: string
): TaskItem | null {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;

  const isSelf = actorEmail && target.email && actorEmail.toLowerCase() === target.email.toLowerCase();

  const updated = updateTask(
    taskId,
    {
      assignee: target.name,
      assigneeId: target.id,
      assigneeEmail: target.email,
      assigneeType: 'individual',
      assigneeIds: [target.id],
      status: isSelf ? 'In Progress' : 'Assigned',
      allottedBy: actorName,
      allottedAt: new Date().toISOString(),
    },
    actorName
  );

  if (updated) {
    logAuditEvent(
      'TASK_ALLOTTED',
      actorName,
      isSelf
        ? `Took up social media task "${task.title}"`
        : `Allotted social media task "${task.title}" to ${target.name} (${target.email})`
    );
  }

  return updated;
}

export const EVENT_REPORT_UPLOAD_REQUIRED_MESSAGE =
  'Upload the event report (Event Reports module) to complete this task — it can\'t be marked completed any other way.';

/**
 * An "Event Report Request" task is only done once the report itself has been uploaded for that event, so it can't be
 * marked Completed by hand. Uploading the report completes it automatically (see the event-reports page). A rejected
 * report doesn't count — it has to be re-uploaded. Returns the message to show, or null when completing is allowed.
 */
export function getEventReportCompletionBlocker(task: Pick<TaskItem, 'workflowType' | 'eventId'> | undefined | null): string | null {
  if (!task || task.workflowType !== 'event_report_request') return null;
  const hasReport = !!task.eventId && getEventReports().some(r => r.eventId === task.eventId && r.status !== 'rejected');
  return hasReport ? null : EVENT_REPORT_UPLOAD_REQUIRED_MESSAGE;
}

export function updateTaskStatus(id: string, status: TaskItem['status'], actorName?: string): TaskItem | null {
  if (status === 'Completed' && getEventReportCompletionBlocker(getTasks().find(t => t.id === id))) {
    return getTasks().find(t => t.id === id) || null;
  }
  registerOptimisticTaskUpdate(id, { status });
  return updateTask(id, { status }, actorName || 'User');
}

export async function updateTaskStatusAsync(
  id: string,
  status: TaskItem['status'],
  actorName: string = 'User'
): Promise<{ success: boolean; task?: TaskItem; error?: string }> {
  const tasks = getTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return { success: false, error: 'Task not found' };
  if (status === 'Completed') {
    const blocker = getEventReportCompletionBlocker(tasks[idx]);
    if (blocker) return { success: false, error: blocker };
  }

  const previousTask = { ...tasks[idx] };
  const previousStatus = previousTask.status;

  // Optimistic update locally
  const optimisticTask: TaskItem = { ...tasks[idx], status, ...(status === 'Completed' && tasks[idx].status !== 'Completed' ? { completedAt: new Date().toISOString() } : {}) };
  tasks[idx] = optimisticTask;

  // Register in optimistic registry to shield against background sync polls
  registerOptimisticTaskUpdate(id, { status }, previousTask);
  saveTasks(tasks);

  try {
    const url = `/api/tasks/${id}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(optimisticTask),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || errData.message || `Server error (${res.status})`);
    }

    const serverResult = await res.json().catch(() => optimisticTask);

    // Server confirmed! Clear optimistic lock
    clearOptimisticTaskUpdate(id);

    // Save final confirmed version
    const currentTasks = getTasks();
    const currIdx = currentTasks.findIndex(t => t.id === id);
    if (currIdx !== -1) {
      currentTasks[currIdx] = { ...currentTasks[currIdx], ...serverResult };
      saveTasks(currentTasks);
    }

    logAuditEvent('TASK_STATUS_CHANGED', actorName, `Marked task "${previousTask.title}" as ${status}`);

    // If marked Completed and it was a social media post task, spawn follow-on event report request task
    if (status === 'Completed' && previousStatus !== 'Completed') {
      if (previousTask.workflowType === 'event_social_post' && previousTask.eventId) {
        spawnEventReportRequestTask(previousTask.eventId, previousTask.event, actorName);
      }
    }

    return { success: true, task: currentTasks[currIdx] || optimisticTask };
  } catch (err: any) {
    console.error(`[updateTaskStatusAsync] Failed to complete task ${id} on server:`, err);
    // Revert optimistic update
    clearOptimisticTaskUpdate(id);
    const rollbackTasks = getTasks();
    const rollbackIdx = rollbackTasks.findIndex(t => t.id === id);
    if (rollbackIdx !== -1) {
      rollbackTasks[rollbackIdx] = previousTask;
      saveTasks(rollbackTasks);
    }
    return {
      success: false,
      error: err?.message || 'Error in updation of the task, please try again.'
    };
  }
}

/**
 * Centre Head / Events Head answering the weekly holiday-scheduler's "is a
 * social media post needed for this festival?" task (see
 * src/lib/holiday-scheduler.ts, which creates the workflowType
 * 'holiday_social_approval' task this responds to). A "yes" fans out a new
 * group task to every member whose role contains "Design Head" or "Social
 * Media Head" (both the senior and non-senior title-holders match the same
 * substring, so both get it) — falling back to tier <= 2 leadership if no
 * one on the roster currently holds either title, so the task is never left
 * orphaned with no one able to see it.
 */
export function respondToHolidayApproval(taskId: string, approved: boolean, actorName: string): TaskItem | null {
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return null;

  updateTask(taskId, { status: 'Completed', decidedBy: actorName, decidedAt: new Date().toISOString() }, actorName);
  logAuditEvent(
    'HOLIDAY_SOCIAL_APPROVAL_DECIDED',
    actorName,
    `${approved ? 'Approved' : 'Declined'} a social media post for "${task.event || task.title}"`
  );

  if (approved) {
    const existing = getTasks().find(t =>
      t.workflowType === 'holiday_design_social' &&
      ((t.eventId && t.eventId === task.eventId) || (t.event && t.event === task.event))
    );
    if (!existing) {
      const pool = resolveSocialPostingAssignees();
      const isSingle = pool.length === 1;
      addTask({
        title: `Design & post content for "${task.event || task.title}"`,
        event: task.event,
        eventId: task.eventId,
        assignee: pool.map(m => m.name).join(', ') || 'Social Media Head',
        assigneeType: isSingle ? 'individual' : 'group',
        assigneeId: isSingle ? pool[0].id : undefined,
        assigneeEmail: isSingle ? pool[0].email : undefined,
        assigneeIds: pool.map(m => m.id),
        dueDate: task.dueDate,
        creatorName: actorName,
        workflowType: 'holiday_design_social',
        isSocialMediaPost: true,
        taskCategory: 'design',
        briefDescription: `Allot this task to a social media team member or take it up yourself to create and post social media content for "${task.event || task.title}". Submit the design asset here once ready.`,
      });
    }
  }

  return getTasks().find(t => t.id === taskId) || null;
}

// Workflow types the schedulers (holiday-scheduler.ts / event-social-scheduler.ts)
// recreate deterministically for an event on every boot/weekly/daily catch-up
// run. Keep this in sync with AUTO_RECREATED_WORKFLOWS in
// src/app/api/tasks/[id]/route.ts — both gate the same "don't resurrect a
// deliberately deleted auto-task" bookkeeping, which must never apply to a
// manually created task (e.g. a Design Portal brief) that simply references
// an eventId.
const AUTO_RECREATED_WORKFLOW_TYPES = new Set([
  'holiday_social_approval',
  'holiday_design_social',
  'event_social_post',
  'event_poster_request',
  'event_report_request',
  'event_report_assignment',
  'procurement',
]);

export function deleteTask(id: string, actorName: string): boolean {
  const tasks = getTasks();
  const target = tasks.find(t => t.id === id);
  if (!target) return false;

  const updated = tasks.filter(t => t.id !== id);
  saveTasks(updated);
  removeApprovalRequestsForEntity('task', id);

  // Direct correlation check: if a task is deleted, purge any correlated ratings —
  // if there is not any task, then it makes no sense that there would be a rating for said task.
  const remainingRatings = getRatings().filter(r => r.taskId !== id);
  saveRatings(remainingRatings);

  // Record dismissed auto-task in systemSettings so it is never recreated or resurrected.
  // Strictly gated on AUTO_RECREATED_WORKFLOW_TYPES: this bookkeeping exists only
  // so scheduler-generated tasks (holiday/event social posts, poster requests,
  // report requests, procurement) don't resurrect themselves on the next
  // scheduler pass. It must never fire for a manually created task that merely
  // references an eventId — e.g. a Design Portal brief with a Canva link —
  // because ensureHolidaysAndRatingsCleaned purges every task whose eventId is
  // dismissed here, and that would wipe out unrelated, unsubmitted design tasks
  // for the same event on the next server restart.
  const isAutoRecreatedTask =
    (target.workflowType && AUTO_RECREATED_WORKFLOW_TYPES.has(target.workflowType)) ||
    id.startsWith('task_event_') ||
    id.startsWith('task_holiday_');

  if (isAutoRecreatedTask && target.eventId) {
    const settings = getSystemSettings();
    const dismissedIds = new Set(settings.dismissedAutoTaskIds || []);
    dismissedIds.add(id);
    dismissedIds.add(target.eventId);
    if (target.workflowType) {
      dismissedIds.add(`${target.workflowType}_${target.eventId}`);
    }
    saveSystemSettings({
      ...settings,
      dismissedAutoTaskIds: Array.from(dismissedIds),
    });
  }

  // Direct correlation: if this task is tied to an event, mark dismissal flags on the event
  if (isAutoRecreatedTask && (target.eventId || target.event)) {
    const events = getEvents();
    let eventsChanged = false;
    const nextEvents = events.map(e => {
      const match = (target.eventId && (e.id === target.eventId || e.id.includes(target.eventId) || target.eventId.includes(e.id))) ||
        (target.event && e.title?.toLowerCase() === target.event.toLowerCase());
      if (!match) return e;

      eventsChanged = true;
      const dismissedTypes = new Set(e.dismissedAutoTaskTypes || []);
      if (target.workflowType) dismissedTypes.add(target.workflowType);
      const isPoster = target.workflowType === 'event_poster_request' || id.startsWith('task_event_poster_');
      const isSocial =
        target.workflowType === 'event_social_post' ||
        target.workflowType === 'holiday_social_approval' ||
        target.workflowType === 'holiday_design_social' ||
        id.startsWith('task_event_social_') ||
        id.startsWith('task_holiday_');

      return {
        ...e,
        posterTaskDismissed: isPoster ? true : e.posterTaskDismissed,
        socialTaskDismissed: isSocial ? true : e.socialTaskDismissed,
        dismissedAutoTaskTypes: Array.from(dismissedTypes),
      };
    });
    if (eventsChanged) {
      saveEvents(nextEvents);
    }
  }

  serverDelete('/api/tasks', id);
  logAuditEvent('TASK_DELETED', actorName, `Deleted task: ${target.title}`);
  return true;
}

/**
 * Submit an edit to an already-approved task for sign-off instead of applying it
 * immediately — used when the editor doesn't hold one of Tasks' trusted built-in
 * roles (see getTaskApprovalRequirement). The task keeps showing its
 * last-approved values to everyone else until the change is approved (merged
 * in) or rejected (discarded).
 */
export function submitTaskEdit(
  id: string,
  changes: Partial<TaskItem>,
  submittedBy: string,
  submittedByEmail: string,
  approval: { approverType?: GroupPolicy['approverType']; approverMemberId?: string; approverPolicyTagId?: string; policyName?: string }
): TaskItem | null {
  const tasks = getTasks();
  const target = tasks.find(t => t.id === id);
  if (!target) return null;

  // Only log a 'delegated' step when this edit actually reassigns the task
  // to someone else — an unrelated field edit routed through approval
  // (e.g. a due-date change) isn't a delegation.
  const trail = (changes.assignee || changes.assigneeId)
    ? [...(target.delegationTrail || []), {
        action: 'delegated' as const,
        actorName: submittedBy,
        actorEmail: submittedByEmail,
        targetName: changes.assignee,
        at: new Date().toISOString(),
      }]
    : target.delegationTrail;

  const result = updateTask(id, {
    pendingChange: changes,
    approvalStatus: 'pending_edit',
    approverType: approval.approverType,
    approverMemberId: approval.approverMemberId,
    approverPolicyTagId: approval.approverPolicyTagId,
    approvalPolicyName: approval.policyName,
    submittedBy,
    submittedByEmail,
    delegationTrail: trail,
  }, submittedBy);
  logAuditEvent('TASK_EDIT_SUBMITTED', submittedBy, `Submitted an edit to task "${target.title}" for approval`, submittedByEmail);
  return result;
}

/** Approve a pending task creation or edit. For a pending edit, merges the
 *  staged pendingChange into the record; for a pending creation, simply marks
 *  it approved. */
export function approveTask(id: string, actorName: string, note?: string): TaskItem | null {
  const tasks = getTasks();
  const target = tasks.find(t => t.id === id);
  if (!target) return null;

  const isEdit = target.approvalStatus === 'pending_edit';
  const trail = [...(target.delegationTrail || []), {
    action: 'approved' as const,
    actorName,
    targetName: isEdit ? target.pendingChange?.assignee : undefined,
    note,
    at: new Date().toISOString(),
  }];
  const result = updateTask(id, {
    ...(isEdit ? target.pendingChange : {}),
    approvalStatus: 'approved',
    pendingChange: undefined,
    decidedBy: actorName,
    decidedAt: new Date().toISOString(),
    delegationTrail: trail,
  }, actorName);
  markApprovalRequestsDecided('task', id, 'approved', actorName, note);
  logAuditEvent('TASK_APPROVED', actorName, `Approved ${isEdit ? 'an edit to' : 'the creation of'} task "${target.title}"`);
  return result;
}

/** Reject a pending task creation or edit. A rejected creation is marked
 *  'rejected' (kept for audit, hidden from general view). A rejected edit
 *  simply discards the staged pendingChange — the original approved task
 *  stands. */
export function rejectTask(id: string, actorName: string, reason?: string): TaskItem | null {
  const tasks = getTasks();
  const target = tasks.find(t => t.id === id);
  if (!target) return null;

  const isEdit = target.approvalStatus === 'pending_edit';
  const trail = [...(target.delegationTrail || []), {
    action: 'rejected' as const,
    actorName,
    note: reason,
    at: new Date().toISOString(),
  }];
  const result = updateTask(id, {
    approvalStatus: isEdit ? 'approved' : 'rejected',
    pendingChange: undefined,
    decidedBy: actorName,
    decidedAt: new Date().toISOString(),
    rejectionReason: reason,
    delegationTrail: trail,
  }, actorName);
  markApprovalRequestsDecided('task', id, 'rejected', actorName, reason);
  logAuditEvent('TASK_REJECTED', actorName, `Rejected ${isEdit ? 'an edit to' : 'the creation of'} task "${target.title}"${reason ? `: ${reason}` : ''}`);
  return result;
}

export function canViewTask(
  task: TaskItem, 
  user: { id?: string; name: string; email: string; tier: number; division?: string; committee?: string; role?: string } | null
): boolean {
  if (!user) return false;
  // Tier 1-3 (Super User, Centre Head, Head of Events): see all tasks
  if (user.tier <= 3) return true;
  // Tier 4 (Advisory Board): strategic read-only oversight
  if (user.tier === 4) return true;

  // President, Vice President, and Executive Council: see all tasks
  const role = ((user as any)?.role || '').toLowerCase();
  if (role.includes('president') || role.includes('vice president') || role.includes('chief coordinator')) return true;

  if (task.assigneeType === 'committee') {
    // Check if user's legacy committee field matches committee name
    if (user.committee && (
      user.committee.toLowerCase() === (task.assignee || '').toLowerCase() ||
      user.committee.toLowerCase() === (task.eventCommitteeName || '').toLowerCase()
    )) {
      return true;
    }

    // Check if user's member ID is assigned to the event committee
    const memberId = user.id || getMembers().find(m => m.email.toLowerCase() === user.email.toLowerCase())?.id;
    if (memberId) {
      const events = getEvents();
      const targetEvents = task.eventId ? events.filter(e => e.id === task.eventId) : events;
      const isMember = targetEvents.some(e =>
        e.committees.some(c =>
          (c.id === task.eventCommitteeId || c.name.toLowerCase() === (task.assignee || '').toLowerCase()) &&
          (c.memberIds.includes(memberId) || c.leadMemberId === memberId)
        )
      );
      if (isMember) return true;
    }
    return false;
  }

  // Tier 5-6 (Core Committee, Training Associate): see their assigned individual
  // tasks, or a group task (assigneeType 'group') they're one of the members of.
  const memberId = user.id || getMembers().find(m => m.email.toLowerCase() === user.email.toLowerCase())?.id;
  return Boolean(
    (task.assignee && task.assignee.toLowerCase() === user.name.toLowerCase()) ||
    (task.assigneeEmail && task.assigneeEmail.toLowerCase() === user.email.toLowerCase()) ||
    (task.assigneeId && task.assigneeId === (user as any).id) ||
    (memberId && task.assigneeIds && task.assigneeIds.includes(memberId))
  );
}

/**
 * True only if `user` IS the task's assignee — the individual assignee, or a
 * member of the assigned committee/group. Unlike canViewTask, this grants no
 * broad read-only visibility to leadership/Advisory Board/Executive roles —
 * it's used to gate ACTING on a task (acknowledge/complete it), not just
 * seeing it. See permissions.ts's canChangeTaskStatus, which additionally
 * lets the Centre Head, the Heads of Events, and the Super User act on any
 * task regardless of assignment.
 */
export function isTaskAssignee(
  task: TaskItem,
  user: { id?: string; name: string; email: string } | null
): boolean {
  if (!user) return false;
  const memberId = user.id || getMembers().find(m => m.email.toLowerCase() === user.email.toLowerCase())?.id;

  if (task.assigneeType === 'committee') {
    if (!memberId) return false;
    const events = getEvents();
    const targetEvents = task.eventId ? events.filter(e => e.id === task.eventId) : events;
    return targetEvents.some(e =>
      e.committees.some(c =>
        (c.id === task.eventCommitteeId || c.name.toLowerCase() === (task.assignee || '').toLowerCase()) &&
        (c.memberIds.includes(memberId) || c.leadMemberId === memberId)
      )
    );
  }

  return Boolean(
    (task.assignee && task.assignee.toLowerCase() === user.name.toLowerCase()) ||
    (task.assigneeEmail && task.assigneeEmail.toLowerCase() === user.email.toLowerCase()) ||
    (task.assigneeId && task.assigneeId === memberId) ||
    (memberId && task.assigneeIds && task.assigneeIds.includes(memberId))
  );
}

/**
 * Whether `user` has personally acknowledged this task already — distinct
 * from isTaskAssignee (are they allotted to it at all). For a group or
 * committee task, each assignee's acknowledgment is tracked independently
 * in acknowledgedByIds, so one member acknowledging never makes this true
 * for the others.
 */
export function hasAcknowledgedTask(
  task: TaskItem,
  user: { id?: string; name: string; email: string } | null
): boolean {
  if (!user) return false;
  const memberId = user.id || getMembers().find(m => m.email.toLowerCase() === user.email.toLowerCase())?.id;
  return Boolean(memberId && task.acknowledgedByIds?.includes(memberId));
}

export interface TaskAssigneeStatus {
  id: string;
  name: string;
  email?: string;
  acknowledged: boolean;
  isFaculty?: boolean;
}

/**
 * Returns the individual acknowledgment statuses for all members allotted
 * to a task (individual, group, or committee). Each member's status is
 * tracked independently so group assignments show clearly who has already
 * acknowledged and who is still pending.
 */
export function getTaskAssigneeStatuses(
  task: TaskItem,
  allMembers?: Member[],
  allEvents?: EventItem[]
): TaskAssigneeStatus[] {
  const members = allMembers || getMembers();
  const events = allEvents || getEvents();
  const activeMembers = members.filter(m => m.status !== 'Terminated');
  const byId = new Map(activeMembers.map(m => [m.id, m]));
  const ackIds = new Set(task.acknowledgedByIds || []);

  const checkAck = (mId: string, mEmail?: string, mName?: string) => {
    if (ackIds.has(mId)) return true;
    if (mEmail && (ackIds.has(mEmail) || ackIds.has(mEmail.toLowerCase()))) return true;
    if (task.acknowledged && (task.assigneeId === mId || (mEmail && task.assigneeEmail?.toLowerCase() === mEmail.toLowerCase()))) return true;
    if (mEmail && task.acknowledgedByEmail && task.acknowledgedByEmail.toLowerCase() === mEmail.toLowerCase()) return true;
    return false;
  };

  const checkIsFaculty = (m?: Member, name?: string) => {
    if (m && isFacultyMember(m)) return true;
    if (name && /prof\.|professor|faculty/i.test(name)) return true;
    return false;
  };

  // Group task with explicit assigneeIds
  if (task.assigneeType === 'group' && Array.isArray(task.assigneeIds) && task.assigneeIds.length > 0) {
    return task.assigneeIds.map(id => {
      const m = byId.get(id);
      const name = m ? m.name : id;
      return {
        id,
        name,
        email: m?.email,
        acknowledged: checkAck(id, m?.email, name),
        isFaculty: checkIsFaculty(m, name),
      };
    });
  }

  // Committee task tied to an event
  if (task.assigneeType === 'committee') {
    const event = events.find(e => e.id === task.eventId || (task.event && e.title.toLowerCase() === task.event.toLowerCase()));
    const committee = event?.committees?.find(c =>
      (task.eventCommitteeId && c.id === task.eventCommitteeId) ||
      c.name.toLowerCase() === (task.eventCommitteeName || task.assignee || '').toLowerCase()
    );
    if (committee) {
      const cMemberIds = Array.from(new Set([...(committee.memberIds || []), committee.leadMemberId].filter(Boolean) as string[]));
      if (cMemberIds.length > 0) {
        return cMemberIds.map(id => {
          const m = byId.get(id);
          const isLead = id === committee.leadMemberId;
          const baseName = m ? m.name : id;
          const name = isLead ? `${baseName} (Lead)` : baseName;
          return {
            id,
            name,
            email: m?.email,
            acknowledged: checkAck(id, m?.email, baseName),
            isFaculty: checkIsFaculty(m, baseName),
          };
        });
      }
    }
  }

  // Fallback: If assignee string contains multiple names (e.g. "3 students: Alice, Bob, Charlie")
  if (task.assigneeType === 'group' || (task.assignee && (task.assignee.includes(',') || task.assignee.includes('&')))) {
    const cleaned = task.assignee.replace(/^(\d+\s+students?:\s*)/i, '');
    const rawNames = cleaned.split(/,|&|\band\b/).map(s => s.trim()).filter(Boolean);
    if (rawNames.length > 1) {
      return rawNames.map(rawName => {
        const m = activeMembers.find(mem => mem.name.toLowerCase() === rawName.toLowerCase());
        const id = m?.id || rawName;
        return {
          id,
          name: m?.name || rawName,
          email: m?.email,
          acknowledged: checkAck(id, m?.email, rawName),
          isFaculty: checkIsFaculty(m, rawName),
        };
      });
    }
  }

  // Individual task
  const m = (task.assigneeId ? byId.get(task.assigneeId) : undefined) ||
    (task.assigneeEmail ? activeMembers.find(mem => mem.email.toLowerCase() === task.assigneeEmail!.toLowerCase()) : undefined) ||
    (task.assignee ? activeMembers.find(mem => mem.name.toLowerCase() === task.assignee.toLowerCase()) : undefined);
  const id = m?.id || task.assigneeId || 'individual';
  const name = m?.name || task.assignee || 'Assignee';
  return [{
    id,
    name,
    email: m?.email || task.assigneeEmail,
    acknowledged: checkAck(id, m?.email, name),
    isFaculty: checkIsFaculty(m, name),
  }];
}

/**
 * Returns true if a task's assignees are Faculty or if it represents a
 * Faculty Permission requirement (where permission from any 1 faculty is sufficient).
 */
export function isFacultyTaskAssignees(
  task: TaskItem,
  statuses?: TaskAssigneeStatus[]
): boolean {
  if (task.workflowType === 'holiday_social_approval') return false;
  const list = statuses || getTaskAssigneeStatuses(task);
  if (list.length > 0 && list.some(s => s.isFaculty)) return true;
  const assigneeStr = (task.assignee || '').toLowerCase();
  return /faculty|professor|prof\./.test(assigneeStr);
}

/**
 * Records the current user's own, personal acknowledgment of a task — never
 * a groupmate's, and never on a student's behalf by anyone else, leadership
 * included. The isTaskAssignee check here is just a UX shortcut to skip a
 * doomed request; /api/tasks/ack independently re-verifies server-side that
 * the caller is genuinely one of the task's assignees and only ever records
 * their own id, so this can't be spoofed by calling the API directly either.
 */
export async function acknowledgeTask(
  taskId: string,
  user: { id?: string; name: string; email: string } | null
): Promise<TaskItem | null> {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task || !user || !isTaskAssignee(task, user)) return null;
  if (task.approvalStatus === 'pending_create' || task.approvalStatus === 'pending_edit' || task.approvalStatus === 'rejected') return null;

  const res = await fetch('/api/tasks/ack', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ taskIds: [taskId] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.tasks)) return null;

  const updatedTask = data.tasks.find((t: TaskItem) => t.id === taskId);
  if (!updatedTask) return null;

  const current = getTasks();
  const idx = current.findIndex(t => t.id === taskId);
  if (idx !== -1) {
    current[idx] = { ...current[idx], ...updatedTask };
    saveTasks(current);
  }
  logAuditEvent('TASK_ACKNOWLEDGED', user.name, `Acknowledged task: ${task.title}`);
  return updatedTask;
}

// -------------------------------------------------------------
// Ratings (Tied to Task Performance)
// -------------------------------------------------------------

export function getRatings(): RatingItem[] {
  if (typeof window === 'undefined') return initialRatings;
  const saved = localStorage.getItem('rtbi_ratings');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  // Do NOT seed localStorage here — return sample data without writing
  return initialRatings;
}

export function saveRatings(ratings: RatingItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_ratings', JSON.stringify(ratings));
  markLocalWrite('rtbi_ratings');
}

/**
 * Recomputes a task's single ratingScore summary field as the average of its
 * SUPER_USER, CENTRE_HEAD, ADVISOR, and GG_HEAD reviews (see
 * permissions.ts's resolveRatingReviewerRole) for the given targetId (the
 * parent rating's target — the actual assignee for an individual task, or
 * the committee/group identifier for a fan-out task). The score is the live average
 * of whichever reviewers have submitted so far.
 */
function isCommitteeReviewerRole(role?: string): boolean {
  return role === 'SUPER_USER' || role === 'CENTRE_HEAD' || role === 'ADVISOR' || role === 'GG_HEAD';
}

function recomputeTaskAggregateScore(taskId: string, targetId: string, actorName: string): void {
  const task = getTasks().find(t => t.id === taskId);
  const isFanOutTask = !!task && (task.assigneeType === 'committee' || !!task.eventCommitteeId || task.assigneeType === 'group');
  if (isFanOutTask) {
    // A committee/group's score is the average of its members' own ratings
    // (the per-student rows), so students rated individually count at their
    // own score. Falls back to the bookkeeping row if nothing fanned out.
    const rows = getRatings().filter(r => r.taskId === taskId && isCommitteeReviewerRole(r.reviewerRole));
    const perStudent = rows.filter(r => !r.isGroupPlaceholder);
    const basis = perStudent.length > 0 ? perStudent : rows;
    if (basis.length === 0) return;
    const committeeAvg = parseFloat((basis.reduce((sum, r) => sum + r.overallScore, 0) / basis.length).toFixed(2));
    updateTask(taskId, { ratingScore: committeeAvg, ratedAt: new Date().toISOString().split('T')[0] }, actorName);
    return;
  }
  const relevant = getRatings().filter(
    r => r.taskId === taskId && r.targetId === targetId && (
      r.reviewerRole === 'SUPER_USER' ||
      r.reviewerRole === 'CENTRE_HEAD' ||
      r.reviewerRole === 'ADVISOR' ||
      r.reviewerRole === 'GG_HEAD'
    )
  );
  if (relevant.length === 0) return;
  const avg = parseFloat((relevant.reduce((sum, r) => sum + r.overallScore, 0) / relevant.length).toFixed(2));
  updateTask(taskId, { ratingScore: avg, ratedAt: new Date().toISOString().split('T')[0] }, actorName);
}

function propagateCommitteeRating(task: TaskItem, parentRating: RatingItem): void {
  const events = getEvents();
  const event = events.find(e => e.id === task.eventId || e.title === task.event);
  if (!event) {
    console.warn(`[propagateCommitteeRating] No linked event found for committee task "${task.title}" — no student ratings were created.`);
    return;
  }

  const committee = (event.committees || []).find(
    c => c.id === task.eventCommitteeId || c.name.toLowerCase() === task.assignee.toLowerCase()
  );
  if (!committee || !committee.memberIds || committee.memberIds.length === 0) {
    console.warn(`[propagateCommitteeRating] No matching committee with members found for task "${task.title}" (eventCommitteeId: ${task.eventCommitteeId || 'unset'}) — no student ratings were created.`);
    return;
  }

  const members = getMembers();
  const ratings = getRatings();
  let updated = false;

  committee.memberIds.forEach(mId => {
    const memberObj = members.find(m => m.id === mId || m.name.toLowerCase() === mId.toLowerCase());
    if (!memberObj) return;
    if (isFacultyMember(memberObj)) return;
    if (isSocialMediaPostTask(task) && !isSocialMediaTeamMember(memberObj)) return;

    // Scoped to the SAME reviewer role: a second reviewer (e.g. the GG Head,
    // fanning out after the Centre Head already rated this committee) must
    // still get their own row per member, not be silently skipped because
    // the Centre Head's rows already exist. If this exact reviewer already
    // rated this member for this task, update their existing row in place
    // (matches the "re-review edits your own score" rule) instead of adding
    // a duplicate.
    const existingIdx = ratings.findIndex(
      r => r.taskId === task.id && (r.targetId === memberObj.id || r.targetName.toLowerCase() === memberObj.name.toLowerCase()) && r.reviewerRole === parentRating.reviewerRole
    );

    if (existingIdx !== -1) {
      ratings[existingIdx] = {
        ...ratings[existingIdx],
        criteriaSet: parentRating.criteriaSet,
        scores: parentRating.scores,
        quality: parentRating.quality,
        timeliness: parentRating.timeliness,
        initiative: parentRating.initiative,
        collaboration: parentRating.collaboration,
        overallScore: parentRating.overallScore,
        notes: `[Committee Evaluation: ${committee.name}] ${parentRating.notes || ''}`.trim(),
        updatedAt: new Date().toISOString().split('T')[0],
      };
      serverPatch('/api/ratings', ratings[existingIdx].id, ratings[existingIdx]);
      updated = true;
      return;
    }

    const studentRating: RatingItem = {
      id: 'r_comm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      taskId: task.id,
      taskTitle: task.title,
      eventId: task.eventId,
      eventName: task.event,
      targetId: memberObj.id,
      targetName: memberObj.name,
      raterName: parentRating.raterName,
      reviewerRole: parentRating.reviewerRole,
      criteriaSet: parentRating.criteriaSet,
      scores: parentRating.scores,
      quality: parentRating.quality,
      timeliness: parentRating.timeliness,
      initiative: parentRating.initiative,
      collaboration: parentRating.collaboration,
      overallScore: parentRating.overallScore,
      notes: `[Committee Evaluation: ${committee.name}] ${parentRating.notes || ''}`.trim(),
      createdAt: parentRating.createdAt
    };
    ratings.unshift(studentRating);
    serverPost('/api/ratings', studentRating);
    updated = true;
  });

  if (updated) {
    saveRatings(ratings);
  }
}

/**
 * Same fan-out as propagateCommitteeRating, but for an ad-hoc 'group' task —
 * there's no EventCommittee to look up, just the assigneeIds already stored
 * directly on the task.
 */
function propagateGroupRating(task: TaskItem, parentRating: RatingItem): void {
  if (!task.assigneeIds || task.assigneeIds.length === 0) return;

  const members = getMembers();
  const ratings = getRatings();
  let updated = false;

  task.assigneeIds.forEach(mId => {
    const memberObj = members.find(m => m.id === mId);
    if (!memberObj) return;
    if (isFacultyMember(memberObj)) return;
    if (isSocialMediaPostTask(task) && !isSocialMediaTeamMember(memberObj)) return;

    // Same same-reviewer-role scoping as propagateCommitteeRating above.
    const existingIdx = ratings.findIndex(
      r => r.taskId === task.id && r.targetId === memberObj.id && r.reviewerRole === parentRating.reviewerRole
    );

    if (existingIdx !== -1) {
      ratings[existingIdx] = {
        ...ratings[existingIdx],
        criteriaSet: parentRating.criteriaSet,
        scores: parentRating.scores,
        quality: parentRating.quality,
        timeliness: parentRating.timeliness,
        initiative: parentRating.initiative,
        collaboration: parentRating.collaboration,
        overallScore: parentRating.overallScore,
        notes: `[Group Evaluation] ${parentRating.notes || ''}`.trim(),
        updatedAt: new Date().toISOString().split('T')[0],
      };
      serverPatch('/api/ratings', ratings[existingIdx].id, ratings[existingIdx]);
      updated = true;
      return;
    }

    const studentRating: RatingItem = {
      id: 'r_group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      taskId: task.id,
      taskTitle: task.title,
      eventId: task.eventId,
      eventName: task.event,
      targetId: memberObj.id,
      targetName: memberObj.name,
      raterName: parentRating.raterName,
      reviewerRole: parentRating.reviewerRole,
      criteriaSet: parentRating.criteriaSet,
      scores: parentRating.scores,
      quality: parentRating.quality,
      timeliness: parentRating.timeliness,
      initiative: parentRating.initiative,
      collaboration: parentRating.collaboration,
      overallScore: parentRating.overallScore,
      notes: `[Group Evaluation] ${parentRating.notes || ''}`.trim(),
      createdAt: parentRating.createdAt
    };
    ratings.unshift(studentRating);
    serverPost('/api/ratings', studentRating);
    updated = true;
  });

  if (updated) {
    saveRatings(ratings);
  }
}

/**
 * Rate only some of a committee's/group's members (or a single student) with
 * one scorecard, leaving the rest to be rated separately. Writes real
 * per-student rows only -- no committee-level bookkeeping row -- so each
 * student keeps exactly the score they were given, and the task's overall
 * score becomes the average across all its per-student ratings.
 * Re-rating a student this reviewer already rated edits that row in place.
 */
export function rateTaskMembers(
  task: TaskItem,
  memberIds: string[],
  input: Pick<RatingItem, 'raterName' | 'reviewerRole' | 'criteriaSet' | 'scores' | 'quality' | 'timeliness' | 'initiative' | 'collaboration' | 'overallScore' | 'notes' | 'lateNote'>
): RatingItem[] {
  const members = getMembers();
  const ratings = getRatings();
  const today = new Date().toISOString().split('T')[0];
  const touched: RatingItem[] = [];
  const label = task.assigneeType === 'group' ? 'Group Evaluation' : `Committee Evaluation: ${task.eventCommitteeName || task.assignee}`;
  const notes = `[${label} \u2014 individual/subset rating] ${input.notes || ''}`.trim();

  memberIds.forEach(mId => {
    const memberObj = members.find(m => m.id === mId);
    if (!memberObj || isFacultyMember(memberObj)) return;
    if (isSocialMediaPostTask(task) && !isSocialMediaTeamMember(memberObj)) return;

    const existingIdx = ratings.findIndex(
      r => r.taskId === task.id && !r.isGroupPlaceholder && r.targetId === memberObj.id &&
        ((input.reviewerRole && r.reviewerRole === input.reviewerRole) || r.raterName === input.raterName)
    );
    if (existingIdx !== -1) {
      ratings[existingIdx] = { ...ratings[existingIdx], ...input, notes, updatedAt: today };
      serverPatch('/api/ratings', ratings[existingIdx].id, ratings[existingIdx]);
      touched.push(ratings[existingIdx]);
      return;
    }
    const row: RatingItem = {
      ...input,
      id: 'r_sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      taskId: task.id,
      taskTitle: task.title,
      eventId: task.eventId,
      eventName: task.event,
      targetId: memberObj.id,
      targetName: memberObj.name,
      notes,
      createdAt: today,
    };
    ratings.unshift(row);
    serverPost('/api/ratings', row);
    touched.push(row);
  });

  if (touched.length > 0) {
    saveRatings(ratings);
    recomputeTaskAggregateScore(task.id, touched[0].targetId, input.raterName);
    logAuditEvent('RATING_SUBMITTED', input.raterName, `Evaluated ${touched.length} member(s) (${input.overallScore}/5.0) individually on "${task.title}": ${touched.map(r => r.targetName).join(', ')}`);
  }
  return touched;
}

export function addRating(rating: Omit<RatingItem, 'id' | 'createdAt'>): RatingItem {
  // Direct correlation check: every rating MUST directly correlate to an existing task
  if (!rating.taskId || typeof rating.taskId !== 'string' || !rating.taskId.trim()) {
    throw new Error('Direct correlation check failed: a rating must directly correlate to an existing task.');
  }
  const task = getTasks().find(t => t.id === rating.taskId);
  if (!task) {
    throw new Error('Direct correlation check failed: no corresponding task found for this rating.');
  }

  const members = getMembers();
  const targetMember = members.find(m => m.id === rating.targetId || m.name.toLowerCase() === rating.targetName.toLowerCase());
  if ((targetMember && isFacultyMember(targetMember)) || /prof\.|professor|faculty/i.test(rating.targetName)) {
    throw new Error('Professors and faculty members cannot receive performance ratings.');
  }
  if (isSocialMediaPostTask(task)) {
    if (!targetMember || !isSocialMediaTeamMember(targetMember)) {
      throw new Error('Only student members of the Social Media team can be evaluated for social media posts.');
    }
  }

  const ratings = getRatings();
  const newRating: RatingItem = {
    ...rating,
    id: 'r_' + Date.now(),
    createdAt: new Date().toISOString().split('T')[0]
  };
  ratings.unshift(newRating);
  saveRatings(ratings);
  serverPost('/api/ratings', newRating);

  if (rating.taskId) {
    recomputeTaskAggregateScore(rating.taskId, rating.targetId, rating.raterName);

    const task = getTasks().find(t => t.id === rating.taskId);
    if (task && (task.assigneeType === 'committee' || task.eventCommitteeId)) {
      propagateCommitteeRating(task, newRating);
    } else if (task && task.assigneeType === 'group') {
      propagateGroupRating(task, newRating);
    }
    // Re-average now that the per-student rows exist.
    recomputeTaskAggregateScore(rating.taskId, rating.targetId, rating.raterName);
  }

  logAuditEvent('RATING_SUBMITTED', rating.raterName, `Evaluated task performance (${rating.overallScore}/5.0) for ${rating.targetName} on "${rating.taskTitle}"`);
  return newRating;
}

export function updateRating(id: string, updates: Partial<RatingItem>, actorName: string): RatingItem | null {
  const ratings = getRatings();
  const idx = ratings.findIndex(r => r.id === id);
  if (idx === -1) return null;

  ratings[idx] = {
    ...ratings[idx],
    ...updates,
    updatedAt: new Date().toISOString().split('T')[0]
  };
  saveRatings(ratings);
  // Send the full merged rating, not just the diff, so a server-side upsert (a
  // client-only sample rating that was never POSTed) creates a complete record.
  serverPatch('/api/ratings', id, ratings[idx]);

  if (ratings[idx].taskId && updates.overallScore !== undefined) {
    recomputeTaskAggregateScore(ratings[idx].taskId, ratings[idx].targetId, actorName);
  }

  logAuditEvent('RATING_UPDATED', actorName, `Updated evaluation scorecard for ${ratings[idx].targetName}`);
  return ratings[idx];
}

export function deleteRating(id: string, actorName: string): boolean {
  const ratings = getRatings();
  const target = ratings.find(r => r.id === id);
  if (!target) return false;

  const updated = ratings.filter(r => r.id !== id);
  saveRatings(updated);
  serverDelete('/api/ratings', id);
  logAuditEvent('RATING_DELETED', actorName, `Deleted rating record for ${target.targetName}`);
  return true;
}

// -------------------------------------------------------------
// Student Profiles & Individual Outcomes Aggregation
// -------------------------------------------------------------

export interface StudentProfileData {
  member: Member;
  assignedEvents: { event: EventItem; committee: EventCommittee }[];
  tasks: TaskItem[];
  ratings: RatingItem[];
  stats: {
    totalTasks: number;
    completedTasks: number;
    completionRate: number;
    averageRating: number;
    qualityAvg: number;
    timelinessAvg: number;
    initiativeAvg: number;
    collaborationAvg: number;
    totalEvents: number;
  };
}

export function getStudentProfile(memberIdOrName: string, passedMember?: Member): StudentProfileData | null {
  const member = passedMember || (() => {
    const members = getMembers();
    return members.find(m => m.id === memberIdOrName || m.name.toLowerCase() === memberIdOrName.toLowerCase());
  })();
  if (!member) return null;

  const events = getEvents();
  const assignedEvents: { event: EventItem; committee: EventCommittee }[] = [];
  events.forEach(event => {
    (event.committees || []).forEach(comm => {
      if (comm.memberIds.includes(member.id) || comm.memberIds.includes(member.name)) {
        assignedEvents.push({ event, committee: comm });
      }
    });
  });

  const allTasks = getTasks();
  const memberTasks = allTasks.filter(t => {
    if (t.assigneeId === member.id || t.assignee.toLowerCase() === member.name.toLowerCase()) return true;
    if (member.email && t.assigneeEmail && t.assigneeEmail.toLowerCase() === member.email.toLowerCase()) return true;
    if (t.assigneeType === 'committee' || t.eventCommitteeId) {
      return assignedEvents.some(ae =>
        ae.committee.id === t.eventCommitteeId ||
        ae.committee.name.toLowerCase() === t.assignee.toLowerCase()
      );
    }
    return false;
  });

  const validTaskIds = new Set(allTasks.map(t => t.id));
  const allRatings = getRatings();
  const memberRatings = allRatings.filter(r =>
    !r.isGroupPlaceholder &&
    r.taskId &&
    validTaskIds.has(r.taskId) &&
    (r.targetId === member.id || r.targetName.toLowerCase() === member.name.toLowerCase())
  );

  const totalTasks = memberTasks.length;
  const completedTasks = memberTasks.filter(t => t.status === 'Completed').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  let qualitySum = 0, timelinessSum = 0, initiativeSum = 0, collaborationSum = 0, overallSum = 0;
  memberRatings.forEach(r => {
    qualitySum += r.quality;
    timelinessSum += r.timeliness;
    initiativeSum += r.initiative;
    collaborationSum += r.collaboration;
    overallSum += r.overallScore;
  });

  const ratingCount = memberRatings.length;
  const averageRating = ratingCount > 0 ? parseFloat((overallSum / ratingCount).toFixed(1)) : 0;
  const qualityAvg = ratingCount > 0 ? parseFloat((qualitySum / ratingCount).toFixed(1)) : 0;
  const timelinessAvg = ratingCount > 0 ? parseFloat((timelinessSum / ratingCount).toFixed(1)) : 0;
  const initiativeAvg = ratingCount > 0 ? parseFloat((initiativeSum / ratingCount).toFixed(1)) : 0;
  const collaborationAvg = ratingCount > 0 ? parseFloat((collaborationSum / ratingCount).toFixed(1)) : 0;

  return {
    member,
    assignedEvents,
    tasks: memberTasks,
    ratings: memberRatings,
    stats: {
      totalTasks,
      completedTasks,
      completionRate,
      averageRating,
      qualityAvg,
      timelinessAvg,
      initiativeAvg,
      collaborationAvg,
      totalEvents: assignedEvents.length
    }
  };
}

export function getStudentLeaderboard(): {
  id: string;
  name: string;
  role: string;
  division: string;
  score: number;
  rawScore: number;
  recencyScore: number;
  consistencyRatio: number;
  completedTasks: number;
  totalTasks: number;
  ratingsCount: number;
}[] {
  const members = getMembers();
  // Student contributors (Core Committee, Training Associates, Alumni) plus Super Users, who are evaluated on their
  // tasks like everyone else and are ranked alongside the students.
  const studentMembers = members.filter(m => m.tier === 1 || m.tier >= 3);

  // The leaderboard shows exactly what the Reports module's "Student Final Score" shows (same ratings, same
  // formula — see final-score.ts), so the two never disagree. Same rating filter as the Reports page: only
  // ratings of an existing task, no committee/group placeholder rows, no faculty/professors.
  const validTaskIds = new Set(getTasks().map(t => t.id));
  const validRatings = getRatings().filter(r => {
    if (r.isGroupPlaceholder || !r.taskId || !validTaskIds.has(r.taskId)) return false;
    const target = members.find(m => m.id === r.targetId || m.name.toLowerCase() === r.targetName.toLowerCase());
    if (target && /prof\.|professor|faculty/i.test(target.role || '')) return false;
    if (/prof\.|professor|faculty/i.test(r.targetName)) return false;
    return true;
  });

  // Several reviewers rating the same student on the same task count as ONE evaluation (their average)
  const byStudentTask = new Map<string, RatingItem[]>();
  validRatings.forEach(r => {
    const key = `${r.targetId || r.targetName}_${r.taskId || r.taskTitle}`;
    const group = byStudentTask.get(key);
    if (group) group.push(r); else byStudentTask.set(key, [r]);
  });
  const evaluations = Array.from(byStudentTask.values()).map(group => ({
    targetName: group[0].targetName,
    eventName: group[0].eventName,
    overallScore: group.reduce((sum, r) => sum + r.overallScore, 0) / group.length,
  }));

  const finalByName = new Map(
    buildStudentFinalScores(evaluations).map(f => [f.name.toLowerCase(), f])
  );

  const results = studentMembers.map(m => {
    const profile = getStudentProfile(m.id);
    const f = finalByName.get(m.name.toLowerCase());
    return {
      id: m.id,
      name: m.name,
      role: m.role,
      division: m.division,
      score: f ? f.finalScore : 0,
      rawScore: f ? f.avgScore : 0,
      recencyScore: f ? f.avgScore : 0,
      consistencyRatio: 1,
      completedTasks: profile?.stats.completedTasks || 0,
      totalTasks: profile?.stats.totalTasks || 0,
      ratingsCount: f ? f.taskCount : 0,
    };
  });

  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.ratingsCount !== a.ratingsCount) return b.ratingsCount - a.ratingsCount;
    return b.completedTasks - a.completedTasks;
  });
}

// -------------------------------------------------------------
// Reimbursements (Two-Stage Approval)
// -------------------------------------------------------------

export function getReimbursements(): ReimbursementItem[] {
  if (typeof window === 'undefined') return initialReimbursements;
  const saved = localStorage.getItem('rtbi_reimbursements');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  // Do NOT seed localStorage here — return sample data without writing
  return initialReimbursements;
}

export function saveReimbursements(reimbursements: ReimbursementItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_reimbursements', JSON.stringify(reimbursements));
  markLocalWrite('rtbi_reimbursements');
}

export async function addReimbursement(item: Omit<ReimbursementItem, 'id' | 'status' | 'submittedAt'>, onProgress?: UploadProgressCallback): Promise<ReimbursementItem> {
  const newClaim: ReimbursementItem = {
    ...item,
    id: 'rem_' + Date.now(),
    status: 'Pending',
    submittedAt: new Date().toISOString().split('T')[0]
  };

  // POST to server first so receipt files are written to disk and receiptFiles
  // gets real storageKey/url values, before this claim ever touches localStorage.
  const serverResult = await serverPost('/api/reimbursements', newClaim, onProgress);
  if (!serverResult) {
    throw new Error('The claim failed to reach the server. Please check your connection and try again.');
  }

  const createdClaim: ReimbursementItem = { ...newClaim, ...serverResult };

  const current = getReimbursements();
  current.unshift(createdClaim);
  saveReimbursements(current);
  logAuditEvent('REIMBURSEMENT_CLAIMED', item.memberName, `Submitted expense claim of ₹${item.amount} under ${item.category}`);
  return createdClaim;
}

export function updateReimbursementStatus(
  id: string,
  status: ReimbursementItem['status'],
  reviewerInfo?: { name: string; stage?: 'firstPass' | 'final'; tier?: number }
): ReimbursementItem | null {
  const current = getReimbursements();
  const idx = current.findIndex(r => r.id === id);
  if (idx === -1) return null;

  const claim = current[idx];
  claim.status = status;
  claim.decidedAt = new Date().toISOString().split('T')[0];

  if (reviewerInfo) {
    const effectiveStage = reviewerInfo.tier !== undefined
      ? (reviewerInfo.tier <= 3 ? 'final' : 'firstPass')
      : (reviewerInfo.stage || 'final');

    if (effectiveStage === 'firstPass') {
      claim.firstPassReviewer = reviewerInfo.name;
    } else {
      claim.finalApprover = reviewerInfo.name;
    }
    logAuditEvent('REIMBURSEMENT_STATUS_UPDATED', reviewerInfo.name, `Updated claim #${claim.id} status to "${status}" (${effectiveStage})`);
  }

  saveReimbursements(current);
  serverPatch('/api/reimbursements', id, claim);
  return claim;
}

// -------------------------------------------------------------
// Budgets — Centre Head submits event/monthly requests, Finance Head decides
// -------------------------------------------------------------

export function getBudgets(): BudgetItem[] {
  if (typeof window === 'undefined') return initialBudgets;
  const saved = localStorage.getItem('rtbi_budgets');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  return initialBudgets;
}

export function saveBudgets(budgets: BudgetItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_budgets', JSON.stringify(budgets));
  markLocalWrite('rtbi_budgets');
}

export function addBudget(item: Omit<BudgetItem, 'id' | 'status' | 'submittedAt'>): BudgetItem {
  const current = getBudgets();
  const newBudget: BudgetItem = {
    ...item,
    id: 'bud_' + Date.now(),
    status: 'Pending',
    submittedAt: new Date().toISOString().split('T')[0],
  };
  current.unshift(newBudget);
  saveBudgets(current);
  serverPost('/api/budgets', newBudget);
  const scopeLabel = item.type === 'event' ? (item.eventName || 'an event') : (item.month || 'a month');
  logAuditEvent('BUDGET_SUBMITTED', item.submittedBy, `Submitted a ₹${item.amount.toLocaleString()} budget request for ${scopeLabel}`, item.submittedByEmail);
  return newBudget;
}

export function decideBudget(
  id: string,
  status: 'Approved' | 'Rejected',
  decidedBy: string,
  decisionNotes?: string
): BudgetItem | null {
  const current = getBudgets();
  const idx = current.findIndex(b => b.id === id);
  if (idx === -1) return null;

  current[idx] = {
    ...current[idx],
    status,
    decidedBy,
    decidedAt: new Date().toISOString().split('T')[0],
    decisionNotes,
  };
  saveBudgets(current);
  serverPatch('/api/budgets', id, current[idx]);
  logAuditEvent('BUDGET_DECIDED', decidedBy, `${status} the ₹${current[idx].amount.toLocaleString()} budget request from ${current[idx].submittedBy}`);
  return current[idx];
}

/** Centre Head stage-1 verification, gating a budget's stage-2 Finance Head decision. */
export function verifyBudgetByCentreHead(id: string, reviewerName: string): BudgetItem | null {
  const current = getBudgets();
  const idx = current.findIndex(b => b.id === id);
  if (idx === -1) return null;

  current[idx] = {
    ...current[idx],
    centreHeadVerified: true,
    centreHeadVerifiedBy: reviewerName,
    centreHeadVerifiedAt: new Date().toISOString().split('T')[0],
  };
  saveBudgets(current);
  serverPatch('/api/budgets', id, current[idx]);
  logAuditEvent('BUDGET_VERIFIED', reviewerName, `Centre Head verified a ₹${current[idx].amount.toLocaleString()} budget request, sending it to Finance Head`);
  return current[idx];
}

/**
 * Lets the Centre Head revise their own budget request — before Finance
 * Head has decided, or even after it was already Approved. Either way the
 * edit always resets it to Pending: a changed Approved budget no longer
 * reflects what was actually approved, so it must be re-approved rather
 * than silently keeping its old Approved status with new numbers.
 */
export function updateBudget(id: string, updates: Partial<BudgetItem>, actorName: string): BudgetItem | null {
  const current = getBudgets();
  const idx = current.findIndex(b => b.id === id);
  if (idx === -1) return null;

  const wasApproved = current[idx].status === 'Approved';
  current[idx] = {
    ...current[idx],
    ...updates,
    status: 'Pending',
    decidedBy: undefined,
    decidedAt: undefined,
    decisionNotes: undefined,
    // Composition changed — the Centre Head's earlier verification no longer
    // reflects what's actually being sent to Finance Head, so it must happen again.
    centreHeadVerified: false,
    centreHeadVerifiedBy: undefined,
    centreHeadVerifiedAt: undefined,
  };
  saveBudgets(current);
  serverPatch('/api/budgets', id, current[idx]);
  logAuditEvent(
    'BUDGET_EDITED',
    actorName,
    `Edited a ₹${current[idx].amount.toLocaleString()} budget request${wasApproved ? ' that was previously Approved — now pending re-approval' : ''}`
  );
  return current[idx];
}

// -------------------------------------------------------------
// Procurement Requests — any member submits, Centre Head/Advisor decide
// -------------------------------------------------------------

export const initialProcurementRequests: ProcurementRequestItem[] = [];

export function getProcurementRequests(): ProcurementRequestItem[] {
  if (typeof window === 'undefined') return initialProcurementRequests;
  const saved = localStorage.getItem('rtbi_procurement_requests');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  return initialProcurementRequests;
}

export function saveProcurementRequests(items: ProcurementRequestItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_procurement_requests', JSON.stringify(items));
  markLocalWrite('rtbi_procurement_requests');
}

function isProcurementAutoApprover(user?: { role?: string; tier?: number; division?: string } | null): boolean {
  if (!user) return false;
  if (user.tier === 1 || user.tier === 2) return true;
  const role = (user.role || '').toLowerCase();
  const division = (user.division || '').toLowerCase();
  return (
    role.includes('ceo') ||
    role.includes('director') ||
    role.includes('head') ||
    division.includes('leadership')
  );
}

export function createProcurementTask(
  request: ProcurementRequestItem,
  members: Member[],
  events: EventItem[],
  tasks: TaskItem[]
): TaskItem {
  const active = members.filter(m => m.status !== 'Terminated' && m.email);
  const ceoUser = active.find(m => {
    const role = (m.role || '').toLowerCase();
    return m.tier === 2 || role.includes('ceo') || role.includes('director') || role.includes('head');
  }) || active.find(m => m.tier === 1) || active[0];

  const itemsSummary = request.items.map(i => `${i.quantity} ${i.unit || ''} ${i.name}`.replace(/\s+/g, ' ').trim()).join(', ');
  const title = `Procure items for ${request.eventName || request.taskTitle || 'Operations'}: ${itemsSummary.length > 80 ? itemsSummary.slice(0, 77) + '...' : itemsSummary}`;

  let dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  if (request.eventId) {
    const ev = events.find(e => e.id === request.eventId);
    if (ev?.startDate && !ev.datesTBD) dueDate = ev.startDate;
  } else if (request.taskId) {
    const t = tasks.find(tk => tk.id === request.taskId);
    if (t?.dueDate) dueDate = t.dueDate;
  }

  const itemsDetail = (request.items || [])
    .map(i => `• ${i.quantity} ${i.unit || ''} ${i.name}${i.notes ? ` (${i.notes})` : ''}`)
    .join('\n');

  const briefDescription = `Procurement Request:\n${itemsDetail}\n\nRequested by: ${request.requesterName}${request.justification ? `\nJustification: ${request.justification}` : ''}\n\nNote: Procurement tasks are administrative operations and not subject to ratings or reviews.`;

  return {
    id: `task_procurement_${request.id}`,
    title,
    event: request.eventName,
    eventId: request.eventId,
    assignee: ceoUser ? ceoUser.name : 'CEO',
    assigneeId: ceoUser?.id,
    assigneeEmail: ceoUser?.email,
    assigneeType: 'individual',
    dueDate,
    status: 'Assigned',
    creatorName: request.requesterName || 'Procurement System',
    workflowType: 'procurement',
    isProcurement: true,
    procurementId: request.id,
    briefDescription,
  };
}

export function addProcurementRequest(
  item: Omit<ProcurementRequestItem, 'id' | 'status' | 'submittedAt'>,
  user?: { id?: string; name?: string; email?: string; role?: string; tier?: number; division?: string }
): ProcurementRequestItem {
  const current = getProcurementRequests();
  const members = getMembers();
  const requester = user || members.find(m => m.id === item.requesterId || (item.requesterEmail && m.email?.toLowerCase() === item.requesterEmail.toLowerCase()));
  const isAutoApprover = isProcurementAutoApprover(requester);

  const id = 'proc_' + Date.now();
  const status = isAutoApprover ? 'Approved' : 'Pending';
  const decidedBy = isAutoApprover ? (requester?.name || item.requesterName) : undefined;
  const decidedAt = isAutoApprover ? new Date().toISOString() : undefined;
  const decisionNotes = isAutoApprover ? 'Auto-approved (created by Centre Head / Advisor / Super User)' : undefined;

  let procurementTaskId: string | undefined = undefined;

  const newRequest: ProcurementRequestItem = {
    ...item,
    id,
    status,
    decidedBy,
    decidedAt,
    decisionNotes,
    submittedAt: new Date().toISOString(),
  };

  if (isAutoApprover) {
    const task = createProcurementTask(newRequest, members, getEvents(), getTasks());
    procurementTaskId = task.id;
    newRequest.procurementTaskId = task.id;
    addTask(task);
  }

  current.unshift(newRequest);
  saveProcurementRequests(current);
  serverPost('/api/procurement-requests', newRequest);
  const scopeLabel = item.eventName || item.taskTitle || 'no linked event/task';
  logAuditEvent(
    'PROCUREMENT_REQUEST_SUBMITTED',
    item.requesterName,
    isAutoApprover
      ? `Added and auto-approved procurement of ${item.items.length} item(s) for ${scopeLabel} (task assigned to Centre Head)`
      : `Requested procurement of ${item.items.length} item(s) for ${scopeLabel}`,
    item.requesterEmail
  );
  return newRequest;
}

export function decideProcurementRequest(
  id: string,
  status: 'Approved' | 'Rejected',
  decidedBy: string,
  decisionNotes?: string
): ProcurementRequestItem | null {
  const current = getProcurementRequests();
  const idx = current.findIndex(r => r.id === id);
  if (idx === -1) return null;

  let procurementTaskId = current[idx].procurementTaskId;

  if (status === 'Approved') {
    const tasks = getTasks();
    const existingTask = tasks.find(t => t.id === `task_procurement_${id}` || t.procurementId === id);
    if (!existingTask) {
      const task = createProcurementTask({ ...current[idx], status: 'Approved' }, getMembers(), getEvents(), tasks);
      procurementTaskId = task.id;
      addTask(task);
    } else {
      procurementTaskId = existingTask.id;
    }
  }

  current[idx] = {
    ...current[idx],
    status,
    decidedBy,
    decidedAt: new Date().toISOString(),
    decisionNotes,
    procurementTaskId,
  };
  saveProcurementRequests(current);
  serverPatch('/api/procurement-requests', id, current[idx]);
  logAuditEvent('PROCUREMENT_REQUEST_DECIDED', decidedBy, `${status} the procurement request from ${current[idx].requesterName}`);
  return current[idx];
}

/**
 * Marks an already-Approved request Completed — the items have actually
 * been procured and issued to the requester. Same Centre Head/Advisor gate
 * as decideProcurementRequest (see permissions.ts's canDecideProcurementRequest).
 */
export function completeProcurementRequest(id: string, completedBy: string): ProcurementRequestItem | null {
  const current = getProcurementRequests();
  const idx = current.findIndex(r => r.id === id);
  if (idx === -1) return null;

  current[idx] = {
    ...current[idx],
    status: 'Completed',
    completedBy,
    completedAt: new Date().toISOString(),
  };

  const tasks = getTasks();
  const linkedTask = tasks.find(t => t.id === `task_procurement_${id}` || t.procurementId === id || t.id === current[idx].procurementTaskId);
  if (linkedTask && linkedTask.status !== 'Completed') {
    updateTask(linkedTask.id, { status: 'Completed' }, completedBy);
  }

  saveProcurementRequests(current);
  serverPatch('/api/procurement-requests', id, current[idx]);
  logAuditEvent('PROCUREMENT_REQUEST_COMPLETED', completedBy, `Marked the procurement request from ${current[idx].requesterName} as completed`);
  return current[idx];
}

/**
 * Lets the requester revise and resubmit their own request — before a
 * decision, or even after Rejected. Either way the edit always resets it
 * to Pending, mirroring updateBudget's "any edit resets to Pending" rule,
 * and re-fans-out the Centre Head/Advisor approval email.
 */
export function updateProcurementRequest(id: string, updates: Partial<ProcurementRequestItem>, actorName: string): ProcurementRequestItem | null {
  const current = getProcurementRequests();
  const idx = current.findIndex(r => r.id === id);
  if (idx === -1) return null;

  current[idx] = {
    ...current[idx],
    ...updates,
    status: 'Pending',
    decidedBy: undefined,
    decidedAt: undefined,
    decisionNotes: undefined,
    approvalEmailSent: undefined,
    approvalEmailError: undefined,
  };
  saveProcurementRequests(current);
  serverPatch('/api/procurement-requests', id, current[idx]);
  logAuditEvent('PROCUREMENT_REQUEST_RESUBMITTED', actorName, `Resubmitted a procurement request for ${current[idx].eventName || current[idx].taskTitle || 'no linked event/task'}`);
  return current[idx];
}

export function deleteProcurementRequest(id: string, actorName: string): void {
  const current = getProcurementRequests();
  const filtered = current.filter(r => r.id !== id);
  saveProcurementRequests(filtered);
  serverDelete('/api/procurement-requests', id);
  logAuditEvent('PROCUREMENT_REQUEST_DELETED', actorName, 'Deleted a procurement request');
}

// Indian financial year runs Apr 1 - Mar 31. Month index 0 (Jan) - 11 (Dec).
function getFinancialYearForDate(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1; // Apr(3)-Dec -> this year; Jan-Mar -> previous year
  return `${startYear}-${startYear + 1}`;
}

function getMonthKeyForDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getCurrentFinancialYear(): string {
  return getFinancialYearForDate(new Date().toISOString());
}

/**
 * When a TBD event's date is set (or an already-dated event's date moves to
 * a different month), any budget line item already planned against it needs
 * to move out of its old monthly budget and into the one matching the
 * event's real date, so monthly/annual totals keep reflecting where the
 * money is actually going. Approved months whose composition changes this
 * way are reset to Pending, mirroring updateBudget()'s "edited budgets need
 * re-approval" rule.
 */
export function syncBudgetLineItemsForEvent(eventId: string): void {
  const event = getEventById(eventId);
  if (!event || event.datesTBD || !event.startDate) return; // no real date to bucket by yet

  const targetMonth = getMonthKeyForDate(event.startDate);
  const targetFY = getFinancialYearForDate(event.startDate);
  const budgets = getBudgets();
  const touchedIds = new Set<string>();
  const pulled: BudgetLineItem[] = [];

  for (const b of budgets) {
    if (b.type !== 'monthly' || b.month === targetMonth || !b.lineItems?.length) continue;
    const matching = b.lineItems.filter(li => li.eventId === eventId);
    if (!matching.length) continue;

    b.lineItems = b.lineItems.filter(li => li.eventId !== eventId);
    b.amount = b.lineItems.reduce((s, li) => s + (li.amount || li.proposedAmount || 0), 0);
    b.proposedAmount = b.amount;
    if (b.status === 'Approved') {
      b.status = 'Pending';
      b.decidedBy = undefined;
      b.decidedAt = undefined;
      b.decisionNotes = `Auto-reset to Pending: "${event.title}" moved out after its event date changed.`;
      b.centreHeadVerified = false;
      b.centreHeadVerifiedBy = undefined;
      b.centreHeadVerifiedAt = undefined;
    }
    pulled.push(...matching);
    touchedIds.add(b.id);
  }

  if (!pulled.length) return; // nothing was planned against this event yet

  let target = budgets.find(b => b.type === 'monthly' && b.month === targetMonth);
  if (!target) {
    target = {
      id: 'bud_' + Date.now() + '_auto',
      type: 'monthly',
      financialYear: targetFY,
      month: targetMonth,
      amount: 0,
      proposedAmount: 0,
      lineItems: [],
      status: 'Pending',
      submittedBy: 'System (Auto-Recalculated)',
      submittedAt: new Date().toISOString().split('T')[0],
    };
    budgets.unshift(target);
  } else if (target.status === 'Approved') {
    target.status = 'Pending';
    target.decidedBy = undefined;
    target.decidedAt = undefined;
    target.decisionNotes = `Auto-reset to Pending: "${event.title}" moved in after its event date changed.`;
    target.centreHeadVerified = false;
    target.centreHeadVerifiedBy = undefined;
    target.centreHeadVerifiedAt = undefined;
  }
  target.lineItems = [...(target.lineItems || []), ...pulled];
  target.amount = target.lineItems.reduce((s, li) => s + (li.amount || li.proposedAmount || 0), 0);
  target.proposedAmount = target.amount;
  touchedIds.add(target.id);

  saveBudgets(budgets);
  touchedIds.forEach(id => {
    const b = budgets.find(x => x.id === id);
    if (b) serverPost('/api/budgets', b); // POST upserts by id server-side
  });
  logAuditEvent(
    'BUDGET_LINE_ITEM_RECALCULATED',
    'System',
    `Recalculated budget for "${event.title}": moved to ${targetMonth} (FY ${targetFY}) following its event date update.`
  );
}

// -------------------------------------------------------------
// Income Sources & Sponsorships
// -------------------------------------------------------------

export function getIncomeSources(): IncomeSourceItem[] {
  if (typeof window === 'undefined') return initialIncomeSources;
  const saved = localStorage.getItem('rtbi_income_sources');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      console.error(e);
    }
  }
  return initialIncomeSources;
}

export function saveIncomeSources(items: IncomeSourceItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_income_sources', JSON.stringify(items));
  markLocalWrite('rtbi_income_sources');
}

export function addIncomeSource(item: Omit<IncomeSourceItem, 'id' | 'createdAt'>): IncomeSourceItem {
  const current = getIncomeSources();
  const newIncome: IncomeSourceItem = {
    ...item,
    id: 'inc_' + Date.now(),
    createdAt: new Date().toISOString().split('T')[0],
  };
  current.unshift(newIncome);
  saveIncomeSources(current);
  serverPost('/api/income-sources', newIncome);
  logAuditEvent('INCOME_SOURCE_ADDED', item.submittedBy || 'Admin', `Added ${item.type || 'income source'} "${item.name}" of ₹${item.amount.toLocaleString()} for FY ${item.financialYear}${item.eventName ? ` (Linked to event "${item.eventName}")` : ' (General Centre Income)'}`);
  return newIncome;
}

export function updateIncomeSource(id: string, updates: Partial<IncomeSourceItem>, actorName: string): IncomeSourceItem | null {
  const current = getIncomeSources();
  const idx = current.findIndex(i => i.id === id);
  if (idx === -1) return null;

  current[idx] = { ...current[idx], ...updates };
  saveIncomeSources(current);
  serverPatch('/api/income-sources', id, current[idx]);
  logAuditEvent('INCOME_SOURCE_UPDATED', actorName, `Updated income source "${current[idx].name}"`);
  return current[idx];
}

export function deleteIncomeSource(id: string, actorName: string): boolean {
  const current = getIncomeSources();
  const target = current.find(i => i.id === id);
  if (!target) return false;

  const updated = current.filter(i => i.id !== id);
  saveIncomeSources(updated);
  serverDelete('/api/income-sources', id);
  logAuditEvent('INCOME_SOURCE_DELETED', actorName, `Deleted income source "${target.name}" (₹${target.amount.toLocaleString()})`);
  return true;
}


export function verifyReimbursementByCentreHead(id: string, reviewerName: string): ReimbursementItem | null {
  const current = getReimbursements();
  const idx = current.findIndex(r => r.id === id);
  if (idx === -1) return null;

  const claim = current[idx];
  const now = new Date().toISOString().split('T')[0];
  claim.status = 'Verified by Centre Head';
  claim.centreHeadVerified = true;
  claim.centreHeadVerifiedBy = reviewerName;
  claim.centreHeadVerifiedAt = now;
  claim.firstPassReviewer = reviewerName;

  saveReimbursements(current);
  serverPatch('/api/reimbursements', id, claim);
  logAuditEvent('REIMBURSEMENT_VERIFIED', reviewerName, `Centre Head verified reimbursement claim of ₹${claim.amount} for ${claim.memberName}`);
  return claim;
}


// -------------------------------------------------------------
// Announcements
// -------------------------------------------------------------

export function getAnnouncements(): AnnouncementItem[] {
  if (typeof window === 'undefined') return initialAnnouncements;
  const saved = localStorage.getItem('rtbi_announcements');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  // Do NOT seed localStorage here — return sample data without writing
  return initialAnnouncements;
}

export function saveAnnouncements(announcements: AnnouncementItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_announcements', JSON.stringify(announcements));
  markLocalWrite('rtbi_announcements');
}

export function addAnnouncement(item: Omit<AnnouncementItem, 'id' | 'publishedAt'>): AnnouncementItem {
  const current = getAnnouncements();
  const now = new Date();
  const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const newAnn: AnnouncementItem = {
    ...item,
    id: 'a_' + Date.now(),
    publishedAt: formattedDate
  };
  current.unshift(newAnn);
  saveAnnouncements(current);
  serverPost('/api/announcements', newAnn);
  logAuditEvent('ANNOUNCEMENT_PUBLISHED', item.authorName, `Published announcement: "${item.title}" [Scope: ${item.scope}]`);
  return newAnn;
}

export function approveAnnouncement(id: string, approverName: string, note?: string): AnnouncementItem | null {
  const current = getAnnouncements();
  const idx = current.findIndex(a => a.id === id);
  if (idx === -1) return null;

  const now = new Date();
  const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  current[idx] = {
    ...current[idx],
    status: 'Approved',
    approvedBy: approverName,
    approvedAt: formattedDate,
  };
  saveAnnouncements(current);
  serverPatch('/api/announcements', id, current[idx]);
  markApprovalRequestsDecided('announcement', id, 'approved', approverName, note);
  logAuditEvent('ANNOUNCEMENT_APPROVED', approverName, `Approved and published announcement: "${current[idx].title}"`);
  return current[idx];
}

export function rejectAnnouncement(id: string, actorName: string): AnnouncementItem | null {
  const current = getAnnouncements();
  const idx = current.findIndex(a => a.id === id);
  if (idx === -1) return null;

  const now = new Date();
  const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  current[idx] = {
    ...current[idx],
    status: 'Rejected',
    rejectedBy: actorName,
    rejectedAt: formattedDate,
  };
  saveAnnouncements(current);
  serverPatch('/api/announcements', id, current[idx]);
  markApprovalRequestsDecided('announcement', id, 'rejected', actorName);
  logAuditEvent('ANNOUNCEMENT_REJECTED', actorName, `Rejected announcement submission: "${current[idx].title}"`);
  return current[idx];
}

export function updateAnnouncement(id: string, updates: Partial<AnnouncementItem>, actorName: string): AnnouncementItem | null {
  const current = getAnnouncements();
  const idx = current.findIndex(a => a.id === id);
  if (idx === -1) return null;

  const now = new Date();
  current[idx] = {
    ...current[idx],
    ...updates,
    editedAt: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  };
  saveAnnouncements(current);
  serverPatch('/api/announcements', id, current[idx]);
  logAuditEvent('ANNOUNCEMENT_UPDATED', actorName, `Updated announcement: "${current[idx].title}"`);
  return current[idx];
}

export function deleteAnnouncement(id: string, actorName: string): boolean {
  const current = getAnnouncements();
  const target = current.find(a => a.id === id);
  if (!target) return false;

  const updated = current.filter(a => a.id !== id);
  saveAnnouncements(updated);
  removeApprovalRequestsForEntity('announcement', id);
  serverDelete('/api/announcements', id);
  logAuditEvent('ANNOUNCEMENT_DELETED', actorName, `Retracted announcement: "${target.title}"`);
  return true;
}

// -------------------------------------------------------------
// Forms & Submissions
// -------------------------------------------------------------

export function getForms(): PublicFormItem[] {
  if (typeof window === 'undefined') return initialForms;
  const saved = localStorage.getItem('rtbi_custom_forms');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  // Do NOT seed localStorage here — return sample data without writing
  return initialForms;
}

export function saveForms(forms: PublicFormItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_custom_forms', JSON.stringify(forms));
  markLocalWrite('rtbi_custom_forms');
}

export function addForm(form: Omit<PublicFormItem, 'id' | 'createdAt'>): PublicFormItem {
  const current = getForms();
  const newForm: PublicFormItem = {
    ...form,
    id: 'form_' + Date.now(),
    createdAt: new Date().toISOString().split('T')[0]
  };
  current.unshift(newForm);
  saveForms(current);
  serverPost('/api/forms', newForm);
  logAuditEvent('FORM_CREATED', form.createdBy, `Created public form "${form.title}" at /forms/${form.slug}`);
  return newForm;
}

export function updateForm(id: string, updates: Partial<PublicFormItem>, actorName: string): PublicFormItem | null {
  const current = getForms();
  const idx = current.findIndex(f => f.id === id);
  if (idx === -1) return null;

  current[idx] = { ...current[idx], ...updates };
  saveForms(current);
  // Send the full merged form, not just the diff, so a server-side upsert (a
  // client-only sample form that was never POSTed) creates a complete record.
  serverPatch('/api/forms', id, current[idx]);
  logAuditEvent('FORM_UPDATED', actorName, `Updated public form "${current[idx].title}"`);
  return current[idx];
}

export function deleteForm(id: string, actorName: string): boolean {
  const current = getForms();
  const target = current.find(f => f.id === id);
  if (!target) return false;

  const updated = current.filter(f => f.id !== id);
  saveForms(updated);
  serverDelete('/api/forms', id);

  // A deleted form used to leave its submissions behind forever — orphaned
  // "ghost" responses that would even resurface under a brand-new form
  // later created on the same slug (submissions are matched by slug as a
  // fallback for records predating a reliable formId). Purge them from
  // this client's cache immediately; the server-side DELETE above cascades
  // the same cleanup so every other client picks it up on its next sync.
  const remainingSubmissions = getSubmissions().filter(
    s => s.formId !== id && s.slug !== target.slug
  );
  saveSubmissions(remainingSubmissions);

  removeApprovalRequestsForEntity('form', id);

  logAuditEvent('FORM_DELETED', actorName, `Deleted public form "${target.title}"`);
  return true;
}

/** Submit an edit to an already-approved form for sign-off — the public link keeps
 *  serving the last-approved version until the change is approved or rejected. */
export function submitFormEdit(
  id: string,
  changes: Partial<PublicFormItem>,
  submittedBy: string,
  submittedByEmail: string,
  approval: { approverType?: GroupPolicy['approverType']; approverMemberId?: string; approverPolicyTagId?: string; policyName?: string }
): PublicFormItem | null {
  const current = getForms();
  const target = current.find(f => f.id === id);
  if (!target) return null;

  const result = updateForm(id, {
    pendingChange: changes,
    approvalStatus: 'pending_edit',
    approverType: approval.approverType,
    approverMemberId: approval.approverMemberId,
    approverPolicyTagId: approval.approverPolicyTagId,
    approvalPolicyName: approval.policyName,
    submittedBy,
    submittedByEmail,
  }, submittedBy);
  logAuditEvent('FORM_EDIT_SUBMITTED', submittedBy, `Submitted an edit to form "${target.title}" for approval`, submittedByEmail);
  return result;
}

/** Submit a deletion request for sign-off instead of deleting immediately. */
export function submitFormDelete(
  id: string,
  submittedBy: string,
  submittedByEmail: string,
  approval: { approverType?: GroupPolicy['approverType']; approverMemberId?: string; approverPolicyTagId?: string; policyName?: string }
): PublicFormItem | null {
  const current = getForms();
  const target = current.find(f => f.id === id);
  if (!target) return null;

  const result = updateForm(id, {
    approvalStatus: 'pending_delete',
    approverType: approval.approverType,
    approverMemberId: approval.approverMemberId,
    approverPolicyTagId: approval.approverPolicyTagId,
    approvalPolicyName: approval.policyName,
    submittedBy,
    submittedByEmail,
  }, submittedBy);
  logAuditEvent('FORM_DELETE_SUBMITTED', submittedBy, `Submitted deletion of form "${target.title}" for approval`, submittedByEmail);
  return result;
}

/** Approve a pending form creation, edit, or deletion. */
export function approveForm(id: string, actorName: string, note?: string): PublicFormItem | null {
  const current = getForms();
  const target = current.find(f => f.id === id);
  if (!target) return null;

  if (target.approvalStatus === 'pending_delete') {
    deleteForm(id, actorName);
    logAuditEvent('FORM_APPROVED', actorName, `Approved and completed the deletion of form "${target.title}"`);
    return null;
  }

  const isEdit = target.approvalStatus === 'pending_edit';
  const result = updateForm(id, {
    ...(isEdit ? target.pendingChange : {}),
    approvalStatus: 'approved',
    pendingChange: undefined,
    decidedBy: actorName,
    decidedAt: new Date().toISOString(),
  }, actorName);
  markApprovalRequestsDecided('form', id, 'approved', actorName, note);
  logAuditEvent('FORM_APPROVED', actorName, `Approved ${isEdit ? 'an edit to' : 'the creation of'} form "${target.title}" — its public link is now live`);
  return result;
}

/** Reject a pending form creation, edit, or deletion. A rejected creation is
 *  marked 'rejected' (its link never goes live). A rejected edit or deletion
 *  reverts to 'approved' — the original form stands. */
export function rejectForm(id: string, actorName: string, reason?: string): PublicFormItem | null {
  const current = getForms();
  const target = current.find(f => f.id === id);
  if (!target) return null;

  const isCreate = target.approvalStatus === 'pending_create';
  const result = updateForm(id, {
    approvalStatus: isCreate ? 'rejected' : 'approved',
    pendingChange: undefined,
    decidedBy: actorName,
    decidedAt: new Date().toISOString(),
    rejectionReason: reason,
  }, actorName);
  markApprovalRequestsDecided('form', id, 'rejected', actorName, reason);
  const kind = target.approvalStatus === 'pending_delete' ? 'the deletion of' : isCreate ? 'the creation of' : 'an edit to';
  logAuditEvent('FORM_REJECTED', actorName, `Rejected ${kind} form "${target.title}"${reason ? `: ${reason}` : ''}`);
  return result;
}

export function isSlugUnique(slug: string, excludeFormId?: string): boolean {
  const current = getForms();
  return !current.some(f => f.slug.toLowerCase() === slug.toLowerCase() && f.id !== excludeFormId);
}

// -------------------------------------------------------------
// Form Templates — reusable field schemas for the form builder
// -------------------------------------------------------------

export function getFormTemplates(): FormTemplateItem[] {
  let list: FormTemplateItem[] = [...initialFormTemplates];
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('rtbi_form_templates');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const custom = parsed.filter((p: any) => !initialFormTemplates.some(it => it.id === p.id));
          // Built-ins: an edited copy (customized) replaces the in-code one; a deleted marker hides it
          const builtIns = initialFormTemplates
            .map((b) => {
              const saved = parsed.find((p: any) => p?.id === b.id);
              if (saved?.deleted) return null;
              if (saved?.customized && Array.isArray(saved.fields)) return { ...b, ...saved };
              return b;
            })
            .filter(Boolean) as FormTemplateItem[];
          list = [...builtIns, ...custom];
        }
      } catch (e) {
        console.error(e);
      }
    }
  }
  return list;
}

export function saveFormTemplates(templates: FormTemplateItem[]): void {
  if (typeof window === 'undefined') return;
  // Keep built-in override rows (edited copies / deleted markers) that aren't part of the merged list passed in
  let keep: FormTemplateItem[] = [];
  try {
    const prev = JSON.parse(localStorage.getItem('rtbi_form_templates') || '[]');
    if (Array.isArray(prev)) {
      keep = prev.filter((r: any) => initialFormTemplates.some((b) => b.id === r?.id) && (r.deleted || r.customized) && !templates.some((t) => t.id === r.id));
    }
  } catch { /* ignore */ }
  localStorage.setItem('rtbi_form_templates', JSON.stringify([...templates, ...keep]));
  markLocalWrite('rtbi_form_templates');
}

export function addFormTemplate(template: Omit<FormTemplateItem, 'id' | 'createdAt'>): FormTemplateItem {
  const current = getFormTemplates();
  const newTemplate: FormTemplateItem = {
    ...template,
    id: 'tmpl_' + Date.now(),
    createdAt: new Date().toISOString().split('T')[0]
  };
  current.unshift(newTemplate);
  saveFormTemplates(current);
  serverPost('/api/form-templates', newTemplate);
  logAuditEvent('FORM_TEMPLATE_CREATED', template.createdBy, `Saved form template "${template.name}"`);
  return newTemplate;
}

/** Saved rows that override built-ins (customized copies and deleted markers) must survive getFormTemplates(). */
function readSavedTemplateRows(): FormTemplateItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem('rtbi_form_templates') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function upsertSavedTemplate(row: FormTemplateItem): void {
  const rows = readSavedTemplateRows();
  const idx = rows.findIndex((r) => r.id === row.id);
  if (idx >= 0) rows[idx] = row;
  else rows.unshift(row);
  saveFormTemplates(rows);
}

export function isBuiltInTemplate(id: string): boolean {
  return initialFormTemplates.some((t) => t.id === id);
}

/** Built-ins the admin deleted (hidden), so they can be restored from Manage Templates. */
export function getDeletedBuiltInTemplates(): FormTemplateItem[] {
  const rows = readSavedTemplateRows();
  return initialFormTemplates.filter((b) => rows.some((r) => r.id === b.id && r.deleted));
}

export function deleteFormTemplate(id: string, actorName: string): boolean {
  const current = getFormTemplates();
  const target = current.find(t => t.id === id);
  if (!target) return false;

  if (isBuiltInTemplate(id)) {
    // Hide instead of removing: the server re-seeds a missing built-in, a marker row survives that
    const marker: FormTemplateItem = { ...(initialFormTemplates.find((t) => t.id === id) as FormTemplateItem), deleted: true, customized: false };
    upsertSavedTemplate(marker);
    serverPatch('/api/form-templates', id, { deleted: true, customized: false });
  } else {
    saveFormTemplates(current.filter(t => t.id !== id));
    serverDelete('/api/form-templates', id);
  }
  logAuditEvent('FORM_TEMPLATE_DELETED', actorName, `Deleted form template "${target.name}"`);
  return true;
}

/** Bring back a deleted built-in or discard edits to one (restores the original in-code version). */
export function restoreBuiltInTemplate(id: string, actorName: string): boolean {
  const original = initialFormTemplates.find((t) => t.id === id);
  if (!original) return false;
  upsertSavedTemplate({ ...original, customized: false, deleted: false });
  serverPatch('/api/form-templates', id, { ...original, customized: false, deleted: false });
  logAuditEvent('FORM_TEMPLATE_UPDATED', actorName, `Restored built-in form template "${original.name}"`);
  return true;
}

/**
 * Edit a template's name, description or fields. Custom templates are updated in place. Built-in templates are
 * saved as an edited copy (`customized`) that replaces the in-code version until "Reset to original".
 */
export function updateFormTemplate(
  id: string,
  changes: Partial<Pick<FormTemplateItem, 'name' | 'description' | 'fields'>>,
  actorName: string
): FormTemplateItem | null {
  const current = getFormTemplates();
  const idx = current.findIndex(t => t.id === id);
  if (idx === -1) return null;

  if (isBuiltInTemplate(id)) {
    const updated: FormTemplateItem = { ...current[idx], ...changes, customized: true, deleted: false };
    upsertSavedTemplate(updated);
    serverPatch('/api/form-templates', id, updated);
    logAuditEvent('FORM_TEMPLATE_UPDATED', actorName, `Edited built-in form template "${updated.name}"`);
    return updated;
  }

  const updated: FormTemplateItem = { ...current[idx], ...changes };
  const next = [...current];
  next[idx] = updated;
  saveFormTemplates(next);
  serverPatch('/api/form-templates', id, updated);
  logAuditEvent('FORM_TEMPLATE_UPDATED', actorName, `Updated form template "${updated.name}"`);
  return updated;
}

export function getSubmissions(): FormSubmissionItem[] {
  if (typeof window === 'undefined') return initialSubmissions;
  const saved = localStorage.getItem('rtbi_form_submissions');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  // Do NOT seed localStorage here — return sample data without writing
  return initialSubmissions;
}

export function saveSubmissions(submissions: FormSubmissionItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_form_submissions', JSON.stringify(submissions));
  markLocalWrite('rtbi_form_submissions');
}

/** Deletes one collected response from this client's cache and the server. */
export function deleteSubmission(id: string, actorName: string): boolean {
  const current = getSubmissions();
  const target = current.find(s => s.id === id);
  if (!target) return false;
  saveSubmissions(current.filter(s => s.id !== id));
  serverDelete('/api/submissions', id);
  logAuditEvent('FORM_RESPONSE_DELETED', actorName, `Deleted a response to form slug "${target.slug}"`);
  return true;
}

/** True once a public form's optional `closeAt` (ISO UTC) has passed. Pure, so it runs on both server and client. */
export function isFormClosed(form: { closeAt?: string } | null | undefined, now: number = Date.now()): boolean {
  if (!form?.closeAt) return false;
  const t = Date.parse(form.closeAt);
  return !isNaN(t) && now > t;
}

export function addSubmission(sub: Omit<FormSubmissionItem, 'id' | 'submittedAt'>): { submission: FormSubmissionItem; synced: Promise<boolean> } {
  const current = getSubmissions();
  const now = new Date();
  const formatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const newSub: FormSubmissionItem = {
    ...sub,
    id: 'sub_' + Date.now(),
    submittedAt: formatted
  };
  current.unshift(newSub);
  // The server write is the source of truth admins actually see (this is the
  // only side of this flow anonymous respondents can reach), so callers that
  // need to know the submission actually landed should await `synced`
  // instead of treating the localStorage write as success on its own.
  let synced: Promise<boolean> = Promise.resolve(false);
  if (typeof window !== 'undefined') {
    localStorage.setItem('rtbi_form_submissions', JSON.stringify(current));
    markLocalWrite('rtbi_form_submissions');
    synced = serverPost('/api/submissions', newSub).then(() => true).catch(() => false);
  }
  logAuditEvent('FORM_SUBMITTED', 'Public Respondent', `New response submitted for form slug "${sub.slug}"`);
  return { submission: newSub, synced };
}

// -------------------------------------------------------------
// Audit Logs
// -------------------------------------------------------------

/**
 * Some server routes (password reset, account activation, email change, setup...) wrote audit entries as
 * `{ user: name }` / `{ actor: name }` with no actorName/actorEmail. Every consumer assumes the AuditLogItem shape, so
 * a missing string field made searching the Audit Trail throw and blank the whole Settings page. Fill the gaps here.
 */
function normalizeAuditLog(raw: any): AuditLogItem {
  return {
    ...raw,
    id: String(raw?.id ?? ''),
    action: String(raw?.action ?? ''),
    actorName: String(raw?.actorName ?? raw?.user ?? raw?.actor ?? ''),
    actorEmail: String(raw?.actorEmail ?? raw?.targetEmail ?? ''),
    details: String(raw?.details ?? ''),
    timestamp: String(raw?.timestamp ?? ''),
  };
}

export function getAuditLogs(): AuditLogItem[] {
  if (typeof window === 'undefined') return [];
  const saved = localStorage.getItem('rtbi_audit_logs');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed.map(normalizeAuditLog) : [];
    } catch (e) {
      console.error(e);
    }
  }
  return [];
}

export function logAuditEvent(action: string, actorName: string, details: string, actorEmail?: string): void {
  if (typeof window === 'undefined') return;
  const current = getAuditLogs();
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const newLog: AuditLogItem = {
    id: 'log_' + Date.now(),
    action,
    actorName,
    actorEmail: actorEmail || 'system@example.com',
    details,
    timestamp
  };
  current.unshift(newLog);
  // Keep last 1000 logs in localStorage (aligns with server)
  localStorage.setItem('rtbi_audit_logs', JSON.stringify(current.slice(0, 1000)));
  markLocalWrite('rtbi_audit_logs');
  // Push to server asynchronously (fire-and-forget)
  serverPost('/api/auditlogs', newLog);
}

// -------------------------------------------------------------
// Design Portal & Proofreading Workflow
// -------------------------------------------------------------

export function getDesigns(): DesignSubmissionItem[] {
  if (typeof window === 'undefined') return initialDesigns;
  const saved = localStorage.getItem('rtbi_designs');
  if (saved) {
    try {
      const items: DesignSubmissionItem[] = JSON.parse(saved);
      const now = new Date().getTime();
      return items.map(item => {
        const expiresAtMs = new Date(item.expiresAt).getTime();
        if (now > expiresAtMs && !item.isExpired) {
          return { ...item, isExpired: true };
        }
        return item;
      });
    } catch (e) {
      console.error(e);
    }
  }
  return initialDesigns;
}

export function saveDesigns(designs: DesignSubmissionItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Strip heavy inline base64 fileData when persisting to localStorage.
    // Real file assets are stored on disk and served via fileUrl (/api/files).
    const cleaned = designs.map(d => {
      const { fileData, ...rest } = d;
      return rest;
    });
    localStorage.setItem('rtbi_designs', JSON.stringify(cleaned));
    markLocalWrite('rtbi_designs');
    window.dispatchEvent(new CustomEvent('rtbi-data-sync'));
  } catch (e) {
    console.warn('[saveDesigns] Local storage quota exceeded or unavailable:', e);
  }
}

/**
 * Unlike most mutations in this file, a design submission's server round-trip
 * is awaited rather than fired-and-forgotten: the uploaded file only actually
 * exists once the server has converted and saved it, so a silent server-side
 * failure here (a bad request, the file never arriving, a transient network
 * blip) previously left the designer looking at what appeared to be a
 * successful upload in their own browser — the local write always
 * succeeded — while no file (and no record at all) ever reached the server
 * or any other user's view. On failure, the optimistic local write is rolled
 * back and an error is thrown so the caller can show it and let the designer
 * retry, instead of a submission that silently goes nowhere.
 */
/**
 * Every design submission — regardless of category — must go to the Centre
 * Head or the GG Campus Events Head for mandatory proofreading; there is no
 * opt-out and no manual reviewer picker. Prefers a real Centre Head, falls
/**
 * Returns all active members eligible for selection as design proofreaders:
 * Super Users, CEOs and Employees (Startups can submit designs but not review them).
 * Tighten here once the proofreading scope is defined for the RTBI portal.
 */
export function getEligibleFacultyProofreaders(members?: Member[]): Member[] {
  return (members || getMembers()).filter(m => m.status !== 'Terminated' && m.tier <= 3);
}

/**
 * Fallback resolver when no specific proofreader is selected.
 */
export function resolveDesignReviewer(): { id: string; name: string; email: string } | undefined {
  const faculty = getEligibleFacultyProofreaders();
  if (faculty.length > 0) {
    const first = faculty[0];
    return { id: first.id, name: first.name, email: first.email };
  }
  return undefined;
}

/**
 * The fixed leadership group that Instagram/LinkedIn posting tasks are
 * always assigned to once captions are approved (see reviewDesignCaptions
 * below) — Design Head, Social Media Head, and Senior Head roles, same
 * "role string contains X" matching respondToHolidayApproval already uses
 * for its own design/social-media fan-out. This is a fixed routing rule,
 * not tied to who submitted or designed the asset — posting is always the
 * group's job, never the designer's. Falls back to tier <= 2 leadership if
 * the roster currently holds none of those titles, so the task is never
 * left orphaned with no one able to see it.
 */
/**
 * Resolves the member pool assigned to social-media posting tasks.
 * Strictly limited to the Head and Senior Head of Social Media.
 * Committee or general student groups and Professors/Faculty are strictly excluded.
 */
export function resolveSocialPostingAssignees(members?: Member[]): Member[] {
  const all = (members || getMembers()).filter(m => m.status !== 'Terminated' && !isFacultyMember(m));
  const heads = all.filter(m => isSocialMediaHeadOrSrHead(m));
  if (heads.length > 0) return heads;
  const team = all.filter(m => isSocialMediaTeamMember(m));
  return team.length > 0 ? team : all.slice(0, 1);
}

export function resolveSocialMediaHeads(members?: Member[]): Member[] {
  return resolveSocialPostingAssignees(members);
}

export async function addDesign(design: Omit<DesignSubmissionItem, 'id' | 'submittedAt' | 'expiresAt' | 'isExpired'>, onProgress?: UploadProgressCallback): Promise<DesignSubmissionItem> {
  if (design.fileSize > 25 * 1024 * 1024) {
    throw new Error('File size exceeds the 25 MB limit.');
  }

  const current = getDesigns();
  const now = new Date();
  const submittedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Resolve assigned faculty proofreaders from the submitter's explicit selection
  const allMembers = getMembers();
  let assignedProofreaderIds = design.assignedProofreaderIds || [];
  let assignedProofreaders = design.assignedProofreaders || [];

  if (assignedProofreaderIds.length > 0 && assignedProofreaders.length === 0) {
    assignedProofreaders = assignedProofreaderIds
      .map(id => allMembers.find(m => m.id === id))
      .filter((m): m is Member => Boolean(m))
      .map(m => ({ id: m.id, name: m.name, email: m.email, role: m.role }));
  }

  // Fallback if none provided
  if (assignedProofreaders.length === 0) {
    const fallback = resolveDesignReviewer();
    if (fallback) {
      assignedProofreaders = [{ id: fallback.id, name: fallback.name, email: fallback.email }];
      assignedProofreaderIds = [fallback.id];
    }
  }

  const primaryReviewer = assignedProofreaders[0];
  const proofreaderNames = assignedProofreaders.map(p => p.name).join(', ');

  const newDesign: DesignSubmissionItem = {
    ...design,
    id: 'des_' + Date.now(),
    submittedAt,
    expiresAt,
    isExpired: false,
    proofreadRequested: true,
    assignedProofreaderId: primaryReviewer?.id,
    assignedProofreaderName: proofreaderNames || primaryReviewer?.name,
    assignedProofreaderEmail: primaryReviewer?.email,
    assignedProofreaderIds: assignedProofreaders.map(p => p.id),
    assignedProofreaders,
    review: primaryReviewer ? {
      proofreaderId: primaryReviewer.id,
      proofreaderName: primaryReviewer.name,
      status: 'Pending Proofread',
    } : undefined,
    // Reuse the design-brief or auto-generated task (if this submission fulfills one or is for the same event) as the
    // task syncDesignTask() completes on approval, instead of spawning a new standalone duplicate.
    linkedTaskId: design.sourceTaskId || design.linkedTaskId || (() => {
      if (!design.eventId) return undefined;
      const match = getTasks().find(t =>
        t.eventId === design.eventId &&
        (t.workflowType === 'event_social_post' || t.workflowType === 'holiday_design_social' || t.taskCategory === 'design' || t.isDesignDeliverable)
      );
      return match?.id;
    })(),
  };

  // POST to server first so the file is written to disk and fileUrl/storageKey is generated without polluting localStorage with base64 data
  const serverResult = await serverPost('/api/designs', newDesign, onProgress);
  if (!serverResult) {
    throw new Error('The design failed to upload to the server. Please check your connection and try again.');
  }

  const createdDesign: DesignSubmissionItem = {
    ...newDesign,
    ...serverResult,
  };
  delete createdDesign.fileData;

  current.unshift(createdDesign);
  saveDesigns(current);

  // A submission against a design-brief task means work on it has started —
  // move it out of 'Assigned' so it reads correctly on the Tasks page too.
  // syncDesignTask() (triggered on approval) takes it to 'Completed'.
  if (design.sourceTaskId) {
    const sourceTask = getTasks().find(t => t.id === design.sourceTaskId);
    if (sourceTask && sourceTask.status === 'Assigned') {
      updateTask(design.sourceTaskId, { status: 'In Progress' }, design.designerName);
    }
  }

  const proofreadMsg = proofreaderNames
    ? ` (routed to ${proofreaderNames} for faculty proofreading)`
    : ' (no faculty proofreader assigned)';
  logAuditEvent('DESIGN_SUBMITTED', design.designerName, `Submitted design "${design.title}" (${(design.fileSize / (1024 * 1024)).toFixed(2)} MB)${proofreadMsg}`, design.designerEmail);

  return createdDesign;
}

/**
 * Synchronize design finalization state with the Task & Rating system.
 * A design is considered finalized once its mandatory proofread has been
 * approved by the Centre Head or GG Campus Events Head — that single action
 * is the only gate; there is no separate style-review requirement blocking
 * it. (The Style Review form elsewhere in the Design Portal still exists as
 * an optional, independent annotation a Design Head can use, but it is no
 * longer required for the design to finalize.)
 *
 * Once finalized, it automatically creates or completes a Task (linked to an Event
 * if present, or as a standalone deliverable if not), entering the Task Evaluation Queue
 * on the Ratings page, and kicks off Stage 1 of the caption/social-posting workflow
 * (see submitDesignCaptions / reviewDesignCaptions / completeDesignPosting below).
 */
function syncDesignTask(item: DesignSubmissionItem, reviewerName: string): DesignSubmissionItem {
  const isFullyFinalized = !item.proofreadRequested || item.review?.status === 'Proofread Approved';

  let updatedItem = { ...item };

  if (isFullyFinalized) {
    const allTasks = getTasks();
    const existingTask = updatedItem.linkedTaskId
      ? allTasks.find(t => t.id === updatedItem.linkedTaskId)
      : (updatedItem.eventId
          ? allTasks.find(t =>
              t.eventId === updatedItem.eventId &&
              (t.workflowType === 'event_social_post' || t.workflowType === 'holiday_design_social' || t.taskCategory === 'design' || t.isDesignDeliverable)
            )
          : null);

    if (existingTask) {
      updatedItem.linkedTaskId = existingTask.id;
      if (existingTask.status !== 'Completed') {
        updateTask(existingTask.id, { status: 'Completed' }, reviewerName);
      }
    } else {
      const task = addTask({
        title: `Design Approved: ${updatedItem.title}`,
        event: updatedItem.eventName || undefined,
        eventId: updatedItem.eventId || undefined,
        assignee: updatedItem.designerName,
        assigneeId: updatedItem.designerId,
        assigneeEmail: updatedItem.designerEmail,
        assigneeType: 'individual',
        dueDate: new Date().toISOString().split('T')[0],
        status: 'Completed',
        creatorName: reviewerName,
        isDesignDeliverable: true,
      });
      updatedItem.linkedTaskId = task.id;
    }

    // Check if the auto-generated task for this event was ALREADY completed or was the linked task.
    // If so, do NOT generate duplicate caption or posting tasks.
    const autoTask = updatedItem.eventId
      ? allTasks.find(t =>
          t.eventId === updatedItem.eventId &&
          (t.workflowType === 'event_social_post' || t.workflowType === 'holiday_design_social')
        )
      : null;

    const isAutoTaskAlreadyDone = autoTask && (autoTask.status === 'Completed' || autoTask.id === updatedItem.linkedTaskId);

    if (isAutoTaskAlreadyDone) {
      updatedItem.workflowStage = 'completed';
      updatedItem.postingInstagramDone = true;
      updatedItem.postingLinkedinDone = true;
      updatedItem.captionStatus = 'approved';
      return updatedItem;
    }

    // Only auto-generate caption & posting task if category is 'Social Media'
    const isSocialMedia = updatedItem.category === 'Social Media';
    if (!isSocialMedia) {
      // Non-social media designs (Poster, Postage, Banner, Brochure, Certificates, Other)
      // complete their design task and stop here. No captions or posting tasks are generated.
      updatedItem.workflowStage = 'completed';
      return updatedItem;
    }

    // Unified Caption Writing & Posting Task for Social Media Head / Sr Head
    if (!updatedItem.workflowStage || updatedItem.workflowStage === 'caption_required' || updatedItem.workflowStage === 'posting_required') {
      const existingPostingTask = allTasks.find(t =>
        t.designId === updatedItem.id && t.workflowType === 'design_social_posting'
      );
      if (!existingPostingTask) {
        const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const postingPool = resolveSocialPostingAssignees();
        const isSingle = postingPool.length === 1;
        const postingAssignee = {
          assignee: postingPool.map(m => m.name).join(', ') || 'Social Media Head',
          assigneeType: (isSingle ? 'individual' : 'group') as 'individual' | 'group',
          assigneeId: isSingle ? postingPool[0].id : undefined,
          assigneeEmail: isSingle ? postingPool[0].email : undefined,
          assigneeIds: postingPool.map(m => m.id),
        };

        const postTask = addTask({
          title: `[Social Media Post] Caption & Post: ${updatedItem.title}`,
          event: updatedItem.eventName || undefined,
          eventId: updatedItem.eventId || undefined,
          ...postingAssignee,
          dueDate,
          status: 'In Progress',
          creatorName: reviewerName,
          isSocialMediaPost: true,
          workflowType: 'design_social_posting',
          designId: updatedItem.id,
          draftInstagramCaption: updatedItem.draftInstagramCaption || '',
          draftLinkedinCaption: updatedItem.draftLinkedinCaption || '',
          approvedInstagramCaption: updatedItem.approvedInstagramCaption || '',
          approvedLinkedinCaption: updatedItem.approvedLinkedinCaption || '',
        });

        updatedItem.workflowStage = 'posting_required';
        updatedItem.postingInstagramTaskId = postTask.id;
        updatedItem.postingLinkedinTaskId = postTask.id;
        updatedItem.captionTaskId = postTask.id;
      }
    }

    return updatedItem;
  } else if (updatedItem.linkedTaskId) {
    // If a previously approved design is no longer finalized (e.g. the proofreader
    // requested changes after approving), revert its task to 'In Progress' if not
    // already rated.
    const linkedTask = getTasks().find(t => t.id === updatedItem.linkedTaskId);
    if (linkedTask && !linkedTask.ratingScore) {
      updateTask(updatedItem.linkedTaskId, { status: 'In Progress' }, reviewerName);
    }
  }

  return updatedItem;
}

export function submitDesignCaptions(designId: string, instaCaption: string, linkedinCaption: string, actorName: string): DesignSubmissionItem | null {
  const designs = getDesigns();
  const idx = designs.findIndex(d => d.id === designId);
  if (idx === -1) return null;

  const design = designs[idx];

  // Complete Stage 1 task
  if (design.captionTaskId) {
    updateTaskStatus(design.captionTaskId, 'Completed', actorName);
  }

  const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const isSocialPost = design.category === 'Social Media' || (design.eventId && getTasks().some(t => t.eventId === design.eventId && isSocialMediaPostTask(t)));
  const socialHeads = resolveSocialPostingAssignees();
  const defaultSocialReviewer = socialHeads.length > 0 ? socialHeads[0] : null;

  // By default, social media captions go to the Head / Sr Head of Social Media,
  // never to a committee or group of students.
  const captionReviewer = (isSocialPost && defaultSocialReviewer)
    ? { id: defaultSocialReviewer.id, name: defaultSocialReviewer.name, email: defaultSocialReviewer.email }
    : (design.assignedProofreaderId && design.assignedProofreaderName && design.assignedProofreaderEmail)
      ? { id: design.assignedProofreaderId, name: design.assignedProofreaderName, email: design.assignedProofreaderEmail }
      : resolveDesignReviewer();

  // If an auto-generated task for this event is already completed, do not spawn a duplicate review task
  if (design.eventId) {
    const autoTask = getTasks().find(t =>
      t.eventId === design.eventId &&
      (t.workflowType === 'event_social_post' || t.workflowType === 'holiday_design_social') &&
      t.status === 'Completed'
    );
    if (autoTask) {
      design.draftInstagramCaption = instaCaption;
      design.draftLinkedinCaption = linkedinCaption;
      design.workflowStage = 'completed';
      design.captionStatus = 'approved';
      designs[idx] = design;
      saveDesigns(designs);
      serverPatch('/api/designs', design.id, design);
      return design;
    }
  }

  const task2 = addTask({
    title: `[Caption Approval] Review Captions: ${design.title}`,
    event: design.eventName || undefined,
    eventId: design.eventId || undefined,
    assignee: captionReviewer ? captionReviewer.name : 'Centre Head',
    assigneeId: captionReviewer?.id,
    assigneeEmail: captionReviewer?.email,
    assigneeType: 'individual',
    dueDate,
    status: 'In Progress',
    creatorName: actorName,
    isDesignDeliverable: true,
    workflowType: 'design_caption_review',
    designId: design.id,
    draftInstagramCaption: instaCaption,
    draftLinkedinCaption: linkedinCaption,
  });

  design.draftInstagramCaption = instaCaption;
  design.draftLinkedinCaption = linkedinCaption;
  design.workflowStage = 'caption_approval';
  design.captionApprovalTaskId = task2.id;
  design.captionStatus = 'pending_approval';

  designs[idx] = design;
  saveDesigns(designs);
  serverPatch('/api/designs', design.id, design);
  logAuditEvent('DESIGN_CAPTIONS_SUBMITTED', actorName, `Submitted draft captions for design "${design.title}"`);
  return design;
}

export function reviewDesignCaptions(designId: string, approved: boolean, comments: string, actorName: string): DesignSubmissionItem | null {
  const designs = getDesigns();
  const idx = designs.findIndex(d => d.id === designId);
  if (idx === -1) return null;

  const design = designs[idx];

  // Complete Stage 2 task
  if (design.captionApprovalTaskId) {
    updateTaskStatus(design.captionApprovalTaskId, 'Completed', actorName);
  }

  if (approved) {
    // If an auto-generated task for this event is already completed, do not spawn duplicate posting tasks
    if (design.eventId) {
      const autoTask = getTasks().find(t =>
        t.eventId === design.eventId &&
        (t.workflowType === 'event_social_post' || t.workflowType === 'holiday_design_social') &&
        t.status === 'Completed'
      );
      if (autoTask) {
        design.approvedInstagramCaption = design.draftInstagramCaption;
        design.approvedLinkedinCaption = design.draftLinkedinCaption;
        design.workflowStage = 'completed';
        design.postingInstagramDone = true;
        design.postingLinkedinDone = true;
        design.captionStatus = 'approved';
        design.captionReviewComments = comments;
        designs[idx] = design;
        saveDesigns(designs);
        serverPatch('/api/designs', design.id, design);
        return design;
      }
    }

    const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Posting is strictly routed to the Social Media Head and Senior Head.
    // Committee or general student groups and Faculty are strictly excluded.
    const postingPool = resolveSocialPostingAssignees();
    const isSingle = postingPool.length === 1;
    const postingAssignee = {
      assignee: postingPool.map(m => m.name).join(', ') || 'Social Media Head',
      assigneeType: (isSingle ? 'individual' : 'group') as 'individual' | 'group',
      assigneeId: isSingle ? postingPool[0].id : undefined,
      assigneeEmail: isSingle ? postingPool[0].email : undefined,
      assigneeIds: postingPool.map(m => m.id),
    };

    // Idempotent: check if platform posting tasks already exist for this design
    const existingTasks = getTasks();
    const existingInsta = existingTasks.find(t =>
      (design.postingInstagramTaskId && t.id === design.postingInstagramTaskId) ||
      (t.designId === design.id && t.workflowType === 'design_social_posting' && t.platform === 'instagram')
    );
    const existingLinkedin = existingTasks.find(t =>
      (design.postingLinkedinTaskId && t.id === design.postingLinkedinTaskId) ||
      (t.designId === design.id && t.workflowType === 'design_social_posting' && t.platform === 'linkedin')
    );

    const instaTask = existingInsta
      ? (updateTask(existingInsta.id, {
          status: 'In Progress',
          dueDate,
          ...postingAssignee,
          approvedInstagramCaption: design.draftInstagramCaption,
        }, actorName) || existingInsta)
      : addTask({
          title: `[Social Media Posting] Post on Instagram: ${design.title}`,
          event: design.eventName || undefined,
          eventId: design.eventId || undefined,
          ...postingAssignee,
          dueDate,
          status: 'In Progress',
          creatorName: actorName,
          isDesignDeliverable: true,
          isSocialMediaPost: true,
          workflowType: 'design_social_posting',
          platform: 'instagram',
          designId: design.id,
          approvedInstagramCaption: design.draftInstagramCaption,
        });

    const linkedinTask = existingLinkedin
      ? (updateTask(existingLinkedin.id, {
          status: 'In Progress',
          dueDate,
          ...postingAssignee,
          approvedLinkedinCaption: design.draftLinkedinCaption,
        }, actorName) || existingLinkedin)
      : addTask({
          title: `[Social Media Posting] Post on LinkedIn: ${design.title}`,
          event: design.eventName || undefined,
          eventId: design.eventId || undefined,
          ...postingAssignee,
          dueDate,
          status: 'In Progress',
          creatorName: actorName,
          isDesignDeliverable: true,
          isSocialMediaPost: true,
          workflowType: 'design_social_posting',
          platform: 'linkedin',
          designId: design.id,
          approvedLinkedinCaption: design.draftLinkedinCaption,
        });

    design.approvedInstagramCaption = design.draftInstagramCaption;
    design.approvedLinkedinCaption = design.draftLinkedinCaption;
    design.workflowStage = 'posting_required';
    design.postingInstagramTaskId = instaTask.id;
    design.postingLinkedinTaskId = linkedinTask.id;
    design.postingInstagramDone = false;
    design.postingLinkedinDone = false;
    design.captionStatus = 'approved';
    design.captionReviewComments = comments;
  } else {
    // Rejected -> re-open Stage 1 task for designer
    const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const task1 = addTask({
      title: `[Caption Revision] Draft Captions: ${design.title}`,
      event: design.eventName || undefined,
      eventId: design.eventId || undefined,
      assignee: design.designerName,
      assigneeId: design.designerId,
      assigneeEmail: design.designerEmail,
      assigneeType: 'individual',
      dueDate,
      status: 'In Progress',
      creatorName: actorName,
      isDesignDeliverable: true,
      workflowType: 'design_caption_draft',
      designId: design.id,
    });

    design.workflowStage = 'caption_required';
    design.captionTaskId = task1.id;
    design.captionStatus = 'changes_requested';
    design.captionReviewComments = comments;
  }

  designs[idx] = design;
  saveDesigns(designs);
  serverPatch('/api/designs', design.id, design);
  logAuditEvent('DESIGN_CAPTIONS_REVIEWED', actorName, `${approved ? 'Approved' : 'Requested changes for'} captions on design "${design.title}"`);
  return design;
}

/**
 * Marks ONE of the two posting tasks (Instagram or LinkedIn) done. The
 * design's workflowStage only flips to 'completed' once BOTH platforms have
 * been marked — posting to just one is not the end of the workflow.
 */
export function completeDesignPosting(designId: string, platform: 'instagram' | 'linkedin', actorName: string): DesignSubmissionItem | null {
  const designs = getDesigns();
  const idx = designs.findIndex(d => d.id === designId);
  if (idx === -1) return null;

  const design = designs[idx];
  const isUnified = design.postingInstagramTaskId && design.postingInstagramTaskId === design.postingLinkedinTaskId;

  if (platform === 'instagram') {
    design.postingInstagramDone = true;
  } else {
    design.postingLinkedinDone = true;
  }

  if (isUnified) {
    if (design.postingInstagramDone && design.postingLinkedinDone) {
      design.workflowStage = 'completed';
      if (design.postingInstagramTaskId) {
        updateTaskStatus(design.postingInstagramTaskId, 'Completed', actorName);
      }
    }
  } else {
    const taskId = platform === 'instagram' ? design.postingInstagramTaskId : design.postingLinkedinTaskId;
    if (taskId) {
      updateTaskStatus(taskId, 'Completed', actorName);
    }
    if (design.postingInstagramDone && design.postingLinkedinDone) {
      design.workflowStage = 'completed';
    }
  }

  designs[idx] = design;
  saveDesigns(designs);
  serverPatch('/api/designs', design.id, design);
  logAuditEvent('DESIGN_POSTING_COMPLETED', actorName, `Marked ${platform === 'instagram' ? 'Instagram' : 'LinkedIn'} posting complete for design "${design.title}"`);
  return design;
}

export function completeAllDesignPosting(designId: string, actorName: string): DesignSubmissionItem | null {
  const designs = getDesigns();
  const idx = designs.findIndex(d => d.id === designId);
  if (idx === -1) return null;

  const design = designs[idx];
  design.postingInstagramDone = true;
  design.postingLinkedinDone = true;
  design.workflowStage = 'completed';

  const taskId = design.postingInstagramTaskId || design.postingLinkedinTaskId;
  if (taskId) {
    updateTaskStatus(taskId, 'Completed', actorName);
  }
  if (design.postingLinkedinTaskId && design.postingLinkedinTaskId !== taskId) {
    updateTaskStatus(design.postingLinkedinTaskId, 'Completed', actorName);
  }

  designs[idx] = design;
  saveDesigns(designs);
  serverPatch('/api/designs', design.id, design);
  logAuditEvent('DESIGN_POSTING_COMPLETED', actorName, `Marked social media posting complete for design "${design.title}"`);
  return design;
}

/**
 * Lets whoever's on a "[Social Media Posting] Post on Instagram/LinkedIn"
 * task change and resubmit the approved caption text — e.g. a typo spotted
 * right before (or after) publishing — without re-running the full
 * draft/approval cycle in submitDesignCaptions/reviewDesignCaptions. Editable
 * regardless of whether that platform's post is already marked done, since a
 * correction can still be needed after the fact.
 */
export function updateApprovedCaption(
  designId: string,
  platform: 'instagram' | 'linkedin',
  newCaption: string,
  actorName: string
): DesignSubmissionItem | null {
  const designs = getDesigns();
  const idx = designs.findIndex(d => d.id === designId);
  if (idx === -1) return null;

  const design = { ...designs[idx] };
  if (platform === 'instagram') {
    design.approvedInstagramCaption = newCaption;
  } else {
    design.approvedLinkedinCaption = newCaption;
  }

  designs[idx] = design;
  saveDesigns(designs);
  serverPatch('/api/designs', design.id, design);
  logAuditEvent('DESIGN_CAPTION_EDITED', actorName, `Edited the ${platform === 'linkedin' ? 'LinkedIn' : 'Instagram'} caption for design "${design.title}"`);
  return design;
}

export function updateDesignReview(
  id: string,
  reviewStatus: 'Proofread Approved' | 'Changes Requested',
  comments: string,
  reviewerName: string
): DesignSubmissionItem | null {
  const current = getDesigns();
  const idx = current.findIndex(d => d.id === id);
  if (idx === -1) return null;

  const item = current[idx];
  const updatedReview: DesignProofreadReview = {
    proofreaderId: item.assignedProofreaderId || 'reviewer',
    proofreaderName: reviewerName,
    status: reviewStatus,
    comments,
    reviewedAt: new Date().toISOString()
  };

  let updatedItem: DesignSubmissionItem = {
    ...item,
    review: updatedReview
  };

  updatedItem = syncDesignTask(updatedItem, reviewerName);

  current[idx] = updatedItem;
  saveDesigns(current);
  serverPatch('/api/designs', id, current[idx]);
  logAuditEvent('DESIGN_PROOFREAD_UPDATED', reviewerName, `Updated proofread review for design "${item.title}" to ${reviewStatus}`);
  
  return current[idx];
}

export function updateDesignStyleReview(
  id: string,
  styleStatus: 'Style Approved' | 'Style Rejected',
  styleFeedback: string,
  reviewerName: string
): DesignSubmissionItem | null {
  const current = getDesigns();
  const idx = current.findIndex(d => d.id === id);
  if (idx === -1) return null;

  const item = current[idx];
  let updated: DesignSubmissionItem = {
    ...item,
    styleStatus,
    styleFeedback,
    styleDecidedBy: reviewerName,
    styleDecidedAt: new Date().toISOString()
  };

  // Once Style Approved, the 30-day storage-retention clock restarts from
  // the approval date instead of the original upload date — reviewers can
  // take a while to get to a submission, and the file should stay usable
  // for a full 30 days after being cleared for use, not expire mid-review.
  // Only the stored file/image is ever purged at expiry (processDesignRetention
  // in server-db.ts) — the proofread review, style feedback, and any Ratings
  // awarded against this design (a separate collection, keyed off the task
  // synced below) are untouched and stay visible permanently.
  if (styleStatus === 'Style Approved') {
    updated.expiresAt = new Date(new Date(updated.styleDecidedAt as string).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    updated.isExpired = false;
  }

  updated = syncDesignTask(updated, reviewerName);

  current[idx] = updated;
  saveDesigns(current);
  serverPatch('/api/designs', id, current[idx]);
  logAuditEvent('DESIGN_STYLE_REVIEW_UPDATED', reviewerName, `Design Head updated style review for design "${item.title}" to ${styleStatus}`);

  return current[idx];
}

/**
 * Replace the uploaded asset on an existing design submission — e.g. after
 * "Changes Requested" — without creating a new record. Resets any prior
 * proofread/style decision back to pending, since the reviewed file no
 * longer exists. The server round-trip is awaited (see addDesign for why) —
 * a failed upload rolls the local record back to the file it had before,
 * rather than leaving the UI showing a "replaced" file that never actually
 * reached the server.
 */
export async function updateDesignFile(
  id: string,
  fileData: string,
  fileName: string,
  fileSize: number,
  fileType: string,
  actorName: string,
  ocrScan?: OcrScanResult,
  onProgress?: UploadProgressCallback
): Promise<DesignSubmissionItem | null> {
  if (fileSize > 25 * 1024 * 1024) {
    throw new Error('File size exceeds the 25 MB limit.');
  }

  const current = getDesigns();
  const idx = current.findIndex(d => d.id === id);
  if (idx === -1) return null;

  const item = current[idx];
  let updated: DesignSubmissionItem = {
    ...item,
    fileData,
    fileName,
    fileSize,
    fileType,
    // The replaced file's own scan (if the designer ran one), or cleared —
    // the previous ocrScan described the file being replaced, not this one.
    ocrScan,
    review: item.review ? { ...item.review, status: 'Pending Proofread', comments: undefined, reviewedAt: undefined } : item.review,
    styleStatus: item.styleStatus ? 'Pending' : item.styleStatus,
    styleFeedback: undefined,
  };

  updated = syncDesignTask(updated, actorName);

  // PATCH to server first so fileData base64 is saved on disk and fileUrl is updated
  const serverResult = await serverPatch('/api/designs', id, updated, onProgress);
  if (!serverResult) {
    throw new Error('The replacement file failed to upload to the server. Please check your connection and try again.');
  }

  const finalUpdated: DesignSubmissionItem = {
    ...updated,
    ...serverResult,
  };
  delete finalUpdated.fileData;

  current[idx] = finalUpdated;
  saveDesigns(current);

  logAuditEvent('DESIGN_FILE_REPLACED', actorName, `Replaced the uploaded file for design "${item.title}"`);

  return finalUpdated;
}

export function deleteDesign(id: string, actorName: string): boolean {
  const current = getDesigns();
  const target = current.find(d => d.id === id);
  if (!target) return false;

  const updated = current.filter(d => d.id !== id);
  saveDesigns(updated);
  removeApprovalRequestsForEntity('design', id);
  serverDelete('/api/designs', id);
  logAuditEvent('DESIGN_DELETED', actorName, `Deleted design submission "${target.title}"`);
  return true;
}

// -------------------------------------------------------------
// Group Policy Management (Super User-only dynamic access control)
// -------------------------------------------------------------

export function getGroupPolicies(): GroupPolicy[] {
  if (typeof window === 'undefined') return initialGroupPolicies;
  const saved = localStorage.getItem('rtbi_group_policies');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  return initialGroupPolicies;
}

export function saveGroupPolicies(policies: GroupPolicy[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('rtbi_group_policies', JSON.stringify(policies));
  markLocalWrite('rtbi_group_policies');
}

export function addGroupPolicy(policy: Omit<GroupPolicy, 'id' | 'createdAt'>): GroupPolicy {
  const current = getGroupPolicies();
  const newPolicy: GroupPolicy = {
    ...policy,
    id: 'policy_' + Date.now(),
    createdAt: new Date().toISOString(),
  };
  current.unshift(newPolicy);
  saveGroupPolicies(current);
  serverPost('/api/group-policies', newPolicy);
  logAuditEvent('GROUP_POLICY_CREATED', policy.createdBy, `Created group policy tag "${newPolicy.name}" [${newPolicy.tag}] granting: ${newPolicy.capabilities.join(', ') || 'none'}`);
  return newPolicy;
}

export function updateGroupPolicy(id: string, updates: Partial<GroupPolicy>, actorName: string): GroupPolicy | null {
  const current = getGroupPolicies();
  const idx = current.findIndex(p => p.id === id);
  if (idx === -1) return null;

  current[idx] = { ...current[idx], ...updates, updatedAt: new Date().toISOString() };
  saveGroupPolicies(current);
  serverPatch('/api/group-policies', id, current[idx]);
  logAuditEvent('GROUP_POLICY_UPDATED', actorName, `Updated group policy tag "${current[idx].name}" [${current[idx].tag}]`);
  return current[idx];
}

export function deleteGroupPolicy(id: string, actorName: string): boolean {
  const current = getGroupPolicies();
  const target = current.find(p => p.id === id);
  if (!target) return false;

  const updated = current.filter(p => p.id !== id);
  saveGroupPolicies(updated);
  serverDelete('/api/group-policies', id);
  logAuditEvent('GROUP_POLICY_DELETED', actorName, `Deleted group policy tag "${target.name}" [${target.tag}]`);
  return true;
}

// -------------------------------------------------------------
// Access Level Settings (Super User-only, editable built-in access rules)
// -------------------------------------------------------------

export function getAccessLevelSettings(): AccessLevelSettings {
  if (typeof window === 'undefined') return DEFAULT_ACCESS_LEVEL_SETTINGS;
  const saved = localStorage.getItem('rtbi_access_level_settings');
  if (saved) {
    try {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr) && arr.length > 0) return { ...DEFAULT_ACCESS_LEVEL_SETTINGS, ...arr[0] };
    } catch (e) {
      console.error(e);
    }
  }
  return DEFAULT_ACCESS_LEVEL_SETTINGS;
}

export function updateAccessLevelSettings(updates: Partial<AccessLevelSettings>, actorName: string): AccessLevelSettings {
  const current = getAccessLevelSettings();
  const updated: AccessLevelSettings = {
    ...current,
    ...updates,
    id: 'default',
    updatedAt: new Date().toISOString(),
    updatedBy: actorName,
  };
  if (typeof window !== 'undefined') {
    localStorage.setItem('rtbi_access_level_settings', JSON.stringify([updated]));
    markLocalWrite('rtbi_access_level_settings');
  }
  serverPost('/api/access-level-settings', updated);
  logAuditEvent(
    'ACCESS_LEVEL_SETTINGS_CHANGED',
    actorName,
    `Updated built-in access level rules: ${Object.keys(updates).join(', ')}`
  );
  return updated;
}

// -------------------------------------------------------------
// System Settings (Super User-only site-wide lockdown switch)
// -------------------------------------------------------------

export function getSystemSettings(): SystemSettings {
  if (typeof window === 'undefined') return DEFAULT_SYSTEM_SETTINGS;
  const saved = localStorage.getItem('rtbi_system_settings');
  if (saved) {
    try {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr) && arr.length > 0) return { ...DEFAULT_SYSTEM_SETTINGS, ...arr[0] };
    } catch (e) {
      console.error(e);
    }
  }
  return DEFAULT_SYSTEM_SETTINGS;
}

export function saveSystemSettings(settings: SystemSettings): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('rtbi_system_settings', JSON.stringify([settings]));
    markLocalWrite('rtbi_system_settings');
  }
  serverPost('/api/system-settings', settings);
}

export function updateSystemSettings(updates: Partial<SystemSettings>, actorName: string): SystemSettings {
  const current = getSystemSettings();
  const updated: SystemSettings = {
    ...current,
    ...updates,
    id: 'default',
    updatedAt: new Date().toISOString(),
    updatedBy: actorName,
  };
  saveSystemSettings(updated);
  if (updates.lockdownEnabled !== undefined && updates.lockdownEnabled !== current.lockdownEnabled) {
    logAuditEvent(
      'SYSTEM_LOCKDOWN_CHANGED',
      actorName,
      updated.lockdownEnabled ? 'Enabled site-wide lockdown — every user except the Super User now sees a Not Found screen' : 'Disabled site-wide lockdown — normal access restored for everyone'
    );
  }
  return updated;
}

/**
 * Client Helper: Request a 5-minute password reset OTP
 */
export async function requestPasswordReset(email: string): Promise<{ success: boolean; message?: string; error?: string; expiresAt?: number; adminOverride?: boolean; activationLinkSent?: boolean; name?: string }> {
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (data.adminOverride) {
      return { success: true, adminOverride: true, message: data.message, name: data.name };
    }
    if (data.activationLinkSent) {
      return { success: true, activationLinkSent: true, message: data.message };
    }
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to send reset code.' };
    }
    return { success: true, message: data.message, expiresAt: data.expiresAt };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error requesting password reset.' };
  }
}

/**
 * Client Helper: Submit OTP and set new password
 */
export async function submitPasswordReset(email: string, otp: string, newPassword: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to reset password.' };
    }
    
    // Pull the freshly-hashed passwordHash back from the server rather than mirroring
    // the plaintext newPassword into the local cache ourselves.
    await syncWithServer();

    return { success: true, message: data.message };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error submitting password reset.' };
  }
}

/**
 * Client Helper: Request a 5-minute OTP to authorize changing the account's
 * login email. The code is sent to the CURRENT (old) email, not the new one.
 */
export async function requestEmailChange(memberId: string, currentEmail: string, newEmail: string): Promise<{ success: boolean; message?: string; error?: string; expiresAt?: number }> {
  try {
    const res = await fetch('/api/auth/request-email-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, currentEmail, newEmail }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to send verification code.' };
    }
    return { success: true, message: data.message, expiresAt: data.expiresAt };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error requesting email change.' };
  }
}

/**
 * Client Helper: Step 2 of 3 — submit the OTP sent to the OLD email. This
 * does NOT apply the new email yet; on success the server sends a second
 * OTP to the NEW address, which confirmNewEmailChange() below then verifies.
 */
export async function confirmEmailChange(memberId: string, otp: string): Promise<{ success: boolean; message?: string; error?: string; newEmail?: string; expiresAt?: number }> {
  try {
    const res = await fetch('/api/auth/confirm-email-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, otp }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to confirm email change.' };
    }
    return { success: true, message: data.message, newEmail: data.newEmail, expiresAt: data.expiresAt };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error confirming email change.' };
  }
}

/**
 * Client Helper: Step 3 of 3 — submit the OTP sent to the NEW email. Only
 * this final step actually applies the email change.
 */
export async function confirmNewEmailChange(memberId: string, otp: string): Promise<{ success: boolean; message?: string; error?: string; newEmail?: string }> {
  try {
    const res = await fetch('/api/auth/confirm-new-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, otp }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to confirm email change.' };
    }

    // Pull the freshly-updated record back from the server rather than mirroring
    // the change into the local cache ourselves.
    await syncWithServer();

    return { success: true, message: data.message, newEmail: data.newEmail };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error confirming email change.' };
  }
}

/**
 * Client Helper: Fetch sent email logs from database
 */
export async function getEmailLogs(): Promise<any[]> {
  try {
    const res = await fetch('/api/email', { headers: authHeaders() });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.error('Error fetching email logs:', e);
    return [];
  }
}

/**
 * Client Helper: Super User / Admin request member password setup (admin override)
 */
export async function requestMemberPasswordReset(memberId: string, mustReset: boolean = true): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`/api/members/${memberId}/require-password-reset`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mustReset }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to update password reset request.' };
    }
    await syncWithServer();
    return { success: true, message: data.message };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error setting password reset request.' };
  }
}

/**
 * Client Helper: Super User Only — directly set a member's password. Takes effect
 * immediately (no OTP, no "set up on next login" step for the member to complete).
 */
export async function adminSetMemberPassword(memberId: string, newPassword: string, actorName: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`/api/members/${memberId}/set-password`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ newPassword, actorName }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to set password.' };
    }
    await syncWithServer();
    return { success: true, message: data.message };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error setting password.' };
  }
}

/**
 * Client Helper: Submit new password via Super User Admin Override (no OTP required)
 */
export async function submitAdminOverridePasswordReset(email: string, newPassword: string): Promise<{ success: boolean; message?: string; user?: any; token?: string; error?: string }> {
  try {
    const res = await fetch('/api/auth/override-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to update password via admin override.' };
    }
    await syncWithServer();
    return { success: true, message: data.message, user: data.user, token: data.token };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error submitting admin override password reset.' };
  }
}




