import { Hono } from 'hono';
import { getDb, Bindings, Variables } from '../db/client';
import { bookings, items, blackouts, users, auditLog } from '../db/schema';
import { bookingRequestSchema, blackoutSchema, decisionSchema } from '../../shared/schemas';
import { eq, and, or, sql, isNull, inArray, desc } from 'drizzle-orm';
import { pathParam, requireRole } from '../middleware';
import { canBookSlot, getKolkataDateString, getSlotStartUtc } from '../../shared/slots';
import { sendDecisionEmail } from '../notify';
import { newId } from '../ids';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * Send after the response. Notification failures must never break a booking,
 * and `executionCtx` is absent when the app is invoked directly (tests).
 */
function afterResponse(c: { executionCtx: { waitUntil(promise: Promise<unknown>): void } }, work: Promise<unknown>) {
  const swallowed = work.catch((err) => console.error('Deferred task failed:', err));
  try {
    c.executionCtx.waitUntil(swallowed);
  } catch {
    // No ExecutionContext — let it run unawaited.
  }
}

// A resident may hold at most this many slots on any one day. Counted per
// calendar day rather than as a rolling total, so a booking today never blocks
// one next week.
const BOOKINGS_PER_DAY_LIMIT = 5;

// --- Resident Route: Check Item Availability Grid ---
app.get('/availability/:itemId', async (c) => {
  const db = getDb(c.env.DB);
  const itemId = pathParam(c, 'itemId');
  const dateStr = c.req.query('date'); // 'YYYY-MM-DD'
  const user = c.get('user');

  if (!dateStr) {
    return c.json({ error: 'Date query parameter is required' }, 400);
  }

  const itemDetails = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (itemDetails.length === 0) {
    return c.json({ error: 'Item not found' }, 404);
  }
  const item = itemDetails[0];

  // Fetch approved bookings for the item on this date
  const approvedBookings = await db.select()
    .from(bookings)
    .where(
      and(
        eq(bookings.itemId, itemId),
        eq(bookings.slotDate, dateStr),
        eq(bookings.status, 'approved')
      )
    );

  // Fetch current user's bookings (pending / approved) for this item on this date
  const myBookings = user
    ? await db.select()
        .from(bookings)
        .where(
          and(
            eq(bookings.itemId, itemId),
            eq(bookings.slotDate, dateStr),
            eq(bookings.userId, user.id),
            inArray(bookings.status, ['pending', 'approved'])
          )
        )
    : [];

  // Fetch blackouts (global or item-specific) for this date
  const dayBlackouts = await db.select()
    .from(blackouts)
    .where(
      and(
        eq(blackouts.slotDate, dateStr),
        or(isNull(blackouts.itemId), eq(blackouts.itemId, itemId))
      )
    );

  const now = new Date();

  // Build grid data for the 18 slots (0 to 17)
  const grid = Array.from({ length: 18 }, (_, idx) => {
    // Check if slot index is within allowed hours for the item
    const isAllowedHours = idx >= item.earliestSlot && idx <= item.latestSlot;
    
    // Check if slot starts in the past or starts in next 5 minutes
    const isBookableTime = canBookSlot(dateStr, idx, now);

    // Find blackouts matching this slot index (or full day blackouts where slotIndex is null)
    const activeBlackout = dayBlackouts.find(
      b => b.slotIndex === null || b.slotIndex === idx
    );

    // Calculate approved count
    const slotApproved = approvedBookings.filter(b => b.slotIndex === idx);
    const bookedCount = slotApproved.length;
    const availableCount = Math.max(0, item.quantity - bookedCount);

    // Find my booking status
    const myBooking = myBookings.find(b => b.slotIndex === idx);
    
    let status: 'available' | 'full' | 'blackout' | 'past' | 'requested_by_me' | 'approved_for_me' | 'restricted_hours' = 'available';

    if (myBooking) {
      status = myBooking.status === 'approved' ? 'approved_for_me' : 'requested_by_me';
    } else if (activeBlackout) {
      status = 'blackout';
    } else if (!isAllowedHours) {
      status = 'restricted_hours';
    } else if (!isBookableTime) {
      status = 'past';
    } else if (availableCount <= 0) {
      status = 'full';
    }

    return {
      slotIndex: idx,
      status,
      capacity: item.quantity,
      bookedCount,
      availableCount,
      blackoutReason: activeBlackout ? activeBlackout.reason : null,
      bookingId: myBooking ? myBooking.id : null,
    };
  });

  return c.json({
    item,
    grid,
  });
});

