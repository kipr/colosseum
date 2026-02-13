/**
 * Standardize how we store old_value/new_value in audit_log.
 * Avoids inconsistent double-stringification.
 */
export function toAuditJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}
