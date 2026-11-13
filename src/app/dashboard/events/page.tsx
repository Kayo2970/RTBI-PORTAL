'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus,
  X,
  Calendar,
  MapPin,
  Users,
  Edit2,
  Trash2,
  CheckCircle2,
  ShieldAlert,
  ArrowRight,
  Download,
  Upload,
  Clock,
  Check,
  Ban,
  Handshake,
  Sparkles,
  UserCheck,
  Ticket,
} from 'lucide-react';
import {
  getEvents,
  addEvent,
  updateEvent,
  deleteEvent,
  approveEvent,
  rejectEvent,
  submitEventEdit,
  submitEventDelete,
  getEffectiveEventStatus,
  formatEventDateRange,
  formatEventPlanningNote,
  getEventSortTime,
  getEventSponsors,
  getEventSponsorTotal,
  getMembers,
  isFestivalEvent,
  EventItem,
  EventCommittee,
  EventSponsor,
  Member,
} from '@/lib/local-data';
import {
  canCreateEvent,
  canEditEvent,
  canDeleteEvent,
  canManageEvents,
  canExportEventDetails,
  canViewEvent,
  canApprovePendingEvent,
  getEventApprovalRequirement,
} from '@/lib/permissions';
import { downloadEventDetailsCsv } from '@/lib/event-participants-export';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { useDropTarget } from '@/components/ui/file-dropzone';
import { RequestApprovalModal } from '@/components/request-approval-modal';

type EventStatusFilter = 'ALL' | 'ONGOING' | 'COMPLETED' | 'ARCHIVED';

