'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  UserCheck,
  Check,
  X,
  Clock,
  Inbox,
  Send,
  CheckSquare,
  Calendar,
  Users,
  Palette,
  FileText,
  Megaphone,
  Eye,
  ExternalLink,
  MapPin,
  Tag,
  Paperclip,
  Info,
  ChevronRight,
  Sparkles,
  LayoutTemplate,
  History,
  Ticket
} from 'lucide-react';
import {
  getApprovalRequests,
  saveApprovalRequests,
  decideApprovalRequest,
  deleteApprovalRequest,
  approveTask,
  rejectTask,
  approveEvent,
  rejectEvent,
  approveAnnouncement,
  rejectAnnouncement,
  approveForm,
  rejectForm,
  approveEventReport,
  rejectEventReport,
  getTasks,
  getDesigns,
  getEvents,
  getAnnouncements,
  getEventReports,
  getForms,
  getMembers,
  ApprovalRequest,
  TaskItem,
  DesignSubmissionItem,
  EventItem,
  AnnouncementItem,
  EventReportItem,
  PublicFormItem,
  Member,
} from '@/lib/local-data';
import { isEventsHeadGgCampus } from '@/lib/permissions';
import { EmptyState } from '@/components/ui/empty-state';
import { decideProposal } from '@/lib/proposals-client';

type Tab = 'inbox' | 'sent' | 'decided';

const entityIcon = (type: ApprovalRequest['entityType']) => {
  if (type === 'task') return CheckSquare;
  if (type === 'event') return Calendar;
  if (type === 'design') return Palette;
  if (type === 'event-report') return FileText;
  if (type === 'announcement') return Megaphone;
  if (type === 'proposal') return FileText;
  if (type === 'form') return LayoutTemplate;
  if (type === 'event-pass') return Ticket;
  return Users;
};

const entityLink = (req: ApprovalRequest) => {
  if (req.entityType === 'task') return '/dashboard/tasks';
  if (req.entityType === 'event') return `/dashboard/events/${req.entityId}`;
  if (req.entityType === 'member') return '/dashboard/directory';
  if (req.entityType === 'design') return '/dashboard/designs';
  if (req.entityType === 'event-report') return '/dashboard/event-reports';
  if (req.entityType === 'announcement') return '/dashboard/announcements';
  if (req.entityType === 'proposal') return `/dashboard/proposals?highlight=${req.entityId}`;
  if (req.entityType === 'form') return '/dashboard/forms';
  if (req.entityType === 'event-pass') return '/dashboard/event-passes';
  return req.eventId ? `/dashboard/events/${req.eventId}` : '/dashboard/events';
};

const statusBadge = (status: ApprovalRequest['status']) => {
  if (status === 'approved') return 'bg-success/15 text-success border-success/30';
  if (status === 'rejected') return 'bg-danger/15 text-danger border-danger/30';
  return 'bg-warning/15 text-warning border-warning/30';
};

