import { describe, expect, it } from 'vitest';
import { getApiError, getApiErrorMessage } from '../../../src/shared/apiError';
import {
  acceptEventBodySchema,
  bulkAcceptBodySchema,
  bulkAcceptParamsSchema,
  revertEventBodySchema,
  scoreIdParamsSchema,
  scoreSubmitBodySchema,
  scoreUpdateBodySchema,
} from '../../../src/server/validation/scores';
import { advanceWinnerBodySchema } from '../../../src/server/validation/brackets';

function issuePaths(result: {
  success: false;
  error: { issues: Array<{ path: PropertyKey[] }> };
}) {
  return result.error.issues.map((issue) => issue.path.map(String).join('.'));
}

const seedingSubmit = {
  templateId: 1,
  scoreData: { points: 10 },
  eventId: 1,
  scoreType: 'seeding' as const,
  resultType: 'standard' as const,
};

const bracketWinnerData = {
  winner_team_id: { value: 2, type: 'number', label: 'Winner' },
};

describe('getApiErrorMessage', () => {
  it('reads nested error.message', () => {
    expect(
      getApiErrorMessage({
        error: { code: 'VALIDATION_FAILED', message: 'Bad payload' },
      }),
    ).toBe('Bad payload');
  });

  it('reads legacy string error', () => {
    expect(getApiErrorMessage({ error: 'Legacy' })).toBe('Legacy');
    expect(getApiError({ error: 'Legacy' })?.code).toBe('INVALID_STATE');
  });
});

describe('scoreSubmitBodySchema', () => {
  it('accepts the smallest valid seeding request', () => {
    const result = scoreSubmitBodySchema.safeParse(seedingSubmit);
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated standard bracket request', () => {
    const result = scoreSubmitBodySchema.safeParse({
      templateId: 1,
      participantName: 'Judge A',
      matchId: 'W1',
      scoreData: bracketWinnerData,
      isHeadToHead: true,
      eventId: 4,
      scoreType: 'bracket',
      game_queue_id: 9,
      bracket_game_id: 3,
      resultType: 'standard',
      disqualifiedTeamId: null,
      resultNote: null,
    });
    expect(result.success).toBe(true);
  });

  it.each(['standard', 'no_contest', 'disqualification'] as const)(
    'accepts resultType %s when fields match the variant',
    (resultType) => {
      const body =
        resultType === 'disqualification'
          ? {
              ...seedingSubmit,
              scoreType: 'bracket' as const,
              bracket_game_id: 1,
              scoreData: {},
              resultType,
              disqualifiedTeamId: 5,
              resultNote: 'Rule 4.2',
            }
          : {
              ...seedingSubmit,
              scoreType: 'bracket' as const,
              bracket_game_id: 1,
              scoreData: bracketWinnerData,
              resultType,
            };
      expect(scoreSubmitBodySchema.safeParse(body).success).toBe(true);
    },
  );

  it('rejects a missing resultType', () => {
    const { resultType: _resultType, ...rest } = seedingSubmit;
    const result = scoreSubmitBodySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        issuePaths(result).some((path) => path.includes('resultType')),
      ).toBe(true);
    }
  });

  it('rejects missing required fields', () => {
    const result = scoreSubmitBodySchema.safeParse({ resultType: 'standard' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = issuePaths(result);
      expect(paths).toEqual(
        expect.arrayContaining(['templateId', 'scoreData']),
      );
    }
  });

  it('rejects a string templateId', () => {
    const result = scoreSubmitBodySchema.safeParse({
      ...seedingSubmit,
      templateId: '1',
    });
    expect(result.success).toBe(false);
  });

  it.each([0, -1, 1.5])('rejects templateId %s', (templateId) => {
    expect(
      scoreSubmitBodySchema.safeParse({ ...seedingSubmit, templateId }).success,
    ).toBe(false);
  });

  it('rejects an empty DQ reason', () => {
    const result = scoreSubmitBodySchema.safeParse({
      templateId: 1,
      scoreData: {},
      scoreType: 'bracket',
      bracket_game_id: 1,
      resultType: 'disqualification',
      disqualifiedTeamId: 2,
      resultNote: '   ',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result)).toContain('resultNote');
    }
  });

  it('trims a DQ reason', () => {
    const result = scoreSubmitBodySchema.safeParse({
      templateId: 1,
      scoreData: {},
      scoreType: 'bracket',
      bracket_game_id: 1,
      resultType: 'disqualification',
      disqualifiedTeamId: 2,
      resultNote: '  Rule 4.2  ',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.resultType === 'disqualification') {
      expect(result.data.resultNote).toBe('Rule 4.2');
      expect(result.data.disqualifiedTeamId).toBe(2);
    }
  });

  it('rejects unknown keys', () => {
    const result = scoreSubmitBodySchema.safeParse({
      ...seedingSubmit,
      unexpected: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.code === 'unrecognized_keys'),
      ).toBe(true);
    }
  });

  it('rejects a DQ on a seeding score', () => {
    const result = scoreSubmitBodySchema.safeParse({
      ...seedingSubmit,
      resultType: 'disqualification',
      disqualifiedTeamId: 1,
      resultNote: 'reason',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result)).toContain('resultType');
    }
  });

  it('rejects a standard bracket score without a winner', () => {
    const result = scoreSubmitBodySchema.safeParse({
      templateId: 1,
      scoreData: {},
      scoreType: 'bracket',
      bracket_game_id: 1,
      resultType: 'standard',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuePaths(result)).toContain('scoreData.winner_team_id');
    }
  });

  it('rejects DQ fields on a standard result', () => {
    const result = scoreSubmitBodySchema.safeParse({
      ...seedingSubmit,
      disqualifiedTeamId: 3,
    });
    expect(result.success).toBe(false);
  });

  it('reports multiple issues together', () => {
    const result = scoreSubmitBodySchema.safeParse({
      templateId: 0,
      scoreType: 'bracket',
      resultType: 'disqualification',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(1);
    }
  });
});

