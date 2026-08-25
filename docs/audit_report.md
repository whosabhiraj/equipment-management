# Audit — Hostel Sports & Games Booking Portal

Audited against `hostel-booking-master-prompt.md`, 25 Aug 2026.

Baseline before this pass: **sign-in was impossible**, `tsc --noEmit` reported 40
errors, and the test suite had never executed once. The previous version of this
document described the capacity-guard SQL as handling races "flawlessly"; the
snippet it quoted as evidence contains the bug described in §2.1.

Verification after this pass: `npm run typecheck` clean, `npm test` 11/11,
`npm run build` clean, and `POST /api/auth/sign-in/social` returns a valid Google
authorization URL against a live `wrangler dev`.

---

## 1. Sign-in was broken in five independent places

Any one of these alone stops a resident from logging in. All are fixed.

| # | Fault | Symptom |
|---|---|---|
| 1.1 | Client called `GET /api/auth/login/social/google`. Better Auth has no such route — it is `POST /api/auth/sign-in/social`, which returns `{ url }` to navigate to. | The 404 page |
| 1.2 | `BETTER_AUTH_SECRET` was never passed to `betterAuth()` | see 1.6 |
| 1.3 | `BETTER_AUTH_URL` was never passed, so no OAuth redirect URI could be built | 500 on sign-in |
| 1.4 | `drizzleAdapter` had no `usePlural`, so it looked up `schema.user` / `session` / `account` while the schema exports `users` / `sessions` / `accounts` | adapter throws on every auth DB access |
| 1.5 | No `verifications` table existed in the schema or migrations. Better Auth stores the OAuth `state` and PKCE verifier there | "Unable to create verification" |
| 1.6 | Better Auth reads `BETTER_AUTH_SECRET` from `process.env`, which does not exist in Workers. With no explicit `secret` it falls back to its **published default**, `better-auth-secret-123456789`. Session cookies are HMAC-signed with that value. | **Anyone could forge a session cookie for any user id, including an admin.** Critical. |

Also fixed: the Vite dev server (`:5173`) is a different origin from the Worker
(`:8787`), so Better Auth rejected the sign-in with `Invalid origin`. Handled by
a new `TRUSTED_ORIGINS` env var, set only in local development.

---

## 2. Data integrity

### 2.1 The capacity guard did not work — the approval queue jams permanently

The single most important statement in the repo. The approval `UPDATE` counted
approved bookings with an **unaliased self-reference**:

```sql
-- before
UPDATE bookings SET status = 'approved'
WHERE id = ? AND status = 'pending' AND (
  SELECT COUNT(*) FROM bookings
  WHERE item_id = bookings.item_id AND ...   -- `bookings` binds to the SUBQUERY
) < (SELECT quantity FROM items WHERE id = bookings.item_id AND active = 1);
```

Inside the subquery, `FROM bookings` shadows the UPDATE target, so
`item_id = bookings.item_id` collapses to `item_id = item_id` — a tautology. The
subquery counted **every approved booking in the whole table**, ignoring item,
date and slot entirely.

It does not overbook. It does something worse and quieter: once the total number
of approved bookings anywhere in the system reaches an item's `quantity`, no
approval of that item can ever succeed again. For a `quantity = 1` item that is
after the *first* approval in the entire system. The rep gets a permanent,
inexplicable `409 Slot capacity has filled up` on every request thereafter.

Fixed by aliasing the inner table (`FROM bookings AS taken`). Reverting the fix
makes Test 1 fail (3 of 4 approvals succeed where 4 should) — the test has teeth.

The `INSERT ... SELECT ... WHERE` used for booking creation was already correct;
it binds parameters rather than correlating.

### 2.2 The quantity-reduction guard was a no-op

`items.ts` computed `remainingConflicts` as `conflicts.filter(() => true)` and
then never read it — the comment in the code said as much. Any non-empty
`resolveCancellations` array committed the reduction, silently overbooking the
item. It now verifies that the nominated cancellations actually clear every
oversubscribed slot, and returns the still-unresolved ones if they do not.

### 2.3 The approve/decline payload was never validated

`if (!bookingId || !inArray(decision, ['approved','declined']))` — `inArray` is a
Drizzle SQL *builder*, so it always returns a truthy object and the negation is
always false. Any value that was not the literal `'declined'` fell through to the
approve branch. Replaced with a Zod schema.

---

## 3. Crashes and resource limits

- **`/api/users/import/preview` was a guaranteed 500.** It called
  `z.string().email()` while `users.ts` never imported `zod`. CSV roster import
  has never worked.
