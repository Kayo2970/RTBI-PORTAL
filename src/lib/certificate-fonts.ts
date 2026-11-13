/**
 * Custom certificate fonts (server only): uploaded font files or Google Fonts imports, kept under data/uploads/certificate-fonts/
 * as `<id>__<weight>_<style>.<ext>`. Every file of one id is registered under the same canvas family so bold / italic resolve.
 */
import fs from 'fs/promises';
import path from 'path';
import { GlobalFonts } from '@napi-rs/canvas';

const DIR = path.join(process.cwd(), 'data', 'uploads', 'certificate-fonts');
const EXTS = ['ttf', 'otf', 'woff', 'woff2'];
const registered = new Set<string>();
const MAX_FONT_BYTES = 8 * 1024 * 1024;

export interface CustomFont {
  id: string;
  label: string;
  files: number;
}

export const slugFontId = (name: string) =>
  name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export const customFamily = (id: string) => `Cust_${id.replace(/-/g, '_')}`;

async function files(): Promise<string[]> {
  try {
    return (await fs.readdir(DIR)).filter((f) => EXTS.includes(f.split('.').pop() || ''));
  } catch {
    return [];
  }
}

export async function listCustomFonts(): Promise<CustomFont[]> {
  const byId = new Map<string, CustomFont>();
  for (const f of await files()) {
    const id = f.split('__')[0];
    const cur = byId.get(id);
    if (cur) cur.files++;
    else byId.set(id, { id, label: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), files: 1 });
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Registers every stored font with the canvas (idempotent; call before rendering). */
export async function registerCustomFonts(): Promise<void> {
  for (const f of await files()) {
    if (registered.has(f)) continue;
    registered.add(f);
    try {
      GlobalFonts.registerFromPath(path.join(DIR, f), customFamily(f.split('__')[0]));
    } catch {
      /* unreadable font: text falls back to the next family in the stack */
    }
  }
}

function sniffExt(buf: Buffer): string | null {
  const m = buf.subarray(0, 4).toString('latin1');
  if (m === 'wOFF') return 'woff';
  if (m === 'wOF2') return 'woff2';
  if (m === 'OTTO') return 'otf';
  if (buf.readUInt32BE(0) === 0x00010000 || m === 'true') return 'ttf';
  return null;
}

async function writeFont(id: string, weight: number, style: string, buf: Buffer): Promise<void> {
  if (buf.length > MAX_FONT_BYTES) throw new Error('Font file is too large (max 8 MB).');
  const ext = sniffExt(buf);
  if (!ext) throw new Error('That is not a valid font file (use .ttf, .otf, .woff or .woff2).');
  await fs.mkdir(DIR, { recursive: true });
  const name = `${id}__${weight}_${style}.${ext}`;
  await fs.writeFile(path.join(DIR, name), buf);
  registered.delete(name);
}

export async function saveUploadedFont(displayName: string, dataUrl: string): Promise<string> {
  const id = slugFontId(displayName);
  if (!id) throw new Error('Give the font a name.');
  const buf = Buffer.from(dataUrl.split(',')[1] || '', 'base64');
  await writeFont(id, 400, 'normal', buf);
  return id;
}

export async function deleteCustomFont(id: string): Promise<void> {
  for (const f of await files()) if (f.split('__')[0] === id) await fs.unlink(path.join(DIR, f)).catch(() => {});
}

/** Accepts a fonts.google.com/specimen/<Name> link, a fonts.googleapis.com css/css2 link, or just the family name. */
export function googleFamilyFromLink(input: string): string | null {
  const v = input.trim();
  try {
    const u = new URL(v);
    if (u.hostname === 'fonts.google.com') {
      const seg = u.pathname.split('/').filter(Boolean);
      const i = seg.indexOf('specimen');
      return i >= 0 && seg[i + 1] ? decodeURIComponent(seg[i + 1]).replace(/\+/g, ' ') : null;
    }
    if (u.hostname === 'fonts.googleapis.com') {
      const fam = u.searchParams.get('family');
      return fam ? fam.split(':')[0].replace(/\+/g, ' ') : null;
    }
    return null;
  } catch {
    return /^[A-Za-z0-9 ]{2,60}$/.test(v) ? v : null;
  }
}

export async function importGoogleFont(link: string): Promise<string> {
  const family = googleFamilyFromLink(link);
  if (!family) throw new Error('Paste a Google Fonts link (fonts.google.com/specimen/… or a fonts.googleapis.com link) or a font name.');
  const id = slugFontId(family);
  const enc = encodeURIComponent(family).replace(/%20/g, '+');
  // An old user agent makes Google serve plain .ttf files
  const ua = { 'User-Agent': 'Mozilla/5.0 (X11; U; Linux x86_64; en-US) AppleWebKit/533.4 Gecko/20100101 Firefox/3.6' };
  let css = '';
  for (const spec of [`${enc}:ital,wght@0,400;0,700;1,400;1,700`, `${enc}:wght@400;700`, enc]) {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${spec}&display=swap`, { headers: ua });
    if (res.ok) {
      css = await res.text();
      break;
    }
  }
  if (!css) throw new Error(`Google Fonts has no family called "${family}".`);
  const blocks = css.match(/@font-face\s*{[^}]*}/g) || [];
  let saved = 0;
  for (const b of blocks) {
    const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(b)?.[1];
    if (!url) continue;
    const style = /font-style:\s*(\w+)/.exec(b)?.[1] === 'italic' ? 'italic' : 'normal';
    const weight = Number(/font-weight:\s*(\d+)/.exec(b)?.[1] || 400);
    const r = await fetch(url);
    if (!r.ok) continue;
    await writeFont(id, weight, style, Buffer.from(await r.arrayBuffer()));
    saved++;
  }
  if (!saved) throw new Error('Could not download that font from Google Fonts.');
  return id;
}
