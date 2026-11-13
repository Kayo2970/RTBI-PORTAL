import type { EventPassItem } from '@/lib/local-data';
import { getPassValidDays } from '@/lib/local-data';

const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** All-day .ics spanning the pass's valid days (one pass, one QR, many days). */
export function buildPassIcs(pass: EventPassItem, passUrl: string): string {
  const days = getPassValidDays(pass);
  const fromLabel = ((pass.eventDate || pass.validityDate || '').match(/\d{4}-\d{2}-\d{2}/g) || []).sort();
  const first = days[0] || fromLabel[0] || new Date().toISOString().slice(0, 10);
  const last = days[days.length - 1] || fromLabel[fromLabel.length - 1] || first;
  const end = new Date(`${last}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const compact = (iso: string) => iso.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RTBI//Official Event Pass//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${pass.id}@rtbi-portal`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${esc(`${pass.eventName} (${pass.passType})`)}`,
    `LOCATION:${esc(pass.roomOrVenue || pass.eventVenue || 'Main Auditorium')}`,
    `DESCRIPTION:${esc(`Official pass for ${pass.attendeeName}.\nSerial: ${pass.serialNumber}\nYour pass: ${passUrl}`)}`,
    `DTSTART;VALUE=DATE:${compact(first)}`,
    `DTEND;VALUE=DATE:${compact(end.toISOString().slice(0, 10))}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
