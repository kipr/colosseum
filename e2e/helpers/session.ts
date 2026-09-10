/**
 * Admin authentication for the Playwright suite.
 *
 * The e2e server stores sessions with `connect-pg-simple` in the `"session"`
 * table, so a spec logs an admin in by writing a session row and setting the
 * matching signed `connect.sid` cookie. That skips Google OAuth, which needs
 * real credentials.
 */
import crypto from 'crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { e2eDb } from './db';

/**
 * The session secret the e2e Express server is started with (see
 * `playwright.config.ts`). Pinned rather than read from `.env`, because a
 * developer with a real SESSION_SECRET there would otherwise get cookies the
 * server rejects.
 */
export const E2E_SESSION_SECRET = 'colosseum-e2e-session-secret';

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Same scheme as `cookie-signature`, which is what express-session uses. */
export function signSessionId(
  sid: string,
  secret: string = E2E_SESSION_SECRET,
): string {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `s:${sid}.${signature}`;
}

/** The shape express-session persists for a Passport-authenticated user. */
function adminSessionData(userId: number) {
  return {
    cookie: {
      originalMaxAge: SESSION_MAX_AGE_MS,
      expires: new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString(),
      secure: false,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    },
    passport: { user: userId },
  };
}

/** Insert or replace a session row. `sess` is a JSON column, `expire` a timestamp. */
export async function writeSession(
  sid: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sess: any,
  expiresAt: Date = new Date(Date.now() + SESSION_MAX_AGE_MS),
): Promise<void> {
  await e2eDb().run(
    `INSERT INTO "session" (sid, sess, expire) VALUES (?, ?, ?)
     ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
    [sid, JSON.stringify(sess), expiresAt],
  );
}

/** Read a session's payload. `pg` parses the JSON column, so this is an object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readSession(sid: string): Promise<any | undefined> {
  const row = await e2eDb().get<{ sess: unknown }>(
    'SELECT sess FROM "session" WHERE sid = ?',
    [sid],
  );
  return row?.sess;
}

export async function deleteSession(sid: string): Promise<void> {
  await e2eDb().run('DELETE FROM "session" WHERE sid = ?', [sid]);
}

/** `sess` is JSON, so a substring match needs an explicit text cast. */
export async function deleteSessionsForUser(userId: number): Promise<void> {
  await e2eDb().run('DELETE FROM "session" WHERE sess::text LIKE ?', [
    `%"user":${userId}%`,
  ]);
}

export interface AdminSession {
  adminUserId: number;
  sid: string;
  /** Value for the `connect.sid` cookie. */
  signedCookie: string;
}

/** Create an admin user plus a logged-in session for them. */
export async function seedAdminSession(options: {
  email: string;
  name: string;
  /** Defaults to a random value; pass one to keep it stable across a suite. */
  sid?: string;
  googleId?: string;
}): Promise<AdminSession> {
  const db = e2eDb();
  const googleId =
    options.googleId ?? `e2e-admin-${crypto.randomBytes(8).toString('hex')}`;

  const inserted = await db.run(
    `INSERT INTO users (google_id, email, name, is_admin)
     VALUES (?, ?, ?, TRUE) RETURNING id`,
    [googleId, options.email, options.name],
  );
  const adminUserId = Number(inserted.lastID);

  const sid = options.sid ?? crypto.randomBytes(24).toString('hex');
  await writeSession(sid, adminSessionData(adminUserId));

  return { adminUserId, sid, signedCookie: signSessionId(sid) };
}

/** Attach a signed session cookie so the browser is authenticated. */
export async function setSessionCookie(
  target: BrowserContext | Page,
  signedCookie: string,
): Promise<void> {
  const context = 'context' in target ? target.context() : target;
  await context.addCookies([
    {
      name: 'connect.sid',
      value: signedCookie,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
