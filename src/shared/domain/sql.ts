/**
 * SQL helpers that derive DDL fragments from shared enum constants so the
 * database schema stays in sync with the TypeScript domain layer.
 *
 * The values are emitted in the same order as the source array, single-quoted,
 * and comma-separated with a single space — matching the existing hand-written
 * CHECK constraints byte-for-byte so existing constraints continue to match
 * after a schema diff.
 */

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_VALUE_RE = /^[A-Za-z0-9_]+$/;

/**
 * Build a `CHECK (<column> IN ('a', 'b', ...))` SQL fragment from a readonly
 * array of enum values.
 *
 * Throws at startup if any value or column name contains characters outside
 * the safe identifier/literal alphabet. This is intentionally strict: enum
 * values in this codebase are lowercase snake_case tokens, so anything else
 * is almost certainly a bug.
 */
export function sqlEnumCheck(
  column: string,
  values: readonly string[],
): string {
  if (!IDENTIFIER_RE.test(column)) {
    throw new Error(
      `sqlEnumCheck: unsafe column name ${JSON.stringify(column)}`,
    );
  }
  if (values.length === 0) {
    throw new Error('sqlEnumCheck: at least one value is required');
  }
  for (const v of values) {
    if (!SAFE_VALUE_RE.test(v)) {
      throw new Error(
        `sqlEnumCheck: unsafe enum value ${JSON.stringify(v)} for column ${column}`,
      );
    }
  }
  const list = values.map((v) => `'${v}'`).join(', ');
  return `CHECK (${column} IN (${list}))`;
}
