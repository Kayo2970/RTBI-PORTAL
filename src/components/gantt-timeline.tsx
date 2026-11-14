'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CalendarRange,
  Calendar,
  CalendarDays,
  MapPin,
  CheckSquare,
  Clock,
  ExternalLink,
  Maximize2,
  X,
  ChevronRight,
  Info,
  ZoomIn,
  ZoomOut,
  DoorOpen,
  Sparkles,
  Layers,
  Flag,
} from 'lucide-react';
import {
  EventItem,
  TaskItem,
  getEffectiveEventStatus,
  hasEventPlanningPhase,
  formatEventDateRange,
  formatEventPlanningNote,
  getTaskLateness,
  describeTaskLateness,
} from '@/lib/local-data';
import type { Booking } from '@/lib/billing';
import { EventDetailModal } from '@/components/event-detail-modal';

type WindowKey = '14' | '30' | '60' | '90' | 'year' | 'custom';

const WINDOW_OPTIONS: { key: Exclude<WindowKey, 'custom'>; label: string; before: number; after: number }[] = [
  { key: '14', label: '2 Weeks', before: 1, after: 14 },
  { key: '30', label: '30 Days', before: 2, after: 30 },
  { key: '60', label: '60 Days', before: 3, after: 60 },
  { key: '90', label: 'Quarter', before: 3, after: 90 },
  { key: 'year', label: 'Full Year', before: 7, after: 365 },
];

const DAY_MS = 86400000;
/** Horizontal zoom levels (multiplier on the width of one day column). */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
const LABEL_GAP_PX = 56; // keep date labels at least this far apart at any zoom
const LATE_MARKER_CLASS = 'bg-danger ring-2 ring-danger/60 !border-danger z-20';

const taskMarkerTitle = (task: TaskItem) => {
  const late = getTaskLateness(task);
  return `${task.title} · due ${task.dueDate} · ${task.status}${late ? ` · ${describeTaskLateness(late)}` : ''}`;
};

/** Longest custom range we draw — beyond this the day columns become unreadably thin. */
const MAX_CUSTOM_DAYS = 731;
const parseDate = (s: string) => new Date(`${s}T00:00:00`);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type TbiScheduleTrack = 'PROGRAM' | 'WORKSHOP' | 'DEMO_DAY' | 'HACKATHON' | 'FACILITY' | 'MILESTONE';

export function getTbiEventTrack(event: EventItem): { track: TbiScheduleTrack; label: string; badgeCls: string; barGradient: string } {
  const text = `${event.title} ${event.description || ''} ${event.location || ''}`.toLowerCase();
  if (/workshop|bootcamp|masterclass|training|hands-on|lab\b/i.test(text)) {
    return {
      track: 'WORKSHOP',
      label: 'Workshop',
      badgeCls: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
      barGradient: 'bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500',
    };
  }
  if (/pitch|demo day|investor|showcase|presentation\b/i.test(text)) {
    return {
      track: 'DEMO_DAY',
      label: 'Demo / Pitch',
      badgeCls: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
      barGradient: 'bg-gradient-to-r from-purple-600 via-fuchsia-600 to-purple-500',
    };
  }
  if (/hackathon|ideathon|challenge|competition|contest\b/i.test(text)) {
    return {
      track: 'HACKATHON',
      label: 'Hackathon',
      badgeCls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      barGradient: 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500',
    };
  }
  if (/cohort|incubation|induction|mentor|clinic|review\b/i.test(text)) {
    return {
      track: 'PROGRAM',
      label: 'Cohort Program',
      badgeCls: 'bg-accent/15 text-accent border-accent/30',
      barGradient: 'bg-gradient-to-r from-accent via-rose-600 to-accent',
    };
  }
  return {
    track: 'PROGRAM',
    label: 'TBI Program',
    badgeCls: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    barGradient: 'bg-gradient-to-r from-accent via-amber-600 to-accent',
  };
}

export type TrackFilterKey = 'ALL' | 'PROGRAMS' | 'WORKSHOPS' | 'PITCH' | 'BOOKINGS' | 'MILESTONES';

export interface GanttTimelineProps {
  /** Already permission-filtered, non-holiday events. */
  events: EventItem[];
  /** Already permission-filtered tasks. */
  tasks: TaskItem[];
  /** Optional confirmed facility/room bookings from the incubator. */
  bookings?: Booking[];
  maxRows?: number;
}

