import { Hono } from 'hono';
import { getDb, Bindings, Variables } from '../db/client';
import { users, auditLog } from '../db/schema';
import { z } from 'zod';
import { userImportSchema, userUpdateSchema, bulkAddPeopleSchema } from '../../shared/schemas';
import { eq, and, sql, like, or } from 'drizzle-orm';
import { pathParam, requireRole } from '../middleware';
import { newId } from '../ids';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// All routes here are restricted to Rep / Admin, and User changes are Admin-only
app.use('/*', requireRole('rep', 'admin'));

// --- List, search and filter the people in the hostel ---
app.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const search = c.req.query('search') || '';
  const role = c.req.query('role') || '';
  const status = c.req.query('status') || ''; // 'active' | 'disabled'

  const conditions = [];

  if (search) {
    conditions.push(
      or(
        like(users.name, `%${search}%`),
        like(users.email, `%${search}%`),
        like(users.roomNo, `%${search}%`)
      )
    );
  }

  const roleFilter = z.enum(['resident', 'rep', 'admin']).safeParse(role);
  if (roleFilter.success) {
    conditions.push(eq(users.role, roleFilter.data));
  }

  if (status) {
    conditions.push(eq(users.disabled, status === 'disabled'));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const list = await db.select().from(users).where(whereClause).orderBy(users.name);

  return c.json(list);
});

// --- Add one person ---
app.post('/', requireRole('admin'), async (c) => {
  const db = getDb(c.env.DB);
  const body = await c.req.json();
  const parsed = userImportSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid user data', details: parsed.error.format() }, 400);
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing.length > 0) {
    return c.json({ error: 'Someone with that email is already in the hostel.' }, 409);
  }

  const id = newId('usr');
  const now = new Date();
  await db.insert(users).values({
    id,
    email,
    name: parsed.data.name,
    role: parsed.data.role,
    roomNo: parsed.data.roomNo,
    disabled: false,
    createdAt: now,
    updatedAt: now,
  });

  // Log action
  const actor = c.get('user');
  await db.insert(auditLog).values({
    id: newId('aud'),
    actorId: actor.id,
    action: 'add_user',
    targetType: 'user',
    targetId: id,
    metaJson: JSON.stringify(parsed.data),
    createdAt: now,
  });

  return c.json({ success: true, id });
});

// --- Update a person's details and role (admin only) ---
app.put('/:id', requireRole('admin'), async (c) => {
  const db = getDb(c.env.DB);
  const id = pathParam(c, 'id');
  const body = await c.req.json();
  const parsed = userUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid update parameters', details: parsed.error.format() }, 400);
  }

  const targetUser = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (targetUser.length === 0) {
    return c.json({ error: 'User not found' }, 404);
  }

  const actor = c.get('user');

  // Guard: Avoid removing the last active Admin
  if (targetUser[0].role === 'admin' && (parsed.data.role !== 'admin' || parsed.data.disabled)) {
    const adminCount = await db.select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.disabled, false)));

    if (adminCount[0].count <= 1) {
      return c.json({ error: 'Action blocked: This is the last active Administrator. Promote another administrator first.' }, 400);
    }
  }

  const now = new Date();
  await db.update(users)
    .set({
      role: parsed.data.role,
      roomNo: parsed.data.roomNo,
      disabled: parsed.data.disabled,
      updatedAt: now,
    })
    .where(eq(users.id, id));

  // Log action
  await db.insert(auditLog).values({
    id: newId('aud'),
    actorId: actor.id,
    action: parsed.data.disabled ? 'disable_user' : 'update_user',
    targetType: 'user',
    targetId: id,
    metaJson: JSON.stringify({ before: targetUser[0], after: parsed.data }),
    createdAt: now,
  });

  return c.json({ success: true });
});

