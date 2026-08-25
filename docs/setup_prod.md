# Production Deployment Guide (Cloudflare Workers)

This guide explains how to deploy the Hostel Sports & Games Booking Portal to a live Cloudflare Workers environment.

## Architecture Overview
The application uses a **Single-Worker architecture**. 
When deployed, Cloudflare bundles the Hono backend API and the compiled React static assets into a single Worker instance. The Worker intercepts incoming requests:
- Requests starting with `/api/*` are handled by Hono routing logic.
- All other requests serve the static HTML/CSS/JS assets via Cloudflare's Native Assets binding.

## Prerequisites
1. A Cloudflare account.
2. Cloudflare CLI (`wrangler`) authenticated locally (`npx wrangler login`).
3. Google Cloud Console configured with production redirect URIs.

## 1. Configure Cloudflare Resources

Before deploying the worker, you must provision a production D1 database.

1. **Create the Production D1 Database**:
   ```bash
   npx wrangler d1 create hostel-booking-prod
   ```
   *Wrangler will output a `database_id`. Copy this ID.*

2. **Update `wrangler.toml`**:
   Open `wrangler.toml` and locate the `[[d1_databases]]` section. Replace the `database_id` with the one you just generated:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "hostel-booking-prod"
   database_id = "YOUR-NEW-DATABASE-ID-HERE"
   ```

## 2. Apply Migrations & Seed Data to Production

You must build the database schema on the live Cloudflare network.

1. **Apply Schema**:
   ```bash
   npx wrangler d1 migrations apply DB --remote
   ```

2. **Apply Roster Seed Data**:
   > **Destructive.** `scripts/seed.sql` begins with `DELETE FROM users/bookings/...`.
   > It is a first-run bootstrap only. To add residents to a live database use the
   > admin CSV import at `/manage/users` instead — never re-run this file.

   Ensure you have generated `scripts/seed.sql` using your real student roster (see Local Setup guide). Then execute it remotely:
   ```bash
   npx wrangler d1 execute hostel-booking-prod --remote --file=./scripts/seed.sql
   ```

## 3. Configure Production Secrets

Do not upload `.dev.vars` to production. Instead, inject secrets directly into your Cloudflare Worker using the CLI:

```bash
npx wrangler secret put BETTER_AUTH_SECRET
# Paste your generated 32-character secret when prompted

npx wrangler secret put GOOGLE_CLIENT_ID
# Paste your production Google Client ID

npx wrangler secret put GOOGLE_CLIENT_SECRET
# Paste your production Google Client Secret

npx wrangler secret put RESEND_API_KEY
# Paste your Resend API key (if NOTIFY_ENABLED is true)
```

## 4. Build and Deploy

Now you are ready to compile the frontend and deploy the bundle.

1. **Build the React Frontend**:
   This compiles the Vite SPA into the `./dist` folder.
   ```bash
   npm run build
   ```

2. **Deploy to Cloudflare**:
   This uploads the Hono worker script and the `./dist` assets folder to Cloudflare's edge network.
   ```bash
   npx wrangler deploy
   ```

3. **Verify Google OAuth**:
   After deployment, Wrangler will provide your live URL (e.g., `https://kavya.your-subdomain.workers.dev`). 
   You **must** go to the Google Cloud Console and add this exact URL + `/api/auth/callback/google` to your Authorized Redirect URIs.

## 5. Maintenance & Rollbacks

### Backups
Before applying any future migrations, backup your production database locally using the provided shell script:
```bash
./scripts/backup.sh
```
*(This downloads a `.sql` dump and compiles it into a `.db` SQLite file in the `./backups/` directory).*

### Rollbacks
If a bad deployment breaks the site, you can instantly revert to a previous working version:
```bash
# List previous deployments to find the stable ID
npx wrangler deployments list

# Rollback
npx wrangler deployments rollback <deployment-id>
```
