'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, PackagePlus, PackageMinus, SlidersHorizontal, Pencil, RotateCw } from 'lucide-react';
import { api, readStoredUser } from '@/lib/billing-client';
import { canManageInventory } from '@/lib/permissions';
import {
  InventoryItem,
  InventoryMovement,
  MovementType,
  formatINR,
  INVENTORY_CATEGORIES,
  INVENTORY_UNITS,
  generateItemCode,
} from '@/lib/billing';
import { Field, Modal, Badge, Banner, Panel, inputCls, btnPrimary, btnGhost, fmtDateTime } from '@/components/billing-ui';

interface FormState {
  name: string;
  sku: string;
  category: string;
  unit: string;
  quantity: string;
  reorderLevel: string;
  unitCost: string;
  location: string;
  notes: string;
}

const defaultCategory = INVENTORY_CATEGORIES[0];
const defaultUnit = 'pcs';

function makeBlankForm(existingItems: InventoryItem[] = []): FormState {
  return {
    name: '',
    sku: generateItemCode(defaultCategory, existingItems),
    category: defaultCategory,
    unit: defaultUnit,
    quantity: '0',
    reorderLevel: '0',
    unitCost: '0',
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
  const [tab, setTab] = useState<'stock' | 'history'>('stock');
  const [q, setQ] = useState('');
  const [catFilter, setCatFilter] = useState<string>('ALL');
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

  const rows = useMemo(() => items
    .filter(i => i.active)
    .filter(i => !lowOnly || i.quantity <= i.reorderLevel)
    .filter(i => catFilter === 'ALL' || (i.category || 'Other') === catFilter)
    .filter(i => !q.trim() || [i.name, i.sku, i.category, i.location].some(f => (f || '').toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name)), [items, q, lowOnly, catFilter]);

  const active = items.filter(i => i.active);
  const lowCount = active.filter(i => i.quantity <= i.reorderLevel).length;
  const value = active.reduce((s, i) => s + i.quantity * i.unitCost, 0);

  if (ready && !allowed) {
    return <div className="p-8"><Banner kind="error">Inventory is available to Super User, CEO and Employee accounts.</Banner></div>;
  }

  function handleCategoryChange(newCategory: string) {
    if (!form) return;
    if (!form.id) {
      // Auto-update Item Code prefix when creating a new item
      const newCode = generateItemCode(newCategory, items);
      setForm({ ...form, v: { ...form.v, category: newCategory, sku: newCode } });
    } else {
      setForm({ ...form, v: { ...form.v, category: newCategory } });
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
        unitCost: Number(v.unitCost),
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
        <button className={btnPrimary} onClick={() => setForm({ v: makeBlankForm(items) })}>
          <Plus className="h-4 w-4" /> Add item
        </button>
      </div>

      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

      <div className="grid grid-cols-3 gap-3">
        <Panel><p className="text-[11px] text-theme-text-secondary">Items</p><p className="text-lg font-bold text-theme-text-primary">{active.length}</p></Panel>
        <Panel><p className="text-[11px] text-theme-text-secondary">Low / out of stock</p><p className={`text-lg font-bold ${lowCount ? 'text-red-500' : 'text-theme-text-primary'}`}>{lowCount}</p></Panel>
        <Panel><p className="text-[11px] text-theme-text-secondary">Stock value</p><p className="text-lg font-bold text-theme-text-primary">{formatINR(value)}</p></Panel>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className={btnGhost} aria-pressed={tab === 'stock'} onClick={() => setTab('stock')}>Stock</button>
        <button className={btnGhost} aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Movement history</button>
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
              onChange={e => setCatFilter(e.target.value)}
            >
              <option value="ALL">All categories</option>
              {INVENTORY_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
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
                <th className="p-3 font-semibold">Item & Code</th>
                <th className="p-3 font-semibold">Category / location</th>
                <th className="p-3 font-semibold text-right">In stock</th>
                <th className="p-3 font-semibold text-right">Reorder at</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-theme-text-secondary">
                    {items.length ? 'No items match.' : 'No inventory yet — add your first item.'}
                  </td>
                </tr>
              )}
              {rows.map(i => {
                const out = i.quantity <= 0;
                const low = !out && i.quantity <= i.reorderLevel;
                return (
                  <tr key={i.id} className="border-b border-theme-card-border/50 text-theme-text-primary">
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
                      {i.location ? <span className="block text-theme-text-secondary">{i.location}</span> : null}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap font-semibold">{i.quantity} {i.unit}</td>
                    <td className="p-3 text-right">{i.reorderLevel}</td>
                    <td className="p-3">{out ? <Badge tone="red">Out of stock</Badge> : low ? <Badge tone="amber">Low</Badge> : <Badge tone="green">OK</Badge>}</td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <span className="inline-flex gap-1.5">
                        <button className={btnGhost} aria-label={`Stock in ${i.name}`} onClick={() => setMove({ item: i, type: 'In' })}><PackagePlus className="h-4 w-4" /></button>
                        <button className={btnGhost} aria-label={`Stock out ${i.name}`} onClick={() => setMove({ item: i, type: 'Out' })}><PackageMinus className="h-4 w-4" /></button>
                        <button className={btnGhost} aria-label={`Adjust ${i.name}`} onClick={() => setMove({ item: i, type: 'Adjust' })}><SlidersHorizontal className="h-4 w-4" /></button>
                        <button
                          className={btnGhost}
                          aria-label={`Edit ${i.name}`}
                          onClick={() => {
                            const isStandardCategory = INVENTORY_CATEGORIES.includes((i.category || '') as any);
                            setForm({
                              id: i.id,
                              v: {
                                name: i.name,
                                sku: i.sku || generateItemCode(i.category, items),
                                category: isStandardCategory ? (i.category || defaultCategory) : 'Other',
                                unit: i.unit || defaultUnit,
                                quantity: String(i.quantity),
                                reorderLevel: String(i.reorderLevel),
                                unitCost: String(i.unitCost),
                                location: i.location || '',
                                notes: i.notes || '',
                              },
                              customCategory: isStandardCategory ? '' : (i.category || ''),
                            });
                          }}
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
                <th className="p-3 font-semibold">By</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-theme-text-secondary">No movements yet.</td></tr>}
              {movements.map(m => (
                <tr key={m.id} className="border-b border-theme-card-border/50 text-theme-text-primary">
                  <td className="p-3 whitespace-nowrap">{fmtDateTime(m.at)}</td>
                  <td className="p-3">{m.itemName}</td>
                  <td className="p-3">{m.type}</td>
                  <td className={`p-3 text-right font-semibold ${m.delta < 0 ? 'text-red-500' : 'text-emerald-500'}`}>{m.delta > 0 ? '+' : ''}{m.delta}</td>
                  <td className="p-3 text-right">{m.quantityAfter}</td>
                  <td className="p-3">{m.reason || '—'}</td>
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
              <Field label="Unit cost (₹)">
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={inputCls}
                  value={form.v.unitCost}
                  onChange={e => setForm({ ...form, v: { ...form.v, unitCost: e.target.value } })}
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const title = type === 'In' ? 'Stock in' : type === 'Out' ? 'Stock out' : 'Adjust stock (stock-take)';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api(`/api/inventory/${item.id}/movements`, 'POST', { type, quantity: Number(qty), reason });
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
