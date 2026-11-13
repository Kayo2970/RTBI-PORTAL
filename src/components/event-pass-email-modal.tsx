'use client';

import { beginTask } from '@/lib/background-tasks';
import React, { useState } from 'react';
import {
  Mail,
  X,
  Send,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Eye,
  CheckSquare,
  Square,
  Users,
  Tag,
  QrCode,
  RefreshCw,
} from 'lucide-react';
import { EventItem, EventPassItem, buildPassEmail, dispatchPassEmail } from '@/lib/local-data';
import { PassEmailComposer, usePassEmailTemplate } from '@/components/pass-email-composer';
import { passEmailOptsFromTemplate } from '@/lib/pass-email-template';
import { EmailBackgroundPicker, DEFAULT_BACKGROUND_PICK, backgroundChoiceFor, type EmailBackgroundPick } from '@/components/email-background-picker';
import { EmailHtmlPreview } from '@/components/email-html-preview';
import { FALLBACK_ORIGIN } from '@/lib/app-origin';

interface EventPassEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: EventItem[];
  selectedEventId: string;
  passes: EventPassItem[];
  currentUserName: string;
  currentUserEmail?: string;
  onEmailsDispatched?: (count: number) => void;
}

export function EventPassEmailModal({
  isOpen,
  onClose,
  events,
  selectedEventId,
  passes,
  currentUserName,
  currentUserEmail,
  onEmailsDispatched,
}: EventPassEmailModalProps) {
  const [activeEventId, setActiveEventId] = useState(selectedEventId || 'ALL');
  // One shared message (also used by Preview & dispatch in Issued Passes)
  const [template, setTemplate] = usePassEmailTemplate(isOpen);

  const [selectedPassIds, setSelectedPassIds] = useState<string[]>([]);
  // Preview follows a pass id (not an index) so list refreshes never jump to another person
  const [previewPassId, setPreviewPassId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  // Blurred picture behind the e-mails (default = the one set in Email Settings, if any)
  const [bgPick, setBgPick] = useState<EmailBackgroundPick>(DEFAULT_BACKGROUND_PICK);
  const [successToast, setSuccessToast] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Filter passes that have valid emails
  const eventPasses = passes.filter((p) => {
    if (activeEventId !== 'ALL' && p.eventId !== activeEventId) return false;
    return Boolean(p.attendeeEmail);
  });

  // Nobody is pre-selected: recipients are chosen on purpose. Reset only when the dialog opens or the event
  // filter changes — never because the passes list was refreshed in the background.
  React.useEffect(() => {
    setSelectedPassIds([]);
    setPreviewPassId(null);
  }, [isOpen, activeEventId]);

  // A background refresh can only drop selections whose pass vanished; it never adds or re-selects anyone
  const eligibleKey = eventPasses.map((p) => p.id).join('|');
  React.useEffect(() => {
    const ids = new Set(eventPasses.map((p) => p.id));
    setSelectedPassIds((prev) => (prev.every((id) => ids.has(id)) ? prev : prev.filter((id) => ids.has(id))));
  }, [eligibleKey]);

  const toggleSelectAll = () => {
    if (selectedPassIds.length === eventPasses.length) {
      setSelectedPassIds([]);
    } else {
      setSelectedPassIds(eventPasses.map((p) => p.id));
    }
  };

  const togglePassSelect = (id: string) => {
    if (selectedPassIds.includes(id)) {
      setSelectedPassIds(selectedPassIds.filter((pId) => pId !== id));
    } else {
      setSelectedPassIds([...selectedPassIds, id]);
    }
  };

  // Compute the designed email preview for the highlighted recipient
  const previewPass = eventPasses.find((p) => p.id === previewPassId) || eventPasses[0];
  const origin = typeof window !== 'undefined' ? window.location.origin : FALLBACK_ORIGIN;
  const previewEmail = previewPass
    ? buildPassEmail(previewPass, origin, { forPreview: true, ...passEmailOptsFromTemplate(template) })
    : null;

  const handleSendEmails = async () => {
    const targets = eventPasses.filter((p) => selectedPassIds.includes(p.id));
    if (targets.length === 0) {
      setErrorMessage('No recipients selected with a valid email address.');
      return;
    }

    if (!window.confirm(`Send ${targets.length} email${targets.length === 1 ? '' : 's'}?\n\n${targets.slice(0, 8).map((t) => `• ${t.attendeeName} <${t.attendeeEmail}>`).join('\n')}${targets.length > 8 ? `\n…and ${targets.length - 8} more` : ''}`)) return;

    setIsSending(true);
    setErrorMessage('');
    const task = beginTask({ label: `Sending ${targets.length} pass email${targets.length === 1 ? '' : 's'}`, total: targets.length });

    try {
      let sentCount = 0;
      let failCount = 0;

      for (const pass of targets) {
        if (!pass.attendeeEmail) continue;

        try {
          const res = await dispatchPassEmail(pass, pass.attendeeEmail, passEmailOptsFromTemplate(template), backgroundChoiceFor(bgPick) as 'none' | { storageKey: string; blur: number } | undefined);
          if (!res.success) {
            failCount++;
            console.warn(`Failed to dispatch email to ${pass.attendeeEmail}:`, res.error);
          } else {
            sentCount++;
          }
        } catch (subErr) {
          failCount++;
          console.warn(`Network error dispatching email to ${pass.attendeeEmail}:`, subErr);
        }
        task.progress(sentCount + failCount, `${sentCount} sent${failCount ? `, ${failCount} failed` : ''}`);
      }
      task.finish(`${sentCount} of ${targets.length} pass email${targets.length === 1 ? '' : 's'} sent${failCount ? `, ${failCount} failed` : ''}.`, { warn: failCount > 0 });

      if (sentCount > 0) {
        setSuccessToast(`Dispatched ${sentCount} personalized pass emails successfully!${failCount > 0 ? ` (${failCount} failed)` : ''}`);
        if (onEmailsDispatched) onEmailsDispatched(sentCount);
        setTimeout(() => {
          onClose();
          setSuccessToast('');
        }, 2000);
      } else {
        setErrorMessage('Failed to send pass emails. Please check your SMTP settings in Settings > Email.');
      }
    } catch (err: any) {
      console.error(err);
      task.fail('Failed to dispatch pass emails.');
      setErrorMessage('Failed to dispatch pass emails.');
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="glass-panel w-full max-w-[1600px] rounded-3xl p-5 md:p-7 space-y-5 relative border border-slate-200/90 dark:border-white/15 bg-white/95 dark:bg-[#0D1F38]/95 shadow-2xl h-[94vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-accent/20 border border-accent/30 flex items-center justify-center text-accent">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                Mail-Merge Event Pass Dispatch
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Send personalized invitations & turnstile pass links with dynamic `@placeholders`.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Feedback Messages */}
        {successToast && (
          <div className="flex items-center gap-3 p-4 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl text-emerald-300 text-xs">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <span className="font-semibold">{successToast}</span>
          </div>
        )}
        {errorMessage && (
          <div className="flex items-center gap-3 p-4 bg-rose-500/15 border border-rose-500/30 rounded-2xl text-rose-300 text-xs">
            <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-6 overflow-y-auto flex-1 pr-1 text-xs">
          {/* LEFT: TEMPLATE EDITOR & PLACEHOLDERS */}
          <div className="space-y-4 min-w-0">
            {/* Event Filter */}
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">
                Target Event
              </label>
              <select
                value={activeEventId}
                onChange={(e) => setActiveEventId(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white font-medium focus:outline-none focus:border-accent text-xs"
              >
                <option value="ALL" className="bg-slate-900 text-white">All Events</option>
                {events.map((evt) => (
                  <option key={evt.id} value={evt.id} className="bg-slate-900 text-white">
                    {evt.title}
                  </option>
                ))}
              </select>
            </div>

            <PassEmailComposer template={template} onChange={setTemplate} bodyRows={14} />

            <EmailBackgroundPicker value={bgPick} onChange={setBgPick} disabled={isSending} />
          </div>

          {/* RIGHT: RECIPIENTS SELECTION & LIVE PREVIEW */}
          <div className="space-y-4 flex flex-col min-w-0">
            {/* Recipients Checklist */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-slate-800 dark:text-white text-xs flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-accent" />
                  Recipients ({selectedPassIds.length}/{eventPasses.length})
                </span>
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-[11px] font-bold text-accent hover:underline cursor-pointer"
                >
                  {selectedPassIds.length === eventPasses.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div className="max-h-36 overflow-y-auto border border-slate-200 dark:border-white/10 rounded-xl divide-y divide-slate-100 dark:divide-white/5 bg-slate-50/50 dark:bg-white/5 p-1">
                {eventPasses.length === 0 ? (
                  <div className="py-4 text-center text-slate-400 text-[11px]">
                    No issued passes with email addresses found.
                  </div>
                ) : (
                  eventPasses.map((pass) => {
                    const isChecked = selectedPassIds.includes(pass.id);
                    return (
                      <div
                        key={pass.id}
                        className="flex items-center justify-between p-1.5 hover:bg-white/10 rounded-lg cursor-pointer text-[11px]"
                        onClick={() => togglePassSelect(pass.id)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isChecked ? (
                            <CheckSquare className="h-4 w-4 text-accent shrink-0" />
                          ) : (
                            <Square className="h-4 w-4 text-slate-400 shrink-0" />
                          )}
                          <div className="truncate">
                            <span className="font-bold text-slate-900 dark:text-white block truncate">
                              {pass.attendeeName}
                            </span>
                            <span className="text-[10px] text-slate-400 block truncate">
                              {pass.attendeeEmail}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewPassId(pass.id);
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded-md font-bold transition-all ${
                            previewPass?.id === pass.id
                              ? 'bg-accent text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Preview
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Live Rendered Email Preview */}
            <div className="space-y-1.5 flex-1 flex flex-col">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3 text-accent" /> Live email preview (exactly what is sent)
                </span>
                <span className="text-[10px] text-accent font-semibold truncate max-w-[160px]">
                  {previewPass?.attendeeName || 'No recipient'}
                </span>
              </div>

              <div className="rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-3 py-2 text-[11px]">
                <span className="text-[9px] text-slate-400 uppercase font-bold mr-2">Subject</span>
                <span className="font-bold text-slate-900 dark:text-white">{previewEmail?.subject || '—'}</span>
              </div>
              {previewEmail ? (
                <EmailHtmlPreview
                  key={previewPass?.id}
                  title="Email preview"
                  bodyHtml={previewEmail.bodyHtml}
                  subject={previewEmail.subject}
                  bodyText={previewEmail.bodyText}
                  category="EVENT_INVITATION"
                  badgeText="Official Event Pass"
                  badgeColor="#0284c7"
                  background={backgroundChoiceFor(bgPick)}
                  className="w-full h-[560px] rounded-2xl border border-slate-200 dark:border-white/15 bg-slate-200"
                />
              ) : (
                <div className="flex-1 min-h-[200px] rounded-2xl border border-dashed border-slate-300 dark:border-white/15 flex items-center justify-center text-slate-400 text-[11px]">Select a recipient to preview</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200/80 dark:border-white/10 pt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-slate-700 dark:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSending || selectedPassIds.length === 0}
            onClick={handleSendEmails}
            className="px-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-extrabold rounded-xl text-xs transition-all shadow-lg shadow-accent/25 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Dispatching Pass Emails...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Dispatch {selectedPassIds.length} Personalized Passes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EventPassEmailModal;
