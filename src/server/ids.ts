/**
 * Primary keys. `Math.random()` is not a CSPRNG and 9 base36 characters is
 * ~46 bits — guessable, and collision-prone for the audit log. Use UUIDv4.
 */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
