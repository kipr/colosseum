import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  acceptEventScore,
  bulkAcceptEventScores,
  getEventScores,
  rejectScore,
  revertEventScore,
  submitJudgeScore,
  updateScore,
  type JudgeScoreSubmitInput,
  type ScoreListFilters,
  type UpdateScoreInput,
} from '../api/scores';
import type { SessionUser } from '../api/types';
import {
  authUserKey,
  judgeEventKey,
  normalizeScoreListFilters,
  scoresKey,
} from './keys';
import {
  invalidateScoringDependents,
  type EventMutationScope,
} from './invalidation';
import { POLL_INTERVAL_MS } from './queryClient';

type ScoreScope = EventMutationScope & { scoreId?: number };
type JudgeSubmitScope = JudgeScoreSubmitInput & {
  sessionGeneration: string;
  eventId?: number;
};

export function scoresQueryOptions(
  userId: number,
  eventId: number,
  filters: ScoreListFilters,
) {
  const normalized = normalizeScoreListFilters(filters);
  return queryOptions({
    queryKey: [...scoresKey(userId, eventId), normalized],
    queryFn: ({ signal }) => getEventScores(eventId, normalized, signal),
    staleTime: 0,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previousData, previousQuery) => {
      if (!previousData || !previousQuery) return undefined;
      const prev = previousQuery.queryKey;
      if (prev[1] !== userId || prev[3] !== eventId || prev[4] !== 'scores') {
        return undefined;
      }
      const prevFilters = prev[5] as typeof normalized | undefined;
      if (
        !prevFilters ||
        prevFilters.limit !== normalized.limit ||
        prevFilters.status !== normalized.status ||
        prevFilters.scoreType !== normalized.scoreType
      ) {
        return undefined;
      }
      return previousData;
    },
  });
}

export function useScoreMutations() {
  const client = useQueryClient();
  const refresh = async (
    _data: unknown,
    scope: ScoreScope,
    derivedResults: boolean,
  ) => {
    await invalidateScoringDependents(client, scope, { derivedResults });
  };
  const accept = useMutation({
    mutationFn: (v: ScoreScope & { scoreId: number; force?: boolean }) =>
      acceptEventScore(v),
    onSuccess: (data, scope) => refresh(data, scope, true),
  });
  const previewRevert = useMutation({
    mutationFn: (v: ScoreScope & { scoreId: number }) =>
      revertEventScore({ ...v, dryRun: true }),
  });
  const revert = useMutation({
    mutationFn: (v: ScoreScope & { scoreId: number }) =>
      revertEventScore({ ...v, confirm: true }),
    onSuccess: (data, scope) => refresh(data, scope, true),
  });
  const reject = useMutation({
    mutationFn: (v: ScoreScope & { scoreId: number }) => rejectScore(v),
    onSuccess: (data, scope) => refresh(data, scope, false),
  });
  const bulkAccept = useMutation({
    mutationFn: (
      v: EventMutationScope & { eventId: number; scoreIds: number[] },
    ) => bulkAcceptEventScores(v),
    onSuccess: (result, scope) => refresh(result, scope, result.accepted > 0),
  });
  const update = useMutation({
    mutationFn: (v: ScoreScope & UpdateScoreInput) => updateScore(v),
    onSuccess: (data, scope) => refresh(data, scope, false),
  });
  return { accept, previewRevert, revert, reject, bulkAccept, update };
}

export function useJudgeScoreSubmitMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: JudgeSubmitScope) =>
      submitJudgeScore({
        templateId: v.templateId,
        participantName: v.participantName,
        matchId: v.matchId,
        scoreData: v.scoreData,
        isHeadToHead: v.isHeadToHead,
        bracketSource: v.bracketSource,
        eventId: v.eventId,
        scoreType: v.scoreType,
        game_queue_id: v.game_queue_id,
        bracket_game_id: v.bracket_game_id,
        double_seeding_match_id: v.double_seeding_match_id,
        resultType: v.resultType,
        disqualifiedTeamId: v.disqualifiedTeamId,
        resultNote: v.resultNote,
      }),
    onSuccess: async (submission, variables) => {
      const eventId = variables.eventId;
      if (eventId == null) return;
      const user = client.getQueryData<SessionUser | null>(authUserKey);
      await invalidateScoringDependents(
        client,
        {
          userId: user?.id,
          eventId,
          generation: variables.sessionGeneration,
        },
        { derivedResults: submission.status === 'accepted' },
      );
    },
  });
}
