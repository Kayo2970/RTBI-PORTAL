import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageInventory } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { bad, str, num } from '@/lib/billing-server';
import type { InventoryItem } from '@/lib/billing';

/** Edit item details. Stock levels change only through /movements so there is always an audit trail. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageInventory(actor), 'Inventory is available to staff only.');
    const { id } = await params;
    const b = await request.json();
    let updated!: InventoryItem;
    await mutateCollection<InventoryItem>('inventoryItems', (cur) => {
      const idx = cur.findIndex(i => i.id === id);
      if (idx === -1) bad('Item not found.');
      const it = cur[idx];
      const name = b.name !== undefined ? str(b.name, 120) : it.name;
      if (!name) bad('Item name is required.');
      const sku = b.sku !== undefined ? str(b.sku, 60) : it.sku;
      if (sku && cur.some(o => o.id !== id && o.sku && o.sku.toLowerCase() === sku.toLowerCase())) bad(`SKU "${sku}" is already in use.`);
      updated = {
        ...it, name, sku,
        category: b.category !== undefined ? str(b.category, 60) : it.category,
        unit: b.unit !== undefined ? str(b.unit, 20) || 'pcs' : it.unit,
        reorderLevel: b.reorderLevel !== undefined ? Math.max(0, num(b.reorderLevel)) : it.reorderLevel,
        unitCost: b.unitCost !== undefined ? Math.max(0, num(b.unitCost)) : it.unitCost,
        location: b.location !== undefined ? str(b.location, 120) : it.location,
        notes: b.notes !== undefined ? str(b.notes, 300) : it.notes,
        active: b.active !== undefined ? !!b.active : it.active,
        updatedAt: new Date().toISOString(),
      };
      const out = [...cur];
      out[idx] = updated;
      return out;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return apiError(err, 'inventory-patch', 400);
  }
}
