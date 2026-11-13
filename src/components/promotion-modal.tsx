'use client';

import React from 'react';
import {
  Award,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Crown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Unlock,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { RippleButton } from '@/components/ui/ripple-button';

export interface PromotionData {
  previousTier: number;
  previousRole: string;
  newTier: number;
  newRole: string;
  newDivision?: string;
  /** Defaults to 'promotion' for any existing caller that doesn't pass this — never breaks the celebratory copy for a genuine promotion. */
  changeType?: 'promotion' | 'demotion';
}

export interface PromotionModalProps {
  data: PromotionData | null;
  isOpen: boolean;
  onClose: () => void;
}

export function PromotionModal({ data, isOpen, onClose }: PromotionModalProps) {
  if (!isOpen || !data) return null;

  const isDemotion = data.changeType === 'demotion';

  // Derive upgraded capabilities granted by the new role/tier
  const getUpgradedCapabilities = (tier: number, role: string): string[] => {
    const list: string[] = [];
    const r = role.toLowerCase();

    if (tier === 1) {
      list.push('Full System & Master Administrative Clearance (Tier 1 Super User)');
      list.push('Instant Quick-Switch into any member session without password');
      list.push('Global Event, Budget, Reimbursement & Policy Approval Authority');
      list.push('Security Lockdown, Database Encryption & Audit Log Controls');
      return list;
    }

    if (tier === 2 || r.includes('head') || r.includes('president') || r.includes('faculty')) {
      list.push('Executive Event & Budget Sign-Off Authority');
      list.push('Broadcast Campus & Division Announcements');
      list.push('Review & Authorize Student Performance Ratings');
      list.push('Public Form & Registration Workflow Management');
      return list;
    }

    if (tier === 3 || r.includes('core') || r.includes('lead')) {
      list.push('Departmental Task Assignment & Delegation Rights');
      list.push('Design Portal Asset Review & Media Deliverables Approval');
      list.push('Sub-Committee Leadership & Symposium Logistics Tools');
      list.push('Member Evaluation & Task Extension Approvals');
      return list;
    }

    if (tier === 4 || tier === 5) {
      list.push('Operational Task Submission & Extension Requests');
      list.push('Direct Upload Access to Creative Design Portals');
      list.push('Committee Collaboration & Milestone Tracking');
      return list;
    }

    list.push('Expanded Workspace Access & Calendar Tracking');
    list.push('Collaborative Milestone & Task Management');
    return list;
  };

  const capabilities = isDemotion ? [] : getUpgradedCapabilities(data.newTier, data.newRole);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-black/75 backdrop-blur-md animate-in fade-in duration-200 select-none">

      {/* Outer Celebration Card */}
      <div className="relative w-full max-w-lg glass-panel bg-white/95 dark:bg-[#0B1B2E]/95 text-slate-900 dark:text-white rounded-3xl border-2 border-accent/40 shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">

        {/* Glowing Ambient Top Accent */}
        <div className={`w-full h-2 bg-gradient-to-r ${isDemotion ? 'from-slate-400 via-accent to-rose-400' : 'from-amber-400 via-accent to-emerald-400'}`} />

        {/* Header */}
        <div className="p-6 md:p-8 text-center space-y-4 relative bg-gradient-to-b from-accent/15 via-transparent to-transparent">

          {/* Animated Badge */}
          <div className={`mx-auto h-16 w-16 rounded-3xl bg-gradient-to-tr ${isDemotion ? 'from-slate-500 to-rose-500' : 'from-amber-500 to-accent'} flex items-center justify-center text-white shadow-xl shadow-accent/30 ring-4 ring-white/20`}>
            {isDemotion ? <TrendingDown className="h-8 w-8" /> : <Crown className="h-8 w-8 animate-bounce" />}
          </div>

          <div className="space-y-1.5">
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${isDemotion ? 'bg-rose-500/15 border border-rose-500/30 text-rose-900 dark:text-rose-300' : 'bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-300'}`}>
              <Sparkles className="h-3.5 w-3.5" />
              {isDemotion ? 'Role Change — Designation Update' : 'Role Promotion & Elevation'}
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {isDemotion ? 'Congratulations on Your New Designation' : 'Congratulations on Your Promotion!'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 max-w-sm mx-auto font-medium leading-relaxed">
              {isDemotion
                ? 'You have been demoted — your designation and operational privileges have changed at RTBI Portal.'
                : 'Your designation and operational privileges have been upgraded at RTBI Portal.'}
            </p>
          </div>

          {/* Elevation Visual Comparison Pill */}
          <div className="flex items-center justify-center gap-3 p-3 rounded-2xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-white/10 shadow-inner">
            <div className="text-left">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Previous</span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[120px] block">
                {data.previousRole} (T{data.previousTier})
              </span>
            </div>

            <div className="p-1.5 rounded-full bg-accent/20 text-accent">
              <ArrowRight className="h-4 w-4" />
            </div>

            <div className="text-left">
              <span className="text-[10px] uppercase font-bold text-accent block">New Designation</span>
              <span className="text-xs font-black text-slate-900 dark:text-white truncate max-w-[140px] block">
                {data.newRole} (Tier {data.newTier})
              </span>
            </div>
          </div>

        </div>

        {/* Upgraded Capabilities Section (promotion only) or Access Change Notice (demotion) */}
        {isDemotion ? (
          <div className="px-6 md:px-8 py-4 space-y-2 bg-slate-50/50 dark:bg-black/20 border-t border-b border-slate-200 dark:border-white/10">
            <h4 className="text-xs font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <TrendingDown className="h-4 w-4" />
              Access Change Notice:
            </h4>
            <p className="text-xs text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
              Some privileges tied to your previous designation may no longer be available. Contact your Centre Head if you believe this was made in error.
            </p>
          </div>
        ) : (
          <div className="px-6 md:px-8 py-4 space-y-3 bg-slate-50/50 dark:bg-black/20 border-t border-b border-slate-200 dark:border-white/10">
            <h4 className="text-xs font-black uppercase tracking-wider text-accent flex items-center gap-1.5">
              <Unlock className="h-4 w-4 text-accent" />
              New Privileges & Upgraded Access:
            </h4>

            <ul className="space-y-2">
              {capabilities.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2.5 text-xs text-slate-800 dark:text-slate-200 font-medium">
                  <span className="h-4 w-4 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 border border-emerald-500/30">
                    <Check className="h-2.5 w-2.5 stroke-[3]" />
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Modal Footer Actions */}
        <div className="p-6 flex items-center justify-end gap-3 bg-white/50 dark:bg-slate-900/50">
          <RippleButton
            onClick={onClose}
            className="w-full bg-accent text-white hover:bg-accent/90 text-xs font-black py-3 rounded-2xl shadow-xl shadow-accent/25 flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
          >
            <span>Acknowledge & Access Workspace</span>
            <ChevronRight className="h-4 w-4" />
          </RippleButton>
        </div>

      </div>

    </div>
  );
}
