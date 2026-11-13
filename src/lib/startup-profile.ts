/**
 * startup-profile.ts — shared shape + option lists for the Startup (tier 4)
 * profile that is built during account activation (/activate). Stored on the
 * member record as `startupProfile`. Safe to import from client and server.
 */

export const STARTUP_SECTORS = [
  'AgriTech', 'AI / ML', 'Biotech & Healthcare', 'Clean Energy & Climate', 'Consumer & D2C',
  'DeepTech & Hardware', 'EdTech', 'FinTech', 'Logistics & Mobility', 'Manufacturing',
  'SaaS & Enterprise', 'Social Impact', 'Other',
] as const;

export const STARTUP_STAGES = [
  'Idea', 'Prototype / MVP', 'Early Revenue', 'Growth', 'Scaling',
] as const;

export const STARTUP_TEAM_SIZES = ['1', '2–5', '6–10', '11–25', '26–50', '50+'] as const;

export const MAX_STARTUP_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
export const STARTUP_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export interface StartupProfile {
  startupName: string;
  tagline?: string;
  logoUrl?: string;        // servable path under /api/files
  logoStorageKey?: string; // path relative to data/uploads
  sector: string;
  stage: string;
  foundedYear?: string;
  teamSize?: string;
  location?: string;
  website?: string;
  aboutUs: string;
  problem?: string;
  solution?: string;
  socials?: { linkedin?: string; twitter?: string; instagram?: string };
  completedAt?: string;
}

/** What the activation form sends: StartupProfile minus server-owned fields, plus the transient logo upload. */
export type StartupProfileInput = Omit<StartupProfile, 'logoUrl' | 'logoStorageKey' | 'completedAt'> & {
  logoData?: string;     // base64 data URL, converted to a stored file server-side
  logoFileName?: string;
};
