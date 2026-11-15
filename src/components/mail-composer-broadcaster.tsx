'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Send,
  Users,
  FileUp,
  Paperclip,
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CalendarClock,
  Check,
  Search,
  Filter,
  Loader2,
  Sparkles,
  CheckSquare,
  Square,
  Info,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { authHeaders, Member } from '@/lib/local-data';
import {
  applyMailMerge,
  findUnknownPlaceholders,
  parseRecipients,
  isValidEmail,
  type Recipient,
} from '@/lib/mail-merge';
import { EmailHtmlPreview } from '@/components/email-html-preview';
import {
  EmailBackgroundPicker,
  backgroundChoiceFor,
  DEFAULT_BACKGROUND_PICK,
  type EmailBackgroundPick,
} from '@/components/email-background-picker';
import {
  ComposedAttachment,
  MAX_TOTAL_ATTACHMENT_BYTES,
  filesToAttachments,
  formatBytes,
  buildAttachmentNoticeLine,
} from '@/lib/email-attachments';
import { ConfirmModal } from '@/components/ui/confirm-modal';

const SAMPLE_RECIPIENTS = `name, email, role, department
Ananya Sharma, ananya@example.com, Incubatee, BioNano Labs
Rahul Verma, rahul@example.com, Mentor, RTBI Core
Priya Nair, priya@example.com, Founder & CEO, Quantum Leap`;

interface MailComposerBroadcasterProps {
  onSent?: (count: number) => void;
  onNavigateToSettings?: () => void;
  title?: string;
  subtitle?: string;
  senderName?: string;
  senderEmail?: string;
  initialSubject?: string;
  initialBodyText?: string;
  initialRecipientsText?: string;
}