// --- Resident Route: Request Booking (Atomic conditional inserts) ---
app.post('/request', async (c) => {
  const db = getDb(c.env.DB);
  const body = await c.req.json();
  const parsed = bookingRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid booking data', details: parsed.error.format() }, 400);
  }

  const user = c.get('user');
  const { itemId, slotDate, slotIndices, note } = parsed.data;

  // Retrieve item details
  const itemDetails = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (itemDetails.length === 0 || !itemDetails[0].active) {
    return c.json({ error: 'Item is not active or does not exist' }, 400);
  }
  const item = itemDetails[0];

  // 1. Enforce max slots per booking
  if (slotIndices.length > item.maxSlotsPerBooking) {
    return c.json({ error: `Cannot book more than ${item.maxSlotsPerBooking} consecutive slots at once.` }, 400);
  }

  // 2. Enforce earliest & latest slot indexes
  const outOfRange = slotIndices.some(idx => idx < item.earliestSlot || idx > item.latestSlot);
  if (outOfRange) {
    return c.json({ error: `Selected slot index is outside allowed booking hours for this item.` }, 400);
  }

  const now = new Date();

  // 3. Enforce advance days booking rule
  // Slot date must not exceed advanceDays into the future
  const maxAdvanceDateStr = getKolkataDateString(
    new Date(now.getTime() + item.advanceDays * 24 * 60 * 60 * 1000)
  );
  if (slotDate > maxAdvanceDateStr) {
    return c.json({ error: `Bookings can only be requested up to ${item.advanceDays} days in advance.` }, 400);
  }

  // 4. Enforce "Starts in next 5 minutes" check
  const invalidTime = slotIndices.some(idx => !canBookSlot(slotDate, idx, now));
  if (invalidTime) {
    return c.json({ error: `Cannot book slots that are in the past or start in the next 5 minutes.` }, 400);
  }

  // 5. Enforce the per-day cap across every item, not just this one.
  const sameDayCount = await db.select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(
      and(
        eq(bookings.userId, user.id),
        eq(bookings.slotDate, slotDate),
        inArray(bookings.status, ['pending', 'approved'])
      )
    );

  const alreadyHeld = sameDayCount[0].count;
  if (alreadyHeld + slotIndices.length > BOOKINGS_PER_DAY_LIMIT) {
    const remaining = Math.max(0, BOOKINGS_PER_DAY_LIMIT - alreadyHeld);
    return c.json({
      error: remaining === 0
        ? `You already have ${BOOKINGS_PER_DAY_LIMIT} slots on ${slotDate}. Cancel one to book another.`
        : `That would put you over ${BOOKINGS_PER_DAY_LIMIT} slots on ${slotDate}. You have ${remaining} left that day.`,
    }, 400);
  }

  // Check if user already has an active booking for this item at these slots
  const duplicates = await db.select()
    .from(bookings)
    .where(
      and(
        eq(bookings.itemId, itemId),
        eq(bookings.slotDate, slotDate),
        eq(bookings.userId, user.id),
        inArray(bookings.slotIndex, slotIndices),
        inArray(bookings.status, ['pending', 'approved'])
      )
    );
  
  if (duplicates.length > 0) {
    return c.json({ error: `You already have a pending or approved request for this slot.` }, 409);
  }

  // 6. Check for active blackouts in selected slots
  const activeBlackouts = await db.select()
    .from(blackouts)
    .where(
      and(
        eq(blackouts.slotDate, slotDate),
        or(isNull(blackouts.itemId), eq(blackouts.itemId, itemId)),
        or(isNull(blackouts.slotIndex), inArray(blackouts.slotIndex, slotIndices))
      )
    );
  if (activeBlackouts.length > 0) {
    return c.json({ error: `Selected slot is unavailable due to maintenance / blackout.` }, 400);
  }

  // Determine starting status
  const initialStatus = item.requiresApproval ? 'pending' : 'approved';
  const ids = slotIndices.map(() => newId('bkg'));
  const nowTimestamp = now.getTime();

  // Create conditional insert D1 statements
  const query = `
    INSERT INTO bookings (id, item_id, slot_date, slot_index, user_id, status, note, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (
      SELECT COUNT(*) FROM bookings
      WHERE item_id = ? AND slot_date = ? AND slot_index = ? AND status = 'approved'
    ) < (SELECT quantity FROM items WHERE id = ? AND active = 1);
  `;

  const statements = slotIndices.map((idx, i) => {
    return c.env.DB.prepare(query).bind(
      ids[i], itemId, slotDate, idx, user.id, initialStatus, note || null, nowTimestamp,
      itemId, slotDate, idx, itemId
    );
  });

  // Execute batch
  const batchResults = await c.env.DB.batch(statements);
  const allSucceeded = batchResults.every(r => r.meta.changes > 0);

  if (!allSucceeded) {
    // Clean up partial succeeds (atomic rollback simulated)
    const successfulIds = ids.filter((_, i) => batchResults[i].meta.changes > 0);
    if (successfulIds.length > 0) {
      await db.delete(bookings).where(inArray(bookings.id, successfulIds));
    }
    return c.json({ error: 'Conflict: Slot capacity became full. Please refresh availability.' }, 409);
  }

  return c.json({ success: true, status: initialStatus, ids });
});

