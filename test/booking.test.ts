import { env } from 'cloudflare:test';
import { describe, expect, it, beforeEach } from 'vitest';
// Workers have no fs, so the migration is inlined at build time by Vite.
import migrationSql from '../migrations/0000_init_schema.sql?raw';
import verificationsSql from '../migrations/0001_add_verifications.sql?raw';
import accountColumnsSql from '../migrations/0002_account_oauth_columns.sql?raw';
import { getDb } from '../src/server/db/client';
import * as schema from '../src/server/db/schema';
import { getAuth } from '../src/server/auth';
import app from '../src/server/index';
import { eq, and } from 'drizzle-orm';
import { getKolkataDateString, getSlotStartUtc } from '../src/shared/slots';

/**
 * Slot dates must be relative. Every seeded item has advance_days = 7, so a
 * hardcoded far-future date is rejected before the rule under test is reached
 * — and it rots the moment the date passes.
 */
function daysAhead(n: number): string {
  return getKolkataDateString(new Date(Date.now() + n * 24 * 60 * 60 * 1000));
}

// Helper to initialize database schema
async function setupDatabase() {
  // D1's exec() requires one statement per line, so run them individually.
  const statements = [migrationSql, verificationsSql, accountColumnsSql]
    .join('\n')
    // Strip comments first — a `;` inside one would split a statement in half.
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((stmt) => stmt.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
}

async function seedData() {
  const db = getDb(env.DB);
  const now = new Date();
  const nowMs = now.getTime();

  // Seed Users
  await db.insert(schema.users).values([
    { id: 'usr_admin', email: 'admin@college.edu', name: 'Admin User', role: 'admin', disabled: false, createdAt: now, updatedAt: now },
    { id: 'usr_rep', email: 'rep@college.edu', name: 'Rep User', role: 'rep', disabled: false, createdAt: now, updatedAt: now },
    { id: 'usr_res1', email: 'res1@college.edu', name: 'Resident One', role: 'resident', disabled: false, createdAt: now, updatedAt: now },
    { id: 'usr_res2', email: 'res2@college.edu', name: 'Resident Two', role: 'resident', disabled: false, createdAt: now, updatedAt: now },
    { id: 'usr_res3', email: 'res3@college.edu', name: 'Resident Three', role: 'resident', disabled: false, createdAt: now, updatedAt: now },
    { id: 'usr_res4', email: 'res4@college.edu', name: 'Resident Four', role: 'resident', disabled: false, createdAt: now, updatedAt: now },
    { id: 'usr_disabled', email: 'disabled@college.edu', name: 'Disabled User', role: 'resident', disabled: true, createdAt: now, updatedAt: now },
  ]);

  // Extra residents: the capacity race needs quantity + 3 *distinct* users,
  // because one person cannot hold two copies of an item in the same hour.
  // Kept as a second insert — D1 caps a statement at 100 bound variables.
  await db.insert(schema.users).values(
    Array.from({ length: 6 }, (_, i) => ({
      id: `usr_res${i + 5}`,
      email: `res${i + 5}@college.edu`,
      name: `Resident ${i + 5}`,
      role: 'resident' as const,
      disabled: false,
      createdAt: now,
      updatedAt: now,
    }))
  );

  // Seed Sessions
  await db.insert(schema.sessions).values([
    { id: 's_admin', userId: 'usr_admin', token: 'token_admin', expiresAt: new Date(nowMs + 86400000), createdAt: now, updatedAt: now },
    { id: 's_rep', userId: 'usr_rep', token: 'token_rep', expiresAt: new Date(nowMs + 86400000), createdAt: now, updatedAt: now },
    { id: 's_res1', userId: 'usr_res1', token: 'token_res1', expiresAt: new Date(nowMs + 86400000), createdAt: now, updatedAt: now },
    { id: 's_res2', userId: 'usr_res2', token: 'token_res2', expiresAt: new Date(nowMs + 86400000), createdAt: now, updatedAt: now },
    { id: 's_disabled', userId: 'usr_disabled', token: 'token_disabled', expiresAt: new Date(nowMs + 86400000), createdAt: now, updatedAt: now },
    { id: 's_res3', userId: 'usr_res3', token: 'token_res3', expiresAt: new Date(nowMs + 86400000), createdAt: now, updatedAt: now },
  ]);

  // Seed Categories
  await db.insert(schema.categories).values([
    { id: 'cat_1', name: 'Racquet Sports', sortOrder: 1 },
  ]);

  // Seed Items
  await db.insert(schema.items).values([
    { id: 'itm_singleqty', categoryId: 'cat_1', name: 'Badminton Court', quantity: 1, active: true, requiresApproval: true, maxSlotsPerBooking: 2, earliestSlot: 0, latestSlot: 17, advanceDays: 7, sortOrder: 1, createdAt: now },
    { id: 'itm_multiqty', categoryId: 'cat_1', name: 'Table Tennis paddles', quantity: 4, active: true, requiresApproval: true, maxSlotsPerBooking: 2, earliestSlot: 0, latestSlot: 17, advanceDays: 7, sortOrder: 2, createdAt: now },
    { id: 'itm_autoapprove', categoryId: 'cat_1', name: 'Chess Set', quantity: 1, active: true, requiresApproval: false, maxSlotsPerBooking: 2, earliestSlot: 0, latestSlot: 17, advanceDays: 7, sortOrder: 3, createdAt: now },
  ]);
}


/**
 * Better Auth authenticates with a signed cookie, not a bearer token. The
 * cookie value is `<session token>.<base64 HMAC-SHA256 of the token>`.
 * Signed once per run so tests can build headers synchronously.
 */
const signedCookies = new Map<string, string>();

async function signSessionCookies(tokens: string[]) {
  const secret = (env as unknown as { BETTER_AUTH_SECRET: string }).BETTER_AUTH_SECRET;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  for (const token of tokens) {
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
    const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)));
    signedCookies.set(token, `better-auth.session_token=${encodeURIComponent(`${token}.${encoded}`)}`);
  }
}

