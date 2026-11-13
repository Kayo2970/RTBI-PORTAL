'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Users, Plus, UserPlus, Pencil, Award, X, Send, RefreshCw, CheckCircle2, AlertCircle, CheckSquare, Square, ImagePlus, Trash2, ChevronDown, ChevronRight, Download, CalendarClock, Check, Mail } from 'lucide-react';
import { EventItem, Member, TaskItem, authHeaders, formatEventDateRange, getMembers, getTasks } from '@/lib/local-data';
import { beginTask } from '@/lib/background-tasks';
import { EmailHtmlPreview } from '@/components/email-html-preview';
import { EmailBackgroundPicker, DEFAULT_BACKGROUND_PICK, backgroundChoiceFor, type EmailBackgroundPick } from '@/components/email-background-picker';
import { defaultSelection, isSelectable, keepSelection, scheduledMap, selectOnlyVisible, toggleVisible, visibleSelectionState } from '@/lib/certificate-selection';
import { CertificateStatusBadge, CERT_STATUS_FILTERS } from '@/components/certificate-status-badge';
import { CertBox, CertBoxKey, CertLayout, CERT_BOX_LABELS, CERT_FONT_OPTIONS, DEFAULT_CERT_EMAIL, CERT_EMAIL_FIELDS, CERT_EMAIL_MAX_SUBJECT, CERT_EMAIL_MAX_BODY, mergeCertEmail } from '@/lib/certificate-layout';

interface CertType { id: string; name: string }
interface Attendee { manual?: boolean; passId: string; name: string; email: string; serial: string; organisation?: string; category?: string; passType?: string; daysAttended?: number; totalDays?: number; status: string; code?: string; issuedAt?: string; sentAt?: string; sentBy?: string; error?: string }
interface Template { title: string; introText: string; bodyText: string; signatoryName: string; signatoryTitle: string; nameSource: 'name' | 'organisation' | 'category' | 'serial'; textColor: string; layout: CertLayout }
interface Schedule { id: string; sendAt: string; passIds: string[]; status: string; sent?: number; failed?: number; error?: string; finishedAt?: string; createdBy?: string }

const field = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-accent text-xs';
const label = 'block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px] mb-1';
const numCls = 'w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-lg text-slate-900 dark:text-white text-xs';

const BOX_HINTS: Record<CertBoxKey, string> = {
  title: 'Big heading at the top',
  intro: 'Small line above the name',
  name: 'Each attendee’s name (always centred in its box)',
  body: 'Wording with merge fields',
  signatory: 'Signature line, name and designation',
  qr: 'Verify QR code and certificate ID',
};

/** Placeholder shown while the event's design and recipients load, instead of an empty page. */
function CertificateSkeleton() {
  const bar = 'rounded-lg bg-slate-200/80 dark:bg-white/10';
  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(520px,5fr)_minmax(0,7fr)] gap-5 animate-pulse" role="status" aria-label="Loading certificate design">
      <div className="space-y-2.5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-2xl border border-slate-200 dark:border-white/10 px-4 py-3 flex items-center gap-3">
            <div className={`h-6 w-6 rounded-full ${bar}`} />
            <div className={`h-3.5 flex-1 max-w-[220px] ${bar}`} />
            <div className={`h-3.5 w-3.5 ${bar}`} />
          </div>
        ))}
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 space-y-2">
          <div className={`h-3 w-3/4 ${bar}`} />
          <div className={`h-9 w-40 rounded-xl ${bar}`} />
        </div>
      </div>
      <div className="space-y-3">
        <div className={`h-3 w-40 ${bar}`} />
        <div className={`w-full aspect-[297/210] rounded-2xl ${bar}`} />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

const STEPS = ['Background', 'Choose content', 'Adjust position & font', 'Link to data', 'Preview final files', 'Schedule & send'];

/** Parses a JSON response; turns an HTML error page from the server / proxy into a readable message naming the action. */
async function readJson(res: Response, what: string): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 413) throw new Error(`The server rejected ${what} because it is too large. Use a smaller file, or raise the upload limit (nginx client_max_body_size).`);
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new Error(`The server did not answer in time while ${what}. Try again in a moment.`);
    if (res.status === 404) throw new Error(`The server does not have this feature yet while ${what} — deploy the latest build (git pull, npm run build, pm2 restart).`);
    throw new Error(`Unexpected server response (HTTP ${res.status}) while ${what}.`);
  }
}

/** Downsizes a picked background to at most 2480 px (JPEG) before upload, so the request stays small. */
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        const scale = Math.min(1, 2480 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        const ctx = c.getContext('2d');
        if (!ctx) return reject(new Error('Could not process that image.'));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.95));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  events: EventItem[];
  initialEventId?: string;
  canEditDesign: boolean;
  /** Holds the Send Certificates power; false = design/preview only. Defaults to true. */
  canSend?: boolean;
  /** Lets the person pick recipients from the Members Directory (needs full-directory access). */
  canPickMembers?: boolean;
  /** Render as a page section (the Certificates tab) instead of a pop-up overlay. */
  inline?: boolean;
}

