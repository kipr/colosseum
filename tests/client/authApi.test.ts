import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentUser } from '../../src/client/api/auth';
import { ApiError, ApiParseError } from '../../src/client/api/http';
import { userA } from './helpers/sessionFixtures';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
}

function getFetchMock(): ReturnType<typeof vi.fn> {
  return vi.mocked(globalThis.fetch);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getCurrentUser', () => {
  it('returns a typed session user on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(userA))),
    );

    await expect(getCurrentUser()).resolves.toEqual(userA);
    expect(getFetchMock()).toHaveBeenCalledWith(
      '/auth/user',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('maps HTTP 401 to null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({ error: 'Not authenticated' }, { status: 401 }),
        ),
      ),
    );

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('propagates other HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(jsonResponse({ error: 'boom' }, { status: 500 })),
      ),
    );

    const error = await getCurrentUser().catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, message: 'boom' });
  });

  it('propagates parse failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('not-json', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );

    await expect(getCurrentUser()).rejects.toBeInstanceOf(ApiParseError);
  });

  it('propagates transport failures', async () => {
    const transport = new TypeError('Failed to fetch');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(transport)),
    );

    await expect(getCurrentUser()).rejects.toBe(transport);
  });

  it('forwards the abort signal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(userA))),
    );
    const controller = new AbortController();

    await getCurrentUser({ signal: controller.signal });
    expect(getFetchMock().mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});
