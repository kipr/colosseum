/**
 * HTTP tests for the central Express error handler.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createTestApp,
  startServer,
  TestServerHandle,
} from './helpers/testServer';

describe('errorHandler', () => {
  let server: TestServerHandle | undefined;

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    vi.restoreAllMocks();
  });

  it('returns a generic 500 without leaking the error message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createTestApp();
    app.get('/boom', async () => {
      throw new Error('relation "secret_table" does not exist');
    });
    server = await startServer(app);

    const res = await fetch(`${server.baseUrl}/boom`);
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'Internal server error' });
    expect(text).not.toContain('secret_table');
    expect(errorSpy).toHaveBeenCalledWith(
      'Unhandled error on GET /boom:',
      expect.any(Error),
    );
  });

  it('keeps exposed client errors such as malformed JSON as 400', async () => {
    const app = createTestApp();
    app.post('/echo', (req, res) => {
      res.json(req.body);
    });
    server = await startServer(app);

    const res = await fetch(`${server.baseUrl}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toHaveProperty('error');
  });

  it('delegates to Express when headers were already sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createTestApp();
    app.get('/partial', async (_req, res) => {
      res.status(200);
      res.write('partial');
      throw new Error('late failure');
    });
    server = await startServer(app);

    // Express's default handler destroys the socket, so the body read fails
    // instead of a second response being written.
    const res = await fetch(`${server.baseUrl}/partial`);
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow();
  });
});
