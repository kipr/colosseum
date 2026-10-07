import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../src/client/utils/api';

function stubFetch(response: Response) {
  const mock = vi.fn(async () => response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

function lastInit(mock: ReturnType<typeof stubFetch>): RequestInit {
  return (mock.mock.calls[0] as unknown as [string, RequestInit])[1];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('returns parsed JSON on success and always sends credentials', async () => {
    const mock = stubFetch(Response.json([{ id: 1 }]));

    await expect(apiFetch<{ id: number }[]>('/teams')).resolves.toEqual([
      { id: 1 },
    ]);
    expect(mock).toHaveBeenCalledWith('/teams', expect.any(Object));
    expect(lastInit(mock).credentials).toBe('include');
  });

  it('returns undefined for 204 No Content', async () => {
    stubFetch(new Response(null, { status: 204 }));

    await expect(
      apiFetch('/teams/1', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });

  it('JSON-encodes plain bodies and sets Content-Type', async () => {
    const mock = stubFetch(Response.json({ ok: true }));

    await apiFetch('/teams', { method: 'POST', body: { team_number: 7 } });

    const init = lastInit(mock);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"team_number":7}');
    expect(new Headers(init.headers).get('Content-Type')).toBe(
      'application/json',
    );
  });

  it('passes FormData through without JSON-encoding it', async () => {
    const mock = stubFetch(Response.json({ ok: true }));
    const form = new FormData();
    form.append('file', 'x');

    await apiFetch('/upload', { method: 'POST', body: form });

    const init = lastInit(mock);
    expect(init.body).toBe(form);
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('throws ApiError with the server error message and body', async () => {
    stubFetch(
      Response.json(
        { error: 'Team number taken', conflicts: [1] },
        { status: 409 },
      ),
    );

    const error = await apiFetch('/teams', {
      fallbackError: 'Failed to save team',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: 'Team number taken',
      status: 409,
      data: { error: 'Team number taken', conflicts: [1] },
    });
  });

  it('uses the fallback message for an HTML proxy error page', async () => {
    stubFetch(
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const error = await apiFetch('/teams', {
      fallbackError: 'Failed to load teams',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: 'Failed to load teams',
      status: 502,
      data: null,
    });
  });

  it('defaults the message to the status code without a fallback', async () => {
    stubFetch(new Response('Gateway Timeout', { status: 504 }));

    await expect(apiFetch('/teams')).rejects.toThrow('Request failed (504)');
  });
});
