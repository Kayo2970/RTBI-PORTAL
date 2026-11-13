/**
 * csv.ts — shared, quote-aware CSV parsing/serialization so every
 * export/import pair in the app round-trips correctly (a name, role, or
 * address containing a comma or a quote survives being downloaded and then
 * re-uploaded), instead of each page hand-rolling its own `line.split(',')`.
 */

/** Parses one CSV line into fields, respecting double-quoted fields that may
 *  contain commas and escaped ("") quotes. */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/** Splits full CSV text into non-empty lines, ready for parseCsvLine. */
export function splitCsvLines(text: string): string[] {
  return text.split('\n').filter(l => l.trim() !== '');
}

/** Quotes and escapes a single field for CSV output — always quoted so a
 *  value containing a comma, quote, or newline survives round-tripping. */
export function toCsvField(value: string | number | null | undefined): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/** Joins already-quoted-or-raw field values into one CSV row (fields are
 *  quoted via toCsvField). */
export function toCsvRow(values: (string | number | null | undefined)[]): string {
  return values.map(toCsvField).join(',');
}

/** Triggers a browser download of `content` as a CSV file named `filename`. */
export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
