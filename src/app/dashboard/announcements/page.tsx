'use client';

import React, { useState, useEffect } from 'react';
import {
  Megaphone,
  Plus,
  X,
  CheckCircle,
  Play,
  Terminal,
  Edit2,
  Trash2,
  Info,
  Clock,
  Search,
  Users,
  CheckSquare,
  Square,
  Calendar,
  UserCheck
} from 'lucide-react';
import { 
  getAnnouncements, 
  addAnnouncement, 
  updateAnnouncement, 
  deleteAnnouncement,
  approveAnnouncement,
  rejectAnnouncement,
  getMembers, 
  getEvents,
  getTasks,
  isApprovedEvent,
  getCommittees, 
  AnnouncementItem, 
  Member,
  EventItem,
  TaskItem
} from '@/lib/local-data';
import { isCentreHead, canCreateAnnouncement, canApproveAnnouncement, canDeleteAnnouncement } from '@/lib/permissions';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchableSelect } from '@/components/searchable-select';

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [committees, setCommittees] = useState<string[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [user, setUser] = useState<any>(null);

  // Modals & Active Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<AnnouncementItem | null>(null);
  const [deletingAnnouncementId, setDeletingAnnouncementId] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [targetCategory, setTargetCategory] = useState<string>('All Members');
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [selectedCommitteeId, setSelectedCommitteeId] = useState<string>('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberQuery, setMemberQuery] = useState<string>('');
  
  // Bottom-Right Floating Dispatch Progress State
  const [dispatchProgress, setDispatchProgress] = useState<{
    active: boolean;
    current: number;
    total: number;
    title: string;
    lastSentName: string;
    completed: boolean;
    minimized: boolean;
  }>({
    active: false,
    current: 0,
    total: 0,
    title: '',
    lastSentName: '',
    completed: false,
    minimized: false,
  });

  // Deep link from a notification (?highlight=<announcementId>) — scroll to it once
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [hasScrolledToHighlight, setHasScrolledToHighlight] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    const refreshData = () => {
      setAnnouncements(getAnnouncements());
      setCommittees(getCommittees());
      const evList = getEvents();
      setEvents(evList);
      setTasks(getTasks());
      const memList = getMembers();
      setAllMembers(memList);

      if (evList.length > 0 && !selectedEventId) {
        setSelectedEventId(evList[0].id);
        if (evList[0].committees && evList[0].committees.length > 0) {
          setSelectedCommitteeId(evList[0].committees[0].id);
        }
      }
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

    const params = new URLSearchParams(window.location.search);
    setHighlightId(params.get('highlight'));

    window.addEventListener('rtbi-data-sync', refreshData);
    window.addEventListener('storage', refreshData);
    return () => {
      window.removeEventListener('rtbi-data-sync', refreshData);
      window.removeEventListener('storage', refreshData);
    };
  }, []);

  useEffect(() => {
    if (!highlightId || hasScrolledToHighlight) return;
    const el = document.getElementById(`announcement-${highlightId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHasScrolledToHighlight(true);
    }
  }, [announcements, highlightId, hasScrolledToHighlight]);

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleOpenCreate = () => {
    setTitle('');
    setContent('');
    setTargetCategory('All Members');
    if (events.length > 0) {
      setSelectedEventId(events[0].id);
      if (events[0].committees && events[0].committees.length > 0) {
        setSelectedCommitteeId(events[0].committees[0].id);
      }
    }
    setSelectedMemberIds([]);
    setMemberQuery('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (ann: AnnouncementItem) => {
    setEditingAnnouncement(ann);
    setTitle(ann.title);
    setContent(ann.content);
    setTargetCategory('All Members');
  };

  // Drives the bottom-right floating progress bar while an announcement
  // circulates. The actual email send already happened once, server-side,
  // inside addAnnouncement()/approveAnnouncement()'s POST/PATCH call to
  // /api/announcements — that route calls dispatchAnnouncementEmails(),
  // which is the single, emailSent-guarded source of truth for these
  // emails. This loop used to ALSO call /api/email/send per recipient on
  // top of that, so every announcement went out twice — once from the
  // server-side dispatch, once from here. It now only animates the same
  // recipient list for visual feedback; it must never place its own
  // network call to send mail.
  const triggerEmailDispatchLoop = async (annTitle: string, annContent: string, recipients: Member[]) => {
    if (!recipients || recipients.length === 0) return;

    setDispatchProgress({
      active: true,
      current: 0,
      total: recipients.length,
      title: annTitle,
      lastSentName: recipients[0]?.name || '',
      completed: false,
      minimized: false,
    });

    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      setDispatchProgress(prev => ({
        ...prev,
        current: i + 1,
        lastSentName: r.name,
      }));

      await new Promise(res => setTimeout(res, 180));
    }

    setDispatchProgress(prev => ({
      ...prev,
      completed: true,
    }));

    // Auto-dismiss bottom-right widget after 6 seconds when complete
    setTimeout(() => {
      setDispatchProgress(prev => ({ ...prev, active: false }));
    }, 6000);
  };

  const handleApproveAnnouncement = (id: string) => {
    const updated = approveAnnouncement(id, user?.name || 'Centre Head / GG Campus Events Head');
    if (updated) {
      setAnnouncements(getAnnouncements());

      // Resolve recipient list from announcement scope
      let recipients: Member[] = [];
      const scopeStr = updated.scope || 'All Members';

      if (scopeStr.includes('Specific Member')) {
        recipients = allMembers;
      } else if (scopeStr.includes('→')) {
        const parts = scopeStr.split('→').map(s => s.trim());
        const eventMatch = events.find(e => e.title.toLowerCase().includes(parts[0].toLowerCase()));
        const commMatch = eventMatch?.committees.find(c => c.name.toLowerCase().includes(parts[1].toLowerCase()));
        if (commMatch) {
          const idSet = new Set(commMatch.memberIds || []);
          if (commMatch.leadMemberId) idSet.add(commMatch.leadMemberId);
          recipients = allMembers.filter(m => idSet.has(m.id));
        }
      } else if (['Super User', 'CEO', 'Employee', 'Startup'].includes(scopeStr)) {
        recipients = allMembers.filter(m => m.division === scopeStr);
      } else {
        recipients = allMembers;
      }

      // Immediately start background dispatch & show bottom-right progress bar
      triggerEmailDispatchLoop(updated.title, updated.content, recipients);
      triggerSuccess(`✔ Announcement "${updated.title}" approved! Email circulation started.`);
    }
  };

  const handleRejectAnnouncement = (id: string) => {
    const updated = rejectAnnouncement(id, user?.name || 'Centre Head / GG Campus Events Head');
    if (updated) {
      triggerSuccess(`Announcement submission rejected.`);
      setAnnouncements(getAnnouncements());
    }
  };

  // Helper to compute target recipient list and display scope string
  const computeTargetRecipients = () => {
    let recipients: Member[] = [];
    let scopeLabel = targetCategory;

    if (targetCategory === 'All Members') {
      recipients = allMembers;
      // Must stay the literal string 'All Members' — resolveAnnouncementRecipients
      // (announcement-scope.ts, the single source of truth the server uses to
      // resolve who actually gets emailed) and getAnnouncementScopeMatch only
      // recognize that exact string. This used to be labeled 'All Center
      // Members' here, which neither function matches — every "All Members"
      // announcement silently resolved to zero recipients server-side and
      // never sent a single email.
      scopeLabel = 'All Members';
    } else if (['Super User', 'CEO', 'Employee', 'Startup'].includes(targetCategory)) {
      recipients = allMembers.filter(m => m.division === targetCategory);
      scopeLabel = targetCategory;
    } else if (targetCategory === 'Event Committee') {
      const selectedEvent = events.find(e => e.id === selectedEventId);
      const selectedComm = selectedEvent?.committees.find(c => c.id === selectedCommitteeId);
      if (selectedEvent && selectedComm) {
        const idSet = new Set(selectedComm.memberIds || []);
        if (selectedComm.leadMemberId) idSet.add(selectedComm.leadMemberId);
        recipients = allMembers.filter(m => idSet.has(m.id));
        scopeLabel = `${selectedEvent.title} → ${selectedComm.name}`;
      } else if (selectedEvent) {
        scopeLabel = `Event: ${selectedEvent.title}`;
        recipients = allMembers;
      }
    } else if (targetCategory === 'Specific Members') {
      const idSet = new Set(selectedMemberIds);
      recipients = allMembers.filter(m => idSet.has(m.id));
      scopeLabel = `${recipients.length} Specific Member(s)`;
    }

    return { recipients, scopeLabel };
  };

  const handleSaveAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !content || !user) return;

    const { recipients, scopeLabel } = computeTargetRecipients();

    if (editingAnnouncement) {
      updateAnnouncement(editingAnnouncement.id, {
        title,
        content,
        scope: scopeLabel,
      }, user.name);
      triggerSuccess('Announcement updated.');
      setEditingAnnouncement(null);
    } else {
      const isApproved = canApproveAnnouncement(user);

      addAnnouncement({
        title,
        content,
        scope: scopeLabel,
        authorName: user.name,
        status: isApproved ? 'Approved' : 'Pending Approval',
      });

      setIsModalOpen(false);

      if (!isApproved) {
        triggerSuccess('Announcement submitted! Awaiting approval by the Centre Head or GG Campus Events Head before circulation.');
        setAnnouncements(getAnnouncements());
        return;
      }

      // If created by Centre Head / GG Campus Events Head, start immediate background dispatch
      triggerEmailDispatchLoop(title, content, recipients);
      triggerSuccess('✔ Announcement published! Email circulation started.');
    }

    setAnnouncements(getAnnouncements());
  };

  const handleConfirmDelete = () => {
    if (!deletingAnnouncementId) return;
    deleteAnnouncement(deletingAnnouncementId, user?.name || 'User');
    setDeletingAnnouncementId(null);
    setAnnouncements(getAnnouncements());
    triggerSuccess('Announcement retracted.');
  };

  const selectedEvent = events.find(e => e.id === selectedEventId);
  const filteredMembers = allMembers.filter(m => {
    const q = memberQuery.toLowerCase();
    return !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || (m.role || '').toLowerCase().includes(q) || (m.department || '').toLowerCase().includes(q);
  });

  const toggleSelectMember = (id: string) => {
    setSelectedMemberIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const canPublish = canCreateAnnouncement(user);
  const canApprove = canApproveAnnouncement(user);
  const canDelete = canDeleteAnnouncement(user);

  const displayedAnnouncements = announcements.filter(ann => {
    if (canApprove) return true;
    if (user && ann.authorName.toLowerCase() === user.name.toLowerCase()) return true;
    return !ann.status || ann.status === 'Approved';
  });

  return (
    <div className="p-6 md:p-8 space-y-6">
      
      {/* Notifications */}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-success/15 border border-success/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <CheckCircle className="h-5 w-5 text-success shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Header section with Create Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary">Center Announcements</h1>
          <p className="text-xs text-theme-text-secondary">Publish center circulars and broadcast targeted announcements to committees and specific members</p>
        </div>
        {canPublish && (
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            New Announcement
          </button>
        )}
      </div>

      {/* Announcements Feed */}
      <div className="space-y-4">
        {displayedAnnouncements.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No announcements published"
            description="Broadcast center updates, meeting notifications, or financial deadlines."
            actionLabel={canPublish ? "Publish Announcement" : undefined}
            onAction={canPublish ? handleOpenCreate : undefined}
          />
        ) : (
          displayedAnnouncements.map((ann) => (
            <div
              key={ann.id}
              id={`announcement-${ann.id}`}
              className={`glass-panel rounded-2xl p-6 flex flex-col space-y-3 hover:bg-theme-border/10 transition-all border text-xs ${
                ann.id === highlightId ? 'border-accent ring-2 ring-accent/50' : 'border-theme-card-border/50'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center flex-wrap gap-2.5">
                  <h3 className="font-bold text-sm text-theme-text-primary">{ann.title}</h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/20">
                    {ann.scope}
                  </span>
                  {ann.status === 'Pending Approval' && (
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                      <Clock className="h-3 w-3 animate-pulse" />
                      Pending Approval (Centre Head / GG Campus Events Head)
                    </span>
                  )}
                  {ann.status === 'Approved' && (
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Approved & Published
                    </span>
                  )}
                  {ann.status === 'Rejected' && (
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/30 flex items-center gap-1">
                      <X className="h-3 w-3" />
                      Rejected
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-theme-text-secondary text-[11px]">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {ann.publishedAt}
                  </span>
                  <span>by <strong className="text-theme-text-primary">{ann.authorName}</strong></span>
                </div>
              </div>

              <p className="text-xs text-theme-text-secondary leading-relaxed bg-theme-background/20 p-3 rounded-xl border border-theme-border/20 whitespace-pre-wrap">
                {ann.content}
              </p>

              {/* Status Indicator Audit Banner: Approved vs Rejected vs Pending */}
              {ann.status === 'Approved' && (
                <div className="flex items-center gap-2 p-2.5 bg-emerald-500/10 border border-emerald-500/25 rounded-xl text-[11px] text-emerald-400">
                  <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    <strong>Approved & Circulated</strong> by <strong className="text-emerald-300">{ann.approvedBy || 'Centre Head'}</strong>
                    {ann.approvedAt && ` on ${ann.approvedAt}`}
                  </span>
                </div>
              )}

              {ann.status === 'Rejected' && (
                <div className="flex items-center gap-2 p-2.5 bg-danger/10 border border-danger/25 rounded-xl text-[11px] text-danger">
                  <X className="h-4 w-4 shrink-0 text-danger" />
                  <span>
                    <strong>Rejected</strong> by <strong className="text-red-300">{ann.rejectedBy || 'Centre Head'}</strong>
                    {ann.rejectedAt && ` on ${ann.rejectedAt}`}
                  </span>
                </div>
              )}

              {ann.status === 'Pending Approval' && (
                <div className="flex items-center gap-2 p-2.5 bg-amber-500/10 border border-amber-500/25 rounded-xl text-[11px] text-amber-400">
                  <Clock className="h-4 w-4 shrink-0 text-amber-400 animate-pulse" />
                  <span>
                    <strong>Pending Approval:</strong> Submitted by <strong>{ann.authorName}</strong>. Awaiting Centre Head review before email circulation.
                  </span>
                </div>
              )}

              {ann.editedAt && (
                <span className="text-[10px] text-theme-text-secondary italic">
                  Last edited: {ann.editedAt}
                </span>
              )}

              {canApprove && ann.status === 'Pending Approval' && (
                <div className="flex items-center gap-2 pt-2 border-t border-theme-border/20">
                  <button
                    onClick={() => handleApproveAnnouncement(ann.id)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                  >
                    <CheckCircle className="h-3.5 w-3.5" /> Approve & Circulate Announcement
                  </button>
                  <button
                    onClick={() => handleRejectAnnouncement(ann.id)}
                    className="px-3 py-1.5 bg-danger hover:bg-danger/90 text-white font-semibold rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              )}

              {(canPublish || canDelete) && (
                <div className="flex justify-end gap-2 pt-1">
                  {canPublish && (
                    <button
                      onClick={() => handleOpenEdit(ann)}
                      className="p-1 hover:bg-theme-border/30 rounded text-theme-text-secondary hover:text-accent transition-all cursor-pointer flex items-center gap-1 text-[11px]"
                    >
                      <Edit2 className="h-3 w-3" /> Edit
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => setDeletingAnnouncementId(ann.id)}
                      className="p-1 hover:bg-danger/10 rounded text-danger transition-all cursor-pointer flex items-center gap-1 text-[11px]"
                    >
                      <Trash2 className="h-3 w-3" /> Retract
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create / Edit Announcement Modal */}
      {(isModalOpen || editingAnnouncement) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-lg rounded-3xl p-6 flex flex-col space-y-5 relative border border-white/15 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-theme-text-primary">
                {editingAnnouncement ? 'Edit Announcement' : 'Publish New Announcement'}
              </h2>
              <button 
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingAnnouncement(null);
                }}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAnnouncement} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Announcement Subject *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Committee Meeting & Deliverable Notice"
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              {/* Target Scope Category Selection */}
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Target Recipient Audience</label>
                <select
                  value={targetCategory}
                  onChange={(e) => {
                    setTargetCategory(e.target.value);
                    if (e.target.value === 'Event Committee' && events.length > 0) {
                      setSelectedEventId(events[0].id);
                      if (events[0].committees && events[0].committees.length > 0) {
                        setSelectedCommitteeId(events[0].committees[0].id);
                      }
                    }
                  }}
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent font-semibold"
                >
                  <option value="All Members">All Center Members</option>
                  <option value="Super User">Super Users (Tier 1)</option>
                  <option value="CEO">CEOs (Tier 2)</option>
                  <option value="Employee">Employees (Tier 3)</option>
                  <option value="Startup">Startups (Tier 4)</option>
                  <option value="Event Committee">Event Committee (Sub-menu: Select Event & Committee)</option>
                  <option value="Specific Members">Specific Members (Pick from Member Logbook Roster)</option>
                </select>
              </div>

              {/* Sub-Menu: Event -> Committee Selection */}
              {targetCategory === 'Event Committee' && (
                <div className="p-3.5 bg-accent/5 border border-accent/20 rounded-2xl space-y-3">
                  <div className="space-y-1">
                    <label className="flex items-center gap-1.5 font-semibold text-accent">
                      <Calendar className="h-3.5 w-3.5" />
                      1. Select Event *
                    </label>
                    <SearchableSelect
                      value={selectedEventId}
                      onChange={(evId) => {
                        setSelectedEventId(evId);
                        const match = events.find(ev => ev.id === evId);
                        if (match && match.committees && match.committees.length > 0) {
                          setSelectedCommitteeId(match.committees[0].id);
                        } else {
                          setSelectedCommitteeId('');
                        }
                      }}
                      options={events.filter(ev => isApprovedEvent(ev, tasks)).map(ev => ({ value: ev.id, label: ev.title }))}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="flex items-center gap-1.5 font-semibold text-accent">
                      <Users className="h-3.5 w-3.5" />
                      2. Select Sub-Committee *
                    </label>
                    <SearchableSelect
                      value={selectedCommitteeId}
                      onChange={setSelectedCommitteeId}
                      allLabel={selectedEvent?.committees?.length ? undefined : 'No committees setup for this event'}
                      allValue=""
                      options={(selectedEvent?.committees || []).map(c => ({ value: c.id, label: `${c.name} (${c.memberIds?.length || 0} members)` }))}
                    />
                  </div>
                </div>
              )}

              {/* Sub-Menu: Specific Members Roster Selection */}
              {targetCategory === 'Specific Members' && (
                <div className="p-3.5 bg-accent/5 border border-accent/20 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 font-semibold text-accent">
                      <Users className="h-3.5 w-3.5" />
                      Pick Specific Members from Roster Logbook
                    </label>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/20 text-accent">
                      {selectedMemberIds.length} Selected
                    </span>
                  </div>

                  {/* Search input */}
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-theme-background/50 border border-theme-card-border rounded-xl">
                    <Search className="h-3.5 w-3.5 text-theme-text-secondary shrink-0" />
                    <input
                      type="text"
                      value={memberQuery}
                      onChange={(e) => setMemberQuery(e.target.value)}
                      placeholder="Search by name, email, role, or department..."
                      className="w-full bg-transparent border-0 focus:outline-none text-theme-text-primary placeholder-theme-text-secondary text-xs"
                    />
                  </div>

                  {/* Quick Select All / Clear */}
                  <div className="flex items-center justify-between text-[11px] pt-0.5">
                    <button
                      type="button"
                      onClick={() => setSelectedMemberIds(Array.from(new Set([...selectedMemberIds, ...filteredMembers.map(m => m.id)])))}
                      className="text-accent hover:underline font-medium cursor-pointer"
                    >
                      Select All Filtered ({filteredMembers.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedMemberIds([])}
                      className="text-theme-text-secondary hover:underline cursor-pointer"
                    >
                      Clear Selection
                    </button>
                  </div>

                  {/* Roster Checkbox List */}
                  <div className="max-h-44 overflow-y-auto space-y-1 pr-1 divide-y divide-theme-border/20">
                    {filteredMembers.length === 0 ? (
                      <p className="text-center py-3 text-theme-text-secondary">No members match your search.</p>
                    ) : (
                      filteredMembers.map(m => {
                        const isChecked = selectedMemberIds.includes(m.id);
                        return (
                          <div
                            key={m.id}
                            onClick={() => toggleSelectMember(m.id)}
                            className={`flex items-center justify-between p-2 rounded-xl cursor-pointer transition-colors ${
                              isChecked ? 'bg-accent/15 border border-accent/30' : 'hover:bg-theme-border/20'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              {isChecked ? (
                                <CheckSquare className="h-4 w-4 text-accent shrink-0" />
                              ) : (
                                <Square className="h-4 w-4 text-theme-text-secondary shrink-0" />
                              )}
                              <div>
                                <span className="font-bold text-theme-text-primary block">{m.name}</span>
                                <span className="text-[10px] text-theme-text-secondary block">{m.email}</span>
                              </div>
                            </div>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-theme-border/30 text-theme-text-secondary shrink-0">
                              {m.role || m.division}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Announcement Message Content *</label>
                <textarea
                  required
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write clear instructions, deadlines, or meeting links..."
                  rows={4}
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer mt-4"
              >
                {editingAnnouncement ? 'Save Updates' : 'Publish & Submit Announcement'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Floating Bottom-Right Chat-Style Progress Bar Widget */}
      {dispatchProgress.active && (
        <div className="fixed bottom-6 right-6 z-50 w-80 md:w-96 glass-panel rounded-2xl p-4 border border-accent/40 shadow-2xl bg-zinc-900/95 text-white animate-in slide-in-from-bottom-5 duration-300">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              {dispatchProgress.completed ? (
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <div className="h-2.5 w-2.5 rounded-full bg-accent animate-ping shrink-0" />
              )}
              <span className="font-bold text-xs text-white truncate max-w-[210px]">
                {dispatchProgress.completed ? 'Email Dispatch Complete' : 'Circulating Emails...'}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setDispatchProgress(prev => ({ ...prev, minimized: !prev.minimized }))}
                className="px-2 py-0.5 hover:bg-white/10 rounded-md text-zinc-400 hover:text-white transition-all cursor-pointer text-[10px] font-medium"
              >
                {dispatchProgress.minimized ? 'Expand' : 'Minimize'}
              </button>
              <button
                onClick={() => setDispatchProgress(prev => ({ ...prev, active: false }))}
                className="p-1 hover:bg-white/10 rounded-md text-zinc-400 hover:text-white transition-all cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {!dispatchProgress.minimized && (
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between items-center text-[11px] text-zinc-300">
                <span className="truncate max-w-[210px]">
                  {dispatchProgress.completed
                    ? `Successfully sent ${dispatchProgress.total} emails`
                    : `Sending: ${dispatchProgress.lastSentName}`}
                </span>
                <span className="font-mono font-bold text-accent">
                  {dispatchProgress.current}/{dispatchProgress.total}
                </span>
              </div>

              {/* Progress bar track */}
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    dispatchProgress.completed ? 'bg-emerald-400' : 'bg-accent'
                  }`}
                  style={{
                    width: `${Math.round((dispatchProgress.current / (dispatchProgress.total || 1)) * 100)}%`,
                  }}
                />
              </div>

              <div className="flex justify-between items-center text-[10px] text-zinc-400 pt-0.5">
                <span className="truncate max-w-[220px]">"{dispatchProgress.title}"</span>
                <span className="font-mono font-semibold">
                  {Math.round((dispatchProgress.current / (dispatchProgress.total || 1)) * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingAnnouncementId)}
        title="Retract Announcement"
        message="Are you sure you want to retract and remove this announcement from the public dashboard feed?"
        confirmLabel="Retract"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingAnnouncementId(null)}
      />

    </div>
  );
}
