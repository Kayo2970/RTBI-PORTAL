'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  DoorOpen,
  CalendarDays,
  CheckSquare,
  PlusCircle,
  Calendar,
  CalendarPlus,
  Ticket,
  Palette,
  IdCard,
  Lightbulb,
  Star,
  FileCheck2,
  Receipt,
  Wallet,
  ReceiptText,
  Boxes,
  FileText,
  Megaphone,
  Contact,
  Send,
  Users,
  ShieldCheck,
  Mail,
  Settings,
  SlidersHorizontal,
  Search,
  X,
  Check,
  Sparkles,
  ArrowUpRight,
  Plus,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import {
  SessionUser,
  isSuperUser,
  canCreateTask,
  canCreateEvent,
  canManageBilling,
  canBookRoom,
  canManageInventory,
  canAccessEventPassesModule,
  canAccessGroupPolicies,
  canAccessGuestDirectory,
  canBuildForms,
  canManageEmailSettings,
} from '@/lib/permissions';

export interface QuickActionDef {
  id: string;
  title: string;
  shortDesc: string;
  category: 'Workspace' | 'Facilities' | 'Operations' | 'Administration';
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string; // text color
  bgColor: string;     // icon bg
  borderColor: string; // border on hover/badge
  isAllowed: (user: SessionUser) => boolean;
  defaultPinned: boolean;
}

