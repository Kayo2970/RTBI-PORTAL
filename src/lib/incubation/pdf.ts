import { jsPDF } from 'jspdf';

/**
 * Plain, letterhead-less PDF builder for generated records (dossier, decision note, admission / graduation letter,
 * exit acknowledgement). Final wording and letterhead are supplied by RTBI later — these are templates.
 */
export interface PdfSection { heading?: string; lines: string[] }

export function buildPdf(title: string, subtitle: string, sections: PdfSection[]): { doc: jsPDF; dataUrl: string } {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;
  const ensure = (h: number) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(title, M, y); y += 20;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110); doc.text(subtitle, M, y); y += 22; doc.setTextColor(0);
  for (const s of sections) {
    if (s.heading) { ensure(26); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(s.heading, M, y); y += 16; }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    for (const line of s.lines) {
      for (const part of doc.splitTextToSize(line || ' ', W - M * 2) as string[]) { ensure(14); doc.text(part, M, y); y += 13; }
    }
    y += 8;
  }
  return { doc, dataUrl: doc.output('datauristring') };
}

export function downloadPdf(name: string, title: string, subtitle: string, sections: PdfSection[]): string {
  const { doc, dataUrl } = buildPdf(title, subtitle, sections);
  doc.save(name);
  return dataUrl;
}