export function MailComposerBroadcaster({
  onSent,
  onNavigateToSettings,
  title = 'Mail Composer & Broadcaster',
  subtitle = 'Compose and broadcast personalised mail-merge emails to incubator members, startups, or custom recipient lists.',
  senderName = 'RTBI Portal',
  senderEmail = 'portal@ruas-incubator.com',
  initialSubject,
  initialBodyText,
  initialRecipientsText,
}: MailComposerBroadcasterProps) {
  // Recipients & Parser State
  const [recipientsText, setRecipientsText] = useState(initialRecipientsText || '');
  const [subject, setSubject] = useState(initialSubject || '');
  const [bodyText, setBodyText] = useState(initialBodyText || '');

  useEffect(() => {
    if (initialSubject !== undefined) setSubject(initialSubject);
  }, [initialSubject]);
  useEffect(() => {
    if (initialBodyText !== undefined) setBodyText(initialBodyText);
  }, [initialBodyText]);
  useEffect(() => {
    if (initialRecipientsText !== undefined) setRecipientsText(initialRecipientsText);
  }, [initialRecipientsText]);
  const [bodyIsHtml, setBodyIsHtml] = useState(false);
  const [batchLabel, setBatchLabel] = useState('');
  const [category, setCategory] = useState<'ANNOUNCEMENT' | 'DIRECT_MESSAGE' | 'SYSTEM'>('ANNOUNCEMENT');
  const [badgeText, setBadgeText] = useState('');
  const [bgPick, setBgPick] = useState<EmailBackgroundPick>(DEFAULT_BACKGROUND_PICK);
  const [attachments, setAttachments] = useState<ComposedAttachment[]>([]);
  const [isProcessingAttachments, setIsProcessingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');

  // Schedule & Send State
  const [scheduleOn, setScheduleOn] = useState(false);
  const [sendAt, setSendAt] = useState('');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Directory Picker Modal State
  const [showDirectoryModal, setShowDirectoryModal] = useState(false);
  const [directoryMembers, setDirectoryMembers] = useState<Member[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directorySearch, setDirectorySearch] = useState('');
  const [directoryDivision, setDirectoryDivision] = useState<string>('ALL');
  const [selectedMemberEmails, setSelectedMemberEmails] = useState<Set<string>>(new Set());
  const [appendMode, setAppendMode] = useState<'append' | 'replace'>('append');
  const [includeDirectoryMetadata, setIncludeDirectoryMetadata] = useState(true);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse recipients with mail-merge engine
  const parsed = useMemo(() => parseRecipients(recipientsText), [recipientsText]);
  const { recipients, columns, skipped } = parsed;

  // Track unknown placeholders in subject or body
  const unknownPlaceholders = useMemo(() => {
    const unk = new Set<string>();
    findUnknownPlaceholders(subject, columns).forEach((p) => unk.add(p));
    findUnknownPlaceholders(bodyText, columns).forEach((p) => unk.add(p));
    return Array.from(unk);
  }, [subject, bodyText, columns]);

  const totalAttachmentBytes = attachments.reduce((sum, a) => sum + a.size, 0);

  // Currently previewed recipient
  const currentRecipient: Recipient | undefined =
    recipients[Math.min(previewIndex, Math.max(recipients.length - 1, 0))];
  const previewFields = currentRecipient?.fields || {};
  const previewSubject = applyMailMerge(subject, previewFields);
  const previewBody = applyMailMerge(bodyText, previewFields);

  // Validation problem detector
  const validationError = useMemo(() => {
    if (recipients.length === 0) return 'Add at least one recipient or import members from the directory.';
    if (!subject.trim()) return 'Please add an email subject line.';
    if (!bodyText.trim()) return 'Please write an email message body.';
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return `Attachments exceed the maximum allowed total size of ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}.`;
    }
    if (scheduleOn && !sendAt) return 'Pick a scheduled date and time to broadcast at.';
    return null;
  }, [recipients.length, subject, bodyText, totalAttachmentBytes, scheduleOn, sendAt]);

  // Insert token at cursor in message body
  const insertAtCursor = (text: string) => {
    const el = bodyRef.current;
    if (!el) {
      setBodyText((prev) => prev + text);
      return;
    }
    const start = el.selectionStart ?? bodyText.length;
    const end = el.selectionEnd ?? bodyText.length;
    const updated = bodyText.slice(0, start) + text + bodyText.slice(end);
    setBodyText(updated);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // CSV File picker handler
  const handleCsvFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const content = await file.text();
      setRecipientsText(content);
      setPreviewIndex(0);
      setNotice({ kind: 'ok', text: `Loaded recipient list from "${file.name}".` });
    } catch {
      setNotice({ kind: 'error', text: `Could not read recipient file "${file.name}".` });
    }
  };

  // Attachments picker handler
  const handleAttachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const chosen = Array.from(files);
    const addedBytes = chosen.reduce((acc, f) => acc + f.size, 0);
    if (totalAttachmentBytes + addedBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      setAttachmentError(
        `Total attachments size limit is ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}. Selected files would total ${formatBytes(
          totalAttachmentBytes + addedBytes
        )}.`
      );
      return;
    }
    setAttachmentError('');
    setIsProcessingAttachments(true);
    try {
      const converted = await filesToAttachments(chosen);
      setAttachments((prev) => [...prev, ...converted]);
    } catch (err: any) {
      setAttachmentError(err?.message || 'Failed to process selected attachment files.');
    } finally {
      setIsProcessingAttachments(false);
    }
  };

  const handleRemoveAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  // Insert attachment note helper
  const handleInsertAttachmentNote = () => {
    if (attachments.length === 0) return;
    const line = buildAttachmentNoticeLine(attachments.map((a) => a.filename));
    insertAtCursor(`\n${line}\n`);
  };

  // Fetch directory members when directory modal opens
  const fetchDirectoryMembers = useCallback(async () => {
    setDirectoryLoading(true);
    try {
      const res = await fetch('/api/members', {
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setDirectoryMembers(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    } finally {
      setDirectoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showDirectoryModal && directoryMembers.length === 0) {
      fetchDirectoryMembers();
    }
  }, [showDirectoryModal, directoryMembers.length, fetchDirectoryMembers]);

  // Filtered members for directory modal
  const filteredDirectoryMembers = useMemo(() => {
    const q = directorySearch.trim().toLowerCase();
    return directoryMembers
      .filter((m) => m.status !== 'Terminated')
      .filter((m) => {
        if (directoryDivision === 'ALL') return true;
        return m.division === directoryDivision || m.role === directoryDivision;
      })
      .filter((m) => {
        if (!q) return true;
        return (
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (m.role || '').toLowerCase().includes(q) ||
          (m.department || '').toLowerCase().includes(q) ||
          (m.program || '').toLowerCase().includes(q) ||
          (m.phone || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [directoryMembers, directorySearch, directoryDivision]);

  // Toggle single member in directory modal
  const toggleMemberSelection = (email: string) => {
    setSelectedMemberEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email.toLowerCase())) {
        next.delete(email.toLowerCase());
      } else {
        next.add(email.toLowerCase());
      }
      return next;
    });
  };

  // Select all filtered members in directory modal
  const selectAllFiltered = () => {
    setSelectedMemberEmails((prev) => {
      const next = new Set(prev);
      filteredDirectoryMembers.forEach((m) => {
        if (m.email) next.add(m.email.toLowerCase());
      });
      return next;
    });
  };

  // Deselect all
  const deselectAll = () => {
    setSelectedMemberEmails(new Set());
  };

  // Import selected members from directory into recipient list
  const importSelectedMembers = () => {
    const selected = directoryMembers.filter((m) => m.email && selectedMemberEmails.has(m.email.toLowerCase()));
    if (selected.length === 0) return;

    let csv = '';
    const cleanCell = (val?: string) => `"${(val || '').replace(/"/g, '""')}"`;

    if (includeDirectoryMetadata) {
      const header = 'name, email, role, division, department, phone';
      const rows = selected.map((m) =>
        [
          cleanCell(m.name),
          cleanCell(m.email),
          cleanCell(m.role),
          cleanCell(m.division),
          cleanCell(m.department || m.program),
          cleanCell(m.phone),
        ].join(', ')
      );

      if (appendMode === 'replace' || !recipientsText.trim()) {
        csv = [header, ...rows].join('\n');
      } else {
        // If appending, check if current text has a compatible header
        if (recipientsText.toLowerCase().includes('email')) {
          csv = recipientsText.trim() + '\n' + rows.join('\n');
        } else {
          csv = recipientsText.trim() + '\n\n' + [header, ...rows].join('\n');
        }
      }
    } else {
      // Simple name & email
      const rows = selected.map((m) => `${m.name} <${m.email}>`);
      if (appendMode === 'replace' || !recipientsText.trim()) {
        csv = rows.join('\n');
      } else {
        csv = recipientsText.trim() + '\n' + rows.join('\n');
      }
    }

    setRecipientsText(csv);
    setPreviewIndex(0);
    setShowDirectoryModal(false);
    setSelectedMemberEmails(new Set());
    setNotice({
      kind: 'ok',
      text: `Imported ${selected.length} member${selected.length === 1 ? '' : 's'} from the Users Directory into your recipient list.`,
    });
  };

  // Send / Queue Broadcast
  const handleSendBroadcast = async () => {
    if (validationError) return;
    setSending(true);
    setNotice(null);

    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          subject,
          bodyText,
          bodyHtml: bodyIsHtml ? bodyText : undefined,
          label: batchLabel.trim() || undefined,
          category,
          badgeText: badgeText.trim() || undefined,
          background: backgroundChoiceFor(bgPick),
          attachments: attachments.map((a) => ({
            filename: a.filename,
            contentBase64: a.contentBase64,
            contentType: a.contentType,
          })),
          recipients: recipients.map((r) => ({
            email: r.email,
            fields: r.fields,
          })),
          sendAt: scheduleOn && sendAt ? new Date(sendAt).toISOString() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dispatch email broadcast.');
      }

      setConfirming(false);
      setNotice({
        kind: 'ok',
        text: `Successfully queued broadcast of ${data.count || recipients.length} personalised email${
          (data.count || recipients.length) === 1 ? '' : 's'
        } through the delivery queue!`,
      });

      if (onSent) onSent(data.count || recipients.length);
    } catch (err: any) {
      setConfirming(false);
      setNotice({ kind: 'error', text: err?.message || 'Failed to send broadcast.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-theme-border/20 pb-4">
        <div>
          <h2 className="text-lg font-bold text-theme-text-primary flex items-center gap-2">
            <Send className="h-5 w-5 text-accent" />
            {title}
          </h2>
          <p className="text-xs text-theme-text-secondary mt-0.5">{subtitle}</p>
        </div>
        {onNavigateToSettings && (
          <button
            type="button"
            onClick={onNavigateToSettings}
            className="text-xs font-semibold text-accent hover:underline flex items-center gap-1.5 cursor-pointer self-start md:self-auto"
          >
            <ShieldCheck className="h-4 w-4" />
            Verify SMTP Configuration
          </button>
        )}
      </div>

      {notice && (
        <div
          className={`p-3.5 rounded-2xl text-xs flex items-center justify-between gap-3 border ${
            notice.kind === 'ok'
              ? 'bg-success/15 border-success/30 text-emerald-400'
              : 'bg-danger/15 border-danger/30 text-rose-400'
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.kind === 'ok' ? <Check className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
            <span>{notice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-theme-text-secondary hover:text-theme-text-primary cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Studio 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Composer Controls */}
        <div className="lg:col-span-7 space-y-6">
          {/* STEP 1: RECIPIENTS & DIRECTORY */}
          <div className="glass-panel p-5 md:p-6 rounded-3xl border border-theme-card-border space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-theme-border/15 pb-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-[11px] flex items-center justify-center">
                  1
                </span>
                <h3 className="text-sm font-bold text-theme-text-primary">Recipients &amp; Mail Merge</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDirectoryModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white hover:bg-primary-light text-xs font-semibold cursor-pointer shadow-sm transition-all"
                >
                  <Users className="h-3.5 w-3.5" />
                  Select from Directory
                </button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/plain"
                  className="hidden"
                  onChange={handleCsvFilePicked}
                />
                <button
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme-card-border bg-theme-background/30 text-theme-text-primary hover:bg-theme-border/20 text-xs font-semibold cursor-pointer transition-all"
                >
                  <FileUp className="h-3.5 w-3.5" />
                  Upload CSV
                </button>
                {recipientsText && (
                  <button
                    type="button"
                    onClick={() => {
                      setRecipientsText('');
                      setPreviewIndex(0);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-theme-text-secondary hover:text-danger text-xs font-medium cursor-pointer transition-all"
                    title="Clear recipients"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-theme-text-secondary">
                Paste recipients, email list, or CSV table:
              </label>
              <textarea
                rows={5}
                value={recipientsText}
                onChange={(e) => {
                  setRecipientsText(e.target.value);
                  setPreviewIndex(0);
                }}
                placeholder={SAMPLE_RECIPIENTS}
                spellCheck={false}
                className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary font-mono text-xs focus:outline-none focus:border-accent"
              />
              <p className="text-[11px] text-theme-text-secondary">
                Provide a header row with an <code className="text-accent">email</code> column and any number of custom columns
                (e.g. <code className="text-accent">name</code>, <code className="text-accent">role</code>,{' '}
                <code className="text-accent">department</code>). Each column becomes a dynamic{' '}
                <code className="text-accent">{'{{placeholder}}'}</code>.
              </p>
            </div>

            {/* Parsed Recipients Preview Table */}
            {recipients.length > 0 && (
              <div className="rounded-2xl border border-theme-card-border overflow-hidden bg-theme-background/20">
                <div className="flex items-center justify-between px-3.5 py-2 bg-theme-background/60 text-xs font-semibold text-theme-text-primary border-b border-theme-border/20">
                  <span className="flex items-center gap-2">
                    <CheckSquare className="h-3.5 w-3.5 text-success" />
                    <span>
                      {recipients.length} valid recipient{recipients.length === 1 ? '' : 's'} parsed
                    </span>
                  </span>
                  {recipients.length > 5 && (
                    <span className="text-[11px] font-normal text-theme-text-secondary">Showing first 5 rows</span>
                  )}
                </div>
                <div className="overflow-x-auto max-h-44 text-xs">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-theme-border/20 text-theme-text-secondary font-medium">
                        {columns.map((c) => (
                          <th key={c} className="px-3 py-1.5 font-mono uppercase text-[10px] tracking-wider">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border/10 text-theme-text-primary font-mono text-[11px]">
                      {recipients.slice(0, 5).map((r, i) => (
                        <tr key={`${r.email}-${i}`} className="hover:bg-theme-border/10">
                          {columns.map((col) => (
                            <td key={col} className="px-3 py-1.5 truncate max-w-[12rem]">
                              {r.fields[col] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Skipped Lines Callout */}
            {skipped.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {skipped.length} line{skipped.length === 1 ? '' : 's'} skipped:
                </p>
                <ul className="list-disc list-inside text-[11px] space-y-0.5 text-amber-200/80">
                  {skipped.slice(0, 5).map((s, idx) => (
                    <li key={idx}>
                      Line {s.line}: {s.reason}
                    </li>
                  ))}
                  {skipped.length > 5 && <li>…and {skipped.length - 5} more</li>}
                </ul>
              </div>
            )}
          </div>

          {/* STEP 2: MESSAGE CONTENT */}
          <div className="glass-panel p-5 md:p-6 rounded-3xl border border-theme-card-border space-y-4">
            <div className="flex items-center justify-between border-b border-theme-border/15 pb-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-[11px] flex items-center justify-center">
                  2
                </span>
                <h3 className="text-sm font-bold text-theme-text-primary">Email Content</h3>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-theme-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={bodyIsHtml}
                  onChange={(e) => setBodyIsHtml(e.target.checked)}
                  className="rounded"
                />
                <span>Raw HTML Mode</span>
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-theme-text-secondary">Subject Line *</label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Important Update for {{name}} — RTBI Incubation Program"
                className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary font-semibold text-xs focus:outline-none focus:border-accent"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-theme-text-secondary">Message Body *</label>
                {attachments.length > 0 && !bodyIsHtml && (
                  <button
                    type="button"
                    onClick={handleInsertAttachmentNote}
                    className="px-2 py-0.5 bg-accent/15 text-accent border border-accent/30 rounded-md font-semibold hover:bg-accent/25 transition-all cursor-pointer text-[10px]"
                    title="Insert notice naming attachments"
                  >
                    + Mention attachments in body
                  </button>
                )}
              </div>
              <textarea
                ref={bodyRef}
                rows={9}
                required
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder={
                  bodyIsHtml
                    ? '<h2>Dear {{name}},</h2>\n<p>We are excited to share...</p>'
                    : 'Dear {{name}},\n\nWe are pleased to inform you that {{department}} deliverables have been scheduled...\n\nBest regards,\nRTBI Team'
                }
                className={`w-full px-4 py-3 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary text-xs focus:outline-none focus:border-accent leading-relaxed ${
                  bodyIsHtml ? 'font-mono' : ''
                }`}
              />

              {/* Dynamic Placeholder Insertion Buttons */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-semibold text-theme-text-secondary flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-accent" />
                  Insert placeholder:
                </span>
                {columns.map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => insertAtCursor(`{{${col}}}`)}
                    className="px-2 py-0.5 rounded-lg border border-theme-card-border bg-theme-background/50 hover:bg-theme-border/30 text-theme-text-primary font-mono text-[11px] font-medium cursor-pointer transition-all"
                  >
                    {`{{${col}}}`}
                  </button>
                ))}
              </div>

              {unknownPlaceholders.length > 0 && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    No column called{' '}
                    <strong>{unknownPlaceholders.map((u) => `{{${u}}}`).join(', ')}</strong> in your recipient list —
                    it will be sent literally as typed.
                  </span>
                </div>
              )}
            </div>

            {/* Email Background Theme Picker */}
            <EmailBackgroundPicker value={bgPick} onChange={setBgPick} disabled={sending} />

            {/* Attachments Section */}
            <div className="space-y-2 pt-2 border-t border-theme-border/15">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleAttachFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessingAttachments}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme-card-border bg-theme-background/30 text-theme-text-primary hover:bg-theme-border/20 text-xs font-semibold cursor-pointer transition-all disabled:opacity-50"
                >
                  {isProcessingAttachments ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5" />
                  )}
                  Attach Files
                </button>
                {attachments.length > 0 && (
                  <span className="text-[11px] text-theme-text-secondary">
                    {formatBytes(totalAttachmentBytes)} of {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}
                  </span>
                )}
              </div>

              {attachmentError && <p className="text-[11px] text-danger">{attachmentError}</p>}

              {attachments.length > 0 && (
                <div className="space-y-1.5">
                  {attachments.map((att, idx) => (
                    <div
                      key={`${att.filename}-${idx}`}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-theme-background/30 border border-theme-border/20 text-xs"
                    >
                      <span className="truncate text-theme-text-primary font-medium">
                        {att.filename}{' '}
                        <span className="text-[11px] text-theme-text-secondary">({formatBytes(att.size)})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx)}
                        className="text-theme-text-secondary hover:text-danger cursor-pointer p-1"
                        title="Remove file"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* STEP 3: DISPATCH & SCHEDULE */}
          <div className="glass-panel p-5 md:p-6 rounded-3xl border border-theme-card-border space-y-4">
            <div className="flex items-center gap-2 border-b border-theme-border/15 pb-3">
              <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-[11px] flex items-center justify-center">
                3
              </span>
              <h3 className="text-sm font-bold text-theme-text-primary">Dispatch Settings &amp; Broadcast</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-theme-text-secondary">
                  Batch Tag / Label (optional)
                </label>
                <input
                  type="text"
                  value={batchLabel}
                  onChange={(e) => setBatchLabel(e.target.value)}
                  placeholder="e.g. Q1 Cohort Invitations"
                  className="w-full px-4 py-2 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-theme-text-secondary">Email Category Tag</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                  className="w-full px-4 py-2 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="ANNOUNCEMENT">Announcement Broadcast</option>
                  <option value="DIRECT_MESSAGE">Direct Notification</option>
                  <option value="SYSTEM">System Broadcast</option>
                </select>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-theme-border/15">
              <label className="flex items-center gap-2 text-xs text-theme-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleOn}
                  onChange={(e) => setScheduleOn(e.target.checked)}
                  className="rounded"
                />
                <CalendarClock className="h-4 w-4 text-accent" />
                <span>Send later at scheduled time</span>
              </label>

              {scheduleOn && (
                <input
                  type="datetime-local"
                  value={sendAt}
                  onChange={(e) => setSendAt(e.target.value)}
                  className="px-3 py-1.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent"
                />
              )}
            </div>

            <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-theme-text-secondary">
                {validationError ? (
                  <span className="text-danger flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {validationError}
                  </span>
                ) : (
                  <span className="text-emerald-400 flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5" />
                    Ready to broadcast to {recipients.length} recipient{recipients.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={Boolean(validationError) || sending}
                onClick={() => setConfirming(true)}
                className="px-6 py-2.5 rounded-xl bg-accent text-white hover:bg-primary-light font-bold text-xs cursor-pointer shadow-md shadow-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {recipients.length > 1 ? `Broadcast to ${recipients.length} Recipients` : 'Send Broadcast Email'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Live Recipient-by-Recipient Preview */}
        <div className="lg:col-span-5 sticky top-6 space-y-4">
          <div className="glass-panel p-5 rounded-3xl border border-theme-card-border space-y-3">
            <div className="flex items-center justify-between border-b border-theme-border/20 pb-3">
              <h3 className="text-sm font-bold text-theme-text-primary">Live Recipient Preview</h3>
              {recipients.length > 1 && (
                <div className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    disabled={previewIndex === 0}
                    onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                    className="p-1 rounded-lg hover:bg-theme-border/20 text-theme-text-secondary disabled:opacity-30 cursor-pointer"
                    aria-label="Previous recipient preview"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="font-mono text-[11px] px-1 text-theme-text-primary">
                    {previewIndex + 1} / {recipients.length}
                  </span>
                  <button
                    type="button"
                    disabled={previewIndex >= recipients.length - 1}
                    onClick={() => setPreviewIndex((i) => Math.min(recipients.length - 1, i + 1))}
                    className="p-1 rounded-lg hover:bg-theme-border/20 text-theme-text-secondary disabled:opacity-30 cursor-pointer"
                    aria-label="Next recipient preview"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="text-xs space-y-1 font-mono text-theme-text-secondary border-b border-theme-border/15 pb-2">
              <p>
                From:{' '}
                <strong className="text-theme-text-primary">
                  {senderName} &lt;{senderEmail}&gt;
                </strong>
              </p>
              <p>
                To:{' '}
                <strong className="text-theme-text-primary">
                  {currentRecipient?.email || 'recipient@domain.com'}
                </strong>
              </p>
              <p>
                Subject:{' '}
                <strong className="text-accent font-sans font-semibold">
                  {previewSubject || subject || 'Subject Line Preview'}
                </strong>
              </p>
            </div>

            {/* Rendered Email Frame */}
            <EmailHtmlPreview
              title="Mail broadcast preview"
              subject={previewSubject || subject || 'Subject Preview'}
              bodyText={bodyIsHtml ? undefined : previewBody || bodyText || 'Your message text will appear here...'}
              bodyHtml={bodyIsHtml ? previewBody || bodyText : undefined}
              category={category}
              badgeText={badgeText.trim() || undefined}
              background={backgroundChoiceFor(bgPick)}
              className="w-full h-[480px] rounded-2xl border border-theme-border/30 bg-slate-200"
            />

            {attachments.length > 0 && (
              <p className="text-[11px] text-theme-text-secondary">
                Attachments: {attachments.map((a) => a.filename).join(', ')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* MODAL: DIRECTORY MEMBERS PICKER */}
      {showDirectoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-3xl rounded-3xl p-6 space-y-4 border border-theme-card-border shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-theme-border/20 pb-3">
              <div>
                <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                  <Users className="h-4 w-4 text-accent" />
                  Select Members from Users Directory
                </h3>
                <p className="text-xs text-theme-text-secondary mt-0.5">
                  Pick members to insert into your broadcast list with their names, roles, departments, and phone numbers.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDirectoryModal(false)}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/20 text-theme-text-secondary cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              <div className="relative flex-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-secondary" />
                <input
                  type="text"
                  placeholder="Search by name, email, role, department, phone…"
                  value={directorySearch}
                  onChange={(e) => setDirectorySearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-theme-background/40 border border-theme-card-border rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
                {['ALL', 'Super User', 'CEO', 'Employee', 'Startup'].map((div) => (
                  <button
                    key={div}
                    type="button"
                    onClick={() => setDirectoryDivision(div)}
                    className={`px-3 py-1.5 rounded-xl font-medium cursor-pointer transition-all whitespace-nowrap ${
                      directoryDivision === div
                        ? 'bg-accent text-white shadow-sm'
                        : 'bg-theme-background/40 text-theme-text-secondary hover:bg-theme-border/20'
                    }`}
                  >
                    {div}
                  </button>
                ))}
              </div>
            </div>

            {/* Selection Quick Actions */}
            <div className="flex items-center justify-between text-xs text-theme-text-secondary px-1">
              <span>
                {filteredDirectoryMembers.length} member{filteredDirectoryMembers.length === 1 ? '' : 's'} matching
                filters
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="text-accent hover:underline font-semibold cursor-pointer"
                >
                  Select all visible ({filteredDirectoryMembers.length})
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-theme-text-secondary hover:text-theme-text-primary cursor-pointer"
                >
                  Deselect all
                </button>
              </div>
            </div>

            {/* Members List Table */}
            <div className="flex-1 overflow-y-auto border border-theme-card-border rounded-2xl bg-theme-background/20 max-h-80">
              {directoryLoading ? (
                <div className="p-8 flex flex-col items-center justify-center gap-2 text-theme-text-secondary text-xs">
                  <Loader2 className="h-6 w-6 animate-spin text-accent" />
                  <span>Loading directory members…</span>
                </div>
              ) : filteredDirectoryMembers.length === 0 ? (
                <div className="p-8 text-center text-xs text-theme-text-secondary">
                  No members found matching your search.
                </div>
              ) : (
                <div className="divide-y divide-theme-border/10 text-xs">
                  {filteredDirectoryMembers.map((m) => {
                    const isSelected = selectedMemberEmails.has((m.email || '').toLowerCase());
                    return (
                      <div
                        key={m.id || m.email}
                        onClick={() => toggleMemberSelection(m.email)}
                        className={`p-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                          isSelected ? 'bg-accent/10' : 'hover:bg-theme-border/10'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="text-accent">
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4" />
                            ) : (
                              <Square className="h-4 w-4 text-theme-text-secondary" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-theme-text-primary truncate">{m.name}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-theme-border/20 text-theme-text-secondary">
                                {m.division || m.role}
                              </span>
                            </div>
                            <div className="text-[11px] text-theme-text-secondary truncate flex items-center gap-2 mt-0.5">
                              <span>{m.email}</span>
                              {(m.department || m.program) && (
                                <>
                                  <span>·</span>
                                  <span>{m.department || m.program}</span>
                                </>
                              )}
                              {m.phone && (
                                <>
                                  <span>·</span>
                                  <span>{m.phone}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom Options & Action */}
            <div className="border-t border-theme-border/20 pt-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <div className="font-semibold text-accent flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4" />
                  {selectedMemberEmails.size} member{selectedMemberEmails.size === 1 ? '' : 's'} selected
                </div>

                <div className="flex items-center gap-2 text-theme-text-secondary">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="dirAppendMode"
                      checked={appendMode === 'append'}
                      onChange={() => setAppendMode('append')}
                    />
                    <span>Append</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="dirAppendMode"
                      checked={appendMode === 'replace'}
                      onChange={() => setAppendMode('replace')}
                    />
                    <span>Replace list</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDirectoryModal(false)}
                  className="px-4 py-2 rounded-xl border border-theme-card-border text-theme-text-secondary hover:text-theme-text-primary text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={selectedMemberEmails.size === 0}
                  onClick={importSelectedMembers}
                  className="px-5 py-2 rounded-xl bg-accent text-white hover:bg-primary-light text-xs font-bold cursor-pointer disabled:opacity-50 transition-all shadow-md shadow-accent/20 flex items-center gap-1.5"
                >
                  <Users className="h-4 w-4" />
                  Insert {selectedMemberEmails.size} Members
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL */}
      <ConfirmModal
        isOpen={confirming}
        title={recipients.length > 1 ? `Broadcast to ${recipients.length} recipients?` : 'Send broadcast email?'}
        confirmLabel={scheduleOn ? (sending ? 'Scheduling...' : 'Schedule Broadcast') : (sending ? 'Sending...' : 'Send Broadcast')}
        variant="primary"
        onCancel={() => !sending && setConfirming(false)}
        onConfirm={handleSendBroadcast}
        message={
            <div className="space-y-3 text-xs text-theme-text-secondary">
              <p>
                Subject: <strong className="text-theme-text-primary">{previewSubject || subject}</strong>
              </p>
              <p>
                Recipient count:{' '}
                <strong className="text-theme-text-primary">
                  {recipients.length} recipient{recipients.length === 1 ? '' : 's'}
                </strong>{' '}
                (each recipient will receive their own individually personalised message).
              </p>
              {attachments.length > 0 && (
                <p>
                  Attachments:{' '}
                  <strong className="text-theme-text-primary">
                    {attachments.length} file{attachments.length === 1 ? '' : 's'}
                  </strong>{' '}
                  ({formatBytes(totalAttachmentBytes)}).
                </p>
              )}
              {scheduleOn && sendAt && (
                <p className="text-accent font-semibold">
                  Scheduled delivery:{' '}
                  {new Date(sendAt).toLocaleString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              )}
              {unknownPlaceholders.length > 0 && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300">
                  Warning: The following placeholders have no matching columns and will appear verbatim:{' '}
                  {unknownPlaceholders.map((u) => `{{${u}}}`).join(', ')}.
                </div>
              )}
            </div>
          }
        />
    </div>
  );
}
