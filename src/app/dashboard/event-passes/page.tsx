'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { beginTask } from '@/lib/background-tasks';
import { CertificateStatusBadge, CERT_STATUS_FILTERS } from '@/components/certificate-status-badge';
import { SortableTh } from '@/components/ui/sortable-th';
import { getPassAttendanceState, getAbsentDays, isEventDone, type PassAttendanceState } from '@/lib/pass-attendance';
import { useSort, type SortGetters } from '@/lib/use-sort';
import {
  Award,
  Ticket,
  QrCode,
  Search,
  MapPin,
  Send,
  Bell,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Eye,
  ExternalLink,
  ShieldCheck,
  Calendar,
  Sparkles,
  Layers,
  Edit3,
  Trash2,
  Mail,
  MailCheck,
  RotateCcw,
  Filter,
  Users,
  Check,
  Clock,
  Smartphone,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import {
  EventItem,
  EventPassItem,
  PassEmailStatus,
  getPassIssuableEvents,
  getEventPasses,
  saveEventPasses,
  updateEventPassStatus,
  deleteEventPass,
  deleteEventPassesBulk,
  dispatchPassEmail,
  authHeaders,
} from '@/lib/local-data';
import {
  canManageEventPasses,
  canScanEventPasses,
  canEditEventPasses,
  canSendCertificates,
  canDesignCertificates,
  canDispatchEventPasses,
  canDeleteEventPasses,
  canViewIssuedEventPasses,
  canViewIssuedCertificates,
  canDeleteCertificates,
  canAccessEventPassesModule,
  canViewFullDirectory,
} from '@/lib/permissions';
import { EventPassStudio } from '@/components/event-pass-studio';
import dynamic from 'next/dynamic';
const EventPassScanner = dynamic(() => import('@/components/event-pass-scanner').then((m) => m.EventPassScanner), { ssr: false });
import { EventPassPushModal } from '@/components/event-pass-push-modal';
import { EventPassBulkDispatchModal } from '@/components/event-pass-bulk-dispatch-modal';
import { EventPassBulkEditModal } from '@/components/event-pass-bulk-edit-modal';
import { CertificateModal } from '@/components/certificate-modal';
import { IssuedCertificatesPanel } from '@/components/issued-certificates-panel';
import { EventPassEditModal } from '@/components/event-pass-edit-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchableSelect } from '@/components/searchable-select';

export default function EventPassesPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventPasses, setEventPasses] = useState<EventPassItem[]>([]);
  
  // 3 Primary Tabs: Studio | Issued Passes Deep-Dive | Gate Turnstile Scanner
  const [activeTab, setActiveTab] = useState<'studio' | 'passes' | 'certificates' | 'scanner'>('studio');

  // Handle any direct/legacy pass param navigations
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const passSerial = searchParams.get('pass') || searchParams.get('passId') || searchParams.get('serial');
      if (passSerial) {
        router.replace(`/pass/${encodeURIComponent(passSerial)}`);
      }
    }
  }, [router]);

  // Filters for Studio bottom table
  const [passSearchQuery, setPassSearchQuery] = useState('');
  const [passFilterEventId, setPassFilterEventId] = useState<string>('ALL');

  // Filters for Dedicated "Issued Passes" Tab (Deep Dive)
  const [deepFilterEventId, setDeepFilterEventId] = useState<string>('ALL');
  const [deepFilterEmailStatus, setDeepFilterEmailStatus] = useState<string>('ALL');
  const [deepFilterCert, setDeepFilterCert] = useState<string>('ALL');
  // Certificate ledger per pass (issued / queued / sent / failed + times); only loaded for people allowed to see certificates.
  const [certStatuses, setCertStatuses] = useState<Record<string, { status: string; sentAt?: string; issuedAt?: string; sentBy?: string; error?: string; count?: number; typeName?: string }>>({});
  const [certAllowed, setCertAllowed] = useState(false);
  useEffect(() => {
    if (activeTab === 'certificates') return; // refreshed when returning to the passes tab after sending
    let cancelled = false;
    fetch('/api/certificates/status', { cache: 'no-store', headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        setCertAllowed(!!j.allowed);
        setCertStatuses(j.statuses || {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeTab]);
  const [deepFilterAttendance, setDeepFilterAttendance] = useState<string>('ALL');
  const [deepFilterTier, setDeepFilterTier] = useState<string>('ALL');
  const [deepFilterCategory, setDeepFilterCategory] = useState<string>('ALL');
  const [deepSearchQuery, setDeepSearchQuery] = useState('');
  // Events whose container is toggled away from its default (completed = collapsed, live/upcoming = open)
  const [toggledGroups, setToggledGroups] = useState<Set<string>>(new Set());

  // Email dispatching state
  const [dispatchingPassId, setDispatchingPassId] = useState<string | null>(null);
  const [isBatchDispatching, setIsBatchDispatching] = useState(false);
  // Multi-select for "Preview & dispatch" (survives search/filter changes)
  const [selectedPassIds, setSelectedPassIds] = useState<Set<string>>(new Set());
  const [isBulkDispatchOpen, setIsBulkDispatchOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Push Alert Modal State
  const [isPushModalOpen, setIsPushModalOpen] = useState(false);
  const [selectedPushPass, setSelectedPushPass] = useState<EventPassItem | null>(null);

  // Edit Pass Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedEditPass, setSelectedEditPass] = useState<EventPassItem | null>(null);

  // Notifications / Toast
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setErrorMsg('');
    setTimeout(() => setSuccessMsg(''), 4500);
  };

  const triggerError = (msg: string) => {
    setErrorMsg(msg);
    setSuccessMsg('');
    setTimeout(() => setErrorMsg(''), 5000);
  };

  const syncPassesFromServer = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/api/events/all/passes', { cache: 'no-store', headers: authHeaders() });
      if (res.ok) {
        const serverPasses = await res.json();
        if (Array.isArray(serverPasses)) {
          saveEventPasses(serverPasses);
          setEventPasses(serverPasses);
        }
      }
    } catch (err) {
      console.warn('[event-passes] live sync failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error(e);
      }
    }
    setEvents(getPassIssuableEvents());
    setEventPasses(getEventPasses());

    // Initial server fetch to guarantee latest view states
    syncPassesFromServer();

    const handleSync = () => {
      setEvents(getPassIssuableEvents());
      setEventPasses(getEventPasses());
    };
    window.addEventListener('rtbi-data-sync', handleSync);
    // Outcome of the server-side Group Policy approval gate (held for approval / refused)
    const handleApproval = (e: Event) => {
      const d = (e as CustomEvent).detail as { message: string; kind: 'pending' | 'error' };
      if (d?.kind === 'error') triggerError(d.message);
      else if (d?.message) triggerSuccess(`⏳ ${d.message}`);
    };
    window.addEventListener('rtbi-pass-approval', handleApproval);
    return () => {
      window.removeEventListener('rtbi-data-sync', handleSync);
      window.removeEventListener('rtbi-pass-approval', handleApproval);
    };
  }, []);

  const canManagePasses = canManageEventPasses(user);
  const canScanPasses = canScanEventPasses(user);
  // Finer abilities that a Group Policy can grant without full management
  const canEditPass = canEditEventPasses(user);
  const canDispatchPass = canDispatchEventPasses(user);
  const canDeletePass = canDeleteEventPasses(user);
  // Row checkboxes are for bulk actions: dispatch, edit and delete each have their own permission.
  const canSelectPasses = canDispatchPass || canDeletePass || canEditPass;
  const canSendCerts = canSendCertificates(user);
  const canDesignCerts = canDesignCertificates(user);
  const canViewIssued = canViewIssuedEventPasses(user);
  const canAccessModule = canAccessEventPassesModule(user);

  const canCertificates = canSendCerts || canDesignCerts;
  const tabBarRef = useRef<HTMLDivElement>(null);
  const canSeeCertLedger = canViewIssuedCertificates(user);

  // Keep the active tab visible when the tab bar scrolls (mobile).
  useEffect(() => {
    const bar = tabBarRef.current;
    const active = bar?.querySelector<HTMLElement>('[data-tab-active="true"]');
    if (bar && active) bar.scrollTo({ left: Math.max(0, active.offsetLeft - 16), behavior: 'smooth' });
  }, [activeTab]);

  // Auto switch to the first tab the user can actually use
  useEffect(() => {
    if (user && !canManagePasses && canViewIssued) {
      setActiveTab('passes');
    } else if (user && !canManagePasses && canSeeCertLedger) {
      setActiveTab('certificates');
    } else if (user && !canManagePasses && canScanPasses) {
      setActiveTab('scanner');
    }
  }, [user, canManagePasses, canViewIssued, canSeeCertLedger, canScanPasses]);

  // Dispatch single pass email
  const handleDispatchSinglePass = async (pass: EventPassItem) => {
    let email = pass.attendeeEmail;
    if (!email) {
      email = window.prompt(`Enter recipient email address for ${pass.attendeeName}:`) || undefined;
    }
    if (!email) return;

    setDispatchingPassId(pass.id);
    const res = await dispatchPassEmail(pass, email);
    setDispatchingPassId(null);
    if (res.success && res.pending) {
      // the approval notice has already been shown by dispatchPassEmail
    } else if (res.success) {
      setEventPasses(getEventPasses());
      triggerSuccess(`Pass ${pass.serialNumber} dispatched to ${email}!`);
    } else {
      triggerError(res.error || 'Failed to dispatch pass email. Check SMTP settings.');
    }
  };

  // Batch dispatch to all unsent passes in current filter
  const handleBatchDispatchUnsent = async (filteredList: EventPassItem[]) => {
    const unsent = filteredList.filter(
      (p) => p.attendeeEmail && p.approvalStatus !== 'pending_create' && (!p.emailStatus || p.emailStatus === 'Not Sent')
    );
    if (unsent.length === 0) {
      triggerError('No unsent passes with attendee email addresses found in this view.');
      return;
    }

    if (!window.confirm(`Dispatch pass invitation emails to ${unsent.length} attendees now?`)) {
      return;
    }

    setIsBatchDispatching(true);
    let successCount = 0;
    let doneCount = 0;
    const task = beginTask({ label: `Dispatching ${unsent.length} pass email${unsent.length === 1 ? '' : 's'}`, total: unsent.length });
    for (const pass of unsent) {
      const res = await dispatchPassEmail(pass);
      if (res.success) successCount++;
      doneCount++;
      task.progress(doneCount, `${successCount} sent${doneCount - successCount ? `, ${doneCount - successCount} failed` : ''}`);
    }
    task.finish(`${successCount} of ${unsent.length} pass emails dispatched.`, { warn: successCount < unsent.length });
    setIsBatchDispatching(false);
    setEventPasses(getEventPasses());
    triggerSuccess(`Successfully dispatched ${successCount} of ${unsent.length} pass emails!`);
  };

  // Bulk delete the ticked passes. Runs as a tracked background task, so it keeps going if the page is left.
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const handleBulkDeletePasses = async () => {
    const targets = eventPasses.filter((p) => selectedPassIds.has(p.id));
    if (targets.length === 0) return;
    const preview = targets.slice(0, 8).map((p) => `• ${p.attendeeName} (${p.serialNumber})`).join('\n');
    if (!window.confirm(`Permanently delete ${targets.length} issued pass${targets.length === 1 ? '' : 'es'}?\n\n${preview}${targets.length > 8 ? `\n…and ${targets.length - 8} more` : ''}\n\nTheir QR codes stop working. This cannot be undone.`)) return;
    setIsBulkDeleting(true);
    const task = beginTask({ label: `Deleting ${targets.length} pass${targets.length === 1 ? '' : 'es'}`, total: targets.length });
    try {
      const r = await deleteEventPassesBulk(targets.map((p) => p.id), user?.name || 'Staff', (done) => task.progress(done));
      const parts = [`${r.deleted} deleted`, r.pending ? `${r.pending} sent for approval` : '', r.failed.length ? `${r.failed.length} failed (${r.failed.slice(0, 3).map((f) => `${f.name}: ${f.error}`).join('; ')})` : ''].filter(Boolean);
      task.finish(`${parts.join(', ')}.`, { warn: r.failed.length > 0 || r.pending > 0 });
      setSelectedPassIds(new Set());
      setEventPasses(getEventPasses());
      if (r.failed.length) triggerError(`Some passes could not be deleted: ${r.failed.slice(0, 3).map((f) => f.name).join(', ')}.`);
      else triggerSuccess(`${parts.join(', ')}.`);
    } catch (err: any) {
      task.fail(err?.message || 'Bulk delete failed.');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // CSV Attendance & Delivery Status Exporter
  const handleExportAttendance = (targetEventId: string = 'ALL', order?: (rows: EventPassItem[]) => EventPassItem[]) => {
    const filtered = (order ? order(eventPasses) : eventPasses).filter((p) => {
      if (targetEventId !== 'ALL' && p.eventId !== targetEventId) return false;
      return true;
    });

    if (filtered.length === 0) {
      triggerError('No pass records found to export.');
      return;
    }

    const headers = [
      'Serial Number',
      'Attendee Name',
      'Guest Category',
      'Organization / Affiliation',
      'Assigned Room / Venue',
      'Event Name',
      'Pass Tier',
      'Issued By',
      'Issued At',
      'Status',
      'Email & Pass View Status',
      'Email Sent At',
      'Email Received At',
      'Certificate Status',
      'Certificate Sent At',
      'Pass Viewed',
      'Pass Viewed At',
      'Pass View Count',
      'Checked In By',
      'Checked In At',
      'Multi-Day Attendance',
      'Email Address',
      'Phone Number',
      'Notes',
    ];

    const rows = filtered.map((p) => [
      `"${p.serialNumber}"`,
      `"${(p.attendeeName || '').replace(/"/g, '""')}"`,
      `"${(p.guestCategory || 'General Delegate').replace(/"/g, '""')}"`,
      `"${(p.attendeeOrg || '').replace(/"/g, '""')}"`,
      `"${(p.roomOrVenue || p.eventVenue || '').replace(/"/g, '""')}"`,
      `"${(p.eventName || '').replace(/"/g, '""')}"`,
      `"${p.passType}"`,
      `"${(p.issuedBy || '').replace(/"/g, '""')}"`,
      `"${p.issuedAt || ''}"`,
      `"${p.status}"`,
      `"${p.emailStatus || (p.passViewed ? 'Pass Viewed' : 'Not Sent')}"`,
      `"${p.emailSentAt || ''}"`,
      `"${p.emailReceivedAt || ''}"`,
      `"${certAllowed ? (certStatuses[p.id]?.status || 'Not issued') : ''}"`,
      `"${certAllowed ? (certStatuses[p.id]?.sentAt || '') : ''}"`,
      `"${p.passViewed ? 'Yes' : 'No'}"`,
      `"${p.passViewedAt || ''}"`,
      `"${p.passViewCount || 0}"`,
      `"${(p.checkedInBy || '').replace(/"/g, '""')}"`,
      `"${p.checkedInAt || ''}"`,
      `"${(p.attendance ? p.attendance.map((a) => `${a.day} (${new Date(a.timestamp).toLocaleString()})`).join('; ') : '').replace(/"/g, '""')}"`,
      `"${(p.attendeeEmail || '').replace(/"/g, '""')}"`,
      `"${(p.attendeePhone || '').replace(/"/g, '""')}"`,
      `"${(p.notes || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const eventNameSlug =
      targetEventId !== 'ALL'
        ? (events.find((e) => e.id === targetEventId)?.title || 'event').replace(/[^a-zA-Z0-9]+/g, '_')
        : 'all_events';
    link.setAttribute('href', url);
    link.setAttribute('download', `rtbi_attendance_${eventNameSlug}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerSuccess(`Exported ${filtered.length} attendee records to CSV!`);
  };

  // Helper component to render the 3-state Email & Pass View badge
  const renderEmailViewBadge = (pass: EventPassItem) => {
    const isViewed = pass.passViewed || pass.emailStatus === 'Pass Viewed';
    const isReceived = pass.emailStatus === 'Email Received';
    const isSent = pass.emailStatus === 'Email Sent';

    if (isViewed) {
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border border-emerald-500/30 shadow-sm shadow-emerald-500/15">
            <Eye className="h-3 w-3 text-emerald-400 shrink-0" />
            <span>Pass Viewed</span>
            {pass.passViewCount && pass.passViewCount > 1 ? (
              <span className="px-1 py-0.1 bg-emerald-500/20 rounded text-[9px] font-mono">
                {pass.passViewCount}x
              </span>
            ) : null}
          </span>
          {pass.passViewedAt && (
            <span className="text-[9px] text-emerald-600 dark:text-emerald-400/80 pl-1 font-mono">
              {new Date(pass.passViewedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &middot; {new Date(pass.passViewedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      );
    }

    if (isReceived) {
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
            <MailCheck className="h-3 w-3 text-cyan-400 shrink-0" />
            <span>Email Received</span>
          </span>
          {pass.emailReceivedAt && (
            <span className="text-[9px] text-cyan-600 dark:text-cyan-400/80 pl-1 font-mono">
              {new Date(pass.emailReceivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &middot; {new Date(pass.emailReceivedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      );
    }

    if (isSent) {
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            <Send className="h-3 w-3 text-amber-400 shrink-0" />
            <span>Email Sent</span>
          </span>
          {pass.emailSentAt && (
            <span className="text-[9px] text-amber-600 dark:text-amber-400/80 pl-1 font-mono">
              {new Date(pass.emailSentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &middot; {new Date(pass.emailSentAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-500/10 text-slate-500 dark:text-slate-400 border border-slate-500/20">
        <Mail className="h-3 w-3 opacity-60 shrink-0" />
        <span>Not Sent</span>
      </span>
    );
  };

  // Selected event for Deep Dive Tab
  const selectedDeepEvent = useMemo(() => {
    if (deepFilterEventId === 'ALL') return null;
    return events.find((e) => e.id === deepFilterEventId) || null;
  }, [deepFilterEventId, events]);

  // Column sorting for the two passes tables (click a header: ascending, descending, then back to the default order).
  const studioSort = useSort();
  const deepSort = useSort();
  const passSortGetters: SortGetters<EventPassItem> = {
    serial: (p) => p.serialNumber,
    name: (p) => p.attendeeName,
    category: (p) => p.guestCategory,
    venue: (p) => p.roomOrVenue,
    event: (p) => p.eventName,
    tier: (p) => p.passType,
    email: (p) => p.emailStatus || (p.passViewed ? 'Pass Viewed' : 'Not Sent'),
    cert: (p) => certStatuses[p.id]?.status || 'Not issued',
    gate: (p) => p.status,
    issuedBy: (p) => p.issuedBy,
    issuedAt: (p) => p.issuedAt,
  };

  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const attendanceOf = (p: EventPassItem): PassAttendanceState => getPassAttendanceState(p, eventById.get(p.eventId));

  // Gate badge: "Absent" once the event is over with no scan, "Partial" if some valid days were missed
  const gateBadge = (pass: EventPassItem) => {
    const st = attendanceOf(pass);
    const label = st === 'Pending' ? pass.status : st === 'Attended' ? 'Attended' : st === 'Partial' ? `Partial · missed ${getAbsentDays(pass).length}d` : st;
    const cls =
      st === 'Checked In' || st === 'Attended'
        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
        : st === 'Cancelled'
        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
        : st === 'Absent'
        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
        : st === 'Partial'
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
        : 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-500/30';
    return (
      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${cls}`}>
        {(st === 'Checked In' || st === 'Attended') && <Check className="h-2.5 w-2.5" />}
        <span>{label}</span>
      </span>
    );
  };

  // Deep dive filtered passes
  const deepFilteredPasses = useMemo(() => {
    return eventPasses.filter((p) => {
      if (deepFilterEventId !== 'ALL' && p.eventId !== deepFilterEventId) return false;
      
      if (deepFilterEmailStatus !== 'ALL') {
        const currentEmailStatus = p.emailStatus || (p.passViewed ? 'Pass Viewed' : 'Not Sent');
        if (deepFilterEmailStatus === 'Pass Viewed' && (!p.passViewed && currentEmailStatus !== 'Pass Viewed')) return false;
        if (deepFilterEmailStatus === 'Email Received' && currentEmailStatus !== 'Email Received') return false;
        if (deepFilterEmailStatus === 'Email Sent' && currentEmailStatus !== 'Email Sent') return false;
        if (deepFilterEmailStatus === 'Not Sent' && currentEmailStatus !== 'Not Sent') return false;
      }

      if (certAllowed && deepFilterCert !== 'ALL' && (certStatuses[p.id]?.status || 'Not issued') !== deepFilterCert) return false;

      if (deepFilterAttendance !== 'ALL') {
        const st = attendanceOf(p);
        if (deepFilterAttendance === 'Checked In' && p.status !== 'Checked In') return false;
        if (deepFilterAttendance === 'Pending' && st !== 'Pending') return false;
        if (deepFilterAttendance === 'Absent' && st !== 'Absent' && st !== 'Partial') return false;
      }

      if (deepFilterTier !== 'ALL' && p.passType !== deepFilterTier) return false;
      if (deepFilterCategory !== 'ALL' && p.guestCategory !== deepFilterCategory) return false;

      if (deepSearchQuery.trim()) {
        const q = deepSearchQuery.toLowerCase();
        const matches =
          p.attendeeName.toLowerCase().includes(q) ||
          p.serialNumber.toLowerCase().includes(q) ||
          (p.attendeeEmail && p.attendeeEmail.toLowerCase().includes(q)) ||
          (p.attendeePhone && p.attendeePhone.toLowerCase().includes(q)) ||
          (p.attendeeOrg && p.attendeeOrg.toLowerCase().includes(q)) ||
          (p.roomOrVenue && p.roomOrVenue.toLowerCase().includes(q)) ||
          (p.guestCategory && p.guestCategory.toLowerCase().includes(q)) ||
          p.passType.toLowerCase().includes(q) ||
          (p.eventName && p.eventName.toLowerCase().includes(q));
        if (!matches) return false;
      }

      return true;
    });
  }, [
    eventPasses,
    deepFilterEventId,
    deepFilterEmailStatus,
    deepFilterCert,
    certStatuses,
    certAllowed,
    deepFilterAttendance,
    deepFilterTier,
    deepFilterCategory,
    deepSearchQuery,
    events,
  ]);

  // One container per event (only when several events are in view). Completed events sit after live ones, collapsed by default.
  const deepGroups = useMemo(() => {
    const sorted = deepSort.apply(deepFilteredPasses, passSortGetters);
    if (deepFilterEventId !== 'ALL') {
      return [{ eventId: deepFilterEventId, eventName: '', passes: sorted, done: false, open: true, showHeader: false, attended: 0, absent: 0 }];
    }
    const map = new Map<string, EventPassItem[]>();
    sorted.forEach((p) => map.set(p.eventId, [...(map.get(p.eventId) || []), p]));
    const groups = Array.from(map.entries()).map(([eventId, passes]) => {
      const ev = eventById.get(eventId);
      const done = ev ? isEventDone(ev) : passes.every((p) => attendanceOf(p) === 'Absent' || attendanceOf(p) === 'Attended' || attendanceOf(p) === 'Partial' || attendanceOf(p) === 'Cancelled');
      const toggled = toggledGroups.has(eventId);
      return {
        eventId,
        eventName: ev?.title || passes[0]?.eventName || 'Event',
        passes,
        done,
        open: done ? toggled : !toggled,
        showHeader: true,
        attended: passes.filter((p) => ['Checked In', 'Attended', 'Partial'].includes(attendanceOf(p))).length,
        absent: passes.filter((p) => attendanceOf(p) === 'Absent').length,
      };
    });
    return [...groups.filter((g) => !g.done), ...groups.filter((g) => g.done)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepFilteredPasses, deepSort, deepFilterEventId, eventById, toggledGroups]);

  // KPI Metrics computed on the selected event scope
  const scopedPasses = useMemo(() => {
    if (deepFilterEventId === 'ALL') return eventPasses;
    return eventPasses.filter((p) => p.eventId === deepFilterEventId);
  }, [eventPasses, deepFilterEventId]);

  const kpis = useMemo(() => {
    const total = scopedPasses.length;
    const sent = scopedPasses.filter(
      (p) => p.emailStatus === 'Email Sent' || p.emailStatus === 'Email Received' || p.emailStatus === 'Pass Viewed'
    ).length;
    const pendingDispatch = total - sent;
    const admitted = scopedPasses.filter((p) => p.status === 'Checked In').length;
    const absent = scopedPasses.filter((p) => attendanceOf(p) === 'Absent').length;
    const attended = scopedPasses.filter((p) => ['Checked In', 'Attended', 'Partial'].includes(attendanceOf(p))).length;
    const yetToArrive = Math.max(0, total - attended - absent);

    return {
      total,
      sent,
      sentPct: total > 0 ? Math.round((sent / total) * 100) : 0,
      pendingDispatch,
      pendingDispatchPct: total > 0 ? Math.round((pendingDispatch / total) * 100) : 0,
      yetToArrive,
      yetToArrivePct: total > 0 ? Math.round((yetToArrive / total) * 100) : 0,
      admitted,
      admittedPct: total > 0 ? Math.round((admitted / total) * 100) : 0,
      absent,
    };
  }, [scopedPasses, events]);

  // Distinct categories and tiers for filters
  const uniqueTiers = useMemo(() => {
    return Array.from(new Set(scopedPasses.map((p) => p.passType))).filter(Boolean);
  }, [scopedPasses]);

  const uniqueCategories = useMemo(() => {
    return Array.from(new Set(scopedPasses.map((p) => p.guestCategory))).filter(Boolean) as string[];
  }, [scopedPasses]);

  if (!canAccessModule) {
    return (
      <div className="p-6 md:p-8">
        <EmptyState
          icon={Ticket}
          title="Access Restricted"
          description="You do not currently hold authorization to issue event passes or operate the turnstile gate scanner. Contact leadership or request a Group Policy grant."
        />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 min-w-0 animate-in fade-in duration-200">
      {/* Notifications */}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-emerald-500/15 border border-emerald-500/25 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300 shadow-md shadow-emerald-500/10">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <span className="font-semibold">{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-3 p-4 bg-rose-500/15 border border-rose-500/25 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300 shadow-md shadow-rose-500/10">
          <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
          <span className="font-semibold">{errorMsg}</span>
        </div>
      )}

      {/* Header & Main Nav Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-theme-border/30 pb-4 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-black text-theme-text-primary flex items-center gap-2.5">
            <div className="p-2 bg-accent/15 rounded-2xl text-accent border border-accent/20">
              <Ticket className="h-6 w-6" />
            </div>
            Event Passes &amp; Gate Turnstile
          </h1>
          <p className="text-xs text-theme-text-secondary mt-1">
            Issue verified passes, monitor real-time email &amp; attendee view engagement, and operate gate turnstiles.
          </p>
        </div>

        {/* Tab Controls: Studio | Issued Passes Tab | Gate Turnstile */}
        {/* Scrolls sideways on narrow screens (tabs never wrap or get cut off); the active tab is kept in view. */}
        <div ref={tabBarRef} className="flex items-center gap-1.5 bg-slate-200/80 dark:bg-white/5 p-1 rounded-2xl border border-slate-300 dark:border-white/10 text-xs shadow-inner max-w-full overflow-x-auto overscroll-x-contain snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {canManagePasses && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('studio')}
                data-tab-active={activeTab === 'studio'}
                className={`px-3 sm:px-4 py-2 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 whitespace-nowrap snap-start ${
                  activeTab === 'studio'
                    ? 'bg-accent text-white shadow-md shadow-accent/25'
                    : 'text-theme-text-secondary hover:text-theme-text-primary'
                }`}
              >
                <Sparkles className="h-4 w-4" />
                Passes &amp; Tickets Studio
              </button>
            </>
          )}
          {canViewIssued && (
            <>

              <button
                type="button"
                onClick={() => setActiveTab('passes')}
                data-tab-active={activeTab === 'passes'}
                className={`px-3 sm:px-4 py-2 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 whitespace-nowrap snap-start ${
                  activeTab === 'passes'
                    ? 'bg-accent text-white shadow-md shadow-accent/25'
                    : 'text-theme-text-secondary hover:text-theme-text-primary'
                }`}
              >
                <Ticket className="h-4 w-4" />
                Issued Event Passes
                {eventPasses.length > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                      activeTab === 'passes'
                        ? 'bg-white/20 text-white'
                        : 'bg-accent/15 text-accent border border-accent/25'
                    }`}
                  >
                    {eventPasses.length}
                  </span>
                )}
              </button>
            </>
          )}

          {canSeeCertLedger && (
            <button
              type="button"
              onClick={() => setActiveTab('certificates')}
                data-tab-active={activeTab === 'certificates'}
              className={`px-3 sm:px-4 py-2 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 whitespace-nowrap snap-start ${
                activeTab === 'certificates'
                  ? 'bg-accent text-white shadow-md shadow-accent/25'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <Award className="h-4 w-4" />
              Certificates
            </button>
          )}

          {canScanPasses && (
            <button
              type="button"
              onClick={() => setActiveTab('scanner')}
                data-tab-active={activeTab === 'scanner'}
              className={`px-3 sm:px-4 py-2 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 whitespace-nowrap snap-start ${
                activeTab === 'scanner'
                  ? 'bg-accent text-white shadow-md shadow-accent/25'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <QrCode className="h-4 w-4" />
              Gate Turnstile Scanner
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: PASSES & TICKETS STUDIO */}
      {activeTab === 'studio' && canManagePasses && (
        <div className="space-y-8 animate-in fade-in duration-300">
          <EventPassStudio
            events={events}
            currentUserId={user?.id}
            currentUserName={user?.name || 'Authorized Staff'}
            currentUserEmail={user?.email}
            onPassIssued={() => {
              setEventPasses(getEventPasses());
            }}
          />

          {/* Quick Issued Passes Ledger at Bottom (Kept as requested) */}
          <div className="glass-panel rounded-3xl p-6 md:p-8 space-y-5 border border-white/15 bg-theme-card/90 shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-theme-text-primary">Issued Event Passes &amp; Turnstile Roster</h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab('passes')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:underline cursor-pointer ml-2"
                  >
                    <span>Open Full Deep Dive View</span>
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-xs text-theme-text-secondary">
                  Real-time ledger of passes issued across events with live email delivery and view tracking.
                </p>
              </div>

              {/* Filters & Actions */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => handleExportAttendance(passFilterEventId, (rows) => studioSort.apply(rows, passSortGetters))}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/35 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm"
                  title="Export Attendance & Registration Roster to CSV for Audits"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Export (CSV)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedPushPass(null);
                    setIsPushModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/35 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm"
                  title="Broadcast lock-screen push notification to attendees"
                >
                  <Bell className="h-3.5 w-3.5 animate-pulse" />
                  Broadcast Push
                </button>

                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-theme-text-secondary" />
                  <input
                    type="text"
                    value={passSearchQuery}
                    onChange={(e) => setPassSearchQuery(e.target.value)}
                    placeholder="Search attendee or serial..."
                    className="pl-8 pr-3 py-1.5 bg-theme-background/50 border border-theme-card-border rounded-xl text-theme-text-primary text-xs focus:outline-none focus:border-accent"
                  />
                </div>

                <SearchableSelect
                  value={passFilterEventId}
                  onChange={setPassFilterEventId}
                  allLabel="All Events"
                  allValue="ALL"
                  options={events.map((evt) => ({ value: evt.id, label: evt.title }))}
                />
              </div>
            </div>

            {/* Passes Table */}
            {eventPasses.length === 0 ? (
              <div className="py-12 text-center text-theme-text-secondary text-xs">
                No event passes issued yet. Use the studio above to issue the first pass!
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/90 dark:border-white/10 text-theme-text-secondary text-[11px] uppercase tracking-wider">
                      <SortableTh label="Serial ID" columnKey="serial" sort={studioSort.sort} onToggle={studioSort.toggle} />
                      <SortableTh label="Attendee & Category" columnKey="name" sort={studioSort.sort} onToggle={studioSort.toggle} />
                      <SortableTh label="Room / Venue" columnKey="venue" sort={studioSort.sort} onToggle={studioSort.toggle} />
                      <SortableTh label="Event" columnKey="event" sort={studioSort.sort} onToggle={studioSort.toggle} />
                      <SortableTh label="Pass Tier" columnKey="tier" sort={studioSort.sort} onToggle={studioSort.toggle} />
                      <SortableTh label="Email & Pass View Status" columnKey="email" sort={studioSort.sort} onToggle={studioSort.toggle} />
                      {certAllowed && <SortableTh label="Certificate" columnKey="cert" sort={studioSort.sort} onToggle={studioSort.toggle} />}
                      <SortableTh label="Gate Status" columnKey="gate" sort={studioSort.sort} onToggle={studioSort.toggle} />
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/50 dark:divide-white/5">
                    {studioSort.apply(eventPasses, passSortGetters)
                      .filter((p) => {
                        if (passFilterEventId !== 'ALL' && p.eventId !== passFilterEventId) return false;
                        if (passSearchQuery.trim()) {
                          const q = passSearchQuery.toLowerCase();
                          return (
                            p.attendeeName.toLowerCase().includes(q) ||
                            p.serialNumber.toLowerCase().includes(q) ||
                            (p.attendeeOrg && p.attendeeOrg.toLowerCase().includes(q)) ||
                            (p.roomOrVenue && p.roomOrVenue.toLowerCase().includes(q)) ||
                            (p.guestCategory && p.guestCategory.toLowerCase().includes(q)) ||
                            p.passType.toLowerCase().includes(q)
                          );
                        }
                        return true;
                      })
                      .map((pass) => (
                        <tr key={pass.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold">
                            <a
                              href={`/pass/${pass.serialNumber}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-500 dark:text-sky-400 hover:text-sky-300 hover:underline inline-flex items-center gap-1 group"
                              title={`Open verified pass for ${pass.attendeeName} (${pass.serialNumber})`}
                            >
                              <span>{pass.serialNumber}</span>
                              <ExternalLink className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                            </a>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-theme-text-primary">{pass.attendeeName}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {pass.guestCategory && (
                                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-accent/15 text-accent border border-accent/25">
                                  {pass.guestCategory}
                                </span>
                              )}
                              {pass.attendeeOrg && (
                                <span className="text-[10px] text-theme-text-secondary truncate max-w-[150px]">
                                  {pass.attendeeOrg}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 min-w-[140px] max-w-[220px] align-top">
                            <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-start gap-1 min-w-0">
                              <MapPin className="h-3 w-3 text-accent shrink-0 mt-0.5" />
                              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{pass.roomOrVenue || pass.eventVenue || 'Main Auditorium'}</span>
                            </span>
                          </td>
                          <td className="py-3 px-4 text-theme-text-secondary max-w-[180px] truncate">
                            {pass.eventName}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent/15 text-accent border border-accent/30">
                              {pass.passType}
                            </span>
                          </td>
                          {/* Real-time Email & Pass View Status */}
                          <td className="py-3 px-4">
                            {renderEmailViewBadge(pass)}
                          </td>
                          <td className="py-3 px-4">
                            {gateBadge(pass)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <a
                                href={`/pass/${pass.serialNumber}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                                title={`View Pass for ${pass.attendeeName}`}
                              >
                                <Eye className="h-3 w-3" />
                                <span>View</span>
                              </a>

                              <button
                                type="button"
                                disabled={dispatchingPassId === pass.id}
                                onClick={() => handleDispatchSinglePass(pass)}
                                className="p-1.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-sky-500/30 rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                                title={`Dispatch Pass Email to ${pass.attendeeEmail || pass.attendeeName}`}
                              >
                                {dispatchingPassId === pass.id ? (
                                  <span className="h-3 w-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin block" />
                                ) : (
                                  <Send className="h-3 w-3" />
                                )}
                              </button>

                              {pass.status !== 'Checked In' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateEventPassStatus(pass.id, 'Checked In', user?.name || 'Staff');
                                    setEventPasses(getEventPasses());
                                    triggerSuccess(`Checked in ${pass.attendeeName}!`);
                                  }}
                                  className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                                >
                                  Admit
                                </button>
                              )}

                              {canManagePasses && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedEditPass(pass);
                                    setIsEditModalOpen(true);
                                  }}
                                  className="p-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 border border-indigo-500/30 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                                  title={`Edit pass details for ${pass.attendeeName}`}
                                >
                                  <Edit3 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ISSUED EVENT PASSES DEEP DIVE VIEW */}
      {activeTab === 'passes' && canViewIssued && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Top Event Showcase Banner (when an event or all events is filtered) */}
          <div className="glass-panel rounded-3xl p-6 md:p-8 border border-white/15 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-slate-950/90 shadow-2xl relative overflow-hidden">
            <div className="absolute right-0 top-0 w-96 h-96 bg-accent/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
            
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
              <div className="space-y-2 max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-accent/20 text-accent border border-accent/30 inline-flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" /> Event Pass Analytics &amp; Roster
                  </span>
                  {selectedDeepEvent && (
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      selectedDeepEvent.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                    }`}>
                      {selectedDeepEvent.status}
                    </span>
                  )}
                </div>

                <h2 className="text-xl md:text-2xl font-black text-white">
                  {selectedDeepEvent ? selectedDeepEvent.title : 'All Events & Conferences Roster'}
                </h2>

                <p className="text-xs text-slate-300 leading-relaxed">
                  {selectedDeepEvent
                    ? selectedDeepEvent.description || 'Verified attendance tracking, pass views on the portal, and gate turnstile credentials.'
                    : 'Global overview of all credentialed attendees, VIP dignitaries, turnstile checks, and real-time email-to-portal conversion metrics.'}
                </p>

                {selectedDeepEvent && (
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300 pt-1">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Calendar className="h-3.5 w-3.5 text-accent" />
                      {selectedDeepEvent.startDate} {selectedDeepEvent.endDate && selectedDeepEvent.endDate !== selectedDeepEvent.startDate ? `→ ${selectedDeepEvent.endDate}` : ''}
                    </span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <MapPin className="h-3.5 w-3.5 text-accent" />
                      {selectedDeepEvent.location || 'Main Campus Auditorium'}
                    </span>
                  </div>
                )}
              </div>

              {/* Event Quick Filter Dropdown & Refresh */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="min-w-[240px]">
                  <SearchableSelect
                    value={deepFilterEventId}
                    onChange={setDeepFilterEventId}
                    allLabel="All Events & Conferences"
                    allValue="ALL"
                    options={events.map((evt) => ({ value: evt.id, label: evt.title }))}
                  />
                </div>

                <button
                  type="button"
                  disabled={isRefreshing}
                  onClick={syncPassesFromServer}
                  className="px-3.5 py-2.5 bg-white/10 hover:bg-white/15 text-white border border-white/20 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  title="Refresh pass view data from server"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExportAttendance(deepFilterEventId, (rows) => deepSort.apply(rows, passSortGetters))}
                  className="px-3.5 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {/* 5 Real-Time KPI Cards (Total Passes, Sent, Pending Dispatch, Yet to Arrive, Admitted) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 mt-6 pt-6 border-t border-white/10">
              {/* 1. Total Passes */}
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold">
                  <span>Passes Issued</span>
                  <Ticket className="h-3.5 w-3.5 text-accent" />
                </div>
                <div className="text-2xl font-black text-white">{kpis.total}</div>
                <div className="text-[10px] text-slate-400">Total registered guests</div>
              </div>

              {/* 2. Email Sent */}
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold">
                  <span>Email Sent</span>
                  <Send className="h-3.5 w-3.5 text-amber-400" />
                </div>
                <div className="text-2xl font-black text-amber-400">
                  {kpis.sent}
                  <span className="text-xs font-normal text-slate-400 ml-1.5">({kpis.sentPct}%)</span>
                </div>
                <div className="text-[10px] text-slate-400">Dispatched credentials</div>
              </div>

              {/* 3. Pending Dispatch */}
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold">
                  <span>Pending Dispatch</span>
                  <Mail className="h-3.5 w-3.5 text-cyan-400" />
                </div>
                <div className="text-2xl font-black text-cyan-400">
                  {kpis.pendingDispatch}
                  <span className="text-xs font-normal text-slate-400 ml-1.5">({kpis.pendingDispatchPct}%)</span>
                </div>
                <div className="text-[10px] text-slate-400">Passes not yet emailed</div>
              </div>

              {/* 4. Yet to Arrive */}
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold">
                  <span>Yet to Arrive</span>
                  <Clock className="h-3.5 w-3.5 text-emerald-400" />
                </div>
                <div className="text-2xl font-black text-emerald-400">
                  {kpis.yetToArrive}
                  <span className="text-xs font-normal text-slate-400 ml-1.5">({kpis.yetToArrivePct}%)</span>
                </div>
                <div className="text-[10px] text-slate-400">Not yet scanned at gate</div>
              </div>

              {/* 5. Gate Turnstile Checked In */}
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold">
                  <span>Admitted Gate</span>
                  <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
                </div>
                <div className="text-2xl font-black text-white">
                  {kpis.admitted}
                  <span className="text-xs font-normal text-slate-400 ml-1.5">({kpis.admittedPct}%)</span>
                </div>
                <div className="text-[10px] text-slate-400">Scanned at turnstile{kpis.absent > 0 ? <span className="text-rose-400 font-bold"> · {kpis.absent} absent</span> : null}</div>
              </div>
            </div>
          </div>

          {/* Deep Dive Filter Toolbar */}
          <div className="glass-panel p-5 rounded-2xl border border-white/10 bg-theme-card space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              {/* Search bar */}
              <div className="relative flex-1 min-w-[260px]">
                <Search className="absolute left-3.5 top-3 h-4 w-4 text-theme-text-secondary" />
                <input
                  type="text"
                  value={deepSearchQuery}
                  onChange={(e) => setDeepSearchQuery(e.target.value)}
                  placeholder="Search by attendee name, serial ID, email, organization, room..."
                  className="w-full pl-10 pr-4 py-2.5 bg-theme-background/60 border border-theme-border/40 rounded-xl text-theme-text-primary text-xs focus:outline-none focus:border-accent"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {canSeeCertLedger && (
                <button
                  type="button"
                  onClick={() => setActiveTab('certificates')}
                  className="px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  title="Email PDF certificates to everyone who attended a finished event"
                >
                  <Award className="h-3.5 w-3.5" />
                  <span>Certificates</span>
                </button>
                )}
                {canDispatchPass && (
                <button
                  type="button"
                  disabled={isBatchDispatching}
                  onClick={() => handleBatchDispatchUnsent(deepFilteredPasses)}
                  className="px-3 py-2 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-sky-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  title="Dispatch emails to all unsent passes in this filtered view"
                >
                  {isBatchDispatching ? (
                    <span className="h-3.5 w-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  <span>Email Unsent Passes</span>
                </button>
                )}

                {canManagePasses && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPushPass(null);
                    setIsPushModalOpen(true);
                  }}
                  className="px-3 py-2 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Bell className="h-3.5 w-3.5" />
                  <span>Broadcast Push</span>
                </button>
                )}
              </div>
            </div>

            {/* Filter Pills / Dropdowns */}
            <div className="flex items-center gap-2.5 flex-wrap pt-2 border-t border-theme-border/20 text-xs">
              <span className="text-[11px] font-bold text-theme-text-secondary flex items-center gap-1 mr-1">
                <Filter className="h-3 w-3" /> Filters:
              </span>

              {/* Status Filter */}
              <select
                value={deepFilterEmailStatus}
                onChange={(e) => setDeepFilterEmailStatus(e.target.value)}
                className="px-3 py-1.5 bg-theme-background/60 border border-theme-border/40 rounded-xl text-theme-text-primary text-xs focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="ALL">All Email &amp; View States</option>
                <option value="Pass Viewed">✓ Pass Viewed (Opened on Website)</option>
                <option value="Email Received">✓✓ Email Received / Opened</option>
                <option value="Email Sent">✓ Email Sent</option>
                <option value="Not Sent">Not Sent</option>
              </select>

              {/* Certificate Filter */}
              {certAllowed && (
                <select
                  value={deepFilterCert}
                  onChange={(e) => setDeepFilterCert(e.target.value)}
                  className="px-3 py-1.5 bg-theme-background/60 border border-theme-border/40 rounded-xl text-theme-text-primary text-xs focus:outline-none focus:border-accent cursor-pointer"
                >
                  <option value="ALL">All Certificate States</option>
                  {CERT_STATUS_FILTERS.map((s) => (
                    <option key={s} value={s}>{s === 'Issued' ? 'Issued (not sent)' : s}</option>
                  ))}
                </select>
              )}

              {/* Turnstile Gate Filter */}
              <select
                value={deepFilterAttendance}
                onChange={(e) => setDeepFilterAttendance(e.target.value)}
                className="px-3 py-1.5 bg-theme-background/60 border border-theme-border/40 rounded-xl text-theme-text-primary text-xs focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="ALL">All Turnstile States</option>
                <option value="Checked In">Checked In / Admitted</option>
                <option value="Pending">Pending Check-In</option>
                <option value="Absent">Absent (event over, not scanned)</option>
              </select>

              {/* Tier Filter */}
              {uniqueTiers.length > 0 && (
                <select
                  value={deepFilterTier}
                  onChange={(e) => setDeepFilterTier(e.target.value)}
                  className="px-3 py-1.5 bg-theme-background/60 border border-theme-border/40 rounded-xl text-theme-text-primary text-xs focus:outline-none focus:border-accent cursor-pointer"
                >
                  <option value="ALL">All Pass Tiers</option>
                  {uniqueTiers.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}

              {/* Category Filter */}
              {uniqueCategories.length > 0 && (
                <select
                  value={deepFilterCategory}
                  onChange={(e) => setDeepFilterCategory(e.target.value)}
                  className="px-3 py-1.5 bg-theme-background/60 border border-theme-border/40 rounded-xl text-theme-text-primary text-xs focus:outline-none focus:border-accent cursor-pointer"
                >
                  <option value="ALL">All Guest Categories</option>
                  {uniqueCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}

              {/* Clear filters shortcut */}
              {(deepFilterEmailStatus !== 'ALL' ||
                deepFilterCert !== 'ALL' ||
                deepFilterAttendance !== 'ALL' ||
                deepFilterTier !== 'ALL' ||
                deepFilterCategory !== 'ALL' ||
                deepSearchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setDeepFilterEmailStatus('ALL');
                    setDeepFilterCert('ALL');
                    setDeepFilterAttendance('ALL');
                    setDeepFilterTier('ALL');
                    setDeepFilterCategory('ALL');
                    setDeepSearchQuery('');
                  }}
                  className="px-2.5 py-1 text-accent hover:underline font-bold text-xs cursor-pointer ml-auto"
                >
                  Reset Filters
                </button>
              )}
            </div>
          </div>

          {/* Deep Dive Passes Table */}
          <div className="glass-panel rounded-3xl p-6 border border-white/15 bg-theme-card/90 shadow-2xl space-y-4">
            <div className="flex items-center justify-between text-xs text-theme-text-secondary px-1">
              <span>
                Showing <strong>{deepFilteredPasses.length}</strong> of {eventPasses.length} issued passes
              </span>
              <span className="text-[11px] font-mono">
                Click any Serial ID to view public verified credential
              </span>
            </div>

            {canSelectPasses && selectedPassIds.size > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-sky-500/10 border-y border-sky-500/30 text-xs">
                <div className="font-bold text-sky-300">
                  {selectedPassIds.size} selected
                  {(() => {
                    const noEmail = eventPasses.filter((p) => selectedPassIds.has(p.id) && !p.attendeeEmail).length;
                    return noEmail > 0 ? <span className="ml-2 font-semibold text-amber-400">· {noEmail} without an email</span> : null;
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setSelectedPassIds(new Set(deepFilteredPasses.map((p) => p.id)))} className="px-3 py-1.5 rounded-lg border border-sky-500/30 text-sky-300 font-bold hover:bg-sky-500/10 cursor-pointer">
                    Select all {deepFilteredPasses.length} in view
                  </button>
                  <button type="button" onClick={() => setSelectedPassIds(new Set())} className="px-3 py-1.5 rounded-lg text-theme-text-secondary font-bold hover:text-theme-text-primary cursor-pointer">
                    Clear
                  </button>
                  {canEditPass && (
                    <button type="button" onClick={() => setIsBulkEditOpen(true)} className="px-4 py-1.5 rounded-lg border border-indigo-400/40 text-indigo-300 hover:bg-indigo-500/10 font-black flex items-center gap-1.5 cursor-pointer">
                      <Edit3 className="h-3.5 w-3.5" /> Bulk edit
                    </button>
                  )}
                  {canDeletePass && (
                    <button type="button" disabled={isBulkDeleting} onClick={handleBulkDeletePasses} className="px-4 py-1.5 rounded-lg border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                      <Trash2 className="h-3.5 w-3.5" /> {isBulkDeleting ? 'Deleting…' : `Delete ${selectedPassIds.size}`}
                    </button>
                  )}
                  {canDispatchPass && (
                    <button type="button" onClick={() => setIsBulkDispatchOpen(true)} className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-black flex items-center gap-1.5 cursor-pointer">
                      <Send className="h-3.5 w-3.5" /> Preview &amp; dispatch
                    </button>
                  )}
                </div>
              </div>
            )}

            {deepFilteredPasses.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <Ticket className="h-10 w-10 text-theme-text-secondary/40 mx-auto" />
                <h4 className="text-sm font-bold text-theme-text-primary">No passes match your filters</h4>
                <p className="text-xs text-theme-text-secondary max-w-sm mx-auto">
                  Try changing the event dropdown, adjusting the email/view status filter, or clearing your search term.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDeepFilterEventId('ALL');
                    setDeepFilterEmailStatus('ALL');
                    setDeepFilterAttendance('ALL');
                    setDeepFilterTier('ALL');
                    setDeepFilterCategory('ALL');
                    setDeepSearchQuery('');
                  }}
                  className="px-4 py-2 bg-accent hover:bg-primary-light text-white font-bold rounded-xl text-xs transition-all cursor-pointer"
                >
                  Clear All Filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/90 dark:border-white/10 text-theme-text-secondary text-[11px] uppercase tracking-wider">
                      {canSelectPasses && <th className="py-3 px-3 w-8">
                        <input
                          type="checkbox"
                          aria-label="Select all passes in this view"
                          checked={deepFilteredPasses.length > 0 && deepFilteredPasses.every((p) => selectedPassIds.has(p.id))}
                          ref={(el) => {
                            if (el) {
                              const n = deepFilteredPasses.filter((p) => selectedPassIds.has(p.id)).length;
                              el.indeterminate = n > 0 && n < deepFilteredPasses.length;
                            }
                          }}
                          onChange={(e) =>
                            setSelectedPassIds((prev) => {
                              const next = new Set(prev);
                              deepFilteredPasses.forEach((p) => (e.target.checked ? next.add(p.id) : next.delete(p.id)));
                              return next;
                            })
                          }
                          className="h-4 w-4 accent-sky-500 cursor-pointer"
                        />
                      </th>}
                      <SortableTh label="Serial ID" columnKey="serial" sort={deepSort.sort} onToggle={deepSort.toggle} />
                      <SortableTh label="Attendee & Details" columnKey="name" sort={deepSort.sort} onToggle={deepSort.toggle} />
                      <SortableTh label="Room / Venue" columnKey="venue" sort={deepSort.sort} onToggle={deepSort.toggle} />
                      <SortableTh label="Event" columnKey="event" sort={deepSort.sort} onToggle={deepSort.toggle} />
                      <SortableTh label="Pass Tier" columnKey="tier" sort={deepSort.sort} onToggle={deepSort.toggle} />
                      <SortableTh label="Email & Pass View Status" columnKey="email" sort={deepSort.sort} onToggle={deepSort.toggle} />
                      {certAllowed && <SortableTh label="Certificate" columnKey="cert" sort={deepSort.sort} onToggle={deepSort.toggle} />}
                      <SortableTh label="Gate Turnstile" columnKey="gate" sort={deepSort.sort} onToggle={deepSort.toggle} />
                      <SortableTh label="Issued By" columnKey="issuedBy" sort={deepSort.sort} onToggle={deepSort.toggle} />
                      <SortableTh label="Issued On" columnKey="issuedAt" sort={deepSort.sort} onToggle={deepSort.toggle} />
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/50 dark:divide-white/5">
                    {deepGroups.flatMap((g) => [
                      g.showHeader ? (
                        <tr key={`grp-${g.eventId}`} className="bg-slate-100/70 dark:bg-white/5">
                          <td colSpan={(canSelectPasses ? 12 : 11) + (certAllowed ? 1 : 0)} className="py-2.5 px-4">
                            <div className="flex flex-wrap items-center gap-3">
                              {canSelectPasses && (
                                <input
                                  type="checkbox"
                                  aria-label={`Select all passes of ${g.eventName}`}
                                  checked={g.passes.every((p) => selectedPassIds.has(p.id))}
                                  onChange={(e) =>
                                    setSelectedPassIds((prev) => {
                                      const next = new Set(prev);
                                      g.passes.forEach((p) => (e.target.checked ? next.add(p.id) : next.delete(p.id)));
                                      return next;
                                    })
                                  }
                                  className="h-4 w-4 accent-sky-500 cursor-pointer"
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => setToggledGroups((prev) => { const n = new Set(prev); if (n.has(g.eventId)) n.delete(g.eventId); else n.add(g.eventId); return n; })}
                                className="flex items-center gap-2 font-black text-theme-text-primary text-xs cursor-pointer"
                                aria-expanded={g.open}
                              >
                                <span className="text-[10px]">{g.open ? '▼' : '▶'}</span>
                                {g.eventName}
                              </button>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${g.done ? 'bg-slate-500/15 text-slate-500 border-slate-500/30' : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'}`}>
                                {g.done ? 'Completed' : 'Live / upcoming'}
                              </span>
                              <span className="text-[11px] text-theme-text-secondary">
                                {g.passes.length} pass{g.passes.length === 1 ? '' : 'es'}
                                {g.done ? ` · ${g.attended} attended · ` : ' · '}
                                {g.done ? <span className={g.absent > 0 ? 'text-rose-500 font-bold' : ''}>{g.absent} absent</span> : `${g.attended} checked in`}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ) : null,
                      ...(g.open ? g.passes : []).map((pass) => (
                      <tr key={pass.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                        {canSelectPasses && (<td className="py-3 px-3 w-8">
                          <input
                            type="checkbox"
                            aria-label={`Select ${pass.attendeeName}`}
                            checked={selectedPassIds.has(pass.id)}
                            onChange={(e) =>
                              setSelectedPassIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(pass.id);
                                else next.delete(pass.id);
                                return next;
                              })
                            }
                            className="h-4 w-4 accent-sky-500 cursor-pointer"
                          />
                        </td>)}

                        {/* Serial ID */}
                        <td className="py-3 px-4 font-mono font-bold">
                          <a
                            href={`/pass/${pass.serialNumber}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-500 dark:text-sky-400 hover:text-sky-300 hover:underline inline-flex items-center gap-1 group"
                            title={`Open verified pass on portal (${pass.serialNumber})`}
                          >
                            <span>{pass.serialNumber}</span>
                            <ExternalLink className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                          </a>
                        </td>

                        {/* Attendee Details */}
                        <td className="py-3 px-4">
                          <div className="font-bold text-theme-text-primary text-sm">{pass.attendeeName}</div>
                          {pass.approvalStatus && (
                            <div
                              className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[9px] font-bold text-warning"
                              title={`Submitted by ${pass.submittedBy || 'a member'}${pass.approvalPolicyName ? ` under "${pass.approvalPolicyName}"` : ''}`}
                            >
                              ⏳ {pass.approvalStatus === 'pending_create' ? 'Issue' : pass.approvalStatus === 'pending_edit' ? 'Edit' : 'Delete'} awaiting {pass.approverName || 'approval'}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            {pass.guestCategory && (
                              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-accent/15 text-accent border border-accent/25">
                                {pass.guestCategory}
                              </span>
                            )}
                            {pass.attendeeOrg && (
                              <span className="text-[10px] text-theme-text-secondary truncate max-w-[160px]">
                                {pass.attendeeOrg}
                              </span>
                            )}
                          </div>
                          {pass.attendeeEmail && (
                            <div className="text-[10px] text-theme-text-secondary font-mono mt-0.5 truncate max-w-[200px]">
                              {pass.attendeeEmail}
                            </div>
                          )}
                        </td>

                        {/* Room / Venue */}
                        <td className="py-3 px-4 min-w-[140px] max-w-[220px] align-top">
                          <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-start gap-1 min-w-0">
                            <MapPin className="h-3 w-3 text-accent shrink-0 mt-0.5" />
                            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{pass.roomOrVenue || pass.eventVenue || 'Main Auditorium'}</span>
                          </span>
                        </td>

                        {/* Event */}
                        <td className="py-3 px-4 text-theme-text-secondary max-w-[180px] truncate">
                          <div className="font-medium text-theme-text-primary truncate">{pass.eventName}</div>
                          {pass.validityDate && (
                            <div className="text-[10px] text-theme-text-secondary">{pass.validityDate}</div>
                          )}
                        </td>

                        {/* Pass Tier */}
                        <td className="py-3 px-4">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-accent/15 text-accent border border-accent/30">
                            {pass.passType}
                          </span>
                        </td>

                        {/* Email & Pass View Status (Core Feature) */}
                        <td className="py-3 px-4">
                          {renderEmailViewBadge(pass)}
                        </td>

                        {/* Certificate: issued / sent, and when */}
                        {certAllowed && (
                          <td className="py-3 px-4">
                            <CertificateStatusBadge
                              status={certStatuses[pass.id]?.status || 'Not issued'}
                              sentAt={certStatuses[pass.id]?.sentAt}
                              issuedAt={certStatuses[pass.id]?.issuedAt}
                              sentBy={certStatuses[pass.id]?.sentBy}
                              error={certStatuses[pass.id]?.error}
                              count={certStatuses[pass.id]?.count}
                              typeName={certStatuses[pass.id]?.typeName}
                            />
                          </td>
                        )}

                        {/* Turnstile Gate Status */}
                        <td className="py-3 px-4">
                          {gateBadge(pass)}
                          {pass.checkedInAt && (
                            <div className="text-[9px] text-theme-text-secondary mt-0.5 font-mono">
                              {new Date(pass.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by {pass.checkedInBy || 'Staff'}
                            </div>
                          )}
                        </td>

                        {/* Issued By */}
                        <td className="py-3 px-4 text-theme-text-secondary text-[11px]">
                          <div>{pass.issuedBy}</div>
                        </td>

                        {/* Issued On */}
                        <td className="py-3 px-4 text-theme-text-secondary text-[11px] whitespace-nowrap">
                          {pass.issuedAt && !isNaN(Date.parse(pass.issuedAt))
                            ? new Date(pass.issuedAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* View Live Pass */}
                            <a
                              href={`/pass/${pass.serialNumber}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                              title={`View pass for ${pass.attendeeName}`}
                            >
                              <Eye className="h-3 w-3" />
                              <span>View</span>
                            </a>

                            {/* 1-Click Dispatch Email */}
                            {canDispatchPass && (
                            <button
                              type="button"
                              disabled={dispatchingPassId === pass.id || pass.approvalStatus === 'pending_create'}
                              onClick={() => handleDispatchSinglePass(pass)}
                              className="p-1.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-sky-500/30 rounded-lg text-[10px] font-bold transition-all cursor-pointer disabled:opacity-50"
                              title={
                                pass.emailStatus === 'Pass Viewed' || pass.emailStatus === 'Email Sent'
                                  ? `Resend Pass Email to ${pass.attendeeEmail || pass.attendeeName}`
                                  : `Dispatch Pass Email to ${pass.attendeeEmail || pass.attendeeName}`
                              }
                            >
                              {dispatchingPassId === pass.id ? (
                                <span className="h-3 w-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin block" />
                              ) : (
                                <Send className="h-3 w-3" />
                              )}
                            </button>
                            )}

                            {/* Admit / Check-in */}
                            {pass.status !== 'Checked In' && (
                              <button
                                type="button"
                                onClick={() => {
                                  updateEventPassStatus(pass.id, 'Checked In', user?.name || 'Staff');
                                  setEventPasses(getEventPasses());
                                  triggerSuccess(`Admitted ${pass.attendeeName} at turnstile!`);
                                }}
                                className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                              >
                                Admit
                              </button>
                            )}

                            {/* Push notification */}
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPushPass(pass);
                                setIsPushModalOpen(true);
                              }}
                              className="p-1.5 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/25 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                              title="Send Lock-Screen Push Alert to this Attendee"
                            >
                              <Bell className="h-3 w-3" />
                            </button>

                            {/* Edit Pass */}
                            {canEditPass && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedEditPass(pass);
                                  setIsEditModalOpen(true);
                                }}
                                className="p-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 border border-indigo-500/30 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                                title={`Edit pass details for ${pass.attendeeName}`}
                              >
                                <Edit3 className="h-3 w-3" />
                              </button>
                            )}

                            {/* Copy Serial */}
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(pass.serialNumber);
                                triggerSuccess(`Copied serial ${pass.serialNumber}`);
                              }}
                              className="px-2 py-1 bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/20 text-slate-800 dark:text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                              title="Copy Serial ID"
                            >
                              Copy ID
                            </button>

                            {/* Delete Pass */}
                            {canDeletePass && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Delete pass ${pass.serialNumber} for ${pass.attendeeName}? This cannot be undone.`
                                    )
                                  ) {
                                    deleteEventPass(pass.id, user?.name || 'Staff');
                                    setEventPasses(getEventPasses());
                                    triggerSuccess(`Deleted pass ${pass.serialNumber}.`);
                                  }
                                }}
                                className="p-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-500 dark:text-rose-400 border border-rose-500/30 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                                title={`Delete pass for ${pass.attendeeName}`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )),
                    ])}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: GATE TURNSTILE SCANNER */}
      {/* TAB: CERTIFICATES — design, preview, compose the email, send or schedule */}
      {activeTab === 'certificates' && canSeeCertLedger && (
        <div className="animate-in fade-in duration-300 space-y-6">
          {canCertificates && (
            <CertificateModal
              inline
              isOpen
              onClose={() => setActiveTab(canViewIssued ? 'passes' : canManagePasses ? 'studio' : 'certificates')}
              events={events}
              initialEventId={deepFilterEventId !== 'ALL' ? deepFilterEventId : passFilterEventId}
              canEditDesign={canDesignCerts}
              canSend={canSendCerts}
              canPickMembers={canViewFullDirectory(user)}
            />
          )}
          {/* Issued certificates, grouped per event like the Events page */}
          <IssuedCertificatesPanel canDelete={canDeleteCertificates(user)} canSend={canSendCerts} />
        </div>
      )}

      {activeTab === 'scanner' && canScanPasses && (
        <div className="animate-in fade-in duration-300">
          <EventPassScanner
            currentUserName={user?.name || 'Staff'}
            onPassCheckedIn={(pass) => {
              setEventPasses(getEventPasses());
              triggerSuccess(`Turnstile Verified: ${pass.attendeeName} (${pass.passType}) admitted!`);
            }}
          />
        </div>
      )}

      {/* EDIT PASS MODAL */}
      <EventPassEditModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedEditPass(null);
        }}
        pass={selectedEditPass}
        events={events}
        currentUserName={user?.name || 'Staff'}
        onPassUpdated={(updated) => {
          setEventPasses(getEventPasses());
          triggerSuccess(`Updated pass for ${updated.attendeeName} (${updated.serialNumber}) — Apple & Google Wallet sync triggered.`);
        }}
      />

      {/* PUSH ALERT NOTIFICATION MODAL */}
      <EventPassBulkDispatchModal
        isOpen={isBulkDispatchOpen}
        passes={eventPasses.filter((p) => selectedPassIds.has(p.id))}
        onClose={() => setIsBulkDispatchOpen(false)}
        onDone={() => setEventPasses(getEventPasses())}
      />

      <EventPassBulkEditModal
        isOpen={isBulkEditOpen}
        passes={eventPasses.filter((p) => selectedPassIds.has(p.id))}
        events={events}
        currentUserName={user?.name || 'Admin'}
        onClose={() => setIsBulkEditOpen(false)}
        onDone={() => setEventPasses(getEventPasses())}
      />

      <EventPassPushModal
        isOpen={isPushModalOpen}
        onClose={() => {
          setIsPushModalOpen(false);
          setSelectedPushPass(null);
        }}
        eventId={
          activeTab === 'passes' && deepFilterEventId !== 'ALL'
            ? deepFilterEventId
            : passFilterEventId !== 'ALL'
            ? passFilterEventId
            : events[0]?.id || ''
        }
        eventName={
          (activeTab === 'passes' && deepFilterEventId !== 'ALL'
            ? events.find((e) => e.id === deepFilterEventId)?.title
            : passFilterEventId !== 'ALL'
            ? events.find((e) => e.id === passFilterEventId)?.title
            : events[0]?.title) || 'RTBI Official Event'
        }
        passes={
          activeTab === 'passes' && deepFilterEventId !== 'ALL'
            ? eventPasses.filter((p) => p.eventId === deepFilterEventId)
            : passFilterEventId !== 'ALL'
            ? eventPasses.filter((p) => p.eventId === passFilterEventId)
            : eventPasses
        }
        initialSelectedPass={selectedPushPass}
        onBroadcastSuccess={() => triggerSuccess('Push notification alert sent to pass holders!')}
      />
    </div>
  );
}
