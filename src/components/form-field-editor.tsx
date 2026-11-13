'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import { FormField } from '@/lib/local-data';

interface Props {
  field: FormField;
  onChange: (key: keyof FormField, value: any) => void;
  onRemove: () => void;
  canRemove: boolean;
  allowCheckbox?: boolean;
  /** Whether the form/template being edited is linked to an event (enables "from the event" defaults). */
  eventLinked?: boolean;
}

const input = 'w-full px-3 py-1.5 bg-theme-background/40 border border-theme-border/30 rounded-lg text-theme-text-primary text-xs';

/**
 * One question row in the form builder / template editor: label, type, required, choices, and an optional
 * default value (typed, picked, or taken from the linked event's name / date / venue).
 */
export function FormFieldEditor({ field, onChange, onRemove, canRemove, allowCheckbox, eventLinked }: Props) {
  const hasDefault = field.defaultValue !== undefined || field.defaultSource !== undefined;
  const textLike = field.type === 'text' || field.type === 'email' || field.type === 'textarea' || field.type === 'number';
  const eventCapable = field.type === 'text' || field.type === 'textarea';

  const setDefaultOn = (on: boolean) => {
    if (!on) {
      onChange('defaultValue', undefined);
      onChange('defaultSource', undefined);
      onChange('lockDefault', undefined);
      return;
    }
    // Sensible starting point: a question that looks like "Name of event" starts on the event's name
    const looksLikeEvent = /event/i.test(field.label) && /name|title/i.test(field.label);
    if (eventCapable && looksLikeEvent && eventLinked) onChange('defaultSource', 'event_name');
    onChange('defaultValue', field.type === 'multiselect' ? [] : field.type === 'checkbox' ? true : field.type === 'select' ? field.options?.[0] || '' : '');
  };

  return (
    <div className="p-3 bg-theme-border/10 border border-theme-border/20 rounded-xl space-y-2">
      <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
        <div className="flex-1 min-w-[160px] space-y-1">
          <input type="text" required value={field.label} onChange={(e) => onChange('label', e.target.value)} placeholder="Question Label" className={input} />
        </div>
        <div className="w-36 shrink-0">
          <select value={field.type} onChange={(e) => onChange('type', e.target.value)} className="w-full px-2 py-1.5 bg-theme-background/40 border border-theme-border/30 rounded-lg text-theme-text-primary text-xs">
            <option value="text">Short Text</option>
            <option value="email">Email</option>
            <option value="number">Number</option>
            <option value="textarea">Paragraph</option>
            <option value="scale">Scale (1-5)</option>
            <option value="select">Single Choice</option>
            <option value="multiselect">Multiple Choice</option>
            {allowCheckbox && <option value="checkbox">Checkbox (Yes toggle)</option>}
          </select>
        </div>
        <label className="flex items-center gap-1 text-[11px] text-theme-text-secondary cursor-pointer shrink-0">
          <input type="checkbox" checked={field.required} onChange={(e) => onChange('required', e.target.checked)} className="accent-accent" />
          Required
        </label>
        <button type="button" onClick={onRemove} disabled={!canRemove} className="p-1.5 hover:bg-danger/10 rounded-lg text-danger transition-all cursor-pointer disabled:opacity-30 shrink-0" title="Remove Question">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {(field.type === 'select' || field.type === 'multiselect') && (
        <div className="pl-0.5 space-y-1">
          <label className="block text-[10px] font-medium text-theme-text-secondary">
            {field.type === 'multiselect' ? 'Choices (respondent can pick one or more)' : 'Choices (respondent picks exactly one)'}
          </label>
          <input
            type="text"
            defaultValue={(field.options || []).join(', ')}
            key={`${field.id}-options`}
            onBlur={(e) => onChange('options', e.target.value.split(',').map((o) => o.trim()).filter(Boolean))}
            onChange={(e) => onChange('options', e.target.value.split(',').map((o) => o.trim()).filter(Boolean))}
            placeholder="e.g. Workshop, Guest Lecture, Seminar/Conference"
            className={input}
          />
        </div>
      )}

      {/* Default value */}
      <div className="pl-0.5 space-y-1.5">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-theme-text-secondary cursor-pointer w-fit">
          <input type="checkbox" checked={hasDefault} onChange={(e) => setDefaultOn(e.target.checked)} className="accent-accent" />
          Set a default value
        </label>

        {hasDefault && (
          <div className="space-y-1.5 rounded-lg border border-accent/20 bg-accent/5 p-2.5">
            {eventCapable && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-medium text-theme-text-secondary shrink-0">Fill with</span>
                <select
                  value={field.defaultSource || 'typed'}
                  onChange={(e) => onChange('defaultSource', e.target.value === 'typed' ? undefined : e.target.value)}
                  className="px-2 py-1 bg-theme-background/40 border border-theme-border/30 rounded-lg text-theme-text-primary text-xs"
                >
                  <option value="typed">A value I type</option>
                  <option value="event_name">The linked event&apos;s name</option>
                  <option value="event_date">The linked event&apos;s date</option>
                  <option value="event_venue">The linked event&apos;s venue</option>
                </select>
                {field.defaultSource && !eventLinked && (
                  <span className="text-[10px] text-amber-400 font-semibold">Link this form to an event above for this to fill in.</span>
                )}
              </div>
            )}

            {(!field.defaultSource || !eventCapable) && textLike && (
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                value={typeof field.defaultValue === 'string' ? field.defaultValue : ''}
                onChange={(e) => onChange('defaultValue', e.target.value)}
                placeholder={field.type === 'email' ? 'name@example.com' : 'Type the default answer'}
                className={input}
              />
            )}
            {field.defaultSource && eventCapable && (
              <input
                type="text"
                value={typeof field.defaultValue === 'string' ? field.defaultValue : ''}
                onChange={(e) => onChange('defaultValue', e.target.value)}
                placeholder="Fallback if no event is linked (optional)"
                className={input}
              />
            )}

            {field.type === 'select' && (
              <select value={typeof field.defaultValue === 'string' ? field.defaultValue : ''} onChange={(e) => onChange('defaultValue', e.target.value)} className={input}>
                <option value="">— none —</option>
                {(field.options || []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            )}

            {field.type === 'multiselect' && (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {(field.options || []).length === 0 && <span className="text-[10px] text-theme-text-secondary">Add choices above first.</span>}
                {(field.options || []).map((o) => {
                  const cur = Array.isArray(field.defaultValue) ? field.defaultValue : [];
                  return (
                    <label key={o} className="flex items-center gap-1 text-[11px] text-theme-text-primary cursor-pointer">
                      <input type="checkbox" checked={cur.includes(o)} onChange={(e) => onChange('defaultValue', e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} className="accent-accent" />
                      {o}
                    </label>
                  );
                })}
              </div>
            )}

            {field.type === 'scale' && (
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => onChange('defaultValue', String(field.defaultValue) === String(n) ? '' : String(n))}
                    className={`h-7 w-7 rounded-lg text-xs font-bold border cursor-pointer ${String(field.defaultValue) === String(n) ? 'bg-accent text-white border-accent' : 'border-theme-border/40 text-theme-text-secondary hover:border-accent'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}

            {field.type === 'checkbox' && (
              <label className="flex items-center gap-1.5 text-[11px] text-theme-text-primary cursor-pointer">
                <input type="checkbox" checked={field.defaultValue === true} onChange={(e) => onChange('defaultValue', e.target.checked)} className="accent-accent" />
                Ticked by default
              </label>
            )}

            <label className="flex items-center gap-1.5 text-[11px] text-theme-text-primary cursor-pointer w-fit">
              <input type="checkbox" checked={field.lockDefault !== false} onChange={(e) => onChange('lockDefault', e.target.checked ? undefined : false)} className="accent-accent" />
              Lock it — respondents see it but can&apos;t edit it
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
