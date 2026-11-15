'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  DoorOpen,
  Users,
  MapPin,
  Pencil,
  CalendarClock,
  IndianRupee,
  CalendarDays,
  CheckCircle2,
  Clock,
  AlertCircle,
  Check,
  Sparkles,
  ChevronRight,
  Info,
  Calendar as CalendarIcon,
  XCircle,
} from 'lucide-react';
import { api, readStoredUser } from '@/lib/billing-client';
import { canManageRooms } from '@/lib/permissions';
import { Room, Booking, rangesOverlap, formatINR, DEFAULT_ROOMS } from '@/lib/billing';
import {
  Field,
  Modal,
  Badge,
  Banner,
  Panel,
  inputCls,
  btnPrimary,
  btnGhost,
  btnDanger,
  fmtDateTime,
} from '@/components/billing-ui';

const blankRoom = { name: '', capacity: '8', location: '', amenities: '', hourlyRate: '0', gstPercent: '0' };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function getInitialBookingTime(): { date: string; fromTime: string; toTime: string } {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const end = new Date(d.getTime() + 60 * 60 * 1000);

  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const toTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;

  return { date, fromTime, toTime };
}

export function formatTime12(timeStr: string): string {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${pad(m)} ${period}`;
}

export function formatIsoTime12(isoStr: string): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoStr;
  }
}

export function getDurationLabel(fromTime: string, toTime: string): string {
  if (!fromTime || !toTime) return '';
  const [h1, m1] = fromTime.split(':').map(Number);
  const [h2, m2] = toTime.split(':').map(Number);
  if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return '';
  const totalMins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (totalMins <= 0) return '';
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0 && mins > 0) return `${hours} hr ${mins} min`;
  if (hours > 0) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${mins} mins`;
}

export function addMinutesToTime(fromTime: string, minutes: number): string {
  if (!fromTime) return '11:00';
  const [h, m] = fromTime.split(':').map(Number);
  const total = (isNaN(h) ? 9 : h) * 60 + (isNaN(m) ? 0 : m) + minutes;
  const newH = Math.min(23, Math.floor(total / 60));
  const newM = total % 60;
  return `${pad(newH)}:${pad(newM)}`;
}