describe('scoreUpdateBodySchema', () => {
  it('requires a complete result variant', () => {
    expect(
      scoreUpdateBodySchema.safeParse({ scoreData: { total: 1 } }).success,
    ).toBe(false);
  });

  it('accepts a full standard replacement', () => {
    const result = scoreUpdateBodySchema.safeParse({
      scoreData: { total: 1 },
      resultType: 'standard',
      disqualifiedTeamId: null,
      resultNote: null,
    });
    expect(result.success).toBe(true);
  });

  it('narrows DQ fields', () => {
    const result = scoreUpdateBodySchema.safeParse({
      scoreData: {},
      resultType: 'disqualification',
      disqualifiedTeamId: 4,
      resultNote: 'Rule 1',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.resultType === 'disqualification') {
      expect(result.data.disqualifiedTeamId).toBe(4);
      expect(result.data.resultNote).toBe('Rule 1');
    }
  });
});

describe('smaller score schemas', () => {
  it('coerces score id params', () => {
    const result = scoreIdParamsSchema.safeParse({ id: '12' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe(12);
  });

  it('rejects id 0', () => {
    expect(scoreIdParamsSchema.safeParse({ id: '0' }).success).toBe(false);
  });

  it('accepts optional accept/revert flags and rejects unknown keys', () => {
    expect(acceptEventBodySchema.safeParse({}).success).toBe(true);
    expect(acceptEventBodySchema.safeParse({ force: true }).success).toBe(true);
    expect(acceptEventBodySchema.safeParse({ force: 'yes' }).success).toBe(
      false,
    );
    expect(revertEventBodySchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('requires a non-empty score_ids array of positive ids', () => {
    expect(bulkAcceptBodySchema.safeParse({ score_ids: [] }).success).toBe(
      false,
    );
    expect(bulkAcceptBodySchema.safeParse({ score_ids: [1, 2] }).success).toBe(
      true,
    );
    expect(bulkAcceptParamsSchema.safeParse({ eventId: '3' }).success).toBe(
      true,
    );
  });
});

describe('advanceWinnerBodySchema', () => {
  it('requires numeric game and winner ids', () => {
    expect(
      advanceWinnerBodySchema.safeParse({ game_id: 1, winner_id: 2 }).success,
    ).toBe(true);
    expect(
      advanceWinnerBodySchema.safeParse({ game_id: '1', winner_id: 2 }).success,
    ).toBe(false);
  });
});
