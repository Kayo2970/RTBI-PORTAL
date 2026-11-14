'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { getExpenseHeadLabel } from '@/lib/finance';
import {
  ChevronLeft,
  Calendar,
  MapPin,
  Users,
  CheckSquare,
  Plus,
  Trash2,
  UserPlus,
  CheckCircle2,
  User,
  Award,
  Wallet,
  Landmark,
  TrendingUp,
  Clock,
  Check,
  X,
  Ban,
  UserCheck,
  Search,
  Download,
  Ticket,
} from 'lucide-react';
import {
  getEventById,
  getMembers,
  getTasks,
  getExpenses,
  addTask,
  deleteTask,
  addEventCommittee,
  updateEventCommitteeMembers,
  deleteEventCommittee,
  submitEventCommitteeCreate,
  submitEventCommitteeMembers,
  approveEventCommittee,
  rejectEventCommittee,
  formatEventDateRange,
  formatEventPlanningNote,
  getEventSponsors,
  getEventSponsorTotal,
  EventItem,
  EventCommittee,
  Member,
  TaskItem,
} from '@/lib/local-data';
import { canExportEventDetails, canManageEvents, isCommitteeApprover, canDeleteTask } from '@/lib/permissions';
import { downloadEventDetailsCsv } from '@/lib/event-participants-export';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { StudentProfileModal } from '@/components/student-profile-modal';
import { RequestApprovalModal } from '@/components/request-approval-modal';
import { SearchableSelect } from '@/components/searchable-select';

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const eventId = resolvedParams.id;

  const [event, setEvent] = useState<EventItem | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [user, setUser] = useState<any>(null);

  // Modals & States
  const COMMITTEE_PRESETS = [
    'Food',
    'Stage',
    'Organizing',
    'Hospitality',
    'Design',
    'Photography',
    'Others',
  ] as const;
  const [isAddCommitteeModalOpen, setIsAddCommitteeModalOpen] = useState(false);
  const [selectedCommitteePreset, setSelectedCommitteePreset] = useState<string>('Food');
  const [customCommitteeName, setCustomCommitteeName] = useState('');
  const [newCommitteeMemberIds, setNewCommitteeMemberIds] = useState<string[]>([]);
  const [newCommitteeMemberQuery, setNewCommitteeMemberQuery] = useState('');

  const [managingCommittee, setManagingCommittee] = useState<EventCommittee | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [committeeMemberQuery, setCommitteeMemberQuery] = useState('');
  const [approvalRequestCommittee, setApprovalRequestCommittee] = useState<EventCommittee | null>(null);
  const [reviewingCommittee, setReviewingCommittee] = useState<EventCommittee | null>(null);

  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskCommitteeId, setTaskCommitteeId] = useState('');
  const [taskAssigneeId, setTaskAssigneeId] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskReviewerId, setTaskReviewerId] = useState('');

  const [deletingCommitteeId, setDeletingCommitteeId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [rejectingCommitteeId, setRejectingCommitteeId] = useState<string | null>(null);
  const [committeeRejectionReasonInput, setCommitteeRejectionReasonInput] = useState('');
  const [selectedStudentForProfile, setSelectedStudentForProfile] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    const refreshData = () => {
      const loadedEvent = getEventById(eventId);
      setEvent(loadedEvent);
      setMembers(getMembers());
      setTasks(getTasks().filter(t => t.eventId === eventId || t.event === loadedEvent?.title));
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
  }, [eventId]);

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const canBypassCommitteeApproval = isCommitteeApprover(user);

  const openAddCommitteeModal = () => {
    setSelectedCommitteePreset('Food');
    setCustomCommitteeName('');
    setNewCommitteeMemberIds([]);
    setNewCommitteeMemberQuery('');
    setIsAddCommitteeModalOpen(true);
  };

  const handleCreateCommittee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;

    const committeeName = selectedCommitteePreset === 'Others' ? customCommitteeName.trim() : selectedCommitteePreset;
    if (!committeeName) return;

    if (canBypassCommitteeApproval) {
      addEventCommittee(event.id, committeeName, user?.name || 'User', newCommitteeMemberIds);
      triggerSuccess(`Created event committee "${committeeName}" with ${newCommitteeMemberIds.length} members`);
    } else {
      submitEventCommitteeCreate(event.id, committeeName, user?.name || 'User', user?.email || '', newCommitteeMemberIds);
      triggerSuccess(`Committee "${committeeName}" with ${newCommitteeMemberIds.length} members submitted for approval from the Centre Head, Advisor, or GG Campus Head of Events.`);
    }
    setSelectedCommitteePreset('Food');
    setCustomCommitteeName('');
    setNewCommitteeMemberIds([]);
    setIsAddCommitteeModalOpen(false);
    setEvent(getEventById(eventId));
  };

  const openManageMembers = (committee: EventCommittee) => {
    setManagingCommittee(committee);
    setSelectedMemberIds([...committee.memberIds]);
    setCommitteeMemberQuery('');
  };

  const handleToggleMember = (memberId: string) => {
    setSelectedMemberIds(prev =>
      prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId]
    );
  };

  const handleSaveCommitteeMembers = () => {
    if (!event || !managingCommittee) return;

    if (canBypassCommitteeApproval) {
      updateEventCommitteeMembers(event.id, managingCommittee.id, selectedMemberIds, user?.name || 'User');
      triggerSuccess(`Updated student roster for "${managingCommittee.name}"`);
    } else {
      submitEventCommitteeMembers(event.id, managingCommittee.id, selectedMemberIds, user?.name || 'User', user?.email || '');
      triggerSuccess(`Roster update for "${managingCommittee.name}" submitted for approval from the Centre Head, Advisor, or GG Campus Head of Events.`);
    }
    setManagingCommittee(null);
    setEvent(getEventById(eventId));
  };

  const handleConfirmDeleteCommittee = () => {
    if (!event || !deletingCommitteeId) return;

    deleteEventCommittee(event.id, deletingCommitteeId, user?.name || 'User');
    setDeletingCommitteeId(null);
    setEvent(getEventById(eventId));
    triggerSuccess('Removed committee from event.');
  };

  const handleConfirmDeleteTask = () => {
    if (!event || !deletingTaskId) return;

    deleteTask(deletingTaskId, user?.name || 'User');
    setDeletingTaskId(null);
    setTasks(getTasks().filter(t => t.eventId === eventId || t.event === event.title));
    triggerSuccess('Task deleted successfully.');
  };

  const handleApproveCommittee = (committeeId: string) => {
    if (!event) return;
    approveEventCommittee(event.id, committeeId, user?.name || 'User');
    setEvent(getEventById(eventId));
    setReviewingCommittee(null);
    triggerSuccess('Approved. The change is now live.');
  };

  const handleConfirmRejectCommittee = () => {
    if (!event || !rejectingCommitteeId) return;
    rejectEventCommittee(event.id, rejectingCommitteeId, user?.name || 'User', committeeRejectionReasonInput || undefined);
    setEvent(getEventById(eventId));
    setRejectingCommitteeId(null);
    setCommitteeRejectionReasonInput('');
    triggerSuccess('Rejected.');
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle || !taskDueDate || !event) return;

    const assignedMember = members.find(m => m.id === taskAssigneeId);
    const assignedComm = event.committees.find(c => c.id === taskCommitteeId);
    // A committee task can optionally require sign-off from a specific
    // reviewer before it actually lands on the committee's students —
    // the task stays hidden (pending_create) until that reviewer approves it.
    const reviewer = !assignedMember ? members.find(m => m.id === taskReviewerId) : undefined;

    addTask({
      title: taskTitle,
      event: event.title,
      eventId: event.id,
      eventCommitteeId: taskCommitteeId || undefined,
      eventCommitteeName: assignedComm?.name || undefined,
      assignee: assignedMember ? assignedMember.name : (assignedComm ? assignedComm.name : 'Unassigned'),
      assigneeId: assignedMember?.id,
      assigneeEmail: assignedMember?.email,
      assigneeType: assignedMember ? 'individual' : 'committee',
      dueDate: taskDueDate,
      creatorName: user?.name || 'Leadership',
      ...(reviewer ? {
        approvalStatus: 'pending_create' as const,
        approverType: 'SPECIFIC_MEMBER' as const,
        approverMemberId: reviewer.id,
        approvalPolicyName: 'Committee Task Review',
        submittedBy: user?.name,
        submittedByEmail: user?.email,
      } : {}),
    });

    setTaskTitle('');
    setTaskCommitteeId('');
    setTaskAssigneeId('');
    setTaskDueDate('');
    setTaskReviewerId('');
    setIsAddTaskModalOpen(false);

    setTasks(getTasks().filter(t => t.eventId === eventId || t.event === event.title));
    triggerSuccess(reviewer ? `Task sent to ${reviewer.name} for review before it's assigned.` : 'Event deliverable task assigned.');
  };

  const isLeadership = canManageEvents(user);

  if (!event) {
    return (
      <div className="p-6 md:p-8 space-y-6">
        <Link href="/dashboard/events" className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-semibold">
          <ChevronLeft className="h-4 w-4" /> Back to Events
        </Link>
        <div className="glass-panel rounded-2xl p-12 text-center text-theme-text-secondary text-xs">
          Event not found or has been removed.
        </div>
      </div>
    );
  }

  // Calculate student participants for this event
  const allEventMemberIds = Array.from(new Set(event.committees.flatMap(c => c.memberIds)));
  const eventParticipants = members.filter(m => allEventMemberIds.includes(m.id));

  return (
    <div className="p-6 md:p-8 space-y-6">
      
      {/* Alert Banner */}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-success/15 border border-success/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Breadcrumb & Navigation */}
      <div className="flex items-center justify-between">
        <Link 
          href="/dashboard/events"
          className="inline-flex items-center gap-1 text-xs text-theme-text-secondary hover:text-accent font-semibold transition-all cursor-pointer"
        >
          <ChevronLeft className="h-4 w-4" />
          All Events
        </Link>
        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
          event.status === 'active' ? 'bg-success/15 text-success border border-success/30' :
          event.status === 'completed' ? 'bg-primary/15 text-primary-light border border-primary/30' :
          'bg-warning/15 text-warning border border-warning/30'
        }`}>
          {event.status}
        </span>
      </div>

      {/* Event Header Banner */}
      <div className="glass-panel rounded-3xl p-6 md:p-8 space-y-4 border border-theme-border/40 relative overflow-hidden">
        <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-black text-theme-text-primary tracking-tight">{event.title}</h1>
            {canExportEventDetails(user) && (
              <button
                onClick={() => downloadEventDetailsCsv(event, members)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer border border-theme-border/40"
                title="Download event details and student details (CSV)"
              >
                <Download className="h-4 w-4" />
                Download Event & Student Details
              </button>
            )}
          </div>
          <p className="text-xs text-theme-text-secondary max-w-3xl leading-relaxed">{event.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-3 border-t border-theme-border/20 text-xs text-theme-text-secondary">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-accent" />
            <span className={event.datesTBD ? 'text-warning font-semibold' : ''}>{formatEventDateRange(event)}</span>
          </div>
          {formatEventPlanningNote(event) && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-accent/70" />
              <span className="text-accent/90 font-medium">{formatEventPlanningNote(event)}</span>
            </div>
          )}
          {event.location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-warning" />
              <span>{event.location}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            <span>{event.committees.length} Event Committees &middot; {eventParticipants.length} Student Organizers</span>
          </div>
        </div>
      </div>

      {/* Event expenses — booked in the Finance module against this event */}
      {(() => {
        const eventExpenses = getExpenses().filter((x) => x.eventId === event.id);
        const actualSpent = eventExpenses.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);

        const spentByHead: Record<string, number> = {};
        eventExpenses.forEach((x) => { spentByHead[x.head] = (spentByHead[x.head] || 0) + (Number(x.amount) || 0); });

        const eventSponsors = getEventSponsors(event.id);
        const sponsorTotal = getEventSponsorTotal(event);
        const sponsorCovered = Math.min(actualSpent, sponsorTotal);
        const surplusReturned = Math.max(0, sponsorTotal - actualSpent);

        return (
          <div className="glass-panel rounded-2xl p-5 border border-theme-card-border space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
                  <Wallet className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-theme-text-primary flex items-center gap-2">
                    Event Expenses
                    <Link href="/dashboard/budget" className="text-[10px] text-accent hover:underline font-semibold flex items-center gap-0.5">
                      View in Finance &rarr;
                    </Link>
                  </h3>
                  <p className="text-[11px] text-theme-text-secondary">
                    Bill-backed expenses booked against this event in the Finance module
                  </p>
                </div>
              </div>
              <div className="text-xs">
                <span className="text-[10px] text-theme-text-secondary block font-medium uppercase tracking-wider">Total Spent</span>
                <span className="font-extrabold text-emerald-400 text-sm">₹{actualSpent.toLocaleString()}</span>
              </div>
            </div>

            {Object.keys(spentByHead).length > 0 && (
              <div className="flex flex-wrap gap-2 text-[11px]">
                {Object.entries(spentByHead).map(([head, amt]) => (
                  <span key={head} className="px-2.5 py-1 rounded-lg bg-theme-background/40 border border-theme-border/30 text-theme-text-secondary">
                    {getExpenseHeadLabel(head)}: <strong className="text-theme-text-primary">₹{amt.toLocaleString()}</strong>
                  </span>
                ))}
              </div>
            )}

            {sponsorTotal > 0 && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-emerald-400">
                    🤝 Event Sponsors ({eventSponsors.map((s) => s.name).join(', ')}): ₹{sponsorTotal.toLocaleString()}
                  </span>
                </div>
                <div className="text-[11px] text-theme-text-secondary">
                  {actualSpent > 0 ? (
                    <span>
                      <strong className="text-emerald-400">₹{sponsorCovered.toLocaleString()}</strong> depleted from sponsor &middot;{' '}
                      <strong className="text-indigo-400">₹{surplusReturned.toLocaleString()}</strong> surplus returned to Centre
                    </span>
                  ) : (
                    <span>Fully sponsored — ₹{sponsorTotal.toLocaleString()} surplus available</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Main Grid: Event Committees (Sub-categories) & Event Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Event Committees (Sub-categories) */}
        <div className="glass-panel rounded-2xl p-6 lg:col-span-1 space-y-5 flex flex-col">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider">Event Committees</h3>
              <p className="text-[11px] text-theme-text-secondary">Sub-category units executing this event</p>
            </div>
            {isLeadership && (
              <button
                onClick={openAddCommitteeModal}
                className="px-2.5 py-1.5 bg-accent hover:bg-primary-light text-white text-[11px] font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Unit
              </button>
            )}
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-[600px] pr-1">
            {event.committees.length === 0 ? (
              <div className="text-center py-8 text-theme-text-secondary text-xs bg-theme-border/5 rounded-xl border border-theme-border/20">
                No committee sub-units added to this event yet.
              </div>
            ) : (
              event.committees.map(committee => {
                const assignedStudents = members.filter(m => committee.memberIds.includes(m.id));
                const isPendingCreate = committee.approvalStatus === 'pending_create';
                const isPendingMembers = committee.approvalStatus === 'pending_members';
                const pendingStudents = isPendingMembers
                  ? members.filter(m => (committee.pendingMemberIds || []).includes(m.id))
                  : [];

                return (
                  <div key={committee.id} className={`p-4 border rounded-xl space-y-3 text-xs ${isPendingCreate ? 'bg-warning/5 border-warning/25' : 'bg-theme-border/10 border-theme-border/20'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-theme-text-primary text-xs">{committee.name}</h4>
                        {!isPendingCreate && (
                          <span className="text-[10px] text-theme-text-secondary">{assignedStudents.length} student members assigned</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {user && !isPendingCreate && (
                          <button
                            onClick={() => setApprovalRequestCommittee(committee)}
                            className="p-1 text-theme-text-secondary hover:text-accent hover:bg-theme-border/30 rounded cursor-pointer transition-all"
                            title="Ask someone to approve this committee"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {isLeadership && (
                          <button
                            onClick={() => setDeletingCommitteeId(committee.id)}
                            className="p-1 text-danger hover:bg-danger/10 rounded cursor-pointer transition-all"
                            title="Remove Committee"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {isPendingCreate ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-warning">
                          <Clock className="h-3 w-3" />
                          Awaiting approval from Centre Head / Advisor / GG Campus Head of Events
                          {committee.submittedBy && (
                            <span className="font-normal text-theme-text-secondary">&middot; Requested by {committee.submittedBy}</span>
                          )}
                        </div>
                        {committee.pendingMemberIds && committee.pendingMemberIds.length > 0 && (
                          <div className="text-[10px] text-theme-text-secondary">
                            Proposed students ({committee.pendingMemberIds.length}):{' '}
                            <span className="text-theme-text-primary font-medium">
                              {members.filter(m => committee.pendingMemberIds?.includes(m.id)).map(m => m.name).join(', ')}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Member Avatars */}
                        <div className="flex flex-wrap gap-1.5">
                          {assignedStudents.length === 0 ? (
                            <span className="text-[11px] text-theme-text-secondary italic">No students assigned</span>
                          ) : (
                            assignedStudents.map(s => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setSelectedStudentForProfile(s.id)}
                                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-accent/15 hover:bg-accent/25 text-theme-text-primary border border-accent/25 transition-all cursor-pointer"
                                title="Click to view student profile"
                              >
                                <User className="h-2.5 w-2.5 text-accent" />
                                {s.name}
                              </button>
                            ))
                          )}
                        </div>

                        {isPendingMembers && (
                          <div className="p-2 bg-warning/10 border border-warning/25 rounded-lg space-y-1.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-warning">
                              <Clock className="h-3 w-3" />
                              Roster update awaiting approval ({pendingStudents.length} student{pendingStudents.length === 1 ? '' : 's'} proposed)
                            </div>
                            {committee.submittedBy && (
                              <p className="text-[10px] text-theme-text-secondary pl-4">Requested by {committee.submittedBy}</p>
                            )}
                          </div>
                        )}

                        {isLeadership && (
                          <button
                            onClick={() => openManageMembers(committee)}
                            className="w-full py-1.5 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary text-[11px] font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <UserPlus className="h-3 w-3" />
                            Assign / Manage Students
                          </button>
                        )}
                      </>
                    )}

                    {(isPendingCreate || isPendingMembers) && canBypassCommitteeApproval && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => setReviewingCommittee(committee)}
                          className="flex-1 py-1.5 bg-success/15 hover:bg-success/25 text-success border border-success/30 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Check className="h-3 w-3" />
                          Approve
                        </button>
                        <button
                          onClick={() => setRejectingCommitteeId(committee.id)}
                          className="flex-1 py-1.5 bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <X className="h-3 w-3" />
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Event Deliverables / Tasks & Roster */}
        <div className="glass-panel rounded-2xl p-6 lg:col-span-2 space-y-6">
          
          {/* Section 1: Event Tasks */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-accent" />
                  Event Tasks & Deliverables ({tasks.length})
                </h3>
                <p className="text-[11px] text-theme-text-secondary">Track deadlines and review deliverable completion</p>
              </div>
              {isLeadership && (
                <button
                  onClick={() => setIsAddTaskModalOpen(true)}
                  className="px-3 py-1.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Assign Task
                </button>
              )}
            </div>

            {tasks.length === 0 ? (
              <div className="text-center py-8 text-theme-text-secondary text-xs bg-theme-border/5 rounded-xl border border-theme-border/20">
                No tasks created specifically for this event yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left">
                  <thead>
                    <tr className="text-theme-text-secondary border-b border-theme-border/40 text-xs">
                      <th className="pb-2.5 font-semibold">Task Deliverable</th>
                      <th className="pb-2.5 font-semibold">Assignee / Committee</th>
                      <th className="pb-2.5 font-semibold">Due Date</th>
                      <th className="pb-2.5 font-semibold">Status</th>
                      <th className="pb-2.5 font-semibold">Performance Rating</th>
                      <th className="pb-2.5 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-border/20">
                    {tasks.map(t => (
                      <tr key={t.id} className="hover:bg-theme-border/10 transition-all text-xs">
                        <td className="py-3 font-semibold text-theme-text-primary">{t.title}</td>
                        <td className="py-3 text-theme-text-secondary">
                          <span className="font-medium text-theme-text-primary">{t.assignee}</span>
                          {t.eventCommitteeName && (
                            <span className="block text-[10px] text-theme-text-secondary">{t.eventCommitteeName}</span>
                          )}
                        </td>
                        <td className="py-3 text-theme-text-secondary whitespace-nowrap">{t.dueDate}</td>
                        <td className="py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            t.status === 'Completed' ? 'bg-success/15 text-success' :
                            t.status === 'In Progress' ? 'bg-primary/15 text-primary-light' :
                            t.status === 'Pending Extension' ? 'bg-danger/15 text-danger' :
                            'bg-warning/15 text-warning'
                          }`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="py-3">
                          {t.ratingScore ? (
                            <span className="inline-flex items-center gap-1 font-bold text-accent">
                              <Award className="h-3 w-3" />
                              {t.ratingScore.toFixed(1)}/5.0
                            </span>
                          ) : (
                            <span className="text-[10px] text-theme-text-secondary italic">Awaiting evaluation</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          {canDeleteTask(user, t) && (
                            <button
                              onClick={() => setDeletingTaskId(t.id)}
                              className="p-1 hover:bg-danger/10 rounded-md text-danger transition-all cursor-pointer"
                              title="Delete Task"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 3: Student Organizer Directory for this Event */}
          <div className="space-y-3 pt-4 border-t border-theme-border/20">
            <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider flex items-center gap-2">
              <Users className="h-4 w-4 text-warning" />
              Event Student Directory Roster ({eventParticipants.length})
            </h3>

            {eventParticipants.length === 0 ? (
              <div className="text-center py-6 text-theme-text-secondary text-xs">
                No students assigned to any committee for this event yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                {eventParticipants.map(member => (
                  <div key={member.id} className="p-2.5 bg-theme-border/10 border border-theme-border/20 rounded-xl flex items-center gap-2.5 text-xs">
                    <div className="h-7 w-7 bg-accent/20 rounded-lg flex items-center justify-center font-bold text-accent text-[10px]">
                      {member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="overflow-hidden">
                      <p className="font-semibold text-theme-text-primary truncate">{member.name}</p>
                      <p className="text-[10px] text-theme-text-secondary truncate">{member.division}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Modal 1: Add Committee to this Event */}
      {isAddCommitteeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-lg rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl max-h-[90vh]">
            <div>
              <h2 className="text-base font-bold text-theme-text-primary">Create Event Committee Unit</h2>
              <p className="text-xs text-theme-text-secondary mt-0.5">Select a committee and add students for {event.title}</p>
            </div>

            <form onSubmit={handleCreateCommittee} className="space-y-4 text-xs flex flex-col flex-1 overflow-hidden">
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Committee Type *</label>
                <select
                  value={selectedCommitteePreset}
                  onChange={(e) => setSelectedCommitteePreset(e.target.value)}
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                >
                  {COMMITTEE_PRESETS.map((c) => (
                    <option key={c} value={c}>
                      {c === 'Others' ? 'Others (Enter Custom Tag)' : c}
                    </option>
                  ))}
                </select>
              </div>

              {selectedCommitteePreset === 'Others' && (
                <div className="space-y-1.5 animate-in fade-in duration-150">
                  <label className="block font-medium text-theme-text-secondary">Custom Committee Name / Tag *</label>
                  <input
                    type="text"
                    required
                    value={customCommitteeName}
                    onChange={(e) => setCustomCommitteeName(e.target.value)}
                    placeholder="e.g. Media Production, Security, Logistics"
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              )}

              {/* Student Member Multi-Select */}
              <div className="space-y-2 flex-1 overflow-hidden flex flex-col">
                <label className="block font-medium text-theme-text-secondary">
                  Add Students to Committee ({newCommitteeMemberIds.length} selected)
                </label>
                <div className="flex items-center gap-2 px-3 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl focus-within:border-accent">
                  <Search className="h-3.5 w-3.5 text-theme-text-secondary shrink-0" />
                  <input
                    type="text"
                    value={newCommitteeMemberQuery}
                    onChange={(e) => setNewCommitteeMemberQuery(e.target.value)}
                    placeholder="Search by student name, division, or email..."
                    className="w-full bg-transparent border-0 focus:outline-none focus:ring-0 text-theme-text-primary placeholder-theme-text-secondary text-xs"
                  />
                </div>

                <div className="space-y-1 overflow-y-auto max-h-52 pr-1 divide-y divide-theme-border/20 border border-theme-border/30 rounded-xl p-2 bg-theme-background/20">
                  {(() => {
                    const q = newCommitteeMemberQuery.trim().toLowerCase();
                    const filtered = members
                      .filter(m => m.status !== 'Terminated')
                      .filter(m => !q ||
                        m.name.toLowerCase().includes(q) ||
                        m.division.toLowerCase().includes(q) ||
                        m.email.toLowerCase().includes(q)
                      )
                      .slice().sort((a, b) => a.name.localeCompare(b.name));

                    if (filtered.length === 0) {
                      return <p className="py-4 text-center text-xs text-theme-text-secondary italic">No students match search.</p>;
                    }

                    return filtered.map(student => {
                      const isSelected = newCommitteeMemberIds.includes(student.id);
                      return (
                        <div
                          key={student.id}
                          onClick={() => {
                            setNewCommitteeMemberIds(prev =>
                              prev.includes(student.id) ? prev.filter(id => id !== student.id) : [...prev, student.id]
                            );
                          }}
                          className="flex items-center justify-between p-2 hover:bg-theme-border/10 rounded-lg cursor-pointer transition-all text-xs"
                        >
                          <div>
                            <p className="font-semibold text-theme-text-primary">{student.name}</p>
                            <p className="text-[10px] text-theme-text-secondary">{student.division} &middot; {student.email}</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="h-4 w-4 accent-accent cursor-pointer"
                          />
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-theme-border/20">
                <button
                  type="button"
                  onClick={() => setIsAddCommitteeModalOpen(false)}
                  className="px-4 py-2 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary font-semibold rounded-xl text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl text-xs shadow-md shadow-accent/15 cursor-pointer"
                >
                  {canBypassCommitteeApproval ? 'Create Committee' : 'Submit Committee for Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Manage Committee Students */}
      {managingCommittee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-lg rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl max-h-[85vh]">
            <div>
              <h2 className="text-base font-bold text-theme-text-primary">Assign Students to {managingCommittee.name}</h2>
              <p className="text-xs text-theme-text-secondary mt-0.5">Select organizers from the full member directory</p>
            </div>

            <div className="flex items-center gap-2 px-4 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl focus-within:border-accent">
              <Search className="h-3.5 w-3.5 text-theme-text-secondary shrink-0" />
              <input
                type="text"
                value={committeeMemberQuery}
                onChange={(e) => setCommitteeMemberQuery(e.target.value)}
                placeholder="Search by name, division, or email..."
                className="w-full bg-transparent border-0 focus:outline-none focus:ring-0 text-theme-text-primary placeholder-theme-text-secondary text-xs"
              />
            </div>

            <div className="space-y-2 overflow-y-auto max-h-96 pr-1 divide-y divide-theme-border/20">
              {(() => {
                const q = committeeMemberQuery.trim().toLowerCase();
                const filteredMembers = members
                  .filter(m => m.status !== 'Terminated')
                  .filter(m => !q ||
                    m.name.toLowerCase().includes(q) ||
                    m.division.toLowerCase().includes(q) ||
                    m.email.toLowerCase().includes(q)
                  )
                  .slice().sort((a, b) => a.name.localeCompare(b.name));

                if (filteredMembers.length === 0) {
                  return <p className="py-6 text-center text-xs text-theme-text-secondary italic">No members match &ldquo;{committeeMemberQuery}&rdquo;.</p>;
                }

                return filteredMembers.map(student => {
                const isSelected = selectedMemberIds.includes(student.id);
                return (
                  <div
                    key={student.id}
                    onClick={() => handleToggleMember(student.id)}
                    className="flex items-center justify-between p-2.5 hover:bg-theme-border/10 rounded-xl cursor-pointer transition-all text-xs"
                  >
                    <div>
                      <p className="font-semibold text-theme-text-primary">{student.name}</p>
                      <p className="text-[10px] text-theme-text-secondary">{student.division} &middot; {student.email}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="h-4 w-4 accent-accent cursor-pointer"
                    />
                  </div>
                );
                });
              })()}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-theme-border/20">
              <button
                type="button"
                onClick={() => setManagingCommittee(null)}
                className="px-4 py-2 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary font-semibold rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCommitteeMembers}
                className="px-4 py-2 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl text-xs shadow-md shadow-accent/15"
              >
                Save Assignments ({selectedMemberIds.length} students)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review & Approve Committee Modal — shows exactly what's being
          approved (the committee, who submitted it, and the actual proposed
          roster) instead of approving blind off a bare "Approve" click. */}
      {reviewingCommittee && (() => {
        const isReviewingPendingCreate = reviewingCommittee.approvalStatus === 'pending_create';
        const proposedStudents = members.filter(m => (reviewingCommittee.pendingMemberIds || []).includes(m.id));
        const currentStudents = members.filter(m => reviewingCommittee.memberIds.includes(m.id));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="glass-panel w-full max-w-md rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl">
              <div>
                <h2 className="text-base font-bold text-theme-text-primary">Review Before Approving</h2>
                <p className="text-xs text-theme-text-secondary mt-0.5">
                  {isReviewingPendingCreate ? 'A new committee, submitted for approval' : 'A roster update, submitted for approval'}
                </p>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 bg-theme-background/30 border border-theme-border/30 rounded-xl space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-theme-text-secondary font-bold">Committee</p>
                  <p className="font-semibold text-theme-text-primary">{reviewingCommittee.name}</p>
                </div>

                <div className="p-3 bg-theme-background/30 border border-theme-border/30 rounded-xl space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-theme-text-secondary font-bold">Submitted By</p>
                  <p className="font-semibold text-theme-text-primary">{reviewingCommittee.submittedBy || 'Unknown'}</p>
                  {reviewingCommittee.submittedByEmail && (
                    <p className="text-theme-text-secondary">{reviewingCommittee.submittedByEmail}</p>
                  )}
                </div>

                {isReviewingPendingCreate ? (
                  proposedStudents.length > 0 ? (
                    <div className="p-3 bg-warning/10 border border-warning/25 rounded-xl space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-warning font-bold">Proposed Initial Roster ({proposedStudents.length})</p>
                      <ul className="space-y-1">
                        {proposedStudents.map(s => (
                          <li key={s.id} className="text-theme-text-primary font-medium">{s.name} <span className="text-theme-text-secondary font-normal">({s.division})</span></li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-theme-text-secondary italic">No student roster proposed yet — this creates the committee with an empty roster.</p>
                  )
                ) : (
                  <div className="p-3 bg-warning/10 border border-warning/25 rounded-xl space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-warning font-bold">Proposed Roster ({proposedStudents.length})</p>
                    {proposedStudents.length === 0 ? (
                      <p className="text-theme-text-secondary italic">Empty — this clears the committee's roster.</p>
                    ) : (
                      <ul className="space-y-1">
                        {proposedStudents.map(s => (
                          <li key={s.id} className="text-theme-text-primary font-medium">{s.name} <span className="text-theme-text-secondary font-normal">({s.division})</span></li>
                        ))}
                      </ul>
                    )}
                    {currentStudents.length > 0 && (
                      <p className="text-theme-text-secondary pt-1">Currently: {currentStudents.map(s => s.name).join(', ')}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-theme-border/20">
                <button
                  type="button"
                  onClick={() => setReviewingCommittee(null)}
                  className="px-4 py-2 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary font-semibold rounded-xl text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleApproveCommittee(reviewingCommittee.id)}
                  className="px-4 py-2 bg-success hover:bg-success/90 text-white font-semibold rounded-xl text-xs shadow-md shadow-success/15 cursor-pointer"
                >
                  Confirm Approval
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal 3: Assign Event Task */}
      {isAddTaskModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-lg rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl">
            <div>
              <h2 className="text-base font-bold text-theme-text-primary">Assign Event Task</h2>
              <p className="text-xs text-theme-text-secondary mt-0.5">Create a deliverable tied to {event.title}</p>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="block font-medium text-theme-text-secondary">Task Title *</label>
                <input
                  type="text"
                  required
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="e.g. Procure 100 ID Badges and Lanyards"
                  className="w-full px-4 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block font-medium text-theme-text-secondary">Event Committee</label>
                  <SearchableSelect
                    value={taskCommitteeId}
                    onChange={setTaskCommitteeId}
                    allLabel="General Event Task"
                    allValue=""
                    options={event.committees
                      .filter(c => c.approvalStatus !== 'pending_create')
                      .map(c => ({ value: c.id, label: c.name }))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-medium text-theme-text-secondary">Assignee Student</label>
                  <SearchableSelect
                    value={taskAssigneeId}
                    onChange={setTaskAssigneeId}
                    allLabel="Select individual assignee..."
                    allValue=""
                    options={members
                      .filter(m => m.status !== 'Terminated')
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(p => ({ value: p.id, label: `${p.name} (${p.division})` }))}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block font-medium text-theme-text-secondary">Due Date *</label>
                <input
                  type="date"
                  required
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                  className="w-full px-4 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              {!taskAssigneeId && (
                <div className="space-y-1">
                  <label className="block font-medium text-theme-text-secondary">Require Review From (optional)</label>
                  <SearchableSelect
                    value={taskReviewerId}
                    onChange={setTaskReviewerId}
                    allLabel="No review needed — assign immediately"
                    allValue=""
                    options={members
                      .filter(m => m.status !== 'Terminated' && m.id !== (user?.id || ''))
                      .map(m => ({ value: m.id, label: `${m.name} (${m.role})` }))}
                  />
                  {taskReviewerId && (
                    <p className="text-[10px] text-theme-text-secondary pt-0.5">
                      The task stays hidden from the committee until this reviewer approves it.
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddTaskModalOpen(false)}
                  className="px-4 py-2 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary font-semibold rounded-xl text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl text-xs shadow-md shadow-accent/15"
                >
                  Assign Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Committee Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingCommitteeId)}
        title="Remove Event Committee"
        message="Are you sure you want to remove this committee from the event? Student assignments for this committee will be detached."
        confirmLabel="Remove Committee"
        variant="danger"
        onConfirm={handleConfirmDeleteCommittee}
        onCancel={() => setDeletingCommitteeId(null)}
      />

      {/* Delete Task Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingTaskId)}
        title="Delete Task"
        message="Are you sure you want to delete this task deliverable? This action cannot be undone."
        confirmLabel="Delete Task"
        variant="danger"
        onConfirm={handleConfirmDeleteTask}
        onCancel={() => setDeletingTaskId(null)}
      />

      {approvalRequestCommittee && user && (
        <RequestApprovalModal
          isOpen={Boolean(approvalRequestCommittee)}
          onClose={() => setApprovalRequestCommittee(null)}
          entityType="committee"
          entityId={approvalRequestCommittee.id}
          entityTitle={approvalRequestCommittee.name}
          eventId={eventId}
          members={members}
          currentUser={user}
          onRequested={() => triggerSuccess('Approval request sent!')}
        />
      )}

      {/* Student Profile Modal */}
      <StudentProfileModal
        memberIdOrName={selectedStudentForProfile}
        onClose={() => setSelectedStudentForProfile(null)}
      />

      {/* Reject Pending Committee Approval Modal */}
      {rejectingCommitteeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                <Ban className="h-4.5 w-4.5 text-danger" />
                Reject Submission
              </h2>
              <button
                onClick={() => { setRejectingCommitteeId(null); setCommitteeRejectionReasonInput(''); }}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-1.5 text-xs">
              <label className="block font-medium text-theme-text-secondary">Reason (optional)</label>
              <textarea
                value={committeeRejectionReasonInput}
                onChange={(e) => setCommitteeRejectionReasonInput(e.target.value)}
                rows={3}
                placeholder="Let the submitter know why this was rejected..."
                className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent resize-none"
              />
            </div>
            <button
              onClick={handleConfirmRejectCommittee}
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
