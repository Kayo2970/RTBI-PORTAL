'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DoorOpen, Plus, Users, MapPin, Pencil, CalendarClock, IndianRupee } from 'lucide-react';
import { api, readStoredUser } from '@/lib/billing-client';
import { canManageRooms } from '@/lib/permissions';
import { Room, Booking, billableHours, rangesOverlap, formatINR } from '@/lib/billing';
import { Field, Modal, Badge, Banner, Panel, inputCls, btnPrimary, btnGhost, btnDanger, toLocalInput, fmtDateTime } from '@/components/billing-ui';

const blankRoom = { name: '', capacity: '8', location: '', amenities: '', hourlyRate: '0', gstPercent: '18' };

function defaultStart(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export default function BookingsPage() {
  const [user, setUser] = useState<any>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [view, setView] = useState<'mine' | 'all'>('mine');

  const [bookingRoom, setBookingRoom] = useState<Room | null>(null);
  const [roomForm, setRoomForm] = useState<{ id?: string; v: typeof blankRoom } | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const staff = canManageRooms(user);

  const load = useCallback(async () => {
    try {
      const [r, b] = await Promise.all([api<Room[]>('/api/rooms'), api<Booking[]>('/api/bookings')]);
      setRooms(r);
      setBookings(b);
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUser(readStoredUser());
    load();
  }, [load]);

  const now = Date.now();
  const shown = useMemo(() => {
    const rows = bookings.filter(b => (view === 'all' && staff ? true : b.bookedById === user?.id));
    return rows.sort((a, b) => b.start.localeCompare(a.start));
  }, [bookings, view, staff, user]);

  async function cancel(b: Booking) {
    if (!confirm(`Cancel "${b.title}" in ${b.roomName}?`)) return;
    setCancelling(b.id);
    try {
      const r = await api<{ invoiceNote?: string }>(`/api/bookings/${b.id}`, 'PATCH', { action: 'cancel' });
      setMsg({ kind: 'ok', text: 'Booking cancelled.' + (r.invoiceNote ? ' ' + r.invoiceNote : '') });
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
      setMsg({ kind: 'ok', text: 'Boardroom saved.' });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  }

  async function toggleRoom(r: Room) {
    try {
      await api(`/api/rooms/${r.id}`, 'PATCH', { active: !r.active });
      await load();
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary">Boardroom Bookings</h1>
          <p className="text-xs text-theme-text-secondary">Reserve a boardroom by the hour. Paid rooms generate an invoice automatically.</p>
        </div>
        {staff && (
          <button className={btnPrimary} onClick={() => setRoomForm({ v: blankRoom })}>
            <Plus className="h-4 w-4" /> Add boardroom
          </button>
        )}
      </div>

      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

      <section aria-label="Boardrooms" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {loading && <p className="text-xs text-theme-text-secondary">Loading…</p>}
        {!loading && rooms.length === 0 && (
          <Panel className="sm:col-span-2 xl:col-span-3 text-center text-xs text-theme-text-secondary">
            No boardrooms yet.{staff ? ' Use “Add boardroom” to create the first one.' : ' Ask an administrator to add one.'}
          </Panel>
        )}
        {rooms.filter(r => r.active || staff).map(r => (
          <Panel key={r.id} className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <DoorOpen className="h-5 w-5 text-accent" />
                <h2 className="font-bold text-sm text-theme-text-primary">{r.name}</h2>
              </div>
              {!r.active && <Badge tone="grey">Inactive</Badge>}
            </div>
            <div className="text-xs text-theme-text-secondary space-y-1">
              <p className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Seats {r.capacity}</p>
              {r.location && <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {r.location}</p>}
              {r.amenities && <p>{r.amenities}</p>}
              <p className="flex items-center gap-1.5 font-semibold text-theme-text-primary">
                <IndianRupee className="h-3.5 w-3.5" />
                {r.hourlyRate > 0 ? `${formatINR(r.hourlyRate)}/hr + ${r.gstPercent}% GST` : 'Free'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {r.active && <button className={btnPrimary} onClick={() => setBookingRoom(r)}><CalendarClock className="h-4 w-4" /> Book</button>}
              {staff && (
                <>
                  <button className={btnGhost} onClick={() => setRoomForm({ id: r.id, v: { name: r.name, capacity: String(r.capacity), location: r.location || '', amenities: r.amenities || '', hourlyRate: String(r.hourlyRate), gstPercent: String(r.gstPercent) } })}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button className={btnGhost} onClick={() => toggleRoom(r)}>{r.active ? 'Deactivate' : 'Activate'}</button>
                </>
              )}
            </div>
          </Panel>
        ))}
      </section>

      <section aria-label="Bookings" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-theme-text-primary">{view === 'all' && staff ? 'All bookings' : 'My bookings'}</h2>
          {staff && (
            <div className="flex gap-2">
              <button className={btnGhost} aria-pressed={view === 'mine'} onClick={() => setView('mine')}>Mine</button>
              <button className={btnGhost} aria-pressed={view === 'all'} onClick={() => setView('all')}>Everyone</button>
            </div>
          )}
        </div>
        <Panel className="!p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-theme-text-secondary border-b border-theme-card-border">
                <th className="p-3 font-semibold">When</th>
                <th className="p-3 font-semibold">Room</th>
                <th className="p-3 font-semibold">Purpose</th>
                {view === 'all' && staff && <th className="p-3 font-semibold">Booked by</th>}
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-theme-text-secondary">No bookings yet.</td></tr>
              )}
              {shown.map(b => {
                const upcoming = new Date(b.end).getTime() > now;
                return (
                  <tr key={b.id} className="border-b border-theme-card-border/50 text-theme-text-primary">
                    <td className="p-3 whitespace-nowrap">{fmtDateTime(b.start)}<br /><span className="text-theme-text-secondary">to {fmtDateTime(b.end)}</span></td>
                    <td className="p-3">{b.roomName}</td>
                    <td className="p-3">{b.title}{b.organisation ? <span className="block text-theme-text-secondary">{b.organisation}</span> : null}</td>
                    {view === 'all' && staff && <td className="p-3">{b.bookedByName}</td>}
                    <td className="p-3">
                      {b.status === 'Cancelled' ? <Badge tone="red">Cancelled</Badge> : upcoming ? <Badge tone="green">Confirmed</Badge> : <Badge tone="grey">Completed</Badge>}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {b.invoiceId && b.status === 'Confirmed' && <Link href="/dashboard/invoices" className="text-accent font-semibold mr-3">Invoice</Link>}
                      {b.status === 'Confirmed' && upcoming && (staff || b.bookedById === user?.id) && (
                        <button className={btnDanger} disabled={cancelling === b.id} onClick={() => cancel(b)}>Cancel</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </section>

      {bookingRoom && (
        <BookModal
          room={bookingRoom}
          bookings={bookings}
          onClose={() => setBookingRoom(null)}
          onDone={async (text) => { setBookingRoom(null); setMsg({ kind: 'ok', text }); await load(); }}
        />
      )}

      {roomForm && (
        <Modal title={roomForm.id ? 'Edit boardroom' : 'Add boardroom'} onClose={() => setRoomForm(null)}>
          <form onSubmit={saveRoom} className="space-y-4">
            <Field label="Room name *"><input required className={inputCls} value={roomForm.v.name} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, name: e.target.value } })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Capacity *"><input required type="number" min="1" className={inputCls} value={roomForm.v.capacity} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, capacity: e.target.value } })} /></Field>
              <Field label="Location"><input className={inputCls} value={roomForm.v.location} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, location: e.target.value } })} /></Field>
              <Field label="Rate per hour (₹)" hint="0 = free, no invoice"><input type="number" min="0" step="any" className={inputCls} value={roomForm.v.hourlyRate} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, hourlyRate: e.target.value } })} /></Field>
              <Field label="GST %"><input type="number" min="0" max="100" step="any" className={inputCls} value={roomForm.v.gstPercent} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, gstPercent: e.target.value } })} /></Field>
            </div>
            <Field label="Amenities"><input className={inputCls} placeholder="Projector, whiteboard, video-conferencing" value={roomForm.v.amenities} onChange={e => setRoomForm({ ...roomForm, v: { ...roomForm.v, amenities: e.target.value } })} /></Field>
            <button className={btnPrimary + ' w-full'} type="submit">Save boardroom</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function BookModal({ room, bookings, onClose, onDone }: { room: Room; bookings: Booking[]; onClose: () => void; onDone: (msg: string) => void }) {
  const s0 = defaultStart();
  const [start, setStart] = useState(toLocalInput(s0));
  const [end, setEnd] = useState(toLocalInput(new Date(s0.getTime() + 3600_000)));
  const [title, setTitle] = useState('');
  const [attendees, setAttendees] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const sIso = isNaN(new Date(start).getTime()) ? '' : new Date(start).toISOString();
  const eIso = isNaN(new Date(end).getTime()) ? '' : new Date(end).toISOString();
  const valid = !!sIso && !!eIso && new Date(eIso) > new Date(sIso);
  const hours = valid ? billableHours(sIso, eIso) : 0;
  const net = hours * room.hourlyRate;
  const total = net + (net * room.gstPercent) / 100;

  const clashes = valid ? bookings.filter(b => b.roomId === room.id && b.status === 'Confirmed' && rangesOverlap(b.start, b.end, sIso, eIso)) : [];
  const sameDay = bookings.filter(b => b.roomId === room.id && b.status === 'Confirmed' && sIso && new Date(b.start).toDateString() === new Date(sIso).toDateString());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const b = await api<Booking>('/api/bookings', 'POST', { roomId: room.id, start: sIso, end: eIso, title, attendees: Number(attendees) || 0, organisation, notes });
      onDone(`${room.name} booked.` + (b.invoiceId ? ' An invoice has been generated — see Invoices & Payments to pay it.' : ''));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Book ${room.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Start *"><input required type="datetime-local" className={inputCls} value={start} onChange={e => setStart(e.target.value)} /></Field>
          <Field label="End *"><input required type="datetime-local" className={inputCls} value={end} onChange={e => setEnd(e.target.value)} /></Field>
        </div>
        {sameDay.length > 0 && (
          <div className="text-xs text-theme-text-secondary rounded-xl border border-theme-card-border p-3">
            <p className="font-semibold text-theme-text-primary mb-1">Already booked that day</p>
            {sameDay.map(b => <p key={b.id}>{fmtDateTime(b.start)} – {new Date(b.end).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</p>)}
          </div>
        )}
        {clashes.length > 0 && <Banner kind="error">That slot overlaps an existing booking.</Banner>}
        <Field label="Purpose / title *"><input required className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="Investor meeting, team offsite…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Attendees" hint={`Max ${room.capacity}`}><input type="number" min="0" max={room.capacity} className={inputCls} value={attendees} onChange={e => setAttendees(e.target.value)} /></Field>
          <Field label="Startup / organisation"><input className={inputCls} value={organisation} onChange={e => setOrganisation(e.target.value)} /></Field>
        </div>
        <Field label="Notes"><textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        {room.hourlyRate > 0 && valid && (
          <div className="text-xs rounded-xl bg-accent/10 border border-accent/30 p-3 text-theme-text-primary">
            {hours} hr × {formatINR(room.hourlyRate)} + {room.gstPercent}% GST = <strong>{formatINR(total)}</strong> (invoice raised on booking)
          </div>
        )}
        {error && <Banner kind="error">{error}</Banner>}
        <button className={btnPrimary + ' w-full'} type="submit" disabled={busy || !valid || clashes.length > 0}>{busy ? 'Booking…' : 'Confirm booking'}</button>
      </form>
    </Modal>
  );
}
