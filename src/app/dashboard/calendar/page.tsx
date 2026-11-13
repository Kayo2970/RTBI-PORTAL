'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, CalendarDays, ClipboardCheck, DoorOpen } from 'lucide-react';
import { getEvents, getTasks, getEffectiveEventStatus, formatEventDateRange, hasEventPlanningPhase, getEventSortTime, EventItem, TaskItem } from '@/lib/local-data';
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

export default function CalendarPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [user, setUser] = useState<any>(null);

  const now = new Date();
  const [calendarDate, setCalendarDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<number | null>(() => now.getDate());

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

  // Same visibility rule as the Events page: approved/legacy events follow the
  // own-vs-all Group Policy scope; pending/rejected submissions are only shown to
  // their submitter, their resolved approver, or the Super User.
  const visibleEvents = events.filter(event => {
    if (event.approvalStatus === 'pending_create' || event.approvalStatus === 'rejected') {
      return user?.tier === 1 || event.submittedByEmail === user?.email || canApprovePendingEvent(event, user);
    }
    return canViewEvent(event, user);
  });

  const handlePrevMonth = () => {
    const newDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    setCalendarDate(newDate);
    const maxDays = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate();
    setSelectedDay(prev => prev ? Math.min(prev, maxDays) : 1);
  };

  const handleNextMonth = () => {
    const newDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    setCalendarDate(newDate);
    const maxDays = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate();
    setSelectedDay(prev => prev ? Math.min(prev, maxDays) : 1);
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

  const getDayEvents = (day: number) => {
    const checkStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return visibleEvents.filter(e => !e.datesTBD && checkStr >= e.startDate && checkStr <= e.endDate);
  };

  const getDayPlanningEvents = (day: number) => {
    const checkStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return visibleEvents.filter(e => hasEventPlanningPhase(e) && checkStr === e.planningStartDate);
  };

  const getDayTasks = (day: number) => {
    const checkStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return tasks.filter(t => t.status !== 'Completed' && t.dueDate === checkStr);
  };

  const getDayBookings = (day: number) => {
    const checkStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return bookings.filter(b => b.status === 'Confirmed' && b.start.slice(0, 10) === checkStr);
  };

  const upcomingEvents = [...visibleEvents]
    .filter(e => {
      const effective = getEffectiveEventStatus(e);
      return effective !== 'completed' && effective !== 'archived';
    })
    .sort((a, b) => getEventSortTime(a) - getEventSortTime(b))
    .slice(0, 6);

  const todayStr = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();

  const upcomingBookings = [...bookings]
    .filter(b => b.status === 'Confirmed' && new Date(b.end).getTime() > nowMs)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 5);

  const upcomingTaskDeadlines = [...tasks]
    .filter(t => t.status !== 'Completed' && t.dueDate >= todayStr)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-accent" />
            Calendar & Room Schedule
          </h1>
          <p className="text-xs text-theme-text-secondary">
            View scheduled symposiums, workshops, deadlines, and live <strong>Boardroom & Meeting Room</strong> bookings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/bookings"
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-accent text-white text-xs font-bold hover:bg-primary-light transition-all shadow-sm"
          >
            <DoorOpen className="h-4 w-4" /> Book a Room
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Interactive Event & Booking Calendar */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-6 flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary">RTBI Calendar</h3>
              <p className="text-xs text-theme-text-secondary">Click any day to view scheduled events, deadlines, and room bookings</p>
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
                  tooltipParts.push(dayBookings.map(b => `${b.roomName}: ${b.organisation || b.bookedByName} (${formatTimeRange(b.start, b.end)})`).join(', '));
                }
                if (hasEvents) {
                  tooltipParts.push(dayEvents.map(e => e.title).join(', '));
                }
                if (hasTasks) {
                  tooltipParts.push(dayTasks.map(t => `${t.title} (Task deadline)`).join(', '));
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
            <h4 className="text-[11px] font-bold text-theme-text-secondary uppercase tracking-wider">
              Schedule on {monthNames[calMonth]} {selectedDay || '?'}:
            </h4>
            {selectedDay ? (
              (() => {
                const dayBookings = getDayBookings(selectedDay);
                const dayEvents = getDayEvents(selectedDay);
                const dayPlanningEvents = getDayPlanningEvents(selectedDay);
                const dayTasks = getDayTasks(selectedDay);

                if (dayBookings.length === 0 && dayEvents.length === 0 && dayPlanningEvents.length === 0 && dayTasks.length === 0) {
                  return (
                    <div className="text-xs text-theme-text-secondary py-4 text-center bg-theme-border/10 border border-theme-border/20 rounded-xl">
                      No events, deadlines, or room bookings scheduled for this date.
                    </div>
                  );
                }

                return [
                  // 1. Room Bookings on this day
                  ...dayBookings.map(b => (
                    <div
                      key={`booking-${b.id}`}
                      className="p-3.5 bg-sky-500/10 border border-sky-500/25 rounded-xl space-y-1.5 transition-all text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] uppercase tracking-wider ${b.roomName.toLowerCase().includes('board') ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'}`}>
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
                        This <strong>{b.roomName}</strong> is booked from{' '}
                        <span className="text-theme-text-primary font-semibold">{formatTimeRange(b.start, b.end)}</span> by{' '}
                        <strong className="text-theme-text-primary">{b.organisation || b.bookedByName}</strong>, and they are using it.
                      </p>
                    </div>
                  )),

                  // 2. Tasks
                  ...dayTasks.map(t => (
                    <Link
                      key={`task-${t.id}`}
                      href="/dashboard/tasks"
                      className="p-3 bg-danger/10 border border-danger/25 rounded-xl flex items-center justify-between gap-3 hover:bg-danger/20 transition-all block cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <ClipboardCheck className="h-3.5 w-3.5 text-danger shrink-0" />
                        <div>
                          <h5 className="font-semibold text-theme-text-primary text-xs hover:text-accent transition-colors">{t.title}</h5>
                          <p className="text-[10px] text-theme-text-secondary mt-0.5">{t.assignee}{t.event ? ` · ${t.event}` : ''}</p>
                        </div>
                      </div>
                      <span className="text-[10px] px-2.5 py-0.5 bg-danger/15 text-danger font-semibold rounded-md shrink-0">Deadline</span>
                    </Link>
                  )),

                  // 3. Planning events
                  ...dayPlanningEvents.map(ev => (
                    <Link
                      key={`planning-${ev.id}`}
                      href={`/dashboard/events/${ev.id}`}
                      className="p-3 bg-warning/10 border border-warning/25 rounded-xl flex items-center justify-between gap-3 hover:bg-warning/20 transition-all block cursor-pointer"
                    >
                      <div>
                        <h5 className="font-semibold text-theme-text-primary text-xs hover:text-accent transition-colors">{ev.title}</h5>
                        <p className="text-[10px] text-theme-text-secondary mt-0.5">Prep/planning phase — event runs {formatEventDateRange(ev)}</p>
                      </div>
                      <span className="text-[10px] px-2.5 py-0.5 bg-warning/15 text-warning font-semibold rounded-md shrink-0">Planning</span>
                    </Link>
                  )),

                  // 4. Regular Events
                  ...dayEvents.map(ev => (
                    <Link
                      key={ev.id}
                      href={`/dashboard/events/${ev.id}`}
                      className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl flex items-center justify-between gap-3 hover:bg-theme-border/20 transition-all block cursor-pointer"
                    >
                      <div>
                        <h5 className="font-semibold text-theme-text-primary text-xs hover:text-accent transition-colors">{ev.title}</h5>
                        <p className="text-[10px] text-theme-text-secondary mt-0.5">{(ev.committees || []).length} Sub-Committees</p>
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

        {/* Sidebar: Room Bookings, Events & Tasks */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col space-y-4">
          {/* Upcoming Room Bookings */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-1.5">
                <DoorOpen className="h-4 w-4 text-sky-400" />
                Room Bookings
              </h3>
              <Link href="/dashboard/bookings" className="text-[11px] text-accent hover:underline font-semibold">
                Book a Room &rarr;
              </Link>
            </div>
            <div className="space-y-2 text-xs">
              {upcomingBookings.length === 0 ? (
                <div className="text-xs text-theme-text-secondary py-3 text-center bg-theme-border/10 border border-theme-border/20 rounded-xl">
                  No upcoming room bookings.
                </div>
              ) : (
                upcomingBookings.map(b => (
                  <div
                    key={b.id}
                    className="p-3 bg-sky-500/10 border border-sky-500/25 rounded-xl flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`font-bold text-[11px] px-1.5 py-0.5 rounded ${b.roomName.toLowerCase().includes('board') ? 'bg-accent/20 text-accent' : 'bg-sky-500/20 text-sky-400'}`}>
                        {b.roomName}
                      </span>
                      <span className="text-[10px] text-theme-text-secondary">
                        {new Date(b.start).toLocaleDateString([], { month: 'short', day: 'numeric' })}, {formatTimeRange(b.start, b.end)}
                      </span>
                    </div>
                    <p className="text-[11px] text-theme-text-primary">
                      <strong className="text-theme-text-primary">{b.organisation || b.bookedByName}</strong> is using the {b.roomName}
                    </p>
                    <p className="text-[10px] text-theme-text-secondary line-clamp-1">
                      Purpose: {b.title}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Upcoming Events */}
          <div className="space-y-3 pt-2 border-t border-theme-border/20">
            <h3 className="text-base font-bold text-theme-text-primary">Upcoming Events</h3>
            <div className="space-y-2 text-xs">
              {upcomingEvents.length === 0 ? (
                <div className="text-xs text-theme-text-secondary py-3 text-center bg-theme-border/10 border border-theme-border/20 rounded-xl">
                  No upcoming events scheduled.
                </div>
              ) : (
                upcomingEvents.map(ev => (
                  <Link
                    key={ev.id}
                    href={`/dashboard/events/${ev.id}`}
                    className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl flex flex-col gap-1 hover:bg-theme-border/20 transition-all block cursor-pointer"
                  >
                    <h5 className="font-semibold text-theme-text-primary text-xs hover:text-accent transition-colors">{ev.title}</h5>
                    <p className={`text-[10px] ${ev.datesTBD ? 'text-warning font-semibold' : 'text-theme-text-secondary'}`}>{formatEventDateRange(ev)}</p>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Upcoming Tasks */}
          <div className="space-y-3 pt-2 border-t border-theme-border/20">
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
                upcomingTaskDeadlines.map(t => (
                  <Link
                    key={t.id}
                    href="/dashboard/tasks"
                    className="p-3 bg-danger/10 border border-danger/25 rounded-xl flex items-center justify-between gap-2 hover:bg-danger/20 transition-all block cursor-pointer"
                  >
                    <div>
                      <h5 className="font-semibold text-theme-text-primary text-xs hover:text-accent transition-colors">{t.title}</h5>
                      <p className="text-[10px] text-theme-text-secondary mt-0.5">{t.assignee}</p>
                    </div>
                    <span className="text-[10px] text-danger font-semibold shrink-0">{t.dueDate}</span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