// --- Resident Route: My Bookings (Upcoming and Past) ---
app.get('/my-bookings', async (c) => {
  const db = getDb(c.env.DB);
  const user = c.get('user');

  const list = await db.select({
    id: bookings.id,
    itemId: bookings.itemId,
    slotDate: bookings.slotDate,
    slotIndex: bookings.slotIndex,
    status: bookings.status,
    note: bookings.note,
    declineReason: bookings.declineReason,
    createdAt: bookings.createdAt,
    itemName: sql<string>`(select name from items where id = bookings.item_id)`,
    itemImageUrl: sql<string>`(select image_url from items where id = bookings.item_id)`
  })
  .from(bookings)
  .where(eq(bookings.userId, user.id))
  .orderBy(desc(bookings.slotDate), desc(bookings.slotIndex));

  return c.json(list);
});

// --- Resident Route: Cancel Booking ---
app.post('/:id/cancel', async (c) => {
  const db = getDb(c.env.DB);
  const id = pathParam(c, 'id');
  const user = c.get('user');

  const bDetails = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  if (bDetails.length === 0) {
    return c.json({ error: 'Booking not found' }, 404);
  }
  const booking = bDetails[0];

  // Restrict cancel of other users' bookings unless rep/admin
  const isRepOrAdmin = user.role === 'rep' || user.role === 'admin';
  if (booking.userId !== user.id && !isRepOrAdmin) {
    return c.json({ error: 'Forbidden: You do not own this booking.' }, 403);
  }

  // Ensure slot hasn't started yet
  const now = new Date();
  const slotStart = getSlotStartUtc(booking.slotDate, booking.slotIndex);
  if (slotStart <= now.getTime()) {
    return c.json({ error: 'Cannot cancel a booking once the slot has started.' }, 400);
  }

  // Check state
  if (booking.status === 'cancelled' || booking.status === 'declined') {
    return c.json({ error: 'Booking is already cancelled or declined.' }, 400);
  }

  await db.update(bookings)
    .set({
      status: 'cancelled',
      decidedBy: user.id,
      decidedAt: now,
      declineReason: booking.userId !== user.id ? 'Cancelled by representative' : 'Cancelled by resident'
    })
    .where(eq(bookings.id, id));

  // If rep cancelled it, send email notification
  if (booking.userId !== user.id) {
    const resident = await db.select().from(users).where(eq(users.id, booking.userId)).limit(1);
    const item = await db.select().from(items).where(eq(items.id, booking.itemId)).limit(1);
    
    if (resident.length > 0 && item.length > 0) {
      await sendDecisionEmail(c.env, {
        recipientEmail: resident[0].email,
        recipientName: resident[0].name,
        itemName: item[0].name,
        slotDate: booking.slotDate,
        slotIndices: [booking.slotIndex],
        status: 'cancelled',
        declineReason: 'Cancelled by representative',
        deciderName: user.name,
        actorId: user.id
      });
    }
  }

  // Log action
  await db.insert(auditLog).values({
    id: newId('aud'),
    actorId: user.id,
    action: 'cancel_booking',
    targetType: 'booking',
    targetId: id,
    metaJson: JSON.stringify({ cancelledBy: user.id }),
    createdAt: now,
  });

  return c.json({ success: true });
});

