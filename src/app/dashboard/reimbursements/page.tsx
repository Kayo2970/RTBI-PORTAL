'use client';

import React, { useState, useEffect } from 'react';
import {
  Check,
  X,
  Download,
  FileText,
  ShieldAlert,
  CheckCircle,
  Eye,
  EyeOff,
  Clock,
  CheckCircle2,
  BarChart3,
  Filter,
  Calendar,
  FileSpreadsheet,
  Building2,
  CreditCard,
  Hash,
  Paperclip
} from 'lucide-react';
import { FileDropzone, FilePreviewRow, createProgressTracker } from '@/components/ui/file-dropzone';
import { SearchableSelect } from '@/components/searchable-select';
import {
  getReimbursements,
  addReimbursement,
  updateReimbursementStatus,
  verifyReimbursementByCentreHead,
  getEvents,
  getTasks,
  isApprovedEvent,
  getMembers,
  Member,
  ReimbursementItem,
  EventItem,
  TaskItem,
  ReceiptFile
} from '@/lib/local-data';
import {
  isCentreHead,
  canApproveAsSectorHead,
  canApproveAsFinanceHead,
  canViewReimbursement
} from '@/lib/permissions';

export default function ReimbursementsPage() {
  const [reimbursements, setReimbursements] = useState<ReimbursementItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [user, setUser] = useState<any>(null);

  // Form State (Collaborator Claims)
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Printing & Stationary');
  const [description, setDescription] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');

  // Structured Bank Settlement Details
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');

  // Multiple Receipt Files (Up to 3: Bill, Proof, Supporting Docs). Kept as raw
  // File objects (not pre-converted to base64) so each row can show a real
  // thumbnail/type/size and survive a failed claim submission for retry.
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isSubmittingClaim, setIsSubmittingClaim] = useState(false);
  const [claimSubmitError, setClaimSubmitError] = useState('');
  const [claimUploadProgress, setClaimUploadProgress] = useState(0);
  const [claimUploadEtaSeconds, setClaimUploadEtaSeconds] = useState<number | null>(null);

  // Filtering & Event Chart Modal State
  const [selectedEventFilter, setSelectedEventFilter] = useState<string>('ALL');
  const [showChartModal, setShowChartModal] = useState(false);
  const [chartEventId, setChartEventId] = useState<string>('ALL');

  // Modals & previews
  const [viewingReceipt, setViewingReceipt] = useState<{ files: ReceiptFile[]; selectedIndex: number; title: string } | null>(null);
  const [revealedBankIds, setRevealedBankIds] = useState<Record<string, boolean>>({});

  // Notification Alert State
  const [alertMsg, setAlertMsg] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const refreshData = () => {
      setReimbursements(getReimbursements());
      setEvents(getEvents());
      setTasks(getTasks());
    };
    refreshData();

    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        const u = JSON.parse(savedUser);
        setUser(u);

        const allMembers = getMembers();
        const me = allMembers.find((m: Member) => m.id === u.id || m.email?.toLowerCase() === u.email?.toLowerCase());
        const defaultBank = u.bankName || me?.bankName || '';
        const defaultAcc = u.accountNumber || me?.accountNumber || '';
        const defaultIfsc = u.ifscCode || me?.ifscCode || '';

        if (defaultBank) setBankName(defaultBank);
        if (defaultAcc) setAccountNumber(defaultAcc);
        if (defaultIfsc) setIfscCode(defaultIfsc);
      } catch (e) {
        console.error(e);
      }
    }

    window.addEventListener('leads-data-sync', refreshData);
    window.addEventListener('storage', refreshData);
    return () => {
      window.removeEventListener('leads-data-sync', refreshData);
      window.removeEventListener('storage', refreshData);
    };
  }, []);

  const triggerSuccess = (msg: string) => {
    setAlertMsg(msg);
    setTimeout(() => setAlertMsg(''), 4000);
  };

  const handleFilesSelected = (files: File[]) => {
    if (attachedFiles.length + files.length > 3) {
      setFormError('Maximum 3 documentation files (bill, payment proof, supporting note) allowed per claim.');
      return;
    }
    setFormError('');
    setAttachedFiles(prev => [...prev, ...files]);
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read that file.')));
    reader.onerror = () => reject(new Error(`Could not read "${file.name}". Please try selecting it again.`));
    reader.readAsDataURL(file);
  });

  const handleSubmitClaim = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setFormError('');

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError('Please enter a valid positive reimbursement amount.');
      return;
    }

    if (!description || !bankName.trim() || !accountNumber.trim() || !ifscCode.trim() || !user) {
      setFormError('Please fill in all mandatory expense and bank settlement details.');
      return;
    }

    const selectedEv = events.find(ev => ev.id === selectedEventId);
    const summaryBankStr = `${bankName.trim()} - A/C ${accountNumber.trim()} - IFSC ${ifscCode.trim().toUpperCase()}`;

    setIsSubmittingClaim(true);
    setClaimSubmitError('');
    setClaimUploadProgress(0);
    setClaimUploadEtaSeconds(null);
    try {
      const receiptFiles: ReceiptFile[] = await Promise.all(
        attachedFiles.map(async (file) => ({
          name: file.name,
          dataUrl: await readFileAsDataUrl(file),
          type: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
        }))
      );

      const tracker = createProgressTracker((pct, eta) => { setClaimUploadProgress(pct); setClaimUploadEtaSeconds(eta); });
      await addReimbursement({
        memberName: user.name,
        memberEmail: user.email,
        amount: parsedAmount,
        category,
        description,
        receiptUrl: receiptFiles[0]?.name || 'receipt.pdf',
        receiptData: receiptFiles[0]?.dataUrl || undefined,
        receiptFiles,
        bankDetails: summaryBankStr,
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim(),
        ifscCode: ifscCode.trim().toUpperCase(),
        eventId: selectedEventId || undefined,
        eventName: selectedEv ? selectedEv.title : undefined
      }, tracker);

      // Reset Form — only on confirmed success; a failed submit keeps every
      // field (including the attached files) exactly as the claimant left it.
      setAmount('');
      setDescription('');
      setBankName('');
      setAccountNumber('');
      setIfscCode('');
      setSelectedEventId('');
      setAttachedFiles([]);
      setClaimUploadProgress(0);
      setClaimUploadEtaSeconds(null);

      setReimbursements(getReimbursements());
      triggerSuccess(`Reimbursement claim ${selectedEv ? `attached to "${selectedEv.title}"` : ''} submitted successfully with ${receiptFiles.length} file(s).`);
    } catch (err: any) {
      setClaimSubmitError(err.message || 'Failed to submit the claim. Please try again.');
    } finally {
      setIsSubmittingClaim(false);
    }
  };

  // Two-Stage Approval Handlers (Centre Head Verification Stage 1 -> Finance Head Approval Stage 2)
  const handleSectorHeadApproval = (id: string, approve: boolean) => {
    if (approve) {
      verifyReimbursementByCentreHead(id, user?.name || 'Centre Head');
      triggerSuccess('Centre Head verification completed. Claim is ready for Finance Head final approval.');
    } else {
      updateReimbursementStatus(id, 'Denied', { name: user?.name || 'Centre Head', stage: 'firstPass', tier: user?.tier });
      triggerSuccess('Claim rejected by Centre Head.');
    }
    setReimbursements(getReimbursements());
  };

  const handleFinanceHeadApproval = (id: string, approve: boolean) => {
    const claim = reimbursements.find(r => r.id === id);
    if (approve && claim && claim.status === 'Pending' && !isCentreHead(user) && user?.tier !== 1) {
      setFormError('Centre Head Verification Required: This claim must be verified by the Centre Head before Finance Head final approval.');
      return;
    }

    if (approve) {
      updateReimbursementStatus(id, 'Approved', { name: user?.name || 'Finance Head', stage: 'final', tier: user?.tier });
      triggerSuccess('Finance Head approval granted. Reimbursement claim processed & disbursed.');
    } else {
      updateReimbursementStatus(id, 'Denied', { name: user?.name || 'Finance Head', stage: 'final', tier: user?.tier });
      triggerSuccess('Claim rejected by Finance Head.');
    }
    setReimbursements(getReimbursements());
  };

  const toggleBankReveal = (id: string) => {
    setRevealedBankIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const maskAccNo = (acc?: string) => {
    if (!acc) return '••••••••';
    if (acc.length <= 4) return '••••' + acc;
    return '••••••••' + acc.slice(-4);
  };

  const handleDownloadCsv = () => {
    const approvedClaims = reimbursements.filter(r => r.status === 'Approved');
    if (approvedClaims.length === 0) {
      alert('No approved claims available to reconcile.');
      return;
    }

    let csvContent = 'Claim_ID,Member,Email,Category,Event,Amount,Bank_Name,Account_Number,IFSC_Code,Attached_Files_Count,Date_Approved,First_Pass_Reviewer,Final_Approver\n';
    approvedClaims.forEach(claim => {
      const bName = claim.bankName || (claim.bankDetails ? claim.bankDetails.split('-')[0].trim() : 'N/A');
      const accNo = claim.accountNumber || (claim.bankDetails ? claim.bankDetails.split('-')[1]?.replace('A/C', '').trim() : 'N/A');
      const ifsc = claim.ifscCode || (claim.bankDetails ? claim.bankDetails.split('-')[2]?.replace('IFSC', '').trim() : 'N/A');
      const fileCount = claim.receiptFiles?.length || (claim.receiptUrl ? 1 : 0);

      csvContent += `"${claim.id}","${claim.memberName}","${claim.memberEmail}","${claim.category}","${claim.eventName || 'General Operations'}",${claim.amount},"${bName}","${accNo}","${ifsc}",${fileCount},"${claim.submittedAt}","${claim.firstPassReviewer || 'N/A'}","${claim.finalApprover || 'N/A'}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'leads_reconciled_expenses.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // One-Shot Event Reimbursement Chart CSV Export
  const handleExportEventChartCsv = (targetEventId: string) => {
    const targetEv = events.find(e => e.id === targetEventId);
    const chartClaims = targetEventId === 'ALL'
      ? reimbursements
      : targetEventId === 'GENERAL'
      ? reimbursements.filter(r => !r.eventId)
      : reimbursements.filter(r => r.eventId === targetEventId);

    const titleName = targetEventId === 'ALL'
      ? 'All Events & Operations'
      : targetEventId === 'GENERAL'
      ? 'General Operations'
      : targetEv?.title || 'Event';

    const totalAmount = chartClaims.reduce((sum, r) => sum + r.amount, 0);
    const approvedAmount = chartClaims.filter(r => r.status === 'Approved').reduce((sum, r) => sum + r.amount, 0);
    const pendingAmount = chartClaims.filter(r => r.status === 'Pending' || r.status === 'Under Review').reduce((sum, r) => sum + r.amount, 0);
    const deniedAmount = chartClaims.filter(r => r.status === 'Denied').reduce((sum, r) => sum + r.amount, 0);

    let csvContent = `==================================================\n`;
    csvContent += `LEADS FINANCIAL REIMBURSEMENT SUMMARY CHART\n`;
    csvContent += `Target Scope: ${titleName}\n`;
    csvContent += `Generated Date: ${new Date().toISOString().split('T')[0]}\n`;
    csvContent += `Total Claims Count: ${chartClaims.length}\n`;
    csvContent += `Total Amount Claimed: ₹${totalAmount}\n`;
    csvContent += `Total Approved Amount: ₹${approvedAmount}\n`;
    csvContent += `Total Pending Amount: ₹${pendingAmount}\n`;
    csvContent += `Total Denied Amount: ₹${deniedAmount}\n`;
    csvContent += `==================================================\n\n`;

    csvContent += `Claim_ID,Member_Name,Email,Category,Event_Name,Description,Amount_INR,Status,Bank_Name,Account_Number,IFSC_Code,Attached_Files_Count,Submitted_Date,First_Pass_Reviewer,Final_Approver\n`;

    chartClaims.forEach(r => {
      const bName = r.bankName || (r.bankDetails ? r.bankDetails.split('-')[0].trim() : 'N/A');
      const accNo = r.accountNumber || (r.bankDetails ? r.bankDetails.split('-')[1]?.replace('A/C', '').trim() : 'N/A');
      const ifsc = r.ifscCode || (r.bankDetails ? r.bankDetails.split('-')[2]?.replace('IFSC', '').trim() : 'N/A');
      const fileCount = r.receiptFiles?.length || (r.receiptUrl ? 1 : 0);

      csvContent += `"${r.id}","${r.memberName}","${r.memberEmail}","${r.category}","${r.eventName || 'General Operations'}","${r.description.replace(/"/g, '""')}",${r.amount},"${r.status}","${bName}","${accNo}","${ifsc}",${fileCount},"${r.submittedAt}","${r.firstPassReviewer || 'N/A'}","${r.finalApprover || 'N/A'}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeFilename = titleName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    link.setAttribute('href', url);
    link.setAttribute('download', `reimbursement_chart_${safeFilename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const canSectorApprove = canApproveAsSectorHead(user);
  const canFinanceApprove = canApproveAsFinanceHead(user);

  const displayedClaims = reimbursements.filter(r => {
    // Role & stage visibility filter
    if (user && !canViewReimbursement(r, user)) {
      return false;
    }
    // Event filter
    if (selectedEventFilter === 'ALL') return true;
    if (selectedEventFilter === 'GENERAL') return !r.eventId;
    return r.eventId === selectedEventFilter;
  });

  const pendingClaims = displayedClaims.filter(r => r.status === 'Pending' || r.status === 'Verified by Centre Head' || r.status === 'Under Review');
  const processedClaims = displayedClaims.filter(r => r.status === 'Approved' || r.status === 'Denied');

  const getStatusBadge = (status: ReimbursementItem['status']) => {
    switch (status) {
      case 'Pending':
        return 'bg-amber-500/15 text-amber-500 border border-amber-500/30';
      case 'Verified by Centre Head':
      case 'Under Review':
        return 'bg-blue-500/15 text-blue-400 border border-blue-500/30';
      case 'Approved':
        return 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30';
      case 'Denied':
        return 'bg-red-500/15 text-red-500 border border-red-500/30';
    }
  };

  const getStatusLabel = (status: ReimbursementItem['status']) => {
    switch (status) {
      case 'Pending':
        return 'Pending Centre Head Verification';
      case 'Verified by Centre Head':
      case 'Under Review':
        return 'Verified by Centre Head → Awaiting Finance Approval';
      case 'Approved':
        return 'Approved & Payment Processed';
      case 'Denied':
        return 'Rejected';
    }
  };

  const openReceiptViewer = (claim: ReimbursementItem) => {
    let files: ReceiptFile[] = [];
    if (claim.receiptFiles && claim.receiptFiles.length > 0) {
      files = claim.receiptFiles;
    } else if (claim.receiptData || claim.receiptUrl) {
      files = [{ name: claim.receiptUrl || 'Receipt_Doc.pdf', dataUrl: claim.receiptData }];
    }
    if (files.length === 0) return;

    setViewingReceipt({
      files,
      selectedIndex: 0,
      title: `Bills & Supporting Docs: ${claim.memberName} (₹${claim.amount})`
    });
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      
      {/* Alert Banner */}
      {alertMsg && (
        <div className="flex items-center gap-3 p-4 bg-success/15 border border-success/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <CheckCircle className="h-5 w-5 text-success shrink-0" />
          <span>{alertMsg}</span>
        </div>
      )}

      {/* Header section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary">Reimbursements & Expense Claims</h1>
          <p className="text-xs text-theme-text-secondary">Structured bank settlement (Bank, Account No, IFSC), multi-bill documentation (up to 3 files) & event charts</p>
        </div>

        {/* Header Controls & Filter */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Event Filter Selector */}
          <div className="flex items-center gap-2 bg-theme-background/30 border border-theme-card-border px-3 py-1.5 rounded-xl">
            <Filter className="h-4 w-4 text-theme-text-secondary" />
            <SearchableSelect
              value={selectedEventFilter}
              onChange={setSelectedEventFilter}
              allLabel="All Events & Operations"
              allValue="ALL"
              options={[
                { value: 'GENERAL', label: 'General Operations (No Event)' },
                ...events.filter(ev => isApprovedEvent(ev, tasks)).map(ev => ({ value: ev.id, label: `Event: ${ev.title}` })),
              ]}
            />
          </div>

          {/* Event Reimbursement Chart Modal Trigger */}
          <button
            onClick={() => {
              setChartEventId(selectedEventFilter === 'GENERAL' ? 'ALL' : selectedEventFilter);
              setShowChartModal(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-theme-border/20 hover:bg-theme-border/30 text-theme-text-primary text-xs font-semibold rounded-xl border border-theme-border/30 transition-all cursor-pointer shadow-sm"
          >
            <BarChart3 className="h-4 w-4 text-accent" />
            <span>Event Expense Chart</span>
          </button>

          {(canSectorApprove || canFinanceApprove) && (
            <button
              onClick={handleDownloadCsv}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer"
            >
              <Download className="h-4 w-4" />
              Download Reconciliations (CSV)
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left Column: Submit Claim Form */}
        <div className="glass-panel rounded-2xl p-6 xl:col-span-1 space-y-4">
          <div>
            <h3 className="text-base font-bold text-theme-text-primary">Submit Expense Claim</h3>
            <p className="text-xs text-theme-text-secondary">Attach event, enter bank settlement details & upload up to 3 documentation files</p>
          </div>

          {formError && (
            <div className="p-3 bg-danger/10 border border-danger/25 rounded-xl text-danger text-xs flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleSubmitClaim} className="space-y-4 text-xs">
            {/* Event Association Select Dropdown */}
            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-accent" />
                Associated Event (Optional)
              </label>
              <SearchableSelect
                value={selectedEventId}
                onChange={setSelectedEventId}
                allLabel="General Operations / Non-Event Expense"
                allValue=""
                options={events.filter(ev => isApprovedEvent(ev, tasks)).map(ev => ({ value: ev.id, label: ev.title }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Expense Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
              >
                <option value="Printing & Stationary">Printing & Stationary</option>
                <option value="Catering / Refreshments">Catering / Refreshments</option>
                <option value="Travel & Logistics">Travel & Logistics</option>
                <option value="Technical Assets / Hardware">Technical Assets / Hardware</option>
                <option value="Miscellaneous & Operational">Miscellaneous & Operational</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Claim Amount (₹) *</label>
              <input
                type="number"
                min="1"
                step="any"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 2450.00"
                className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-medium text-theme-text-secondary">Expense Description & Justification *</label>
              <textarea
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detail what was purchased, for which event/committee, and why..."
                rows={2}
                className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            {/* Multiple Documentation Files Section (2-3 files) */}
            <div className="space-y-2 pt-1 border-t border-theme-border/20">
              <div className="flex items-center justify-between">
                <label className="block font-medium text-theme-text-secondary flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5 text-accent" />
                  Bills & Supporting Docs (Up to 3 files)
                </label>
                <span className="text-[10px] text-theme-text-secondary font-medium">
                  {attachedFiles.length}/3 attached
                </span>
              </div>

              {attachedFiles.length < 3 && (
                <FileDropzone
                  onFilesSelected={handleFilesSelected}
                  accept="image/*,.pdf"
                  multiple
                  disabled={isSubmittingClaim}
                  label="Upload Bill, Payment Receipt, or Approval Note"
                  hint="Drag and drop, or click to browse — up to 3 files"
                  compact
                />
              )}

              {/* Each attached file gets its own thumbnail/type/size proof and
                  its own remove control — one file never affects another. */}
              {attachedFiles.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {attachedFiles.map((file, idx) => (
                    <FilePreviewRow
                      key={`${file.name}-${idx}`}
                      file={file}
                      onRemove={!isSubmittingClaim ? () => removeAttachedFile(idx) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Structured Bank Settlement Coordinates */}
            <div className="space-y-3 pt-2 border-t border-theme-border/20">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-theme-text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-accent" />
                  Bank Settlement Coordinates
                </h4>
                {user && (user.bankName || bankName) && (
                  <span className="text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded-md font-medium flex items-center gap-1 border border-accent/20">
                    <CheckCircle2 className="h-3 w-3" />
                    Auto-filled from Settings
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="block font-medium text-theme-text-secondary text-[11px] flex items-center gap-1">
                    <Building2 className="h-3 w-3" /> Bank Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. HDFC Bank, SBI, ICICI"
                    className="w-full px-3 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block font-medium text-theme-text-secondary text-[11px] flex items-center gap-1">
                      <CreditCard className="h-3 w-3" /> Account Number *
                    </label>
                    <input
                      type="text"
                      required
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      placeholder="e.g. 50100293849182"
                      className="w-full px-3 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium text-theme-text-secondary text-[11px] flex items-center gap-1">
                      <Hash className="h-3 w-3" /> IFSC Code *
                    </label>
                    <input
                      type="text"
                      required
                      value={ifscCode}
                      onChange={(e) => setIfscCode(e.target.value)}
                      placeholder="e.g. HDFC0000123"
                      className="w-full px-3 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs uppercase"
                    />
                  </div>
                </div>
              </div>

              <span className="text-[10px] text-theme-text-secondary block">
                Account credentials are encrypted & masked for general users.
              </span>
            </div>

            {isSubmittingClaim && attachedFiles.length > 0 && (
              <div className="space-y-0.5 pt-1">
                <div className="h-1.5 rounded-full bg-theme-border/30 overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all duration-200" style={{ width: `${claimUploadProgress}%` }} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-theme-text-secondary">
                  <span>Uploading claim & {attachedFiles.length} file(s)... {claimUploadProgress}%</span>
                  {claimUploadEtaSeconds !== null && <span>{claimUploadEtaSeconds <= 0 ? 'almost done' : `${Math.ceil(claimUploadEtaSeconds)}s left`}</span>}
                </div>
              </div>
            )}

            {claimSubmitError && (
              <div className="p-3 bg-danger/10 border border-danger/25 rounded-xl text-danger text-xs flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>{claimSubmitError} Your details and attached files are still here — just submit again.</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingClaim}
              className="w-full py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmittingClaim ? 'Submitting...' : claimSubmitError ? 'Retry Submit Claim' : 'Submit Expense Claim'}
            </button>
          </form>
        </div>

        {/* Right Column: Pending & Processed Claims */}
        <div className="glass-panel rounded-2xl p-6 xl:col-span-2 space-y-6">
          
          {/* Pending / Under Review Queue */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider flex items-center gap-2">
                <Clock className="h-4 w-4 text-warning" />
                Claims in Verification Pipeline ({pendingClaims.length})
              </h3>
            </div>

            {pendingClaims.length === 0 ? (
              <div className="text-center py-8 text-theme-text-secondary text-xs bg-theme-border/5 rounded-xl border border-theme-border/20">
                No reimbursement claims currently awaiting review for this filter scope.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingClaims.map(claim => {
                  const isRevealed = Boolean(revealedBankIds[claim.id]);
                  const bName = claim.bankName || (claim.bankDetails ? claim.bankDetails.split('-')[0].trim() : 'Bank');
                  const accNo = claim.accountNumber || (claim.bankDetails ? claim.bankDetails.split('-')[1]?.replace('A/C', '').trim() : '');
                  const ifsc = claim.ifscCode || (claim.bankDetails ? claim.bankDetails.split('-')[2]?.replace('IFSC', '').trim() : '');
                  const filesList = claim.receiptFiles && claim.receiptFiles.length > 0
                    ? claim.receiptFiles
                    : (claim.receiptData || claim.receiptUrl ? [{ name: claim.receiptUrl || 'Receipt_Doc.pdf', dataUrl: claim.receiptData }] : []);

                  return (
                    <div key={claim.id} className="p-4 bg-theme-border/10 border border-theme-border/20 rounded-xl space-y-3 hover:bg-theme-border/15 transition-all text-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-theme-text-primary">{claim.memberName}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusBadge(claim.status)}`}>
                              {getStatusLabel(claim.status)}
                            </span>
                            {claim.firstPassReviewer && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                Sector Head: {claim.firstPassReviewer}
                              </span>
                            )}
                            {claim.eventName && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {claim.eventName}
                              </span>
                            )}
                          </div>
                          <p className="text-theme-text-secondary mt-0.5">{claim.memberEmail} · Submitted on {claim.submittedAt}</p>
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-base text-accent">₹{claim.amount.toLocaleString()}</span>
                          <p className="text-[11px] text-theme-text-secondary">{claim.category}</p>
                        </div>
                      </div>

                      <div className="p-3 bg-theme-background/30 rounded-lg border border-theme-border/20 space-y-2">
                        <p className="text-theme-text-primary font-medium">{claim.description}</p>
                        
                        {/* Structured Bank Settlement Display */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-theme-border/10 text-[11px]">
                          <div>
                            <span className="text-theme-text-secondary font-medium block">Bank Name:</span>
                            <span className="font-semibold text-theme-text-primary">{bName}</span>
                          </div>
                          <div>
                            <span className="text-theme-text-secondary font-medium block flex items-center gap-1">
                              Account Number:
                              {(canSectorApprove || canFinanceApprove || user?.tier === 1) && (
                                <button
                                  type="button"
                                  onClick={() => toggleBankReveal(claim.id)}
                                  className="text-theme-text-secondary hover:text-accent cursor-pointer"
                                  title={isRevealed ? 'Mask Bank Info' : 'Reveal Full Bank Info'}
                                >
                                  {isRevealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                </button>
                              )}
                            </span>
                            <span className="font-mono font-semibold text-theme-text-primary">
                              {isRevealed ? accNo : maskAccNo(accNo)}
                            </span>
                          </div>
                          <div>
                            <span className="text-theme-text-secondary font-medium block">IFSC Code:</span>
                            <span className="font-mono font-semibold text-theme-text-primary uppercase">{ifsc || 'N/A'}</span>
                          </div>
                        </div>

                        {/* Files & Documents Preview Button */}
                        <div className="flex items-center justify-between pt-1 border-t border-theme-border/10 text-[11px]">
                          <span className="text-theme-text-secondary flex items-center gap-1">
                            <Paperclip className="h-3.5 w-3.5 text-accent" />
                            {filesList.length} Documentation File(s) Attached
                          </span>

                          {filesList.length > 0 ? (
                            <button
                              onClick={() => openReceiptViewer(claim)}
                              className="text-accent hover:underline flex items-center gap-1 cursor-pointer font-medium"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Inspect Bills & Proofs ({filesList.length})
                            </button>
                          ) : (
                            <span className="text-theme-text-secondary italic">No receipt file attached</span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons based on role & stage */}
                      <div className="flex justify-end gap-2 pt-2 border-t border-theme-border/20">
                        {/* Stage 1: Centre Head verification (Pending claims) */}
                        {(canSectorApprove || isCentreHead(user) || user?.tier === 1) && claim.status === 'Pending' && (
                          <>
                            <button
                              onClick={() => handleSectorHeadApproval(claim.id, true)}
                              className="px-3 py-1.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-lg transition-all text-xs cursor-pointer flex items-center gap-1 shadow-sm"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Verify Claim (Step 1 - Pass to Finance)
                            </button>
                            <button
                              onClick={() => handleSectorHeadApproval(claim.id, false)}
                              className="px-3 py-1.5 bg-danger hover:bg-danger/90 text-white font-semibold rounded-lg transition-all text-xs cursor-pointer flex items-center gap-1 shadow-sm"
                            >
                              <X className="h-3.5 w-3.5" />
                              Reject Claim
                            </button>
                          </>
                        )}

                        {/* Stage 2: Finance Head approval (Verified by Centre Head or Under Review claims) */}
                        {(canFinanceApprove || isCentreHead(user) || user?.tier === 1) && (claim.status === 'Verified by Centre Head' || claim.status === 'Under Review' || (claim.status === 'Pending' && (isCentreHead(user) || user?.tier === 1))) && (
                          <>
                            <button
                              onClick={() => handleFinanceHeadApproval(claim.id, true)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-all text-xs cursor-pointer flex items-center gap-1 shadow-sm"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Final Approve & Process Payment (Step 2)
                            </button>
                            <button
                              onClick={() => handleFinanceHeadApproval(claim.id, false)}
                              className="px-3 py-1.5 bg-danger hover:bg-danger/90 text-white font-semibold rounded-lg transition-all text-xs cursor-pointer flex items-center gap-1 shadow-sm"
                            >
                              <X className="h-3.5 w-3.5" />
                              Reject Claim
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Processed / Reconciled Claims History */}
          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              Settlement & Reconciled History ({processedClaims.length})
            </h3>

            {processedClaims.length === 0 ? (
              <div className="text-center py-6 text-theme-text-secondary text-xs">
                No past settled or denied claims recorded for this filter scope.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-left">
                  <thead>
                    <tr className="text-theme-text-secondary border-b border-theme-border/40 text-xs">
                      <th className="pb-2.5 font-semibold">Claimant</th>
                      <th className="pb-2.5 font-semibold">Event / Scope</th>
                      <th className="pb-2.5 font-semibold">Bank Settlement</th>
                      <th className="pb-2.5 font-semibold">Amount</th>
                      <th className="pb-2.5 font-semibold">Status</th>
                      <th className="pb-2.5 font-semibold">Approval Log</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-border/20">
                    {processedClaims.map(claim => {
                      const bName = claim.bankName || (claim.bankDetails ? claim.bankDetails.split('-')[0].trim() : 'Bank');
                      const ifsc = claim.ifscCode || (claim.bankDetails ? claim.bankDetails.split('-')[2]?.replace('IFSC', '').trim() : '');
                      return (
                        <tr key={claim.id} className="hover:bg-theme-border/10 transition-all text-xs">
                          <td className="py-3 font-semibold text-theme-text-primary">{claim.memberName}</td>
                          <td className="py-3 text-theme-text-secondary">{claim.eventName || 'General Ops'}</td>
                          <td className="py-3 font-mono text-[11px] text-theme-text-secondary">{bName} ({ifsc})</td>
                          <td className="py-3 font-bold text-theme-text-primary">₹{claim.amount.toLocaleString()}</td>
                          <td className="py-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusBadge(claim.status)}`}>
                              {claim.status}
                            </span>
                          </td>
                          <td className="py-3 text-[11px] text-theme-text-secondary">
                            {claim.finalApprover ? `Authorized by ${claim.finalApprover}` : claim.firstPassReviewer ? `Reviewed by ${claim.firstPassReviewer}` : 'System Logged'} ({claim.decidedAt || claim.submittedAt})
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

      </div>

      {/* View Attached Bills & Documents Modal (Supports Navigation between multiple files) */}
      {viewingReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-2xl rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-theme-text-primary">{viewingReceipt.title}</h3>
                <p className="text-xs text-theme-text-secondary">File {viewingReceipt.selectedIndex + 1} of {viewingReceipt.files.length}: {viewingReceipt.files[viewingReceipt.selectedIndex]?.name}</p>
              </div>
              <button 
                onClick={() => setViewingReceipt(null)}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Tab selector for multiple attached files */}
            {viewingReceipt.files.length > 1 && (
              <div className="flex border-b border-theme-border/30 gap-2 text-xs font-semibold overflow-x-auto pb-1">
                {viewingReceipt.files.map((file, idx) => (
                  <button
                    key={idx}
                    onClick={() => setViewingReceipt({ ...viewingReceipt, selectedIndex: idx })}
                    className={`px-3 py-1.5 rounded-t-lg transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                      viewingReceipt.selectedIndex === idx
                        ? 'bg-accent text-white font-bold'
                        : 'bg-theme-border/10 text-theme-text-secondary hover:text-theme-text-primary'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Doc {idx + 1}: {file.name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Document Viewer Frame */}
            {(() => {
              const activeFile = viewingReceipt.files[viewingReceipt.selectedIndex];
              if (!activeFile) return null;

              const url = activeFile.url || activeFile.dataUrl || '';
              const isPdf = activeFile.name.endsWith('.pdf') || activeFile.type === 'application/pdf';

              return (
                <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-theme-border/30 bg-black/20 flex items-center justify-center p-2">
                  {url ? (
                    isPdf ? (
                      <iframe src={url} className="w-full h-96 rounded-lg" title={activeFile.name}></iframe>
                    ) : (
                      <img src={url} alt={activeFile.name} className="max-w-full h-auto object-contain rounded-lg" />
                    )
                  ) : (
                    <div className="p-8 text-center text-xs text-theme-text-secondary space-y-2">
                      <FileText className="h-8 w-8 mx-auto text-theme-text-secondary/50" />
                      <p className="font-semibold text-theme-text-primary">{activeFile.name}</p>
                      <p>File registered in settlement ledger. Full content preview available on server sync.</p>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex justify-end gap-2">
              {(() => {
                const activeFile = viewingReceipt.files[viewingReceipt.selectedIndex];
                const url = activeFile?.url || activeFile?.dataUrl;
                if (!url) return null;
                return (
                  <a
                    href={activeFile.url ? `${activeFile.url}?download=1` : url}
                    download={activeFile.name}
                    className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                );
              })()}
              <button
                onClick={() => setViewingReceipt(null)}
                className="px-4 py-2 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* One-Shot Event Reimbursement Chart Modal */}
      {showChartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-3xl rounded-3xl p-6 flex flex-col space-y-5 relative border border-white/15 shadow-2xl max-h-[90vh] overflow-y-auto">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-theme-border/30 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-accent/10 border border-accent/20 rounded-2xl text-accent">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-theme-text-primary">Event Reimbursement Summary Chart</h3>
                  <p className="text-xs text-theme-text-secondary">Inspect itemized claims & download one-shot financial ledgers per event</p>
                </div>
              </div>
              <button 
                onClick={() => setShowChartModal(false)}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scope / Event Selector */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-theme-background/20 p-3.5 rounded-2xl border border-theme-border/30 text-xs">
              <span className="font-semibold text-theme-text-primary flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-accent" />
                Select Event Scope:
              </span>
              <SearchableSelect
                value={chartEventId}
                onChange={setChartEventId}
                allLabel="All Events & Operations Combined"
                allValue="ALL"
                className="w-56"
                options={[
                  { value: 'GENERAL', label: 'General Operations (No Event)' },
                  ...events.filter(ev => isApprovedEvent(ev, tasks)).map(ev => ({ value: ev.id, label: `Event: ${ev.title}` })),
                ]}
              />
            </div>

            {/* Financial Metrics Summary Grid */}
            {(() => {
              const scopeClaims = chartEventId === 'ALL'
                ? reimbursements
                : chartEventId === 'GENERAL'
                ? reimbursements.filter(r => !r.eventId)
                : reimbursements.filter(r => r.eventId === chartEventId);

              const totalAmt = scopeClaims.reduce((s, r) => s + r.amount, 0);
              const approvedAmt = scopeClaims.filter(r => r.status === 'Approved').reduce((s, r) => s + r.amount, 0);
              const pendingAmt = scopeClaims.filter(r => r.status === 'Pending' || r.status === 'Under Review').reduce((s, r) => s + r.amount, 0);
              const deniedAmt = scopeClaims.filter(r => r.status === 'Denied').reduce((s, r) => s + r.amount, 0);

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-xl space-y-1">
                      <span className="text-[11px] text-theme-text-secondary font-medium">Total Claimed</span>
                      <p className="text-base font-bold text-theme-text-primary">₹{totalAmt.toLocaleString()}</p>
                      <span className="text-[10px] text-theme-text-secondary">{scopeClaims.length} total claim(s)</span>
                    </div>

                    <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-1">
                      <span className="text-[11px] text-emerald-400 font-medium">Approved & Paid</span>
                      <p className="text-base font-bold text-emerald-400">₹{approvedAmt.toLocaleString()}</p>
                      <span className="text-[10px] text-emerald-400/80">{scopeClaims.filter(r => r.status === 'Approved').length} claim(s)</span>
                    </div>

                    <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-1">
                      <span className="text-[11px] text-amber-400 font-medium">Pending Review</span>
                      <p className="text-base font-bold text-amber-400">₹{pendingAmt.toLocaleString()}</p>
                      <span className="text-[10px] text-amber-400/80">{scopeClaims.filter(r => r.status === 'Pending' || r.status === 'Under Review').length} claim(s)</span>
                    </div>

                    <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl space-y-1">
                      <span className="text-[11px] text-red-400 font-medium">Denied Claims</span>
                      <p className="text-base font-bold text-red-400">₹{deniedAmt.toLocaleString()}</p>
                      <span className="text-[10px] text-red-400/80">{scopeClaims.filter(r => r.status === 'Denied').length} claim(s)</span>
                    </div>
                  </div>

                  {/* Itemized Table */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">
                      Itemized Expense Breakdown ({scopeClaims.length})
                    </h4>

                    {scopeClaims.length === 0 ? (
                      <div className="text-center py-6 text-theme-text-secondary text-xs bg-theme-border/5 rounded-xl border border-theme-border/20">
                        No expense claims attached to this event scope yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-theme-border/30 rounded-xl max-h-60 overflow-y-auto">
                        <table className="min-w-full text-xs text-left">
                          <thead className="sticky top-0 bg-theme-background/90 backdrop-blur-md border-b border-theme-border/40">
                            <tr className="text-theme-text-secondary text-[11px]">
                              <th className="p-2.5 font-semibold">Claimant</th>
                              <th className="p-2.5 font-semibold">Bank Settlement</th>
                              <th className="p-2.5 font-semibold">Category</th>
                              <th className="p-2.5 font-semibold">Amount</th>
                              <th className="p-2.5 font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-theme-border/20">
                            {scopeClaims.map(claim => {
                              const bName = claim.bankName || (claim.bankDetails ? claim.bankDetails.split('-')[0].trim() : 'Bank');
                              const ifsc = claim.ifscCode || (claim.bankDetails ? claim.bankDetails.split('-')[2]?.replace('IFSC', '').trim() : '');
                              return (
                                <tr key={claim.id} className="hover:bg-theme-border/10 text-xs">
                                  <td className="p-2.5 font-semibold text-theme-text-primary">{claim.memberName}</td>
                                  <td className="p-2.5 font-mono text-[11px] text-theme-text-secondary">{bName} ({ifsc})</td>
                                  <td className="p-2.5 text-theme-text-secondary">{claim.category}</td>
                                  <td className="p-2.5 font-bold text-theme-text-primary">₹{claim.amount.toLocaleString()}</td>
                                  <td className="p-2.5">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusBadge(claim.status)}`}>
                                      {claim.status}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* One-Shot Download Actions */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-theme-border/30">
                    <p className="text-[11px] text-theme-text-secondary">
                      Export full ledger containing claim breakdown, bank settlement coordinates, and verification logs.
                    </p>
                    <button
                      onClick={() => handleExportEventChartCsv(chartEventId)}
                      className="w-full sm:w-auto px-4 py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer flex items-center justify-center gap-2 text-xs"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      <span>Download Event Reimbursement Chart (CSV)</span>
                    </button>
                  </div>
                </div>
              );
            })()}

          </div>
        </div>
      )}

    </div>
  );
}
