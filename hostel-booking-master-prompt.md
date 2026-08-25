g++ broken.cpp -o broken.exe 2> err3.txt
Get-Content err3.txt# Master prompt — Hostel Sports & Games Booking Portal

> Paste this whole file into Claude Code as your first message. Keep it in the repo as `CLAUDE.md` afterwards so it stays in context for every future session.
> Anything in `[[ brackets ]]` is a decision you should fill in before starting.

---

## 0. How to work on this project

Read this entire document before writing code. Then:

1. **Plan first.** Produce a short build plan and a file tree. Wait for my approval before writing code.
2. **Build in the order given in §9.** Do not skip ahead to UI polish before auth and the booking engine work end to end.
3. **Use the `frontend-design` skill** before writing any UI. Follow its two-pass process: brainstorm a token system (color / type / layout / signature), critique it against §7 of this document, revise, *then* build. Do not skip the critique pass.
4. After each phase, run the test suite and tell me what's passing before moving on.
5. When you hit an ambiguity not covered here, ask me rather than guessing. Guessing on auth or on the conflict logic is the one thing I actively don't want.
6. Never invent library APIs. If you're unsure of a Better Auth / Drizzle / Hono / Wrangler signature, check the docs or ask.

---

## 1. What this is

A booking portal for a college hostel's shared sports and games inventory — badminton racquets, table tennis paddles, board games like Catan and Codenames, footballs, carrom, chess sets.

**The flow:**
- A resident signs in with Google, browses what's available, and requests a specific item for a specific time slot (e.g. "Badminton racquet, 27 Aug, 9:00 PM").
- The hostel **sports rep** sees a queue of pending requests and approves or declines each one.
- On approval, the slot is locked for that item. Everyone else who requested the same slot is automatically declined.
- The resident sees their upcoming and past bookings, and can cancel before the slot starts.

**Scale:** ~200–400 residents, 1–4 reps, maybe 50 bookings a day at peak. This is small. Do not build for scale that doesn't exist — no queues, no caches, no microservices.

**Timezone: `Asia/Kolkata`, hardcoded.** Everyone using this is in one building. Do not build multi-timezone support.

---

## 2. Tech stack (fixed — do not substitute)

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| API | Hono (TypeScript) |
| Frontend | Vite + React + TypeScript, TanStack Router, TanStack Query |
| Styling | Tailwind CSS + shadcn/ui (use sparingly — see §7) |
| Database | Cloudflare D1 (SQLite) |
| ORM / migrations | Drizzle ORM + Drizzle Kit |
| Auth | Better Auth, Google social provider, Drizzle adapter, cookie sessions |
| Validation | Zod, shared between client and server |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` |
| Email | Resend (free tier), behind a NOTIFY_ENABLED flag |
| Deploy | Wrangler, single Worker, GitHub Actions |

**One Worker serves both the API and the static frontend** via Workers Static Assets. Same origin for everything — this is deliberate, it removes CORS and cross-site cookie problems entirely. Do not split into two deployments.

Repo layout: a single package with `src/server/` (Hono app, routes, db, auth), `src/client/` (React app), `src/shared/` (Zod schemas and slot-time helpers imported by both), `migrations/`, `scripts/`.

---

## 3. Auth — get this exactly right

### Sign-in
- Google OAuth only. No email/password, no magic links.
- **Login only, never signup.** Users are pre-populated by me. Enforce this in Better Auth's `signIn.before` hook: look up the incoming Google email in the `users` table. If there's no row, **reject the sign-in and create nothing**. Return a clean "This email isn't on the hostel roster — talk to your sports rep" page, not a stack trace.
- Also reject if Google reports `email_verified: false`.
- [[ If the hostel uses a Google Workspace domain, also verify the `hd` claim equals `<domain>`. Tell me if you need this and I'll confirm the domain. ]]
- Reject sign-in if the user row has `disabled = 1`, with a distinct message.

### Roles
There is **one** auth system, not two. `users.role` is `'resident' | 'rep' | 'admin'`.
- `resident` — book and manage own bookings.
- `rep` — everything a resident can do, plus the approval queue and the item catalog.
- `admin` — everything a rep can do, plus user management and role assignment.

The admin panel is just a route (`/manage`) behind a role check. **Do not build a second login screen or a separate OAuth app for it.**

### Endpoint authorization
Apply middleware at the **router** level, default-deny, then explicitly open the small set of public routes:

```ts
app.use('/api/*', requireSession)          // 401 if no valid session
app.use('/api/manage/*', requireRole('rep', 'admin'))
app.use('/api/manage/users/*', requireRole('admin'))
```

Non-negotiable rules:
- **Always derive `user_id` from the session.** Never read an actor identity from the request body or a query param. If a handler needs to know who's acting, it reads `c.get('user')`.
- Every handler that touches a specific booking re-checks ownership (or rep role) against that booking's row — not just that the caller is logged in. An authenticated resident must not be able to cancel someone else's booking by guessing an ID.
- Use ULIDs or UUIDv4 for all primary keys. No sequential integers in URLs.
- Cookies: `HttpOnly`, `Secure`, `SameSite=Lax`. Add an `Origin` header check on all non-GET requests.
- Rate-limit booking creation per user (e.g. 10/minute) — a simple D1 counter is fine, don't reach for a Durable Object.
- All input validated with Zod at the route boundary. Reject unknown fields.

---

## 4. Data model

Fixed-length slots, **not** arbitrary start/end timestamps. This makes conflict detection a uniqueness constraint instead of interval arithmetic, and kills a whole class of timezone bugs.

- A day is divided into hourly slots. Slot `0` = 06:00, slot `17` = 23:00. Store `slot_date` as a local `'YYYY-MM-DD'` string and `slot_index` as an integer. Convert to display times only in the UI layer, from a single helper in `src/shared/slots.ts`.

Core tables (extend as needed, but keep these shapes):

```sql
users        id, email UNIQUE, name, image, role, room_no, disabled, created_at
categories   id, name, sort_order                     -- "Racquet sports", "Board games"
items        id, category_id, name, description, image_url,
             quantity,                                 -- how many copies exist, >= 0
             active,                                   -- soft disable, never delete
             requires_approval,                        -- 0 = auto-approve on request
             max_slots_per_booking,                    -- e.g. 2 consecutive hours
             earliest_slot, latest_slot,               -- per-item allowed hours
             advance_days,                             -- how far ahead it can be booked
             sort_order, created_at
