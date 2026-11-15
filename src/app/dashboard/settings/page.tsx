'use client';

import React, { useState, useEffect } from 'react';
import CodeSlots from '@/components/code-slots';
import {
  User,
  ShieldCheck,
  History,
  Key,
  CheckCircle2,
  ShieldAlert,
  Save,
  Building2,
  CreditCard,
  Hash,
  Mail,
  Send,
  Eye,
  RefreshCw,
  FileText,
  RotateCw,
  AlertCircle,
  Crop,
  Search,
  Download,
  KeyRound,
} from 'lucide-react';
import { getAuditLogs, getMembers, saveMembers, updateMember, updateMemberAvatar, logAuditEvent, AuditLogItem, getEmailLogs, requestEmailChange, confirmEmailChange, confirmNewEmailChange, authHeaders, setSessionToken } from '@/lib/local-data';
import { toCsvRow, downloadCsv } from '@/lib/csv';
import { PeriodFilter } from '@/components/period-filter';
import { PeriodFilterValue, extractAvailableMonths, isWithinPeriod } from '@/lib/period-filter';
import { isCentreHead } from '@/lib/permissions';
import { FileDropzone, useUploadTask, formatFileSize } from '@/components/ui/file-dropzone';
import { ImageCropModal } from '@/components/image-crop-modal';
import DOMPurify from 'isomorphic-dompurify';
import { IntegrationsPanel } from '@/components/integrations-panel';

