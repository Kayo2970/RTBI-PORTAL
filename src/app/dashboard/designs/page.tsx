'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Palette,
  UploadCloud,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  MessageSquare,
  Trash2,
  Eye,
  ShieldAlert,
  UserCheck,
  Calendar,
  FileCheck,
  Search,
  X,
  Send,
  Lock,
  Download,
  Sparkles,
  CheckSquare,
  Star,
  Plus,
  Edit2,
  RefreshCw,
  GraduationCap,
  Check,
  ExternalLink,
  Link2,
  Pencil
} from 'lucide-react';
import { FileDropzone, FilePreviewRow, createProgressTracker } from '@/components/ui/file-dropzone';
import { RequestApprovalModal } from '@/components/request-approval-modal';
import { SearchableSelect } from '@/components/searchable-select';
import {
  getDesigns,
  addDesign,
  updateDesignStyleReview,
  updateDesignFile,
  deleteDesign,
  getMembers,
  getEvents,
  isApprovedEvent,
  addEvent,
  getTasks,
  updateTask,
  isTaskAssignee,
  DesignSubmissionItem,
  Member,
  EventItem,
  TaskItem,
  authHeaders
} from '@/lib/local-data';
import { canViewAllDesigns, isCentreHead, canManageCanvaLibrary, hasCapability } from '@/lib/permissions';
import { parseCsvLine, splitCsvLines, toCsvRow, downloadCsv } from '@/lib/csv';