function countInWindow(
  opt: (typeof WINDOW_OPTIONS)[number],
  events: EventItem[],
  tasks: TaskItem[],
  bookings: Booking[] = []
): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = toDateStr(addDays(today, -opt.before));
  const end = toDateStr(addDays(today, opt.after));
  const eventCount = events.filter(
    (e) => !e.datesTBD && e.startDate && e.endDate && e.endDate >= start && e.startDate <= end
  ).length;
  const taskCount = tasks.filter((t) => t.dueDate >= start && t.dueDate <= end).length;
  const bookingCount = bookings.filter((b) => {
    const s = b.start?.slice(0, 10);
    const e = b.end?.slice(0, 10);
    return s && e && e >= start && s <= end;
  }).length;
  return eventCount + taskCount + bookingCount;
}

function getCountdownBadge(startDate: string, endDate: string, planningStartDate?: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toDateStr(today);

  if (endDate < todayStr) {
    return { label: 'Concluded', cls: 'bg-theme-border/20 text-theme-text-secondary' };
  }
  if (startDate <= todayStr && endDate >= todayStr) {
    return { label: 'Active Today', cls: 'bg-warning/20 text-warning font-bold animate-pulse' };
  }
  if (planningStartDate && planningStartDate <= todayStr && startDate > todayStr) {
    const diff = daysBetween(today, parseDate(startDate));
    return { label: `In Prep (${diff}d to launch)`, cls: 'bg-warning/15 text-warning font-medium' };
  }
  const diff = daysBetween(today, parseDate(startDate));
  if (diff === 1) return { label: 'Starts Tomorrow', cls: 'bg-accent/20 text-accent font-bold' };
  if (diff <= 7) return { label: `Starts in ${diff}d`, cls: 'bg-accent/15 text-accent font-semibold' };
  return { label: `In ${diff}d`, cls: 'bg-theme-border/25 text-theme-text-primary' };
}

