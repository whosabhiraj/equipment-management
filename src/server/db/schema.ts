import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// --- Better Auth & Application Users Table ---
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  name: text('name').notNull(),
  image: text('image'),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
  role: text('role').$type<'resident' | 'rep' | 'admin'>().default('resident').notNull(),
  roomNo: text('room_no'),
  disabled: integer('disabled', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Better Auth Sessions
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').unique().notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Better Auth Accounts. Every column below is written by Better Auth when it
// links a Google account — a missing one fails the whole sign-in with
// "unable to link account". See the schema conformance test in test/auth-schema.test.ts.
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Better Auth Verification values. Used to hold the OAuth state + PKCE code
// verifier between the redirect to Google and the callback — sign-in fails
// outright without it.
export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  identifierIdx: index('idx_verifications_identifier').on(table.identifier),
}));

// --- Application Core Tables ---

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
});

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').references(() => categories.id).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  imageUrl: text('image_url'),
  quantity: integer('quantity').default(1).notNull(),
  active: integer('active', { mode: 'boolean' }).default(true).notNull(),
  requiresApproval: integer('requires_approval', { mode: 'boolean' }).default(true).notNull(),
  maxSlotsPerBooking: integer('max_slots_per_booking').default(2).notNull(),
  earliestSlot: integer('earliest_slot').default(0).notNull(), // Slot index (e.g. 0 = 06:00)
  latestSlot: integer('latest_slot').default(17).notNull(),    // Slot index (e.g. 17 = 23:00)
  advanceDays: integer('advance_days').default(7).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const bookings = sqliteTable('bookings', {
  id: text('id').primaryKey(),
  itemId: text('item_id').references(() => items.id).notNull(),
  slotDate: text('slot_date').notNull(),       // Local 'YYYY-MM-DD'
  slotIndex: integer('slot_index').notNull(),  // Slot index 0 to 17
  userId: text('user_id').references(() => users.id).notNull(),
  status: text('status').$type<'pending' | 'approved' | 'declined' | 'cancelled' | 'no_show'>().default('pending').notNull(),
  note: text('note'),
  decidedBy: text('decided_by').references(() => users.id),
  decidedAt: integer('decided_at', { mode: 'timestamp' }),
  declineReason: text('decline_reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  // Single active/pending booking per slot per user per item limit
  uniqueItemSlotUser: uniqueIndex('idx_bookings_item_slot_user')
    .on(table.itemId, table.slotDate, table.slotIndex, table.userId)
    .where(sql`status IN ('pending', 'approved')`),
  // Supporting index for capacity and conflicts search
  lookupIdx: index('idx_bookings_lookup')
    .on(table.itemId, table.slotDate, table.slotIndex, table.status),
}));

export const blackouts = sqliteTable('blackouts', {
  id: text('id').primaryKey(),
  itemId: text('item_id').references(() => items.id), // Nullable = Global blackout
  slotDate: text('slot_date').notNull(),              // 'YYYY-MM-DD'
  slotIndex: integer('slot_index'),                   // Nullable = Full day blackout
  reason: text('reason').notNull(),
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').references(() => users.id).notNull(),
  action: text('action').notNull(), // e.g. 'approve', 'decline', 'disable_user'
  targetType: text('target_type').notNull(), // e.g. 'booking', 'item', 'user'
  targetId: text('target_id').notNull(),
  metaJson: text('meta_json'), // Optional context as JSON string
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Blackout = typeof blackouts.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