export default function EventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [user, setUser] = useState<any>(null);
  // Defaults to Ongoing (not All) so the board opens decluttered — completed
  // and archived events live in their own tabs instead of mixing into the
  // active view, mirroring the Active/Completed split on the Tasks page.
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>('ONGOING');

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

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [rejectingEventId, setRejectingEventId] = useState<string | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [approvalRequestEvent, setApprovalRequestEvent] = useState<EventItem | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [datesTBD, setDatesTBD] = useState(false);
  const [planningStartDate, setPlanningStartDate] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [location, setLocation] = useState('');
  const [campus, setCampus] = useState<'GG Campus' | 'RTC Campus' | 'Both Campuses'>('GG Campus');
  const [status, setStatus] = useState<EventItem['status']>('planned');
  const [sponsors, setSponsors] = useState<EventSponsor[]>([]);
  const [formError, setFormError] = useState('');
  // Phones show the event form one section at a time; sm+ screens show every section as before
  const [formTab, setFormTab] = useState<'basics' | 'dates' | 'sponsors' | 'details'>('basics');
  useEffect(() => {
    if (isCreateModalOpen || editingEvent) setFormTab('basics');
  }, [isCreateModalOpen, editingEvent]);
  const formTabClass = (tab: string) => `space-y-4 ${formTab === tab ? 'block' : 'hidden'} sm:block`;
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Initial Committee State (optional during event creation)
  const [initialCommitteePreset, setInitialCommitteePreset] = useState<string>('None');
  const [initialCustomCommitteeName, setInitialCustomCommitteeName] = useState<string>('');
  const [initialCommitteeMemberIds, setInitialCommitteeMemberIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isDragOver: isCsvDragOver, dragHandlers: csvDragHandlers } = useDropTarget((files) => handleCsvFile(files[0]));

  useEffect(() => {
    const refreshData = () => {
      setEvents(getEvents());
      setMembers(getMembers());
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

    window.addEventListener('rtbi-data-sync', refreshData);
    window.addEventListener('storage', refreshData);
    return () => {
      window.removeEventListener('rtbi-data-sync', refreshData);
      window.removeEventListener('storage', refreshData);
    };
  }, []);

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setErrorMsg('');
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const triggerError = (msg: string) => {
    setErrorMsg(msg);
    setSuccessMsg('');
    setTimeout(() => setErrorMsg(''), 5000);
  };

  const VALID_STATUSES: EventItem['status'][] = ['planned', 'active', 'completed', 'archived'];

  const handleDownloadTemplate = () => {
    const csvContent = 'Title,Description,StartDate,EndDate,Location,Status\n' +
      'National Robotics Symposium 2026,Annual robotics and AI showcase,2026-09-10,2026-09-12,Auditorium 2,planned\n' +
      'Design Sprint Weekend,Two-day UI/UX design bootcamp,2026-10-01,2026-10-02,Design Lab,planned';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'rtbi_events_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleCsvFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleCsvFile = (file: File | undefined) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      try {
        const lines = text.split('\n');
        if (lines.length < 2) {
          triggerError('CSV file is empty or missing headers.');
          return;
        }

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const titleIndex = headers.indexOf('title');
        const descIndex = headers.indexOf('description');
        const startIndex = headers.indexOf('startdate');
        const endIndex = headers.indexOf('enddate');
        const locationIndex = headers.indexOf('location');
        const statusIndex = headers.indexOf('status');

        if (titleIndex === -1 || startIndex === -1 || endIndex === -1) {
          triggerError('Invalid CSV headers. Required at minimum: Title, StartDate, EndDate');
          return;
        }

        let importCount = 0;
        let skippedCount = 0;

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
          if (values.length < 2) continue;

          const evTitle = values[titleIndex];
          const evStart = values[startIndex];
          const evEnd = values[endIndex];

          if (!evTitle || !evStart || !evEnd || isNaN(new Date(evStart).getTime()) || isNaN(new Date(evEnd).getTime())) {
            skippedCount++;
            continue;
          }
          if (new Date(evEnd) < new Date(evStart)) {
            skippedCount++;
            continue;
          }

          const rawStatus = statusIndex !== -1 ? values[statusIndex].toLowerCase() : 'planned';
          const evStatus = (VALID_STATUSES as string[]).includes(rawStatus) ? rawStatus as EventItem['status'] : 'planned';

          addEvent({
            title: evTitle,
            description: descIndex !== -1 ? values[descIndex] : '',
            startDate: evStart,
            endDate: evEnd,
            location: locationIndex !== -1 ? values[locationIndex] : '',
            status: evStatus,
            createdBy: user?.name || 'User',
            committees: []
          });
          importCount++;
        }

        if (importCount > 0) {
          setEvents(getEvents());
          triggerSuccess(`Successfully imported ${importCount} new event(s). ${skippedCount > 0 ? `(${skippedCount} invalid row(s) skipped)` : ''}`);
        } else {
          triggerError('No valid event rows found in the CSV — check that Title, StartDate, and EndDate are filled in and dates are valid.');
        }
      } catch {
        triggerError('Error parsing CSV file. Please verify formatting.');
      }
    };
    reader.readAsText(file);
  };

  // Adds (days - 1) to a 'YYYY-MM-DD' start date, so a 1-day event's End
  // Date equals its Start Date rather than the day after.
  const addDaysToDateStr = (dateStr: string, days: number): string => {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + (days - 1));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    const days = parseInt(durationDays, 10);
    if (value && days >= 1) setEndDate(addDaysToDateStr(value, days));
  };

  const handleDurationDaysChange = (value: string) => {
    setDurationDays(value);
    const days = parseInt(value, 10);
    if (startDate && days >= 1) setEndDate(addDaysToDateStr(startDate, days));
  };

  // Typing directly into End Date always wins — clear any set duration so a
  // later Start Date change doesn't silently overwrite the manual edit.
  const handleEndDateChange = (value: string) => {
    setEndDate(value);
    setDurationDays('');
  };

  const handleOpenCreate = () => {
    setTitle('');
    setDescription('');
    setStartDate('');
    setEndDate('');
    setDatesTBD(false);
    setPlanningStartDate('');
    setDurationDays('');
    setLocation('');
    setCampus('GG Campus');
    setStatus('planned');
    setSponsors([]);
    setFormError('');
    setInitialCommitteePreset('None');
    setInitialCustomCommitteeName('');
    setInitialCommitteeMemberIds([]);
    setIsCreateModalOpen(true);
  };

  const handleOpenEdit = (event: EventItem) => {
    setEditingEvent(event);
    setTitle(event.title);
    setDescription(event.description);
    setStartDate(event.startDate);
    setEndDate(event.endDate);
    setDatesTBD(!!event.datesTBD);
    setPlanningStartDate(event.planningStartDate || '');
    setDurationDays('');
    setLocation(event.location || '');
    setCampus(event.campus || 'GG Campus');
    setStatus(event.status);
    setSponsors(event.sponsors || []);
    setFormError('');
  };

  const addSponsorRow = () => {
    setSponsors((rows) => [...rows, { id: 'sp_' + Date.now(), name: '', amount: undefined }]);
  };

  const updateSponsorRow = (id: string, patch: Partial<EventSponsor>) => {
    setSponsors((rows) => rows.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeSponsorRow = (id: string) => {
    setSponsors((rows) => rows.filter((s) => s.id !== id));
  };

  const handleSaveEvent = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!title.trim() || (!datesTBD && (!startDate || !endDate))) {
      setFormError('Please fill in event title and active dates (or mark dates as To Be Decided).');
      return;
    }

    if (!datesTBD && new Date(endDate) < new Date(startDate)) {
      setFormError('End Date must be on or after Start Date.');
      return;
    }

    if (!datesTBD && planningStartDate && new Date(planningStartDate) > new Date(startDate)) {
      setFormError('Planning Start Date must be on or before the Event Start Date — it marks when prep work begins, ahead of the event itself.');
      return;
    }

    const cleanedSponsors = sponsors
      .filter((s) => s.name.trim())
      .map((s) => ({ ...s, name: s.name.trim(), amount: Number(s.amount) || undefined }));

    if (editingEvent) {
      const changes = {
        title: title.trim(),
        description: description.trim(),
        startDate: datesTBD ? '' : startDate,
        endDate: datesTBD ? '' : endDate,
        datesTBD,
        planningStartDate,
        location: location.trim(),
        campus,
        status,
        sponsors: cleanedSponsors,
      };
      const approval = getEventApprovalRequirement(user, 'EDIT');
      if (approval.requiresApproval) {
        submitEventEdit(editingEvent.id, changes, user?.name || 'User', user?.email || '', {
          approverType: approval.approverType,
          approverMemberId: approval.approverMemberId,
          approverPolicyTagId: approval.approverPolicyTagId,
          policyName: approval.policyName,
        });
        triggerSuccess(`Edit submitted for approval to ${approval.approverName}. It will apply once approved.`);
      } else {
        updateEvent(editingEvent.id, changes, user?.name || 'User');
        triggerSuccess('Event details updated successfully.');
      }
      setEditingEvent(null);
    } else {
      const initialCommittees: EventCommittee[] = [];
      if (initialCommitteePreset !== 'None') {
        const commName = initialCommitteePreset === 'Others' ? initialCustomCommitteeName.trim() : initialCommitteePreset;
        if (commName) {
          initialCommittees.push({
            id: 'comm_' + Date.now(),
            name: commName,
            memberIds: initialCommitteeMemberIds,
          });
        }
      }

      const newEventBase = {
        title: title.trim(),
        description: description.trim(),
        startDate: datesTBD ? '' : startDate,
        endDate: datesTBD ? '' : endDate,
        datesTBD,
        planningStartDate,
        location: location.trim(),
        campus,
        status,
        sponsors: cleanedSponsors,
        createdBy: user?.name || 'User',
        committees: initialCommittees
      };
      const approval = getEventApprovalRequirement(user, 'CREATE');
      if (approval.requiresApproval) {
        addEvent({
          ...newEventBase,
          approvalStatus: 'pending_create',
          approverType: approval.approverType,
          approverMemberId: approval.approverMemberId,
          approverPolicyTagId: approval.approverPolicyTagId,
          approvalPolicyName: approval.policyName,
          submittedBy: user?.name,
          submittedByEmail: user?.email,
        });
        triggerSuccess(`Event submitted for approval to ${approval.approverName}. It will go live once approved.`);
      } else {
        addEvent(newEventBase);
        triggerSuccess('New event created with its own directory.');
      }
      setIsCreateModalOpen(false);
    }

    setEvents(getEvents());
  };

  const handleApproveEvent = (id: string) => {
    const wasDelete = events.find(e => e.id === id)?.approvalStatus === 'pending_delete';
    approveEvent(id, user?.name || 'User');
    setEvents(getEvents());
    triggerSuccess(wasDelete ? 'Approved. The event has been deleted.' : 'Approved. The change is now live.');
  };

  const handleConfirmReject = () => {
    if (!rejectingEventId) return;
    rejectEvent(rejectingEventId, user?.name || 'User', rejectionReasonInput || undefined);
    setEvents(getEvents());
    setRejectingEventId(null);
    setRejectionReasonInput('');
    triggerSuccess('Rejected.');
  };

  const handleConfirmDelete = () => {
    if (!deletingEventId) return;
    const approval = getEventApprovalRequirement(user, 'DELETE');
    if (approval.requiresApproval) {
      submitEventDelete(deletingEventId, user?.name || 'User', user?.email || '', {
        approverType: approval.approverType,
        approverMemberId: approval.approverMemberId,
        approverPolicyTagId: approval.approverPolicyTagId,
        policyName: approval.policyName,
      });
      triggerSuccess(`Deletion submitted for approval to ${approval.approverName}. The event stays live until then.`);
    } else {
      deleteEvent(deletingEventId, user?.name || 'User');
      triggerSuccess('Event removed from system.');
    }
    setDeletingEventId(null);
    setEvents(getEvents());
  };

  const canManage = canManageEvents(user);
  const canCreate = canCreateEvent(user);

  const getStatusBadge = (eventStatus: EventItem['status']) => {
    switch (eventStatus) {
      case 'active':
        return 'bg-success/15 text-success border border-success/30';
      case 'planned':
        return 'bg-warning/15 text-warning border border-warning/30';
      case 'completed':
        return 'bg-primary/15 text-primary-light border border-primary/30';
      case 'archived':
        return 'bg-theme-border/30 text-theme-text-secondary';
    }
  };

  // Visibility: a pending/rejected submission is only shown to its submitter, its
  // resolved approver, and the Super User — everyone else sees nothing of it until
  // it's approved. Once approved (or for events created before this feature, which
  // carry no approvalStatus at all), the normal own/listed-vs-all rule from
  // canViewEvent applies.
  const canSeeApprovalMeta = (event: EventItem) =>
    user?.tier === 1 || event.submittedByEmail === user?.email || canApprovePendingEvent(event, user);

  const visibleEvents = events
    .filter(event => !isFestivalEvent(event))
    .filter(event => {
      if (event.approvalStatus === 'pending_create' || event.approvalStatus === 'rejected') {
        return canSeeApprovalMeta(event);
      }
      return canViewEvent(event, user);
    });

  // Upcoming/active events first (soonest start date first), then events whose end
  // date has already passed — those sort most-recently-ended first, and their
  // status badge shows "completed" even if it's still stored as "planned"/"active"
  // (nothing ever auto-transitioned it before), so the grid reads as a real
  // upcoming-vs-past view instead of an arbitrary jumble.
  const statusRank = (s: EventItem['status']) => (s === 'archived' ? 2 : s === 'completed' ? 1 : 0);
  const sortedEvents = [...visibleEvents].sort((a, b) => {
    const aStatus = getEffectiveEventStatus(a);
    const bStatus = getEffectiveEventStatus(b);
    const rankDiff = statusRank(aStatus) - statusRank(bStatus);
    if (rankDiff !== 0) return rankDiff;
    const aTime = getEventSortTime(a);
    const bTime = getEventSortTime(b);
    const isPast = aStatus === 'completed' || aStatus === 'archived';
    return isPast ? bTime - aTime : aTime - bTime;
  });

  const statusFilteredEvents = sortedEvents.filter(event => {
    if (statusFilter === 'ALL') return true;
    const effective = getEffectiveEventStatus(event);
    if (statusFilter === 'ONGOING') return effective === 'planned' || effective === 'active';
    if (statusFilter === 'COMPLETED') return effective === 'completed';
    return effective === 'archived';
  });

  return (
    <div className="p-6 md:p-8 space-y-6">
      
      {/* Alert Banner */}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-success/15 border border-success/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-3 p-4 bg-danger/15 border border-danger/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <ShieldAlert className="h-5 w-5 text-danger shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Header section with Create Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Events & Milestone Operations</h1>
          <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">Manage symposiums, create event-specific sub-committees, and assign student teams</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-slate-800 dark:text-white text-xs font-bold rounded-xl transition-all cursor-pointer border border-slate-300 dark:border-white/15 shadow-sm"
              title="Download CSV Template"
            >
              <Download className="h-4 w-4" />
              Download Template
            </button>

            <button
              onClick={handleUploadClick}
              {...csvDragHandlers}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer border shadow-sm ${
                isCsvDragOver
                  ? 'border-accent bg-accent/15 shadow-md shadow-accent/25 ring-2 ring-accent/30 text-accent'
                  : 'border-slate-300 dark:border-white/15 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-slate-800 dark:text-white'
              }`}
              title="Upload Filled CSV File — click or drag and drop"
            >
              <Upload className="h-4 w-4" />
              {isCsvDragOver ? 'Drop CSV here' : 'Upload Events (CSV)'}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".csv,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,text/plain"
              className="hidden"
            />

            <Link
              href="/dashboard/event-passes"
              className="flex items-center gap-1.5 px-3.5 py-2 bg-accent/15 border border-accent/35 text-accent hover:bg-accent/25 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm"
            >
              <Ticket className="h-4 w-4" />
              Event Passes
            </Link>

            <Link
              href="/dashboard/festivals"
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-slate-800 dark:text-white border border-slate-300 dark:border-white/15 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm"
            >
              <Sparkles className="h-4 w-4" />
              Festivals & Observances
            </Link>

            {canCreate && (
              <button
                onClick={handleOpenCreate}
                className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/90 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-accent/25 cursor-pointer uppercase tracking-wider"
              >
                <Plus className="h-4 w-4" />
                Create New Event
              </button>
            )}
          </div>
        )}
      </div>

      {/* Status Filter Tabs */}
          {visibleEvents.length > 0 && (
            <div className="flex items-center gap-1.5 bg-slate-100/90 dark:bg-slate-900/80 rounded-2xl p-1.5 w-fit border border-slate-200/90 dark:border-white/15 shadow-sm">
              {([
                { key: 'ALL', label: 'All Events' },
                { key: 'ONGOING', label: 'Ongoing' },
                { key: 'COMPLETED', label: 'Completed' },
                { key: 'ARCHIVED', label: 'Archived' },
              ] as { key: EventStatusFilter; label: string }[]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                    statusFilter === tab.key
                      ? 'bg-accent text-white shadow-md shadow-accent/25 scale-105'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/80 dark:hover:bg-white/10'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

      {/* Grid of Events Cards */}
      {visibleEvents.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No events scheduled"
          description="Create your first symposium, workshop, or conference milestone."
          actionLabel={canCreate ? "Create Event" : undefined}
          onAction={canCreate ? handleOpenCreate : undefined}
        />
      ) : statusFilteredEvents.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No events match this filter"
          description="Try a different status tab to see other events."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {statusFilteredEvents.map((event) => {
            const effectiveStatus = getEffectiveEventStatus(event);
            const isPast = effectiveStatus === 'completed' || effectiveStatus === 'archived';

            return (
              <div
                key={event.id}
                className={`glass-panel rounded-3xl p-6 flex flex-col justify-between hover:border-accent/60 transition-all border border-slate-200/90 dark:border-white/20 shadow-lg shadow-slate-200/60 dark:shadow-black/40 bg-white/95 dark:bg-[#0D1F38]/95 backdrop-blur-2xl group space-y-5 ${isPast ? 'opacity-80' : ''}`}
              >
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full capitalize ${getStatusBadge(effectiveStatus)}`}>
                        {effectiveStatus}
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/20">
                        {event.campus || 'GG Campus'}
                      </span>
                    </div>
                    <span className="text-[11px] text-accent font-semibold flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {(event.committees || []).length} Committees
                    </span>
                  </div>

                  {(event.approvalStatus === 'pending_create' || event.approvalStatus === 'pending_edit' || event.approvalStatus === 'pending_delete') && canSeeApprovalMeta(event) && (
                    <div className={`flex items-center justify-between gap-2 p-2.5 border rounded-xl text-[11px] ${event.approvalStatus === 'pending_delete' ? 'bg-danger/10 border-danger/25' : 'bg-warning/10 border-warning/25'}`}>
                      <div className={`flex items-center gap-1.5 font-semibold ${event.approvalStatus === 'pending_delete' ? 'text-danger' : 'text-warning'}`}>
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {canApprovePendingEvent(event, user)
                            ? `Awaiting your approval${event.submittedBy ? ` • Submitted by ${event.submittedBy}` : ''}`
                            : `${event.approvalStatus === 'pending_delete' ? 'Deletion pending approval' : event.approvalStatus === 'pending_edit' ? 'Edit pending approval' : 'Event pending approval'}${event.submittedBy ? ` • Submitted by ${event.submittedBy === user?.name ? 'you' : event.submittedBy}` : ''}`}
                        </span>
                      </div>
                      {canApprovePendingEvent(event, user) && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleApproveEvent(event.id)}
                            className="p-1 hover:bg-success/15 rounded-md text-success cursor-pointer"
                            title="Approve"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setRejectingEventId(event.id)}
                            className="p-1 hover:bg-danger/15 rounded-md text-danger cursor-pointer"
                            title="Reject"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {event.approvalStatus === 'rejected' && canSeeApprovalMeta(event) && (
                    <div className="flex items-center gap-1.5 p-2.5 bg-danger/10 border border-danger/25 rounded-xl text-[11px] text-danger font-semibold">
                      <Ban className="h-3.5 w-3.5 shrink-0" />
                      <span>Rejected by {event.decidedBy || 'approver'}{event.rejectionReason ? `: ${event.rejectionReason}` : ''}</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Link 
                      href={`/dashboard/events/${event.id}`}
                      className="font-bold text-base text-theme-text-primary hover:text-accent transition-colors leading-snug block"
                    >
                      {event.title}
                    </Link>
                    <p className="text-xs text-theme-text-secondary line-clamp-2 leading-relaxed">
                      {event.description || 'No description provided.'}
                    </p>
                  </div>

                  <div className="space-y-1 text-xs text-theme-text-secondary pt-1">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <Calendar className="h-3.5 w-3.5 text-accent" />
                      <span className={event.datesTBD ? 'text-warning font-semibold' : ''}>{formatEventDateRange(event)}</span>
                    </div>
                    {formatEventPlanningNote(event) && (
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <Clock className="h-3.5 w-3.5 text-accent/70" />
                        <span className="text-accent/90 font-medium">{formatEventPlanningNote(event)}</span>
                      </div>
                    )}
                    {event.location && (
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <MapPin className="h-3.5 w-3.5 text-warning" />
                        <span className="truncate">{event.location}</span>
                      </div>
                    )}
                    {(() => {
                      const allSponsors = getEventSponsors(event.id);
                      const spTotal = getEventSponsorTotal(event);
                      if (allSponsors.length === 0) return null;
                      return (
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <Handshake className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="truncate">
                            🤝 {allSponsors.map((s) => s.name).join(', ')} — ₹{spTotal.toLocaleString()}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="border-t border-theme-border/20 pt-4 flex items-center justify-between text-xs">
                  <Link
                    href={`/dashboard/events/${event.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-accent hover:text-primary-light transition-all"
                  >
                    <span>Event Workspace</span>
                    <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                  </Link>
                  {canExportEventDetails(user) && (
                    <button
                      onClick={() => downloadEventDetailsCsv(event, members)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-theme-text-secondary hover:text-accent transition-all cursor-pointer"
                      title="Download event details and student details (CSV)"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Details
                    </button>
                  )}
                  
                  {(canEditEvent(user) || canDeleteEvent(user) || user) && (
                    <div className="flex items-center gap-1">
                      {user && (
                        <button
                          onClick={() => setApprovalRequestEvent(event)}
                          className="p-1.5 hover:bg-theme-border/30 rounded-lg transition-all text-theme-text-secondary hover:text-accent cursor-pointer"
                          title="Ask someone to approve this event"
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {canEditEvent(user) && (
                        <button
                          onClick={() => handleOpenEdit(event)}
                          className="p-1.5 hover:bg-theme-border/30 rounded-lg transition-all text-theme-text-secondary hover:text-accent cursor-pointer"
                          title="Edit Event Settings"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {canDeleteEvent(user) && event.approvalStatus !== 'pending_delete' && (
                        <button
                          onClick={() => setDeletingEventId(event.id)}
                          className="p-1.5 hover:bg-danger/10 rounded-lg transition-all text-danger cursor-pointer"
                          title="Delete Event"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Event Modal */}
      {(isCreateModalOpen || editingEvent) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-lg lg:max-w-4xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl p-4 sm:p-6 flex flex-col space-y-5 relative border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-theme-text-primary">
                {editingEvent ? 'Edit Event Details' : 'Create New Event'}
              </h2>
              <button 
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setEditingEvent(null);
                }}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-danger/10 border border-danger/25 rounded-xl text-danger text-xs flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form
              onSubmit={handleSaveEvent}
              onInvalidCapture={(e) => {
                // A required field sits in a section that is hidden on phones: jump to it and re-show the message
                const tab = (e.target as HTMLElement).closest('[data-tab]')?.getAttribute('data-tab') as typeof formTab | null;
                if (tab && tab !== formTab) {
                  const f = e.currentTarget;
                  setFormTab(tab);
                  setTimeout(() => f.reportValidity(), 60);
                }
              }}
              className="space-y-4 text-xs lg:grid lg:grid-cols-2 lg:gap-x-8 lg:gap-y-4 lg:space-y-0"
            >
              <div className="sm:hidden -mx-1 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Event form sections">
                {([['basics', 'Basics'], ['dates', 'Dates'], ['sponsors', 'Sponsors'], ['details', 'Details']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={formTab === key}
                    onClick={() => setFormTab(key)}
                    className={`shrink-0 px-3.5 py-2 rounded-full text-[11px] font-bold cursor-pointer transition-all ${
                      formTab === key ? 'bg-accent text-white shadow-md shadow-accent/20' : 'bg-theme-background/40 text-theme-text-secondary border border-theme-card-border'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="space-y-4 min-w-0">
              <div data-tab="basics" className={formTabClass('basics')}>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Event Title *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. National Robotics Symposium 2026"
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Venue / Location</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Auditorium 2"
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Host Campus *</label>
                  <select
                    value={campus || 'GG Campus'}
                    onChange={(e) => setCampus(e.target.value as any)}
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent font-semibold text-accent"
                  >
                    <option value="GG Campus">GG Campus</option>
                    <option value="RTC Campus">RTC Campus</option>
                    <option value="Both Campuses">Both Campuses</option>
                  </select>
                </div>
              </div>

              </div>

              <div data-tab="dates" className={formTabClass('dates')}>
              <label className="flex items-center gap-2 cursor-pointer font-medium text-theme-text-primary">
                <input
                  type="checkbox"
                  checked={datesTBD}
                  onChange={(e) => setDatesTBD(e.target.checked)}
                  className="accent-accent"
                />
                Dates To Be Decided
              </label>

              {!datesTBD && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block font-medium text-theme-text-secondary">Start Date *</label>
                    <input
                      type="date"
                      required={!datesTBD}
                      value={startDate}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                      className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block font-medium text-theme-text-secondary">Number of Days (optional)</label>
                    <input
                      type="number"
                      min={1}
                      value={durationDays}
                      onChange={(e) => handleDurationDaysChange(e.target.value)}
                      placeholder="e.g. 3"
                      className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                    />
                  </div>

                  <div className="space-y-1.5 col-span-2">
                    <label className="block font-medium text-theme-text-secondary">End Date *</label>
                    <input
                      type="date"
                      required={!datesTBD}
                      value={endDate}
                      onChange={(e) => handleEndDateChange(e.target.value)}
                      className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                    />
                    <p className="text-[11px] text-theme-text-secondary">
                      Set this directly, or pick a Start Date and Number of Days above and it fills itself in.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Planning Start Date (optional)</label>
                <input
                  type="date"
                  value={planningStartDate}
                  max={!datesTBD && startDate ? startDate : undefined}
                  onChange={(e) => setPlanningStartDate(e.target.value)}
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
                <p className="text-[11px] text-theme-text-secondary">
                  When prep work (bookings, committees, design briefs...) actually starts. Independent of the Event Date(s) above — set this even while the event's own dates are still To Be Decided, so planning can begin before the event date is locked in.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Event Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as EventItem['status'])}
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="planned">Planned</option>
                  <option value="active">Active / In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </div>

              </div>

              </div>

              <div className="space-y-4 min-w-0">
              <div data-tab="sponsors" className={formTabClass('sponsors')}>
              <div className="space-y-2 border-t border-theme-border/30 pt-3">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-theme-text-secondary flex items-center gap-1.5">
                    <Handshake className="h-3.5 w-3.5" /> Sponsors (optional)
                  </label>
                  <button
                    type="button"
                    onClick={addSponsorRow}
                    className="text-accent font-semibold flex items-center gap-1 hover:underline cursor-pointer text-[11px]"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Sponsor
                  </button>
                </div>
                <p className="text-[11px] text-theme-text-secondary">
                  In the Budget module, a sponsor's contribution is used up first — the Centre's budget only covers what's left.
                  Amount can be added now or later, once confirmed.
                </p>
                {sponsors.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={s.name}
                      onChange={(e) => updateSponsorRow(s.id, { name: e.target.value })}
                      placeholder="Sponsor name"
                      className="flex-1 px-3 py-2 bg-theme-background/30 border border-theme-card-border rounded-lg text-theme-text-primary text-xs focus:outline-none focus:border-accent"
                    />
                    <input
                      type="number"
                      min={0}
                      value={s.amount ?? ''}
                      onChange={(e) => updateSponsorRow(s.id, { amount: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="Amount (₹) — TBD"
                      className="w-40 px-3 py-2 bg-theme-background/30 border border-theme-card-border rounded-lg text-theme-text-primary text-xs font-mono focus:outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={() => removeSponsorRow(s.id)}
                      className="p-1.5 text-danger hover:bg-danger/10 rounded-lg cursor-pointer shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              </div>

              <div data-tab="details" className={formTabClass('details')}>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Description / Objectives</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Outline key targets, attendee capacity, and schedule..."
                  rows={3}
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              {!editingEvent && (
                <div className="space-y-3 border-t border-theme-border/30 pt-3">
                  <div className="space-y-1.5">
                    <label className="block font-medium text-theme-text-secondary flex items-center gap-1.5">
                      Initial Committee Unit (optional)
                    </label>
                    <select
                      value={initialCommitteePreset}
                      onChange={(e) => setInitialCommitteePreset(e.target.value)}
                      className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs"
                    >
                      <option value="None">None (Create later)</option>
                      <option value="Food">Food</option>
                      <option value="Stage">Stage</option>
                      <option value="Organizing">Organizing</option>
                      <option value="Hospitality">Hospitality</option>
                      <option value="Design">Design</option>
                      <option value="Photography">Photography</option>
                      <option value="Others">Others (Enter Custom Tag)</option>
                    </select>
                  </div>

                  {initialCommitteePreset === 'Others' && (
                    <div className="space-y-1.5 animate-in fade-in duration-150">
                      <label className="block text-[11px] font-medium text-theme-text-secondary">Custom Committee Name / Tag *</label>
                      <input
                        type="text"
                        required={initialCommitteePreset === 'Others'}
                        value={initialCustomCommitteeName}
                        onChange={(e) => setInitialCustomCommitteeName(e.target.value)}
                        placeholder="e.g. Media Production, Logistics"
                        className="w-full px-4 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs"
                      />
                    </div>
                  )}

                  {initialCommitteePreset !== 'None' && (
                    <div className="space-y-1.5 animate-in fade-in duration-150">
                      <label className="block text-[11px] font-medium text-theme-text-secondary">
                        Assign Students to Committee ({initialCommitteeMemberIds.length} selected)
                      </label>
                      <div className="max-h-36 overflow-y-auto rounded-xl border border-theme-card-border divide-y divide-theme-border/20 p-1 bg-theme-background/20">
                        {members
                          .filter(m => m.status !== 'Terminated')
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(student => (
                            <label
                              key={student.id}
                              className="flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-theme-border/20 cursor-pointer rounded-lg text-xs"
                            >
                              <span className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={initialCommitteeMemberIds.includes(student.id)}
                                  onChange={(e) => {
                                    setInitialCommitteeMemberIds(prev =>
                                      e.target.checked ? [...prev, student.id] : prev.filter(id => id !== student.id)
                                    );
                                  }}
                                  className="accent-accent"
                                />
                                <span className="font-medium text-theme-text-primary">{student.name}</span>
                              </span>
                              <span className="text-theme-text-secondary text-[10px]">{student.division}</span>
                            </label>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              </div>

              </div>

              <button
                type="submit"
                className="w-full lg:col-span-2 py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer mt-4"
              >
                {editingEvent ? 'Save Event Updates' : 'Create Event & Initialize Sub-Committees'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingEventId)}
        title="Delete Event"
        message="Are you sure you want to delete this event? All sub-committees and linked event deliverables will be removed."
        confirmLabel="Delete Event"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingEventId(null)}
      />

      {approvalRequestEvent && user && (
        <RequestApprovalModal
          isOpen={Boolean(approvalRequestEvent)}
          onClose={() => setApprovalRequestEvent(null)}
          entityType="event"
          entityId={approvalRequestEvent.id}
          entityTitle={approvalRequestEvent.title}
          eventId={approvalRequestEvent.id}
          members={members}
          currentUser={user}
          onRequested={() => triggerSuccess('✔ Approval request sent!')}
        />
      )}

      {/* Reject Pending Approval Modal */}
      {rejectingEventId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                <Ban className="h-4.5 w-4.5 text-danger" />
                Reject Submission
              </h2>
              <button
                onClick={() => { setRejectingEventId(null); setRejectionReasonInput(''); }}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-1.5 text-xs">
              <label className="block font-medium text-theme-text-secondary">Reason (optional)</label>
              <textarea
                value={rejectionReasonInput}
                onChange={(e) => setRejectionReasonInput(e.target.value)}
                rows={3}
                placeholder="Let the submitter know why this was rejected..."
                className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent resize-none"
              />
            </div>
            <button
              onClick={handleConfirmReject}
              className="w-full py-3 bg-danger hover:bg-danger/90 text-white font-semibold text-xs rounded-xl transition-all shadow-md cursor-pointer"
            >
              Confirm Rejection
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

