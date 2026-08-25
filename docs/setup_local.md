# Local Development Setup Guide

This guide explains how to run the Hostel Sports & Games Booking Portal on your local machine for development and testing.

## Prerequisites
1. **Node.js** (v18 or higher)
2. **npm** (v9 or higher)
3. **Google Cloud Console Account** (for OAuth setup)

## 1. Environment Configuration

The local development environment uses Cloudflare's Wrangler to emulate the D1 database and Workers runtime locally.

1. Create your local secrets file by copying the template:
   ```bash
   cp .dev.vars.example .dev.vars
   ```

2. Open `.dev.vars` and configure the following:
   - `BETTER_AUTH_SECRET`: Generate a random 32-character string (e.g., using `openssl rand -base64 32`).
   - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: Obtain these from the Google Cloud Console. 
     - **Important:** Set the Authorized Redirect URI in Google Console to `http://localhost:8787/api/auth/callback/google`.
   - `RESEND_API_KEY`: (Optional for local dev) Your Resend email API key.
   - `NOTIFY_ENABLED`: Set to `false` if you want to skip sending actual emails during local testing.

## 2. Database Initialization (Local D1)

Cloudflare Wrangler uses a local SQLite file in the `.wrangler` directory to emulate D1.

1. **Apply Schema Migrations**:
   Run Drizzle's migration scripts against the local emulated database:
   ```bash
   npx wrangler d1 migrations apply DB --local
   ```

2. **Prepare the Roster (Seed Data)**:
   The system strictly blocks signups from unknown emails. You must seed the database with a test user roster.
   - Edit `data/roster.example.csv` or create `data/roster.csv` with your test email addresses.
   - Add the word `admin` to your own email address to automatically receive administrator privileges (e.g., `your.name+admin@college.edu`).

3. **Generate & Execute Seed SQL**:
   Compile the CSV into SQL inserts and apply them to the local database:
   ```bash
   npx tsx scripts/seed.ts
   npx wrangler d1 execute hostel-booking-local --local --file=./scripts/seed.sql
   ```

## 3. Running the Application

Because this is a Single-Worker architecture, you need to run two processes during development:

### Terminal 1: Start the Backend (Hono)
This command starts the Wrangler local server on `http://localhost:8787`. It serves the API routes (`/api/*`).
```bash
npm run dev:worker
```
*(Note: If you encounter issues with `powershell` missing from PATH on Windows, ensure you are running this from a standard Command Prompt, Git Bash, or WSL, or ensure PowerShell is correctly set in your system environment variables).*

### Terminal 2: Start the Frontend (Vite)
This command starts the Vite development server on `http://localhost:5173`. 
```bash
npm run dev:client
```

### Accessing the App
Open your browser and navigate to **`http://localhost:5173`**.
Vite is configured to automatically proxy any requests starting with `/api` to the Wrangler backend running on `8787`, resolving CORS issues locally.

## 4. Running Tests
The project includes a comprehensive Vitest test suite covering 11 critical business rules (concurrency, role guards, quantity limits).
```bash
npm run test
```
