import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminLoader } from '../../src/client/loaders/adminLoader';

describe('adminLoader', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('allows authenticated administrators through', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        id: 1,
        email: 'admin@example.com',
        name: 'Admin',
        isAdmin: true,
      }),
    );
    const request = new Request('https://colosseum.test/admin/events');

    await expect(adminLoader({ request })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/auth/user', {
      credentials: 'include',
      signal: request.signal,
    });
  });

  it('starts OAuth and preserves the requested admin URL', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
      }),
    );
    const request = new Request('https://colosseum.test/admin/queue/42#status');

    const response = await adminLoader({ request });

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(302);
    expect(response?.headers.get('Location')).toBe(
      '/auth/google?returnTo=%2Fadmin%2Fqueue%2F42%23status',
    );
    expect(response?.headers.get('X-Remix-Reload-Document')).toBe('true');
  });

  it('sends authenticated non-admin users to access denied', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        id: 2,
        email: 'user@example.com',
        name: 'User',
        isAdmin: false,
      }),
    );
    const request = new Request('https://colosseum.test/admin/events');

    const response = await adminLoader({ request });

    expect(response).toBeInstanceOf(Response);
    expect(response?.headers.get('Location')).toBe('/auth/access-denied');
    expect(response?.headers.get('X-Remix-Reload-Document')).toBe('true');
  });

  it('surfaces unexpected HTTP failures', async () => {
    const serverError = new Response('Unavailable', { status: 503 });
    fetchMock.mockResolvedValue(serverError);
    const request = new Request('https://colosseum.test/admin/events');

    await expect(adminLoader({ request })).rejects.toBe(serverError);
  });

  it('surfaces network failures', async () => {
    const networkError = new TypeError('fetch failed');
    fetchMock.mockRejectedValue(networkError);
    const request = new Request('https://colosseum.test/admin/events');

    await expect(adminLoader({ request })).rejects.toBe(networkError);
  });
});
