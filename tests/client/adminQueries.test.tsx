// @vitest-environment jsdom
import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  QueryClientProvider,
  focusManager,
  useQuery,
} from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  createTestQueryClient,
  createQueryWrapper,
  jsonResponse,
  jsonErrorResponse,
  registerQueryTestCleanup,
  renderWithQuery,
} from './helpers/queryTestUtils';
import {
  adminEventsKey,
  authUserKey,
  fieldTemplatesKey,
  publicTemplatesKey,
  templateDetailKey,
  teamsKey,
} from '../../src/client/queries/keys';
import {
  teamsQueryOptions,
  useTeamMutations,
} from '../../src/client/queries/teams';
import { useEventMutations } from '../../src/client/queries/events';
import {
  fieldTemplatesQueryOptions,
  templateQueryOptions,
  templatesQueryOptions,
  useTemplateMutations,
} from '../../src/client/queries/templates';
import { adminUsersQueryOptions } from '../../src/client/queries/admins';
import {
  removeAdminOnlyQueries,
  removeAdminUserQueries,
} from '../../src/client/queries/invalidation';
import FieldTemplateModal from '../../src/client/components/admin/FieldTemplateModal';
import TemplateEditorModal from '../../src/client/components/admin/TemplateEditorModal';
import type { Event } from '../../src/client/utils/eventStatus';

const auth = vi.hoisted(() => ({
  user: { id: 1, isAdmin: true },
  loading: false,
}));
vi.mock('../../src/client/contexts/AuthContext', () => ({
  useAuth: () => auth,
}));
registerQueryTestCleanup();

