/**
 * announcement-scope.ts — the single source of truth for "who does an
 * announcement's `scope` actually target." Pure (no window/localStorage),
 * so it's safe to import from both server Route Handlers and client pages.
 *
 * Fixes the recipient targeting that `Member.committee` was meant to cover
 * but never can — every real member has `committee: undefined`; the field
 * that actually holds a value like "Executive Council" is `department`.
 * Ad-hoc scope values that aren't a division or a department (e.g. a named
 * event committee from getCommittees()) are resolved by matching against
 * EventCommittee.memberIds, which only exists nested inside EventItem —
 * not on Member at all.
 */
import type { Member, EventItem } from './local-data';

const DIVISION_SCOPES = ['Super User', 'CEO', 'Employee', 'Startup'];

/** Pure, server-and-client-safe: given a scope string, the full member list, and
 *  the full event list, returns the members that scope actually targets. This is
 *  the ONLY place recipient-set logic should live — used for real sending (server)
 *  and anywhere the UI needs to preview/count who a scope reaches. */
export function resolveAnnouncementRecipients(
  scope: string,
  members: Member[],
  events: EventItem[] = []
): Member[] {
  // 'All Center Members' was a stale mislabel the announcements page used to
  // store for this scope — kept as an alias so announcements already saved
  // with it (from before that was fixed) still resolve recipients correctly.
  if (!scope || scope === 'All Members' || scope === 'All Center Members') return members;

  if (DIVISION_SCOPES.includes(scope)) {
    return members.filter(m => m.division === scope);
  }

  const byDepartmentOrCommittee = members.filter(m => m.department === scope || m.committee === scope);
  if (byDepartmentOrCommittee.length > 0) return byDepartmentOrCommittee;

  // Ad-hoc event-committee scope (e.g. "Design & Media Committee") — resolve via
  // EventCommittee.memberIds, matching both member id and name (existing legacy
  // dual-matching convention used elsewhere, e.g. canViewTask/getStudentProfile).
  const matchingCommittees = events.flatMap(e => e.committees || []).filter(c => c.name === scope);
  if (matchingCommittees.length === 0) return [];

  const matchedIds = new Set<string>();
  const matchedNames = new Set<string>();
  matchingCommittees.forEach(c => (c.memberIds || []).forEach(idOrName => {
    matchedIds.add(idOrName);
    matchedNames.add(idOrName.toLowerCase());
  }));

  return members.filter(m => matchedIds.has(m.id) || matchedNames.has(m.name.toLowerCase()));
}

/** Per-viewer relevance check ("is this announcement meant for me"), used to filter
 *  the notification feed. Base leadership (tier <= 3) always sees everything. */
export function getAnnouncementScopeMatch(
  scope: string,
  user: { tier: number; division?: string; committee?: string; department?: string } | null | undefined
): boolean {
  if (!user) return false;
  if (!scope || scope === 'All Members' || scope === 'All Center Members') return true;
  if (user.tier <= 3) return true; // mirrors permissions.isBaseLeadership
  if (DIVISION_SCOPES.includes(scope)) return scope === user.division;
  return scope === user.department || scope === user.committee;
}
