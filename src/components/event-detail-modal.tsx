'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import {
  X,
  Calendar,
  MapPin,
  Users,
  CheckSquare,
  Clock,
  ExternalLink,
  ShieldCheck,
  Building,
  DollarSign,
  Tag
} from 'lucide-react';
import {
  EventItem,
  TaskItem,
  getMembers,
  getEffectiveEventStatus,
  formatEventDateRange,
  formatEventPlanningNote,
  getEventSponsors
} from '@/lib/local-data';

interface EventDetailModalProps {
  event: EventItem | null;
  tasks?: TaskItem[];
  isOpen: boolean;
  onClose: () => void;
}

export function EventDetailModal({ event, tasks = [], isOpen, onClose }: EventDetailModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !event) return null;

  const members = getMembers();
  const getMemberById = (id: string) => members.find(m => m.id === id || m.name === id);

  const effectiveStatus = getEffectiveEventStatus(event, tasks);
  const eventTasks = tasks.filter(t => t.eventId === event.id || t.event === event.title);
  const completedTasks = eventTasks.filter(t => t.status === 'Completed').length;
  const sponsors = getEventSponsors(event.id);

  const STATUS_STYLES: Record<EventItem['status'], { bg: string; text: string; border: string }> = {
    planned: { bg: 'bg-accent/15', text: 'text-accent', border: 'border-accent/30' },
    active: { bg: 'bg-warning/15', text: 'text-warning', border: 'border-warning/30' },
    completed: { bg: 'bg-emerald-500/15', text: 'text-emerald-500 dark:text-emerald-400', border: 'border-emerald-500/30' },
    archived: { bg: 'bg-theme-border/30', text: 'text-theme-text-secondary', border: 'border-theme-border/40' },
  };

  const statusStyle = STATUS_STYLES[effectiveStatus] || STATUS_STYLES.planned;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-3xl rounded-3xl p-6 md:p-8 flex flex-col space-y-6 relative border border-white/15 shadow-2xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border capitalize ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                {effectiveStatus}
              </span>
              {event.campus && (
                <span className="text-[10px] font-medium bg-theme-border/30 text-theme-text-secondary px-2.5 py-0.5 rounded-full border border-theme-border/30 flex items-center gap-1">
                  <Building className="h-3 w-3" />
                  {event.campus}
                </span>
              )}
              {event.approvalStatus && event.approvalStatus !== 'approved' && (
                <span className="text-[10px] font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/30 px-2 py-0.5 rounded-full">
                  Approval: {event.approvalStatus.replace('pending_', 'pending ')}
                </span>
              )}
            </div>
            <h2 className="text-xl md:text-2xl font-black text-theme-text-primary leading-snug">
              {event.title}
            </h2>
            <p className="text-xs text-theme-text-secondary flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-accent flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatEventDateRange(event)}
              </span>
              {formatEventPlanningNote(event) && (
                <span className="text-warning flex items-center gap-1 font-medium">
                  <Clock className="h-3 w-3" />
                  {formatEventPlanningNote(event)}
                </span>
              )}
            </p>
          </div>

          <button
            onClick={onClose}
            type="button"
            className="h-8 w-8 flex items-center justify-center rounded-xl bg-theme-border/20 hover:bg-theme-border/40 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer shrink-0"
            title="Close window"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Insights Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl flex flex-col justify-between">
            <span className="text-[10px] uppercase font-bold text-theme-text-secondary flex items-center gap-1">
              <Calendar className="h-3 w-3 text-accent" />
              Event Dates
            </span>
            <span className="text-xs font-bold text-theme-text-primary mt-1">
              {event.datesTBD ? 'Dates TBD' : event.startDate || '—'}
            </span>
            <span className="text-[10px] text-theme-text-secondary">
              {event.datesTBD ? 'To be finalized' : `Until ${event.endDate || '—'}`}
            </span>
          </div>

          <div className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl flex flex-col justify-between">
            <span className="text-[10px] uppercase font-bold text-theme-text-secondary flex items-center gap-1">
              <Clock className="h-3 w-3 text-warning" />
              Planning Phase
            </span>
            <span className="text-xs font-bold text-theme-text-primary mt-1">
              {event.planningStartDate ? event.planningStartDate : 'Standard'}
            </span>
            <span className="text-[10px] text-theme-text-secondary">
              {event.planningStartDate ? 'Prep kickoff date' : 'Aligned with event'}
            </span>
          </div>

          <div className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl flex flex-col justify-between">
            <span className="text-[10px] uppercase font-bold text-theme-text-secondary flex items-center gap-1">
              <MapPin className="h-3 w-3 text-emerald-500" />
              Venue & Location
            </span>
            <span className="text-xs font-bold text-theme-text-primary mt-1 truncate" title={event.location || event.campus || 'On Campus'}>
              {event.location || event.campus || 'On Campus'}
            </span>
            <span className="text-[10px] text-theme-text-secondary truncate">
              {event.campus || 'Main Campus'}
            </span>
          </div>

          <div className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl flex flex-col justify-between">
            <span className="text-[10px] uppercase font-bold text-theme-text-secondary flex items-center gap-1">
              <CheckSquare className="h-3 w-3 text-accent" />
              Deliverables
            </span>
            <span className="text-xs font-bold text-theme-text-primary mt-1">
              {eventTasks.length} {eventTasks.length === 1 ? 'Task' : 'Tasks'}
            </span>
            <span className="text-[10px] text-emerald-500 font-semibold">
              {completedTasks} completed
            </span>
          </div>
        </div>

        {/* Description */}
        {event.description && (
          <div className="p-4 bg-theme-border/10 border border-theme-border/20 rounded-2xl space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary">
              About this Event
            </h3>
            <p className="text-xs text-theme-text-primary leading-relaxed whitespace-pre-line">
              {event.description}
            </p>
          </div>
        )}

        {/* Committees Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-accent" />
              Organizing Committees ({event.committees?.length || 0})
            </h3>
          </div>

          {!event.committees || event.committees.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-theme-border/30 text-center text-xs text-theme-text-secondary">
              No specific committees configured for this event.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {event.committees.map(comm => (
                <div key={comm.id} className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-theme-text-primary">{comm.name}</span>
                    <span className="text-[10px] text-theme-text-secondary font-medium">
                      {comm.memberIds?.length || 0} members
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {comm.memberIds && comm.memberIds.length > 0 ? (
                      comm.memberIds.map(memId => {
                        const mem = getMemberById(memId);
                        const initials = mem?.name
                          ? mem.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                          : memId.slice(0, 2).toUpperCase();
                        return (
                          <div
                            key={memId}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-theme-card border border-theme-border/30 text-[11px]"
                            title={mem?.name ? `${mem.name} · ${mem.role}` : memId}
                          >
                            <span className="h-4 w-4 rounded-full bg-accent/20 text-accent font-bold text-[9px] flex items-center justify-center">
                              {initials}
                            </span>
                            <span className="font-medium text-theme-text-primary truncate max-w-[110px]">
                              {mem?.name || memId}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <span className="text-[11px] text-theme-text-secondary italic">No members assigned</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Linked Tasks Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-1.5">
              <CheckSquare className="h-3.5 w-3.5 text-accent" />
              Event Tasks & Deliverables ({eventTasks.length})
            </h3>
          </div>

          {eventTasks.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-theme-border/30 text-center text-xs text-theme-text-secondary">
              No tasks currently tracked for this event.
            </div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {eventTasks.map(task => (
                <div
                  key={task.id}
                  className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <h4 className="font-semibold text-theme-text-primary truncate">{task.title}</h4>
                    <div className="flex items-center gap-2 text-[10px] text-theme-text-secondary">
                      <span>Assigned to: <strong className="text-theme-text-primary font-medium">{task.assignee || 'Unassigned'}</strong></span>
                      <span>&middot;</span>
                      <span>Due: <strong className="text-theme-text-primary font-medium">{task.dueDate}</strong></span>
                    </div>
                  </div>

                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                    task.status === 'Completed'
                      ? 'bg-success/15 text-success border border-success/30'
                      : task.status === 'In Progress'
                        ? 'bg-warning/15 text-warning border border-warning/30'
                        : task.status === 'Pending Extension'
                          ? 'bg-danger/15 text-danger border border-danger/30'
                          : 'bg-accent/15 text-accent border border-accent/30'
                  }`}>
                    {task.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sponsors Section (if any exist) */}
        {sponsors.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
              Sponsors & Contributions ({sponsors.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {sponsors.map((sp, idx) => (
                <div key={idx} className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-theme-text-primary block">{sp.name}</span>
                    {sp.tier && <span className="text-[10px] text-theme-text-secondary capitalize">{sp.tier} tier</span>}
                  </div>
                  <span className="font-bold text-emerald-500 text-xs">
                    ₹{sp.amount?.toLocaleString() || 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="pt-2 border-t border-theme-border/30 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer"
          >
            Close Window
          </button>

          <Link
            href={`/dashboard/events/${event.id}`}
            className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
          >
            Manage in Events Module <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
