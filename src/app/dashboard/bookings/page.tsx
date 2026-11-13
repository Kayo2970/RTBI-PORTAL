'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DoorOpen, Plus, Users, MapPin, Pencil, CalendarClock, IndianRupee, CalendarDays, CheckCircle2 } from 'lucide-react';
import { api, readStoredUser } from '@/lib/billing-client';
import { canManageRooms } from '@/lib/permissions';
import { Room, Booking, rangesOverlap, formatINR, DEFAULT_ROOMS } from '@/lib/billing';
import { Field, Modal, Badge, Banner, Panel, inputCls, btnPrimary, btnGhost, btnDanger, fmtDateTime } from '@/components/billing-ui';

const blankRoom = { name: '', capacity: '8', location: '', amenities: '', hourlyRate: '0', gstPercent: '0' };

function getInitialBookingTime(): { date: string; fromTime: string; toTime: string } {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const end = new Date(d.getTime() + 60 * 60 * 1000);

  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const toTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;

  return { date, fromTime, toTime };
}

export default function BookingsPage() {
  const [user, setUser] = useState<any>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [view, setView] = useState<'mine' | 'all'>('all');

  const [bookingRoom, setBookingRoom] = useState<Room | null>(null);
  const [showNewBookingModal, setShowNewBookingModal] = useState(false);
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
    const rows = bookings.filter(b => (view === 'all' ? true : b.bookedById === user?.id));
    return rows.sort((a, b) => b.start.localeCompare(a.start));
  }, [bookings, view, user]);

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
      const body = { ...v, capacity: Number(v.capacity), hourlyRate: Number(v.hourlyRate), gstPercent: Number(v.gstPercent) };
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

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary flex items-center gap-2">
            <DoorOpen className="h-5 w-5 text-accent" />
            Room Bookings
          </h1>
          <p className="text-xs text-theme-text-secondary">
            Book the <strong>Boardroom</strong> or <strong>Meeting Room</strong> for startup discussions, investor pitches, and team meetings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/calendar" className={btnGhost}>
            <CalendarDays className="h-4 w-4 text-accent" /> View in Calendar
          </Link>
          <button
            className={btnPrimary}
            onClick={() => setShowNewBookingModal(true)}
          >
            <CalendarClock className="h-4 w-4" /> Book a Room
          </button>
        </div>
      </div>

      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

      {/* The Two Dedicated Rooms */}
      <section aria-label="Available Rooms" className="grid gap-5 sm:grid-cols-2">
        {loading && <p className="text-xs text-theme-text-secondary sm:col-span-2">Loading rooms…</p>}
        {rooms.filter(r => r.active || staff).map(r => {
          const isBoardroom = r.name.toLowerCase().includes('board');
          return (
            <Panel key={r.id} className="space-y-4 border border-theme-card-border/70 hover:border-accent/40 transition-all shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className={`p-2.5 rounded-2xl ${isBoardroom ? 'bg-accent/15 text-accent border border-accent/25' : 'bg-sky-500/15 text-sky-400 border border-sky-500/25'}`}>
                    <DoorOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-bold text-base text-theme-text-primary">{r.name}</h2>
                    <p className="text-[11px] text-theme-text-secondary">{r.location || 'RTBI Facility'}</p>
                  </div>
                </div>
                {!r.active && <Badge tone="grey">Inactive</Badge>}
              </div>

              <div className="text-xs text-theme-text-secondary space-y-1.5 pt-1">
                <p className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-theme-text-secondary/80" />
                  <span>Capacity: <strong className="text-theme-text-primary">{r.capacity} people</strong></span>
                </p>
                {r.amenities && (
                  <p className="text-[11px] text-theme-text-secondary/90 leading-relaxed bg-theme-background/30 p-2.5 rounded-xl border border-theme-border/20">
                    {r.amenities}
                  </p>
                )}
                {r.hourlyRate > 0 ? (
                  <p className="flex items-center gap-1 font-semibold text-theme-text-primary pt-1">
                    <IndianRupee className="h-3.5 w-3.5" />
                    {formatINR(r.hourlyRate)}/hr + {r.gstPercent}% GST
                  </p>
                ) : (
                  <p className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1 pt-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Complimentary for Incubated Startups
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-theme-border/20">
                {r.active && (
                  <button
                    className={btnPrimary}
                    onClick={() => {
                      setBookingRoom(r);
                      setShowNewBookingModal(true);
                    }}
                  >
                    <CalendarClock className="h-4 w-4" /> Book {r.name}
                  </button>
                )}
                {staff && (
                  <button
                    className={btnGhost + ' text-xs'}
                    onClick={() => setRoomForm({ id: r.id, v: { name: r.name, capacity: String(r.capacity), location: r.location || '', amenities: r.amenities || '', hourlyRate: String(r.hourlyRate), gstPercent: String(r.gstPercent) } })}
                  >
                    <Pencil className="h-3 w-3" /> Edit Details
                  </button>
                )}
              </div>
            </Panel>
          );
        })}
      </section>

      {/* Bookings Schedule Table */}
      <section aria-label="Bookings List" className="space-y-3">
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
                <th className="p-3 font-semibold">Date & Time</th>
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
              {shown.map(b => {
                const upcoming = new Date(b.end).getTime() > now;
                const isMyBooking = b.bookedById === user?.id;
                const canCancel = b.status === 'Confirmed' && upcoming && (staff || isMyBooking);

                return (
                  <tr key={b.id} className="border-b border-theme-card-border/50 text-theme-text-primary hover:bg-theme-border/10 transition-colors">
                    <td className="p-3 whitespace-nowrap">
                      <span className="font-semibold">{fmtDateTime(b.start)}</span>
                      <br />
                      <span className="text-[11px] text-theme-text-secondary">to {fmtDateTime(b.end)}</span>
                    </td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded-md font-bold text-[11px] ${b.roomName.toLowerCase().includes('board') ? 'bg-accent/15 text-accent border border-accent/25' : 'bg-sky-500/15 text-sky-400 border border-sky-500/25'}`}>
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

      {/* Booking Modal */}
      {showNewBookingModal && (
        <BookingModal
          rooms={rooms}
          initialRoom={bookingRoom || rooms[0]}
          bookings={bookings}
          currentUser={user}
          onClose={() => {
            setShowNewBookingModal(false);
            setBookingRoom(null);
          }}
          onDone={async (text) => {
            setShowNewBookingModal(false);
            setBookingRoom(null);
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
              <input required className={inputCls} value={roomForm.v.name} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, name: e.target.value } })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Capacity *">
                <input required type="number" min="1" className={inputCls} value={roomForm.v.capacity} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, capacity: e.target.value } })} />
              </Field>
              <Field label="Location">
                <input className={inputCls} value={roomForm.v.location} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, location: e.target.value } })} />
              </Field>
              <Field label="Rate per hour (₹)" hint="0 = free">
                <input type="number" min="0" step="any" className={inputCls} value={roomForm.v.hourlyRate} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, hourlyRate: e.target.value } })} />
              </Field>
              <Field label="GST %">
                <input type="number" min="0" max="100" step="any" className={inputCls} value={roomForm.v.gstPercent} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, gstPercent: e.target.value } })} />
              </Field>
            </div>
            <Field label="Amenities">
              <input className={inputCls} placeholder="Projector, whiteboard, video-conferencing" value={roomForm.v.amenities} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, amenities: e.target.value } })} />
            </Field>
            <button className={btnPrimary + ' w-full'} type="submit">Save Room</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function BookingModal({
  rooms,
  initialRoom,
  bookings,
  currentUser,
  onClose,
  onDone,
}: {
  rooms: Room[];
  initialRoom?: Room;
  bookings: Booking[];
  currentUser: any;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [selectedRoomId, setSelectedRoomId] = useState<string>(initialRoom?.id || rooms[0]?.id || 'room_boardroom');
  const initialTimes = useMemo(() => getInitialBookingTime(), []);
  const [date, setDate] = useState(initialTimes.date);
  const [fromTime, setFromTime] = useState(initialTimes.fromTime);
  const [toTime, setToTime] = useState(initialTimes.toTime);
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedRoom = rooms.find(r => r.id === selectedRoomId) || rooms[0];

  // Derive start and end ISO
  const startIso = date && fromTime ? new Date(`${date}T${fromTime}:00`).toISOString() : '';
  const endIso = date && toTime ? new Date(`${date}T${toTime}:00`).toISOString() : '';

  const startMs = startIso ? new Date(startIso).getTime() : 0;
  const endMs = endIso ? new Date(endIso).getTime() : 0;
  const isValidRange = startMs > 0 && endMs > 0 && endMs > startMs;

  // Clashes check on the selected date for this room
  const clashes = useMemo(() => {
    if (!isValidRange || !selectedRoom) return [];
    return bookings.filter(b =>
      b.roomId === selectedRoom.id &&
      b.status === 'Confirmed' &&
      rangesOverlap(b.start, b.end, startIso, endIso)
    );
  }, [isValidRange, selectedRoom, bookings, startIso, endIso]);

  // Existing bookings on this date for the selected room
  const sameDayBookings = useMemo(() => {
    if (!selectedRoom || !date) return [];
    return bookings.filter(b =>
      b.roomId === selectedRoom.id &&
      b.status === 'Confirmed' &&
      b.start.startsWith(date)
    );
  }, [selectedRoom, date, bookings]);

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
    if (!isValidRange) {
      setError('End time must be after the start time.');
      return;
    }
    if (!purpose.trim()) {
      setError('Please type in the purpose of the booking.');
      return;
    }
    if (clashes.length > 0) {
      const c = clashes[0];
      setError(`${selectedRoom.name} is already booked from ${new Date(c.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} to ${new Date(c.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by ${c.organisation || c.bookedByName}.`);
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
        organisation: startupName,
      });

      onDone(`${selectedRoom.name} booked successfully from ${fromTime} to ${toTime} on ${date}.`);
    } catch (err: any) {
      setError(err.message || 'Failed to complete room booking.');
    } finally {
      setBusy(false);
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <Modal title="Book a Room" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Room Selection Toggle */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-theme-text-primary">
            Select Room *
          </label>
          <div className="grid grid-cols-2 gap-3">
            {rooms.map(r => {
              const isSelected = r.id === selectedRoomId;
              const isBoardroom = r.name.toLowerCase().includes('board');
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRoomId(r.id)}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'border-accent bg-accent/15 shadow-sm text-theme-text-primary'
                      : 'border-theme-border/30 bg-theme-background/20 text-theme-text-secondary hover:border-theme-border'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <DoorOpen className={`h-4 w-4 ${isSelected ? 'text-accent' : 'text-theme-text-secondary'}`} />
                    <span className="font-bold text-xs">{r.name}</span>
                  </div>
                  <p className="text-[11px] mt-1 text-theme-text-secondary">
                    {isBoardroom ? 'Seats 14 · Main Hub' : 'Seats 6 · Discussions'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Startup Identity */}
        <div className="p-3 rounded-xl bg-theme-background/30 border border-theme-border/20 text-xs flex items-center justify-between">
          <span className="text-theme-text-secondary">Booking for:</span>
          <span className="font-bold text-theme-text-primary">{startupName}</span>
        </div>

        {/* Date Selection */}
        <Field label="Booking Date *">
          <input
            required
            type="date"
            min={todayStr}
            className={inputCls}
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </Field>

        {/* Time Selection */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From Time *">
            <input
              required
              type="time"
              className={inputCls}
              value={fromTime}
              onChange={e => setFromTime(e.target.value)}
            />
          </Field>
          <Field label="To Time *">
            <input
              required
              type="time"
              className={inputCls}
              value={toTime}
              onChange={e => setToTime(e.target.value)}
            />
          </Field>
        </div>

        {/* Existing bookings notice for that day */}
        {sameDayBookings.length > 0 && (
          <div className="text-[11px] text-theme-text-secondary rounded-xl bg-theme-background/20 border border-theme-border/25 p-3 space-y-1">
            <p className="font-semibold text-theme-text-primary flex items-center gap-1.5">
              <span>Already booked on {date}:</span>
            </p>
            {sameDayBookings.map(b => (
              <p key={b.id} className="text-theme-text-secondary">
                • {new Date(b.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(b.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: <strong className="text-theme-text-primary">{b.organisation || b.bookedByName}</strong> ({b.title})
              </p>
            ))}
          </div>
        )}

        {/* Clashes Banner */}
        {clashes.length > 0 && (
          <Banner kind="error">
            {selectedRoom.name} is already booked during this time by {clashes[0].organisation || clashes[0].bookedByName}. Please choose another time.
          </Banner>
        )}

        {/* Purpose of Booking */}
        <Field label="Purpose of Booking *" hint="Type the purpose of your reservation">
          <textarea
            required
            rows={2}
            className={inputCls}
            value={purpose}
            onChange={e => setPurpose(e.target.value)}
            placeholder="e.g. Investor Pitch Presentation, Core Team Strategy, Client Discussion"
          />
        </Field>

        {error && <Banner kind="error">{error}</Banner>}

        <div className="flex gap-2 pt-2">
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
            disabled={busy || !isValidRange || clashes.length > 0 || !purpose.trim()}
          >
            {busy ? 'Booking…' : `Confirm ${selectedRoom?.name || 'Room'}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