export function getDateOffset(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateHuman(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export default function BookingsPage() {
  const [user, setUser] = useState<any>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [view, setView] = useState<'mine' | 'all'>('all');

  // Date & Time First slot exploration state
  const initialSlot = useMemo(() => getInitialBookingTime(), []);
  const [slotDate, setSlotDate] = useState(initialSlot.date);
  const [slotFromTime, setSlotFromTime] = useState(initialSlot.fromTime);
  const [slotToTime, setSlotToTime] = useState(initialSlot.toTime);

  // Modal state
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingModalInitial, setBookingModalInitial] = useState<{
    roomId?: string;
    date: string;
    fromTime: string;
    toTime: string;
  } | null>(null);

  const [roomForm, setRoomForm] = useState<{ id?: string; v: typeof blankRoom } | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const staff = canManageRooms(user);

  const load = useCallback(async () => {
    try {
      const [r, b] = await Promise.all([api<Room[]>('/api/rooms'), api<Booking[]>('/api/bookings')]);
      setRooms(r && r.length > 0 ? r : DEFAULT_ROOMS);
      setBookings(b || []);
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUser(readStoredUser());
    load();

    const handleSync = () => load();
    window.addEventListener('rtbi-data-sync', handleSync);
    window.addEventListener('storage', handleSync);
    return () => {
      window.removeEventListener('rtbi-data-sync', handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, [load]);

  const now = Date.now();
  const shown = useMemo(() => {
    const rows = bookings.filter((b) => (view === 'all' ? true : b.bookedById === user?.id));
    return rows.sort((a, b) => b.start.localeCompare(a.start));
  }, [bookings, view, user]);

  // Evaluate room availability on main page based on selected slot
  const slotStartIso = slotDate && slotFromTime ? new Date(`${slotDate}T${slotFromTime}:00`).toISOString() : '';
  const slotEndIso = slotDate && slotToTime ? new Date(`${slotDate}T${slotToTime}:00`).toISOString() : '';
  const isSlotValid =
    slotStartIso &&
    slotEndIso &&
    new Date(slotEndIso).getTime() > new Date(slotStartIso).getTime() &&
    new Date(slotStartIso).getTime() >= Date.now() - 5 * 60_000;

  async function cancel(b: Booking) {
    if (!confirm(`Cancel booking for "${b.roomName}" (${b.title})?`)) return;
    setCancelling(b.id);
    try {
      const r = await api<{ invoiceNote?: string }>(`/api/bookings/${b.id}`, 'PATCH', { action: 'cancel' });
      setMsg({ kind: 'ok', text: 'Booking cancelled.' + (r.invoiceNote ? ' ' + r.invoiceNote : '') });
      window.dispatchEvent(new CustomEvent('rtbi-data-sync'));
      await load();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setCancelling(null);
    }
  }

  async function saveRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!roomForm) return;
    try {
      const v = roomForm.v;
      const body = {
        ...v,
        capacity: Number(v.capacity),
        hourlyRate: Number(v.hourlyRate),
        gstPercent: Number(v.gstPercent),
      };
      if (roomForm.id) await api(`/api/rooms/${roomForm.id}`, 'PATCH', body);
      else await api('/api/rooms', 'POST', body);
      setRoomForm(null);
      setMsg({ kind: 'ok', text: 'Room updated.' });
      window.dispatchEvent(new CustomEvent('rtbi-data-sync'));
      await load();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  }

  const todayStr = useMemo(() => getDateOffset(0), []);
  const tomorrowStr = useMemo(() => getDateOffset(1), []);

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary flex items-center gap-2">
            <DoorOpen className="h-5 w-5 text-accent" />
            Room Bookings
          </h1>
          <p className="text-xs text-theme-text-secondary">
            Select your preferred <strong>Date &amp; Time</strong> first to inspect room availability and book the{' '}
            <strong>Boardroom</strong> or <strong>Meeting Room</strong>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/calendar" className={btnGhost}>
            <CalendarDays className="h-4 w-4 text-accent" /> View in Calendar
          </Link>
          <button
            className={btnPrimary}
            onClick={() => {
              setBookingModalInitial({
                date: slotDate,
                fromTime: slotFromTime,
                toTime: slotToTime,
              });
              setShowBookingModal(true);
            }}
          >
            <CalendarClock className="h-4 w-4" /> Book a Room
          </button>
        </div>
      </div>

      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

      {/* STEP 1: Interactive Date & Time Availability Checker */}
      <section
        aria-label="Find Available Rooms"
        className="glass-panel rounded-3xl p-5 md:p-6 border border-theme-card-border/80 shadow-md space-y-4 bg-gradient-to-br from-theme-card/60 via-theme-card/40 to-theme-card/20"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-theme-border/20 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-accent/15 text-accent border border-accent/20">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-theme-text-primary">
                1. Select Desired Date &amp; Time Slot
              </h2>
              <p className="text-[11px] text-theme-text-secondary">
                Rooms automatically evaluate real-time availability for this exact window
              </p>
            </div>
          </div>

          {/* Quick Date Chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-theme-text-secondary font-medium uppercase tracking-wide mr-1">
              Quick Date:
            </span>
            <button
              type="button"
              onClick={() => setSlotDate(todayStr)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                slotDate === todayStr
                  ? 'bg-accent text-white border-accent shadow-sm'
                  : 'bg-theme-background/30 text-theme-text-secondary border-theme-border/30 hover:border-accent/40'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setSlotDate(tomorrowStr)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                slotDate === tomorrowStr
                  ? 'bg-accent text-white border-accent shadow-sm'
                  : 'bg-theme-background/30 text-theme-text-secondary border-theme-border/30 hover:border-accent/40'
              }`}
            >
              Tomorrow
            </button>
          </div>
        </div>

        {/* Date and Time Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div>
            <label className="block text-[11px] font-semibold text-theme-text-secondary mb-1">
              Date
            </label>
            <input
              type="date"
              min={todayStr}
              value={slotDate}
              onChange={(e) => setSlotDate(e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-theme-text-secondary mb-1">
              Start Time
            </label>
            <input
              type="time"
              value={slotFromTime}
              onChange={(e) => {
                const newFrom = e.target.value;
                setSlotFromTime(newFrom);
                // If end time is before or equal to start time, advance it by 1 hour
                if (slotToTime && newFrom >= slotToTime) {
                  setSlotToTime(addMinutesToTime(newFrom, 60));
                }
              }}
              className={inputCls}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-theme-text-secondary">
                End Time
              </label>
              {/* Duration presets */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSlotToTime(addMinutesToTime(slotFromTime, 30))}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-theme-background/40 hover:bg-theme-border/40 text-theme-text-secondary font-medium transition-colors"
                >
                  +30m
                </button>
                <button
                  type="button"
                  onClick={() => setSlotToTime(addMinutesToTime(slotFromTime, 60))}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-theme-background/40 hover:bg-theme-border/40 text-theme-text-secondary font-medium transition-colors"
                >
                  +1h
                </button>
                <button
                  type="button"
                  onClick={() => setSlotToTime(addMinutesToTime(slotFromTime, 120))}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-theme-background/40 hover:bg-theme-border/40 text-theme-text-secondary font-medium transition-colors"
                >
                  +2h
                </button>
              </div>
            </div>
            <input
              type="time"
              value={slotToTime}
              onChange={(e) => setSlotToTime(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Selected Slot Confirmation Summary Pill */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-theme-background/25 border border-theme-border/20 text-xs">
          <div className="flex items-center gap-2 text-theme-text-primary">
            <Sparkles className="h-4 w-4 text-accent shrink-0" />
            <span>
              Checking availability for:{' '}
              <strong className="text-theme-text-primary">{formatDateHuman(slotDate)}</strong> from{' '}
              <strong className="text-theme-text-primary">{formatTime12(slotFromTime)}</strong> to{' '}
              <strong className="text-theme-text-primary">{formatTime12(slotToTime)}</strong>
              {getDurationLabel(slotFromTime, slotToTime) && (
                <span className="text-theme-text-secondary ml-1 font-medium">
                  ({getDurationLabel(slotFromTime, slotToTime)})
                </span>
              )}
            </span>
          </div>

          {!isSlotValid && (
            <span className="text-amber-400 font-semibold flex items-center gap-1 text-[11px]">
              <AlertCircle className="h-3.5 w-3.5" /> Please pick a valid future time slot
            </span>
          )}
        </div>
      </section>

      {/* STEP 2: Live Room Availability Cards for the Chosen Slot */}
      <section aria-label="Available Rooms for Chosen Slot" className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-theme-text-primary flex items-center gap-2">
              <DoorOpen className="h-4 w-4 text-accent" />
              2. Inspect &amp; Select an Available Room
            </h2>
            <p className="text-[11px] text-theme-text-secondary">
              Rooms with conflicts are highlighted in red; available rooms can be booked instantly.
            </p>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {loading && <p className="text-xs text-theme-text-secondary sm:col-span-2">Loading rooms…</p>}

          {rooms
            .filter((r) => r.active || staff)
            .map((r) => {
              const isBoardroom = r.name.toLowerCase().includes('board');

              // Check if room has clash during this slot
              const clashingBookings = isSlotValid
                ? bookings.filter(
                    (b) =>
                      b.roomId === r.id &&
                      b.status === 'Confirmed' &&
                      rangesOverlap(b.start, b.end, slotStartIso, slotEndIso)
                  )
                : [];
              const isAvailable = isSlotValid && clashingBookings.length === 0;
              const clash = clashingBookings[0];

              return (
                <Panel
                  key={r.id}
                  className={`space-y-4 border transition-all shadow-sm ${
                    isAvailable
                      ? 'border-emerald-500/40 hover:border-emerald-500/70 bg-emerald-500/[0.03]'
                      : isSlotValid
                      ? 'border-red-500/30 bg-red-500/[0.02]'
                      : 'border-theme-card-border/70 hover:border-accent/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`p-2.5 rounded-2xl ${
                          isBoardroom
                            ? 'bg-accent/15 text-accent border border-accent/25'
                            : 'bg-sky-500/15 text-sky-400 border border-sky-500/25'
                        }`}
                      >
                        <DoorOpen className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-base text-theme-text-primary">{r.name}</h3>
                        <p className="text-[11px] text-theme-text-secondary">{r.location || 'RTBI Facility'}</p>
                      </div>
                    </div>

                    {/* Availability Status Badge */}
                    {!r.active ? (
                      <Badge tone="grey">Inactive</Badge>
                    ) : isAvailable ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm animate-in fade-in">
                        <Check className="h-3.5 w-3.5" /> Available Now
                      </span>
                    ) : isSlotValid ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-500/15 text-red-400 border border-red-500/30">
                        <XCircle className="h-3.5 w-3.5" /> Booked / Occupied
                      </span>
                    ) : (
                      <Badge tone="grey">Select valid slot</Badge>
                    )}
                  </div>

                  {/* Room details */}
                  <div className="text-xs text-theme-text-secondary space-y-2 pt-1">
                    <p className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-theme-text-secondary/80" />
                      <span>
                        Capacity: <strong className="text-theme-text-primary">{r.capacity} people</strong>
                      </span>
                    </p>
                    {r.amenities && (
                      <p className="text-[11px] text-theme-text-secondary/90 leading-relaxed bg-theme-background/30 p-2.5 rounded-xl border border-theme-border/20">
                        {r.amenities}
                      </p>
                    )}
                    {r.hourlyRate > 0 ? (
                      <p className="flex items-center gap-1 font-semibold text-theme-text-primary pt-0.5">
                        <IndianRupee className="h-3.5 w-3.5" />
                        {formatINR(r.hourlyRate)}/hr + {r.gstPercent}% GST
                      </p>
                    ) : (
                      <p className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1 pt-0.5">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Complimentary for Incubated Startups
                      </p>
                    )}
                  </div>

                  {/* Conflict Notice if booked */}
                  {!isAvailable && clash && (
                    <div className="text-[11px] p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 space-y-0.5">
                      <p className="font-semibold flex items-center gap-1">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        Reserved by {clash.organisation || clash.bookedByName}
                      </p>
                      <p className="text-[10px] text-red-300/80">
                        {formatIsoTime12(clash.start)} – {formatIsoTime12(clash.end)}: &quot;{clash.title}&quot;
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-theme-border/20">
                    {r.active && (
                      <button
                        className={isAvailable ? btnPrimary : btnGhost}
                        onClick={() => {
                          setBookingModalInitial({
                            roomId: r.id,
                            date: slotDate,
                            fromTime: slotFromTime,
                            toTime: slotToTime,
                          });
                          setShowBookingModal(true);
                        }}
                      >
                        <CalendarClock className="h-4 w-4" />
                        {isAvailable ? `Book ${r.name} for this Slot` : `Change Time to Book`}
                      </button>
                    )}

                    {staff && (
                      <button
                        className={btnGhost + ' text-xs'}
                        onClick={() =>
                          setRoomForm({
                            id: r.id,
                            v: {
                              name: r.name,
                              capacity: String(r.capacity),
                              location: r.location || '',
                              amenities: r.amenities || '',
                              hourlyRate: String(r.hourlyRate),
                              gstPercent: String(r.gstPercent),
                            },
                          })
                        }
                      >
                        <Pencil className="h-3 w-3" /> Edit Details
                      </button>
                    )}
                  </div>
                </Panel>
              );
            })}
        </div>
      </section>

      {/* Bookings Schedule Table */}
      <section aria-label="Bookings List" className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-theme-text-primary">
              {view === 'all' ? 'All Scheduled Bookings' : 'My Bookings'}
            </h2>
            <p className="text-[11px] text-theme-text-secondary">
              See which startup is using each room and when.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className={btnGhost + (view === 'all' ? ' bg-theme-border/30 text-theme-text-primary' : '')}
              onClick={() => setView('all')}
            >
              All Startups
            </button>
            <button
              className={btnGhost + (view === 'mine' ? ' bg-theme-border/30 text-theme-text-primary' : '')}
              onClick={() => setView('mine')}
            >
              My Bookings
            </button>
          </div>
        </div>

        <Panel className="!p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-theme-text-secondary border-b border-theme-card-border bg-theme-background/20">
                <th className="p-3 font-semibold">Date &amp; Time</th>
                <th className="p-3 font-semibold">Room</th>
                <th className="p-3 font-semibold">Purpose</th>
                <th className="p-3 font-semibold">Startup / Booker</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold text-right" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-theme-text-secondary">
                    No bookings scheduled yet. Click <strong>Book a Room</strong> above to reserve a time slot.
                  </td>
                </tr>
              )}
              {shown.map((b) => {
                const upcoming = new Date(b.end).getTime() > now;
                const isMyBooking = b.bookedById === user?.id;
                const canCancel = b.status === 'Confirmed' && upcoming && (staff || isMyBooking);

                return (
                  <tr
                    key={b.id}
                    className="border-b border-theme-card-border/50 text-theme-text-primary hover:bg-theme-border/10 transition-colors"
                  >
                    <td className="p-3 whitespace-nowrap">
                      <span className="font-semibold">{fmtDateTime(b.start)}</span>
                      <br />
                      <span className="text-[11px] text-theme-text-secondary">to {fmtDateTime(b.end)}</span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md font-bold text-[11px] ${
                          b.roomName.toLowerCase().includes('board')
                            ? 'bg-accent/15 text-accent border border-accent/25'
                            : 'bg-sky-500/15 text-sky-400 border border-sky-500/25'
                        }`}
                      >
                        {b.roomName}
                      </span>
                    </td>
                    <td className="p-3">
                      <p className="font-medium text-theme-text-primary max-w-xs">{b.title}</p>
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-theme-text-primary">
                        {b.organisation || b.bookedByName}
                      </div>
                      {b.organisation && b.bookedByName && b.organisation !== b.bookedByName && (
                        <div className="text-[11px] text-theme-text-secondary">({b.bookedByName})</div>
                      )}
                    </td>
                    <td className="p-3">
                      {b.status === 'Cancelled' ? (
                        <Badge tone="red">Cancelled</Badge>
                      ) : upcoming ? (
                        <Badge tone="green">In Use / Confirmed</Badge>
                      ) : (
                        <Badge tone="grey">Completed</Badge>
                      )}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {canCancel && (
                        <button
                          className={btnDanger + ' text-xs py-1 px-2.5'}
                          disabled={cancelling === b.id}
                          onClick={() => cancel(b)}
                        >
                          {cancelling === b.id ? 'Cancelling…' : 'Cancel'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </section>

      {/* Date & Time First Room Booking Modal */}
      {showBookingModal && (
        <BookingModal
          rooms={rooms}
          initialRoomId={bookingModalInitial?.roomId}
          initialDate={bookingModalInitial?.date}
          initialFromTime={bookingModalInitial?.fromTime}
          initialToTime={bookingModalInitial?.toTime}
          bookings={bookings}
          currentUser={user}
          onClose={() => {
            setShowBookingModal(false);
            setBookingModalInitial(null);
          }}
          onDone={async (text) => {
            setShowBookingModal(false);
            setBookingModalInitial(null);
            setMsg({ kind: 'ok', text });
            window.dispatchEvent(new CustomEvent('rtbi-data-sync'));
            await load();
          }}
        />
      )}

      {/* Staff Room Edit Modal */}
      {roomForm && (
        <Modal title={roomForm.id ? 'Edit Room' : 'Add Room'} onClose={() => setRoomForm(null)}>
          <form onSubmit={saveRoom} className="space-y-4">
            <Field label="Room name *">
              <input
                required
                className={inputCls}
                value={roomForm.v.name}
                onChange={(e) => setRoomForm({ ...roomForm, v: { ...roomForm.v, name: e.target.value } })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Capacity *">
                <input
                  required
                  type="number"
                  min="1"
                  className={inputCls}
                  value={roomForm.v.capacity}
                  onChange={(e) => setRoomForm({ ...roomForm, v: { ...roomForm.v, capacity: e.target.value } })}
                />
              </Field>
              <Field label="Location">
                <input
                  className={inputCls}
                  value={roomForm.v.location}
                  onChange={(e) => setRoomForm({ ...roomForm, v: { ...roomForm.v, location: e.target.value } })}
                />
              </Field>
              <Field label="Rate per hour (₹)" hint="0 = free">
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={inputCls}
                  value={roomForm.v.hourlyRate}
                  onChange={(e) => setRoomForm({ ...roomForm, v: { ...roomForm.v, hourlyRate: e.target.value } })}
                />
              </Field>
              <Field label="GST %">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  className={inputCls}
                  value={roomForm.v.gstPercent}
                  onChange={(e) => setRoomForm({ ...roomForm, v: { ...roomForm.v, gstPercent: e.target.value } })}
                />
              </Field>
            </div>
            <Field label="Amenities">
              <input
                className={inputCls}
                placeholder="Projector, whiteboard, video-conferencing"
                value={roomForm.v.amenities}
                onChange={(e) => setRoomForm({ ...roomForm, v: { ...roomForm.v, amenities: e.target.value } })}
              />
            </Field>
            <button className={btnPrimary + ' w-full'} type="submit">
              Save Room
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------------
// Date & Time First Booking Modal
// --------------------------------------------------------------------------------

interface BookingModalProps {
  rooms: Room[];
  initialRoomId?: string;
  initialDate?: string;
  initialFromTime?: string;
  initialToTime?: string;
  bookings: Booking[];
  currentUser: any;
  onClose: () => void;
  onDone: (msg: string) => void;
}

const PURPOSE_SUGGESTIONS = [
  'Client Discussion',
  'Investor Pitch',
  'Team Standup',
  'Mentor Clinic',
  'Strategy Session',
  'Product Demo',
];

function BookingModal({
  rooms,
  initialRoomId,
  initialDate,
  initialFromTime,
  initialToTime,
  bookings,
  currentUser,
  onClose,
  onDone,
}: BookingModalProps) {
  const fallback = useMemo(() => getInitialBookingTime(), []);
  const [date, setDate] = useState(initialDate || fallback.date);
  const [fromTime, setFromTime] = useState(initialFromTime || fallback.fromTime);
  const [toTime, setToTime] = useState(initialToTime || fallback.toTime);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId || null);

  const [purpose, setPurpose] = useState('');
  const [attendees, setAttendees] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showScheduleDetails, setShowScheduleDetails] = useState(false);

  // Time & Range Validation
  const todayStr = useMemo(() => getDateOffset(0), []);
  const tomorrowStr = useMemo(() => getDateOffset(1), []);

  const startIso = date && fromTime ? new Date(`${date}T${fromTime}:00`).toISOString() : '';
  const endIso = date && toTime ? new Date(`${date}T${toTime}:00`).toISOString() : '';

  const startMs = startIso ? new Date(startIso).getTime() : 0;
  const endMs = endIso ? new Date(endIso).getTime() : 0;
  const isPast = startMs > 0 && startMs < Date.now() - 5 * 60_000;
  const isValidRange = startMs > 0 && endMs > 0 && endMs > startMs && !isPast;

  // Active rooms
  const activeRooms = useMemo(() => rooms.filter((r) => r.active), [rooms]);

  // Compute room availability map for this exact date & time window
  const roomAvailability = useMemo(() => {
    return activeRooms.map((r) => {
      if (!isValidRange) {
        return { room: r, isAvailable: false, clash: null, reason: 'Invalid or past time' };
      }
      const clashing = bookings.filter(
        (b) =>
          b.roomId === r.id &&
          b.status === 'Confirmed' &&
          rangesOverlap(b.start, b.end, startIso, endIso)
      );
      return {
        room: r,
        isAvailable: clashing.length === 0,
        clash: clashing[0] || null,
        reason: clashing.length > 0 ? 'Occupied during this slot' : 'Available',
      };
    });
  }, [activeRooms, isValidRange, bookings, startIso, endIso]);

  // If a room was pre-selected but is occupied in the new time window, handle gracefully
  useEffect(() => {
    if (!selectedRoomId) {
      // Auto-select the first available room if none selected
      const firstAvailable = roomAvailability.find((a) => a.isAvailable);
      if (firstAvailable) {
        setSelectedRoomId(firstAvailable.room.id);
      }
    } else {
      const current = roomAvailability.find((a) => a.room.id === selectedRoomId);
      if (current && !current.isAvailable) {
        // If current room is booked, see if another room is free
        const alternate = roomAvailability.find((a) => a.isAvailable);
        if (alternate) {
          setSelectedRoomId(alternate.room.id);
        }
      }
    }
  }, [roomAvailability, selectedRoomId]);

  const selectedRoomEntry = roomAvailability.find((a) => a.room.id === selectedRoomId);
  const selectedRoom = selectedRoomEntry?.room;
  const isSelectedRoomAvailable = selectedRoomEntry?.isAvailable || false;

  // Existing bookings on this date (across all rooms) for schedule glance
  const dayBookings = useMemo(() => {
    if (!date) return [];
    return bookings
      .filter((b) => b.status === 'Confirmed' && b.start.startsWith(date))
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [bookings, date]);

  const startupName =
    currentUser?.startupProfile?.startupName ||
    currentUser?.organisation ||
    currentUser?.companyName ||
    currentUser?.name ||
    'Incubated Startup';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!date) {
      setError('Please select a date.');
      return;
    }
    if (!fromTime || !toTime) {
      setError('Please select the start and end time.');
      return;
    }
    if (isPast) {
      setError('Cannot book a time slot in the past. Please choose a future time.');
      return;
    }
    if (!isValidRange) {
      setError('End time must be after the start time.');
      return;
    }
    if (!selectedRoom) {
      setError('Please select an available room.');
      return;
    }
    if (!isSelectedRoomAvailable) {
      setError(
        `${selectedRoom.name} is occupied during this time. Please select an available room or change your time slot.`
      );
      return;
    }
    if (!purpose.trim()) {
      setError('Please enter the purpose of the booking.');
      return;
    }
    if (attendees && Number(attendees) > selectedRoom.capacity) {
      setError(`${selectedRoom.name} maximum capacity is ${selectedRoom.capacity} people.`);
      return;
    }

    setBusy(true);
    try {
      await api<Booking>('/api/bookings', 'POST', {
        roomId: selectedRoom.id,
        start: startIso,
        end: endIso,
        purpose: purpose.trim(),
        title: purpose.trim(),
        attendees: attendees ? Number(attendees) : undefined,
        organisation: startupName,
      });

      onDone(
        `${selectedRoom.name} booked successfully for ${formatDateHuman(date)} from ${formatTime12(
          fromTime
        )} to ${formatTime12(toTime)}.`
      );
    } catch (err: any) {
      setError(err.message || 'Failed to complete room booking.');
    } finally {
      setBusy(false);
    }
  }

  const durationStr = getDurationLabel(fromTime, toTime);

  return (
    <Modal title="Book a Room" wide={true} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Step Indicator Header */}
        <div className="flex items-center gap-2 text-xs font-semibold text-theme-text-secondary border-b border-theme-border/20 pb-3">
          <span className="flex items-center gap-1.5 text-accent font-bold">
            <span className="h-5 w-5 rounded-full bg-accent text-white flex items-center justify-center text-[10px]">
              1
            </span>
            Pick Date &amp; Time
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-theme-text-secondary/50" />
          <span
            className={`flex items-center gap-1.5 font-bold ${
              selectedRoom ? 'text-accent' : 'text-theme-text-secondary'
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] ${
                selectedRoom ? 'bg-accent text-white' : 'bg-theme-border/50 text-theme-text-secondary'
              }`}
            >
              2
            </span>
            Select Available Room
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-theme-text-secondary/50" />
          <span
            className={`flex items-center gap-1.5 font-bold ${
              purpose.trim() ? 'text-accent' : 'text-theme-text-secondary'
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] ${
                purpose.trim() ? 'bg-accent text-white' : 'bg-theme-border/50 text-theme-text-secondary'
              }`}
            >
              3
            </span>
            Confirm Booking
          </span>
        </div>

        {/* =========================================================================
            STEP 1: DATE & TIME FIRST
        ========================================================================= */}
        <div className="space-y-3 p-4 rounded-2xl bg-theme-background/30 border border-theme-border/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-accent" />
              <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wide">
                Step 1: Choose Meeting Date &amp; Time
              </h3>
            </div>
            {/* Quick date chips */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDate(todayStr)}
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                  date === todayStr
                    ? 'bg-accent text-white border-accent'
                    : 'bg-theme-background/40 text-theme-text-secondary border-theme-border/30 hover:border-accent/40'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setDate(tomorrowStr)}
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                  date === tomorrowStr
                    ? 'bg-accent text-white border-accent'
                    : 'bg-theme-background/40 text-theme-text-secondary border-theme-border/30 hover:border-accent/40'
                }`}
              >
                Tomorrow
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-theme-text-secondary mb-1">
                Booking Date *
              </label>
              <input
                required
                type="date"
                min={todayStr}
                className={inputCls}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-theme-text-secondary mb-1">
                From Time *
              </label>
              <input
                required
                type="time"
                className={inputCls}
                value={fromTime}
                onChange={(e) => {
                  const newFrom = e.target.value;
                  setFromTime(newFrom);
                  if (toTime && newFrom >= toTime) {
                    setToTime(addMinutesToTime(newFrom, 60));
                  }
                }}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-theme-text-secondary">
                  To Time *
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setToTime(addMinutesToTime(fromTime, 30))}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-theme-background/50 hover:bg-theme-border/50 text-theme-text-secondary font-medium transition-colors"
                  >
                    +30m
                  </button>
                  <button
                    type="button"
                    onClick={() => setToTime(addMinutesToTime(fromTime, 60))}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-theme-background/50 hover:bg-theme-border/50 text-theme-text-secondary font-medium transition-colors"
                  >
                    +1h
                  </button>
                  <button
                    type="button"
                    onClick={() => setToTime(addMinutesToTime(fromTime, 90))}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-theme-background/50 hover:bg-theme-border/50 text-theme-text-secondary font-medium transition-colors"
                  >
                    +1.5h
                  </button>
                </div>
              </div>
              <input
                required
                type="time"
                className={inputCls}
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
              />
            </div>
          </div>

          {/* Validation Feedback */}
          {isPast && (
            <p className="text-[11px] text-red-400 flex items-center gap-1 font-medium">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              The selected time has already passed today. Please select a future time slot.
            </p>
          )}
          {!isPast && !isValidRange && fromTime && toTime && (
            <p className="text-[11px] text-amber-400 flex items-center gap-1 font-medium">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              End time must be after the start time.
            </p>
          )}

          {isValidRange && (
            <div className="text-[11px] text-theme-text-secondary flex items-center justify-between pt-1">
              <span className="flex items-center gap-1.5 text-theme-text-primary">
                <Clock className="h-3.5 w-3.5 text-accent" />
                Slot: <strong>{formatDateHuman(date)}</strong> · {formatTime12(fromTime)} to{' '}
                {formatTime12(toTime)}
              </span>
              {durationStr && (
                <span className="px-2 py-0.5 rounded-md bg-accent/15 text-accent font-bold">
                  {durationStr}
                </span>
              )}
            </div>
          )}
        </div>

        {/* =========================================================================
            STEP 2: SEE WHAT IS AVAILABLE (ROOM AVAILABILITY)
        ========================================================================= */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wide flex items-center gap-2">
              <DoorOpen className="h-4 w-4 text-accent" />
              Step 2: What is Available for this Slot?
            </h3>
            {dayBookings.length > 0 && (
              <button
                type="button"
                onClick={() => setShowScheduleDetails((v) => !v)}
                className="text-[11px] text-accent hover:underline flex items-center gap-1 font-semibold cursor-pointer"
              >
                <Info className="h-3 w-3" />
                {showScheduleDetails ? 'Hide Day Schedule' : `View ${dayBookings.length} Bookings on ${date}`}
              </button>
            )}
          </div>

          {/* Expandable Day Schedule to see all occupied slots for the date */}
          {showScheduleDetails && dayBookings.length > 0 && (
            <div className="p-3 rounded-2xl bg-theme-background/40 border border-theme-border/30 text-xs space-y-1.5 animate-in fade-in">
              <p className="font-bold text-theme-text-primary text-[11px] flex items-center gap-1.5 pb-1 border-b border-theme-border/20">
                <CalendarDays className="h-3.5 w-3.5 text-accent" />
                All Reservations on {formatDateHuman(date)}:
              </p>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {dayBookings.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between text-[11px] py-1 border-b border-theme-border/10 last:border-0"
                  >
                    <span className="font-semibold text-theme-text-primary">
                      {formatIsoTime12(b.start)} – {formatIsoTime12(b.end)}: {b.roomName}
                    </span>
                    <span className="text-theme-text-secondary">
                      {b.organisation || b.bookedByName} ({b.title})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Room Selection Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {roomAvailability.map(({ room: r, isAvailable, clash }) => {
              const isSelected = selectedRoomId === r.id;
              const isBoardroom = r.name.toLowerCase().includes('board');

              return (
                <div
                  key={r.id}
                  onClick={() => {
                    if (isAvailable) {
                      setSelectedRoomId(r.id);
                      setError('');
                    }
                  }}
                  className={`p-4 rounded-2xl border transition-all text-left relative flex flex-col justify-between ${
                    isAvailable
                      ? isSelected
                        ? 'border-accent bg-accent/15 ring-2 ring-accent/30 shadow-md cursor-pointer'
                        : 'border-emerald-500/30 bg-emerald-500/[0.04] hover:border-emerald-500/70 hover:bg-emerald-500/[0.08] cursor-pointer'
                      : 'border-red-500/30 bg-red-500/[0.03] opacity-80 cursor-not-allowed'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`p-2 rounded-xl ${
                            isBoardroom
                              ? 'bg-accent/15 text-accent border border-accent/25'
                              : 'bg-sky-500/15 text-sky-400 border border-sky-500/25'
                          }`}
                        >
                          <DoorOpen className="h-4 w-4" />
                        </div>
                        <div>
                          <h4 className="font-bold text-xs text-theme-text-primary">{r.name}</h4>
                          <p className="text-[10px] text-theme-text-secondary">
                            Seats {r.capacity} · {r.location || 'RTBI Hub'}
                          </p>
                        </div>
                      </div>

                      {/* Status Tag */}
                      {isAvailable ? (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                            isSelected
                              ? 'bg-accent text-white border-accent'
                              : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          }`}
                        >
                          <Check className="h-3 w-3" />
                          {isSelected ? 'Selected' : 'Available'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-red-500/15 text-red-400 border-red-500/30 flex items-center gap-1">
                          <XCircle className="h-3 w-3" />
                          Occupied
                        </span>
                      )}
                    </div>

                    {r.amenities && (
                      <p className="text-[10px] text-theme-text-secondary leading-relaxed bg-theme-background/30 p-2 rounded-lg border border-theme-border/20 line-clamp-2">
                        {r.amenities}
                      </p>
                    )}

                    {r.hourlyRate > 0 ? (
                      <p className="text-[11px] font-semibold text-theme-text-primary">
                        {formatINR(r.hourlyRate)}/hr + {r.gstPercent}% GST
                      </p>
                    ) : (
                      <p className="text-[10px] font-semibold text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Complimentary for Incubated Startups
                      </p>
                    )}
                  </div>

                  {/* Conflict Notice if room is booked */}
                  {!isAvailable && clash && (
                    <div className="mt-3 pt-2 border-t border-red-500/20 text-[10px] text-red-300 space-y-0.5">
                      <p className="font-semibold">
                        Reserved by {clash.organisation || clash.bookedByName}
                      </p>
                      <p className="text-red-300/80">
                        {formatIsoTime12(clash.start)} – {formatIsoTime12(clash.end)}: &quot;{clash.title}&quot;
                      </p>
                    </div>
                  )}

                  {isAvailable && (
                    <div className="mt-3 pt-2 border-t border-theme-border/20 text-[11px] flex items-center justify-between font-semibold">
                      <span className={isSelected ? 'text-accent' : 'text-theme-text-secondary'}>
                        {isSelected ? '✓ Ready to book' : 'Click to select this room'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* If all rooms are occupied for this slot */}
          {isValidRange && roomAvailability.every((a) => !a.isAvailable) && (
            <Banner kind="error">
              Both the Boardroom and Meeting Room are occupied during this time window. Please pick an
              earlier or later time slot above.
            </Banner>
          )}
        </div>

        {/* =========================================================================
            STEP 3: PURPOSE & DETAILS (ENABLED ONCE AVAILABLE ROOM SELECTED)
        ========================================================================= */}
        {selectedRoom && isSelectedRoomAvailable && (
          <div className="space-y-3 p-4 rounded-2xl bg-theme-background/30 border border-theme-border/30 animate-in fade-in">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wide flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                Step 3: Purpose &amp; Attendee Details
              </h3>
              <span className="text-[11px] text-theme-text-secondary font-medium">
                Booking for: <strong className="text-theme-text-primary">{startupName}</strong>
              </span>
            </div>

            {/* Purpose input with quick suggestion chips */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-theme-text-secondary">
                  Purpose of Booking *
                </label>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-theme-text-secondary mr-1">Suggestions:</span>
                  {PURPOSE_SUGGESTIONS.slice(0, 3).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setPurpose(s)}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-theme-background/60 hover:bg-theme-border/40 text-theme-text-secondary hover:text-theme-text-primary border border-theme-border/30 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <input
                required
                type="text"
                className={inputCls}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Investor Pitch Presentation, Core Team Strategy, Client Discussion"
              />
            </div>

            {/* Expected Attendees */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-semibold text-theme-text-secondary mb-1">
                  Expected Attendees (Max {selectedRoom.capacity})
                </label>
                <input
                  type="number"
                  min="1"
                  max={selectedRoom.capacity}
                  className={inputCls}
                  placeholder={`1 to ${selectedRoom.capacity}`}
                  value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-theme-text-secondary mb-1">
                  Startup / Organization
                </label>
                <div className="px-4 py-2.5 bg-theme-background/20 border border-theme-card-border/50 rounded-xl text-theme-text-primary text-xs font-semibold">
                  {startupName}
                </div>
              </div>
            </div>
          </div>
        )}

        {error && <Banner kind="error">{error}</Banner>}

        {/* Modal Actions */}
        <div className="flex gap-2 pt-2 border-t border-theme-border/20">
          <button
            type="button"
            className={btnGhost + ' w-1/3'}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={btnPrimary + ' w-2/3'}
            disabled={
              busy ||
              !isValidRange ||
              !selectedRoom ||
              !isSelectedRoomAvailable ||
              !purpose.trim()
            }
          >
            {busy
              ? 'Confirming Booking…'
              : selectedRoom && isSelectedRoomAvailable
              ? `Confirm Booking for ${selectedRoom.name}`
              : 'Select Available Room to Continue'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
