'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Sparkles,
  LayoutDashboard,
  CalendarDays,
  CheckSquare,
  Users,
  Calendar,
  DollarSign,
  Receipt,
  Palette,
  Award,
  FileSpreadsheet,
  Settings,
  ChevronRight,
  ChevronLeft,
  X,
  ShieldCheck,
  Compass,
  ArrowRight,
  KeyRound,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { Member } from '@/lib/local-data';
import { isCentreHead, isFinanceHead, canAccessGuestDirectory } from '@/lib/permissions';
import { RippleButton } from '@/components/ui/ripple-button';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';

export interface OnboardingTourUser {
  id?: string;
  name: string;
  email: string;
  tier: number;
  role?: string;
  division?: string;
  department?: string;
  committee?: string;
  avatarUrl?: string;
}

export interface OnboardingTourProps {
  user: OnboardingTourUser;
  isOpen: boolean;
  onClose: () => void;
}

interface TourStep {
  id: string;
  title: string;
  moduleName: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  color: 'accent' | 'primary' | 'success' | 'warning' | 'danger';
  summary: string;
  whatYouCanDo: string[];
  keyInformation: string[];
  accessBadge: string;
  isRestricted?: boolean;
}

export function OnboardingTour({ user, isOpen, onClose }: OnboardingTourProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Generate role-tailored steps based on user.tier and permissions
  const getTailoredSteps = (): TourStep[] => {
    const isSuper = user.tier === 1;
    const isHead = isCentreHead(user);
    const isFinance = isFinanceHead(user);
    const hasGuestDir = canAccessGuestDirectory(user);

    const steps: TourStep[] = [
      {
        id: 'welcome',
        title: `Welcome, ${user.name}!`,
        moduleName: 'Introduction & Access Overview',
        href: '/dashboard/home',
        icon: Sparkles,
        color: 'accent',
        summary: `You are signed in as a ${user.role || 'Member'} (${user.division || 'RTBI Team'}) with Tier ${user.tier} clearance. This quick interactive tour will introduce you to all accessible workspaces tailored to your role.`,
        whatYouCanDo: [
          'Navigate through your assigned workspaces from the sidebar',
          'Track live committee tasks, events, and performance metrics',
          'Access data and approval pipelines aligned with your authorization level',
        ],
        keyInformation: [
          `Your Access Tier: Tier ${user.tier}`,
          `Your Division: ${user.division || 'General Member'}`,
          `Your Role: ${user.role || 'Member'}`,
        ],
        accessBadge: `Tier ${user.tier} Clearance`,
      },
      {
        id: 'home',
        title: 'Dashboard Overview & Pulse',
        moduleName: 'Command Centre',
        href: '/dashboard/home',
        icon: LayoutDashboard,
        color: 'primary',
        summary: 'The central hub of RTBI Portal. Displays real-time organizational KPIs, quick actions, performance charts, and campus-wide announcements.',
        whatYouCanDo: [
          'View active member counts, ongoing events, and task metrics',
          'Read urgent announcements published for your division',
          'Use quick shortcuts to navigate straight to priority desks',
        ],
        keyInformation: [
          'Live statistical counters across all active sectors',
          'Interactive activity radar and completion timelines',
          'Recent circulars and leadership broadcast messages',
        ],
        accessBadge: 'Standard Access',
      },
      {
        id: 'events',
        title: 'Events Management Workspace',
        moduleName: 'Events Workspace',
        href: '/dashboard/events',
        icon: CalendarDays,
        color: 'accent',
        summary: 'Coordinates event lifecycles across campuses from initial proposal and budget approval to venue logistics and post-event reporting.',
        whatYouCanDo: isSuper || isHead
          ? [
              'Approve, reject, or archive event proposals',
              'Assign organizing committees and set financial budgets',
              'Monitor cross-campus venue allocations and schedules',
            ]
          : [
              'Submit new event proposals for leadership review',
              'View event logistics, schedules, and committee assignments',
              'Track registration counts and post-event feedback',
            ],
        keyInformation: [
          'Inter-campus event cards with status badges (Ongoing, Planned, Archived)',
          'Speaker, coordinator, and venue details',
          'Associated budget requirements and clearance status',
        ],
        accessBadge: isSuper || isHead ? 'Full Approver' : 'Contributor',
      },
      {
        id: 'tasks',
        title: 'Tasks Desk & Kanban Board',
        moduleName: 'Tasks Desk',
        href: '/dashboard/tasks',
        icon: CheckSquare,
        color: 'success',
        summary: 'Visual workflow management system organized in a 4-stage Kanban pipeline (To Do, In Progress, Under Review, and Completed).',
        whatYouCanDo: [
          'Drag or update task progress cards across stages',
          'Filter tasks by priority (Urgent, High, Normal, Low) or assignee',
          'Create new actionable tasks and assign deadlines',
        ],
        keyInformation: [
          'Task title, description, and attached resource links',
          'Assignee avatar badges and division tags',
          'Countdown timers to due dates and priority color chips',
        ],
        accessBadge: 'Team Contributor',
      },
      {
        id: 'directory',
        title: 'Members Directory & Profiles',
        moduleName: 'Members Directory',
        href: '/dashboard/directory',
        icon: Users,
        color: 'primary',
        summary: 'The comprehensive member registry for RTBI Portal faculty leadership, core department heads, and incubation associates.',
        whatYouCanDo: isSuper
          ? [
              'Add, edit, or modify member roles, tiers, and permissions',
              'View full student dossiers, performance history, and audit trails',
              'Execute Quick-Switch impersonation to verify committee views',
            ]
          : [
              'Browse member contacts and committee divisions',
              'View peer student leadership profiles and assigned portfolios',
              'Filter directory by division (Core Committee, Associates, Faculty)',
            ],
        keyInformation: [
          'Official contact emails, roles, and campus affiliations',
          'Tier badges (Tier 1 through Tier 7)',
          'Performance ratings and portfolio assignments',
        ],
        accessBadge: isSuper ? 'Full Administrator' : 'Read Directory',
      },
      {
        id: 'calendar',
        title: 'Inter-Campus Event Calendar',
        moduleName: 'Calendar Desk',
        href: '/dashboard/calendar',
        icon: Calendar,
        color: 'accent',
        summary: 'Interactive 7x5 month grid mapping all university deadlines, committee meetings, workshops, and flagship festivals.',
        whatYouCanDo: [
          'Browse upcoming milestones month-by-month',
          'Filter by campus location (Main Campus, South Campus, Virtual)',
          'Click any calendar date to inspect scheduled events and timings',
        ],
        keyInformation: [
          'Multi-day event spans color-coded by category',
          'Meeting links, room numbers, and speaker agendas',
          'Real-time sync with newly approved event proposals',
        ],
        accessBadge: 'All Campuses View',
      },
    ];

    // Conditionally append Budgeting desk for Finance / Centre Heads / Super Users
    if (isSuper || isHead || isFinance) {
      steps.push({
        id: 'budget',
        title: 'Financial Portfolios & Budgets',
        moduleName: 'Finance & Budgets',
        href: '/dashboard/budget',
        icon: DollarSign,
        color: 'warning',
        summary: 'Executive ledger managing capital allocations, departmental operating funds, event sponsorships, and expenditure audits.',
        whatYouCanDo: [
          'Review financial allocation caps by committee department',
          'Verify budget requests before disbursement',
          'Export audited financial spreadsheets for university accounting',
        ],
        keyInformation: [
          'Total Allocation, Utilized Funds, and Remaining Capital KPIs',
          'Department-wise progress bars and transaction ledgers',
          'Cleared vs. Pending expenditure reconciliations',
        ],
        accessBadge: 'Executive Financial Clearance',
      });
    }

    // Reimbursements desk
    steps.push({
      id: 'reimbursements',
      title: 'Expense Claims & Reimbursements',
      moduleName: 'Reimbursements Pipeline',
      href: '/dashboard/reimbursements',
      icon: Receipt,
      color: 'success',
      summary: 'Dual-Stage verification workflow for member out-of-pocket expenses, travel claims, and purchase bills.',
      whatYouCanDo: isSuper || isHead || isFinance
        ? [
            'Audit attached receipt bills and invoice documents',
            'Grant Stage 1 (Verification) and Stage 2 (Disbursement) approvals',
            'Issue settlement receipts and track payment status',
          ]
        : [
            'Submit new reimbursement claims with receipt photo uploads',
            'Track live status through the verification pipeline',
            'Receive disbursement confirmations upon financial settlement',
          ],
      keyInformation: [
        'Claim ID, requester details, expense category, and amount',
        'Verification status pills (Pending, Verified, Approved, Settled)',
        'Attached digital bills, GST invoices, and payment receipts',
      ],
      accessBadge: isSuper || isHead || isFinance ? 'Approval Authority' : 'Submitter',
    });

    // Designs & Media Desk
    steps.push({
      id: 'designs',
      title: 'Design Assets & Dual-Gate Approvals',
      moduleName: 'Design Portal',
      href: '/dashboard/designs',
      icon: Palette,
      color: 'accent',
      summary: 'Brand compliance management system enforcing Gate 1 (Brand Style Compliance) and Gate 2 (Text Proofreading) prior to public release.',
      whatYouCanDo: isSuper || user.department?.toLowerCase().includes('design')
        ? [
            'Upload new poster artwork, social banners, and badges',
            'Grant Dual-Gate clearances (Style Compliance & Proofread)',
            'Manage master high-res print assets and public download links',
          ]
        : [
            'Browse approved marketing materials and banners',
            'Download official promotional creatives for campus drives',
            'Verify release status before sharing content externally',
          ],
      keyInformation: [
        'Visual asset thumbnail previews with dimension tags',
        'Gate 1 Style & Gate 2 Proofread status pills',
        'Lead designer credits and download repositories',
      ],
      accessBadge: 'Brand Portal',
    });

    // Performance Ratings Desk
    steps.push({
      id: 'ratings',
      title: 'Performance Appraisals & Radar',
      moduleName: 'Ratings Desk',
      href: '/dashboard/ratings',
      icon: Award,
      color: 'warning',
      summary: 'Analytical competency framework scoring leadership, initiative, dependability, communication, and technical execution.',
      whatYouCanDo: [
        'Inspect your 5-point competency radar chart and historical growth',
        'Review feedback notes and peer recognitions',
        isSuper ? 'Record semester ratings and feedback for committee members' : 'View personal performance scorecards',
      ],
      keyInformation: [
        '5-Axis Radar Diagram (Initiative, Quality, Teamwork, Timeliness, Leadership)',
        'Cumulative GPA rating scorecards (out of 5.0)',
        'Recognition badges and promotion eligibility flags',
      ],
      accessBadge: 'Confidential Records',
    });

    // Public Forms Desk
    steps.push({
      id: 'forms',
      title: 'Dynamic QR Forms & Registrations',
      moduleName: 'Forms Desk',
      href: '/dashboard/forms',
      icon: FileSpreadsheet,
      color: 'primary',
      summary: 'Generates scannable QR-coded registration forms, event feedback questionnaires, and automated attendee spreadsheets.',
      whatYouCanDo: [
        'Generate high-resolution printable QR codes for event venues',
        'Inspect live registration counts and attendee responses',
        'Export response datasets directly to Excel / CSV format',
      ],
      keyInformation: [
        'Form title, active status switch, and response counters',
        'Direct shareable registration URLs and downloadable QR posters',
        'Attendee submission tables with timestamp records',
      ],
      accessBadge: 'Forms Manager',
    });

    // Settings (Tier 1 Super User only)
    if (isSuper) {
      steps.push({
        id: 'settings',
        title: 'Master Settings & Security Vault',
        moduleName: 'Settings & Security',
        href: '/dashboard/settings',
        icon: Settings,
        color: 'danger',
        summary: 'Root security console for AES-256 master key management, encrypted backup snapshots, lockdown controls, and tamper-evident audit logs.',
        whatYouCanDo: [
          'Rotate AES-256 master encryption keys and view security status',
          'Download encrypted full JSON backups or restore data snapshots',
          'Toggle emergency Emergency Lockdown mode and inspect audit logs',
        ],
        keyInformation: [
          'Cryptographic status and database integrity verification',
          'Comprehensive audit trails recording every user login and mutation',
          'Global campus configuration and maintenance switches',
        ],
        accessBadge: 'Super User Exclusive (Tier 1)',
      });
    }

    return steps;
  };

  const steps = getTailoredSteps();
  const currentStep = steps[currentStepIndex] || steps[0];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;
  const progressPercent = Math.round(((currentStepIndex + 1) / steps.length) * 100);

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const handleComplete = () => {
    try {
      localStorage.setItem(`rtbi_tour_completed_${user.email || user.name}`, 'true');
    } catch {}
    onClose();
  };

  const handleNavigateToModule = (href: string) => {
    handleComplete();
    router.push(href);
  };

  if (!isOpen) return null;

  const IconComponent = currentStep.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-200 select-none">
      
      {/* Outer Modal Container */}
      <div className="relative w-full max-w-2xl glass-panel bg-space-theme/95 rounded-3xl border border-white/20 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Top Progress Bar */}
        <div className="w-full h-1.5 bg-white/10 relative overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-accent via-primary-light to-accent transition-all duration-300 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-2xl bg-accent/20 border border-accent/30 text-accent shrink-0">
              <Compass className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-accent">
                  Interactive Guided Tour
                </span>
                <span className="text-white/30 text-xs hidden sm:inline">•</span>
                <span className="text-[11px] font-medium text-theme-text-secondary hidden sm:inline">
                  Step {currentStepIndex + 1} of {steps.length}
                </span>
              </div>
              <h3 className="text-sm font-extrabold text-theme-text-primary">
                {currentStep.moduleName}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Chip variant="flat" color={currentStep.color} size="sm">
              {currentStep.accessBadge}
            </Chip>
            <button
              onClick={handleComplete}
              className="p-2 text-theme-text-secondary hover:text-theme-text-primary hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              title="Close Tour"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {/* Modal Body / Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          
          {/* Main Step Hero Banner */}
          <div className="flex items-start gap-4 p-5 rounded-2xl bg-white/5 border border-white/10">
            <div className="p-3.5 rounded-2xl bg-accent/15 border border-accent/25 text-accent shrink-0">
              <IconComponent className="h-7 w-7" />
            </div>
            <div className="space-y-1.5 flex-1">
              <h2 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                {currentStep.title}
              </h2>
              <p className="text-xs text-theme-text-secondary leading-relaxed">
                {currentStep.summary}
              </p>
            </div>
          </div>

          {/* 2-Column Details: What You Can Do & What Is Shown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Box 1: What You Can Do */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-accent flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                What You Can Do:
              </h4>
              <ul className="space-y-2">
                {currentStep.whatYouCanDo.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-theme-text-primary/90">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent mt-1.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Box 2: Information Displayed */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-theme-text-secondary flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Information Displayed:
              </h4>
              <ul className="space-y-2">
                {currentStep.keyInformation.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-theme-text-secondary">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/40 mt-1.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>

          {/* Interactive Action: Jump to this Workspace */}
          {currentStep.id !== 'welcome' && (
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-accent/10 border border-accent/20">
              <div className="flex items-center gap-2.5 text-xs font-semibold text-theme-text-primary">
                <IconComponent className="h-4 w-4 text-accent" />
                <span>Want to explore this workspace right now?</span>
              </div>
              <button
                type="button"
                onClick={() => handleNavigateToModule(currentStep.href)}
                className="flex items-center gap-1.5 text-xs font-bold text-accent hover:text-primary-light transition-colors cursor-pointer"
              >
                <span>Open {currentStep.moduleName}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

        </div>

        {/* Modal Footer / Navigation Controls */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-between gap-3">
          
          {/* Left: Step Indicators */}
          <div className="flex items-center gap-1.5 hidden sm:flex">
            {steps.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => setCurrentStepIndex(idx)}
                className={`h-2 rounded-full transition-all cursor-pointer ${
                  idx === currentStepIndex
                    ? 'w-6 bg-accent'
                    : 'w-2 bg-white/20 hover:bg-white/40'
                }`}
                title={s.title}
              />
            ))}
          </div>

          {/* Right: Back / Next / Finish Buttons */}
          <div className="flex items-center gap-2.5 ml-auto">
            {!isFirstStep && (
              <Button
                variant="bordered"
                size="sm"
                onClick={handlePrev}
                startContent={<ChevronLeft className="h-4 w-4" />}
              >
                Previous
              </Button>
            )}

            <Button
              variant="light"
              size="sm"
              onClick={handleComplete}
            >
              Skip Tour
            </Button>

            <RippleButton
              onClick={handleNext}
              className="bg-accent text-white hover:bg-primary-light text-xs font-bold h-9 px-4 rounded-xl shadow-md shadow-accent/20"
            >
              <span>{isLastStep ? "Got it! Let's Start" : 'Next Module'}</span>
              {!isLastStep && <ChevronRight className="h-4 w-4 ml-1" />}
            </RippleButton>
          </div>

        </div>

      </div>

    </div>
  );
}
