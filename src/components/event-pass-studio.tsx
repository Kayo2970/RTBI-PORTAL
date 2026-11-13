'use client';

import React, { useState, useEffect } from 'react';
import {
  Ticket,
  User,
  Mail,
  Phone,
  Building2,
  Calendar,
  Sparkles,
  Printer,
  CheckCircle2,
  ShieldCheck,
  Copy,
  MapPin,
  Clock,
  QrCode,
  Tag,
  Share2,
  ExternalLink,
  Layers,
  Upload,
  Download,
  Send,
  Smartphone,
  Eye,
  Palette,
} from 'lucide-react';
import {
  EventItem,
  EventPassItem,
  EventPassType,
  EventGuestCategory,
  PassQrOptions,
  DEFAULT_QR_OPTIONS,
  qrFieldsFromOptions,
  qrOptionsFromPass,
  PassTheme,
  addEventPass,
  getEventPasses,
  dispatchPassEmail,
  expandDateRange,
  formatValidDaysLabel,
} from '@/lib/local-data';
import { AppleWalletPassPreview } from './apple-wallet-pass-preview';
import { EventPassBulkModal } from './event-pass-bulk-modal';
import { PassThemeEditor } from './pass-theme-editor';
import { EventPassKeycard } from './event-pass-keycard';
import { CardArtworkToggle, EventTitleToggle, PassFontControls, PassQrControls, PassSection, PassColorControls, PassTextColorControls, PassValidityPicker, PASS_COLOR_PRESETS, PASS_GRADIENT_PRESETS } from './pass-design-controls';

export { PASS_COLOR_PRESETS, PASS_GRADIENT_PRESETS };
import { EventPassEmailModal } from './event-pass-email-modal';
import { SearchableSelect } from './searchable-select';

interface EventPassStudioProps {
  events: EventItem[];
  currentUserId?: string;
  currentUserName: string;
  currentUserEmail?: string;
  onPassIssued?: (pass: EventPassItem) => void;
}

const PASS_TYPES: {
  type: EventPassType;
  label: string;
  colorClass: string;
  badge: string;
}[] = [
  {
    type: 'VIP Pass',
    label: 'VIP Pass',
    colorClass: 'bg-amber-500/15 border-amber-400/40 text-amber-300',
    badge: 'VIP ACCESS',
  },
  {
    type: 'Keynote Speaker',
    label: 'Keynote Speaker',
    colorClass: 'bg-purple-500/15 border-purple-400/40 text-purple-300',
    badge: 'KEYNOTE SPEAKER',
  },
  {
    type: 'Executive Delegate',
    label: 'Executive Delegate',
    colorClass: 'bg-sky-500/15 border-sky-400/40 text-sky-300',
    badge: 'EXECUTIVE',
  },
  {
    type: 'Student Delegate',
    label: 'Student Delegate',
    colorClass: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300',
    badge: 'STUDENT DELEGATE',
  },
  {
    type: 'Guest Pass',
    label: 'Guest Pass',
    colorClass: 'bg-slate-500/15 border-slate-400/40 text-slate-300',
    badge: 'GUEST PASS',
  },
  {
    type: 'Press / Media',
    label: 'Press / Media',
    colorClass: 'bg-rose-500/15 border-rose-400/40 text-rose-300',
    badge: 'PRESS & MEDIA',
  },
  {
    type: 'Organizer',
    label: 'Organizer / Crew',
    colorClass: 'bg-indigo-500/15 border-indigo-400/40 text-indigo-300',
    badge: 'CREW / ORGANIZER',
  },
  {
    type: 'Other',
    label: 'Other / Custom',
    colorClass: 'bg-teal-500/15 border-teal-400/40 text-teal-300',
    badge: 'CUSTOM PASS',
  },
];

const GUEST_CATEGORIES: { category: EventGuestCategory; label: string; icon: string }[] = [
  { category: 'Keynote Speaker', label: 'Keynote Speaker', icon: '🎙️' },
  { category: 'VIP Dignitary', label: 'VIP Dignitary', icon: '⭐' },
  { category: 'Faculty', label: 'Faculty / Academic', icon: '🏛️' },
  { category: 'Student', label: 'Student / Scholar', icon: '🎓' },
  { category: 'Industry Partner', label: 'Industry Partner', icon: '💼' },
  { category: 'Alumni', label: 'Alumni Network', icon: '🌟' },
  { category: 'Organizer / Crew', label: 'Organizer / Crew', icon: '🛡️' },
  { category: 'Press / Media', label: 'Press / Media', icon: '📸' },
  { category: 'Special Guest', label: 'Special Guest', icon: '✨' },
  { category: 'Other', label: 'Other / Custom', icon: '🏷️' },
];

