import { type Infer, z } from './schema';
import {
  coercedPositiveId,
  isoDateInput,
  mergePatch,
  trimmedNonEmptyString,
} from './primitives';

export const EVENT_STATUSES = [
  'setup',
  'active',
  'complete',
  'archived',
] as const;

export const SCORE_ACCEPT_MODES = [
  'manual',
  'auto_accept_seeding',
  'auto_accept_all',
] as const;

export const eventStatusSchema = z.enum(EVENT_STATUSES);
export const scoreAcceptModeSchema = z.enum(SCORE_ACCEPT_MODES);

const nullableString = z.string().nullable();
const spectatorReleasedSchema = z.union([z.literal(0), z.literal(1)]);

export const createEventBodySchema = z
  .object({
    name: trimmedNonEmptyString,
    description: nullableString.optional(),
    event_date: isoDateInput.nullable().optional(),
    location: nullableString.optional(),
    status: eventStatusSchema.optional().default('setup'),
    seeding_rounds: z.number().int().positive().optional().default(3),
    double_seeding_rounds: z.number().int().min(0).optional().default(0),
    min_rest_minutes: z.number().int().min(0).optional().default(3),
    score_accept_mode: scoreAcceptModeSchema.optional().default('manual'),
  })
  .strict();

export const eventPatchBodySchema = z
  .object({
    name: trimmedNonEmptyString.optional(),
    description: nullableString.optional(),
    event_date: isoDateInput.nullable().optional(),
    location: nullableString.optional(),
    status: eventStatusSchema.optional(),
    seeding_rounds: z.number().int().positive().optional(),
    double_seeding_rounds: z.number().int().min(0).optional(),
    min_rest_minutes: z.number().int().min(0).optional(),
    score_accept_mode: scoreAcceptModeSchema.optional(),
    spectator_results_released: spectatorReleasedSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'No valid fields to update',
  });

export const eventUpdateSchema = z
  .object({
    name: trimmedNonEmptyString,
    description: z.string().nullable(),
    event_date: isoDateInput.nullable(),
    location: z.string().nullable(),
    status: eventStatusSchema,
    seeding_rounds: z.number().int().positive(),
    double_seeding_rounds: z.number().int().min(0),
    min_rest_minutes: z.number().int().min(0),
    score_accept_mode: scoreAcceptModeSchema,
    spectator_results_released: spectatorReleasedSchema,
  })
  .strict();

export type EventUpdate = Infer<typeof eventUpdateSchema>;

export const eventIdParamsSchema = z
  .object({
    id: coercedPositiveId,
  })
  .strict();

export const createEventRequest = {
  body: createEventBodySchema,
};

export const patchEventRequest = {
  params: eventIdParamsSchema,
  body: eventPatchBodySchema,
};

export const eventIdRequest = {
  params: eventIdParamsSchema,
};

export function eventRowToUpdateCandidate(row: {
  name: string;
  description: string | null;
  event_date: string | Date | null;
  location: string | null;
  status: string;
  seeding_rounds: number;
  double_seeding_rounds: number;
  min_rest_minutes: number;
  score_accept_mode: string;
  spectator_results_released: number | boolean;
}): EventUpdate {
  const eventDate =
    row.event_date instanceof Date
      ? row.event_date.toISOString().slice(0, 10)
      : row.event_date;
  return {
    name: row.name,
    description: row.description,
    event_date: eventDate,
    location: row.location,
    status: row.status as EventUpdate['status'],
    seeding_rounds: Number(row.seeding_rounds),
    double_seeding_rounds: Number(row.double_seeding_rounds),
    min_rest_minutes: Number(row.min_rest_minutes),
    score_accept_mode:
      row.score_accept_mode as EventUpdate['score_accept_mode'],
    spectator_results_released: row.spectator_results_released ? 1 : 0,
  };
}

export function mergeEventPatch(
  current: EventUpdate,
  patch: Infer<typeof eventPatchBodySchema>,
): EventUpdate {
  return mergePatch(current, patch);
}
