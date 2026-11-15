/**
 * announcement-scope.ts — the single source of truth for "who does an
 * announcement's `scope` actually target." Pure (no window/localStorage),
 * so it's safe to import from both server Route Handlers and client pages.
 *
 * Recipients are resolved from the scope string: everyone, a tier/division, or a department.
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

  const byDepartment = members.filter(m => m.department === scope);
  if (byDepartment.length > 0) return byDepartment;

  return [];
}

/** Per-viewer relevance check ("is this announcement meant for me"), used to filter
 *  the notification feed. Base leadership (tier <= 3) always sees everything. */
export function getAnnouncementScopeMatch(
  scope: string,
  user: { tier: number; division?: string; department?: string } | null | undefined
): boolean {
  if (!user) return false;
  if (!scope || scope === 'All Members' || scope === 'All Center Members') return true;
  if (user.tier <= 3) return true; // mirrors permissions.isBaseLeadership
  if (DIVISION_SCOPES.includes(scope)) return scope === user.division;
  return scope === user.department;
}
