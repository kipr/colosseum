/**
 * Parse a value from a TEXT or JSON/JSONB column.
 *
 * `pg` returns TEXT as a string and JSON/JSONB as an already-parsed object.
 * Callers that always `JSON.parse` a column will throw (and often null out
 * the payload) when the driver already deserialized it.
 */
export function parseStoredJson<T = unknown>(value: unknown): T {
  if (value == null) {
    throw new SyntaxError('Missing JSON value');
  }
  if (typeof value === 'object') {
    return value as T;
  }
  if (typeof value !== 'string') {
    throw new SyntaxError(`Cannot parse JSON from ${typeof value}`);
  }
  return JSON.parse(value) as T;
}

export function tryParseStoredJson<T = unknown>(value: unknown): T | null {
  try {
    return parseStoredJson<T>(value);
  } catch {
    return null;
  }
}
