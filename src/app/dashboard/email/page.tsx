'use client';

import React, { useState, useEffect, useRef } from 'react';
import { authHeaders } from '@/lib/local-data';
import { beginTask } from '@/lib/background-tasks';
import {
  Mail, 
  Server, 
  Send, 
  CheckCircle2, 
  AlertCircle, 
  Lock, 
  ShieldAlert, 
  Eye, 
  EyeOff, 
  RefreshCw,
  FileText,
  Sparkles,
  Key,
  Globe,
  Search,
  X,
  Check,
  Zap,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Rocket,
  Clock,
  Inbox,
  Play,
  Filter,
  Paperclip,
  Loader2,
  Award,
  CalendarClock
} from 'lucide-react';
import { EmailSettings, EmailLog } from '@/lib/email-service';
import { canManageEmailSettings } from '@/lib/permissions';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { EmailHtmlPreview } from '@/components/email-html-preview';
import { EmailBackgroundField, EmailBackgroundPicker, DEFAULT_BACKGROUND_PICK, EMAIL_BLUR_DEFAULT, backgroundChoiceFor, type EmailBackgroundPick } from '@/components/email-background-picker';
import { ComposedAttachment, filesToAttachments, formatBytes, buildAttachmentNoticeLine, MAX_TOTAL_ATTACHMENT_BYTES } from '@/lib/email-attachments';

interface PendingQueueItem {
  email: string;
  assigneeName: string;
  taskCount: number;
  tasks: Array<{
    id: string;
    title: string;
    event?: string;
    dueDate?: string;
    creatorName?: string;
    assignedAt: string;
  }>;
}

interface CertScheduleItem {
  id: string;
  eventTitle: string;
  typeName: string;
  recipients: number;
  sendAt: string;
  deliverAfter: string;
  status: 'Scheduled' | 'Running' | 'Done' | 'Failed' | 'Cancelled';
  sent?: number;
  failed?: number;
  error?: string;
  finishedAt?: string;
  createdBy: string;
}

interface PassScheduleItem {
  id: string;
  count: number;
  sendAt: string;
  eventNames: string[];
  createdBy: string;
  status: 'Scheduled' | 'Running' | 'Done' | 'Failed' | 'Cancelled';
  sent?: number;
  failed?: number;
  skipped?: number;
  error?: string;
  finishedAt?: string;
}

interface BufferedEmailItem {
  id: string;
  to: string;
  subject: string;
  category: string;
  queuedAt: string;
  bufferedUntil: string;
  remainingMs: number;
  remainingSeconds: number;
  hasAttachments: boolean;
  attachmentCount: number;
}

