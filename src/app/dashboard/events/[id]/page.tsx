'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
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
  getBudgets,
  getReimbursements,
  addTask,
  deleteTask,
  formatEventDateRange,
  formatEventPlanningNote,
  getEventSponsors,
  getEventSponsorTotal,
  EventItem,
  Member,
  TaskItem,
  EventPassItem,
  getEventPasses,
} from '@/lib/local-data';
import { canExportEventDetails, canManageEvents, canDeleteTask, canViewEventGuestList, canViewIssuedCertificates, canDeleteCertificates } from '@/lib/permissions';
import { IssuedCertificatesPanel } from '@/components/issued-certificates-panel';
import { downloadEventDetailsCsv } from '@/lib/event-participants-export';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { StudentProfileModal } from '@/components/student-profile-modal';
import { SearchableSelect } from '@/components/searchable-select';

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const eventId = resolvedParams.id;

  const [event, setEvent] = useState<EventItem | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [user, setUser] = useState<any>(null);

  // Modals & States
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssigneeId, setTaskAssigneeId] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');

  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [selectedStudentForProfile, setSelectedStudentForProfile] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [eventPasses, setEventPasses] = useState<EventPassItem[]>([]);

  useEffect(() => {
    const refreshData = () => {
      const loadedEvent = getEventById(eventId);
      setEvent(loadedEvent);
      setMembers(getMembers());
      setTasks(getTasks().filter(t => t.eventId === eventId || t.event === loadedEvent?.title));
      setEventPasses(getEventPasses(eventId).filter(p => !p.approvalStatus || p.approvalStatus === 'pending_edit'));
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
  }, [eventId]);

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleConfirmDeleteTask = () => {
    if (!event || !deletingTaskId) return;

    deleteTask(deletingTaskId, user?.name || 'User');
    setDeletingTaskId(null);
    setTasks(getTasks().filter(t => t.eventId === eventId || t.event === event.title));
    triggerSuccess('Task deleted successfully.');
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle || !taskDueDate || !event) return;

    const assignedMember = members.find(m => m.id === taskAssigneeId);

    addTask({
      title: taskTitle,
      event: event.title,
      eventId: event.id,
      assignee: assignedMember ? assignedMember.name : 'Unassigned',
      assigneeId: assignedMember?.id,
      assigneeEmail: assignedMember?.email,
      assigneeType: 'individual',
      dueDate: taskDueDate,
      creatorName: user?.name || 'Leadership',
    });

    setTaskTitle('');
    setTaskAssigneeId('');
    setTaskDueDate('');
    setIsAddTaskModalOpen(false);

    setTasks(getTasks().filter(t => t.eventId === eventId || t.event === event.title));
    triggerSuccess('Event task assigned.');
  };

  const isLeadership = canManageEvents(user);

  // Members who hold a task for this event.
  const eventParticipants = members.filter(m => tasks.some(t => t.assigneeId === m.id || (t.assigneeIds || []).includes(m.id)));

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
            <span>{tasks.length} Task{tasks.length === 1 ? '' : 's'} &middot; {eventParticipants.length} Team Member{eventParticipants.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      {/* Event Financial & Budget Health Card (Integrated with Budgeting Module) */}
      {(() => {
        const allBudgets = getBudgets();
        const allReimbursements = getReimbursements();

        // Calculate proposed budget allocated to this event
        let proposedAmount = 0;
        allBudgets.forEach((b) => {
          if (b.eventId === event.id) {
            proposedAmount += b.amount || b.proposedAmount || 0;
          }
          if (b.lineItems) {
            b.lineItems.forEach((li) => {
              if (li.eventId === event.id) {
                proposedAmount += li.amount || li.proposedAmount || 0;
              }
            });
          }
        });

        // Calculate actual approved reimbursements for this event
        const actualSpent = allReimbursements
          .filter((r) => r.eventId === event.id && r.status === 'Approved')
          .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

        // Calculate sponsors and surplus for this event
        const eventSponsors = getEventSponsors(event.id);
        const sponsorTotal = getEventSponsorTotal(event);
        const sponsorCovered = Math.min(actualSpent, sponsorTotal);
        const surplusReturned = Math.max(0, sponsorTotal - actualSpent);

        const variance = proposedAmount - actualSpent;
        const percentUsed = proposedAmount > 0 ? Math.min(Math.round((actualSpent / proposedAmount) * 100), 100) : 0;

        return (
          <div className="glass-panel rounded-2xl p-5 border border-theme-card-border space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
                  <Wallet className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-theme-text-primary flex items-center gap-2">
                    Event Financial Health & Budget Status
                    <Link
                      href="/dashboard/budget"
                      className="text-[10px] text-accent hover:underline font-semibold flex items-center gap-0.5"
                    >
                      View in Budget Module &rarr;
                    </Link>
                  </h3>
                  <p className="text-[11px] text-theme-text-secondary">
                    Synced live with Budgeting Module & Approved Reimbursements
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs">
                <div>
                  <span className="text-[10px] text-theme-text-secondary block font-medium uppercase tracking-wider">
                    Allocated Proposed Budget
                  </span>
                  <span className="font-extrabold text-accent text-sm">
                    ₹{proposedAmount.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-theme-text-secondary block font-medium uppercase tracking-wider">
                    Realized Actual Spent
                  </span>
                  <span className="font-extrabold text-emerald-400 text-sm">
                    ₹{actualSpent.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-theme-text-secondary block font-medium uppercase tracking-wider">
                    Variance / Forecast
                  </span>
                  <span
                    className={`font-extrabold text-sm ${
                      variance >= 0 ? 'text-emerald-400' : 'text-danger'
                    }`}
                  >
                    {variance >= 0 ? `+₹${variance.toLocaleString()}` : `-₹${Math.abs(variance).toLocaleString()}`}
                  </span>
                </div>
              </div>
            </div>

            {/* Event Sponsorship & Surplus Return Status Banner */}
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

            {/* Budget Progress Bar */}
            {proposedAmount > 0 && (
              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-[10px] text-theme-text-secondary font-medium">
                  <span>Budget Utilization: {percentUsed}%</span>
                  <span>{variance >= 0 ? `₹${variance.toLocaleString()} remaining` : 'Over budget!'}</span>
                </div>
                <div className="h-2 w-full bg-theme-background/60 rounded-full overflow-hidden border border-theme-border/20">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      actualSpent > proposedAmount
                        ? 'bg-danger'
                        : percentUsed > 85
                        ? 'bg-warning'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${percentUsed}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Main Grid: Event Tasks, passes & team */}
      <div className="grid grid-cols-1 gap-6">
        
        {/* Event Deliverables / Tasks & Team */}
        <div className="glass-panel rounded-2xl p-6 space-y-6">
          
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
                      <th className="pb-2.5 font-semibold">Assignee</th>
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

          {/* Section 2: Event Passes, guest list & certificates (Event Passes module) */}
          {(canViewEventGuestList(user) || canViewIssuedCertificates(user)) && (
            <div className="space-y-4 pt-4 border-t border-theme-border/20">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider flex items-center gap-2">
                    <Ticket className="h-4 w-4 text-accent" />
                    Event Passes & Guest List ({eventPasses.length})
                  </h3>
                  <p className="text-[11px] text-theme-text-secondary">Passes issued for this event and the certificates sent to attendees</p>
                </div>
                <Link href="/dashboard/event-passes" className="px-3 py-1.5 bg-accent/15 border border-accent/35 text-accent hover:bg-accent/25 text-xs font-bold rounded-xl flex items-center gap-1.5">
                  <Ticket className="h-3.5 w-3.5" />
                  Open Event Passes
                </Link>
              </div>
              {canViewEventGuestList(user) && (eventPasses.length === 0 ? (
                <div className="text-center py-8 text-theme-text-secondary text-xs bg-theme-border/5 rounded-xl border border-theme-border/20">
                  No passes issued for this event yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs text-left">
                    <thead>
                      <tr className="text-theme-text-secondary border-b border-theme-border/40 text-xs">
                        <th className="pb-2.5 font-semibold">Guest</th>
                        <th className="pb-2.5 font-semibold">Pass Type</th>
                        <th className="pb-2.5 font-semibold">Serial</th>
                        <th className="pb-2.5 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border/20">
                      {eventPasses.map(p => (
                        <tr key={p.id} className="hover:bg-theme-border/10 text-xs">
                          <td className="py-2.5 font-semibold text-theme-text-primary">
                            {p.attendeeName}
                            {(p.attendeeOrg || p.attendeeEmail) && <span className="block text-[10px] font-normal text-theme-text-secondary">{p.attendeeOrg || p.attendeeEmail}</span>}
                          </td>
                          <td className="py-2.5 text-theme-text-secondary">{p.passType}</td>
                          <td className="py-2.5 font-mono text-[10px] text-theme-text-secondary">{p.serialNumber}</td>
                          <td className="py-2.5">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              p.status === 'Checked In' ? 'bg-success/15 text-success' :
                              p.status === 'Cancelled' ? 'bg-danger/15 text-danger' :
                              'bg-primary/15 text-primary-light'
                            }`}>{p.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {canViewIssuedCertificates(user) && <IssuedCertificatesPanel eventId={eventId} compact canDelete={canDeleteCertificates(user)} />}
            </div>
          )}

          {/* Section 3: People with a task for this event */}
          <div className="space-y-3 pt-4 border-t border-theme-border/20">
            <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider flex items-center gap-2">
              <Users className="h-4 w-4 text-warning" />
              Event Team ({eventParticipants.length})
            </h3>

            {eventParticipants.length === 0 ? (
              <div className="text-center py-6 text-theme-text-secondary text-xs">
                Nobody has been assigned a task for this event yet.
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

              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <label className="block font-medium text-theme-text-secondary">Assign to</label>
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

      {/* Student Profile Modal */}
      <StudentProfileModal
        memberIdOrName={selectedStudentForProfile}
        onClose={() => setSelectedStudentForProfile(null)}
      />
    </div>
  );
}
