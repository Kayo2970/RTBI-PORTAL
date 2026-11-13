'use client';

import { useState } from 'react';
import { X, UserCheck, Search } from 'lucide-react';
import { requestApproval, Member, ApprovalRequest } from '@/lib/local-data';

interface RequestApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: ApprovalRequest['entityType'];
  entityId: string;
  entityTitle: string;
  eventId?: string;
  members: Member[];
  currentUser: { id: string; name: string; email: string };
  onRequested?: (request: ApprovalRequest) => void;
}

export function RequestApprovalModal({
  isOpen,
  onClose,
  entityType,
  entityId,
  entityTitle,
  eventId,
  members,
  currentUser,
  onRequested,
}: RequestApprovalModalProps) {
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  // A manual approval request can only be addressed to a Faculty member or a
  // Super User — never a fellow student/committee member, regardless of
  // their tier or role. Faculty is a Member.division value; Super User is
  // identified by tier 1.
  const candidates = members
    .filter(m => m.id !== currentUser.id && m.status !== 'Terminated')
    .filter(m => m.tier <= 2)
    .filter(m => !search.trim() || m.name.toLowerCase().includes(search.toLowerCase()) || (m.role || '').toLowerCase().includes(search.toLowerCase()));

  const handleClose = () => {
    setSearch('');
    setTargetId('');
    setMessage('');
    onClose();
  };

  const handleSubmit = () => {
    const target = members.find(m => m.id === targetId);
    if (!target) return;
    setSubmitting(true);
    const created = requestApproval({
      entityType,
      entityId,
      entityTitle,
      eventId,
      requesterId: currentUser.id,
      requesterName: currentUser.name,
      requesterEmail: currentUser.email,
      targetMemberId: target.id,
      targetMemberName: target.name,
      targetMemberEmail: target.email,
      message: message.trim() || undefined,
    });
    setSubmitting(false);
    onRequested?.(created);
    handleClose();
  };

  return (
    <div
      onClick={handleClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel w-full max-w-md rounded-3xl p-6 flex flex-col space-y-5 relative border border-white/20 shadow-2xl animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent/15 text-accent">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-theme-text-primary">Request Approval</h3>
              <p className="text-xs text-theme-text-secondary mt-0.5 truncate max-w-[220px]">{entityTitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-theme-text-secondary mb-1.5 block">Ask for approval from</label>
            <div className="relative mb-2">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-secondary" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search members..."
                className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-theme-border/40 bg-theme-background/30 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <p className="text-[10px] text-theme-text-secondary mb-2">Only Faculty members and the Super User can be asked for a manual approval.</p>
            <div className="max-h-44 overflow-y-auto rounded-xl border border-theme-border/30 divide-y divide-theme-border/20">
              {candidates.length === 0 && (
                <p className="text-xs text-theme-text-secondary p-3 text-center">No Faculty member or Super User found.</p>
              )}
              {candidates.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setTargetId(m.id)}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors cursor-pointer ${targetId === m.id ? 'bg-accent/15 text-accent font-semibold' : 'text-theme-text-primary hover:bg-theme-border/20'}`}
                >
                  <span>{m.name}</span>
                  <span className="text-[10px] text-theme-text-secondary">{m.role}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-theme-text-secondary mb-1.5 block">Message (optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Add context for the approver..."
              className="w-full px-3 py-2 text-xs rounded-xl border border-theme-border/40 bg-theme-background/30 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2.5 text-xs font-semibold text-theme-text-primary bg-theme-border/30 hover:bg-theme-border/50 rounded-xl transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!targetId || submitting}
            className="px-4 py-2.5 text-xs font-semibold rounded-xl transition-all shadow-md cursor-pointer bg-accent hover:bg-primary-light text-white shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send Request
          </button>
        </div>
      </div>
    </div>
  );
}
