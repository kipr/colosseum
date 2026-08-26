import { z } from 'zod';
import {
  coercedPositiveId,
  mergePatch,
  nonEmptyObject,
  optionalNullablePositiveId,
  positiveId,
  trimmedNonEmptyString,
} from './primitives';

export const createBracketBodySchema = z
  .object({
    event_id: positiveId,
    name: trimmedNonEmptyString,
    bracket_size: z.number().int().positive().optional(),
    actual_team_count: z.number().int().positive().nullable().optional(),
    status: z.string().optional(),
    weight: z.number().gt(0).lte(1).optional(),
    team_ids: z.array(positiveId).optional(),
  })
  .strict();

export const bracketPatchBodySchema = nonEmptyObject(
  z.object({
    name: trimmedNonEmptyString.optional(),
    bracket_size: z.number().int().positive().optional(),
    actual_team_count: z.number().int().positive().nullable().optional(),
    status: z.string().optional(),
    weight: z.number().gt(0).lte(1).optional(),
  }),
);

export const bracketUpdateSchema = z
  .object({
    name: trimmedNonEmptyString,
    bracket_size: z.number().int().positive(),
    actual_team_count: z.number().int().positive().nullable(),
    status: z.string(),
    weight: z.number().gt(0).lte(1),
  })
  .strict();

export type BracketUpdate = z.infer<typeof bracketUpdateSchema>;

export const bracketIdParamsSchema = z
  .object({
    id: coercedPositiveId,
  })
  .strict();

export const createBracketRequest = { body: createBracketBodySchema };
export const patchBracketRequest = {
  params: bracketIdParamsSchema,
  body: bracketPatchBodySchema,
};
export const bracketIdRequest = { params: bracketIdParamsSchema };

export const advanceWinnerParamsSchema = z
  .object({
    id: coercedPositiveId,
  })
  .strict();

export const advanceWinnerBodySchema = z
  .object({
    game_id: positiveId,
    winner_id: positiveId,
  })
  .strict();

export const advanceWinnerRequest = {
  params: advanceWinnerParamsSchema,
  body: advanceWinnerBodySchema,
};

export const optionalPositiveId = optionalNullablePositiveId;

export function bracketRowToUpdateCandidate(row: {
  name: string;
  bracket_size: number;
  actual_team_count: number | null;
  status: string;
  weight: number;
}): BracketUpdate {
  return {
    name: row.name,
    bracket_size: Number(row.bracket_size),
    actual_team_count:
      row.actual_team_count == null ? null : Number(row.actual_team_count),
    status: row.status,
    weight: Number(row.weight),
  };
}

export function mergeBracketPatch(
  current: BracketUpdate,
  patch: z.infer<typeof bracketPatchBodySchema>,
): BracketUpdate {
  return mergePatch(current, patch);
}
