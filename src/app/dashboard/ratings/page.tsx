'use client';

import React, { useState, useEffect } from 'react';
import {
  Star,
  CheckCircle,
  Users,
  ShieldAlert,
  X,
  Search,
  Edit2,
  Trash2,
  CheckSquare,
  Palette,
  ChevronDown,
  Briefcase,
  ListFilter,
  Check
} from 'lucide-react';
import {
  getRatings,
  addRating,
  updateRating,
  deleteRating,
  getMembers,
  getTasks,
  getTaskAssignedDate,
  getTaskLateness,
  describeTaskLateness,
  getEvents,
  getTaskAssigneeStatuses,
  rateTaskMembers,
  Member,
  TaskItem,
  RatingItem,
  EventItem
} from '@/lib/local-data';
import { getRatingColor } from '@/lib/design-tokens';
import { canViewRating, canEvaluateEventStudent, canEditRating, resolveRatingReviewerRole, isFaculty, isSocialMediaTeamMember, isSocialMediaPostTask, isTaskRatable } from '@/lib/permissions';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { PeriodFilter } from '@/components/period-filter';
import { SearchableSelect } from '@/components/searchable-select';
import { PeriodFilterValue, extractAvailableMonths, isWithinPeriod } from '@/lib/period-filter';
import {
  RATING_CRITERIA,
  RatingCriteriaSet,
  criteriaSetForTaskCategory,
  averageScore,
  projectLegacyRatingFields,
} from '@/lib/rating-criteria';
import { groupScoredReportsBySubmitter } from '@/lib/report-scoring';
import { getEventReports, EventReportItem } from '@/lib/local-data';
import { ReportScorePanel } from '@/components/report-score-panel';
import { canScoreEventReports } from '@/lib/permissions';

const CRITERIA_SET_LABEL: Record<RatingCriteriaSet, string> = {
  general: 'General Task',
  design: 'Design Task',
  reportWriting: 'Report Writing Task',
};

// Sliders default to the midpoint (3 = Satisfactory), not the maximum score —
// defaulting to 5 meant a reviewer who opened the modal and submitted without
// touching a single slider silently handed out a perfect rating.
/** Assigned / due / completed dates of a task, plus a red callout when it was completed after the deadline with no extension. */
function TaskTimingLine({ task }: { task: TaskItem | undefined }) {
  if (!task) return null;
  const assigned = getTaskAssignedDate(task);
  const late = getTaskLateness(task);
  return (
    <div className="space-y-1 mt-1">
      <p className="text-[10px] text-theme-text-secondary">
        {assigned ? <>Assigned <strong className="text-theme-text-primary">{assigned}</strong> &middot; </> : null}
        Due <strong className="text-theme-text-primary">{task.dueDate}</strong>
        {task.status === 'Completed' && task.completedAt ? <> &middot; Completed <strong className="text-theme-text-primary">{task.completedAt.slice(0, 10)}</strong></> : null}
      </p>
      {late && (
        <p className="text-[10px] font-bold text-danger bg-danger/10 border border-danger/30 rounded-lg px-2 py-1">
          Submitted {late.daysLate} day{late.daysLate === 1 ? '' : 's'} after the deadline — no extension was given
        </p>
      )}
    </div>
  );
}

function defaultScoresFor(set: RatingCriteriaSet): Record<string, number> {
  const scores: Record<string, number> = {};
  RATING_CRITERIA[set].forEach(c => { scores[c.key] = 3; });
  return scores;
}

// Legacy ratings (pre-criteriaSet) only ever have the 4 fixed fields — editing
// one re-scores it against the General rubric, seeded from its old scores.
function legacyRatingAsGeneralScores(rating: RatingItem): Record<string, number> {
  return {
    accuracy: rating.quality,
    timeliness: rating.timeliness,
    collaboration: rating.collaboration,
    reliability: rating.initiative,
    communication: rating.overallScore,
  };
}

// Falls back to the title-string convention for tasks created before
// isDesignDeliverable existed, so already-created Design Portal tasks don't
// lose their Design Head evaluation rights after this deploys.
const isDesignTask = (task: TaskItem): boolean =>
  task.isDesignDeliverable === true || /design approved|design deliverable/i.test(task.title);