- **The rep's approval queue would hard-fail under load.** It ran 3 D1 queries
  per pending row inside `Promise.all`. Workers cap subrequests at 50 (free) /
  1000 (paid), so the page dies at roughly 16 pending requests — exactly when a
  rep most needs it. Rewritten as two grouped queries. The blackout and
  auto-decline notification loops had the same shape and are also batched; their
  emails now run via `waitUntil` instead of blocking the response.
- **`migrations/seed.sql` would have wiped production.** It begins with
  `DELETE FROM bookings; … DELETE FROM users;` and lived in `migrations/`. §10
  has CI run `wrangler d1 migrations apply DB --remote` before every deploy, so
  the first production deploy would have destroyed the roster and every booking.
  Moved to `scripts/seed.sql`, with the destructive warning added to
  `docs/setup_prod.md`.

---

## 4. Security

| Finding | Status |
|---|---|
| Forgeable session cookies via the default signing secret (1.6) | Fixed |
| No `Origin` check on non-GET requests (§3 requires one) | Fixed — `requireSameOrigin` |
| Primary keys from `Math.random().toString(36)` — not a CSPRNG, ~46 bits. §3 requires ULID/UUIDv4 | Fixed — `crypto.randomUUID()` |
| Zod schemas accepted unknown fields (§3 says reject) | Fixed — `.strict()` |
| A user disabled mid-session was 401'd but their session stayed valid (§6 says revoke) | Fixed |
| Unmatched `/api/*` fell through to the SPA handler and returned `index.html` | Fixed — JSON 404 |
| `.dev.vars.example` contained a **real, working Google client secret**, and the repo had no `.gitignore` at all | Example scrubbed, `.gitignore` added — **but that secret must be rotated in Google Cloud Console.** It sat in a file whose whole purpose is to be committed. |

Ownership checks on individual bookings, default-deny router middleware, and
role gating were already correct, and are covered by tests 4 and 5.

---

## 5. Timezone

Three places used `new Date().toISOString().split('T')[0]` — a **UTC** calendar
date — where §1 mandates Asia/Kolkata: the rep's Today view, the `advance_days`
limit, and the quantity-conflict window. Between 00:00 and 05:30 IST every one of
them was a day out. All now use `getKolkataDateString()`.

---

## 6. The test suite had never been run

`wrangler.toml` was missing `compatibility_flags = ["nodejs_compat"]`, which
`@cloudflare/vitest-pool-workers` refuses to start without. Behind that were four
more layers:

1. `kysely` (pulled in by Better Auth's Drizzle adapter) resolved to its CJS
   build inside workerd — fixed with `ssr.noExternal`.
2. Setup used `fs.readFileSync` to load the migration; Workers have no `fs` —
   now a Vite `?raw` import.
3. Every request authenticated with `Authorization: Bearer <token>`, a scheme
   Better Auth does not implement without the `bearer` plugin. All 11 tests
   would have 401'd. They now build a real HMAC-signed session cookie, which
   exercises the actual auth path.
4. Two tests were written against rules they violate: tests 7 and 10 booked dates
   46+ days out against `advance_days = 7`, and test 1's seven-way race gave all
   seven rows the same `user_id`, which the partial unique index forbids. Dates
   are now relative; the race uses distinct residents.

All 11 cases from §8 now pass, and genuinely exercise their subject.

---

## 7. Not fixed — remaining gaps against the master prompt

Nothing here is broken; these are things the spec asks for that were never built.

**Spec requirements missing**

- **No rate limiting** on booking creation. §3 asks for ~10/min per user.
- **No TanStack Router**, though §2 fixes it as the stack. Navigation is
  `useState` tabs, so `/manage` and `/manage/users` are not real URLs — no deep
  links, no back button, no bookmarking. §3's "the admin panel is just a route"
  is not literally true yet.
- **No shadcn/ui** (§2).
- **No GitHub Actions** (§10). There is no `.github/` directory, so nothing
  typechecks, tests, migrates or deploys on push.

**Features described in §5 that are absent**

- Bulk-approve non-conflicting requests.
- Disabling an item auto-declines pending requests but never offers to cancel
  future *approved* ones.
- Blackouts can be created and listed but not deleted, and creating one silently
  cancels approved bookings with no preview step.

**Smaller**

- `no_show` can be set on any booking regardless of status or whether the slot
  has actually passed.
- Declines write no audit-log entry, though approvals do.
- Resend sends from `noreply@resend.dev`, not the verified domain §5 assumes.
- `App.tsx` is ~1370 lines against §11's ~300-line guidance.
