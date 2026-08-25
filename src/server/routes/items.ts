import { Hono } from 'hono';
import { getDb, Bindings, Variables } from '../db/client';
import { items, categories, bookings, auditLog } from '../db/schema';
import { itemSchema, categorySchema } from '../../shared/schemas';
import { eq, and, gte, inArray, sql } from 'drizzle-orm';
import { pathParam, requireRole } from '../middleware';
import { newId } from '../ids';
import { getKolkataDateString } from '../../shared/slots';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// --- Resident Route: Browse Items Grouped by Category ---
app.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const user = c.get('user');

  // Residents only see active items. Reps/Admins see all items.
  const isRepOrAdmin = user && (user.role === 'rep' || user.role === 'admin');

  const allCategories = await db.select().from(categories).orderBy(categories.sortOrder);
  const allItems = await db.select().from(items).orderBy(items.sortOrder);

  // Group items by category
  const result = allCategories.map((cat) => {
    const catItems = allItems.filter(
      (item) =>
        item.categoryId === cat.id &&
        (isRepOrAdmin || item.active)
    );
    return {
      ...cat,
      items: catItems,
    };
  }).filter(cat => isRepOrAdmin || cat.items.length > 0);

  return c.json(result);
});

// --- Rep/Admin Routes: Manage Categories ---
app.post('/categories', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);
  const body = await c.req.json();
  const parsed = categorySchema.safeParse(body);
  
  if (!parsed.success) {
    return c.json({ error: 'Invalid data', details: parsed.error.format() }, 400);
  }

  const catId = newId('cat');
  await db.insert(categories).values({
    id: catId,
    name: parsed.data.name,
    sortOrder: parsed.data.sortOrder,
  });

  return c.json({ success: true, id: catId });
});

app.put('/categories/:id', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);
  const id = pathParam(c, 'id');
  const body = await c.req.json();
  const parsed = categorySchema.safeParse(body);
  
  if (!parsed.success) {
    return c.json({ error: 'Invalid data', details: parsed.error.format() }, 400);
  }

  await db.update(categories)
    .set({ name: parsed.data.name, sortOrder: parsed.data.sortOrder })
    .where(eq(categories.id, id));

  return c.json({ success: true });
});

app.delete('/categories/:id', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);
  const id = pathParam(c, 'id');
  const actor = c.get('user');

  // Only an empty category may go. A category holding items would orphan them,
  // and items are never hard-deleted (§11) so there is nothing to cascade.
  const existingItems = await db.select().from(items).where(eq(items.categoryId, id)).limit(1);
  if (existingItems.length > 0) {
    return c.json({ error: 'Category cannot be deleted: it contains items. Move or archive them first.' }, 400);
  }

  await db.delete(categories).where(eq(categories.id, id));

  await db.insert(auditLog).values({
    id: newId('aud'),
    actorId: actor.id,
    action: 'delete_category',
    targetType: 'category',
    targetId: id,
    createdAt: new Date(),
  });

  return c.json({ success: true });
});

// --- Rep/Admin Routes: Manage Items ---

// Check quantity conflicts helper
app.post('/:id/check-quantity', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);
  const id = pathParam(c, 'id');
  const { quantity } = await c.req.json();

  if (typeof quantity !== 'number' || quantity < 0) {
    return c.json({ error: 'Quantity must be a positive integer' }, 400);
  }

  // Find all future slots where approved count is greater than proposed quantity
  const todayStr = getKolkataDateString();
  
  const futureApproved = await db.select({
    slotDate: bookings.slotDate,
    slotIndex: bookings.slotIndex,
    count: sql<number>`count(*)`
  })
  .from(bookings)
  .where(
    and(
      eq(bookings.itemId, id),
      eq(bookings.status, 'approved'),
      gte(bookings.slotDate, todayStr)
    )
  )
  .groupBy(bookings.slotDate, bookings.slotIndex);

  const conflicts = futureApproved.filter(slot => slot.count > quantity);

  if (conflicts.length === 0) {
    return c.json({ hasConflicts: false, conflicts: [] });
  }

  // Fetch individual booking details for the conflicts so the rep can choose
  const conflictDetails = await Promise.all(
    conflicts.map(async (conf) => {
      const bDetails = await db.select({
        id: bookings.id,
        userName: sql<string>`(select name from users where id = bookings.user_id)`,
        roomNo: sql<string>`(select room_no from users where id = bookings.user_id)`,
        note: bookings.note
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.itemId, id),
          eq(bookings.slotDate, conf.slotDate),
          eq(bookings.slotIndex, conf.slotIndex),
          eq(bookings.status, 'approved')
        )
      );
      return {
        ...conf,
        bookings: bDetails
      };
    })
  );

  return c.json({ hasConflicts: true, conflicts: conflictDetails });
});

