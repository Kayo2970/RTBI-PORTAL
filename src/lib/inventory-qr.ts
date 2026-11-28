/**
 * Inventory QR stickers. The QR encodes the item code (sku), falling back to the
 * record id for legacy items without one; the scanner resolves either.
 * Client-only (uses canvas via `qrcode` and jsPDF) — import from client components.
 */
import type { InventoryItem } from './billing';

export function qrPayload(item: Pick<InventoryItem, 'id' | 'sku'>): string {
  return item.sku || item.id;
}

/** Find the item a scanned / typed value refers to (item code or id, case-insensitive). */
export function findItemByScan<T extends Pick<InventoryItem, 'id' | 'sku'>>(items: T[], raw: string): T | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  return items.find(i => (i.sku || '').toLowerCase() === v || i.id.toLowerCase() === v);
}

async function qrDataUrl(text: string): Promise<string> {
  const QR = await import('qrcode');
  return QR.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 400 });
}

/** A4 sheet of 3 x 8 stickers (70 x 37 mm): QR on the left, name / code / category on the right. */
export async function exportStickersPdf(items: InventoryItem[], fileName = 'RTBI_Inventory_QR_Stickers.pdf'): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const cols = 3, rows = 8, w = 70, h = 37;
  const perPage = cols * rows;
  const marginX = (210 - cols * w) / 2;
  const marginY = (297 - rows * h) / 2;

  for (let n = 0; n < items.length; n++) {
    if (n > 0 && n % perPage === 0) doc.addPage();
    const slot = n % perPage;
    const x = marginX + (slot % cols) * w;
    const y = marginY + Math.floor(slot / cols) * h;
    const item = items[n];

    doc.setDrawColor(190);
    doc.setLineDashPattern([1, 1], 0);
    doc.rect(x, y, w, h);
    doc.setLineDashPattern([], 0);

    doc.addImage(await qrDataUrl(qrPayload(item)), 'PNG', x + 2.5, y + 2.5, 32, 32);

    const tx = x + 37;
    const tw = w - 37 - 2;
    doc.setTextColor(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const nameLines = (doc.splitTextToSize(item.name, tw) as string[]).slice(0, 3);
    doc.text(nameLines, tx, y + 7);
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.5);
    doc.text((doc.splitTextToSize(item.sku || item.id, tw) as string[]).slice(0, 2), tx, y + 7 + nameLines.length * 4 + 1);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(90);
    const cat = [item.category, item.subCategory].filter(Boolean).join(' › ');
    if (cat) doc.text((doc.splitTextToSize(cat, tw) as string[]).slice(0, 2), tx, y + h - 7);
    doc.text('RTBI Inventory', tx, y + h - 3);
  }
  doc.save(fileName);
}
