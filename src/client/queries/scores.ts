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
  type ScoreListFilters,
  type UpdateScoreInput,
} from '../api/scores';
import type { SessionUser } from '../api/types';
import { authUserKey, normalizeScoreListFilters, scoresKey } from './keys';
import {
  invalidateScoringDependents,
  type EventMutationScope,
} from './invalidation';
import { LIVE_QUERY } from './queryClient';

type ScoreScope = EventMutationScope & { scoreId?: number };

export function scoresQueryOptions(
  userId: number,
  eventId: number,
  filters: ScoreListFilters,
) {
  const normalized = normalizeScoreListFilters(filters);
  return queryOptions({
    queryKey: [...scoresKey(userId, eventId), normalized],
    queryFn: ({ signal }) => getEventScores(eventId, normalized, signal),
    ...LIVE_QUERY,
    placeholderData: (previousData, previousQuery) => {
      const prev = previousQuery?.queryKey;
      const prevFilters = prev?.[5] as typeof normalized | undefined;
      return previousData &&
        prev?.[1] === userId &&
        prev?.[3] === eventId &&
        prev?.[4] === 'scores' &&
        prevFilters?.limit === normalized.limit &&
        prevFilters?.status === normalized.status &&
        prevFilters?.scoreType === normalized.scoreType
        ? previousData
        : undefined;
    },
  });
}

export function useScoreMutations() {
  const client = useQueryClient();
  const refresh = (
    _data: unknown,
    scope: ScoreScope,
    derivedResults: boolean,
  ) => invalidateScoringDependents(client, scope, { derivedResults });
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
    mutationFn: submitJudgeScore,
    onSuccess: async (submission, variables) => {
      if (variables.eventId == null) return;
      const user = client.getQueryData<SessionUser | null>(authUserKey);
      await invalidateScoringDependents(
        client,
        {
          userId: user?.id,
          eventId: variables.eventId,
          generation: variables.sessionGeneration,
        },
        { derivedResults: submission.status === 'accepted' },
      );
    },
  });
}
