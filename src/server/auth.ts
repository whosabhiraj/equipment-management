import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, type Bindings } from "./db/client";
import * as schema from "./db/schema";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";

/**
 * Origins allowed to start a sign-in / hold a session.
 *
 * Always includes BETTER_AUTH_URL's origin. TRUSTED_ORIGINS (comma separated)
 * exists for local development, where the Vite dev server runs on :5173 and
 * proxies /api to the Worker on :8787 — two different origins. In preview and
 * production one Worker serves both, so it should be left unset.
 */
export function getTrustedOrigins(env: Bindings): string[] {
  const origins = new Set<string>();
  if (env.BETTER_AUTH_URL) {
    origins.add(new URL(env.BETTER_AUTH_URL).origin);
  }
  for (const raw of (env.TRUSTED_ORIGINS ?? "").split(",")) {
    const value = raw.trim();
    if (value) origins.add(new URL(value).origin);
  }
  return [...origins];
}

export function getAuth(d1: D1Database, env: Bindings) {
  const db = getDb(d1);

  // Workers do not populate process.env, so Better Auth cannot pick these up
  // on its own — passing them explicitly is mandatory. Without `secret` it
  // silently falls back to a published default and every session cookie
  // becomes forgeable.
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is not set. Refusing to start with a default signing secret.");
  }
  if (!env.BETTER_AUTH_URL) {
    throw new Error("BETTER_AUTH_URL is not set. Better Auth cannot build the OAuth redirect URI without it.");
  }

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: getTrustedOrigins(env),
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
      // Our tables are named `users` / `sessions` / `accounts` / `verifications`;
      // Better Auth's models are singular.
      usePlural: true,
    }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    account: {
      // People are added to the hostel before they ever sign in, so the Google
      // account links to the existing row rather than creating a second one.
      accountLinking: {
        enabled: true,
      },
    },
    // Catch errors globally to return JSON / redirect correctly
    onAPIError: {
      throw: true,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (userCtx) => {
            const email = userCtx.email.toLowerCase();

            // Enforce verified email checks from social logins
            if (userCtx.emailVerified === false) {
              throw new APIError("FORBIDDEN", {
                message: "Your Google email address is not verified.",
              });
            }

            // Optional Google Workspace domain check
            if (env.GOOGLE_WORKSPACE_DOMAIN) {
              if (!email.endsWith(`@${env.GOOGLE_WORKSPACE_DOMAIN.toLowerCase()}`)) {
                throw new APIError("FORBIDDEN", {
                  message: `Sign-in restricted to @${env.GOOGLE_WORKSPACE_DOMAIN} accounts.`,
                });
              }
            }

            // Only people already added to the hostel may sign in. Reaching this
            // hook at all means no row matched the email, so it always rejects —
            // it exists so an unknown email creates nothing.
            const member = await db.query.users.findFirst({
              where: eq(schema.users.email, email),
            });

            if (!member) {
              throw new APIError("FORBIDDEN", {
                message: "You haven't been added to the hostel yet. Contact the admin to be added.",
              });
            }

            if (member.disabled) {
              throw new APIError("FORBIDDEN", {
                message: "Your access to the hostel portal has been blocked. Contact the admin.",
              });
            }

            // Unreachable in practice (a person already in the hostel never reaches
            // this hook), but Better Auth only honours a `{ data }` shape —
            // a bare object is silently discarded.
            return {
              data: {
                ...userCtx,
                role: member.role,
                roomNo: member.roomNo,
              },
            };
          },
        },
      },
      session: {
        create: {
          before: async (sessionCtx) => {
            // Check if user is disabled upon session creation
            const dbUser = await db.query.users.findFirst({
              where: eq(schema.users.id, sessionCtx.userId),
            });

            if (!dbUser) {
              throw new APIError("FORBIDDEN", {
                message: "You haven't been added to the hostel yet. Contact the admin to be added.",
              });
            }

            if (dbUser.disabled) {
              throw new APIError("FORBIDDEN", {
                message: "Your access to the hostel portal has been blocked. Contact the admin.",
              });
            }
          },
        },
      },
    },
  });
}
