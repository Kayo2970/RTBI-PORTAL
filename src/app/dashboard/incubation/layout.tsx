'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { STAGES, stageForPath } from '@/components/incubation/stages';
import { isManagerUi, isStaffUi, useCurrentUser } from '@/components/incubation/ui';

/** Incubation shell: one row of lifecycle stages, plus a second row of registers for the active stage. */
export default function IncubationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useCurrentUser();
  const staff = isStaffUi(user);
  const manager = isManagerUi(user);
  const external = !!user && user.tier === 3 && user.externalReviewer === true;
  const startupUser = !!user && user.tier === 4;

  // External reviewers and startups get a reduced menu; everything else is gated by the same flags as before.
  if (user && (external || startupUser)) {
    const only = external ? [{ id: 'apps', label: 'Applications', href: '/dashboard/incubation/applications' }] : [{ id: 'ws', label: 'My programme', href: '/dashboard/incubation/workspace' }, { id: 'progress', label: 'Progress submission', href: '/dashboard/incubation/records/progress' }];
    return (
      <>
        <nav aria-label="Incubation" className="px-6 md:px-8 pt-4 border-b border-theme-border bg-theme-card">
          <ul className="flex gap-1">{only.map((s) => <li key={s.id}><Link href={s.href} aria-current={pathname === s.href || pathname.startsWith(s.href + '/') ? 'page' : undefined} className={`inline-flex items-center min-h-11 px-4 text-sm font-semibold border-b-2 -mb-px ${pathname === s.href || pathname.startsWith(s.href + '/') ? 'border-accent' : 'border-transparent text-theme-text-secondary'}`}>{s.label}</Link></li>)}</ul>
        </nav>
        {children}
      </>
    );
  }

  const stages = STAGES.filter((s) => !s.staffOnly || staff);
  const active = stageForPath(pathname);
  const links = (active?.links ?? []).filter((l) => (!l.staffOnly || staff) && (!l.managerOnly || manager));

  return (
    <>
      <div className="border-b border-theme-border bg-theme-card">
        <nav aria-label="Incubation stages" className="px-4 md:px-8 pt-3 overflow-x-auto">
          <ul className="flex gap-1 min-w-max">
            {stages.map((s) => {
              const on = s.id === active?.id;
              return (
                <li key={s.id}>
                  <Link href={s.href} aria-current={on ? 'page' : undefined}
                    className={`inline-flex items-center min-h-11 px-4 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${on ? 'border-accent text-theme-text-primary' : 'border-transparent text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-border/20'}`}>
                    {s.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {links.length > 1 && (
          <nav aria-label={`${active?.label} sections`} className="px-4 md:px-8 py-2 overflow-x-auto bg-theme-border/10">
            <ul className="flex gap-2 min-w-max">
              {links.map((l) => {
                const on = pathname === l.href || pathname.startsWith(l.href + '/');
                return (
                  <li key={l.href}>
                    <Link href={l.href} aria-current={on ? 'page' : undefined}
                      className={`inline-flex items-center min-h-10 px-4 rounded-full text-sm font-semibold border transition-colors ${on ? 'bg-primary text-white border-primary dark:bg-white/15 dark:border-white/30' : 'border-theme-border text-theme-text-primary hover:bg-theme-border/20'}`}>
                      {l.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>
      {children}
    </>
  );
}
