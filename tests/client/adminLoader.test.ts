import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminEventLoader,
  adminIndexLoader,
  adminLoader,
  SELECTED_EVENT_STORAGE_KEY,
} from '../../src/client/loaders/adminLoader';

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

  it('restores stored selection only after authenticating /admin', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        id: 1,
        email: 'admin@example.com',
        name: 'Admin',
        isAdmin: true,
      }),
    );
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue('42'),
      removeItem: vi.fn(),
    });
    const request = new Request('https://colosseum.test/admin');

    const response = await adminLoader({ request });

    expect(response).toBeInstanceOf(Response);
    expect(response?.headers.get('Location')).toBe('/admin/events/42');
  });

  it('starts OAuth and preserves the requested admin URL', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
      }),
    );
    const request = new Request(
      'https://colosseum.test/admin/events/42/queue#status',
    );

    const response = await adminLoader({ request });

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(302);
    expect(response?.headers.get('Location')).toBe(
      '/auth/google?returnTo=%2Fadmin%2Fevents%2F42%2Fqueue%23status',
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

describe('adminIndexLoader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStoredEvent(value: string | null) {
    const storage = {
      getItem: vi.fn().mockReturnValue(value),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('localStorage', storage);
    return storage;
  }

  it('redirects a stored event selection to its canonical URL', () => {
    const storage = stubStoredEvent('42');

    const response = adminIndexLoader();

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/admin/events/42');
    expect(storage.getItem).toHaveBeenCalledWith(SELECTED_EVENT_STORAGE_KEY);
  });

  it('redirects to event management without a stored selection', () => {
    stubStoredEvent(null);

    const response = adminIndexLoader();

    expect(response.headers.get('Location')).toBe('/admin/events');
  });

  it.each(['', 'abc', '0', '-1', '1.5', String(Number.MAX_SAFE_INTEGER + 1)])(
    'clears malformed stored event ID %j',
    (storedId) => {
      const storage = stubStoredEvent(storedId);

      const response = adminIndexLoader();

      expect(response.headers.get('Location')).toBe('/admin/events');
      expect(storage.removeItem).toHaveBeenCalledWith(
        SELECTED_EVENT_STORAGE_KEY,
      );
    },
  );
});

describe('adminEventLoader', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function loadEvent(eventId: string, request = new Request('https://test')) {
    return adminEventLoader({
      params: { eventId },
      request,
      context: undefined,
    });
  }

  it('loads a valid event using the navigation abort signal', async () => {
    const event = { id: 42, name: 'Nationals', status: 'setup' };
    fetchMock.mockResolvedValue(Response.json(event));
    const request = new Request('https://colosseum.test/admin/events/42');

    await expect(loadEvent('42', request)).resolves.toEqual(event);
    expect(fetchMock).toHaveBeenCalledWith('/events/42', {
      credentials: 'include',
      signal: request.signal,
    });
  });

  it.each(['abc', '0', '-1', '1.5'])(
    'rejects malformed event ID %j without fetching',
    async (eventId) => {
      await expect(loadEvent(eventId)).rejects.toMatchObject({ status: 404 });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('normalizes a missing event response to a 404', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'Event not found' }, { status: 404 }),
    );

    await expect(loadEvent('42')).rejects.toMatchObject({ status: 404 });
  });

  it('surfaces other HTTP failures', async () => {
    const serverError = new Response('Unavailable', { status: 503 });
    fetchMock.mockResolvedValue(serverError);

    await expect(loadEvent('42')).rejects.toBe(serverError);
  });

  it('surfaces aborted fetches', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    fetchMock.mockRejectedValue(abortError);

    await expect(loadEvent('42')).rejects.toBe(abortError);
  });
});
