'use client';

import React from 'react';
import { Award, Clock, CheckCircle2, AlertCircle, CircleDashed } from 'lucide-react';

export type CertDisplayStatus = 'Not issued' | 'Issued' | 'Queued' | 'Sent' | 'Failed';

export const CERT_STATUS_FILTERS: CertDisplayStatus[] = ['Not issued', 'Issued', 'Queued', 'Sent', 'Failed'];

const STYLES: Record<CertDisplayStatus, { cls: string; text: string; Icon: React.ComponentType<{ className?: string }> }> = {
  'Not issued': { cls: 'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20', text: 'text-slate-500 dark:text-slate-400', Icon: CircleDashed },
  Issued: { cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30', text: 'text-sky-600 dark:text-sky-400/80', Icon: Award },
  Queued: { cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30', text: 'text-amber-600 dark:text-amber-400/80', Icon: Clock },
  Sent: { cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', text: 'text-emerald-600 dark:text-emerald-400/80', Icon: CheckCircle2 },
  Failed: { cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30', text: 'text-rose-600 dark:text-rose-400/80', Icon: AlertCircle },
};

export function formatCertTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

/** Status pill plus the relevant time underneath: sent/queued time, or issued time when not yet emailed. */
export function CertificateStatusBadge({ status, sentAt, issuedAt, error, sentBy, count, typeName }: { status: CertDisplayStatus | string; sentAt?: string; issuedAt?: string; error?: string; sentBy?: string; count?: number; typeName?: string }) {
  const st = STYLES[(status as CertDisplayStatus)] || STYLES['Not issued'];
  const label = status === 'Not issued' ? 'Not issued' : status === 'Issued' ? 'Issued · not sent' : status === 'Queued' ? 'Queued to send' : status === 'Sent' ? 'Sent' : status;
  const time = status === 'Sent' || status === 'Queued' ? formatCertTime(sentAt) : status === 'Issued' || status === 'Failed' ? formatCertTime(issuedAt) : '';
  return (
    <div className="flex flex-col gap-0.5" title={error || undefined}>
      <span className={`inline-flex w-fit items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${st.cls}`}>
        <st.Icon className="h-3 w-3 shrink-0" />
        <span>{label}</span>
      </span>
      {(count || 0) > 1 ? <span className="text-[9px] pl-1 text-slate-500">{count} certificates · best status shown</span> : typeName ? <span className="text-[9px] pl-1 text-slate-500">{typeName}</span> : null}
      {time && <span className={`text-[9px] pl-1 font-mono ${st.text}`}>{time}{sentBy && status === 'Sent' ? ` · by ${sentBy}` : ''}</span>}
    </div>
  );
}