export default function EmailManagementPage() {
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'outbox' | 'queue' | 'certificates' | 'composer' | 'settings'>('outbox');
  const [certSchedules, setCertSchedules] = useState<CertScheduleItem[]>([]);
  const [passSchedules, setPassSchedules] = useState<PassScheduleItem[]>([]);
  const [isCancellingSchedule, setIsCancellingSchedule] = useState<string | null>(null);

  // Email Settings Form State
  const [settings, setSettings] = useState<EmailSettings>({
    id: 'default',
    provider: 'gmail',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    secure: false,
    authUser: 'portal@example.com',
    authPass: '',
    fromName: 'RTBI Portal',
    fromEmail: 'portal@example.com',
    replyTo: 'portal@example.com',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [showDkimSection, setShowDkimSection] = useState(false);

  // SMTP Test Diagnostics State
  const [testRecipient, setTestRecipient] = useState('');
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Email Client Composer State
  const [dispatchScope, setDispatchScope] = useState<'SINGLE' | 'All Members' | 'Super User' | 'CEO' | 'Employee' | 'Startup'>('SINGLE');
  const [customRecipient, setCustomRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<'ANNOUNCEMENT' | 'DIRECT_MESSAGE' | 'SYSTEM'>('ANNOUNCEMENT');
  const [bodyText, setBodyText] = useState('');
  const [previewTab, setPreviewTab] = useState<'edit' | 'preview'>('edit');
  const [isSendingDispatch, setIsSendingDispatch] = useState(false);
  const [showDispatchConfirm, setShowDispatchConfirm] = useState(false);
  const [attachments, setAttachments] = useState<ComposedAttachment[]>([]);
  const [isProcessingAttachments, setIsProcessingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');

  // Outbox & Audit Logs State
  const [outboxLogs, setOutboxLogs] = useState<EmailLog[]>([]);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState<'ALL' | 'SENT' | 'FAILED' | 'BUFFERED' | 'CANCELLED'>('ALL');
  const [logCategoryFilter, setLogCategoryFilter] = useState<string>('ALL');
  const [selectedLog, setSelectedLog] = useState<EmailLog | null>(null);
  const LOG_PAGE_SIZE = 50;
  const [logsHasMore, setLogsHasMore] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsMatchedTotal, setLogsMatchedTotal] = useState(0);
  const [isLoadingMoreLogs, setIsLoadingMoreLogs] = useState(false);
  const [logCounts, setLogCounts] = useState({ total: 0, sent: 0, buffered: 0, failed: 0 });
  const logFiltersRef = useRef({ q: '', status: 'ALL' as string, category: 'ALL' as string });
  logFiltersRef.current = { q: logSearchQuery.trim(), status: logStatusFilter, category: logCategoryFilter };
  const logOffsetRef = useRef(0);
  const logReqRef = useRef(0);
  const logFiltersInitRef = useRef(true);

  // Pending Buffer Queues State
  const [pendingQueues, setPendingQueues] = useState<PendingQueueItem[]>([]);
  const [bufferedEmails, setBufferedEmails] = useState<BufferedEmailItem[]>([]);
  const [isFlushingQueue, setIsFlushingQueue] = useState<string | null>(null);

  // Toast notifications
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        const u = JSON.parse(savedUser);
        setUser(u);
        setTestRecipient(u.email || 'portal@example.com');
      } catch (e) {
        console.error(e);
      }
    }
    fetchSettings();
    fetchLogs();
    fetchQueues();
    fetchCertSchedules();

    // Config may have been changed from another device/session — always
    // re-pull the persisted settings when the user comes back to this tab
    // instead of trusting whatever was fetched at mount time.
    const revalidateSettings = () => {
      if (document.visibilityState === 'visible') fetchSettings();
    };
    document.addEventListener('visibilitychange', revalidateSettings);
    window.addEventListener('focus', revalidateSettings);
    return () => {
      document.removeEventListener('visibilitychange', revalidateSettings);
      window.removeEventListener('focus', revalidateSettings);
    };
  }, []);

  // Re-query the server (first page) whenever the search/filters change.
  useEffect(() => {
    if (logFiltersInitRef.current) { logFiltersInitRef.current = false; return; }
    const t = setTimeout(() => fetchLogs(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logSearchQuery, logStatusFilter, logCategoryFilter]);

  const triggerToast = (type: 'success' | 'error', text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => setToastMsg(null), 4500);
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/email/settings', { cache: 'no-store', headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        if (data.dkimPrivateKey) setShowDkimSection(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Loads one page (LOG_PAGE_SIZE) of logs; filters are applied server-side.
  // append=true fetches the next page and adds it to the list.
  const fetchLogs = async (append = false) => {
    const { q, status, category } = logFiltersRef.current;
    const offset = append ? logOffsetRef.current : 0;
    const reqId = ++logReqRef.current;
    if (append) setIsLoadingMoreLogs(true);
    try {
      const params = new URLSearchParams({ limit: String(LOG_PAGE_SIZE), offset: String(offset), status, category, q });
      if (!append) params.set('fresh', '1');
      const res = await fetch(`/api/email/logs?${params}`, { headers: authHeaders(), cache: 'no-store' });
      if (!res.ok) {
        if (reqId === logReqRef.current) {
          const err = await res.json().catch(() => ({}));
          setLogsError(err.error || `Could not load email logs (HTTP ${res.status}).`);
        }
      } else if (reqId === logReqRef.current) {
        setLogsError(null);
        const data = await res.json();
        const page: EmailLog[] = data.logs || [];
        setOutboxLogs(prev => append ? [...prev, ...page.filter(l => !prev.some(p => p.id === l.id))] : page);
        logOffsetRef.current = offset + page.length;
        setLogsHasMore(!!data.hasMore);
        setLogsMatchedTotal(data.total ?? page.length);
        if (data.counts) setLogCounts(data.counts);
      }
    } catch (e) {
      console.error(e);
      if (reqId === logReqRef.current) setLogsError('Could not reach the server to load email logs.');
    } finally {
      if (append) setIsLoadingMoreLogs(false);
    }
  };

  const fetchQueues = async () => {
    try {
      const res = await fetch('/api/email/queue', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setPendingQueues(data.queues || []);
        setBufferedEmails(data.bufferedEmails || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchCertSchedules = async () => {
    try {
      const res = await fetch('/api/email/certificates', { headers: authHeaders() });
      if (res.ok) setCertSchedules((await res.json()).schedules || []);
      const pr = await fetch('/api/pass-email-schedules', { headers: authHeaders() });
      if (pr.ok) setPassSchedules((await pr.json()).schedules || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCancelPassSchedule = async (id: string) => {
    if (!window.confirm('Cancel this scheduled pass email send? Nothing will be emailed for it.')) return;
    setIsCancellingSchedule(id);
    try {
      const res = await fetch(`/api/pass-email-schedules?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) triggerToast('success', 'Scheduled pass email send cancelled.');
      else triggerToast('error', data.error || 'Could not cancel that scheduled send.');
      fetchCertSchedules();
    } finally {
      setIsCancellingSchedule(null);
    }
  };

  const handleCancelSchedule = async (id: string) => {
    if (!window.confirm('Cancel this scheduled certificate send? Nothing will be emailed for it.')) return;
    setIsCancellingSchedule(id);
    try {
      const res = await fetch(`/api/email/certificates?scheduleId=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) triggerToast('success', 'Scheduled certificate send cancelled.');
      else triggerToast('error', data.error || 'Could not cancel that scheduled send.');
      fetchCertSchedules();
    } catch (err: any) {
      triggerToast('error', err?.message || 'Error cancelling the scheduled send');
    } finally {
      setIsCancellingSchedule(null);
    }
  };

  // Keep the Scheduled Certificates tab fresh while it is open (batches fire and emails enter the buffer on their own).
  useEffect(() => {
    if (activeTab !== 'certificates') return;
    const refresh = () => { fetchCertSchedules(); fetchQueues(); };
    refresh();
    const h = setInterval(refresh, 15000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleCertBulk = async (action: 'flush' | 'cancel') => {
    setIsFlushingQueue('CERT_ALL');
    try {
      const res = action === 'flush'
        ? await fetch('/api/email/queue', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ all: true, only: 'CERTIFICATE' }) })
        : await fetch('/api/email/queue?all=true&scope=certificates', { method: 'DELETE', headers: authHeaders() });
      if (res.ok) triggerToast('success', action === 'flush' ? 'All certificate emails dispatched now.' : 'All buffered certificate emails cancelled.');
      else triggerToast('error', 'Could not complete that action.');
      fetchQueues();
      fetchLogs();
    } catch (err: any) {
      triggerToast('error', err?.message || 'Error updating certificate emails');
    } finally {
      setIsFlushingQueue(null);
    }
  };

  // Live countdown timer for buffered outgoing emails
  useEffect(() => {
    if (bufferedEmails.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setBufferedEmails(prev =>
        prev.map(item => {
          const untilMs = new Date(item.bufferedUntil).getTime();
          const rem = Math.max(0, Math.ceil((untilMs - now) / 1000));
          return { ...item, remainingSeconds: rem };
        })
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [bufferedEmails.length]);

  const formatCountdown = (totalSeconds: number): string => {
    if (totalSeconds <= 0) return '00m:00s (Dispatching now)';
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}m:${String(secs).padStart(2, '0')}s remaining`;
  };

  const [isCancellingQueue, setIsCancellingQueue] = useState<string | null>(null);

  const handleCancelQueue = async (email?: string) => {
    setIsCancellingQueue(email || 'ALL');
    try {
      const url = email ? `/api/email/queue?email=${encodeURIComponent(email)}` : '/api/email/queue?all=true&scope=general';
      const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        triggerToast('success', data.message || 'Queued email buffer cancelled.');
        fetchQueues();
        fetchLogs();
      } else {
        triggerToast('error', 'Failed to cancel queue.');
      }
    } catch (err: any) {
      triggerToast('error', err?.message || 'Error cancelling queue');
    } finally {
      setIsCancellingQueue(null);
    }
  };

  const handleCancelBufferedEmail = async (id: string) => {
    setIsCancellingQueue(id);
    try {
      const res = await fetch(`/api/email/queue?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        triggerToast('success', 'Email cancelled and discarded from buffer queue.');
        fetchQueues();
        fetchLogs();
        if (selectedLog && selectedLog.id === id) {
          setSelectedLog(prev => prev ? { ...prev, status: 'CANCELLED' } : null);
        }
      } else {
        triggerToast('error', 'Failed to cancel buffered email.');
      }
    } catch (err: any) {
      triggerToast('error', err?.message || 'Error cancelling email');
    } finally {
      setIsCancellingQueue(null);
    }
  };

  const handleFlushQueue = async (email: string) => {
    setIsFlushingQueue(email);
    try {
      const res = await fetch('/api/email/queue', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        triggerToast('success', `Flushed and dispatched task digest email to ${email}`);
        fetchQueues();
        fetchLogs();
      } else {
        triggerToast('error', (await res.json().catch(() => ({}))).error || `Failed to flush queue (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      triggerToast('error', err?.message || 'Error flushing queue');
    } finally {
      setIsFlushingQueue(null);
    }
  };

  const handleFlushBufferedEmail = async (id: string) => {
    setIsFlushingQueue(id);
    try {
      const res = await fetch('/api/email/queue', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        triggerToast('success', 'Email dispatched immediately via SMTP.');
        fetchQueues();
        fetchLogs();
        if (selectedLog && selectedLog.id === id) {
          setSelectedLog(prev => prev ? { ...prev, status: 'SENT' } : null);
        }
      } else {
        triggerToast('error', (await res.json().catch(() => ({}))).error || `Failed to dispatch buffered email (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      triggerToast('error', err?.message || 'Error dispatching email');
    } finally {
      setIsFlushingQueue(null);
    }
  };

  const handleFlushAll = async () => {
    setIsFlushingQueue('ALL');
    try {
      const res = await fetch('/api/email/queue', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ all: true, except: 'CERTIFICATE' }),
      });
      if (res.ok) {
        triggerToast('success', 'All buffered emails dispatched immediately.');
        fetchQueues();
        fetchLogs();
      } else {
        triggerToast('error', (await res.json().catch(() => ({}))).error || `Failed to flush all queues (HTTP ${res.status}).`);
      }
    } catch (err: any) {
      triggerToast('error', err?.message || 'Error flushing all queues');
    } finally {
      setIsFlushingQueue(null);
    }
  };

  // Provider Preset Handler
  const handleSelectProvider = (provider: EmailSettings['provider']) => {
    if (provider === 'gmail') {
      setSettings(prev => ({
        ...prev,
        provider: 'gmail',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        secure: false,
      }));
    } else if (provider === 'outlook') {
      setSettings(prev => ({
        ...prev,
        provider: 'outlook',
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        secure: false,
      }));
    } else if (provider === 'local_postfix') {
      setSettings(prev => ({
        ...prev,
        provider: 'local_postfix',
        smtpHost: 'localhost',
        smtpPort: 25,
        secure: false,
      }));
    } else if (provider === 'direct_send') {
      setSettings(prev => ({
        ...prev,
        provider: 'direct_send',
      }));
    } else {
      setSettings(prev => ({
        ...prev,
        provider: 'custom',
      }));
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      const res = await fetch('/api/email/settings', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ settings, actorName: user?.name || 'Super User' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSettings(updated);
        triggerToast('success', 'Email server credentials and SMTP settings updated successfully.');
      } else {
        const data = await res.json().catch(() => null);
        triggerToast('error', data?.error || 'Failed to save email settings.');
      }
    } catch (err: any) {
      triggerToast('error', err?.message || 'Error saving settings.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  /** Saves only the default mail background, so the SMTP credentials above are left exactly as they are. */
  const handleSaveBackground = async () => {
    setIsSavingBackground(true);
    try {
      const bg = settings.background;
      const res = await fetch('/api/email/settings', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ settings: { background: bg?.storageKey ? { enabled: bg.enabled !== false, storageKey: bg.storageKey, blur: bg.blur ?? EMAIL_BLUR_DEFAULT } : undefined }, actorName: user?.name || 'Super User' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSettings(prev => ({ ...prev, background: updated.background, updatedAt: updated.updatedAt }));
        triggerToast('success', updated.background?.enabled ? 'Default email background saved. It is used on every email unless a send turns it off.' : 'Default email background removed.');
      } else {
        const data = await res.json().catch(() => null);
        triggerToast('error', data?.error || 'Failed to save the email background.');
      }
    } catch (err: any) {
      triggerToast('error', err?.message || 'Error saving the email background.');
    } finally {
      setIsSavingBackground(false);
    }
  };

  const handleTestConnection = async () => {
    if (!testRecipient) {
      triggerToast('error', 'Please enter a test recipient email address.');
      return;
    }
    setIsTestingSmtp(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/email/test', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        // Test whatever is currently in the form — including a provider
        // switch or credentials that haven't been saved yet — not whatever
        // was last saved. Otherwise switching providers here and testing
        // silently re-tests the old saved config with no way to tell.
        body: JSON.stringify({ testRecipient, settings }),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        triggerToast('success', 'SMTP test successful! Check test inbox.');
      } else {
        triggerToast('error', 'SMTP test failed. Check server credentials.');
      }
      fetchLogs();
    } catch (err: any) {
      setTestResult({ success: false, message: err?.message || 'Connection test failed' });
      triggerToast('error', 'Failed to reach SMTP server.');
    } finally {
      setIsTestingSmtp(false);
    }
  };

  const [badgeOption, setBadgeOption] = useState<string>('NONE');
  const [customBadgeText, setCustomBadgeText] = useState<string>('');
  const [bgPick, setBgPick] = useState<EmailBackgroundPick>(DEFAULT_BACKGROUND_PICK);
  const [isSavingBackground, setIsSavingBackground] = useState(false);

  const handleAttachFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setAttachmentError('');
    setIsProcessingAttachments(true);
    try {
      const files = Array.from(fileList);
      const existingBytes = attachments.reduce((sum, a) => sum + a.size, 0);
      const incomingBytes = files.reduce((sum, f) => sum + f.size, 0);
      if (existingBytes + incomingBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        setAttachmentError(`Total attachment size can't exceed ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} — most SMTP servers (including Outlook) reject larger messages.`);
        return;
      }
      const newAttachments = await filesToAttachments(files);
      setAttachments(prev => [...prev, ...newAttachments]);
    } catch (err: any) {
      setAttachmentError(err?.message || 'Failed to read one or more files.');
    } finally {
      setIsProcessingAttachments(false);
    }
  };

  const handleRemoveAttachment = (filename: string) => {
    setAttachments(prev => prev.filter(a => a.filename !== filename));
  };

  const handleInsertAttachmentNote = () => {
    if (attachments.length === 0) return;
    const line = buildAttachmentNoticeLine(attachments.map(a => a.filename));
    setBodyText(prev => (prev.trim() ? `${prev}\n\n${line}` : line));
  };

  /** The header tag chosen for the email (shared by the real send and the live preview). */
  const resolveBadgeText = (): string | undefined => {
    if (badgeOption === 'INVITATION') return '🎉 Official Invitation';
    if (badgeOption === 'ANNOUNCEMENT') return '📢 Official Announcement';
    if (badgeOption === 'ACTION_REQUIRED') return '📌 Action Required';
    if (badgeOption === 'IMPORTANT') return '⚠️ Important Notice';
    if (badgeOption === 'CUSTOM') return customBadgeText.trim() || undefined;
    return undefined;
  };

  const handleExecuteDispatch = async () => {
    setShowDispatchConfirm(false);
    setIsSendingDispatch(true);
    const task = beginTask({ label: dispatchScope === 'SINGLE' ? 'Sending email' : 'Dispatching broadcast email' });
    try {
      const resolvedBadgeText = resolveBadgeText();

      const payload = {
        scope: dispatchScope,
        recipientEmail: dispatchScope === 'SINGLE' ? customRecipient : undefined,
        subject,
        bodyText,
        category,
        badgeText: resolvedBadgeText,
        background: backgroundChoiceFor(bgPick),
        attachments: attachments.map(({ filename, contentBase64, contentType }) => ({ filename, contentBase64, contentType })),
      };
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        triggerToast('success', `Dispatched ${data.count} email notification(s) successfully.`);
        task.finish(`Queued ${data.count} email${data.count === 1 ? '' : 's'} (10-minute hold applies).`);
        setSubject('');
        setBodyText('');
        setCustomRecipient('');
        setAttachments([]);
        fetchLogs();
      } else {
        triggerToast('error', data.error || 'Failed to dispatch emails.');
        task.fail(data.error || 'Failed to dispatch emails.');
      }
    } catch (err: any) {
      triggerToast('error', err?.message || 'Error executing email dispatch.');
      task.fail(err?.message || 'Error executing email dispatch.');
    } finally {
      setIsSendingDispatch(false);
    }
  };

  // Logs arrive already filtered and paginated from the server.
  const filteredLogs = outboxLogs;

  const totalLogs = logCounts.total;
  const sentCount = logCounts.sent;
  const bufferedCount = logCounts.buffered;
  const failedCount = logCounts.failed;
  // Certificate emails get their own tab; the general queue shows everything else.
  const certBuffered = bufferedEmails.filter(b => b.category === 'CERTIFICATE');
  const otherBuffered = bufferedEmails.filter(b => b.category !== 'CERTIFICATE');
  const upcomingSchedules = certSchedules.filter(s => s.status === 'Scheduled' || s.status === 'Running');
  const totalQueueCount = pendingQueues.length + otherBuffered.length;
  const upcomingPassSchedules = passSchedules.filter(s => s.status === 'Scheduled' || s.status === 'Running');
  const certTabCount = upcomingSchedules.length + certBuffered.length + upcomingPassSchedules.length;

  const isSuperUser = user && (user.tier === 1 || user.role === 'Super User' || user.id === 'm1' || user.email?.toLowerCase() === 'kayo2970@gmail.com');

  // Access Guard — Centre Head / Super User, or an explicit Group Policy grant
  const isAuthorized = user && canManageEmailSettings(user);

  if (user && !isAuthorized) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="glass-panel p-8 rounded-3xl border border-danger/30 text-center space-y-4 shadow-2xl">
          <div className="h-16 w-16 bg-danger/15 rounded-2xl flex items-center justify-center mx-auto text-danger border border-danger/25">
            <Lock className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold text-theme-text-primary">Centre Head Access Only</h2>
          <p className="text-xs text-theme-text-secondary leading-relaxed">
            The Mailroom Audit Portal handles global SMTP server configurations, outbox delivery logs, dispatch queues, and system transmission histories. Access is strictly restricted to the Centre Head.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      
      {/* Toast Alert */}
      {toastMsg && (
        <div className={`p-4 rounded-2xl text-xs font-semibold flex items-center gap-3 animate-in fade-in duration-300 border shadow-lg ${
          toastMsg.type === 'success' 
            ? 'bg-success/15 border-success/30 text-theme-text-primary' 
            : 'bg-danger/15 border-danger/30 text-theme-text-primary'
        }`}>
          {toastMsg.type === 'success' ? <CheckCircle2 className="h-5 w-5 text-success shrink-0" /> : <AlertCircle className="h-5 w-5 text-danger shrink-0" />}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="glass-panel p-6 rounded-3xl border border-accent/20 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-accent/10 via-primary/5 to-transparent">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent/15 text-accent border border-accent/20">
              <Mail className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold text-theme-text-primary">Centre Head Operational Mailbox & Audit Desk</h1>
          </div>
          <p className="text-xs text-theme-text-secondary">
            View outbox dispatch histories, inspect pending email queues, compose broadcasts, and monitor operational delivery.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold px-3 py-1 bg-accent/15 text-accent rounded-xl border border-accent/20 flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5" />
            SMTP Relay: {settings.provider.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Mailbox Suite Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-theme-border/30 pb-3 text-xs font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveTab('outbox')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all cursor-pointer ${
            activeTab === 'outbox' 
              ? 'bg-accent text-white shadow-md shadow-accent/20' 
              : 'text-theme-text-secondary hover:bg-theme-border/20'
          }`}
        >
          <Inbox className="h-4 w-4" />
          Sent Outbox & Delivery Audit ({totalLogs})
        </button>

        <button
          onClick={() => {
            setActiveTab('queue');
            fetchQueues();
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all cursor-pointer relative ${
            activeTab === 'queue' 
              ? 'bg-accent text-white shadow-md shadow-accent/20' 
              : 'text-theme-text-secondary hover:bg-theme-border/20'
          }`}
        >
          <Clock className="h-4 w-4" />
          Sending Queue & Buffers ({totalQueueCount})
          {totalQueueCount > 0 && (
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping absolute top-1 right-1" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('certificates')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all cursor-pointer relative ${
            activeTab === 'certificates'
              ? 'bg-accent text-white shadow-md shadow-accent/20'
              : 'text-theme-text-secondary hover:bg-theme-border/20'
          }`}
        >
          <Award className="h-4 w-4" />
          Scheduled Sends ({certTabCount})
          {certTabCount > 0 && (
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping absolute top-1 right-1" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('composer')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all cursor-pointer ${
            activeTab === 'composer' 
              ? 'bg-accent text-white shadow-md shadow-accent/20' 
              : 'text-theme-text-secondary hover:bg-theme-border/20'
          }`}
        >
          <Send className="h-4 w-4" />
          Compose Broadcast
        </button>

        {isSuperUser && (
          <button
            onClick={() => {
              setActiveTab('settings');
              fetchSettings();
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-accent text-white shadow-md shadow-accent/20' 
                : 'text-theme-text-secondary hover:bg-theme-border/20'
            }`}
          >
            <Server className="h-4 w-4" />
            SMTP Configuration
          </button>
        )}
      </div>

      {/* TAB 1: SENT OUTBOX & DELIVERY AUDIT LOGS */}
      {activeTab === 'outbox' && (
        <div className="glass-panel p-6 rounded-3xl space-y-5 border border-theme-card-border">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                <FileText className="h-4 w-4 text-accent" />
                Sent Email History & Operational Audit Logs
              </h3>
              <p className="text-xs text-theme-text-secondary">Comprehensive history of every email notification, OTP, task digest, and announcement dispatched.</p>
            </div>

            <button
              onClick={() => fetchLogs()}
              className="px-3 py-1.5 bg-theme-border/20 hover:bg-theme-border/40 text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh Outbox Logs
            </button>
          </div>

          {/* Outbox Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 bg-theme-border/10 rounded-2xl border border-theme-border/20 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-theme-text-secondary">Total Messages</span>
              <h4 className="text-2xl font-bold text-theme-text-primary">{totalLogs}</h4>
            </div>

            <div className="p-4 bg-success/10 rounded-2xl border border-success/20 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-success">Delivered / Sent</span>
              <h4 className="text-2xl font-bold text-success">{sentCount}</h4>
            </div>

            <div className="p-4 bg-amber-500/10 rounded-2xl border border-amber-500/20 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">10m Buffered Queue</span>
              <h4 className="text-2xl font-bold text-amber-400">{bufferedCount}</h4>
            </div>

            <div className="p-4 bg-danger/10 rounded-2xl border border-danger/20 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-danger">Delivery Failures</span>
              <h4 className="text-2xl font-bold text-danger">{failedCount}</h4>
            </div>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-theme-text-secondary" />
              <input
                type="text"
                value={logSearchQuery}
                onChange={e => setLogSearchQuery(e.target.value)}
                placeholder="Search recipient email, subject line, category..."
                className="w-full pl-9 pr-3 py-2 bg-theme-background/40 border border-theme-card-border rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 text-theme-text-secondary shrink-0" />
                <select
                  value={logStatusFilter}
                  onChange={e => setLogStatusFilter(e.target.value as any)}
                  className="px-3 py-1.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-xs text-theme-text-primary focus:outline-none"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="SENT">Sent Successfully</option>
                  <option value="BUFFERED">Buffered (10-min window)</option>
                  <option value="CANCELLED">Cancelled</option>
                  <option value="FAILED">Delivery Failed</option>
                </select>
              </div>

              <select
                value={logCategoryFilter}
                onChange={e => setLogCategoryFilter(e.target.value)}
                className="px-3 py-1.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-xs text-theme-text-primary focus:outline-none"
              >
                <option value="ALL">All Categories</option>
                <option value="GROUP_POLICY_GRANT">Group Policy Grants</option>
                <option value="TASK_ASSIGNMENT">Task Assignments</option>
                <option value="EVENT_PASS">Event Passes</option>
                <option value="ANNOUNCEMENT">Announcements</option>
                <option value="DIRECT_MESSAGE">Direct Messages</option>
                <option value="SYSTEM">System Broadcasts</option>
                <option value="EVENT_REPORT_APPROVAL">Report Approvals</option>
                <option value="DESIGN_APPROVAL">Design Approvals</option>
                <option value="PROCUREMENT_DECISION">Procurement Decisions</option>
              </select>
            </div>
          </div>

          {logsError && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-danger/30 bg-danger/10 text-xs text-danger">
              <span>{logsError}</span>
              <button onClick={() => fetchLogs(filteredLogs.length > 0 && logsHasMore ? true : false)} className="px-3 py-1 rounded-lg bg-danger/20 hover:bg-danger/30 font-bold cursor-pointer shrink-0">Retry</button>
            </div>
          )}

          {/* Logs Table */}
          {filteredLogs.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No email logs found"
              description="Dispatched emails and server delivery records will appear here."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-theme-border/20">
              <table className="w-full text-left text-xs text-theme-text-primary">
                <thead className="bg-theme-border/15 text-[11px] uppercase tracking-wider text-theme-text-secondary border-b border-theme-border/20">
                  <tr>
                    <th className="p-3.5 font-bold">Status</th>
                    <th className="p-3.5 font-bold">Recipient Email</th>
                    <th className="p-3.5 font-bold">Subject Line</th>
                    <th className="p-3.5 font-bold">Category</th>
                    <th className="p-3.5 font-bold">Dispatched Date</th>
                    <th className="p-3.5 font-bold text-right">Inspect Payload</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-border/15">
                  {filteredLogs.map(log => (
                    <tr key={log.id} className="hover:bg-theme-border/10 transition-colors">
                      <td className="p-3.5">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                          log.status === 'SENT' 
                            ? 'bg-success/15 text-success border border-success/20' 
                            : log.status === 'BUFFERED'
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                            : log.status === 'CANCELLED'
                            ? 'bg-theme-border/30 text-theme-text-secondary border border-theme-border/40'
                            : 'bg-danger/15 text-danger border border-danger/20'
                        }`}>
                          {log.status === 'BUFFERED' && <Clock className="h-2.5 w-2.5 animate-spin" />}
                          {log.status === 'SENT' ? 'DELIVERED / SENT' : log.status === 'BUFFERED' ? 'BUFFERED (10-MIN HOLD)' : log.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED'}
                        </span>
                      </td>
                      <td className="p-3.5 font-semibold text-theme-text-primary">{log.to}</td>
                      <td className="p-3.5 max-w-xs truncate font-medium">{log.subject}</td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 bg-accent/10 text-accent rounded-md font-mono text-[10px]">
                          {log.category}
                        </span>
                      </td>
                      <td className="p-3.5 text-theme-text-secondary text-[11px] whitespace-nowrap">
                        {new Date(log.sentAt).toLocaleString()}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="px-2.5 py-1 bg-accent/15 hover:bg-accent/25 text-accent text-[11px] font-bold rounded-lg border border-accent/20 transition-all cursor-pointer"
                        >
                          Inspect Payload
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filteredLogs.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-theme-text-secondary">
              <span>Showing {filteredLogs.length} of {logsMatchedTotal} logs (latest first)</span>
              {logsHasMore && (
                <button
                  onClick={() => fetchLogs(true)}
                  disabled={isLoadingMoreLogs}
                  className="px-4 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent font-bold rounded-xl border border-accent/20 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isLoadingMoreLogs ? 'Loading...' : `Load next ${LOG_PAGE_SIZE}`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SENDING QUEUE & BUFFERS */}
      {activeTab === 'queue' && (
        <div className="glass-panel p-6 rounded-3xl space-y-6 border border-theme-card-border">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                <Clock className="h-4 w-4 text-accent" />
                Active Sending Queues & 10-Minute Buffers
              </h3>
              <p className="text-xs text-theme-text-secondary">
                All outgoing emails across the ERP wait in a 10-minute quiet buffer before SMTP handoff.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {totalQueueCount > 0 && (
                <>
                  <button
                    onClick={() => handleCancelQueue()}
                    disabled={Boolean(isCancellingQueue)}
                    className="px-3 py-1.5 bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel All Queues
                  </button>

                  <button
                    onClick={handleFlushAll}
                    disabled={Boolean(isFlushingQueue)}
                    className="px-3 py-1.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Dispatch All Now
                  </button>
                </>
              )}

              <button
                onClick={fetchQueues}
                className="px-3 py-1.5 bg-theme-border/20 hover:bg-theme-border/40 text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh Queues
              </button>
            </div>
          </div>

          {/* Universal Buffer Explanatory Notice */}
          <div className="p-4 bg-accent/10 border border-accent/20 rounded-2xl flex items-start gap-3">
            <Clock className="h-5 w-5 text-accent shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <span className="font-bold text-theme-text-primary block">Universal 10-Minute Quiet Buffer Active</span>
              <p className="text-theme-text-secondary leading-relaxed">
                No email is dispatched immediately upon button click. Every outgoing message (announcements, passes, invitations, group policy grants, approvals, direct broadcasts, and task digests) is held for 10 minutes. This allows you to verify, cancel, or immediately dispatch before it reaches recipient inboxes.
              </p>
            </div>
          </div>

          {otherBuffered.length === 0 && pendingQueues.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No pending email queues"
              description="All outgoing emails, task digests, and notifications have completed their 10-minute buffer and been dispatched."
            />
          ) : (
            <div className="space-y-6">
              {/* SECTION 1: BUFFERED OUTGOING EMAILS */}
              {otherBuffered.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-theme-border/20 pb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-accent" />
                      Buffered Outgoing Emails ({otherBuffered.length})
                    </span>
                    <span className="text-[11px] text-theme-text-secondary">
                      Auto-sending when timer reaches 00m:00s
                    </span>
                  </div>

                  <div className="space-y-3">
                    {otherBuffered.map(b => (
                      <div key={b.id} className="p-5 bg-theme-background/30 border border-theme-card-border rounded-2xl space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-theme-border/20 pb-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-theme-text-primary">{b.to}</span>
                              <span className="px-2 py-0.5 bg-accent/10 text-accent rounded-md font-mono text-[10px]">
                                {b.category}
                              </span>
                              {b.hasAttachments && (
                                <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-md text-[10px] font-semibold flex items-center gap-1">
                                  <Paperclip className="h-3 w-3" /> {b.attachmentCount} Attachment{b.attachmentCount === 1 ? '' : 's'}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-theme-text-secondary flex-wrap">
                              <span className="text-amber-400 font-semibold flex items-center gap-1">
                                <Clock className="h-3 w-3 animate-spin" />
                                {formatCountdown(b.remainingSeconds)}
                              </span>
                              <span>&middot;</span>
                              <span>Queued: {new Date(b.queuedAt).toLocaleTimeString()}</span>
                              <span>&middot;</span>
                              <span>Dispatch at: {new Date(b.bufferedUntil).toLocaleTimeString()}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleCancelBufferedEmail(b.id)}
                              disabled={isCancellingQueue === b.id}
                              className="px-3 py-2 bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1 shrink-0"
                            >
                              <X className="h-3.5 w-3.5" />
                              {isCancellingQueue === b.id ? 'Cancelling...' : 'Cancel Queue'}
                            </button>

                            <button
                              onClick={() => handleFlushBufferedEmail(b.id)}
                              disabled={isFlushingQueue === b.id}
                              className="px-4 py-2 bg-accent hover:bg-primary-light text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                            >
                              <Play className="h-3.5 w-3.5" />
                              {isFlushingQueue === b.id ? 'Dispatching...' : 'Dispatch Now'}
                            </button>
                          </div>
                        </div>

                        <div className="p-3 bg-theme-background/60 rounded-xl border border-theme-border/20 text-xs">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-theme-text-secondary block mb-1">Subject Line</span>
                          <span className="font-semibold text-theme-text-primary block">{b.subject}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SECTION 2: TASK ASSIGNMENT DIGEST QUEUES */}
              {pendingQueues.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between border-b border-theme-border/20 pb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-accent" />
                      Task Assignment Digest Queues ({pendingQueues.length})
                    </span>
                    <span className="text-[11px] text-theme-text-secondary">
                      Aggregating multiple tasks into single student digests
                    </span>
                  </div>

                  <div className="space-y-4">
                    {pendingQueues.map(q => (
                      <div key={q.email} className="p-5 bg-theme-background/30 border border-theme-card-border rounded-2xl space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-theme-border/20 pb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-theme-text-primary">{q.assigneeName}</span>
                              <span className="text-xs text-accent font-mono">({q.email})</span>
                            </div>
                            <span className="text-[10px] text-amber-400 font-semibold flex items-center gap-1 mt-1">
                              <Clock className="h-3 w-3" /> 10-Minute Buffer Active ({q.taskCount} queued task notifications)
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleCancelQueue(q.email)}
                              disabled={isCancellingQueue === q.email}
                              className="px-3 py-2 bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1 shrink-0"
                            >
                              <X className="h-3.5 w-3.5" />
                              {isCancellingQueue === q.email ? 'Cancelling...' : 'Cancel Queue'}
                            </button>

                            <button
                              onClick={() => handleFlushQueue(q.email)}
                              disabled={isFlushingQueue === q.email}
                              className="px-4 py-2 bg-accent hover:bg-primary-light text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                            >
                              <Play className="h-3.5 w-3.5" />
                              {isFlushingQueue === q.email ? 'Flushing Email...' : 'Dispatch Digest Now'}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <span className="text-[11px] font-bold text-theme-text-secondary block">Queued Tasks in Digest Payload:</span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {q.tasks.map(t => (
                              <div key={t.id} className="p-2.5 bg-theme-background/60 rounded-xl border border-theme-border/20 text-xs">
                                <span className="font-bold text-theme-text-primary block">{t.title}</span>
                                <span className="text-[10px] text-theme-text-secondary block">Context: {t.event || 'RTBI Operations'} &middot; Due: {t.dueDate}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB: SCHEDULED CERTIFICATES — same universal 10-minute buffer as every other email */}
      {activeTab === 'certificates' && (
        <div className="glass-panel p-6 rounded-3xl space-y-6 border border-theme-card-border">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                <Award className="h-4 w-4 text-accent" />
                Scheduled Certificates & Their 10-Minute Buffer
              </h3>
              <p className="text-xs text-theme-text-secondary">Every certificate send scheduled from the Certificates tab, across all events, plus the certificate emails now waiting to go out.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {certBuffered.length > 0 && (
                <>
                  <button onClick={() => handleCertBulk('cancel')} disabled={Boolean(isFlushingQueue)} className="px-3 py-1.5 bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50">
                    <X className="h-3.5 w-3.5" /> Cancel All Certificate Emails
                  </button>
                  <button onClick={() => handleCertBulk('flush')} disabled={Boolean(isFlushingQueue)} className="px-3 py-1.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer flex items-center gap-1.5 disabled:opacity-50">
                    <Play className="h-3.5 w-3.5" /> Dispatch All Now
                  </button>
                </>
              )}
              <button onClick={() => { fetchCertSchedules(); fetchQueues(); }} className="px-3 py-1.5 bg-theme-border/20 hover:bg-theme-border/40 text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
            </div>
          </div>

          <div className="p-4 bg-accent/10 border border-accent/20 rounded-2xl flex items-start gap-3">
            <Clock className="h-5 w-5 text-accent shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <span className="font-bold text-theme-text-primary block">Universal 10-Minute Quiet Buffer Applies</span>
              <p className="text-theme-text-secondary leading-relaxed">
                At the scheduled time each certificate is generated and queued, then held for 10 minutes before SMTP handoff — so recipients receive it about 10 minutes after the scheduled time. During that window you can cancel it or dispatch it immediately. The PDF stays attached throughout.
              </p>
            </div>
          </div>

          {/* SECTION 1: SCHEDULED BATCHES */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-theme-border/20 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-2">
                <CalendarClock className="h-3.5 w-3.5 text-accent" /> Scheduled Sends ({certSchedules.length})
              </span>
              <span className="text-[11px] text-theme-text-secondary">Upcoming first, then recent history</span>
            </div>
            {certSchedules.length === 0 ? (
              <EmptyState icon={CalendarClock} title="No scheduled certificates" description="Schedule a send from Event Passes → Certificates and it will appear here." />
            ) : (
              <div className="space-y-3">
                {certSchedules.map(s => {
                  const active = s.status === 'Scheduled' || s.status === 'Running';
                  const tone = s.status === 'Done' ? 'bg-success/15 text-success border-success/30' : s.status === 'Failed' ? 'bg-danger/15 text-danger border-danger/30' : s.status === 'Cancelled' ? 'bg-theme-border/20 text-theme-text-secondary border-theme-border/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30';
                  return (
                    <div key={s.id} className="p-4 bg-theme-background/30 border border-theme-card-border rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-theme-text-primary truncate">{s.eventTitle}</span>
                          <span className="px-2 py-0.5 bg-accent/10 text-accent rounded-md text-[10px] font-semibold">{s.typeName}</span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${tone}`}>{s.status === 'Running' ? 'Sending…' : s.status}</span>
                        </div>
                        <div className="flex items-center gap-x-2 gap-y-0.5 text-[11px] text-theme-text-secondary flex-wrap">
                          <span>{s.recipients} certificate{s.recipients === 1 ? '' : 's'}</span><span>&middot;</span>
                          <span>Scheduled for {new Date(s.sendAt).toLocaleString()}</span><span>&middot;</span>
                          <span>by {s.createdBy}</span>
                        </div>
                        <div className="text-[11px] flex items-center gap-x-2 flex-wrap">
                          {active && <span className="text-amber-400 font-semibold">Delivered about {new Date(s.deliverAfter).toLocaleString()} (after the 10-minute buffer)</span>}
                          {s.status === 'Done' && <span className="text-theme-text-secondary">{s.sent} queued{s.failed ? `, ${s.failed} failed` : ''} · released {s.finishedAt ? new Date(s.finishedAt).toLocaleString() : ''} · final delivery about {new Date(s.deliverAfter).toLocaleTimeString()}</span>}
                          {s.status === 'Failed' && <span className="text-danger">{s.error || 'The scheduled send failed.'}</span>}
                        </div>
                      </div>
                      {s.status === 'Scheduled' && (
                        <button onClick={() => handleCancelSchedule(s.id)} disabled={isCancellingSchedule === s.id} className="px-3 py-2 bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1 shrink-0">
                          <X className="h-3.5 w-3.5" /> {isCancellingSchedule === s.id ? 'Cancelling...' : 'Cancel Send'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION: SCHEDULED PASS EMAILS (from Event Passes → Preview & dispatch → Schedule) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-theme-border/20 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-2">
                <CalendarClock className="h-3.5 w-3.5 text-accent" /> Scheduled Pass Emails ({passSchedules.length})
              </span>
              <span className="text-[11px] text-theme-text-secondary">Sent by the server at the chosen time, then held 10 minutes like every email</span>
            </div>
            {passSchedules.length === 0 ? (
              <EmptyState icon={CalendarClock} title="No scheduled pass emails" description="In Event Passes, select passes → Preview & dispatch → Schedule, and the batch appears here." />
            ) : (
              <div className="space-y-3">
                {passSchedules.map(s => {
                  const tone = s.status === 'Done' ? 'bg-success/15 text-success border-success/30' : s.status === 'Failed' ? 'bg-danger/15 text-danger border-danger/30' : s.status === 'Cancelled' ? 'bg-theme-border/20 text-theme-text-secondary border-theme-border/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30';
                  return (
                    <div key={s.id} className="p-4 bg-theme-background/30 border border-theme-card-border rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-theme-text-primary truncate">{s.eventNames.join(', ') || 'Event passes'}</span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${tone}`}>{s.status === 'Running' ? 'Sending…' : s.status}</span>
                        </div>
                        <div className="flex items-center gap-x-2 gap-y-0.5 text-[11px] text-theme-text-secondary flex-wrap">
                          <span>{s.count} pass email{s.count === 1 ? '' : 's'}</span><span>&middot;</span>
                          <span>Scheduled for {new Date(s.sendAt).toLocaleString()}</span><span>&middot;</span>
                          <span>by {s.createdBy}</span>
                        </div>
                        {s.status === 'Done' && <div className="text-[11px] text-theme-text-secondary">{s.sent} queued{s.failed ? `, ${s.failed} failed` : ''}{s.skipped ? `, ${s.skipped} skipped (pass deleted, cancelled or awaiting approval)` : ''}{s.finishedAt ? ` · released ${new Date(s.finishedAt).toLocaleString()}` : ''}</div>}
                        {s.status === 'Failed' && <div className="text-[11px] text-danger">{s.error || 'The scheduled send failed.'}</div>}
                      </div>
                      {s.status === 'Scheduled' && (
                        <button onClick={() => handleCancelPassSchedule(s.id)} disabled={isCancellingSchedule === s.id} className="px-3 py-2 bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1 shrink-0">
                          <X className="h-3.5 w-3.5" /> {isCancellingSchedule === s.id ? 'Cancelling...' : 'Cancel Send'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 2: CERTIFICATE EMAILS IN THE 10-MINUTE BUFFER */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-theme-border/20 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-accent" /> Certificate Emails in the 10-Minute Buffer ({certBuffered.length})
              </span>
              <span className="text-[11px] text-theme-text-secondary">Auto-sending when timer reaches 00m:00s</span>
            </div>
            {certBuffered.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="No certificate emails waiting" description="Certificate emails appear here for 10 minutes after they are sent or released from a schedule, before SMTP handoff." />
            ) : (
              <div className="space-y-3">
                {certBuffered.map(b => (
                  <div key={b.id} className="p-4 bg-theme-background/30 border border-theme-card-border rounded-2xl space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-theme-text-primary">{b.to}</span>
                          {b.hasAttachments && (
                            <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-md text-[10px] font-semibold flex items-center gap-1"><Paperclip className="h-3 w-3" /> Certificate PDF attached</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-theme-text-secondary flex-wrap">
                          <span className="text-amber-400 font-semibold flex items-center gap-1"><Clock className="h-3 w-3 animate-spin" />{formatCountdown(b.remainingSeconds)}</span>
                          <span>&middot;</span><span>Queued: {new Date(b.queuedAt).toLocaleTimeString()}</span>
                          <span>&middot;</span><span>Dispatch at: {new Date(b.bufferedUntil).toLocaleTimeString()}</span>
                        </div>
                        <span className="text-xs text-theme-text-primary font-semibold block truncate">{b.subject}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => handleCancelBufferedEmail(b.id)} disabled={isCancellingQueue === b.id} className="px-3 py-2 bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1">
                          <X className="h-3.5 w-3.5" /> {isCancellingQueue === b.id ? 'Cancelling...' : 'Cancel'}
                        </button>
                        <button onClick={() => handleFlushBufferedEmail(b.id)} disabled={isFlushingQueue === b.id} className="px-4 py-2 bg-accent hover:bg-primary-light text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                          <Play className="h-3.5 w-3.5" /> {isFlushingQueue === b.id ? 'Dispatching...' : 'Dispatch Now'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: COMPOSE BROADCAST */}
      {activeTab === 'composer' && (
        <div className="glass-panel p-6 md:p-8 rounded-3xl space-y-6 border border-theme-card-border">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-theme-border/20 pb-4">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                <Send className="h-4 w-4 text-accent" />
                Broadcast Email Composer
              </h3>
              <p className="text-xs text-theme-text-secondary mt-0.5">
                Compose custom HTML/text email broadcasts to member divisions or individual recipients directly via your configured mail server.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewTab('edit')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                  previewTab === 'edit' ? 'bg-accent text-white' : 'bg-theme-border/20 text-theme-text-secondary'
                }`}
              >
                Edit Content
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab('preview')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                  previewTab === 'preview' ? 'bg-accent text-white' : 'bg-theme-border/20 text-theme-text-secondary'
                }`}
              >
                Live Preview
              </button>
            </div>
          </div>

          {previewTab === 'edit' ? (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Target Recipient Scope *</label>
                  <select
                    value={dispatchScope}
                    onChange={e => setDispatchScope(e.target.value as any)}
                    className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent font-semibold"
                  >
                    <option value="SINGLE">Single Recipient Email</option>
                    <option value="All Members">All Members (Full Roster Broadcast)</option>
                    <option value="Super User">Super Users</option>
                    <option value="CEO">CEOs</option>
                    <option value="Employee">Employees</option>
                    <option value="Startup">Startups</option>
                  </select>
                </div>

                {dispatchScope === 'SINGLE' ? (
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="block font-medium text-theme-text-secondary">Recipient Email Address *</label>
                    <input
                      type="email"
                      required
                      value={customRecipient}
                      onChange={e => setCustomRecipient(e.target.value)}
                      placeholder="student@example.com"
                      className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="block font-medium text-theme-text-secondary">Category Tag</label>
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value as any)}
                      className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                    >
                      <option value="ANNOUNCEMENT">Announcement Broadcast</option>
                      <option value="DIRECT_MESSAGE">Direct Notification</option>
                      <option value="SYSTEM">System Broadcast</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Subject Line *</label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="e.g. [RTBI Announcement] General Body Meeting Schedule & Deliverables"
                  className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block font-medium text-theme-text-secondary">Email Message Body *</label>
                  {attachments.length > 0 && (
                    <button
                      type="button"
                      onClick={handleInsertAttachmentNote}
                      className="px-2 py-0.5 bg-accent/15 text-accent border border-accent/30 rounded-md font-semibold hover:bg-accent/25 transition-all cursor-pointer text-[10px]"
                      title="Insert a 'Please find attached...' line naming the current attachments"
                    >
                      + Insert Attachment Note
                    </button>
                  )}
                </div>
                <textarea
                  rows={8}
                  required
                  value={bodyText}
                  onChange={e => setBodyText(e.target.value)}
                  placeholder="Type message content here..."
                  className="w-full px-4 py-3 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent font-mono text-xs leading-relaxed"
                />
              </div>

              <EmailBackgroundPicker value={bgPick} onChange={setBgPick} disabled={isSendingDispatch} />

              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" />
                  Attachments (optional)
                </label>
                <label className="flex items-center justify-center gap-2 px-4 py-3 bg-theme-background/40 border border-dashed border-theme-card-border rounded-xl text-theme-text-secondary cursor-pointer hover:border-accent hover:text-accent transition-all">
                  {isProcessingAttachments ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                  <span className="font-medium">Click to attach one or more files (max {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} total)</span>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={e => { handleAttachFiles(e.target.files); e.target.value = ''; }}
                    disabled={isProcessingAttachments}
                  />
                </label>
                {attachmentError && (
                  <p className="text-[11px] text-danger">{attachmentError}</p>
                )}
                {attachments.length > 0 && (
                  <div className="space-y-1.5">
                    {attachments.map(a => (
                      <div key={a.filename} className="flex items-center justify-between gap-2 px-3 py-2 bg-theme-background/30 border border-theme-border/20 rounded-xl">
                        <div className="min-w-0 flex items-center gap-2">
                          <Paperclip className="h-3.5 w-3.5 text-theme-text-secondary shrink-0" />
                          <span className="font-semibold text-theme-text-primary truncate">{a.filename}</span>
                          <span className="text-theme-text-secondary shrink-0">({formatBytes(a.size)})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(a.filename)}
                          className="p-1 text-danger hover:bg-danger/10 rounded-lg transition-all cursor-pointer shrink-0"
                          title="Remove attachment"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end pt-3">
                <button
                  type="button"
                  disabled={!subject || !bodyText || (dispatchScope === 'SINGLE' && !customRecipient) || isSendingDispatch}
                  onClick={() => setShowDispatchConfirm(true)}
                  className="px-6 py-2.5 bg-accent hover:bg-primary-light text-white font-bold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  <Send className="h-4 w-4" />
                  {isSendingDispatch ? 'Dispatching...' : 'Broadcast Email Payload'}
                </button>
              </div>
            </div>
          ) : (
            /* Live HTML Preview Box */
            <div className="space-y-4">
              <div className="p-4 bg-theme-background/60 border border-theme-card-border rounded-2xl space-y-3">
                <div className="border-b border-theme-border/20 pb-3 text-xs space-y-1">
                  <p className="text-theme-text-secondary">From: <strong className="text-theme-text-primary">{settings.fromName} &lt;{settings.fromEmail}&gt;</strong></p>
                  <p className="text-theme-text-secondary">To: <strong className="text-theme-text-primary">{dispatchScope === 'SINGLE' ? customRecipient || 'recipient@domain.com' : `[Broadcast Scope: ${dispatchScope}]`}</strong></p>
                  <p className="text-theme-text-secondary">Subject: <strong className="text-accent">{subject || 'No Subject Provided'}</strong></p>
                </div>
                
                <EmailHtmlPreview
                  title="Email preview"
                  subject={subject || 'Subject Line Preview'}
                  bodyText={bodyText || 'Your message text will appear here...'}
                  category={category}
                  badgeText={resolveBadgeText()}
                  background={backgroundChoiceFor(bgPick)}
                  className="w-full h-[520px] rounded-xl border border-theme-border/30 bg-slate-200"
                />
                {attachments.length > 0 && <p className="text-[10px] text-theme-text-secondary">Attached: {attachments.map(a => a.filename).join(', ')}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SMTP SERVER SETTINGS */}
      {activeTab === 'settings' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="glass-panel p-6 rounded-3xl xl:col-span-2 space-y-6 border border-theme-card-border">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                <Key className="h-4 w-4 text-accent" />
                SMTP Mail Relay Credentials
              </h3>
              <p className="text-xs text-theme-text-secondary mt-0.5">
                Select your service provider or enter custom SMTP credentials for sending announcements, OTPs, and task notifications.
              </p>
            </div>

            {/* Provider Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <button
                type="button"
                onClick={() => handleSelectProvider('gmail')}
                className={`p-3.5 rounded-2xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                  settings.provider === 'gmail'
                    ? 'bg-accent/15 border-accent text-accent shadow-md shadow-accent/10'
                    : 'bg-theme-border/10 border-theme-border/30 hover:border-theme-border/60 text-theme-text-primary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Globe className="h-4 w-4" />
                  {settings.provider === 'gmail' && <Check className="h-4 w-4" />}
                </div>
                <div>
                  <span className="font-bold text-xs block mt-2">Gmail / Workspace</span>
                  <span className="text-[10px] opacity-75">smtp.gmail.com:587</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectProvider('outlook')}
                className={`p-3.5 rounded-2xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                  settings.provider === 'outlook'
                    ? 'bg-accent/15 border-accent text-accent shadow-md shadow-accent/10'
                    : 'bg-theme-border/10 border-theme-border/30 hover:border-theme-border/60 text-theme-text-primary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Globe className="h-4 w-4" />
                  {settings.provider === 'outlook' && <Check className="h-4 w-4" />}
                </div>
                <div>
                  <span className="font-bold text-xs block mt-2">Outlook 365</span>
                  <span className="text-[10px] opacity-75">smtp.office365.com:587</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectProvider('custom')}
                className={`p-3.5 rounded-2xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                  settings.provider === 'custom'
                    ? 'bg-accent/15 border-accent text-accent shadow-md shadow-accent/10'
                    : 'bg-theme-border/10 border-theme-border/30 hover:border-theme-border/60 text-theme-text-primary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Server className="h-4 w-4" />
                  {settings.provider === 'custom' && <Check className="h-4 w-4" />}
                </div>
                <div>
                  <span className="font-bold text-xs block mt-2">Custom SMTP</span>
                  <span className="text-[10px] opacity-75">Host & Port Defined</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectProvider('local_postfix')}
                className={`p-3.5 rounded-2xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                  settings.provider === 'local_postfix'
                    ? 'bg-accent/15 border-accent text-accent shadow-md shadow-accent/10'
                    : 'bg-theme-border/10 border-theme-border/30 hover:border-theme-border/60 text-theme-text-primary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Zap className="h-4 w-4" />
                  {settings.provider === 'local_postfix' && <Check className="h-4 w-4" />}
                </div>
                <div>
                  <span className="font-bold text-xs block mt-2">Local Postfix</span>
                  <span className="text-[10px] opacity-75">localhost:25</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectProvider('direct_send')}
                className={`p-3.5 rounded-2xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                  settings.provider === 'direct_send'
                    ? 'bg-accent/15 border-accent text-accent shadow-md shadow-accent/10'
                    : 'bg-theme-border/10 border-theme-border/30 hover:border-theme-border/60 text-theme-text-primary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Rocket className="h-4 w-4" />
                  {settings.provider === 'direct_send' && <Check className="h-4 w-4" />}
                </div>
                <div>
                  <span className="font-bold text-xs block mt-2">Direct Send (Built-in)</span>
                  <span className="text-[10px] opacity-75">No relay — MX direct</span>
                </div>
              </button>
            </div>

            <form
              onSubmit={handleSaveSettings}
              onInvalidCapture={(e) => {
                const target = e.target as HTMLInputElement;
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const labelEl = target.closest('.space-y-1\\.5')?.querySelector('label');
                const label = labelEl?.textContent?.replace(/\s*\*\s*$/, '') || 'A required field';
                triggerToast('error', `${label} is empty or invalid — scroll up to fix it before saving.`);
              }}
              className="space-y-4 text-xs"
            >
              {settings.provider === 'direct_send' ? (
                <div className="space-y-3">
                  <div className="p-4 bg-accent/10 rounded-2xl border border-accent/20 space-y-2 text-[11px] text-theme-text-secondary leading-relaxed">
                    <span className="font-bold text-theme-text-primary flex items-center gap-1.5">
                      <Rocket className="h-3.5 w-3.5 text-accent" />
                      Built-in Direct Send
                    </span>
                    <p>The app itself resolves each recipient&apos;s mail server (MX record) and delivers straight to it — no Gmail/Outlook relay, no Postfix, nothing in between.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block font-medium text-theme-text-secondary">HELO Hostname *</label>
                    <input
                      type="text"
                      required
                      value={settings.heloHostname || ''}
                      onChange={e => setSettings(prev => ({ ...prev, heloHostname: e.target.value }))}
                      placeholder="e.g. mail.rtbi.ac.in"
                      className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                    />
                    <p className="text-[11px] text-theme-text-secondary">Must match the PTR (reverse-DNS) record on this VPS&apos;s outbound IP, or most receiving mail servers will reject the connection outright.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="block font-medium text-theme-text-secondary">SMTP Host *</label>
                      <input
                        type="text"
                        required
                        value={settings.smtpHost}
                        onChange={e => setSettings(prev => ({ ...prev, smtpHost: e.target.value }))}
                        placeholder="e.g. smtp.gmail.com"
                        className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block font-medium text-theme-text-secondary">SMTP Port *</label>
                      <input
                        type="number"
                        required
                        value={settings.smtpPort}
                        onChange={e => setSettings(prev => ({ ...prev, smtpPort: Number(e.target.value) }))}
                        placeholder="587"
                        className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block font-medium text-theme-text-secondary">Auth Username / Email</label>
                      <input
                        type="text"
                        value={settings.authUser}
                        onChange={e => setSettings(prev => ({ ...prev, authUser: e.target.value }))}
                        placeholder="portal@example.com"
                        className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>

                    <div className="space-y-1.5 relative">
                      <label className="block font-medium text-theme-text-secondary">App Password / Auth Secret</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={settings.authPass}
                          onChange={e => setSettings(prev => ({ ...prev, authPass: e.target.value }))}
                          placeholder="••••••••••••••••"
                          className="w-full pl-4 pr-10 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-3 text-theme-text-secondary hover:text-theme-text-primary"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {settings.provider === 'outlook' && (
                    <div className="p-4 bg-amber-500/10 rounded-2xl border border-amber-500/25 space-y-1.5 text-[11px] text-theme-text-secondary leading-relaxed">
                      <span className="font-bold text-theme-text-primary flex items-center gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                        Company email + password not connecting?
                      </span>
                      <p>
                        Microsoft 365 turns off SMTP AUTH (plain username/password sign-in) for every mailbox by default —
                        this is a tenant setting, not a wrong password. An admin has to enable it per mailbox: Microsoft 365
                        admin center → Users → Active users → this mailbox → Mail → &quot;Manage email apps&quot; → turn on
                        Authenticated SMTP. If the mailbox has multi-factor authentication (MFA) on, an app password is
                        required instead of the regular sign-in password. Use &quot;Test Connection &amp; Send Email&quot; below —
                        it now explains exactly which of these is blocking you.
                      </p>
                    </div>
                  )}
                </>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Sender Display Name *</label>
                  <input
                    type="text"
                    required
                    value={settings.fromName}
                    onChange={e => setSettings(prev => ({ ...prev, fromName: e.target.value }))}
                    placeholder="RTBI Portal"
                    className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Sender Email Address *</label>
                  <input
                    type="email"
                    required
                    value={settings.fromEmail}
                    onChange={e => setSettings(prev => ({ ...prev, fromEmail: e.target.value }))}
                    placeholder="portal@example.com"
                    className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              {settings.provider !== 'gmail' && settings.provider !== 'outlook' && (
              <div className="border-t border-theme-border/20 pt-4">
                <button
                  type="button"
                  onClick={() => setShowDkimSection(!showDkimSection)}
                  className="flex items-center gap-2 text-theme-text-secondary hover:text-theme-text-primary font-bold cursor-pointer"
                >
                  <Key className="h-3.5 w-3.5" />
                  DKIM Signing (Advanced)
                  {showDkimSection ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>

                {showDkimSection && (
                  <div className="mt-3 space-y-4">
                    <p className="text-[11px] text-theme-text-secondary leading-relaxed">
                      Optional — Nodemailer signs the message itself before handing it off, independent of the provider above. Requires the matching public key published as a DNS TXT record at <code className="bg-theme-background/40 px-1 py-0.5 rounded">&lt;dkimSelector&gt;._domainkey.&lt;dkimDomain&gt;</code>. Signing is skipped entirely unless all three fields below are filled in.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="block font-medium text-theme-text-secondary">DKIM Domain</label>
                        <input
                          type="text"
                          value={settings.dkimDomain || ''}
                          onChange={e => setSettings(prev => ({ ...prev, dkimDomain: e.target.value }))}
                          placeholder="rtbi.ac.in"
                          className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block font-medium text-theme-text-secondary">DKIM Selector</label>
                        <input
                          type="text"
                          value={settings.dkimSelector || ''}
                          onChange={e => setSettings(prev => ({ ...prev, dkimSelector: e.target.value }))}
                          placeholder="rtbi"
                          className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block font-medium text-theme-text-secondary">DKIM Private Key</label>
                      <textarea
                        value={settings.dkimPrivateKey || ''}
                        onChange={e => setSettings(prev => ({ ...prev, dkimPrivateKey: e.target.value }))}
                        placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                        rows={6}
                        className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent font-mono text-[11px] leading-relaxed"
                      />
                    </div>
                  </div>
                )}
              </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-theme-border/20">
                <span className="text-[11px] text-theme-text-secondary">
                  Last updated: {settings.updatedAt ? new Date(settings.updatedAt).toLocaleString() : 'Not configured'}
                </span>
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="px-5 py-2.5 bg-accent hover:bg-primary-light text-white font-bold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  <Server className="h-4 w-4" />
                  {isSavingSettings ? 'Saving Settings...' : 'Save SMTP Credentials'}
                </button>
              </div>
            </form>
          </div>

          <div className="glass-panel p-6 rounded-3xl space-y-5 border border-theme-card-border flex flex-col justify-between">
            <div className="space-y-4">
              <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                Connection Diagnostics & Test
              </h3>
              <p className="text-xs text-theme-text-secondary leading-relaxed">
                Test your SMTP server connection and verify credentials by transmitting a live test email payload.
              </p>

              <div className="space-y-1.5 text-xs">
                <label className="block font-medium text-theme-text-secondary">Test Recipient Email</label>
                <input
                  type="email"
                  value={testRecipient}
                  onChange={e => setTestRecipient(e.target.value)}
                  placeholder="kayo2970@gmail.com"
                  className="w-full px-4 py-2.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingSmtp}
                className="w-full py-2.5 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/20 font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 text-xs disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isTestingSmtp ? 'animate-spin' : ''}`} />
                {isTestingSmtp ? 'Verifying SMTP Server...' : 'Test Connection & Send Email'}
              </button>

              {testResult && (
                <div className={`p-4 rounded-2xl border text-xs space-y-2 animate-in fade-in duration-300 ${
                  testResult.success 
                    ? 'bg-success/10 border-success/30 text-theme-text-primary' 
                    : 'bg-danger/10 border-danger/30 text-theme-text-primary'
                }`}>
                  <div className="flex items-center gap-2 font-bold">
                    {testResult.success ? (
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-danger shrink-0" />
                    )}
                    <span>{testResult.success ? 'SMTP Handshake Verified' : 'SMTP Handshake Error'}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed opacity-90">{testResult.message}</p>
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel p-6 rounded-3xl xl:col-span-3 space-y-4 border border-theme-card-border">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                Email Background (blurred picture)
              </h3>
              <p className="text-xs text-theme-text-secondary mt-0.5">
                A picture shown, blurred, behind every email the system sends: certificates, event passes, guest invites, announcements and the Email composer. Any send can turn it off or use a different picture.
              </p>
              <p className="text-[11px] text-theme-text-secondary mt-1">
                Emails load their background from this server when they are opened, so the blurred picture is kept for 90 days after the last email that used it, then shrunk to a very small blurred version, and removed after 180 days — older emails then simply show the plain light background. Sending with the picture again rebuilds it.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-theme-text-primary cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={!!settings.background?.storageKey && settings.background?.enabled !== false}
                disabled={!settings.background?.storageKey}
                onChange={e => setSettings(prev => ({ ...prev, background: { ...prev.background, enabled: e.target.checked, blur: prev.background?.blur ?? EMAIL_BLUR_DEFAULT } }))}
              />
              Use this background on all emails
            </label>
            <EmailBackgroundField
              storageKey={settings.background?.storageKey}
              blur={settings.background?.blur ?? EMAIL_BLUR_DEFAULT}
              onChange={n => setSettings(prev => ({ ...prev, background: { enabled: n.storageKey ? (prev.background?.enabled ?? true) : false, storageKey: n.storageKey, blur: n.blur } }))}
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveBackground}
                disabled={isSavingBackground}
                className="px-5 py-2.5 bg-accent hover:bg-primary-light text-white font-bold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer disabled:opacity-50 text-xs"
              >
                {isSavingBackground ? 'Saving…' : 'Save email background'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dispatch Modal */}
      {showDispatchConfirm && (
        <ConfirmModal
          isOpen={showDispatchConfirm}
          title="Confirm Email Dispatch"
          message={`Are you sure you want to dispatch this email broadcast? Target Scope: "${dispatchScope}". This will deliver emails through your configured SMTP server.`}
          confirmLabel="Execute Dispatch"
          cancelLabel="Cancel"
          onConfirm={handleExecuteDispatch}
          onCancel={() => setShowDispatchConfirm(false)}
        />
      )}

      {/* Inspect Email Log Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-2xl rounded-3xl p-6 space-y-5 border border-white/15 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-theme-border/20 pb-4">
              <div>
                <h3 className="text-base font-bold text-theme-text-primary">Email Payload Inspector</h3>
                <p className="text-xs text-theme-text-secondary mt-0.5">Log ID: {selectedLog.id}</p>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-4 bg-theme-border/10 p-3.5 rounded-2xl border border-theme-border/20">
                <div>
                  <span className="text-[10px] text-theme-text-secondary block font-medium">Recipient Address:</span>
                  <span className="font-bold text-theme-text-primary">{selectedLog.to}</span>
                </div>
                <div>
                  <span className="text-[10px] text-theme-text-secondary block font-medium">Delivery Status:</span>
                  <span className={`font-bold ${
                    selectedLog.status === 'SENT' ? 'text-success' :
                    selectedLog.status === 'BUFFERED' ? 'text-amber-500' :
                    selectedLog.status === 'CANCELLED' ? 'text-theme-text-secondary line-through' :
                    'text-danger'
                  }`}>
                    {selectedLog.status === 'SENT' ? 'SENT / DELIVERED' :
                     selectedLog.status === 'BUFFERED' ? 'BUFFERED (10-MIN QUIET HOLD)' :
                     selectedLog.status === 'CANCELLED' ? 'CANCELLED / DISCARDED' : 'FAILED'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-theme-text-secondary block font-medium">Category:</span>
                  <span className="font-semibold text-accent">{selectedLog.category}</span>
                </div>
                <div>
                  <span className="text-[10px] text-theme-text-secondary block font-medium">
                    {selectedLog.status === 'BUFFERED' ? 'Queued At:' : 'Dispatched At:'}
                  </span>
                  <span className="font-mono text-theme-text-primary">{new Date(selectedLog.sentAt).toLocaleString()}</span>
                </div>
              </div>

              {selectedLog.status === 'BUFFERED' && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Clock className="h-4 w-4 animate-spin text-amber-500 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-amber-500 block">
                        Held in 10-Minute Quiet Buffer
                      </span>
                      <span className="text-[10px] text-theme-text-secondary">
                        {selectedLog.bufferedUntil
                          ? `Scheduled for automatic dispatch at ${new Date(selectedLog.bufferedUntil).toLocaleTimeString()}`
                          : 'Waiting in buffer queue before SMTP dispatch'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCancelBufferedEmail(selectedLog.id)}
                      disabled={isCancellingQueue === selectedLog.id}
                      className="px-3 py-1.5 bg-danger/15 hover:bg-danger/25 text-danger border border-danger/30 text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1"
                    >
                      <X className="h-3.5 w-3.5" />
                      {isCancellingQueue === selectedLog.id ? 'Cancelling...' : 'Cancel Send'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFlushBufferedEmail(selectedLog.id)}
                      disabled={isFlushingQueue === selectedLog.id}
                      className="px-3 py-1.5 bg-accent hover:bg-primary-light text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer disabled:opacity-50 flex items-center gap-1"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {isFlushingQueue === selectedLog.id ? 'Dispatching...' : 'Dispatch Now'}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <span className="font-bold text-theme-text-primary block mb-1">Subject:</span>
                <div className="p-2.5 bg-theme-background/50 rounded-xl border border-theme-border/20 font-semibold text-accent">
                  {selectedLog.subject}
                </div>
              </div>

              {selectedLog.errorMessage && (
                <div>
                  <span className="font-bold text-danger block mb-1">Error Traceback:</span>
                  <div className="p-2.5 bg-danger/10 border border-danger/25 rounded-xl text-danger font-mono text-[11px] whitespace-pre-wrap">
                    {selectedLog.errorMessage}
                  </div>
                </div>
              )}
              {selectedLog.smtpResponse && (
                <div>
                  <span className="font-bold text-theme-text-primary block mb-1">SMTP Server Handshake Response:</span>
                  <div className="p-2.5 bg-theme-background/50 rounded-xl border border-theme-border/20 font-mono text-[11px] text-theme-text-secondary">
                    {selectedLog.smtpResponse}
                  </div>
                </div>
              )}

              <div>
                <span className="font-bold text-theme-text-primary block mb-1">Dispatched Body Content:</span>
                <div className="p-3 bg-slate-900 text-slate-200 rounded-xl border border-slate-800 font-mono text-[11px] max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {selectedLog.bodyText}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-theme-border/20">
              <button
                type="button"
                onClick={() => {
                  setDispatchScope('SINGLE');
                  setCustomRecipient(selectedLog.to);
                  setSubject(selectedLog.subject);
                  setBodyText(selectedLog.bodyText);
                  setSelectedLog(null);
                  setActiveTab('composer');
                  triggerToast('success', `Pre-filled composer with message payload for ${selectedLog.to}`);
                }}
                className="px-4 py-2 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 text-xs font-bold rounded-xl cursor-pointer flex items-center gap-1.5 transition-all"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reuse Payload in Composer
              </button>

              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary text-xs font-bold rounded-xl cursor-pointer transition-all"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
