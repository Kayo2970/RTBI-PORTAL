'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authHeaders } from '@/lib/local-data';

type Background = 'default' | 'none' | { storageKey: string; blur: number } | undefined;

/** Wraps an HTML fragment the way a mail client's reading pane would (a full document is shown as it is). */
function toDocument(html: string, frameColor: string): string {
  return /<body[\s>]/i.test(html) ? html : `<html><body style="margin:0;padding:12px;background:${frameColor};">${html}</body></html>`;
}

/**
 * The finished e-mail, as it will actually be sent — header banner, badge, message card and the blurred background — built by the
 * server with the same code that sends mail (POST /api/email/preview). Re-renders (debounced) whenever the content or the
 * background choice changes. For e-mails that bring their own HTML (event passes) pass `bodyHtml`; it is shown straight away
 * and replaced by the server's version (with the background) once it arrives.
 */
export function EmailHtmlPreview({
  subject = '',
  bodyText = '',
  bodyHtml,
  category = 'DIRECT_MESSAGE',
  badgeText,
  badgeColor,
  background,
  className = 'w-full h-[420px] rounded-2xl border border-slate-200 dark:border-white/15 bg-slate-200',
  frameColor = '#e2e8f0',
  title = 'Email preview',
}: {
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  category?: string;
  badgeText?: string;
  badgeColor?: string;
  background?: Background;
  className?: string;
  frameColor?: string;
  title?: string;
}) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const bgKey = JSON.stringify(background ?? null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/email/preview', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ subject, bodyText, bodyHtml, category, badgeText, badgeColor, background }),
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setHtml(res.ok && typeof data.html === 'string' ? data.html : '');
      } catch {
        if (!cancelled) setHtml('');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // `background` is tracked through bgKey so an inline object doesn't re-fire the effect on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, bodyText, bodyHtml, category, badgeText, badgeColor, bgKey]);

  const shown = html || bodyHtml || '';
  return (
    <div className="relative">
      <iframe title={title} sandbox="" srcDoc={shown ? toDocument(shown, frameColor) : ''} className={className} />
      {loading && <Loader2 className="absolute top-2 right-2 h-4 w-4 animate-spin text-slate-500" />}
    </div>
  );
}
