'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, Plus, Trash2, X, Download, Paperclip, RotateCcw } from 'lucide-react';
import {
  BILL_TYPES, DEFAULT_IDN_PEOPLE, buildDraft, buildIdnDocx, buildIdnPdf, fileToDataUrl, idnFileName, idnTotals, inrNum,
  type IdnInputs, type IdnItem, type IdnPerson,
} from '@/lib/idn';

const inputCls =
  'w-full px-3 py-2 bg-theme-sidebar/60 border border-theme-border/40 rounded-xl text-xs text-theme-text-primary outline-none focus:border-accent transition-all';
const labelCls = 'text-xs font-semibold text-theme-text-secondary';
const PEOPLE_KEY = 'rtbi_idn_people';

export interface IdnSeed {
  vendor: string;
  amount: number;
  billDate: string;
  description: string;
  headLabel: string;
}

type TextKey = 'intro' | 'billPara' | 'justification' | 'approval';
const TEXT_LABELS: Record<TextKey, string> = {
  intro: 'Introduction',
  billPara: 'Bill paragraph',
  justification: '2. Justification',
  approval: '3. Approval requested',
};

function loadPeople() {
  try {
    const raw = localStorage.getItem(PEOPLE_KEY);
    if (raw) return { ...DEFAULT_IDN_PEOPLE, ...JSON.parse(raw) } as typeof DEFAULT_IDN_PEOPLE;
  } catch { /* ignore */ }
  return DEFAULT_IDN_PEOPLE;
}

function PersonRow({ label, p, onChange }: { label: string; p: IdnPerson; onChange: (p: IdnPerson) => void }) {
  return (
    <div className="grid grid-cols-[88px_1fr_1fr] gap-2 items-center">
      <span className="text-xs text-theme-text-secondary">{label}</span>
      <input className={inputCls} aria-label={`${label} name`} value={p.name} onChange={e => onChange({ ...p, name: e.target.value })} />
      <input className={inputCls} aria-label={`${label} designation`} value={p.designation} onChange={e => onChange({ ...p, designation: e.target.value })} />
    </div>
  );
}

/**
 * Drafts the RTBI Inter-Departmental Note from the expense details. Everything is prefilled from
 * the expense form, wording regenerates as inputs change until a paragraph is hand-edited, and
 * the result is attached to the expense as the IDN (PDF) and/or downloaded as an editable DOCX.
 */
