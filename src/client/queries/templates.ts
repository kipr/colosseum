import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  getPublicTemplates,
  getTemplates,
  getTemplate,
  getFieldTemplates,
  saveTemplate,
  deleteTemplate,
  saveFieldTemplate,
  deleteFieldTemplate,
  verifyTemplate,
} from '../api/templates';
import {
  publicTemplatesKey,
  templatesKey,
  templateDetailKey,
  fieldTemplatesKey,
} from './keys';
import {
  ADMIN_ONLY_QUERY_META,
  canUpdateUserCache,
  removeJudgeQueries,
} from './authorization';
import type { MutationScope } from './invalidation';
import { LIST_STALE_TIME_MS } from './queryClient';

export const publicTemplatesQueryOptions = () =>
  queryOptions({
    queryKey: publicTemplatesKey,
    queryFn: ({ signal }) => getPublicTemplates(signal),
    staleTime: LIST_STALE_TIME_MS,
  });
export const templatesQueryOptions = (userId: number, eventId?: number) =>
  queryOptions({
    queryKey: [...templatesKey(userId), { eventId: eventId ?? null }],
    queryFn: ({ signal }) => getTemplates(eventId, signal),
    staleTime: LIST_STALE_TIME_MS,
    meta: ADMIN_ONLY_QUERY_META,
  });
export const templateQueryOptions = (
  userId: number,
  templateId: number,
  isAdmin: boolean,
) =>
  queryOptions({
    queryKey: [
      ...templateDetailKey(userId, templateId),
      isAdmin ? 'admin' : 'staff',
    ],
    queryFn: ({ signal }) => getTemplate(templateId, signal),
    staleTime: LIST_STALE_TIME_MS,
    meta: { adminOnly: isAdmin },
  });
export const fieldTemplatesQueryOptions = (userId: number) =>
  queryOptions({
    queryKey: fieldTemplatesKey(userId),
    queryFn: ({ signal }) => getFieldTemplates(signal),
    staleTime: LIST_STALE_TIME_MS,
  });
export function useTemplateMutations() {
  const client = useQueryClient();
  const refresh = (
    _data: unknown,
    { userId, templateId }: MutationScope & { templateId?: number },
  ) => {
    if (!canUpdateUserCache(client, userId, true)) return;
    return Promise.all([
      client.invalidateQueries({ queryKey: templatesKey(userId) }),
      client.invalidateQueries({ queryKey: publicTemplatesKey }),
      ...(templateId == null
        ? []
        : [
            client.invalidateQueries({
              queryKey: templateDetailKey(userId, templateId),
            }),
          ]),
    ]);
  };
  const save = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (v: MutationScope & Parameters<typeof saveTemplate>[0]) =>
      saveTemplate(v),
    onSuccess: refresh,
  });
  const remove = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (v: MutationScope & { templateId: number }) =>
      deleteTemplate(v),
    onSuccess: (_, scope) => {
      client.removeQueries({
        queryKey: templateDetailKey(scope.userId, scope.templateId),
      });
      return refresh(_, scope);
    },
  });
  const refreshFields = (_data: unknown, { userId }: MutationScope) => {
    if (canUpdateUserCache(client, userId))
      return client.invalidateQueries({ queryKey: fieldTemplatesKey(userId) });
  };
  const saveField = useMutation({
    mutationFn: (v: MutationScope & Parameters<typeof saveFieldTemplate>[0]) =>
      saveFieldTemplate(v),
    onSuccess: refreshFields,
  });
  const removeField = useMutation({
    mutationFn: (v: MutationScope & { templateId: number }) =>
      deleteFieldTemplate(v),
    onSuccess: refreshFields,
  });
  return { save, remove, saveField, removeField };
}

export function useVerifyTemplateMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: verifyTemplate,
    onSuccess: () => removeJudgeQueries(client),
  });
}
