'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, CheckSquare, ChevronLeft, ChevronRight, Loader2, Send, Square, X } from 'lucide-react';
import { authHeaders } from '@/lib/local-data';
import { beginTask } from '@/lib/background-tasks';
import { CertificateStatusBadge } from '@/components/certificate-status-badge';
import { EmailBackgroundPicker, DEFAULT_BACKGROUND_PICK, backgroundChoiceFor, type EmailBackgroundPick } from '@/components/email-background-picker';
import { CERT_EMAIL_FIELDS, CERT_EMAIL_MAX_BODY, CERT_EMAIL_MAX_SUBJECT, DEFAULT_CERT_EMAIL, mergeCertEmail } from '@/lib/certificate-layout';
import { defaultSelection, isSelectable, isSettled, scheduledMap, type SelectionSchedule } from '@/lib/certificate-selection';

/** One issued certificate, as listed in the Issued Certificates box. */
export interface SendableCertificate {
  id: string;
  passId: string;
  eventId: string;
  eventName: string;
  eventDate?: string;
  typeId?: string;
  typeName?: string;
  attendeeName: string;
  attendeeEmail: string;
  code?: string;
  status: string;
  issuedAt?: string;
  sentAt?: string;
  sentBy?: string;
  error?: string;
}

interface GroupInfo {
  key: string;
  eventId: string;
  eventName: string;
  typeId: string;
  eventOver: boolean;
  schedules: SelectionSchedule[];
}

interface GroupResult {
  key: string;
  label: string;
  kind: 'ok' | 'warn' | 'err';
  text: string;
}

const groupKeyOf = (c: SendableCertificate) => `${c.eventId}|${c.typeId || 'default'}`;

/**
 * Bulk e-mail dialog for certificates picked in the Issued Certificates box: choose who gets it, write the message,
 * pick the blurred background (with a real preview of the e-mail), then send now or schedule. People are grouped by
 * event + certificate type and sent through the same endpoint as the designer's "Schedule & send" step.
 * Mounted only while open, so every opening starts fresh.
 */
