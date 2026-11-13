'use client';

import React, { useEffect, useState } from 'react';
import { X, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { getEventPasses, EventItem, EventPassItem, updateEventPass, updateEventPassStatus, todayIso, PassAttendanceRecord, expandDateRange, formatValidDaysLabel, getPassValidDays } from '@/lib/local-data';
import { PassValidityPicker } from '@/components/pass-design-controls';

interface Props {
  isOpen: boolean;
  passes: EventPassItem[];
  events: EventItem[];
  currentUserName: string;
  onClose: () => void;
  onDone: () => void;
}

const PASS_TYPES = ['VIP Pass', 'Keynote Speaker', 'Executive Delegate', 'Student Delegate', 'Guest Pass', 'Press / Media', 'Organizer', 'Other'];
const GUEST_CATEGORIES = ['VIP Dignitary', 'Keynote Speaker', 'Faculty', 'Student', 'Industry Partner', 'Alumni', 'Press / Media', 'Organizer / Crew', 'Special Guest', 'Other'];

type FieldKey = 'roomOrVenue' | 'eventVenue' | 'passType' | 'guestCategory' | 'validityDate' | 'validDays' | 'accessTier' | 'seatOrZone' | 'notes' | 'attendeeOrg' | 'status' | 'fontScale' | 'admit';

const input = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-accent text-xs disabled:opacity-40';

/** Change the same field(s) on every selected pass. Only ticked fields are applied; each pass goes through the normal edit path (approval rules, QR + wallet sync). */
export function EventPassBulkEditModal({ isOpen, passes, events, currentUserName, onClose, onDone }: Props) {
  const [apply, setApply] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [values, setValues] = useState<Record<FieldKey, string>>({
    roomOrVenue: '', eventVenue: '', passType: PASS_TYPES[0], guestCategory: GUEST_CATEGORIES[0], validityDate: '', validDays: '', accessTier: '', seatOrZone: '', notes: '', attendeeOrg: '', status: 'Active', fontScale: '1', admit: '',
  });
  // Valid days picked for the whole selection (null = every day of each pass's event)
  const [pickedDays, setPickedDays] = useState<string[] | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ ok: number; pending: number; admitted: number; alreadyAdmitted: number; skippedAdmit: number; failed: Array<{ name: string; error: string }> } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setApply({});
    setPickedDays(null);
    setProgress(0);
    setResult(null);
    setRunning(false);
  }, [isOpen]);

  if (!isOpen) return null;

  // Days of each selected pass's own event (falls back to the days the pass already has)
  const eventDaysOf = (p: EventPassItem): string[] => {
    const ev = events.find((e) => e.id === p.eventId);
    const fromEvent = ev && !ev.datesTBD ? expandDateRange(ev.startDate, ev.endDate) : [];
    return fromEvent.length > 0 ? fromEvent : getPassValidDays(p);
  };
  const dayChoices = Array.from(new Set(passes.flatMap(eventDaysOf))).sort();
  const effectiveDays = pickedDays ? pickedDays.filter((d) => dayChoices.includes(d)) : dayChoices;
  const toggleDay = (d: string) => {
    const base = pickedDays ?? dayChoices;
    const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d].sort();
    if (next.length > 0) setPickedDays(next);
  };

  const chosen = (Object.keys(apply) as FieldKey[]).filter((k) => apply[k]);
  const set = (k: FieldKey, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const row = (k: FieldKey, labelText: string, control: React.ReactNode) => (
    <div className="flex items-start gap-3">
      <label className="flex items-center gap-2 w-40 shrink-0 pt-2 font-bold text-slate-700 dark:text-slate-300 text-[11px] uppercase tracking-wider cursor-pointer">
        <input type="checkbox" checked={!!apply[k]} onChange={(e) => setApply((p) => ({ ...p, [k]: e.target.checked }))} />
        {labelText}
      </label>
      <div className="flex-1 min-w-0">{control}</div>
    </div>
  );

  const run = async () => {
    if (chosen.length === 0 || passes.length === 0) return;
    if (!window.confirm(`Apply ${chosen.length} change${chosen.length === 1 ? '' : 's'} to ${passes.length} pass${passes.length === 1 ? '' : 'es'}?`)) return;
    const updates: Partial<EventPassItem> = {};
    for (const k of chosen) {
      const v = values[k];
      if (k === 'validDays' || k === 'admit') continue; // resolved per pass below (clamped to that pass's own event days)
      if (k === 'fontScale') updates.fontScale = Math.min(1.6, Math.max(0.7, Number(v) || 1));
      else if (k === 'status') updates.status = v as EventPassItem['status'];
      else (updates as any)[k] = v.trim();
    }
    setRunning(true);
    setResult(null);
    setProgress(0);
    const failed: Array<{ name: string; error: string }> = [];
    let ok = 0;
    let pending = 0;
    let admitted = 0;
    let alreadyAdmitted = 0;
    let skippedAdmit = 0;
    // Sequential: updateEventPass edits the shared local cache, so parallel runs would overwrite each other
    for (let i = 0; i < passes.length; i++) {
      const p = passes[i];
      try {
        let perPass = updates;
        if (apply.validDays) {
          const allowed = eventDaysOf(p);
          const days = effectiveDays.filter((d) => allowed.includes(d));
          if (days.length === 0) {
            failed.push({ name: p.attendeeName, error: 'None of the chosen days fall within this pass\'s event.' });
            setProgress(i + 1);
            continue;
          }
          perPass = { ...updates, validDays: days, ...(apply.validityDate ? {} : { validityDate: formatValidDaysLabel(days) }) };
        }
        const hasEdits = chosen.some((k) => k !== 'admit');
        const r = hasEdits ? await updateEventPass(p.id, perPass, currentUserName) : { pass: p, refused: undefined, approvalPending: false };
        if (!r) failed.push({ name: p.attendeeName, error: 'Pass not found.' });
        else if (r.refused) failed.push({ name: p.attendeeName, error: r.refused });
        else {
          if (hasEdits) { if (r.approvalPending) pending++; else ok++; }
          if (apply.admit) {
            // Check in on every valid day up to today (or today alone when the pass has no dated days)
            const fresh = getEventPasses().find((x) => x.id === p.id) || p;
            if (fresh.status === 'Cancelled' || fresh.approvalStatus) { skippedAdmit++; }
            else {
              const today = todayIso();
              const past = getPassValidDays(fresh).filter((d) => d <= today);
              const days = past.length > 0 ? past : [today];
              const have = new Set((fresh.attendance || []).map((a) => a.day.toLowerCase()));
              const missing = days.filter((d) => !have.has(d.toLowerCase()));
              if (missing.length === 0 && fresh.status === 'Checked In') alreadyAdmitted++;
              else {
                const now = new Date().toISOString();
                const records: PassAttendanceRecord[] = missing.map((d) => ({ day: d, date: d, timestamp: now, scannedBy: currentUserName, checkedInBy: currentUserName }));
                updateEventPassStatus(p.id, 'Checked In', currentUserName, records);
                admitted++;
              }
            }
          }
        }
      } catch (e: any) {
        failed.push({ name: p.attendeeName, error: e?.message || 'Failed.' });
      }
      setProgress(i + 1);
    }
    setResult({ ok, pending, admitted, alreadyAdmitted, skippedAdmit, failed });
    setRunning(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="glass-panel w-full max-w-2xl rounded-3xl p-5 md:p-7 space-y-4 border border-slate-200/90 dark:border-white/15 bg-white/95 dark:bg-[#0D1F38]/95 shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 pb-3">
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">Bulk edit {passes.length} pass{passes.length === 1 ? '' : 'es'}</h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">Tick a field to change it on every selected pass. Unticked fields are left alone.</p>
          </div>
          <button onClick={onClose} disabled={running} className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 cursor-pointer"><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-3 text-xs pr-1">
          {row('roomOrVenue', 'Room / Venue', <input className={input} disabled={!apply.roomOrVenue} value={values.roomOrVenue} onChange={(e) => set('roomOrVenue', e.target.value)} placeholder="e.g. Seminar Hall 2, Block C" />)}
          {row('eventVenue', 'Event venue', <input className={input} disabled={!apply.eventVenue} value={values.eventVenue} onChange={(e) => set('eventVenue', e.target.value)} />)}
          {row('passType', 'Pass type', <select className={input} disabled={!apply.passType} value={values.passType} onChange={(e) => set('passType', e.target.value)}>{PASS_TYPES.map((t) => <option key={t} value={t} className="bg-slate-900 text-white">{t}</option>)}</select>)}
          {row('guestCategory', 'Guest category', <select className={input} disabled={!apply.guestCategory} value={values.guestCategory} onChange={(e) => set('guestCategory', e.target.value)}>{GUEST_CATEGORIES.map((t) => <option key={t} value={t} className="bg-slate-900 text-white">{t}</option>)}</select>)}
          {row('validDays', 'Valid on (days)', (
            <div className={apply.validDays ? '' : 'opacity-40 pointer-events-none'}>
              {dayChoices.length > 0 ? (
                <PassValidityPicker
                  eventDays={dayChoices}
                  effectiveValidDays={effectiveDays}
                  selectedValidDays={pickedDays}
                  setSelectedValidDays={setPickedDays}
                  toggleValidDay={toggleDay}
                  validityDate=""
                  setValidityDate={() => {}}
                  displayValidity={formatValidDaysLabel(effectiveDays)}
                />
              ) : (
                <p className="text-[11px] text-slate-500 pt-2">The selected passes have no dated event days to choose from.</p>
              )}
            </div>
          ))}
          {row('validityDate', 'Validity label', <input className={input} disabled={!apply.validityDate} value={values.validityDate} onChange={(e) => set('validityDate', e.target.value)} placeholder="e.g. 13 – 14 Oct 2026" />)}
          {row('accessTier', 'Access tier', <input className={input} disabled={!apply.accessTier} value={values.accessTier} onChange={(e) => set('accessTier', e.target.value)} />)}
          {row('seatOrZone', 'Seat / Zone', <input className={input} disabled={!apply.seatOrZone} value={values.seatOrZone} onChange={(e) => set('seatOrZone', e.target.value)} />)}
          {row('attendeeOrg', 'Organisation', <input className={input} disabled={!apply.attendeeOrg} value={values.attendeeOrg} onChange={(e) => set('attendeeOrg', e.target.value)} />)}
          {row('notes', 'Notes', <textarea rows={2} className={input} disabled={!apply.notes} value={values.notes} onChange={(e) => set('notes', e.target.value)} />)}
          {row('fontScale', 'Text size', <input type="number" step="0.1" min="0.7" max="1.6" className={input} disabled={!apply.fontScale} value={values.fontScale} onChange={(e) => set('fontScale', e.target.value)} />)}
          {row('status', 'Status', <select className={input} disabled={!apply.status} value={values.status} onChange={(e) => set('status', e.target.value)}><option value="Active" className="bg-slate-900 text-white">Active</option><option value="Cancelled" className="bg-slate-900 text-white">Cancelled</option></select>)}

          {row('admit', 'Bulk admit', <p className={`text-[11px] pt-2 ${apply.admit ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>Check in all {passes.length} selected pass{passes.length === 1 ? '' : 'es'} at once — every valid day up to today is marked attended. Cancelled passes are skipped.</p>)}

          {running && (
            <div className="flex items-center gap-2 text-sky-400 font-bold"><Loader2 className="h-4 w-4 animate-spin" /> Updating {progress} / {passes.length}…</div>
          )}
          {result && (
            <div className={`p-3 rounded-2xl border space-y-1 ${result.failed.length ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'}`}>
              <div className="flex items-center gap-2 font-bold">
                {result.failed.length ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                {apply.admit ? `${result.admitted} checked in${result.alreadyAdmitted ? `, ${result.alreadyAdmitted} already checked in` : ''}${result.skippedAdmit ? `, ${result.skippedAdmit} skipped (cancelled or awaiting approval)` : ''}; ` : ''}{result.ok} updated{result.pending ? `, ${result.pending} waiting for approval` : ''}{result.failed.length ? `, ${result.failed.length} failed` : ''}.
              </div>
              {result.failed.slice(0, 8).map((f, i) => <div key={i} className="text-[11px]">• {f.name}: {f.error}</div>)}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200/80 dark:border-white/10 pt-3 flex items-center justify-between gap-3">
          <button type="button" onClick={onClose} disabled={running} className="px-4 py-2.5 bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white rounded-xl text-xs font-bold cursor-pointer">{result ? 'Close' : 'Cancel'}</button>
          <button type="button" disabled={running || chosen.length === 0} onClick={run} className="px-6 py-2.5 bg-accent text-white font-extrabold rounded-xl text-xs shadow-lg shadow-accent/25 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Apply to {passes.length} pass{passes.length === 1 ? '' : 'es'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EventPassBulkEditModal;
