import React from 'react';

/** Page title block: one h1 per page, optional breadcrumb above, actions on the right (primary action last). */
export function PageHeader({ title, description, icon, breadcrumb, actions }: {
  title: string; description?: string; icon?: React.ReactNode; breadcrumb?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        {breadcrumb && <div className="text-sm text-theme-text-secondary mb-1">{breadcrumb}</div>}
        <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-2.5">{icon}{title}</h1>
        {description && <p className="text-sm text-theme-text-secondary mt-1 max-w-3xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
