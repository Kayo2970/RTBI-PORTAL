import { readCollection } from '@/lib/server-db';
import type { EventItem, EventPassItem } from '@/lib/local-data';
import { isPassArchived } from '@/lib/pass-retention';

export interface PassLookup {
  pass: EventPassItem;
  event?: EventItem;
  archived: boolean;
}

/** Serial-addressed lookup shared by the public pass routes. */
export async function lookupPassBySerial(serial: string): Promise<PassLookup | null> {
  const passes = await readCollection<EventPassItem>('event_passes');
  const pass = passes.find((p) => p.serialNumber.toLowerCase() === serial.toLowerCase());
  if (!pass) return null;
  const events = await readCollection<EventItem>('events');
  const event = events.find((e) => e.id === pass.eventId);
  return { pass, event, archived: isPassArchived(pass, event) };
}
