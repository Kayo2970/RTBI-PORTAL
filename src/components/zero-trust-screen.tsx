'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ShieldAlert, LogOut, ArrowLeft, Lock } from 'lucide-react';
import { tierLabel, SessionUser } from '@/lib/permissions';

interface ZeroTrustRestrictedScreenProps {
  user: SessionUser;
  onSignOut?: () => void;
}

export function ZeroTrustRestrictedScreen({ user, onSignOut }: ZeroTrustRestrictedScreenProps) {
  const userTier = user?.tier ?? 4;
  const roleName = tierLabel(userTier);

  return (
    <div className="min-h-screen bg-space-theme flex flex-col items-center justify-center p-4 md:p-6 text-center relative z-10 selection:bg-accent/30 selection:text-white">
      {/* Background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-red-500/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-accent/15 rounded-full blur-[100px]" />
      </div>

      <div className="glass-panel w-full max-w-lg rounded-3xl p-8 md:p-10 flex flex-col items-center space-y-6 border border-red-500/30 shadow-2xl backdrop-blur-xl relative">
        {/* Header Branding */}
        <div className="flex items-center gap-3">
          <Image
            src="/card/rtbi-logo.png"
            alt="RTBI Logo"
            width={48}
            height={48}
            className="h-10 w-auto object-contain drop-shadow"
            priority
          />
          <div className="text-left border-l border-theme-border/30 pl-3">
            <span className="text-[10px] font-mono tracking-widest uppercase text-theme-text-secondary block">
              RTBI PORTAL
            </span>
            <span className="text-xs font-bold text-theme-text-primary">
              Security & Access Control
            </span>
          </div>
        </div>

        {/* Shield Alert Icon */}
        <div className="relative">
          <div className="h-20 w-20 rounded-3xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-500 shadow-inner">
            <ShieldAlert className="h-10 w-10 animate-pulse" />
          </div>
          <div className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-theme-background border border-red-500/40 flex items-center justify-center text-red-400">
            <Lock className="h-3.5 w-3.5" />
          </div>
        </div>

        {/* Heading & Policy Statement */}
        <div className="space-y-2">
          <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-red-500/20 text-red-400 border border-red-500/30">
            Zero-Trust Site-Wide Policy Enforced
          </span>
          <h1 className="text-2xl font-bold text-theme-text-primary tracking-tight">
            Access Restricted
          </h1>
          <p className="text-xs text-theme-text-secondary leading-relaxed max-w-sm mx-auto">
            A site-wide <strong>Zero-Trust, Zero-Access</strong> policy is currently active. Only the <strong>Super User</strong> has access to portal modules, models, and controls while the platform is under construction.
          </p>
        </div>

        {/* User Identity Card */}
        <div className="w-full bg-theme-background/40 border border-theme-border/30 rounded-2xl p-4 text-xs space-y-2 text-left">
          <div className="flex items-center justify-between border-b border-theme-border/20 pb-2">
            <span className="text-theme-text-secondary font-medium">Logged-in User</span>
            <span className="font-semibold text-theme-text-primary">{user?.name || 'Unknown'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-theme-border/20 pb-2">
            <span className="text-theme-text-secondary font-medium">Email Address</span>
            <span className="font-mono text-theme-text-primary text-[11px]">{user?.email || 'N/A'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-theme-border/20 pb-2">
            <span className="text-theme-text-secondary font-medium">Current Role</span>
            <span className="font-bold text-accent px-2 py-0.5 rounded bg-accent/15 border border-accent/25 text-[11px]">
              {roleName} (Tier {userTier})
            </span>
          </div>
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-theme-text-secondary font-medium">Policy Status</span>
            <span className="font-bold text-red-400 flex items-center gap-1.5 text-[11px]">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
              Locked (Zero Access)
            </span>
          </div>
        </div>

        <p className="text-[11px] text-theme-text-secondary/80 leading-relaxed italic">
          Granular permissions and module visibility for {roleName} accounts will be provisioned by the Super User as individual modules are finalized.
        </p>

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full pt-1">
          {onSignOut && (
            <button
              onClick={onSignOut}
              className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-xs font-bold transition-all cursor-pointer shadow-sm"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          )}
          <Link
            href="/"
            className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-theme-border/10 hover:bg-theme-border/20 border border-theme-border/30 text-theme-text-primary text-xs font-semibold transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
