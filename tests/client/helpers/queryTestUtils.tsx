import {
  QueryClientProvider,
  focusManager,
  onlineManager,
  type QueryClient,
  type QueryClientConfig,
} from '@tanstack/react-query';
import { cleanup, render, type RenderOptions } from '@testing-library/react';
import { type ReactElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, vi } from 'vitest';
import { createQueryClient } from '../../../src/client/queries/queryClient';

const trackedClients: QueryClient[] = [];

export function createTestQueryClient(
  options: QueryClientConfig = {},
): QueryClient {
  const queryClient = createQueryClient({
    ...options,
    defaultOptions: {
      ...options.defaultOptions,
      queries: {
        retry: false,
        ...options.defaultOptions?.queries,
      },
    },
  });
  trackedClients.push(queryClient);
  return queryClient;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers,
  });
}

export function jsonErrorResponse(
  status: number,
  message = 'Request failed',
  headers?: HeadersInit,
): Response {
  return jsonResponse(
    { error: message },
    {
      status,
      headers,
    },
  );
}

type RouterOptions = {
  initialEntries?: string[];
};

export function createQueryWrapper(options?: {
  queryClient?: QueryClient;
  router?: RouterOptions | false;
}): ({ children }: { children: ReactNode }) => ReactElement {
  const queryClient = options?.queryClient ?? createTestQueryClient();
  const router = options?.router;

  return function QueryTestWrapper({
    children,
  }: {
    children: ReactNode;
  }): ReactElement {
    const tree = (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    if (router === false) {
      return tree;
    }
    return (
      <MemoryRouter initialEntries={router?.initialEntries ?? ['/spectator']}>
        {tree}
      </MemoryRouter>
    );
  };
}

export function renderWithQuery(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & {
    queryClient?: QueryClient;
    router?: RouterOptions | false;
  },
) {
  const queryClient = options?.queryClient ?? createTestQueryClient();
  const wrapper = createQueryWrapper({
    queryClient,
    router: options?.router,
  });
  return {
    ...render(ui, { wrapper, ...options }),
    queryClient,
  };
}

export async function cleanupQueryTests(): Promise<void> {
  cleanup();
  const clients = trackedClients.splice(0);
  await Promise.all(
    clients.map(async (client) => {
      await client.cancelQueries();
      client.clear();
    }),
  );
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
}

export function registerQueryTestCleanup(): void {
  afterEach(async () => {
    await cleanupQueryTests();
  });
}