// --- Rep/Admin Route: Approval Queue ---
app.get('/manage/queue', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);

  // Group pending bookings
  const queue = await db.select({
    id: bookings.id,
    itemId: bookings.itemId,
    slotDate: bookings.slotDate,
    slotIndex: bookings.slotIndex,
    note: bookings.note,
    createdAt: bookings.createdAt,
    itemName: sql<string>`(select name from items where id = bookings.item_id)`,
    requesterName: sql<string>`(select name from users where id = bookings.user_id)`,
    requesterRoom: sql<string>`(select room_no from users where id = bookings.user_id)`
  })
  .from(bookings)
  .where(eq(bookings.status, 'pending'))
  .orderBy(bookings.createdAt);

  if (queue.length === 0) {
    return c.json([]);
  }

  // Competing-request counts, in two grouped queries rather than three per row.
  // A per-row loop costs 3 D1 subrequests each and blows the Workers subrequest
  // limit once the queue passes a couple of dozen entries.
  const itemIds = [...new Set(queue.map((req) => req.itemId))];

  const capacities = await db.select({ id: items.id, quantity: items.quantity })
    .from(items)
    .where(inArray(items.id, itemIds));
  const capacityByItem = new Map(capacities.map((row) => [row.id, row.quantity]));

  const slotCounts = await db.select({
    itemId: bookings.itemId,
    slotDate: bookings.slotDate,
    slotIndex: bookings.slotIndex,
    status: bookings.status,
    count: sql<number>`count(*)`,
  })
    .from(bookings)
    .where(
      and(
        inArray(bookings.itemId, itemIds),
        inArray(bookings.status, ['pending', 'approved'])
      )
    )
    .groupBy(bookings.itemId, bookings.slotDate, bookings.slotIndex, bookings.status);

  const slotKey = (itemId: string, slotDate: string, slotIndex: number, status: string) =>
    `${itemId}|${slotDate}|${slotIndex}|${status}`;
  const countBySlot = new Map(
    slotCounts.map((row) => [slotKey(row.itemId, row.slotDate, row.slotIndex, row.status), row.count])
  );

  const enrichedQueue = queue.map((req) => {
    const capacity = capacityByItem.get(req.itemId) ?? 0;
    const approved = countBySlot.get(slotKey(req.itemId, req.slotDate, req.slotIndex, 'approved')) ?? 0;
    const pendingCount = countBySlot.get(slotKey(req.itemId, req.slotDate, req.slotIndex, 'pending')) ?? 0;

    return {
      ...req,
      capacity,
      approvedCount: approved,
      pendingCount,
      availableCount: Math.max(0, capacity - approved),
    };
  });

  return c.json(enrichedQueue);
});