export const ALL_QUICK_ACTIONS: QuickActionDef[] = [
  // --- Facilities ---
  {
    id: 'book-room',
    title: 'Book a Room',
    shortDesc: 'Reserve Boardroom or Meeting Room',
    category: 'Facilities',
    href: '/dashboard/bookings',
    icon: DoorOpen,
    accentColor: 'text-sky-400',
    bgColor: 'bg-sky-500/15',
    borderColor: 'border-sky-500/30',
    isAllowed: (u) => canBookRoom(u),
    defaultPinned: true,
  },

  // --- Workspace ---
  {
    id: 'calendar',
    title: 'Calendar & Schedule',
    shortDesc: 'Interactive month and day view',
    category: 'Workspace',
    href: '/dashboard/calendar',
    icon: CalendarDays,
    accentColor: 'text-accent',
    bgColor: 'bg-accent/15',
    borderColor: 'border-accent/30',
    isAllowed: (u) => !!u,
    defaultPinned: true,
  },
  {
    id: 'tasks',
    title: 'My Assigned Tasks',
    shortDesc: 'Review action items and deadlines',
    category: 'Workspace',
    href: '/dashboard/tasks',
    icon: CheckSquare,
    accentColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15',
    borderColor: 'border-emerald-500/30',
    isAllowed: (u) => !!u,
    defaultPinned: true,
  },
  {
    id: 'create-task',
    title: 'New Task Allotment',
    shortDesc: 'Assign task to team or members',
    category: 'Workspace',
    href: '/dashboard/tasks?action=new',
    icon: PlusCircle,
    accentColor: 'text-amber-400',
    bgColor: 'bg-amber-500/15',
    borderColor: 'border-amber-500/30',
    isAllowed: (u) => canCreateTask(u),
    defaultPinned: true,
  },
  {
    id: 'events',
    title: 'Events & Cohorts',
    shortDesc: 'Incubator symposiums & masterclasses',
    category: 'Workspace',
    href: '/dashboard/events',
    icon: Calendar,
    accentColor: 'text-rose-400',
    bgColor: 'bg-rose-500/15',
    borderColor: 'border-rose-500/30',
    isAllowed: (u) => !!u,
    defaultPinned: true,
  },
  {
    id: 'create-event',
    title: 'Create Incubator Event',
    shortDesc: 'Draft event with timeline and pass config',
    category: 'Workspace',
    href: '/dashboard/events?action=new',
    icon: CalendarPlus,
    accentColor: 'text-fuchsia-400',
    bgColor: 'bg-fuchsia-500/15',
    borderColor: 'border-fuchsia-500/30',
    isAllowed: (u) => canCreateEvent(u),
    defaultPinned: false,
  },
  {
    id: 'event-passes',
    title: 'Event Passes & Wallet',
    shortDesc: 'Apple/Google Wallet passes and check-ins',
    category: 'Workspace',
    href: '/dashboard/event-passes',
    icon: Ticket,
    accentColor: 'text-indigo-400',
    bgColor: 'bg-indigo-500/15',
    borderColor: 'border-indigo-500/30',
    isAllowed: (u) => canAccessEventPassesModule(u),
    defaultPinned: false,
  },
  {
    id: 'designs',
    title: 'Design Portal',
    shortDesc: 'Canva designs, banners & brand assets',
    category: 'Workspace',
    href: '/dashboard/designs',
    icon: Palette,
    accentColor: 'text-pink-400',
    bgColor: 'bg-pink-500/15',
    borderColor: 'border-pink-500/30',
    isAllowed: (u) => !!u,
    defaultPinned: true,
  },
  {
    id: 'visiting-card',
    title: 'Digital Visiting Card',
    shortDesc: 'Share contact card with QR & VCF',
    category: 'Workspace',
    href: '/dashboard/visiting-card',
    icon: IdCard,
    accentColor: 'text-cyan-400',
    bgColor: 'bg-cyan-500/15',
    borderColor: 'border-cyan-500/30',
    isAllowed: (u) => !!u,
    defaultPinned: false,
  },
  {
    id: 'proposals',
    title: 'Startup Proposals',
    shortDesc: 'Submit and track innovation proposals',
    category: 'Workspace',
    href: '/dashboard/proposals',
    icon: Lightbulb,
    accentColor: 'text-yellow-400',
    bgColor: 'bg-yellow-500/15',
    borderColor: 'border-yellow-500/30',
    isAllowed: (u) => !!u,
    defaultPinned: false,
  },
  {
    id: 'ratings',
    title: 'Performance Ratings',
    shortDesc: 'Deliverable evaluations & leaderboard',
    category: 'Workspace',
    href: '/dashboard/ratings',
    icon: Star,
    accentColor: 'text-amber-400',
    bgColor: 'bg-amber-500/15',
    borderColor: 'border-amber-500/30',
    isAllowed: (u) => !!u,
    defaultPinned: false,
  },

  // --- Operations ---
  {
    id: 'approvals',
    title: 'Approvals Center',
    shortDesc: 'Review pending requests and workflows',
    category: 'Operations',
    href: '/dashboard/approvals',
    icon: FileCheck2,
    accentColor: 'text-purple-400',
    bgColor: 'bg-purple-500/15',
    borderColor: 'border-purple-500/30',
    isAllowed: (u) => !!u,
    defaultPinned: true,
  },
  {
    id: 'inventory',
    title: 'Inventory Management',
    shortDesc: 'Stock item codes, categories & movements',
    category: 'Operations',
    href: '/dashboard/inventory',
    icon: Boxes,
    accentColor: 'text-teal-400',
    bgColor: 'bg-teal-500/15',
    borderColor: 'border-teal-500/30',
    isAllowed: (u) => canManageInventory(u),
    defaultPinned: true,
  },
  {
    id: 'reimbursements',
    title: 'Reimbursements',
    shortDesc: 'Submit expense claims and track approvals',
    category: 'Operations',
    href: '/dashboard/reimbursements',
    icon: Receipt,
    accentColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15',
    borderColor: 'border-emerald-500/30',
    isAllowed: (u) => !!u,
    defaultPinned: false,
  },
  {
    id: 'budget',
    title: 'Budget & Funds',
    shortDesc: 'Track allocations, grants and spend',
    category: 'Operations',
    href: '/dashboard/budget',
    icon: Wallet,
    accentColor: 'text-blue-400',
    bgColor: 'bg-blue-500/15',
    borderColor: 'border-blue-500/30',
    isAllowed: (u) => !!u,
    defaultPinned: false,
  },
  {
    id: 'invoices',
    title: 'Invoices & Payments',
    shortDesc: 'Billing statements and payment tracking',
    category: 'Operations',
    href: '/dashboard/invoices',
    icon: ReceiptText,
    accentColor: 'text-sky-400',
    bgColor: 'bg-sky-500/15',
    borderColor: 'border-sky-500/30',
    isAllowed: (u) => canManageBilling(u) || (u?.tier !== undefined && u.tier <= 3),
    defaultPinned: false,
  },
  {
    id: 'forms',
    title: 'Public Forms Builder',
    shortDesc: 'Create applicant and feedback forms',
    category: 'Operations',
    href: '/dashboard/forms',
    icon: FileText,
    accentColor: 'text-violet-400',
    bgColor: 'bg-violet-500/15',
    borderColor: 'border-violet-500/30',
    isAllowed: (u) => canBuildForms(u),
    defaultPinned: false,
  },
  {
    id: 'announcements',
    title: 'Announcements',
    shortDesc: 'Center updates, alerts and notices',
    category: 'Operations',
    href: '/dashboard/announcements',
    icon: Megaphone,
    accentColor: 'text-orange-400',
    bgColor: 'bg-orange-500/15',
    borderColor: 'border-orange-500/30',
    isAllowed: (u) => !!u,
    defaultPinned: false,
  },
  {
    id: 'guests',
    title: 'Guest & VIP Directory',
    shortDesc: 'Mentors, speakers & VIP visiting contacts',
    category: 'Operations',
    href: '/dashboard/guest-directory',
    icon: Contact,
    accentColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15',
    borderColor: 'border-emerald-500/30',
    isAllowed: (u) => canAccessGuestDirectory(u),
    defaultPinned: false,
  },

  // --- Administration (Strict Super User / Admin only) ---
  {
    id: 'broadcaster',
    title: 'Mail Broadcaster',
    shortDesc: 'Mail-merge and recipient broadcasts',
    category: 'Administration',
    href: '/dashboard/broadcaster',
    icon: Send,
    accentColor: 'text-accent',
    bgColor: 'bg-accent/15',
    borderColor: 'border-accent/30',
    isAllowed: (u) => isSuperUser(u),
    defaultPinned: true,
  },
  {
    id: 'users',
    title: 'User Administration',
    shortDesc: 'Manage members, roles and tiers',
    category: 'Administration',
    href: '/dashboard/users',
    icon: Users,
    accentColor: 'text-red-400',
    bgColor: 'bg-red-500/15',
    borderColor: 'border-red-500/30',
    isAllowed: (u) => isSuperUser(u),
    defaultPinned: true,
  },
  {
    id: 'policies',
    title: 'Group Policies & RBAC',
    shortDesc: 'Role access policies and matrix',
    category: 'Administration',
    href: '/dashboard/policies',
    icon: ShieldCheck,
    accentColor: 'text-indigo-400',
    bgColor: 'bg-indigo-500/15',
    borderColor: 'border-indigo-500/30',
    isAllowed: (u) => canAccessGroupPolicies(u),
    defaultPinned: false,
  },
  {
    id: 'email-settings',
    title: 'Email Configuration',
    shortDesc: 'SMTP credentials, templates and logs',
    category: 'Administration',
    href: '/dashboard/email',
    icon: Mail,
    accentColor: 'text-blue-400',
    bgColor: 'bg-blue-500/15',
    borderColor: 'border-blue-500/30',
    isAllowed: (u) => canManageEmailSettings(u),
    defaultPinned: false,
  },
  {
    id: 'settings',
    title: 'System Settings',
    shortDesc: 'Center profiles and portal preferences',
    category: 'Administration',
    href: '/dashboard/settings',
    icon: Settings,
    accentColor: 'text-theme-text-secondary',
    bgColor: 'bg-theme-border/30',
    borderColor: 'border-theme-border/40',
    isAllowed: (u) => !!u,
    defaultPinned: false,
  },
];

