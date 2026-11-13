'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  X,
  Search,
  Edit2,
  Trash2,
  ShieldAlert,
  Users,
  Building2,
  Phone,
  Mail,
  Globe,
  MapPin,
  Link2,
  StickyNote,
  ImagePlus,
  ImageOff,
  ExternalLink,
  Download,
  Upload,
  Sparkles,
  Loader2,
  FileText,
  CheckCircle2,
  Scan,
} from 'lucide-react';
import { Linkedin } from '@/components/ui/linkedin-icon';
import { getGuests, addGuest, updateGuest, deleteGuest, Guest, authHeaders } from '@/lib/local-data';
import { canAccessGuestDirectory, canEditGuestRecord, canRemoveGuestContact, isRestrictedGuestEditor, canViewGuestRecord } from '@/lib/permissions';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { FileDropzone, FilePreviewRow, createProgressTracker, useDropTarget } from '@/components/ui/file-dropzone';
import { parseCsvLine, splitCsvLines, toCsvRow, downloadCsv } from '@/lib/csv';

const MAX_CARD_SIZE = 10 * 1024 * 1024; // 10 MB

const emptyForm = {
  name: '',
  organization: '',
  designation: '',
  phone: '',
  telephone: '',
  email: '',
  website: '',
  address: '',
  linkedin: '',
  notes: '',
};

