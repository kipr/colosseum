export const CANONICAL_SCHEMA_VERSION = 1 as const;

export function canonicalSchema(
  partial: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    fields: [],
    ...partial,
  };
}
