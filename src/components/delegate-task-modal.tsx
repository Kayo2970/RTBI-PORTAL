'use client';

import { useState } from 'react';
import { X, UserPlus, Search, UserCheck } from 'lucide-react';
import { delegateAutoTask, allotSocialMediaTask, Member, TaskItem, isFacultyMember, isSocialMediaTeamMember, isSocialMediaPostTask, isSocialMediaHeadOrSrHead } from '@/lib/local-data';

interface DelegateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: TaskItem;
  members: Member[];
  currentUser: { id: string; name: string; email: string };
  onDelegated?: (task: TaskItem | null) => void;
}

export function DelegateTaskModal({
  isOpen,
  onClose,
  task,
  members,
  currentUser,
  onDelegated,
}: DelegateTaskModalProps) {
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const isSocialTask = isSocialMediaPostTask(task);
  const isSocialHead = isSocialMediaHeadOrSrHead(currentUser as any);
  const canDirectAllot = isSocialTask && isSocialHead;

  const candidates = members
    .filter(m => m.status !== 'Terminated')
    .filter(m => !isFacultyMember(m))
    .filter(m => !isSocialTask || isSocialMediaTeamMember(m))
    .filter(m => !search.trim() || m.name.toLowerCase().includes(search.toLowerCase()) || (m.role || '').toLowerCase().includes(search.toLowerCase()));

  const handleClose = () => {
    setSearch('');
    setTargetId('');
    onClose();
  };

  const handleTakeUpMyself = () => {
    setSubmitting(true);
    const result = allotSocialMediaTask(
      task.id,
      { id: currentUser.id, name: currentUser.name, email: currentUser.email },
      currentUser.name,
      currentUser.email
    );
    setSubmitting(false);
    onDelegated?.(result);
    handleClose();
  };

  const handleSubmit = () => {
    const target = members.find(m => m.id === targetId);
    if (!target) return;
    setSubmitting(true);
    const result = canDirectAllot
      ? allotSocialMediaTask(
          task.id,
          { id: target.id, name: target.name, email: target.email },
          currentUser.name,
          currentUser.email
        )
      : delegateAutoTask(
          task.id,
          { id: target.id, name: target.name, email: target.email },
          currentUser.name,
          currentUser.email
        );
    setSubmitting(false);
    onDelegated?.(result);
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="glass-panel w-full max-w-md rounded-3xl p-6 flex flex-col space-y-5 relative border border-white/20 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent/15 text-accent">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-theme-text-primary">{canDirectAllot ? 'Allot Social Media Task' : 'Delegate Task'}</h3>
              <p className="text-xs text-theme-text-secondary mt-0.5 truncate max-w-[220px]">{task.title}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-[11px] text-theme-text-secondary bg-theme-background/30 border border-theme-border/30 rounded-xl p-3">
          {canDirectAllot
            ? 'As the Social Media Head / Senior Head, you can allot this task directly to any member of the Social Media team, or take it up yourself.'
            : 'Reassigning this task needs sign-off from the Centre Head or GG Campus Events Head before it takes effect.'}
        </p>

        <div>
          <label className="text-xs font-semibold text-theme-text-secondary mb-1.5 block">
            {canDirectAllot ? 'Allot to team member' : 'Reassign to'}
          </label>
          <div className="relative mb-2">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members..."
              className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-theme-border/40 bg-theme-background/30 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
          <div className="max-h-44 overflow-y-auto rounded-xl border border-theme-border/30 divide-y divide-theme-border/20">
            {candidates.length === 0 && (
              <p className="text-xs text-theme-text-secondary p-3 text-center">No members found.</p>
            )}
            {candidates.map(m => (
              <button
                key={m.id}
                onClick={() => setTargetId(m.id)}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors cursor-pointer ${targetId === m.id ? 'bg-accent/15 text-accent font-semibold' : 'text-theme-text-primary hover:bg-theme-border/20'}`}
              >
                <span>{m.name}</span>
                <span className="text-[10px] text-theme-text-secondary">{m.role}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 flex-wrap">
          {canDirectAllot && (
            <button
              type="button"
              onClick={handleTakeUpMyself}
              disabled={submitting}
              className="mr-auto px-3.5 py-2.5 text-xs font-semibold text-accent bg-accent/15 hover:bg-accent/25 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
            >
              <UserCheck className="h-3.5 w-3.5" /> Take It Up Myself
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2.5 text-xs font-semibold text-theme-text-primary bg-theme-border/30 hover:bg-theme-border/50 rounded-xl transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!targetId || submitting}
            className="px-4 py-2.5 text-xs font-semibold rounded-xl transition-all shadow-md cursor-pointer bg-accent hover:bg-primary-light text-white shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {canDirectAllot ? 'Allot Task' : 'Submit for Approval'}
          </button>
        </div>
      </div>
    </div>
  );
}
