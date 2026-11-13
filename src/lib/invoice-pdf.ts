'use client';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Invoice, Payment, BillingSettings, computeTotals, amountPaid } from './billing';

// jsPDF's built-in fonts have no ₹ glyph, so amounts are written as "Rs.".
const money = (n: number) => 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function downloadInvoicePdf(inv: Invoice, payments: Payment[], s: BillingSettings) {
  const doc = new jsPDF();
  const t = computeTotals(inv.lines, inv.discount);
  const paid = amountPaid(inv.id, payments);
  let y = 18;

  doc.setFontSize(18).setFont('helvetica', 'bold').text(s.businessName, 14, y);
  doc.setFontSize(10).setFont('helvetica', 'normal');
  if (s.address) { y += 6; doc.text(doc.splitTextToSize(s.address, 90), 14, y); y += 5 * (doc.splitTextToSize(s.address, 90).length - 1); }
  if (s.gstin) { y += 5; doc.text(`GSTIN: ${s.gstin}`, 14, y); }

  doc.setFontSize(20).setFont('helvetica', 'bold').text(inv.status === 'Void' ? 'INVOICE (VOID)' : 'INVOICE', 196, 18, { align: 'right' });
  doc.setFontSize(10).setFont('helvetica', 'normal');
  doc.text(`No: ${inv.number}`, 196, 25, { align: 'right' });
  doc.text(`Issued: ${inv.issueDate}`, 196, 30, { align: 'right' });
  doc.text(`Due: ${inv.dueDate}`, 196, 35, { align: 'right' });

  y = Math.max(y, 38) + 10;
  doc.setFont('helvetica', 'bold').text('Bill to', 14, y);
  doc.setFont('helvetica', 'normal');
  y += 5; doc.text(inv.customerName, 14, y);
  if (inv.customerOrganisation) { y += 5; doc.text(inv.customerOrganisation, 14, y); }
  if (inv.customerEmail) { y += 5; doc.text(inv.customerEmail, 14, y); }

  autoTable(doc, {
    startY: y + 8,
    head: [['#', 'Description', 'Qty', 'Rate', 'Tax %', 'Tax', 'Amount']],
    body: inv.lines.map((l, i) => [
      String(i + 1), l.description, String(l.quantity), money(l.unitPrice), `${l.taxPercent}%`, money(t.lines[i].tax), money(t.lines[i].gross),
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [60, 40, 110] },
    columnStyles: { 0: { cellWidth: 10 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
  });

  let fy = (doc as any).lastAutoTable.finalY + 8;
  const row = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, 140, fy);
    doc.text(value, 196, fy, { align: 'right' });
    fy += 6;
  };
  row('Subtotal', money(t.subtotal));
  if (t.discount > 0) row('Discount', '- ' + money(t.discount));
  row('Tax', money(t.tax));
  row('Total', money(t.total), true);
  if (paid > 0) { row('Paid', money(paid)); row('Balance due', money(Math.max(0, t.total - paid)), true); }

  fy += 6;
  doc.setFont('helvetica', 'normal').setFontSize(9);
  const pay: string[] = [];
  if (s.upiId) pay.push(`UPI: ${s.upiId}`);
  if (s.accountNumber) pay.push(`Bank: ${[s.bankName, s.accountName].filter(Boolean).join(' - ')}  A/c ${s.accountNumber}  IFSC ${s.ifsc || '-'}`);
  if (pay.length) { doc.setFont('helvetica', 'bold').text('How to pay', 14, fy); doc.setFont('helvetica', 'normal'); pay.forEach(p => { fy += 5; doc.text(p, 14, fy); }); fy += 5; doc.text(`Quote ${inv.number} as the payment reference.`, 14, fy); fy += 8; }
  if (inv.notes) { doc.text(doc.splitTextToSize(`Notes: ${inv.notes}`, 180), 14, fy); fy += 10; }
  if (s.terms) doc.text(doc.splitTextToSize(s.terms, 180), 14, fy);

  doc.save(`${inv.number.replace(/\//g, '-')}.pdf`);
}
