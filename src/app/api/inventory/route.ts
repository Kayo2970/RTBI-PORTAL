import { NextResponse } from 'next/server';
import { readCollection, mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageInventory } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { bad, str, num } from '@/lib/billing-server';
import { generateItemCode, type InventoryItem, type InventoryMovement } from '@/lib/billing';

export async function GET(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageInventory(actor), 'Inventory is available to staff only.');
    const [items, movements] = await Promise.all([
      readCollection<InventoryItem>('inventoryItems'),
      readCollection<InventoryMovement>('inventoryMovements'),
    ]);
    return NextResponse.json({ items, movements: movements.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 500) });
  } catch (err) {
    return apiError(err, 'inventory-get');
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageInventory(actor), 'Inventory is available to staff only.');
    const b = await request.json();
    const name = str(b.name, 120);
    if (!name) bad('Item name is required.');
    const quantity = num(b.quantity);
    if (quantity < 0) bad('Opening quantity cannot be negative.');
    const now = new Date().toISOString();
    const category = str(b.category, 60);
    const sku = str(b.sku, 60);
    let item!: InventoryItem;
    await mutateCollection<InventoryItem>('inventoryItems', (cur) => {
      const assignedSku = sku || generateItemCode(category, cur);
      if (cur.some(i => i.sku && i.sku.toLowerCase() === assignedSku.toLowerCase())) {
        bad(`Item code "${assignedSku}" is already in use.`);
      }
      item = {
        id: 'inv_item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name,
        sku: assignedSku,
        category,
        unit: str(b.unit, 20) || 'pcs',
        quantity,
        reorderLevel: Math.max(0, num(b.reorderLevel)),
        unitCost: Math.max(0, num(b.unitCost)),
        location: str(b.location, 120),
        notes: str(b.notes, 300),
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      return [...cur, item];
    });
    if (quantity > 0) {
      await mutateCollection<InventoryMovement>('inventoryMovements', (cur) => [
        ...cur,
        { id: 'mv_' + Date.now(), itemId: item.id, itemName: item.name, type: 'In', delta: quantity, quantityAfter: quantity, reason: 'Opening stock', by: actor.name, at: now },
      ]);
    }
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    return apiError(err, 'inventory-post', 400);
  }
}
