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
  invalidateEventDependents,
  invalidateQueueDependents,
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
  });
}

export function useScoreMutations() {
  const client = useQueryClient();
  const refresh = (_data: unknown, scope: ScoreScope) =>
    Promise.all([
      invalidateEventDependents(client, scope),
      invalidateQueueDependents(client, scope),
    ]);
  const accept = useMutation({
    mutationFn: (v: ScoreScope & { scoreId: number; force?: boolean }) =>
      acceptEventScore(v),
    onSuccess: refresh,
  });
  const previewRevert = useMutation({
    mutationFn: (v: ScoreScope & { scoreId: number }) =>
      revertEventScore({ ...v, dryRun: true }),
  });
  const revert = useMutation({
    mutationFn: (v: ScoreScope & { scoreId: number }) =>
      revertEventScore({ ...v, confirm: true }),
    onSuccess: refresh,
  });
  const reject = useMutation({
    mutationFn: (v: ScoreScope & { scoreId: number }) => rejectScore(v),
    onSuccess: refresh,
  });
  const bulkAccept = useMutation({
    mutationFn: (
      v: EventMutationScope & { eventId: number; scoreIds: number[] },
    ) => bulkAcceptEventScores(v),
    onSuccess: (result, scope) =>
      result.accepted > 0 ? refresh(result, scope) : undefined,
  });
  const update = useMutation({
    mutationFn: (v: ScoreScope & UpdateScoreInput) => updateScore(v),
    onSuccess: refresh,
  });
  return { accept, previewRevert, revert, reject, bulkAccept, update };
}

export function useJudgeScoreSubmitMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: submitJudgeScore,
    onSuccess: async (_submission, variables) => {
      if (variables.eventId == null) return;
      const user = client.getQueryData<SessionUser | null>(authUserKey);
      await Promise.all([
        invalidateEventDependents(client, {
          userId: user?.id,
          eventId: variables.eventId,
        }),
        invalidateQueueDependents(client, {
          userId: user?.id,
          eventId: variables.eventId,
          generation: variables.sessionGeneration,
        }),
      ]);
    },
  });
}