function clientWithUser() {
  const client = createTestQueryClient();
  client.setQueryData(authUserKey, auth.user);
  return client;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const event = { id: 10, name: 'New event', status: 'setup' } as Event;
const fields = [{ id: 'points', label: 'Points', type: 'number' }];
const fieldTemplate = {
  id: 5,
  name: 'Original',
  description: '',
  created_at: '',
  fields,
};
const template = {
  id: 5,
  name: 'Original',
  description: '',
  access_code: 'secret',
  schema: { fields },
};

describe('stage three queries and writes', () => {
  it('shares the complete field-template list across consumers and parses stored fields once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          ...fieldTemplate,
          fields: undefined,
          fields_json: JSON.stringify(fields),
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = clientWithUser();
    const wrapper = createQueryWrapper({ queryClient: client });
    const first = renderHook(() => useQuery(fieldTemplatesQueryOptions(1)), {
      wrapper,
    });
    const second = renderHook(() => useQuery(fieldTemplatesQueryOptions(1)), {
      wrapper,
    });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(first.result.current.data?.[0].fields).toEqual(fields);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancels superseded team reads and separates events and server filters', async () => {
    let firstSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options) => {
        if (!firstSignal) {
          firstSignal = options.signal;
          return new Promise<Response>((_resolve, reject) =>
            options.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            ),
          );
        }
        return Promise.resolve(
          jsonResponse([{ id: 20, team_name: 'Event B' }]),
        );
      }),
    );
    const client = clientWithUser();
    const hook = renderHook(
      ({ eventId }) => useQuery(teamsQueryOptions(1, eventId, 'registered')),
      {
        initialProps: { eventId: 10 },
        wrapper: createQueryWrapper({ queryClient: client }),
      },
    );
    hook.rerender({ eventId: 20 });
    await waitFor(() =>
      expect(hook.result.current.data?.[0].team_name).toBe('Event B'),
    );
    expect(firstSignal?.aborted).toBe(true);
    expect(
      client.getQueryData([...teamsKey(1, 10), { status: 'registered' }]),
    ).toBeUndefined();
    expect(teamsQueryOptions(1, 20, 'all').queryKey).not.toEqual(
      teamsQueryOptions(1, 20, 'registered').queryKey,
    );
  });

  it('invalidates all originating team filters after unmount and partial bulk success', async () => {
    const response = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response.promise),
    );
    const client = clientWithUser();
    const origin = teamsQueryOptions(1, 10, 'all').queryKey;
    const filtered = teamsQueryOptions(1, 10, 'registered').queryKey;
    const other = teamsQueryOptions(1, 20).queryKey;
    for (const key of [origin, filtered, other]) client.setQueryData(key, []);
    const hook = renderHook(() => useTeamMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    let result!: Promise<unknown>;
    act(() => {
      result = hook.result.current.bulkImport.mutateAsync({
        userId: 1,
        eventId: 10,
        teams: [{ team_number: 1, team_name: 'A' }],
      });
    });
    hook.unmount();
    response.resolve(
      jsonResponse({ created: 1, errors: [{ index: 1, error: 'Duplicate' }] }),
    );
    await expect(result).resolves.toEqual({
      created: 1,
      errors: [{ index: 1, error: 'Duplicate' }],
    });
    expect(client.getQueryState(origin)?.isInvalidated).toBe(true);
    expect(client.getQueryState(filtered)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  });

  it('does not recreate protected data when an event write finishes after logout', async () => {
    const response = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response.promise),
    );
    const client = clientWithUser();
    const hook = renderHook(() => useEventMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    let result!: Promise<unknown>;
    act(() => {
      result = hook.result.current.save.mutateAsync({
        userId: 1,
        data: { name: event.name },
      });
    });
    client.setQueryData(authUserKey, null);
    await removeAdminUserQueries(client, 1);
    response.resolve(jsonResponse(event));
    await act(async () => {
      await result;
    });
    expect(client.getQueryData(adminEventsKey(1))).toBeUndefined();
  });

  it('makes a successful event immediately selectable while its list refresh is delayed', async () => {
    const refresh = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options) =>
        options.method === 'POST'
          ? Promise.resolve(jsonResponse(event))
          : refresh.promise,
      ),
    );
    const client = clientWithUser();
    client.setQueryData(adminEventsKey(1), []);
    const hook = renderHook(
      () => {
        const list = useQuery({
          queryKey: adminEventsKey(1),
          queryFn: async ({ signal }) =>
            (await fetch('/events', { signal })).json(),
          staleTime: Infinity,
        });
        return { list, ...useEventMutations() };
      },
      { wrapper: createQueryWrapper({ queryClient: client }) },
    );
    await act(async () => {
      await hook.result.current.save.mutateAsync({
        userId: 1,
        data: { name: event.name },
      });
    });
    expect(client.getQueryData(adminEventsKey(1))).toEqual([event]);
    expect(hook.result.current.save.isPending).toBe(false);
    refresh.resolve(jsonResponse([event]));
  });

  it('keeps a successful write successful when the essential team refresh fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options) =>
        Promise.resolve(
          options.method === 'POST'
            ? jsonResponse({ id: 1 })
            : jsonErrorResponse(500),
        ),
      ),
    );
    const client = clientWithUser();
    const key = teamsQueryOptions(1, 10).queryKey;
    client.setQueryData(key, [{ id: 1, team_name: 'Previously loaded' }]);
    const hook = renderHook(
      () => ({
        query: useQuery(teamsQueryOptions(1, 10)),
        ...useTeamMutations(),
      }),
      { wrapper: createQueryWrapper({ queryClient: client }) },
    );
    await act(async () => {
      await hook.result.current.save.mutateAsync({
        userId: 1,
        eventId: 10,
        data: { team_number: 1, team_name: 'Changed' },
      });
    });
    await waitFor(() => expect(hook.result.current.query.isError).toBe(true));
    expect(hook.result.current.save.isSuccess).toBe(true);
    expect(hook.result.current.query.data?.[0].team_name).toBe(
      'Previously loaded',
    );
  });

  it('refreshes all template associations, including unfiltered lists and public discovery', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(template)));
    const client = clientWithUser();
    const keys = [
      templatesQueryOptions(1, 10).queryKey,
      templatesQueryOptions(1, 20).queryKey,
      templatesQueryOptions(1).queryKey,
      publicTemplatesKey,
    ];
    for (const key of keys) client.setQueryData(key, []);
    const hook = renderHook(() => useTemplateMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    await act(async () => {
      await hook.result.current.save.mutateAsync({
        userId: 1,
        eventId: 20,
        templateId: 5,
        data: {
          name: 'Moved',
          description: '',
          accessCode: '',
          schema: { fields: [] },
        },
      });
    });
    for (const key of keys)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(templatesQueryOptions(1).queryKey).not.toEqual(
      templatesQueryOptions(1, 10).queryKey,
    );
  });

  it('evicts privileged details on demotion and ignores late privileged mutation results', async () => {
    const response = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response.promise),
    );
    const client = clientWithUser();
    const adminOptions = templateQueryOptions(1, 5, true);
    const staffOptions = templateQueryOptions(1, 5, false);
    client.getQueryCache().build(client, adminOptions).setData(template);
    client
      .getQueryCache()
      .build(client, staffOptions)
      .setData({ ...template, access_code: undefined });
    const hook = renderHook(() => useTemplateMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    let result!: Promise<unknown>;
    act(() => {
      result = hook.result.current.save.mutateAsync({
        userId: 1,
        eventId: 10,
        templateId: 5,
        data: {
          name: 'Changed',
          description: '',
          accessCode: 'secret',
          schema: {},
        },
      });
    });
    client.setQueryData(authUserKey, { id: 1, isAdmin: false });
    await removeAdminOnlyQueries(client, 1);
    response.resolve(jsonResponse(template));
    await act(async () => {
      await result;
    });
    expect(client.getQueryData(adminOptions.queryKey)).toBeUndefined();
    expect(client.getQueryData(staffOptions.queryKey)).toBeDefined();
    expect(client.getQueryState(staffOptions.queryKey)?.isInvalidated).toBe(
      false,
    );
  });

  it('revalidates authentication after a privileged read is rejected without evicting staff data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonErrorResponse(403)));
    const client = clientWithUser();
    client.setQueryData(fieldTemplatesKey(1), [fieldTemplate]);
    client.setQueryData(publicTemplatesKey, []);
    client
      .getQueryCache()
      .build(client, templateQueryOptions(1, 5, true))
      .setData(template);
    await expect(
      client.fetchQuery(adminUsersQueryOptions(1)),
    ).rejects.toThrow();
    await waitFor(() =>
      expect(client.getQueryState(authUserKey)?.isInvalidated).toBe(true),
    );
    expect(
      client.getQueryData(templateQueryOptions(1, 5, true).queryKey),
    ).toBeUndefined();
    expect(client.getQueryData(fieldTemplatesKey(1))).toEqual([fieldTemplate]);
    expect(client.getQueryData(publicTemplatesKey)).toEqual([]);
  });

  it('removes a deleted event and its filtered template list even when refreshing events fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((_url, options) =>
          Promise.resolve(
            options.method === 'DELETE'
              ? new Response(null, { status: 204 })
              : jsonErrorResponse(500),
          ),
        ),
    );
    const client = clientWithUser();
    client.setQueryData(adminEventsKey(1), [event]);
    const templates = templatesQueryOptions(1, event.id).queryKey;
    client.setQueryData(templates, [template]);
    const hook = renderHook(() => useEventMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    await act(async () => {
      await hook.result.current.remove.mutateAsync({
        userId: 1,
        eventId: event.id,
      });
    });
    expect(client.getQueryData(adminEventsKey(1))).toEqual([]);
    expect(client.getQueryData(templates)).toBeUndefined();
  });

  it('removes deleted template details rather than leaving a reusable stale preview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true })),
    );
    const client = clientWithUser();
    client.setQueryData([...templateDetailKey(1, 5), 'admin'], template);
    const hook = renderHook(() => useTemplateMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    await act(async () => {
      await hook.result.current.remove.mutateAsync({
        userId: 1,
        templateId: 5,
      });
    });
    expect(
      client.getQueriesData({ queryKey: templateDetailKey(1, 5) }),
    ).toEqual([]);
  });
});