export default function RatingsPage() {
  const [ratings, setRatings] = useState<RatingItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [user, setUser] = useState<any>(null);
  const [eventReports, setEventReports] = useState<ReturnType<typeof getEventReports>>([]);
  const [scoringReportId, setScoringReportId] = useState<string | null>(null);

  // Search & Filter state
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>({ mode: 'ALL' });
  const [historyStudentFilter, setHistoryStudentFilter] = useState('ALL');
  const [historyEventFilter, setHistoryEventFilter] = useState('ALL');
  const [historyTaskFilter, setHistoryTaskFilter] = useState('ALL');
  // Score-range filter + sort for the Scorecard History table below — lets an
  // editor quickly isolate outlier scores (e.g. every 5.0, or everything
  // under 3.0) and sort them together, so a batch of scores that need
  // correcting can be reviewed and edited one after another instead of
  // hunting through the whole list in date order.
  const [historyScoreBand, setHistoryScoreBand] = useState<'ALL' | '5' | '4-4.9' | '3-3.9' | '2-2.9' | '0-1.9'>('ALL');
  const [historySortBy, setHistorySortBy] = useState<
    'newest' | 'oldest' | 'scoreHigh' | 'scoreLow' | 'nameAsc' | 'nameDesc' | 'taskAsc' | 'taskDesc' | 'eventAsc' | 'eventDesc' | 'evalCountHigh' | 'evalCountLow'
  >('newest');

  // Task Evaluation Queue — student/event filters, sort, and event grouping
  const [queueStudentFilter, setQueueStudentFilter] = useState('ALL');
  const [queueEventFilter, setQueueEventFilter] = useState('ALL');
  const [queueSortBy, setQueueSortBy] = useState<'pendingFirst' | 'titleAsc' | 'assigneeAsc' | 'eventAsc'>('pendingFirst');
  // Mirrors the Approvals page's Awaiting/Decided split — deliverables this
  // viewer has already evaluated move to their own tab instead of just
  // vanishing, so there's still a quick way to see what's been evaluated
  // without it cluttering the main pending queue.
  const [queueTab, setQueueTab] = useState<'pending' | 'evaluated'>('pending');

  // Evaluation Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRating, setEditingRating] = useState<RatingItem | null>(null);
  const [deletingRatingId, setDeletingRatingId] = useState<string | null>(null);

  // Selected Task for Evaluation
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);

  // Form Scores — which 5-criterion rubric is active, and the scores entered
  // against it (keyed by RATING_CRITERIA[activeCriteriaSet]'s criterion keys).
  const [activeCriteriaSet, setActiveCriteriaSet] = useState<RatingCriteriaSet>('general');
  const [scores, setScores] = useState<Record<string, number>>(defaultScoresFor('general'));
  const [notes, setNotes] = useState('');
  // Committee/group tasks: rate everyone with one scorecard, or just the
  // students ticked in `selectedMemberIds` (so people can be scored on their own merit).
  const [rateMode, setRateMode] = useState<'all' | 'selected'>('all');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  // Notification Alerts
  const [alertMsg, setAlertMsg] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const refreshData = () => {
      setRatings(getRatings());
      setMembers(getMembers());
      setTasks(getTasks());
      setEvents(getEvents());
      setEventReports(getEventReports());
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
    setAlertMsg(msg);
    setTimeout(() => setAlertMsg(''), 4000);
  };

  // Same targetId resolution handleEvaluateSubmit uses when creating a new
  // rating — factored out so the queue card can look up whether THIS viewer
  // has already filled their reviewer slot for a task, without duplicating
  // the member-lookup logic.
  const getRatingTargetId = (task: TaskItem): string => {
    const assigneeMember = members.find(m => m.name.toLowerCase() === task.assignee.toLowerCase());
    return assigneeMember ? assigneeMember.id : (task.assigneeId || task.assignee);
  };

  const isFanOutTask = (task: TaskItem) => task.assigneeType === 'committee' || Boolean(task.eventCommitteeId) || task.assigneeType === 'group';

  // Students that can actually be rated on a committee/group task (faculty excluded).
  const getRateableRoster = (task: TaskItem) => {
    if (!isFanOutTask(task)) return [];
    const forLookup: TaskItem = task.assigneeType === 'group' ? task : { ...task, assigneeType: 'committee' };
    return getTaskAssigneeStatuses(forLookup, members, events).filter(m => !m.isFaculty && members.some(mb => mb.id === m.id));
  };

  // This reviewer's own per-student rating rows for a task.
  const myMemberRatings = (task: TaskItem): RatingItem[] => {
    const role = resolveRatingReviewerRole(user, isDesignTask(task));
    return ratings.filter(r => r.taskId === task.id && !r.isGroupPlaceholder && ((role && r.reviewerRole === role) || r.raterName === user?.name));
  };

  const openEvaluationForTask = (task: TaskItem) => {
    if (!isTaskRatable(task)) {
      setAlertMsg(`Procurement tasks are administrative operations and not subject to ratings or reviews.`);
      setTimeout(() => setAlertMsg(''), 5000);
      return;
    }

    const linkedEvent = events.find(ev => ev.id === task.eventId || ev.title === task.event);
    const eventCampus = linkedEvent?.campus || task.eventCampus || 'GG Campus';

    if (!canEvaluateEventStudent(user, eventCampus, isDesignTask(task))) {
      setAlertMsg(`Evaluation Access Denied: You are not authorized to evaluate student performance for this deliverable.`);
      setTimeout(() => setAlertMsg(''), 5000);
      return;
    }

    const criteriaSet = criteriaSetForTaskCategory(task.taskCategory);
    setEditingRating(null);
    setSelectedTask(task);
    setActiveCriteriaSet(criteriaSet);
    setScores(defaultScoresFor(criteriaSet));
    setNotes('');
    setFormError('');
    const roster = getRateableRoster(task);
    if (roster.length > 1) {
      const rated = new Set(myMemberRatings(task).map(r => r.targetId));
      const unrated = roster.filter(m => !rated.has(m.id)).map(m => m.id);
      // Already rated some members? Default to the ones still outstanding.
      if (rated.size > 0 && unrated.length > 0) {
        setRateMode('selected');
        setSelectedMemberIds(unrated);
      } else if (rated.size > 0) {
        setRateMode('selected');
        setSelectedMemberIds([]);
      } else {
        setRateMode('all');
        setSelectedMemberIds(roster.map(m => m.id));
      }
    } else {
      setRateMode('all');
      setSelectedMemberIds([]);
    }
    setIsModalOpen(true);
  };

  const openEditEvaluation = (rating: RatingItem) => {
    setEditingRating(rating);
    const matchedTask = tasks.find(t => t.id === rating.taskId) || null;
    setSelectedTask(matchedTask);
    const criteriaSet = rating.criteriaSet ?? criteriaSetForTaskCategory(matchedTask?.taskCategory);
    setActiveCriteriaSet(criteriaSet);
    if (rating.scores) {
      // Keep only the current rubric's criteria (older ratings may carry retired keys).
      const base = defaultScoresFor(criteriaSet);
      const kept: Record<string, number> = {};
      Object.keys(base).forEach(k => { kept[k] = rating.scores?.[k] ?? base[k]; });
      setScores(kept);
    } else {
      setScores(rating.criteriaSet ? defaultScoresFor(criteriaSet) : legacyRatingAsGeneralScores(rating));
    }
    setNotes(rating.notes || '');
    setFormError('');
    setIsModalOpen(true);
  };

  const handleEvaluateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!selectedTask && !editingRating) {
      setFormError('Direct correlation check failed: Task selection is mandatory. Every rating must correlate directly to an active task deliverable.');
      return;
    }

    if (!user) return;

    if (selectedTask) {
      if (!isTaskRatable(selectedTask)) {
        setFormError('Evaluation Access Denied: Procurement tasks are administrative operations and not subject to ratings or reviews.');
        return;
      }
      const assigneeMember = members.find(m => m.name.toLowerCase() === selectedTask.assignee.toLowerCase() || m.id === selectedTask.assigneeId);
      if ((assigneeMember && isFaculty(assigneeMember)) || /prof\.|professor|faculty/i.test(selectedTask.assignee)) {
        setFormError('Evaluation Access Denied: Professors and faculty members cannot receive performance ratings.');
        return;
      }
      if (isSocialMediaPostTask(selectedTask)) {
        if (!assigneeMember || !isSocialMediaTeamMember(assigneeMember)) {
          setFormError('Evaluation Access Denied: Only student members of the Social Media team can be evaluated for social media posts.');
          return;
        }
      }
      const linkedEvent = events.find(ev => ev.id === selectedTask.eventId || ev.title === selectedTask.event);
      const eventCampus = linkedEvent?.campus || selectedTask.eventCampus || 'GG Campus';
      if (!canEvaluateEventStudent(user, eventCampus, isDesignTask(selectedTask))) {
        setFormError(`Evaluation Access Denied: Only authorized reviewers (Super User, Centre Head, Advisor, Head of Events) may evaluate performance.`);
        return;
      }
    }

    const overall = averageScore(scores);
    const legacy = projectLegacyRatingFields(activeCriteriaSet, scores);

    if (editingRating) {
      const correlatedTask = tasks.find(t => t.id === editingRating.taskId);
      if (!correlatedTask) {
        setFormError('Direct correlation check failed: the task associated with this rating no longer exists.');
        return;
      }
      if (!isTaskRatable(correlatedTask)) {
        setFormError('Evaluation Access Denied: Procurement tasks are administrative operations and not subject to ratings or reviews.');
        return;
      }
      const editLate = getTaskLateness(correlatedTask);
      updateRating(editingRating.id, {
        criteriaSet: activeCriteriaSet,
        scores,
        ...legacy,
        overallScore: overall,
        notes,
        lateNote: editLate ? describeTaskLateness(editLate) : undefined,
      }, user?.name || 'User');
      triggerSuccess(`Updated evaluation scorecard for ${editingRating.targetName}`);
    } else if (selectedTask) {
      const assigneeMember = members.find(m => m.name.toLowerCase() === selectedTask.assignee.toLowerCase());
      const isCommittee = selectedTask.assigneeType === 'committee' || selectedTask.eventCommitteeId;
      const isGroup = selectedTask.assigneeType === 'group';
      const targetId = assigneeMember ? assigneeMember.id : (selectedTask.assigneeId || selectedTask.assignee);
      const reviewerRole = resolveRatingReviewerRole(user, isDesignTask(selectedTask));

      // Reviewers (Super User, Centre Head, Advisor, GG Campus Events Head)
      // submit separate ratings that are averaged together. If this reviewer
      // already reviewed this exact task/target, re-submitting edits their existing
      // review in place instead of adding a duplicate row from the same reviewer.
      const ownExisting = ratings.find(
        r => r.taskId === selectedTask.id && r.targetId === targetId && reviewerRole !== null && (r.reviewerRole === reviewerRole || r.raterName === user.name)
      );

      const lateInfo = getTaskLateness(selectedTask);

      // Subset / individual rating on a committee or group task: write per-student
      // ratings for just the ticked students; everyone else stays unrated for now.
      const roster = getRateableRoster(selectedTask);
      const coversEveryone = roster.length > 0 && roster.every(m => selectedMemberIds.includes(m.id));
      if (roster.length > 1 && rateMode === 'selected' && !coversEveryone) {
        const chosen = roster.filter(m => selectedMemberIds.includes(m.id));
        if (chosen.length === 0) {
          setFormError('Select at least one student to rate, or switch to "All members".');
          return;
        }
        const done = rateTaskMembers(selectedTask, chosen.map(m => m.id), {
          raterName: user.name,
          reviewerRole: reviewerRole ?? undefined,
          criteriaSet: activeCriteriaSet,
          scores,
          ...legacy,
          overallScore: overall,
          notes,
          lateNote: lateInfo ? describeTaskLateness(lateInfo) : undefined,
        });
        triggerSuccess(`Submitted ${overall}/5.0 for ${done.length} student${done.length === 1 ? '' : 's'} on "${selectedTask.title}": ${done.map(r => r.targetName).join(', ')}`);
        setIsModalOpen(false);
        setEditingRating(null);
        setSelectedTask(null);
        setRatings(getRatings());
        setTasks(getTasks());
        return;
      }

      if (ownExisting) {
        updateRating(ownExisting.id, {
          criteriaSet: activeCriteriaSet,
          scores,
          ...legacy,
          overallScore: overall,
          notes,
          lateNote: lateInfo ? describeTaskLateness(lateInfo) : undefined,
        }, user.name);
      } else {
        addRating({
          taskId: selectedTask.id,
          taskTitle: selectedTask.title,
          eventId: selectedTask.eventId,
          eventName: selectedTask.event,
          targetId,
          targetName: selectedTask.assignee,
          raterName: user.name,
          reviewerRole: reviewerRole ?? undefined,
          criteriaSet: activeCriteriaSet,
          scores,
          ...legacy,
          overallScore: overall,
          notes,
          lateNote: lateInfo ? describeTaskLateness(lateInfo) : undefined,
          // Committee/group tasks don't have a real person as their target —
          // targetId/targetName here is the committee's or group's
          // placeholder string. Flag it so it never surfaces as if it were
          // an actual rated person (see RatingItem.isGroupPlaceholder); the
          // real per-student rows are created right below by addRating's
          // propagateCommitteeRating/propagateGroupRating fan-out.
          isGroupPlaceholder: Boolean(isCommittee || isGroup) || undefined,
        });
      }

      const committeeNotice = isCommittee
        ? ' (Evaluation propagated to all student members of this committee)'
        : isGroup
          ? ' (Evaluation propagated to all students in this group)'
          : '';
      const averageNotice = reviewerRole === 'SUPER_USER' || reviewerRole === 'CENTRE_HEAD' || reviewerRole === 'ADVISOR' || reviewerRole === 'GG_HEAD'
        ? ' — shown score is the live average of evaluations submitted so far'
        : '';
      triggerSuccess(`Submitted performance score of ${overall}/5.0 for ${selectedTask.assignee} on "${selectedTask.title}"${committeeNotice}${averageNotice}`);
    }

    setIsModalOpen(false);
    setEditingRating(null);
    setSelectedTask(null);
    setRatings(getRatings());
    setTasks(getTasks());
  };

  const handleConfirmDeleteRating = () => {
    if (!deletingRatingId) return;
    deleteRating(deletingRatingId, user?.name || 'User');
    setDeletingRatingId(null);
    setRatings(getRatings());
    setTasks(getTasks());
    triggerSuccess('Rating record removed successfully.');
  };

  const isAdmin = user && (user.tier <= 3 || user.tier === 5); // Tiers 1-3 & 5 can evaluate tasks

  // Whether the CURRENT viewer's own reviewer slot has already scored this task
  // — used both for the "pending first" sort and to decide whether a queue card offers
  // "Evaluate" or "Edit My Review".
  const hasMyRating = (task: TaskItem): boolean => {
    const reviewerRole = resolveRatingReviewerRole(user, isDesignTask(task));
    if (!reviewerRole) return false;
    const targetId = getRatingTargetId(task);
    if (ratings.some(r => r.taskId === task.id && r.targetId === targetId && (r.reviewerRole === reviewerRole || r.raterName === user?.name))) return true;
    // Rated member-by-member: done once every student has this reviewer's rating.
    const roster = getRateableRoster(task);
    if (roster.length === 0) return false;
    const rated = new Set(myMemberRatings(task).map(r => r.targetId));
    return roster.every(m => rated.has(m.id));
  };

  // The actual rating record hasMyRating found, if any — used by the
  // Evaluated tab's "Edit My Review" action.
  const getMyRatingForTask = (task: TaskItem): RatingItem | undefined => {
    const reviewerRole = resolveRatingReviewerRole(user, isDesignTask(task));
    if (!reviewerRole) return undefined;
    const targetId = getRatingTargetId(task);
    return ratings.find(r => r.taskId === task.id && r.targetId === targetId && (r.reviewerRole === reviewerRole || r.raterName === user?.name));
  };

  // Task Evaluation Queue surfaces completed student deliverables pending evaluation by the current user.
  // Administrative approval tasks, faculty deliverables, and social media tasks for non-team members are strictly excluded.
  const completedTasks = tasks.filter(t => {
    if (t.status !== 'Completed') return false;
    if (t.workflowType === 'holiday_social_approval') return false;
    if (!isTaskRatable(t)) return false;
    const assigneeMember = members.find(m => m.id === t.assigneeId || m.name.toLowerCase() === t.assignee.toLowerCase());
    if (assigneeMember && isFaculty(assigneeMember)) return false;
    if (/prof\.|professor|faculty/i.test(t.assignee)) return false;
    if (isSocialMediaPostTask(t)) {
      if (!assigneeMember || !isSocialMediaTeamMember(assigneeMember)) return false;
    }
    return true;
  });
  const pendingQueueTasks = completedTasks.filter(t => !hasMyRating(t));
  const evaluatedQueueTasks = completedTasks.filter(t => hasMyRating(t));
  const activeQueueTasks = queueTab === 'pending' ? pendingQueueTasks : evaluatedQueueTasks;

  const searchedQueueTasks = activeQueueTasks.filter(t => {
    const q = taskSearchQuery.toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      t.assignee.toLowerCase().includes(q) ||
      (t.event && t.event.toLowerCase().includes(q))
    );
  });

  // Filter option lists are derived from the currently search-matched tasks, so a
  // dropdown never offers a student/event with nothing left to evaluate.
  const queueStudentOptions = Array.from(new Set(searchedQueueTasks.map(t => t.assignee))).sort((a, b) => a.localeCompare(b));
  const queueEventOptions = Array.from(new Set(searchedQueueTasks.map(t => t.event || 'Standalone Deliverable'))).sort((a, b) => a.localeCompare(b));

  const filteredQueueTasks = searchedQueueTasks.filter(t => {
    if (queueStudentFilter !== 'ALL' && t.assignee !== queueStudentFilter) return false;
    if (queueEventFilter !== 'ALL' && (t.event || 'Standalone Deliverable') !== queueEventFilter) return false;
    return true;
  });

  const sortedQueueTasks = [...filteredQueueTasks].sort((a, b) => {
    switch (queueSortBy) {
      case 'titleAsc':
        return a.title.localeCompare(b.title);
      case 'assigneeAsc':
        return a.assignee.localeCompare(b.assignee);
      case 'eventAsc':
        return (a.event || 'Standalone Deliverable').localeCompare(b.event || 'Standalone Deliverable');
      case 'pendingFirst':
      default: {
        const aPending = hasMyRating(a) ? 1 : 0;
        const bPending = hasMyRating(b) ? 1 : 0;
        if (aPending !== bPending) return aPending - bPending;
        return a.title.localeCompare(b.title);
      }
    }
  });

  const queueGroups: { key: string; label: string; tasks: TaskItem[] }[] = [];
  sortedQueueTasks.forEach(task => {
    const key = task.eventId || 'standalone';
    let group = queueGroups.find(g => g.key === key);
    if (!group) {
      group = { key, label: task.event || 'Standalone Deliverables', tasks: [] };
      queueGroups.push(group);
    }
    group.tasks.push(task);
  });
  queueGroups.sort((a, b) => {
    if (a.key === 'standalone') return 1;
    if (b.key === 'standalone') return -1;
    return a.label.localeCompare(b.label);
  });

  const hasActiveQueueFilters = queueStudentFilter !== 'ALL' || queueEventFilter !== 'ALL' || taskSearchQuery !== '';
  const clearQueueFilters = () => {
    setQueueStudentFilter('ALL');
    setQueueEventFilter('ALL');
    setTaskSearchQuery('');
  };

  // Accessible ratings history baseline (faculty excluded, direct task correlation check enforced, period filter applied)
  const accessibleRatingsHistory = ratings.filter(r => {
    // Direct correlation check: if there is not any task, then it makes no sense that there would be a rating for said task!
    if (!r.taskId || !tasks.some(t => t.id === r.taskId)) return false;

    // Committee/group bookkeeping rows are keyed by the committee/group's
    // placeholder name, not a real person — never list them as a scorecard.
    // The real per-student rows (created by the propagate* fan-out) are
    // what should show up here instead.
    if (r.isGroupPlaceholder) return false;
    if (!canViewRating(r, user)) return false;

    // Professors/Faculty cannot get a rating or be part of ratings history
    const targetMember = members.find(m => m.id === r.targetId || m.name.toLowerCase() === r.targetName.toLowerCase());
    if (targetMember && isFaculty(targetMember)) return false;
    if (/prof\.|professor|faculty/i.test(r.targetName)) return false;

    // For social media tasks: only student members of the social media team
    const matchedTask = tasks.find(t => t.id === r.taskId || t.title === r.taskTitle);
    if (matchedTask && !isTaskRatable(matchedTask)) return false;
    if (/\[procurement\]|procure items/i.test(r.taskTitle)) return false;
    if ((matchedTask && isSocialMediaPostTask(matchedTask)) || /\[social media posting\]|social media post/i.test(r.taskTitle)) {
      if (!targetMember || !isSocialMediaTeamMember(targetMember)) return false;
    }

    return isWithinPeriod(r.createdAt, periodFilter);
  });

  // Filter options derived from all accessible history in this period
  const historyStudentOptions = Array.from(
    new Set(accessibleRatingsHistory.map(r => r.targetName))
  ).sort((a, b) => a.localeCompare(b));

  const historyEventOptions = Array.from(
    new Set(accessibleRatingsHistory.map(r => r.eventName || tasks.find(t => t.id === r.taskId)?.event || 'Standalone Deliverable'))
  ).sort((a, b) => a.localeCompare(b));

  const historyTaskOptions = Array.from(
    new Set(accessibleRatingsHistory.map(r => r.taskTitle || tasks.find(t => t.id === r.taskId)?.title || 'Deliverable'))
  ).sort((a, b) => a.localeCompare(b));

  // Filtered ratings history
  const filteredRatingsHistory = accessibleRatingsHistory.filter(r => {
    if (historyStudentFilter !== 'ALL' && r.targetName !== historyStudentFilter) return false;

    const evName = r.eventName || tasks.find(t => t.id === r.taskId)?.event || 'Standalone Deliverable';
    if (historyEventFilter !== 'ALL' && evName !== historyEventFilter) return false;

    const tTitle = r.taskTitle || tasks.find(t => t.id === r.taskId)?.title || '';
    if (historyTaskFilter !== 'ALL' && tTitle !== historyTaskFilter) return false;

    const matchesSearch =
      r.targetName.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
      r.taskTitle.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
      (r.eventName && r.eventName.toLowerCase().includes(historySearchQuery.toLowerCase())) ||
      r.raterName.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
      (r.notes && r.notes.toLowerCase().includes(historySearchQuery.toLowerCase()));

    return matchesSearch;
  });

  // Group scorecards by evaluated deliverable (taskId + targetId or taskTitle + targetName)
  interface ScorecardGroup {
    key: string;
    taskId: string;
    taskTitle: string;
    eventId?: string;
    eventName?: string;
    targetId: string;
    targetName: string;
    ratings: RatingItem[];
    aggregateScore: number;
    latestCreatedAt: string;
  }

  const scorecardGroups: ScorecardGroup[] = [];
  filteredRatingsHistory.forEach(r => {
    const key = `${r.taskId || r.taskTitle}_${r.targetId || r.targetName}`;
    let group = scorecardGroups.find(g => g.key === key);
    if (!group) {
      const task = tasks.find(t => t.id === r.taskId);
      group = {
        key,
        taskId: r.taskId,
        taskTitle: r.taskTitle || task?.title || 'Deliverable',
        eventId: r.eventId || task?.eventId,
        eventName: r.eventName || task?.event || 'Standalone Deliverable',
        targetId: r.targetId,
        targetName: r.targetName,
        ratings: [],
        aggregateScore: 0,
        latestCreatedAt: r.createdAt
      };
      scorecardGroups.push(group);
    }
    group.ratings.push(r);
    if (r.createdAt > group.latestCreatedAt) {
      group.latestCreatedAt = r.createdAt;
    }
  });

  scorecardGroups.forEach(g => {
    const sum = g.ratings.reduce((acc, r) => acc + r.overallScore, 0);
    g.aggregateScore = parseFloat((sum / g.ratings.length).toFixed(1));
  });

  // Score-range filter: isolate a specific band (e.g. every 5.0, or every
  // sub-3.0) to review together before editing.
  const scoreBandMatches = (score: number): boolean => {
    switch (historyScoreBand) {
      case '5': return score >= 5;
      case '4-4.9': return score >= 4 && score < 5;
      case '3-3.9': return score >= 3 && score < 4;
      case '2-2.9': return score >= 2 && score < 3;
      case '0-1.9': return score < 2;
      default: return true;
    }
  };
  const scoreFilteredGroups = historyScoreBand === 'ALL'
    ? scorecardGroups
    : scorecardGroups.filter(g => scoreBandMatches(g.aggregateScore));

  scoreFilteredGroups.sort((a, b) => {
    switch (historySortBy) {
      case 'oldest': return a.latestCreatedAt.localeCompare(b.latestCreatedAt);
      case 'scoreHigh': return b.aggregateScore - a.aggregateScore;
      case 'scoreLow': return a.aggregateScore - b.aggregateScore;
      case 'nameAsc': return a.targetName.localeCompare(b.targetName);
      case 'nameDesc': return b.targetName.localeCompare(a.targetName);
      case 'taskAsc': return a.taskTitle.localeCompare(b.taskTitle);
      case 'taskDesc': return b.taskTitle.localeCompare(a.taskTitle);
      case 'eventAsc': return (a.eventName || 'Standalone Deliverable').localeCompare(b.eventName || 'Standalone Deliverable');
      case 'eventDesc': return (b.eventName || 'Standalone Deliverable').localeCompare(a.eventName || 'Standalone Deliverable');
      case 'evalCountHigh': return b.ratings.length - a.ratings.length;
      case 'evalCountLow': return a.ratings.length - b.ratings.length;
      case 'newest':
      default: return b.latestCreatedAt.localeCompare(a.latestCreatedAt);
    }
  });

  const hasActiveHistoryFilters =
    historyStudentFilter !== 'ALL' ||
    historyEventFilter !== 'ALL' ||
    historyTaskFilter !== 'ALL' ||
    historyScoreBand !== 'ALL' ||
    historySearchQuery !== '' ||
    periodFilter.mode !== 'ALL';

  const clearHistoryFilters = () => {
    setHistoryStudentFilter('ALL');
    setHistoryEventFilter('ALL');
    setHistoryTaskFilter('ALL');
    setHistoryScoreBand('ALL');
    setHistorySearchQuery('');
    setPeriodFilter({ mode: 'ALL' });
  };

  const availableRatingMonths = extractAvailableMonths(ratings.map(r => r.createdAt));

  // Report Writing Final Score leaderboard — decay-weighted average of each
  // submitter's scored event reports (see report-scoring.ts). Excludes faculty.
  const reportScoreLeaderboard = groupScoredReportsBySubmitter(eventReports, members);
  const canScoreReports = !!user && canScoreEventReports(user);

  return (
    <div className="p-6 md:p-8 space-y-6">
      
      {/* Alert Banner */}
      {alertMsg && (
        <div className="flex items-center gap-3 p-4 bg-success/15 border border-success/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <CheckCircle className="h-5 w-5 text-success shrink-0" />
          <span>{alertMsg}</span>
        </div>
      )}

      {/* Header section */}
      <div>
        <h1 className="text-xl font-bold text-theme-text-primary">Task-Based Performance Ratings</h1>
        <p className="text-xs text-theme-text-secondary">Evaluate student members against the General, Design, or Report Writing rubric — whichever matches the task</p>
      </div>

      {/* Score event reports on the Report Writing rubric (same data as the Event Reports page) */}
      {canScoreReports && eventReports.length > 0 && (
        <div className="bg-theme-card border border-theme-card-border rounded-2xl p-5 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-theme-text-primary mb-1">Score Event Reports</h2>
            <p className="text-[11px] text-theme-text-secondary">
              Rate submitted event reports on the Report Writing rubric. Scores here are the same as on the Event Reports page and feed the Final Score below.
            </p>
          </div>
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {eventReports.filter(r => r.status !== 'rejected').map(report => (
              <div key={report.id} className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-theme-text-primary truncate">{report.eventTitle}</p>
                    <p className="text-[10px] text-theme-text-secondary">
                      Submitted by {report.submittedBy}
                      {report.reportScore != null && <> &middot; Score {report.reportScore.toFixed(1)}/5.0 (by {report.scoredBy})</>}
                    </p>
                  </div>
                  <button
                    onClick={() => setScoringReportId(scoringReportId === report.id ? null : report.id)}
                    className="shrink-0 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 text-[11px] font-bold rounded-lg transition-all cursor-pointer"
                  >
                    {report.reportScore != null ? 'Edit Score' : 'Score Report'}
                  </button>
                </div>
                {scoringReportId === report.id && (
                  <ReportScorePanel
                    report={report}
                    actorName={user?.name || 'Reviewer'}
                    onSaved={(r: EventReportItem) => {
                      setEventReports(getEventReports());
                      setScoringReportId(null);
                      triggerSuccess(`Scored ${r.reportScore?.toFixed(1)}/5.0 on the Report Writing rubric.`);
                    }}
                    onCancel={() => setScoringReportId(null)}
                    onError={(m) => window.alert(m)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Report Writing Final Score leaderboard */}
      {reportScoreLeaderboard.length > 0 && (
        <div className="bg-theme-card border border-theme-card-border rounded-2xl p-5">
          <h2 className="text-sm font-bold text-theme-text-primary mb-1">Report Writing — Final Score</h2>
          <p className="text-[11px] text-theme-text-secondary mb-3">
            Average of each submitter&apos;s scored event reports (100% of the score).
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs text-left">
              <thead>
                <tr className="text-theme-text-secondary border-b border-theme-border/40">
                  <th className="pb-2 font-semibold">Submitter</th>
                  <th className="pb-2 font-semibold">Reports Scored</th>
                  <th className="pb-2 font-semibold">Last Report</th>
                  <th className="pb-2 font-semibold">Final Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-border/20">
                {reportScoreLeaderboard.map(row => {
                  const colorTokens = getRatingColor(row.finalScore);
                  return (
                    <tr key={row.submittedBy}>
                      <td className="py-2.5 pr-2 font-bold text-theme-text-primary whitespace-nowrap">{row.submittedBy}</td>
                      <td className="py-2.5 pr-2 text-theme-text-secondary">{row.reportCount}</td>
                      <td className="py-2.5 pr-2 text-theme-text-secondary whitespace-nowrap">{row.lastSubmittedAt}</td>
                      <td className="py-2.5 pr-2">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-lg border ${colorTokens.bg} ${colorTokens.text} ${colorTokens.border}`}>
                          <Star className="h-3 w-3 fill-current" />
                          {row.finalScore.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grid: Task Evaluation Queue & Evaluation History */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Task Evaluation Queue */}
        <div className="glass-panel rounded-2xl p-6 lg:col-span-1 space-y-4 flex flex-col max-h-[580px]">
          <div>
            <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-accent" />
              Task Evaluation Queue
            </h3>
            <p className="text-xs text-theme-text-secondary">
              {queueTab === 'pending' ? 'Select any pending task deliverable to evaluate assignee performance' : 'Deliverables you have already evaluated'}
            </p>
          </div>

          <div className="flex items-center gap-1 p-0.5 bg-theme-background/40 border border-theme-border/40 rounded-lg">
            <button
              type="button"
              onClick={() => setQueueTab('pending')}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${
                queueTab === 'pending' ? 'bg-accent text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              Pending
              {pendingQueueTasks.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${queueTab === 'pending' ? 'bg-white/25' : 'bg-theme-border/40'}`}>
                  {pendingQueueTasks.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setQueueTab('evaluated')}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${
                queueTab === 'evaluated' ? 'bg-accent text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              Evaluated
              {evaluatedQueueTasks.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${queueTab === 'evaluated' ? 'bg-white/25' : 'bg-theme-border/40'}`}>
                  {evaluatedQueueTasks.length}
                </span>
              )}
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-theme-text-secondary" />
            <input
              type="text"
              value={taskSearchQuery}
              onChange={(e) => setTaskSearchQuery(e.target.value)}
              placeholder={queueTab === 'pending' ? 'Search pending tasks or assignees...' : 'Search evaluated tasks or assignees...'}
              className="w-full pl-8 pr-3 py-1.5 bg-theme-background/40 border border-theme-border/40 rounded-xl text-xs text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent"
            />
          </div>

          {/* Student / event filters + sort — mirrors the Tasks page filter bar */}
          <div className="space-y-1.5 relative z-10">
            <div className="grid grid-cols-2 gap-1.5">
              <SearchableSelect
                value={queueStudentFilter}
                onChange={setQueueStudentFilter}
                allLabel="All Students"
                allValue="ALL"
                placeholder="Search students..."
                compact
                options={queueStudentOptions.map(name => ({ value: name, label: name }))}
              />
              <SearchableSelect
                value={queueEventFilter}
                onChange={setQueueEventFilter}
                allLabel="All Events"
                allValue="ALL"
                placeholder="Search events..."
                compact
                options={queueEventOptions.map(name => ({ value: name, label: name }))}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 flex items-center gap-1.5 px-2 py-1.5 bg-theme-background/40 border border-theme-border/40 rounded-lg">
                <ListFilter className="h-3 w-3 text-theme-text-secondary shrink-0" />
                <select
                  value={queueSortBy}
                  onChange={(e) => setQueueSortBy(e.target.value as typeof queueSortBy)}
                  className="w-full bg-transparent text-[11px] text-theme-text-primary focus:outline-none"
                >
                  <option value="pendingFirst">Sort: Task Title (A-Z)</option>
                  <option value="titleAsc">Sort: Task Title (A-Z)</option>
                  <option value="assigneeAsc">Sort: Student (A-Z)</option>
                  <option value="eventAsc">Sort: Event (A-Z)</option>
                </select>
              </div>
              {hasActiveQueueFilters && (
                <button
                  onClick={clearQueueFilters}
                  className="px-2 py-1.5 text-[11px] font-semibold text-theme-text-secondary hover:text-theme-text-primary bg-theme-border/30 hover:bg-theme-border/50 rounded-lg transition-all cursor-pointer shrink-0"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {sortedQueueTasks.length === 0 ? (
              <div className="text-center py-8 text-theme-text-secondary text-xs bg-theme-border/5 rounded-xl border border-theme-border/20">
                {hasActiveQueueFilters
                  ? `No ${queueTab === 'pending' ? 'pending' : 'evaluated'} deliverables match the selected filters.`
                  : queueTab === 'pending'
                    ? 'No pending deliverables currently waiting for your evaluation.'
                    : "You haven't evaluated any deliverables yet."}
              </div>
            ) : (
              queueGroups.map(group => (
                <details key={group.key} open className="group">
                  <summary className="flex items-center justify-between cursor-pointer list-none select-none py-1">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-theme-text-primary">
                      <Briefcase className="h-3 w-3 text-accent" />
                      {group.label}
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-theme-border/30 text-theme-text-secondary">
                        {group.tasks.length}
                      </span>
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-theme-text-secondary transition-transform group-open:rotate-180" />
                  </summary>

                  <div className="space-y-3 pt-2 pb-1">
                    {group.tasks.map(task => {
                      const linkedEvent = events.find(ev => ev.id === task.eventId || ev.title === task.event);
                      const eventCampus = linkedEvent?.campus || task.eventCampus || 'GG Campus';
                      const isDesignDeliverable = isDesignTask(task);
                      const canEval = canEvaluateEventStudent(user, eventCampus, isDesignDeliverable);
                      const targetId = getRatingTargetId(task);
                      
                      // Look up ratings already submitted for this task deliverable
                      // Committee/group tasks average their students' own ratings (so individually rated students count at their own score).
                      const fanOut = isFanOutTask(task);
                      const memberRows = fanOut ? ratings.filter(r => r.taskId === task.id && !r.isGroupPlaceholder) : [];
                      const existingTaskRatings = fanOut && memberRows.length > 0
                        ? memberRows
                        : ratings.filter(r => r.taskId === task.id && r.targetId === targetId);
                      const avgScoreSoFar = existingTaskRatings.length > 0
                        ? (existingTaskRatings.reduce((sum, r) => sum + r.overallScore, 0) / existingTaskRatings.length).toFixed(1)
                        : null;

                      return (
                        <div
                          key={task.id}
                          className={`p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-xl space-y-2 hover:bg-theme-border/15 transition-all text-xs ${!canEval ? 'opacity-75' : ''}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className="font-bold text-xs text-theme-text-primary line-clamp-1">{task.title}</h4>
                              <p className="text-[10px] text-theme-text-secondary mt-0.5">
                                Assignee: <strong className="text-theme-text-primary">{task.assignee}</strong>
                              </p>
                              <TaskTimingLine task={task} />
                              <div className="flex items-center flex-wrap gap-1.5 mt-1">
                                {task.event ? (
                                  <span className="text-[10px] text-accent font-semibold">{task.event}</span>
                                ) : (
                                  <span className="text-[9px] font-medium px-1.5 py-0.5 bg-theme-border/20 text-theme-text-secondary rounded">
                                    Standalone Deliverable
                                  </span>
                                )}
                                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-accent/10 text-accent rounded border border-accent/20">
                                  {eventCampus}
                                </span>
                                {isDesignDeliverable && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 bg-purple-500/15 text-purple-400 rounded border border-purple-500/20 flex items-center gap-1">
                                    <Palette className="h-2.5 w-2.5" /> Design Deliverable
                                  </span>
                                )}
                                {(task.assigneeType === 'committee' || task.eventCommitteeId) && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 bg-warning/15 text-warning rounded border border-warning/20 flex items-center gap-1">
                                    <Users className="h-2.5 w-2.5" /> Committee Task
                                  </span>
                                )}
                                {task.assigneeType === 'group' && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 bg-warning/15 text-warning rounded border border-warning/20 flex items-center gap-1">
                                    <Users className="h-2.5 w-2.5" /> Group Task
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 bg-success/15 text-success">
                              {task.status}
                            </span>
                          </div>

                          {avgScoreSoFar ? (
                            <div className="pt-1 border-t border-theme-border/20 space-y-1">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-theme-text-secondary">Average Score so far:</span>
                                <span className="font-bold text-accent flex items-center gap-1">
                                  <Star className="h-3 w-3 fill-accent" />
                                  {avgScoreSoFar}/5.0
                                </span>
                              </div>
                              <div className="flex items-center flex-wrap gap-1.5 text-[9px]">
                                {fanOut && memberRows.length > 0
                                  ? <span className="text-success font-semibold">✓ {memberRows.length} student rating{memberRows.length === 1 ? '' : 's'} so far</span>
                                  : existingTaskRatings.map(r => (
                                  <span key={r.id} className="text-success font-semibold flex items-center gap-0.5">
                                    ✓ {r.raterName} ({r.reviewerRole ? r.reviewerRole.replace('_', ' ') : 'Evaluator'})
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <div className="pt-1 border-t border-theme-border/20 flex items-center justify-between gap-2">
                            {!canEval ? (
                              <span className="text-[10px] text-warning font-medium italic">
                                {isDesignDeliverable
                                  ? 'Evaluations restricted to Super User, Centre Head, Advisor, Head of Events (GG Campus), or Design Head'
                                  : 'Evaluations restricted to Super User, Centre Head, Advisor, or Head of Events (GG Campus)'}
                              </span>
                            ) : queueTab === 'evaluated' ? (
                              <span className="text-[10px] text-success font-semibold flex items-center gap-1">
                                <Check className="h-3 w-3" /> You evaluated this
                              </span>
                            ) : (
                              <span className="text-[10px] text-theme-text-secondary">
                                {task.assigneeType === 'committee' ? 'Rates entire committee' : task.assigneeType === 'group' ? 'Rates entire group' : 'Pending Evaluation'}
                              </span>
                            )}
                            {canEval && queueTab === 'pending' && (
                              <button
                                onClick={() => openEvaluationForTask(task)}
                                className="px-3 py-1 text-[11px] font-medium rounded-lg cursor-pointer transition-all bg-accent hover:bg-primary-light text-white shadow-sm"
                              >
                                Evaluate Performance
                              </button>
                            )}
                            {canEval && queueTab === 'evaluated' && (() => {
                              if (fanOut) {
                                return (
                                  <button
                                    onClick={() => openEvaluationForTask(task)}
                                    className="px-3 py-1 text-[11px] font-medium rounded-lg cursor-pointer transition-all bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary"
                                  >
                                    Re-rate Members
                                  </button>
                                );
                              }
                              const myRating = getMyRatingForTask(task);
                              return myRating ? (
                                <button
                                  onClick={() => openEditEvaluation(myRating)}
                                  className="px-3 py-1 text-[11px] font-medium rounded-lg cursor-pointer transition-all bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary"
                                >
                                  Edit My Review
                                </button>
                              ) : null;
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Submitted Evaluations & Scorecards History */}
        <div className="glass-panel rounded-2xl p-6 lg:col-span-2 space-y-4 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary">Performance Evaluation Scorecards</h3>
              <p className="text-xs text-theme-text-secondary">Audited aggregate performance ratings tied to student task deliverables</p>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Filter to one specific student's scorecards */}
              <SearchableSelect
                value={historyStudentFilter}
                onChange={setHistoryStudentFilter}
                allLabel="All Students"
                allValue="ALL"
                placeholder="Search students..."
                compact
                options={historyStudentOptions.map(name => ({ value: name, label: name }))}
              />

              {/* Filter by Event */}
              <SearchableSelect
                value={historyEventFilter}
                onChange={setHistoryEventFilter}
                allLabel="All Events"
                allValue="ALL"
                placeholder="Search events..."
                compact
                options={historyEventOptions.map(name => ({ value: name, label: name }))}
              />

              {/* Filter by Task Deliverable */}
              <SearchableSelect
                value={historyTaskFilter}
                onChange={setHistoryTaskFilter}
                allLabel="All Tasks"
                allValue="ALL"
                placeholder="Search tasks..."
                compact
                options={historyTaskOptions.map(title => ({ value: title, label: title }))}
              />

              {/* Period Filter: month or custom date range */}
              <PeriodFilter
                value={periodFilter}
                onChange={setPeriodFilter}
                availableMonths={availableRatingMonths}
              />

              {/* Score-range filter — isolate a band (e.g. every 5.0, or every sub-3.0) to review/edit as a batch */}
              <select
                value={historyScoreBand}
                onChange={(e) => setHistoryScoreBand(e.target.value as typeof historyScoreBand)}
                title="Filter by score range"
                className="px-2.5 py-1.5 bg-theme-background/30 border border-theme-border/40 rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent"
              >
                <option value="ALL">All Scores</option>
                <option value="5">5.0 only</option>
                <option value="4-4.9">4.0 – 4.9</option>
                <option value="3-3.9">3.0 – 3.9</option>
                <option value="2-2.9">2.0 – 2.9</option>
                <option value="0-1.9">Below 2.0</option>
              </select>

              {/* Sort order */}
              <select
                value={historySortBy}
                onChange={(e) => setHistorySortBy(e.target.value as typeof historySortBy)}
                title="Sort order"
                className="px-2.5 py-1.5 bg-theme-background/30 border border-theme-border/40 rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="scoreHigh">Score: High to Low</option>
                <option value="scoreLow">Score: Low to High</option>
                <option value="nameAsc">Student Name (A-Z)</option>
                <option value="nameDesc">Student Name (Z-A)</option>
                <option value="taskAsc">Task Title (A-Z)</option>
                <option value="taskDesc">Task Title (Z-A)</option>
                <option value="eventAsc">Event Name (A-Z)</option>
                <option value="eventDesc">Event Name (Z-A)</option>
                <option value="evalCountHigh">Most Evaluations</option>
                <option value="evalCountLow">Fewest Evaluations</option>
              </select>

              {/* Search filter */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-theme-text-secondary" />
                <input
                  type="text"
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  placeholder="Search scorecards..."
                  className="w-44 pl-8 pr-3 py-1.5 bg-theme-background/30 border border-theme-border/40 rounded-xl text-xs text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent"
                />
              </div>

              {/* Clear filters button */}
              {hasActiveHistoryFilters && (
                <button
                  type="button"
                  onClick={clearHistoryFilters}
                  className="px-2.5 py-1.5 text-xs text-accent hover:text-accent/80 font-medium transition-colors"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto flex-1">
            {scoreFilteredGroups.length === 0 ? (
              <div className="text-center py-12 text-theme-text-secondary text-xs space-y-2">
                <div>No evaluated task scorecards found matching the selected filter.</div>
                {hasActiveHistoryFilters && (
                  <button
                    type="button"
                    onClick={clearHistoryFilters}
                    className="text-xs text-accent hover:underline font-medium"
                  >
                    Reset all filters
                  </button>
                )}
              </div>
            ) : (
              <table className="min-w-full text-xs text-left">
                <thead>
                  <tr className="text-theme-text-secondary border-b border-theme-border/40 text-xs">
                    <th className="pb-3 font-semibold">Student Assignee</th>
                    <th className="pb-3 font-semibold">Evaluated Task / Event</th>
                    <th className="pb-3 font-semibold">Evaluator(s) & Scores</th>
                    <th className="pb-3 font-semibold">Breakdown (Q / T / I / C)</th>
                    <th className="pb-3 font-semibold">Average Aggregate Score</th>
                    <th className="pb-3 font-semibold">Remarks</th>
                    {isAdmin && <th className="pb-3 font-semibold text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-border/20">
                  {scoreFilteredGroups.map(group => {
                    const colorTokens = getRatingColor(group.aggregateScore);

                    return (
                      <tr key={group.key} className="hover:bg-theme-border/10 transition-all text-xs">
                        {/* Student Assignee */}
                        <td className="py-3.5 pr-2 font-bold text-theme-text-primary whitespace-nowrap align-top">
                          {group.targetName}
                        </td>

                        {/* Evaluated Task / Event */}
                        <td className="py-3.5 pr-2 max-w-xs align-top">
                          <p className="font-semibold text-theme-text-primary truncate">{group.taskTitle}</p>
                          {group.eventName ? (
                            <span className="text-[10px] text-accent font-medium">{group.eventName}</span>
                          ) : (
                            <span className="text-[10px] text-theme-text-secondary">Standalone Deliverable</span>
                          )}
                        </td>

                        {/* Evaluator(s) & Individual Scores — showing ONLY people who actually scored */}
                        <td className="py-3.5 pr-2 text-theme-text-secondary max-w-xs align-top space-y-1">
                          {group.ratings.map(rating => (
                            <div key={rating.id} className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-theme-text-primary">{rating.raterName}</span>
                              {rating.reviewerRole && (
                                <span className={`inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                                  rating.reviewerRole === 'SUPER_USER'
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                    : rating.reviewerRole === 'CENTRE_HEAD'
                                      ? 'bg-accent/10 text-accent border-accent/20'
                                      : rating.reviewerRole === 'ADVISOR'
                                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                        : rating.reviewerRole === 'GG_HEAD'
                                          ? 'bg-primary/10 text-primary-light border-primary/20'
                                          : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                                }`}>
                                  {rating.reviewerRole === 'SUPER_USER'
                                    ? 'Super User'
                                    : rating.reviewerRole === 'CENTRE_HEAD'
                                      ? 'Centre Head'
                                      : rating.reviewerRole === 'ADVISOR'
                                        ? 'Advisor'
                                        : rating.reviewerRole === 'GG_HEAD'
                                          ? 'GG Head'
                                          : 'Design Head'}
                                </span>
                              )}
                              <span className="font-bold text-accent">({rating.overallScore.toFixed(1)})</span>
                            </div>
                          ))}
                        </td>

                        {/* Breakdown — real per-criterion scores when the rubric is known, else the legacy Q/T/I/C fields */}
                        <td className="py-3.5 pr-2 text-theme-text-secondary whitespace-nowrap align-top space-y-1">
                          {group.ratings.map(rating => (
                            <div key={rating.id} className="text-[11px]">
                              {group.ratings.length > 1 && (
                                <span className="text-[9px] text-theme-text-secondary mr-1">{rating.raterName.split(' ')[0]}:</span>
                              )}
                              {rating.criteriaSet && rating.scores ? (
                                <span title={CRITERIA_SET_LABEL[rating.criteriaSet]}>
                                  {RATING_CRITERIA[rating.criteriaSet].map((c, i) => (
                                    <React.Fragment key={c.key}>
                                      {i > 0 && ' · '}
                                      <span className="font-semibold text-theme-text-primary" title={c.label}>{(rating.scores as Record<string, number>)[c.key] ?? '–'}</span>
                                    </React.Fragment>
                                  ))}
                                </span>
                              ) : (
                                <>
                                  <span className="font-semibold text-theme-text-primary">{rating.quality}</span> &middot;{' '}
                                  <span className="font-semibold text-theme-text-primary">{rating.timeliness}</span> &middot;{' '}
                                  <span className="font-semibold text-theme-text-primary">{rating.initiative}</span> &middot;{' '}
                                  <span className="font-semibold text-theme-text-primary">{rating.collaboration}</span>
                                </>
                              )}
                            </div>
                          ))}
                        </td>

                        {/* Average Aggregate Score */}
                        <td className="py-3.5 pr-2 whitespace-nowrap align-top">
                          <div className="flex flex-col items-start gap-0.5">
                            <span className={`inline-flex items-center gap-1 text-xs font-extrabold px-2 py-0.5 rounded-lg border ${colorTokens.bg} ${colorTokens.text} ${colorTokens.border}`}>
                              <Star className="h-3 w-3 fill-current" />
                              {group.aggregateScore.toFixed(1)} / 5.0
                            </span>
                            {group.ratings.length > 1 && (
                              <span className="text-[9px] text-theme-text-secondary font-medium">
                                Avg of {group.ratings.length} reviews
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Remarks */}
                        <td className="py-3.5 text-theme-text-secondary max-w-xs align-top space-y-1">
                          {(() => {
                            const taskForRow = tasks.find(t => t.id === group.ratings[0]?.taskId);
                            const liveLate = taskForRow ? getTaskLateness(taskForRow) : null;
                            const note = group.ratings.find(r => r.lateNote)?.lateNote || (liveLate ? describeTaskLateness(liveLate) : '');
                            return note ? (
                              <p className="text-[11px] font-bold text-danger" title={note}>{note}</p>
                            ) : null;
                          })()}
                          {group.ratings.map(r => r.notes ? (
                            <p key={r.id} className="text-[11px] truncate" title={`${r.raterName}: ${r.notes}`}>
                              {group.ratings.length > 1 ? <strong className="text-theme-text-primary">{r.raterName.split(' ')[0]}: </strong> : null}
                              {r.notes}
                            </p>
                          ) : null).filter(Boolean).length > 0 ? (
                            group.ratings.map(r => r.notes ? (
                              <p key={r.id} className="text-[11px] truncate" title={`${r.raterName}: ${r.notes}`}>
                                {group.ratings.length > 1 ? <strong className="text-theme-text-primary">{r.raterName.split(' ')[0]}: </strong> : null}
                                {r.notes}
                              </p>
                            ) : null)
                          ) : (
                            <span className="text-[11px]">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        {isAdmin && (
                          <td className="py-3.5 text-right align-top">
                            <div className="flex justify-end gap-1 flex-wrap">
                              {group.ratings.map(rating => {
                                const canEdit = canEditRating(rating, user);
                                if (!canEdit) return null;
                                return (
                                  <div key={rating.id} className="flex items-center gap-0.5" title={`Manage ${rating.raterName}'s rating`}>
                                    <button
                                      onClick={() => openEditEvaluation(rating)}
                                      className="p-1 hover:bg-theme-border/30 rounded-md text-theme-text-secondary hover:text-accent transition-all cursor-pointer"
                                      title={`Edit ${rating.raterName}'s Scorecard`}
                                    >
                                      <Edit2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setDeletingRatingId(rating.id)}
                                      className="p-1 hover:bg-danger/10 rounded-md text-danger transition-all cursor-pointer"
                                      title={`Delete ${rating.raterName}'s Scorecard`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>

      {/* Task Performance Evaluation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl p-6 flex flex-col space-y-5 relative border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-theme-text-primary">
                {editingRating ? 'Edit Task Performance Scorecard' : 'Evaluate Task Performance'}
              </h2>
              <button 
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingRating(null);
                  setSelectedTask(null);
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

            {/* Task & Assignee Info Header */}
            <div className="bg-accent/10 border border-accent/15 p-3.5 rounded-2xl text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-theme-text-secondary font-semibold uppercase tracking-wider text-[10px]">Deliverable</span>
                {selectedTask?.event && (
                  <span className="text-[10px] text-accent font-semibold">{selectedTask.event}</span>
                )}
              </div>
              <h3 className="text-sm font-bold text-theme-text-primary">
                {editingRating ? editingRating.taskTitle : selectedTask?.title}
              </h3>
              <p className="text-[11px] text-theme-text-secondary">
                Student Assignee: <strong className="text-theme-text-primary">{editingRating ? editingRating.targetName : selectedTask?.assignee}</strong>
              </p>
              <TaskTimingLine task={editingRating ? tasks.find(t => t.id === editingRating.taskId) : selectedTask || undefined} />
              {(() => {
                const modalTask = editingRating ? tasks.find(t => t.id === editingRating.taskId) : selectedTask;
                if (!modalTask) return null;
                const isCommitteeTask = modalTask.assigneeType === 'committee' || Boolean(modalTask.eventCommitteeId);
                if (!isCommitteeTask && modalTask.assigneeType !== 'group') return null;
                const roster = getTaskAssigneeStatuses(
                  isCommitteeTask ? { ...modalTask, assigneeType: 'committee' } : modalTask,
                  members,
                  events
                );
                if (roster.length === 0) return null;
                const kind = isCommitteeTask ? 'Committee' : 'Group';

                // Editing one student's existing scorecard: just list the members for context.
                if (editingRating || roster.length < 2) {
                  return (
                    <div className="pt-1.5 space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-secondary">
                        {kind} Members ({roster.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {roster.map(m => (
                          <span key={m.id} className="px-2 py-0.5 rounded-lg bg-theme-background/40 border border-theme-border/40 text-[11px] font-medium text-theme-text-primary">
                            {m.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                }

                const rateable = roster.filter(m => !m.isFaculty);
                const myRows = myMemberRatings(modalTask);
                const toggle = (id: string) =>
                  setSelectedMemberIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
                return (
                  <div className="pt-2 space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-secondary">
                      Who is this rating for? ({rateable.length} {kind.toLowerCase()} members)
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => { setRateMode('all'); setSelectedMemberIds(rateable.map(m => m.id)); }}
                        className={`px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${rateMode === 'all' ? 'bg-accent text-white border-accent' : 'bg-theme-background/40 border-theme-border/40 text-theme-text-primary hover:bg-theme-border/20'}`}
                      >
                        All members
                      </button>
                      <button
                        type="button"
                        onClick={() => setRateMode('selected')}
                        className={`px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${rateMode === 'selected' ? 'bg-accent text-white border-accent' : 'bg-theme-background/40 border-theme-border/40 text-theme-text-primary hover:bg-theme-border/20'}`}
                      >
                        Selected students
                      </button>
                    </div>
                    {rateMode === 'selected' ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] text-theme-text-secondary">
                          <span>{selectedMemberIds.length} selected &mdash; this score applies only to them</span>
                          <span className="flex gap-2">
                            <button type="button" className="text-accent font-semibold cursor-pointer" onClick={() => setSelectedMemberIds(rateable.map(m => m.id))}>Select all</button>
                            <button type="button" className="text-accent font-semibold cursor-pointer" onClick={() => setSelectedMemberIds([])}>Clear</button>
                          </span>
                        </div>
                        <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                          {rateable.map(m => {
                            const mine = myRows.find(r => r.targetId === m.id);
                            return (
                              <label key={m.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-theme-background/40 border border-theme-border/40 cursor-pointer text-[11px]">
                                <span className="flex items-center gap-2 text-theme-text-primary font-medium">
                                  <input
                                    type="checkbox"
                                    checked={selectedMemberIds.includes(m.id)}
                                    onChange={() => toggle(m.id)}
                                    className="accent-accent"
                                  />
                                  {m.name}
                                </span>
                                {mine && (
                                  <span className="text-[10px] font-bold text-success whitespace-nowrap">Rated {mine.overallScore.toFixed(1)}</span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-theme-text-secondary/80 italic">
                          Submit once per group of students. Each student keeps their own score, and the {kind.toLowerCase()}&apos;s overall score is the average of all its students&apos; ratings.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {rateable.map(m => (
                          <span key={m.id} className="px-2 py-0.5 rounded-lg bg-theme-background/40 border border-theme-border/40 text-[11px] font-medium text-theme-text-primary">
                            {m.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              {!editingRating && selectedTask && (() => {
                const role = resolveRatingReviewerRole(user, isDesignTask(selectedTask));
                if (role === 'SUPER_USER' || role === 'CENTRE_HEAD' || role === 'ADVISOR' || role === 'GG_HEAD') {
                  const roleLabel = role === 'SUPER_USER'
                    ? 'Super User'
                    : role === 'CENTRE_HEAD'
                      ? 'Centre Head'
                      : role === 'ADVISOR'
                        ? 'Advisor'
                        : 'Head of Events (GG Campus)';
                  return (
                    <p className="text-[10px] text-theme-text-secondary/80 italic">
                      Reviewing as {roleLabel} — the score shown for this task is the live average of evaluations submitted so far.
                    </p>
                  );
                }
                return null;
              })()}
            </div>

            <form onSubmit={handleEvaluateSubmit} className="space-y-4 text-xs">

              <div className="text-[10px] font-bold uppercase tracking-wide text-accent">
                {CRITERIA_SET_LABEL[activeCriteriaSet]} Rubric
              </div>

              {/* Score Sliders */}
              <div className="space-y-3">
                {RATING_CRITERIA[activeCriteriaSet].map((criterion, idx) => (
                  <div className="space-y-1" key={criterion.key} title={criterion.description}>
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-theme-text-primary">{idx + 1}. {criterion.label}</span>
                      <span className="font-bold text-accent">{(scores[criterion.key] ?? 3).toFixed(1)} / 5</span>
                    </div>
                    <input
                      type="range" min="1" max="5" step="0.5"
                      value={scores[criterion.key] ?? 3}
                      onChange={(e) => setScores(s => ({ ...s, [criterion.key]: parseFloat(e.target.value) }))}
                      className="w-full accent-accent h-1.5 bg-theme-border/40 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                ))}
              </div>

              {/* Remarks Notes */}
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Evaluation Remarks / Feedback for Student</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Record constructive feedback on deliverables and milestone targets..."
                  rows={3}
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              {/* Rolling Average Score */}
              <div className="bg-theme-border/10 p-3 rounded-xl border border-theme-border/20 flex justify-between items-center">
                <span className="font-semibold text-theme-text-secondary">Calculated Performance Rating:</span>
                <span className="text-sm font-black text-warning flex items-center gap-1">
                  <Star className="h-4 w-4 fill-warning stroke-warning" />
                  {averageScore(scores).toFixed(1)} / 5.0
                </span>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer mt-4"
              >
                {editingRating ? 'Save Scorecard Updates' : 'Submit Performance Rating'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingRatingId)}
        title="Delete Scorecard Record"
        message="Are you sure you want to delete this task evaluation scorecard? The performance rating on the task deliverable will be cleared."
        confirmLabel="Delete Scorecard"
        variant="danger"
        onConfirm={handleConfirmDeleteRating}
        onCancel={() => setDeletingRatingId(null)}
      />

    </div>
  );
}
