import { z } from 'zod';

/** JSON body IDs: integers > 0, no string coercion. */
export const positiveId = z.number().int().positive();

export const nullablePositiveId = positiveId.nullable();

export const optionalPositiveId = positiveId.optional();

export const optionalNullablePositiveId = positiveId.nullable().optional();

/**
 * Route and query parameters arrive as strings, so bounded coercion is
 * appropriate. Do not use this on JSON bodies.
 */
export const coercedPositiveId = z.coerce.number().int().positive();

export const idParamsSchema = z
  .object({
    id: coercedPositiveId,
  })
  .strict();

export const eventIdParamsSchema = z
  .object({
    eventId: coercedPositiveId,
  })
  .strict();

export const trimmedNonEmptyString = z.string().trim().min(1);

export const isoDateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

/**
 * Merge explicitly supplied patch keys onto a complete candidate.
 * Omitted keys (not present or `undefined`) leave the current value.
 */
export function mergePatch<T extends Record<string, unknown>>(
  current: T,
  patch: Partial<T>,
): T {
  const merged = { ...current };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (
      Object.prototype.hasOwnProperty.call(patch, key) &&
      patch[key] !== undefined
    ) {
      merged[key] = patch[key] as T[keyof T];
    }
  }
  return merged;
}
