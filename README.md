# Hostel Sports & Games Booking Portal

A high-performance booking portal for a college hostel's shared sports and games inventory. Built on a Single-Worker architecture (Hono API + Vite/React SPA) using Cloudflare Workers, D1 database, Drizzle ORM, Better Auth, and Resend

---

## 1. Google Cloud Console Setup

To support Google OAuth login:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Navigate to **APIs & Services > Credentials**.
4. Click **Create Credentials > OAuth client ID**.
5. Select **Web Application** as the application type.
6. Configure the **Authorized redirect URIs** depending on your environment:
   *   **Local Development**:
       `http://localhost:8787/api/auth/callback/google`
   *   **Preview Environment**:
       `https://preview-hostel-booking.your-subdomain.workers.dev/api/auth/callback/google`
   *   **Production Environment**:
       `https://hostel-booking.your-subdomain.workers.dev/api/auth/callback/google`
7. Copy the generated **Client ID** and **Client Secret**. Add them to your `.dev.vars` (local) and Workers Secrets (remote).

> The redirect URI is derived from `BETTER_AUTH_URL`, so it must match it exactly
> — including the port. Registering `http://localhost:5173/...` will not work:
> Google always redirects to the Worker, never to the Vite dev server.

---

## 1a. Running it locally

There are two modes, and the difference matters for auth.

**Single origin (matches production — use this to test sign-in):**
```bash
npm run build        # Vite output into dist/, which the Worker serves
npm run dev:worker   # wrangler dev on http://localhost:8787
```
Open **http://localhost:8787**. One origin, no proxy, nothing extra to configure.

**Vite dev server (hot reload, for UI work):**
```bash
npm run dev:worker   # terminal 1 — API on :8787
npm run dev          # terminal 2 — UI on :5173, proxies /api to :8787
```
Open **http://localhost:5173**. Because the page and the Worker are on different
ports, `TRUSTED_ORIGINS=http://localhost:5173` must be set in `.dev.vars` or Better
Auth rejects the sign-in with `Invalid origin`. Leave `TRUSTED_ORIGINS` unset in
preview and production, where a single Worker serves both.

---

## 2. Local Database Migration & Seeding

Since the D1 local database is isolated, you must run migrations and seed it before developing:

1. **Copy Secrets Template**:
   ```bash
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars to add your actual Google OAuth credentials and Resend API key
   ```

2. **Apply Schema Migrations**:
   ```bash
   npx wrangler d1 migrations apply DB --local
   ```

3. **Generate & Apply Roster Seed Data**:
   *   Create your custom student roster in `data/roster.csv` (using `data/roster.example.csv` as a template).
   *   Compile/execute the seeding generator script:
       ```bash
       npx tsx scripts/seed.ts
       ```
   *   Apply the generated seed queries to D1 local:
       ```bash
       npx wrangler d1 execute hostel-booking-local --local --file=./scripts/seed.sql
       ```

---

## 3. Promoting the First Administrator

Because signups are blocked (roster restriction), you must pre-populate an admin user or elevate an existing one:

### Option A: Via Roster CSV Seeding (Recommended)
Add a row to your roster CSV containing the keyword `admin` in the email address (e.g., `admin.hostel@college.edu`). The seeding script will automatically assign this user the `admin` role when creating `seed.sql`.

### Option B: Direct SQL Update
Execute a raw SQL query directly on D1 to elevate an existing user:
*   **Local Development**:
    ```bash
    npx wrangler d1 execute hostel-booking-local --local --command="UPDATE users SET role='admin' WHERE email='your.email@college.edu';"
    ```
*   **Remote Production**:
    ```bash
    npx wrangler d1 execute hostel-booking-prod --remote --command="UPDATE users SET role='admin' WHERE email='your.email@college.edu';"
    ```

---

## 4. Deploying to Cloudflare

Deploy the Hono backend and the React static assets in a single command:

1. **Build Static Frontend**:
   ```bash
   npm run build
   ```
2. **Deploy Worker & Assets**:
   ```bash
   npx wrangler deploy
   ```
3. **Upload Secrets**:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put RESEND_API_KEY
   ```

---

## 5. Rollback a Bad Deployment

If a production deploy introduces issues, roll back instantly to a previous version using Wrangler:

1. **View Deployment History**:
   ```bash
   npx wrangler deployments list
   ```
2. **Rollback to Stable Version ID**:
   ```bash
   npx wrangler deployments rollback <deployment-id>
   ```

---

## 6. Backup Commands

Always back up your database before applying new migrations:
```bash
chmod +x scripts/backup.sh
./scripts/backup.sh
```
This will output a timestamped SQL dump and SQLite `.db` file in the `./backups/` directory.
