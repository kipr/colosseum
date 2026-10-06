/**
 * HTTP tests for the Google OAuth entry point.
 * Pins the authorization request to the basic sign-in scopes so no Google
 * API permission (e.g. Drive or Sheets) is requested again by accident.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import passport from 'passport';
import { startServer, TestServerHandle } from './helpers/testServer';
import { setupPassport } from '../../src/server/config/passport';
import authRoutes from '../../src/server/routes/auth';
import { resetAllRateLimiters } from '../../src/server/middleware/rateLimit';

describe('GET /auth/google', () => {
  let server: TestServerHandle;
  const originalClientId = process.env.GOOGLE_CLIENT_ID;

  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    setupPassport();
  });

  afterAll(() => {
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
  });

  afterEach(async () => {
    if (server) await server.close();
    resetAllRateLimiters();
  });

  it('requests only the profile and email scopes, without offline access', async () => {
    const app = express();
    app.use(passport.initialize());
    app.use('/auth', authRoutes);
    server = await startServer(app);

    const res = await fetch(`${server.baseUrl}/auth/google`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);

    const location = new URL(res.headers.get('location') ?? '');
    expect(location.hostname).toBe('accounts.google.com');
    expect(location.searchParams.get('scope')?.split(' ').sort()).toEqual([
      'email',
      'profile',
    ]);
    expect(location.searchParams.has('access_type')).toBe(false);
    expect(location.searchParams.has('prompt')).toBe(false);
    expect(location.searchParams.has('include_granted_scopes')).toBe(false);
  });
});