interface QuickActionsWidgetProps {
  user: any;
}

export function QuickActionsWidget({ user }: QuickActionsWidgetProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Strictly filter only actions that this user has permission to access
  const authorizedActions = useMemo(() => {
    return ALL_QUICK_ACTIONS.filter((action) => action.isAllowed(user));
  }, [user]);

  const authorizedActionIds = useMemo(() => {
    return new Set(authorizedActions.map((a) => a.id));
  }, [authorizedActions]);

  // Storage key per user
  const storageKey = useMemo(() => {
    const userIdentifier = user?.id || user?.email || 'default';
    return `rtbi_quick_actions_${userIdentifier}`;
  }, [user]);

  // Default pinned IDs among the authorized ones
  const defaultPinnedIds = useMemo(() => {
    const pinned = authorizedActions.filter((a) => a.defaultPinned).map((a) => a.id);
    return pinned.length > 0 ? pinned : authorizedActions.slice(0, 6).map((a) => a.id);
  }, [authorizedActions]);

  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load user's saved preferences
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Strictly drop any ID that the user is not permitted to see
          const valid = parsed.filter((id) => authorizedActionIds.has(id));
          setPinnedIds(valid.length > 0 ? valid : defaultPinnedIds);
          setIsInitialized(true);
          return;
        }
      }
    } catch (e) {
      console.error('Failed to load quick action preferences:', e);
    }
    setPinnedIds(defaultPinnedIds);
    setIsInitialized(true);
  }, [storageKey, authorizedActionIds, defaultPinnedIds]);

  // Save changes
  const savePinnedIds = (newIds: string[]) => {
    // Enforce permission boundary: only save IDs that are genuinely authorized
    const sanitized = newIds.filter((id) => authorizedActionIds.has(id));
    setPinnedIds(sanitized);
    try {
      localStorage.setItem(storageKey, JSON.stringify(sanitized));
    } catch (e) {
      console.error('Failed to save quick action preferences:', e);
    }
  };

  const togglePin = (actionId: string) => {
    if (!authorizedActionIds.has(actionId)) return;
    if (pinnedIds.includes(actionId)) {
      savePinnedIds(pinnedIds.filter((id) => id !== actionId));
    } else {
      savePinnedIds([...pinnedIds, actionId]);
    }
  };

  const resetToDefaults = () => {
    savePinnedIds(defaultPinnedIds);
  };

  const selectAllPermitted = () => {
    savePinnedIds(authorizedActions.map((a) => a.id));
  };

  // Active actions to render in the widget (maintaining user selected order)
  const activeActions = useMemo(() => {
    return pinnedIds
      .map((id) => authorizedActions.find((a) => a.id === id))
      .filter((a): a is QuickActionDef => Boolean(a));
  }, [pinnedIds, authorizedActions]);

  // Actions for modal display (filtered by search query)
  const filteredModalActions = useMemo(() => {
    if (!searchQuery.trim()) return authorizedActions;
    const q = searchQuery.toLowerCase();
    return authorizedActions.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.shortDesc.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    );
  }, [authorizedActions, searchQuery]);

  // Grouped actions for modal
  const groupedModalActions = useMemo(() => {
    const groups: Record<string, QuickActionDef[]> = {
      Facilities: [],
      Workspace: [],
      Operations: [],
      Administration: [],
    };
    filteredModalActions.forEach((action) => {
      if (!groups[action.category]) groups[action.category] = [];
      groups[action.category].push(action);
    });
    return groups;
  }, [filteredModalActions]);

  if (!isInitialized) {
    return null;
  }

  return (
    <section aria-label="Quick Actions Widget" className="space-y-3">
      {/* Widget Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-xl bg-accent/15 text-accent border border-accent/25">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-theme-text-primary flex items-center gap-2">
              Quick Actions
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-accent/15 text-accent border border-accent/25">
                {activeActions.length} active
              </span>
            </h2>
            <p className="text-[11px] text-theme-text-secondary">
              Personalized shortcuts dock to quickly jump to your permitted modules
            </p>
          </div>
        </div>

        {/* Customize Trigger Button */}
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme-border/40 hover:border-accent/40 bg-theme-background/30 hover:bg-theme-border/20 text-xs font-semibold text-theme-text-primary transition-all cursor-pointer shadow-sm self-start sm:self-auto"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-accent" />
          Customize Dock
        </button>
      </div>

      {/* Grid of Quick Action Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {activeActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.id}
              href={action.href}
              className={`group glass-panel rounded-2xl p-3.5 flex flex-col justify-between border border-theme-card-border/70 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/5 transition-all cursor-pointer relative overflow-hidden bg-gradient-to-br from-theme-card/70 to-theme-card/30`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-1">
                  <div
                    className={`p-2 rounded-xl ${action.bgColor} ${action.accentColor} border ${action.borderColor} group-hover:scale-110 transition-transform duration-200`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-theme-text-secondary/40 group-hover:text-accent group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </div>

                <div>
                  <h3 className="font-bold text-xs text-theme-text-primary group-hover:text-accent transition-colors line-clamp-1">
                    {action.title}
                  </h3>
                  <p className="text-[10px] text-theme-text-secondary line-clamp-1 mt-0.5">
                    {action.shortDesc}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}

        {/* Add Shortcut / Customize Tile */}
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="glass-panel rounded-2xl p-3.5 flex flex-col items-center justify-center text-center gap-1.5 border border-dashed border-theme-border/60 hover:border-accent/50 hover:bg-accent/5 transition-all cursor-pointer group"
          title="Add or remove shortcuts"
        >
          <div className="h-8 w-8 rounded-xl bg-theme-background/40 group-hover:bg-accent/15 text-theme-text-secondary group-hover:text-accent flex items-center justify-center transition-colors">
            <Plus className="h-4 w-4" />
          </div>
          <span className="text-xs font-semibold text-theme-text-secondary group-hover:text-theme-text-primary transition-colors">
            Add More
          </span>
          <span className="text-[10px] text-theme-text-secondary/70">
            Customize dock
          </span>
        </button>
      </div>

      {/* Fallback if user unpinned everything */}
      {activeActions.length === 0 && (
        <div className="p-6 rounded-2xl bg-theme-background/20 border border-dashed border-theme-border/40 text-center space-y-2">
          <p className="text-xs text-theme-text-secondary">
            Your Quick Actions dock is currently empty.
          </p>
          <button
            type="button"
            onClick={resetToDefaults}
            className="px-3.5 py-1.5 rounded-xl bg-accent text-white text-xs font-bold hover:bg-primary-light transition-all shadow-sm cursor-pointer"
          >
            Load Recommended Shortcuts
          </button>
        </div>
      )}

      {/* =========================================================================
          CUSTOMIZATION MODAL (ONLY SHOWS AUTHORIZED MODULES & ACTIONS)
      ========================================================================= */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="glass-panel w-full max-w-2xl rounded-3xl p-6 space-y-5 border border-white/15 shadow-2xl max-h-[88vh] overflow-y-auto animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-theme-border/20 pb-3">
              <div>
                <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-accent" />
                  Customize Home Quick Actions
                </h3>
                <p className="text-xs text-theme-text-secondary mt-0.5">
                  Select which shortcuts you want visible on your home screen. Only modules permitted for your tier ({user?.role || user?.division || 'Member'}) are listed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="h-8 w-8 rounded-xl hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary flex items-center justify-center cursor-pointer transition-colors shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Search and Bulk Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-theme-text-secondary" />
                <input
                  type="text"
                  placeholder="Filter available shortcuts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-theme-background/30 border border-theme-border/40 rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={selectAllPermitted}
                  className="px-2.5 py-1.5 rounded-lg border border-theme-border/30 hover:border-accent/40 bg-theme-background/20 text-theme-text-primary text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={resetToDefaults}
                  className="px-2.5 py-1.5 rounded-lg border border-theme-border/30 hover:border-theme-border bg-theme-background/20 text-theme-text-secondary hover:text-theme-text-primary text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1"
                >
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
              </div>
            </div>

            {/* List of Actions by Category */}
            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
              {(['Facilities', 'Workspace', 'Operations', 'Administration'] as const).map(
                (category) => {
                  const items = groupedModalActions[category];
                  if (!items || items.length === 0) return null;

                  return (
                    <div key={category} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[11px] font-bold text-theme-text-secondary uppercase tracking-wider">
                          {category} ({items.length})
                        </h4>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {items.map((action) => {
                          const Icon = action.icon;
                          const isPinned = pinnedIds.includes(action.id);

                          return (
                            <button
                              key={action.id}
                              type="button"
                              onClick={() => togglePin(action.id)}
                              className={`p-3 rounded-2xl border text-left flex items-center justify-between gap-2.5 transition-all cursor-pointer ${
                                isPinned
                                  ? 'border-accent bg-accent/15 ring-1 ring-accent/30 shadow-sm'
                                  : 'border-theme-border/30 bg-theme-background/20 hover:border-theme-border/60'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div
                                  className={`p-2 rounded-xl shrink-0 ${action.bgColor} ${action.accentColor} border ${action.borderColor}`}
                                >
                                  <Icon className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-bold text-xs text-theme-text-primary truncate">
                                    {action.title}
                                  </p>
                                  <p className="text-[10px] text-theme-text-secondary truncate">
                                    {action.shortDesc}
                                  </p>
                                </div>
                              </div>

                              {/* Checkbox indicator */}
                              <div
                                className={`h-5 w-5 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                                  isPinned
                                    ? 'bg-accent border-accent text-white shadow-sm'
                                    : 'border-theme-border/60 bg-theme-background/40'
                                }`}
                              >
                                {isPinned && <Check className="h-3.5 w-3.5" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
              )}

              {filteredModalActions.length === 0 && (
                <div className="py-8 text-center text-xs text-theme-text-secondary">
                  No permitted shortcuts match your search &quot;{searchQuery}&quot;.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-theme-border/20 text-xs">
              <span className="text-theme-text-secondary">
                <strong className="text-theme-text-primary">{pinnedIds.length}</strong> of{' '}
                {authorizedActions.length} permitted actions active
              </span>

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2 rounded-xl bg-accent hover:bg-primary-light text-white font-bold transition-all shadow-md shadow-accent/20 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

