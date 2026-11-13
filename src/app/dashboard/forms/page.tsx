'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { FormFieldEditor } from '@/components/form-field-editor';
import { FormImageField } from '@/components/form-image-field';
import { FormHeaderFraming, DEFAULT_HEADER_FRAMING, HeaderFraming } from '@/components/form-header-framing';
import {
  Plus,
  Trash2,
  Eye,
  Copy,
  CheckCircle2,
  Check,
  Ban,
  X,
  Edit2,
  ShieldAlert,
  FileText,
  FileDown,
  FileSpreadsheet,
  Clock,
  Table2,
  BarChart3,
  Gauge,
  LayoutTemplate,
  CalendarDays,
  Save,
  TrendingUp,
  Users,
  QrCode,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { FormQrModal } from '@/components/form-qr-modal';
import { FeedbackAnalysisPanel } from '@/components/feedback-analysis-panel';
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import {
  getForms,
  addForm,
  updateForm,
  deleteForm,
  submitFormEdit,
  submitFormDelete,
  approveForm,
  rejectForm,
  getSubmissions,
  isSlugUnique,
  getFormTemplates,
  addFormTemplate,
  updateFormTemplate,
  deleteFormTemplate,
  restoreBuiltInTemplate,
  getDeletedBuiltInTemplates,
  isBuiltInTemplate,
  getEvents,
  getTasks,
  isApprovedEvent,
  FEEDBACK_FORM_TEMPLATE_ID,
  initialFormTemplates,
  PublicFormItem,
  FormField,
  FormSubmissionItem,
  FormTemplateItem,
  EventItem,
  TaskItem,
  isFormClosed,
  deleteSubmission,
} from '@/lib/local-data';
import { canCreateForms, canDeleteForms, seesOnlyOwnForms, isOwnForm, getFormApprovalRequirement, canApprovePendingForm, hasCapability } from '@/lib/permissions';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchableSelect } from '@/components/searchable-select';

const CHART_COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'];

const CHARTABLE_TYPES: FormField['type'][] = ['scale', 'number', 'select', 'checkbox', 'multiselect'];

/**
 * Value -> count for one field across a form's submissions, keyed by the
 * raw answer. A multiselect answer is an array — each option the
 * respondent picked counts toward its own bucket ("select all that
 * apply" tallying), rather than the whole array being treated as one
 * combined key.
 */
function buildFieldCounts(field: FormField, subs: FormSubmissionItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  subs.forEach(s => {
    const raw = s.data[field.id] ?? s.data[field.label];
    if (raw === undefined || raw === null || raw === '') return;
    const values = Array.isArray(raw) ? raw : [raw];
    values.forEach(v => {
      if (v === undefined || v === null || v === '') return;
      const key = String(v);
      counts[key] = (counts[key] || 0) + 1;
    });
  });
  return counts;
}

function buildScaleChartData(field: FormField, subs: FormSubmissionItem[]) {
  const counts = buildFieldCounts(field, subs);
  return [1, 2, 3, 4, 5].map(n => ({ name: String(n), count: counts[String(n)] || 0 }));
}

function buildCategoryChartData(field: FormField, subs: FormSubmissionItem[]) {
  const counts = buildFieldCounts(field, subs);
  // Checkbox answers are stored as raw booleans, so their bucket keys are
  // the literal strings "true"/"false" — humanize those into Yes/No rather
  // than showing respondents' answers as JS boolean stringification.
  const labelFor = (key: string) => {
    if (field.type !== 'checkbox') return key;
    if (key === 'true') return 'Yes';
    if (key === 'false') return 'No';
    return key;
  };
  return Object.entries(counts)
    .map(([name, count]) => ({ name: labelFor(name), count }))
    .sort((a, b) => b.count - a.count);
}

/** A "nice" (round, never-too-tall) Y-axis ceiling for small response counts —
 *  recharts' own auto-domain rounds up aggressively (e.g. a max of 1 becomes
 *  a 0-4 axis), which leaves bars looking lost in mostly-empty charts on
 *  forms with only a handful of submissions so far. */
function chartCountDomainMax(dataMax: number): number {
  const max = Math.max(1, Math.ceil(dataMax));
  if (max <= 5) return max;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude) * magnitude;
}

