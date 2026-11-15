import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { requireSession, requirePermission } from '@/lib/session';
import { canManageInventory } from '@/lib/permissions-server';
import { apiError } from '@/lib/api-error';
import { bad, str, num } from '@/lib/billing-server';
import type { InventoryItem, InventoryMovement, MovementType } from '@/lib/billing';

/**
 * Stock movement: { type: 'In' | 'Out' | 'Adjust', quantity, reason }.
 * In/Out take a positive quantity; Adjust sets the counted stock level (stock-take).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSession(request);
    requirePermission(canManageInventory(actor), 'Inventory is available to staff only.');
    const { id } = await params;
    const b = await request.json();
    const type = b.type as MovementType;
    if (!['In', 'Out', 'Adjust'].includes(type)) bad('Choose stock in, stock out or adjust.');
    const qty = num(b.quantity, NaN);
    if (!Number.isFinite(qty) || qty < 0 || (type !== 'Adjust' && qty === 0)) bad('Enter a valid quantity.');
    const reason = str(b.reason, 200);
    if (type === 'Adjust' && !reason) bad('Give a reason for the stock adjustment.');

    let item!: InventoryItem;
    let movement!: InventoryMovement;
    await mutateCollection<InventoryItem>('inventoryItems', (cur) => {
      const idx = cur.findIndex(i => i.id === id);
      if (idx === -1) bad('Item not found.');
      const it = cur[idx];
      const after = type === 'In' ? it.quantity + qty : type === 'Out' ? it.quantity - qty : qty;
      if (after < 0) bad(`Only ${it.quantity} ${it.unit} of "${it.name}" in stock.`);
      const now = new Date().toISOString();
      item = { ...it, quantity: Math.round(after * 1000) / 1000, updatedAt: now };
      movement = {
        id: 'mv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        itemId: it.id, itemName: it.name, type,
        delta: Math.round((item.quantity - it.quantity) * 1000) / 1000,
        quantityAfter: item.quantity, reason, by: actor.name, at: now,
      };
      const out = [...cur];
      out[idx] = item;
      return out;
    });
    await mutateCollection<InventoryMovement>('inventoryMovements', (cur) => [...cur, movement]);
    return NextResponse.json({ item, movement }, { status: 201 });
  } catch (err) {
    return apiError(err, 'inventory-movement-post', 400);
  }
}