describe('editor drafts and polling', () => {
  it('retains field editor input through background changes and failed saves, preventing duplicate submits', async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn(() => response.promise);
    vi.stubGlobal('fetch', fetchMock);
    const client = clientWithUser();
    client.setQueryData(fieldTemplatesKey(1), [fieldTemplate]);
    const onSave = vi.fn();
    renderWithQuery(
      <FieldTemplateModal templateId={5} onSave={onSave} onClose={vi.fn()} />,
      { queryClient: client },
    );
    fireEvent.change(screen.getByDisplayValue('Original'), {
      target: { value: 'My draft' },
    });
    act(() => {
      client.setQueryData(fieldTemplatesKey(1), [
        { ...fieldTemplate, name: 'Remote update' },
      ]);
    });
    expect(screen.getByDisplayValue('My draft')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update Template' }));
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Update Template' })
          .hasAttribute('disabled'),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update Template' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    response.resolve(jsonErrorResponse(400, 'Invalid template'));
    await screen.findByText('Invalid template');
    expect(screen.getByDisplayValue('My draft')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps the scoresheet access-code and JSON drafts when cached details refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));
    const client = clientWithUser();
    const key = templateQueryOptions(1, 5, true).queryKey;
    client.setQueryData(key, template);
    renderWithQuery(
      <TemplateEditorModal
        templateId={5}
        eventId={10}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
      { queryClient: client },
    );
    fireEvent.change(screen.getByDisplayValue('secret'), {
      target: { value: 'draft-code' },
    });
    const schema = screen.getByDisplayValue(
      JSON.stringify(template.schema, null, 2),
      { normalizer: (value) => value },
    );
    fireEvent.change(schema, { target: { value: '{"fields":[]}' } });
    act(() => {
      client.setQueryData(key, { ...template, access_code: 'remote-code' });
    });
    expect(screen.getByDisplayValue('draft-code')).toBeTruthy();
    expect(screen.getByDisplayValue('{"fields":[]}')).toBeTruthy();
  });

  it('polls admin users every thirty seconds only while visible', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockImplementation(() => Promise.resolve(jsonResponse([])));
      vi.stubGlobal('fetch', fetchMock);
      const client = clientWithUser();
      const hook = renderHook(() => useQuery(adminUsersQueryOptions(1)), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      act(() => focusManager.setFocused(false));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await act(async () => {
        focusManager.setFocused(true);
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      hook.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