export function CertificateSendDialog({ certificates, onClose, onDone }: { certificates: SendableCertificate[]; onClose: () => void; onDone: () => void }) {
  const [groups, setGroups] = useState<Record<string, GroupInfo>>({});
  const [loading, setLoading] = useState(true);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState(DEFAULT_CERT_EMAIL.subject);
  const [body, setBody] = useState(DEFAULT_CERT_EMAIL.bodyText);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [bgPick, setBgPick] = useState<EmailBackgroundPick>(DEFAULT_BACKGROUND_PICK);
  const [sendMode, setSendMode] = useState<'now' | 'later'>('now');
  const [sendAt, setSendAt] = useState('');
  const [index, setIndex] = useState(0);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<GroupResult[]>([]);
  const [error, setError] = useState('');

  const rows = certificates;
  const scheduled = useMemo(() => scheduledMap(Object.values(groups).flatMap((g) => g.schedules)), [groups]);

  // Load each event + type's pending schedules and whether sending is open, then set the default recipients.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const keys = Array.from(new Set(rows.map(groupKeyOf)));
      const loaded: Record<string, GroupInfo> = {};
      await Promise.all(keys.map(async (key) => {
        const [eventId, typeId] = key.split('|');
        const sample = rows.find((r) => groupKeyOf(r) === key)!;
        const info: GroupInfo = { key, eventId, eventName: sample.eventName, typeId, eventOver: false, schedules: [] };
        try {
          const res = await fetch(`/api/events/${eventId}/certificates?typeId=${encodeURIComponent(typeId)}`, { headers: authHeaders(), cache: 'no-store' });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            info.eventOver = !!data.eventOver;
            info.schedules = Array.isArray(data.schedules) ? data.schedules : [];
          }
        } catch { /* keep the safe defaults: not over, no schedules */ }
        loaded[key] = info;
      }));
      if (cancelled) return;
      setGroups(loaded);
      const sched = scheduledMap(Object.values(loaded).flatMap((g) => g.schedules));
      const ids = defaultSelection(rows.map((r) => ({ passId: r.passId, status: r.status })), sched);
      setIncluded(new Set(rows.filter((r) => ids.has(r.passId)).map((r) => r.id)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [certificates]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const varsFor = useCallback((c: SendableCertificate) => ({
    name: c.attendeeName,
    email: c.attendeeEmail,
    event: c.eventName,
    date: c.eventDate || '',
    code: c.code || 'ISSUED-ON-SEND',
    verifyUrl: `${origin}/certificate/${c.code || 'ISSUED-ON-SEND'}`,
  }), [origin]);

  const safeIndex = Math.min(index, Math.max(0, rows.length - 1));
  const current = rows[safeIndex];
  const mergedSubject = current ? mergeCertEmail(subject, varsFor(current)) : '';
  const mergedBody = current ? mergeCertEmail(body, varsFor(current)) : '';

  // The e-mail preview is the real HTML built by the server (so the background is exactly what recipients get).
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch('/api/email/preview', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ subject: mergedSubject, bodyText: mergedBody, category: 'CERTIFICATE', background: backgroundChoiceFor(bgPick) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setPreviewHtml(res.ok && typeof data.html === 'string' ? data.html : '');
      } catch {
        if (!cancelled) setPreviewHtml('');
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [current, mergedSubject, mergedBody, bgPick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const selectableRows = rows.filter((r) => isSelectable({ passId: r.passId, status: r.status }, scheduled));
  const chosen = rows.filter((r) => included.has(r.id));
  const resendCount = chosen.filter((r) => isSettled({ passId: r.passId, status: r.status })).length;
  const toggle = (c: SendableCertificate) => {
    if (scheduled.has(c.passId)) return;
    setIncluded((prev) => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; });
  };
  const emailReady = subject.trim().length > 0 && body.trim().length > 0;
  const scheduleTag = (c: SendableCertificate) => {
    const at = scheduled.get(c.passId);
    return at ? `Scheduled ${new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
  };

  const insertField = (token: string) => {
    const el = bodyRef.current;
    if (!el) return setBody((b) => `${b}${token}`);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  const send = async () => {
    setError('');
    if (chosen.length === 0) return;
    if (!emailReady) return setError('Write a subject and a message first.');
    if (sendMode === 'later') {
      const when = new Date(sendAt);
      if (!sendAt || Number.isNaN(when.getTime())) return setError('Pick the date and time to send.');
      if (when.getTime() < Date.now() + 60_000) return setError('Pick a time at least a minute from now.');
    }
    const resend = resendCount > 0 ? `\n\n${resendCount} of them already received this certificate and will get it again.` : '';
    const ask = sendMode === 'later' ? `Schedule ${chosen.length} certificate${chosen.length === 1 ? '' : 's'} for ${new Date(sendAt).toLocaleString()}?` : `Email ${chosen.length} certificate${chosen.length === 1 ? '' : 's'} now?`;
    if (!window.confirm(ask + resend)) return;

    setBusy(true);
    setResults([]);
    const byGroup = new Map<string, SendableCertificate[]>();
    chosen.forEach((c) => byGroup.set(groupKeyOf(c), [...(byGroup.get(groupKeyOf(c)) || []), c]));
    const task = beginTask({ label: sendMode === 'later' ? `Scheduling ${chosen.length} certificate${chosen.length === 1 ? '' : 's'}` : `Sending ${chosen.length} certificate${chosen.length === 1 ? '' : 's'}`, total: byGroup.size, detail: 'Generating PDFs and queueing emails…' });
    const out: GroupResult[] = [];
    let done = 0;
    let problems = 0;
    for (const [key, list] of byGroup) {
      const g = groups[key];
      const label = `${g?.eventName || list[0].eventName}${list[0].typeName ? ` · ${list[0].typeName}` : ''}`;
      if (sendMode === 'now' && g && !g.eventOver) {
        out.push({ key, label, kind: 'warn', text: `Not sent — sending opens on the event's last day. Schedule these ${list.length} instead.` });
        problems++;
      } else {
        try {
          const res = await fetch(`/api/events/${list[0].eventId}/certificates`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              typeId: g?.typeId || 'default',
              passIds: list.map((c) => c.passId),
              sendAt: sendMode === 'later' ? new Date(sendAt).toISOString() : undefined,
              message: { subject, bodyText: body },
              background: backgroundChoiceFor(bgPick),
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          const skipped = data.skippedScheduled ? ` ${data.skippedScheduled} skipped (already scheduled).` : '';
          if (data.scheduled) {
            out.push({ key, label, kind: 'ok', text: `Scheduled ${list.length - (data.skippedScheduled || 0)} for ${new Date(data.schedule.sendAt).toLocaleString()}.${skipped}` });
          } else {
            const failedN = data.failed || 0;
            if (failedN) problems++;
            out.push({ key, label, kind: failedN ? 'warn' : 'ok', text: `Sent ${data.sent}${failedN ? `, ${failedN} failed (see the list)` : ''}.${skipped}` });
          }
        } catch (e) {
          problems++;
          out.push({ key, label, kind: 'err', text: e instanceof Error ? e.message : 'Failed to send.' });
        }
      }
      done++;
      task.progress(done);
    }
    setResults(out);
    setBusy(false);
    task.finish(problems ? `Finished with ${problems} event${problems === 1 ? '' : 's'} needing attention.` : sendMode === 'later' ? 'Scheduled.' : 'Queued (10-minute hold applies).', { warn: problems > 0 });
    onDone();
  };

  const field = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:border-accent';
  const resultTone = { ok: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30', warn: 'bg-amber-500/10 text-amber-500 border-amber-500/30', err: 'bg-rose-500/10 text-rose-400 border-rose-500/30' } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3" role="dialog" aria-modal="true" aria-label="Send certificates">
      <div className="glass-panel w-full max-w-6xl max-h-[94vh] rounded-3xl border border-white/15 shadow-2xl flex flex-col overflow-hidden bg-theme-card/95 text-xs">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-white/10">
          <div>
            <h3 className="text-sm font-extrabold text-theme-text-primary flex items-center gap-2"><Send className="h-4 w-4 text-accent" /> Send certificates</h3>
            <p className="text-[11px] text-theme-text-secondary">{rows.length} picked · {chosen.length} will be emailed · PDFs are attached automatically</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: who + message */}
          <div className="space-y-3 min-w-0">
            <div className="space-y-2 p-3 rounded-xl border border-slate-200 dark:border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold text-slate-800 dark:text-white">Who gets this ({chosen.length} of {rows.length})</span>
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold">
                  <button type="button" disabled={busy} className="text-accent hover:underline cursor-pointer" onClick={() => setIncluded(new Set(selectableRows.map((r) => r.id)))}>Everyone not yet sent ({selectableRows.length})</button>
                  <button type="button" disabled={busy} className="text-slate-500 hover:underline cursor-pointer" onClick={() => setIncluded(new Set())}>Clear</button>
                </div>
              </div>
              <div className="border border-slate-200 dark:border-white/10 rounded-xl divide-y divide-slate-100 dark:divide-white/5 max-h-[34vh] overflow-y-auto">
                {loading && <div className="py-4 text-center text-slate-400 flex items-center justify-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking schedules…</div>}
                {!loading && rows.map((c, i) => {
                  const on = included.has(c.id);
                  const locked = scheduled.has(c.passId);
                  return (
                    <div key={c.id} className={`flex items-start justify-between gap-2 p-2 ${i === safeIndex ? 'bg-accent/10' : on ? 'bg-accent/5' : ''}`}>
                      <button type="button" disabled={locked || busy} onClick={() => toggle(c)} className={`flex items-start gap-2 min-w-0 flex-1 text-left ${locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                        {on ? <CheckSquare className="h-4 w-4 text-accent shrink-0 mt-0.5" /> : <Square className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />}
                        <span className="min-w-0">
                          <span className="font-bold text-slate-900 dark:text-white block break-words">{c.attendeeName}{locked && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 align-middle">{scheduleTag(c)}</span>}</span>
                          <span className="text-[10px] text-slate-400 block break-all">{c.attendeeEmail || 'no email address'} · {c.eventName}{c.typeName ? ` · ${c.typeName}` : ''}</span>
                        </span>
                      </button>
                      <div className="shrink-0 flex items-center gap-2">
                        <CertificateStatusBadge status={c.status} sentAt={c.sentAt} issuedAt={c.issuedAt} error={c.error} sentBy={c.sentBy} />
                        <button type="button" title="Preview this person's email" onClick={() => setIndex(i)} className="h-7 px-2 rounded-lg border border-slate-300 dark:border-white/15 text-slate-500 text-[10px] font-bold cursor-pointer">Preview</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-500">People already sent or queued start unticked — tick one to send again. People already in a scheduled send can&apos;t be ticked (cancel that schedule first). Certificates from different events or types are sent in separate batches.</p>
            </div>

            <div className="space-y-2 p-3 rounded-xl border border-slate-200 dark:border-white/10">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Email message</label>
                <button type="button" onClick={() => { setSubject(DEFAULT_CERT_EMAIL.subject); setBody(DEFAULT_CERT_EMAIL.bodyText); }} className="text-[10px] font-bold text-accent cursor-pointer">Reset to default</button>
              </div>
              <input className={field} maxLength={CERT_EMAIL_MAX_SUBJECT} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" disabled={busy} />
              <textarea ref={bodyRef} rows={8} maxLength={CERT_EMAIL_MAX_BODY} className={`${field} font-sans`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the message that goes with the certificate" disabled={busy} />
              <div className="flex flex-wrap gap-1.5">
                {CERT_EMAIL_FIELDS.map((f) => (
                  <button key={f.token} type="button" title={f.label} onClick={() => insertField(f.token)} className="px-2 py-1 rounded-lg bg-accent/10 text-accent border border-accent/30 font-bold cursor-pointer">{f.token}</button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">Each placeholder is filled in for every person. The certificate PDF is always attached.</p>
            </div>
          </div>

          {/* Right: preview + background + when */}
          <div className="space-y-3 min-w-0">
            <div className="space-y-2 p-3 rounded-xl border border-slate-200 dark:border-white/10">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold text-slate-800 dark:text-white">Email preview</span>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => setIndex(Math.max(0, safeIndex - 1))} disabled={safeIndex === 0} className="p-1.5 rounded-lg border border-slate-300 dark:border-white/15 disabled:opacity-30 cursor-pointer" aria-label="Previous person"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <span className="text-[10px] text-slate-500 min-w-[48px] text-center">{rows.length ? safeIndex + 1 : 0} / {rows.length}</span>
                  <button type="button" onClick={() => setIndex(Math.min(rows.length - 1, safeIndex + 1))} disabled={safeIndex >= rows.length - 1} className="p-1.5 rounded-lg border border-slate-300 dark:border-white/15 disabled:opacity-30 cursor-pointer" aria-label="Next person"><ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              {current && (
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">To {current.attendeeName} &lt;{current.attendeeEmail}&gt;</span>
                  <p className="font-bold text-slate-900 dark:text-white break-words">{mergedSubject || '(no subject)'}</p>
                  <p className="text-[10px] text-slate-500">Attached: Certificate-{current.attendeeName.replace(/[^\w]+/g, '_')}.pdf</p>
                </div>
              )}
              <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-100">
                <iframe title="Email preview" sandbox="" srcDoc={previewHtml} className="w-full h-[46vh] min-h-[320px] bg-slate-100" />
                {previewing && <Loader2 className="absolute top-2 right-2 h-4 w-4 animate-spin text-slate-500" />}
              </div>
            </div>

            <EmailBackgroundPicker value={bgPick} onChange={setBgPick} disabled={busy} />

            <div className="space-y-2 p-3 rounded-xl border border-slate-200 dark:border-white/10">
              <div className="flex flex-wrap gap-4 font-bold text-slate-700 dark:text-slate-200">
                <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={sendMode === 'now'} onChange={() => setSendMode('now')} disabled={busy} /> Send now</label>
                <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={sendMode === 'later'} onChange={() => setSendMode('later')} disabled={busy} /> Schedule</label>
              </div>
              {sendMode === 'later' && <input type="datetime-local" className={`${field} max-w-xs [color-scheme:dark]`} value={sendAt} onChange={(e) => setSendAt(e.target.value)} disabled={busy} />}
              {sendMode === 'now' && <p className="text-[10px] text-slate-500">Sending now works for events that have reached their last day; for others, schedule it.</p>}
              {resendCount > 0 && <p className="text-[11px] font-semibold text-amber-500">{resendCount} ticked {resendCount === 1 ? 'person has' : 'people have'} already received this certificate.</p>}
              {error && <p className="text-[11px] font-semibold text-rose-400">{error}</p>}
              {results.length > 0 && (
                <div className="space-y-1.5">
                  {results.map((r) => (
                    <div key={r.key} className={`px-3 py-2 rounded-lg border text-[11px] ${resultTone[r.kind]}`}><span className="font-bold">{r.label}:</span> {r.text}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10 bg-black/10">
          <span className="text-[11px] text-theme-text-secondary">{chosen.length === 0 ? 'Tick at least one person.' : `${chosen.length} certificate${chosen.length === 1 ? '' : 's'} ready`}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-white/15 font-bold cursor-pointer disabled:opacity-40">{results.length ? 'Close' : 'Cancel'}</button>
            <button type="button" onClick={send} disabled={busy || loading || chosen.length === 0 || !emailReady} className="px-5 py-2.5 bg-accent text-white font-extrabold rounded-xl shadow-lg shadow-accent/25 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : sendMode === 'later' ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {sendMode === 'later' ? `Schedule ${chosen.length}${sendAt ? ` · ${new Date(sendAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}` : `Send ${chosen.length} now`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
