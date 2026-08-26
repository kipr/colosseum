import { z } from 'zod';

/** JSON body IDs: integers > 0, no string coercion. */
export const positiveId = z.number().int().positive();

export const trimmedNonEmptyString = z.string().trim().min(1);
