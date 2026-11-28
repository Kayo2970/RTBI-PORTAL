/**
 * IDN (Inter-Departmental Note) drafting — mirrors RTBI's approval-note format:
 * letterhead, From/To/Date/Sub block, salutation, intro + bill paragraph,
 * 1. Details of Procurement, 2. Justification, 3. Approval Requested, signature
 * blocks and an optional "Annexure – Cheque Copy" page.
 *
 * `buildDraft` turns the structured inputs into the note's text. Paragraph text uses
 * **bold** markers, rendered by both the PDF and DOCX writers. Pure helpers are
 * server-safe; the exporters are client-only (canvas / fetch / Blob).
 */

/** `rate` is the ex-GST rate (forward mode); `finalAmount` is the GST-inclusive line total (backward mode). */
export interface IdnItem { desc: string; qty: number; unit: string; rate: number; finalAmount?: number }
export type IdnAmountMode = 'exclusive' | 'inclusive';
export interface IdnPerson { name: string; designation: string }

export interface IdnInputs {
  date: string; // YYYY-MM-DD
  fromLine: string;
  toLine: string;
  vendor: string;
  billType: string; // "Bill of Supply" | "Tax Invoice" | "Invoice"
  billNo: string;
  billDate: string; // YYYY-MM-DD
  purpose: string; // e.g. "Printing of visiting cards"
  items: IdnItem[];
  gstPercent: number;
  /** exclusive: enter rate, GST is added. inclusive: enter the final amount, base + GST are worked back. */
  amountMode: IdnAmountMode;
  /** Conveyance / transport fee added on top of the items (no GST applied to it). */
  conveyanceFee: number;
  conveyanceLabel: string;
  compositionVendor: boolean;
  headLabel: string; // expense head, e.g. "Administrative Expenses"
  budgetRef: string; // e.g. "MOA, KITS GoK"
  preparedBy: IdnPerson;
  recommendedBy: IdnPerson[];
  approvedBy: IdnPerson[];
  chequeCaption: string; // annexure caption; used only when a cheque image is supplied
}

export interface IdnDraft {
  date: string;
  fromLine: string;
  toLine: string;
  subject: string;
  salutation: string;
  intro: string;
  billPara: string;
  details: string[];
  justification: string;
  approval: string;
  preparedBy: IdnPerson;
  recommendedBy: IdnPerson[];
  approvedBy: IdnPerson[];
  annexureTitle: string;
  total: number;
}

// Defaults taken from the sample note; shown in the drafter and fully editable there.
export const DEFAULT_IDN_PEOPLE = {
  fromLine: 'Assistant Manager – PR & Admin, RTBI',
  toLine: 'Chairman, RTBI',
  preparedBy: { name: 'Mr. Pranab Das', designation: 'Assistant Manager – PR & Admin, RTBI' },
  recommendedBy: [
    { name: 'Dr. Subhadeep Mukherjee', designation: 'CEO – RTBI' },
    { name: 'Mr. Vineet Khurana', designation: 'Head – Finance' },
  ],
  approvedBy: [
    { name: 'Mr. Ashok Rao', designation: 'Registrar – RUAS' },
    { name: 'Dr. Kuldeep K Raina', designation: 'Vice Chancellor-RUAS' },
  ],
};

export const BILL_TYPES = ['Bill of Supply', 'Tax Invoice', 'Invoice', 'Cash Memo'];

// ---------------------------------------------------------------- formatting

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** 2400 -> "2,400"; 2400.5 -> "2,400.50" (Indian digit grouping). */
export function inrNum(n: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: Number.isInteger(r2(n)) ? 0 : 2, maximumFractionDigits: 2 }).format(r2(n));
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + ' Hundred'); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}

