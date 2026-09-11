import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, VerifyCallback } from 'passport-google-oauth20';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
import { createTestDb, type TestDb } from '../sql/helpers/testDb';

type GoogleVerify = (
  accessToken: string,
  refreshToken: string,
  profile: Profile,
  done: VerifyCallback,
) => Promise<void>;

const passportMocks = vi.hoisted(() => ({
  use: vi.fn(),
  serializeUser: vi.fn(),
  deserializeUser: vi.fn(),
}));

const strategyMocks = vi.hoisted(() => ({
  verify: undefined as GoogleVerify | undefined,
}));

vi.mock('passport', () => ({
  default: passportMocks,
}));

vi.mock('passport-google-oauth20', () => ({
  Strategy: class {
    constructor(_options: unknown, verify: GoogleVerify) {
      strategyMocks.verify = verify;
    }
  },
}));

import { setupPassport } from '../../src/server/config/passport';

describe('Google Passport strategy', () => {
  let testDb: TestDb;
  const previousAllowedDomains = process.env.ALLOWED_EMAIL_DOMAINS;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    process.env.ALLOWED_EMAIL_DOMAINS = 'kipr.org';
    strategyMocks.verify = undefined;
    setupPassport();
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
    if (previousAllowedDomains === undefined) {
      delete process.env.ALLOWED_EMAIL_DOMAINS;
    } else {
      process.env.ALLOWED_EMAIL_DOMAINS = previousAllowedDomains;
    }
  });

  async function verifyLogin(name: string): Promise<Record<string, unknown>> {
    const verify = strategyMocks.verify;
    if (!verify) throw new Error('Google strategy verifier was not registered');

    const profile = {
      id: 'google-admin-1',
      displayName: name,
      emails: [{ value: 'admin@kipr.org' }],
    } as Profile;

    return new Promise((resolve, reject) => {
      void verify(
        'unused-access-token',
        'unused-refresh-token',
        profile,
        (error, user) => {
          if (error) reject(error);
          else resolve(user as Record<string, unknown>);
        },
      );
    });
  }

  it('creates and updates identity records without storing OAuth credentials', async () => {
    await verifyLogin('Initial Admin');
    await verifyLogin('Renamed Admin');

    const user = await testDb.db.get<Record<string, unknown>>(
      'SELECT * FROM users WHERE google_id = ?',
      ['google-admin-1'],
    );
    expect(user).toMatchObject({
      email: 'admin@kipr.org',
      name: 'Renamed Admin',
      is_admin: true,
    });
    expect(user).not.toHaveProperty('access_token');
    expect(user).not.toHaveProperty('refresh_token');
    expect(user).not.toHaveProperty('token_expires_at');
  });
});
