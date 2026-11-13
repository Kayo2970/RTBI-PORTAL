'use client';

import { ShieldCheck, X, Database, Lock, Users, Clock, Mail, UserCheck } from 'lucide-react';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PrivacyPolicyModal({ isOpen, onClose }: PrivacyPolicyModalProps) {
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
              <h2 className="text-lg font-bold text-theme-text-primary">Privacy Policy</h2>
              <p className="text-xs text-theme-text-secondary mt-0.5">LEADS Next Gen Portal & Operational Systems</p>
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
          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <Database className="h-4 w-4 text-accent" />
              1. What Data We Collect
            </h3>
            <p className="text-theme-text-secondary">
              This portal collects only what's needed to run RTBI Portal's internal operations:
            </p>
            <ul className="list-disc pl-5 text-theme-text-secondary space-y-1">
              <li><strong>Member records:</strong> name, email, phone number, role, tier, division/department, and (optionally) date of birth and a profile photo.</li>
              <li><strong>Operational records:</strong> events, tasks, ratings, reimbursement claims and receipt scans, budgets, design submissions, guest/visiting-card contacts, and public form responses.</li>
              <li><strong>Account security data:</strong> a salted, hashed password (never the plaintext password itself), and short-lived session tokens used to keep you signed in.</li>
              <li><strong>Public form respondents:</strong> whatever a public form itself asks for — no account or login is required to submit one, and only the fields that form defines are collected.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <Lock className="h-4 w-4 text-warning" />
              2. How It's Stored & Protected
            </h3>
            <p className="text-theme-text-secondary">
              All collected records are stored on the Centre's own server, encrypted at rest (AES-256-GCM). Passwords are never stored in plain text — only a salted cryptographic hash used to verify a login attempt. Uploaded files (receipts, avatars, design assets, visiting cards) are stored as files on that same server, not embedded in shared data, and are only reachable via a random, non-guessable link. Access to any record is governed by your account's role/tier and the Group Policy access rules a Super User configures — not everyone who can sign in can see everyone else's data.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <Users className="h-4 w-4 text-accent" />
              3. Who Can See It
            </h3>
            <p className="text-theme-text-secondary">
              Your data is visible only to other members of RTBI Portal whose role grants them access to that particular record — e.g. your department Head, the Centre Head, or a Finance Head reviewing a claim you submitted. We do not sell, rent, or share your data with outside companies. The only external service this portal talks to is the email provider used to send you notifications (e.g. Gmail/SMTP, configured by the Centre) and, for anonymous site-traffic counts only, Cloudflare Web Analytics — a cookieless analytics tool that does not track you individually or across other sites.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-accent" />
              4. Audit Logging
            </h3>
            <p className="text-theme-text-secondary">
              Actions taken on this portal (logins, record changes, approvals, email dispatches) are recorded to an internal audit trail, visible to leadership, for security and accountability. This log records what changed and by whom — it does not track your browsing activity or location.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" />
              5. How Long We Keep It
            </h3>
            <p className="text-theme-text-secondary">
              Member and operational records are kept for as long as they're relevant to the Centre's operations and history. Design Portal file uploads are automatically purged 30 days after submission. If your membership ends, your account can be terminated (which revokes access immediately) — contact the Centre Head if you'd like your personal data reviewed or removed beyond what the Centre needs to keep for its own records.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="font-bold text-sm text-theme-text-primary flex items-center gap-2">
              <Mail className="h-4 w-4 text-accent" />
              6. Your Choices
            </h3>
            <p className="text-theme-text-secondary">
              You can review and update most of your own profile details from Settings. Password resets, email address changes, and account questions are handled through the portal's own self-service flows or by asking a Super User/Centre Head. Bulk email notifications (announcements, event rosters, guest invites) include a way to opt out — reply "Unsubscribe" to any such email, or contact the address below.
            </p>
          </div>

          {/* Contact Box */}
          <div className="p-3.5 bg-theme-border/10 border border-theme-border/20 rounded-2xl text-[11px] text-theme-text-secondary flex items-center justify-between">
            <span>For privacy questions or data requests, contact:</span>
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
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}
