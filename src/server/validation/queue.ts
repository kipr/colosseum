import { type Infer, z } from './schema';
import { QUEUE_STATUSES } from '../constants/queueStatus';
import {
  coercedPositiveId,
  mergePatch,
  nonEmptyObject,
  optionalNullablePositiveId,
  positiveId,
} from './primitives';

const queueTypeFields = {
  event_id: positiveId,
  queue_position: z.number().int().min(0).optional(),
  table_number: z.number().int().positive().nullable().optional(),
} as const;

export const createQueueItemBodySchema = z.discriminatedUnion('queue_type', [
  z
    .object({
      ...queueTypeFields,
      queue_type: z.literal('bracket'),
      bracket_game_id: positiveId,
      seeding_team_id: z.null().optional(),
      seeding_round: z.null().optional(),
      double_seeding_match_id: z.null().optional(),
    })
    .strict(),
  z
    .object({
      ...queueTypeFields,
      queue_type: z.literal('seeding'),
      seeding_team_id: positiveId,
      seeding_round: z.number().int().positive(),
      bracket_game_id: z.null().optional(),
      double_seeding_match_id: z.null().optional(),
    })
    .strict(),
  z
    .object({
      ...queueTypeFields,
      queue_type: z.literal('double_seeding'),
      double_seeding_match_id: positiveId,
      bracket_game_id: z.null().optional(),
      seeding_team_id: z.null().optional(),
      seeding_round: z.null().optional(),
    })
    .strict(),
]);

export const queuePresenceBodySchema = z
  .object({
    team_id: positiveId,
    present: z.boolean(),
  })
  .strict();

export const queuePatchBodySchema = nonEmptyObject(
  z.object({
    status: z.enum(QUEUE_STATUSES).optional(),
    table_number: z.number().int().positive().nullable().optional(),
  }),
);

export const queueItemUpdateSchema = z
  .object({
    status: z.enum(QUEUE_STATUSES),
    table_number: z.number().int().positive().nullable(),
  })
  .strict();

export type QueueItemUpdate = Infer<typeof queueItemUpdateSchema>;

export const queueCallBodySchema = z
  .object({
    table_number: z.number().int().positive().optional(),
  })
  .strict();

export const populateFromSeedingBodySchema = z
  .object({
    event_id: positiveId,
  })
  .strict();

export const populateFromBracketBodySchema = z
  .object({
    event_id: positiveId,
    bracket_id: optionalNullablePositiveId,
  })
  .strict();

export const queueIdParamsSchema = z
  .object({
    id: coercedPositiveId,
  })
  .strict();

export const createQueueItemRequest = { body: createQueueItemBodySchema };
export const queuePresenceRequest = {
  params: queueIdParamsSchema,
  body: queuePresenceBodySchema,
};
export const patchQueueItemRequest = {
  params: queueIdParamsSchema,
  body: queuePatchBodySchema,
};
export const callQueueItemRequest = {
  params: queueIdParamsSchema,
  body: queueCallBodySchema,
};
export const queueIdRequest = { params: queueIdParamsSchema };
export const populateFromSeedingRequest = {
  body: populateFromSeedingBodySchema,
};
export const populateFromBracketRequest = {
  body: populateFromBracketBodySchema,
};

export function queueRowToUpdateCandidate(row: {
  status: string;
  table_number: number | null;
}): QueueItemUpdate {
  return {
    status: row.status as QueueItemUpdate['status'],
    table_number: row.table_number == null ? null : Number(row.table_number),
  };
}

export function mergeQueuePatch(
  current: QueueItemUpdate,
  patch: Infer<typeof queuePatchBodySchema>,
): QueueItemUpdate {
  return mergePatch(current, patch);
}