export default function GuestDirectoryPage() {
  const [user, setUser] = useState<any>(null);
  const [userHydrated, setUserHydrated] = useState(false);

  const [guests, setGuests] = useState<Guest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [form, setForm] = useState(emptyForm);

  const [frontCardFile, setFrontCardFile] = useState<File | null>(null);
  const [frontCardData, setFrontCardData] = useState('');
  const [frontCardError, setFrontCardError] = useState('');

  const [backCardFile, setBackCardFile] = useState<File | null>(null);
  const [backCardData, setBackCardData] = useState('');
  const [backCardError, setBackCardError] = useState('');

  const [isOcrScanning, setIsOcrScanning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [deletingGuest, setDeletingGuest] = useState<Guest | null>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const { isDragOver: isCsvDragOver, dragHandlers: csvDragHandlers } = useDropTarget((files) => handleCsvFile(files[0]));
  const [guestUploadProgress, setGuestUploadProgress] = useState(0);
  const [guestUploadEtaSeconds, setGuestUploadEtaSeconds] = useState<number | null>(null);

  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error(e);
      }
    }

    const refresh = () => setGuests(getGuests());
    refresh();
    setUserHydrated(true);

    window.addEventListener('leads-data-sync', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('leads-data-sync', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const triggerToast = (type: 'success' | 'error', text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => setToastMsg(null), 4000);
  };

  // Rows skipped during the last CSV import specifically because their email
  // already exists elsewhere — kept around (not auto-dismissed like the toast
  // above) so the user can download them, fix the email, and re-upload.
  const [emailConflicts, setEmailConflicts] = useState<{ name: string; organization: string; designation: string; phone: string; email: string; website: string; address: string; linkedin: string; notes: string; metBy: string }[]>([]);

  const resetForm = () => {
    setForm(emptyForm);
    setFrontCardFile(null);
    setFrontCardData('');
    setFrontCardError('');
    setBackCardFile(null);
    setBackCardData('');
    setBackCardError('');
    setIsOcrScanning(false);
    setOcrStatus(null);
    setEditingGuest(null);
    setGuestUploadProgress(0);
    setGuestUploadEtaSeconds(null);
  };

  const openAddModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (guest: Guest) => {
    setEditingGuest(guest);
    setForm({
      name: guest.name,
      organization: guest.organization || '',
      designation: guest.designation || '',
      phone: guest.phone || '',
      telephone: guest.telephone || '',
      email: guest.email || '',
      website: guest.website || '',
      address: guest.address || '',
      linkedin: guest.linkedin || '',
      notes: guest.notes || '',
    });
    setFrontCardFile(null);
    setFrontCardData('');
    setFrontCardError('');
    setBackCardFile(null);
    setBackCardData('');
    setBackCardError('');
    setIsOcrScanning(false);
    setOcrStatus(null);
    setIsModalOpen(true);
  };

  const compressCardImageFile = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
        return;
      }

      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxDim = 1200; // Optimal scaling dimension for instant upload & sharp OCR parsing
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.80));
        } else {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      };
      img.src = url;
    });
  };

  const handleFrontCardFiles = async (files: File[]) => {
    const selected = files[0];
    setFrontCardError('');
    if (!selected) {
      setFrontCardFile(null);
      setFrontCardData('');
      setOcrStatus(null);
      return;
    }
    setOcrStatus('⚡ Auto-scaling & optimizing card photo for OCR...');
    setFrontCardFile(selected);
    try {
      const compressedBase64 = await compressCardImageFile(selected);
      setFrontCardData(compressedBase64);
      runOcrScan(compressedBase64, backCardData);
    } catch {
      setFrontCardError('Failed to read and process image file.');
      setOcrStatus(null);
    }
  };

  const handleBackCardFiles = async (files: File[]) => {
    const selected = files[0];
    setBackCardError('');
    if (!selected) {
      setBackCardFile(null);
      setBackCardData('');
      setOcrStatus(null);
      return;
    }
    setOcrStatus('⚡ Auto-scaling & optimizing card photo for OCR...');
    setBackCardFile(selected);
    try {
      const compressedBase64 = await compressCardImageFile(selected);
      setBackCardData(compressedBase64);
      if (frontCardData) {
        runOcrScan(frontCardData, compressedBase64);
      }
    } catch {
      setBackCardError('Failed to read and process image file.');
      setOcrStatus(null);
    }
  };

  const runOcrScan = async (fData: string, bData?: string) => {
    if (!fData) {
      setFrontCardError('Front of card photograph is compulsory to run OCR scan.');
      return;
    }
    setIsOcrScanning(true);
    setOcrStatus('Scanning visiting card with OCR...');
    try {
      const res = await fetch('/api/guests/ocr', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ frontData: fData, backData: bData || undefined }),
      });

      const responseText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(
          res.status === 413
            ? 'Card image file is too large for the server proxy. Please try a smaller photo or PDF.'
            : 'Server returned an invalid response (connection timed out or server proxy error).'
        );
      }

      if (!res.ok) throw new Error(data.error || 'Failed to scan card');

      setForm((prev) => ({
        name: data.name || prev.name,
        organization: data.organization || prev.organization,
        designation: data.designation || prev.designation,
        phone: data.phone || prev.phone,
        telephone: data.telephone || prev.telephone,
        email: data.email || prev.email,
        website: data.website || prev.website,
        address: data.address || prev.address,
        linkedin: data.linkedin || prev.linkedin,
        notes: data.notes
          ? prev.notes
            ? `${prev.notes}\n\n${data.notes}`
            : data.notes
          : prev.notes,
      }));

      setOcrStatus('✨ Card scanned successfully! Details auto-filled into form below (you can edit or override any field).');
    } catch (err: any) {
      setOcrStatus(`⚠️ OCR Notice: ${err.message || 'Could not parse card automatically. Please fill in details manually.'}`);
    } finally {
      setIsOcrScanning(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    // Front card is compulsory if back card is uploaded without existing front card
    if (backCardData && !frontCardData && !editingGuest?.visitingCardFrontUrl && !editingGuest?.visitingCardUrl) {
      setFrontCardError('Front of the card photograph is compulsory when uploading card photos.');
      return;
    }

    setIsSaving(true);

    const payload: any = {
      name: form.name.trim(),
      organization: form.organization.trim() || undefined,
      designation: form.designation.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      website: form.website.trim() || undefined,
      address: form.address.trim() || undefined,
      linkedin: form.linkedin.trim() || undefined,
      notes: form.notes.trim() || undefined,
      metBy: editingGuest?.metBy || user?.name || 'Unknown',
    };

    if (frontCardData) {
      payload.visitingCardFrontData = frontCardData;
      payload.visitingCardFrontFileName = frontCardFile?.name || 'card_front.jpg';
      payload.visitingCardData = frontCardData;
      payload.visitingCardFileName = frontCardFile?.name || 'card_front.jpg';
    }

    if (backCardData) {
      payload.visitingCardBackData = backCardData;
      payload.visitingCardBackFileName = backCardFile?.name || 'card_back.jpg';
    }

    setGuestUploadProgress(0);
    setGuestUploadEtaSeconds(null);
    const tracker = createProgressTracker((pct, eta) => { setGuestUploadProgress(pct); setGuestUploadEtaSeconds(eta); });

    try {
      if (editingGuest) {
        // A restricted (non-admin) editor spends their one-time edit the
        // moment they save — see permissions.ts's canEditGuestRecord.
        if (isRestrictedGuestEditor(user)) {
          payload.selfEditUsedAt = new Date().toISOString();
        }
        await updateGuest(editingGuest.id, payload, user?.name || 'Admin', tracker);
        triggerToast('success', `Updated guest record for ${payload.name}.`);
      } else {
        payload.createdBy = user?.email;
        await addGuest(payload, user?.name || 'Admin', tracker);
        triggerToast('success', `Added ${payload.name} to the Guest Directory.`);
      }
      setGuests(getGuests());
      setIsModalOpen(false);
      resetForm();
    } catch (err: any) {
      // Deliberately doesn't close the modal or clear the card files — a
      // failed save keeps everything staged so the user can just hit Save again.
      triggerToast('error', err.message || 'Failed to save guest.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = () => {
    if (!deletingGuest) return;
    try {
      deleteGuest(deletingGuest.id, user?.name || 'Admin');
      setGuests(getGuests());
      triggerToast('success', `Removed ${deletingGuest.name} from the Guest Directory.`);
    } catch (err: any) {
      triggerToast('error', err.message || 'Failed to remove guest.');
    } finally {
      setDeletingGuest(null);
    }
  };

  const handleDownloadTemplate = () => {
    const csvContent = 'Name,Organization,Designation,Phone,Email,Website,Address,LinkedIn,Notes,Met By\n' +
      'Anjali Rao,Acme Corp,Marketing Director,+91 98765 43210,anjali.rao@acmecorp.com,acmecorp.com,"123 MG Road, Bangalore, KA 560001",linkedin.com/in/anjalirao,Interested in sponsoring the annual summit,Kayomarz Pavri\n' +
      'Rahul Mehta,,,+91 99999 11111,rahul.mehta@example.com,,,,,';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'leads_guest_directory_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const visibleGuests = guests.filter(g => canViewGuestRecord(g, user));

  const handleDownloadFullBackup = () => {
    const header = toCsvRow(['Name', 'Organization', 'Designation', 'Phone', 'Email', 'Website', 'Address', 'LinkedIn', 'Notes', 'Met By']);
    const rows = visibleGuests.map(g => toCsvRow([g.name, g.organization, g.designation, g.phone, g.email, g.website, g.address, g.linkedin, g.notes, g.metBy]));
    downloadCsv(`leads_guest_directory_backup_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows].join('\n'));
    triggerToast('success', `Downloaded a backup of ${visibleGuests.length} guest records.`);
  };

  const handleDownloadEmailConflicts = () => {
    const header = toCsvRow(['Name', 'Organization', 'Designation', 'Phone', 'Email', 'Website', 'Address', 'LinkedIn', 'Notes', 'Met By', 'Conflict Reason']);
    const rows = emailConflicts.map(c => toCsvRow([c.name, c.organization, c.designation, c.phone, c.email, c.website, c.address, c.linkedin, c.notes, c.metBy, 'Email already exists in the guest directory']));
    downloadCsv(`leads_guest_directory_email_conflicts_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows].join('\n'));
  };

  const handleCsvUploadClick = () => {
    csvFileInputRef.current?.click();
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleCsvFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleCsvFile = (file: File | undefined) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      try {
        const lines = splitCsvLines(text);
        if (lines.length < 2) {
          triggerToast('error', 'CSV file is empty or missing headers.');
          return;
        }

        const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase());
        const nameIndex = headers.indexOf('name');
        const orgIndex = headers.indexOf('organization');
        const designationIndex = headers.indexOf('designation');
        const phoneIndex = headers.indexOf('phone');
        const emailIndex = headers.indexOf('email');
        const websiteIndex = headers.indexOf('website');
        const addressIndex = headers.indexOf('address');
        const linkedinIndex = headers.indexOf('linkedin');
        const notesIndex = headers.indexOf('notes');
        const metByIndex = headers.indexOf('met by');

        if (nameIndex === -1) {
          triggerToast('error', 'Invalid CSV headers. Required at minimum: Name');
          return;
        }

        // Guests don't require a unique email, but skip within-file/roster
        // duplicates when an email IS present, same spirit as the member import.
        const seenEmails = new Set(
          getGuests().map(g => g.email?.toLowerCase()).filter((email): email is string => Boolean(email))
        );
        let importCount = 0;
        let skippedCount = 0;
        const conflicts: typeof emailConflicts = [];

        for (let i = 1; i < lines.length; i++) {
          const values = parseCsvLine(lines[i]);
          const gName = values[nameIndex];
          if (!gName) {
            skippedCount++;
            continue;
          }

          const rowFields = {
            name: gName,
            organization: (orgIndex !== -1 ? values[orgIndex] : '') || '',
            designation: (designationIndex !== -1 ? values[designationIndex] : '') || '',
            phone: (phoneIndex !== -1 ? values[phoneIndex] : '') || '',
            email: emailIndex !== -1 ? values[emailIndex] || '' : '',
            website: (websiteIndex !== -1 ? values[websiteIndex] : '') || '',
            address: (addressIndex !== -1 ? values[addressIndex] : '') || '',
            linkedin: (linkedinIndex !== -1 ? values[linkedinIndex] : '') || '',
            notes: (notesIndex !== -1 ? values[notesIndex] : '') || '',
            metBy: (metByIndex !== -1 ? values[metByIndex] : '') || user?.name || 'Unknown',
          };

          const gEmail = rowFields.email.toLowerCase();
          if (gEmail && seenEmails.has(gEmail)) {
            skippedCount++;
            conflicts.push(rowFields);
            continue;
          }

          // Awaited (and caught) per row — addGuest now reaches the server
          // before it resolves, so a row that genuinely fails to save is
          // counted as skipped instead of silently reported as imported.
          try {
            await addGuest({
              name: rowFields.name,
              organization: rowFields.organization || undefined,
              designation: rowFields.designation || undefined,
              phone: rowFields.phone || undefined,
              email: gEmail || undefined,
              website: rowFields.website || undefined,
              address: rowFields.address || undefined,
              linkedin: rowFields.linkedin || undefined,
              notes: rowFields.notes || undefined,
              metBy: rowFields.metBy,
              createdBy: user?.email,
            }, user?.name || 'Admin');

            if (gEmail) seenEmails.add(gEmail);
            importCount++;
          } catch {
            skippedCount++;
            if (gEmail) conflicts.push(rowFields);
          }
        }

        setEmailConflicts(conflicts);

        if (importCount > 0) {
          setGuests(getGuests());
          triggerToast('success', `Successfully imported ${importCount} guest${importCount === 1 ? '' : 's'}.${skippedCount > 0 ? ` (${skippedCount} row${skippedCount === 1 ? '' : 's'} skipped)` : ''}`);
        } else {
          triggerToast('error', skippedCount > 0 ? `No new guests imported. ${skippedCount} row(s) skipped (missing name or duplicate email — see below).` : 'No valid guest rows found in the CSV.');
        }
      } catch {
        triggerToast('error', 'Error parsing CSV file. Please verify formatting.');
      }
    };
    reader.readAsText(file);
  };

  const filteredGuests = visibleGuests.filter(g => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (
      g.name.toLowerCase().includes(q) ||
      (g.organization || '').toLowerCase().includes(q) ||
      (g.designation || '').toLowerCase().includes(q) ||
      (g.email || '').toLowerCase().includes(q) ||
      (g.website || '').toLowerCase().includes(q) ||
      (g.metBy || '').toLowerCase().includes(q)
    );
  });

  if (!userHydrated) return null;

  if (!canAccessGuestDirectory(user)) {
    return (
      <div className="p-6 md:p-8">
        <EmptyState
          icon={ShieldAlert}
          title="Access Restricted"
          description="The Guest Directory is available to the Centre Head and Faculty members only."
        />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary">Guest Directory</h1>
          <p className="text-xs text-theme-text-secondary">Guests, sponsors, and visitors met at events — sourced from visiting cards. Separate from the Member roster and Mail Merge tool.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleDownloadFullBackup}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer border border-theme-border/40"
            title="Download a full CSV backup of every guest in the directory"
          >
            <Download className="h-4 w-4" />
            Download Backup (CSV)
          </button>

          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer border border-theme-border/40"
            title="Download CSV Template"
          >
            <Download className="h-4 w-4" />
            Download Template
          </button>

          <button
            onClick={handleCsvUploadClick}
            {...csvDragHandlers}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer border ${
              isCsvDragOver
                ? 'border-accent bg-accent/10 shadow-md shadow-accent/20 ring-2 ring-accent/20 text-accent'
                : 'border-theme-border/40 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary'
            }`}
            title="Upload Filled CSV File — click or drag and drop"
          >
            <Upload className="h-4 w-4" />
            {isCsvDragOver ? 'Drop CSV here' : 'Upload Guests (CSV)'}
          </button>
          <input
            type="file"
            ref={csvFileInputRef}
            onChange={handleCsvFileUpload}
            accept=".csv,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,text/plain"
            className="hidden"
          />

          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer shrink-0"
          >
            <Plus className="h-4 w-4" />
            Add Guest
          </button>
        </div>
      </div>

      {toastMsg && (
        <div className={`flex items-center gap-3 p-4 rounded-2xl text-xs animate-in fade-in duration-300 ${
          toastMsg.type === 'success' ? 'bg-success/15 border border-success/20 text-theme-text-primary' : 'bg-danger/15 border border-danger/20 text-theme-text-primary'
        }`}>
          <span>{toastMsg.text}</span>
        </div>
      )}

      {emailConflicts.length > 0 && (
        <div className="flex items-start sm:items-center justify-between gap-3 p-4 bg-warning/15 border border-warning/30 rounded-2xl text-xs animate-in fade-in duration-300 flex-col sm:flex-row">
          <div className="flex items-start sm:items-center gap-3">
            <Mail className="h-5 w-5 text-warning shrink-0" />
            <span className="text-theme-text-primary">
              {emailConflicts.length} row{emailConflicts.length === 1 ? '' : 's'} skipped during the last import — the email address already exists in the guest directory.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDownloadEmailConflicts}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-warning/20 hover:bg-warning/30 text-warning text-xs font-semibold rounded-xl transition-all cursor-pointer border border-warning/40"
            >
              <Download className="h-3.5 w-3.5" />
              Download Conflict Report
            </button>
            <button
              onClick={() => setEmailConflicts([])}
              className="p-1.5 text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-border/20 rounded-lg transition-all cursor-pointer"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="glass-panel rounded-2xl p-4 flex items-center gap-3">
        <Search className="h-4.5 w-4.5 text-theme-text-secondary shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by name, organization, designation, email, or met by..."
          className="w-full bg-transparent border-0 focus:outline-none focus:ring-0 text-xs text-theme-text-primary placeholder-theme-text-secondary"
        />
        <span className="text-xs font-semibold text-theme-text-primary shrink-0">{filteredGuests.length} guest{filteredGuests.length === 1 ? '' : 's'}</span>
      </div>

      {filteredGuests.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No guests found"
          description={guests.length === 0 ? 'Add the first guest to start building the directory.' : 'No guests match your search.'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredGuests.map(guest => (
            <div key={guest.id} className="glass-panel rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-theme-text-primary leading-snug break-words">{guest.name}</h3>
                  {guest.designation && <p className="text-[11px] font-medium text-theme-text-secondary leading-normal break-words mt-0.5">{guest.designation}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canEditGuestRecord(guest, user) && (
                    <button
                      onClick={() => openEditModal(guest)}
                      className="p-1.5 text-theme-text-secondary hover:text-accent hover:bg-theme-border/20 rounded-lg transition-all cursor-pointer"
                      title={
                        isRestrictedGuestEditor(user)
                          ? 'Edit Guest — one-time correction window, within 24 hours of adding this record'
                          : 'Edit Guest'
                      }
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {canRemoveGuestContact(user) && (
                    <button
                      onClick={() => setDeletingGuest(guest)}
                      className="p-1.5 text-danger hover:bg-danger/10 rounded-lg transition-all cursor-pointer"
                      title="Remove Guest"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5 text-[11px] text-theme-text-secondary">
                {guest.organization && (
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-3 w-3 shrink-0" />
                    <span className="truncate">{guest.organization}</span>
                  </div>
                )}
                {guest.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="h-3 w-3 shrink-0" />
                    <span className="truncate">{guest.phone}</span>
                  </div>
                )}
                {guest.email && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-3 w-3 shrink-0" />
                    <span className="truncate">{guest.email}</span>
                  </div>
                )}
                {guest.website && (
                  <div className="flex items-center gap-1.5">
                    <Globe className="h-3 w-3 shrink-0" />
                    <a
                      href={/^https?:\/\//i.test(guest.website) ? guest.website : `https://${guest.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="truncate hover:text-accent hover:underline"
                    >
                      {guest.website}
                    </a>
                  </div>
                )}
                {guest.linkedin && (
                  <div className="flex items-center gap-1.5">
                    <Linkedin className="h-3 w-3 shrink-0" />
                    <a
                      href={/^https?:\/\//i.test(guest.linkedin) ? guest.linkedin : `https://${guest.linkedin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="truncate hover:text-accent hover:underline"
                    >
                      {guest.linkedin}
                    </a>
                  </div>
                )}
                {guest.address && (
                  <div className="flex items-start gap-1.5">
                    <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{guest.address}</span>
                  </div>
                )}
                {guest.metBy && (
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3 w-3 shrink-0" />
                    <span>Met by {guest.metBy}</span>
                  </div>
                )}
                {guest.notes && (
                  <div className="flex items-start gap-1.5 pt-1">
                    <StickyNote className="h-3 w-3 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{guest.notes}</span>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-theme-border/20 flex flex-wrap items-center gap-3">
                {(guest.visitingCardFrontUrl || guest.visitingCardUrl) ? (() => {
                  const url = guest.visitingCardFrontUrl || guest.visitingCardUrl || '';
                  const isPdf = url.toLowerCase().includes('.pdf');
                  return (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-accent hover:underline"
                    >
                      {isPdf ? <FileText className="h-3.5 w-3.5 text-danger" /> : <ExternalLink className="h-3 w-3" />}
                      {isPdf ? 'Front Card (PDF)' : 'Front Card'}
                    </a>
                  );
                })() : (
                  <span className="flex items-center gap-1.5 text-[11px] text-theme-text-secondary/70">
                    <ImageOff className="h-3 w-3" />
                    No card photo on file
                  </span>
                )}
                {guest.visitingCardBackUrl && (() => {
                  const isPdf = guest.visitingCardBackUrl.toLowerCase().includes('.pdf');
                  return (
                    <a
                      href={guest.visitingCardBackUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-accent hover:underline"
                    >
                      {isPdf ? <FileText className="h-3.5 w-3.5 text-danger" /> : <ExternalLink className="h-3 w-3" />}
                      {isPdf ? 'Back Card (PDF)' : 'Back Card'}
                    </a>
                  );
                })()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-lg rounded-3xl p-6 flex flex-col space-y-5 relative border border-white/15 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-theme-text-primary">{editingGuest ? 'Edit Guest' : 'Add Guest to Directory'}</h2>
              <button
                onClick={() => { setIsModalOpen(false); resetForm(); }}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Full Name *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Anjali Rao"
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Organization</label>
                  <input
                    type="text"
                    value={form.organization}
                    onChange={e => setForm(f => ({ ...f, organization: e.target.value }))}
                    placeholder="e.g. Acme Corp"
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Designation</label>
                  <input
                    type="text"
                    value={form.designation}
                    onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}
                    placeholder="e.g. Marketing Director"
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Phone (Mobile)</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+91 98765 43210"
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Telephone (Landline)</label>
                  <input
                    type="text"
                    value={form.telephone}
                    onChange={e => setForm(f => ({ ...f, telephone: e.target.value }))}
                    placeholder="080-23608000"
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="guest@example.com"
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Company Website</label>
                  <input
                    type="text"
                    value={form.website}
                    onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                    placeholder="e.g. acmecorp.com"
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">LinkedIn</label>
                  <input
                    type="text"
                    value={form.linkedin}
                    onChange={e => setForm(f => ({ ...f, linkedin: e.target.value }))}
                    placeholder="linkedin.com/in/..."
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Address</label>
                <textarea
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="Office / mailing address"
                  rows={2}
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Context on how/where you met, follow-up items, etc."
                  rows={3}
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              {/* Visiting Card Photographs & OCR Auto-Fill Option */}
              <div className="p-4 bg-theme-border/15 rounded-2xl border border-theme-border/30 space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-theme-text-primary flex items-center gap-1.5 text-xs">
                    <ImagePlus className="h-4 w-4 text-accent" />
                    Visiting Card Photographs & OCR Auto-Fill
                  </span>
                  <span className="text-[10px] text-accent font-medium px-2 py-0.5 bg-accent/10 rounded-full flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    Auto-Fill Enabled
                  </span>
                </div>
                <p className="text-[11px] text-theme-text-secondary leading-snug">
                  Uploading card photographs or PDF files automatically runs OCR to extract and fill in all guest details below. Front of card is compulsory when uploading a card, while back of card is optional. All fields remain subject to manual override.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Front of Card — COMPULSORY */}
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-theme-text-secondary">
                      Front of Card (Image/PDF) <span className="text-danger font-bold">* (Compulsory)</span>
                    </label>
                    <FileDropzone
                      onFilesSelected={handleFrontCardFiles}
                      accept="image/*,application/pdf"
                      label="Click or drag card photo here"
                      capture="environment"
                      compact
                    />
                    {frontCardFile && (
                      <FilePreviewRow file={frontCardFile} onRemove={() => handleFrontCardFiles([])} />
                    )}
                    {frontCardError && <p className="text-danger text-[11px] font-medium">{frontCardError}</p>}
                    {(editingGuest?.visitingCardFrontUrl || editingGuest?.visitingCardUrl) && !frontCardData && (
                      <p className="text-[10px] text-theme-text-secondary">Front card on file. Choose new image or PDF to replace.</p>
                    )}
                  </div>

                  {/* Back of Card — OPTIONAL */}
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-theme-text-secondary">
                      Back of Card (Image/PDF) <span className="text-theme-text-secondary/70 font-normal">(Optional)</span>
                    </label>
                    <FileDropzone
                      onFilesSelected={handleBackCardFiles}
                      accept="image/*,application/pdf"
                      label="Click or drag card photo here"
                      capture="environment"
                      compact
                    />
                    {backCardFile && (
                      <FilePreviewRow file={backCardFile} onRemove={() => handleBackCardFiles([])} />
                    )}
                    {backCardError && <p className="text-danger text-[11px] font-medium">{backCardError}</p>}
                    {editingGuest?.visitingCardBackUrl && !backCardData && (
                      <p className="text-[10px] text-theme-text-secondary">Back card on file. Choose new image or PDF to replace.</p>
                    )}
                  </div>
                </div>

                {/* OCR Scan Status Indicator */}
                {isOcrScanning && (
                  <div className="flex items-center gap-2 text-[11px] text-accent font-medium p-2.5 bg-accent/10 rounded-xl animate-pulse">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Scanning card with OCR & extracting guest details...</span>
                  </div>
                )}

                {ocrStatus && !isOcrScanning && (
                  <div className={`flex items-start gap-2 text-[11px] p-2.5 rounded-xl border ${
                    ocrStatus.includes('✨') || ocrStatus.includes('successfully')
                      ? 'bg-success/10 border-success/20 text-success'
                      : 'bg-warning/10 border-warning/20 text-theme-text-primary'
                  }`}>
                    {ocrStatus.includes('✨') ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    ) : (
                      <Scan className="h-4 w-4 shrink-0 mt-0.5" />
                    )}
                    <span className="leading-snug">{ocrStatus}</span>
                  </div>
                )}
              </div>

              {isSaving && (frontCardFile || backCardFile) && (
                <div className="space-y-0.5">
                  <div className="h-1.5 rounded-full bg-theme-border/30 overflow-hidden">
                    <div className="h-full bg-accent rounded-full transition-all duration-200" style={{ width: `${guestUploadProgress}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-theme-text-secondary">
                    <span>Uploading... {guestUploadProgress}%</span>
                    {guestUploadEtaSeconds !== null && <span>{guestUploadEtaSeconds <= 0 ? 'almost done' : `${Math.ceil(guestUploadEtaSeconds)}s left`}</span>}
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isSaving}
                className="w-full py-3 bg-accent hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer mt-4"
              >
                {isSaving ? 'Saving...' : editingGuest ? 'Save Changes' : 'Add Guest'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingGuest)}
        title="Remove Guest from Directory"
        message={`Are you sure you want to remove ${deletingGuest?.name} from the Guest Directory? This cannot be undone.`}
        confirmLabel="Remove Guest"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingGuest(null)}
      />
    </div>
  );
}