function authHeaders(token: string, extra: Record<string, string> = {}) {
  const cookie = signedCookies.get(token);
  if (!cookie) throw new Error(`No signed cookie for ${token}`);
  return { Cookie: cookie, ...extra };
}

describe('Hostel Booking Portal E2E Tests', () => {
  beforeEach(async () => {
    await setupDatabase();
    await seedData();
    await signSessionCookies([
      'token_admin',
      'token_rep',
      'token_res1',
      'token_res2',
      'token_res3',
      'token_disabled',
    ]);
  });

  // Test 1: Capacity race condition - quantity=1 and quantity=4
  it('Test 1: Capacity race condition — quantity=1 and quantity=4', async () => {
    const db = getDb(env.DB);
    const dateStr = daysAhead(3);
    const slotIdx = 10;

    // --- Scenario A: Quantity = 1 ---
    // Seed 4 pending bookings for the same slot
    const b1 = 'bkg_q1_a';
    const b2 = 'bkg_q1_b';
    const b3 = 'bkg_q1_c';
    const b4 = 'bkg_q1_d';

    const now = new Date();
    await db.insert(schema.bookings).values([
      { id: b1, itemId: 'itm_singleqty', slotDate: dateStr, slotIndex: slotIdx, userId: 'usr_res1', status: 'pending', createdAt: now },
      { id: b2, itemId: 'itm_singleqty', slotDate: dateStr, slotIndex: slotIdx, userId: 'usr_res2', status: 'pending', createdAt: now },
      { id: b3, itemId: 'itm_singleqty', slotDate: dateStr, slotIndex: slotIdx, userId: 'usr_res3', status: 'pending', createdAt: now },
      { id: b4, itemId: 'itm_singleqty', slotDate: dateStr, slotIndex: slotIdx, userId: 'usr_res4', status: 'pending', createdAt: now },
    ]);

    // Fire 4 concurrent approvals
    const promisesQ1 = [b1, b2, b3, b4].map(bId => 
      app.request('/api/bookings/manage/decide', {
        method: 'POST',
        headers: authHeaders('token_rep', { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ bookingId: bId, decision: 'approved' })
      }, env)
    );

    const responsesQ1 = await Promise.all(promisesQ1);
    const statusesQ1 = responsesQ1.map(r => r.status);
    
    // Exactly 1 must return 200/success (since quantity = 1), and 3 must fail with 409
    const successesQ1 = statusesQ1.filter(s => s === 200).length;
    const conflictsQ1 = statusesQ1.filter(s => s === 409).length;

    expect(successesQ1).toBe(1);
    expect(conflictsQ1).toBe(3);

    // --- Scenario B: Quantity = 4 ---
    // Seed 7 pending bookings for the same slot
    const idsQ4 = Array.from({ length: 7 }, (_, i) => `bkg_q4_${i}`);
    await db.insert(schema.bookings).values(
      idsQ4.map((id, i) => ({
        id,
        itemId: 'itm_multiqty',
        slotDate: dateStr,
        slotIndex: slotIdx,
        userId: `usr_res${i + 4}`,
        status: 'pending' as const,
        createdAt: now
      }))
    );

    // Fire 7 concurrent approvals
    const promisesQ4 = idsQ4.map(bId =>
      app.request('/api/bookings/manage/decide', {
        method: 'POST',
        headers: authHeaders('token_rep', { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ bookingId: bId, decision: 'approved' })
      }, env)
    );

    const responsesQ4 = await Promise.all(promisesQ4);
    const statusesQ4 = responsesQ4.map(r => r.status);

    const successesQ4 = statusesQ4.filter(s => s === 200).length;
    const conflictsQ4 = statusesQ4.filter(s => s === 409).length;

    expect(successesQ4).toBe(4);
    expect(conflictsQ4).toBe(3);
  });

  // Test 2: Sign-in with email not on roster
  it('Test 2: Sign-in with email not on roster returns 403', async () => {
    const auth = getAuth(env.DB, env);
    const beforeHook = auth.options.databaseHooks?.user?.create?.before;
    expect(beforeHook).toBeDefined();

    if (beforeHook) {
      await expect(
        beforeHook({
          email: 'alien@college.edu',
          name: 'Alien User',
          emailVerified: true,
          id: 'test-id',
          createdAt: new Date(),
          updatedAt: new Date()
        } as any)
      ).rejects.toThrow();
    }
  });

  // Test 3: Sign-in with disabled user is rejected
  it('Test 3: Sign-in with disabled user is rejected', async () => {
    const auth = getAuth(env.DB, env);
    
    // Test user create before hook
    const beforeUserHook = auth.options.databaseHooks?.user?.create?.before;
    if (beforeUserHook) {
      await expect(
        beforeUserHook({
          email: 'disabled@college.edu',
          name: 'Disabled User',
          emailVerified: true,
          id: 'test-id',
          createdAt: new Date(),
          updatedAt: new Date()
        } as any)
      ).rejects.toThrow();
    }

    // Test session create before hook
    const beforeSessionHook = auth.options.databaseHooks?.session?.create?.before;
    if (beforeSessionHook) {
      await expect(
        beforeSessionHook({
          userId: 'usr_disabled',
        } as any)
      ).rejects.toThrow();
    }
  });

  // Test 4: Resident cannot cancel or manage another resident's booking
  it("Test 4: A resident cannot cancel another resident's booking", async () => {
    const db = getDb(env.DB);
    const bId = 'bkg_other_user';
    await db.insert(schema.bookings).values({
      id: bId,
      itemId: 'itm_singleqty',
      slotDate: daysAhead(3),
      slotIndex: 12,
      userId: 'usr_res2', // owned by resident 2
      status: 'approved',
      createdAt: new Date()
    });

    // Resident 1 tries to cancel Resident 2's booking
    const res = await app.request(`/api/bookings/${bId}/cancel`, {
      method: 'POST',
      headers: authHeaders('token_res1')
    }, env);

    expect(res.status).toBe(403);
  });

  // Test 5: Resident hitting manage routes gets 403
  it('Test 5: A resident hitting management routes gets 403', async () => {
    const res = await app.request('/api/bookings/manage/queue', {
      method: 'GET',
      headers: authHeaders('token_res1')
    }, env);
    expect(res.status).toBe(403);

    const res2 = await app.request('/api/users/', {
      method: 'GET',
      headers: authHeaders('token_res1')
    }, env);
    expect(res2.status).toBe(403);
  });

  // Test 6: Approving the last copy auto-declines other pending requests
  it('Test 6: Approving last free copy auto-declines competing requests', async () => {
    const db = getDb(env.DB);
    const dateStr = daysAhead(3);
    const slotIdx = 9;

    const b1 = 'b1_compete';
    const b2 = 'b2_compete';

    await db.insert(schema.bookings).values([
      { id: b1, itemId: 'itm_singleqty', slotDate: dateStr, slotIndex: slotIdx, userId: 'usr_res1', status: 'pending', createdAt: new Date() },
      { id: b2, itemId: 'itm_singleqty', slotDate: dateStr, slotIndex: slotIdx, userId: 'usr_res2', status: 'pending', createdAt: new Date() }
    ]);

    // Approve booking 1
    const res = await app.request('/api/bookings/manage/decide', {
      method: 'POST',
      headers: authHeaders('token_rep', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ bookingId: b1, decision: 'approved' })
    }, env);

    expect(res.status).toBe(200);

    // Verify booking 2 is now auto-declined
    const b2Row = await db.select().from(schema.bookings).where(eq(schema.bookings.id, b2)).limit(1);
    expect(b2Row[0].status).toBe('declined');
    expect(b2Row[0].declineReason).toBe('Slot filled');
  });

  // Test 7: Auto-approve item books instantly and respects capacity under concurrency
  it('Test 7: Auto-approve item books instantly and respects capacity', async () => {
    // 1. Books instantly
    const res = await app.request('/api/bookings/request', {
      method: 'POST',
      headers: authHeaders('token_res1', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        itemId: 'itm_autoapprove',
        slotDate: daysAhead(3),
        slotIndices: [14],
        note: 'Auto approve instant test'
      })
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('approved');

    // 2. Respects capacity under concurrency (itm_autoapprove quantity = 1)
    // Fire 3 concurrent booking requests for another slot (slot 15)
    const promises = Array.from({ length: 3 }, (_, i) => 
      app.request('/api/bookings/request', {
        method: 'POST',
        headers: authHeaders(`token_res${i + 1}`, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          itemId: 'itm_autoapprove',
          slotDate: daysAhead(3),
          slotIndices: [15],
        })
      }, env)
    );

    const responses = await Promise.all(promises);
    const statuses = responses.map(r => r.status);
    
    expect(statuses.filter(s => s === 200).length).toBe(1);
    expect(statuses.filter(s => s === 409).length).toBe(2);
  });

  // Test 8: Reducing quantity below existing approved bookings is blocked
  it('Test 8: Lowering item quantity below future approved bookings is blocked', async () => {
    const db = getDb(env.DB);
    const dateStr = daysAhead(3);
    
    // Seed two approved bookings for itm_multiqty (original quantity = 4)
    await db.insert(schema.bookings).values([
      { id: 'b_multi_1', itemId: 'itm_multiqty', slotDate: dateStr, slotIndex: 5, userId: 'usr_res1', status: 'approved', createdAt: new Date() },
      { id: 'b_multi_2', itemId: 'itm_multiqty', slotDate: dateStr, slotIndex: 5, userId: 'usr_res2', status: 'approved', createdAt: new Date() },
    ]);

    // Try to reduce quantity of itm_multiqty to 1 (lower than 2 approved slots)
    const res = await app.request('/api/items/itm_multiqty', {
      method: 'PUT',
      headers: authHeaders('token_rep', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        categoryId: 'cat_1',
        name: 'Table Tennis paddles',
        quantity: 1, // Change to 1
        active: true,
        requiresApproval: true,
        maxSlotsPerBooking: 2,
        earliestSlot: 0,
        latestSlot: 17,
        advanceDays: 7
      })
    }, env);

    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.requiresResolution).toBe(true);
  });

  // Test 9: Failing Resend call does not fail approval
  it('Test 9: Resend email failures are caught and logged, not aborting approval', async () => {
    // Enable emails
    const customEnv = {
      ...env,
      NOTIFY_ENABLED: 'true',
      RESEND_API_KEY: 'test-api-key',
    };

    // Mock global fetch to fail on Resend
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.toString().includes('resend.com')) {
        return new Response('Mock error', { status: 500 });
      }
      return originalFetch(url);
    };

    const db = getDb(env.DB);
    const bId = 'bkg_email_fail';
    await db.insert(schema.bookings).values({
      id: bId,
      itemId: 'itm_singleqty',
      slotDate: daysAhead(3),
      slotIndex: 11,
      userId: 'usr_res1',
      status: 'pending',
      createdAt: new Date()
    });

    // Approve booking
    const res = await app.request('/api/bookings/manage/decide', {
      method: 'POST',
      headers: authHeaders('token_rep', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ bookingId: bId, decision: 'approved' })
    }, customEnv);

    // The endpoint must succeed with 200
    expect(res.status).toBe(200);

    // Assert that the database contains an email failure in audit log
    const auditLogs = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'email_failure'));
    expect(auditLogs.length).toBe(1);
    
    // Restore fetch
    globalThis.fetch = originalFetch;
  });

  // Test 10: Slot rule enforcement
  it('Test 10: Slot rule validation enforcement', async () => {
    // 10a. Outside item allowed hours (Allowed: 0 to 17, try slot index 18)
    const resHours = await app.request('/api/bookings/request', {
      method: 'POST',
      headers: authHeaders('token_res1', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        itemId: 'itm_singleqty',
        slotDate: daysAhead(3),
        slotIndices: [18], // Out of range
      })
    }, env);
    expect(resHours.status).toBe(400);

    // 10b. Beyond advance_days (Allowed: 7 days, try 10 days in future)
    const tenDaysFromNowStr = daysAhead(10);
    const resAdvance = await app.request('/api/bookings/request', {
      method: 'POST',
      headers: authHeaders('token_res1', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        itemId: 'itm_singleqty',
        slotDate: tenDaysFromNowStr,
        slotIndices: [12],
      })
    }, env);
    expect(resAdvance.status).toBe(400);

    // 10c. Past slot (starts in next 5 minutes or earlier)
    // Try to book today, slot index 0 (6:00 AM) which is in the past
    const todayStr = getKolkataDateString();
    const resPast = await app.request('/api/bookings/request', {
      method: 'POST',
      headers: authHeaders('token_res1', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        itemId: 'itm_singleqty',
        slotDate: todayStr,
        slotIndices: [0],
      })
    }, env);
    expect(resPast.status).toBe(400);

    // 10d. Per-day cap: 5 slots on one date, so the sixth is refused.
    const db = getDb(env.DB);
    const futureDateStr = daysAhead(4);
    await db.insert(schema.bookings).values([
      { id: 'b_lim_1', itemId: 'itm_singleqty', slotDate: futureDateStr, slotIndex: 1, userId: 'usr_res1', status: 'approved', createdAt: new Date() },
      { id: 'b_lim_2', itemId: 'itm_singleqty', slotDate: futureDateStr, slotIndex: 2, userId: 'usr_res1', status: 'pending', createdAt: new Date() },
      { id: 'b_lim_3', itemId: 'itm_singleqty', slotDate: futureDateStr, slotIndex: 3, userId: 'usr_res1', status: 'approved', createdAt: new Date() },
      { id: 'b_lim_4', itemId: 'itm_multiqty', slotDate: futureDateStr, slotIndex: 4, userId: 'usr_res1', status: 'approved', createdAt: new Date() },
      { id: 'b_lim_5', itemId: 'itm_multiqty', slotDate: futureDateStr, slotIndex: 5, userId: 'usr_res1', status: 'pending', createdAt: new Date() },
    ]);

    // A sixth slot on the same date is over the cap.
    const resLimit = await app.request('/api/bookings/request', {
      method: 'POST',
      headers: authHeaders('token_res1', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        itemId: 'itm_singleqty',
        slotDate: futureDateStr,
        slotIndices: [6],
      })
    }, env);
    expect(resLimit.status).toBe(400);
    const body = (await resLimit.json()) as { error: string };
    expect(body.error).toContain('5 slots');

    // The cap is per day, so the next day is untouched by it.
    const resNextDay = await app.request('/api/bookings/request', {
      method: 'POST',
      headers: authHeaders('token_res1', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        itemId: 'itm_singleqty',
        slotDate: daysAhead(5),
        slotIndices: [6],
      })
    }, env);
    expect(resNextDay.status).toBe(200);
  });

  // Test 11: Disabling an item auto-declines pending requests and preserves approved ones
  it('Test 11: Disabling item auto-declines pending, preserves approved', async () => {
    const db = getDb(env.DB);
    const bPending = 'b_itm_dis_pending';
    const bApproved = 'b_itm_dis_approved';

    await db.insert(schema.bookings).values([
      { id: bPending, itemId: 'itm_singleqty', slotDate: daysAhead(3), slotIndex: 8, userId: 'usr_res1', status: 'pending', createdAt: new Date() },
      { id: bApproved, itemId: 'itm_singleqty', slotDate: daysAhead(3), slotIndex: 9, userId: 'usr_res2', status: 'approved', createdAt: new Date() },
    ]);

    // Disable the item (active = false)
    const res = await app.request('/api/items/itm_singleqty', {
      method: 'PUT',
      headers: authHeaders('token_rep', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        categoryId: 'cat_1',
        name: 'Badminton Court',
        quantity: 1,
        active: false, // Turn off
        requiresApproval: true,
        maxSlotsPerBooking: 2,
        earliestSlot: 0,
        latestSlot: 17,
        advanceDays: 7
      })
    }, env);

    expect(res.status).toBe(200);

    // Assert that the pending booking is declined
    const pendingRow = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bPending)).limit(1);
    expect(pendingRow[0].status).toBe('declined');
    expect(pendingRow[0].declineReason).toContain('no longer available');

    // Assert that the approved booking is preserved
    const approvedRow = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bApproved)).limit(1);
    expect(approvedRow[0].status).toBe('approved');
  });
});
