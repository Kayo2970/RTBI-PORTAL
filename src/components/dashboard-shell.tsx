'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Calendar,
  CheckSquare,
  Star,
  Receipt,
  ReceiptText,
  DoorOpen,
  Boxes,
  FileText,
  BarChart3,
  Megaphone,
  FolderGit2,
  Settings,
  LogOut,
  Sun,
  Moon,
  Menu,
  X,
  User,
  Bell,
  Check,
  Info,
  ShieldCheck,
  Palette,
  UserCog,
  Search,
  Undo2,
  DatabaseBackup,
  Mail,
  Send,
  Contact,
  Wallet,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Compass,
  Trash2,
  Sparkles,
  FileCheck2,
  IdCard,
  Ticket,
  Package,
  Lightbulb,
  Users,
} from 'lucide-react';
import { getAnnouncements, getTasks, getDesigns, getMembers, getBudgets, getReimbursements, getEvents, getEventReports, getApprovalRequests, logAuditEvent, Member, syncWithServer, getSystemSettings, signOutClient, getSessionToken, setSessionToken, authHeaders } from '@/lib/local-data';
import { canViewTaskExtended, getAnnouncementScopeMatch, isCentreHead, isEventsHeadGgCampus, isFinanceHead, canAccessGuestDirectory, canVerifyBudgetCentreHead, canDecideBudget, canVerifyReimbursementCentreHead, canApproveAsSectorHead, canApproveAsFinanceHead, canSubmitEventReport, canReviewEventReports, canViewEventReports, canAccessEventPassesModule, canAccessGroupPolicies } from '@/lib/permissions';
import { TermsModal } from '@/components/terms-modal';
import { PrivacyPolicyModal } from '@/components/privacy-policy-modal';
import { IosInstallPrompt } from '@/components/ios-install-prompt';
import { NotFoundScreen } from '@/components/not-found-screen';
import { LoadingScreen } from '@/components/loading-screen';
import dynamic from 'next/dynamic';
import { BackgroundTaskTray } from '@/components/background-task-tray';
const OnboardingTour = dynamic(() => import('@/components/onboarding-tour').then((m) => m.OnboardingTour), { ssr: false });
import { PromotionModal, PromotionData } from '@/components/promotion-modal';
import { SyncStatusPill } from '@/components/ui/sync-status-pill';
import { Avatar } from '@/components/ui/avatar';
const AeroShardsBackground = dynamic(
  () => import('@/components/aero-shards-background').then((m) => m.AeroShardsBackground),
  { ssr: false }
);

interface SidebarItem {
  name: string;
  href: string;
  icon: React.ComponentType<any>;
  superUserOnly?: boolean;
  staffOnly?: boolean; // tiers 1–3 (Super User, CEO, Employee)
  groupPoliciesOnly?: boolean;
}

interface NavSection {
  title: string;
  items: SidebarItem[];
}

const navSections: NavSection[] = [
  {
    title: 'Workspace',
    items: [
      { name: 'Dashboard', href: '/dashboard/home', icon: LayoutDashboard },
      { name: 'Calendar', href: '/dashboard/calendar', icon: Calendar },
      { name: 'Events', href: '/dashboard/events', icon: Calendar },
      { name: 'Tasks', href: '/dashboard/tasks', icon: CheckSquare },
      { name: 'Approvals', href: '/dashboard/approvals', icon: FileCheck2 },
      { name: 'Proposals', href: '/dashboard/proposals', icon: Lightbulb },
      { name: 'Ratings', href: '/dashboard/ratings', icon: Star },
      { name: 'Design Portal', href: '/dashboard/designs', icon: Palette },
      { name: 'Visiting Card', href: '/dashboard/visiting-card', icon: IdCard },
      { name: 'Bookings', href: '/dashboard/bookings', icon: DoorOpen },
    ],
  },
  {
    title: 'Administration',
    items: [
      { name: 'Reimbursements', href: '/dashboard/reimbursements', icon: Receipt },
      { name: 'Budget & Funds', href: '/dashboard/budget', icon: Wallet },
      { name: 'Invoices & Payments', href: '/dashboard/invoices', icon: ReceiptText },
      { name: 'Inventory', href: '/dashboard/inventory', icon: Boxes, staffOnly: true },
      { name: 'Public Forums', href: '/dashboard/forms', icon: FileText },
      { name: 'Announcements', href: '/dashboard/announcements', icon: Megaphone },
      { name: 'Guest Directory', href: '/dashboard/guest-directory', icon: Contact },
      { name: 'Users', href: '/dashboard/users', icon: Users, superUserOnly: true },
      { name: 'Group Policies', href: '/dashboard/policies', icon: ShieldCheck, groupPoliciesOnly: true },
      { name: 'Email Management', href: '/dashboard/email', icon: Mail, superUserOnly: true },
      { name: 'Settings', href: '/dashboard/settings', icon: Settings },
    ],
  },
];

const allSidebarItems = navSections.flatMap(s => s.items);

const INACTIVITY_LOGOUT_MS = 30 * 60 * 1000; // 30 minutes

const SEEN_ACTION_IDS_KEY = 'leads_notif_seen_action_ids';

function loadSeenActionIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(SEEN_ACTION_IDS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeenActionIds(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SEEN_ACTION_IDS_KEY, JSON.stringify(Array.from(ids)));
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<{ id: string; title: string; time: string; read: boolean; link: string; actionNeeded: boolean }[]>([]);
  // Ids of action-needed notifications the user has already had the dropdown
  // open for — distinct from the per-row `read` flag above. The badge count
  // is driven by this, not by `read`, specifically so it can never flash back
  // to 0 and jump again on a background poll: it only ever grows (a newly
  // appearing action item is unseen) and only ever shrinks by the user
  // actually opening the panel, never by a rebuild of the underlying list.
  const [seenActionIds, setSeenActionIds] = useState<Set<string>>(new Set());
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const notifRefMobile = useRef<HTMLDivElement>(null);

  // Desktop sidebar: collapses to an icon-only rail (persisted across
  // reloads) and temporarily flies out to full width on hover so labels
  // stay reachable without permanently giving up the reclaimed space.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarHovering, setIsSidebarHovering] = useState(false);
  const showSidebarLabels = !isSidebarCollapsed || isSidebarHovering;

  // Brief branded splash shown whenever navigation crosses into a different
  // top-level module (e.g. Tasks -> Events), not for sub-routes within the
  // same module (e.g. Events -> Events/[id]).
  const [isModuleTransitioning, setIsModuleTransitioning] = useState(false);
  const prevModuleRef = useRef<string | null>(null);

  // Super User-only quick account switch — jumps straight into any real member's
  // session without a password. originalUser is the Super User's own identity,
  // stashed only while impersonating so there's always a way back.
  const [isQuickSwitchOpen, setIsQuickSwitchOpen] = useState(false);
  const [quickSwitchSearch, setQuickSwitchSearch] = useState('');
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [originalUser, setOriginalUser] = useState<any>(null);
  const quickSwitchRef = useRef<HTMLDivElement>(null);
  const quickSwitchRefMobile = useRef<HTMLDivElement>(null);

  // Header user-menu dropdown (Settings / Sign Out), opened by clicking the
  // name/avatar in the desktop navbar.
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [user, setUser] = useState({
    name: '',
    email: '',
    role: 'Super User',
    tier: 1,
    division: 'Super User',
    department: undefined as string | undefined,
    committee: undefined as string | undefined,
    avatarUrl: undefined as string | undefined,
  });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [lockdownEnabled, setLockdownEnabled] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [isPromotionModalOpen, setIsPromotionModalOpen] = useState(false);
  const [promotionData, setPromotionData] = useState<PromotionData | null>(null);
  // Tracks the current user for the 'leads-data-sync' handler below, which is
  // registered once on mount and would otherwise only ever see this initial
  // (pre-login) placeholder user via a stale closure.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const buildNotifications = (currentUser: any) => {
    const proofreadNotifs = getDesigns()
      .filter(d => d.proofreadRequested && (
        d.assignedProofreaderEmail === currentUser.email ||
        (Array.isArray(d.assignedProofreaderIds) && d.assignedProofreaderIds.includes(currentUser.id)) ||
        (Array.isArray(d.assignedProofreaders) && d.assignedProofreaders.some((p: any) => p.email === currentUser.email || p.id === currentUser.id))
      ) && d.review?.status === 'Pending Proofread')
      .map(d => ({
        id: 'pf_' + d.id,
        title: `Proofreading Request: ${d.title}`,
        time: `From ${d.designerName}`,
        read: false,
        actionNeeded: true,
        link: `/dashboard/designs?highlight=${d.id}`,
      }));

    // FYI-only — recency windows, not real unread tracking, so these never
    // contribute to the badge count (only genuine decisions do).
    const recentAnnounce = getAnnouncements()
      .filter(a => getAnnouncementScopeMatch(a.scope, currentUser))
      .slice(0, 3)
      .map(a => ({
        id: a.id,
        title: `Announcement: ${a.title}`,
        time: a.publishedAt,
        read: false,
        actionNeeded: false,
        link: `/dashboard/announcements?highlight=${a.id}`,
      }));

    const recentTasks = getTasks()
      .filter(t => canViewTaskExtended(t, currentUser))
      .slice(0, 2)
      .map(t => ({
        id: t.id,
        title: `Task assigned: ${t.title}`,
        time: `Due ${t.dueDate}`,
        read: false,
        actionNeeded: false,
        link: `/dashboard/tasks?highlight=${t.id}`,
      }));

    // Budget requests awaiting this user's stage-1 (Centre Head) or stage-2
    // (Finance Head) action — mirrors the reimbursement notifications below.
    const budgetNotifs = getBudgets()
      .filter(b => b.status === 'Pending')
      .filter(b => (!b.centreHeadVerified && canVerifyBudgetCentreHead(currentUser)) || (b.centreHeadVerified && canDecideBudget(currentUser, b)))
      .map(b => ({
        id: 'bud_' + b.id,
        title: b.centreHeadVerified
          ? `Budget awaiting your approval: ${b.eventName || b.month || b.financialYear || 'Request'}`
          : `Budget awaiting your verification: ${b.eventName || b.month || b.financialYear || 'Request'}`,
        time: `From ${b.submittedBy}`,
        read: false,
        actionNeeded: true,
        link: `/dashboard/budget`,
      }));

    // Reimbursement claims awaiting this user's stage-1 or stage-2 action.
    const reimbursementNotifs = getReimbursements()
      .filter(r => {
        if (r.status === 'Pending') return canVerifyReimbursementCentreHead(currentUser) || canApproveAsSectorHead(currentUser);
        if (r.status === 'Verified by Centre Head' || r.status === 'Under Review') return canApproveAsFinanceHead(currentUser, r);
        return false;
      })
      .map(r => ({
        id: 'rem_' + r.id,
        title: `Reimbursement awaiting your review: ${r.memberName} — ₹${Number(r.amount).toLocaleString()}`,
        time: r.category,
        read: false,
        actionNeeded: true,
        link: `/dashboard/reimbursements`,
      }));

    // Event create/edit requests routed to this user for approval.
    const eventApprovalNotifs = getEvents()
      .filter(e => (e.approvalStatus === 'pending_create' || e.approvalStatus === 'pending_edit'))
      .filter(e => e.approverMemberId === currentUser.id || (e.approverType === 'CENTER_HEAD' && isCentreHead(currentUser)))
      .map(e => ({
        id: 'evt_' + e.id,
        title: `Event ${e.approvalStatus === 'pending_create' ? 'creation' : 'edit'} awaiting approval: ${e.title}`,
        time: `From ${e.submittedBy || 'a member'}`,
        read: false,
        actionNeeded: true,
        link: `/dashboard/events`,
      }));

    // Ad-hoc manual approval requests addressed directly to this user.
    const manualApprovalNotifs = getApprovalRequests()
      .filter(r => r.status === 'pending' && r.targetMemberId === currentUser.id)
      .map(r => ({
        id: 'apr_' + r.id,
        title: `Approval requested: ${r.entityTitle}`,
        time: `From ${r.requesterName}`,
        read: false,
        actionNeeded: true,
        link: `/dashboard/approvals`,
      }));

    // Notification for approvers when an approval decision is made by another person:
    // "once one person gives approval others like superuser and other people who can give approval get a notification saying approved by that person"
    const canUserGiveApproval =
      currentUser.tier === 1 ||
      isCentreHead(currentUser) ||
      isEventsHeadGgCampus(currentUser) ||
      currentUser.tier === 2 ||
      (currentUser.role && currentUser.role.toLowerCase().includes('advisor'));

    const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // last 7 days
    const approvedByOthersNotifs: any[] = [];

    // 1. From tracked approval requests
    getApprovalRequests()
      .filter(r => r.status === 'approved')
      .filter(r => {
        const t = r.decidedAt ? new Date(r.decidedAt).getTime() : 0;
        return t >= recentCutoff;
      })
      .forEach(r => {
        const isEligible = canUserGiveApproval || r.targetMemberId === currentUser.id;
        if (!isEligible) return;

        const decidedBy = r.decidedBy || (r.decisionNote?.match(/by\s+([^.]+)/i)?.[1]?.trim());
        if (!decidedBy) return;
        if (
          decidedBy.toLowerCase() === (currentUser.name || '').toLowerCase() ||
          decidedBy.toLowerCase() === (currentUser.email || '').toLowerCase()
        ) {
          return;
        }

        let link = '/dashboard/approvals';
        if (r.entityType === 'task') link = `/dashboard/tasks?highlight=${r.entityId}`;
        else if (r.entityType === 'event') link = `/dashboard/events`;
        else if (r.entityType === 'design') link = `/dashboard/designs?highlight=${r.entityId}`;
        else if (r.entityType === 'event-report') link = `/dashboard/event-reports?highlight=${r.entityId}`;

        approvedByOthersNotifs.push({
          id: 'appr_decided_' + r.id,
          title: `Approved by ${decidedBy}: ${r.entityTitle}`,
          time: r.decidedAt ? new Date(r.decidedAt).toLocaleDateString() : 'Recently',
          read: false,
          actionNeeded: false,
          link,
        });
      });

    // 2. From tasks approved directly
    getTasks()
      .filter(t => t.approvalStatus === 'approved' && t.decidedBy && t.decidedAt)
      .filter(t => new Date(t.decidedAt!).getTime() >= recentCutoff)
      .forEach(t => {
        const isEligible = canUserGiveApproval || (t.approverType === 'SPECIFIC_MEMBER' && t.approverMemberId === currentUser.id);
        if (!isEligible) return;
        if (
          t.decidedBy!.toLowerCase() === (currentUser.name || '').toLowerCase() ||
          t.decidedBy!.toLowerCase() === (currentUser.email || '').toLowerCase()
        ) {
          return;
        }
        if (approvedByOthersNotifs.some(n => n.id.includes(t.id))) return;

        approvedByOthersNotifs.push({
          id: 'task_approved_' + t.id,
          title: `Approved by ${t.decidedBy}: ${t.title}`,
          time: t.decidedAt ? new Date(t.decidedAt).toLocaleDateString() : 'Recently',
          read: false,
          actionNeeded: false,
          link: `/dashboard/tasks?highlight=${t.id}`,
        });
      });

    // 3. From events approved directly
    getEvents()
      .filter(e => e.approvalStatus === 'approved' && e.decidedBy && e.decidedAt)
      .filter(e => new Date(e.decidedAt!).getTime() >= recentCutoff)
      .forEach(e => {
        if (!canUserGiveApproval) return;
        if (
          e.decidedBy!.toLowerCase() === (currentUser.name || '').toLowerCase() ||
          e.decidedBy!.toLowerCase() === (currentUser.email || '').toLowerCase()
        ) {
          return;
        }
        if (approvedByOthersNotifs.some(n => n.id.includes(e.id))) return;

        approvedByOthersNotifs.push({
          id: 'event_approved_' + e.id,
          title: `Approved by ${e.decidedBy}: ${e.title}`,
          time: e.decidedAt ? new Date(e.decidedAt).toLocaleDateString() : 'Recently',
          read: false,
          actionNeeded: false,
          link: `/dashboard/events`,
        });
      });

    // 4. From event reports approved directly
    getEventReports()
      .filter(er => er.status === 'approved' && (er.centreHeadApprovedBy || er.eventsHeadGgApprovedBy))
      .filter(er => {
        const d = er.centreHeadApprovedAt || er.eventsHeadGgApprovedAt;
        return d ? new Date(d).getTime() >= recentCutoff : false;
      })
      .forEach(er => {
        if (!canUserGiveApproval) return;
        const approverName = er.centreHeadApprovedBy || er.eventsHeadGgApprovedBy || 'Approver';
        if (
          approverName.toLowerCase() === (currentUser.name || '').toLowerCase() ||
          approverName.toLowerCase() === (currentUser.email || '').toLowerCase()
        ) {
          return;
        }
        if (approvedByOthersNotifs.some(n => n.id.includes(er.id))) return;

        const at = er.centreHeadApprovedAt || er.eventsHeadGgApprovedAt;
        approvedByOthersNotifs.push({
          id: 'report_approved_' + er.id,
          title: `Approved by ${approverName}: ${er.eventTitle}`,
          time: at ? new Date(at).toLocaleDateString() : 'Recently',
          read: false,
          actionNeeded: false,
          link: `/dashboard/event-reports?highlight=${er.id}`,
        });
      });

    const dismissed = loadDismissedNotifIds();
    return [...budgetNotifs, ...reimbursementNotifs, ...eventApprovalNotifs, ...manualApprovalNotifs, ...approvedByOthersNotifs, ...proofreadNotifs, ...recentAnnounce, ...recentTasks]
      .filter(n => !dismissed.has(n.id));
  };

  const loadDismissedNotifIds = (): Set<string> => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('leads_dismissed_notif_ids') : null;
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  };

  const saveDismissedNotifIds = (ids: Set<string>) => {
    try {
      localStorage.setItem('leads_dismissed_notif_ids', JSON.stringify(Array.from(ids)));
    } catch {}
  };

  const [dismissedNotifIds, setDismissedNotifIds] = useState<Set<string>>(new Set());

  // Initialize theme, user session, notifications, and server sync
  useEffect(() => {
    setDismissedNotifIds(loadDismissedNotifIds());
    const theme = localStorage.getItem('theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (theme === 'dark' || (!theme && systemDark)) {
      setIsDarkTheme(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDarkTheme(false);
      document.documentElement.classList.remove('dark');
    }

    setIsSidebarCollapsed(localStorage.getItem('sidebarCollapsed') === 'true');

    // Public Pass Redirection: If an attendee/guest visits a legacy link (e.g. /dashboard/events?pass=XYZ),
    // redirect them directly to the public pass page (/pass/XYZ) without requiring login.
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const passSerial = searchParams.get('pass') || searchParams.get('passId') || searchParams.get('serial');
      if (passSerial) {
        router.replace(`/pass/${encodeURIComponent(passSerial)}`);
        return;
      }
    }

    const savedUser = localStorage.getItem('user');
    const token = getSessionToken();
    if (!savedUser || !token) {
      // Route guard: Save intended target URL so user returns to clicked link after login
      if (typeof window !== 'undefined') {
        const fullPath = window.location.pathname + window.location.search + window.location.hash;
        if (fullPath && fullPath !== '/' && fullPath !== '/dashboard/home') {
          sessionStorage.setItem('redirect_after_login', fullPath);
        }
      }
      signOutClient();
      router.replace('/');
      return;
    }

    try {
      const parsedUser = JSON.parse(savedUser);
      setUser(parsedUser);
      setIsAuthenticated(true);
      setAllMembers(getMembers());
      setLockdownEnabled(getSystemSettings().lockdownEnabled);

      const stashedOriginal = localStorage.getItem('impersonatorOriginalUser');
      if (stashedOriginal) {
        try {
          setOriginalUser(JSON.parse(stashedOriginal));
          setIsImpersonating(true);
        } catch (e) {
          console.error('Failed to parse stashed impersonator identity:', e);
        }
      }

      // Initial sync: pull server state into localStorage immediately
      syncWithServer();

      // Poll every 7 seconds so changes from other devices appear automatically
      const pollInterval = setInterval(() => {
        if (document.visibilityState === 'hidden') return; // resume handlers below resync on return
        syncWithServer().catch(() => {}); // silent — offline is OK
      }, 7000);

      // Mobile browsers (iOS Safari especially) freeze timers while the tab is
      // backgrounded or the phone is locked, and can restore a page from the
      // back/forward cache without re-running anything — so the 7s poll alone
      // leaves stale data on screen after resuming. Re-sync immediately on any
      // resume signal.
      const resync = () => { syncWithServer().catch(() => {}); };
      const onVisibility = () => { if (document.visibilityState === 'visible') resync(); };
      const onPageShow = () => resync();
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('focus', resync);
      window.addEventListener('pageshow', onPageShow);
      window.addEventListener('online', resync);

      // Load dynamic notifications from recent announcements, tasks, and proofread requests
      setNotifications(buildNotifications(parsedUser));
      setSeenActionIds(loadSeenActionIds());

      // Auto-launch role-tailored Onboarding Tour ONLY on first-time initial account setup ever
      const isInitialSetup = parsedUser.isFirstLogin === true || (parsedUser as any).isNewAccount === true;
      const hasCompletedTour =
        (parsedUser.id && localStorage.getItem(`leads_tour_completed_${parsedUser.id}`)) ||
        (parsedUser.email && localStorage.getItem(`leads_tour_completed_${parsedUser.email}`)) ||
        (parsedUser.name && localStorage.getItem(`leads_tour_completed_${parsedUser.name}`)) ||
        (parsedUser.email && localStorage.getItem(`leads_has_logged_in_${parsedUser.email}`));

      const isImpersonatingSession = typeof window !== 'undefined' && sessionStorage.getItem('impersonator_original_user');

      if (isInitialSetup && !hasCompletedTour && !isImpersonatingSession) {
        setTimeout(() => setIsTourOpen(true), 800);
      }

      // Mark that account has logged in so tutorial is not auto-shown repeatedly
      if (parsedUser.email) {
        localStorage.setItem(`leads_has_logged_in_${parsedUser.email}`, 'true');
        if (parsedUser.id) localStorage.setItem(`leads_has_logged_in_${parsedUser.id}`, 'true');
      }

      // Detect Promotion / Role Elevation on session load
      const userKey = parsedUser.email || parsedUser.id || parsedUser.name;
      const storedLastTier = localStorage.getItem(`leads_seen_tier_${userKey}`);
      const storedLastRole = localStorage.getItem(`leads_seen_role_${userKey}`);

      if (storedLastTier !== null && storedLastRole !== null) {
        // parseFloat, not parseInt — tiers can be fractional (2.5 = GG Campus
        // Head). parseInt("2.5", 10) truncates to 2, which made this
        // permanently misread a stored "2.5" back as "2" on every later
        // login, re-triggering the demotion notice forever instead of once.
        const lastTierNum = parseFloat(storedLastTier);
        // In RTBI Portal, lower tier number indicates higher rank (Tier 1 = Super User, Tier 2 = Leadership, Tier 3 = Core)
        const isTierElevated = !isNaN(lastTierNum) && parsedUser.tier < lastTierNum;
        const isTierDemoted = !isNaN(lastTierNum) && parsedUser.tier > lastTierNum;
        const isRolePromoted = isTierElevated || (storedLastRole !== (parsedUser.role || '') && parsedUser.tier <= lastTierNum);

        if ((isRolePromoted || isTierDemoted) && !isImpersonatingSession) {
          setPromotionData({
            previousTier: lastTierNum,
            previousRole: storedLastRole,
            newTier: parsedUser.tier,
            newRole: parsedUser.role || 'Elevated Member',
            newDivision: parsedUser.division,
            changeType: isTierDemoted ? 'demotion' : 'promotion',
          });
          setTimeout(() => setIsPromotionModalOpen(true), 600);
        }
      }

      // Record baseline seen role & tier
      localStorage.setItem(`leads_seen_tier_${userKey}`, String(parsedUser.tier));
      localStorage.setItem(`leads_seen_role_${userKey}`, parsedUser.role || '');

      return () => {
        clearInterval(pollInterval);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('focus', resync);
        window.removeEventListener('pageshow', onPageShow);
        window.removeEventListener('online', resync);
      };
    } catch (e) {
      console.error('Failed to parse user session:', e);
      router.replace('/');
    }

  }, [router]);

  // The server dropped this session (an admin required a password reset, the account was signed out elsewhere...):
  // clear the stale login and go back to the login page.
  useEffect(() => {
    const onExpired = () => {
      signOutClient();
      localStorage.setItem('logoutReason', 'session_expired');
      router.replace('/');
    };
    window.addEventListener('leads-session-expired', onExpired);
    return () => window.removeEventListener('leads-session-expired', onExpired);
  }, [router]);

  // Re-check the lockdown flag and rebuild notifications every time a server
  // sync lands (initial load, the 7-second poll, or another tab's write) — the
  // notification list used to be computed once at mount, before that first
  // sync had a chance to resolve, so anything assigned/published right before
  // (or shortly after) login never appeared until a full remount. Existing
  // read flags are preserved by id across the rebuild.
  useEffect(() => {
    const handleSync = () => {
      setLockdownEnabled(getSystemSettings().lockdownEnabled);
      setAllMembers(getMembers());
      const currentUser = userRef.current;
      if (!currentUser?.email) return;

      // Security: a member terminated while actively logged in gets kicked
      // out on the next poll (within ~7s) rather than staying signed in
      // until their session naturally expires or they navigate somewhere
      // that re-checks status.
      const liveRecord = getMembers().find(m =>
        ((currentUser as any).id && m.id === (currentUser as any).id) ||
        (currentUser.email && m.email.toLowerCase() === currentUser.email.toLowerCase())
      );
      if (liveRecord) {
        if (liveRecord.status === 'Terminated') {
          logAuditEvent('SESSION_TERMINATED_LOGOUT', currentUser.name || 'User', 'Force-logged out — account was terminated while session was active', currentUser.email);
          signOutClient();
          localStorage.setItem('logoutReason', 'terminated');
          router.replace('/');
          return;
        }

        const hasProfileChanges =
          liveRecord.name !== currentUser.name ||
          liveRecord.email !== currentUser.email ||
          liveRecord.role !== currentUser.role ||
          liveRecord.tier !== currentUser.tier ||
          liveRecord.division !== currentUser.division ||
          liveRecord.department !== currentUser.department ||
          (liveRecord as any).program !== (currentUser as any).program ||
          (liveRecord as any).batch !== (currentUser as any).batch ||
          liveRecord.avatarUrl !== currentUser.avatarUrl ||
          liveRecord.dateOfBirth !== (currentUser as any).dateOfBirth ||
          liveRecord.bankName !== (currentUser as any).bankName ||
          liveRecord.accountNumber !== (currentUser as any).accountNumber ||
          liveRecord.ifscCode !== (currentUser as any).ifscCode;

        if (hasProfileChanges) {
          const userKey = liveRecord.email || liveRecord.id || liveRecord.name;
          const storedLastTier = localStorage.getItem(`leads_seen_tier_${userKey}`);
          const storedLastRole = localStorage.getItem(`leads_seen_role_${userKey}`);

          if (storedLastTier !== null && storedLastRole !== null) {
            // parseFloat — see the matching fix/comment on the login-time
            // check above; tiers can be fractional (2.5 = GG Campus Head).
            const lastTierNum = parseFloat(storedLastTier);
            const isTierElevated = !isNaN(lastTierNum) && liveRecord.tier < lastTierNum;
            const isTierDemoted = !isNaN(lastTierNum) && liveRecord.tier > lastTierNum;
            const isRolePromoted = isTierElevated || (storedLastRole !== (liveRecord.role || '') && liveRecord.tier <= lastTierNum);

            if (isRolePromoted || isTierDemoted) {
              setPromotionData({
                previousTier: lastTierNum,
                previousRole: storedLastRole,
                newTier: liveRecord.tier,
                newRole: liveRecord.role || 'Elevated Member',
                newDivision: liveRecord.division,
                changeType: isTierDemoted ? 'demotion' : 'promotion',
              });
              setIsPromotionModalOpen(true);
            }
          }

          localStorage.setItem(`leads_seen_tier_${userKey}`, String(liveRecord.tier));
          localStorage.setItem(`leads_seen_role_${userKey}`, liveRecord.role || '');

          const updatedSessionUser = {
            ...currentUser,
            id: liveRecord.id,
            name: liveRecord.name,
            email: liveRecord.email,
            role: liveRecord.role,
            tier: liveRecord.tier,
            division: liveRecord.division,
            department: liveRecord.department,
            program: (liveRecord as any).program,
            batch: (liveRecord as any).batch,
            avatarUrl: liveRecord.avatarUrl,
            dateOfBirth: liveRecord.dateOfBirth,
            bankName: liveRecord.bankName,
            accountNumber: liveRecord.accountNumber,
            ifscCode: liveRecord.ifscCode,
          };
          delete (updatedSessionUser as any).passwordHash;
          setUser(updatedSessionUser);
          localStorage.setItem('user', JSON.stringify(updatedSessionUser));
        }
      }

      setNotifications(prev => {
        const readIds = new Set(prev.filter(n => n.read).map(n => n.id));
        const rebuilt = buildNotifications(currentUser);

        // Prune seenActionIds down to only ids still present as action-needed
        // — bounds its storage size and lets an id become "new" again if the
        // same underlying record somehow reappears as actionable later.
        setSeenActionIds(prevSeen => {
          const stillActionable = new Set(rebuilt.filter(n => n.actionNeeded).map(n => n.id));
          const pruned = new Set([...prevSeen].filter(id => stillActionable.has(id)));
          if (pruned.size !== prevSeen.size) saveSeenActionIds(pruned);
          return pruned.size !== prevSeen.size ? pruned : prevSeen;
        });

        return rebuilt.map(n => readIds.has(n.id) ? { ...n, read: true } : n);
      });
    };
    window.addEventListener('leads-data-sync', handleSync);
    return () => window.removeEventListener('leads-data-sync', handleSync);
  }, [router]);

  // Click outside to close dropdowns. The notification bell renders twice (desktop
  // header + mobile header, only one visible at a time via CSS), so both refs must
  // miss the click before the dropdown closes.
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const insideDesktopBell = notifRef.current?.contains(target);
      const insideMobileBell = notifRefMobile.current?.contains(target);
      if (!insideDesktopBell && !insideMobileBell) {
        setIsNotificationsOpen(false);
      }
      const insideDesktopQuickSwitch = quickSwitchRef.current?.contains(target);
      const insideMobileQuickSwitch = quickSwitchRefMobile.current?.contains(target);
      if (!insideDesktopQuickSwitch && !insideMobileQuickSwitch) {
        setIsQuickSwitchOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const currentModule = pathname.split('/')[2] || 'home';
    if (prevModuleRef.current === null) {
      // Skip on first mount — the login page already showed its own splash
      // for this transition into the dashboard.
      prevModuleRef.current = currentModule;
      return;
    }
    if (prevModuleRef.current !== currentModule) {
      prevModuleRef.current = currentModule;
      setIsModuleTransitioning(true);
    }
  }, [pathname]);

  // Security: auto-logout after 30 minutes with no mouse/keyboard/touch/scroll
  // activity, so a session left open on a shared or unattended machine doesn't
  // stay signed in indefinitely. Any of those events resets the timer.
  useEffect(() => {
    if (!isAuthenticated) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const doAutoLogout = () => {
      const currentUser = localStorage.getItem('user');
      if (currentUser) {
        try {
          const parsed = JSON.parse(currentUser);
          logAuditEvent('SESSION_AUTO_LOGOUT', parsed.name || 'User', 'Automatically logged out after 30 minutes of inactivity', parsed.email);
        } catch (e) {
          console.error(e);
        }
      }
      signOutClient();
      localStorage.setItem('logoutReason', 'inactivity');
      router.replace('/');
    };

    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(doAutoLogout, INACTIVITY_LOGOUT_MS);
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(evt => window.addEventListener(evt, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timeoutId);
      activityEvents.forEach(evt => window.removeEventListener(evt, resetTimer));
    };
  }, [isAuthenticated, router]);

  // Super User only: jump straight into any real member's session, no password.
  // The Super User's own identity is stashed so "Return to my account" always works,
  // even across a chain of switches (only ever stashes the ORIGINAL identity once).
  const canQuickSwitch = isImpersonating ? originalUser?.tier === 1 : user.tier === 1;

  const handleQuickSwitch = async (target: Member) => {
    const realIdentity = isImpersonating ? originalUser : user;
    const realToken = localStorage.getItem('impersonatorOriginalToken') || getSessionToken();
    try {
      const res = await fetch('/api/auth/impersonate', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ targetMemberId: target.id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          if (!isImpersonating && realToken) {
            localStorage.setItem('impersonatorOriginalToken', realToken);
          }
          setSessionToken(data.token);
        }
      }
    } catch (e) {
      console.warn('Impersonate token request failed:', e);
    }
    localStorage.setItem('impersonatorOriginalUser', JSON.stringify(realIdentity));
    localStorage.setItem('user', JSON.stringify(target));
    logAuditEvent(
      'ADMIN_QUICK_SWITCH',
      realIdentity.name,
      `Quick-switched into ${target.name} (${target.email}) without a password`,
      realIdentity.email
    );
    setIsQuickSwitchOpen(false);
    setQuickSwitchSearch('');
    window.location.reload();
  };

  const handleReturnToSelf = () => {
    if (!originalUser) return;
    const origToken = localStorage.getItem('impersonatorOriginalToken');
    if (origToken) {
      setSessionToken(origToken);
      localStorage.removeItem('impersonatorOriginalToken');
    }
    localStorage.setItem('user', JSON.stringify(originalUser));
    localStorage.removeItem('impersonatorOriginalUser');
    logAuditEvent(
      'ADMIN_QUICK_SWITCH_RETURN',
      originalUser.name,
      'Returned to own account from a quick-switch session',
      originalUser.email
    );
    window.location.reload();
  };

  const quickSwitchResults = allMembers.filter(m => {
    const q = quickSwitchSearch.toLowerCase();
    return !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.role.toLowerCase().includes(q);
  });

  const toggleSidebarCollapsed = () => {
    const next = !isSidebarCollapsed;
    setIsSidebarCollapsed(next);
    localStorage.setItem('sidebarCollapsed', String(next));
  };

  // MagicBento Global Dynamic Cursor Tracker for all module cards and boxes
  useEffect(() => {
    let frame = 0;
    let lastX = 0;
    let lastY = 0;
    let lit = new Set<HTMLElement>();
    const update = () => {
      frame = 0;
      const cards = document.querySelectorAll<HTMLElement>(
        '.glass-panel:not(header):not(aside):not(.no-magic), .magic-bento-card, .dashboard-card'
      );
      const next = new Set<HTMLElement>();
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        if (lastX >= rect.left && lastX <= rect.right && lastY >= rect.top && lastY <= rect.bottom) {
          next.add(card);
          card.style.setProperty('--glow-x', `${((lastX - rect.left) / rect.width) * 100}%`);
          card.style.setProperty('--glow-y', `${((lastY - rect.top) / rect.height) * 100}%`);
          if (!lit.has(card)) card.style.setProperty('--glow-intensity', '1');
        }
      });
      lit.forEach((card) => {
        if (!next.has(card)) card.style.setProperty('--glow-intensity', '0');
      });
      lit = next;
    };
    // At most one layout pass per frame instead of one per mouse event.
    const handleMouseMove = (e: MouseEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!frame) frame = requestAnimationFrame(update);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);

  const toggleTheme = () => {
    const newTheme = !isDarkTheme;
    setIsDarkTheme(newTheme);
    if (newTheme) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  // Match active item using longest prefix match for detail sub-routes
  const activeItem = allSidebarItems
    .filter(item => pathname === item.href || pathname.startsWith(item.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0] || allSidebarItems[0];

  const handleLogout = () => {
    signOutClient();
    router.replace('/');
  };

  // Marks every currently-actionable notification as seen — this is the one
  // and only way the badge count clears, and it fires the instant the panel
  // opens rather than waiting for an explicit "Mark all read" click.
  const markActionNotifsSeen = () => {
    setSeenActionIds(prev => {
      const actionableIds = notifications.filter(n => n.actionNeeded).map(n => n.id);
      if (actionableIds.every(id => prev.has(id))) return prev;
      const next = new Set(prev);
      actionableIds.forEach(id => next.add(id));
      saveSeenActionIds(next);
      return next;
    });
  };

  const handleToggleNotifications = () => {
    setIsNotificationsOpen(open => {
      if (!open) markActionNotifsSeen();
      return !open;
    });
  };

  const markAllNotificationsAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    markActionNotifsSeen();
  };

  const clearAllNotifications = () => {
    const currentIds = notifications.map(n => n.id);
    const next = new Set(dismissedNotifIds);
    currentIds.forEach(id => next.add(id));
    setDismissedNotifIds(next);
    saveDismissedNotifIds(next);
    setNotifications([]);
  };

  const handleDismissNotification = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(dismissedNotifIds);
    next.add(id);
    setDismissedNotifIds(next);
    saveDismissedNotifIds(next);
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleNotifClick = (notif: { id: string; link: string }) => {
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
    setIsNotificationsOpen(false);
    setIsMobileMenuOpen(false);
    router.push(notif.link);
  };

  // Badge only counts items that need a decision (proofread/budget/reimbursement/
  // event approvals) — recent announcements and tasks stay in the list below for
  // visibility but never inflate this number. A dot at 1, a number from 2-99, and
  // a 99+ cap above that, so the badge's own shape never destabilizes the bell.
  const unseenActionNotifs = notifications.filter(n => n.actionNeeded && !seenActionIds.has(n.id));
  const unseenActionCount = unseenActionNotifs.length;

  // Rendered twice — once in the desktop navbar, once in the mobile header — since
  // only one is ever visible at a time (the other's ancestor is `hidden` via CSS),
  // this keeps the bell available on phones without duplicating ~50 lines of JSX.
  const renderNotificationBell = (wrapperRef: React.RefObject<HTMLDivElement | null>) => (
    <div className="relative inline-flex items-center justify-center shrink-0" ref={wrapperRef}>
      <button
        onClick={handleToggleNotifications}
        className="h-9 w-9 flex items-center justify-center text-theme-text-secondary hover:text-theme-text-primary rounded-xl hover:bg-theme-border/20 transition-all cursor-pointer relative shrink-0"
        title="Notifications"
      >
        <Bell className="h-4.5 w-4.5" />
        {unseenActionCount > 0 && (
          unseenActionCount === 1 ? (
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-danger rounded-full ring-2 ring-theme-sidebar" />
          ) : (
            <span className="absolute -top-1.5 -right-1.5 h-[18px] min-w-[18px] px-1 flex items-center justify-center rounded-full bg-danger text-white text-[9px] font-bold leading-none ring-2 ring-theme-sidebar">
              {unseenActionCount > 99 ? '99+' : unseenActionCount}
            </span>
          )
        )}
      </button>

      {isNotificationsOpen && (
        <>
          {/* Mobile backdrop dim overlay */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setIsNotificationsOpen(false)}
          />

          {/* Floating Dropdown Popover */}
          <div className="fixed md:absolute top-16 md:top-full right-3 md:right-0 left-3 md:left-auto mt-0 md:mt-2 w-[calc(100vw-24px)] md:w-96 glass-panel rounded-3xl p-4 shadow-2xl border border-white/20 z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-2xl bg-white/95 dark:bg-[#0B1B2E]/95 text-theme-text-primary">
            <div className="flex items-center justify-between pb-2.5 border-b border-theme-border/30 gap-2">
              <div className="flex items-center gap-1.5">
                <h4 className="text-xs font-bold text-theme-text-primary">Notifications</h4>
                {notifications.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-theme-text-secondary font-mono">
                    {notifications.length}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {notifications.some(n => !n.read) && (
                  <button
                    onClick={markAllNotificationsAsRead}
                    className="text-[10px] text-accent hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                    title="Mark all notifications as read"
                  >
                    <Check className="h-3 w-3" />
                    Mark read
                  </button>
                )}

                {notifications.length > 0 && (
                  <button
                    onClick={clearAllNotifications}
                    className="text-[10px] text-danger hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                    title="Clear all received notifications"
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear all
                  </button>
                )}
              </div>
            </div>

            <div className="divide-y divide-theme-border/20 max-h-64 overflow-y-auto pt-1 space-y-1">
              {notifications.length === 0 ? (
                <div className="text-center py-6 text-theme-text-secondary text-xs">
                  No notifications at this time.
                </div>
              ) : (
                notifications.map(notif => (
                  <div
                    key={notif.id}
                    className={`group relative flex items-start justify-between gap-2 p-2.5 rounded-xl text-xs transition-all hover:bg-accent/10 ${notif.read ? 'opacity-60' : 'bg-accent/5'}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleNotifClick(notif)}
                      className="flex-1 text-left flex items-start gap-2.5 cursor-pointer min-w-0"
                    >
                      <Info className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${notif.actionNeeded ? 'text-danger' : 'text-accent'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-theme-text-primary text-xs leading-snug">{notif.title}</p>
                        <p className="text-[10px] text-theme-text-secondary mt-0.5">{notif.time}</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleDismissNotification(notif.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-theme-text-secondary hover:text-danger hover:bg-danger/10 rounded-lg transition-all cursor-pointer shrink-0"
                      title="Clear this notification"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );

  // Rendered twice — once in the desktop navbar, once in the mobile menu —
  // mirroring renderNotificationBell above, so Super User quick-switch is
  // reachable on mobile instead of only existing in the desktop header.
  // Anchored with an explicit top-full (instead of relying on the browser's
  // static-position fallback for an unset `top`) so it never drifts above
  // the trigger button when the header row wraps at tablet widths.
  const renderQuickSwitch = (wrapperRef: React.RefObject<HTMLDivElement | null>) => (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => {
          setAllMembers(getMembers());
          setIsQuickSwitchOpen(!isQuickSwitchOpen);
        }}
        className="h-9 w-9 flex items-center justify-center text-theme-text-secondary hover:text-theme-text-primary rounded-xl hover:bg-theme-border/20 transition-all cursor-pointer"
        title="Quick Switch: view as any account (Super User only)"
      >
        <UserCog className="h-4.5 w-4.5" />
      </button>

      {isQuickSwitchOpen && (
        <div className="absolute right-0 top-full mt-3 w-88 md:w-96 max-w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col glass-panel rounded-3xl p-3.5 shadow-2xl border border-white/20 z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-2xl bg-space-theme/95">
          {/* ListBox Header */}
          <div className="flex items-center justify-between px-1.5 pt-1 pb-2.5 border-b border-theme-border/40 mb-2.5">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-xl bg-accent/20 text-accent">
                <UserCog className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-theme-text-primary flex items-center gap-1.5">
                  Account Switcher
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-accent bg-accent/15 px-1.5 py-0.2 rounded-full border border-accent/20">
                    Super User
                  </span>
                </h4>
                <p className="text-[10px] text-theme-text-secondary">
                  Instantly switch view & permissions
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsQuickSwitchOpen(false)}
              className="text-theme-text-secondary hover:text-theme-text-primary p-1 rounded-lg hover:bg-white/10 transition-all cursor-pointer text-xs"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Search Input Box */}
          <div className="relative mb-2.5">
            <div className="flex items-center gap-2 px-3 py-2 bg-theme-background/50 border border-theme-border/50 rounded-xl focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30 transition-all">
              <Search className="h-3.5 w-3.5 text-theme-text-secondary shrink-0" />
              <input
                type="text"
                autoFocus
                value={quickSwitchSearch}
                onChange={(e) => setQuickSwitchSearch(e.target.value)}
                placeholder="Search by name, email, or role..."
                className="w-full bg-transparent border-0 focus:outline-none text-xs text-theme-text-primary placeholder-theme-text-secondary"
              />
              {quickSwitchSearch && (
                <button
                  onClick={() => setQuickSwitchSearch('')}
                  className="text-theme-text-secondary hover:text-theme-text-primary text-[10px] p-0.5 rounded cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Return to self banner if impersonating */}
          {isImpersonating && originalUser && (
            <div className="mb-2.5 p-2.5 rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Undo2 className="h-3.5 w-3.5 text-accent shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-theme-text-primary truncate">Currently Impersonating</p>
                  <p className="text-[10px] text-theme-text-secondary truncate">Original: {originalUser.name}</p>
                </div>
              </div>
              <button
                onClick={handleReturnToSelf}
                className="px-2.5 py-1 bg-accent text-white rounded-lg text-[10px] font-bold hover:bg-primary-light transition-all shrink-0 cursor-pointer shadow-sm"
              >
                Return
              </button>
            </div>
          )}

          {/* HeroUI ListBox Items */}
          <div className="max-h-64 flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
            {quickSwitchResults.length === 0 ? (
              <div className="text-center py-8 text-theme-text-secondary space-y-1">
                <p className="text-xs font-semibold">No matching members found</p>
                <p className="text-[10px]">Try searching by name, role, or division</p>
              </div>
            ) : (
              quickSwitchResults.map(m => {
                const isSelected = m.email.toLowerCase() === user.email.toLowerCase();

                return (
                  <button
                    key={m.id}
                    onClick={() => handleQuickSwitch(m)}
                    className={`w-full group flex items-center justify-between p-2.5 rounded-2xl transition-all duration-150 cursor-pointer text-left border ${
                      isSelected
                        ? 'bg-accent/15 border-accent/40 shadow-sm shadow-accent/10'
                        : 'bg-theme-background/30 border-transparent hover:bg-white/10 dark:hover:bg-white/5 hover:border-theme-border/50'
                    }`}
                  >
                    {/* Left: Avatar + Label & Description */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <Avatar
                          size="sm"
                          src={m.avatarUrl}
                          name={m.name}
                          color={isSelected ? 'accent' : 'default'}
                          className="rounded-xl shadow-sm"
                        />
                        {isSelected && (
                          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-theme-background z-10" />
                        )}
                      </div>

                      {/* Label + Description */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-theme-text-primary group-hover:text-accent transition-colors truncate">
                            {m.name}
                          </span>
                          {isSelected && (
                            <span className="text-[9px] font-semibold text-accent bg-accent/10 px-1.5 py-0.2 rounded-md border border-accent/20 shrink-0">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-theme-text-secondary mt-0.5 truncate">
                          <span className="truncate">{m.email}</span>
                          <span className="shrink-0">•</span>
                          <span className="font-medium text-theme-text-secondary/80 shrink-0">{m.role}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Item Indicator */}
                    <div className="shrink-0 ml-2">
                      {isSelected ? (
                        <div className="h-6 w-6 rounded-full bg-accent text-white flex items-center justify-center shadow-sm">
                          <Check className="h-3.5 w-3.5" />
                        </div>
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-transparent flex items-center justify-center opacity-0 group-hover:opacity-100 group-hover:bg-white/10 transition-all text-theme-text-secondary group-hover:text-theme-text-primary">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* ListBox Footer Info */}
          <div className="pt-2 mt-2 border-t border-theme-border/30 flex items-center justify-between text-[10px] text-theme-text-secondary px-1 shrink-0">
            <span>{allMembers.length} Available {allMembers.length === 1 ? 'Account' : 'Accounts'}</span>
            <span className="text-[9px] opacity-75">Click to switch</span>
          </div>
        </div>
      )}
    </div>
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-space-theme flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    );
  }

  // Site-wide lockdown: everyone except the real Super User (tier 1) sees a
  // plain 404 instead of the dashboard. Applies during impersonation too —
  // if the Super User is viewing the app as someone else, they see what that
  // person would see.
  if (lockdownEnabled && user.tier !== 1) {
    return <NotFoundScreen />;
  }

  return (
    <div className="min-h-screen bg-space-theme flex flex-col md:flex-row transition-all duration-300 relative z-0">
      {/* Background Animated GhostFibers WebGL Canvas.
          -z-10 on the canvas (not z-0): z-0 on the CANVAS itself would create
          a positioned stacking context that paints AFTER normal non-positioned
          in-flow content (CSS stacking order groups positioned z-index:0 boxes
          above plain in-flow boxes, regardless of DOM order) — that's what was
          washing out every bare page heading/subtitle that isn't inside a
          .glass-panel card (cards escaped it because backdrop-filter gives
          them their own stacking context). A negative z-index guarantees this
          canvas paints strictly behind ALL normal content, everywhere.
          The OUTER wrapper here also needs its own explicit z-0 (not just
          `relative`, which alone never creates a stacking context) — without
          it, this div's own opaque bg-space-theme background paints in the
          root stacking context's normal-flow layer, which comes AFTER the
          canvas's negative-z-index layer there, hiding the canvas completely
          behind a flat color. With z-0 here, this div becomes its own
          stacking-context root: its background paints first/backmost inside
          THAT context, the canvas paints just above it, and everything else
          still paints above the canvas exactly as before. */}
      {/* Background Animated AeroShards / GhostFibers WebGL/WebGPU Canvas */}
      <div className="fixed inset-0 pointer-events-none -z-10 opacity-50 dark:opacity-90 transition-opacity duration-500 overflow-hidden">
        <AeroShardsBackground
          isDark={isDarkTheme}
          shardColor="#361C6A"
          accentColor="#E34A21"
          placement="full"
          material="glass"
          markers="plus"
          count={1250}
          depthOfField={0.75}
          vignette={0.3}
          mouseInteraction
          pulseOnClick
          holdToGather
          spread={2}
          speed={2.56}
        />
      </div>

      {isModuleTransitioning && (
        <LoadingScreen
          duration={500}
          subtitle="Loading module..."
          onComplete={() => setIsModuleTransitioning(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      {/* min-h-screen (not h-screen) so it stretches to match the main column's
          real height on pages tall enough to exceed one viewport (common at
          tablet widths, where cards/tables reflow into more rows) — h-screen
          hard-capped it at exactly 100vh, leaving a gap at the bottom. */}
      <aside className={`hidden md:block relative shrink-0 min-h-screen sticky top-0 z-40 transition-[width] duration-200 ${isSidebarCollapsed ? 'w-20' : 'w-64'}`}>
        <div
          onMouseEnter={() => { if (isSidebarCollapsed) setIsSidebarHovering(true); }}
          onMouseLeave={() => setIsSidebarHovering(false)}
          className={`absolute inset-y-0 left-0 flex flex-col glass-panel bg-theme-sidebar/95 border-r border-theme-sidebar-border overflow-hidden transition-[width] duration-200 ${
            showSidebarLabels ? 'w-64' : 'w-20'
          } ${isSidebarCollapsed && isSidebarHovering ? 'shadow-2xl' : ''}`}
        >
          {/* Brand Logo Link to Dashboard Home */}
          <Link
            href="/dashboard/home"
            title="RTBI Portal"
            className={`flex items-center gap-3 p-4 border-b border-theme-border/40 hover:bg-theme-border/10 transition-colors cursor-pointer select-none ${
              showSidebarLabels ? 'px-4' : 'justify-center px-0'
            }`}
          >
            <div className="h-9 w-9 flex items-center justify-center shrink-0">
              <img
                src="/images/rtbi-icon.png"
                alt="RTBI Logo"
                className="h-full w-full object-contain filter drop-shadow-[0_2px_8px_rgba(54,28,106,0.3)]"
              />
            </div>
            {showSidebarLabels && (
              <div className="flex flex-col">
                <span className="font-extrabold text-xs tracking-wider uppercase text-theme-text-primary">
                  RTBI PORTAL
                </span>
                <span className="text-[10px] text-theme-text-secondary font-medium">
                  Ramaiah Incubator
                </span>
              </div>
            )}
          </Link>

          {/* Navigation Links */}
          <nav className="flex-1 overflow-y-auto p-3 space-y-6">
            {navSections.map((section) => (
              <div key={section.title} className="space-y-1">
                {showSidebarLabels && (
                  <h4 className="px-3 text-[10px] font-bold text-theme-text-secondary uppercase tracking-wider mb-2">
                    {section.title}
                  </h4>
                )}
                <div className="space-y-1">
                  {section.items.filter(item => (!item.superUserOnly || user.tier === 1) && (!item.staffOnly || user.tier <= 3) && (!item.groupPoliciesOnly || canAccessGroupPolicies(user))).map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        title={showSidebarLabels ? undefined : item.name}
                        className={`flex items-center gap-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 whitespace-nowrap ${showSidebarLabels ? 'px-3.5' : 'justify-center px-0'} ${
                          isActive
                            ? 'bg-accent text-white shadow-md shadow-accent/20'
                            : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-border/20'
                        }`}
                      >
                        <Icon className={`h-4.5 w-4.5 shrink-0 ${isActive ? 'text-white' : 'text-theme-text-secondary'}`} />
                        {showSidebarLabels && item.name}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* User Info & Logout */}
          <div className="p-4 border-t border-theme-border/30 flex flex-col gap-3 shrink-0">
            <div className={`flex items-center gap-3 py-1 ${showSidebarLabels ? 'px-2' : 'justify-center px-0'}`}>
              <div className="h-9 w-9 bg-accent/15 rounded-xl flex items-center justify-center border border-accent/20 shrink-0 overflow-hidden">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.name} className="h-full w-full object-cover" />
                ) : (
                  <User className="h-4.5 w-4.5 text-accent" />
                )}
              </div>
              {showSidebarLabels && (
                <div className="overflow-hidden">
                  <h4 className="font-semibold text-xs text-theme-text-primary truncate">{user.name}</h4>
                  <p className="text-[11px] text-theme-text-secondary truncate">{user.role || 'Member'}</p>
                </div>
              )}
            </div>

            <button
              onClick={handleLogout}
              title={showSidebarLabels ? undefined : 'Sign Out'}
              className={`flex items-center gap-2.5 w-full py-2 text-xs font-semibold text-danger hover:bg-danger/10 rounded-xl transition-all duration-200 cursor-pointer whitespace-nowrap ${showSidebarLabels ? 'px-3.5' : 'justify-center px-0'}`}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {showSidebarLabels && 'Sign Out'}
            </button>
          </div>
        </div>

        {/* Collapse / expand toggle — straddles the sidebar's docked edge */}
        <button
          onClick={toggleSidebarCollapsed}
          title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute top-20 -right-3 h-6 w-6 flex items-center justify-center rounded-full bg-theme-sidebar border border-theme-sidebar-border shadow-md text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-border/30 transition-all z-50 cursor-pointer"
        >
          {isSidebarCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </aside>

      {/* Mobile Header / Nav */}
      <header className="md:hidden flex items-center justify-between h-16 px-3 sm:px-4 glass-panel bg-theme-sidebar/95 border-b border-theme-sidebar-border sticky top-0 z-[60] w-full gap-2">
        <Link 
          href="/dashboard/home" 
          className="flex items-center gap-2 hover:opacity-90 transition-all cursor-pointer select-none min-w-0 max-w-[65%]"
          title="Return to Dashboard Home"
        >
          <div className="h-7 w-7 flex items-center justify-center shrink-0">
            <img 
              src="/images/rtbi-icon.png" 
              alt="RTBI Logo" 
              className="h-full w-full object-contain"
            />
          </div>
          <span className="font-bold text-xs tracking-wider uppercase text-theme-text-primary truncate">RTBI PORTAL</span>
        </Link>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={toggleTheme}
            className="h-9 w-9 flex items-center justify-center text-theme-text-secondary hover:text-theme-text-primary rounded-lg hover:bg-theme-border/20 transition-all cursor-pointer"
            title="Toggle Theme"
          >
            {isDarkTheme ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          {renderNotificationBell(notifRefMobile)}

          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="h-9 w-9 flex items-center justify-center text-theme-text-secondary hover:text-theme-text-primary rounded-lg hover:bg-theme-border/20 transition-all cursor-pointer"
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 top-16 z-[55] md:hidden bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <div 
            className="absolute top-0 left-0 right-0 glass-panel bg-theme-sidebar/98 border-b border-theme-sidebar-border max-h-[calc(100vh-4rem)] overflow-y-auto p-4 flex flex-col gap-4 shadow-2xl animate-in slide-in-from-top-2 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <nav className="flex flex-col gap-4">
              {navSections.map((section) => (
                <div key={section.title} className="space-y-1">
                  <h4 className="px-2 text-[10px] font-bold text-theme-text-secondary uppercase tracking-wider">
                    {section.title}
                  </h4>
                  {section.items.filter(item => (!item.superUserOnly || user.tier === 1) && (!item.staffOnly || user.tier <= 3) && (!item.groupPoliciesOnly || canAccessGroupPolicies(user))).map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                          isActive
                            ? 'bg-accent text-white'
                            : 'text-theme-text-secondary hover:text-theme-text-primary'
                        }`}
                      >
                        <Icon className="h-4.5 w-4.5" />
                        {item.name}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
            
            <div className="border-t border-theme-border/30 pt-3 flex flex-col gap-2">
              <div className="flex items-center gap-3 px-2">
                <div className="h-9 w-9 bg-accent/15 rounded-xl flex items-center justify-center border border-accent/20 overflow-hidden">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name} className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-4.5 w-4.5 text-accent" />
                  )}
                </div>
                <div>
                  <h4 className="font-semibold text-xs text-theme-text-primary">{user.name}</h4>
                  <p className="text-[11px] text-theme-text-secondary font-medium">{user.role || 'Member'}</p>
                </div>
              </div>

              {isImpersonating && (
                <button
                  onClick={() => { setIsMobileMenuOpen(false); handleReturnToSelf(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 mx-2 bg-warning/15 border border-warning/40 text-warning text-[11px] font-semibold rounded-xl hover:bg-warning/25 transition-all cursor-pointer"
                  title={`Return to ${originalUser?.name || 'your account'}`}
                >
                  <Undo2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Viewing as {user.name}</span>
                  <span className="shrink-0">&mdash; Return</span>
                </button>
              )}

              {canQuickSwitch && (
                <div className="flex items-center justify-between gap-2 px-2">
                  <span className="text-xs font-semibold text-theme-text-secondary">Quick Switch</span>
                  {renderQuickSwitch(quickSwitchRefMobile)}
                </div>
              )}

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleLogout();
                }}
                className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs font-semibold text-danger hover:bg-danger/10 rounded-xl transition-all"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop Navbar */}
        <header className="hidden md:flex items-center justify-between h-16 px-8 gap-4 glass-panel bg-theme-sidebar/50 border-b border-theme-sidebar-border sticky top-0 z-30">
          <div className="flex items-center gap-3 shrink-0">
            <h2 className="text-base font-bold text-theme-text-primary">{activeItem.name}</h2>
          </div>

          <div className="flex items-center gap-3 justify-end shrink-0">
            {/* Interactive Guided Tour button */}
            <button
              onClick={() => setIsTourOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 text-xs font-bold rounded-xl transition-all cursor-pointer shrink-0"
              title="Interactive Tour of Modules & Permissions"
            >
              <Compass className="h-4 w-4" />
              <span className="hidden sm:inline">Guided Tour</span>
            </button>

            {/* Theme switcher */}
            <button
              onClick={toggleTheme}
              className="h-9 w-9 flex items-center justify-center text-theme-text-secondary hover:text-theme-text-primary rounded-xl hover:bg-theme-border/20 transition-all cursor-pointer shrink-0"
              title="Toggle Light/Dark Theme"
            >
              {isDarkTheme ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
            </button>

            {/* Notification bell & dropdown */}
            {renderNotificationBell(notifRef)}

            {/* Super User quick-switch: view as any real member without a password */}
            {isImpersonating && (
              <button
                onClick={handleReturnToSelf}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-warning/15 border border-warning/40 text-warning text-[11px] font-semibold rounded-xl hover:bg-warning/25 transition-all cursor-pointer shrink-0 max-w-[220px]"
                title={`Return to ${originalUser?.name || 'your account'}`}
              >
                <Undo2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Viewing as {user.name}</span>
                <span className="shrink-0">&mdash; Return</span>
              </button>
            )}

            {canQuickSwitch && renderQuickSwitch(quickSwitchRef)}

            {/* Active User info — click to open the Settings / Sign Out menu */}
            <div className="relative shrink-0" ref={userMenuRef}>
              <button
                onClick={() => setIsUserMenuOpen(v => !v)}
                className="flex items-center gap-3 min-w-0 rounded-xl px-1.5 py-1 hover:bg-theme-border/20 transition-all cursor-pointer"
              >
                <div className="text-right min-w-0 max-w-[110px] lg:max-w-[180px]">
                  <h4 className="font-bold text-xs text-theme-text-primary truncate" title={user.name}>{user.name}</h4>
                  <p className="text-[10px] text-theme-text-secondary font-medium tracking-wide truncate" title={user.role}>{user.role}</p>
                </div>
                <Avatar
                  size="sm"
                  src={user.avatarUrl}
                  name={user.name}
                  color="accent"
                  className="rounded-xl shadow-md shadow-accent/20"
                />
              </button>

              {isUserMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 max-w-[calc(100vw-2rem)] glass-panel rounded-2xl p-1.5 shadow-2xl border border-white/20 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <button
                    onClick={() => { setIsUserMenuOpen(false); setIsTourOpen(true); }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-xs font-semibold text-accent hover:bg-accent/15 rounded-xl transition-all cursor-pointer"
                  >
                    <Compass className="h-4 w-4" />
                    Guided Tour
                  </button>
                  <Link
                    href="/dashboard/settings"
                    onClick={() => setIsUserMenuOpen(false)}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-xs font-semibold text-theme-text-primary hover:bg-theme-border/20 rounded-xl transition-all cursor-pointer"
                  >
                    <Settings className="h-4 w-4 text-theme-text-secondary" />
                    Settings
                  </Link>
                  <button
                    onClick={() => { setIsUserMenuOpen(false); handleLogout(); }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-xs font-semibold text-danger hover:bg-danger/10 rounded-xl transition-all cursor-pointer"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <BackgroundTaskTray offsetClass={isSidebarCollapsed ? 'md:left-24' : 'md:left-[17rem]'} />

        {/* Dashboard Pages Content */}
        <main className="flex-1 overflow-x-hidden">
          {children}
        </main>

        {/* Global Footer */}
        <footer className="mt-auto border-t border-theme-border/20 py-4 px-6 md:px-8 bg-theme-background/40 backdrop-blur-md flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-theme-text-secondary">
          <div className="flex flex-col sm:flex-row items-center gap-2 text-center md:text-left">
            <span>By visiting or using this portal, you agree to our</span>
            <button
              type="button"
              onClick={() => setIsTermsOpen(true)}
              className="font-semibold text-accent underline hover:text-primary-light transition-colors cursor-pointer"
            >
              Terms & Conditions
            </button>
            <span>and</span>
            <button
              type="button"
              onClick={() => setIsPrivacyOpen(true)}
              className="font-semibold text-accent underline hover:text-primary-light transition-colors cursor-pointer"
            >
              Privacy Policy
            </button>
            <span className="hidden sm:inline">&middot;</span>
            <span className="text-[11px]">All Intellectual Property, Copyrights & Development Licensing belong exclusively to <strong>Kayomarz Pavri</strong>.</span>
          </div>
          <div className="text-[11px] font-medium text-theme-text-secondary">
            &copy; 2026 RTBI Portal. All rights reserved.
          </div>
        </footer>

        {/* Terms & Conditions Modal */}
        <TermsModal isOpen={isTermsOpen} onClose={() => setIsTermsOpen(false)} />
        {/* Privacy Policy Modal */}
        <PrivacyPolicyModal isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} />

        {/* Interactive Role-Tailored Onboarding Tour */}
        <OnboardingTour user={user} isOpen={isTourOpen} onClose={() => setIsTourOpen(false)} />

        {/* Role Elevation & Promotion Celebration Modal */}
        <PromotionModal
          data={promotionData}
          isOpen={isPromotionModalOpen}
          onClose={() => setIsPromotionModalOpen(false)}
        />
      </div>

      {/* Global save/sync feedback for every background write app-wide */}
      <SyncStatusPill />

      {/* iOS "Add to Home Screen" nudge — Safari has no install-prompt API,
          so this is the only way an iPhone/iPad visitor discovers it. */}
      <IosInstallPrompt />
    </div>
  );
}
