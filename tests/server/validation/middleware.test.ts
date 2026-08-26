import express from 'express';
import { describe, expect, it } from 'vitest';
import { requireAuth } from '../../../src/server/middleware/auth';
import { validateRequest } from '../../../src/server/validation/middleware';
import { scoreIdParamsSchema } from '../../../src/server/validation/scores';
import { getApiError } from '../../../src/shared/apiError';
import { z } from 'zod';
import {
  createTestApp,
  http,
  startServer,
} from '../../http/helpers/testServer';

const bodySchema = z
  .object({
    name: z.string().trim().min(1),
    count: z.number().int().positive(),
  })
  .strict();

const requestSchemas = {
  params: scoreIdParamsSchema,
  body: bodySchema,
};

describe('validateRequest middleware', () => {
  it('stores coerced params and body on req.validated', async () => {
    const app = createTestApp({ user: { id: 1, is_admin: true } });
    app.post('/items/:id', validateRequest(requestSchemas), (req, res) => {
      res.json((req as express.Request & { validated: unknown }).validated);
    });
    const server = await startServer(app);
    try {
      const res = await http.post(`${server.baseUrl}/items/12`, {
        name: '  Alpha  ',
        count: 3,
      });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({
        params: { id: 12 },
        body: { name: 'Alpha', count: 3 },
      });
    } finally {
      await server.close();
    }
  });

  it('returns nested issues for params and body together', async () => {
    const app = createTestApp({ user: { id: 1, is_admin: true } });
    app.post('/items/:id', validateRequest(requestSchemas), (_req, res) => {
      res.json({ ok: true });
    });
    const server = await startServer(app);
    try {
      const res = await http.post(`${server.baseUrl}/items/0`, {
        count: 'nope',
      });
      expect(res.status).toBe(400);
      const error = getApiError(res.json);
      expect(error?.code).toBe('VALIDATION_FAILED');
      expect(error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ location: 'params', path: ['id'] }),
          expect.objectContaining({ location: 'body' }),
        ]),
      );
    } finally {
      await server.close();
    }
  });

  it('does not mutate the database handler when validation fails', async () => {
    let handlerRan = false;
    const app = createTestApp({ user: { id: 1, is_admin: true } });
    app.post('/items/:id', validateRequest(requestSchemas), (_req, res) => {
      handlerRan = true;
      res.json({ ok: true });
    });
    const server = await startServer(app);
    try {
      const res = await http.post(`${server.baseUrl}/items/1`, {});
      expect(res.status).toBe(400);
      expect(handlerRan).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('returns 401 before payload details when auth runs first', async () => {
    const app = createTestApp();
    app.put(
      '/items/:id',
      requireAuth,
      validateRequest(requestSchemas),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    const server = await startServer(app);
    try {
      const res = await http.put(`${server.baseUrl}/items/1`, {
        unexpected: true,
      });
      expect(res.status).toBe(401);
      expect(getApiError(res.json)?.issues).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
