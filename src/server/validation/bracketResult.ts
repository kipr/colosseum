import { z } from 'zod';
import { BRACKET_RESULT_TYPES } from '../../shared/bracketResult';

const positiveId = z.number().int().positive();
const optionalId = positiveId.nullable().optional();
const resultType = z.enum(BRACKET_RESULT_TYPES);
const resultNote = z.string().trim().max(1000).nullable().optional();

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

function validateResultFields(
  value: {
    resultType?: (typeof BRACKET_RESULT_TYPES)[number];
    disqualifiedTeamId?: number | null;
    resultNote?: string | null;
  },
  context: z.RefinementCtx,
): void {
  if (value.resultType === 'disqualification') {
    if (value.disqualifiedTeamId == null) {
      context.addIssue({
        code: 'custom',
        path: ['disqualifiedTeamId'],
        message: 'A disqualified team is required for a disqualification',
      });
    }
    if (!value.resultNote?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['resultNote'],
        message: 'A private reason or rule reference is required',
      });
    }
    return;
  }

  if (value.disqualifiedTeamId != null) {
    context.addIssue({
      code: 'custom',
      path: ['disqualifiedTeamId'],
      message: 'disqualifiedTeamId is only valid for a disqualification',
    });
  }
  if (value.resultNote?.trim()) {
    context.addIssue({
      code: 'custom',
      path: ['resultNote'],
      message: 'resultNote is only valid for a disqualification',
    });
  }
}

export const scoreSubmitBodySchema = z
  .object({
    templateId: positiveId,
    participantName: z.string().optional(),
    matchId: z.union([z.string(), z.number()]).optional(),
    scoreData: z.record(z.string(), z.unknown()),
    isHeadToHead: z.boolean().optional(),
    bracketSource: z.unknown().optional(),
    eventId: optionalId,
    scoreType: z.enum(['seeding', 'bracket', 'double_seeding']).optional(),
    game_queue_id: optionalId,
    bracket_game_id: optionalId,
    double_seeding_match_id: optionalId,
    resultType: resultType.default('standard'),
    disqualifiedTeamId: optionalId,
    resultNote,
  })
  .strict()
  .superRefine((value, context) => {
    validateResultFields(value, context);
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
  });

export const scoreIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

export const scoreUpdateBodySchema = z
  .object({
    scoreData: z.record(z.string(), z.unknown()),
    resultType: resultType.optional(),
    disqualifiedTeamId: optionalId,
    resultNote,
  })
  .strict()
  .superRefine(validateResultFields);

export const acceptEventBodySchema = z
  .object({ force: z.boolean().optional() })
  .strict();

export const revertEventBodySchema = z
  .object({
    dryRun: z.boolean().optional(),
    confirm: z.boolean().optional(),
  })
  .strict();

export const bulkAcceptParamsSchema = z
  .object({ eventId: z.coerce.number().int().positive() })
  .strict();

export const bulkAcceptBodySchema = z
  .object({ score_ids: z.array(positiveId).min(1) })
  .strict();

export const advanceWinnerParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

export const advanceWinnerBodySchema = z
  .object({ game_id: positiveId, winner_id: positiveId })
  .strict();
