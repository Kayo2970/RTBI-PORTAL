'use client';

import React from 'react';
import { Award, Clock, CheckCircle2, AlertCircle, CircleDashed } from 'lucide-react';

export type CertDisplayStatus = 'Not issued' | 'Issued' | 'Queued' | 'Sent' | 'Failed';

export const CERT_STATUS_FILTERS: CertDisplayStatus[] = ['Not issued', 'Issued', 'Queued', 'Sent', 'Failed'];

const STYLES: Record<CertDisplayStatus, { cls: string; text: string; Icon: React.ComponentType<{ className?: string }> }> = {
  'Not issued': { cls: 'bg-theme-card/10 text-theme-text-secondary dark:text-theme-text-secondary border-theme-border/20', text: 'text-theme-text-secondary dark:text-theme-text-secondary', Icon: CircleDashed },
  Issued: { cls: 'bg-accent/15 text-accent dark:text-accent border-accent/30', text: 'text-accent dark:text-accent/80', Icon: Award },
  Queued: { cls: 'bg-warning/15 text-warning dark:text-warning border-warning/30', text: 'text-warning dark:text-warning/80', Icon: Clock },
  Sent: { cls: 'bg-success/15 text-success dark:text-success border-success/30', text: 'text-success dark:text-success/80', Icon: CheckCircle2 },
  Failed: { cls: 'bg-danger/15 text-danger dark:text-danger border-danger/30', text: 'text-danger dark:text-danger/80', Icon: AlertCircle },
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
      {(count || 0) > 1 ? <span className="text-[9px] pl-1 text-theme-text-secondary">{count} certificates · best status shown</span> : typeName ? <span className="text-[9px] pl-1 text-theme-text-secondary">{typeName}</span> : null}
      {time && <span className={`text-[9px] pl-1 font-mono ${st.text}`}>{time}{sentBy && status === 'Sent' ? ` · by ${sentBy}` : ''}</span>}
    </div>
  );
}
