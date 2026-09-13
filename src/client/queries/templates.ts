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
  type MutationScope,
} from './invalidation';

export const publicTemplatesQueryOptions = () =>
  queryOptions({
    queryKey: publicTemplatesKey,
    queryFn: ({ signal }) => getPublicTemplates(signal),
    staleTime: 30_000,
  });
export const templatesQueryOptions = (userId: number, eventId?: number) =>
  queryOptions({
    queryKey: [...templatesKey(userId), { eventId: eventId ?? null }],
    queryFn: ({ signal }) => getTemplates(eventId, signal),
    staleTime: 30_000,
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
    staleTime: 30_000,
    meta: { adminOnly: isAdmin },
  });
export const fieldTemplatesQueryOptions = (userId: number) =>
  queryOptions({
    queryKey: fieldTemplatesKey(userId),
    queryFn: ({ signal }) => getFieldTemplates(signal),
    staleTime: 30_000,
  });
export function useTemplateMutations() {
  const client = useQueryClient();
  const refresh = async (
    _data: unknown,
    { userId, templateId }: MutationScope & { templateId?: number },
  ) => {
    if (!canUpdateUserCache(client, userId, true)) return;
    await Promise.all([
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
    onSuccess: async (_, scope) => {
      await client.cancelQueries({
        queryKey: templateDetailKey(scope.userId, scope.templateId),
      });
      client.removeQueries({
        queryKey: templateDetailKey(scope.userId, scope.templateId),
      });
      await refresh(_, scope);
    },
  });
  const refreshFields = async (_data: unknown, { userId }: MutationScope) => {
    if (canUpdateUserCache(client, userId))
      await client.invalidateQueries({ queryKey: fieldTemplatesKey(userId) });
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
