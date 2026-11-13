'use client';

import { ShieldCheck, Copyright, X, Lock, FileText, CheckCircle2, Wrench, LogOut } from 'lucide-react';

interface TermsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TermsModal({ isOpen, onClose }: TermsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="glass-panel w-full max-w-3xl rounded-3xl p-6 md:p-8 space-y-6 border border-white/15 shadow-2xl relative max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-theme-border/20 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent/15 text-accent border border-accent/20">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-theme-text-primary">Terms & Conditions of Use</h2>
              <p className="text-xs text-theme-text-secondary mt-0.5">RTBI Portal & Operational Systems</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto space-y-5 text-xs text-theme-text-primary pr-2 leading-relaxed">
          {/* Key Intellectual Property Highlight Box */}
          <div className="p-4 bg-accent/10 border border-accent/30 rounded-2xl space-y-2">
            <div className="flex items-center gap-2 font-bold text-accent text-sm">
              <Copyright className="h-4 w-4 shrink-0" />
              <span>Intellectual Property & Licensing Ownership Notice</span>
            </div>
            <p className="text-xs text-theme-text-primary font-medium leading-relaxed">
              All intellectual property rights, copyrights, trademarks, software source code, database architectures, UI/UX designs, custom modules, algorithms, and development licensing associated with the RTBI Next Gen Portal belong exclusively to <strong className="text-accent underline font-bold">Kayomarz Pavri</strong>.
            </p>
          </div>

          {/* Clause 1: Acceptance of Terms */}
          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              1. Acceptance of Terms & Implied Consent
            </h3>
            <p className="text-theme-text-secondary">
              By accessing, browsing, logging into, or using this website, dashboard, public forms, or associated API services, you confirm that you have read, understood, and unconditionally agreed to be bound by these Terms and Conditions. Access to this platform is advised and governed strictly under these terms upon visiting. If you do not agree to these terms, you must immediately cease all access and usage.
            </p>
          </div>

          {/* Clause 2: Proprietary Ownership */}
          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <Lock className="h-4 w-4 text-warning" />
              2. Intellectual Property Rights & Codebase Ownership
            </h3>
            <p className="text-theme-text-secondary">
              The entire platform—including but not limited to source code, React/Next.js components, database schema, design tokens, Group Policy RBAC engine, form engines, report generators, visual assets, the Public Forms & Feedback engine (with QR code generation and Word-document export), the Design Portal's automated 30-day asset-retention system, the Guest Directory and Members Directory invite tooling, and the automated Indian Holiday Calendar sync and social-media task-approval workflow—is the sole and exclusive property of <strong>Kayomarz Pavri</strong>.
            </p>
            <ul className="list-disc pl-5 text-theme-text-secondary space-y-1">
              <li>No part of this portal or software may be reproduced, modified, distributed, reverse-engineered, decompiled, or re-licensed without explicit prior written authorization from <strong>Kayomarz Pavri</strong>.</li>
              <li>Unauthorized copying, duplication, scraping, or commercial exploitation of any element of this codebase or system architecture constitutes a violation of copyright and intellectual property laws.</li>
            </ul>
          </div>

          {/* Clause 3: Scoped Access */}
          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <FileText className="h-4 w-4 text-accent" />
              3. Authorized Scoped Access & Account Conduct
            </h3>
            <p className="text-theme-text-secondary">
              Users are granted a limited, non-exclusive, non-transferable right to access features corresponding strictly to their assigned organization tier, designation, and Group Policy grants. Credentials must be kept secure. Attempting to bypass access controls, escalate privileges, or tamper with system logs is strictly prohibited.
            </p>
          </div>

          {/* Clause 4: Data Governance & Auditing */}
          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-accent" />
              4. System Governance & Audit Trail
            </h3>
            <p className="text-theme-text-secondary">
              All operational actions—including login attempts, task modifications, rating submissions, financial approvals, email dispatches, and policy updates—are logged to an immutable audit trail for security, governance, and compliance.
            </p>
          </div>

          {/* Clause 5: Maintenance Term */}
          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <Wrench className="h-4 w-4 text-accent" />
              5. Platform Maintenance, Support & Continuity Term
            </h3>
            <p className="text-theme-text-secondary">
              <strong>Kayomarz Pavri</strong>, as the platform's developer and sole intellectual property owner, undertakes to maintain, support, and operate this platform—including bug fixes, security updates, feature development, and server/infrastructure upkeep—for a term of <strong>twenty-five (25) years</strong> from the Effective Date of these Terms, either personally or through a Super User-tier administrator designated for that purpose. This undertaking governs ongoing maintenance responsibility; it does not itself transfer, dilute, or otherwise affect the intellectual property ownership set out in Clause 2, which remains exclusive to Kayomarz Pavri regardless of who is actively performing maintenance at any given time.
            </p>
          </div>

          {/* Clause 6: Exit & Transfer */}
          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <LogOut className="h-4 w-4 text-warning" />
              6. Exit, Discontinuation & Transfer of Maintenance Responsibility
            </h3>
            <p className="text-theme-text-secondary">
              Notwithstanding Clause 5, the maintenance commitment described above is not unconditional. Kayomarz Pavri may discontinue active maintenance of the platform, or transfer maintenance responsibility to a successor developer or administrator, under either of the following exit conditions:
            </p>
            <ul className="list-disc pl-5 text-theme-text-secondary space-y-1">
              <li><strong>Discontinuation:</strong> Maintenance may be paused or wound down where continuing is no longer reasonably practicable (including but not limited to prolonged unavailability, changed circumstances, or the Centre's own decision to retire or replace the platform), with reasonable advance notice to the Centre Head where circumstances permit.</li>
              <li><strong>Transfer:</strong> Maintenance responsibility may be handed to a named successor developer or Super User-tier administrator, provided the transfer is reviewed and approved in writing by the Centre Head before it takes effect. An approved transfer carries forward the same 25-year continuity term under this Clause and Clause 5; it does not reset or extend it.</li>
            </ul>
            <p className="text-theme-text-secondary">
              No exit or transfer under this Clause affects the intellectual property ownership set out in Clause 2, which remains exclusive to Kayomarz Pavri unless separately and explicitly assigned in writing.
            </p>
          </div>

          {/* Contact Box */}
          <div className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl text-[11px] text-theme-text-secondary flex items-center justify-between">
            <span>For licensing queries or IP permissions, contact:</span>
            <span className="font-semibold text-theme-text-primary font-mono">kayo2970@gmail.com</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-theme-border/20 shrink-0">
          <span className="text-[11px] text-theme-text-secondary">
            &copy; 2026 RTBI Portal. All rights reserved.
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-accent hover:bg-primary-light text-white font-bold rounded-xl text-xs transition-all cursor-pointer shadow-md shadow-accent/20"
          >
            I Understand & Agree
          </button>
        </div>
      </div>
    </div>
  );
}
