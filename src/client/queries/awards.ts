import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type { AutomaticAwardSettings } from '../../shared/automaticAwards';
import {
  addAwardRecipients,
  addIndividualRecipient,
  applyAutomaticAwards,
  deleteAwardTemplate,
  deleteEventAward,
  getAutomaticAwardPreview,
  getAwardTemplates,
  getEventAwards,
  getPublicAwards,
  getTeamAwardCounts,
  removeAwardRecipient,
  removeIndividualRecipient,
  reorderEventAwards,
  saveAwardTemplate,
  saveEventAward,
} from '../api/awards';
import { awardTemplatesKey, awardsKey, publicEventKey } from './keys';
import { ADMIN_ONLY_QUERY_META, canUpdateUserCache } from './authorization';
import {
  invalidateEventDependents,
  type EventMutationScope,
  type MutationScope,
} from './invalidation';
import { LIST_STALE_TIME_MS } from './queryClient';

export function awardTemplatesQueryOptions(userId: number) {
  return queryOptions({
    queryKey: awardTemplatesKey(userId),
    queryFn: ({ signal }) => getAwardTemplates(signal),
    staleTime: LIST_STALE_TIME_MS,
    meta: ADMIN_ONLY_QUERY_META,
  });
}

export function eventAwardsQueryOptions(userId: number, eventId: number) {
  return queryOptions({
    queryKey: [...awardsKey(userId, eventId), 'event'],
    queryFn: ({ signal }) => getEventAwards(eventId, signal),
    staleTime: LIST_STALE_TIME_MS,
    meta: ADMIN_ONLY_QUERY_META,
  });
}

export function teamAwardCountsQueryOptions(userId: number, eventId: number) {
  return queryOptions({
    queryKey: [...awardsKey(userId, eventId), 'team-counts'],
    queryFn: ({ signal }) => getTeamAwardCounts(eventId, signal),
    staleTime: LIST_STALE_TIME_MS,
    meta: ADMIN_ONLY_QUERY_META,
  });
}

export function automaticAwardSettingsQueryOptions(
  userId: number,
  eventId: number,
) {
  return queryOptions({
    queryKey: [...awardsKey(userId, eventId), 'automatic-settings'],
    queryFn: ({ signal }) =>
      getAutomaticAwardPreview(eventId, undefined, signal),
    meta: ADMIN_ONLY_QUERY_META,
  });
}

export function automaticAwardPreviewQueryOptions(
  userId: number,
  eventId: number,
  settings: AutomaticAwardSettings,
) {
  return queryOptions({
    queryKey: [...awardsKey(userId, eventId), 'automatic-preview', settings],
    queryFn: ({ signal }) =>
      getAutomaticAwardPreview(eventId, settings, signal),
    meta: ADMIN_ONLY_QUERY_META,
  });
}

export function publicAwardsQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'awards'],
    queryFn: ({ signal }) => getPublicAwards(eventId, signal),
  });
}

export function useAwardMutations() {
  const client = useQueryClient();
  const refreshEvent = (_data: unknown, scope: EventMutationScope) =>
    invalidateEventDependents(client, scope);
  const refreshTemplates = (_data: unknown, { userId }: MutationScope) => {
    if (!canUpdateUserCache(client, userId, true)) return;
    return client.invalidateQueries({ queryKey: awardTemplatesKey(userId) });
  };
  const saveTemplate = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (v: MutationScope & Parameters<typeof saveAwardTemplate>[0]) =>
      saveAwardTemplate(v),
    onSuccess: refreshTemplates,
  });
  const removeTemplate = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (v: MutationScope & { templateId: number }) =>
      deleteAwardTemplate(v),
    onSuccess: refreshTemplates,
  });
  const saveAward = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof saveEventAward>[0],
    ) => saveEventAward(v),
    onSuccess: refreshEvent,
  });
  const removeAward = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (v: EventMutationScope & { awardId: number }) =>
      deleteEventAward(v),
    onSuccess: refreshEvent,
  });
  const addRecipients = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof addAwardRecipients>[0],
    ) => addAwardRecipients(v),
    onSuccess: refreshEvent,
  });
  const removeRecipient = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof removeAwardRecipient>[0],
    ) => removeAwardRecipient(v),
    onSuccess: refreshEvent,
  });
  const addIndividual = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof addIndividualRecipient>[0],
    ) => addIndividualRecipient(v),
    onSuccess: refreshEvent,
  });
  const removeIndividual = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof removeIndividualRecipient>[0],
    ) => removeIndividualRecipient(v),
    onSuccess: refreshEvent,
  });
  const applyAutomatic = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof applyAutomaticAwards>[0],
    ) => applyAutomaticAwards(v),
    onSuccess: refreshEvent,
  });
  const reorder = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof reorderEventAwards>[0],
    ) => reorderEventAwards(v),
    onSuccess: (results, scope) =>
      results.some((row) => row.ok) ? refreshEvent(results, scope) : undefined,
  });
  return {
    saveTemplate,
    removeTemplate,
    saveAward,
    removeAward,
    addRecipients,
    removeRecipient,
    addIndividual,
    removeIndividual,
    applyAutomatic,
    reorder,
  };
}