// --- Rep/Admin Route: Approve/Decline Bookings ---
app.post('/manage/decide', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);
  const actor = c.get('user');
  const parsed = decisionSchema.safeParse(await c.req.json());

  if (!parsed.success) {
    return c.json({ error: 'Invalid decision payload', details: parsed.error.format() }, 400);
  }
  const { bookingId, decision, declineReason } = parsed.data;

  const bDetails = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (bDetails.length === 0) {
    return c.json({ error: 'Booking not found' }, 404);
  }
  const booking = bDetails[0];

  if (booking.status !== 'pending') {
    return c.json({ error: 'Booking is already decided or cancelled.' }, 400);
  }

  const now = new Date();

  if (decision === 'declined') {
    // Decline is straightforward
    await db.update(bookings)
      .set({
        status: 'declined',
        declineReason: declineReason || 'Declined by representative',
        decidedBy: actor.id,
        decidedAt: now
      })
      .where(eq(bookings.id, bookingId));

    // Send decline email
    const resident = await db.select().from(users).where(eq(users.id, booking.userId)).limit(1);
    const item = await db.select().from(items).where(eq(items.id, booking.itemId)).limit(1);
    if (resident.length > 0 && item.length > 0) {
      await sendDecisionEmail(c.env, {
        recipientEmail: resident[0].email,
        recipientName: resident[0].name,
        itemName: item[0].name,
        slotDate: booking.slotDate,
        slotIndices: [booking.slotIndex],
        status: 'declined',
        declineReason: declineReason || 'Declined by representative',
        deciderName: actor.name,
        actorId: actor.id
      });
    }

    return c.json({ success: true, status: 'declined' });
  }

  // Decision === 'approved' -> Enforce Capacity Conditional Update
  // The counting subquery MUST alias its own copy of `bookings`; an unaliased
  // `FROM bookings` shadows the UPDATE target and the correlation silently
  // degrades into `item_id = item_id`.
  const updateQuery = `
    UPDATE bookings
    SET status = 'approved', decided_by = ?, decided_at = ?
    WHERE id = ? AND status = 'pending' AND (
      SELECT COUNT(*) FROM bookings AS taken
      WHERE taken.item_id = bookings.item_id
        AND taken.slot_date = bookings.slot_date
        AND taken.slot_index = bookings.slot_index
        AND taken.status = 'approved'
    ) < (SELECT quantity FROM items WHERE id = bookings.item_id AND active = 1);
  `;

  const stmt = c.env.DB.prepare(updateQuery).bind(actor.id, now.getTime(), bookingId);
  const result = await stmt.run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'Conflict: Slot capacity has filled up.' }, 409);
  }

  // Get details for email and auto-decline calculations
  const resident = await db.select().from(users).where(eq(users.id, booking.userId)).limit(1);
  const itemDetails = await db.select().from(items).where(eq(items.id, booking.itemId)).limit(1);
  const item = itemDetails[0];

  // Send approval email
  if (resident.length > 0) {
    await sendDecisionEmail(c.env, {
      recipientEmail: resident[0].email,
      recipientName: resident[0].name,
      itemName: item.name,
      slotDate: booking.slotDate,
      slotIndices: [booking.slotIndex],
      status: 'approved',
      deciderName: actor.name,
      actorId: actor.id
    });
  }

  // Check if slot is now full -> Auto-decline other pending requests for this slot
  const approvedCountResult = await db.select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(
      and(
        eq(bookings.itemId, booking.itemId),
        eq(bookings.slotDate, booking.slotDate),
        eq(bookings.slotIndex, booking.slotIndex),
        eq(bookings.status, 'approved')
      )
    );

  const approvedCount = approvedCountResult[0].count;
  
  if (approvedCount >= item.quantity) {
    const pendingOthers = await db.select()
      .from(bookings)
      .where(
        and(
          eq(bookings.itemId, booking.itemId),
          eq(bookings.slotDate, booking.slotDate),
          eq(bookings.slotIndex, booking.slotIndex),
          eq(bookings.status, 'pending')
        )
      );

    if (pendingOthers.length > 0) {
      await db.update(bookings)
        .set({
          status: 'declined',
          declineReason: 'Slot filled',
          decidedBy: actor.id,
          decidedAt: now
        })
        .where(
          and(
            eq(bookings.itemId, booking.itemId),
            eq(bookings.slotDate, booking.slotDate),
            eq(bookings.slotIndex, booking.slotIndex),
            eq(bookings.status, 'pending')
          )
        );

      // Notify auto-declined users. One lookup for everyone, and the sends run
      // after the response so a slow mail provider never delays the rep.
      const recipients = await db.select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(inArray(users.id, [...new Set(pendingOthers.map((o) => o.userId))]));
      const recipientById = new Map(recipients.map((r) => [r.id, r]));

      for (const other of pendingOthers) {
        const recipient = recipientById.get(other.userId);
        if (!recipient) continue;
        afterResponse(c,
          sendDecisionEmail(c.env, {
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            itemName: item.name,
            slotDate: other.slotDate,
            slotIndices: [other.slotIndex],
            status: 'declined',
            declineReason: 'Slot filled',
            deciderName: actor.name,
            actorId: actor.id
          })
        );
      }
    }
  }

  // Log action
  await db.insert(auditLog).values({
    id: newId('aud'),
    actorId: actor.id,
    action: 'approve_booking',
    targetType: 'booking',
    targetId: bookingId,
    metaJson: JSON.stringify({ itemId: booking.itemId, date: booking.slotDate, slot: booking.slotIndex }),
    createdAt: now,
  });

  return c.json({ success: true, status: 'approved' });
});

// --- Rep/Admin Route: Today View (Approved items in chronological order) ---
app.get('/manage/today', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);
  const todayStr = getKolkataDateString();

  const list = await db.select({
    id: bookings.id,
    slotIndex: bookings.slotIndex,
    note: bookings.note,
    userName: sql<string>`(select name from users where id = bookings.user_id)`,
    roomNo: sql<string>`(select room_no from users where id = bookings.user_id)`,
    itemName: sql<string>`(select name from items where id = bookings.item_id)`,
    status: bookings.status
  })
  .from(bookings)
  .where(
    and(
      eq(bookings.slotDate, todayStr),
      eq(bookings.status, 'approved')
    )
  )
  .orderBy(bookings.slotIndex);

  return c.json(list);
});

