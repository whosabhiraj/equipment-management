import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { Session, User } from './schema';

export type Bindings = {
  DB: D1Database;
  ASSETS?: Fetcher;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  /** Comma-separated extra origins allowed to sign in (local dev only). */
  TRUSTED_ORIGINS?: string;
  GOOGLE_WORKSPACE_DOMAIN?: string;
  RESEND_API_KEY?: string;
  NOTIFY_ENABLED?: string;
};

export type Variables = {
  user: User;
  session: Session;
};

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