function computeAverage(field: FormField, subs: FormSubmissionItem[]): number | null {
  const values = subs
    .map(s => Number(s.data[field.id] ?? s.data[field.label]))
    .filter(v => !isNaN(v));
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Response count per calendar day, oldest first, for the submissions-over-time trend chart. */
function buildSubmissionsByDay(subs: FormSubmissionItem[]) {
  const counts: Record<string, number> = {};
  subs.forEach(s => {
    const day = (s.submittedAt || '').slice(0, 10);
    if (!day) return;
    counts[day] = (counts[day] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function escapeCsvValue(value: unknown): string {
  const str = (Array.isArray(value) ? value.join('; ') : String(value ?? '')).replace(/"/g, '""');
  return `"${str}"`;
}

/** Turns a title/template name into a URL-safe slug fragment — used to
 *  auto-suggest the Public Link Slug from the form's (auto-generated)
 *  title, e.g. "Feedback Form – AI Hackathon 2026" -> "feedback-form-ai-hackathon-2026". */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** ISO UTC -> value for <input type="datetime-local"> in the browser's local time ('' when unset/invalid). */
const toLocalInput = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** <input type="datetime-local"> value (browser-local) -> ISO UTC. '' (not undefined) when cleared, so the server-side merge actually clears a previously saved value. */
const fromLocalInput = (v: string): string => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
};
const formatCloseAt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function FormsBuilderPage() {
  const [forms, setForms] = useState<PublicFormItem[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmissionItem[]>([]);
  const [templates, setTemplates] = useState<FormTemplateItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [user, setUser] = useState<any>(null);

  // Modals & Active Edit
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<PublicFormItem | null>(null);
  const [deletingFormId, setDeletingFormId] = useState<string | null>(null);
  // A response id, 'ALL' (every response of the selected form) or null.
  const [deletingResponse, setDeletingResponse] = useState<string | null>(null);
  const [rejectingFormId, setRejectingFormId] = useState<string | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false);
  const [templateNameDraft, setTemplateNameDraft] = useState('');
  const [qrModalForm, setQrModalForm] = useState<PublicFormItem | null>(null);

  // Edit Template modal — editing a custom (user-saved) template's name and
  // fields in place. Built-in templates aren't editable here (see
  // updateFormTemplate's doc comment in local-data.ts).
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateEditName, setTemplateEditName] = useState('');
  const [templateEditFields, setTemplateEditFields] = useState<FormField[]>([]);
  const [templateEditDescription, setTemplateEditDescription] = useState('');

  // Manage Templates modal — a direct entry point to edit/delete a custom
  // template without first having to start building a new form and select
  // it from the dropdown.
  const [isManageTemplatesOpen, setIsManageTemplatesOpen] = useState(false);

  // Form Creator State
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [closeAt, setCloseAt] = useState(''); // datetime-local string; '' = never closes
  const [headerText, setHeaderText] = useState('');
  const [headerImageUrl, setHeaderImageUrl] = useState('');
  const [headerFraming, setHeaderFraming] = useState<HeaderFraming>(DEFAULT_HEADER_FRAMING);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState('');
  const [backgroundBlur, setBackgroundBlur] = useState(0);
  const [backgroundDim, setBackgroundDim] = useState(10);
  const [committee, setCommittee] = useState('Senior Student Leadership');
  const [eventId, setEventId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [fields, setFields] = useState<FormField[]>([
    { id: 'field_1', label: 'Full Name', type: 'text', required: true },
    { id: 'field_2', label: 'University Email', type: 'email', required: true }
  ]);

  // Selected Form for submissions view
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'charts'>('table');
  // Received Submissions table paging (same Rows-per-page pattern as the Members directory)
  const [subPageSize, setSubPageSize] = useState(10);
  const [subPage, setSubPage] = useState(1);

  // Notification States
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const refreshData = () => {
      const loadedForms = getForms();
      setForms(loadedForms);
      setSubmissions(getSubmissions());
      setTemplates(getFormTemplates());
      setEvents(getEvents());
      setTasks(getTasks());
    };
    refreshData();

    const loadedForms = getForms();
    if (loadedForms.length > 0) {
      setSelectedFormId(loadedForms[0].id);
    }

    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error(e);
      }
    }

    window.addEventListener('rtbi-data-sync', refreshData);
    window.addEventListener('storage', refreshData);
    return () => {
      window.removeEventListener('rtbi-data-sync', refreshData);
      window.removeEventListener('storage', refreshData);
    };
  }, []);

  const triggerNotification = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleOpenCreate = () => {
    setTitle('');
    setSlug('');
    setDescription('');
    setCloseAt('');
    setHeaderText('');
    setHeaderImageUrl('');
    setHeaderFraming(DEFAULT_HEADER_FRAMING);
    setBackgroundImageUrl('');
    setBackgroundBlur(0);
    setBackgroundDim(10);
    setCommittee(user?.committee === 'All Committees' ? 'Senior Student Leadership' : user?.committee || 'Senior Student Leadership');
    setEventId('');
    setSelectedTemplateId('');
    setFields([
      { id: 'f_1', label: 'Full Name', type: 'text', required: true },
      { id: 'f_2', label: 'University Email', type: 'email', required: true }
    ]);
    setFormError('');
    setIsCreateModalOpen(true);
  };

  const handleOpenEdit = (form: PublicFormItem) => {
    setEditingForm(form);
    setTitle(form.title);
    setSlug(form.slug);
    setDescription(form.description);
    setCloseAt(toLocalInput(form.closeAt));
    setHeaderText(form.headerText || '');
    setHeaderImageUrl(form.headerImageUrl || '');
    setHeaderFraming({
      posX: form.headerPosX ?? DEFAULT_HEADER_FRAMING.posX,
      posY: form.headerPosY ?? DEFAULT_HEADER_FRAMING.posY,
      zoom: form.headerZoom ?? DEFAULT_HEADER_FRAMING.zoom,
      height: form.headerHeight ?? DEFAULT_HEADER_FRAMING.height,
    });
    setBackgroundImageUrl(form.backgroundImageUrl || '');
    setBackgroundBlur(form.backgroundBlur ?? 0);
    setBackgroundDim(form.backgroundDim ?? 10);
    setCommittee(form.committee);
    setEventId(form.eventId || '');
    setSelectedTemplateId('');
    setFields(form.fields);
    setFormError('');
  };

  const handleApplyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) {
      setFields([
        { id: 'f_1', label: 'Full Name', type: 'text', required: true },
        { id: 'f_2', label: 'University Email', type: 'email', required: true }
      ]);
      return;
    }
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setFields(template.fields.map((f, i) => ({ ...f, id: `field_${Date.now()}_${i}` })));
      if (templateId === FEEDBACK_FORM_TEMPLATE_ID) {
        // An event may already be linked (e.g. picked before the template),
        // so the very first auto-title/slug already reflects it rather than
        // only picking up the event on a later handleEventLink call.
        const linkedEvent = events.find(ev => ev.id === eventId);
        setTitle(linkedEvent ? `Feedback Form – ${linkedEvent.title}` : 'Feedback Form');
      } else if (!title || title.trim() === '') {
        setTitle(template.name.replace(' Template', ''));
      }
      if (!slug || slug.trim() === '') {
        const linkedEvent = events.find(ev => ev.id === eventId);
        const slugSource = templateId === FEEDBACK_FORM_TEMPLATE_ID
          ? (linkedEvent ? `Feedback Form – ${linkedEvent.title}` : 'Feedback Form')
          : template.name.replace(/template/gi, '');
        setSlug(slugify(slugSource));
      }
    }
  };

  const handleEventLink = (newEventId: string) => {
    // Whether slug is still tracking the (pre-update) title automatically,
    // i.e. the user hasn't typed a custom slug over it — checked BEFORE
    // title changes below, since this is what decides whether it's still
    // safe to overwrite.
    const looksAutoSlug = slug === '' || slug === slugify(title);
    setEventId(newEventId);
    // Keep an auto-generated Feedback Form title (and, as long as it hasn't
    // been hand-edited, its slug) in sync with whichever event is currently
    // linked — every event's feedback form otherwise ends up sharing the
    // same generic "feedback-form" slug instead of one that actually
    // identifies which event it belongs to.
    if (selectedTemplateId === FEEDBACK_FORM_TEMPLATE_ID && (title === '' || title === 'Feedback Form' || title.startsWith('Feedback Form – '))) {
      const linkedEvent = events.find(ev => ev.id === newEventId);
      const newTitle = linkedEvent ? `Feedback Form – ${linkedEvent.title}` : 'Feedback Form';
      setTitle(newTitle);
      if (looksAutoSlug) {
        setSlug(slugify(newTitle));
      }
    }
  };

  const handleSaveTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateNameDraft.trim()) return;
    addFormTemplate({
      name: templateNameDraft.trim(),
      fields,
      createdBy: user?.name || 'User'
    });
    setTemplates(getFormTemplates());
    setTemplateNameDraft('');
    setIsSaveTemplateOpen(false);
    triggerNotification('Field schema saved as a reusable template.');
  };

  const handleDeleteTemplate = (templateId: string) => {
    const t = templates.find((x) => x.id === templateId);
    if (!window.confirm(`Delete the template "${t?.name || ''}"? Forms already created from it are not affected.${isBuiltInTemplate(templateId) ? ' You can restore this built-in template later from Manage Templates.' : ''}`)) return;
    deleteFormTemplate(templateId, user?.name || 'User');
    setTemplates(getFormTemplates());
    if (selectedTemplateId === templateId) setSelectedTemplateId('');
  };

  const handleRestoreTemplate = (templateId: string) => {
    restoreBuiltInTemplate(templateId, user?.name || 'User');
    setTemplates(getFormTemplates());
    triggerNotification('Built-in template restored to its original version.');
  };

  const handleOpenEditTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;
    setEditingTemplateId(templateId);
    setTemplateEditName(template.name);
    setTemplateEditFields(template.fields.map(f => ({ ...f })));
    setTemplateEditDescription(template.description || '');
  };

  const handleSaveTemplateEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplateId || !templateEditName.trim() || templateEditFields.length === 0) return;
    updateFormTemplate(editingTemplateId, { name: templateEditName.trim(), description: templateEditDescription.trim() || undefined, fields: templateEditFields }, user?.name || 'User');
    setTemplates(getFormTemplates());
    setEditingTemplateId(null);
    triggerNotification('Template updated.');
  };

  const addEditTemplateField = () => {
    setTemplateEditFields([...templateEditFields, { id: 'field_' + Date.now(), label: 'New Question / Field', type: 'text', required: false }]);
  };

  const removeEditTemplateField = (index: number) => {
    if (templateEditFields.length <= 1) return;
    setTemplateEditFields(templateEditFields.filter((_, i) => i !== index));
  };

  const updateEditTemplateField = (index: number, key: keyof FormField, value: any) => {
    setTemplateEditFields((prev) => prev.map((f, i) => i === index ? { ...f, [key]: value } : f));
  };

  const addField = () => {
    setFields([...fields, { id: 'field_' + Date.now(), label: 'New Question / Field', type: 'text', required: false }]);
  };

  const removeField = (index: number) => {
    if (fields.length <= 1) return;
    setFields(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, key: keyof FormField, value: any) => {
    // Functional update so several onChange calls in one handler (e.g. clearing a default's value + source) all apply
    setFields((prev) => prev.map((f, i) => i === index ? { ...f, [key]: value } : f));
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!title.trim() || !slug.trim()) {
      setFormError('Form Title and Public URL Slug are required.');
      return;
    }

    const formattedSlug = slug.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const linkedEvent = eventId ? events.find(ev => ev.id === eventId) : undefined;

    if (editingForm) {
      if (!isSlugUnique(formattedSlug, editingForm.id)) {
        setFormError(`The slug "${formattedSlug}" is already taken by another form. Choose a unique slug.`);
        return;
      }
      const changes = {
        title,
        slug: formattedSlug,
        description,
        closeAt: fromLocalInput(closeAt),
        headerText: headerText.trim() || undefined,
        headerImageUrl: headerImageUrl || undefined,
        headerPosX: headerImageUrl ? headerFraming.posX : undefined,
        headerPosY: headerImageUrl ? headerFraming.posY : undefined,
        headerZoom: headerImageUrl ? headerFraming.zoom : undefined,
        headerHeight: headerImageUrl ? headerFraming.height : undefined,
        backgroundImageUrl: backgroundImageUrl || undefined,
        backgroundBlur: backgroundImageUrl ? backgroundBlur : undefined,
        backgroundDim: backgroundImageUrl ? backgroundDim : undefined,
        committee,
        fields,
        eventId: eventId || undefined,
        eventName: linkedEvent?.title,
      };
      const approval = getFormApprovalRequirement(user, 'EDIT');
      if (approval.requiresApproval) {
        submitFormEdit(editingForm.id, changes, user?.name || 'User', user?.email || '', {
          approverType: approval.approverType,
          approverMemberId: approval.approverMemberId,
          approverPolicyTagId: approval.approverPolicyTagId,
          policyName: approval.policyName,
        });
        triggerNotification(`Edit submitted for approval to ${approval.approverName}. The live link keeps showing the current version until then.`);
      } else {
        updateForm(editingForm.id, changes, user?.name || 'User');
        triggerNotification('Public form updated successfully.');
      }
      setEditingForm(null);
    } else {
      if (!isSlugUnique(formattedSlug)) {
        setFormError(`The slug "${formattedSlug}" is already taken by another form. Choose a unique slug.`);
        return;
      }
      const newFormBase = {
        title,
        slug: formattedSlug,
        description,
        closeAt: fromLocalInput(closeAt),
        headerText: headerText.trim() || undefined,
        headerImageUrl: headerImageUrl || undefined,
        headerPosX: headerImageUrl ? headerFraming.posX : undefined,
        headerPosY: headerImageUrl ? headerFraming.posY : undefined,
        headerZoom: headerImageUrl ? headerFraming.zoom : undefined,
        headerHeight: headerImageUrl ? headerFraming.height : undefined,
        backgroundImageUrl: backgroundImageUrl || undefined,
        backgroundBlur: backgroundImageUrl ? backgroundBlur : undefined,
        backgroundDim: backgroundImageUrl ? backgroundDim : undefined,
        committee,
        fields,
        eventId: eventId || undefined,
        eventName: linkedEvent?.title,
        createdBy: user?.name || 'User',
        status: 'active' as const,
        sourceTemplateId: selectedTemplateId || undefined,
      };
      const approval = getFormApprovalRequirement(user, 'CREATE');
      if (approval.requiresApproval) {
        addForm({
          ...newFormBase,
          approvalStatus: 'pending_create',
          approverType: approval.approverType,
          approverMemberId: approval.approverMemberId,
          approverPolicyTagId: approval.approverPolicyTagId,
          approvalPolicyName: approval.policyName,
          submittedBy: user?.name,
          submittedByEmail: user?.email,
        });
        triggerNotification(`Form submitted for approval to ${approval.approverName}. Its public link goes live once approved.`);
      } else {
        addForm(newFormBase);
        triggerNotification('New dynamic public form created successfully. QR Code is ready.');
      }
      setIsCreateModalOpen(false);
    }

    const updated = getForms();
    setForms(updated);

    // Auto-open QR preview for newly created form if it wasn't an edit — but
    // only once it's actually live. A form awaiting Centre Head sign-off
    // (approvalStatus === 'pending_create') has no working /forms/{slug}
    // page yet (see PublicFormPage — pending/rejected forms render "Form Not
    // Found"), so surfacing a scannable QR for it here would just hand out a
    // broken link. The list view already hides the QR button for pending
    // forms (see the row's QrCode button below); this mirrors that guard.
    if (!editingForm) {
      const newlyCreated = updated.find(f => f.slug.toLowerCase() === formattedSlug.toLowerCase());
      if (newlyCreated) {
        setSelectedFormId(newlyCreated.id);
        if (newlyCreated.approvalStatus !== 'pending_create') {
          setQrModalForm(newlyCreated);
        }
      }
    }
  };

  const handleConfirmDelete = () => {
    if (!deletingFormId) return;
    const approval = getFormApprovalRequirement(user, 'DELETE');
    if (approval.requiresApproval) {
      submitFormDelete(deletingFormId, user?.name || 'User', user?.email || '', {
        approverType: approval.approverType,
        approverMemberId: approval.approverMemberId,
        approverPolicyTagId: approval.approverPolicyTagId,
        policyName: approval.policyName,
      });
      triggerNotification(`Deletion submitted for approval to ${approval.approverName}. The form stays live until then.`);
      setDeletingFormId(null);
      setForms(getForms());
      return;
    }
    deleteForm(deletingFormId, user?.name || 'User');
    setDeletingFormId(null);
    const updated = getForms();
    setForms(updated);
    setSubmissions(getSubmissions());
    if (selectedFormId === deletingFormId && updated.length > 0) {
      setSelectedFormId(updated[0].id);
    }
    triggerNotification('Public form deleted.');
  };

  const handleConfirmDeleteResponse = () => {
    if (!deletingResponse || !selectedForm) return;
    const ids = deletingResponse === 'ALL'
      ? selectedSubmissions.map(s => s.id)
      : [deletingResponse];
    ids.forEach(id => deleteSubmission(id, user?.name || 'User'));
    setDeletingResponse(null);
    setSubmissions(getSubmissions());
    setSubPage(1);
    triggerNotification(ids.length === 1 ? 'Response deleted.' : `${ids.length} responses deleted.`);
  };

  const handleApproveForm = (id: string) => {
    const wasDelete = forms.find(f => f.id === id)?.approvalStatus === 'pending_delete';
    approveForm(id, user?.name || 'User');
    setForms(getForms());
    if (wasDelete) setSubmissions(getSubmissions());
    triggerNotification(wasDelete ? 'Approved. The form has been deleted.' : 'Approved. The form is now live.');
  };

  const handleConfirmRejectForm = () => {
    if (!rejectingFormId) return;
    rejectForm(rejectingFormId, user?.name || 'User', rejectionReasonInput || undefined);
    setForms(getForms());
    setRejectingFormId(null);
    setRejectionReasonInput('');
    triggerNotification('Rejected.');
  };

  const handleDownloadSubmissionsCsv = () => {
    if (!selectedForm || selectedSubmissions.length === 0) return;
    const headers = ['Timestamp', ...selectedForm.fields.map(f => f.label)];
    const rows = selectedSubmissions.map(sub => [
      sub.submittedAt,
      ...selectedForm.fields.map(f => sub.data[f.id] ?? sub.data[f.label] ?? ''),
    ]);
    const csv = [headers, ...rows].map(row => row.map(escapeCsvValue).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedForm.slug}-submissions.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadFilledWord = (submissionId: string) => {
    window.open(`/api/submissions/${submissionId}/word`, '_blank');
  };

  const handleCopyLink = (formSlug: string) => {
    const linkUrl = `${window.location.origin}/forms/${formSlug}`;
    navigator.clipboard.writeText(linkUrl);
    setCopiedSlug(formSlug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  // PRD Gating: Super User (Tier 1) and Core Committee (Tier 5)
  const canBuild = canCreateForms(user);
  // Training Associates see (and can manage) only the forms they created; the server filters the data the same way.
  const onlyOwnForms = seesOnlyOwnForms(user);
  // Response data (submissions, exports, analytics) is more sensitive than
  // the form's own metadata/share link, which stays visible to everyone who
  // can reach this page — form-builders always see it, others only with an
  // explicit FORMS_VIEW_RESPONSES grant. Previously ungated entirely.
  const canViewResponses = canBuild || hasCapability(user, 'FORMS_VIEW_RESPONSES');
  // Deleting a response is permanent: form deleters, or a Training Associate on a form they created (the server enforces the same).
  const canDeleteResponses = (form: PublicFormItem | undefined) =>
    !!form && canViewResponses && (canDeleteForms(user) || (onlyOwnForms && isOwnForm(form, user)));

  // Visibility: a pending/rejected submission is only shown to its submitter, its
  // resolved approver, and the Super User — mirrors the same rule on Events/Tasks.
  const canSeeFormApprovalMeta = (form: PublicFormItem) =>
    user?.tier === 1 || form.submittedByEmail === user?.email || canApprovePendingForm(form, user);
  const displayedForms = forms.filter(form => {
    if (onlyOwnForms && !isOwnForm(form, user)) return false;
    if (form.approvalStatus === 'pending_create' || form.approvalStatus === 'rejected') {
      return canSeeFormApprovalMeta(form);
    }
    return true;
  });

  const selectedForm = displayedForms.find(f => f.id === selectedFormId) || displayedForms[0];
  const selectedSubmissions = selectedForm ? submissions.filter(s => s.formId === selectedForm.id || s.slug === selectedForm.slug) : [];
  const subTotalPages = Math.max(1, Math.ceil(selectedSubmissions.length / subPageSize));
  const subCurrentPage = Math.min(subPage, subTotalPages);
  const subStart = (subCurrentPage - 1) * subPageSize;
  const pagedSubmissions = selectedSubmissions.slice(subStart, subStart + subPageSize);

  return (
    <div className="p-6 md:p-8 space-y-6">
      
      {/* Alert Notification */}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-success/15 border border-success/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Header section with Create Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary">Public Forms & Registration Builder</h1>
          <p className="text-xs text-theme-text-secondary">
            {onlyOwnForms
              ? 'Build your own public forms. You can see only the forms you create, and each one goes live once the Centre Head, Advisor, Super User or GG Campus Events Head approves it.'
              : 'Generate responsive, shareable student registration and survey links'}
          </p>
        </div>
        {canBuild ? (
          <div className="flex items-center gap-2">
            {!onlyOwnForms && (
              <button
                onClick={() => setIsManageTemplatesOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                <LayoutTemplate className="h-4 w-4" />
                Manage Templates
              </button>
            )}
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Build New Form
            </button>
          </div>
        ) : (
          <span className="text-xs text-theme-text-secondary italic">
            Form creation permissions: Super User (Tier 1) & Core Committee (Tier 5)
          </span>
        )}
      </div>

      {/* Top-of-page stats summary bar */}
      {forms.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="glass-panel rounded-2xl p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <FileText className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-lg font-bold text-theme-text-primary leading-none">{forms.length}</p>
              <p className="text-[10px] text-theme-text-secondary mt-1">Total Forms</p>
            </div>
          </div>
          <div className="glass-panel rounded-2xl p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
              <Users className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-lg font-bold text-theme-text-primary leading-none">{submissions.length}</p>
              <p className="text-[10px] text-theme-text-secondary mt-1">Total Responses</p>
            </div>
          </div>
          <div className="glass-panel rounded-2xl p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center shrink-0">
              <TrendingUp className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-lg font-bold text-theme-text-primary leading-none">
                {submissions.filter(s => {
                  const d = new Date(s.submittedAt);
                  const weekAgo = new Date();
                  weekAgo.setDate(weekAgo.getDate() - 7);
                  return !isNaN(d.getTime()) && d >= weekAgo;
                }).length}
              </p>
              <p className="text-[10px] text-theme-text-secondary mt-1">Responses This Week</p>
            </div>
          </div>
          <div className="glass-panel rounded-2xl p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0">
              <LayoutTemplate className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-lg font-bold text-theme-text-primary leading-none">{templates.length}</p>
              <p className="text-[10px] text-theme-text-secondary mt-1">Saved Templates</p>
            </div>
          </div>
        </div>
      )}

      {/* Forms and Responses Layout */}
      {forms.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No public forms configured"
          description="Create custom registration forms for conferences, hackathons, and symposiums."
          actionLabel={canBuild ? "Build New Form" : undefined}
          onAction={canBuild ? handleOpenCreate : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Active Forms List */}
          <div className="glass-panel rounded-2xl p-6 lg:col-span-1 space-y-4 flex flex-col">
            <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider">
              Published Forms ({displayedForms.length})
            </h3>

            <div className="space-y-3 flex-1 overflow-y-auto max-h-[600px] pr-1">
              {displayedForms.map(form => {
                const isSelected = selectedForm?.id === form.id;
                const formSubs = submissions.filter(s => s.formId === form.id || s.slug === form.slug);

                return (
                  <div
                    key={form.id}
                    onClick={() => { setSelectedFormId(form.id); setSubPage(1); }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2.5 text-xs ${
                      isSelected
                        ? 'bg-accent/10 border-accent/40 shadow-sm'
                        : 'bg-theme-border/10 border-theme-border/20 hover:bg-theme-border/20'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="font-bold text-theme-text-primary text-xs leading-snug">{form.title}</h4>
                          {form.isSample && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-warning/15 text-warning border border-warning/20">
                              Sample
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-theme-text-secondary mt-0.5 font-mono">/forms/{form.slug}</p>
                        {form.closeAt && !isNaN(Date.parse(form.closeAt)) && (
                          <p className={`text-[10px] mt-0.5 font-semibold ${isFormClosed(form) ? 'text-danger' : 'text-theme-text-secondary'}`}>
                            {isFormClosed(form) ? 'Closed' : 'Closes'} {formatCloseAt(form.closeAt)}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/15 text-accent">
                        {formSubs.length} responses
                      </span>
                    </div>

                    {(form.approvalStatus === 'pending_create' || form.approvalStatus === 'pending_edit' || form.approvalStatus === 'pending_delete') && canSeeFormApprovalMeta(form) && (
                      <div className={`flex items-center justify-between gap-2 p-2 border rounded-lg text-[10px] ${form.approvalStatus === 'pending_delete' ? 'bg-danger/10 border-danger/25' : 'bg-warning/10 border-warning/25'}`}>
                        <div className={`flex items-center gap-1 font-semibold ${form.approvalStatus === 'pending_delete' ? 'text-danger' : 'text-warning'}`}>
                          <Clock className="h-3 w-3 shrink-0" />
                          <span>
                            {form.approvalStatus === 'pending_delete' ? 'Deletion awaiting approval' : form.approvalStatus === 'pending_edit' ? 'Edit awaiting approval' : 'Awaiting approval'}
                          </span>
                        </div>
                        {canApprovePendingForm(form, user) && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleApproveForm(form.id); }}
                              className="p-0.5 hover:bg-success/15 rounded text-success cursor-pointer"
                              title="Approve"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setRejectingFormId(form.id); }}
                              className="p-0.5 hover:bg-danger/15 rounded text-danger cursor-pointer"
                              title="Reject"
                            >
                              <Ban className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {form.approvalStatus === 'rejected' && canSeeFormApprovalMeta(form) && (
                      <div className="flex items-center gap-1 p-2 bg-danger/10 border border-danger/25 rounded-lg text-[10px] text-danger font-semibold">
                        <Ban className="h-3 w-3 shrink-0" />
                        <span>Rejected by {form.decidedBy || 'approver'}{form.rejectionReason ? `: ${form.rejectionReason}` : ''}</span>
                      </div>
                    )}

                    <p className="text-[11px] text-theme-text-secondary line-clamp-1">
                      {form.description || `${form.fields.length} question fields`}
                    </p>

                    {form.eventName && (
                      <p className="text-[10px] text-accent flex items-center gap-1 font-semibold">
                        <CalendarDays className="h-3 w-3" />
                        Linked to {form.eventName}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-1 border-t border-theme-border/20 text-[11px]">
                      {form.approvalStatus === 'pending_create' ? (
                        <span className="text-theme-text-secondary italic">Link generates once approved</span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyLink(form.slug);
                          }}
                          className="text-accent hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Copy className="h-3 w-3" />
                          {copiedSlug === form.slug ? 'Copied Link!' : 'Copy Link'}
                        </button>
                      )}

                      <div className="flex items-center gap-1.5">
                        {form.approvalStatus !== 'pending_create' && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setQrModalForm(form);
                              }}
                              className="p-1 hover:bg-accent/15 rounded text-accent hover:text-accent cursor-pointer"
                              title="Preview & Download QR Code"
                            >
                              <QrCode className="h-3.5 w-3.5" />
                            </button>
                            <Link
                              href={`/forms/${form.slug}`}
                              target="_blank"
                              onClick={(e) => e.stopPropagation()}
                              className="p-1 hover:bg-theme-border/30 rounded text-theme-text-secondary hover:text-theme-text-primary"
                              title="Open Public Form View"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Link>
                          </>
                        )}
                        {canBuild && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEdit(form);
                              }}
                              className="p-1 hover:bg-theme-border/30 rounded text-theme-text-secondary hover:text-accent cursor-pointer"
                              title="Edit Form"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            {form.approvalStatus !== 'pending_delete' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingFormId(form.id);
                                }}
                                className="p-1 hover:bg-danger/10 rounded text-danger cursor-pointer"
                                title="Delete Form"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Submissions & Form Preview Inspector */}
          <div className="glass-panel rounded-2xl p-6 lg:col-span-2 space-y-5">
            {selectedForm ? (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-theme-border/30">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-theme-text-primary">{selectedForm.title}</h3>
                      {selectedForm.isSample && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/20">
                          Sample Dataset
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-theme-text-secondary mt-0.5">
                      Public URL: <code className="text-accent font-mono">/forms/{selectedForm.slug}</code> &middot; Created by {selectedForm.createdBy}
                    </p>
                    {selectedForm.eventName && (
                      <p className="text-[11px] text-accent mt-1 flex items-center gap-1 font-semibold">
                        <CalendarDays className="h-3.5 w-3.5" />
                        Linked to event: {selectedForm.eventName}
                      </p>
                    )}
                  </div>
                  {selectedForm.approvalStatus === 'pending_create' ? (
                    <span className="text-xs text-warning font-semibold flex items-center gap-1.5 self-start sm:self-auto">
                      <Clock className="h-3.5 w-3.5" /> Link generates once approved
                    </span>
                  ) : (
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <button
                        onClick={() => setQrModalForm(selectedForm)}
                        className="px-3 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent text-xs font-semibold rounded-xl transition-all border border-accent/30 cursor-pointer flex items-center gap-1.5"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        QR Code & Print
                      </button>
                      <button
                        onClick={() => handleCopyLink(selectedForm.slug)}
                        className="px-3 py-1.5 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copiedSlug === selectedForm.slug ? 'Copied!' : 'Share Link'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Submissions: Table / Charts toggle */}
                {canViewResponses ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">
                      Received Submissions ({selectedSubmissions.length})
                    </h4>
                    <div className="flex items-center gap-2">
                      {selectedSubmissions.length > 0 && canDeleteResponses(selectedForm) && (
                        <button
                          onClick={() => setDeletingResponse('ALL')}
                          className="px-2.5 py-1 bg-danger/10 hover:bg-danger/20 text-danger rounded-lg transition-all text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                          title="Delete every response to this form"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete all
                        </button>
                      )}
                      {selectedSubmissions.length > 0 && (
                        <button
                          onClick={handleDownloadSubmissionsCsv}
                          className="px-2.5 py-1 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary rounded-lg transition-all text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                          title="Download all responses as CSV"
                        >
                          <FileDown className="h-3.5 w-3.5" />
                          CSV
                        </button>
                      )}
                      <div className="flex items-center gap-1 bg-theme-border/20 rounded-xl p-1">
                        <button
                          onClick={() => setViewMode('table')}
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${viewMode === 'table' ? 'bg-accent text-white' : 'text-theme-text-secondary'}`}
                        >
                          <Table2 className="h-3 w-3" /> Table
                        </button>
                        <button
                          onClick={() => setViewMode('charts')}
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${viewMode === 'charts' ? 'bg-accent text-white' : 'text-theme-text-secondary'}`}
                        >
                          <BarChart3 className="h-3 w-3" /> Charts
                        </button>
                      </div>
                    </div>
                  </div>

                  {selectedSubmissions.length === 0 ? (
                    <div className="text-center py-12 text-theme-text-secondary text-xs bg-theme-border/5 rounded-xl border border-theme-border/20">
                      No student responses submitted yet for this form link.
                    </div>
                  ) : viewMode === 'table' ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs text-left">
                        <thead>
                          <tr className="text-theme-text-secondary border-b border-theme-border/40 text-xs">
                            <th className="pb-3 font-semibold">Timestamp</th>
                            {selectedForm.fields.map(f => (
                              <th key={f.id} className="pb-3 font-semibold">{f.label}</th>
                            ))}
                            {selectedForm.sourceTemplateId === FEEDBACK_FORM_TEMPLATE_ID && (
                              <th className="pb-3 font-semibold">Filled Copy</th>
                            )}
                            {canDeleteResponses(selectedForm) && <th className="pb-3 font-semibold">Delete</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border/20">
                          {pagedSubmissions.map(sub => (
                            <tr key={sub.id} className="hover:bg-theme-border/10 transition-all text-xs">
                              <td className="py-3 pr-2 text-theme-text-secondary whitespace-nowrap">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {sub.submittedAt}
                                </span>
                              </td>
                              {selectedForm.fields.map(f => {
                                const val = sub.data[f.id] ?? sub.data[f.label];
                                const display = Array.isArray(val) ? (val.length > 0 ? val.join(', ') : '—') : String(val || '—');
                                return (
                                  <td key={f.id} className="py-3 pr-3 text-theme-text-primary max-w-xs truncate">
                                    {display}
                                  </td>
                                );
                              })}
                              {selectedForm.sourceTemplateId === FEEDBACK_FORM_TEMPLATE_ID && (
                                <td className="py-3 pr-3">
                                  <button
                                    onClick={() => handleDownloadFilledWord(sub.id)}
                                    className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg text-blue-400 transition-all cursor-pointer"
                                    title="Download filled feedback form (.docx)"
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              )}
                              {canDeleteResponses(selectedForm) && (
                                <td className="py-3 pr-3">
                                  <button
                                    onClick={() => setDeletingResponse(sub.id)}
                                    className="p-1.5 bg-danger/10 hover:bg-danger/20 rounded-lg text-danger transition-all cursor-pointer"
                                    title="Delete this response"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-1 border-t border-theme-border/20 text-xs text-theme-text-secondary">
                        <div className="flex items-center gap-2">
                          <span>Rows per page:</span>
                          <select
                            value={subPageSize}
                            onChange={(e) => { setSubPageSize(Number(e.target.value)); setSubPage(1); }}
                            className="px-2 py-1 bg-theme-background/40 border border-theme-border/40 rounded-lg text-xs text-theme-text-primary focus:outline-none"
                          >
                            <option value={10}>10</option>
                            <option value={15}>15</option>
                            <option value={20}>20</option>
                          </select>
                          <span>
                            Showing <strong>{subStart + 1}–{Math.min(subStart + subPageSize, selectedSubmissions.length)}</strong> of <strong>{selectedSubmissions.length}</strong>
                          </span>
                        </div>
                        {subTotalPages > 1 && (
                          <div className="flex items-center gap-2">
                            <span>Page <strong>{subCurrentPage}</strong> of <strong>{subTotalPages}</strong></span>
                            <button type="button" onClick={() => setSubPage(Math.max(1, subCurrentPage - 1))} disabled={subCurrentPage === 1} className="p-1.5 rounded-lg border border-theme-border/30 hover:bg-theme-border/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-theme-text-primary" aria-label="Previous page">
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => setSubPage(Math.min(subTotalPages, subCurrentPage + 1))} disabled={subCurrentPage === subTotalPages} className="p-1.5 rounded-lg border border-theme-border/30 hover:bg-theme-border/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-theme-text-primary" aria-label="Next page">
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    (() => {
                      const chartableFields = selectedForm.fields.filter(f => CHARTABLE_TYPES.includes(f.type));
                      const scaleFields = selectedForm.fields.filter(f => f.type === 'scale');
                      const scaleAverages = scaleFields
                        .map(f => computeAverage(f, selectedSubmissions))
                        .filter((v): v is number => v !== null);
                      const overallAverage = scaleAverages.length > 0
                        ? scaleAverages.reduce((a, b) => a + b, 0) / scaleAverages.length
                        : null;
                      const weekAgo = new Date();
                      weekAgo.setDate(weekAgo.getDate() - 7);
                      const thisWeekCount = selectedSubmissions.filter(s => {
                        const d = new Date(s.submittedAt);
                        return !isNaN(d.getTime()) && d >= weekAgo;
                      }).length;
                      const trendData = buildSubmissionsByDay(selectedSubmissions);

                      return (
                        <div className="space-y-4">
                          {/* Analytics stats row */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <div className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl">
                              <p className="text-lg font-bold text-theme-text-primary leading-none">{selectedSubmissions.length}</p>
                              <p className="text-[10px] text-theme-text-secondary mt-1">Total Responses</p>
                            </div>
                            <div className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl">
                              <p className="text-lg font-bold text-theme-text-primary leading-none">{thisWeekCount}</p>
                              <p className="text-[10px] text-theme-text-secondary mt-1">This Week</p>
                            </div>
                            {overallAverage !== null && (
                              <div className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl">
                                <p className="text-lg font-bold text-accent leading-none">{overallAverage.toFixed(1)} / 5.0</p>
                                <p className="text-[10px] text-theme-text-secondary mt-1">Overall Avg. Rating</p>
                              </div>
                            )}
                          </div>

                          {/* Submissions-over-time trend */}
                          {trendData.length > 1 && (
                            <div className="p-4 bg-theme-border/10 border border-theme-border/20 rounded-xl space-y-2">
                              <h5 className="text-xs font-bold text-theme-text-primary flex items-center gap-1.5">
                                <TrendingUp className="h-3.5 w-3.5 text-accent" />
                                Responses Over Time
                              </h5>
                              <div className="h-40 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="date" tick={{ fill: 'currentColor', fontSize: 9 }} />
                                    <YAxis allowDecimals={false} domain={[0, chartCountDomainMax(Math.max(...trendData.map(d => d.count)))]} tick={{ fill: 'currentColor', fontSize: 10 }} />
                                    <Tooltip
                                      formatter={(value: any) => [`${value} response${value === 1 ? '' : 's'}`, 'Responses']}
                                      contentStyle={{
                                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                                        borderColor: 'rgba(255,255,255,0.1)',
                                        borderRadius: '12px',
                                        fontSize: '11px'
                                      }}
                                    />
                                    <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                          )}

                          {/* Full analysis (summary stats, outcomes, segments, drivers, comment themes) for forms built from the Feedback Form Template */}
                          {selectedForm.sourceTemplateId === FEEDBACK_FORM_TEMPLATE_ID && (
                            <FeedbackAnalysisPanel form={selectedForm} submissions={selectedSubmissions} />
                          )}

                          {chartableFields.length === 0 ? (
                            <div className="text-center py-12 text-theme-text-secondary text-xs bg-theme-border/5 rounded-xl border border-theme-border/20">
                              This form has no scale, number, or choice questions to chart yet — open text answers can't be charted.
                            </div>
                          ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {chartableFields.map(f => {
                            const isNumeric = f.type === 'scale' || f.type === 'number';
                            const data = f.type === 'scale' ? buildScaleChartData(f, selectedSubmissions) : buildCategoryChartData(f, selectedSubmissions);
                            const average = isNumeric ? computeAverage(f, selectedSubmissions) : null;
                            return (
                              <div key={f.id} className="p-4 bg-theme-border/10 border border-theme-border/20 rounded-xl space-y-2">
                                <div className="flex items-center justify-between">
                                  <h5 className="text-xs font-bold text-theme-text-primary">{f.label}</h5>
                                  {average !== null && (
                                    <span className="flex items-center gap-1 text-[11px] font-bold text-accent">
                                      <Gauge className="h-3 w-3" />
                                      Avg {average.toFixed(1)}{f.type === 'scale' ? ' / 5.0' : ''}
                                    </span>
                                  )}
                                </div>
                                {data.length === 0 ? (
                                  <p className="text-[11px] text-theme-text-secondary py-6 text-center">No responses to this question yet.</p>
                                ) : (
                                  <div className="h-48 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                      <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                        <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 10 }} interval={0} angle={f.type === 'scale' ? 0 : -20} textAnchor={f.type === 'scale' ? 'middle' : 'end'} />
                                        <YAxis allowDecimals={false} domain={[0, chartCountDomainMax(Math.max(...data.map(d => d.count)))]} tick={{ fill: 'currentColor', fontSize: 10 }} />
                                        <Tooltip
                                          formatter={(value: any) => [`${value} response${value === 1 ? '' : 's'}`, f.label]}
                                          contentStyle={{
                                            backgroundColor: 'rgba(15, 23, 42, 0.9)',
                                            borderColor: 'rgba(255,255,255,0.1)',
                                            borderRadius: '12px',
                                            fontSize: '11px'
                                          }}
                                        />
                                        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                                          {data.map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                          ))}
                                        </Bar>
                                      </BarChart>
                                    </ResponsiveContainer>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                          )}
                        </div>
                      );
                    })()
                  )}
                </div>
                ) : (
                  <div className="text-center py-12 text-theme-text-secondary text-xs">
                    You don&apos;t have permission to view this form&apos;s responses.
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-theme-text-secondary text-xs">
                Select a published form from the left panel to inspect responses.
              </div>
            )}
          </div>

        </div>
      )}

      {/* Create / Edit Form Modal */}
      {(isCreateModalOpen || editingForm) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-2xl rounded-3xl p-6 flex flex-col space-y-5 relative border border-white/15 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-theme-text-primary">
                {editingForm ? 'Edit Public Form' : 'Build New Public Form'}
              </h2>
              <button 
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setEditingForm(null);
                  setIsSaveTemplateOpen(false);
                }}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-danger/10 border border-danger/25 rounded-xl text-danger text-xs flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {!editingForm && (
              <div className="p-3.5 bg-accent/10 border border-accent/20 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-xs text-theme-text-primary flex items-center gap-1.5">
                    <LayoutTemplate className="h-4 w-4 text-accent" />
                    Select Template (optional)
                  </label>
                  {selectedTemplateId && (
                    <span className="text-[10px] text-accent font-semibold px-2 py-0.5 rounded-md bg-accent/15 border border-accent/25">
                      Template Applied
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <SearchableSelect
                    value={selectedTemplateId}
                    onChange={handleApplyTemplate}
                    allLabel="-- Blank Form (Custom Schema) --"
                    allValue=""
                    className="flex-1"
                    options={templates.map(t => ({ value: t.id, label: `${t.name} (${t.fields.length} fields)` }))}
                  />
                  {selectedTemplateId && !initialFormTemplates.some(it => it.id === selectedTemplateId) && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOpenEditTemplate(selectedTemplateId)}
                        className="p-2.5 hover:bg-accent/10 rounded-xl text-accent transition-all cursor-pointer"
                        title="Edit This Custom Template"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(selectedTemplateId)}
                        className="p-2.5 hover:bg-danger/10 rounded-xl text-danger transition-all cursor-pointer"
                        title="Delete This Custom Template"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
                <p className="text-[10px] text-theme-text-secondary">
                  Choose a pre-built template to auto-populate form questions, or start with blank questions below.
                </p>
              </div>
            )}

            <form onSubmit={handleSaveForm} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Form Title *</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. AI Hackathon Registration 2026"
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block font-medium text-theme-text-secondary">Public Link Slug * (/forms/[slug])</label>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="ai-hackathon-2026"
                    className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Form Header (optional)</label>
                <input
                  type="text"
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder="Banner shown at the very top of the public form, e.g. RTBI Portal · Annual Summit 2026"
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <FormImageField label="Header Picture (optional)" hint="Wide banner across the top of the form." kind="header" value={headerImageUrl} onChange={(url) => { setHeaderImageUrl(url); if (url !== headerImageUrl) setHeaderFraming(DEFAULT_HEADER_FRAMING); }} showPreview={false} />
              {headerImageUrl && <FormHeaderFraming url={headerImageUrl} value={headerFraming} onChange={setHeaderFraming} />}
              <FormImageField label="Background Picture (optional)" hint="Replaces the standard background on this public form only." kind="background" value={backgroundImageUrl} onChange={setBackgroundImageUrl} />
              {backgroundImageUrl && (
                <div className="space-y-2 p-3 rounded-xl border border-theme-card-border">
                  <label className="flex items-center justify-between gap-3 text-theme-text-secondary">
                    <span className="w-24 shrink-0">Blur: {backgroundBlur}px</span>
                    <input type="range" min={0} max={20} step={1} value={backgroundBlur} onChange={(e) => setBackgroundBlur(Number(e.target.value))} className="flex-1 accent-accent" />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-theme-text-secondary">
                    <span className="w-24 shrink-0">Darken: {backgroundDim}%</span>
                    <input type="range" min={0} max={80} step={5} value={backgroundDim} onChange={(e) => setBackgroundDim(Number(e.target.value))} className="flex-1 accent-accent" />
                  </label>
                  <div className="relative h-24 rounded-lg overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={backgroundImageUrl} alt="" className="h-full w-full object-cover scale-110" style={{ filter: `blur(${backgroundBlur}px)` }} />
                    <div className="absolute inset-0 bg-black" style={{ opacity: backgroundDim / 100 }} />
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-white drop-shadow">Live preview</span>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Description / Respondent Instructions</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain event agenda, eligibility, and deadline details..."
                  rows={2}
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Closes On (optional)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="datetime-local"
                    value={closeAt}
                    onChange={(e) => setCloseAt(e.target.value)}
                    className="flex-1 px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent [color-scheme:dark]"
                  />
                  {closeAt && (
                    <button
                      type="button"
                      onClick={() => setCloseAt('')}
                      className="px-3 py-2.5 border border-theme-card-border rounded-xl text-theme-text-secondary hover:bg-theme-border/10 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-theme-text-secondary">
                  Leave empty to keep the form open. After this time, respondents see &quot;Sorry, this form is currently closed. Please contact the administrator.&quot;
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Link to Event (optional)
                </label>
                <SearchableSelect
                  value={eventId}
                  onChange={handleEventLink}
                  allLabel="-- No Event Linked --"
                  allValue=""
                  options={events.filter(ev => isApprovedEvent(ev, tasks)).map(ev => ({ value: ev.id, label: ev.title }))}
                />
              </div>

              {/* Dynamic Field Builder */}
              <div className="space-y-3 pt-2 border-t border-theme-border/20">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-theme-text-primary uppercase tracking-wider">
                    Form Questions & Field Schema ({fields.length})
                  </h4>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setTemplateNameDraft(''); setIsSaveTemplateOpen(true); }}
                      className="px-2.5 py-1 bg-theme-border/30 hover:bg-theme-border/50 text-theme-text-primary rounded-lg transition-all text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                      title="Save these fields as a reusable template"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Save as Template
                    </button>
                    <button
                      type="button"
                      onClick={addField}
                      className="px-2.5 py-1 bg-accent/20 hover:bg-accent text-accent hover:text-white rounded-lg transition-all text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Question
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {fields.map((field, idx) => (
                    <FormFieldEditor
                      key={field.id}
                      field={field}
                      onChange={(key, value) => updateField(idx, key, value)}
                      onRemove={() => removeField(idx)}
                      canRemove={fields.length > 1}
                      eventLinked={Boolean(eventId)}
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer mt-4"
              >
                {editingForm ? 'Save Form Changes' : 'Publish Shareable Form Link'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Save as Template Modal */}
      {isSaveTemplateOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-sm rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-theme-text-primary flex items-center gap-1.5">
                <LayoutTemplate className="h-4 w-4" />
                Save as Template
              </h2>
              <button
                onClick={() => setIsSaveTemplateOpen(false)}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[11px] text-theme-text-secondary">
              Saves the current {fields.length} question field{fields.length === 1 ? '' : 's'} as a reusable template you can start future forms from.
            </p>
            <form onSubmit={handleSaveTemplate} className="space-y-3 text-xs">
              <input
                type="text"
                required
                autoFocus
                value={templateNameDraft}
                onChange={(e) => setTemplateNameDraft(e.target.value)}
                placeholder="e.g. Event Registration — Standard"
                className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
              />
              <button
                type="submit"
                className="w-full py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer"
              >
                Save Template
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Manage Templates Modal — direct entry point to edit/delete a custom
          template without going through the "Build New Form" flow first. */}
      {isManageTemplatesOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-theme-text-primary flex items-center gap-1.5">
                <LayoutTemplate className="h-4 w-4" />
                Manage Templates
              </h2>
              <button
                onClick={() => setIsManageTemplatesOpen(false)}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {(() => {
              const customTemplates = templates.filter(t => !isBuiltInTemplate(t.id));
              const builtInTemplates = templates.filter(t => isBuiltInTemplate(t.id));
              const deletedBuiltIns = getDeletedBuiltInTemplates();
              const row = (t: FormTemplateItem, builtIn: boolean) => (
                <div key={t.id} className="flex items-center justify-between gap-2 p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl">
                  <div className="min-w-0">
                    <p className="font-bold text-theme-text-primary flex items-center gap-1.5 flex-wrap">
                      {t.name}
                      {builtIn && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent">Built-in</span>}
                      {builtIn && t.customized && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">Edited</span>}
                    </p>
                    <p className="text-[10px] text-theme-text-secondary">{t.fields.length} field{t.fields.length === 1 ? '' : 's'}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {builtIn && t.customized && (
                      <button type="button" onClick={() => handleRestoreTemplate(t.id)} className="px-2 py-1.5 hover:bg-theme-border/30 rounded-lg text-theme-text-secondary text-[10px] font-semibold transition-all cursor-pointer" title="Discard your edits and go back to the original">
                        Reset
                      </button>
                    )}
                    <button type="button" onClick={() => { setIsManageTemplatesOpen(false); handleOpenEditTemplate(t.id); }} className="p-2 hover:bg-accent/10 rounded-lg text-accent transition-all cursor-pointer" title="Edit Template">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => handleDeleteTemplate(t.id)} className="p-2 hover:bg-danger/10 rounded-lg text-danger transition-all cursor-pointer" title="Delete Template">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
              return (
                <div className="space-y-4 text-xs">
                  <div className="space-y-2">
                    <p className="font-semibold text-theme-text-secondary uppercase tracking-wider text-[10px]">
                      Your Templates ({customTemplates.length})
                    </p>
                    {customTemplates.length === 0 ? (
                      <div className="text-center py-6 text-theme-text-secondary bg-theme-border/5 rounded-xl border border-theme-border/20">
                        No custom templates yet — build a form, then use &quot;Save as Template&quot; to create one.
                      </div>
                    ) : (
                      <div className="space-y-2">{customTemplates.map(t => row(t, false))}</div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="font-semibold text-theme-text-secondary uppercase tracking-wider text-[10px]">
                      Built-in Templates ({builtInTemplates.length})
                    </p>
                    {builtInTemplates.length === 0 ? (
                      <div className="text-center py-4 text-theme-text-secondary bg-theme-border/5 rounded-xl border border-theme-border/20">All built-in templates are deleted.</div>
                    ) : (
                      <div className="space-y-2">{builtInTemplates.map(t => row(t, true))}</div>
                    )}
                    {builtInTemplates.some(t => t.id === FEEDBACK_FORM_TEMPLATE_ID) && (
                      <p className="text-[10px] text-amber-400/90">
                        Tip: the Feedback Form&apos;s downloadable Word copy is built from its original questions — if you remove or rename those, the matching spots in the Word file are left blank.
                      </p>
                    )}
                  </div>

                  {deletedBuiltIns.length > 0 && (
                    <div className="space-y-2">
                      <p className="font-semibold text-theme-text-secondary uppercase tracking-wider text-[10px]">Deleted built-in templates</p>
                      {deletedBuiltIns.map(t => (
                        <div key={t.id} className="flex items-center justify-between gap-2 p-3 bg-theme-border/5 border border-dashed border-theme-border/30 rounded-xl">
                          <p className="font-semibold text-theme-text-secondary">{t.name}</p>
                          <button type="button" onClick={() => handleRestoreTemplate(t.id)} className="px-3 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent rounded-lg text-[11px] font-bold cursor-pointer">
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Edit Template Modal — custom templates are updated in place; built-in ones are saved as an edited copy
          (Manage Templates shows an Edited badge and a Reset button). */}
      {editingTemplateId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-theme-text-primary flex items-center gap-1.5">
                <Edit2 className="h-4 w-4" />
                Edit Template
              </h2>
              <button
                onClick={() => setEditingTemplateId(null)}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveTemplateEdit} className="space-y-3 text-xs">
              <input
                type="text"
                required
                autoFocus
                value={templateEditName}
                onChange={(e) => setTemplateEditName(e.target.value)}
                placeholder="Template name"
                className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
              />
              <textarea
                rows={2}
                value={templateEditDescription}
                onChange={(e) => setTemplateEditDescription(e.target.value)}
                placeholder="Short description (optional)"
                className="w-full px-4 py-2 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
              />

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-theme-text-primary">Fields</label>
                  <button
                    type="button"
                    onClick={addEditTemplateField}
                    className="px-2.5 py-1 bg-accent/20 hover:bg-accent text-accent hover:text-white rounded-lg transition-all text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Question
                  </button>
                </div>

                {templateEditFields.map((field, idx) => (
                  <FormFieldEditor
                    key={field.id}
                    field={field}
                    onChange={(key, value) => updateEditTemplateField(idx, key, value)}
                    onRemove={() => removeEditTemplateField(idx)}
                    canRemove={templateEditFields.length > 1}
                    allowCheckbox
                    eventLinked
                  />
                ))}
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer"
              >
                Save Template Changes
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingFormId)}
        title="Delete Public Form"
        message="Are you sure you want to delete this public form? The public link will become unreachable and any responses associated will be archived."
        confirmLabel="Delete Form"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingFormId(null)}
      />

      <ConfirmModal
        isOpen={Boolean(deletingResponse)}
        title={deletingResponse === 'ALL' ? 'Delete All Responses' : 'Delete Response'}
        message={deletingResponse === 'ALL'
          ? `Permanently delete all ${selectedSubmissions.length} responses to this form? This cannot be undone — download the CSV first if you need a copy.`
          : 'Permanently delete this response? This cannot be undone.'}
        confirmLabel={deletingResponse === 'ALL' ? 'Delete All' : 'Delete Response'}
        variant="danger"
        onConfirm={handleConfirmDeleteResponse}
        onCancel={() => setDeletingResponse(null)}
      />

      {rejectingFormId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 flex flex-col space-y-4 relative border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                <Ban className="h-4.5 w-4.5 text-danger" />
                Reject Submission
              </h2>
              <button
                onClick={() => { setRejectingFormId(null); setRejectionReasonInput(''); }}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-1.5 text-xs">
              <label className="block font-medium text-theme-text-secondary">Reason (optional)</label>
              <textarea
                value={rejectionReasonInput}
                onChange={(e) => setRejectionReasonInput(e.target.value)}
                rows={3}
                placeholder="Let the submitter know why this was rejected..."
                className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent resize-none"
              />
            </div>
            <button
              onClick={handleConfirmRejectForm}
              className="w-full py-3 bg-danger hover:bg-danger/90 text-white font-semibold text-xs rounded-xl transition-all shadow-md cursor-pointer"
            >
              Confirm Rejection
            </button>
          </div>
        </div>
      )}

      {/* QR Code Preview & Download Modal */}
      <FormQrModal
        isOpen={Boolean(qrModalForm)}
        onClose={() => setQrModalForm(null)}
        form={qrModalForm}
        templates={templates}
      />

    </div>
  );
}
