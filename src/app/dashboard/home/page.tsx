'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Calendar,
  CheckSquare,
  AlertCircle,
  Megaphone,
  ExternalLink,
  ChevronRight,
  Star,
  Crown,
  Award,
  Users,
  Sparkles,
  Check,
  CheckCircle2
} from 'lucide-react';
import {
  getTasks,
  getEvents,
  getMembers,
  getRatings,
  getAnnouncements,
  updateTaskStatus,
  updateTaskStatusAsync,
  getStudentLeaderboard,
  getEffectiveEventStatus,
  formatEventDateRange,
  formatEventPlanningNote,
  getEventSortTime,
  isTaskAssignee,
  hasAcknowledgedTask,
  acknowledgeTask,
  isFestivalEvent,
  TaskItem,
  EventItem,
  AnnouncementItem
} from '@/lib/local-data';
import { canViewTaskExtended, canViewEvent, canApprovePendingEvent } from '@/lib/permissions';
import { getRatingColor } from '@/lib/design-tokens';
import { StudentProfileModal } from '@/components/student-profile-modal';
import { GanttTimeline } from '@/components/gantt-timeline';
import { TaskErrorToast } from '@/components/task-error-toast';

export default function DashboardHome() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [membersCount, setMembersCount] = useState(0);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [user, setUser] = useState<any>(null);
  
  // Announcements, Events, and Festivals Tab State
  const [activeTab, setActiveTab] = useState<'events' | 'festivals' | 'announcements'>('events');

  // Leaderboard State
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [overallAvgScore, setOverallAvgScore] = useState<number>(0);
  const [hasRatings, setHasRatings] = useState(false);
  const [selectedStudentForProfile, setSelectedStudentForProfile] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  // Optimistic completion animation and rollback state
  const [animatingTaskIds, setAnimatingTaskIds] = useState<Set<string>>(new Set());
  const [disappearingTaskIds, setDisappearingTaskIds] = useState<Set<string>>(new Set());
  const [bottomErrorToast, setBottomErrorToast] = useState<{
    isOpen: boolean;
    message: string;
    taskId?: string;
  }>({ isOpen: false, message: '' });

  useEffect(() => {
    const refreshData = () => {
      const allEvents = getEvents();
      setEvents(allEvents.sort((a, b) => getEventSortTime(a) - getEventSortTime(b)));

      const allTasks = getTasks();
      setTasks(allTasks);

      setMembersCount(getMembers().length);
      setAnnouncements(getAnnouncements());

      // Dynamic Individual Student Leaderboard
      const studentRanks = getStudentLeaderboard();
      setLeaderboard(studentRanks.slice(0, 5));

      const validTaskIds = new Set(allTasks.map(t => t.id));
      const ratingsList = getRatings().filter(r => r.taskId && validTaskIds.has(r.taskId));
      setHasRatings(ratingsList.length > 0);
      if (ratingsList.length > 0) {
        const totalScore = ratingsList.reduce((acc, r) => acc + r.overallScore, 0);
        setOverallAvgScore(parseFloat((totalScore / ratingsList.length).toFixed(1)));
      }

      setLastUpdatedAt(new Date());
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

  // Acknowledgment is a personal attestation, not a status change anyone
  // else can make on a student's behalf — routed through the dedicated
  // /api/tasks/ack endpoint (see acknowledgeTask in local-data.ts), which
  // independently re-verifies server-side that the caller is genuinely the
  // task's own assignee before recording anything under their id.
  const handleAcknowledge = async (id: string) => {
    const updated = await acknowledgeTask(id, user);
    if (updated) setTasks(getTasks());
  };

  const handleComplete = async (id: string) => {
    // 1. Immediately trigger the celebratory completed visual state on client
    setAnimatingTaskIds(prev => new Set(prev).add(id));

    // After 420ms of celebratory animation, initiate smooth collapse / slide-out
    setTimeout(() => {
      setDisappearingTaskIds(prev => new Set(prev).add(id));
    }, 420);

    // 2. Perform backend completion at server end
    const res = await updateTaskStatusAsync(id, 'Completed', user?.name || 'User');

    if (res.success) {
      setTimeout(() => {
        setAnimatingTaskIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setDisappearingTaskIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setTasks(getTasks());
      }, 550);
    } else {
      // Revert on failure
      setAnimatingTaskIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setDisappearingTaskIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setTasks(getTasks());
      setBottomErrorToast({
        isOpen: true,
        message: res.error || 'Error in updation of the task, please try again.',
        taskId: id,
      });
    }
  };

  const handleRequestExtension = (id: string) => {
    updateTaskStatus(id, 'Pending Extension');
    setTasks(getTasks());
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  // Same visibility rule as the Events page: approved/legacy events follow the
  // own-vs-all Group Policy scope; pending/rejected submissions are only shown to
  // their submitter, their resolved approver, or the Super User.
  const visibleEvents = events
    .filter(event => !isFestivalEvent(event))
    .filter(event => {
      if (event.approvalStatus === 'pending_create' || event.approvalStatus === 'rejected') {
        return user?.tier === 1 || event.submittedByEmail === user?.email || canApprovePendingEvent(event, user);
      }
      return canViewEvent(event, user);
    });

  const visibleFestivals = events
    .filter(isFestivalEvent)
    .filter(event => event.startDate >= todayStr)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const activeEventsCount = visibleEvents.filter(e => {
    const effective = getEffectiveEventStatus(e, tasks);
    return effective !== 'completed' && effective !== 'archived';
  }).length;

  const getEventsOnDate = (date: Date) => {
    const checkStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return visibleEvents.filter(e => !e.datesTBD && checkStr >= e.startDate && checkStr <= e.endDate);
  };

  // Filter tasks based on shared permission helper
  const displayedTasks = tasks.filter(task => canViewTaskExtended(task, user));

  // The "Assigned Tasks" dashboard tile is meant to show what's actually
  // outstanding — tasks still needing action (acknowledgment, progress, or
  // completion) — not the full historical list including everything already
  // wrapped up. TaskItem has no createdAt, so due-date year is the only
  // available signal for "this year's" tasks; scoping the active count to
  // the current calendar year keeps the tile from accumulating stale,
  // long-overdue tasks from prior years forever — it naturally resets each
  // January as new tasks get due dates in the new year.
  const currentYear = new Date().getFullYear();
  const isCurrentYearTask = (t: TaskItem) => {
    const due = new Date(t.dueDate);
    return !isNaN(due.getTime()) && due.getFullYear() === currentYear;
  };

  const activeDisplayedTasks = displayedTasks.filter(t => t.status !== 'Completed' && isCurrentYearTask(t));
  const activeTasksCount = activeDisplayedTasks.length;

  // Count tasks awaiting THIS member's own acknowledgment — must check
  // isTaskAssignee (am I literally the assignee?), not canViewTaskExtended
  // (can I see this task at all?). The latter is deliberately broad —
  // Executives and Department Heads can see every task in their scope so
  // they show up correctly elsewhere on this page — which was inflating
  // this "awaiting YOUR acknowledgment" banner with tasks assigned to
  // other people entirely, showing every leadership/Executive viewer the
  // same non-personal number regardless of what's actually theirs to act on.
  // Checking hasAcknowledgedTask instead of status === 'Assigned' matters
  // for a group/committee task specifically: the shared status can already
  // read 'In Progress' purely because a DIFFERENT assignee acknowledged
  // first, but that never counts as THIS member's own acknowledgment, so
  // they'd otherwise silently drop off this banner despite never having
  // personally acknowledged anything themselves.
  const pendingAckCount = tasks.filter(t =>
    t.status !== 'Completed' &&
    t.approvalStatus !== 'pending_create' &&
    t.approvalStatus !== 'pending_edit' &&
    t.approvalStatus !== 'rejected' &&
    isTaskAssignee(t, user) &&
    !hasAcknowledgedTask(t, user) &&
    isCurrentYearTask(t)
  ).length;

  const completedTasksCount = displayedTasks.filter(t => t.status === 'Completed' && isCurrentYearTask(t)).length;

  const scorePercentage = Math.min(100, Math.max(0, (overallAvgScore / 5.0) * 100));

  const validTaskIds = new Set(tasks.map(t => t.id));
  const ratingsList = getRatings().filter(r => r.taskId && validTaskIds.has(r.taskId));
  const performanceBreakdown = hasRatings
    ? `Average of ${ratingsList.length} evaluation${ratingsList.length === 1 ? '' : 's'} across ${new Set(ratingsList.map(r => r.targetId)).size} member(s), on a 5.0 scale covering quality, timeliness, initiative, and collaboration.`
    : 'No evaluations submitted yet — visit Ratings to score task deliverables.';

  return (
    <div className="p-6 md:p-8 space-y-6">
      
      {/* Welcome Card */}
      {user && (
        <div className="glass-panel rounded-3xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-accent/10 to-primary/5 border border-accent/20">
          <div>
            <h1 className="text-xl font-bold text-theme-text-primary">Hello! Welcome back, {user.name}</h1>
            <p className="text-xs text-theme-text-secondary mt-1">
              Designation: <span className="font-semibold text-theme-text-primary">{user.role || 'Member'}</span>
              {(user.committee || user.division) && (
                <> &middot; {user.committee ? `Committee: ${user.committee}` : `Division: ${user.division}`}</>
              )}
            </p>
          </div>
          <span className="text-xs font-semibold text-accent px-3.5 py-1.5 bg-accent/15 rounded-xl border border-accent/20">
            {user.role || user.division || 'LEADS Member'}
          </span>
        </div>
      )}

      {/* Banner: Task awaiting acknowledgment */}
      {pendingAckCount > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-amber-500/15 dark:bg-amber-500/20 border border-amber-500/30 dark:border-amber-400/40 rounded-2xl shadow-lg backdrop-blur-xl animate-in fade-in duration-300">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-300 shrink-0" />
            <span className="text-xs font-bold text-slate-900 dark:text-white">
              You have {pendingAckCount} task(s) awaiting your acknowledgment.
            </span>
          </div>
          <Link 
            href="/dashboard/tasks"
            className="text-xs font-extrabold text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 uppercase tracking-wider px-4 py-2 rounded-xl transition-all shadow-md shadow-amber-500/20 shrink-0 cursor-pointer"
          >
            Review Tasks
          </Link>
        </div>
      )}

      {/* Grid: Stats Widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Active Events */}
        <Link
          href="/dashboard/events"
          className="glass-panel rounded-2xl p-5 flex items-center justify-between transition-all hover:ring-2 hover:ring-accent/30 cursor-pointer"
          title="Open the Events module"
        >
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">Active Events</span>
            <h3 className="text-2xl font-bold text-theme-text-primary">{activeEventsCount}</h3>
            <span className="text-[11px] text-theme-text-secondary font-medium">
              {visibleEvents.length} total planned / active
            </span>
          </div>
          <div className="h-11 w-11 bg-accent/15 rounded-xl flex items-center justify-center border border-accent/15">
            <Calendar className="h-5 w-5 text-accent" />
          </div>
        </Link>

        {/* Tasks Assigned */}
        <Link
          href="/dashboard/tasks"
          className="glass-panel rounded-2xl p-5 flex items-center justify-between transition-all hover:ring-2 hover:ring-success/30 cursor-pointer"
          title="Open the Tasks module"
        >
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">Assigned Tasks</span>
            <h3 className="text-2xl font-bold text-theme-text-primary">{activeTasksCount}</h3>
            <span className="text-[11px] font-semibold flex items-center gap-1.5">
              <span className="text-warning">{activeTasksCount} pending</span>
              <span className="text-theme-text-secondary font-normal">&middot;</span>
              <span className="text-success">{completedTasksCount} completed this year</span>
            </span>
          </div>
          <div className="h-11 w-11 bg-success/15 rounded-xl flex items-center justify-center border border-success/15">
            <CheckSquare className="h-5 w-5 text-success" />
          </div>
        </Link>

        {/* Members / Roster Count */}
        <Link
          href="/dashboard/directory"
          className="glass-panel rounded-2xl p-5 flex items-center justify-between transition-all hover:ring-2 hover:ring-primary/30 cursor-pointer"
          title="Open the Member Directory"
        >
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">Member Roster</span>
            <h3 className="text-2xl font-bold text-theme-text-primary">{membersCount}</h3>
            <span className="text-[11px] text-accent font-semibold">Active center members</span>
          </div>
          <div className="h-11 w-11 bg-primary/15 rounded-xl flex items-center justify-center border border-primary/15">
            <Users className="h-5 w-5 text-accent" />
          </div>
        </Link>

        {/* Performance Rollup */}
        <Link
          href="/dashboard/ratings"
          className="glass-panel rounded-2xl p-5 flex items-center justify-between transition-all hover:ring-2 hover:ring-emerald-500/30 cursor-pointer"
          title={performanceBreakdown}
        >
          <div className="space-y-1.5 flex-1 pr-2">
            <span className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">Performance Rollup</span>
            {hasRatings ? (
              <h3 className="text-2xl font-bold text-theme-text-primary">
                {overallAvgScore.toFixed(1)} <span className="text-xs font-normal text-theme-text-secondary">/ 5.0</span>
              </h3>
            ) : (
              <h3 className="text-sm font-semibold text-theme-text-secondary">No ratings yet</h3>
            )}
            {/* Continuous progress track */}
            <div className="w-full bg-theme-border/40 h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${hasRatings ? scorePercentage : 0}%` }}
              ></div>
            </div>
            <span className="text-[10px] text-theme-text-secondary font-medium">
              {hasRatings ? `Avg of ${ratingsList.length} evaluation${ratingsList.length === 1 ? '' : 's'}` : 'Hover for details'}
            </span>
          </div>
          <div className="h-11 w-11 bg-emerald-500/15 rounded-xl flex items-center justify-center border border-emerald-500/20">
            <Star className="h-5 w-5 text-emerald-500 fill-emerald-500" />
          </div>
        </Link>

      </div>

      {lastUpdatedAt && (
        <p className="text-[10px] text-theme-text-secondary font-medium -mt-2 text-right">
          Last updated {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      {/* Cross-Module Project Timeline (Gantt) */}
      <GanttTimeline events={visibleEvents} tasks={displayedTasks} />

      {/* Grid: Calendar & Leaderboard Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Calendar Quick-Access Card */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col space-y-4">
          <div>
            <h3 className="text-base font-bold text-theme-text-primary">LEADS Event Calendar</h3>
            <p className="text-xs text-theme-text-secondary">Explore scheduled symposiums, workshops, and milestones</p>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3 py-6 border border-theme-border/30 rounded-2xl bg-theme-background/10">
            <Calendar className="h-8 w-8 text-accent" />
            <p className="text-xs text-theme-text-secondary max-w-xs">
              {getEventsOnDate(new Date()).length > 0
                ? `${getEventsOnDate(new Date()).length} event(s) happening today.`
                : 'View the full interactive calendar to browse upcoming events by month.'}
            </p>
            <Link
              href="/dashboard/calendar"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer"
            >
              Open Calendar
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Top Performers Leaderboard */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col space-y-4">
          <div>
            <h3 className="text-base font-bold text-theme-text-primary">Student Performance Leaderboard</h3>
            <p className="text-xs text-theme-text-secondary">Individual student contributor rankings from the Reports module's Final Score (average of task evaluations)</p>
          </div>

          <div className="flex-1 space-y-2.5">
            {leaderboard.length === 0 ? (
              <div className="text-center py-10 text-theme-text-secondary text-xs">
                No evaluation scores submitted yet. Visit Ratings to evaluate student tasks.
              </div>
            ) : (
              leaderboard.map((perf, index) => {
                const rankIcons = [
                  <Crown key="crown" className="h-4 w-4 text-amber-400 shrink-0" />,
                  <Award key="award2" className="h-4 w-4 text-slate-300 shrink-0" />,
                  <Award key="award3" className="h-4 w-4 text-amber-600 shrink-0" />,
                ];

                const colorTokens = getRatingColor(perf.score);

                return (
                  <div 
                    key={perf.id || perf.name} 
                    onClick={() => setSelectedStudentForProfile(perf.id || perf.name)}
                    className="flex items-center justify-between p-3 bg-theme-border/10 border border-theme-border/20 rounded-2xl hover:bg-accent/10 hover:border-accent/30 transition-all text-xs cursor-pointer group"
                    title="Click to view student profile and outcomes"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-5 flex justify-center">
                        {index < 3 ? rankIcons[index] : <span className="font-bold text-theme-text-secondary">#{index + 1}</span>}
                      </div>

                      <div className="h-8 w-8 rounded-xl flex items-center justify-center border font-bold text-xs bg-accent/15 border-accent/20 text-accent group-hover:scale-105 transition-transform">
                        {perf.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>

                      <div>
                        <h4 className="font-bold text-theme-text-primary text-xs leading-snug group-hover:text-accent transition-colors">{perf.name}</h4>
                        <div className="flex items-center gap-1.5 text-[10px] text-theme-text-secondary">
                          <span className="font-medium">{perf.division}</span>
                          <span>&middot;</span>
                          <span>{perf.completedTasks} tasks done</span>
                          <span>&middot;</span>
                          <span>{perf.ratingsCount} task{perf.ratingsCount === 1 ? '' : 's'} evaluated</span>
                        </div>
                      </div>
                    </div>

                    <div
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-xl font-bold text-xs border ${colorTokens.bg} ${colorTokens.text} ${colorTokens.border}`}
                      title={
                        perf.ratingsCount > 0
                          ? `Same as the Reports module's Final Score: average evaluation score (${perf.rawScore.toFixed(1)} across ${perf.ratingsCount} evaluated task${perf.ratingsCount === 1 ? '' : 's'}, multi-reviewer tasks count once)`
                          : 'No ratings yet — 0.0 until their first evaluation'
                      }
                    >
                      <span>{perf.score.toFixed(2)}</span>
                      <Star className="h-3 w-3 fill-current" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Grid: Tasks Table & Dynamic Tabbed Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Active Tasks List */}
        <div className="glass-panel rounded-2xl p-6 lg:col-span-2 flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary">Actionable Tasks</h3>
              <p className="text-xs text-theme-text-secondary">Current assignments and workflow progress</p>
            </div>
            <Link 
              href="/dashboard/tasks" 
              className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
            >
              View All Tasks <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            {displayedTasks.length === 0 ? (
              <div className="text-center py-8 text-theme-text-secondary text-xs">
                {user?.tier === 4 ? 'No task obligations for Advisory Board role.' : 'No active tasks assigned to your view.'}
              </div>
            ) : (
              <table className="min-w-full text-xs text-left">
                <thead>
                  <tr className="text-theme-text-secondary border-b border-theme-border/40 text-xs">
                    <th className="pb-3 font-semibold">Task</th>
                    <th className="pb-3 font-semibold">Event</th>
                    <th className="pb-3 font-semibold">Due Date</th>
                    <th className="pb-3 font-semibold">Status</th>
                    <th className="pb-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-border/20">
                  {displayedTasks.slice(0, 5).map(task => {
                    const isAnimating = animatingTaskIds.has(task.id);
                    const isDisappearing = disappearingTaskIds.has(task.id);

                    return (
                      <tr 
                        key={task.id} 
                        className={`transition-all duration-500 ${
                          isDisappearing
                            ? 'opacity-0 -translate-x-4 max-h-0 py-0 pointer-events-none'
                            : isAnimating
                              ? 'bg-emerald-500/15 border-emerald-500/30'
                              : 'hover:bg-theme-border/10'
                        }`}
                      >
                        <td className="py-3 pr-2 font-medium text-theme-text-primary">
                          <div className="flex items-center gap-2">
                            {isAnimating && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 animate-bounce shrink-0" />
                            )}
                            <span className={isAnimating ? 'line-through text-emerald-300 transition-all' : ''}>
                              {task.title}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 pr-2 text-theme-text-secondary">{task.event || 'Standalone'}</td>
                        <td className="py-3 pr-2 text-theme-text-secondary">{task.dueDate}</td>
                        <td className="py-3 pr-2">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full transition-all duration-300 ${
                            isAnimating
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-500/20'
                              : task.status === 'Assigned' 
                                 ? 'bg-accent/15 text-accent border border-accent/20' 
                                 : task.status === 'In Progress' 
                                   ? 'bg-warning/15 text-warning border border-warning/20' 
                                   : task.status === 'Completed'
                                     ? 'bg-success/15 text-success border border-success/20'
                                     : 'bg-danger/15 text-danger border border-danger/20'
                          }`}>
                            {isAnimating ? (
                              <>
                                <Check className="w-2.5 h-2.5" />
                                <span>Completed!</span>
                              </>
                            ) : (
                              task.status
                            )}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          {/* Acknowledgment is personal — gated on isTaskAssignee
                              (am I literally the one this was allotted to?), not
                              just this row being visible to a broad viewer like
                              leadership, and checked against hasAcknowledgedTask
                              rather than status alone so a group/committee task
                              already In Progress from a DIFFERENT member's
                              acknowledgment still prompts this viewer for their
                              own if they haven't given it yet. */}
                          {task.approvalStatus === 'pending_create' || task.approvalStatus === 'pending_edit' ? (
                            <span className="text-[10px] text-warning font-medium">Pending approval</span>
                          ) : task.approvalStatus === 'rejected' ? (
                            <span className="text-[10px] text-danger font-medium">Rejected</span>
                          ) : task.status !== 'Completed' && isTaskAssignee(task, user) && !hasAcknowledgedTask(task, user) ? (
                            <button
                              onClick={() => handleAcknowledge(task.id)}
                              className="px-2.5 py-1 bg-accent hover:bg-primary-light text-white text-[10px] font-semibold rounded-lg transition-all cursor-pointer"
                            >
                              Acknowledge
                            </button>
                          ) : task.status === 'In Progress' || isAnimating ? (
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => handleComplete(task.id)}
                                disabled={isAnimating}
                                className={`px-2.5 py-1 text-white text-[10px] font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                                  isAnimating 
                                    ? 'bg-emerald-600 scale-95 shadow-md shadow-emerald-500/30' 
                                    : 'bg-success hover:bg-success/90'
                                }`}
                              >
                                {isAnimating ? (
                                  <>
                                    <Check className="w-2.5 h-2.5" />
                                    <span>Done!</span>
                                  </>
                                ) : (
                                  'Complete'
                                )}
                              </button>
                              {!isAnimating && (
                                <button
                                  onClick={() => handleRequestExtension(task.id)}
                                  className="px-2 py-1 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary text-[10px] font-semibold rounded-lg transition-all cursor-pointer"
                                  title="Request Deadline Extension"
                                >
                                  Extend
                                </button>
                              )}
                            </div>
                          ) : task.status === 'Assigned' ? (
                            <span className="text-[10px] text-theme-text-secondary">Awaiting acknowledgment</span>
                          ) : (
                            <span className="text-[10px] text-theme-text-secondary">Closed</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Dynamic Tabbed Events, Festivals & Announcements Panel */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col space-y-4">
          <div className="flex border-b border-theme-border/30 pb-2.5 gap-2 flex-wrap">
            <button
              onClick={() => setActiveTab('events')}
              className={`pb-1 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'events'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              Upcoming Events ({visibleEvents.filter(ev => getEffectiveEventStatus(ev, tasks) !== 'completed' && getEffectiveEventStatus(ev, tasks) !== 'archived').length})
            </button>

            <button
              onClick={() => setActiveTab('festivals')}
              className={`pb-1 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'festivals'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Festivals ({visibleFestivals.length})
            </button>

            <button
              onClick={() => setActiveTab('announcements')}
              className={`pb-1 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'announcements'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              <Megaphone className="h-3.5 w-3.5" />
              Announcements
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto max-h-[300px] pr-1 text-xs">
            {activeTab === 'events' ? (
              (() => {
                const upcoming = visibleEvents.filter(ev => {
                  const effective = getEffectiveEventStatus(ev, tasks);
                  return effective !== 'completed' && effective !== 'archived';
                });
                if (upcoming.length === 0) {
                  return <div className="text-center py-8 text-theme-text-secondary text-xs">No upcoming club/university events.</div>;
                }
                return upcoming.map(ev => (
                  <div key={ev.id} className="p-3 bg-white/40 dark:bg-white/5 border border-theme-border/20 rounded-xl space-y-1 hover:bg-white/60 dark:hover:bg-white/10 transition-all">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-theme-text-primary text-xs">{ev.title}</h4>
                      <span className="text-[10px] px-2 py-0.5 bg-accent/15 text-accent font-semibold rounded-md capitalize">{getEffectiveEventStatus(ev, tasks)}</span>
                    </div>
                    <p className="text-[10px] text-theme-text-secondary line-clamp-2">{ev.description}</p>
                    <p className={`text-[10px] font-medium pt-1 ${ev.datesTBD ? 'text-warning' : 'text-theme-text-secondary'}`}>{formatEventDateRange(ev)}</p>
                    {formatEventPlanningNote(ev) && (
                      <p className="text-[10px] font-medium text-accent/90">{formatEventPlanningNote(ev)}</p>
                    )}
                  </div>
                ));
              })()
            ) : activeTab === 'festivals' ? (
              (() => {
                if (visibleFestivals.length === 0) {
                  return <div className="text-center py-8 text-theme-text-secondary text-xs">No upcoming festivals in the next 30 days.</div>;
                }
                return visibleFestivals.slice(0, 8).map(fest => (
                  <div key={fest.id} className="p-3 bg-white/40 dark:bg-white/5 border border-theme-border/20 rounded-xl space-y-1 hover:bg-white/60 dark:hover:bg-white/10 transition-all flex items-start justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-theme-text-primary text-xs truncate">{fest.title}</h4>
                        <span className="text-[10px] px-1.5 py-0.2 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold rounded shrink-0">Festival</span>
                      </div>
                      <p className="text-[10px] text-theme-text-secondary line-clamp-1">{fest.description}</p>
                      <p className="text-[10px] font-medium text-theme-text-secondary">{fest.startDate}</p>
                    </div>
                    <Link
                      href="/dashboard/festivals"
                      className="text-[10px] text-accent hover:underline font-semibold shrink-0"
                    >
                      Details &rarr;
                    </Link>
                  </div>
                ));
              })()
            ) : (
              announcements.length === 0 ? (
                <div className="text-center py-8 text-theme-text-secondary text-xs">No announcements published.</div>
              ) : (
                announcements.map(ann => (
                  <div key={ann.id} className="p-3 bg-white/40 dark:bg-white/5 border border-theme-border/20 rounded-xl space-y-1 hover:bg-white/60 dark:hover:bg-white/10 transition-all">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-theme-text-primary text-xs">{ann.title}</h4>
                      <span className="text-[10px] text-accent font-medium px-2 py-0.5 bg-accent/10 rounded">{ann.scope}</span>
                    </div>
                    <p className="text-[10px] text-theme-text-secondary line-clamp-2">{ann.content}</p>
                    <p className="text-[10px] text-theme-text-secondary font-medium pt-1">{ann.publishedAt} &middot; by {ann.authorName}</p>
                  </div>
                ))
              )
            )}
          </div>
        </div>

      </div>

      {/* Student Profile Modal */}
      <StudentProfileModal
        memberIdOrName={selectedStudentForProfile}
        onClose={() => setSelectedStudentForProfile(null)}
      />

      {/* Bottom Right Error Toast with Try Again */}
      <TaskErrorToast
        isOpen={bottomErrorToast.isOpen}
        message={bottomErrorToast.message}
        onClose={() => setBottomErrorToast(prev => ({ ...prev, isOpen: false }))}
        onRetry={bottomErrorToast.taskId ? () => handleComplete(bottomErrorToast.taskId!) : undefined}
      />

    </div>
  );
}
