import type React from 'react';
import {
  LayoutDashboard, Calendar, CheckSquare, Star, Receipt, ReceiptText, DoorOpen, Boxes, FileText, BarChart3,
  Megaphone, Settings, FileCheck2, IdCard, Ticket, Lightbulb, Rocket, Palette, Send, Mail,
  Contact, Wallet, ShieldCheck, Users, Sparkles,
} from 'lucide-react';
import { canAccessEventPassesModule, canAccessGroupPolicies } from '@/lib/permissions';

export interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Extra path prefixes that should also highlight this item. */
  matchPrefixes?: string[];
  superUserOnly?: boolean;
  eventPassesOnly?: boolean;
  staffOnly?: boolean; // tiers 1–3 (Super User, CEO, Employee)
  groupPoliciesOnly?: boolean;
  /** Extra words the command palette matches on. */
  keywords?: string;
  /** Where external reviewers (who can reach only part of the area) are sent instead of `href`. */
  externalHref?: string;
}

export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
  /** Rarely used modules: collapsed by default (progressive disclosure). */
  collapsible?: boolean;
}

/**
 * Five groups, each short enough to scan at a glance (Miller's Law); the long tail lives under
 * a collapsed "More" group (Hick's Law). Incubation gets its own group.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'work',
    title: 'Work',
    items: [
      { name: 'Dashboard', href: '/dashboard/home', icon: LayoutDashboard, keywords: 'home overview' },
      { name: 'Tasks', href: '/dashboard/tasks', icon: CheckSquare, keywords: 'todo assignments' },
      { name: 'Calendar', href: '/dashboard/calendar', icon: Calendar, keywords: 'schedule' },
      { name: 'Events', href: '/dashboard/events', icon: Calendar, keywords: 'programme' },
      { name: 'Approvals', href: '/dashboard/approvals', icon: FileCheck2, keywords: 'inbox decisions' },
    ],
  },
  {
    id: 'incubation',
    title: 'Incubation',
    items: [
      { name: 'Incubation', href: '/dashboard/incubation/overview', icon: Rocket, matchPrefixes: ['/dashboard/incubation'], externalHref: '/dashboard/incubation/applications', keywords: 'startups applications onboarding registers kpi reviews cohorts mentors graduation' },
    ],
  },
  {
    id: 'communication',
    title: 'Communication',
    items: [
      { name: 'Announcements', href: '/dashboard/announcements', icon: Megaphone, keywords: 'news notices' },
      { name: 'Public Forums', href: '/dashboard/forms', icon: FileText, keywords: 'forms surveys' },
      { name: 'Email Management', href: '/dashboard/email', icon: Mail, superUserOnly: true, keywords: 'mail inbox' },
    ],
  },
  {
    id: 'admin',
    title: 'Admin & Finance',
    items: [
      { name: 'Finance', href: '/dashboard/budget', icon: Wallet, keywords: 'budget money' },
      { name: 'Invoices', href: '/dashboard/invoices', icon: Receipt, keywords: 'billing payments' },
      { name: 'Users', href: '/dashboard/users', icon: Users, superUserOnly: true, keywords: 'members accounts people' },
      { name: 'Group Policies', href: '/dashboard/policies', icon: ShieldCheck, groupPoliciesOnly: true, keywords: 'permissions access' },
      { name: 'Settings', href: '/dashboard/settings', icon: Settings, keywords: 'profile preferences' },
    ],
  },
  {
    id: 'more',
    title: 'More',
    collapsible: true,
    items: [
      { name: 'Event Passes', href: '/dashboard/event-passes', icon: Ticket, eventPassesOnly: true },
      { name: 'Proposals', href: '/dashboard/proposals', icon: Lightbulb },
      { name: 'Ratings', href: '/dashboard/ratings', icon: Star, keywords: 'scorecards feedback' },
      { name: 'Design Portal', href: '/dashboard/designs', icon: Palette },
      { name: 'Visiting Card', href: '/dashboard/visiting-card', icon: IdCard },
      { name: 'Bookings', href: '/dashboard/bookings', icon: DoorOpen, keywords: 'rooms' },
      { name: 'Expenses', href: '/dashboard/expenses', icon: ReceiptText, staffOnly: true },
      { name: 'Inventory', href: '/dashboard/inventory', icon: Boxes, staffOnly: true },
      { name: 'Guest Directory', href: '/dashboard/guest-directory', icon: Contact },
      { name: 'Mail Broadcaster', href: '/dashboard/broadcaster', icon: Send, superUserOnly: true },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** The one visibility rule used by sidebar, mobile drawer and command palette. */
export function isNavItemVisible(item: NavItem, user: any): boolean {
  return (
    (!item.superUserOnly || user.tier === 1) &&
    (!item.staffOnly || user.tier <= 3) &&
    (!item.eventPassesOnly || canAccessEventPassesModule(user)) &&
    (!item.groupPoliciesOnly || canAccessGroupPolicies(user))
  );
}

function matches(item: NavItem, pathname: string) {
  const prefixes = [item.href, ...(item.matchPrefixes ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** Longest-prefix match so exactly one sidebar item is highlighted (e.g. Startups is not "active" on /incubation/kpi). */
export function findActiveItem(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS
    .filter((i) => matches(i, pathname))
    .sort((a, b) => Math.max(...[a.href, ...(a.matchPrefixes ?? [])].map((p) => p.length)) - Math.max(...[b.href, ...(b.matchPrefixes ?? [])].map((p) => p.length)))
    .pop();
}

export const PaletteIcon = Sparkles;
