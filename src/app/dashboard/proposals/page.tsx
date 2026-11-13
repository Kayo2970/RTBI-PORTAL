'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Lightbulb, Plus, X, Paperclip, Download, Clock, CheckCircle, Send, Inbox, ShieldCheck, Trash2, Search, Users, Loader2,
} from 'lucide-react';
import { getMembers, type Member } from '@/lib/local-data';
import {
  MAX_PROPOSAL_FILES, MAX_PROPOSAL_FILE_BYTES, PROPOSAL_RECIPIENT_GROUPS,
  type ProposalItem, type ProposalResponseStatus,
} from '@/lib/proposals';
import { fetchProposals, createProposal, decideProposal, respondToProposal, deleteProposal } from '@/lib/proposals-client';
import { formatFileSize } from '@/components/ui/file-dropzone';

type Tab = 'inbox' | 'sent' | 'review';

interface DraftFile { name: string; type: string; size: number; dataUrl: string }

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    r.readAsDataURL(file);
  });

const statusStyle: Record<string, string> = {
  'Pending Approval': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Approved: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Rejected: 'bg-danger/15 text-danger border-danger/30',
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export default function ProposalsPage() {
  const [user, setUser] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // form
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [groups, setGroups] = useState<string[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  // per-card inputs
  const [noteFor, setNoteFor] = useState<Record<string, string>>({});
  const [commentFor, setCommentFor] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchProposals());
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load proposals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('user');
      if (saved) setUser(JSON.parse(saved));
    } catch { /* ignore */ }
    setMembers(getMembers());
    setHighlightId(new URLSearchParams(window.location.search).get('highlight'));
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const inbox = useMemo(() => items.filter(p => p.viewer?.isRecipient), [items]);
  const sent = useMemo(() => items.filter(p => p.viewer?.isAuthor), [items]);
  const review = useMemo(() => items.filter(p => p.viewer?.canDecide && p.status === 'Pending Approval'), [items]);
  const isApprover = useMemo(() => items.some(p => p.viewer?.canDecide), [items]);

  // Until the user picks a tab, default to the most useful one (or the highlighted proposal's tab).
  const defaultTab: Tab = (() => {
    const h = highlightId ? items.find(p => p.id === highlightId) : undefined;
    if (h) return h.viewer?.isRecipient ? 'inbox' : h.viewer?.canDecide && h.status === 'Pending Approval' ? 'review' : 'sent';
    return review.length > 0 ? 'review' : inbox.length > 0 ? 'inbox' : 'sent';
  })();
  const activeTab: Tab = tab ?? defaultTab;

  const list = activeTab === 'inbox' ? inbox : activeTab === 'review' ? review : sent;

  const memberMatches = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return [];
    return members
      .filter(m => m.id !== user?.id && m.status !== 'Terminated' && !memberIds.includes(m.id) &&
        (m.name.toLowerCase().includes(q) || (m.role || '').toLowerCase().includes(q)))
      .slice(0, 6);
  }, [memberQuery, members, memberIds, user]);

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(''), 4000); };

  const resetForm = () => {
    setTitle(''); setText(''); setGroups([]); setMemberIds([]); setMemberQuery(''); setFiles([]); setFormError('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const onPickFiles = async (picked: FileList | null) => {
    if (!picked) return;
    setFormError('');
    const next = [...files];
    for (const f of Array.from(picked)) {
      if (next.length >= MAX_PROPOSAL_FILES) { setFormError(`You can attach at most ${MAX_PROPOSAL_FILES} files.`); break; }
      if (f.size > MAX_PROPOSAL_FILE_BYTES) { setFormError(`"${f.name}" is over the 10 MB limit.`); continue; }
      try {
        next.push({ name: f.name, type: f.type, size: f.size, dataUrl: await readAsDataUrl(f) });
      } catch (e: any) { setFormError(e.message); }
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = '';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setFormError('');
    if (!title.trim() || !text.trim()) return setFormError('Please add a title and write your proposal.');
    if (groups.length === 0 && memberIds.length === 0) return setFormError('Choose at least one recipient group or member.');
    setSubmitting(true);
    try {
      await createProposal({
        title: title.trim(), body: text.trim(), recipients: { groups, memberIds },
        attachments: files.map(({ name, type, dataUrl }) => ({ name, type, dataUrl })),
      });
      resetForm();
      setShowForm(false);
      setTab('sent');
      flash('Proposal submitted. It will be shared with the recipients once an approver signs it off.');
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Could not submit the proposal.');
    } finally {
      setSubmitting(false);
    }
  };

  const run = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusyId(id);
    try { await fn(); flash(done); await load(); }
    catch (err: any) { setError(err?.message || 'Something went wrong.'); }
    finally { setBusyId(null); }
  };

  const recipientLabel = (p: ProposalItem) => {
    const names = p.recipients.memberIds.map(id => members.find(m => m.id === id)?.name).filter(Boolean) as string[];
    return [...p.recipients.groups, ...names].join(', ') || '—';
  };

  const tabBtn = (key: Tab, label: string, count: number, Icon: React.ComponentType<any>) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
        activeTab === key ? 'bg-accent text-white border-accent' : 'border-theme-border/40 text-theme-text-secondary hover:bg-theme-border/10'
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
      <span className={`text-[10px] px-1.5 rounded-full ${activeTab === key ? 'bg-white/20' : 'bg-theme-border/30'}`}>{count}</span>
    </button>
  );

  const inputCls = 'w-full bg-theme-background/40 border border-theme-border/40 rounded-xl px-3 py-2 text-xs text-theme-text-primary focus:outline-none focus:border-accent';

  return (
    <div className="p-6 md:p-8 space-y-6">
      {notice && (
        <div className="flex items-center gap-3 p-4 bg-success/15 border border-success/20 rounded-2xl text-theme-text-primary text-xs">
          <CheckCircle className="h-5 w-5 text-success shrink-0" /> {notice}
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between gap-3 p-4 bg-danger/10 border border-danger/25 rounded-2xl text-danger text-xs">
          <span>{error}</span>
          <button onClick={() => setError('')} className="cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary flex items-center gap-2"><Lightbulb className="h-5 w-5 text-accent" /> Proposals</h1>
          <p className="text-xs text-theme-text-secondary">Share an idea with the CEO, employees, startups or specific people. An authorised approver signs it off before it is delivered.</p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/15 cursor-pointer"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {showForm ? 'Cancel' : 'New Proposal'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="glass-panel rounded-2xl p-6 space-y-4 text-xs border border-theme-border/30">
          <div>
            <label className="block font-semibold text-theme-text-primary mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className={inputCls} placeholder="e.g. Proposal for a Placement Prep Workshop Series" />
          </div>
          <div>
            <label className="block font-semibold text-theme-text-primary mb-1">Your proposal</label>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={7} maxLength={20000} className={inputCls} placeholder="Describe the idea, why it matters, what you need, and the expected outcome…" />
          </div>

          <div>
            <label className="block font-semibold text-theme-text-primary mb-1.5">Send to</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {PROPOSAL_RECIPIENT_GROUPS.map(g => {
                const on = groups.includes(g);
                return (
                  <button type="button" key={g} onClick={() => setGroups(on ? groups.filter(x => x !== g) : [...groups, g])}
                    className={`px-3 py-1.5 rounded-full border text-[11px] font-semibold cursor-pointer transition-all ${on ? 'bg-accent text-white border-accent' : 'border-theme-border/40 text-theme-text-secondary hover:bg-theme-border/10'}`}>
                    {g}
                  </button>
                );
              })}
            </div>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-3 top-2.5 text-theme-text-secondary" />
              <input value={memberQuery} onChange={e => setMemberQuery(e.target.value)} className={`${inputCls} pl-9`} placeholder="Add specific people by name or role…" />
              {memberMatches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-theme-surface border border-theme-border/40 rounded-xl shadow-lg overflow-hidden">
                  {memberMatches.map(m => (
                    <button type="button" key={m.id} onClick={() => { setMemberIds([...memberIds, m.id]); setMemberQuery(''); }}
                      className="w-full text-left px-3 py-2 hover:bg-theme-border/15 cursor-pointer">
                      <span className="font-semibold text-theme-text-primary">{m.name}</span>
                      <span className="text-theme-text-secondary"> · {m.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {memberIds.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {memberIds.map(id => (
                  <span key={id} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/15 text-accent border border-accent/20 text-[11px] font-semibold">
                    {members.find(m => m.id === id)?.name || id}
                    <button type="button" onClick={() => setMemberIds(memberIds.filter(x => x !== id))} className="cursor-pointer"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block font-semibold text-theme-text-primary mb-1.5">Attachments <span className="font-normal text-theme-text-secondary">(up to {MAX_PROPOSAL_FILES} files, 10 MB each)</span></label>
            <input ref={fileInput} type="file" multiple onChange={e => onPickFiles(e.target.files)} className="hidden" />
            <button type="button" onClick={() => fileInput.current?.click()} disabled={files.length >= MAX_PROPOSAL_FILES}
              className="flex items-center gap-2 px-3.5 py-2 border border-dashed border-theme-border/60 rounded-xl text-theme-text-secondary hover:bg-theme-border/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              <Paperclip className="h-3.5 w-3.5" /> Add files
            </button>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 bg-theme-background/30 border border-theme-border/30 rounded-xl">
                    <span className="truncate text-theme-text-primary">{f.name} <span className="text-theme-text-secondary">· {formatFileSize(f.size)}</span></span>
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="cursor-pointer text-theme-text-secondary hover:text-danger"><X className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {formError && <p className="text-danger font-medium">{formError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={submitting}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl cursor-pointer disabled:opacity-60">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit for approval
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {tabBtn('inbox', 'Received', inbox.length, Inbox)}
        {tabBtn('sent', 'My proposals', sent.length, Send)}
        {isApprover && tabBtn('review', 'Awaiting my approval', review.length, ShieldCheck)}
      </div>

      {loading ? (
        <p className="text-xs text-theme-text-secondary flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading proposals…</p>
      ) : list.length === 0 ? (
        <div className="glass-panel rounded-2xl p-10 text-center text-xs text-theme-text-secondary border border-theme-border/30">
          <Lightbulb className="h-8 w-8 mx-auto mb-2 opacity-50" />
          {activeTab === 'inbox' ? 'No proposals have been shared with you yet.' : activeTab === 'review' ? 'Nothing is waiting for your approval.' : 'You have not submitted any proposals yet.'}
        </div>
      ) : (
        <div className="space-y-4">
          {list.map(p => {
            const mine = p.responses.find(r => r.memberId === user?.id);
            const busy = busyId === p.id;
            return (
              <div key={p.id} id={`proposal-${p.id}`}
                className={`glass-panel rounded-2xl p-6 space-y-3 border text-xs ${highlightId === p.id ? 'border-accent ring-1 ring-accent/40' : 'border-theme-border/30'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center flex-wrap gap-2.5">
                    <h3 className="font-bold text-sm text-theme-text-primary">{p.title}</h3>
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${statusStyle[p.status]}`}>
                      {p.status === 'Pending Approval' ? <Clock className="h-3 w-3" /> : p.status === 'Approved' ? <CheckCircle className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      {p.status === 'Approved' && !p.decidedBy ? 'Sent' : p.status}
                    </span>
                  </div>
                  <span className="text-theme-text-secondary text-[11px]">by <strong className="text-theme-text-primary">{p.authorName}</strong> · {fmtDate(p.createdAt)}</span>
                </div>

                <p className="flex items-start gap-1.5 text-[11px] text-theme-text-secondary"><Users className="h-3.5 w-3.5 mt-0.5 shrink-0" /> To: {recipientLabel(p)}</p>
                <p className="text-theme-text-secondary leading-relaxed bg-theme-background/20 p-3 rounded-xl border border-theme-border/20 whitespace-pre-wrap">{p.body}</p>

                {p.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {p.attachments.map((a, i) => (
                      <a key={i} href={`${a.url}${a.url.includes('?') ? '&' : '?'}download=1`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-theme-border/40 rounded-lg text-theme-text-primary hover:bg-theme-border/10">
                        <Download className="h-3.5 w-3.5" /> {a.name}
                      </a>
                    ))}
                  </div>
                )}

                {p.status !== 'Pending Approval' && p.decidedBy && (
                  <p className={`text-[11px] ${p.status === 'Approved' ? 'text-emerald-400' : 'text-danger'}`}>
                    {p.status} by <strong>{p.decidedBy}</strong>{p.decisionNote ? ` — “${p.decisionNote}”` : ''}
                  </p>
                )}

                {p.viewer?.canDecide && p.status === 'Pending Approval' && (
                  <div className="space-y-2 pt-2 border-t border-theme-border/20">
                    <input value={noteFor[p.id] || ''} onChange={e => setNoteFor({ ...noteFor, [p.id]: e.target.value })} className={inputCls} placeholder="Optional note for the author…" />
                    <div className="flex gap-2">
                      <button disabled={busy} onClick={() => run(p.id, () => decideProposal(p.id, 'Approved', noteFor[p.id]), 'Proposal approved and sent to its recipients.')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg cursor-pointer flex items-center gap-1 disabled:opacity-60">
                        <CheckCircle className="h-3.5 w-3.5" /> Approve & send
                      </button>
                      <button disabled={busy} onClick={() => run(p.id, () => decideProposal(p.id, 'Rejected', noteFor[p.id]), 'Proposal rejected.')}
                        className="px-3 py-1.5 bg-danger hover:bg-danger/90 text-white font-semibold rounded-lg cursor-pointer flex items-center gap-1 disabled:opacity-60">
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  </div>
                )}

                {p.viewer?.isRecipient && (
                  <div className="space-y-2 pt-2 border-t border-theme-border/20">
                    <p className="font-semibold text-theme-text-primary">Your response{mine ? `: ${mine.status}` : ''}</p>
                    <input value={commentFor[p.id] ?? mine?.comment ?? ''} onChange={e => setCommentFor({ ...commentFor, [p.id]: e.target.value })} className={inputCls} placeholder="Add a comment (optional)…" />
                    <div className="flex flex-wrap gap-2">
                      {(['Under Review', 'Accepted', 'Declined'] as ProposalResponseStatus[]).map(s => (
                        <button key={s} disabled={busy} onClick={() => run(p.id, () => respondToProposal(p.id, s, commentFor[p.id] ?? mine?.comment), 'Response saved.')}
                          className={`px-3 py-1.5 rounded-lg border font-semibold cursor-pointer disabled:opacity-60 ${mine?.status === s ? 'bg-accent text-white border-accent' : 'border-theme-border/40 text-theme-text-secondary hover:bg-theme-border/10'}`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {p.responses.length > 0 && (p.viewer?.isAuthor || p.viewer?.canDecide) && (
                  <div className="space-y-1 pt-2 border-t border-theme-border/20">
                    <p className="font-semibold text-theme-text-primary">Responses ({p.responses.length})</p>
                    {p.responses.map(r => (
                      <p key={r.memberId} className="text-theme-text-secondary">
                        <strong className="text-theme-text-primary">{r.memberName}</strong> — {r.status}{r.comment ? `: “${r.comment}”` : ''}
                      </p>
                    ))}
                  </div>
                )}

                {p.viewer?.canDelete && (
                  <div className="flex justify-end">
                    <button disabled={busy} onClick={() => { if (confirm('Delete this proposal and its attachments?')) run(p.id, () => deleteProposal(p.id), 'Proposal deleted.'); }}
                      className="flex items-center gap-1 text-[11px] text-theme-text-secondary hover:text-danger cursor-pointer">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
