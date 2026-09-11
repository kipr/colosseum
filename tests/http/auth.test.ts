import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createTestApp, http, startServer } from './helpers/testServer';

const passportMocks = vi.hoisted(() => ({
  authenticate: vi.fn(
    () => (_req: Request, res: Response) => res.sendStatus(204),
  ),
}));

vi.mock('passport', () => ({
  default: {
    authenticate: passportMocks.authenticate,
  },
}));

import authRoutes from '../../src/server/routes/auth';

describe('Auth Routes', () => {
  it('requests only Google identity scopes', async () => {
    const app = createTestApp();
    app.use('/auth', authRoutes);
    const server = await startServer(app);

    try {
      const res = await http.get(`${server.baseUrl}/auth/google`);
      expect(res.status).toBe(204);
      expect(passportMocks.authenticate).toHaveBeenCalledWith('google', {
        scope: ['profile', 'email'],
      });
    } finally {
      await server.close();
    }
  });

  it('does not expose the obsolete token-check endpoint', async () => {
    const app = createTestApp();
    app.use('/auth', authRoutes);
    const server = await startServer(app);

    try {
      const res = await fetch(`${server.baseUrl}/auth/check-tokens`);
      expect(res.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
