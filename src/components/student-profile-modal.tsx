
'use client';

import { useState } from 'react';
import {
  X,
  Calendar,
  CheckSquare,
  Star,
  Layers,
  ExternalLink,
  TrendingUp
} from 'lucide-react';
import { getStudentProfile, formatEventDateRange, StudentProfileData, Member, isFacultyMember } from '@/lib/local-data';
import Link from 'next/link';

interface StudentProfileModalProps {
  memberIdOrName: string | null;
  member?: Member | null;
  onClose: () => void;
}

export function StudentProfileModal({ memberIdOrName, member: propMember, onClose }: StudentProfileModalProps) {
  const [activeTab, setActiveTab] = useState<'tasks' | 'events' | 'ratings'>('tasks');
  const targetId = memberIdOrName || propMember?.id || '';
  const profile: StudentProfileData | null = targetId ? getStudentProfile(targetId, propMember || undefined) : null;

  if (!targetId || !profile) return null;

  const { member, stats, tasks, assignedEvents, ratings } = profile;
  const isFaculty = false; // ERP faculty distinction does not apply to the RTBI tiers

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel w-full max-w-2xl rounded-3xl p-6 md:p-8 flex flex-col space-y-6 relative border border-white/15 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 bg-accent/20 border-2 border-accent/30 rounded-2xl flex items-center justify-center text-accent text-xl font-black shrink-0 shadow-lg shadow-accent/15">
              {member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg md:text-xl font-bold text-theme-text-primary">{member.name}</h2>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                  member.division === 'Super User' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
                  member.division === 'CEO' ? 'bg-accent/15 text-accent border-accent/30' :
                  member.division === 'Startup' ? 'bg-purple-500/15 text-purple-400 border-purple-500/30' :
                  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                }`}>
                  {member.division}
                </span>
                {member.batch && (
                  <span className="text-[10px] bg-theme-border/30 text-theme-text-secondary px-2 py-0.5 rounded-full font-medium">
                    {member.batch}
                  </span>
                )}
                <span className="text-[10px] bg-sky-500/15 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded-full font-bold">
                  Tier {member.tier}
                </span>
              </div>
              <p className="text-xs text-theme-text-secondary mt-1 flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-theme-text-primary">{member.role}</span>
                {member.department && (
                  <>
                    <span>&middot;</span>
                    <span>{member.department}</span>
                  </>
                )}
                <span>&middot;</span>
                <span className="text-accent">{member.email}</span>
                {member.phone && (
                  <>
                    <span>&middot;</span>
                    <span>{member.phone}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-xl bg-theme-border/20 hover:bg-theme-border/40 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 4 Outcome Stat Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl flex flex-col justify-between">
            <span className="text-[10px] uppercase font-bold text-theme-text-secondary flex items-center gap-1">
              <Star className="h-3 w-3 text-warning fill-warning" />
              Rating
            </span>
            <div className="mt-2">
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-black text-theme-text-primary">
                  {ratings.length > 0 ? stats.averageRating.toFixed(1) : isFaculty ? 'Oversight' : '5.0'}
                </span>
                {ratings.length > 0 && <span className="text-[10px] text-theme-text-secondary">/ 5.0</span>}
              </div>
              <span className="text-[9px] text-theme-text-secondary">
                {ratings.length > 0 ? `${ratings.length} task reviews` : isFaculty ? 'Faculty / Advisory' : 'Baseline score'}
              </span>
            </div>
          </div>

          <div className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl flex flex-col justify-between">
            <span className="text-[10px] uppercase font-bold text-theme-text-secondary flex items-center gap-1">
              <CheckSquare className="h-3 w-3 text-accent" />
              Tasks Completed
            </span>
            <div className="mt-2">
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-black text-theme-text-primary">{stats.completedTasks}</span>
                <span className="text-[10px] text-theme-text-secondary">/ {stats.totalTasks} total</span>
              </div>
              <span className="text-[9px] text-theme-text-secondary">
                {stats.totalTasks > 0 ? `${stats.completionRate}% completion rate` : 'No active tasks'}
              </span>
            </div>
          </div>

          <div className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl flex flex-col justify-between">
            <span className="text-[10px] uppercase font-bold text-theme-text-secondary flex items-center gap-1">
              <Layers className="h-3 w-3 text-success" />
              Committees
            </span>
            <div className="mt-2">
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-black text-theme-text-primary">{assignedEvents.length}</span>
                <span className="text-[10px] text-theme-text-secondary">active roles</span>
              </div>
              <span className="text-[9px] text-theme-text-secondary">across events</span>
            </div>
          </div>

          <div className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl flex flex-col justify-between">
            <span className="text-[10px] uppercase font-bold text-theme-text-secondary flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-purple-400" />
              Quality Index
            </span>
            <div className="mt-2">
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-black text-theme-text-primary">
                  {stats.qualityAvg > 0 ? stats.qualityAvg.toFixed(1) : '5.0'}
                </span>
                <span className="text-[10px] text-theme-text-secondary">/ 5.0</span>
              </div>
              <span className="text-[9px] text-theme-text-secondary">rubric deliverable</span>
            </div>
          </div>
        </div>

        {/* Competency Breakdown Pill Bar */}
        {ratings.length > 0 && (
          <div className="p-3 bg-accent/5 border border-accent/15 rounded-2xl grid grid-cols-4 gap-2 text-center text-xs">
            <div>
              <span className="text-[10px] text-theme-text-secondary block">Quality</span>
              <strong className="text-theme-text-primary font-bold">{stats.qualityAvg.toFixed(1)}</strong>
            </div>
            <div>
              <span className="text-[10px] text-theme-text-secondary block">Timeliness</span>
              <strong className="text-theme-text-primary font-bold">{stats.timelinessAvg.toFixed(1)}</strong>
            </div>
            <div>
              <span className="text-[10px] text-theme-text-secondary block">Initiative</span>
              <strong className="text-theme-text-primary font-bold">{stats.initiativeAvg.toFixed(1)}</strong>
            </div>
            <div>
              <span className="text-[10px] text-theme-text-secondary block">Collaboration</span>
              <strong className="text-theme-text-primary font-bold">{stats.collaborationAvg.toFixed(1)}</strong>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-theme-border/30 pb-2 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'tasks'
                ? 'bg-accent text-white shadow-sm'
                : 'bg-theme-border/20 text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            Deliverables & Tasks ({tasks.length})
          </button>

          <button
            onClick={() => setActiveTab('events')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'events'
                ? 'bg-accent text-white shadow-sm'
                : 'bg-theme-border/20 text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            <Calendar className="h-3.5 w-3.5" />
            Event Sub-Committees ({assignedEvents.length})
          </button>

          <button
            onClick={() => setActiveTab('ratings')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'ratings'
                ? 'bg-accent text-white shadow-sm'
                : 'bg-theme-border/20 text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            <Star className="h-3.5 w-3.5" />
            Evaluation Scorecards ({ratings.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="space-y-3 min-h-[180px]">
          
          {/* Tasks Tab */}
          {activeTab === 'tasks' && (
            <div className="space-y-2.5">
              {tasks.length === 0 ? (
                <div className="text-center py-8 text-theme-text-secondary text-xs bg-theme-border/5 rounded-2xl border border-theme-border/20">
                  No task deliverables currently assigned to this member.
                </div>
              ) : (
                tasks.map(task => (
                  <div key={task.id} className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl flex items-center justify-between gap-3 hover:bg-theme-border/15 transition-all text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-theme-text-primary">{task.title}</h4>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                          task.status === 'Completed' ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary-light'
                        }`}>
                          {task.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-theme-text-secondary">
                        {task.event && <span>Event: <strong className="text-theme-text-primary">{task.event}</strong></span>}
                        {task.eventCommitteeName && <span>&middot; Committee: {task.eventCommitteeName}</span>}
                        {task.dueDate && <span>&middot; Due: {task.dueDate}</span>}
                      </div>
                    </div>

                    {task.ratingScore ? (
                      <span className="text-xs font-bold text-accent flex items-center gap-1 shrink-0 bg-accent/10 px-2.5 py-1 rounded-xl border border-accent/20">
                        <Star className="h-3.5 w-3.5 fill-accent" />
                        {task.ratingScore.toFixed(1)} / 5.0
                      </span>
                    ) : (
                      <span className="text-[10px] text-theme-text-secondary italic">Pending evaluation</span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Events & Sub-Committees Tab */}
          {activeTab === 'events' && (
            <div className="space-y-2.5">
              {assignedEvents.length === 0 ? (
                <div className="text-center py-8 text-theme-text-secondary text-xs bg-theme-border/5 rounded-2xl border border-theme-border/20">
                  Not currently registered in any event sub-committees.
                </div>
              ) : (
                assignedEvents.map(({ event, committee }) => (
                  <div key={`${event.id}_${committee.id}`} className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl flex items-center justify-between gap-3 hover:bg-theme-border/15 transition-all text-xs">
                    <div className="space-y-1">
                      <h4 className="font-bold text-theme-text-primary text-xs">{event.title}</h4>
                      <p className="text-[11px] text-accent font-semibold flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        {committee.name}
                      </p>
                      <span className="text-[10px] text-theme-text-secondary">{formatEventDateRange(event)}</span>
                    </div>

                    <Link
                      href={`/dashboard/events/${event.id}`}
                      onClick={onClose}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:text-primary-light transition-all shrink-0 bg-theme-border/30 px-3 py-1.5 rounded-xl border border-theme-border/40"
                    >
                      <span>Event Page</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Ratings Tab */}
          {activeTab === 'ratings' && (
            <div className="space-y-2.5">
              {ratings.length === 0 ? (
                <div className="text-center py-8 text-theme-text-secondary text-xs bg-theme-border/5 rounded-2xl border border-theme-border/20">
                  No evaluation scorecards on record yet.
                </div>
              ) : (
                ratings.map(rating => (
                  <div key={rating.id} className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl space-y-2 hover:bg-theme-border/15 transition-all text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-theme-text-primary text-xs">{rating.taskTitle}</h4>
                        <span className="text-[10px] text-theme-text-secondary">
                          Evaluator: <strong className="text-theme-text-primary">{rating.raterName}</strong> &middot; {rating.createdAt}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-accent flex items-center gap-1 shrink-0 bg-accent/10 px-2.5 py-1 rounded-xl border border-accent/20">
                        <Star className="h-3.5 w-3.5 fill-accent" />
                        {rating.overallScore.toFixed(1)} / 5.0
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[10px] text-theme-text-secondary">
                      <span>Quality: <strong className="text-theme-text-primary">{rating.quality}</strong></span>
                      <span>Timeliness: <strong className="text-theme-text-primary">{rating.timeliness}</strong></span>
                      <span>Initiative: <strong className="text-theme-text-primary">{rating.initiative}</strong></span>
                      <span>Collaboration: <strong className="text-theme-text-primary">{rating.collaboration}</strong></span>
                    </div>

                    {rating.notes && (
                      <p className="text-[11px] text-theme-text-secondary bg-theme-background/40 p-2 rounded-xl border border-theme-border/20 italic">
                        &ldquo;{rating.notes}&rdquo;
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
