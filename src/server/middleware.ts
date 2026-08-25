import { Context, Next } from 'hono';
import { getAuth, getTrustedOrigins } from './auth';
import { getDb, Bindings, Variables } from './db/client';
import { eq } from 'drizzle-orm';
import { users } from './db/schema';

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;

/**
 * A route parameter that the router guarantees is present. Hono widens
 * `c.req.param()` to `string | undefined` once a middleware sits in the chain.
 */
export function pathParam(c: AppContext, name: string): string {
  const value = c.req.param(name);
  if (value === undefined) {
    throw new Error(`Missing route parameter: ${name}`);
  }
  return value;
}

/**
 * Origin check on every state-changing request (§3). Session cookies are
 * SameSite=Lax, which already blocks cross-site POSTs from a plain form, but
 * this is the explicit belt-and-braces check the spec asks for.
 *
 * Only enforced when the request actually carries an Origin header — browsers
 * always send one on non-GET, so a missing header means a non-browser client
 * (curl, the test suite), which cannot be CSRF'd.
 */
export async function requireSameOrigin(c: AppContext, next: Next) {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
    return await next();
  }

  const origin = c.req.header('origin');
  if (origin) {
    const allowed = new Set([new URL(c.req.url).origin, ...getTrustedOrigins(c.env)]);
    if (!allowed.has(origin)) {
      return c.json({ error: 'Forbidden: request origin is not trusted' }, 403);
    }
  }

  return await next();
}

export async function requireSession(c: AppContext, next: Next) {
  // Better Auth's own routes are mounted before this middleware and terminate
  // the chain, so this is belt-and-braces against a future reordering.
  if (c.req.path.startsWith('/api/auth/')) {
    return await next();
  }

  const auth = getAuth(c.env.DB, c.env);

  // Retrieve session using request headers
  const sessionData = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!sessionData || !sessionData.user) {
    return c.json({ error: 'Unauthorized: No active session' }, 401);
  }

  const db = getDb(c.env.DB);
  const dbUser = await db.query.users.findFirst({
    where: eq(users.id, sessionData.user.id),
  });

  if (!dbUser) {
    return c.json({ error: 'You are not in the hostel list any more. Contact the admin.' }, 401);
  }

  if (dbUser.disabled) {
    // Revoke the session so a user disabled mid-session cannot keep going (§6).
    await auth.api.revokeSession({
      headers: c.req.raw.headers,
      body: { token: sessionData.session.token },
    }).catch(() => {});
    return c.json({ error: 'Your access has been blocked. Contact the admin.' }, 401);
  }

  // Bind to Hono context
  c.set('user', dbUser);
  c.set('session', sessionData.session as unknown as Variables['session']);

  await next();
}

export function requireRole(...allowedRoles: ('resident' | 'rep' | 'admin')[]) {
  return async (c: AppContext, next: Next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Unauthorized: Session missing' }, 401);
    }

    if (!allowedRoles.includes(user.role)) {
      return c.json({ error: 'Forbidden: Insufficient role permissions' }, 403);
    }

    return await next();
  };
}