bookings     id, item_id, slot_date, slot_index, user_id,
             status,                                   -- pending|approved|declined|cancelled|no_show
             note, decided_by, decided_at, decline_reason, created_at
blackouts    id, item_id NULLABLE, slot_date, slot_index NULLABLE, reason
audit_log    id, actor_id, action, target_type, target_id, meta_json, created_at
```

**No units table.** An item carries a `quantity` — "4 badminton racquets", "2 Catan sets". Bookings point straight at the item. Availability for a slot is `quantity − (approved bookings in that slot)`, computed in SQL, and the UI shows it as "3 of 4 available".

### The conflict guarantee

Because capacity is a count rather than a unique slot, the guarantee is a **conditional insert** — one statement, therefore atomic on D1, no interactive transaction needed:

```sql
INSERT INTO bookings (id, item_id, slot_date, slot_index, user_id, status, note, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
WHERE (
  SELECT COUNT(*) FROM bookings
  WHERE item_id = ?2 AND slot_date = ?3 AND slot_index = ?4 AND status = 'approved'
) < (SELECT quantity FROM items WHERE id = ?2 AND active = 1);
```

Zero rows affected means the slot filled up — return a clean 409 and refresh the grid. **Never** do a `SELECT` count followed by a separate `INSERT`; that's the race this design exists to avoid. Use the same statement shape for both auto-approve booking (`status = 'approved'`) and rep approval (an `UPDATE ... WHERE` guarded by the same subquery-count condition).

Add a supporting index on `bookings(item_id, slot_date, slot_index, status)`.

Also add `UNIQUE(item_id, slot_date, slot_index, user_id) WHERE status IN ('pending','approved')` so one person can't take two copies of the same item in the same hour.

Write a test that fires `quantity + 3` concurrent approvals at one slot and asserts exactly `quantity` succeed and the rest get 409s.

### Pending requests do not hold capacity
Multiple residents may request the same slot regardless of quantity. The rep sees them grouped, with "5 requests, 4 racquets" shown on the group. **When an approval fills the last copy, auto-decline the remaining pending requests for that slot in the same `db.batch()`** with reason "Slot filled". While copies remain free, competing requests stay pending. This stops one person locking the equipment by spamming requests they never intend to use.

---

## 5. Features

### Resident
- Browse items grouped by category. Inactive items are hidden entirely.
- **Availability grid:** pick an item, see a date × slot grid. Each cell shows remaining capacity — "3 of 4" — computed live from the DB, not cached. Full slots and blacked-out slots are visibly dead, not just greyed.
- Request a slot (or up to `max_slots_per_booking` consecutive slots) with an optional note. If the item has `requires_approval = 0`, the request is confirmed immediately and the UI says "Booked" rather than "Requested" — the button label changes to match before the click, so nobody is surprised.
- "My bookings": upcoming and past, with status. Cancel any pending or approved booking before its slot starts.
- Enforce, with clear errors: can't book past slots, can't book beyond `advance_days`, can't book outside the item's allowed hours, can't exceed [[ N ]] active bookings at once, can't request a slot they already have a live request for.

### Rep (`/manage`)
- **Approval queue** — pending requests, oldest first, showing requester name + room, item, slot, note, and competing-request count. Approve or decline inline; decline requires a short reason. Bulk-approve non-conflicting requests in one action.
- **Item catalog CRUD** — this is a first-class feature, not an afterthought:
  - Create / edit / archive categories.
  - Create / edit items: name, description, category, quantity, and per-item rules (allowed hours, advance days, max slots, **auto-approve toggle** — instant booking for low-stakes stuff like board games, approval queue for contested stuff like the badminton court).
  - **Enable / disable** an item with a toggle. Disabling hides it from residents immediately, but **preserves existing bookings** and prompts the rep to optionally cancel future ones with a reason. Never hard-delete an item that has bookings — archive it.
  - **Adjust quantity** — "one racquet has a broken string, we're down to 3". Lowering quantity below the number of approved bookings in some future slot must not silently overbook: show the rep exactly which slots are now oversubscribed and make them choose which bookings to cancel before the change commits.
- **Blackouts** — mark a date or slot range unavailable ("court resurfacing, 3–5 Sep") globally or per item.
- **Today view** — everything approved for today, in time order. This is what the rep actually looks at when handing out equipment.
- Optionally mark a completed booking as `no_show`.

### Admin (`/manage/users`)
- List, search, and filter users.
- Add a single user by email, or **bulk-import from pasted CSV** (`email, name, room_no`) with a preview-and-confirm step showing adds / skips / conflicts.
- Enable / disable a user (disabled users can't sign in; existing bookings preserved).
- Change roles. Guard against removing the last admin.
- View the audit log: who approved, declined, disabled, or edited what, and when.

### Email notifications

Cloudflare's own email binding can only send to addresses verified on my own zone, so it can't mail residents. Use **Resend** instead — free tier is 3,000/month capped at **100/day**, one verified sending domain, which fits this volume with room to spare. Requires a domain I control; I'll verify it and give you the API key as a Worker secret.

Build it behind a single `src/server/notify.ts` module with a `NOTIFY_ENABLED` flag, so the whole thing is one env var away from off:

- Send on **decision only** — approved, declined, or cancelled-by-rep. Never on request creation, never on auto-approve (the screen already confirmed it). That's roughly one email per decision and keeps you far under 100/day.
- Plain text or a minimal React Email template. Subject names the outcome and the slot: "Approved — badminton racquet, 27 Aug, 9:00 PM".
- **Failures must never break the booking.** Send after the DB write commits, wrap in try/catch, log failures to the audit log, and always return success to the rep. A dead mail provider must not block approvals.
- If the daily cap is hit, log it and carry on silently. The site remains the source of truth, and the UI should never imply an email is guaranteed.

### Deliberately out of scope (do not build)
Push notifications; SMS; WhatsApp; payments; recurring bookings; a mobile app; analytics dashboards; multi-hostel tenancy; anything AI-powered. If you think one is essential, tell me why instead of building it.

---

## 6. Errors and edge cases to handle explicitly

- Slot is taken between page load and submit → 409 with a message naming the conflict, and the grid refreshes rather than just toasting.
- Rep approves a request whose slot was taken while the queue page was stale → clean 409, row updates in place.
- Item disabled while a request is pending → the request is auto-declined with "Item is no longer available".
- User disabled mid-session → next request 401s and the session is revoked.
- Clock rollover: a slot that starts in the next 5 minutes can't be requested.
- Empty states everywhere: no items yet, no pending requests, no bookings. Per the design skill, these are invitations to act, not apologies.

---

## 7. UI direction

**The brief:** an internal tool used on a phone, standing in a hostel corridor, deciding whether a racquet is free at 9 PM. Density and speed beat delight. It must not look like a Bootstrap admin template, and it must not look like an over-designed marketing page. It is a *utility with a point of view*.

Follow the `frontend-design` skill's process, with these constraints on top:

- **No landing page, no hero section, no marketing copy.** The signed-out screen is one card with a Google sign-in button and one line of text. Signed in, you land directly on the availability grid.
- **The signature element is the availability grid.** Spend your design boldness there — the way a free / requested / taken slot reads at a glance, on a phone, in one second. Everything else stays quiet and disciplined.
- Mobile-first. The rep's approval queue must be fully usable one-handed on a phone.
- Status is the most important information on the screen. Encode it with **more than color alone** (shape, weight, fill, label) — some residents will be colorblind and the grid is the whole product.
- Pick a typeface pairing deliberately. A grid of times and labels wants a body face with real tabular figures; do not just leave it on the system stack by default.
- Do not use the current AI-design defaults: cream `#F4F1EA` backgrounds with a terracotta accent, near-black with one acid-green accent, or the hairline-rule broadsheet look. Also skip generic `01 / 02 / 03` step markers — nothing here is a sequence.
- The subject's world is worth mining for the visual language: court markings, scoreboards, equipment-room tags, the sign-out sheet on a clipboard. Take one real risk there and justify it to me.
- Restraint: shadcn/ui is a base, not the look. If the result could be any SaaS dashboard, revise it.
- Quality floor, unannounced: responsive to 360px, visible keyboard focus, `prefers-reduced-motion` respected, all interactive controls reachable by keyboard, real `<label>`s on inputs.
- **Copy:** plain verbs, sentence case, active voice. Buttons name the outcome ("Request slot", "Approve", "Decline") and the resulting toast uses the same word ("Requested", "Approved"). Errors say what happened and what to do next, never "Oops!" or "Something went wrong".

Show me the design plan (palette hexes, type roles, layout sketch, signature element) before you build the UI.

---

## 8. Testing

Vitest with `@cloudflare/vitest-pool-workers` against a real local D1. Priorities, in order:

1. **Capacity race: fire `quantity + 3` concurrent approvals at one slot → exactly `quantity` succeed, the rest 409.** Most important test in the repo. Run it with `quantity` of both 1 and 4.
2. Sign-in with an email not on the roster creates no user row and returns 403.
3. Sign-in with a disabled user is rejected.
4. A resident cannot cancel, view, or act on another resident's booking (by ID).
5. A resident hitting any `/api/manage/*` route gets 403.
6. Approving the last free copy auto-declines remaining pending requests for that slot, atomically — and does *not* decline them while copies remain.
7. An auto-approve item books instantly and still respects capacity under concurrency.
8. Reducing an item's quantity below existing approved bookings is blocked until the rep resolves the conflicts.
9. A failing Resend call does not roll back or fail an approval.
10. Slot rule enforcement: past slots, beyond `advance_days`, outside item hours, over the per-user cap.
11. Disabling an item auto-declines its pending requests and preserves approved ones.

Don't chase coverage percentages. These eleven cases matter more than the rest combined.

---

## 9. Build order

Complete and verify each phase before starting the next.

1. **Skeleton** — Vite + Hono in one Worker, static assets binding, `wrangler dev` serving both, TypeScript strict mode, shared Zod package wired up.
2. **Schema + migrations + seed** — Drizzle schema, generated migration, and `scripts/seed.ts` that reads `data/roster.csv` and upserts users with roles, plus a handful of demo categories and items with varied quantities and auto-approve settings.
3. **Auth end to end** — Google OAuth, roster-only sign-in, role middleware, session on the client, protected route boundaries. Prove all of §3 before moving on.
4. **Booking engine (API only)** — availability query, request creation, cancellation, the conditional-insert capacity guard, auto-approve path, approve/decline with auto-decline when capacity fills. Write the §8 tests here, not later.
5. **Resident UI** — design plan first (§7), then availability grid, request flow, my-bookings.
6. **Rep UI** — approval queue, today view, item CRUD and quantity management, blackouts.
7. **Admin UI** — user management, CSV import, audit log.
8. **Deploy** — §10.
9. **Hardening pass** — re-read §3 and §6 against the finished code and report anything that drifted.

---

## 10. Deployment

- `wrangler.toml` with `[[d1_databases]]`, the static assets binding, and separate `[env.preview]` / `[env.production]` blocks pointing at **different D1 databases**.
- Secrets (`GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`) via `wrangler secret put`. Never in `wrangler.toml`, never in the repo. Provide a `.dev.vars.example`.
- Migrations: `wrangler d1 migrations apply DB --remote`, run in CI before deploy.
- GitHub Actions on push to `main`: typecheck → test → build → migrate → `wrangler deploy`. A PR opens a preview deploy against the preview D1.
- Give me a `README.md` with: Google Cloud Console setup (which OAuth client type, exactly which authorized redirect URIs for local / preview / production), how to seed the roster, how to promote the first admin, and how to roll back a bad deploy.
- Also give me `scripts/backup.sh` that dumps D1 to a local SQLite file. One command, run it before every migration.

---

## 11. Guardrails

- No `any`. TypeScript strict.
- No secrets, emails, or roster data committed. `data/roster.csv` is gitignored; ship `data/roster.example.csv`.
- No hard deletes anywhere. Everything is a soft disable or an archive.
- Don't add a dependency without telling me what it's for and why the platform can't do it.
- Don't touch auth or the capacity-guard SQL without flagging it in your summary.
- Keep files under ~300 lines; split routes by domain (`routes/bookings.ts`, `routes/items.ts`, `routes/users.ts`).
