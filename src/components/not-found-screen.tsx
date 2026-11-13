import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

/**
 * Generic "Page Not Found" screen. Used both for genuinely missing routes
 * (via app/not-found.tsx) and, deliberately identical, as what everyone
 * except the Super User sees for every dashboard page while site-wide
 * lockdown is enabled — it reads as an ordinary 404, not a maintenance notice.
 */
export function NotFoundScreen() {
  return (
    <div className="min-h-screen bg-space-theme flex flex-col items-center justify-center p-4 text-center">
      <div className="glass-panel w-full max-w-md rounded-3xl p-10 flex flex-col items-center space-y-5 border border-theme-card-border shadow-2xl">
        <div className="h-16 w-16 rounded-2xl bg-theme-border/10 border border-theme-border/20 flex items-center justify-center text-theme-text-secondary">
          <FileQuestion className="h-8 w-8" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold text-theme-text-primary">404</h1>
          <p className="text-sm font-semibold text-theme-text-primary">Page Not Found</p>
          <p className="text-xs text-theme-text-secondary leading-relaxed max-w-xs">
            The page you're looking for doesn't exist or may have been moved.
          </p>
        </div>
        <Link
          href="/"
          className="px-5 py-2.5 bg-theme-border/10 hover:bg-theme-border/20 text-theme-text-primary text-xs font-semibold rounded-xl transition-all"
        >
          Return Home
        </Link>
      </div>
    </div>
  );
}
