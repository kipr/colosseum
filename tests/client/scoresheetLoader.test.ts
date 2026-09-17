import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  legacyScoresheetLoader,
  scoresheetLoader,
} from '../../src/client/loaders/scoresheetLoader';

function loaderArgs(url: string, templateId?: string) {
  return {
    params: { templateId },
    request: new Request(url),
    context: undefined,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scoresheetLoader', () => {
  it('loads the route template from the judge-session endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 42,
          name: 'Judge Sheet',
          schema: { fields: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await scoresheetLoader(
      loaderArgs('http://localhost/scoresheets/42', '42'),
    );

    expect(result).toMatchObject({ id: 42, name: 'Judge Sheet' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/scoresheet/judge/templates/42',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('redirects to verification when the judge session is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    const result = await scoresheetLoader(
      loaderArgs('http://localhost/scoresheets/42', '42'),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get('Location')).toBe('/judge');
  });

  it('rejects invalid route ids without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      scoresheetLoader(loaderArgs('http://localhost/scoresheets/nope', 'nope')),
    ).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('legacyScoresheetLoader', () => {
  it('redirects old query-string links to the canonical route', () => {
    const result = legacyScoresheetLoader(
      loaderArgs('http://localhost/scoresheet?template=42'),
    );

    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe('/scoresheets/42');
  });

  it('redirects an incomplete old link to template selection', () => {
    const result = legacyScoresheetLoader(
      loaderArgs('http://localhost/scoresheet'),
    );

    expect(result.headers.get('Location')).toBe('/judge');
  });
});
