import { readCollection } from '@/lib/server-db';
import { formatEventDateRange, FormEventInfo } from '@/lib/local-data';

/** Live details of a form's linked event (so "default = the event's name/date/venue" follows renames/reschedules). */
export async function getFormEventInfo(form: { eventId?: string }): Promise<FormEventInfo | undefined> {
  if (!form.eventId) return undefined;
  const events = await readCollection<any>('events');
  const ev = events.find((e: any) => e.id === form.eventId);
  if (!ev) return undefined;
  return {
    name: ev.title,
    date: ev.datesTBD ? undefined : formatEventDateRange(ev),
    venue: ev.location || undefined,
  };
}