// Create Item
app.post('/', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);
  const body = await c.req.json();
  const parsed = itemSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid item parameters', details: parsed.error.format() }, 400);
  }

  const itemId = newId('itm');
  await db.insert(items).values({
    id: itemId,
    ...parsed.data,
    createdAt: new Date(),
  });

  // Log action
  const actor = c.get('user');
  await db.insert(auditLog).values({
    id: newId('aud'),
    actorId: actor.id,
    action: 'create_item',
    targetType: 'item',
    targetId: itemId,
    metaJson: JSON.stringify(parsed.data),
    createdAt: new Date(),
  });

  return c.json({ success: true, id: itemId });
});

// Update Item (handles quantity adjustment & archiving/toggling)
app.put('/:id', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);
  const id = pathParam(c, 'id');
  const body = await c.req.json();
  
  // Body can contain resolving cancellations
  const { resolveCancellations, ...itemData } = body;
  const parsed = itemSchema.safeParse(itemData);

  if (!parsed.success) {
    return c.json({ error: 'Invalid item data', details: parsed.error.format() }, 400);
  }

  const actor = c.get('user');
  const existingItem = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (existingItem.length === 0) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const todayStr = getKolkataDateString();

  // 1. Transactional check for overbookings
  const proposedQty = parsed.data.quantity;
  if (proposedQty < existingItem[0].quantity) {
    const futureApproved = await db.select({
      slotDate: bookings.slotDate,
      slotIndex: bookings.slotIndex,
      count: sql<number>`count(*)`
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.itemId, id),
        eq(bookings.status, 'approved'),
        gte(bookings.slotDate, todayStr)
      )
    )
    .groupBy(bookings.slotDate, bookings.slotIndex);

    const conflicts = futureApproved.filter(slot => slot.count > proposedQty);

    if (conflicts.length > 0) {
      const cancelIds: string[] = Array.isArray(resolveCancellations)
        ? resolveCancellations.filter((v: unknown): v is string => typeof v === 'string')
        : [];

      if (cancelIds.length === 0) {
        return c.json({
          error: 'Lowering quantity causes overbooking. Please resolve oversubscribed slots first.',
          requiresResolution: true,
          conflicts,
        }, 409);
      }

      // Verify the nominated cancellations actually clear every oversubscribed
      // slot. Without this the reduction commits on any non-empty list and the
      // item is silently overbooked.
      const cancelled = await db.select({
        id: bookings.id,
        slotDate: bookings.slotDate,
        slotIndex: bookings.slotIndex,
      })
        .from(bookings)
        .where(
          and(
            eq(bookings.itemId, id),
            eq(bookings.status, 'approved'),
            inArray(bookings.id, cancelIds)
          )
        );

      const cancelledPerSlot = new Map<string, number>();
      for (const row of cancelled) {
        const key = `${row.slotDate}|${row.slotIndex}`;
        cancelledPerSlot.set(key, (cancelledPerSlot.get(key) ?? 0) + 1);
      }

      const unresolved = conflicts.filter((conf) => {
        const freed = cancelledPerSlot.get(`${conf.slotDate}|${conf.slotIndex}`) ?? 0;
        return conf.count - freed > proposedQty;
      });

      if (unresolved.length > 0) {
        return c.json({
          error: 'Lowering quantity still leaves oversubscribed slots. Cancel more bookings first.',
          requiresResolution: true,
          conflicts: unresolved,
        }, 409);
      }

      await db.batch([
        db.update(bookings)
          .set({ status: 'cancelled', declineReason: 'Item quantity reduced', decidedBy: actor.id, decidedAt: new Date() })
          .where(and(eq(bookings.itemId, id), eq(bookings.status, 'approved'), inArray(bookings.id, cancelIds))),
        db.update(items).set(parsed.data).where(eq(items.id, id)),
      ]);
    } else {
      await db.update(items).set(parsed.data).where(eq(items.id, id));
    }
  } else {
    await db.update(items).set(parsed.data).where(eq(items.id, id));
  }

  // 2. Archive handling (Disabling an item)
  if (existingItem[0].active && !parsed.data.active) {
    // If active toggled to false, auto-decline all pending requests
    await db.update(bookings)
      .set({ 
        status: 'declined', 
        declineReason: 'Item is no longer available (archived).', 
        decidedBy: actor.id, 
        decidedAt: new Date() 
      })
      .where(
        and(
          eq(bookings.itemId, id),
          eq(bookings.status, 'pending')
        )
      );
  }

  // Log action
  await db.insert(auditLog).values({
    id: newId('aud'),
    actorId: actor.id,
    action: 'update_item',
    targetType: 'item',
    targetId: id,
    metaJson: JSON.stringify({ before: existingItem[0], after: parsed.data }),
    createdAt: new Date(),
  });

  return c.json({ success: true });
});

export default app;
