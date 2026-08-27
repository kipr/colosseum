import { z } from './schema';
import {
  coercedPositiveId,
  mergePatch,
  nonEmptyObject,
  optionalNullablePositiveId,
  positiveId,
} from './primitives';

export const createSeedingScoreBodySchema = z
  .object({
    team_id: positiveId,
    round_number: z.number().int().positive(),
    score: z.number().int().nullable().optional(),
    score_submission_id: optionalNullablePositiveId,
  })
  .strict();

export const seedingScorePatchBodySchema = nonEmptyObject(
  z.object({
    score: z.number().int().nullable().optional(),
    score_submission_id: optionalNullablePositiveId,
    scored_at: z.string().nullable().optional(),
  }),
);

export const seedingScoreUpdateSchema = z
  .object({
    score: z.number().int().nullable(),
    score_submission_id: positiveId.nullable(),
    scored_at: z.string().nullable(),
  })
  .strict();

export type SeedingScoreUpdate = z.infer<typeof seedingScoreUpdateSchema>;

export const seedingScoreIdParamsSchema = z
  .object({
    id: coercedPositiveId,
  })
  .strict();

export const createSeedingScoreRequest = {
  body: createSeedingScoreBodySchema,
};
export const patchSeedingScoreRequest = {
  params: seedingScoreIdParamsSchema,
  body: seedingScorePatchBodySchema,
};
export const seedingScoreIdRequest = { params: seedingScoreIdParamsSchema };

export function seedingScoreRowToUpdateCandidate(row: {
  score: number | null;
  score_submission_id: number | null;
  scored_at: string | Date | null;
}): SeedingScoreUpdate {
  const scoredAt =
    row.scored_at instanceof Date ? row.scored_at.toISOString() : row.scored_at;
  return {
    score: row.score == null ? null : Number(row.score),
    score_submission_id:
      row.score_submission_id == null ? null : Number(row.score_submission_id),
    scored_at: scoredAt,
  };
}

export function mergeSeedingScorePatch(
  current: SeedingScoreUpdate,
  patch: z.infer<typeof seedingScorePatchBodySchema>,
): SeedingScoreUpdate {
  return mergePatch(current, patch);
}