export function GanttTimeline({ events, tasks, bookings = [], maxRows = 10 }: GanttTimelineProps) {
  const [windowKey, setWindowKey] = useState<WindowKey>('30');
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<{ dayFraction: number } | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTrack, setActiveTrack] = useState<TrackFilterKey>('ALL');

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [modalEvent, setModalEvent] = useState<EventItem | null>(null);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [userPickedWindow, setUserPickedWindow] = useState(false);

  const selectedEvent = useMemo(() => {
    return events.find((e) => e.id === selectedEventId) || null;
  }, [events, selectedEventId]);

  const selectedBooking = useMemo(() => {
    return bookings.find((b) => b.id === selectedBookingId) || null;
  }, [bookings, selectedBookingId]);

  const handleEventClick = (event: EventItem) => {
    setSelectedBookingId(null);
    setSelectedEventId((prev) => (prev === event.id ? null : event.id));
  };

  const handleBookingClick = (booking: Booking) => {
    setSelectedEventId(null);
    setSelectedBookingId((prev) => (prev === booking.id ? null : booking.id));
  };

  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isExpanded]);

  useEffect(() => {
    if (userPickedWindow) return;
    for (const opt of WINDOW_OPTIONS) {
      if (countInWindow(opt, events, tasks, bookings) > 0) {
        setWindowKey(opt.key);
        return;
      }
    }
    setWindowKey('year');
  }, [events, tasks, bookings, userPickedWindow]);

  const windowOpt = WINDOW_OPTIONS.find((w) => w.key === windowKey) ?? WINDOW_OPTIONS[1];
  const customValid =
    windowKey === 'custom' &&
    !!customFrom &&
    !!customTo &&
    customFrom <= customTo &&
    daysBetween(parseDate(customFrom), parseDate(customTo)) < MAX_CUSTOM_DAYS;
  const customError =
    windowKey !== 'custom'
      ? ''
      : !customFrom || !customTo
      ? 'Pick a start and an end date.'
      : customFrom > customTo
      ? 'The end date must be on or after the start date.'
      : !customValid
      ? `Pick a range of at most ${MAX_CUSTOM_DAYS} days (about 2 years).`
      : '';

  const selectCustom = () => {
    if (!customFrom || !customTo) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setCustomFrom(toDateStr(addDays(today, -1)));
      setCustomTo(toDateStr(addDays(today, 30)));
    }
    setWindowKey('custom');
    setUserPickedWindow(true);
  };

  const { rangeStart, rangeEnd, totalDays } = useMemo(() => {
    if (customValid) {
      const from = parseDate(customFrom);
      const to = parseDate(customTo);
      return { rangeStart: from, rangeEnd: to, totalDays: daysBetween(from, to) + 1 };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let start = addDays(today, -windowOpt.before);
    const end = addDays(today, windowOpt.after);

    const endStr = toDateStr(end);
    let earliestPlanning: string | null = null;
    for (const e of events) {
      if (!hasEventPlanningPhase(e) || !e.startDate || e.startDate > endStr) continue;
      if (!earliestPlanning || e.planningStartDate! < earliestPlanning) earliestPlanning = e.planningStartDate!;
    }
    if (earliestPlanning && earliestPlanning < toDateStr(start)) {
      const hardFloor = addDays(today, -180);
      const candidate = parseDate(earliestPlanning);
      start = candidate < hardFloor ? hardFloor : candidate;
    }

    return { rangeStart: start, rangeEnd: end, totalDays: daysBetween(start, end) + 1 };
  }, [windowOpt, events, customValid, customFrom, customTo]);

  const STICKY_LABEL_WIDTH = 256;
  const baseDayWidth = totalDays <= 16 ? 44 : totalDays <= 35 ? 24 : totalDays <= 120 ? 12 : 8;
  const fitDayWidth =
    boxWidth > STICKY_LABEL_WIDTH + 8
      ? Math.floor(((boxWidth - STICKY_LABEL_WIDTH - 2) / totalDays) * 100) / 100
      : 0;
  const dayWidth = Math.max(1.5, Math.max(baseDayWidth, fitDayWidth) * zoom);

  const changeZoom = (next: number) => {
    const clamped = Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.max(ZOOM_STEPS[0], next));
    if (clamped === zoom) return;
    const el = scrollRef.current;
    if (el) {
      const visible = el.clientWidth - STICKY_LABEL_WIDTH;
      zoomAnchor.current = { dayFraction: (el.scrollLeft + visible / 2) / (totalDays * dayWidth) };
    }
    setZoom(clamped);
  };

  const stepZoom = (dir: 1 | -1) => {
    const i = ZOOM_STEPS.findIndex((z) => z >= zoom - 1e-9);
    const cur = i === -1 ? ZOOM_STEPS.length - 1 : i;
    changeZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, cur + dir))]);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setBoxWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchor.current;
    if (!el || !anchor) return;
    zoomAnchor.current = null;
    const visible = el.clientWidth - STICKY_LABEL_WIDTH;
    el.scrollLeft = Math.max(0, anchor.dayFraction * totalDays * dayWidth - visible / 2);
  }, [zoom, dayWidth, totalDays]);

  const zoomRef = useRef({ stepZoom, zoom });
  zoomRef.current = { stepZoom, zoom };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomRef.current.stepZoom(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const timelineWidth = totalDays * dayWidth;
  const todayOffset = daysBetween(rangeStart, new Date(new Date().setHours(0, 0, 0, 0)));

  const xFor = (dateStr: string) =>
    Math.min(totalDays, Math.max(0, daysBetween(rangeStart, parseDate(dateStr)))) * dayWidth;

  const rangeStartStr = toDateStr(rangeStart);
  const rangeEndStr = toDateStr(rangeEnd);
  const effectiveMaxRows = isExpanded ? 500 : maxRows;

  // Track filter logic
  const eventMatchesTrack = (e: EventItem, trackKey: TrackFilterKey): boolean => {
    if (trackKey === 'ALL') return true;
    const t = getTbiEventTrack(e).track;
    if (trackKey === 'WORKSHOPS') return t === 'WORKSHOP';
    if (trackKey === 'PITCH') return t === 'DEMO_DAY';
    if (trackKey === 'PROGRAMS') return t === 'PROGRAM' || t === 'HACKATHON';
    return false;
  };

  // Event rows
  const eventRows = useMemo(() => {
    return events
      .filter((e) => !e.datesTBD && e.startDate && e.endDate)
      .filter((e) => e.endDate >= rangeStartStr && e.startDate <= rangeEndStr)
      .filter((e) => eventMatchesTrack(e, activeTrack))
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, effectiveMaxRows)
      .map((event) => {
        const clampedStart = event.startDate < rangeStartStr ? rangeStartStr : event.startDate;
        const clampedEnd = event.endDate > rangeEndStr ? rangeEndStr : event.endDate;
        const left = xFor(clampedStart);
        const width = Math.max(dayWidth * 0.6, xFor(clampedEnd) - left + dayWidth);

        let planningLeft: number | null = null;
        let planningWidth = 0;
        if (hasEventPlanningPhase(event) && event.planningStartDate! <= rangeEndStr) {
          const clampedPlanStart = event.planningStartDate! < rangeStartStr ? rangeStartStr : event.planningStartDate!;
          planningLeft = xFor(clampedPlanStart);
          planningWidth = Math.max(dayWidth * 0.4, left - planningLeft);
        }

        const eventTasks = tasks.filter(
          (t) => t.eventId === event.id && t.dueDate >= rangeStartStr && t.dueDate <= rangeEndStr
        );
        const trackInfo = getTbiEventTrack(event);
        const countdown = getCountdownBadge(event.startDate, event.endDate, event.planningStartDate);

        return {
          event,
          left,
          width,
          planningLeft,
          planningWidth,
          tasks: eventTasks,
          trackInfo,
          countdown,
        };
      });
  }, [events, tasks, rangeStartStr, rangeEndStr, dayWidth, effectiveMaxRows, activeTrack]);

  // Facility / Room Booking rows
  const bookingRows = useMemo(() => {
    if (activeTrack !== 'ALL' && activeTrack !== 'BOOKINGS') return [];
    return bookings
      .filter((b) => b.status === 'Confirmed' && b.start && b.end)
      .filter((b) => {
        const s = b.start.slice(0, 10);
        const e = b.end.slice(0, 10);
        return e >= rangeStartStr && s <= rangeEndStr;
      })
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, isExpanded ? 50 : 6)
      .map((booking) => {
        const sDate = booking.start.slice(0, 10);
        const eDate = booking.end.slice(0, 10);
        const clampedStart = sDate < rangeStartStr ? rangeStartStr : sDate;
        const clampedEnd = eDate > rangeEndStr ? rangeEndStr : eDate;
        const left = xFor(clampedStart);
        const width = Math.max(dayWidth * 0.8, xFor(clampedEnd) - left + dayWidth);
        const countdown = getCountdownBadge(sDate, eDate);

        return {
          booking,
          left,
          width,
          countdown,
        };
      });
  }, [bookings, rangeStartStr, rangeEndStr, dayWidth, isExpanded, activeTrack]);

  // Standalone Tasks / Milestones row
  const standaloneTasks = useMemo(() => {
    if (activeTrack !== 'ALL' && activeTrack !== 'MILESTONES') return [];
    return tasks
      .filter((t) => !t.eventId && t.dueDate >= rangeStartStr && t.dueDate <= rangeEndStr)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, isExpanded ? 200 : 12);
  }, [tasks, rangeStartStr, rangeEndStr, isExpanded, activeTrack]);

  // Date tick labels along header
  const ticks = useMemo(() => {
    const tickEveryDays = [1, 2, 7, 14, 30, 60].find((d) => d * dayWidth >= LABEL_GAP_PX) ?? 90;
    const result: { offset: number; label: string }[] = [];
    for (let i = 0; i <= totalDays; i += tickEveryDays) {
      const d = addDays(rangeStart, i);
      result.push({
        offset: i * dayWidth,
        label: d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
      });
    }
    return result;
  }, [totalDays, dayWidth, rangeStart]);

  const rowCount = eventRows.length + bookingRows.length + (standaloneTasks.length > 0 ? 1 : 0);

  return (
    <div
      className={
        isExpanded
          ? 'glass-panel rounded-3xl p-6 flex flex-col space-y-4 h-full min-h-0 border border-theme-card-border shadow-2xl'
          : 'glass-panel rounded-3xl p-6 flex flex-col space-y-4 border border-theme-card-border'
      }
    >
      {/* Top Header: Title, Track Filters & Horizon Windows */}
      <div className="flex flex-col gap-4 border-b border-theme-border/15 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-accent" />
              <h3 className="text-base font-bold text-theme-text-primary">Upcoming TBI Schedule</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent/15 text-accent border border-accent/30 uppercase tracking-wider">
                Gantt View
              </span>
            </div>
            <p className="text-xs text-theme-text-secondary mt-0.5">
              Comprehensive timeline of incubator programs, cohort milestones, workshops, and facility schedules.
            </p>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  setWindowKey(opt.key);
                  setUserPickedWindow(true);
                }}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-xl transition-all cursor-pointer ${
                  windowKey === opt.key
                    ? 'bg-accent text-white shadow-xs'
                    : 'bg-theme-border/25 text-theme-text-secondary hover:bg-theme-border/50 hover:text-theme-text-primary'
                }`}
              >
                {opt.label}
              </button>
            ))}

            <div
              className="flex items-center gap-0.5 rounded-xl bg-theme-border/25 p-0.5"
              title="Zoom timeline (Ctrl/Cmd + wheel works too)"
            >
              <button
                type="button"
                onClick={() => stepZoom(-1)}
                disabled={zoom <= ZOOM_STEPS[0]}
                aria-label="Zoom out"
                className="p-1 rounded-lg text-theme-text-secondary hover:bg-theme-border/50 hover:text-theme-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => changeZoom(1)}
                title="Reset zoom to 100%"
                className="px-1 min-w-[36px] text-[10px] font-bold text-theme-text-secondary hover:text-theme-text-primary tabular-nums cursor-pointer"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => stepZoom(1)}
                disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                aria-label="Zoom in"
                className="p-1 rounded-lg text-theme-text-secondary hover:bg-theme-border/50 hover:text-theme-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={selectCustom}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1 ${
                windowKey === 'custom'
                  ? 'bg-accent text-white shadow-xs'
                  : 'bg-theme-border/25 text-theme-text-secondary hover:bg-theme-border/50 hover:text-theme-text-primary'
              }`}
            >
              <Calendar className="h-3 w-3" /> Custom
            </button>

            <button
              type="button"
              onClick={() => {
                if (!isExpanded) {
                  setWindowKey('year');
                  setUserPickedWindow(true);
                }
                setIsExpanded((v) => !v);
              }}
              title={isExpanded ? 'Collapse' : 'Expand full-screen'}
              className="p-1.5 rounded-xl bg-theme-border/25 text-theme-text-secondary hover:bg-theme-border/50 hover:text-theme-text-primary transition-all cursor-pointer"
            >
              {isExpanded ? <X className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* TBI Schedule Track Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs pb-0.5">
          <span className="text-[11px] font-semibold text-theme-text-secondary flex items-center gap-1 shrink-0 mr-1">
            <Layers className="h-3.5 w-3.5 text-accent" />
            Track:
          </span>
          {[
            { key: 'ALL', label: 'All Schedules' },
            { key: 'PROGRAMS', label: 'Programs & Cohorts' },
            { key: 'WORKSHOPS', label: 'Workshops & Labs' },
            { key: 'PITCH', label: 'Demo & Pitch Days' },
            { key: 'BOOKINGS', label: 'Facility Bookings' },
            { key: 'MILESTONES', label: 'Key Milestones' },
          ].map((trk) => (
            <button
              key={trk.key}
              type="button"
              onClick={() => setActiveTrack(trk.key as TrackFilterKey)}
              className={`px-3 py-1 rounded-xl text-[11px] font-semibold cursor-pointer transition-all whitespace-nowrap ${
                activeTrack === trk.key
                  ? 'bg-accent text-white shadow-xs'
                  : 'bg-theme-background/30 text-theme-text-secondary hover:bg-theme-border/25 hover:text-theme-text-primary'
              }`}
            >
              {trk.label}
            </button>
          ))}
        </div>
      </div>

      {windowKey === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 p-3 rounded-2xl bg-theme-border/10 border border-theme-border/30">
          <label className="text-[11px] font-semibold text-theme-text-secondary space-y-1">
            <span className="block">From</span>
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="px-3 py-1.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent"
            />
          </label>
          <label className="text-[11px] font-semibold text-theme-text-secondary space-y-1">
            <span className="block">To</span>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-3 py-1.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent"
            />
          </label>
          {customError ? (
            <p className="text-[11px] text-warning font-medium pb-1.5">{customError} Showing default window until fixed.</p>
          ) : (
            <p className="text-[11px] text-theme-text-secondary pb-1.5">{totalDays} days displayed</p>
          )}
        </div>
      )}

      {/* Selected Event Details Inspector Banner */}
      {selectedEvent && (
        <div className="p-4 rounded-3xl bg-gradient-to-r from-accent/15 via-primary/10 to-accent/5 border border-accent/30 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] uppercase font-extrabold tracking-wider px-2.5 py-0.5 rounded-full ${getTbiEventTrack(selectedEvent).badgeCls}`}>
                {getTbiEventTrack(selectedEvent).label}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize bg-theme-border/30 text-theme-text-primary border border-theme-border/40">
                {getEffectiveEventStatus(selectedEvent, tasks)}
              </span>
            </div>

            <h4 className="text-sm md:text-base font-bold text-theme-text-primary truncate">
              {selectedEvent.title}
            </h4>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-theme-text-secondary">
              <span className="flex items-center gap-1 font-semibold text-accent">
                <Calendar className="h-3.5 w-3.5" />
                {formatEventDateRange(selectedEvent)}
              </span>
              {formatEventPlanningNote(selectedEvent) && (
                <span className="text-warning font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatEventPlanningNote(selectedEvent)}
                </span>
              )}
              {selectedEvent.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-theme-text-secondary" />
                  {selectedEvent.location}
                </span>
              )}
              <span className="flex items-center gap-1">
                <CheckSquare className="h-3.5 w-3.5 text-theme-text-secondary" />
                {tasks.filter((t) => t.eventId === selectedEvent.id || t.event === selectedEvent.title).length} deliverables
              </span>
            </div>

            {selectedEvent.description && (
              <p className="text-xs text-theme-text-secondary line-clamp-1 italic pt-0.5">
                &ldquo;{selectedEvent.description}&rdquo;
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 self-stretch md:self-center justify-end">
            <button
              type="button"
              onClick={() => setModalEvent(selectedEvent)}
              className="px-4 py-2 bg-accent hover:bg-primary-light text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-accent/20 flex items-center gap-1.5 cursor-pointer hover:scale-105 active:scale-95"
            >
              <span>Open Event Window</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setSelectedEventId(null)}
              className="p-2 rounded-xl bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              title="Deselect event"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Selected Room Booking Inspector Banner */}
      {selectedBooking && (
        <div className="p-4 rounded-3xl bg-gradient-to-r from-blue-500/15 via-cyan-500/10 to-blue-500/5 border border-blue-500/30 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase font-extrabold tracking-wider px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                Facility Booking
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize bg-theme-border/30 text-theme-text-primary">
                {selectedBooking.roomName}
              </span>
            </div>

            <h4 className="text-sm md:text-base font-bold text-theme-text-primary truncate">
              {selectedBooking.title}
            </h4>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-theme-text-secondary">
              <span className="flex items-center gap-1 font-semibold text-cyan-400">
                <Clock className="h-3.5 w-3.5" />
                {new Date(selectedBooking.start).toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}{' '}
                –{' '}
                {new Date(selectedBooking.end).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}
              </span>
              <span className="flex items-center gap-1">
                <DoorOpen className="h-3.5 w-3.5 text-theme-text-secondary" />
                {selectedBooking.roomName}
              </span>
              <span className="text-theme-text-primary font-medium">
                Booked by: {selectedBooking.organisation || selectedBooking.bookedByName}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-stretch md:self-center justify-end">
            <Link
              href="/dashboard/bookings"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-blue-600/20 flex items-center gap-1.5"
            >
              <span>Manage Bookings</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => setSelectedBookingId(null)}
              className="p-2 rounded-xl bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              title="Deselect booking"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Gantt Grid Box */}
      {rowCount === 0 ? (
        <div className="text-center py-12 text-theme-text-secondary text-xs rounded-2xl border border-dashed border-theme-border/30">
          No upcoming schedule items fall within this window. Try selecting a wider timeframe or different track filter.
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className={
              isExpanded
                ? 'flex-1 min-h-0 overflow-auto rounded-2xl border border-theme-border/20 bg-theme-background/10'
                : 'overflow-x-auto rounded-2xl border border-theme-border/20 bg-theme-background/10'
            }
          >
            <div style={{ minWidth: timelineWidth + STICKY_LABEL_WIDTH }}>
              {/* Header: Date Scale */}
              <div className="flex sticky top-0 z-20 shadow-xs">
                <div
                  className="sticky left-0 z-30 shrink-0 bg-theme-card border-b border-r border-theme-border/20 px-3 py-2 flex items-center justify-between"
                  style={{ width: STICKY_LABEL_WIDTH }}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-theme-text-secondary">
                    TBI Schedule Items
                  </span>
                  <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-theme-border/20 text-theme-text-secondary">
                    {rowCount} rows
                  </span>
                </div>
                <div
                  className="relative overflow-hidden bg-theme-card border-b border-theme-border/20"
                  style={{ width: timelineWidth, height: 34 }}
                >
                  {ticks.map((t, i) => (
                    <div
                      key={i}
                      className="absolute top-0 h-full flex items-center border-l border-theme-border/15 pl-1.5"
                      style={{ left: t.offset }}
                    >
                      <span className="text-[9px] font-mono text-theme-text-secondary whitespace-nowrap">
                        {t.label}
                      </span>
                    </div>
                  ))}

                  {/* Red "Today" Line Marker */}
                  {todayOffset >= 0 && todayOffset <= totalDays && (
                    <div
                      className="absolute top-0 h-full border-l-2 border-danger z-20 pointer-events-none"
                      style={{ left: todayOffset * dayWidth }}
                    >
                      <span className="absolute top-0.5 left-1 text-[9px] font-bold px-1 py-0.2 rounded bg-danger text-white uppercase tracking-wider shadow-xs">
                        Today
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* TBI Event Rows */}
              {eventRows.map(({ event, left, width, planningLeft, planningWidth, tasks: eventTasks, trackInfo, countdown }) => {
                const effective = getEffectiveEventStatus(event, tasks);
                const isSelected = selectedEventId === event.id;

                return (
                  <div
                    key={event.id}
                    onClick={() => handleEventClick(event)}
                    className={`flex items-center h-14 border-b border-theme-border/10 group cursor-pointer transition-colors ${
                      isSelected ? 'bg-accent/10 border-accent/30' : 'hover:bg-theme-border/10'
                    }`}
                  >
                    {/* Left Sticky Label Column */}
                    <div
                      className={`sticky left-0 z-10 shrink-0 border-r border-theme-border/20 px-3 py-1.5 transition-all flex flex-col justify-center ${
                        isSelected
                          ? 'bg-accent/15 border-l-4 border-l-accent'
                          : 'bg-theme-card group-hover:bg-accent/5'
                      }`}
                      style={{ width: STICKY_LABEL_WIDTH }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider ${trackInfo.badgeCls}`}
                        >
                          {trackInfo.label}
                        </span>
                        <span className={`px-1.5 py-0.2 rounded text-[9px] ${countdown.cls}`}>
                          {countdown.label}
                        </span>
                      </div>
                      <span
                        className={`text-[11px] truncate block mt-0.5 ${
                          isSelected
                            ? 'font-bold text-accent'
                            : 'font-semibold text-theme-text-primary group-hover:text-accent'
                        }`}
                        title={event.title}
                      >
                        {event.title}
                      </span>
                      <span className="text-[10px] text-theme-text-secondary truncate flex items-center gap-1 mt-0.5">
                        <MapPin className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{event.location || 'RTBI Hub'}</span>
                      </span>
                    </div>

                    {/* Timeline Canvas Row */}
                    <div className="relative" style={{ width: timelineWidth, height: '100%' }}>
                      {todayOffset >= 0 && todayOffset <= totalDays && (
                        <div
                          className="absolute top-0 h-full border-l border-danger/30 pointer-events-none"
                          style={{ left: todayOffset * dayWidth }}
                        />
                      )}

                      {/* Hatched Planning / Prep Lead-in Bar */}
                      {planningLeft !== null && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEventClick(event);
                          }}
                          className={`absolute top-1/2 -translate-y-1/2 h-3.5 rounded-full bg-warning/30 border border-dashed border-warning/70 hover:bg-warning/50 transition-all cursor-pointer ${
                            isSelected ? 'ring-2 ring-warning ring-offset-1 ring-offset-theme-card' : ''
                          }`}
                          style={{ left: planningLeft, width: planningWidth }}
                          title={`${event.title} · Planning phase from ${event.planningStartDate}`}
                        />
                      )}

                      {/* Solid Event Bar */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEventClick(event);
                        }}
                        className={`absolute top-1/2 -translate-y-1/2 h-4 rounded-full ${trackInfo.barGradient} ${
                          isSelected
                            ? 'opacity-100 ring-2 ring-accent ring-offset-2 ring-offset-theme-card shadow-lg scale-y-115'
                            : 'opacity-90 hover:opacity-100 hover:shadow-md'
                        } transition-all shadow-sm cursor-pointer flex items-center overflow-hidden`}
                        style={{ left, width }}
                        title={`${event.title} (${event.startDate} to ${event.endDate}) · ${effective}`}
                      >
                        {width >= 70 && (
                          <span className="text-[9px] font-bold text-white px-2 truncate block drop-shadow-xs">
                            {event.title}
                          </span>
                        )}
                      </button>

                      {/* Diamond Deliverable / Task Checkpoints */}
                      {eventTasks.map((task) => (
                        <Link
                          key={task.id}
                          href={`/dashboard/tasks?highlight=${task.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3 rotate-45 border-2 border-white shadow-md hover:scale-130 transition-transform z-10 ${
                            getTaskLateness(task)
                              ? LATE_MARKER_CLASS
                              : task.status === 'Completed'
                              ? 'bg-success'
                              : task.status === 'Pending Extension'
                              ? 'bg-danger'
                              : 'bg-accent'
                          }`}
                          style={{ left: xFor(task.dueDate) }}
                          title={taskMarkerTitle(task)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Facility & Room Booking Rows */}
              {bookingRows.map(({ booking, left, width, countdown }) => {
                const isSelected = selectedBookingId === booking.id;
                return (
                  <div
                    key={booking.id}
                    onClick={() => handleBookingClick(booking)}
                    className={`flex items-center h-14 border-b border-theme-border/10 group cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-500/10 border-blue-500/30' : 'hover:bg-theme-border/10'
                    }`}
                  >
                    <div
                      className={`sticky left-0 z-10 shrink-0 border-r border-theme-border/20 px-3 py-1.5 transition-all flex flex-col justify-center ${
                        isSelected
                          ? 'bg-blue-500/15 border-l-4 border-l-blue-500'
                          : 'bg-theme-card group-hover:bg-blue-500/5'
                      }`}
                      style={{ width: STICKY_LABEL_WIDTH }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                          {booking.roomName}
                        </span>
                        <span className={`px-1.5 py-0.2 rounded text-[9px] ${countdown.cls}`}>
                          {countdown.label}
                        </span>
                      </div>
                      <span
                        className="text-[11px] font-semibold text-theme-text-primary group-hover:text-blue-400 transition-all truncate block mt-0.5"
                        title={booking.title}
                      >
                        {booking.title}
                      </span>
                      <span className="text-[10px] text-theme-text-secondary truncate flex items-center gap-1 mt-0.5">
                        <DoorOpen className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{booking.organisation || booking.bookedByName}</span>
                      </span>
                    </div>

                    <div className="relative" style={{ width: timelineWidth, height: '100%' }}>
                      {todayOffset >= 0 && todayOffset <= totalDays && (
                        <div
                          className="absolute top-0 h-full border-l border-danger/30 pointer-events-none"
                          style={{ left: todayOffset * dayWidth }}
                        />
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBookingClick(booking);
                        }}
                        className={`absolute top-1/2 -translate-y-1/2 h-4 rounded-full bg-gradient-to-r from-cyan-600 to-blue-600 ${
                          isSelected
                            ? 'opacity-100 ring-2 ring-cyan-400 ring-offset-2 ring-offset-theme-card shadow-lg scale-y-115'
                            : 'opacity-90 hover:opacity-100'
                        } transition-all shadow-sm cursor-pointer flex items-center overflow-hidden`}
                        style={{ left, width }}
                        title={`${booking.roomName}: ${booking.title} (${booking.organisation || booking.bookedByName})`}
                      >
                        {width >= 60 && (
                          <span className="text-[9px] font-bold text-white px-2 truncate block drop-shadow-xs">
                            {booking.roomName}: {booking.title}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Standalone Milestones & Deliverables Row */}
              {standaloneTasks.length > 0 && (
                <div className="flex items-center h-14 border-b border-theme-border/10 group">
                  <div
                    className="sticky left-0 z-10 shrink-0 bg-theme-card group-hover:bg-accent/5 border-r border-theme-border/20 px-3 py-1.5 transition-all flex flex-col justify-center"
                    style={{ width: STICKY_LABEL_WIDTH }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-500/15 text-rose-400 border border-rose-500/30">
                        Milestones
                      </span>
                      <span className="text-[9px] text-theme-text-secondary">
                        {standaloneTasks.length} checkpoints
                      </span>
                    </div>
                    <Link
                      href="/dashboard/tasks"
                      className="text-[11px] font-semibold text-theme-text-secondary hover:text-accent transition-all truncate block mt-0.5"
                    >
                      General TBI Deliverables
                    </Link>
                  </div>
                  <div className="relative" style={{ width: timelineWidth, height: '100%' }}>
                    {todayOffset >= 0 && todayOffset <= totalDays && (
                      <div
                        className="absolute top-0 h-full border-l border-danger/30 pointer-events-none"
                        style={{ left: todayOffset * dayWidth }}
                      />
                    )}
                    {standaloneTasks.map((task) => (
                      <Link
                        key={task.id}
                        href={`/dashboard/tasks?highlight=${task.id}`}
                        className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3 rotate-45 border-2 border-white shadow-md hover:scale-130 transition-transform ${
                          getTaskLateness(task)
                            ? LATE_MARKER_CLASS
                            : task.status === 'Completed'
                            ? 'bg-success'
                            : task.status === 'Pending Extension'
                            ? 'bg-danger'
                            : 'bg-accent'
                        }`}
                        style={{ left: xFor(task.dueDate) }}
                        title={taskMarkerTitle(task)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Bar: Schedule Legend */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
            <span className="text-[11px] text-theme-text-secondary">
              Showing {rowCount} upcoming schedule track{rowCount === 1 ? '' : 's'} across {totalDays} days
            </span>

            <div className="relative">
              <button
                type="button"
                onClick={() => setIsLegendOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <Info className="h-3.5 w-3.5" />
                Schedule Legend
              </button>

              {isLegendOpen && (
                <div className="absolute bottom-7 right-0 z-30 p-3.5 rounded-2xl bg-theme-card border border-theme-border/30 shadow-2xl text-[11px] space-y-2 min-w-[240px] backdrop-blur-md">
                  <p className="font-bold text-theme-text-primary pb-1 border-b border-theme-border/20 flex items-center gap-1.5">
                    <Flag className="h-3.5 w-3.5 text-accent" />
                    TBI Schedule Tracks
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-2.5 rounded-full bg-accent" />
                    <span className="text-theme-text-secondary">TBI Cohort Program</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-2.5 rounded-full bg-blue-500" />
                    <span className="text-theme-text-secondary">Workshop / Training Lab</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-2.5 rounded-full bg-purple-500" />
                    <span className="text-theme-text-secondary">Demo Day / Pitch Review</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-2.5 rounded-full bg-cyan-500" />
                    <span className="text-theme-text-secondary">Facility / Room Booking</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-2.5 rounded-full bg-warning/40 border border-dashed border-warning/70" />
                    <span className="text-theme-text-secondary">Planning &amp; Prep Lead-in</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rotate-45 border-2 border-white bg-accent" />
                    <span className="text-theme-text-secondary">Deliverable / Milestone</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Event Details Modal */}
      {modalEvent && (
        <EventDetailModal event={modalEvent} isOpen={!!modalEvent} onClose={() => setModalEvent(null)} />
      )}
    </div>
  );
}