export default function ApprovalsPage() {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [user, setUser] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('inbox');
  const [successMsg, setSuccessMsg] = useState('');
  const [decisionNoteFor, setDecisionNoteFor] = useState<{ id: string; decision: 'approved' | 'rejected' } | null>(null);
  const [decisionNoteInput, setDecisionNoteInput] = useState('');
  const [overviewModalRequest, setOverviewModalRequest] = useState<ApprovalRequest | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [hasScrolled, setHasScrolled] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const target = params.get('id') || params.get('highlight') || params.get('entityId');
      if (target) setHighlightId(target);
    }
  }, []);

  useEffect(() => {
    if (!highlightId || hasScrolled || requests.length === 0) return;
    const el = document.getElementById(`appr-${highlightId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHasScrolled(true);
    }
  }, [highlightId, hasScrolled, requests]);

  const [entitiesData, setEntitiesData] = useState<{
    tasks: TaskItem[];
    designs: DesignSubmissionItem[];
    events: EventItem[];
    announcements: AnnouncementItem[];
    eventReports: EventReportItem[];
    members: Member[];
    forms: PublicFormItem[];
  }>({
    tasks: [],
    designs: [],
    events: [],
    announcements: [],
    eventReports: [],
    members: [],
    forms: [],
  });

  useEffect(() => {
    const refreshData = () => {
      const allReqs = getApprovalRequests();
      const tasks = getTasks();
      const designs = getDesigns();
      const events = getEvents();
      const announcements = getAnnouncements();
      const eventReports = getEventReports();
      const members = getMembers();
      const forms = getForms();

      setEntitiesData({
        tasks,
        designs,
        events,
        announcements,
        eventReports,
        members,
        forms,
      });

      // Filter out any orphaned requests referencing entities that were deleted
      const valid = allReqs.filter(r => {
        if (r.entityType === 'task') return tasks.some(t => t.id === r.entityId);
        if (r.entityType === 'design') return designs.some(d => d.id === r.entityId);
        if (r.entityType === 'event') return events.some(e => e.id === r.entityId);
        if (r.entityType === 'announcement') return announcements.some(a => a.id === r.entityId);
        if (r.entityType === 'event-report') return eventReports.some(er => er.id === r.entityId);
        if (r.entityType === 'form') return forms.some(f => f.id === r.entityId);
        if (r.entityType === 'member') return members.some(m => m.id === r.entityId);
        if (r.entityType === 'committee') {
          return events.some(e => e.committees?.some(c => c.id === r.entityId));
        }
        return true;
      });

      if (valid.length !== allReqs.length) {
        saveApprovalRequests(valid);
      }
      setRequests(valid);
    };
    refreshData();

    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error(e);
      }
    }

    window.addEventListener('leads-data-sync', refreshData);
    window.addEventListener('storage', refreshData);
    return () => {
      window.removeEventListener('leads-data-sync', refreshData);
      window.removeEventListener('storage', refreshData);
    };
  }, []);

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const isSuperUser = user?.tier === 1;
  const inboxRequestsRaw = requests.filter(r => user && (r.targetMemberId === user.id || isSuperUser));

  const inboxRequests = isSuperUser
    ? Object.values(
        inboxRequestsRaw.reduce((acc: Record<string, ApprovalRequest>, r) => {
          const key = r.autoGenerated ? `${r.entityType}:${r.entityId}` : r.id;
          if (!acc[key] || (acc[key].status !== 'pending' && r.status === 'pending')) acc[key] = r;
          return acc;
        }, {})
      )
    : inboxRequestsRaw;
  // "Awaiting My Decision" only ever shows what's actually still pending —
  // an already-approved/rejected request moves to the "Decided" tab instead
  // of lingering in the same list and cluttering it.
  const pendingInbox = inboxRequests.filter(r => r.status === 'pending');
  const decidedInbox = [...inboxRequests.filter(r => r.status !== 'pending')]
    .sort((a, b) => (b.decidedAt || '').localeCompare(a.decidedAt || ''));
  const sentRequests = requests.filter(r => user && r.requesterId === user.id);
  const list = tab === 'inbox' ? pendingInbox : tab === 'decided' ? decidedInbox : sentRequests;
  const pendingInboxCount = pendingInbox.length;

  const directlyResolvable = (type: ApprovalRequest['entityType']) => type === 'task' || type === 'event' || type === 'announcement' || type === 'form' || type === 'event-report' || type === 'event-pass' || type === 'proposal';

  const handleDecide = (id: string, decision: 'approved' | 'rejected', note?: string) => {
    const req = requests.find(r => r.id === id);
    const actorName = user?.name || 'User';

    if (req?.autoGenerated && directlyResolvable(req.entityType)) {
      if (req.entityType === 'task') {
        decision === 'approved' ? approveTask(req.entityId, actorName, note) : rejectTask(req.entityId, actorName, note);
      } else if (req.entityType === 'event') {
        decision === 'approved' ? approveEvent(req.entityId, actorName, note) : rejectEvent(req.entityId, actorName, note);
      } else if (req.entityType === 'announcement') {
        decision === 'approved' ? approveAnnouncement(req.entityId, actorName, note) : rejectAnnouncement(req.entityId, actorName);
      } else if (req.entityType === 'proposal') {
        // Proposals live behind a permission-checked API, not localStorage — decide it server-side.
        decideProposal(req.entityId, decision === 'approved' ? 'Approved' : 'Rejected', note).catch(err => console.error('[approvals] proposal decision failed:', err));
      } else if (req.entityType === 'form') {
        decision === 'approved' ? approveForm(req.entityId, actorName, note) : rejectForm(req.entityId, actorName, note);
      } else if (req.entityType === 'event-report') {
        const as = (req.approverLabel?.toLowerCase().includes('gg') || (user && isEventsHeadGgCampus(user))) ? 'gg_events_head' : 'centre_head';
        decision === 'approved' ? approveEventReport(req.entityId, as, actorName, note) : rejectEventReport(req.entityId, actorName, note);
      }
    }
    decideApprovalRequest(id, decision, actorName, note);

    setDecisionNoteFor(null);
    setDecisionNoteInput('');
    setOverviewModalRequest(null);
    triggerSuccess(decision === 'approved' ? 'Request approved.' : 'Request rejected.');
  };

  const handleWithdraw = (id: string) => {
    deleteApprovalRequest(id, user?.name || 'User');
    setOverviewModalRequest(null);
    triggerSuccess('Request withdrawn.');
  };

  // Helper to resolve entity payload for inspection
  const getEntityForReq = (req: ApprovalRequest) => {
    if (req.entityType === 'announcement') {
      return { type: 'announcement' as const, item: entitiesData.announcements.find(a => a.id === req.entityId) };
    }
    if (req.entityType === 'task') {
      return { type: 'task' as const, item: entitiesData.tasks.find(t => t.id === req.entityId) };
    }
    if (req.entityType === 'event') {
      return { type: 'event' as const, item: entitiesData.events.find(e => e.id === req.entityId) };
    }
    if (req.entityType === 'design') {
      return { type: 'design' as const, item: entitiesData.designs.find(d => d.id === req.entityId) };
    }
    if (req.entityType === 'event-report') {
      return { type: 'event-report' as const, item: entitiesData.eventReports.find(er => er.id === req.entityId) };
    }
    if (req.entityType === 'form') {
      return { type: 'form' as const, item: entitiesData.forms.find(f => f.id === req.entityId) };
    }
    if (req.entityType === 'member') {
      return { type: 'member' as const, item: entitiesData.members.find(m => m.id === req.entityId) };
    }
    if (req.entityType === 'committee') {
      let matchedComm: any = null;
      let matchedEvent: EventItem | undefined;
      for (const e of entitiesData.events) {
        const c = e.committees?.find(cm => cm.id === req.entityId);
        if (c) {
          matchedComm = c;
          matchedEvent = e;
          break;
        }
      }
      return { type: 'committee' as const, item: matchedComm, event: matchedEvent };
    }
    return { type: 'unknown' as const, item: null };
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-success/15 border border-success/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <Check className="h-5 w-5 text-success shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-theme-text-primary flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-accent" />
          Approvals
        </h1>
        <p className="text-xs text-theme-text-secondary">Requests to sign off on announcements, tasks, events, designs, or committee rosters</p>
      </div>

      <div className="flex items-center gap-2 border-b border-theme-border/20">
        <button
          onClick={() => setTab('inbox')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all cursor-pointer ${tab === 'inbox' ? 'border-accent text-accent' : 'border-transparent text-theme-text-secondary hover:text-theme-text-primary'}`}
        >
          <Inbox className="h-3.5 w-3.5" />
          Awaiting My Decision
          {pendingInboxCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent text-white text-[10px] font-bold">{pendingInboxCount}</span>
          )}
        </button>
        <button
          onClick={() => setTab('sent')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all cursor-pointer ${tab === 'sent' ? 'border-accent text-accent' : 'border-transparent text-theme-text-secondary hover:text-theme-text-primary'}`}
        >
          <Send className="h-3.5 w-3.5" />
          Sent By Me
        </button>
        <button
          onClick={() => setTab('decided')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-all cursor-pointer ${tab === 'decided' ? 'border-accent text-accent' : 'border-transparent text-theme-text-secondary hover:text-theme-text-primary'}`}
        >
          <History className="h-3.5 w-3.5" />
          Decided
          {decidedInbox.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-theme-border/40 text-theme-text-secondary text-[10px] font-bold">{decidedInbox.length}</span>
          )}
        </button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title={tab === 'inbox' ? 'Nothing waiting on you' : tab === 'decided' ? 'No decided requests yet' : 'No requests sent yet'}
          description={
            tab === 'inbox'
              ? "When a member asks you to approve an announcement, task, committee, or event, it'll show up here."
              : tab === 'decided'
                ? 'Requests you\'ve approved or rejected will move here, out of your Awaiting My Decision list.'
                : 'Use the "Request Approval" button on an announcement, task, committee, or event to ask a member to sign off on it.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {list.map(req => {
            const Icon = entityIcon(req.entityType);
            const entityResolved = getEntityForReq(req);
            const isHighlighted = highlightId && (req.id === highlightId || req.entityId === highlightId);
            
            return (
              <div
                key={req.id}
                id={`appr-${req.id}`}
                className={`glass-panel rounded-2xl p-4 space-y-3 text-xs flex flex-col justify-between transition-all duration-200 ${
                  isHighlighted ? 'border-accent ring-2 ring-accent/50 bg-accent/5' : 'border border-theme-border/20 hover:border-accent/40'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <div className="p-2 rounded-xl bg-accent/15 text-accent shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => setOverviewModalRequest(req)}
                            className="font-bold text-theme-text-primary hover:text-accent transition-all text-left cursor-pointer"
                          >
                            {req.entityTitle}
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-accent font-semibold uppercase tracking-wider bg-accent/10 px-1.5 py-0.5 rounded">
                            {req.entityType}
                          </span>
                          {req.approverLabel && (
                            <span className="text-[10px] text-theme-text-secondary">
                              ({req.approverLabel})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusBadge(req.status)} shrink-0`}>
                      {req.status === 'pending' ? 'Pending' : req.status === 'approved' ? 'Approved' : 'Rejected'}
                    </span>
                  </div>

                  {/* Requester Context */}
                  <p className="text-theme-text-secondary text-[11px]">
                    {tab === 'sent' ? (
                      <>Sent to <span className="font-semibold text-theme-text-primary">{req.targetMemberName}</span> for approval.</>
                    ) : req.status === 'pending' ? (
                      <><span className="font-semibold text-theme-text-primary">{req.requesterName}</span> is asking you to approve this.</>
                    ) : (
                      <><span className="font-semibold text-theme-text-primary">{req.requesterName}</span> asked you to approve this.</>
                    )}
                  </p>

                  {/* Rich Entity Content Preview */}
                  {entityResolved.item && (
                    <div 
                      onClick={() => setOverviewModalRequest(req)}
                      className="p-3 bg-theme-background/50 hover:bg-theme-background/70 border border-theme-border/25 rounded-xl space-y-1.5 cursor-pointer transition-colors group"
                      title="Click to view detailed overview"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-1">
                          <Info className="h-3 w-3 text-accent" /> Overview Preview
                        </span>
                        <span className="text-[10px] text-accent group-hover:underline flex items-center gap-0.5 font-medium">
                          View details <ChevronRight className="h-3 w-3" />
                        </span>
                      </div>

                      {/* Announcement Preview */}
                      {entityResolved.type === 'announcement' && (
                        <div className="space-y-1 text-theme-text-primary">
                          <div className="flex items-center gap-2 text-[10px] text-theme-text-secondary">
                            <span className="px-1.5 py-0.5 rounded bg-theme-border/30 text-theme-text-primary font-medium">
                              Scope: {entityResolved.item.scope}
                            </span>
                            {entityResolved.item.authorName && (
                              <span>By {entityResolved.item.authorName}</span>
                            )}
                          </div>
                          <p className="line-clamp-2 text-theme-text-primary text-[11px] leading-relaxed font-normal italic">
                            "{entityResolved.item.content}"
                          </p>
                        </div>
                      )}

                      {/* Task Preview */}
                      {entityResolved.type === 'task' && (
                        <div className="space-y-1 text-[11px]">
                          <div className="flex items-center gap-2 text-[10px] text-theme-text-secondary flex-wrap">
                            {entityResolved.item.dueDate && <span>Due: {entityResolved.item.dueDate}</span>}
                            {entityResolved.item.assignee && <span>Assignee: {entityResolved.item.assignee}</span>}
                            {entityResolved.item.event && <span className="text-accent">({entityResolved.item.event})</span>}
                          </div>
                          {entityResolved.item.briefDescription && (
                            <p className="line-clamp-2 text-theme-text-primary text-[11px] italic">
                              "{entityResolved.item.briefDescription}"
                            </p>
                          )}
                          {entityResolved.item.attachments && entityResolved.item.attachments.length > 0 && (
                            <div className="flex items-center gap-1 text-[10px] text-theme-text-secondary pt-0.5">
                              <Paperclip className="h-3 w-3 text-accent" /> {entityResolved.item.attachments.length} attachment(s)
                            </div>
                          )}
                        </div>
                      )}

                      {/* Event Preview */}
                      {entityResolved.type === 'event' && (
                        <div className="space-y-1 text-[11px]">
                          <div className="flex items-center gap-2 text-[10px] text-theme-text-secondary flex-wrap">
                            <span>
                              {entityResolved.item.datesTBD ? 'Dates TBD' : `${entityResolved.item.startDate} ${entityResolved.item.endDate ? `to ${entityResolved.item.endDate}` : ''}`}
                            </span>
                            {entityResolved.item.location && <span>• {entityResolved.item.location}</span>}
                            {entityResolved.item.campus && <span>({entityResolved.item.campus})</span>}
                          </div>
                          {entityResolved.item.description && (
                            <p className="line-clamp-2 text-theme-text-primary text-[11px]">
                              {entityResolved.item.description}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Design Preview */}
                      {entityResolved.type === 'design' && (
                        <div className="space-y-1 text-[11px]">
                          <div className="flex items-center gap-2 text-[10px] text-theme-text-secondary flex-wrap">
                            <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent font-semibold">{entityResolved.item.category}</span>
                            <span>By {entityResolved.item.designerName}</span>
                            {entityResolved.item.eventName && <span>• {entityResolved.item.eventName}</span>}
                          </div>
                          {entityResolved.item.description && (
                            <p className="line-clamp-2 text-theme-text-primary text-[11px]">
                              {entityResolved.item.description}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Event Report Preview */}
                      {entityResolved.type === 'event-report' && (
                        <div className="space-y-1 text-[11px]">
                          <div className="flex items-center gap-2 text-[10px] text-theme-text-secondary flex-wrap">
                            <span>Event: {entityResolved.item.eventTitle}</span>
                            <span>• Submitter: {entityResolved.item.submittedBy}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-theme-text-primary">
                            <FileText className="h-3.5 w-3.5 text-accent shrink-0" />
                            <span className="truncate">{entityResolved.item.fileName}</span>
                            <span className="text-[10px] text-theme-text-secondary">({(entityResolved.item.fileSize / 1024).toFixed(0)} KB)</span>
                          </div>
                        </div>
                      )}

                      {/* Member Preview */}
                      {entityResolved.type === 'member' && (
                        <div className="space-y-1 text-[11px]">
                          <div className="flex items-center gap-2 text-[10px] text-theme-text-secondary flex-wrap">
                            <span className="font-semibold text-theme-text-primary">{entityResolved.item.role}</span>
                            <span>• {entityResolved.item.division}</span>
                            {entityResolved.item.department && <span>({entityResolved.item.department})</span>}
                          </div>
                        </div>
                      )}

                      {/* Committee Preview */}
                      {entityResolved.type === 'committee' && entityResolved.item && (
                        <div className="space-y-1 text-[11px]">
                          <div className="flex items-center gap-2 text-[10px] text-theme-text-secondary flex-wrap">
                            <span>Lead: {entityResolved.item.leadName || 'Unassigned'}</span>
                            {entityResolved.event && <span>• Event: {entityResolved.event.title}</span>}
                            <span>• {entityResolved.item.members?.length || 0} Members</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {req.message && (
                    <p className="bg-theme-background/30 border-l-2 border-accent/40 px-3 py-2 rounded-lg text-theme-text-secondary italic text-[11px]">
                      "{req.message}"
                    </p>
                  )}

                  {req.status !== 'pending' && req.decisionNote && (
                    <p className="bg-theme-background/30 border-l-2 border-theme-border/40 px-3 py-2 rounded-lg text-theme-text-secondary text-[11px]">
                      Note: {req.decisionNote}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-theme-border/20 mt-2">
                  <span className="flex items-center gap-1 text-[10px] text-theme-text-secondary">
                    <Clock className="h-3 w-3" />
                    {new Date(req.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setOverviewModalRequest(req)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-theme-border/20 hover:bg-theme-border/40 text-theme-text-primary font-semibold rounded-lg transition-all text-[11px] cursor-pointer"
                      title="Inspect full overview"
                    >
                      <Eye className="h-3 w-3 text-accent" /> Overview
                    </button>

                    {tab === 'inbox' && req.status === 'pending' && (
                      req.autoGenerated && !directlyResolvable(req.entityType) ? (
                        <Link
                          href={entityLink(req)}
                          className="flex items-center gap-1 px-2.5 py-1 bg-accent/15 hover:bg-accent/25 text-accent font-semibold rounded-lg transition-all text-[11px] cursor-pointer"
                          title="This needs a full review — decide it from its own module."
                        >
                          Review <ChevronRight className="h-3 w-3" />
                        </Link>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setDecisionNoteFor({ id: req.id, decision: 'approved' })}
                            className="flex items-center gap-1 px-2.5 py-1 bg-success hover:bg-success/90 text-white font-semibold rounded-lg transition-all text-[11px] cursor-pointer"
                          >
                            <Check className="h-3 w-3" /> Approve
                          </button>
                          <button
                            onClick={() => setDecisionNoteFor({ id: req.id, decision: 'rejected' })}
                            className="flex items-center gap-1 px-2.5 py-1 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary font-semibold rounded-lg transition-all text-[11px] cursor-pointer"
                          >
                            <X className="h-3 w-3" /> Reject
                          </button>
                        </div>
                      )
                    )}

                    {tab === 'sent' && req.status === 'pending' && (
                      <button
                        onClick={() => handleWithdraw(req.id)}
                        className="px-2.5 py-1 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary font-semibold rounded-lg transition-all text-[11px] cursor-pointer"
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detailed Overview Inspection Modal */}
      {overviewModalRequest && (() => {
        const req = overviewModalRequest;
        const entityResolved = getEntityForReq(req);
        const Icon = entityIcon(req.entityType);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="glass-panel w-full max-w-2xl max-h-[90vh] rounded-3xl p-6 flex flex-col justify-between border border-white/15 shadow-2xl overflow-y-auto space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between gap-4 border-b border-theme-border/20 pb-4">
                <div className="flex items-start gap-3">
                  <div className="p-3 rounded-2xl bg-accent/15 text-accent shrink-0">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-accent font-bold uppercase tracking-wider bg-accent/15 px-2 py-0.5 rounded-md">
                        {req.entityType}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusBadge(req.status)}`}>
                        {req.status === 'pending' ? 'Pending Approval' : req.status === 'approved' ? 'Approved' : 'Rejected'}
                      </span>
                    </div>
                    <h2 className="text-lg font-bold text-theme-text-primary mt-1">{req.entityTitle}</h2>
                    <p className="text-xs text-theme-text-secondary mt-0.5">
                      Requested by <span className="font-semibold text-theme-text-primary">{req.requesterName}</span> ({req.requesterEmail || 'No email'}) • {new Date(req.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setOverviewModalRequest(null)}
                  className="p-2 rounded-xl bg-theme-border/20 hover:bg-theme-border/40 text-theme-text-primary transition-all cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Entity Deep Overview Body */}
              <div className="space-y-4">
                {/* Specific Announcement Details */}
                {entityResolved.type === 'announcement' && entityResolved.item && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Target Audience</p>
                        <p className="text-xs font-semibold text-accent mt-0.5">{entityResolved.item.scope}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Author</p>
                        <p className="text-xs font-semibold text-theme-text-primary mt-0.5">{entityResolved.item.authorName}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Publication Time</p>
                        <p className="text-xs text-theme-text-secondary mt-0.5">
                          {entityResolved.item.publishedAt ? new Date(entityResolved.item.publishedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Draft'}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-theme-background/60 border border-theme-border/40 space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-1.5">
                        <Megaphone className="h-4 w-4 text-accent" /> Announcement Content Body
                      </p>
                      <div className="text-xs text-theme-text-primary whitespace-pre-wrap leading-relaxed bg-theme-background/30 p-3.5 rounded-xl border border-theme-border/20 font-sans">
                        {entityResolved.item.content}
                      </div>
                    </div>
                  </div>
                )}

                {/* Specific Task Details */}
                {entityResolved.type === 'task' && entityResolved.item && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Assignee</p>
                        <p className="text-xs font-semibold text-theme-text-primary mt-0.5">{entityResolved.item.assignee}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Due Date</p>
                        <p className="text-xs font-semibold text-theme-text-primary mt-0.5">{entityResolved.item.dueDate || 'No deadline'}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Linked Event</p>
                        <p className="text-xs font-semibold text-accent mt-0.5">{entityResolved.item.event || 'None'}</p>
                      </div>
                    </div>

                    {entityResolved.item.briefDescription && (
                      <div className="p-4 rounded-2xl bg-theme-background/60 border border-theme-border/40 space-y-1.5">
                        <p className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Task Brief / Description</p>
                        <p className="text-xs text-theme-text-primary whitespace-pre-wrap leading-relaxed">{entityResolved.item.briefDescription}</p>
                      </div>
                    )}

                    {entityResolved.item.attachments && entityResolved.item.attachments.length > 0 && (
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30 space-y-2">
                        <p className="text-[11px] font-bold text-theme-text-secondary flex items-center gap-1.5">
                          <Paperclip className="h-3.5 w-3.5 text-accent" /> Attached Reference Files ({entityResolved.item.attachments.length})
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {entityResolved.item.attachments.map((att, idx) => (
                            <a
                              key={idx}
                              href={att.url || att.dataUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-theme-border/30 hover:bg-theme-border/50 text-xs text-accent transition-all font-medium"
                            >
                              <Paperclip className="h-3 w-3" /> {att.name}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Specific Event Details */}
                {entityResolved.type === 'event' && entityResolved.item && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Dates</p>
                        <p className="text-xs font-semibold text-theme-text-primary mt-0.5">
                          {entityResolved.item.datesTBD ? 'Dates TBD' : `${entityResolved.item.startDate} ${entityResolved.item.endDate ? `to ${entityResolved.item.endDate}` : ''}`}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Location & Campus</p>
                        <p className="text-xs font-semibold text-theme-text-primary mt-0.5">{entityResolved.item.location || 'TBD'} ({entityResolved.item.campus || 'Both'})</p>
                      </div>
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Committees</p>
                        <p className="text-xs font-semibold text-accent mt-0.5">{entityResolved.item.committees?.length || 0} formed</p>
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-theme-background/60 border border-theme-border/40 space-y-1.5">
                      <p className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Event Description</p>
                      <p className="text-xs text-theme-text-primary whitespace-pre-wrap leading-relaxed">{entityResolved.item.description || 'No description provided.'}</p>
                    </div>
                  </div>
                )}

                {/* Specific Design Details */}
                {entityResolved.type === 'design' && entityResolved.item && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Category</p>
                        <p className="text-xs font-semibold text-accent mt-0.5">{entityResolved.item.category}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Designer</p>
                        <p className="text-xs font-semibold text-theme-text-primary mt-0.5">{entityResolved.item.designerName}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Event</p>
                        <p className="text-xs font-semibold text-theme-text-primary mt-0.5">{entityResolved.item.eventName || 'Independent'}</p>
                      </div>
                    </div>

                    {entityResolved.item.fileUrl && entityResolved.item.fileType?.startsWith('image/') && (
                      <div className="p-3 rounded-2xl bg-theme-background/60 border border-theme-border/40 flex justify-center">
                        <img
                          src={entityResolved.item.fileUrl || entityResolved.item.fileData}
                          alt={entityResolved.item.title}
                          className="max-h-60 rounded-xl object-contain shadow-md"
                        />
                      </div>
                    )}

                    {entityResolved.item.description && (
                      <div className="p-4 rounded-2xl bg-theme-background/60 border border-theme-border/40 space-y-1.5">
                        <p className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Design Notes & Description</p>
                        <p className="text-xs text-theme-text-primary whitespace-pre-wrap leading-relaxed">{entityResolved.item.description}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Specific Event Report Details */}
                {entityResolved.type === 'event-report' && entityResolved.item && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Event</p>
                        <p className="text-xs font-semibold text-accent mt-0.5">{entityResolved.item.eventTitle}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">Submitted By</p>
                        <p className="text-xs font-semibold text-theme-text-primary mt-0.5">{entityResolved.item.submittedBy}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <p className="text-[10px] uppercase font-bold text-theme-text-secondary">File Size</p>
                        <p className="text-xs font-semibold text-theme-text-primary mt-0.5">{(entityResolved.item.fileSize / 1024).toFixed(0)} KB</p>
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-theme-background/60 border border-theme-border/40 space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-1.5">
                        <FileText className="h-4 w-4 text-accent" /> Attached Report File
                      </p>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-theme-background/40 border border-theme-border/30">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-accent" />
                          <div>
                            <p className="text-xs font-medium text-theme-text-primary">{entityResolved.item.fileName}</p>
                            <p className="text-[10px] text-theme-text-secondary">{entityResolved.item.fileType}</p>
                          </div>
                        </div>
                        {entityResolved.item.fileUrl && (
                          <a
                            href={entityResolved.item.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1 bg-accent/15 hover:bg-accent/25 text-accent text-xs font-semibold rounded-lg transition-all"
                          >
                            Download / View
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Requester's Personal Message */}
                {req.message && (
                  <div className="p-3.5 bg-accent/10 border-l-3 border-accent rounded-xl space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-accent">Message from Requester</p>
                    <p className="text-xs text-theme-text-primary italic">"{req.message}"</p>
                  </div>
                )}
              </div>

              {/* Action Buttons in Modal */}
              <div className="pt-4 border-t border-theme-border/20 flex items-center justify-between gap-3 flex-wrap">
                <Link
                  href={entityLink(req)}
                  className="flex items-center gap-1.5 text-xs text-accent hover:underline font-semibold"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open in {req.entityType} module
                </Link>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOverviewModalRequest(null)}
                    className="px-4 py-2 text-xs font-semibold text-theme-text-primary bg-theme-border/30 hover:bg-theme-border/50 rounded-xl transition-all cursor-pointer"
                  >
                    Close
                  </button>

                  {tab === 'inbox' && req.status === 'pending' && (
                    <>
                      <button
                        onClick={() => {
                          setDecisionNoteFor({ id: req.id, decision: 'rejected' });
                          setOverviewModalRequest(null);
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-danger/15 hover:bg-danger/25 text-danger font-semibold rounded-xl transition-all text-xs cursor-pointer border border-danger/20"
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                      <button
                        onClick={() => {
                          setDecisionNoteFor({ id: req.id, decision: 'approved' });
                          setOverviewModalRequest(null);
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-success hover:bg-success/90 text-white font-semibold rounded-xl transition-all text-xs cursor-pointer shadow-md shadow-success/20"
                      >
                        <Check className="h-3.5 w-3.5" /> Approve
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Decision Note & Confirmation Modal */}
      {decisionNoteFor && (() => {
        const reviewing = requests.find(r => r.id === decisionNoteFor.id);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl">
            <h2 className="text-base font-bold text-theme-text-primary">
              {decisionNoteFor.decision === 'approved' ? 'Approve Request' : 'Reject Request'}
            </h2>

            {reviewing && (
              <div className="space-y-2 text-xs">
                <div className="p-3 bg-theme-background/30 border border-theme-border/30 rounded-xl space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-theme-text-secondary font-bold">{reviewing.entityType}</p>
                  <p className="font-semibold text-theme-text-primary">{reviewing.entityTitle}</p>
                </div>
                <div className="p-3 bg-theme-background/30 border border-theme-border/30 rounded-xl space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-theme-text-secondary font-bold">Requested By</p>
                  <p className="font-semibold text-theme-text-primary">{reviewing.requesterName}</p>
                  {reviewing.requesterEmail && <p className="text-theme-text-secondary">{reviewing.requesterEmail}</p>}
                </div>
                {reviewing.message && (
                  <div className="p-3 bg-theme-background/30 border-l-2 border-accent/40 rounded-xl">
                    <p className="text-[10px] uppercase tracking-wide text-theme-text-secondary font-bold mb-1">What They Told You</p>
                    <p className="text-theme-text-primary italic">"{reviewing.message}"</p>
                  </div>
                )}
              </div>
            )}

            <textarea
              value={decisionNoteInput}
              onChange={(e) => setDecisionNoteInput(e.target.value)}
              rows={3}
              placeholder="Add your comments / feedback for the submitter..."
              className="w-full px-3 py-2 text-xs rounded-xl border border-theme-border/40 bg-theme-background/30 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none"
            />
            <p className="text-[11px] text-theme-text-secondary">
              Your decision and comments will be automatically emailed to {reviewing?.requesterEmail ? <span className="font-semibold text-theme-text-primary">{reviewing.requesterEmail}</span> : 'the submitter'}.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                onClick={() => { setDecisionNoteFor(null); setDecisionNoteInput(''); }}
                className="px-4 py-2.5 text-xs font-semibold text-theme-text-primary bg-theme-border/30 hover:bg-theme-border/50 rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDecide(decisionNoteFor.id, decisionNoteFor.decision, decisionNoteInput.trim() || undefined)}
                className={`px-4 py-2.5 text-xs font-semibold rounded-xl transition-all shadow-md cursor-pointer text-white ${decisionNoteFor.decision === 'approved' ? 'bg-success hover:bg-success/90 shadow-success/20' : 'bg-danger hover:bg-danger/90 shadow-danger/20'}`}
              >
                Confirm {decisionNoteFor.decision === 'approved' ? 'Approval' : 'Rejection'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