const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'account' | 'roles' | 'audit' | 'emails' | 'integrations'>('account');
  const [user, setUser] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditSearchQuery, setAuditSearchQuery] = useState('');
  const [auditPeriodFilter, setAuditPeriodFilter] = useState<PeriodFilterValue>({ mode: 'ALL' });
  const [auditVisibleCount, setAuditVisibleCount] = useState(50);
  const [emailLogs, setEmailLogs] = useState<any[]>([]);
  const [emailFilter, setEmailFilter] = useState<string>('ALL');
  const [previewEmail, setPreviewEmail] = useState<any | null>(null);

  // Test Email state
  const [testTo, setTestTo] = useState('');
  const [testSubject, setTestSubject] = useState('');
  const [testBody, setTestBody] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);

  // Account form state
  const [displayName, setDisplayName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Profile photo upload
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);

  // Change Email state (self-service, dual OTP: old email first, then new email)
  const [isChangingEmail, setIsChangingEmail] = useState(false);
  const [emailStep, setEmailStep] = useState<'REQUEST' | 'VERIFY_OLD' | 'VERIFY_NEW'>('REQUEST');
  const [newEmailInput, setNewEmailInput] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailExpiresAt, setEmailExpiresAt] = useState<number | null>(null);
  const [emailTimeLeftStr, setEmailTimeLeftStr] = useState('05:00');
  const [isSendingEmailOtp, setIsSendingEmailOtp] = useState(false);
  const [isConfirmingEmailOtp, setIsConfirmingEmailOtp] = useState(false);
  const [emailChangeMsg, setEmailChangeMsg] = useState('');
  const [emailChangeErr, setEmailChangeErr] = useState('');


  // Notification state
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const allMembers = getMembers();
    setAuditLogs(getAuditLogs());
    fetchEmails();

    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        const u = JSON.parse(savedUser);
        setUser(u);
        setDisplayName(u.name);
        const me = allMembers.find(m => m.id === u.id || m.email.toLowerCase() === u.email.toLowerCase());
        setDateOfBirth(u.dateOfBirth || me?.dateOfBirth || '');
        setTestTo(u.email || '');
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const fetchEmails = async () => {
    const logs = await getEmailLogs();
    setEmailLogs(logs);
  };

  // 5-minute countdown timer for the email-change OTP (runs for both the
  // old-email and new-email verification steps)
  useEffect(() => {
    if (!emailExpiresAt || emailStep === 'REQUEST') return;

    const interval = setInterval(() => {
      const remainingMs = emailExpiresAt - Date.now();
      if (remainingMs <= 0) {
        setEmailTimeLeftStr('00:00');
        setEmailChangeErr('The 5-minute verification code has expired. Please request a new one.');
        clearInterval(interval);
      } else {
        const totalSec = Math.floor(remainingMs / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        setEmailTimeLeftStr(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [emailExpiresAt, emailStep]);

  const resetEmailChangeFlow = () => {
    setIsChangingEmail(false);
    setEmailStep('REQUEST');
    setNewEmailInput('');
    setEmailOtp('');
    setEmailExpiresAt(null);
    setEmailTimeLeftStr('05:00');
    setEmailChangeMsg('');
    setEmailChangeErr('');
  };

  const handleRequestEmailChange = async () => {
    setEmailChangeErr('');
    setEmailChangeMsg('');
    if (!newEmailInput.trim()) {
      setEmailChangeErr('Enter the new email address.');
      return;
    }

    setIsSendingEmailOtp(true);
    const res = await requestEmailChange(user.id, user.email, newEmailInput.trim());
    setIsSendingEmailOtp(false);

    if (!res.success) {
      setEmailChangeErr(res.error || 'Failed to send verification code.');
      return;
    }

    setEmailChangeMsg(res.message || `Verification code sent to ${user.email}.`);
    if (res.expiresAt) setEmailExpiresAt(res.expiresAt);
    setEmailStep('VERIFY_OLD');
  };

  // Step 2 of 3: verify the code sent to the OLD email. This does NOT apply
  // the change — success here just unlocks step 3, a second code sent to
  // the NEW email, so the member has to prove they control both inboxes.
  const handleConfirmOldEmailOtp = async () => {
    setEmailChangeErr('');
    if (!emailOtp.trim()) {
      setEmailChangeErr('Enter the 6-digit verification code.');
      return;
    }

    setIsConfirmingEmailOtp(true);
    const res = await confirmEmailChange(user.id, emailOtp.trim());
    setIsConfirmingEmailOtp(false);

    if (!res.success) {
      setEmailChangeErr(res.error || 'Failed to confirm email change.');
      return;
    }

    setEmailOtp('');
    setEmailChangeMsg(res.message || `Current email verified. A second code was sent to ${res.newEmail}.`);
    if (res.expiresAt) setEmailExpiresAt(res.expiresAt);
    setEmailStep('VERIFY_NEW');
  };

  // Step 3 of 3: verify the code sent to the NEW email. Only this step
  // actually applies the change.
  const handleConfirmNewEmailOtp = async () => {
    setEmailChangeErr('');
    if (!emailOtp.trim()) {
      setEmailChangeErr('Enter the 6-digit verification code.');
      return;
    }

    setIsConfirmingEmailOtp(true);
    const res = await confirmNewEmailChange(user.id, emailOtp.trim());
    setIsConfirmingEmailOtp(false);

    if (!res.success) {
      setEmailChangeErr(res.error || 'Failed to confirm email change.');
      return;
    }

    const updatedUser = { ...user, email: res.newEmail };
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
    window.dispatchEvent(new Event('rtbi-data-sync'));
    setAuditLogs(getAuditLogs());

    resetEmailChangeFlow();
    triggerSuccess(res.message || 'Email address updated successfully.');
  };

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setErrorMsg('');
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const triggerError = (msg: string) => {
    setErrorMsg(msg);
    setSuccessMsg('');
    setTimeout(() => setErrorMsg(''), 4000);
  };

  const [avatarSizeError, setAvatarSizeError] = useState('');

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [cropFileName, setCropFileName] = useState('avatar.jpg');

  // File stays in `avatarFile` state (not cleared on failure) so a dropped
  // connection mid-upload can be retried with one tap instead of forcing the
  // user to reselect the same photo.
  const avatarUpload = useUploadTask(async (file, onProgress) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read that file.')));
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });

    const result = await updateMemberAvatar(user.id, dataUrl, file.name, onProgress);

    // The session's `user` object (read by the dashboard header/sidebar) is
    // separate from the members collection, so both need updating — the
    // collection mirror won't itself propagate into the active session.
    const members = getMembers();
    const idx = members.findIndex(m => m.id === user.id);
    if (idx !== -1) {
      members[idx] = { ...members[idx], avatarUrl: result.avatarUrl, avatarStorageKey: result.avatarStorageKey };
      saveMembers(members);
    }
    const updatedUser = { ...user, avatarUrl: result.avatarUrl };
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
    window.dispatchEvent(new Event('rtbi-data-sync'));
    logAuditEvent('MEMBER_UPDATED', user.name, 'Updated profile photo', user.email);
    triggerSuccess('Profile photo updated successfully.');
  });

  const handleAvatarFilesSelected = (files: File[]) => {
    const file = files[0];
    if (!file || !user) return;

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      setAvatarSizeError(`Image size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds the 2 MB maximum limit.`);
      return;
    }
    setAvatarSizeError('');
    setCropFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCropImageSrc(reader.result);
        setCropModalOpen(true);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarCropComplete = (croppedFile: File, dataUrl: string) => {
    setAvatarFile(croppedFile);
    setAvatarPreviewUrl(dataUrl);
    avatarUpload.start(croppedFile);
  };

  const handleOpenCurrentAvatarCrop = () => {
    const currentSrc = avatarPreviewUrl || user?.avatarUrl;
    if (!currentSrc) return;
    setCropFileName('avatar.jpg');
    setCropImageSrc(currentSrc);
    setCropModalOpen(true);
  };

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      triggerError('Name cannot be blank.');
      return;
    }

    if (newPassword) {
      if (!currentPassword) {
        triggerError('Enter your current password to set a new one.');
        return;
      }
      if (newPassword.length < 4) {
        triggerError('New password must be at least 4 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        triggerError('New password and confirmation do not match.');
        return;
      }

      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email: user.email, currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        triggerError(data.error || 'Failed to change password.');
        return;
      }
      // The server invalidates every session for this account (including
      // the one making this very request) and issues a fresh token in
      // data.token — without swapping it in here, every subsequent
      // authenticated call from this tab (starting with updateMember just
      // below) would be using a now-dead token and fail with 401, making a
      // password change that actually succeeded look like it silently
      // broke the account.
      setSessionToken(data.token);
    }

    const changes = {
      name: displayName.trim(),
      dateOfBirth: dateOfBirth || undefined,
    };
    const updatedMember = updateMember(user.id, changes, user.name);
    if (!updatedMember) {
      triggerError('Could not find your member record to update.');
      return;
    }

    const updatedUser = { ...user, ...changes };
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
    window.dispatchEvent(new Event('rtbi-data-sync'));
    setAuditLogs(getAuditLogs());

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    triggerSuccess('Account profile saved successfully.');
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTo.trim() || !testSubject.trim() || !testBody.trim()) {
      triggerError('Please fill in recipient, subject, and body for test email.');
      return;
    }

    setIsSendingTest(true);
    try {
      const res = await fetch('/api/email', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          to: testTo.trim(),
          subject: testSubject.trim(),
          bodyText: testBody.trim(),
          category: 'SYSTEM',
        }),
      });
      if (res.ok) {
        triggerSuccess(`Test email dispatched successfully to ${testTo.trim()}`);
        setTestSubject('');
        setTestBody('');
        fetchEmails();
      } else {
        triggerError('Failed to dispatch test email.');
      }
    } catch (err: any) {
      triggerError(err.message || 'Error dispatching test email.');
    } finally {
      setIsSendingTest(false);
    }
  };

  const isSuperAdmin = user && (user.tier === 1 || isCentreHead(user));

  const rolePrivileges = [
    { tier: 1, role: 'Super User', access: 'Full unconstrained system administration, user management, audit logs, and forms building.' },
    { tier: 2, role: 'Centre Head', access: 'Annual budget, invoice payment verification, event oversight, performance evaluations, and reporting.' },
    { tier: 3, role: 'Head of Events', access: 'Event creation & management, task assignments, deadline extensions, and ratings.' },
    { tier: 4, role: 'Advisory Board', access: 'Strategic read-only oversight, quarterly analytics, and event calendar reviews.' },
    { tier: 5, role: 'Core Committee', access: 'Event organizing, task assignments, and public form creation.' },
    { tier: 6, role: 'Training Associate', access: 'Assigned deliverable execution, task acknowledgment, and personal claim submissions.' },
  ];

  const filteredEmailLogs = emailLogs.filter(log => {
    if (emailFilter === 'ALL') return true;
    return log.category === emailFilter;
  });

  // Audit Trail — search across action/actor/details, an optional date
  // range, and severity color-coding so a destructive action (delete,
  // terminate, reject, lockdown) stands out from a routine one at a glance.
  const auditSeverity = (action: string): 'danger' | 'warning' | 'success' | 'neutral' => {
    const a = action.toUpperCase();
    if (a.includes('DELETE') || a.includes('TERMINAT') || a.includes('REJECT') || a.includes('LOCKDOWN') || a.includes('REVOKE')) return 'danger';
    if (a.includes('UPDATE') || a.includes('EDIT') || a.includes('CHANGE') || a.includes('OVERRIDE')) return 'warning';
    if (a.includes('CREATE') || a.includes('ADD') || a.includes('APPROVE') || a.includes('ACTIVAT')) return 'success';
    return 'neutral';
  };
  const auditSeverityClasses: Record<ReturnType<typeof auditSeverity>, string> = {
    danger: 'bg-danger/10 text-danger',
    warning: 'bg-warning/10 text-warning',
    success: 'bg-success/10 text-success',
    neutral: 'bg-accent/10 text-accent',
  };

  const auditSearchedLogs = auditLogs.filter(log => {
    const q = auditSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      log.action.toLowerCase().includes(q) ||
      log.actorName.toLowerCase().includes(q) ||
      log.actorEmail.toLowerCase().includes(q) ||
      log.details.toLowerCase().includes(q)
    );
  });
  const filteredAuditLogs = auditSearchedLogs.filter(log => isWithinPeriod(log.timestamp, auditPeriodFilter));
  const availableAuditMonths = extractAvailableMonths(auditLogs.map(l => l.timestamp));
  const displayedAuditLogs = filteredAuditLogs.slice(0, auditVisibleCount);

  const handleExportAuditCsv = () => {
    let csv = toCsvRow(['Timestamp', 'Action', 'Actor Name', 'Actor Email', 'Details']) + '\n';
    filteredAuditLogs.forEach(log => {
      csv += toCsvRow([log.timestamp, log.action, log.actorName, log.actorEmail, log.details]) + '\n';
    });
    downloadCsv(`rtbi_audit_trail_${new Date().toISOString().split('T')[0]}.csv`, csv);
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      
      {/* Notifications */}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-emerald-500/15 border border-emerald-500/20 rounded-2xl text-emerald-300 text-xs animate-in fade-in duration-300">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-3 p-4 bg-danger/15 border border-danger/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <ShieldAlert className="h-5 w-5 text-danger shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Header section */}
      <div>
        <h1 className="text-xl font-bold text-theme-text-primary">System Settings & Governance</h1>
        <p className="text-xs text-theme-text-secondary">Configure your profile credentials, inspect role privileges, manage email dispatcher, and review audit records</p>
      </div>

      {/* Tabs navigation */}
      <div className="flex border-b border-theme-border/30 gap-4 text-xs font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveTab('account')}
          className={`pb-3 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'account'
              ? 'text-accent border-b-2 border-accent'
              : 'text-theme-text-secondary hover:text-theme-text-primary'
          }`}
        >
          <User className="h-4 w-4" />
          Account Profile
        </button>

        <button
          onClick={() => setActiveTab('roles')}
          className={`pb-3 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'roles'
              ? 'text-accent border-b-2 border-accent'
              : 'text-theme-text-secondary hover:text-theme-text-primary'
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          Roles & Permissions Matrix
        </button>

        <button
          onClick={() => {
            setActiveTab('emails');
            fetchEmails();
          }}
          className={`pb-3 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'emails'
              ? 'text-accent border-b-2 border-accent'
              : 'text-theme-text-secondary hover:text-theme-text-primary'
          }`}
        >
          <Mail className="h-4 w-4" />
          Email Logs & Dispatcher ({emailLogs.length})
        </button>
        {user?.tier === 1 && (
          <button
            onClick={() => setActiveTab('integrations')}
            className={`pb-3 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'integrations'
                ? 'text-accent border-b-2 border-accent'
                : 'text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            <KeyRound className="h-4 w-4" />
            Integrations
          </button>
        )}


        {isSuperAdmin && (
          <button
            onClick={() => {
              setActiveTab('audit');
              setAuditLogs(getAuditLogs());
            }}
            className={`pb-3 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'audit'
                ? 'text-accent border-b-2 border-accent'
                : 'text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            <History className="h-4 w-4" />
            Audit Trail ({auditLogs.length})
          </button>
        )}
      </div>

      {/* Tab 1: Account Profile */}
      {activeTab === 'account' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-panel rounded-2xl p-6 lg:col-span-2 space-y-5">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary">Profile & Security Preferences</h3>
              <p className="text-xs text-theme-text-secondary">Update your display information and access credentials</p>
            </div>

            <form onSubmit={handleUpdateAccount} className="space-y-4 text-xs">
              <div className="flex items-center gap-4 pb-2">
                <div className="flex flex-col items-center">
                  <div className="h-16 w-16 shrink-0 rounded-2xl bg-accent flex items-center justify-center shadow-md shadow-accent/20 overflow-hidden relative">
                    {avatarPreviewUrl ? (
                      <img src={avatarPreviewUrl} alt={user?.name} className="h-full w-full object-cover" />
                    ) : user?.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-white font-bold text-base">
                        {(user?.name || '').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    {avatarUpload.status === 'uploading' && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-[10px] font-bold">
                        {avatarUpload.progress}%
                      </div>
                    )}
                  </div>
                  {(avatarPreviewUrl || user?.avatarUrl) && avatarUpload.status !== 'uploading' && (
                    <button
                      type="button"
                      onClick={handleOpenCurrentAvatarCrop}
                      className="mt-1.5 text-[10px] font-medium text-accent hover:underline flex items-center gap-1 cursor-pointer transition-colors"
                      title="Re-frame and crop photo"
                    >
                      <Crop className="h-2.5 w-2.5" />
                      Adjust crop
                    </button>
                  )}
                </div>
                <div className="space-y-1.5 flex-1 max-w-sm">
                  <FileDropzone
                    onFilesSelected={handleAvatarFilesSelected}
                    accept="image/*"
                    disabled={avatarUpload.status === 'uploading'}
                    label="Upload Profile Photo"
                    hint="JPG, PNG, or GIF. Max size 2 MB."
                    compact
                  />
                  {avatarSizeError && <p className="text-[11px] text-danger">{avatarSizeError}</p>}
                  {avatarFile && (
                    <p className="text-[10px] text-theme-text-secondary">{avatarFile.name} · {formatFileSize(avatarFile.size)}</p>
                  )}
                  {avatarUpload.status === 'error' && (
                    <div className="flex items-center justify-between gap-2 text-[11px] text-danger">
                      <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3 shrink-0" />{avatarUpload.error}</span>
                      <button
                        type="button"
                        onClick={avatarUpload.retry}
                        className="flex items-center gap-1 font-semibold text-accent hover:underline cursor-pointer shrink-0"
                      >
                        <RotateCw className="h-3 w-3" />
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Full Name</label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block font-medium text-theme-text-secondary">Email Address</label>
                    {!isChangingEmail && (
                      <button
                        type="button"
                        onClick={() => { setIsChangingEmail(true); setNewEmailInput(''); setEmailStep('REQUEST'); setEmailChangeMsg(''); setEmailChangeErr(''); }}
                        className="text-[11px] font-semibold text-accent hover:underline cursor-pointer"
                      >
                        Change Email
                      </button>
                    )}
                  </div>
                  <input
                    type="email"
                    disabled
                    value={user?.email || ''}
                    className="w-full px-4 py-2.5 bg-theme-background/10 border border-theme-border/30 rounded-xl text-theme-text-secondary cursor-not-allowed opacity-70"
                  />
                </div>
              </div>

              {isChangingEmail && (
                <div className="p-4 bg-theme-background/30 border border-theme-border/30 rounded-xl space-y-3">
                  <h4 className="font-bold text-xs text-theme-text-primary uppercase tracking-wider flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-accent" />
                    Change Login Email
                  </h4>
                  <p className="text-[11px] text-theme-text-secondary leading-relaxed">
                    Two verification codes are required — one sent to your <strong>current</strong> email ({user?.email}), then a second sent to the <strong>new</strong> address — so this change only goes through once you've proven you control both inboxes.
                  </p>

                  {emailChangeErr && (
                    <p className="text-[11px] text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">{emailChangeErr}</p>
                  )}
                  {emailChangeMsg && (
                    <p className="text-[11px] text-success bg-success/10 border border-success/20 rounded-lg px-3 py-2">{emailChangeMsg}</p>
                  )}

                  {emailStep === 'REQUEST' && (
                    <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                      <div className="flex-1 space-y-1.5">
                        <label className="block font-medium text-theme-text-secondary">New Email Address</label>
                        <input
                          type="email"
                          value={newEmailInput}
                          onChange={(e) => setNewEmailInput(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full px-4 py-2.5 bg-theme-background/50 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={isSendingEmailOtp}
                          onClick={handleRequestEmailChange}
                          className="px-4 py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {isSendingEmailOtp ? 'Sending...' : 'Send Code'}
                        </button>
                        <button
                          type="button"
                          onClick={resetEmailChangeFlow}
                          className="px-3 py-2.5 bg-theme-background/40 hover:bg-theme-border/30 text-theme-text-secondary font-semibold rounded-xl transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {emailStep === 'VERIFY_OLD' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-[11px] text-theme-text-secondary">
                        <span>
                          <strong className="text-accent">Step 1 of 2</strong> — Enter the code sent to your current email <strong className="text-theme-text-primary">{user?.email}</strong>
                        </span>
                        <span className="font-mono font-bold text-accent">{emailTimeLeftStr}</span>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                        <div className="flex-1 space-y-1.5">
                          <label className="block font-medium text-theme-text-secondary">Verification Code</label>
                          <CodeSlots
                            length={6}
                            value={emailOtp}
                            status={emailChangeErr ? 'error' : 'idle'}
                            autoFocus
                            disabled={isConfirmingEmailOtp}
                            ariaLabel="6-digit verification code"
                            onChange={(code: string) => {
                              setEmailOtp(code);
                              if (code && emailChangeErr) setEmailChangeErr('');
                            }}
                            accentColor="var(--color-accent)"
                            inkColor="var(--color-accent)"
                            slotColor="color-mix(in srgb, var(--color-theme-border) 60%, transparent)"
                            digitColor="var(--color-theme-text-primary)"
                            dangerColor="var(--color-danger)"
                            slotSize={42}
                            gap={8}
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isConfirmingEmailOtp}
                            onClick={handleConfirmOldEmailOtp}
                            className="px-4 py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {isConfirmingEmailOtp ? 'Confirming...' : 'Continue'}
                          </button>
                          <button
                            type="button"
                            onClick={resetEmailChangeFlow}
                            className="px-3 py-2.5 bg-theme-background/40 hover:bg-theme-border/30 text-theme-text-secondary font-semibold rounded-xl transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {emailStep === 'VERIFY_NEW' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-[11px] text-theme-text-secondary">
                        <span>
                          <strong className="text-accent">Step 2 of 2</strong> — Enter the code sent to your new email <strong className="text-theme-text-primary">{newEmailInput}</strong>
                        </span>
                        <span className="font-mono font-bold text-accent">{emailTimeLeftStr}</span>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                        <div className="flex-1 space-y-1.5">
                          <label className="block font-medium text-theme-text-secondary">Verification Code</label>
                          <CodeSlots
                            length={6}
                            value={emailOtp}
                            status={emailChangeErr ? 'error' : 'idle'}
                            autoFocus
                            disabled={isConfirmingEmailOtp}
                            ariaLabel="6-digit verification code"
                            onChange={(code: string) => {
                              setEmailOtp(code);
                              if (code && emailChangeErr) setEmailChangeErr('');
                            }}
                            accentColor="var(--color-accent)"
                            inkColor="var(--color-accent)"
                            slotColor="color-mix(in srgb, var(--color-theme-border) 60%, transparent)"
                            digitColor="var(--color-theme-text-primary)"
                            dangerColor="var(--color-danger)"
                            slotSize={42}
                            gap={8}
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isConfirmingEmailOtp}
                            onClick={handleConfirmNewEmailOtp}
                            className="px-4 py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {isConfirmingEmailOtp ? 'Confirming...' : 'Confirm Change'}
                          </button>
                          <button
                            type="button"
                            onClick={resetEmailChangeFlow}
                            className="px-3 py-2.5 bg-theme-background/40 hover:bg-theme-border/30 text-theme-text-secondary font-semibold rounded-xl transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-theme-border/20">
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Role Tier</label>
                  <input
                    type="text"
                    disabled
                    value={`${user?.role || 'Super User'} (Tier ${user?.tier || 1})`}
                    className="w-full px-4 py-2.5 bg-theme-background/10 border border-theme-border/30 rounded-xl text-theme-text-secondary cursor-not-allowed opacity-70"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <label className="block font-medium text-theme-text-secondary">Date of Birth</label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                  <p className="text-[11px] text-theme-text-secondary">We&apos;ll send you a birthday email from the Centre on this date each year.</p>
                </div>
              </div>

              <div className="pt-2 border-t border-theme-border/20 space-y-3">
                <h4 className="font-bold text-xs text-theme-text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <Key className="h-4 w-4 text-accent" />
                  Change Password
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block font-medium text-theme-text-secondary">New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimum 4 characters"
                      className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block font-medium text-theme-text-secondary">Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password"
                      className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-3">
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer flex items-center gap-1.5 text-xs"
                >
                  <Save className="h-4 w-4" />
                  Save Profile
                </button>
              </div>
            </form>
          </div>

          {/* User Session Info Card */}
          <div className="glass-panel rounded-2xl p-6 space-y-4 flex flex-col justify-between">
            <div className="space-y-3 text-xs">
              <h3 className="text-sm font-bold text-theme-text-primary">Session Info</h3>
              <div className="bg-theme-background/30 p-4 rounded-xl border border-theme-border/30 space-y-2 text-[11px]">
                <p className="text-theme-text-secondary">Authenticated Account:</p>
                <p className="font-bold text-theme-text-primary text-xs">{user?.name}</p>
                <p className="font-mono text-accent">{user?.email}</p>
                <div className="pt-2 border-t border-theme-border/20 text-theme-text-secondary">
                  <span>Authorized Tier: </span>
                  <strong className="text-theme-text-primary">{user?.role} (Level {user?.tier})</strong>
                </div>

              </div>
            </div>

            <div className="text-[11px] text-theme-text-secondary space-y-1">
              <p>RTBI Portal</p>
              <p>Build version: v2026.8.19-email-sync</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Roles Matrix */}
      {activeTab === 'roles' && (
        <div className="glass-panel rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="text-base font-bold text-theme-text-primary">System Access & Permission Hierarchy</h3>
            <p className="text-xs text-theme-text-secondary">Governing access rules across the role tiers defined in RTBI</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rolePrivileges.map(rp => (
              <div key={rp.tier} className="p-4 bg-theme-border/10 border border-theme-border/20 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-theme-text-primary text-sm">{rp.role}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/20">
                    Tier {rp.tier}
                  </span>
                </div>
                <p className="text-xs text-theme-text-secondary leading-relaxed">
                  {rp.access}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Email Logs & Dispatcher Inspector */}
      {activeTab === 'emails' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Sent Emails History */}
            <div className="glass-panel rounded-2xl p-6 lg:col-span-2 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-theme-border/30 pb-4">
                <div>
                  <h3 className="text-base font-bold text-theme-text-primary">Sent Email Notifications</h3>
                  <p className="text-xs text-theme-text-secondary">Live dispatches for OTP resets, announcements, tasks, and event rosters</p>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchEmails}
                    className="p-2 bg-theme-background/40 hover:bg-theme-background/70 border border-theme-border/40 rounded-xl text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
                    title="Refresh Email Logs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <select
                    value={emailFilter}
                    onChange={(e) => setEmailFilter(e.target.value)}
                    className="px-3 py-1.5 bg-theme-background/40 border border-theme-card-border rounded-xl text-xs text-theme-text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="ALL">All Categories ({emailLogs.length})</option>
                    <option value="AUTH_OTP">Password Reset OTP</option>
                    <option value="ANNOUNCEMENT">Announcements</option>
                    <option value="TASK_ASSIGNMENT">Task Assignments</option>
                    <option value="SYSTEM">System Alerts</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                {filteredEmailLogs.length === 0 ? (
                  <div className="text-center py-12 text-theme-text-secondary text-xs space-y-2">
                    <Mail className="h-8 w-8 mx-auto text-theme-text-secondary/40" />
                    <p>No email logs found for category &ldquo;{emailFilter}&rdquo;.</p>
                  </div>
                ) : (
                  <table className="min-w-full text-xs text-left">
                    <thead>
                      <tr className="text-theme-text-secondary border-b border-theme-border/40 text-xs">
                        <th className="pb-3 font-semibold">Category</th>
                        <th className="pb-3 font-semibold">Recipient</th>
                        <th className="pb-3 font-semibold">Subject</th>
                        <th className="pb-3 font-semibold">Sent At</th>
                        <th className="pb-3 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-border/20">
                      {filteredEmailLogs.map(log => (
                        <tr key={log.id} className="hover:bg-theme-border/10 transition-all text-xs">
                          <td className="py-3 pr-2 whitespace-nowrap">
                            <span className={`font-semibold px-2 py-0.5 rounded text-[10px] uppercase border ${
                              log.category === 'AUTH_OTP'
                                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                : log.category === 'ANNOUNCEMENT'
                                ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                                : log.category === 'TASK_ASSIGNMENT'
                                ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                                : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            }`}>
                              {log.category.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-3 pr-2 font-mono font-medium text-theme-text-primary whitespace-nowrap">{log.to}</td>
                          <td className="py-3 pr-2 text-theme-text-primary max-w-xs truncate" title={log.subject}>
                            {log.subject}
                          </td>
                          <td className="py-3 pr-2 text-theme-text-secondary whitespace-nowrap font-mono text-[11px]">
                            {new Date(log.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td className="py-3 text-right">
                            <button
                              onClick={() => setPreviewEmail(log)}
                              className="px-2.5 py-1 bg-accent/15 hover:bg-accent/30 text-accent rounded-lg transition-all font-medium text-[11px] flex items-center gap-1 ml-auto cursor-pointer"
                            >
                              <Eye className="h-3 w-3" />
                              Preview
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Test Email Dispatcher Panel */}
            <div className="glass-panel rounded-2xl p-6 space-y-4 h-fit">
              <div>
                <h3 className="text-sm font-bold text-theme-text-primary flex items-center gap-2">
                  <Send className="h-4 w-4 text-accent" />
                  Test Email Dispatcher
                </h3>
                <p className="text-[11px] text-theme-text-secondary mt-1">
                  Send a test notification to verify recipient inbox delivery
                </p>
              </div>

              <form onSubmit={handleSendTestEmail} className="space-y-3.5 text-xs">
                <div className="space-y-1">
                  <label className="block font-medium text-theme-text-secondary">Recipient Email</label>
                  <input
                    type="email"
                    required
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full px-3.5 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-medium text-theme-text-secondary">Subject Line</label>
                  <input
                    type="text"
                    required
                    value={testSubject}
                    onChange={(e) => setTestSubject(e.target.value)}
                    placeholder="[Test] RTBI System Verification"
                    className="w-full px-3.5 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-medium text-theme-text-secondary">Email Message</label>
                  <textarea
                    rows={3}
                    required
                    value={testBody}
                    onChange={(e) => setTestBody(e.target.value)}
                    placeholder="Write test message body here..."
                    className="w-full px-3.5 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSendingTest}
                  className="w-full py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 text-xs"
                >
                  {isSendingTest ? (
                    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      Dispatch Email
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Integrations (Super User only): WalletWallet key + centre socials */}
      {activeTab === 'integrations' && user?.tier === 1 && <IntegrationsPanel />}

      {/* Tab 4: Security & Audit Trail */}
      {activeTab === 'audit' && isSuperAdmin && (
        <div className="glass-panel rounded-2xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-theme-text-primary">Security Audit Trail</h3>
              <p className="text-xs text-theme-text-secondary">Immutable log of system actions, member updates, and governance events — retains the latest 1,000 events</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-accent px-2.5 py-0.5 bg-accent/15 rounded-md whitespace-nowrap">
                {filteredAuditLogs.length} of {auditLogs.length} events
              </span>
              <button
                onClick={handleExportAuditCsv}
                disabled={filteredAuditLogs.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-theme-border/30 hover:bg-theme-border/50 disabled:opacity-50 disabled:cursor-not-allowed text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-theme-text-secondary" />
              <input
                type="text"
                value={auditSearchQuery}
                onChange={(e) => { setAuditSearchQuery(e.target.value); setAuditVisibleCount(50); }}
                placeholder="Search by action, actor, email, or details..."
                className="w-full pl-8 pr-3 py-2 bg-theme-background/30 border border-theme-border/40 rounded-xl text-xs text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-accent"
              />
            </div>
            <PeriodFilter
              value={auditPeriodFilter}
              onChange={(v) => { setAuditPeriodFilter(v); setAuditVisibleCount(50); }}
              availableMonths={availableAuditMonths}
            />
          </div>

          <div className="overflow-x-auto">
            {filteredAuditLogs.length === 0 ? (
              <div className="text-center py-10 text-theme-text-secondary text-xs">
                {auditLogs.length === 0 ? 'No audit logs recorded yet in this session.' : 'No events match the selected search/filter.'}
              </div>
            ) : (
              <>
                <table className="min-w-full text-xs text-left">
                  <thead>
                    <tr className="text-theme-text-secondary border-b border-theme-border/40 text-xs">
                      <th className="pb-3 font-semibold">Timestamp</th>
                      <th className="pb-3 font-semibold">Event Action</th>
                      <th className="pb-3 font-semibold">Actor Name</th>
                      <th className="pb-3 font-semibold">Actor Email</th>
                      <th className="pb-3 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-border/20">
                    {displayedAuditLogs.map(log => (
                      <tr key={log.id} className="hover:bg-theme-border/10 transition-all text-xs align-top">
                        <td className="py-3 pr-2 text-theme-text-secondary whitespace-nowrap font-mono">{log.timestamp}</td>
                        <td className="py-3 pr-2">
                          <span className={`font-semibold px-2 py-0.5 rounded text-[10px] uppercase whitespace-nowrap ${auditSeverityClasses[auditSeverity(log.action)]}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="py-3 pr-2 font-bold text-theme-text-primary whitespace-nowrap">{log.actorName}</td>
                        <td className="py-3 pr-2 text-theme-text-secondary font-mono whitespace-nowrap">{log.actorEmail}</td>
                        <td className="py-3 text-theme-text-secondary max-w-lg break-words">
                          {log.details}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredAuditLogs.length > displayedAuditLogs.length && (
                  <div className="flex justify-center pt-4">
                    <button
                      onClick={() => setAuditVisibleCount(c => c + 50)}
                      className="px-4 py-2 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer"
                    >
                      Load More ({filteredAuditLogs.length - displayedAuditLogs.length} remaining)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Rendered Email Preview Modal */}
      {previewEmail && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-2xl rounded-3xl p-6 flex flex-col space-y-4 max-h-[90vh] border border-white/20 shadow-2xl relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-theme-border/40 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-accent" />
                <div>
                  <h3 className="text-sm font-bold text-theme-text-primary">Rendered Email Dispatch Preview</h3>
                  <p className="text-[11px] text-theme-text-secondary">To: {previewEmail.to}</p>
                </div>
              </div>
              <button
                onClick={() => setPreviewEmail(null)}
                className="text-theme-text-secondary hover:text-theme-text-primary text-sm p-1 rounded-lg hover:bg-white/10 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 p-4">
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewEmail.bodyHtml || '') }} />
            </div>

            <div className="flex justify-between items-center text-[11px] text-theme-text-secondary pt-2 border-t border-theme-border/20">
              <span className="font-mono">ID: {previewEmail.id}</span>
              <button
                onClick={() => setPreviewEmail(null)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-theme-text-primary font-medium rounded-xl transition-all cursor-pointer text-xs"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Crop Modal for Avatar / Profile Photo */}
      <ImageCropModal
        isOpen={cropModalOpen}
        imageSrc={cropImageSrc}
        fileName={cropFileName}
        title="Frame Profile Photo"
        description="Drag to reposition and zoom to frame your profile picture for avatars, sidebars, and cards."
        onCropComplete={handleAvatarCropComplete}
        onClose={() => setCropModalOpen(false)}
      />

    </div>
  );
}
