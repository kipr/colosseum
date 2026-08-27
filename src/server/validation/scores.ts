import { z, type RefinementCtx } from './schema';
import { BRACKET_RESULT_TYPES } from '../../shared/bracketResult';
import {
  coercedPositiveId,
  optionalNullablePositiveId,
  positiveId,
} from './primitives';

const scoreDataSchema = z.record(z.string(), z.unknown());

const standardResultFields = {
  resultType: z.literal('standard'),
  disqualifiedTeamId: z.null().optional(),
  resultNote: z.null().optional(),
} as const;

const noContestResultFields = {
  resultType: z.literal('no_contest'),
  disqualifiedTeamId: z.null().optional(),
  resultNote: z.null().optional(),
} as const;

const disqualificationResultFields = {
  resultType: z.literal('disqualification'),
  disqualifiedTeamId: positiveId,
  resultNote: z.string().trim().min(1).max(1000),
} as const;

function hasWinnerTeamId(scoreData: Record<string, unknown>): boolean {
  for (const key of ['winner_team_id', 'winner_id']) {
    const entry = scoreData[key];
    if (
      entry &&
      typeof entry === 'object' &&
      'value' in entry &&
      typeof entry.value === 'number' &&
      Number.isInteger(entry.value) &&
      entry.value > 0
    ) {
      return true;
    }
  }
  return false;
}

const scoreSubmitCommon = {
  templateId: positiveId,
  participantName: z.string().optional(),
  matchId: z.union([z.string(), z.number()]).optional(),
  scoreData: scoreDataSchema,
  isHeadToHead: z.boolean().optional(),
  bracketSource: z.unknown().optional(),
  eventId: optionalNullablePositiveId,
  scoreType: z.enum(['seeding', 'bracket', 'double_seeding']).optional(),
  game_queue_id: optionalNullablePositiveId,
  bracket_game_id: optionalNullablePositiveId,
  double_seeding_match_id: optionalNullablePositiveId,
} as const;

function refineScoreSubmit(
  value: {
    resultType: (typeof BRACKET_RESULT_TYPES)[number];
    scoreType?: 'seeding' | 'bracket' | 'double_seeding';
    scoreData: Record<string, unknown>;
  },
  context: RefinementCtx,
): void {
  if (value.resultType !== 'standard' && value.scoreType !== 'bracket') {
    context.addIssue({
      code: 'custom',
      path: ['resultType'],
      message: 'Special results are only supported for bracket scores',
    });
  }
  if (
    value.scoreType === 'bracket' &&
    value.resultType !== 'disqualification' &&
    !hasWinnerTeamId(value.scoreData)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['scoreData', 'winner_team_id'],
      message: 'A bracket winner is required',
    });
  }
}

export const scoreSubmitBodySchema = z
  .discriminatedUnion('resultType', [
    z.object({ ...scoreSubmitCommon, ...standardResultFields }).strict(),
    z.object({ ...scoreSubmitCommon, ...noContestResultFields }).strict(),
    z
      .object({ ...scoreSubmitCommon, ...disqualificationResultFields })
      .strict(),
  ])
  .superRefine(refineScoreSubmit);

export const scoreIdParamsSchema = z
  .object({
    id: coercedPositiveId,
  })
  .strict();

const scoreUpdateCommon = {
  scoreData: scoreDataSchema,
} as const;

export const scoreUpdateBodySchema = z.discriminatedUnion('resultType', [
  z.object({ ...scoreUpdateCommon, ...standardResultFields }).strict(),
  z.object({ ...scoreUpdateCommon, ...noContestResultFields }).strict(),
  z.object({ ...scoreUpdateCommon, ...disqualificationResultFields }).strict(),
]);

export const acceptEventBodySchema = z
  .object({
    force: z.boolean().optional(),
  })
  .strict();

export const revertEventBodySchema = z
  .object({
    dryRun: z.boolean().optional(),
    confirm: z.boolean().optional(),
  })
  .strict();

export const bulkAcceptParamsSchema = z
  .object({
    eventId: coercedPositiveId,
  })
  .strict();

export const bulkAcceptBodySchema = z
  .object({
    score_ids: z.array(positiveId).min(1),
  })
  .strict();

export const scoreSubmitRequest = {
  body: scoreSubmitBodySchema,
};

export const scoreUpdateRequest = {
  params: scoreIdParamsSchema,
  body: scoreUpdateBodySchema,
};

export const acceptEventRequest = {
  params: scoreIdParamsSchema,
  body: acceptEventBodySchema,
};

export const revertEventRequest = {
  params: scoreIdParamsSchema,
  body: revertEventBodySchema,
};

export const bulkAcceptRequest = {
  params: bulkAcceptParamsSchema,
  body: bulkAcceptBodySchema,
};

export const scoreIdRequest = {
  params: scoreIdParamsSchema,
};
