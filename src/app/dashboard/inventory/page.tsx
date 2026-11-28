'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, PackagePlus, PackageMinus, SlidersHorizontal, Pencil, RotateCw, QrCode, ScanLine, Printer } from 'lucide-react';
import { api, readStoredUser } from '@/lib/billing-client';
import { canManageInventory } from '@/lib/permissions';
import {
  InventoryItem,
  InventoryMovement,
  MovementType,
  INVENTORY_CATEGORIES,
  INVENTORY_SUBCATEGORIES,
  INVENTORY_UNITS,
  generateItemCode,
} from '@/lib/billing';
import { getEvents } from '@/lib/local-data';
import { exportStickersPdf, findItemByScan } from '@/lib/inventory-qr';
import { ScanModal } from '@/components/inventory/scan-modal';
import { Field, Modal, Badge, Banner, Panel, inputCls, btnPrimary, btnGhost, fmtDateTime } from '@/components/billing-ui';

interface FormState {
  name: string;
  sku: string;
  category: string;
  subCategory: string;
  unit: string;
  quantity: string;
  reorderLevel: string;
  procurementDate: string;
  purchaseDate: string;
  location: string;
  notes: string;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type SortKey = 'name' | 'category' | 'code' | 'qtyAsc' | 'qtyDesc' | 'procured';

const defaultCategory = INVENTORY_CATEGORIES[0];
const defaultUnit = 'pcs';

function makeBlankForm(existingItems: InventoryItem[] = []): FormState {
  return {
    name: '',
    sku: generateItemCode(defaultCategory, existingItems),
    category: defaultCategory,
    subCategory: '',
    unit: defaultUnit,
    quantity: '0',
    reorderLevel: '0',
    procurementDate: todayIso(),
    purchaseDate: todayIso(),
    location: '',
    notes: '',
  };
}

export default function InventoryPage() {
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [tab, setTab] = useState<'stock' | 'history' | 'events'>('stock');
  const [q, setQ] = useState('');
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [subFilter, setSubFilter] = useState<string>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('category');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<InventoryItem | null>(null);
  const [busyQr, setBusyQr] = useState(false);
  const [lowOnly, setLowOnly] = useState(false);
  const [form, setForm] = useState<{ id?: string; v: FormState; customCategory?: string } | null>(null);
  const [move, setMove] = useState<{ item: InventoryItem; type: MovementType } | null>(null);

  const allowed = canManageInventory(user);

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: InventoryItem[]; movements: InventoryMovement[] }>('/api/inventory');
      setItems(d.items);
      setMovements(d.movements);
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message });
    }
  }, []);

  useEffect(() => {
    const u = readStoredUser();
    setUser(u);
    setReady(true);
    if (canManageInventory(u)) load();
  }, [load]);

  const rows = useMemo(() => {
    const cmpName = (a: InventoryItem, b: InventoryItem) => a.name.localeCompare(b.name);
    const sorters: Record<SortKey, (a: InventoryItem, b: InventoryItem) => number> = {
      name: cmpName,
      category: (a, b) =>
        (a.category || 'Other').localeCompare(b.category || 'Other') ||
        (a.subCategory || '').localeCompare(b.subCategory || '') ||
        cmpName(a, b),
      code: (a, b) => (a.sku || '').localeCompare(b.sku || '', undefined, { numeric: true }),
      qtyAsc: (a, b) => a.quantity - b.quantity || cmpName(a, b),
      qtyDesc: (a, b) => b.quantity - a.quantity || cmpName(a, b),
      procured: (a, b) => (b.procurementDate || '').localeCompare(a.procurementDate || '') || cmpName(a, b),
    };
    return items
      .filter(i => i.active)
      .filter(i => !lowOnly || i.quantity <= i.reorderLevel)
      .filter(i => catFilter === 'ALL' || (i.category || 'Other') === catFilter)
      .filter(i => subFilter === 'ALL' || (i.subCategory || '') === subFilter)
      .filter(i => !q.trim() || [i.name, i.sku, i.category, i.subCategory, i.location].some(f => (f || '').toLowerCase().includes(q.toLowerCase())))
      .sort(sorters[sortKey]);
  }, [items, q, lowOnly, catFilter, subFilter, sortKey]);

  // Sub-category choices for the filter: those used by items in the chosen category.
  const subOptions = useMemo(() => {
    const set = new Set<string>();
    items.filter(i => i.active && i.subCategory && (catFilter === 'ALL' || (i.category || 'Other') === catFilter)).forEach(i => set.add(i.subCategory!));
    return [...set].sort();
  }, [items, catFilter]);

  // How much stock each event consumed (stock-outs linked to an event).
  const eventUsage = useMemo(() => {
    const byEvent = new Map<string, { eventId: string; eventName: string; lines: Map<string, { itemName: string; unit: string; qty: number; last: string }>; total: number }>();
    const unitOf = new Map(items.map(i => [i.id, i.unit]));
    for (const m of movements) {
      if (m.type !== 'Out' || !m.eventId) continue;
      let ev = byEvent.get(m.eventId);
      if (!ev) { ev = { eventId: m.eventId, eventName: m.eventName || m.eventId, lines: new Map(), total: 0 }; byEvent.set(m.eventId, ev); }
      const qty = Math.abs(m.delta);
      const line = ev.lines.get(m.itemId) || { itemName: m.itemName, unit: unitOf.get(m.itemId) || '', qty: 0, last: m.at };
      line.qty += qty;
      if (m.at > line.last) line.last = m.at;
      ev.lines.set(m.itemId, line);
      ev.total += qty;
    }
    return [...byEvent.values()].sort((a, b) => a.eventName.localeCompare(b.eventName));
  }, [movements, items]);

  const usedByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of movements) if (m.type === 'Out' && m.eventId) map.set(m.itemId, (map.get(m.itemId) || 0) + Math.abs(m.delta));
    return map;
  }, [movements]);

  const active = items.filter(i => i.active);
  const lowCount = active.filter(i => i.quantity <= i.reorderLevel).length;

  if (ready && !allowed) {
    return <div className="p-8"><Banner kind="error">Inventory is available to Super User, CEO and Employee accounts.</Banner></div>;
  }

  function handleCategoryChange(newCategory: string) {
    if (!form) return;
    if (!form.id) {
      // Auto-update Item Code prefix when creating a new item
      const newCode = generateItemCode(newCategory, items);
      setForm({ ...form, v: { ...form.v, category: newCategory, subCategory: '', sku: newCode } });
    } else {
      setForm({ ...form, v: { ...form.v, category: newCategory, subCategory: '' } });
    }
  }

  function handleRegenerateCode() {
    if (!form) return;
    const effectiveCategory = form.v.category === 'Other' && form.customCategory?.trim()
      ? form.customCategory.trim()
      : form.v.category;
    const newCode = generateItemCode(effectiveCategory, items);
    setForm({ ...form, v: { ...form.v, sku: newCode } });
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    try {
      const v = form.v;
      const finalCategory = v.category === 'Other' && form.customCategory?.trim()
        ? form.customCategory.trim()
        : v.category;
      const body = {
        ...v,
        category: finalCategory,
        quantity: Number(v.quantity),
        reorderLevel: Number(v.reorderLevel),
      };
      if (form.id) await api(`/api/inventory/${form.id}`, 'PATCH', body);
      else await api('/api/inventory', 'POST', body);
      setForm(null);
      setMsg({ kind: 'ok', text: 'Item saved.' });
      await load();
    } catch (err: any) {
      setMsg({ kind: 'error', text: err.message });
    }
  }

  const toggleSel = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  async function exportQr(list: InventoryItem[]) {
    if (list.length === 0) { setMsg({ kind: 'error', text: 'No items to export.' }); return; }
    setBusyQr(true);
    try {
      await exportStickersPdf(list, list.length === 1 ? `QR_${list[0].sku || list[0].id}.pdf` : undefined);
      setMsg({ kind: 'ok', text: `Exported ${list.length} QR sticker${list.length === 1 ? '' : 's'} (PDF).` });
    } catch (err: any) {
      setMsg({ kind: 'error', text: err.message || 'Could not create the sticker PDF.' });
    } finally {
      setBusyQr(false);
    }
  }

  function handleScan(value: string) {
    setScanning(false);
    const hit = findItemByScan(items.filter(i => i.active), value);
    if (hit) setScanned(hit);
    else setMsg({ kind: 'error', text: `No inventory item matches "${value}".` });
  }

  function openEdit(i: InventoryItem) {
    const isStandardCategory = INVENTORY_CATEGORIES.includes((i.category || '') as any);
    setForm({
      id: i.id,
      v: {
        name: i.name,
        sku: i.sku || generateItemCode(i.category, items),
        category: isStandardCategory ? (i.category || defaultCategory) : 'Other',
        subCategory: i.subCategory || '',
        unit: i.unit || defaultUnit,
        quantity: String(i.quantity),
        reorderLevel: String(i.reorderLevel),
        procurementDate: i.procurementDate || '',
        purchaseDate: i.purchaseDate || '',
        location: i.location || '',
        notes: i.notes || '',
      },
      customCategory: isStandardCategory ? '' : (i.category || ''),
    });
  }

  async function archive(i: InventoryItem) {
    if (!confirm(`Archive "${i.name}"? It will be hidden from stock lists; its history is kept.`)) return;
    try {
      await api(`/api/inventory/${i.id}`, 'PATCH', { active: false });
      await load();
    } catch (err: any) {
      setMsg({ kind: 'error', text: err.message });
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary">Inventory</h1>
          <p className="text-xs text-theme-text-secondary">Track stock levels, every movement, and what needs reordering.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} onClick={() => setScanning(true)}>
            <ScanLine className="h-4 w-4" /> Scan QR
          </button>
          <button className={btnGhost} disabled={busyQr} onClick={() => exportQr(selected.size ? rows.filter(r => selected.has(r.id)) : rows)}>
            <Printer className="h-4 w-4" /> {busyQr ? 'Preparing…' : selected.size ? `QR stickers (${selected.size})` : 'QR stickers (all shown)'}
          </button>
          <button className={btnPrimary} onClick={() => setForm({ v: makeBlankForm(items) })}>
            <Plus className="h-4 w-4" /> Add item
          </button>
        </div>
      </div>

      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

      <div className="grid grid-cols-3 gap-3">
        <Panel><p className="text-[11px] text-theme-text-secondary">Items</p><p className="text-lg font-bold text-theme-text-primary">{active.length}</p></Panel>
        <Panel><p className="text-[11px] text-theme-text-secondary">Low / out of stock</p><p className={`text-lg font-bold ${lowCount ? 'text-red-500' : 'text-theme-text-primary'}`}>{lowCount}</p></Panel>
        <Panel><p className="text-[11px] text-theme-text-secondary">Events supplied</p><p className="text-lg font-bold text-theme-text-primary">{eventUsage.length}</p></Panel>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className={btnGhost} aria-pressed={tab === 'stock'} onClick={() => setTab('stock')}>Stock</button>
        <button className={btnGhost} aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Movement history</button>
        <button className={btnGhost} aria-pressed={tab === 'events'} onClick={() => setTab('events')}>Event usage</button>
        {tab === 'stock' && (
          <>
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-secondary" />
              <input
                aria-label="Search inventory"
                className={inputCls + ' !pl-9'}
                placeholder="Search name, item code, category…"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
            </div>
            <select
              aria-label="Filter by category"
              className={`${inputCls} !w-auto cursor-pointer [&>option]:bg-theme-background [&>option]:text-theme-text-primary text-xs py-2`}
              value={catFilter}
              onChange={e => { setCatFilter(e.target.value); setSubFilter('ALL'); }}
            >
              <option value="ALL">All categories</option>
              {INVENTORY_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <select
              aria-label="Filter by sub-category"
              className={`${inputCls} !w-auto cursor-pointer [&>option]:bg-theme-background [&>option]:text-theme-text-primary text-xs py-2`}
              value={subFilter}
              onChange={e => setSubFilter(e.target.value)}
            >
              <option value="ALL">All sub-categories</option>
              {subOptions.map(sc => (
                <option key={sc} value={sc}>{sc}</option>
              ))}
            </select>
            <select
              aria-label="Sort items"
              className={`${inputCls} !w-auto cursor-pointer [&>option]:bg-theme-background [&>option]:text-theme-text-primary text-xs py-2`}
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
            >
              <option value="category">Sort: Category</option>
              <option value="name">Sort: Name A–Z</option>
              <option value="code">Sort: Item code</option>
              <option value="qtyAsc">Sort: Stock low → high</option>
              <option value="qtyDesc">Sort: Stock high → low</option>
              <option value="procured">Sort: Recently procured</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-theme-text-secondary cursor-pointer">
              <input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} /> Low stock only
            </label>
          </>
        )}
      </div>

      {tab === 'stock' ? (
        <Panel className="!p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-theme-text-secondary border-b border-theme-card-border">
                <th className="p-3 w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={rows.length > 0 && rows.every(r => selected.has(r.id))}
                    onChange={e => setSelected(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())}
                  />
                </th>
                <th className="p-3 font-semibold">Item & Code</th>
                <th className="p-3 font-semibold">Category / location</th>
                <th className="p-3 font-semibold">Procured / purchased</th>
                <th className="p-3 font-semibold text-right">In stock</th>
                <th className="p-3 font-semibold text-right">Used for events</th>
                <th className="p-3 font-semibold text-right">Reorder at</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-theme-text-secondary">
                    {items.length ? 'No items match.' : 'No inventory yet — add your first item.'}
                  </td>
                </tr>
              )}
              {rows.map(i => {
                const out = i.quantity <= 0;
                const low = !out && i.quantity <= i.reorderLevel;
                return (
                  <tr key={i.id} className="border-b border-theme-card-border/50 text-theme-text-primary">
                    <td className="p-3">
                      <input type="checkbox" aria-label={`Select ${i.name}`} checked={selected.has(i.id)} onChange={() => toggleSel(i.id)} />
                    </td>
                    <td className="p-3 font-semibold">
                      <span>{i.name}</span>
                      {i.sku ? (
                        <span className="block font-mono text-[11px] font-normal text-theme-text-secondary tracking-wide mt-0.5">
                          Code: {i.sku}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3">
                      {i.category || '—'}
                      {i.subCategory ? <span className="block text-theme-text-secondary">› {i.subCategory}</span> : null}
                      {i.location ? <span className="block text-theme-text-secondary">{i.location}</span> : null}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="block">Procured: {i.procurementDate || '—'}</span>
                      <span className="block text-theme-text-secondary">Purchased: {i.purchaseDate || '—'}</span>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap font-semibold">{i.quantity} {i.unit}</td>
                    <td className="p-3 text-right whitespace-nowrap">{usedByItem.get(i.id) ? `${Math.round(usedByItem.get(i.id)! * 1000) / 1000} ${i.unit}` : '—'}</td>
                    <td className="p-3 text-right">{i.reorderLevel}</td>
                    <td className="p-3">{out ? <Badge tone="red">Out of stock</Badge> : low ? <Badge tone="amber">Low</Badge> : <Badge tone="green">OK</Badge>}</td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <span className="inline-flex gap-1.5">
                        <button className={btnGhost} aria-label={`Stock in ${i.name}`} onClick={() => setMove({ item: i, type: 'In' })}><PackagePlus className="h-4 w-4" /></button>
                        <button className={btnGhost} aria-label={`Stock out ${i.name}`} onClick={() => setMove({ item: i, type: 'Out' })}><PackageMinus className="h-4 w-4" /></button>
                        <button className={btnGhost} aria-label={`Adjust ${i.name}`} onClick={() => setMove({ item: i, type: 'Adjust' })}><SlidersHorizontal className="h-4 w-4" /></button>
                        <button className={btnGhost} aria-label={`QR sticker for ${i.name}`} onClick={() => exportQr([i])}><QrCode className="h-4 w-4" /></button>
                        <button
                          className={btnGhost}
                          aria-label={`Edit ${i.name}`}
                          onClick={() => openEdit(i)}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      ) : tab === 'events' ? (
        <div className="space-y-4">
          {eventUsage.length === 0 && (
            <Panel><p className="text-xs text-theme-text-secondary">No event usage yet. Use <b>Stock out</b> and pick an event to record what an event consumed.</p></Panel>
          )}
          {eventUsage.map(ev => (
            <Panel key={ev.eventId} className="!p-0 overflow-x-auto">
              <div className="flex items-center justify-between p-3 border-b border-theme-card-border">
                <h3 className="text-sm font-bold text-theme-text-primary">{ev.eventName}</h3>
                <span className="text-[11px] text-theme-text-secondary">{ev.lines.size} item{ev.lines.size === 1 ? '' : 's'} · {Math.round(ev.total * 1000) / 1000} units used</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-theme-text-secondary border-b border-theme-card-border">
                    <th className="p-3 font-semibold">Item</th>
                    <th className="p-3 font-semibold text-right">Utilised</th>
                    <th className="p-3 font-semibold">Last issued</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ev.lines.values()].sort((a, b) => a.itemName.localeCompare(b.itemName)).map(l => (
                    <tr key={l.itemName} className="border-b border-theme-card-border/50 text-theme-text-primary">
                      <td className="p-3">{l.itemName}</td>
                      <td className="p-3 text-right font-semibold">{Math.round(l.qty * 1000) / 1000} {l.unit}</td>
                      <td className="p-3 whitespace-nowrap">{fmtDateTime(l.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ))}
        </div>
      ) : (
        <Panel className="!p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-theme-text-secondary border-b border-theme-card-border">
                <th className="p-3 font-semibold">When</th>
                <th className="p-3 font-semibold">Item</th>
                <th className="p-3 font-semibold">Type</th>
                <th className="p-3 font-semibold text-right">Change</th>
                <th className="p-3 font-semibold text-right">Balance</th>
                <th className="p-3 font-semibold">Reason</th>
                <th className="p-3 font-semibold">Event</th>
                <th className="p-3 font-semibold">By</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-theme-text-secondary">No movements yet.</td></tr>}
              {movements.map(m => (
                <tr key={m.id} className="border-b border-theme-card-border/50 text-theme-text-primary">
                  <td className="p-3 whitespace-nowrap">{fmtDateTime(m.at)}</td>
                  <td className="p-3">{m.itemName}</td>
                  <td className="p-3">{m.type}</td>
                  <td className={`p-3 text-right font-semibold ${m.delta < 0 ? 'text-red-500' : 'text-emerald-500'}`}>{m.delta > 0 ? '+' : ''}{m.delta}</td>
                  <td className="p-3 text-right">{m.quantityAfter}</td>
                  <td className="p-3">{m.reason || '—'}</td>
                  <td className="p-3">{m.eventName || '—'}</td>
                  <td className="p-3">{m.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {form && (
        <Modal title={form.id ? 'Edit item' : 'Add inventory item'} onClose={() => setForm(null)}>
          <form onSubmit={saveItem} className="space-y-4">
            <Field label="Item name *">
              <input
                required
                className={inputCls}
                placeholder="e.g. Oscilloscope 100MHz, Arduino Mega…"
                value={form.v.name}
                onChange={e => setForm({ ...form, v: { ...form.v, name: e.target.value } })}
              />
            </Field>

            <Field label="Item Code *" hint="Auto-generated unique code across inventory">
              <div className="flex gap-2">
                <input
                  required
                  className={`${inputCls} font-mono uppercase tracking-wider flex-1`}
                  value={form.v.sku}
                  placeholder="e.g. RTBI-LAB-1001"
                  onChange={e => setForm({ ...form, v: { ...form.v, sku: e.target.value.toUpperCase() } })}
                />
                <button
                  type="button"
                  className={btnGhost + ' px-3 shrink-0'}
                  title="Generate new unique code"
                  onClick={handleRegenerateCode}
                >
                  <RotateCw className="h-4 w-4" />
                  <span className="hidden sm:inline">Regenerate</span>
                </button>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Category *">
                <select
                  className={`${inputCls} cursor-pointer [&>option]:bg-theme-background [&>option]:text-theme-text-primary`}
                  value={form.v.category}
                  onChange={e => handleCategoryChange(e.target.value)}
                >
                  {INVENTORY_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </Field>

              <Field label="Unit of Measurement *">
                <select
                  className={`${inputCls} cursor-pointer [&>option]:bg-theme-background [&>option]:text-theme-text-primary`}
                  value={form.v.unit}
                  onChange={e => setForm({ ...form, v: { ...form.v, unit: e.target.value } })}
                >
                  {form.v.unit && !INVENTORY_UNITS.some(u => u.value === form.v.unit) && (
                    <option value={form.v.unit}>{form.v.unit}</option>
                  )}
                  {INVENTORY_UNITS.map(u => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Sub-category" hint="Pick a suggestion or type your own">
              <input
                className={inputCls}
                list="inv-subcats"
                placeholder="e.g. Sensors & Modules"
                value={form.v.subCategory}
                onChange={e => setForm({ ...form, v: { ...form.v, subCategory: e.target.value } })}
              />
              <datalist id="inv-subcats">
                {[...new Set([...(INVENTORY_SUBCATEGORIES[form.v.category] || []), ...items.filter(i => (i.category || 'Other') === (form.v.category === 'Other' ? (form.customCategory || 'Other') : form.v.category) && i.subCategory).map(i => i.subCategory!)])].map(sc => (
                  <option key={sc} value={sc} />
                ))}
              </datalist>
            </Field>

            {form.v.category === 'Other' && (
              <Field label="Specific Category Name (Optional)" hint="Specify custom category if Other was chosen">
                <input
                  className={inputCls}
                  placeholder="e.g. Robotics, Chemical Reagents, Bio-Sensors…"
                  value={form.customCategory || ''}
                  onChange={e => setForm({ ...form, customCategory: e.target.value })}
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Location" hint="Storage rack, shelf, lab or room">
                <input
                  className={inputCls}
                  placeholder="e.g. Lab 2 - Shelf B, RTBI Store…"
                  value={form.v.location}
                  onChange={e => setForm({ ...form, v: { ...form.v, location: e.target.value } })}
                />
              </Field>
              {!form.id && (
                <Field label="Opening quantity">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className={inputCls}
                    value={form.v.quantity}
                    onChange={e => setForm({ ...form, v: { ...form.v, quantity: e.target.value } })}
                  />
                </Field>
              )}
              <Field label="Reorder level" hint="Flagged as low at or below this">
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={inputCls}
                  value={form.v.reorderLevel}
                  onChange={e => setForm({ ...form, v: { ...form.v, reorderLevel: e.target.value } })}
                />
              </Field>
              <Field label="Date of procurement">
                <input
                  type="date"
                  className={inputCls}
                  value={form.v.procurementDate}
                  onChange={e => setForm({ ...form, v: { ...form.v, procurementDate: e.target.value } })}
                />
              </Field>
              <Field label="Date of purchase">
                <input
                  type="date"
                  className={inputCls}
                  value={form.v.purchaseDate}
                  onChange={e => setForm({ ...form, v: { ...form.v, purchaseDate: e.target.value } })}
                />
              </Field>
            </div>

            <Field label="Notes">
              <input
                className={inputCls}
                placeholder="Optional supplier, model, or calibration notes…"
                value={form.v.notes}
                onChange={e => setForm({ ...form, v: { ...form.v, notes: e.target.value } })}
              />
            </Field>

            {form.id && (
              <p className="text-[11px] text-theme-text-secondary">
                Change stock levels with the stock in / out / adjust buttons so every movement is audited.
              </p>
            )}

            <div className="flex gap-2 pt-2">
              <button className={btnPrimary + ' flex-1'} type="submit">Save item</button>
              {form.id && (
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => {
                    const it = items.find(x => x.id === form.id);
                    setForm(null);
                    if (it) archive(it);
                  }}
                >
                  Archive
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}

      {scanning && <ScanModal onResult={handleScan} onClose={() => setScanning(false)} />}

      {scanned && (
        <Modal title={scanned.name} onClose={() => setScanned(null)}>
          <div className="space-y-4 text-xs text-theme-text-primary">
            <div className="space-y-1">
              <p className="font-mono text-theme-text-secondary">{scanned.sku || scanned.id}</p>
              <p>{[scanned.category, scanned.subCategory].filter(Boolean).join(' › ') || '—'}{scanned.location ? ` · ${scanned.location}` : ''}</p>
              <p className="text-base font-bold">{scanned.quantity} {scanned.unit} in stock</p>
              <p className="text-theme-text-secondary">Procured {scanned.procurementDate || '—'} · Purchased {scanned.purchaseDate || '—'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={btnPrimary} onClick={() => { const it = scanned; setScanned(null); setMove({ item: it, type: 'In' }); }}><PackagePlus className="h-4 w-4" /> Stock in</button>
              <button className={btnPrimary} onClick={() => { const it = scanned; setScanned(null); setMove({ item: it, type: 'Out' }); }}><PackageMinus className="h-4 w-4" /> Stock out</button>
              <button className={btnGhost} onClick={() => { const it = scanned; setScanned(null); setMove({ item: it, type: 'Adjust' }); }}><SlidersHorizontal className="h-4 w-4" /> Adjust</button>
              <button className={btnGhost} onClick={() => { const it = scanned; setScanned(null); openEdit(it); }}><Pencil className="h-4 w-4" /> Edit</button>
              <button className={btnGhost} onClick={() => { setScanned(null); setScanning(true); }}><ScanLine className="h-4 w-4" /> Scan next</button>
            </div>
          </div>
        </Modal>
      )}

      {move && (
        <MoveModal
          item={move.item}
          type={move.type}
          onClose={() => setMove(null)}
          onDone={async () => {
            setMove(null);
            setMsg({ kind: 'ok', text: 'Stock updated.' });
            await load();
          }}
        />
      )}
    </div>
  );
}

function MoveModal({ item, type, onClose, onDone }: { item: InventoryItem; type: MovementType; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState(type === 'Adjust' ? String(item.quantity) : '');
  const [reason, setReason] = useState('');
  const [eventId, setEventId] = useState('');
  const [events, setEvents] = useState<{ id: string; title: string; startDate?: string }[]>([]);
  useEffect(() => { if (type === 'Out') setEvents(getEvents() as any); }, [type]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const title = type === 'In' ? 'Stock in' : type === 'Out' ? 'Stock out' : 'Adjust stock (stock-take)';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api(`/api/inventory/${item.id}/movements`, 'POST', { type, quantity: Number(qty), reason, eventId: eventId || undefined, eventName: events.find(e => e.id === eventId)?.title });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${title}: ${item.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-theme-text-secondary">Currently {item.quantity} {item.unit} in stock.</p>
        <Field label={type === 'Adjust' ? `Counted quantity (${item.unit}) *` : `Quantity (${item.unit}) *`}>
          <input
            required
            autoFocus
            type="number"
            min={type === 'Adjust' ? '0' : '0.001'}
            step="any"
            className={inputCls}
            value={qty}
            onChange={e => setQty(e.target.value)}
          />
        </Field>
        {type === 'Out' && (
          <Field label="Used for event (optional)" hint="Links this stock-out to an event so its utilisation is reported">
            <select
              className={`${inputCls} cursor-pointer [&>option]:bg-theme-background [&>option]:text-theme-text-primary`}
              value={eventId}
              onChange={e => setEventId(e.target.value)}
            >
              <option value="">— Not for an event —</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.title}{ev.startDate ? ` (${ev.startDate})` : ''}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label={type === 'Adjust' ? 'Reason *' : 'Reason / reference'}>
          <input
            required={type === 'Adjust'}
            className={inputCls}
            placeholder={type === 'In' ? 'Purchase, donation…' : type === 'Out' ? 'Used for event, issued to startup…' : 'Recount, damaged, lost…'}
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
        </Field>
        {error && <Banner kind="error">{error}</Banner>}
        <button className={btnPrimary + ' w-full'} disabled={busy} type="submit">{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Modal>
  );
}
