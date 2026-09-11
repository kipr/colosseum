import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  ApiParseError,
  parseRetryAfterHeader,
  requestJson,
  requestVoid,
} from '../../src/client/api/http';

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

describe('requestJson', () => {
  it('parses a successful JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ ok: true }))),
    );

    await expect(
      requestJson<{ ok: boolean }>('/events/public'),
    ).resolves.toEqual({ ok: true });
  });

  it('sends cookie credentials by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse([]))),
    );

    await requestJson('/events/public');
    expect(getFetchMock()).toHaveBeenCalledWith(
      '/events/public',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('preserves an explicit credentials mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse([]))),
    );

    await requestJson('/events/public', { credentials: 'omit' });
    expect(getFetchMock().mock.calls[0][1]).toEqual(
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it('adds Accept without overwriting supplied headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse([]))),
    );

    await requestJson('/events/public', {
      headers: {
        Authorization: 'Bearer token',
        Accept: 'application/xml',
        'X-Test': '1',
      },
    });

    const headers = new Headers(getFetchMock().mock.calls[0][1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer token');
    expect(headers.get('Accept')).toBe('application/xml');
    expect(headers.get('X-Test')).toBe('1');
  });

  it('forwards the abort signal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse([]))),
    );
    const controller = new AbortController();

    await requestJson('/events/public', { signal: controller.signal });
    expect(getFetchMock().mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it('throws ApiError for unsuccessful JSON responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({ error: 'Failed to fetch events' }, { status: 500 }),
        ),
      ),
    );

    const error = await requestJson('/events/public').catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 500,
      message: 'Failed to fetch events',
    });
  });

  it('uses a fallback message for HTML, empty, or malformed error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('<html>nope</html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
          }),
        ),
      ),
    );
    await expect(requestJson('/events/public')).rejects.toMatchObject({
      status: 502,
      message: 'Request failed (502)',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 503 }))),
    );
    await expect(requestJson('/events/public')).rejects.toMatchObject({
      status: 503,
      message: 'Request failed (503)',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('{not json', {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
    await expect(requestJson('/events/public')).rejects.toMatchObject({
      status: 500,
      message: 'Request failed (500)',
    });
  });

  it('parses Retry-After on error responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            { error: 'Slow down' },
            { status: 429, headers: { 'Retry-After': '7' } },
          ),
        ),
      ),
    );

    await expect(requestJson('/events/public')).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 7000,
      message: 'Slow down',
    });
  });

  it('fails clearly on empty or malformed successful JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 200 }))),
    );
    await expect(requestJson('/events/public')).rejects.toBeInstanceOf(
      ApiParseError,
    );

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
    await expect(requestJson('/events/public')).rejects.toBeInstanceOf(
      ApiParseError,
    );
  });

  it('preserves cancellation instead of wrapping it as an API error', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => {
            reject(
              new DOMException('This operation was aborted', 'AbortError'),
            );
          };
          if (init?.signal?.aborted) {
            abort();
            return;
          }
          init?.signal?.addEventListener('abort', abort);
        });
      }),
    );

    const pending = requestJson('/events/public', {
      signal: controller.signal,
    });
    controller.abort();
    const error = await pending.catch((err) => err);
    expect(error).toBeInstanceOf(DOMException);
    expect(error.name).toBe('AbortError');
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it('surfaces transport failures as-is', async () => {
    const transport = new TypeError('Failed to fetch');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(transport)),
    );

    await expect(requestJson('/events/public')).rejects.toBe(transport);
  });
});

describe('requestVoid', () => {
  it('resolves on an empty successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    await expect(requestVoid('/events/1')).resolves.toBeUndefined();
  });

  it('throws ApiError for unsuccessful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(jsonResponse({ error: 'Nope' }, { status: 404 })),
      ),
    );
    await expect(requestVoid('/events/1')).rejects.toMatchObject({
      status: 404,
      message: 'Nope',
    });
  });
});

describe('parseRetryAfterHeader', () => {
  it('parses delay-seconds and HTTP-date values', () => {
    expect(parseRetryAfterHeader('12')).toBe(12_000);
    expect(parseRetryAfterHeader('invalid')).toBeUndefined();
    expect(parseRetryAfterHeader('')).toBeUndefined();

    const date = new Date(Date.now() + 8_000).toUTCString();
    const delay = parseRetryAfterHeader(date);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(8_000);
  });
});
