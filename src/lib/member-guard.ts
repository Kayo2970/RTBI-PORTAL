/**
 * member-guard.ts — invariants shared by every server route that writes to
 * the members collection (single-record and bulk alike): the root Super User
 * always stays an active Super User, and the roster always keeps at least
 * one active Super User. Centralized here so the bulk routes can't drift
 * from the single-record ones.
 */

/** The root Super User is the account created by the first-run setup wizard (always id 'm1'). It can never be demoted, terminated or deleted. */
export function isRootSuperUser(m: any): boolean {
  return !!m && m.id === 'm1';
}

export function countActiveSuperUsersServer(members: any[]): number {
  return members.filter((m: any) =>
    (m.tier === 1 || m.role === 'Super User' || isRootSuperUser(m)) && m.status !== 'Terminated'
  ).length;
}

// Fields that change a member's standing/access in the system — changing any
// of these on ANYONE (including yourself) requires directory-edit access.
// passwordHash is never settable through the members routes at all
// (dedicated set-password/activation/reset routes own that).
export const PRIVILEGED_FIELDS = ['tier', 'role', 'status', 'division', 'department', 'approvalStatus', 'mustSetupPassword'];

/**
 * The Digital Visiting Card's designation: normally mirrors `role` (the
 * Directory-set designation), except a Super User (tier 1) may type a
 * free-text override — enforced server-side in members/[id]/route.ts, so
 * this can trust `cardDesignationOverride` being present at all means it
 * was legitimately set.
 */
export function effectiveCardDesignation(member: any): string {
  if (member?.tier === 1 && member?.cardDesignationOverride) {
    return member.cardDesignationOverride;
  }
  return member?.role || '';
}
