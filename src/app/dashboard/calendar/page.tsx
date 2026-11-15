'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  ClipboardCheck,
  DoorOpen,
  Filter,
  Clock,
  Check,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import {
  getEvents,
  getTasks,
  getEffectiveEventStatus,
  formatEventDateRange,
  hasEventPlanningPhase,
  getEventSortTime,
  EventItem,
  TaskItem,
} from '@/lib/local-data';
import { canViewEvent, canApprovePendingEvent } from '@/lib/permissions';
import { Booking } from '@/lib/billing';

function formatTime12(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return iso;
  }
}

function formatTimeRange(start: string, end: string): string {
  return `${formatTime12(start)} – ${formatTime12(end)}`;
}

export interface CalendarFilterState {
  bookings: boolean;
  events: boolean;
  planning: boolean;
  tasks: boolean;
  roomFilter: 'ALL' | 'boardroom' | 'meeting';
}

export default function CalendarPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [user, setUser] = useState<any>(null);

  // Multi-select tick list filter state
  const [filters, setFilters] = useState<CalendarFilterState>({
    bookings: true,
    events: true,
    planning: true,
    tasks: true,
    roomFilter: 'ALL',
  });

  const now = new Date();
  const [calendarDate, setCalendarDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<number | null>(() => now.getDate());

  // Restore filter preferences from localStorage if present
  useEffect(() => {
    try {
      const saved = localStorage.getItem('rtbi_calendar_filters');
      if (saved) {
        setFilters((prev) => ({ ...prev, ...JSON.parse(saved) }));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const updateFilters = (updater: (prev: CalendarFilterState) => CalendarFilterState) => {
    setFilters((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem('rtbi_calendar_filters', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    const refreshData = async () => {
      setEvents(getEvents());
      setTasks(getTasks());
      try {
        const res = await fetch('/api/bookings');
        if (res.ok) {
          const data = await res.json();
          setBookings(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        console.error(e);
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

    window.addEventListener('rtbi-data-sync', refreshData);
    window.addEventListener('storage', refreshData);
    return () => {
      window.removeEventListener('rtbi-data-sync', refreshData);
      window.removeEventListener('storage', refreshData);
    };
  }, []);

  // Same visibility rule as the Events page
  const visibleEvents = events.filter((event) => {
    if (event.approvalStatus === 'pending_create' || event.approvalStatus === 'rejected') {
      return user?.tier === 1 || event.submittedByEmail === user?.email || canApprovePendingEvent(event, user);
    }
    return canViewEvent(event, user);
  });

  const handlePrevMonth = () => {
    const newDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    setCalendarDate(newDate);
    const maxDays = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate();
    setSelectedDay((prev) => (prev ? Math.min(prev, maxDays) : 1));
  };

  const handleNextMonth = () => {
    const newDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    setCalendarDate(newDate);
    const maxDays = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate();
    setSelectedDay((prev) => (prev ? Math.min(prev, maxDays) : 1));
  };

  const calYear = calendarDate.getFullYear();
  const calMonth = calendarDate.getMonth();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDayIndex = new Date(calYear, calMonth, 1).getDay();

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

  // Filtered queries per day based on user tick list
  const getDayEvents = (day: number) => {
    if (!filters.events) return [];
    const checkStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return visibleEvents.filter((e) => !e.datesTBD && checkStr >= e.startDate && checkStr <= e.endDate);
  };

  const getDayPlanningEvents = (day: number) => {
    if (!filters.planning) return [];
    const checkStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return visibleEvents.filter((e) => hasEventPlanningPhase(e) && checkStr === e.planningStartDate);
  };

  const getDayTasks = (day: number) => {
    if (!filters.tasks) return [];
    const checkStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return tasks.filter((t) => t.status !== 'Completed' && t.dueDate === checkStr);
  };

  const getDayBookings = (day: number) => {
    if (!filters.bookings) return [];
    const checkStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return bookings.filter((b) => {
      if (b.status !== 'Confirmed') return false;
      if (b.start.slice(0, 10) !== checkStr) return false;
      if (filters.roomFilter === 'boardroom') {
        return b.roomName.toLowerCase().includes('board');
      }
      if (filters.roomFilter === 'meeting') {
        return b.roomName.toLowerCase().includes('meeting');
      }
      return true;
    });
  };

  // Filtered sidebar items
  const upcomingEvents = useMemo(() => {
    if (!filters.events) return [];
    return [...visibleEvents]
      .filter((e) => {
        const effective = getEffectiveEventStatus(e);
        return effective !== 'completed' && effective !== 'archived';
      })
      .sort((a, b) => getEventSortTime(a) - getEventSortTime(b))
      .slice(0, 6);
  }, [visibleEvents, filters.events]);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const nowMs = Date.now();

  const upcomingBookings = useMemo(() => {
    if (!filters.bookings) return [];
    return [...bookings]
      .filter((b) => {
        if (b.status !== 'Confirmed') return false;
        if (new Date(b.end).getTime() <= nowMs) return false;
        if (filters.roomFilter === 'boardroom') {
          return b.roomName.toLowerCase().includes('board');
        }
        if (filters.roomFilter === 'meeting') {
          return b.roomName.toLowerCase().includes('meeting');
        }
        return true;
      })
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 5);
  }, [bookings, filters.bookings, filters.roomFilter, nowMs]);

  const upcomingTaskDeadlines = useMemo(() => {
    if (!filters.tasks) return [];
    return [...tasks]
      .filter((t) => t.status !== 'Completed' && t.dueDate >= todayStr)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 6);
  }, [tasks, filters.tasks, todayStr]);

  // Overall counts for tick badges
  const totalConfirmedBookings = bookings.filter((b) => b.status === 'Confirmed').length;
  const totalPlanningPhases = visibleEvents.filter((e) => hasEventPlanningPhase(e)).length;
  const totalTasks = tasks.filter((t) => t.status !== 'Completed').length;

  const activeCategoriesCount =
    (filters.bookings ? 1 : 0) +
    (filters.events ? 1 : 0) +
    (filters.planning ? 1 : 0) +
    (filters.tasks ? 1 : 0);

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-accent" />
            Calendar &amp; Room Schedule
          </h1>
          <p className="text-xs text-theme-text-secondary">
            Use the tick list below to choose which schedule layers you want to see (Room Bookings, Events, Planning Phases, Task Deadlines).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/bookings"
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-accent text-white text-xs font-bold hover:bg-primary-light transition-all shadow-sm cursor-pointer"
          >
            <DoorOpen className="h-4 w-4" /> Book a Room
          </Link>
        </div>
      </div>

      {/* =========================================================================
          INTERACTIVE TICK LIST FILTER TOOLBAR
      ========================================================================= */}
      <div className="glass-panel p-4 rounded-3xl border border-theme-border/30 space-y-3 bg-gradient-to-br from-theme-card/60 via-theme-card/30 to-theme-card/10 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-theme-border/20 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-accent/15 text-accent border border-accent/20">
              <Filter className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-theme-text-primary uppercase tracking-wide">
                Calendar View Tick List
              </h2>
              <p className="text-[11px] text-theme-text-secondary">
                Select the schedule layers you want displayed across the calendar grid and day details
              </p>
            </div>
          </div>

          {/* Quick Select All / Clear All */}
          <div className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() =>
                updateFilters((prev) => ({
                  ...prev,
                  bookings: true,
                  events: true,
                  planning: true,
                  tasks: true,
                }))
              }
              className="px-2.5 py-1 rounded-lg hover:bg-accent/15 text-accent font-semibold transition-colors cursor-pointer border border-accent/20"
            >
              Select All (4)
            </button>
            <button
              type="button"
              onClick={() =>
                updateFilters((prev) => ({
                  ...prev,
                  bookings: false,
                  events: false,
                  planning: false,
                  tasks: false,
                }))
              }
              className="px-2.5 py-1 rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary font-semibold transition-colors cursor-pointer border border-theme-border/30"
            >
              Clear All
            </button>
          </div>
        </div>

        {/* Checkbox Tick Pills */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 1. Room Bookings Tick */}
          <label
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
              filters.bookings
                ? 'bg-sky-500/15 border-sky-500/40 text-sky-400 shadow-sm'
                : 'bg-theme-background/20 border-theme-border/30 text-theme-text-secondary hover:border-theme-border/60 opacity-60'
            }`}
          >
            <input
              type="checkbox"
              checked={filters.bookings}
              onChange={(e) =>
                updateFilters((prev) => ({ ...prev, bookings: e.target.checked }))
              }
              className="rounded border-theme-border text-accent focus:ring-accent h-3.5 w-3.5 accent-accent cursor-pointer"
            />
            <DoorOpen className="h-3.5 w-3.5 shrink-0" />
            <span>Room Bookings</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-sky-500/20 font-bold text-sky-300">
              {totalConfirmedBookings}
            </span>
          </label>

          {/* Sub-room filter pills when Bookings is checked */}
          {filters.bookings && (
            <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-theme-background/40 border border-sky-500/25 text-[10px] font-semibold animate-in fade-in duration-150">
              <button
                type="button"
                onClick={() => updateFilters((prev) => ({ ...prev, roomFilter: 'ALL' }))}
                className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                  filters.roomFilter === 'ALL'
                    ? 'bg-sky-500 text-white shadow-sm'
                    : 'text-theme-text-secondary hover:text-theme-text-primary'
                }`}
              >
                All Rooms
              </button>
              <button
                type="button"
                onClick={() => updateFilters((prev) => ({ ...prev, roomFilter: 'boardroom' }))}
                className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                  filters.roomFilter === 'boardroom'
                    ? 'bg-sky-500 text-white shadow-sm'
                    : 'text-theme-text-secondary hover:text-theme-text-primary'
                }`}
              >
                Boardroom
              </button>
              <button
                type="button"
                onClick={() => updateFilters((prev) => ({ ...prev, roomFilter: 'meeting' }))}
                className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                  filters.roomFilter === 'meeting'
                    ? 'bg-sky-500 text-white shadow-sm'
                    : 'text-theme-text-secondary hover:text-theme-text-primary'
                }`}
              >
                Meeting Room
              </button>
            </div>
          )}

          {/* 2. Incubator Events Tick */}
          <label
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
              filters.events
                ? 'bg-accent/15 border-accent/40 text-accent shadow-sm'
                : 'bg-theme-background/20 border-theme-border/30 text-theme-text-secondary hover:border-theme-border/60 opacity-60'
            }`}
          >
            <input
              type="checkbox"
              checked={filters.events}
              onChange={(e) =>
                updateFilters((prev) => ({ ...prev, events: e.target.checked }))
              }
              className="rounded border-theme-border text-accent focus:ring-accent h-3.5 w-3.5 accent-accent cursor-pointer"
            />
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            <span>Incubator Events</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-accent/20 font-bold text-accent">
              {visibleEvents.length}
            </span>
          </label>

          {/* 3. Planning Phases Tick */}
          <label
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
              filters.planning
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-400 shadow-sm'
                : 'bg-theme-background/20 border-theme-border/30 text-theme-text-secondary hover:border-theme-border/60 opacity-60'
            }`}
          >
            <input
              type="checkbox"
              checked={filters.planning}
              onChange={(e) =>
                updateFilters((prev) => ({ ...prev, planning: e.target.checked }))
              }
              className="rounded border-theme-border text-accent focus:ring-accent h-3.5 w-3.5 accent-accent cursor-pointer"
            />
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span>Planning Leads</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 font-bold text-amber-300">
              {totalPlanningPhases}
            </span>
          </label>

          {/* 4. Task Deadlines Tick */}
          <label
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
              filters.tasks
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-400 shadow-sm'
                : 'bg-theme-background/20 border-theme-border/30 text-theme-text-secondary hover:border-theme-border/60 opacity-60'
            }`}
          >
            <input
              type="checkbox"
              checked={filters.tasks}
              onChange={(e) =>
                updateFilters((prev) => ({ ...prev, tasks: e.target.checked }))
              }
              className="rounded border-theme-border text-accent focus:ring-accent h-3.5 w-3.5 accent-accent cursor-pointer"
            />
            <ClipboardCheck className="h-3.5 w-3.5 shrink-0" />
            <span>Task Deadlines</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500/20 font-bold text-rose-300">
              {totalTasks}
            </span>
          </label>
        </div>

        {activeCategoriesCount === 0 && (
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center justify-between">
            <span>All schedule categories are currently unticked. Tick at least one category above to view items on the calendar.</span>
            <button
              type="button"
              onClick={() =>
                updateFilters((prev) => ({
                  ...prev,
                  bookings: true,
                  events: true,
                  planning: true,
                  tasks: true,
                }))
              }
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 font-bold text-[11px] text-amber-200 cursor-pointer"
            >
              Show All
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Interactive Event & Booking Calendar */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-6 flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary">RTBI Calendar</h3>
              <p className="text-xs text-theme-text-secondary">
                {activeCategoriesCount > 0
                  ? `Showing ${activeCategoriesCount} active schedule layer${activeCategoriesCount > 1 ? 's' : ''}`
                  : 'All schedule layers unticked'}
              </p>
            </div>

            <div className="flex items-center gap-1 bg-theme-background/30 border border-theme-border/30 rounded-xl p-1 text-xs">
              <button
                onClick={handlePrevMonth}
                className="p-1 hover:bg-theme-border/30 rounded-lg text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
                title="Previous Month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 font-semibold text-theme-text-primary select-none w-28 text-center text-xs">
                {monthNames[calMonth]} {calYear}
              </span>
              <button
                onClick={handleNextMonth}
                className="p-1 hover:bg-theme-border/30 rounded-lg text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
                title="Next Month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="border border-theme-border/30 rounded-2xl p-4 bg-theme-background/10">
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-theme-text-secondary uppercase tracking-wider mb-2">
              <span>Su</span>
              <span>Mo</span>
              <span>Tu</span>
              <span>We</span>
              <span>Th</span>
              <span>Fr</span>
              <span>Sa</span>
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {calendarDays.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} className="aspect-square"></div>;
                }

                const dayEvents = getDayEvents(day);
                const hasEvents = dayEvents.length > 0;
                const dayPlanningEvents = getDayPlanningEvents(day);
                const hasPlanning = dayPlanningEvents.length > 0;
                const dayTasks = getDayTasks(day);
                const hasTasks = dayTasks.length > 0;
                const dayBookings = getDayBookings(day);
                const hasBookings = dayBookings.length > 0;
                const isSelected = selectedDay === day;

                const tooltipParts: string[] = [];
                if (hasBookings) {
                  tooltipParts.push(
                    dayBookings
                      .map((b) => `${b.roomName}: ${b.organisation || b.bookedByName} (${formatTimeRange(b.start, b.end)})`)
                      .join(', ')
                  );
                }
                if (hasEvents) {
                  tooltipParts.push(dayEvents.map((e) => e.title).join(', '));
                }
                if (hasPlanning) {
                  tooltipParts.push(dayPlanningEvents.map((e) => `${e.title} (Planning Phase)`).join(', '));
                }
                if (hasTasks) {
                  tooltipParts.push(dayTasks.map((t) => `${t.title} (Task Deadline)`).join(', '));
                }

                return (
                  <button
                    key={`day-${day}`}
                    onClick={() => setSelectedDay(day)}
                    className={`aspect-square rounded-xl text-xs font-semibold flex flex-col items-center justify-center relative transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-accent text-white shadow-md shadow-accent/25'
                        : hasEvents
                        ? 'bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25'
                        : hasBookings
                        ? 'bg-sky-500/15 border border-sky-500/30 text-sky-400 hover:bg-sky-500/25'
                        : hasPlanning
                        ? 'bg-warning/10 border border-warning/25 text-warning hover:bg-warning/20'
                        : hasTasks
                        ? 'bg-danger/10 border border-danger/25 text-danger hover:bg-danger/20'
                        : 'hover:bg-theme-border/30 text-theme-text-primary'
                    }`}
                    title={tooltipParts.join(' | ') || undefined}
                  >
                    <span>{day}</span>

                    {/* Dot indicators reflecting ticked layers */}
                    {hasEvents && !isSelected && (
                      <span className="absolute bottom-1 h-1.5 w-1.5 bg-accent rounded-full animate-pulse"></span>
                    )}
                    {hasBookings && !isSelected && (
                      <span className="absolute top-1 left-1 h-1.5 w-1.5 bg-sky-400 rounded-full"></span>
                    )}
                    {!hasEvents && hasPlanning && !isSelected && (
                      <span className="absolute bottom-1 h-1.5 w-1.5 bg-warning rounded-full"></span>
                    )}
                    {hasTasks && !isSelected && (
                      <span className="absolute top-1 right-1 h-1.5 w-1.5 bg-danger rounded-full"></span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Day Event & Booking Details */}
          <div className="flex-1 space-y-2 max-h-[300px] overflow-y-auto pr-1 text-xs">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-bold text-theme-text-secondary uppercase tracking-wider">
                Schedule on {monthNames[calMonth]} {selectedDay || '?'}:
              </h4>
              <span className="text-[10px] text-theme-text-secondary">
                Filtered by {activeCategoriesCount} layer{activeCategoriesCount === 1 ? '' : 's'}
              </span>
            </div>

            {selectedDay ? (
              (() => {
                const dayBookings = getDayBookings(selectedDay);
                const dayEvents = getDayEvents(selectedDay);
                const dayPlanningEvents = getDayPlanningEvents(selectedDay);
                const dayTasks = getDayTasks(selectedDay);

                if (
                  dayBookings.length === 0 &&
                  dayEvents.length === 0 &&
                  dayPlanningEvents.length === 0 &&
                  dayTasks.length === 0
                ) {
                  return (
                    <div className="text-xs text-theme-text-secondary py-5 text-center bg-theme-border/10 border border-theme-border/20 rounded-xl space-y-1">
                      <p>No items scheduled for your active tick list on this date.</p>
                      {activeCategoriesCount < 4 && (
                        <button
                          type="button"
                          onClick={() =>
                            updateFilters((prev) => ({
                              ...prev,
                              bookings: true,
                              events: true,
                              planning: true,
                              tasks: true,
                            }))
                          }
                          className="text-[11px] text-accent hover:underline font-semibold cursor-pointer"
                        >
                          Tick all layers to check everything
                        </button>
                      )}
                    </div>
                  );
                }

                return [
                  // 1. Room Bookings on this day (if ticked)
                  ...dayBookings.map((b) => (
                    <div
                      key={`booking-${b.id}`}
                      className="p-3.5 bg-sky-500/10 border border-sky-500/25 rounded-xl space-y-1.5 transition-all text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold text-[10px] uppercase tracking-wider ${
                              b.roomName.toLowerCase().includes('board')
                                ? 'bg-accent/20 text-accent border border-accent/30'
                                : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                            }`}
                          >
                            {b.roomName}
                          </span>
                          <span className="font-semibold text-theme-text-primary text-xs">
                            {formatTimeRange(b.start, b.end)}
                          </span>
                        </div>
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                          In Use / Reserved
                        </span>
                      </div>
                      <p className="text-xs text-theme-text-primary font-medium">
                        <span className="text-theme-text-secondary">Purpose: </span>
                        {b.title}
                      </p>
                      <p className="text-[11px] text-theme-text-secondary">
                        This <strong>{b.roomName}</strong> is reserved from{' '}
                        <span className="text-theme-text-primary font-semibold">
                          {formatTimeRange(b.start, b.end)}
                        </span>{' '}
                        by{' '}
                        <strong className="text-theme-text-primary">
                          {b.organisation || b.bookedByName}
                        </strong>
                        .
                      </p>
                    </div>
                  )),

                  // 2. Tasks (if ticked)
                  ...dayTasks.map((t) => (
                    <Link
                      key={`task-${t.id}`}
                      href="/dashboard/tasks"
                      className="p-3 bg-danger/10 border border-danger/25 rounded-xl flex items-center justify-between gap-3 hover:bg-danger/20 transition-all block cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <ClipboardCheck className="h-3.5 w-3.5 text-danger shrink-0" />
                        <div>
                          <h5 className="font-semibold text-theme-text-primary text-xs hover:text-accent transition-colors">
                            {t.title}
                          </h5>
                          <p className="text-[10px] text-theme-text-secondary mt-0.5">
                            {t.assignee}
                            {t.event ? ` · ${t.event}` : ''}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] px-2.5 py-0.5 bg-danger/15 text-danger font-semibold rounded-md shrink-0">
                        Task Deadline
                      </span>
                    </Link>
                  )),

                  // 3. Planning events (if ticked)
                  ...dayPlanningEvents.map((ev) => (
                    <Link
                      key={`planning-${ev.id}`}
                      href={`/dashboard/events/${ev.id}`}
                      className="p-3 bg-warning/10 border border-warning/25 rounded-xl flex items-center justify-between gap-3 hover:bg-warning/20 transition-all block cursor-pointer"
                    >
                      <div>
                        <h5 className="font-semibold text-theme-text-primary text-xs hover:text-accent transition-colors">
                          {ev.title}
                        </h5>
                        <p className="text-[10px] text-theme-text-secondary mt-0.5">
                          Prep/planning phase — event runs {formatEventDateRange(ev)}
                        </p>
                      </div>
                      <span className="text-[10px] px-2.5 py-0.5 bg-warning/15 text-warning font-semibold rounded-md shrink-0">
                        Planning
                      </span>
                    </Link>
                  )),

                  // 4. Regular Events (if ticked)
                  ...dayEvents.map((ev) => (
                    <Link
                      key={ev.id}
                      href={`/dashboard/events/${ev.id}`}
                      className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl flex items-center justify-between gap-3 hover:bg-theme-border/20 transition-all block cursor-pointer"
                    >
                      <div>
                        <h5 className="font-semibold text-theme-text-primary text-xs hover:text-accent transition-colors">
                          {ev.title}
                        </h5>
                        <p className="text-[10px] text-theme-text-secondary mt-0.5">
                          {ev.location || 'Location TBD'}
                        </p>
                      </div>
                      <span className="text-[10px] px-2.5 py-0.5 bg-accent/15 text-accent font-semibold rounded-md capitalize">
                        {getEffectiveEventStatus(ev)}
                      </span>
                    </Link>
                  )),
                ];
              })()
            ) : (
              <div className="text-xs text-theme-text-secondary py-3 text-center bg-theme-border/10 border border-theme-border/20 rounded-xl">
                Select a day to view scheduled events and room bookings.
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: Dynamically displays sections based on user tick list */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col space-y-4">
          {/* Upcoming Room Bookings (only if ticked) */}
          {filters.bookings && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-1.5">
                  <DoorOpen className="h-4 w-4 text-sky-400" />
                  Room Bookings
                  {filters.roomFilter !== 'ALL' && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-semibold uppercase">
                      {filters.roomFilter}
                    </span>
                  )}
                </h3>
                <Link
                  href="/dashboard/bookings"
                  className="text-[11px] text-accent hover:underline font-semibold"
                >
                  Book a Room &rarr;
                </Link>
              </div>
              <div className="space-y-2 text-xs">
                {upcomingBookings.length === 0 ? (
                  <div className="text-xs text-theme-text-secondary py-3 text-center bg-theme-border/10 border border-theme-border/20 rounded-xl">
                    No upcoming room bookings.
                  </div>
                ) : (
                  upcomingBookings.map((b) => (
                    <div
                      key={b.id}
                      className="p-3 bg-sky-500/10 border border-sky-500/25 rounded-xl flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`font-bold text-[11px] px-1.5 py-0.5 rounded ${
                            b.roomName.toLowerCase().includes('board')
                              ? 'bg-accent/20 text-accent'
                              : 'bg-sky-500/20 text-sky-400'
                          }`}
                        >
                          {b.roomName}
                        </span>
                        <span className="text-[10px] text-theme-text-secondary">
                          {new Date(b.start).toLocaleDateString([], { month: 'short', day: 'numeric' })},{' '}
                          {formatTimeRange(b.start, b.end)}
                        </span>
                      </div>
                      <p className="text-[11px] text-theme-text-primary">
                        <strong className="text-theme-text-primary">
                          {b.organisation || b.bookedByName}
                        </strong>{' '}
                        is using the {b.roomName}
                      </p>
                      <p className="text-[10px] text-theme-text-secondary line-clamp-1">
                        Purpose: {b.title}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Upcoming Events (only if ticked) */}
          {filters.events && (
            <div className={`space-y-3 ${filters.bookings ? 'pt-2 border-t border-theme-border/20' : ''}`}>
              <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-accent" />
                Upcoming Events
              </h3>
              <div className="space-y-2 text-xs">
                {upcomingEvents.length === 0 ? (
                  <div className="text-xs text-theme-text-secondary py-3 text-center bg-theme-border/10 border border-theme-border/20 rounded-xl">
                    No upcoming events scheduled.
                  </div>
                ) : (
                  upcomingEvents.map((ev) => (
                    <Link
                      key={ev.id}
                      href={`/dashboard/events/${ev.id}`}
                      className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl flex flex-col gap-1 hover:bg-theme-border/20 transition-all block cursor-pointer"
                    >
                      <h5 className="font-semibold text-theme-text-primary text-xs hover:text-accent transition-colors">
                        {ev.title}
                      </h5>
                      <p
                        className={`text-[10px] ${
                          ev.datesTBD ? 'text-warning font-semibold' : 'text-theme-text-secondary'
                        }`}
                      >
                        {formatEventDateRange(ev)}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Upcoming Tasks (only if ticked) */}
          {filters.tasks && (
            <div
              className={`space-y-3 ${
                filters.bookings || filters.events ? 'pt-2 border-t border-theme-border/20' : ''
              }`}
            >
              <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-1.5">
                <ClipboardCheck className="h-4 w-4 text-danger" />
                Upcoming Task Deadlines
              </h3>
              <div className="space-y-2 text-xs">
                {upcomingTaskDeadlines.length === 0 ? (
                  <div className="text-xs text-theme-text-secondary py-3 text-center bg-theme-border/10 border border-theme-border/20 rounded-xl">
                    No upcoming task deadlines.
                  </div>
                ) : (
                  upcomingTaskDeadlines.map((t) => (
                    <Link
                      key={t.id}
                      href="/dashboard/tasks"
                      className="p-3 bg-danger/10 border border-danger/25 rounded-xl flex items-center justify-between gap-2 hover:bg-danger/20 transition-all block cursor-pointer"
                    >
                      <div>
                        <h5 className="font-semibold text-theme-text-primary text-xs hover:text-accent transition-colors">
                          {t.title}
                        </h5>
                        <p className="text-[10px] text-theme-text-secondary mt-0.5">{t.assignee}</p>
                      </div>
                      <span className="text-[10px] text-danger font-semibold shrink-0">{t.dueDate}</span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Fallback if all sidebar items are hidden */}
          {!filters.bookings && !filters.events && !filters.tasks && (
            <div className="text-xs text-theme-text-secondary py-8 text-center space-y-2">
              <p>All sidebar sections are currently hidden by your tick list.</p>
              <button
                type="button"
                onClick={() =>
                  updateFilters((prev) => ({
                    ...prev,
                    bookings: true,
                    events: true,
                    planning: true,
                    tasks: true,
                  }))
                }
                className="px-3 py-1.5 rounded-xl bg-accent text-white font-semibold text-xs cursor-pointer shadow-sm"
              >
                Reset Tick List
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
