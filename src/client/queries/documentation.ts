import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  clearDocTeamScore,
  deleteDocCategory,
  getDocCategories,
  getDocScores,
  getGlobalDocCategories,
  getPublicDocumentation,
  importDocTeamScores,
  saveDocCategory,
  saveDocTeamScore,
  updateDocCategoryOrdinal,
} from '../api/documentation';
import {
  documentationKey,
  globalDocCategoriesKey,
  publicEventKey,
} from './keys';
import {
  ADMIN_ONLY_QUERY_META,
  invalidateDocumentationDependents,
  type EventMutationScope,
} from './invalidation';
import { LIST_STALE_TIME_MS, RESULT_STALE_TIME_MS } from './queryClient';

export function globalDocCategoriesQueryOptions(userId: number) {
  return queryOptions({
    queryKey: globalDocCategoriesKey(userId),
    queryFn: ({ signal }) => getGlobalDocCategories(signal),
    staleTime: LIST_STALE_TIME_MS,
    meta: ADMIN_ONLY_QUERY_META,
  });
}

export function docCategoriesQueryOptions(userId: number, eventId: number) {
  return queryOptions({
    queryKey: [...documentationKey(userId, eventId), 'categories'],
    queryFn: ({ signal }) => getDocCategories(eventId, signal),
    staleTime: LIST_STALE_TIME_MS,
    meta: ADMIN_ONLY_QUERY_META,
  });
}

export function docScoresQueryOptions(userId: number, eventId: number) {
  return queryOptions({
    queryKey: [...documentationKey(userId, eventId), 'scores'],
    queryFn: ({ signal }) => getDocScores(eventId, signal),
    staleTime: RESULT_STALE_TIME_MS,
    meta: ADMIN_ONLY_QUERY_META,
  });
}

export function publicDocumentationQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'documentation'],
    queryFn: ({ signal }) => getPublicDocumentation(eventId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function useDocumentationMutations() {
  const client = useQueryClient();
  const refresh = async (
    _data: unknown,
    scope: EventMutationScope,
    globalCategories = false,
  ) => {
    await invalidateDocumentationDependents(client, scope, {
      globalCategories,
    });
  };
  const saveCategory = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof saveDocCategory>[0],
    ) => saveDocCategory(v),
    onSuccess: (_, scope) => refresh(_, scope, true),
  });
  const updateCategory = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof updateDocCategoryOrdinal>[0],
    ) => updateDocCategoryOrdinal(v),
    onSuccess: refresh,
  });
  const removeCategory = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof deleteDocCategory>[0],
    ) => deleteDocCategory(v),
    onSuccess: (_, scope) => refresh(_, scope, true),
  });
  const saveScore = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof saveDocTeamScore>[0],
    ) => saveDocTeamScore(v),
    onSuccess: refresh,
  });
  const clearScore = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof clearDocTeamScore>[0],
    ) => clearDocTeamScore(v),
    onSuccess: refresh,
  });
  const bulkImport = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof importDocTeamScores>[0],
    ) => importDocTeamScores(v),
    onSuccess: async (results, scope) => {
      if (results.some((row) => row.ok)) await refresh(results, scope);
    },
  });
  return {
    saveCategory,
    updateCategory,
    removeCategory,
    saveScore,
    clearScore,
    bulkImport,
  };
}