export function IdnDrafter({ seed, onAttach, onClose }: {
  seed: IdnSeed;
  onAttach: (file: File, total: number) => void;
  onClose: () => void;
}) {
  const today = new Date().toISOString().split('T')[0];
  const [inputs, setInputs] = useState<IdnInputs>(() => {
    const people = DEFAULT_IDN_PEOPLE;
    return {
      date: today,
      fromLine: people.fromLine,
      toLine: people.toLine,
      vendor: seed.vendor,
      billType: 'Bill of Supply',
      billNo: '',
      billDate: seed.billDate,
      purpose: seed.description,
      items: [{ desc: '', qty: 1, unit: 'nos', rate: seed.amount || 0, finalAmount: seed.amount || 0 }],
      gstPercent: 0,
      amountMode: 'exclusive',
      conveyanceFee: 0,
      conveyanceLabel: 'Conveyance fee',
      compositionVendor: true,
      headLabel: seed.headLabel,
      budgetRef: 'MOA, KITS GoK',
      preparedBy: people.preparedBy,
      recommendedBy: people.recommendedBy,
      approvedBy: people.approvedBy,
      chequeCaption: 'Cheque Copy',
    };
  });
  const [overrides, setOverrides] = useState<Partial<Record<TextKey, string>>>({});
  const [cheque, setCheque] = useState<{ name: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState<'' | 'pdf' | 'docx'>('');
  const [error, setError] = useState('');

  // Remembered signatories (editable defaults) — applied after mount to stay SSR-safe.
  useEffect(() => {
    const p = loadPeople();
    setInputs(prev => ({ ...prev, fromLine: p.fromLine, toLine: p.toLine, preparedBy: p.preparedBy, recommendedBy: p.recommendedBy, approvedBy: p.approvedBy }));
  }, []);

  const set = <K extends keyof IdnInputs>(k: K, v: IdnInputs[K]) => setInputs(prev => ({ ...prev, [k]: v }));
  const setItem = (i: number, patch: Partial<IdnItem>) => setInputs(prev => ({ ...prev, items: prev.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }));
  const setPerson = (key: 'recommendedBy' | 'approvedBy', i: number, p: IdnPerson) =>
    setInputs(prev => ({ ...prev, [key]: prev[key].map((x, idx) => (idx === i ? p : x)) }));

  const draft = useMemo(() => ({ ...buildDraft(inputs), ...overrides }), [inputs, overrides]);
  const totals = useMemo(() => idnTotals(inputs.items.filter(i => i.desc.trim()), inputs.gstPercent, inputs.amountMode, inputs.conveyanceFee), [inputs.items, inputs.gstPercent, inputs.amountMode, inputs.conveyanceFee]);

  const validate = () => {
    if (!inputs.vendor.trim()) return 'Enter the vendor name.';
    if (!inputs.billNo.trim()) return 'Enter the bill number.';
    if (!inputs.purpose.trim()) return 'Enter the purpose of the procurement.';
    if (!inputs.items.some(i => i.desc.trim() && i.qty > 0)) return 'Add at least one item with a quantity.';
    if (draft.total <= 0) return 'The total payable must be greater than zero.';
    return '';
  };

  const run = async (kind: 'pdf' | 'docx', attach: boolean) => {
    const v = validate();
    if (v) return setError(v);
    setError('');
    setBusy(kind);
    try {
      try {
        localStorage.setItem(PEOPLE_KEY, JSON.stringify({ fromLine: inputs.fromLine, toLine: inputs.toLine, preparedBy: inputs.preparedBy, recommendedBy: inputs.recommendedBy, approvedBy: inputs.approvedBy }));
      } catch { /* ignore */ }
      if (kind === 'pdf') {
        const blob = await buildIdnPdf(draft, cheque?.dataUrl);
        const file = new File([blob], idnFileName(inputs.vendor, inputs.billNo, 'pdf'), { type: 'application/pdf' });
        if (attach) { onAttach(file, draft.total); onClose(); return; }
        const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      } else {
        const blob = await buildIdnDocx(draft, cheque?.dataUrl);
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = idnFileName(inputs.vendor, inputs.billNo, 'docx'); a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not generate the IDN.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-theme-card border border-theme-card-border rounded-3xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6 space-y-5 shadow-2xl">
        <div className="flex items-start justify-between border-b border-theme-border/20 pb-3">
          <div>
            <h2 className="text-base font-bold text-theme-text-primary flex items-center gap-2"><FileText className="h-5 w-5 text-accent" /> Draft Inter-Departmental Note (IDN)</h2>
            <p className="text-xs text-theme-text-secondary">Fill the details once — the note is drafted in RTBI&apos;s approval format. Edit any paragraph before generating.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-theme-text-secondary cursor-pointer"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1"><span className={labelCls}>Note date</span><input type="date" className={inputCls} value={inputs.date} onChange={e => set('date', e.target.value)} /></label>
          <label className="space-y-1"><span className={labelCls}>Overhead head</span><input className={inputCls} value={inputs.headLabel} onChange={e => set('headLabel', e.target.value)} /></label>
          <label className="space-y-1"><span className={labelCls}>Vendor *</span><input className={inputCls} value={inputs.vendor} onChange={e => set('vendor', e.target.value)} placeholder="e.g. Adarsh Printers" /></label>
          <label className="space-y-1"><span className={labelCls}>Purpose *</span><input className={inputCls} value={inputs.purpose} onChange={e => set('purpose', e.target.value)} placeholder="e.g. Printing of visiting cards" /></label>
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 sm:col-span-2">
            <label className="space-y-1"><span className={labelCls}>Document</span>
              <select className={inputCls} value={inputs.billType} onChange={e => set('billType', e.target.value)}>
                {BILL_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className={labelCls}>Bill no. *</span><input className={inputCls} value={inputs.billNo} onChange={e => set('billNo', e.target.value)} placeholder="1420" /></label>
            <label className="space-y-1"><span className={labelCls}>Bill date</span><input type="date" className={inputCls} value={inputs.billDate} onChange={e => set('billDate', e.target.value)} /></label>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="How the amount is entered">
            <span className={labelCls}>Enter amount as</span>
            <button type="button" aria-pressed={inputs.amountMode === 'exclusive'} onClick={() => set('amountMode', 'exclusive')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${inputs.amountMode === 'exclusive' ? 'bg-accent text-white border-accent' : 'border-theme-border/40 text-theme-text-secondary'}`}>Rate (GST added on top)</button>
            <button type="button" aria-pressed={inputs.amountMode === 'inclusive'} onClick={() => set('amountMode', 'inclusive')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${inputs.amountMode === 'inclusive' ? 'bg-accent text-white border-accent' : 'border-theme-border/40 text-theme-text-secondary'}`}>Final amount incl. GST (work backwards)</button>
          </div>
          <div className="flex items-center justify-between">
            <span className={labelCls}>Items * <span className="font-normal opacity-70">— {inputs.amountMode === 'inclusive' ? 'description · qty · unit · final amount ₹ (incl. GST)' : 'description · qty · unit · rate ₹ (excl. GST)'}</span></span>
            <button type="button" className="text-xs text-accent-strong dark:text-accent-soft font-semibold flex items-center gap-1 cursor-pointer" onClick={() => setInputs(p => ({ ...p, items: [...p.items, { desc: '', qty: 1, unit: 'nos', rate: 0, finalAmount: 0 }] }))}><Plus className="h-3.5 w-3.5" /> Add item</button>
          </div>
          {inputs.items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_64px_90px_28px] gap-2 items-center">
              <input className={inputCls} aria-label="Item description" placeholder="Item, e.g. Visiting Cards" value={it.desc} onChange={e => setItem(i, { desc: e.target.value })} />
              <input className={inputCls} aria-label="Quantity" type="number" min="0" step="any" value={it.qty} onChange={e => setItem(i, { qty: Number(e.target.value) })} />
              <input className={inputCls} aria-label="Unit" value={it.unit} onChange={e => setItem(i, { unit: e.target.value })} />
              {inputs.amountMode === 'inclusive' ? (
                <input className={inputCls} aria-label="Final amount incl. GST (₹)" title="Final amount incl. GST (₹)" type="number" min="0" step="any" value={it.finalAmount ?? 0} onChange={e => setItem(i, { finalAmount: Number(e.target.value) })} />
              ) : (
                <input className={inputCls} aria-label="Rate (₹)" title="Rate (₹, excl. GST)" type="number" min="0" step="any" value={it.rate} onChange={e => setItem(i, { rate: Number(e.target.value) })} />
              )}
              <button type="button" aria-label="Remove item" disabled={inputs.items.length === 1} onClick={() => setInputs(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }))} className="text-theme-text-secondary hover:text-danger disabled:opacity-30 cursor-pointer"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-4 text-xs text-theme-text-secondary pt-1">
            <label className="flex items-center gap-2">GST %
              <input type="number" min="0" step="any" className={inputCls + ' !w-20'} value={inputs.gstPercent} onChange={e => set('gstPercent', Number(e.target.value))} />
            </label>
            {inputs.gstPercent === 0 && (
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={inputs.compositionVendor} onChange={e => set('compositionVendor', e.target.checked)} /> Vendor under composition scheme</label>
            )}
          </div>
          <div className="grid grid-cols-[1fr_130px] gap-2 items-center pt-1">
            <input className={inputCls} aria-label="Conveyance label" value={inputs.conveyanceLabel} onChange={e => set('conveyanceLabel', e.target.value)} placeholder="Conveyance fee" />
            <input className={inputCls} aria-label="Conveyance fee (₹)" title="Conveyance fee (₹, added after GST)" type="number" min="0" step="any" value={inputs.conveyanceFee} onChange={e => set('conveyanceFee', Number(e.target.value))} />
          </div>
          <div className="rounded-xl bg-theme-sidebar/50 border border-theme-border/30 p-3 text-xs space-y-1 text-theme-text-secondary" aria-live="polite">
            <div className="flex justify-between"><span>Basic value (excl. GST)</span><span>₹{inrNum(totals.subtotal)}</span></div>
            {inputs.gstPercent > 0 && <div className="flex justify-between"><span>GST @ {inputs.gstPercent}%</span><span>₹{inrNum(totals.gst)}</span></div>}
            {totals.conveyance > 0 && <div className="flex justify-between"><span>{inputs.conveyanceLabel || 'Conveyance fee'}</span><span>₹{inrNum(totals.conveyance)}</span></div>}
            <div className="flex justify-between font-bold text-theme-text-primary border-t border-theme-border/30 pt-1"><span>Total payable</span><span>₹{inrNum(totals.total)}</span></div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className={labelCls}>Drafted wording (editable)</span>
            {Object.keys(overrides).length > 0 && (
              <button type="button" className="text-xs text-accent-strong dark:text-accent-soft font-semibold flex items-center gap-1 cursor-pointer" onClick={() => setOverrides({})}><RotateCcw className="h-3.5 w-3.5" /> Re-draft all</button>
            )}
          </div>
          {(Object.keys(TEXT_LABELS) as TextKey[]).map(k => (
            <label key={k} className="block space-y-1">
              <span className="text-xs text-theme-text-secondary">{TEXT_LABELS[k]} <span className="opacity-70">(**bold**)</span></span>
              <textarea rows={k === 'intro' ? 2 : 3} className={inputCls} value={draft[k]} onChange={e => setOverrides(o => ({ ...o, [k]: e.target.value }))} />
            </label>
          ))}
          <details className="text-xs text-theme-text-secondary">
            <summary className="cursor-pointer font-semibold">Details of procurement (preview)</summary>
            <ul className="list-disc pl-5 pt-1 space-y-0.5 text-theme-text-primary">{draft.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </details>
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-theme-text-secondary">Addressing &amp; signatories (remembered for next time)</summary>
          <div className="space-y-2 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1"><span className={labelCls}>From</span><input className={inputCls} value={inputs.fromLine} onChange={e => set('fromLine', e.target.value)} /></label>
              <label className="space-y-1"><span className={labelCls}>To</span><input className={inputCls} value={inputs.toLine} onChange={e => set('toLine', e.target.value)} /></label>
            </div>
            <label className="block space-y-1"><span className={labelCls}>Sanctioned budget reference</span><input className={inputCls} value={inputs.budgetRef} onChange={e => set('budgetRef', e.target.value)} /></label>
            <PersonRow label="Prepared by" p={inputs.preparedBy} onChange={p => set('preparedBy', p)} />
            {inputs.recommendedBy.map((p, i) => <PersonRow key={'r' + i} label={`Recommended ${i + 1}`} p={p} onChange={x => setPerson('recommendedBy', i, x)} />)}
            {inputs.approvedBy.map((p, i) => <PersonRow key={'a' + i} label={`Approved ${i + 1}`} p={p} onChange={x => setPerson('approvedBy', i, x)} />)}
          </div>
        </details>

        <div className="space-y-2">
          <span className={labelCls}>Annexure – cheque copy (optional, appended as page 2)</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Cheque copy image"
              className="text-xs text-theme-text-secondary"
              onChange={async e => {
                const f = e.target.files?.[0];
                if (!f) return setCheque(null);
                try { setCheque({ name: f.name, dataUrl: await fileToDataUrl(f) }); } catch (err: any) { setError(err.message); }
              }}
            />
            {cheque && <button type="button" className="text-xs text-danger cursor-pointer" onClick={() => setCheque(null)}>Remove</button>}
          </div>
          {cheque && <input className={inputCls} aria-label="Annexure caption" value={inputs.chequeCaption} onChange={e => set('chequeCaption', e.target.value)} placeholder="Cheque Copy (Adarsh Printers, Bank of Baroda)" />}
        </div>

        {error && <p className="text-xs text-danger" role="alert">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-theme-border/20">
          <button type="button" disabled={!!busy} onClick={() => run('docx', false)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border border-theme-border/40 text-theme-text-primary hover:bg-white/5 cursor-pointer disabled:opacity-60">
            {busy === 'docx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download DOCX (editable)
          </button>
          <button type="button" disabled={!!busy} onClick={() => run('pdf', false)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border border-theme-border/40 text-theme-text-primary hover:bg-white/5 cursor-pointer disabled:opacity-60">
            {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
          </button>
          <button type="button" disabled={!!busy} onClick={() => run('pdf', true)} className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl shadow-md shadow-accent/20 cursor-pointer disabled:opacity-60">
            {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} Generate &amp; attach as IDN
          </button>
        </div>
      </div>
    </div>
  );
}
