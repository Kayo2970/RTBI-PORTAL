'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  PASS_EMAIL_PLACEHOLDERS,
  DEFAULT_PASS_EMAIL_BODY,
  DEFAULT_PASS_EMAIL_SUBJECT,
  PassEmailTemplate,
  loadPassEmailTemplate,
  savePassEmailTemplate,
} from '@/lib/pass-email-template';

/** The shared pass-email template: loaded from / saved to this browser so every dispatch screen uses the same message. */
/** Pass `active` (e.g. modal isOpen) so the latest saved template is re-read each time a screen opens. */
export function usePassEmailTemplate(active: boolean = true): [PassEmailTemplate, (t: PassEmailTemplate) => void] {
  const [template, setTemplate] = useState<PassEmailTemplate>({ subject: DEFAULT_PASS_EMAIL_SUBJECT, body: DEFAULT_PASS_EMAIL_BODY });
  const loaded = useRef(false);
  useEffect(() => {
    if (!active) return;
    setTemplate(loadPassEmailTemplate());
    loaded.current = true;
  }, [active]);
  const update = useCallback((t: PassEmailTemplate) => {
    setTemplate(t);
    if (loaded.current) savePassEmailTemplate(t);
  }, []);
  return [template, update];
}

interface Props {
  template: PassEmailTemplate;
  onChange: (t: PassEmailTemplate) => void;
  bodyRows?: number;
}

export function PassEmailComposer({ template, onChange, bodyRows = 12 }: Props) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const insert = (tag: string) => {
    const el = bodyRef.current;
    if (!el) return onChange({ ...template, body: `${template.body} ${tag}` });
    const start = el.selectionStart ?? template.body.length;
    const end = el.selectionEnd ?? start;
    const next = template.body.slice(0, start) + tag + template.body.slice(end);
    onChange({ ...template, body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  };

  const isDefault = template.subject === DEFAULT_PASS_EMAIL_SUBJECT && template.body === DEFAULT_PASS_EMAIL_BODY && !template.includeMap && !template.includeWhatsapp;
  const field = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-accent text-xs';

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-500">One message for Mail-Merge and Preview &amp; dispatch — saved in this browser.</span>
        {!isDefault && (
          <button type="button" onClick={() => onChange({ subject: DEFAULT_PASS_EMAIL_SUBJECT, body: DEFAULT_PASS_EMAIL_BODY, includeMap: false, mapUrl: '', includeWhatsapp: false, whatsappUrl: '' })} className="flex items-center gap-1 text-[10.5px] font-bold text-sky-400 hover:underline cursor-pointer shrink-0">
            <RotateCcw className="h-3 w-3" /> Reset to default
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">Subject</label>
        <input type="text" value={template.subject} onChange={(e) => onChange({ ...template, subject: e.target.value })} className={`${field} font-semibold`} />
      </div>
      <div className="space-y-1.5">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Click to insert at the cursor</span>
        <div className="flex flex-wrap gap-1.5">
          {PASS_EMAIL_PLACEHOLDERS.map((ph) => (
            <button type="button" key={ph.tag} title={ph.desc} onClick={() => insert(ph.tag)} className="px-2 py-0.5 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 text-[10.5px] font-mono font-bold cursor-pointer transition-colors">
              {ph.tag}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-[11px]">Message</label>
        <textarea ref={bodyRef} rows={bodyRows} value={template.body} onChange={(e) => onChange({ ...template, body: e.target.value })} className={`${field} font-mono leading-relaxed`} />
        <p className="text-[10px] text-slate-500">
          <code>@pass_image</code> and <code>@details</code> choose where the wide ticket and the details table sit; if you leave them out, the ticket goes first and the details after your message. The wallet / calendar buttons always follow.
        </p>
      </div>
      <div className="space-y-2.5 rounded-xl border border-slate-200 dark:border-white/10 p-3">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Extra buttons in the email</span>
        <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
          <input type="checkbox" checked={!!template.includeMap} onChange={(e) => onChange({ ...template, includeMap: e.target.checked })} />
          Send the venue location (Google Maps)
        </label>
        {template.includeMap && (
          <input type="url" placeholder="Google Maps link (leave blank to search the pass's venue)" value={template.mapUrl || ''} onChange={(e) => onChange({ ...template, mapUrl: e.target.value })} className={field} />
        )}
        <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
          <input type="checkbox" checked={!!template.includeWhatsapp} onChange={(e) => onChange({ ...template, includeWhatsapp: e.target.checked })} />
          Invite them to the event WhatsApp group
        </label>
        {template.includeWhatsapp && (
          <input type="url" placeholder="WhatsApp group invite link (https://chat.whatsapp.com/…)" value={template.whatsappUrl || ''} onChange={(e) => onChange({ ...template, whatsappUrl: e.target.value })} className={field} />
        )}
        {template.includeWhatsapp && !/^https?:\/\/\S+$/i.test((template.whatsappUrl || '').trim()) && (
          <p className="text-[10px] text-amber-500">Paste the group invite link — the WhatsApp button is left out until you do.</p>
        )}
        <p className="text-[10px] text-slate-500">Links are saved in this browser. Change them when you switch to another event.</p>
      </div>
    </div>
  );
}