/** 2400 -> "Rupees Two Thousand Four Hundred only" (Indian system: lakh / crore). */
export function rupeesInWords(amount: number): string {
  const total = Math.round(Math.abs(amount) * 100);
  let rupees = Math.floor(total / 100);
  const paise = total % 100;
  if (rupees === 0 && paise === 0) return 'Rupees Zero only';
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(below1000(crore) + ' Crore');
  if (lakh) parts.push(below1000(lakh) + ' Lakh');
  if (thousand) parts.push(below1000(thousand) + ' Thousand');
  if (rupees) parts.push(below1000(rupees));
  let out = 'Rupees ' + (parts.join(' ') || 'Zero');
  if (paise) out += ' and ' + below1000(paise) + ' Paise';
  return out + ' only';
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11-16" -> { day: 16, ord: 'th', rest: 'November 2026' } */
export function longDateParts(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return { day: 0, ord: '', rest: iso || '' };
  const d = Number(m[3]);
  return { day: d, ord: ordinal(d), rest: `${MONTHS[Number(m[2]) - 1]} ${m[1]}` };
}

/** "2026-11-13" -> "13-Nov-2026" */
export function billDateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1].slice(0, 3)}-${m[1]}` : iso || '';
}

export function longDateText(iso: string): string {
  const p = longDateParts(iso);
  return p.day ? `${p.day}${p.ord} ${p.rest}` : p.rest;
}

// ---------------------------------------------------------------- calculations

export interface IdnLine { base: number; gst: number; gross: number; rate: number }

/**
 * Forward (exclusive): base = qty x rate, GST added on top.
 * Backward (inclusive): the entered final amount is the gross; base = gross / (1 + GST%), GST = gross - base.
 * The conveyance fee is added after GST and is not taxed here.
 */
export function idnTotals(items: IdnItem[], gstPercent: number, mode: IdnAmountMode = 'exclusive', conveyanceFee = 0) {
  const g = Number(gstPercent) || 0;
  const lines: IdnLine[] = items.map(i => {
    const qty = Number(i.qty) || 0;
    if (mode === 'inclusive') {
      const gross = r2(Number(i.finalAmount) || 0);
      const base = r2(gross / (1 + g / 100));
      return { base, gst: r2(gross - base), gross, rate: qty ? r2(base / qty) : 0 };
    }
    const base = r2(qty * (Number(i.rate) || 0));
    const gst = r2(base * g / 100);
    return { base, gst, gross: r2(base + gst), rate: Number(i.rate) || 0 };
  });
  const subtotal = r2(lines.reduce((s, l) => s + l.base, 0));
  const gst = r2(lines.reduce((s, l) => s + l.gst, 0));
  const conveyance = r2(Math.max(0, Number(conveyanceFee) || 0));
  return { lines, subtotal, gst, conveyance, itemsTotal: r2(subtotal + gst), total: r2(subtotal + gst + conveyance) };
}

// ---------------------------------------------------------------- drafting

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "nos" / "pcs" read badly after "per" — use a singular. */
const perUnit = (u: string) => ({ nos: 'unit', no: 'unit', pcs: 'piece', pc: 'piece' } as Record<string, string>)[u.trim().toLowerCase()] || u.trim();

function itemText(i: IdnItem): string {
  return `${i.desc} – ${i.qty} ${i.unit}`.trim();
}

/** Turn structured inputs into the note's wording (the user can still edit every paragraph). */
export function buildDraft(inp: IdnInputs): IdnDraft {
  const items = inp.items.filter(i => i.desc.trim());
  const t = idnTotals(items, inp.gstPercent, inp.amountMode, inp.conveyanceFee);
  const { subtotal, gst, total } = t;
  const conv = t.conveyance;
  const convLabel = inp.conveyanceLabel.trim() || 'Conveyance fee';
  const vendor = inp.vendor.trim() || '[Vendor]';
  const purpose = inp.purpose.trim() || 'the above items';
  const billLabel = inp.billType || 'Bill';
  const billRef = `${billLabel} no. **${inp.billNo.trim() || '—'} dated ${billDateText(inp.billDate)}**`;
  const single = items.length === 1 ? items[0] : null;
  const itemSummary = items.length
    ? items.map(i => `${i.desc.toLowerCase()} (${i.qty} ${i.unit})`).join(', ')
    : 'the items';

  const details: string[] = [
    `Purpose: ${cap(purpose)}`,
    `Vendor: ${vendor}`,
    `${billLabel}: No. ${inp.billNo.trim() || '—'} dated ${billDateText(inp.billDate)}`,
  ];
  if (inp.amountMode === 'inclusive') {
    items.forEach((i, idx) => {
      const l = t.lines[idx];
      details.push(`Item: ${itemText(i)} – ₹${inrNum(l.gross)}/- (incl. GST)`);
    });
    if (single) details.push(`Rate: ₹${inrNum(t.lines[0].rate)}/- per ${perUnit(single.unit)} (excl. GST)`);
    details.push(`Basic value: ₹${inrNum(subtotal)}/-`);
    if (inp.gstPercent > 0) details.push(`GST @ ${inp.gstPercent}%: ₹${inrNum(gst)}/-`);
    if (inp.gstPercent > 0) details.push(`Amount including GST: ₹${inrNum(t.itemsTotal)}/-`);
  } else {
    if (single) {
      details.push(`Item: ${itemText(single)}`);
      details.push(`Rate: ₹${inrNum(single.rate)}/- per ${perUnit(single.unit)}`);
    } else {
      items.forEach(i => details.push(`Item: ${i.desc} – ${i.qty} ${i.unit} × ₹${inrNum(i.rate)}/- = ₹${inrNum(i.qty * i.rate)}/-`));
    }
    if (inp.gstPercent > 0) details.push(`GST @ ${inp.gstPercent}%: ₹${inrNum(gst)}/- (on ₹${inrNum(subtotal)}/-)`);
  }
  if (conv > 0) details.push(`${convLabel}: ₹${inrNum(conv)}/-`);
  details.push(`Total Payable: ₹${inrNum(total)}/- (${rupeesInWords(total)})`);

  const gstSentence = inp.gstPercent > 0
    ? `GST at ${inp.gstPercent}% is charged as per the ${billLabel.toLowerCase()}`
    : inp.compositionVendor
      ? 'no GST is charged as the vendor operates under the composition scheme'
      : 'no GST is charged by the vendor';
  const convSentence = conv > 0 ? ` A ${convLabel.toLowerCase()} of ₹${inrNum(conv)} is also payable.` : '';
  const rateSentence = (single && inp.amountMode === 'exclusive'
    ? `The rate is ₹${inrNum(single.rate)} per ${perUnit(single.unit)} for ${single.qty} ${single.unit}, and ${gstSentence}.`
    : `The total value as per the ${billLabel.toLowerCase()} is ₹${inrNum(t.itemsTotal)}${inp.amountMode === 'inclusive' && inp.gstPercent > 0 ? ` (inclusive of GST of ₹${inrNum(gst)})` : ''}, and ${gstSentence}.`) + convSentence;

  return {
    date: inp.date,
    fromLine: inp.fromLine,
    toLine: inp.toLine,
    subject: `Request for Approval of Payment towards ${cap(purpose)}`,
    salutation: 'Respected Sir,',
    intro: `With reference to the administrative requirements of RTBI, **${itemSummary}** were procured from ${vendor}.`,
    billPara: `The ${billRef} has been raised by ${vendor} for ${purpose.toLowerCase()}. Kindly approve the payment under the overhead of **${inp.headLabel || 'the relevant head'}** as per the sanctioned budget at **${inp.budgetRef || 'MOA, KITS GoK'}**.`,
    details,
    justification: `The ${items.length ? items.map(i => i.desc.toLowerCase()).join(', ') : 'items'} are required for the official needs of RTBI. ${rateSentence}`,
    approval: `In view of the above, approval is kindly requested for the payment of ₹ ${inrNum(total)} to ${vendor} towards ${purpose.toLowerCase()}, to be booked under ${inp.headLabel || 'the relevant head'}, subject to applicable RTBI norms and procedure. The ${billLabel} has been enclosed for reference.`,
    preparedBy: inp.preparedBy,
    recommendedBy: inp.recommendedBy,
    approvedBy: inp.approvedBy,
    annexureTitle: inp.chequeCaption,
    total,
  };
}

/** Split "a **b** c" into runs. */
export function richRuns(text: string): { t: string; b: boolean }[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(p => p.startsWith('**') ? { t: p.slice(2, -2), b: true } : { t: p, b: false });
}
export const stripBold = (s: string) => s.replace(/\*\*/g, '');

// ---------------------------------------------------------------- client helpers

export async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read image.'));
    r.readAsDataURL(blob);
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    r.readAsDataURL(file);
  });
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not load image.'));
    img.src = dataUrl;
  });
}

/** Re-encode any browser image as JPEG (what jsPDF / docx both accept reliably). */
async function toJpeg(dataUrl: string): Promise<{ data: string; w: number; h: number }> {
  const { w, h } = await imageSize(dataUrl);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not load image.')); img.src = dataUrl; });
  ctx.drawImage(img, 0, 0);
  return { data: c.toDataURL('image/jpeg', 0.92), w, h };
}

export const idnFileName = (vendor: string, billNo: string, ext: string) =>
  `IDN_${(vendor || 'Vendor').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}${billNo ? '_' + billNo.replace(/[^a-z0-9]+/gi, '_') : ''}.${ext}`;

// ---------------------------------------------------------------- PDF

const LOGO_URL = '/images/ramaiah-gok-logo.jpeg';

/** A4 PDF. jsPDF's built-in fonts have no ₹ glyph, so the PDF writes "Rs." (the DOCX keeps ₹). */
export async function buildIdnPdf(d: IdnDraft, chequeDataUrl?: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdfText = (s: string) => s.replace(/₹\s?/g, 'Rs. ').replace(/[–—]/g, '-').replace(/×/g, 'x');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 12, R = 198, W = R - L, PAD = 2;
  doc.setLineWidth(0.25);

  // Letterhead + title bar
  try {
    const logo = await toJpeg(await urlToDataUrl(LOGO_URL));
    doc.addImage(logo.data, 'JPEG', L, 8, 44, 44 * logo.h / logo.w);
  } catch { /* letterhead is optional */ }
  let y = 30;
  doc.setFillColor(150, 150, 150); doc.rect(L + 4, y, W - 8, 11, 'F');
  doc.setFillColor(0, 0, 0); doc.rect(L + 6, y + 1.5, W - 12, 8, 'F');
  doc.setTextColor(255); doc.setFont('times', 'normal'); doc.setFontSize(15);
  doc.text('INTER-DEPARTMENTAL NOTE', 105, y + 7.3, { align: 'center' });
  doc.setTextColor(0);
  y += 16;

  const boxTop = y;
  const colX = L + W * 0.55;
  // From | To
  doc.setFont('times', 'bold'); doc.setFontSize(10);
  doc.text(pdfText(`From: ${d.fromLine}`), L + PAD, y + 5.2, { maxWidth: colX - L - 2 * PAD });
  doc.text(pdfText(`To: ${d.toLine}`), colX + (R - colX) / 2, y + 5.2, { align: 'center' });
  y += 8; doc.line(L, y, R, y);
  // Date
  doc.setFont('times', 'normal'); doc.setFontSize(10);
  const dp = longDateParts(d.date);
  const dateLead = 'Date: ';
  let dx = colX + PAD;
  doc.text(dateLead + dp.day, dx, y + 5);
  dx += doc.getTextWidth(dateLead + dp.day);
  doc.setFontSize(7); doc.text(dp.ord, dx, y + 3.6);
  dx += doc.getTextWidth(dp.ord);
  doc.setFontSize(10); doc.text(' ' + dp.rest, dx, y + 5);
  y += 7.5; doc.line(L, y, R, y);
  // Sub
  doc.setFont('times', 'bold'); doc.setFontSize(10.5);
  const subLines = doc.splitTextToSize(pdfText(`Sub:  ${d.subject}`), W - 2 * PAD) as string[];
  doc.text(subLines, L + PAD, y + 5);
  y += 3 + subLines.length * 4.6; doc.line(L, y, R, y);
  doc.line(colX, boxTop, colX, boxTop + 8 + 7.5); // From|To + Date divider

  // Rich paragraph with inline bold and word wrap
  const para = (text: string, size = 9.5, indent = 0, gapAfter = 3) => {
    const lh = size * 0.46;
    const words: { t: string; b: boolean }[] = [];
    for (const r of richRuns(pdfText(text))) for (const w of r.t.split(/(\s+)/).filter(Boolean)) words.push({ t: w, b: r.b });
    let x = L + PAD + indent;
    const maxX = R - PAD;
    for (const w of words) {
      doc.setFont('times', w.b ? 'bold' : 'normal'); doc.setFontSize(size);
      const tw = doc.getTextWidth(w.t);
      if (x + tw > maxX && w.t.trim()) { y += lh; x = L + PAD + indent; }
      if (x === L + PAD + indent && !w.t.trim()) continue;
      doc.text(w.t, x, y);
      x += tw;
    }
    y += lh + gapAfter;
  };
  const heading = (t: string) => { y += 2; para(`**${t}**`, 9.5, 0, 2); };
  const bullet = (t: string) => {
    doc.setFont('times', 'normal'); doc.setFontSize(9.5);
    doc.text('•', L + PAD + 5, y);
    para(t, 9.5, 11, 0.8);
  };

  y += 5;
  para(d.salutation, 9.5, 0, 3);
  para(d.intro, 9.5, 0, 3);
  para(d.billPara, 9.5, 0, 2);
  heading('1. Details of Procurement');
  d.details.forEach(bullet);
  heading('2. Justification');
  para(d.justification, 9.5, 0, 2);
  heading('3. Approval Requested');
  para(d.approval, 9.5, 0, 6);

  // Signatures
  const person = (p: { name: string; designation: string }, x: number, align: 'left' | 'right') => {
    doc.setFont('times', 'bold'); doc.setFontSize(9.5); doc.text(pdfText(p.name), x, y, { align });
    doc.setFont('times', 'normal'); doc.text(pdfText(p.designation), x, y + 4.2, { align });
  };
  y += 4;
  doc.setFont('times', 'bold'); doc.setFontSize(9.5); doc.text('Prepared by', L + PAD + 2, y);
  y += 16; person(d.preparedBy, L + PAD + 2, 'left'); y += 11;
  const pair = (title: string, a?: IdnPerson, b?: IdnPerson) => {
    doc.setFont('times', 'bold'); doc.setFontSize(9.5); doc.text(title, 105, y, { align: 'center' });
    y += 14;
    if (a) person(a, L + PAD + 2, 'left');
    if (b) person(b, R - PAD - 2, 'right');
    y += 11;
  };
  if (d.recommendedBy.length) pair('Recommended by', d.recommendedBy[0], d.recommendedBy[1]);
  if (d.approvedBy.length) pair('Approved by', d.approvedBy[0], d.approvedBy[1]);

  // Outer border around the whole note body
  doc.rect(L, boxTop, W, y - boxTop - 4);

  // Annexure page
  if (chequeDataUrl) {
    const img = await toJpeg(chequeDataUrl);
    doc.addPage();
    doc.setFont('times', 'bold'); doc.setFontSize(12);
    doc.text(pdfText(`Annexure – ${d.annexureTitle || 'Cheque Copy'}`), 105, 22, { align: 'center' });
    const maxW = 180, maxH = 230;
    const sc = Math.min(maxW / img.w, maxH / img.h);
    const iw = img.w * sc, ih = img.h * sc;
    doc.addImage(img.data, 'JPEG', (210 - iw) / 2, 32, iw, ih);
  }
  return doc.output('blob');
}

// ---------------------------------------------------------------- DOCX

export async function buildIdnDocx(d: IdnDraft, chequeDataUrl?: string): Promise<Blob> {
  const dx = await import('docx');
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ImageRun, Header, ShadingType, VerticalAlign } = dx;
  const FONT = 'Times New Roman';
  const dataToBytes = (u: string) => Uint8Array.from(atob(u.split(',')[1]), c => c.charCodeAt(0));

  const runs = (text: string, size = 19) => richRuns(text).map(r => new TextRun({ text: r.t, bold: r.b, font: FONT, size }));
  const p = (text: string, opts: { after?: number; size?: number; bullet?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
    new Paragraph({ children: runs(text, opts.size), spacing: { after: opts.after ?? 100 }, alignment: opts.align, bullet: opts.bullet ? { level: 0 } : undefined });
  const h = (text: string) => new Paragraph({ children: [new TextRun({ text, bold: true, font: FONT, size: 19 })], spacing: { before: 120, after: 80 } });

  const line = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const allB = { top: line, bottom: line, left: line, right: line };

  const logo = await toJpeg(await urlToDataUrl(LOGO_URL));
  const header = new Header({
    children: [new Paragraph({ children: [new ImageRun({ type: 'jpg', data: dataToBytes(logo.data), transformation: { width: 150, height: Math.round(150 * logo.h / logo.w) } })] })],
  });

  const dp = longDateParts(d.date);
  const cell = (children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[], o: { span?: number; width?: number } = {}) =>
    new TableCell({ children, columnSpan: o.span, width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined, borders: allB, margins: { top: 40, bottom: 40, left: 90, right: 90 }, verticalAlign: VerticalAlign.CENTER });

  const sig = (pp: IdnPerson) => [
    new TextRun({ text: pp.name, bold: true, font: FONT, size: 19 }),
    new TextRun({ text: pp.designation, font: FONT, size: 19, break: 1 }),
  ];
  const noB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: noB, bottom: noB, left: noB, right: noB };
  const sigCell = (pp: IdnPerson | undefined, align: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
    new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: noBorders,
      children: [new Paragraph({ alignment: align, children: pp ? sig(pp) : [] })],
    });
  const pair = (title: string, a?: IdnPerson, b?: IdnPerson) => [
    new Paragraph({ children: [new TextRun({ text: title, bold: true, font: FONT, size: 19 })], alignment: AlignmentType.CENTER, spacing: { before: 280, after: 280 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...noBorders, insideHorizontal: noB, insideVertical: noB },
      rows: [new TableRow({ children: [sigCell(a, AlignmentType.LEFT), sigCell(b, AlignmentType.RIGHT)] })],
    }),
  ];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        cell([new Paragraph({ children: [new TextRun({ text: `From: ${d.fromLine}`, bold: true, font: FONT, size: 20 })] })], { width: 55 }),
        cell([new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `To: ${d.toLine}`, bold: true, font: FONT, size: 20 })] })], { width: 45 }),
      ] }),
      new TableRow({ children: [
        cell([new Paragraph('')], { width: 55 }),
        cell([new Paragraph({ children: [
          new TextRun({ text: `Date: ${dp.day}`, font: FONT, size: 20 }),
          new TextRun({ text: dp.ord, font: FONT, size: 20, superScript: true }),
          new TextRun({ text: ` ${dp.rest}`, font: FONT, size: 20 }),
        ] })], { width: 45 }),
      ] }),
      new TableRow({ children: [cell([new Paragraph({ children: [new TextRun({ text: `Sub:  ${d.subject}`, bold: true, font: FONT, size: 21 })] })], { span: 2 })] }),
      new TableRow({ children: [cell([
        p(d.salutation, { after: 120 }),
        p(d.intro, { after: 120 }),
        p(d.billPara),
        h('1. Details of Procurement'),
        ...d.details.map(t => p(t, { bullet: true, after: 20 })),
        h('2. Justification'),
        p(d.justification),
        h('3. Approval Requested'),
        p(d.approval, { after: 200 }),
        new Paragraph({ children: [new TextRun({ text: 'Prepared by', bold: true, font: FONT, size: 19 })], spacing: { before: 200, after: 360 } }),
        new Paragraph({ children: sig(d.preparedBy) }),
        ...(d.recommendedBy.length ? pair('Recommended by', d.recommendedBy[0], d.recommendedBy[1]) : []),
        ...(d.approvedBy.length ? pair('Approved by', d.approvedBy[0], d.approvedBy[1]) : []),
      ], { span: 2 })] }),
    ],
  });

  const titleBar = new Table({
    width: { size: 92, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER,
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, fill: '000000', color: 'auto' },
      borders: { top: { style: BorderStyle.SINGLE, size: 12, color: '969696' }, bottom: { style: BorderStyle.SINGLE, size: 12, color: '969696' }, left: { style: BorderStyle.SINGLE, size: 12, color: '969696' }, right: { style: BorderStyle.SINGLE, size: 12, color: '969696' } },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'INTER-DEPARTMENTAL NOTE', font: FONT, size: 30, color: 'FFFFFF' })] })],
    })] })],
  });

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [titleBar, new Paragraph({ spacing: { after: 100 } }), table];
  if (chequeDataUrl) {
    const img = await toJpeg(chequeDataUrl);
    const sc = Math.min(560 / img.w, 640 / img.h);
    children.push(
      new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: `Annexure – ${d.annexureTitle || 'Cheque Copy'}`, bold: true, font: FONT, size: 24 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'jpg', data: dataToBytes(img.data), transformation: { width: Math.round(img.w * sc), height: Math.round(img.h * sc) } })] }),
    );
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 700, left: 700, right: 700, header: 350 } } },
      headers: { default: header },
      children,
    }],
  });
  return Packer.toBlob(doc);
}