// --- Rep/Admin Route: Mark No Show ---
app.post('/:id/no-show', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);
  const id = pathParam(c, 'id');
  const actor = c.get('user');

  const bDetails = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  if (bDetails.length === 0) {
    return c.json({ error: 'Booking not found' }, 404);
  }

  await db.update(bookings)
    .set({
      status: 'no_show',
      decidedBy: actor.id,
      decidedAt: new Date()
    })
    .where(eq(bookings.id, id));

  // Log action
  await db.insert(auditLog).values({
    id: newId('aud'),
    actorId: actor.id,
    action: 'mark_no_show',
    targetType: 'booking',
    targetId: id,
    createdAt: new Date()
  });

  return c.json({ success: true });
});

// --- Rep/Admin Route: Manage Blackouts ---
app.get('/manage/blackouts', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);
  
  const list = await db.select({
    id: blackouts.id,
    slotDate: blackouts.slotDate,
    slotIndex: blackouts.slotIndex,
    reason: blackouts.reason,
    itemName: sql<string>`(select name from items where id = blackouts.item_id)`
  })
  .from(blackouts)
  .orderBy(desc(blackouts.slotDate));

  return c.json(list);
});

app.post('/manage/blackouts', requireRole('rep', 'admin'), async (c) => {
  const db = getDb(c.env.DB);
  const body = await c.req.json();
  const parsed = blackoutSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid blackout inputs', details: parsed.error.format() }, 400);
  }

  const { itemId, slotDate, slotIndex, reason } = parsed.data;
  const blackoutId = newId('blk');

  // Insert blackout
  await db.insert(blackouts).values({
    id: blackoutId,
    itemId: itemId || null,
    slotDate,
    slotIndex: slotIndex === undefined ? null : slotIndex,
    reason,
  });

  // Cancel conflicting bookings (both pending and approved)
  const actor = c.get('user');
  let conflictConditions = [
    eq(bookings.slotDate, slotDate),
    inArray(bookings.status, ['pending', 'approved'])
  ];

  if (itemId) {
    conflictConditions.push(eq(bookings.itemId, itemId));
  }
  if (slotIndex !== undefined && slotIndex !== null) {
    conflictConditions.push(eq(bookings.slotIndex, slotIndex));
  }

  const conflictingBookings = await db.select()
    .from(bookings)
    .where(and(...conflictConditions));

  if (conflictingBookings.length > 0) {
    const cancelReason = `Blackout created: ${reason}`;
    
    // Perform cancels/declines
    await db.update(bookings)
      .set({
        status: 'cancelled',
        declineReason: cancelReason,
        decidedBy: actor.id,
        decidedAt: new Date()
      })
      .where(and(...conflictConditions));

    // Notify users. A global full-day blackout can touch every booking that
    // day, so batch the lookups instead of two queries per affected booking.
    const affectedUsers = await db.select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(inArray(users.id, [...new Set(conflictingBookings.map((b) => b.userId))]));
    const userById = new Map(affectedUsers.map((u) => [u.id, u]));

    const affectedItems = await db.select({ id: items.id, name: items.name })
      .from(items)
      .where(inArray(items.id, [...new Set(conflictingBookings.map((b) => b.itemId))]));
    const itemById = new Map(affectedItems.map((i) => [i.id, i]));

    for (const b of conflictingBookings) {
      const recipient = userById.get(b.userId);
      const itm = itemById.get(b.itemId);
      if (!recipient || !itm) continue;
      afterResponse(c,
        sendDecisionEmail(c.env, {
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          itemName: itm.name,
          slotDate: b.slotDate,
          slotIndices: [b.slotIndex],
          status: 'cancelled',
          declineReason: cancelReason,
          deciderName: actor.name,
          actorId: actor.id
        })
      );
    }
  }

  // Log action
  await db.insert(auditLog).values({
    id: newId('aud'),
    actorId: actor.id,
    action: 'create_blackout',
    targetType: 'blackout',
    targetId: blackoutId,
    metaJson: JSON.stringify(parsed.data),
    createdAt: new Date(),
  });

  return c.json({ success: true, conflictsCancelledCount: conflictingBookings.length });
});

export default app;
