import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import * as schema from '../src/server/db/schema';
import migrationSql from '../migrations/0000_init_schema.sql?raw';
import verificationsSql from '../migrations/0001_add_verifications.sql?raw';
import accountColumnsSql from '../migrations/0002_account_oauth_columns.sql?raw';

/**
 * Better Auth addresses tables through the Drizzle adapter by *property* name,
 * and writes every field of its core models on sign-in. A column it expects but
 * cannot find does not fail loudly — the OAuth callback swallows the throw and
 * redirects with a vague `?error=unable_to_link_account`.
 *
 * Two separate sign-in outages came from exactly that: a missing `verifications`
 * table, then four missing columns on `accounts`. This pins the contract.
 *
 * Field lists are Better Auth 1.1.0's core schema (`getAuthTables`). If the
 * dependency is upgraded and this test fails, reconcile it against the new
 * version rather than deleting the assertion.
 */
const REQUIRED_FIELDS: Record<string, string[]> = {
  users: ['id', 'name', 'email', 'emailVerified', 'image', 'createdAt', 'updatedAt'],
  sessions: ['id', 'userId', 'token', 'expiresAt', 'ipAddress', 'userAgent', 'createdAt', 'updatedAt'],
  accounts: [
    'id',
    'userId',
    'accountId',
    'providerId',
    'accessToken',
    'refreshToken',
    'idToken',
    'accessTokenExpiresAt',
    'refreshTokenExpiresAt',
    'scope',
    'password',
    'createdAt',
    'updatedAt',
  ],
  verifications: ['id', 'identifier', 'value', 'expiresAt', 'createdAt', 'updatedAt'],
};

describe('Better Auth schema conformance', () => {
  for (const [tableName, fields] of Object.entries(REQUIRED_FIELDS)) {
    it(`${tableName} exposes every field Better Auth writes`, () => {
      const table = (schema as Record<string, unknown>)[tableName];
      expect(table, `schema.${tableName} is missing — the adapter resolves models by property name`).toBeDefined();

      const columns = Object.keys(getTableColumns(table as never));
      const missing = fields.filter((field) => !columns.includes(field));
      expect(missing, `${tableName} is missing: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('every required column is also present in the migrations', () => {
    // The Drizzle schema and the SQL that actually builds the database are two
    // separate sources of truth; drift between them only shows up at runtime.
    const sql = [
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      migrationSql,
      verificationsSql,
      accountColumnsSql,
    ].join('\n');

    for (const [tableName, fields] of Object.entries(REQUIRED_FIELDS)) {
      const table = (schema as Record<string, unknown>)[tableName];
      const columns = getTableColumns(table as never) as Record<string, { name: string }>;
      for (const field of fields) {
        const columnName = columns[field].name;
        expect(sql, `${tableName}.${columnName} is in the Drizzle schema but not in any migration`)
          .toContain(`\`${columnName}\``);
      }
    }
  });
});