export default function DesignPortalPage() {
  const [designs, setDesigns] = useState<DesignSubmissionItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [user, setUser] = useState<any>(null);
  const canReviewDesign = !!user && (isCentreHead(user) || hasCapability(user, 'DESIGN_STYLE_APPROVE'));

  // Filter & Search states
  const [activeTab, setActiveTab] = useState<'all' | 'mine' | 'review' | 'expired' | 'canva'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Canva Link Library (Design Head / Centre Head / Advisor / Super User only
  // — see canManageCanvaLibrary in permissions.ts): a standalone directory of
  // every design-brief task's Canva reference link, editable here and kept in
  // sync with the Tasks module because both read/write the same
  // TaskItem.canvaLink field via updateTask/getTasks.
  const [canvaSearchQuery, setCanvaSearchQuery] = useState<string>('');
  const [editingCanvaTaskId, setEditingCanvaTaskId] = useState<string>('');
  const [editingCanvaValue, setEditingCanvaValue] = useState<string>('');
  const [canvaImportSummary, setCanvaImportSummary] = useState<string>('');
  const canvaCsvInputRef = useRef<HTMLInputElement>(null);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [selectedDesign, setSelectedDesign] = useState<DesignSubmissionItem | null>(null);
  const [approvalRequestDesign, setApprovalRequestDesign] = useState<DesignSubmissionItem | null>(null);
  const [approvalRequestSuccessMsg, setApprovalRequestSuccessMsg] = useState('');
  const [showInspectorModal, setShowInspectorModal] = useState<boolean>(false);

  // Quick Event Creation Modal state
  const [showQuickEventModal, setShowQuickEventModal] = useState<boolean>(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [newEventStartDate, setNewEventStartDate] = useState('');
  const [newEventEndDate, setNewEventEndDate] = useState('');
  const [newEventDatesTBD, setNewEventDatesTBD] = useState(false);
  const [newEventLocation, setNewEventLocation] = useState('');
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [quickEventError, setQuickEventError] = useState('');

  const handleQuickEventSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventTitle.trim()) {
      setQuickEventError('Event title is required.');
      return;
    }
    setIsCreatingEvent(true);
    try {
      const created = addEvent({
        title: newEventTitle.trim(),
        description: newEventDesc.trim(),
        startDate: newEventDatesTBD ? '' : newEventStartDate,
        endDate: newEventDatesTBD ? '' : newEventEndDate,
        datesTBD: newEventDatesTBD,
        location: newEventLocation.trim() || undefined,
        status: 'planned',
        createdBy: user?.name || 'User',
      });

      // Refresh local events & automatically select the new event
      const updatedEvents = getEvents();
      setEvents(updatedEvents);
      setEventId(created.id);

      // Reset and close quick event modal
      setNewEventTitle('');
      setNewEventDesc('');
      setNewEventStartDate('');
      setNewEventEndDate('');
      setNewEventDatesTBD(false);
      setNewEventLocation('');
      setQuickEventError('');
      setShowQuickEventModal(false);
    } catch (err: any) {
      setQuickEventError(err?.message || 'Failed to create event.');
    } finally {
      setIsCreatingEvent(false);
    }
  };

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<DesignSubmissionItem['category']>('Poster');
  const [eventId, setEventId] = useState('');
  // Set when this submission is fulfilling a design-brief Task from the
  // "Design Task Requests" queue below, rather than an ad-hoc upload — see
  // handleOpenSubmitForTask.
  const [sourceTaskId, setSourceTaskId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<string>('');
  const [fileError, setFileError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // Reading the file into base64 happens asynchronously (FileReader), separately
  // from the "Uploading..." server round-trip — both get their own progress state
  // so a large file doesn't look "attached and ready" before it actually is.
  const [isReadingFile, setIsReadingFile] = useState<boolean>(false);
  const [readProgress, setReadProgress] = useState<number>(0);
  const [submitError, setSubmitError] = useState<string>('');
  // Real percent + time-remaining for the actual server upload, driven by
  // addDesign()'s onProgress callback — replaces the old indeterminate bar,
  // which could only say "something is happening," never how long it'd take.
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadEtaSeconds, setUploadEtaSeconds] = useState<number | null>(null);

  // Review form state inside Inspector Modal
  const [styleStatus, setStyleStatus] = useState<'Style Approved' | 'Style Rejected'>('Style Approved');
  const [styleFeedback, setStyleFeedback] = useState('');

  // Replace File form state inside Inspector Modal (design owner only)
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replaceFileData, setReplaceFileData] = useState<string>('');
  const [replaceFileError, setReplaceFileError] = useState<string>('');
  const [isReplacingFile, setIsReplacingFile] = useState<boolean>(false);
  const [isReadingReplaceFile, setIsReadingReplaceFile] = useState<boolean>(false);
  const [replaceReadProgress, setReplaceReadProgress] = useState<number>(0);
  const [replaceUploadProgress, setReplaceUploadProgress] = useState<number>(0);
  const [replaceUploadEtaSeconds, setReplaceUploadEtaSeconds] = useState<number | null>(null);

  // Deep link from a notification (?highlight=<designId>) — auto-open its Inspector once
  const [highlightDesignId, setHighlightDesignId] = useState<string | null>(null);
  const [hasOpenedHighlight, setHasOpenedHighlight] = useState(false);

  // Inspector modal tabs: Overview / Review.
  type InspectorTab = 'overview' | 'style';
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');

  const openInspector = (design: DesignSubmissionItem) => {
    setSelectedDesign(design);
    setStyleFeedback(design.styleFeedback || '');
    setStyleStatus(design.styleStatus === 'Style Rejected' ? 'Style Rejected' : 'Style Approved');
    setInspectorTab('overview');
    setShowInspectorModal(true);
  };

  const handleSaveStyleReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDesign || !user) return;
    const updated = updateDesignStyleReview(selectedDesign.id, styleStatus, styleFeedback, user.name);
    if (updated) {
      setSelectedDesign(updated);
      setDesigns(getDesigns());
    }
  };

  const handleReplaceFile = (selected: File | undefined) => {
    setReplaceFileError('');
    if (!selected) {
      setReplaceFile(null);
      setReplaceFileData('');
      return;
    }

    const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
    if (selected.size > MAX_SIZE) {
      setReplaceFileError(`File size (${(selected.size / (1024 * 1024)).toFixed(2)} MB) exceeds the 25 MB maximum limit.`);
      setReplaceFile(null);
      setReplaceFileData('');
      return;
    }

    setReplaceFile(selected);
    setReplaceFileData('');
    setIsReadingReplaceFile(true);
    setReplaceReadProgress(0);
    setReplaceUploadProgress(0);
    setReplaceUploadEtaSeconds(null);
    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (ev.lengthComputable) setReplaceReadProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    reader.onload = () => {
      if (typeof reader.result === 'string') setReplaceFileData(reader.result);
      setIsReadingReplaceFile(false);
      setReplaceReadProgress(100);
    };
    reader.onerror = () => {
      setReplaceFileError('Could not read that file. Please try selecting it again.');
      setReplaceFile(null);
      setReplaceFileData('');
      setIsReadingReplaceFile(false);
    };
    reader.readAsDataURL(selected);
  };

  const handleReplaceFileSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedDesign || !user) return;
    if (isReadingReplaceFile) {
      setReplaceFileError('Still preparing the file — please wait a moment and try again.');
      return;
    }
    if (!replaceFile || !replaceFileData.startsWith('data:')) {
      setReplaceFileError('Select a replacement file first.');
      return;
    }

    setIsReplacingFile(true);
    setReplaceFileError('');
    setReplaceUploadProgress(0);
    setReplaceUploadEtaSeconds(null);
    try {
      const tracker = createProgressTracker((pct, eta) => { setReplaceUploadProgress(pct); setReplaceUploadEtaSeconds(eta); });
      const updated = await updateDesignFile(
        selectedDesign.id,
        replaceFileData,
        replaceFile.name,
        replaceFile.size,
        replaceFile.type || 'application/octet-stream',
        user.name,
        tracker
      );
      if (updated) {
        setSelectedDesign(updated);
        setDesigns(getDesigns());
        setReplaceFile(null);
        setReplaceFileData('');
        setReplaceUploadProgress(0);
        setReplaceUploadEtaSeconds(null);
      }
    } catch (err: any) {
      setReplaceFileError(err.message || 'Failed to replace file.');
    } finally {
      setIsReplacingFile(false);
    }
  };

  const refreshData = () => {
    setDesigns(getDesigns());
    setMembers(getMembers());
    setEvents(getEvents());
    setTasks(getTasks());
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error(e);
      }
    }
    refreshData();

    const params = new URLSearchParams(window.location.search);
    setHighlightDesignId(params.get('highlight'));

    const handleSync = () => refreshData();
    window.addEventListener('rtbi-data-sync', handleSync);
    return () => window.removeEventListener('rtbi-data-sync', handleSync);
  }, []);

  // Once the highlighted design has actually loaded, open its Inspector — retries on
  // every refresh until found, since it may not exist locally yet on first paint.
  useEffect(() => {
    if (!highlightDesignId || hasOpenedHighlight) return;
    const match = designs.find(d => d.id === highlightDesignId);
    if (match) {
      openInspector(match);
      setHasOpenedHighlight(true);
    }
  }, [designs, highlightDesignId, hasOpenedHighlight]);

  // Handle file selection (from either the dropzone's click-browse or an
  // actual drag-and-drop) with a 25 MB limit check
  const handleFile = (selected: File | undefined) => {
    setFileError('');
    if (!selected) {
      setFile(null);
      setFileData('');
      return;
    }

    const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
    if (selected.size > MAX_SIZE) {
      setFileError(`File size (${(selected.size / (1024 * 1024)).toFixed(2)} MB) exceeds the 25 MB maximum limit.`);
      setFile(null);
      setFileData('');
      return;
    }

    setFile(selected);
    setFileData('');
    setIsReadingFile(true);
    setReadProgress(0);
    setSubmitError('');
    setUploadProgress(0);
    setUploadEtaSeconds(null);

    // Convert file to base64 DataURL for storage & preview. This can take a
    // moment for a large PNG/PDF, so it's tracked as its own progress step —
    // submitting before it finishes used to silently create a design with no
    // file attached, since fileData was still the empty string at that point.
    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (ev.lengthComputable) setReadProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setFileData(reader.result);
      }
      setIsReadingFile(false);
      setReadProgress(100);
    };
    reader.onerror = () => {
      setFileError('Could not read that file. Please try selecting it again.');
      setFile(null);
      setFileData('');
      setIsReadingFile(false);
    };
    reader.readAsDataURL(selected);
  };

  const handleUploadSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return;
    if (!file) {
      setFileError('Please select a design asset to upload.');
      return;
    }
    if (isReadingFile) {
      setFileError('Still preparing the file — please wait a moment and try again.');
      return;
    }
    if (!fileData.startsWith('data:')) {
      setFileError('The file did not load correctly. Please re-select it and try again.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    setUploadProgress(0);
    setUploadEtaSeconds(null);
    try {
      const selectedEvent = events.find(ev => ev.id === eventId);
      const tracker = createProgressTracker((pct, eta) => { setUploadProgress(pct); setUploadEtaSeconds(eta); });

      await addDesign({
        title: title.trim(),
        description: description.trim(),
        category,
        fileData,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
        designerId: user?.id || 'guest',
        designerName: user?.name || 'Designer',
        designerEmail: user?.email || 'designer@example.com',
        eventId: selectedEvent?.id,
        eventName: selectedEvent?.title,
        sourceTaskId: sourceTaskId || undefined,
      }, tracker);

      refreshData();
      setShowUploadModal(false);

      // Reset form
      setTitle('');
      setDescription('');
      setCategory('Poster');
      setEventId('');
      setSourceTaskId('');
      setFile(null);
      setFileData('');
      setFileError('');
      setUploadProgress(0);
      setUploadEtaSeconds(null);
    } catch (err: any) {
      // Deliberately doesn't close the modal or reset the form on failure —
      // the file is still selected, so the designer can just hit Submit again.
      setSubmitError(err.message || 'Failed to submit design.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Opens the submission modal pre-filled to fulfill a design-brief Task
  // from the "Design Task Requests" queue — carries sourceTaskId through so
  // addDesign() links this submission back to that task (see local-data.ts's
  // addDesign/syncDesignTask for the completion cascade on approval).
  const handleOpenSubmitForTask = (task: TaskItem) => {
    setSubmitError('');
    setTitle(task.title.replace(/^\[.*?\]\s*/, ''));
    setDescription(task.briefDescription || '');
    setCategory(task.designCategory || 'Poster');
    setEventId(task.eventId || '');
    setSourceTaskId(task.id);
    setFile(null);
    setFileData('');
    setFileError('');
    setShowUploadModal(true);
  };

  // Auto-redirect handling when arriving from a Task card in the Tasks module
  const [hasHandledTaskRedirect, setHasHandledTaskRedirect] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || hasHandledTaskRedirect) return;
    const params = new URLSearchParams(window.location.search);
    const targetTaskId = params.get('sourceTaskId') || params.get('taskId');
    if (!targetTaskId) return;

    if (designs.length > 0 || tasks.length > 0) {
      const matchingTask = tasks.find(t => t.id === targetTaskId);
      const matchingDesign = designs.find(d =>
        d.sourceTaskId === targetTaskId ||
        d.linkedTaskId === targetTaskId ||
        (matchingTask?.eventId && d.eventId === matchingTask.eventId)
      );
      if (matchingDesign) {
        openInspector(matchingDesign);
        setHasHandledTaskRedirect(true);
        return;
      }
      if (matchingTask) {
        if (matchingTask.status === 'Completed') {
          setHasHandledTaskRedirect(true);
          return;
        }
        handleOpenSubmitForTask(matchingTask);
        setHasHandledTaskRedirect(true);
      }
    }
  }, [designs, tasks, hasHandledTaskRedirect]);

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"?`)) {
      deleteDesign(id, user?.name || 'User');
      refreshData();
      if (selectedDesign?.id === id) {
        setShowInspectorModal(false);
        setSelectedDesign(null);
      }
    }
  };

  // Helper for retention calculation
  const getDaysRemaining = (expiresAtStr: string) => {
    const expiresMs = new Date(expiresAtStr).getTime();
    const nowMs = new Date().getTime();
    const diffDays = Math.ceil((expiresMs - nowMs) / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Canva Link Library — every design-brief task (Tasks module,
  // taskCategory === 'design'), whether or not it has a Canva link yet, so
  // the Design Head can see what's still missing one. This is the exact same
  // `tasks` array the Tasks page renders and edits, so a link added/edited
  // here shows up there immediately (and vice versa) via the shared
  // `rtbi-data-sync` event updateTask/saveTasks already dispatch.
  const canvaLibraryTasks = tasks
    .filter(t => t.taskCategory === 'design')
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  const filteredCanvaTasks = canvaLibraryTasks.filter(t => {
    const q = canvaSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      (t.event || '').toLowerCase().includes(q) ||
      (t.assignee || '').toLowerCase().includes(q) ||
      (t.canvaLink || '').toLowerCase().includes(q)
    );
  });

  const handleStartEditCanvaLink = (task: TaskItem) => {
    setCanvaImportSummary('');
    setEditingCanvaTaskId(task.id);
    setEditingCanvaValue(task.canvaLink || '');
  };

  const handleCancelEditCanvaLink = () => {
    setEditingCanvaTaskId('');
    setEditingCanvaValue('');
  };

  const handleSaveCanvaLink = (taskId: string) => {
    if (!canManageCanvaLibrary(user)) return;
    updateTask(taskId, { canvaLink: editingCanvaValue.trim() || undefined }, user?.name || 'User');
    setEditingCanvaTaskId('');
    setEditingCanvaValue('');
    refreshData();
  };

  const handleExportCanvaCsv = () => {
    const header = toCsvRow(['Task ID', 'Title', 'Event', 'Assignee', 'Due Date', 'Status', 'Canva Link', 'Brief Description']);
    const rows = canvaLibraryTasks.map(t => toCsvRow([
      t.id,
      t.title,
      t.event || '',
      t.assignee || '',
      t.dueDate || '',
      t.status,
      t.canvaLink || '',
      t.briefDescription || '',
    ]));
    downloadCsv(`canva_link_library_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows].join('\n'));
  };

  const handleCanvaCsvUploadClick = () => {
    canvaCsvInputRef.current?.click();
  };

  // Import only ever touches the Canva Link column of an EXISTING
  // design-brief task, matched by its Task ID (the column the export above
  // produces) — it never creates, deletes, or reassigns a task, so a bad or
  // stray CSV can't do anything worse than leave a link unchanged.
  const handleCanvaCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canManageCanvaLibrary(user)) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      try {
        const lines = splitCsvLines(text);
        if (lines.length < 2) {
          setCanvaImportSummary('CSV file is empty or missing headers.');
          return;
        }

        const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
        const idIndex = headers.indexOf('task id');
        const linkIndex = headers.indexOf('canva link');
        if (idIndex === -1 || linkIndex === -1) {
          setCanvaImportSummary('Invalid CSV headers. Required columns: "Task ID" and "Canva Link" — export the library first to get a file in the right format.');
          return;
        }

        const currentTasks = getTasks();
        let updated = 0;
        let skipped = 0;
        for (let i = 1; i < lines.length; i++) {
          const values = parseCsvLine(lines[i]);
          const taskId = values[idIndex]?.trim();
          const link = values[linkIndex]?.trim() || '';
          const match = taskId ? currentTasks.find(t => t.id === taskId && t.taskCategory === 'design') : undefined;
          if (!match) {
            skipped++;
            continue;
          }
          updateTask(taskId, { canvaLink: link || undefined }, user?.name || 'User');
          updated++;
        }

        setCanvaImportSummary(
          `Imported ${updated} Canva link${updated === 1 ? '' : 's'}.` +
          (skipped > 0 ? ` Skipped ${skipped} row${skipped === 1 ? '' : 's'} with no matching design task.` : '')
        );
        refreshData();
      } catch {
        setCanvaImportSummary('Failed to parse CSV file — check it matches the exported format.');
      }
    };
    reader.readAsText(file);
  };

  // Filtered designs
  const filteredDesigns = designs.filter(d => {
    // Search
    const matchesSearch =
      d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.designerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.eventName && d.eventName.toLowerCase().includes(searchQuery.toLowerCase()));
    if (!matchesSearch) return false;

    // Category
    if (categoryFilter !== 'all' && d.category !== categoryFilter) return false;

    // Reviewers (Super User / CEO / Group Policy grant) can act on any design.
    const isDesignActionableByMe = (_d: DesignSubmissionItem) => canReviewDesign;

    // Tabs
    if (activeTab === 'mine') {
      return d.designerEmail === user?.email;
    }
    if (activeTab === 'review') {
      return isDesignActionableByMe(d) || canViewAllDesigns(user);
    }
    if (activeTab === 'expired') {
      return d.isExpired;
    }

    // Default "all" tab: plain designers only see their own + anything assigned to them or actionable
    if (!canViewAllDesigns(user)) {
      return d.designerEmail === user?.email || isDesignActionableByMe(d);
    }

    return true;
  });

  // Metrics
  const totalSubmissions = designs.length;
  const pendingReviews = designs.filter(d => (d.styleStatus || 'Pending') === 'Pending').length;
  const approvedDesigns = designs.filter(d => d.styleStatus === 'Style Approved').length;
  const expiredCount = designs.filter(d => d.isExpired).length;
  const assignedToMeCount = canReviewDesign ? pendingReviews : 0;

  // Design-brief Tasks (Tasks module, taskCategory === 'design') waiting on
  // a submission here — visible to the assigned designer, plus anyone who
  // can see the whole portal (Centre Head / Design Head / etc). Stays in the
  // queue until its status flips to 'Completed', which syncDesignTask() does
  // automatically the moment the linked submission's review is approved.
  const designTaskRequests = tasks.filter(t => {
    if (!(t.taskCategory === 'design' || t.isDesignDeliverable || t.designCategory) || t.status === 'Completed') return false;
    if (canViewAllDesigns(user)) return true;
    // isTaskAssignee is the canonical "is this assigned to me" check used
    // across the app (Tasks page, notifications, etc.).
    return isTaskAssignee(t, user);
  });

  return (
    <div className="p-6 md:p-8 space-y-6">
      {approvalRequestSuccessMsg && (
        <div className="flex items-center gap-3 p-4 bg-success/15 border border-success/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <UserCheck className="h-5 w-5 text-success shrink-0" />
          <span>{approvalRequestSuccessMsg}</span>
        </div>
      )}
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 glass-panel border border-white/30 p-6 md:p-8 rounded-3xl shadow-xl bg-gradient-to-r from-accent/15 via-primary/10 to-transparent">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-accent/20 border border-accent/30 text-accent">
              <Palette className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-theme-text-primary">Design Portal</h1>
          </div>
          <p className="text-xs text-theme-text-secondary">
            Submit event artwork, posters & media assets (Max <span className="font-bold text-theme-text-primary">25 MB</span>). Automatic <span className="font-bold text-theme-text-primary">30-day server retention policy</span>. Designs are reviewed and approved by your approvers.
          </p>
        </div>
        <button
          onClick={() => { setSubmitError(''); setSourceTaskId(''); setShowUploadModal(true); }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent hover:bg-primary-light text-white font-bold text-xs transition-all shadow-md shadow-accent/20 whitespace-nowrap cursor-pointer"
        >
          <UploadCloud className="h-4 w-4" />
          Submit Design Asset
        </button>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="glass-panel p-4 rounded-2xl space-y-1 border border-white/20">
          <div className="flex items-center justify-between text-xs text-theme-text-secondary">
            <span className="font-semibold">Total Submissions</span>
            <FileText className="h-4 w-4 text-accent" />
          </div>
          <p className="text-2xl font-black text-theme-text-primary">{totalSubmissions}</p>
          <p className="text-[11px] text-theme-text-secondary">Active in portal</p>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border border-white/20">
          <div className="flex items-center justify-between text-xs text-theme-text-secondary">
            <span className="font-semibold">Pending Review</span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <p className="text-2xl font-black text-amber-600 dark:text-amber-400">{pendingReviews}</p>
          <p className="text-[11px] text-theme-text-secondary">{assignedToMeCount} assigned to you</p>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border border-white/20">
          <div className="flex items-center justify-between text-xs text-theme-text-secondary">
            <span className="font-semibold">Approved</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{approvedDesigns}</p>
          <p className="text-[11px] text-theme-text-secondary">Ready for print & pub</p>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border border-white/20">
          <div className="flex items-center justify-between text-xs text-theme-text-secondary">
            <span className="font-semibold">30-Day Retention Policy</span>
            <ShieldAlert className="h-4 w-4 text-rose-500" />
          </div>
          <p className="text-2xl font-black text-theme-text-secondary">{expiredCount}</p>
          <p className="text-[11px] text-theme-text-secondary">Files purged & archived</p>
        </div>
      </div>

      {/* Design Task Requests — design-brief Tasks created on the Tasks page
          (taskCategory === 'design') waiting on a submission here. */}
      {designTaskRequests.length > 0 && (
        <div className="glass-panel p-5 rounded-3xl border border-accent/25 space-y-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-accent/15 text-accent border border-accent/25">
              <Palette className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-theme-text-primary">Design Task Requests</h2>
              <p className="text-[11px] text-muted-foreground">Design briefs assigned to you, awaiting a submission.</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {designTaskRequests.map(task => {
              const linkedSubmissions = designs.filter(d => d.sourceTaskId === task.id);
              return (
                <div key={task.id} className="p-3.5 bg-background/40 border border-border rounded-2xl space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-xs text-foreground leading-snug">{task.title}</p>
                      <p className="text-[11px] text-muted-foreground">Assignee: {task.assignee} · Due {task.dueDate}</p>
                    </div>
                    <button
                      onClick={() => handleOpenSubmitForTask(task)}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent hover:bg-primary-light text-white text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap"
                    >
                      <UploadCloud className="h-3.5 w-3.5" />
                      Submit Design
                    </button>
                  </div>
                  {task.briefDescription && (
                    <p className="text-[11px] text-muted-foreground whitespace-pre-wrap line-clamp-2">{task.briefDescription}</p>
                  )}
                  {task.canvaLink && (
                    <a
                      href={task.canvaLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-accent/10 hover:bg-accent/20 border border-accent/25 text-accent text-[10px] font-medium rounded-lg transition-all"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      Canva Reference
                    </a>
                  )}
                  {task.attachments && task.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {task.attachments.map((f, i) => (
                        <a
                          key={f.storageKey || f.url || i}
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-accent/10 hover:bg-accent/20 border border-accent/25 text-accent text-[10px] font-medium rounded-lg transition-all max-w-full"
                          title={f.name}
                        >
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{f.name}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {linkedSubmissions.length > 0 && (
                    <div className="pt-1.5 border-t border-border/60 space-y-1">
                      {linkedSubmissions.map(d => (
                        <button
                          key={d.id}
                          onClick={() => openInspector(d)}
                          className="w-full flex items-center justify-between gap-2 text-[11px] text-left hover:text-accent cursor-pointer"
                        >
                          <span className="truncate">{d.fileName}</span>
                          <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                            d.styleStatus === 'Style Approved'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : d.styleStatus === 'Style Rejected'
                              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          }`}>
                            {d.styleStatus === 'Style Approved' ? 'Approved' : d.styleStatus === 'Style Rejected' ? 'Rejected' : 'Pending Review'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter Tabs & Search Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-3 rounded-2xl border border-white/20">
        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'all'
                ? 'bg-accent text-white shadow-md shadow-accent/20'
                : 'text-theme-text-secondary hover:bg-white/40 dark:hover:bg-white/5 hover:text-theme-text-primary'
            }`}
          >
            All Submissions
          </button>

          <button
            onClick={() => setActiveTab('mine')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'mine'
                ? 'bg-accent text-white shadow-md shadow-accent/20'
                : 'text-theme-text-secondary hover:bg-white/40 dark:hover:bg-white/5 hover:text-theme-text-primary'
            }`}
          >
            My Submissions
          </button>

          <button
            onClick={() => setActiveTab('review')}
            className={`relative px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'review'
                ? 'bg-accent text-white shadow-md shadow-accent/20'
                : 'text-theme-text-secondary hover:bg-white/40 dark:hover:bg-white/5 hover:text-theme-text-primary'
            }`}
          >
            Review Queue
            {assignedToMeCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500 text-slate-950 font-black">
                {assignedToMeCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('expired')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'expired'
                ? 'bg-accent text-white shadow-md shadow-accent/20'
                : 'text-theme-text-secondary hover:bg-white/40 dark:hover:bg-white/5 hover:text-theme-text-primary'
            }`}
          >
            30d Expired ({expiredCount})
          </button>

          {/* Restricted to Design Head / Centre Head / Advisor / Super User —
              see canManageCanvaLibrary in permissions.ts. */}
          {canManageCanvaLibrary(user) && (
            <button
              onClick={() => setActiveTab('canva')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                activeTab === 'canva'
                  ? 'bg-accent text-white shadow-md shadow-accent/20'
                  : 'text-theme-text-secondary hover:bg-white/40 dark:hover:bg-white/5 hover:text-theme-text-primary'
              }`}
            >
              <Link2 className="h-3.5 w-3.5" />
              Canva Link Library
            </button>
          )}
        </div>

        {/* Search & Category Filter — hidden on the Canva Link Library tab,
            which has its own search below */}
        {activeTab !== 'canva' && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-theme-text-secondary" />
              <input
                type="text"
                placeholder="Search design title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-white/40 dark:bg-white/5 border border-theme-border/30 text-theme-text-primary placeholder:text-theme-text-secondary focus:outline-none focus:border-accent"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl bg-white/40 dark:bg-white/5 border border-theme-border/30 text-theme-text-primary focus:outline-none focus:border-accent cursor-pointer"
            >
              <option value="all">All Categories</option>
              <option value="Poster">Poster</option>
              <option value="Postage">Postage</option>
              <option value="Banner">Banner</option>
              <option value="Social Media">Social Media Post</option>
              <option value="Certificates">Certificates</option>
              <option value="Brochure">Brochure</option>
              <option value="Other">Other</option>
            </select>
          </div>
        )}
      </div>

      {activeTab === 'canva' && canManageCanvaLibrary(user) ? (
        <div className="glass-panel rounded-3xl p-5 md:p-6 border border-white/20 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-theme-text-primary flex items-center gap-2">
                <Link2 className="h-4 w-4 text-accent" />
                Canva Link Library
              </h2>
              <p className="text-[11px] text-theme-text-secondary max-w-md">
                Every design-brief task's Canva reference link in one place — restricted to the Design Head, Centre Head, Advisor, and Super User.
                Editing a link here updates the same task shown in the Tasks module, and vice versa.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleExportCanvaCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/40 dark:bg-white/5 border border-theme-border/30 hover:border-accent/50 text-theme-text-primary text-xs font-bold transition-all cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
              <button
                onClick={handleCanvaCsvUploadClick}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent hover:bg-primary-light text-white text-xs font-bold transition-all cursor-pointer"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                Import CSV
              </button>
              <input
                ref={canvaCsvInputRef}
                type="file"
                accept=".csv,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,text/plain"
                className="hidden"
                onChange={handleCanvaCsvFileChange}
              />
            </div>
          </div>

          {canvaImportSummary && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/25 text-xs text-theme-text-primary">
              <FileCheck className="h-3.5 w-3.5 text-accent shrink-0" />
              {canvaImportSummary}
            </div>
          )}

          <div className="relative sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-theme-text-secondary" />
            <input
              type="text"
              placeholder="Search by title, event, or assignee..."
              value={canvaSearchQuery}
              onChange={(e) => setCanvaSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-white/40 dark:bg-white/5 border border-theme-border/30 text-theme-text-primary placeholder:text-theme-text-secondary focus:outline-none focus:border-accent"
            />
          </div>

          {filteredCanvaTasks.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <Link2 className="h-8 w-8 mx-auto text-theme-text-secondary" />
              <p className="text-xs text-theme-text-secondary">
                {canvaLibraryTasks.length === 0
                  ? 'No design-brief tasks have been created yet — they show up here as soon as one is created on the Tasks page.'
                  : 'No tasks match your search.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs min-w-[720px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-theme-text-secondary border-b border-theme-border/20">
                    <th className="px-1.5 py-2 font-bold">Title</th>
                    <th className="px-1.5 py-2 font-bold">Event</th>
                    <th className="px-1.5 py-2 font-bold">Assignee</th>
                    <th className="px-1.5 py-2 font-bold">Due Date</th>
                    <th className="px-1.5 py-2 font-bold">Status</th>
                    <th className="px-1.5 py-2 font-bold">Canva Link</th>
                    <th className="px-1.5 py-2 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCanvaTasks.map(task => {
                    const linkedSubmission = designs.find(d => d.sourceTaskId === task.id);
                    return (
                      <tr key={task.id} className="border-b border-theme-border/10 align-top">
                        <td className="px-1.5 py-2.5 font-semibold text-theme-text-primary max-w-[220px]">
                          <div className="truncate" title={task.title}>{task.title}</div>
                          {linkedSubmission && (
                            <div className="text-[10px] text-theme-text-secondary font-normal">
                              Submission: {linkedSubmission.styleStatus === 'Style Approved' ? 'Approved' : linkedSubmission.styleStatus === 'Style Rejected' ? 'Rejected' : 'Pending Review'}
                            </div>
                          )}
                        </td>
                        <td className="px-1.5 py-2.5 text-theme-text-secondary">{task.event || '—'}</td>
                        <td className="px-1.5 py-2.5 text-theme-text-secondary">{task.assignee || '—'}</td>
                        <td className="px-1.5 py-2.5 text-theme-text-secondary whitespace-nowrap">{task.dueDate || '—'}</td>
                        <td className="px-1.5 py-2.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/40 dark:bg-white/5 border border-theme-border/30 whitespace-nowrap">
                            {task.status}
                          </span>
                        </td>
                        <td className="px-1.5 py-2.5 min-w-[180px]">
                          {editingCanvaTaskId === task.id ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="url"
                                autoFocus
                                value={editingCanvaValue}
                                onChange={(e) => setEditingCanvaValue(e.target.value)}
                                placeholder="https://canva.com/design/..."
                                className="w-full min-w-[160px] px-2 py-1 text-[11px] rounded-lg bg-white/60 dark:bg-white/10 border border-accent/40 text-theme-text-primary focus:outline-none focus:border-accent"
                              />
                              <button
                                onClick={() => handleSaveCanvaLink(task.id)}
                                title="Save"
                                className="shrink-0 p-1.5 rounded-lg bg-accent hover:bg-primary-light text-white cursor-pointer"
                              >
                                <Check className="h-3 w-3" />
                              </button>
                              <button
                                onClick={handleCancelEditCanvaLink}
                                title="Cancel"
                                className="shrink-0 p-1.5 rounded-lg bg-white/40 dark:bg-white/10 border border-theme-border/30 text-theme-text-secondary cursor-pointer"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : task.canvaLink ? (
                            <div className="flex items-center gap-1.5">
                              <a
                                href={task.canvaLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 bg-accent/10 hover:bg-accent/20 border border-accent/25 text-accent text-[10px] font-medium rounded-lg transition-all truncate max-w-[160px]"
                                title={task.canvaLink}
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                <span className="truncate">Open link</span>
                              </a>
                              <button
                                onClick={() => handleStartEditCanvaLink(task)}
                                title="Edit Canva link"
                                className="shrink-0 p-1.5 rounded-lg hover:bg-white/40 dark:hover:bg-white/10 text-theme-text-secondary cursor-pointer"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleStartEditCanvaLink(task)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-theme-border/40 text-theme-text-secondary hover:text-accent hover:border-accent/50 text-[10px] font-medium transition-all cursor-pointer"
                            >
                              <Plus className="h-3 w-3" />
                              Add link
                            </button>
                          )}
                        </td>
                        <td className="px-1.5 py-2.5 text-right">
                          {task.attachments && task.attachments.length > 0 && (
                            <span className="text-[10px] text-theme-text-secondary">{task.attachments.length} file{task.attachments.length === 1 ? '' : 's'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : filteredDesigns.length === 0 ? (
        <div className="glass-panel rounded-3xl p-12 text-center space-y-4 border border-white/20">
          <div className="mx-auto w-12 h-12 rounded-full bg-accent/15 flex items-center justify-center text-accent">
            <Palette className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-theme-text-primary">No design submissions found</h3>
          <p className="text-xs text-theme-text-secondary max-w-sm mx-auto">
            Be the first to submit a design asset for review and approval!
          </p>
          <button
            onClick={() => { setSubmitError(''); setShowUploadModal(true); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent hover:bg-primary-light text-white text-xs font-bold transition-all shadow-md shadow-accent/20 cursor-pointer"
          >
            <UploadCloud className="h-4 w-4" />
            Upload Design
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredDesigns.map(design => {
            const daysRemaining = getDaysRemaining(design.expiresAt);
            const isAssignedToMe = canReviewDesign;

            return (
              <div
                key={design.id}
                className="group glass-panel rounded-2xl overflow-hidden hover:border-accent/50 transition-all shadow-md flex flex-col justify-between border border-white/20"
              >
                <div>
                  {/* Top Asset Preview Header */}
                  <div className="relative h-44 bg-white/40 dark:bg-white/5 border-b border-theme-border/20 flex items-center justify-center overflow-hidden">
                    {(design.fileUrl || design.fileData) && design.fileType.startsWith('image/') ? (
                      <img
                        src={design.fileUrl || design.fileData}
                        alt={design.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-theme-text-secondary">
                        <FileText className="h-10 w-10 text-accent/80" />
                        <span className="text-xs font-mono font-medium max-w-[200px] truncate px-2 text-center">
                          {design.fileName}
                        </span>
                      </div>
                    )}

                    {/* Category Pill */}
                    <span className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/90 dark:bg-slate-900/90 backdrop-blur border border-theme-border/30 text-theme-text-primary">
                      {design.category}
                    </span>

                    {/* 30-Day Retention Badge */}
                    <span
                      className={`absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold backdrop-blur border ${
                        design.isExpired || daysRemaining <= 0
                          ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/40'
                          : daysRemaining <= 5
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40'
                          : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
                      }`}
                    >
                      {design.isExpired || daysRemaining <= 0
                        ? '30d Expired (Purged)'
                        : `Expires in ${daysRemaining}d`}
                    </span>
                  </div>

                  {/* Body Content */}
                  <div className="p-4 space-y-3">
                    <div className="space-y-1">
                      <h3 className="font-bold text-sm text-theme-text-primary line-clamp-1 group-hover:text-accent transition-colors">
                        {design.title}
                      </h3>
                      {design.description && (
                        <p className="text-xs text-theme-text-secondary line-clamp-2">
                          {design.description}
                        </p>
                      )}
                    </div>

                    {/* Metadata Specs */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-theme-text-secondary">
                      <span className="font-mono bg-white/50 dark:bg-white/5 px-2 py-0.5 rounded border border-theme-border/30 font-semibold">
                        {(design.fileSize / (1024 * 1024)).toFixed(2)} MB / 25 MB
                      </span>

                      {design.eventName && (
                        <span className="flex items-center gap-1 text-accent truncate max-w-[160px] font-semibold">
                          <Calendar className="h-3 w-3 shrink-0" />
                          {design.eventName}
                        </span>
                      )}
                    </div>

                    {/* Review Status */}
                    <div className="pt-2 border-t border-theme-border/30">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-theme-text-secondary block">
                        Review Status
                      </span>
                      {design.styleStatus === 'Style Approved' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approved
                        </span>
                      ) : design.styleStatus === 'Style Rejected' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 dark:text-rose-400">
                          <AlertCircle className="h-3.5 w-3.5" />
                          Rejected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400">
                          <Clock className="h-3.5 w-3.5" />
                          Pending Review
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="p-4 pt-0 flex items-center justify-between gap-2 border-t border-theme-border/20 mt-2">
                  <div className="text-[11px] text-theme-text-secondary">
                    By <span className="font-bold text-theme-text-primary">{design.designerName}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isAssignedToMe && (design.styleStatus || 'Pending') === 'Pending' && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-500 text-slate-950 animate-pulse">
                        Action Required
                      </span>
                    )}

                    <button
                      onClick={() => openInspector(design)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent text-white hover:bg-primary-light text-xs font-bold transition-all shadow-sm cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Inspect & Review
                    </button>

                    {user && (
                      <button
                        onClick={() => setApprovalRequestDesign(design)}
                        className="p-1.5 rounded-xl text-theme-text-secondary hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                        title="Ask someone to approve this design"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {(design.designerEmail === user?.email || user?.tier <= 3 || hasCapability(user, 'DESIGN_DELETE')) && (
                      <button
                        onClick={() => handleDelete(design.id, design.title)}
                        className="p-1.5 rounded-xl text-theme-text-secondary hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Delete design"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="glass-panel bg-slate-900/95 dark:bg-[#0B1B2E]/95 bg-white/95 backdrop-blur-2xl border border-white/20 dark:border-white/15 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl relative">
            <button
              onClick={() => setShowUploadModal(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="space-y-1">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-accent" />
                Submit Design Asset
              </h2>
              <p className="text-xs text-muted-foreground">
                Upload your graphic asset (<span className="font-semibold">Max 25 MB</span>). Files are stored for <span className="font-semibold">30 days</span> under automatic retention policy.
              </p>
            </div>

            {sourceTaskId && (() => {
              const sourceTask = tasks.find(t => t.id === sourceTaskId);
              if (!sourceTask) return null;
              return (
                <div className="p-3.5 bg-accent/10 border border-accent/30 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <FileText className="h-4 w-4 text-accent" />
                    Fulfilling Task: {sourceTask.title}
                  </div>
                  {sourceTask.briefDescription && (
                    <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{sourceTask.briefDescription}</p>
                  )}
                  {sourceTask.attachments && sourceTask.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {sourceTask.attachments.map((f, i) => (
                        <a
                          key={f.storageKey || f.url || i}
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent text-[10px] font-medium rounded-lg transition-all max-w-full"
                          title={f.name}
                        >
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{f.name}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    This task will be marked <span className="font-semibold text-foreground">Completed</span> automatically once your submission is approved.
                  </p>
                </div>
              );
            })()}

            <form onSubmit={handleUploadSubmit} className="space-y-4 text-xs">
              {/* Title */}
              <div className="space-y-1">
                <label className="font-medium text-foreground">Design Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Tech Conclave Main Stage Banner"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Category & Event */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-medium text-foreground">Category *</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as any)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option value="Poster">Poster</option>
                    <option value="Postage">Postage</option>
                    <option value="Banner">Banner</option>
                    <option value="Social Media">Social Media</option>
                    <option value="Brochure">Brochure</option>
                    <option value="Certificates">Certificates</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-medium text-foreground">Tag Event (Optional)</label>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickEventError('');
                        setShowQuickEventModal(true);
                      }}
                      className="text-[11px] text-accent hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                      Create Event on Spot
                    </button>
                  </div>
                  <SearchableSelect
                    value={eventId}
                    onChange={setEventId}
                    allLabel="-- No Specific Event --"
                    allValue=""
                    options={events.filter(ev => isApprovedEvent(ev, tasks)).map(ev => ({ value: ev.id, label: ev.title }))}
                  />
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label className="font-medium text-foreground">Description & Notes</label>
                <textarea
                  rows={2}
                  placeholder="Provide context, dimensions, or target printing specs..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* File Upload Box */}
              <div className="space-y-1">
                <label className="font-medium text-foreground flex items-center justify-between">
                  <span>File Asset (<span className="text-amber-500 font-bold">&lt; 25 MB</span>) *</span>
                </label>

                <FileDropzone
                  onFilesSelected={(files) => handleFile(files[0])}
                  accept="image/*,video/*,application/pdf,.psd,.ai,.eps,.svg,.indd,.cdr,.ppt,.pptx,.doc,.docx,.zip"
                  label="Click to select design file"
                  hint="Images, video, PDF, PSD, AI, PPTX, DOCX & more — up to 25 MB"
                  disabled={isSubmitting}
                />

                {file && (
                  <div className="pt-1">
                    <FilePreviewRow
                      file={file}
                      status={isSubmitting ? 'uploading' : submitError ? 'error' : 'idle'}
                      progress={uploadProgress}
                      etaSeconds={uploadEtaSeconds}
                      error={submitError}
                      onRetry={submitError ? () => handleUploadSubmit() : undefined}
                    />
                  </div>
                )}

                {isReadingFile && (
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Preparing file...</span>
                      <span className="font-mono">{readProgress}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-150 ease-out"
                        style={{ width: `${readProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {fileError && (
                  <p className="text-rose-500 font-medium text-[11px] flex items-center gap-1 pt-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {fileError}
                  </p>
                )}

              </div>

              <p className="text-[11px] text-muted-foreground">
                Your submission is sent to the default approvers for review.
              </p>

              {/* Real upload percent + ETA and retry now live inline on the
                  FilePreviewRow above — no separate indeterminate bar or
                  duplicate error banner needed here. */}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 rounded-lg bg-muted text-muted-foreground hover:text-foreground font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isReadingFile}
                  className="px-4 py-2 rounded-xl bg-accent text-white font-bold hover:bg-primary-light transition-all shadow-md shadow-accent/20 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Uploading...' : isReadingFile ? 'Preparing file...' : submitError ? 'Retry Submit' : 'Submit Design'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Event Creation Modal */}
      {showQuickEventModal && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="glass-panel bg-slate-900/95 dark:bg-[#0B1B2E]/95 bg-white/95 backdrop-blur-2xl border border-white/20 dark:border-white/15 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl relative text-foreground">
            <button
              onClick={() => setShowQuickEventModal(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="space-y-1">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                Create Event on the Spot
              </h3>
              <p className="text-xs text-muted-foreground">
                Create a new event immediately to tag your design asset.
              </p>
            </div>

            <form onSubmit={handleQuickEventSubmit} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-medium text-foreground">Event Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Annual Tech Symposium 2026"
                  value={newEventTitle}
                  onChange={e => setNewEventTitle(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-foreground">Dates</label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={newEventDatesTBD}
                      onChange={e => setNewEventDatesTBD(e.target.checked)}
                      className="rounded border-border text-accent focus:ring-accent"
                    />
                    Dates TBD
                  </label>
                </div>
                {!newEventDatesTBD && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={newEventStartDate}
                      onChange={e => setNewEventStartDate(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent text-xs"
                    />
                    <input
                      type="date"
                      value={newEventEndDate}
                      onChange={e => setNewEventEndDate(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent text-xs"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground">Location / Venue</label>
                <input
                  type="text"
                  placeholder="e.g. Main Auditorium"
                  value={newEventLocation}
                  onChange={e => setNewEventLocation(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground">Description</label>
                <textarea
                  rows={2}
                  placeholder="Event notes or objectives..."
                  value={newEventDesc}
                  onChange={e => setNewEventDesc(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {quickEventError && (
                <p className="text-rose-500 font-medium text-[11px] flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {quickEventError}
                </p>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowQuickEventModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted font-medium text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingEvent}
                  className="px-4 py-2 rounded-xl bg-accent text-white font-bold hover:bg-primary-light text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-md shadow-accent/20 transition-all"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {isCreatingEvent ? 'Creating...' : 'Create & Tag Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Design Inspector & Review Modal */}
      {showInspectorModal && selectedDesign && (
        <div
          onClick={() => {
            setShowInspectorModal(false);
            setSelectedDesign(null);
          }}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-panel bg-slate-900/95 dark:bg-[#0B1B2E]/95 bg-white/95 backdrop-blur-2xl border border-white/20 dark:border-white/15 rounded-2xl max-w-2xl w-full p-6 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto flex flex-col"
          >
            <div className="sticky -top-6 -mx-6 -mt-6 p-6 bg-slate-900/95 dark:bg-[#0B1B2E]/95 bg-white/95 border-b border-border z-30 flex items-start justify-between gap-4 rounded-t-2xl">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent/10 text-accent border border-accent/20">
                    {selectedDesign.category}
                  </span>
                  <h2 className="text-lg font-bold">{selectedDesign.title}</h2>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Submitted by <span className="font-semibold text-foreground">{selectedDesign.designerName}</span> ({selectedDesign.designerEmail})
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right hidden sm:block">
                  <span className="text-[11px] font-mono bg-muted px-2 py-0.5 rounded border border-border inline-block">
                    {(selectedDesign.fileSize / (1024 * 1024)).toFixed(2)} MB / 25 MB
                  </span>
                  <span className="text-[10px] text-muted-foreground block">
                    Exp: {selectedDesign.expiresAt.split('T')[0]}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowInspectorModal(false);
                    setSelectedDesign(null);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold transition-all border border-border cursor-pointer shadow-sm"
                  title="Close Inspector"
                >
                  <X className="h-4 w-4" />
                  <span>Close</span>
                </button>
              </div>
            </div>

            {/* Inspector Tab Bar — splits the review into focused screens instead of one long scroll */}
            <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 border-b border-border">
              {([
                { id: 'overview', label: 'Overview', icon: FileText },
                { id: 'style', label: 'Review', icon: Sparkles },
              ] as { id: InspectorTab; label: string; icon: typeof FileText }[]).map(tab => {
                const Icon = tab.icon;
                const isActive = inspectorTab === tab.id;
                const needsAttention =
                  (tab.id === 'style' && (!selectedDesign.styleStatus || selectedDesign.styleStatus === 'Pending'));
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setInspectorTab(tab.id)}
                    className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-t-lg text-xs font-semibold transition-all cursor-pointer border-b-2 ${
                      isActive
                        ? 'border-accent text-accent bg-accent/5'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                    {needsAttention && (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Awaiting decision" />
                    )}
                  </button>
                );
              })}
            </div>

            {inspectorTab === 'overview' && (
            <>
            {/* Asset Preview Frame */}
            <div className="bg-muted/40 border border-border rounded-xl p-4 text-center space-y-3">
              {(selectedDesign.fileUrl || selectedDesign.fileData) && selectedDesign.fileType.startsWith('image/') ? (
                <div className="max-h-72 overflow-hidden rounded-lg border border-border mx-auto flex items-center justify-center">
                  <img
                    src={selectedDesign.fileUrl || selectedDesign.fileData}
                    alt={selectedDesign.title}
                    className="max-h-72 object-contain"
                  />
                </div>
              ) : selectedDesign.isExpired ? (
                <div className="py-8 space-y-2 text-rose-400">
                  <ShieldAlert className="h-10 w-10 mx-auto" />
                  <p className="font-bold text-sm">File Payload Purged under 30-Day Retention Policy</p>
                  <p className="text-xs text-muted-foreground">
                    This file exceeded the 30-day storage period. Metadata is preserved for audit trail.
                  </p>
                </div>
              ) : (
                <div className="py-8 space-y-2 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto text-accent" />
                  <p className="font-medium text-sm text-foreground">{selectedDesign.fileName}</p>
                  <p className="text-xs">{selectedDesign.fileType}</p>
                </div>
              )}

              {(selectedDesign.fileUrl || selectedDesign.fileData) && (
                <a
                  href={selectedDesign.fileUrl ? `${selectedDesign.fileUrl}?download=1` : selectedDesign.fileData}
                  download={selectedDesign.fileName}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-medium text-foreground hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" /> Download Full Resolution File
                </a>
              )}
            </div>

            {/* Replace File (design owner or admins only) */}
            {(selectedDesign.designerEmail === user?.email || canViewAllDesigns(user)) && (
              <form onSubmit={handleReplaceFileSubmit} className="border-t border-border pt-4 space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <UploadCloud className="h-4 w-4 text-accent" />
                  Replace Uploaded File
                </h3>
                <p className="text-xs text-muted-foreground">
                  Uploading a new file resets any review decision back to pending, since the reviewed asset no longer exists.
                </p>
                <FileDropzone
                  onFilesSelected={(files) => handleReplaceFile(files[0])}
                  label="Click to select replacement file"
                  hint="Up to 25 MB"
                  disabled={isReplacingFile}
                  compact
                />

                {replaceFile && (
                  <FilePreviewRow
                    file={replaceFile}
                    status={isReplacingFile ? 'uploading' : replaceFileError ? 'error' : 'idle'}
                    progress={replaceUploadProgress}
                    etaSeconds={replaceUploadEtaSeconds}
                    error={replaceFileError}
                    onRetry={replaceFileError ? () => handleReplaceFileSubmit() : undefined}
                    onRemove={!isReplacingFile ? () => handleReplaceFile(undefined) : undefined}
                  />
                )}

                <button
                  type="submit"
                  disabled={isReplacingFile || isReadingReplaceFile || !replaceFile}
                  className="w-full px-4 py-2.5 rounded-xl bg-accent text-white font-bold hover:bg-primary-light text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shadow-md shadow-accent/20 transition-all"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isReplacingFile || isReadingReplaceFile ? 'animate-spin' : ''}`} />
                  {isReplacingFile ? 'Uploading New File...' : isReadingReplaceFile ? 'Reading file...' : 'Upload Revised File'}
                </button>
                {isReadingReplaceFile && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Preparing file...</span>
                      <span className="font-mono">{replaceReadProgress}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-150 ease-out"
                        style={{ width: `${replaceReadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </form>
            )}

            {/* Task & Performance Rating Integration Status Card */}
            {selectedDesign.linkedTaskId && (
              <div className="bg-accent/10 border border-accent/20 p-3.5 rounded-xl space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground flex items-center gap-1.5">
                    <CheckSquare className="h-4 w-4 text-accent" />
                    Task & Rating Workflow Integration
                  </span>
                  {(() => {
                    const linkedTask = tasks.find(t => t.id === selectedDesign.linkedTaskId);
                    if (linkedTask?.ratingScore) {
                      return (
                        <span className="flex items-center gap-1 font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full text-[10px]">
                          <Star className="h-3 w-3 fill-amber-500" /> Rated {linkedTask.ratingScore.toFixed(1)}/5.0
                        </span>
                      );
                    }
                    return (
                      <span className="font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[10px]">
                        Task Registered — Ready for Rating
                      </span>
                    );
                  })()}
                </div>
                <p className="text-muted-foreground text-[11px]">
                  This finalized design deliverable is active as a task assigned to <strong className="text-foreground">{selectedDesign.designerName}</strong>
                  {selectedDesign.eventName ? ` for event "${selectedDesign.eventName}"` : ' (Standalone Deliverable)'}. Evaluators can score performance under the <strong>Ratings</strong> tab.
                </p>
              </div>
            )}

            {/* Description & Event */}
            {selectedDesign.description && (
              <div className="space-y-1 text-xs">
                <span className="font-semibold text-foreground">Designer Notes:</span>
                <p className="text-muted-foreground bg-muted/20 p-3 rounded-lg border border-border">
                  {selectedDesign.description}
                </p>
              </div>
            )}

            </>
            )}

            {/* Design Head Style Evaluation Section */}
            {inspectorTab === 'style' && (
            <div className="pt-1 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
                  <Sparkles className="h-4 w-4 text-accent" />
                  Design Review
                </h3>
                {selectedDesign.styleStatus && (
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                    selectedDesign.styleStatus === 'Style Approved'
                      ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20'
                      : selectedDesign.styleStatus === 'Style Rejected'
                      ? 'bg-rose-500/15 text-rose-500 border border-rose-500/20'
                      : 'bg-amber-500/15 text-amber-500 border border-amber-500/20'
                  }`}>
                    {selectedDesign.styleStatus}
                  </span>
                )}
              </div>

              {selectedDesign.styleFeedback && (
                <div className="bg-muted/30 p-3 rounded-lg border border-border space-y-1 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="font-semibold text-foreground">Reviewer Notes:</span>
                    <span className="font-mono text-[10px]">{selectedDesign.styleDecidedAt?.split('T')[0]} ({selectedDesign.styleDecidedBy})</span>
                  </div>
                  <p className="text-muted-foreground italic">"{selectedDesign.styleFeedback}"</p>
                </div>
              )}

              {canReviewDesign ? (
                <form onSubmit={handleSaveStyleReview} className="space-y-3 text-xs bg-accent/5 p-4 rounded-xl border border-accent/20">
                  <p className="font-medium text-foreground">{selectedDesign.styleStatus ? 'Update Design Style Decision:' : 'Submit Design Style Decision:'}</p>

                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer font-medium">
                      <input
                        type="radio"
                        name="styleStatus"
                        checked={styleStatus === 'Style Approved'}
                        onChange={() => setStyleStatus('Style Approved')}
                        className="text-accent focus:ring-accent"
                      />
                      <span className="text-emerald-500 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve Style
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer font-medium">
                      <input
                        type="radio"
                        name="styleStatus"
                        checked={styleStatus === 'Style Rejected'}
                        onChange={() => setStyleStatus('Style Rejected')}
                        className="text-accent focus:ring-accent"
                      />
                      <span className="text-rose-500 font-semibold flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5" /> Reject Style
                      </span>
                    </label>
                  </div>

                  <div className="space-y-1">
                    <label className="font-medium text-foreground">
                      Style Feedback & Guidelines Compliance{styleStatus === 'Style Rejected' ? ' *' : ' (optional)'}
                    </label>
                    <textarea
                      rows={2}
                      required={styleStatus === 'Style Rejected'}
                      placeholder="Feedback on typography, color scheme, design alignment..."
                      value={styleFeedback}
                      onChange={e => setStyleFeedback(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent text-xs"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-accent text-white font-bold hover:bg-primary-light text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-accent/20 transition-all"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Save Style Decision
                  </button>
                </form>
              ) : (
                <div className="p-3 bg-muted/20 rounded-lg text-xs text-muted-foreground flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  Only the Design Head, Centre Head, or Advisor can approve or reject designs based on design style.
                </div>
              )}
            </div>
            )}

            {/* Sticky Bottom Close Inspector Bar */}
            <div className="sticky -bottom-6 -mx-6 -mb-6 p-4 bg-slate-900/95 dark:bg-[#0B1B2E]/95 bg-white/95 border-t border-border z-30 flex items-center justify-between rounded-b-2xl mt-6">
              <span className="text-xs text-muted-foreground font-medium">
                Design Inspection
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowInspectorModal(false);
                  setSelectedDesign(null);
                }}
                className="px-5 py-2 rounded-xl bg-accent hover:bg-primary-light text-white font-semibold text-xs flex items-center gap-2 transition-all shadow-md shadow-accent/20 cursor-pointer"
              >
                <X className="h-4 w-4" />
                <span>Close Inspector</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {approvalRequestDesign && user && (
        <RequestApprovalModal
          isOpen={Boolean(approvalRequestDesign)}
          onClose={() => setApprovalRequestDesign(null)}
          entityType="design"
          entityId={approvalRequestDesign.id}
          entityTitle={approvalRequestDesign.title}
          eventId={approvalRequestDesign.eventId}
          members={members}
          currentUser={user}
          onRequested={() => {
            setApprovalRequestDesign(null);
            setApprovalRequestSuccessMsg('Approval request sent!');
            setTimeout(() => setApprovalRequestSuccessMsg(''), 4000);
          }}
        />
      )}
    </div>
  );
}