const ROOM_PRESETS = [
  'Main Auditorium - VIP Box',
  'Main Auditorium - Front Row',
  'Seminar Hall A - Room 102',
  'Seminar Hall B - Room 204',
  'Incubation Centre - Lab 1',
  'Executive Boardroom',
  'Exhibition Ground - Stall A1',
  'Media Briefing Room',
];

export function EventPassStudio({
  events,
  currentUserName,
  currentUserEmail,
  onPassIssued,
}: EventPassStudioProps) {
  const activeEvents = events.filter((e) => e.status !== 'completed' && e.status !== 'archived');
  const defaultEvent = activeEvents[0] || events[0];

  const [eventMode, setEventMode] = useState<'existing' | 'custom' | 'none'>('existing');
  const [selectedEventId, setSelectedEventId] = useState(defaultEvent?.id || '');
  // Events can arrive after first render (synced from the server): pick the first one then
  useEffect(() => {
    if (!selectedEventId && defaultEvent?.id) setSelectedEventId(defaultEvent.id);
  }, [selectedEventId, defaultEvent?.id]);
  const [customEventTitle, setCustomEventTitle] = useState('');
  const [attendeeName, setAttendeeName] = useState('');
  const [guestCategory, setGuestCategory] = useState<EventGuestCategory>('VIP Dignitary');
  const [customGuestCategory, setCustomGuestCategory] = useState('');
  const [passType, setPassType] = useState<EventPassType>('VIP Pass');
  const [customPassType, setCustomPassType] = useState('');
  const [passColor, setPassColor] = useState<string>('#0d2342');
  const [colorMode, setColorMode] = useState<'gradient' | 'solid'>('gradient');
  const [passGradient, setPassGradient] = useState<string>('linear-gradient(145deg, #0d2342 0%, #030712 100%)');
  const [gradientEndColor, setGradientEndColor] = useState<string>('#030712');
  const [roomOrVenue, setRoomOrVenue] = useState('');
  const [attendeeEmail, setAttendeeEmail] = useState('');
  const [attendeePhone, setAttendeePhone] = useState('');
  const [attendeeOrg, setAttendeeOrg] = useState('');
  const [brandHeader, setBrandHeader] = useState('RTBI');
  const [validityDate, setValidityDate] = useState('');
  // '' = auto (default pass colours / event theme)
  const [textColor, setTextColor] = useState('');
  const [labelColor, setLabelColor] = useState('');
  const [walletLayout, setWalletLayout] = useState<'poster' | 'classic'>('poster');
  const [passTheme, setPassTheme] = useState<PassTheme | undefined>(undefined);
  // Only an existing event has a pass look; for custom/standalone passes ignore any stale draft
  const activeTheme = eventMode === 'existing' ? passTheme : undefined;
  // null = all days of the selected event (default); otherwise the explicit subset this single pass is valid on
  const [selectedValidDays, setSelectedValidDays] = useState<string[] | null>(null);
  const [notes, setNotes] = useState('');
  // Designer drop-downs: only the first group is open by default
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ details: true });
  // Accordion: opening a section closes the others so the page never grows too tall
  const toggleSection = (k: string) => setOpenSections((o) => ({ [k]: !o[k] }));
  const [fontScale, setFontScale] = useState(1);
  const [showEventTitle, setShowEventTitle] = useState<boolean | undefined>(undefined);
  const [showPortalTitle, setShowPortalTitle] = useState<boolean | undefined>(undefined);
  const [showCardArtwork, setShowCardArtwork] = useState<boolean | undefined>(undefined);
  const [qr, setQr] = useState<PassQrOptions>(DEFAULT_QR_OPTIONS);
  const patchQr = (patch: Partial<PassQrOptions>) => setQr((q) => ({ ...q, ...patch }));

  // Modals & Preview mode
  const [previewMode, setPreviewMode] = useState<'luxury' | 'apple-wallet'>('luxury');
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [issuedPass, setIssuedPass] = useState<EventPassItem | null>(null);
  const [isDispatchingEmail, setIsDispatchingEmail] = useState(false);
  const [emailDispatchStatus, setEmailDispatchStatus] = useState<string>('');
  const [manualEmailInput, setManualEmailInput] = useState('');
  const [showManualEmailPrompt, setShowManualEmailPrompt] = useState(false);
  const [successToast, setSuccessToast] = useState('');
  const [copiedSerial, setCopiedSerial] = useState(false);

  const selectedEvent = eventMode === 'existing' ? events.find((e) => e.id === selectedEventId) || defaultEvent : null;
  const currentPassMeta = PASS_TYPES.find((p) => p.type === passType) || PASS_TYPES[0];

  const formattedEventDate = selectedEvent
    ? selectedEvent.datesTBD
      ? 'Dates TBD'
      : `${selectedEvent.startDate}${
          selectedEvent.endDate && selectedEvent.endDate !== selectedEvent.startDate
            ? ` – ${selectedEvent.endDate}`
            : ''
        }`
    : '2026';

  const resolvedEventTitle =
    eventMode === 'custom'
      ? customEventTitle.trim() || 'Custom Event / Symposium'
      : eventMode === 'none'
      ? 'General Access Credential'
      : selectedEvent?.title || 'RTBI Official Event';

  const resolvedEventId =
    eventMode === 'custom'
      ? `custom-${Date.now()}`
      : eventMode === 'none'
      ? 'standalone'
      : selectedEvent?.id || 'standalone';

  const resolvedEventVenue =
    selectedEvent?.location || roomOrVenue.trim() || 'RTBI Auditorium';

  const previewSerial = `LEADS-EVT-2026-${(attendeeName || 'GUEST').slice(0, 3).toUpperCase()}-99`;
  const displayRoom = roomOrVenue.trim() || selectedEvent?.location || 'Main Auditorium';
  useEffect(() => {
    setSelectedValidDays(null);
  }, [selectedEventId, eventMode]);

  const eventDays = selectedEvent && !selectedEvent.datesTBD ? expandDateRange(selectedEvent.startDate, selectedEvent.endDate) : [];
  const effectiveValidDays = selectedValidDays
    ? selectedValidDays.filter((d) => eventDays.includes(d) || eventDays.length === 0)
    : eventDays.length > 1
    ? eventDays
    : validityDate
    ? [validityDate]
    : [];
  const displayValidity = effectiveValidDays.length > 0 ? formatValidDaysLabel(effectiveValidDays) : formattedEventDate;
  const toggleValidDay = (d: string) => {
    const base = selectedValidDays ?? eventDays;
    const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d].sort();
    setSelectedValidDays(next.length === 0 ? base : next);
  };

  const handleDirectDownloadTemplate = () => {
    const targetEvt = selectedEvent || events[0];
    const formattedDate = targetEvt
      ? targetEvt.datesTBD
        ? 'Dates TBD'
        : `${targetEvt.startDate}${targetEvt.endDate ? ` – ${targetEvt.endDate}` : ''}`
      : '2026';

    const headers = 'AttendeeName,GuestCategory,PassType,RoomOrVenue,Email,Mobile,Organization,CustomValidity,Notes\n';
    const sample1 = `Dr. Meera Swaminathan,Keynote Speaker,Keynote Speaker,Main Auditorium - VIP Box,meera.s@domain.com,+91 98765 43210,IISc Bangalore,${formattedDate},Invited Speaker\n`;
    const sample2 = `Alex Chen,VIP Dignitary,VIP Pass,Main Auditorium - Front Row,alex.chen@techcorp.com,+91 98450 11223,TechCorp Singapore,${formattedDate},Executive Sponsor\n`;
    const sample3 = `Rohan Sharma,Student,Student Delegate,Seminar Hall A - Room 102,rohan.s@msruas.ac.in,+91 91234 56789,RUAS FET,${formattedDate},Student Project Lead\n`;
    const sample4 = `Priya Nambiar,Faculty,Executive Delegate,Seminar Hall B - Room 204,priya.n@msruas.ac.in,+91 99887 76655,RUAS FMC,${formattedDate},Session Chair\n`;
    const sample5 = `Dr. Arjun Menon,Other,Other,Executive Boardroom,arjun.m@example.com,+91 98111 22334,Special Invitee,${formattedDate},Trustee & Guest of Honour`;

    const blob = new Blob([headers + sample1 + sample2 + sample3 + sample4 + sample5], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `leads_event_passes_template_${(targetEvt?.title || 'event').toLowerCase().replace(/[^a-z0-9]/g, '_')}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleIssuePass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attendeeName.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendeeEmail.trim())) {
      setOpenSections({ details: true });
      setSuccessToast('');
      return;
    }
    if (eventMode === 'custom' && !customEventTitle.trim()) return;

    const resolvedGuest = guestCategory === 'Other' ? (customGuestCategory.trim() || 'Guest Invitee') : guestCategory;
    const resolvedPass = passType === 'Other' ? (customPassType.trim() || 'Custom Pass') : passType;

    setIsSubmitting(true);
    try {
      const newPass = addEventPass({
        eventId: resolvedEventId,
        eventName: resolvedEventTitle,
        eventDate: formattedEventDate,
        eventVenue: resolvedEventVenue,
        attendeeName: attendeeName.trim(),
        guestCategory: resolvedGuest as any,
        roomOrVenue: displayRoom,
        attendeeEmail: attendeeEmail.trim() || undefined,
        attendeePhone: attendeePhone.trim() || undefined,
        attendeeOrg: attendeeOrg.trim() || undefined,
        passType: resolvedPass as any,
        accessTier: resolvedPass === 'VIP Pass' ? 'All Access VIP' : 'General Admission',
        validityDate: displayValidity,
        validDays: effectiveValidDays.length > 0 ? effectiveValidDays : undefined,
        seatOrZone: displayRoom,
        passColor,
        passGradient: colorMode === 'gradient' ? passGradient : undefined,
        textColor: textColor || undefined,
        labelColor: labelColor || undefined,
        fontScale: fontScale !== 1 ? fontScale : undefined,
        showEventTitle,
        showPortalTitle,
        showCardArtwork,
        ...qrFieldsFromOptions(qr),
        notes: notes.trim() || undefined,
        issuedBy: currentUserName,
        issuedByEmail: currentUserEmail,
      });

      setIssuedPass(newPass);
      // Issuing never emails the attendee — sending is always an explicit Dispatch
      setSuccessToast(`Pass ${newPass.serialNumber} created for ${newPass.attendeeName}. Not emailed yet — use Dispatch, or Issued Passes → Preview & dispatch.`);
      if (onPassIssued) onPassIssued(newPass);

      setTimeout(() => setSuccessToast(''), 8000);
    } catch (err: any) {
      console.error('Error issuing event pass:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDispatchIssuedPass = async (targetEmailOverride?: string) => {
    if (!issuedPass) return;
    const recipient = targetEmailOverride || issuedPass.attendeeEmail || manualEmailInput.trim();
    if (!recipient) {
      setShowManualEmailPrompt(true);
      return;
    }

    setIsDispatchingEmail(true);
    setEmailDispatchStatus('');

    try {
      const res = await dispatchPassEmail(issuedPass, recipient);
      if (res.success) {
        setEmailDispatchStatus(`Pass dispatched to ${recipient}!`);
        setShowManualEmailPrompt(false);
        setSuccessToast(`Pass ${issuedPass.serialNumber} dispatched to ${recipient}!`);
        setTimeout(() => setEmailDispatchStatus(''), 6000);
      } else {
        setEmailDispatchStatus(`Failed: ${res.error || 'Check SMTP settings'}`);
      }
    } catch (err: any) {
      setEmailDispatchStatus(`Failed: ${err?.message || 'Dispatch error'}`);
    } finally {
      setIsDispatchingEmail(false);
    }
  };

  const handleResetForNext = () => {
    setAttendeeName('');
    setAttendeeEmail('');
    setAttendeePhone('');
    setAttendeeOrg('');
    setRoomOrVenue('');
    setValidityDate('');
    setNotes('');
    setIssuedPass(null);
    setEmailDispatchStatus('');
    setShowManualEmailPrompt(false);
    setManualEmailInput('');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top Action Toolbar: Bulk Import, Mail-Merge, Download Template */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-slate-200/90 dark:border-white/15 bg-white/95 dark:bg-[#0D1F38]/95 shadow-lg">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
            <Ticket className="h-4 w-4 text-accent" /> Event Pass Actions
          </span>
          <span className="text-[10px] text-slate-500 font-medium hidden md:inline">
            • Design single pass, import CSV rosters, or email attendees
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDirectDownloadTemplate}
            className="px-3.5 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/35 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            title="Download formatted CSV template for bulk pass generation"
          >
            <Download className="h-3.5 w-3.5" /> Download CSV Template
          </button>
          <button
            type="button"
            onClick={() => setIsBulkModalOpen(true)}
            className="px-3.5 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/35 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Upload className="h-3.5 w-3.5" /> Bulk CSV Import
          </button>
          <button
            type="button"
            onClick={() => setIsEmailModalOpen(true)}
            className="px-3.5 py-1.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-sky-500/35 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Send className="h-3.5 w-3.5" /> Mail-Merge Dispatch
          </button>
        </div>
      </div>

      {successToast && (
        <div className="flex items-center justify-between p-4 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl text-emerald-300 text-xs animate-in fade-in duration-300 shadow-lg shadow-emerald-500/10">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <span className="font-semibold">{successToast}</span>
          </div>
          {issuedPass && (
            <div className="flex items-center gap-2">
              <a
                href={`/pass/${issuedPass.serialNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1 bg-accent hover:bg-accent/80 text-white text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1.5 shadow-sm"
              >
                <Eye className="h-3.5 w-3.5" />
                View Pass ↗
              </a>
              <button
                type="button"
                onClick={handleResetForNext}
                className="px-3 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-200 text-xs font-bold rounded-lg cursor-pointer transition-all"
              >
                Issue Next Pass →
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* LEFT COLUMN: LIVE ON-THE-SPOT MANUAL ENTRY FORM */}
        <div className="lg:col-span-6 glass-panel rounded-3xl p-6 md:p-8 space-y-6 border border-slate-200/90 dark:border-white/15 bg-white/95 dark:bg-[#0D1F38]/95 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-accent/20 border border-accent/30 flex items-center justify-center text-accent">
                <Ticket className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">
                  On-the-Spot Pass Studio
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                  Self-issue verified luxury passes manually during live events & symposiums.
                </p>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
              Live Sync
            </span>
          </div>

          <form onSubmit={handleIssuePass} className="space-y-4 text-xs">
            {/* 1 · Event & guest details */}
            <PassSection
              title="1 · Event & guest details"
              hint="Who the pass is for, and which event"
              icon={<Ticket className="h-4 w-4" />}
              open={!!openSections.details}
              onToggle={() => toggleSection('details')}
            >
            {/* 1. Target Event / Occasion Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                  Target Event / Occasion *
                </label>
                <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-white/10 p-0.5 rounded-lg text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => setEventMode('existing')}
                    className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                      eventMode === 'existing'
                        ? 'bg-accent text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-white'
                    }`}
                  >
                    Select Event
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventMode('custom')}
                    className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                      eventMode === 'custom'
                        ? 'bg-accent text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-white'
                    }`}
                  >
                    Type Custom
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventMode('none')}
                    className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                      eventMode === 'none'
                        ? 'bg-accent text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-white'
                    }`}
                  >
                    No Event
                  </button>
                </div>
              </div>

              {eventMode === 'existing' && (
                events.length === 0 ? (
                  <p className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-500 dark:text-slate-400 text-xs">
                    No events found (Click &quot;Type Custom&quot; above)
                  </p>
                ) : (
                  <SearchableSelect
                    value={selectedEventId}
                    onChange={setSelectedEventId}
                    options={events.map((evt) => ({ value: evt.id, label: evt.title, sublabel: evt.status }))}
                  />
                )
              )}

              {eventMode === 'custom' && (
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={customEventTitle}
                    onChange={(e) => setCustomEventTitle(e.target.value)}
                    placeholder="Type custom event name (e.g. Annual Tech Symposium / VIP Guest Visit)"
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-accent text-xs"
                  />
                </div>
              )}

              {eventMode === 'none' && (
                <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
                  <span>General All-Access Standalone Credential (No event assigned)</span>
                  <span className="text-[10px] text-emerald-400 font-bold uppercase">Generic Pass</span>
                </div>
              )}
            </div>

            {/* 2. Guest / Attendee Name */}
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                Guest / Attendee Name *
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  required
                  value={attendeeName}
                  onChange={(e) => setAttendeeName(e.target.value)}
                  placeholder="e.g. Dr. Raghavendra Rao / Prof. Ananya Sharma"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-accent text-xs"
                />
              </div>
            </div>

            {/* 3. Guest Category Selector */}
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                Guest Category *
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {GUEST_CATEGORIES.map((gc) => {
                  const isSelected = guestCategory === gc.category;
                  return (
                    <button
                      type="button"
                      key={gc.category}
                      onClick={() => setGuestCategory(gc.category)}
                      className={`px-2.5 py-2 rounded-xl text-[11px] font-bold transition-all border text-left flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-accent text-white border-accent shadow-md shadow-accent/25'
                          : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-accent/40'
                      }`}
                    >
                      <span className="truncate">
                        {gc.icon} {gc.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {guestCategory === 'Other' && (
                <div className="pt-1.5 animate-in fade-in duration-200">
                  <input
                    type="text"
                    required
                    value={customGuestCategory}
                    onChange={(e) => setCustomGuestCategory(e.target.value)}
                    placeholder="Specify custom guest category (e.g. Session Chair, Exhibitor, Key Sponsor, Trustee)"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-accent/50 rounded-xl text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-accent text-xs"
                  />
                </div>
              )}
            </div>

            {/* 4. Pass Type / Tier Pills */}
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                Pass Type / Access Tier *
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {PASS_TYPES.map((pt) => {
                  const isSelected = passType === pt.type;
                  return (
                    <button
                      type="button"
                      key={pt.type}
                      onClick={() => setPassType(pt.type)}
                      className={`px-3 py-2 rounded-xl text-[11px] font-bold transition-all border text-left flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-sky-600 text-white border-sky-500 shadow-md shadow-sky-600/30'
                          : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-sky-500/40'
                      }`}
                    >
                      <span className="truncate">{pt.label}</span>
                      {isSelected && <Sparkles className="h-3 w-3 text-white shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {passType === 'Other' && (
                <div className="pt-1.5 animate-in fade-in duration-200">
                  <input
                    type="text"
                    required
                    value={customPassType}
                    onChange={(e) => setCustomPassType(e.target.value)}
                    placeholder="Specify custom pass type (e.g. Workshop Delegate, Volunteer Pass, Vendor Credential)"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-sky-500/50 rounded-xl text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-sky-400 text-xs"
                  />
                </div>
              )}
            </div>

            {/* 5. Room / Venue / Hall Allocation */}
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px] flex items-center justify-between">
                <span>Room / Venue / Hall Allocation *</span>
                <span className="text-[10px] text-accent font-semibold lowercase">
                  (e.g. Auditorium, VIP Box, Hall A)
                </span>
              </label>
              <div className="relative">
                <MapPin className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={roomOrVenue}
                  onChange={(e) => setRoomOrVenue(e.target.value)}
                  placeholder="e.g. Main Auditorium - VIP Box 2 / Hall A Room 102"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-accent text-xs"
                />
              </div>
              {/* Quick Preset Badges */}
              <div className="flex flex-wrap gap-1 pt-1">
                {ROOM_PRESETS.slice(0, 4).map((preset) => (
                  <button
                    type="button"
                    key={preset}
                    onClick={() => setRoomOrVenue(preset)}
                    className="text-[10px] px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-accent/15 text-slate-600 dark:text-slate-400 hover:text-accent border border-slate-200 dark:border-white/10 cursor-pointer transition-colors"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* 6. Contact Details: Org & Structured Date Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                  Affiliation / Org (Optional)
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={attendeeOrg}
                    onChange={(e) => setAttendeeOrg(e.target.value)}
                    placeholder="e.g. RUAS / Intel / IISc"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-accent text-xs"
                  />
                </div>
              </div>

              <div className="sm:col-span-2">
                <PassValidityPicker
                  eventDays={eventDays}
                  effectiveValidDays={effectiveValidDays}
                  selectedValidDays={selectedValidDays}
                  setSelectedValidDays={setSelectedValidDays}
                  toggleValidDay={toggleValidDay}
                  validityDate={validityDate}
                  setValidityDate={setValidityDate}
                  displayValidity={displayValidity}
                />
              </div>
            </div>

            {/* 7. Contact Details: Mobile & Email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                  Email ID <span className="text-rose-500">*</span> <span className="normal-case font-semibold text-slate-400">(the pass is sent here)</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={attendeeEmail}
                    onChange={(e) => setAttendeeEmail(e.target.value)}
                    placeholder="guest@domain.com"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-accent text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                  Mobile / WhatsApp (Optional)
                </label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="tel"
                    value={attendeePhone}
                    onChange={(e) => setAttendeePhone(e.target.value)}
                    placeholder="+91 XXXXX XXXXX"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-accent text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Pass Header Branding Customization */}
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px] flex items-center justify-between">
                <span>Pass Header Title / Organization</span>
                <span className="text-[10px] text-accent font-semibold lowercase">(branding)</span>
              </label>
              <input
                type="text"
                value={brandHeader}
                onChange={(e) => setBrandHeader(e.target.value)}
                placeholder="RTBI"
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-accent text-xs"
              />
            </div>

            </PassSection>

            {/* 2 · Colours & text */}
            <PassSection
              title="2 · Colours & text"
              hint="Solid or custom gradient, text colours, font size"
              icon={<Palette className="h-4 w-4" />}
              open={!!openSections.colours}
              onToggle={() => toggleSection('colours')}
            >
                        <PassColorControls
              colorMode={colorMode}
              setColorMode={setColorMode}
              passColor={passColor}
              setPassColor={setPassColor}
              passGradient={passGradient}
              setPassGradient={setPassGradient}
              gradientEndColor={gradientEndColor}
              setGradientEndColor={setGradientEndColor}
              activeTheme={activeTheme}
            />
            <PassTextColorControls textColor={textColor} setTextColor={setTextColor} labelColor={labelColor} setLabelColor={setLabelColor} />

              <PassFontControls fontScale={fontScale} setFontScale={setFontScale} showEventTitle={showEventTitle} setShowEventTitle={(v) => { setShowEventTitle(v); setPreviewMode('apple-wallet'); }} eventDefault={activeTheme?.showEventTitle} showPortalTitle={showPortalTitle} setShowPortalTitle={(v) => { setShowPortalTitle(v); setPreviewMode('luxury'); }} portalDefault={activeTheme?.showPortalTitle} />
            </PassSection>

            {/* Event artwork & logo (applies to portal card, emailed ticket and wallet pass) */}
            <PassSection
              title="3 · Event artwork & logo"
              hint="Background image, logo, overlay — saved per event"
              icon={<Palette className="h-4 w-4" />}
              open={!!openSections.art}
              keepMounted
              onToggle={() => toggleSection('art')}
            >
              {eventMode === 'existing' && selectedEvent ? (
                <PassThemeEditor eventId={selectedEvent.id} eventName={selectedEvent.title} onThemeChange={setPassTheme} />
              ) : (
                <p className="text-[11px] text-slate-500">Pick an event from the Events module in section 1 to set its artwork and logo.</p>
              )}
            </PassSection>

            {/* 4 · QR code */}
            <PassSection
              title="4 · QR code"
              hint="Barcode type, caption and QR colours"
              icon={<QrCode className="h-4 w-4" />}
              open={!!openSections.qr}
              onToggle={() => toggleSection('qr')}
            >
              <PassQrControls value={qr} onChange={patchQr} />
            </PassSection>

            {/* Submit Action */}
            <button
              type="submit"
              disabled={isSubmitting || !attendeeName.trim() || !attendeeEmail.trim()}
              className="w-full py-3.5 bg-accent hover:bg-accent/90 text-white font-extrabold rounded-xl transition-all duration-200 shadow-xl shadow-accent/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-4 text-xs tracking-wider uppercase"
            >
              {isSubmitting ? (
                <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Issue Live Verified Pass
                </>
              )}
            </button>
          </form>
        </div>

        {/* RIGHT COLUMN: REAL-TIME INTERACTIVE LIVE PASS PREVIEWS */}
        <div className="lg:col-span-6 flex flex-col items-center space-y-4 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          {/* Dual Preview Switcher: 3D Luxury vs Apple Wallet (98% Match) */}
          <div className="flex items-center justify-between w-full max-w-[380px] px-1">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-white/15">
              <button
                type="button"
                onClick={() => setPreviewMode('luxury')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  previewMode === 'luxury'
                    ? 'bg-accent text-white shadow-md shadow-accent/25'
                    : 'text-slate-500 dark:text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="h-3 w-3" /> Issued Pass
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('apple-wallet')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  previewMode === 'apple-wallet'
                    ? 'bg-accent text-white shadow-md shadow-accent/25'
                    : 'text-slate-500 dark:text-slate-400 hover:text-white'
                }`}
              >
                <Smartphone className="h-3 w-3" /> Apple Wallet (98%)
              </button>
            </div>

          </div>

          {/* VIEW 1: THE ACTUAL ISSUED PASS — the same component the recipient's /pass page renders */}
          {previewMode === 'luxury' && (
            <div className="w-full flex flex-col items-center space-y-2">
              <EventPassKeycard
                pass={{
                  attendeeName: attendeeName.trim() || 'Guest / Attendee Name',
                  passType: (passType === 'Other' ? customPassType.trim() || 'Custom Pass' : passType) as EventPassType,
                  guestCategory: (guestCategory === 'Other' ? customGuestCategory.trim() || 'Guest Invitee' : guestCategory) as any,
                  roomOrVenue: displayRoom,
                  attendeeOrg: attendeeOrg.trim() || undefined,
                  serialNumber: issuedPass ? issuedPass.serialNumber : previewSerial,
                  eventName: resolvedEventTitle,
                  eventDate: formattedEventDate,
                  validityDate: displayValidity,
                  validDays: effectiveValidDays,
                  passColor,
                  passGradient: colorMode === 'gradient' ? passGradient : undefined,
                  textColor: textColor || undefined,
                  labelColor: labelColor || undefined,
                  fontScale,
                  showPortalTitle,
                  showCardArtwork,
                  qrDark: qr.dark,
                  qrLight: qr.light,
                  qrEyeColor: qr.eye || undefined,
                  qrShape: qr.shape,
                  qrLogo: qr.logo,
                }}
                theme={activeTheme}
                autoOpen
                autoExtract
                showActions
              />
              <p className="text-[10.5px] text-slate-500 text-center max-w-[360px]">
                This is the exact pass your recipient opens — folder, card and back. Tap the card to flip it; use Replay to see the opening animation.
              </p>
              <div className="w-full max-w-[360px] space-y-2">
                <CardArtworkToggle value={showCardArtwork} onChange={setShowCardArtwork} hasArtwork={!!activeTheme?.backgroundUrl} />
                <EventTitleToggle target="portal" value={showPortalTitle} onChange={(v) => { setShowPortalTitle(v); setPreviewMode('luxury'); }} eventDefault={activeTheme?.showPortalTitle} />
              </div>
            </div>
          )}

          {/* VIEW 2: 98% PIXEL-ACCURATE NATIVE APPLE WALLET PREVIEW */}
          {previewMode === 'apple-wallet' && (
            <div className="flex items-center gap-1 rounded-full border border-white/15 p-0.5 text-[10px] font-bold">
              {(['poster', 'classic'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setWalletLayout(m)}
                  className={`px-3 py-1 rounded-full cursor-pointer transition-all ${walletLayout === m ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {m === 'poster' ? 'iOS 27 poster' : 'Older iOS (classic)'}
                </button>
              ))}
            </div>
          )}
          {previewMode === 'apple-wallet' && (
            <AppleWalletPassPreview
              attendeeName={attendeeName}
              guestCategory={guestCategory}
              passType={passType}
              roomOrVenue={displayRoom}
              eventName={resolvedEventTitle}
              eventDate={formattedEventDate}
              validityDate={displayValidity}
              serialNumber={issuedPass ? issuedPass.serialNumber : previewSerial}
              interactive={true}
              logoText={brandHeader}
              passColor={passColor}
              theme={activeTheme}
              layout={walletLayout}
              validDaysCount={effectiveValidDays.length}
              validDays={effectiveValidDays}
              passGradient={colorMode === 'gradient' ? passGradient : undefined}
              textColor={textColor || undefined}
              labelColor={labelColor || undefined}
              fontScale={fontScale}
              showEventTitle={showEventTitle}
              barcodeFormat={qr.format}
              altText={qr.altText}
              qr={qr}
            />
          )}
          {previewMode === 'apple-wallet' && (
            <div className="w-full max-w-[340px]">
              <EventTitleToggle value={showEventTitle} onChange={(v) => { setShowEventTitle(v); setPreviewMode('apple-wallet'); }} eventDefault={activeTheme?.showEventTitle} />
            </div>
          )}


          {/* POST-ISSUANCE ACTIONS BAR */}
          {issuedPass ? (
            <div className="w-full max-w-[380px] space-y-2.5 animate-in fade-in duration-300">
              {/* Primary 1-Click Dispatch Email Button */}
              <button
                type="button"
                disabled={isDispatchingEmail}
                onClick={() => handleDispatchIssuedPass()}
                className="w-full py-3 px-4 bg-gradient-to-r from-sky-600 to-accent hover:from-sky-500 hover:to-accent/90 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 border border-sky-400/40 shadow-xl shadow-accent/25 cursor-pointer disabled:opacity-50"
              >
                {isDispatchingEmail ? (
                  <>
                    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Dispatching Pass Email...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    <span>
                      {issuedPass.attendeeEmail
                        ? `Dispatch Pass to ${issuedPass.attendeeEmail}`
                        : 'Dispatch Pass (Email)'}
                    </span>
                  </>
                )}
              </button>

              {/* Status Banner */}
              {emailDispatchStatus && (
                <div
                  className={`p-2.5 rounded-xl text-[11px] font-bold flex items-center gap-2 border ${
                    emailDispatchStatus.startsWith('Failed')
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{emailDispatchStatus}</span>
                </div>
              )}

              {/* Manual Email Input Prompt if no email stored on pass */}
              {showManualEmailPrompt && (
                <div className="p-3 bg-slate-900/90 border border-sky-500/40 rounded-xl space-y-2">
                  <span className="text-[10.5px] font-bold text-slate-300 block">
                    Enter recipient email for {issuedPass.attendeeName}:
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={manualEmailInput}
                      onChange={(e) => setManualEmailInput(e.target.value)}
                      placeholder="attendee@domain.com"
                      className="flex-1 px-3 py-1.5 bg-slate-800 border border-white/15 rounded-lg text-white text-xs focus:outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      disabled={isDispatchingEmail || !manualEmailInput.trim()}
                      onClick={() => handleDispatchIssuedPass(manualEmailInput.trim())}
                      className="px-3 py-1.5 bg-accent hover:bg-accent/90 text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50 transition-all shrink-0"
                    >
                      Send
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <a
                  href={`/pass/${issuedPass.serialNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-3 bg-accent/25 hover:bg-accent/35 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border border-accent/40 cursor-pointer shadow-md"
                >
                  <Eye className="h-4 w-4" /> View Pass
                </a>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="py-2.5 px-3 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border border-white/15 cursor-pointer shadow-md"
                >
                  <Printer className="h-4 w-4" /> Print
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(issuedPass.serialNumber);
                    setCopiedSerial(true);
                    setTimeout(() => setCopiedSerial(false), 2000);
                  }}
                  className="py-2.5 px-3 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border border-sky-500/30 cursor-pointer shadow-md"
                >
                  <Copy className="h-4 w-4" />
                  {copiedSerial ? 'Copied' : 'Copy ID'}
                </button>
              </div>

              <button
                type="button"
                onClick={handleResetForNext}
                className="w-full py-2.5 px-4 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                + Issue Another Event Pass
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 text-center max-w-[340px]">
              Tip: switch between the Issued Pass and Apple Wallet views above — both are rendered from the same design you are editing.
            </p>
          )}
        </div>
      </div>

      {/* BULK CSV MODAL */}
      <EventPassBulkModal
        isOpen={isBulkModalOpen}
        onClose={() => setIsBulkModalOpen(false)}
        events={events}
        selectedEventId={selectedEventId}
        currentUserName={currentUserName}
        currentUserEmail={currentUserEmail}
        onPassesImported={() => {
          if (onPassIssued) {
            const all = getEventPasses();
            if (all[0]) onPassIssued(all[0]);
          }
        }}
      />

      {/* MAIL-MERGE EMAIL DISPATCH MODAL */}
      <EventPassEmailModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        events={events}
        selectedEventId={selectedEventId}
        passes={getEventPasses()}
        currentUserName={currentUserName}
        currentUserEmail={currentUserEmail}
      />
    </div>
  );
}

export default EventPassStudio;