export function CertificateModal({ isOpen, onClose, events, initialEventId, canEditDesign, canSend = true, canPickMembers = false, inline = false }: Props) {
  const [eventId, setEventId] = useState('');
  const [typeId, setTypeId] = useState('default');
  const [types, setTypes] = useState<CertType[]>([{ id: 'default', name: 'Participation' }]);
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState({ name: '', email: '', organisation: '', category: '' });
  const [manualOpen, setManualOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerDivision, setPickerDivision] = useState('ALL');
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [pickerProgress, setPickerProgress] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [taskList, setTaskList] = useState<TaskItem[]>([]);
  const [pickerMode, setPickerMode] = useState<'directory' | 'event'>('directory');
  const [pickerEventId, setPickerEventId] = useState('');
  useEffect(() => {
    if (!canPickMembers) return;
    const read = () => { setMembers(getMembers()); setTaskList(getTasks()); };
    read();
    window.addEventListener('leads-data-sync', read);
    return () => window.removeEventListener('leads-data-sync', read);
  }, [canPickMembers]);
  const [openStep, setOpenStep] = useState(1);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [eventOver, setEventOver] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  // Extra recipient filters (pass type, guest category, organisation, days attended, pass vs manual)
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [orgFilter, setOrgFilter] = useState('ALL');
  const [daysFilter, setDaysFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [template, setTemplate] = useState<Template | null>(null);
  const [preview, setPreview] = useState('');
  const [background, setBackground] = useState<string | null | undefined>(undefined); // undefined = keep, null = remove
  const [hasBackground, setHasBackground] = useState(false);
  const [activeBox, setActiveBox] = useState<CertBoxKey>('name');
  const [customFonts, setCustomFonts] = useState<Array<{ id: string; label: string }>>([]);
  const [googleLink, setGoogleLink] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const [previewPassId, setPreviewPassId] = useState('');
  const [finalPreview, setFinalPreview] = useState('');
  const [openPreviews, setOpenPreviews] = useState<Set<string>>(new Set());
  const [emailEditorOpen, setEmailEditorOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState(DEFAULT_CERT_EMAIL.subject);
  const [emailBody, setEmailBody] = useState(DEFAULT_CERT_EMAIL.bodyText);
  const [bgPick, setBgPick] = useState<EmailBackgroundPick>(DEFAULT_BACKGROUND_PICK);
  const emailBodyRef = useRef<HTMLTextAreaElement>(null);
  const [sendMode, setSendMode] = useState<'now' | 'later'>('now');
  const [sendAt, setSendAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const versionRef = useRef(0);
  const templateRef = useRef<Template | null>(null);
  const backgroundRef = useRef<string | null | undefined>(undefined);
  templateRef.current = template;
  backgroundRef.current = background;

  const endedEvents = events.filter((e) => !e.datesTBD && !e.isHoliday && e.status !== 'archived' && (e.endDate || e.startDate) && (e.endDate || e.startDate) <= new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (!isOpen) return;
    const preferred = initialEventId && initialEventId !== 'ALL' ? initialEventId : '';
    setEventId(preferred || endedEvents[0]?.id || events[0]?.id || '');
    setTypeId('default');
    setOpenStep(1);
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const load = useCallback(async (silent = false) => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
      setTemplate(null);
    }
    setBusy(true);
    try {
      const [a, t] = await Promise.all([
        fetch(`/api/events/${eventId}/certificates?typeId=${typeId}`, { headers: authHeaders() }),
        fetch(`/api/events/${eventId}/certificate-template?typeId=${typeId}`, { headers: authHeaders() }),
      ]);
      const aj = await readJson(a, 'loading attendees');
      if (!a.ok) throw new Error(aj.error || 'Could not load attendees.');
      setAttendees(aj.attendees);
      if (Array.isArray(aj.types) && aj.types.length) setTypes(aj.types);
      setSchedules(aj.schedules || []);
      setEventOver(!!aj.eventOver);
      // A fresh load (event / certificate type changed) starts from "everyone who still needs one"; a reload after a
      // send or schedule keeps what was ticked, minus anyone now sent, queued or already scheduled.
      const scheduledNow = scheduledMap(aj.schedules);
      setSelected((prev) => (silent ? keepSelection(prev, aj.attendees, scheduledNow) : defaultSelection(aj.attendees, scheduledNow)));
      setOpenPreviews(new Set());
      setPreviewPassId(aj.attendees[0]?.passId || '');
      setFinalPreview('');
      if (t.ok) {
        const tj = await readJson(t, 'loading the certificate design');
        setTemplate(tj.template);
        setPreview(tj.preview);
        setHasBackground(tj.hasBackground);
        setBackground(undefined);
        setSaveState('idle');
      }
      setMsg(null);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || 'Could not load certificates.' });
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [eventId, typeId]);

  const loadFonts = useCallback(async () => {
    try {
      const r = await fetch('/api/certificate-fonts', { headers: authHeaders() });
      if (r.ok) setCustomFonts((await readJson(r, 'loading fonts')).fonts || []);
    } catch { /* built-in fonts still work */ }
  }, []);

  useEffect(() => {
    if (isOpen) { load(); loadFonts(); }
  }, [isOpen, load, loadFonts]);

  /** Any design edit goes through here so it is auto-saved and the preview refreshes. */
  const edit = useCallback((fn: (t: Template) => Template) => {
    setTemplate((t) => (t ? fn(t) : t));
    versionRef.current += 1;
    setSaveState('dirty');
  }, []);

  const saveDesign = useCallback(async () => {
    const t = templateRef.current;
    if (!t || !eventId) return;
    const version = versionRef.current;
    setSaveState('saving');
    try {
      const res = await fetch(`/api/events/${eventId}/certificate-template?typeId=${typeId}`, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ ...t, background: backgroundRef.current }) });
      const data = await readJson(res, 'saving the design');
      if (!res.ok) throw new Error(data.error || 'Failed to save.');
      setPreview(data.preview);
      setHasBackground(data.hasBackground);
      setMsg((m) => (m && m.kind === 'err' ? null : m));
      if (versionRef.current === version) {
        setBackground(undefined);
        setSaveState('saved');
      } else setSaveState('dirty');
    } catch (e: any) {
      setSaveState('dirty');
      setMsg({ kind: 'err', text: e.message });
    }
  }, [eventId, typeId]);

  // Auto-save shortly after the last edit so the preview always matches
  useEffect(() => {
    if (saveState !== 'dirty' || !canEditDesign) return;
    const h = setTimeout(saveDesign, 1000);
    return () => clearTimeout(h);
  }, [saveState, template, background, canEditDesign, saveDesign]);

  const loadFinalPreview = useCallback(async () => {
    if (!previewPassId || !eventId) return;
    setBusy(true);
    try {
      if (saveState === 'dirty') await saveDesign();
      const res = await fetch(`/api/events/${eventId}/certificates/preview?typeId=${typeId}&passId=${encodeURIComponent(previewPassId)}`, { headers: authHeaders() });
      const data = await readJson(res, 'building the preview');
      if (!res.ok) throw new Error(data.error || 'Could not build the preview.');
      setFinalPreview(data.preview);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  }, [previewPassId, eventId, typeId, saveState, saveDesign]);

  // The final-preview picker only offers the people ticked in the recipient list (everyone when nothing is ticked)
  useEffect(() => {
    const pool = attendees.filter((a) => selected.has(a.passId));
    const ids = (pool.length > 0 ? pool : attendees).map((a) => a.passId);
    if (!ids.includes(previewPassId)) setPreviewPassId(ids[0] || '');
  }, [attendees, selected, previewPassId]);

  useEffect(() => {
    if (isOpen && openStep === 5) loadFinalPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openStep, previewPassId, isOpen]);

  if (!isOpen) return null;

  const patchBox = (key: CertBoxKey, patch: Partial<CertBox>) =>
    edit((t) => ({ ...t, layout: { ...t.layout, [key]: { ...t.layout[key], ...patch } } }));

  const clampBox = (b: CertBox): Partial<CertBox> => {
    const x = Math.min(Math.max(0, b.x), 98);
    const y = Math.min(Math.max(0, b.y), 98);
    return { x, y, w: Math.min(Math.max(2, b.w), 100 - x), h: Math.min(Math.max(1, b.h), 100 - y) };
  };

  /** Drag the box (mode 'move') or its bottom-right handle (mode 'size') on the preview. */
  const startDrag = (e: React.PointerEvent, key: CertBoxKey, mode: 'move' | 'size') => {
    if (!canEditDesign || !template || !stageRef.current || openStep !== 3) { setActiveBox(key); return; }
    e.preventDefault();
    e.stopPropagation();
    setActiveBox(key);
    const rect = stageRef.current.getBoundingClientRect();
    const start = template.layout[key];
    const sx = e.clientX;
    const sy = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - sx) / rect.width) * 100;
      const dy = ((ev.clientY - sy) / rect.height) * 100;
      const next = mode === 'move' ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: key === 'qr' ? start.h : start.h + dy };
      const clamped = clampBox(key === 'qr' && mode === 'size' ? { ...next, h: ((start.w + dx) / 100) * (rect.width / rect.height) * 100 } : next);
      patchBox(key, mode === 'move' ? { x: clamped.x, y: clamped.y } : { w: clamped.w, h: clamped.h });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const copyLayoutFrom = async (otherId: string) => {
    if (!otherId || !template) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${otherId}/certificate-template`, { headers: authHeaders() });
      const data = await readJson(res, 'copying the layout');
      if (!res.ok) throw new Error(data.error || 'Could not load that design.');
      edit((t) => ({ ...t, layout: data.template.layout, textColor: data.template.textColor }));
      setMsg({ kind: 'ok', text: 'Layout copied from the other event.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const pickArtwork = async (file?: File) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return setMsg({ kind: 'err', text: 'Artwork must be under 25 MB.' });
    try {
      const dataUrl = await shrinkImage(file);
      setBackground(dataUrl);
      setHasBackground(true);
      versionRef.current += 1;
      setSaveState('dirty');
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    }
  };

  const addFont = async (payload: { googleUrl?: string; name?: string; dataUrl?: string }, applyTo: CertBoxKey) => {
    setBusy(true);
    try {
      const res = await fetch('/api/certificate-fonts', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) });
      const data = await readJson(res, 'adding the font');
      if (!res.ok) throw new Error(data.error || 'Could not add the font.');
      setCustomFonts(data.fonts || []);
      patchBox(applyTo, { fontFamily: `custom:${data.id}` });
      setGoogleLink('');
      setMsg({ kind: 'ok', text: 'Font added and selected.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const pickFont = (file: File | undefined, applyTo: CertBoxKey) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return setMsg({ kind: 'err', text: 'Font must be under 8 MB.' });
    const reader = new FileReader();
    reader.onload = () => addFont({ name: file.name, dataUrl: String(reader.result) }, applyTo);
    reader.readAsDataURL(file);
  };

  const removeFont = async (id: string) => {
    if (!window.confirm('Delete this font? Boxes using it fall back to the default serif.')) return;
    const res = await fetch(`/api/certificate-fonts?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
    try {
      if (res.ok) setCustomFonts((await readJson(res, 'deleting the font')).fonts || []);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    }
  };

  /** Saves any pending design edit before moving to another event / certificate type, so nothing is lost. */
  const switchTo = async (nextEvent: string, nextType: string) => {
    if (saveState === 'dirty') await saveDesign();
    setFinalPreview('');
    setStatusFilter('ALL');
    setTypeFilter('ALL'); setCategoryFilter('ALL'); setOrgFilter('ALL'); setDaysFilter('ALL'); setSourceFilter('ALL');
    setRecipientSearch('');
    setEventId(nextEvent);
    setTypeId(nextType);
    setPickerEventId('');
    setPickerSelected(new Set());
    if (nextEvent !== eventId) setTypes([{ id: 'default', name: 'Participation' }]);
  };

  const typeCall = async (method: 'POST' | 'PATCH' | 'DELETE', body?: object, query = '') => {
    const res = await fetch(`/api/events/${eventId}/certificate-types${query}`, { method, headers: authHeaders({ 'Content-Type': 'application/json' }), body: body ? JSON.stringify(body) : undefined });
    const data = await readJson(res, 'updating certificate types');
    if (!res.ok) throw new Error(data.error || 'Could not update certificate types.');
    return data;
  };

  const addType = async () => {
    const name = window.prompt('Name of the new certificate type (e.g. Volunteer, Speaker, Winner):');
    if (!name?.trim()) return;
    const copy = window.confirm(`Start "${name.trim()}" as a copy of the current "${types.find((t) => t.id === typeId)?.name}" design?\n\nOK = copy the current design, Cancel = start from the blank default.`);
    setBusy(true);
    try {
      if (saveState === 'dirty') await saveDesign();
      const data = await typeCall('POST', { name, copyFrom: copy ? typeId : null });
      setTypes(data.types);
      setMsg({ kind: 'ok', text: `Certificate type "${data.created.name}" added.` });
      await switchTo(eventId, data.created.id);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const renameType = async () => {
    const current = types.find((t) => t.id === typeId);
    const name = window.prompt('Rename this certificate type:', current?.name || '');
    if (!name?.trim() || name.trim() === current?.name) return;
    try {
      const data = await typeCall('PATCH', { typeId, name });
      setTypes(data.types);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    }
  };

  const removeType = async () => {
    const current = types.find((t) => t.id === typeId);
    if (typeId === 'default' || !window.confirm(`Delete the "${current?.name}" certificate type and its design?`)) return;
    try {
      const data = await typeCall('DELETE', undefined, `?typeId=${typeId}`);
      setTypes(data.types);
      setMsg({ kind: 'ok', text: 'Certificate type deleted.' });
      await switchTo(eventId, 'default');
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    }
  };

  const downloadRecordPdf = async (passId: string, name: string) => {
    const res = await fetch(`/api/events/${eventId}/certificates/preview?typeId=${typeId}&passId=${encodeURIComponent(passId)}&format=pdf`, { headers: authHeaders() });
    if (!res.ok) return setMsg({ kind: 'err', text: 'Could not build the PDF.' });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `Certificate-${name.replace(/[^\w]+/g, '_')}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Creates a certificate for someone without a pass; optionally emails it, and downloads the PDF straight away otherwise. */
  const createManual = async (mode: 'download' | 'send') => {
    if (!manual.name.trim()) return setMsg({ kind: 'err', text: 'Enter the name to print on the certificate.' });
    if (mode === 'send' && !manual.email.trim()) return setMsg({ kind: 'err', text: 'Enter an email address to send it.' });
    setBusy(true);
    setMsg(null);
    try {
      if (saveState === 'dirty') await saveDesign();
      const res = await fetch(`/api/events/${eventId}/certificates/manual`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ typeId, ...manual, send: mode === 'send', message: { subject: emailSubject, bodyText: emailBody }, background: backgroundChoiceFor(bgPick) }),
      });
      const data = await readJson(res, 'creating the certificate');
      if (!res.ok) {
        if (data.record) await load(true);
        throw new Error(data.error || 'Could not create the certificate.');
      }
      if (mode === 'download') await downloadRecordPdf(data.record.passId, data.record.attendeeName);
      setMsg({ kind: 'ok', text: mode === 'send' ? `Certificate created and emailed to ${manual.email.trim()}.` : `Certificate created for ${data.record.attendeeName} and downloaded.` });
      setManual({ name: '', email: '', organisation: '', category: '' });
      await load(true);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  // ── Members Directory picker ──
  const existingEmails = new Set(attendees.map((a) => (a.email || '').trim().toLowerCase()).filter(Boolean));
  const pickable = members.filter((m) => m.status !== 'Terminated' && (m.email || '').trim());
  const pickerDivisions = Array.from(new Set(pickable.map((m) => m.division).filter(Boolean)));
  const pickerRows = pickable.filter((m) => {
    if (pickerDivision !== 'ALL' && m.division !== pickerDivision) return false;
    const q = pickerSearch.trim().toLowerCase();
    return !q || `${m.name} ${m.email} ${m.role} ${m.department || ''} ${m.division}`.toLowerCase().includes(q);
  });
  // "By event": the people who organised / worked on an event — its committees (leads and members) and anyone given a task for it.
  const pickerEvent = events.find((e) => e.id === (pickerEventId || eventId));
  const pickableById = new Map(pickable.map((m) => [m.id, m]));
  const matchesSearch = (m: Member) => {
    const q = pickerSearch.trim().toLowerCase();
    return !q || `${m.name} ${m.email} ${m.role} ${m.department || ''} ${m.division}`.toLowerCase().includes(q);
  };
  const eventGroups: Array<{ key: string; title: string; note?: string; people: Array<{ m: Member; lead?: boolean }> }> = [];
  if (pickerEvent) {
    for (const c of pickerEvent.committees || []) {
      if (c.approvalStatus === 'rejected' || c.approvalStatus === 'pending_create') continue;
      const ids = Array.from(new Set([...(c.leadMemberId ? [c.leadMemberId] : []), ...(c.memberIds || [])]));
      const people = ids.map((id) => pickableById.get(id)).filter((m): m is Member => !!m && matchesSearch(m)).map((m) => ({ m, lead: m.id === c.leadMemberId }));
      if (people.length) eventGroups.push({ key: c.id, title: c.name, people });
    }
    const taskIds = new Set<string>();
    for (const t of taskList) if (t.eventId === pickerEvent.id) { if (t.assigneeId) taskIds.add(t.assigneeId); (t as any).assigneeIds?.forEach((id: string) => taskIds.add(id)); }
    const taskPeople = Array.from(taskIds).map((id) => pickableById.get(id)).filter((m): m is Member => !!m && matchesSearch(m)).map((m) => ({ m }));
    if (taskPeople.length) eventGroups.push({ key: 'tasks', title: 'Given a task for this event', note: 'Task assignees', people: taskPeople });
  }
  const groupSelectable = (g: { people: Array<{ m: Member }> }) => g.people.filter(({ m }) => !hasCert(m));
  const toggleGroup = (g: { people: Array<{ m: Member }> }) => {
    const ids = groupSelectable(g).map(({ m }) => m.id);
    const allOn = ids.length > 0 && ids.every((id) => pickerSelected.has(id));
    setPickerSelected((prev) => { const n = new Set(prev); ids.forEach((id) => (allOn ? n.delete(id) : n.add(id))); return n; });
  };
  const eventPeopleTotal = new Set(eventGroups.flatMap((g) => g.people.map(({ m }) => m.id))).size;
  const selectEveryoneInEvent = () => setPickerSelected((prev) => { const n = new Set(prev); eventGroups.forEach((g) => groupSelectable(g).forEach(({ m }) => n.add(m.id))); return n; });
  const hasCert = (m: Member) => existingEmails.has(m.email.trim().toLowerCase());
  const memberDetails = (m: Member) => ({ name: m.name, email: m.email.trim(), organisation: m.department || 'RTBI', category: m.role || m.division || '' });
  const togglePick = (id: string) => setPickerSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  /** One member: copy their name / email into the form below (still editable). */
  const fillFromMember = () => {
    const m = pickable.find((x) => pickerSelected.has(x.id));
    if (!m) return;
    setManual(memberDetails(m));
    setPickerOpen(false);
    setPickerSelected(new Set());
    setMsg({ kind: 'ok', text: `Filled in ${m.name}'s details — check them, then create the certificate.` });
  };

  /** Many members: create a certificate record for each, so they join the recipient list ready to send or schedule. */
  const addPickedMembers = async () => {
    const chosen = pickable.filter((m) => pickerSelected.has(m.id) && !hasCert(m));
    if (chosen.length === 0) return setMsg({ kind: 'err', text: 'Everyone selected already has a certificate of this type.' });
    setBusy(true);
    setMsg(null);
    let done = 0;
    const failed: string[] = [];
    const task = beginTask({ label: `Adding ${chosen.length} member${chosen.length === 1 ? '' : 's'} to certificates`, total: chosen.length });
    try {
      if (saveState === 'dirty') await saveDesign();
      for (let i = 0; i < chosen.length; i += 5) {
        await Promise.all(chosen.slice(i, i + 5).map(async (m) => {
          try {
            const res = await fetch(`/api/events/${eventId}/certificates/manual`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ typeId, ...memberDetails(m) }) });
            if (!res.ok) throw new Error();
          } catch {
            failed.push(m.name);
          }
          done += 1;
          setPickerProgress(`Adding ${done}/${chosen.length}…`);
          task.progress(done, failed.length ? `${failed.length} could not be added` : undefined);
        }));
      }
      setMsg({ kind: failed.length ? 'err' : 'ok', text: `Added ${chosen.length - failed.length} member${chosen.length - failed.length === 1 ? '' : 's'} to the recipient list${failed.length ? `. Could not add: ${failed.join(', ')}` : ' — tick them and send or schedule below.'}` });
      task.finish(`Added ${chosen.length - failed.length} of ${chosen.length} to the recipient list.`, { warn: failed.length > 0 });
      setPickerSelected(new Set());
      setPickerOpen(false);
      await load(true);
    } catch (e: any) {
      task.fail(e?.message || 'Could not add the selected people.');
    } finally {
      setPickerProgress('');
      setBusy(false);
    }
  };

  const toggle = (id: string) => setSelected((prev) => { if (scheduledIds.has(id)) return prev; const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const downloadPdf = async () => {
    if (!previewPassId) return;
    const res = await fetch(`/api/events/${eventId}/certificates/preview?typeId=${typeId}&passId=${encodeURIComponent(previewPassId)}&format=pdf`, { headers: authHeaders() });
    if (!res.ok) return setMsg({ kind: 'err', text: 'Could not build the PDF.' });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `Certificate-${(attendees.find((x) => x.passId === previewPassId)?.name || 'sample').replace(/[^\w]+/g, '_')}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const send = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (sendMode === 'later' && !sendAt) return setMsg({ kind: 'err', text: 'Pick the date and time to send.' });
    const when = sendMode === 'later' ? new Date(sendAt).toISOString() : undefined;
    const resend = alreadySentSelected > 0 ? `\n\n${alreadySentSelected} of them already received this certificate and will get it again.` : '';
    if (!window.confirm((sendMode === 'later' ? `Schedule ${ids.length} certificate${ids.length === 1 ? '' : 's'} for ${new Date(sendAt).toLocaleString()}?` : `Email ${ids.length} certificate${ids.length === 1 ? '' : 's'} now?`) + resend)) return;
    setBusy(true);
    setMsg(null);
    const evName = events.find((e) => e.id === eventId)?.title || 'event';
    const task = beginTask({ label: sendMode === 'later' ? `Scheduling ${ids.length} certificate${ids.length === 1 ? '' : 's'}` : `Sending ${ids.length} certificate${ids.length === 1 ? '' : 's'}`, total: 0, detail: `${evName} — generating PDFs and queueing emails…` });
    try {
      if (saveState === 'dirty') await saveDesign();
      const res = await fetch(`/api/events/${eventId}/certificates`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ typeId, passIds: ids, sendAt: when, message: { subject: emailSubject, bodyText: emailBody }, background: backgroundChoiceFor(bgPick) }) });
      const data = await readJson(res, 'sending the certificates');
      if (!res.ok) throw new Error(data.error || 'Failed to send.');
      const skipNote = data.skippedScheduled ? ` ${data.skippedScheduled} ${data.skippedScheduled === 1 ? 'person was' : 'people were'} skipped because they are already in a scheduled send.` : '';
      setMsg(data.scheduled
        ? { kind: 'ok', text: `Scheduled ${ids.length - (data.skippedScheduled || 0)} certificate${ids.length - (data.skippedScheduled || 0) === 1 ? '' : 's'} for ${new Date(data.schedule.sendAt).toLocaleString()}.${skipNote}` }
        : { kind: data.failed ? 'err' : 'ok', text: `Sent ${data.sent} certificate${data.sent === 1 ? '' : 's'}${data.failed ? `, ${data.failed} failed (see the list)` : ''}.${skipNote}` });
      task.finish(data.scheduled ? `Scheduled ${ids.length} certificate${ids.length === 1 ? '' : 's'} for ${new Date(data.schedule.sendAt).toLocaleString()}.` : `${data.sent} certificate${data.sent === 1 ? '' : 's'} queued${data.failed ? `, ${data.failed} failed` : ''} (10-minute hold applies).`, { warn: !data.scheduled && data.failed > 0 });
      await load(true);
    } catch (e: any) {
      task.fail(e.message);
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const cancelSchedule = async (id: string) => {
    const res = await fetch(`/api/events/${eventId}/certificates?scheduleId=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
    let data: any = {};
    try { data = await readJson(res, 'cancelling the scheduled send'); } catch (e: any) { data = { error: e.message }; }
    setMsg(res.ok ? { kind: 'ok', text: 'Scheduled send cancelled.' } : { kind: 'err', text: data.error || 'Could not cancel.' });
    load(true);
  };

  const insertField = (token: string) => {
    const el = emailBodyRef.current;
    if (!el) return setEmailBody((b) => b + token);
    const start = el.selectionStart ?? emailBody.length;
    const end = el.selectionEnd ?? emailBody.length;
    setEmailBody(emailBody.slice(0, start) + token + emailBody.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };
  const eventForEmail = events.find((e) => e.id === eventId);
  const sampleAttendee = attendees.find((a) => selected.has(a.passId)) || attendees[0];
  const emailVars = {
    name: sampleAttendee?.name || 'Attendee Name',
    email: sampleAttendee?.email || 'attendee@example.com',
    event: eventForEmail?.title || 'Your Event',
    date: eventForEmail ? formatEventDateRange(eventForEmail) : '',
    code: 'PREVIEW000',
    verifyUrl: `${typeof window !== 'undefined' ? window.location.origin : ''}/certificate/PREVIEW000`,
  };
  /** The merged fields for one person, so each recipient's own message can be read before sending. */
  const varsFor = (a: Attendee) => ({ ...emailVars, name: a.name, email: a.email, code: a.code || 'ISSUED-ON-SEND', verifyUrl: `${typeof window !== 'undefined' ? window.location.origin : ''}/certificate/${a.code || 'ISSUED-ON-SEND'}` });
  const togglePreview = (id: string) => setOpenPreviews((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedPeople = attendees.filter((a) => selected.has(a.passId));
  const emailReady = emailSubject.trim().length > 0 && emailBody.trim().length > 0;

  const pending = attendees.filter((a) => a.status !== 'Sent' && a.status !== 'Queued').length;
  const counts = CERT_STATUS_FILTERS.reduce((acc, s) => ({ ...acc, [s]: attendees.filter((a) => a.status === s).length }), {} as Record<string, number>);
  const visibleAttendees = attendees.filter((a) => {
    if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
    if (typeFilter !== 'ALL' && (a.passType || '(none)') !== typeFilter) return false;
    if (categoryFilter !== 'ALL' && (a.category || '(none)') !== categoryFilter) return false;
    if (orgFilter !== 'ALL' && (a.organisation || '(none)') !== orgFilter) return false;
    if (sourceFilter === 'pass' && a.manual) return false;
    if (sourceFilter === 'manual' && !a.manual) return false;
    if (daysFilter !== 'ALL') {
      const total = a.totalDays || 0;
      const all = total > 0 ? (a.daysAttended || 0) >= total : true;
      if (daysFilter === 'all' && !all) return false;
      if (daysFilter === 'some' && all) return false;
    }
    const q = recipientSearch.trim().toLowerCase();
    return !q || `${a.name} ${a.email} ${a.organisation || ''} ${a.serial} ${a.code || ''}`.toLowerCase().includes(q);
  });
  const distinct = (pick: (a: Attendee) => string | undefined) => Array.from(new Set(attendees.map((a) => pick(a) || '(none)'))).sort();
  const typeOptions = distinct((a) => a.passType);
  const categoryOptions = distinct((a) => a.category);
  const orgOptions = distinct((a) => a.organisation);
  const anyExtraFilter = [typeFilter, categoryFilter, orgFilter, daysFilter, sourceFilter].some((v) => v !== 'ALL');
  const clearExtraFilters = () => { setTypeFilter('ALL'); setCategoryFilter('ALL'); setOrgFilter('ALL'); setDaysFilter('ALL'); setSourceFilter('ALL'); };
  const scheduledIds = scheduledMap(schedules);
  const visibleSel = visibleSelectionState(selected, visibleAttendees, scheduledIds);
  const sendableCount = attendees.filter((a) => isSelectable(a, scheduledIds)).length;
  const alreadySentSelected = selectedPeople.filter((a) => a.status === 'Sent' || a.status === 'Queued').length;
  const scheduledTag = (id: string) => {
    const at = scheduledIds.get(id);
    return at ? `Scheduled ${new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
  };
  const selectFailed = () => { setStatusFilter('Failed'); setSelected(new Set(attendees.filter((a) => a.status === 'Failed').map((a) => a.passId))); };
  const exportLedgerCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Name', 'Email', 'Organisation', 'Category', 'Pass Serial', 'Certificate Status', 'Certificate ID', 'Issued At', 'Sent At', 'Sent By', 'Error']].concat(
      visibleAttendees.map((a) => [a.name, a.email, a.organisation || '', a.category || '', a.serial, a.status, a.code || '', a.issuedAt || '', a.sentAt || '', a.sentBy || '', a.error || ''])
    );
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `certificates_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const enabledKeys = template ? (Object.keys(template.layout) as CertBoxKey[]).filter((k) => template.layout[k].enabled) : [];
  const showOverlay = template && (openStep === 2 || openStep === 3);
  const box = template ? template.layout[activeBox] : null;

  const numField = (lab: string, v: number, onChange: (n: number) => void, step = 0.5) => (
    <div><label className={label}>{lab}</label><input type="number" step={step} className={numCls} value={Math.round(v * 10) / 10} disabled={!canEditDesign} onChange={(e) => onChange(Number(e.target.value))} /></div>
  );

  const stepDone = (n: number) => {
    if (n === 1) return hasBackground;
    if (n === 2) return enabledKeys.length > 0;
    if (n === 4) return selected.size > 0;
    if (n === 5) return !!finalPreview;
    return false;
  };

  const section = (n: number, body: React.ReactNode) => {
    const open = openStep === n;
    return (
      <div key={n} className={`rounded-2xl border ${open ? 'border-accent/50 bg-accent/5' : 'border-slate-200 dark:border-white/10'}`}>
        <button type="button" onClick={() => setOpenStep(open ? 0 : n)} className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer">
          <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-black ${stepDone(n) ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-white/15 text-slate-700 dark:text-white'}`}>{stepDone(n) ? <Check className="h-3.5 w-3.5" /> : n}</span>
          <span className="flex-1 font-extrabold text-slate-900 dark:text-white text-sm">{STEPS[n - 1]}</span>
          {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </button>
        {open && (
          <div className="px-4 pb-4 space-y-3">
            {body}
            <div className="flex items-center justify-between pt-1">
              <button type="button" disabled={n === 1} onClick={() => setOpenStep(n - 1)} className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white disabled:opacity-30 cursor-pointer">← Back</button>
              {n < STEPS.length && <button type="button" onClick={() => setOpenStep(n + 1)} className="px-4 py-1.5 rounded-lg bg-accent text-white font-extrabold text-xs cursor-pointer">Next: {STEPS[n]} →</button>}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={inline ? '' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-2 md:p-4'}>
      <div className={`glass-panel rounded-3xl p-4 md:p-6 space-y-3 border border-slate-200/90 dark:border-white/15 bg-white/95 dark:bg-[#0D1F38]/95 shadow-2xl flex flex-col ${inline ? 'w-full h-[calc(100vh-14rem)] min-h-[640px]' : 'w-[98vw] max-w-[1700px] h-[95vh]'}`}>
        <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 pb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-accent/20 border border-accent/30 flex items-center justify-center text-accent"><Award className="h-5 w-5" /></div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">Attendance Certificates</h2>
              <p className="text-xs text-slate-600 dark:text-slate-300">Build the certificate step by step, preview the final PDFs, then send or schedule them.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold text-slate-500">{saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved changes…' : saveState === 'saved' ? 'All changes saved' : ''}</span>
            {!inline && <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 cursor-pointer"><X className="h-5 w-5" /></button>}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 text-xs">
          <div className="flex-1 min-w-[220px] max-w-xl">
            <label className={label}>Event</label>
            <select value={eventId} onChange={(e) => switchTo(e.target.value, 'default')} className={field}>
              {events.filter((e) => !e.isHoliday).map((e) => (
                <option key={e.id} value={e.id} className="bg-slate-900 text-white">{e.title}{endedEvents.some((x) => x.id === e.id) ? '' : ' (not ended)'}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[200px]">
            <label className={label}>Certificate type</label>
            <div className="flex items-center gap-1.5">
              <select value={typeId} onChange={(e) => switchTo(eventId, e.target.value)} disabled={loading} className={`${field} !w-auto min-w-[160px]`}>
                {types.map((t) => <option key={t.id} value={t.id} className="bg-slate-900 text-white">{t.name}</option>)}
              </select>
              {canEditDesign && (
                <>
                  <button type="button" title="Add a certificate type" onClick={addType} disabled={busy || loading} className="h-9 px-2.5 rounded-xl bg-accent/15 text-accent border border-accent/30 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> New type</button>
                  <button type="button" title="Rename this type" onClick={renameType} disabled={busy || loading} className="h-9 w-9 rounded-xl border border-slate-300 dark:border-white/15 text-slate-500 flex items-center justify-center cursor-pointer disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button>
                  {typeId !== 'default' && <button type="button" title="Delete this type" onClick={removeType} disabled={busy || loading} className="h-9 w-9 rounded-xl border border-rose-500/30 text-rose-400 flex items-center justify-center cursor-pointer disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>}
                </>
              )}
            </div>
          </div>
          {!canEditDesign && <p className="text-amber-500 font-semibold">You can preview the design but not change it.</p>}
        </div>

        {msg && (
          <div className={`flex items-center gap-2 p-3 rounded-2xl text-xs border ${msg.kind === 'ok' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/15 border-rose-500/30 text-rose-300'}`}>
            {msg.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}

        {loading && !template && <CertificateSkeleton />}

        {template && (
          <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(520px,5fr)_minmax(0,7fr)] gap-5 text-xs">
            {/* Steps */}
            <div className="overflow-y-auto pr-1 space-y-2.5">
              {section(1, (
                <div className="space-y-2">
                  <p className="text-slate-600 dark:text-slate-300">Upload the certificate background (A4 landscape, PNG / JPG / WebP). Skip it to use the simple framed design.</p>
                  <div className="flex items-center gap-2">
                    <label className={`px-3 py-2 rounded-xl bg-accent/15 text-accent border border-accent/30 font-bold flex items-center gap-1.5 ${canEditDesign ? 'cursor-pointer' : 'opacity-50'}`}>
                      <ImagePlus className="h-3.5 w-3.5" /> {hasBackground ? 'Replace background' : 'Upload background'}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={!canEditDesign} onChange={(e) => pickArtwork(e.target.files?.[0])} />
                    </label>
                    {hasBackground && canEditDesign && (
                      <button type="button" className="px-3 py-2 rounded-xl text-rose-400 border border-rose-500/30 font-bold flex items-center gap-1.5 cursor-pointer" onClick={() => { setBackground(null); setHasBackground(false); versionRef.current += 1; setSaveState('dirty'); }}>
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {section(2, (
                <div className="space-y-2">
                  <p className="text-slate-600 dark:text-slate-300">Tick everything you want printed on the certificate, and type its wording.</p>
                  {(Object.keys(CERT_BOX_LABELS) as CertBoxKey[]).map((k) => {
                    const on = template.layout[k].enabled;
                    return (
                      <div key={k} className={`rounded-xl border p-2.5 ${on ? 'border-accent/40 bg-white/60 dark:bg-white/5' : 'border-slate-200 dark:border-white/10'}`}>
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input type="checkbox" className="mt-0.5" checked={on} disabled={!canEditDesign} onChange={(e) => { patchBox(k, { enabled: e.target.checked }); if (e.target.checked) setActiveBox(k); }} />
                          <span>
                            <span className="font-extrabold text-slate-900 dark:text-white block">{CERT_BOX_LABELS[k]}</span>
                            <span className="text-[10px] text-slate-500">{BOX_HINTS[k]}</span>
                          </span>
                        </label>
                        {on && k === 'title' && <input className={`${field} mt-2`} value={template.title} onChange={(e) => edit((t) => ({ ...t, title: e.target.value }))} disabled={!canEditDesign} />}
                        {on && k === 'intro' && <input className={`${field} mt-2`} value={template.introText} onChange={(e) => edit((t) => ({ ...t, introText: e.target.value }))} disabled={!canEditDesign} />}
                        {on && k === 'body' && <textarea rows={3} className={`${field} mt-2`} value={template.bodyText} onChange={(e) => edit((t) => ({ ...t, bodyText: e.target.value }))} disabled={!canEditDesign} />}
                        {on && k === 'signatory' && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <input className={field} placeholder="Signatory name" value={template.signatoryName} onChange={(e) => edit((t) => ({ ...t, signatoryName: e.target.value }))} disabled={!canEditDesign} />
                            <input className={field} placeholder="Designation" value={template.signatoryTitle} onChange={(e) => edit((t) => ({ ...t, signatoryTitle: e.target.value }))} disabled={!canEditDesign} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {section(3, box && (
                <div className="space-y-3">
                  <p className="text-slate-600 dark:text-slate-300">Pick an item, then drag it on the preview (corner handle resizes) or type exact values.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {enabledKeys.map((k) => (
                      <button key={k} type="button" onClick={() => setActiveBox(k)} className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${activeBox === k ? 'bg-accent text-white' : 'bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white'}`}>{CERT_BOX_LABELS[k]}</button>
                    ))}
                    {enabledKeys.length === 0 && <span className="text-amber-500 font-semibold">Nothing is ticked in step 2.</span>}
                  </div>
                  {enabledKeys.includes(activeBox) && (
                    <div className="space-y-2.5 p-3 rounded-2xl border border-accent/30 bg-accent/5">
                      <div className="font-extrabold text-slate-800 dark:text-white">Text box: {CERT_BOX_LABELS[activeBox]}</div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {numField('X %', box.x, (n) => patchBox(activeBox, clampBox({ ...box, x: n })))}
                        {numField('Y %', box.y, (n) => patchBox(activeBox, clampBox({ ...box, y: n })))}
                        {numField('Width %', box.w, (n) => patchBox(activeBox, clampBox({ ...box, w: n })))}
                        {numField('Height %', box.h, (n) => patchBox(activeBox, clampBox({ ...box, h: n })))}
                      </div>
                      {activeBox !== 'qr' && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className={label}>Font</label>
                              <select className={field} value={box.fontFamily} disabled={!canEditDesign} onChange={(e) => patchBox(activeBox, { fontFamily: e.target.value })}>
                                {CERT_FONT_OPTIONS.map((f) => <option key={f.id} value={f.id} className="bg-slate-900 text-white">{f.label}</option>)}
                                {customFonts.map((f) => <option key={f.id} value={`custom:${f.id}`} className="bg-slate-900 text-white">{f.label} (custom)</option>)}
                                {box.fontFamily.startsWith('custom:') && !customFonts.some((f) => `custom:${f.id}` === box.fontFamily) && <option value={box.fontFamily} className="bg-slate-900 text-white">{box.fontFamily.slice(7)} (missing)</option>}
                              </select>
                            </div>
                            {numField('Font size (px)', box.fontSize, (n) => patchBox(activeBox, { fontSize: n }), 1)}
                          </div>
                          {canEditDesign && (
                            <div className="space-y-1.5 p-2 rounded-xl bg-slate-500/5 border border-slate-300/40 dark:border-white/10">
                              <div className="flex flex-wrap items-center gap-2">
                                <label className="px-3 py-1.5 rounded-lg bg-accent/15 text-accent border border-accent/30 font-bold cursor-pointer">
                                  Upload font (.ttf .otf .woff)
                                  <input type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" disabled={busy} onChange={(e) => { pickFont(e.target.files?.[0], activeBox); e.target.value = ''; }} />
                                </label>
                                {box.fontFamily.startsWith('custom:') && (
                                  <button type="button" className="px-3 py-1.5 rounded-lg text-rose-400 border border-rose-500/30 font-bold cursor-pointer" onClick={() => removeFont(box.fontFamily.slice(7))}>Delete this font</button>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <input className={field} placeholder="Google Fonts link, e.g. https://fonts.google.com/specimen/Great+Vibes" value={googleLink} onChange={(e) => setGoogleLink(e.target.value)} />
                                <button type="button" disabled={busy || !googleLink.trim()} onClick={() => addFont({ googleUrl: googleLink }, activeBox)} className="px-3 py-1.5 rounded-lg bg-accent text-white font-bold cursor-pointer disabled:opacity-50 shrink-0">Import</button>
                              </div>
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-3">
                            {([['bold', 'Bold'], ['italic', 'Italic'], ['autoFit', 'Shrink to fit box'], ['underline', 'Underline']] as const).map(([k, lab]) => (
                              <label key={k} className="flex items-center gap-1.5 font-bold text-slate-600 dark:text-slate-300">
                                <input type="checkbox" checked={box[k]} disabled={!canEditDesign} onChange={(e) => patchBox(activeBox, { [k]: e.target.checked })} /> {lab}
                              </label>
                            ))}
                          </div>
                          {activeBox === 'name' ? (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className={label}>Vertical</label>
                                <select className={field} value={box.valign} disabled={!canEditDesign} onChange={(e) => patchBox('name', { valign: e.target.value as CertBox['valign'] })}>
                                  <option value="top" className="bg-slate-900">Top</option><option value="middle" className="bg-slate-900">Middle</option><option value="bottom" className="bg-slate-900">Bottom (letters sit on the box&apos;s bottom edge)</option>
                                </select>
                              </div>
                              <p className="text-[10px] text-slate-500 self-end">The name is always centred horizontally in its box.</p>
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className={label}>Align</label>
                                <select className={field} value={box.align} disabled={!canEditDesign} onChange={(e) => patchBox(activeBox, { align: e.target.value as CertBox['align'] })}>
                                  <option value="left" className="bg-slate-900">Left</option><option value="center" className="bg-slate-900">Centre</option><option value="right" className="bg-slate-900">Right</option>
                                </select>
                              </div>
                              <div>
                                <label className={label}>Vertical</label>
                                <select className={field} value={box.valign} disabled={!canEditDesign} onChange={(e) => patchBox(activeBox, { valign: e.target.value as CertBox['valign'] })}>
                                  <option value="top" className="bg-slate-900">Top</option><option value="middle" className="bg-slate-900">Middle</option><option value="bottom" className="bg-slate-900">Bottom</option>
                                </select>
                              </div>
                              {numField('Max lines (0 = any)', box.maxLines, (n) => patchBox(activeBox, { maxLines: Math.round(n) }), 1)}
                            </div>
                          )}
                        </>
                      )}
                      <div className="flex items-center gap-2">
                        <label className={`${label} mb-0`}>Box colour</label>
                        <input type="color" value={box.color || template.textColor} disabled={!canEditDesign} onChange={(e) => patchBox(activeBox, { color: e.target.value })} />
                        {box.color && <button type="button" className="text-[11px] font-bold text-accent hover:underline cursor-pointer" disabled={!canEditDesign} onClick={() => patchBox(activeBox, { color: '' })}>Use default</button>}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 font-bold text-slate-600 dark:text-slate-300">Default text colour
                      <input type="color" value={template.textColor} onChange={(e) => edit((t) => ({ ...t, textColor: e.target.value }))} disabled={!canEditDesign} />
                    </label>
                    {canEditDesign && (
                      <select className={`${field} !w-auto`} value="" disabled={busy} onChange={(e) => copyLayoutFrom(e.target.value)}>
                        <option value="" className="bg-slate-900 text-white">Copy layout from event…</option>
                        {events.filter((e) => !e.isHoliday && e.id !== eventId).map((e) => <option key={e.id} value={e.id} className="bg-slate-900 text-white">{e.title}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              ))}

              {section(4, (
                <div className="space-y-3">
                  <div>
                    <label className={label}>Print in the name box</label>
                    <select className={field} value={template.nameSource} disabled={!canEditDesign} onChange={(e) => edit((t) => ({ ...t, nameSource: e.target.value as Template['nameSource'] }))}>
                      <option value="name" className="bg-slate-900">Attendee name</option>
                      <option value="organisation" className="bg-slate-900">Organisation</option>
                      <option value="category" className="bg-slate-900">Guest category</option>
                      <option value="serial" className="bg-slate-900">Pass serial number</option>
                    </select>
                  </div>
                  <p className="text-[10px] text-slate-500">This applies to certificates for event passes. People added manually, including from the Members Directory, always print their own name here.</p>
                  <p className="text-[10px] text-slate-500">Merge fields for the wording: <code>@name</code> <code>@organisation</code> <code>@category</code> <code>@serial</code> <code>@event_name</code> <code>@event_date</code>. Each is filled from the attendee&apos;s pass when the PDF is made.</p>
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-slate-800 dark:text-white">Recipients ({selected.size}/{attendees.length} selected · {pending} not yet sent{visibleSel.hiddenSelected > 0 ? ` · ${visibleSel.hiddenSelected} ticked outside this filter` : ''})</span>
                    <button type="button" disabled={visibleSel.selectable.length === 0} className="font-bold text-accent hover:underline cursor-pointer disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed" title="Ticks only the people shown below and unticks everyone else; anyone already sent, queued or scheduled is skipped" onClick={() => setSelected(visibleSel.allOn && visibleSel.hiddenSelected === 0 ? toggleVisible(selected, visibleAttendees, scheduledIds) : selectOnlyVisible(visibleAttendees, scheduledIds))}>
                      {visibleSel.allOn && visibleSel.hiddenSelected === 0 ? 'Deselect all shown' : 'Select only shown'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                    <button type="button" onClick={() => setStatusFilter('ALL')} className={`px-2 py-0.5 rounded-full border cursor-pointer ${statusFilter === 'ALL' ? 'bg-accent/20 text-accent border-accent/40' : 'border-slate-300 dark:border-white/15 text-slate-500'}`}>All {attendees.length}</button>
                    {CERT_STATUS_FILTERS.map((s) => (
                      <button key={s} type="button" onClick={() => setStatusFilter(statusFilter === s ? 'ALL' : s)} className={`px-2 py-0.5 rounded-full border cursor-pointer ${statusFilter === s ? 'bg-accent/20 text-accent border-accent/40' : 'border-slate-300 dark:border-white/15 text-slate-500'}`}>{s} {counts[s] || 0}</button>
                    ))}
                  </div>
                  {typeOptions.length > 1 && (
                    <div className="rounded-xl border border-accent/30 bg-accent/5 p-2.5 space-y-1.5">
                      <div className="font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[10px]">Quick pick by pass type — ticks everyone of that type who still needs a certificate</div>
                      <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                        {typeOptions.map((t) => {
                          const ofType = attendees.filter((a) => (a.passType || '(none)') === t);
                          const todo = ofType.filter((a) => isSelectable(a, scheduledIds)).map((a) => a.passId);
                          const on = typeFilter === t;
                          return (
                            <button key={t} type="button" disabled={todo.length === 0} onClick={() => { setTypeFilter(t); setSelected(new Set(todo)); }} className={`px-2.5 py-1 rounded-full border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-accent/20 text-accent border-accent/40' : 'border-slate-300 dark:border-white/15 text-slate-600 dark:text-slate-300'}`} title={todo.length === 0 ? 'Everyone of this type already has a certificate sent, queued or scheduled' : `Select the ${todo.length} ${t} recipient${todo.length === 1 ? '' : 's'} still to be sent`}>
                              {t} · {todo.length} to send
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-slate-500">Then continue to the wording and use <strong>Send now</strong> or <strong>Schedule</strong> — only the ticked people receive it.</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {typeOptions.length > 1 && <select aria-label="Filter by pass type" className={field} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="ALL" className="bg-slate-900">All pass types</option>{typeOptions.map((o) => <option key={o} value={o} className="bg-slate-900">{o}</option>)}</select>}
                    {categoryOptions.length > 1 && <select aria-label="Filter by guest category" className={field} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="ALL" className="bg-slate-900">All guest categories</option>{categoryOptions.map((o) => <option key={o} value={o} className="bg-slate-900">{o}</option>)}</select>}
                    {orgOptions.length > 1 && <select aria-label="Filter by organisation" className={field} value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}><option value="ALL" className="bg-slate-900">All organisations</option>{orgOptions.map((o) => <option key={o} value={o} className="bg-slate-900">{o}</option>)}</select>}
                    <select aria-label="Filter by days attended" className={field} value={daysFilter} onChange={(e) => setDaysFilter(e.target.value)}><option value="ALL" className="bg-slate-900">Any attendance</option><option value="all" className="bg-slate-900">Attended every valid day</option><option value="some" className="bg-slate-900">Missed some days</option></select>
                    <select aria-label="Filter by source" className={field} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}><option value="ALL" className="bg-slate-900">Passes + manual</option><option value="pass" className="bg-slate-900">Event passes only</option><option value="manual" className="bg-slate-900">Added manually only</option></select>
                    {anyExtraFilter && <button type="button" onClick={clearExtraFilters} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-white/15 text-slate-500 font-bold cursor-pointer">Clear filters</button>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input className={`${field} flex-1 min-w-[140px]`} placeholder="Search name, email, organisation, serial or certificate ID" value={recipientSearch} onChange={(e) => setRecipientSearch(e.target.value)} />
                    {counts['Failed'] > 0 && <button type="button" onClick={selectFailed} className="px-3 py-2 rounded-xl bg-rose-500/15 text-rose-500 border border-rose-500/30 font-bold cursor-pointer">Retry failed ({counts['Failed']})</button>}
                    <button type="button" onClick={exportLedgerCsv} disabled={visibleAttendees.length === 0} className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"><Download className="h-3.5 w-3.5" /> CSV</button>
                  </div>
                  <div className="border border-slate-200 dark:border-white/10 rounded-xl divide-y divide-slate-100 dark:divide-white/5 max-h-[50vh] overflow-y-auto">
                    {attendees.length === 0 && <div className="py-6 text-center text-slate-400">{busy ? 'Loading…' : 'No checked-in attendees with an email address for this event.'}</div>}
                    {attendees.length > 0 && visibleAttendees.length === 0 && <div className="py-6 text-center text-slate-400">No one matches this filter.</div>}
                    {visibleAttendees.map((a) => (
                      <div key={a.passId} onClick={() => toggle(a.passId)} className={`flex items-center justify-between gap-2 p-2 ${scheduledIds.has(a.passId) ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/10 cursor-pointer'}`}>
                        <div className="flex items-start gap-2 min-w-0">
                          {selected.has(a.passId) ? <CheckSquare className="h-4 w-4 text-accent shrink-0 mt-0.5" /> : <Square className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />}
                          <div className="min-w-0">
                            <span className="font-bold text-slate-900 dark:text-white block break-words">{a.name}{a.manual && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 align-middle">Manual</span>}{scheduledIds.has(a.passId) && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 align-middle">{scheduledTag(a.passId)}</span>}</span>
                            <span className="text-[10px] text-slate-400 block break-all">{a.email}{a.organisation ? ` · ${a.organisation}` : ''}{a.category ? ` · ${a.category}` : ''}</span>
                            {a.status === 'Failed' && a.error && <span className="text-[10px] text-rose-400 block break-words">{a.error}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          {a.manual && <button type="button" title="Download this certificate as a PDF" onClick={(ev) => { ev.stopPropagation(); downloadRecordPdf(a.passId, a.name); }} className="h-7 w-7 rounded-lg border border-slate-300 dark:border-white/15 text-slate-500 flex items-center justify-center cursor-pointer"><Download className="h-3.5 w-3.5" /></button>}
                          <CertificateStatusBadge status={a.status} sentAt={a.sentAt} issuedAt={a.issuedAt} error={a.error} sentBy={a.sentBy} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-white/10">
                    <button type="button" onClick={() => setManualOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer">
                      <UserPlus className="h-4 w-4 text-accent" />
                      <span className="flex-1 font-extrabold text-slate-900 dark:text-white">Add someone manually</span>
                      {manualOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                    </button>
                    {manualOpen && (
                      <div className="px-3 pb-3 space-y-2">
                        <p className="text-[10px] text-slate-500">For someone without an event pass. Uses the &ldquo;{types.find((t) => t.id === typeId)?.name}&rdquo; design, and the person is added to the list above.</p>
                        {canPickMembers && (
                          <div className="rounded-xl border border-slate-200 dark:border-white/10">
                            <button type="button" onClick={() => setPickerOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer">
                              <Users className="h-4 w-4 text-accent" />
                              <span className="flex-1 font-bold text-slate-800 dark:text-white">Pick people — Members Directory or an event&apos;s team</span>
                              {pickerOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                            </button>
                            {pickerOpen && (
                              <div className="px-3 pb-3 space-y-2">
                                <div className="flex gap-1.5 text-[11px] font-bold">
                                  {([['directory', 'Members Directory'], ['event', 'By event (committees & team)']] as const).map(([k, lab]) => (
                                    <button key={k} type="button" onClick={() => setPickerMode(k)} className={`px-3 py-1.5 rounded-lg border cursor-pointer ${pickerMode === k ? 'bg-accent text-white border-accent' : 'border-slate-300 dark:border-white/15 text-slate-600 dark:text-slate-300'}`}>{lab}</button>
                                  ))}
                                </div>
                                {pickerMode === 'event' && (
                                  <select className={field} value={pickerEvent?.id || ''} onChange={(e) => setPickerEventId(e.target.value)}>
                                    {events.filter((e) => !e.isHoliday).map((e) => <option key={e.id} value={e.id} className="bg-slate-900 text-white">{e.title}{e.id === eventId ? ' (this event)' : ''}</option>)}
                                  </select>
                                )}
                                <input className={field} placeholder="Search name, email, role or department" value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} />
                                {pickerMode === 'directory' && (
                                <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                                  {['ALL', ...pickerDivisions].map((d) => (
                                    <button key={d} type="button" onClick={() => setPickerDivision(d)} className={`px-2 py-0.5 rounded-full border cursor-pointer ${pickerDivision === d ? 'bg-accent/20 text-accent border-accent/40' : 'border-slate-300 dark:border-white/15 text-slate-500'}`}>{d === 'ALL' ? 'All' : d}</button>
                                  ))}
                                </div>
                                )}
                                {pickerMode === 'event' && (
                                  <div className="border border-slate-200 dark:border-white/10 rounded-xl max-h-64 overflow-y-auto">
                                    {eventGroups.length === 0 ? (
                                      <div className="py-4 px-3 text-center text-slate-400">{pickerEvent ? 'No committee members or task assignees with an email for this event.' : 'Pick an event.'}</div>
                                    ) : (
                                      <>
                                        <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
                                          <span className="text-[10px] font-bold text-slate-500">{eventPeopleTotal} {eventPeopleTotal === 1 ? 'person' : 'people'} across {eventGroups.length} group{eventGroups.length === 1 ? '' : 's'}</span>
                                          <button type="button" onClick={selectEveryoneInEvent} className="text-[11px] font-bold text-accent hover:underline cursor-pointer">Select everyone</button>
                                        </div>
                                        {eventGroups.map((g) => {
                                          const sel = groupSelectable(g);
                                          const allOn = sel.length > 0 && sel.every(({ m }) => pickerSelected.has(m.id));
                                          return (
                                            <div key={g.key} className="border-b last:border-b-0 border-slate-200 dark:border-white/10">
                                              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                                                <span className="font-extrabold text-slate-800 dark:text-white break-words">{g.title} <span className="text-[10px] font-bold text-slate-400">({g.people.length})</span></span>
                                                <button type="button" disabled={sel.length === 0} onClick={() => toggleGroup(g)} className="text-[11px] font-bold text-accent hover:underline cursor-pointer disabled:opacity-40 shrink-0">{allOn ? 'Deselect group' : 'Select group'}</button>
                                              </div>
                                              <div className="divide-y divide-slate-100 dark:divide-white/5">
                                                {g.people.map(({ m, lead }) => {
                                                  const has = hasCert(m);
                                                  return (
                                                    <label key={m.id} className={`flex items-center gap-2 px-2 py-1.5 ${has ? 'opacity-50' : 'hover:bg-white/10 cursor-pointer'}`}>
                                                      <input type="checkbox" disabled={has} checked={pickerSelected.has(m.id)} onChange={() => togglePick(m.id)} />
                                                      <span className="min-w-0 flex-1">
                                                        <span className="font-bold text-slate-900 dark:text-white block break-words">{m.name}{lead && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 align-middle">Lead</span>}</span>
                                                        <span className="text-[10px] text-slate-400 block break-all">{m.email} · {m.role}</span>
                                                      </span>
                                                      {has && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 shrink-0">Already has one</span>}
                                                    </label>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </>
                                    )}
                                  </div>
                                )}
                                {pickerMode === 'directory' && (
                                <div className="border border-slate-200 dark:border-white/10 rounded-xl divide-y divide-slate-100 dark:divide-white/5 max-h-48 overflow-y-auto">
                                  {pickerRows.length === 0 && <div className="py-4 text-center text-slate-400">{members.length === 0 ? 'No members loaded yet.' : 'No members match.'}</div>}
                                  {pickerRows.map((m) => {
                                    const has = hasCert(m);
                                    return (
                                      <label key={m.id} className={`flex items-center gap-2 p-2 ${has ? 'opacity-50' : 'hover:bg-white/10 cursor-pointer'}`}>
                                        <input type="checkbox" disabled={has} checked={pickerSelected.has(m.id)} onChange={() => togglePick(m.id)} />
                                        <span className="min-w-0 flex-1">
                                          <span className="font-bold text-slate-900 dark:text-white block break-words">{m.name}</span>
                                          <span className="text-[10px] text-slate-400 block break-all">{m.email} · {m.role}{` · ${m.division}`}</span>
                                        </span>
                                        {has && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 shrink-0">Already has one</span>}
                                      </label>
                                    );
                                  })}
                                </div>
                                )}
                                <div className="flex flex-wrap items-center gap-2">
                                  <button type="button" disabled={busy || pickerSelected.size !== 1} onClick={fillFromMember} className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white font-bold cursor-pointer disabled:opacity-50">Fill the form with this member</button>
                                  <button type="button" disabled={busy || !canSend || pickerSelected.size === 0} onClick={addPickedMembers} className="px-3 py-2 rounded-xl bg-accent text-white font-extrabold cursor-pointer disabled:opacity-50">Add {pickerSelected.size || ''} selected as recipients</button>
                                  {pickerProgress && <span className="text-[10px] text-slate-500">{pickerProgress}</span>}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div><label className={label}>Name on certificate *</label><input className={field} value={manual.name} maxLength={120} onChange={(e) => setManual({ ...manual, name: e.target.value })} /></div>
                          <div><label className={label}>Email (to send it)</label><input type="email" className={field} value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} /></div>
                          <div><label className={label}>Organisation</label><input className={field} value={manual.organisation} maxLength={120} onChange={(e) => setManual({ ...manual, organisation: e.target.value })} /></div>
                          <div><label className={label}>Category</label><input className={field} value={manual.category} maxLength={80} onChange={(e) => setManual({ ...manual, category: e.target.value })} /></div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={busy || !canSend || !manual.name.trim()} onClick={() => createManual('download')} className="px-3 py-2 rounded-xl bg-accent text-white font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Create &amp; download PDF</button>
                          <button type="button" disabled={busy || !canSend || !manual.name.trim() || !manual.email.trim()} onClick={() => createManual('send')} className="px-3 py-2 rounded-xl bg-accent/15 text-accent border border-accent/30 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"><Send className="h-3.5 w-3.5" /> Create &amp; email</button>
                        </div>
                        {!canSend && <p className="text-[10px] text-amber-500">You need the Send Certificates permission to create certificates.</p>}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {section(5, (
                <div className="space-y-2">
                  <p className="text-slate-600 dark:text-slate-300">See the real certificate for {selectedPeople.length > 0 ? `the ${selectedPeople.length} selected recipient${selectedPeople.length === 1 ? '' : 's'}` : 'any attendee'}, exactly as the PDF will be emailed.</p>
                  <select className={field} value={previewPassId} onChange={(e) => setPreviewPassId(e.target.value)}>
                    {(selectedPeople.length > 0 ? selectedPeople : attendees).map((a) => <option key={a.passId} value={a.passId} className="bg-slate-900 text-white">{a.name}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy || !previewPassId} onClick={loadFinalPreview} className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh</button>
                    <button type="button" disabled={!previewPassId} onClick={downloadPdf} className="px-3 py-2 rounded-xl bg-accent/15 text-accent border border-accent/30 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"><Download className="h-3.5 w-3.5" /> Download PDF</button>
                  </div>
                </div>
              ))}

              {section(6, (
                <div className="space-y-3">
                  {!eventOver && sendMode === 'now' && <p className="text-amber-500 font-semibold">Sending opens on the event's last day — send now becomes available then. You can schedule it for that day or later.</p>}
                  <div className="flex flex-wrap gap-4 font-bold text-slate-700 dark:text-slate-200">
                    <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={sendMode === 'now'} onChange={() => setSendMode('now')} /> Send now</label>
                    <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={sendMode === 'later'} onChange={() => setSendMode('later')} /> Schedule</label>
                  </div>
                  <button type="button" onClick={() => setEmailEditorOpen((o) => !o)} aria-expanded={emailEditorOpen} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-accent/40 bg-accent/10 text-left cursor-pointer">
                    <Mail className="h-4 w-4 text-accent shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="font-extrabold text-slate-900 dark:text-white block">Customize certificate email</span>
                      <span className="text-[10px] text-slate-500 block truncate">Subject: {emailSubject || '(none)'}</span>
                    </span>
                    {emailEditorOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </button>
                  {emailEditorOpen && (<>
                  <div className="space-y-2 p-3 rounded-xl border border-slate-200 dark:border-white/10">
                    <div className="flex items-center justify-between gap-2">
                      <label className={`${label} mb-0`}>Email message</label>
                      <button type="button" onClick={() => { setEmailSubject(DEFAULT_CERT_EMAIL.subject); setEmailBody(DEFAULT_CERT_EMAIL.bodyText); }} className="text-[10px] font-bold text-accent cursor-pointer">Reset to default</button>
                    </div>
                    <input className={field} maxLength={CERT_EMAIL_MAX_SUBJECT} value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Subject" />
                    <textarea ref={emailBodyRef} rows={8} maxLength={CERT_EMAIL_MAX_BODY} className={`${field} font-sans`} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder="Write the message that goes with the certificate" />
                    <div className="flex flex-wrap gap-1.5">
                      {CERT_EMAIL_FIELDS.map((f) => (
                        <button key={f.token} type="button" title={f.label} onClick={() => insertField(f.token)} className="px-2 py-1 rounded-lg bg-accent/10 text-accent border border-accent/30 font-bold cursor-pointer">{f.token}</button>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500">Each placeholder is filled in for every attendee. The certificate PDF is always attached.</p>
                  </div>

                  <EmailBackgroundPicker value={bgPick} onChange={setBgPick} disabled={busy} />
                  </>)}

                  <div className="space-y-2 p-3 rounded-xl border border-slate-200 dark:border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className={`${label} mb-0`}>Who gets this ({selected.size} selected in Link to data)</label>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold">
                        <button type="button" className="text-accent hover:underline cursor-pointer" onClick={() => setOpenStep(4)}>Change selection (Link to data)</button>
                        <button type="button" className="text-slate-500 hover:underline cursor-pointer" onClick={() => setOpenPreviews(openPreviews.size ? new Set() : new Set(selectedPeople.map((a) => a.passId)))}>{openPreviews.size ? 'Hide all messages' : 'Show all messages'}</button>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500">Only the people you selected in <strong>Link to data</strong> are listed. Remove anyone here, or go back to Link to data to pick a different group. Open any row to read that person&apos;s own message.</p>
                    <div className="border border-slate-200 dark:border-white/10 rounded-xl divide-y divide-slate-100 dark:divide-white/5 max-h-[45vh] overflow-y-auto">
                      {selectedPeople.length === 0 && <div className="py-4 text-center text-slate-400">Nobody is selected. Go to Link to data and tick the people this send is for.</div>}
                      {selectedPeople.map((a) => {
                        const on = selected.has(a.passId);
                        const open = openPreviews.has(a.passId);
                        const v = varsFor(a);
                        return (
                          <div key={a.passId} className={on ? 'bg-accent/5' : ''}>
                            <div className="flex items-start justify-between gap-2 p-2">
                              <button type="button" disabled={scheduledIds.has(a.passId)} onClick={() => toggle(a.passId)} className={`flex items-start gap-2 min-w-0 flex-1 text-left ${scheduledIds.has(a.passId) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                                {on ? <CheckSquare className="h-4 w-4 text-accent shrink-0 mt-0.5" /> : <Square className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />}
                                <span className="min-w-0">
                                  <span className="font-bold text-slate-900 dark:text-white block break-words">{a.name}{a.manual && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 align-middle">Manual</span>}{scheduledIds.has(a.passId) && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 align-middle">{scheduledTag(a.passId)}</span>}</span>
                                  <span className="text-[10px] text-slate-400 block break-all">{a.email}</span>
                                </span>
                              </button>
                              <div className="shrink-0 flex items-center gap-2">
                                <CertificateStatusBadge status={a.status} sentAt={a.sentAt} issuedAt={a.issuedAt} error={a.error} sentBy={a.sentBy} />
 <button type="button" title="Remove from this send" onClick={() => toggle(a.passId)} className="h-7 px-2 rounded-lg border border-rose-500/30 text-rose-400 text-[10px] font-bold cursor-pointer">Remove</button>
                                <button type="button" title="Read this person's message" onClick={() => togglePreview(a.passId)} className="h-7 px-2 rounded-lg border border-slate-300 dark:border-white/15 text-slate-500 text-[10px] font-bold flex items-center gap-1 cursor-pointer">{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Message</button>
                              </div>
                            </div>
                            {open && (
                              <div className="mx-2 mb-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 p-2.5 space-y-1">
                                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">To {a.name} &lt;{a.email}&gt;</span>
                                <p className="font-bold text-slate-900 dark:text-white">{mergeCertEmail(emailSubject, v) || '(no subject)'}</p>
                                <EmailHtmlPreview
                                  title={`Email preview for ${a.name}`}
                                  subject={mergeCertEmail(emailSubject, v)}
                                  bodyText={mergeCertEmail(emailBody, v)}
                                  category="CERTIFICATE"
                                  background={backgroundChoiceFor(bgPick)}
                                  className="w-full h-[420px] rounded-lg border border-slate-200 dark:border-white/10 bg-slate-200"
                                />
                                <p className="text-[10px] text-slate-500">Attached: Certificate-{a.name.replace(/[^\w]+/g, '_')}.pdf</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {selectedPeople.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto min-w-0">
                        <span className="text-[10px] font-bold text-slate-500 self-center">{sendMode === 'later' ? 'Scheduling for:' : 'Sending to:'}</span>
                        {selectedPeople.map((a) => <span key={a.passId} className="px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30 text-[10px] font-bold break-words">{a.name}</span>)}
                      </div>
                    )}
                  </div>
                  {sendMode === 'later' && <input type="datetime-local" className={`${field} max-w-xs`} value={sendAt} onChange={(e) => setSendAt(e.target.value)} />}
                  {!canSend && <p className="text-amber-500 font-semibold">You can design and preview certificates but not send them.</p>}
                  <button type="button" disabled={!canSend || !emailReady || busy || selected.size === 0 || (sendMode === 'now' && !eventOver)} onClick={send} className="px-6 py-2.5 bg-accent text-white font-extrabold rounded-xl text-xs shadow-lg shadow-accent/25 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                    {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : sendMode === 'later' ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                    {sendMode === 'later' ? `Schedule ${selected.size} certificate${selected.size === 1 ? '' : 's'}${sendAt ? ` for ${new Date(sendAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}` : `Send ${selected.size} certificate${selected.size === 1 ? '' : 's'} now`}
                  </button>
                  {schedules.length > 0 && (
                    <div className="space-y-1">
                      <label className={label}>Scheduled sends</label>
                      {schedules.map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 dark:border-white/10">
                          <span className="min-w-0">
                            <span className="font-bold text-slate-900 dark:text-white block">{new Date(s.sendAt).toLocaleString()} · {s.passIds.length} certificate{s.passIds.length === 1 ? '' : 's'}</span>
                            <span className="text-[10px] text-slate-500">{s.status}{s.status === 'Done' ? ` — ${s.sent} sent${s.failed ? `, ${s.failed} failed` : ''}` : ''}{s.finishedAt ? ` · finished ${new Date(s.finishedAt).toLocaleString()}` : ''}{s.createdBy ? ` · scheduled by ${s.createdBy}` : ''}{s.error ? ` — ${s.error}` : ''}</span>
                          </span>
                          {s.status === 'Scheduled' && <button type="button" onClick={() => cancelSchedule(s.id)} className="px-2.5 py-1 rounded-lg text-rose-400 border border-rose-500/30 font-bold cursor-pointer">Cancel</button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Preview */}
            <div className="overflow-y-auto min-h-0">
              <label className={label}>{openStep === 5 ? 'Final certificate (real attendee)' : openStep === 3 ? 'Drag a box to move it, drag its corner to resize' : 'Preview (sample name)'}</label>
              <div ref={stageRef} className="relative w-full select-none touch-none">
                {(openStep === 5 ? finalPreview || preview : preview) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={openStep === 5 ? finalPreview || preview : preview} alt="Certificate preview" draggable={false} className="w-full rounded-xl border border-slate-200 dark:border-white/15 shadow-lg" />
                )}
                {showOverlay && enabledKeys.map((k) => {
                  const b = template.layout[k];
                  const on = k === activeBox;
                  return (
                    <div
                      key={k}
                      onPointerDown={(e) => startDrag(e, k, 'move')}
                      title={CERT_BOX_LABELS[k]}
                      style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
                      className={`absolute border ${on ? 'border-accent bg-accent/10 border-2 z-10' : 'border-dashed border-sky-400/60 hover:border-accent'} ${canEditDesign && openStep === 3 ? 'cursor-move' : 'cursor-pointer'}`}
                    >
                      <span className={`absolute -top-4 left-0 px-1 text-[9px] font-bold rounded-t ${on ? 'bg-accent text-white' : 'bg-sky-500/70 text-white'}`}>{CERT_BOX_LABELS[k]}</span>
                      {canEditDesign && openStep === 3 && <span onPointerDown={(e) => startDrag(e, k, 'size')} className="absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 rounded-sm bg-accent border border-white cursor-nwse-resize" />}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Every certificate is made as an A4 PDF with the attendee&apos;s details in the boxes above, and emailed to them. Changes save automatically.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CertificateModal;