// --- Bulk add: preview ---
app.post('/import/preview', requireRole('admin'), async (c) => {
  const db = getDb(c.env.DB);
  const { csvText } = await c.req.json();

  if (!csvText || typeof csvText !== 'string') {
    return c.json({ error: 'Pasted CSV text is required' }, 400);
  }

  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return c.json({ error: 'CSV text is empty' }, 400);
  }

  // Parse lines: handles headers if present
  let dataLines = lines;
  const firstLine = lines[0].toLowerCase();
  if (firstLine.includes('email') || firstLine.includes('name') || firstLine.includes('room')) {
    dataLines = lines.slice(1);
  }

  const parsedUsers: { email: string; name: string; roomNo: string; error?: string }[] = [];
  
  for (const line of dataLines) {
    const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 3) continue;
    const [email, name, roomNo] = parts;
    const emailLower = email.toLowerCase();

    // Verify email format
    const emailCheck = z.string().email().safeParse(emailLower);
    if (!emailCheck.success) {
      parsedUsers.push({ email, name, roomNo, error: 'Invalid email address format' });
      continue;
    }

    parsedUsers.push({ email: emailLower, name, roomNo });
  }

  // Compare against DB to find adds, skips, and conflicts
  const adds: typeof parsedUsers = [];
  const skips: typeof parsedUsers = [];
  const conflicts: (typeof parsedUsers[0] & { existingName: string; existingRoom: string })[] = [];

  for (const item of parsedUsers) {
    if (item.error) continue;

    const existing = await db.select().from(users).where(eq(users.email, item.email)).limit(1);
    if (existing.length === 0) {
      adds.push(item);
    } else {
      const u = existing[0];
      if (u.name === item.name && u.roomNo === item.roomNo) {
        skips.push(item);
      } else {
        conflicts.push({
          ...item,
          existingName: u.name,
          existingRoom: u.roomNo || '',
        });
      }
    }
  }

  return c.json({
    adds,
    skips,
    conflicts,
    errors: parsedUsers.filter(u => u.error)
  });
});

// --- Bulk add: confirm ---
app.post('/import/confirm', requireRole('admin'), async (c) => {
  const db = getDb(c.env.DB);
  const parsed = bulkAddPeopleSchema.safeParse(await c.req.json());

  if (!parsed.success) {
    return c.json({ error: 'Invalid import payload', details: parsed.error.format() }, 400);
  }
  const { items } = parsed.data;

  const now = new Date();
  const actor = c.get('user');
  
  // Use Hono batch operations on D1 for efficiency
  const batchStatements = [];

  for (const u of items) {
    const email = u.email;
    const id = newId('usr');
    
    // SQLite upsert block: update name/room, or insert new
    // This resolves conflicts and adds new users
    batchStatements.push(
      db.insert(users)
        .values({
          id,
          email,
          name: u.name,
          roomNo: u.roomNo,
          role: 'resident',
          disabled: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: users.email,
          set: {
            name: u.name,
            roomNo: u.roomNo,
            updatedAt: now
          }
        })
    );
  }

  await db.batch(batchStatements as any);

  // Log action
  await db.insert(auditLog).values({
    id: newId('aud'),
    actorId: actor.id,
    action: 'bulk_import_users',
    targetType: 'user',
    targetId: 'multiple',
    metaJson: JSON.stringify({ count: items.length }),
    createdAt: now,
  });

  return c.json({ success: true, count: items.length });
});

// --- Audit Log Viewer (Rep & Admin) ---
app.get('/audit', async (c) => {
  const db = getDb(c.env.DB);
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  
  const logs = await db.select({
    id: auditLog.id,
    action: auditLog.action,
    targetType: auditLog.targetType,
    targetId: auditLog.targetId,
    metaJson: auditLog.metaJson,
    createdAt: auditLog.createdAt,
    actorName: sql<string>`(select name from users where id = audit_log.actor_id)`,
    actorEmail: sql<string>`(select email from users where id = audit_log.actor_id)`
  })
  .from(auditLog)
  .orderBy(sql`audit_log.created_at desc`)
  .limit(limit);

  return c.json(logs);
});

export default app;
