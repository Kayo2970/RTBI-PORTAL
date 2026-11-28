import { KINDS } from '@/lib/incubation/kinds';

export interface StageLink { label: string; href: string; staffOnly?: boolean; managerOnly?: boolean }
export interface Stage { id: string; label: string; href: string; links: StageLink[]; staffOnly?: boolean }

const rec = (kind: string): StageLink => ({ label: KINDS[kind].plural, href: `/dashboard/incubation/records/${kind}`, managerOnly: !!KINDS[kind].restricted });

/** Programme lifecycle: the incubation area's navigation. Registers sit under the stage they belong to. */
export const STAGES: Stage[] = [
  { id: 'overview', label: 'Overview', href: '/dashboard/incubation/overview', links: [], staffOnly: true },
  { id: 'pipeline', label: 'Pipeline', href: '/dashboard/incubation/applications', staffOnly: true, links: [
    { label: 'Applications', href: '/dashboard/incubation/applications', staffOnly: true },
    { label: 'Onboarding', href: '/dashboard/incubation/onboarding', staffOnly: true },
  ] },
  { id: 'startups', label: 'Startups', href: '/dashboard/incubation', links: [] },
  { id: 'programme', label: 'Programme', href: '/dashboard/incubation/records/cohort', links: ['cohort', 'milestone', 'progress', 'programEvent', 'mentor', 'mentorSession', 'partnership', 'meeting'].map(rec) },
  { id: 'compliance', label: 'Compliance', href: '/dashboard/incubation/records/review', links: ['review', 'trl', 'agreement', 'evidence', 'renewal', 'incident'].map(rec) },
  { id: 'exit', label: 'Graduation & exit', href: '/dashboard/incubation/records/graduation', links: ['graduation', 'exit'].map(rec) },
  { id: 'reports', label: 'Reports', href: '/dashboard/incubation/reports', staffOnly: true, links: [] },
  { id: 'kpi', label: 'KPIs', href: '/dashboard/incubation/kpi', staffOnly: true, links: [] },
  { id: 'settings', label: 'Settings', href: '/dashboard/incubation/settings', staffOnly: true, links: [] },
];

export function stageForPath(pathname: string): Stage | undefined {
  const rec = pathname.match(/^\/dashboard\/incubation\/records\/([^/]+)/);
  if (rec) return STAGES.find((s) => s.links.some((l) => l.href.endsWith('/' + rec[1])));
  const hit = STAGES.filter((s) => s.id !== 'startups' && (pathname === s.href || pathname.startsWith(s.href + '/') || s.links.some((l) => pathname.startsWith(l.href))));
  return hit[0] ?? (pathname === '/dashboard/incubation' ? STAGES.find((s) => s.id === 'startups') : undefined);
}
