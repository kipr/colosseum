import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import SQLite from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';

const DB_PATH = path.join(__dirname, '..', 'database', 'colosseum.db');
const SESSION_DB_PATH = path.join(__dirname, '..', 'database', 'sessions.db');
const SESSION_SECRET =
  process.env.SESSION_SECRET || 'colosseum-secret-key-change-in-production';

const EVENT_NAME = `E2E Admin Queue Mgmt ${Date.now()}`;
const TEAM_A_NAME = 'E2E QMgmt Alpha';
const TEAM_B_NAME = 'E2E QMgmt Beta';
const TEAM_A_NUMBER = 801;
const TEAM_B_NUMBER = 802;

const ADMIN_EMAIL = 'e2e-queue-mgmt-admin@kipr.org';
const ADMIN_NAME = 'E2E Queue Mgmt Admin';

let eventId: number;
let adminUserId: number;
let sessionId: string;

function signSessionId(sid: string, secret: string): string {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `s:${sid}.${signature}`;
}

async function setAdminCookie(context: BrowserContext) {
  const signedSid = signSessionId(sessionId, SESSION_SECRET);
  await context.addCookies([
    {
      name: 'connect.sid',
      value: signedSid,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/** Avoid queueSyncLimiter (10 req/min) during heavy filter/refetch interactions. */
async function bypassQueueSyncLimit(page: Page) {
  await page.route('**/queue/event/**', (route) => {
    const url = new URL(route.request().url());
    url.searchParams.delete('sync');
    route.continue({ url: url.toString() });
  });
}

function seedingRow(page: Page, teamName: string, round: number) {
  return page
    .locator('tr.queue-row')
    .filter({ hasText: teamName })
    .filter({ hasText: `Round ${round}` });
}

test.describe('Admin queue management', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    sessionId = `e2e-qmgmt-${Date.now()}`;

    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    const ev = db
      .prepare(
        `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
         VALUES (?, 'active', 3, 'manual')`,
      )
      .run(EVENT_NAME);
    eventId = Number(ev.lastInsertRowid);

    const tmA = db
      .prepare(
        `INSERT INTO teams (event_id, team_number, team_name, status)
         VALUES (?, ?, ?, 'checked_in')`,
      )
      .run(eventId, TEAM_A_NUMBER, TEAM_A_NAME);
    const teamAId = Number(tmA.lastInsertRowid);

    const tmB = db
      .prepare(
        `INSERT INTO teams (event_id, team_number, team_name, status)
         VALUES (?, ?, ?, 'checked_in')`,
      )
      .run(eventId, TEAM_B_NUMBER, TEAM_B_NAME);
    const teamBId = Number(tmB.lastInsertRowid);

    // Three seeding rows: A R1, A R2, B R1 — distinct rounds/teams for reorder assertions
    db.prepare(
      `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
       VALUES (?, ?, 1, 'seeding', 1, 'queued')`,
    ).run(eventId, teamAId);
    db.prepare(
      `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
       VALUES (?, ?, 2, 'seeding', 2, 'queued')`,
    ).run(eventId, teamAId);
    db.prepare(
      `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
       VALUES (?, ?, 1, 'seeding', 3, 'queued')`,
    ).run(eventId, teamBId);

    const usr = db
      .prepare(
        `INSERT INTO users (google_id, email, name, is_admin)
         VALUES (?, ?, ?, 1)`,
      )
      .run(`e2e-qmgmt-${Date.now()}`, ADMIN_EMAIL, ADMIN_NAME);
    adminUserId = Number(usr.lastInsertRowid);

    db.close();

    const sessDb = new SQLite(SESSION_DB_PATH);
    sessDb.pragma('busy_timeout = 5000');

    const sessData = JSON.stringify({
      cookie: {
        originalMaxAge: 604800000,
        expires: new Date(Date.now() + 604800000).toISOString(),
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
      passport: {
        user: adminUserId,
      },
    });

    sessDb
      .prepare(
        `INSERT OR REPLACE INTO sessions (sid, sess, expires)
         VALUES (?, ?, ?)`,
      )
      .run(sessionId, sessData, Date.now() + 604800000);
    sessDb.close();
  });

  test.afterAll(() => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    db.prepare('DELETE FROM game_queue WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM teams WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminUserId);

    db.close();

    const sessDb = new SQLite(SESSION_DB_PATH);
    sessDb.pragma('busy_timeout = 5000');
    sessDb.prepare('DELETE FROM sessions WHERE sid = ?').run(sessionId);
    sessDb.close();
  });

  test('queue tab lists seeded items and summary count', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();
    await bypassQueueSyncLimit(page);

    await page.goto(`/admin/events/${eventId}?view=queue`);

    await expect(page.locator('.admin-content-header h2')).toHaveText('Queue', {
      timeout: 15_000,
    });

    await expect(seedingRow(page, TEAM_A_NAME, 1)).toBeVisible();
    await expect(seedingRow(page, TEAM_A_NAME, 2)).toBeVisible();
    await expect(seedingRow(page, TEAM_B_NAME, 1)).toBeVisible();
    await expect(page.locator('.queue-summary')).toContainText(
      '3 items in queue',
    );

    await context.close();
  });

  test('admin advances flow to Called and steps back to Queued', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();
    await bypassQueueSyncLimit(page);

    await page.goto(`/admin/events/${eventId}?view=queue`);
    await expect(page.locator('.admin-content-header h2')).toHaveText('Queue', {
      timeout: 15_000,
    });

    const row = seedingRow(page, TEAM_A_NAME, 1);
    await row.getByRole('button', { name: 'Called' }).click();

    await expect(
      row.locator('.queue-status-badge.queue-status-called'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText('Called', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Back' }).click();
    await expect(
      row.locator('.queue-status-badge.queue-status-queued'),
    ).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('admin reorders with move down on the first queue row', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();
    await bypassQueueSyncLimit(page);

    await page.goto(`/admin/events/${eventId}?view=queue`);
    await expect(page.locator('.admin-content-header h2')).toHaveText('Queue', {
      timeout: 15_000,
    });

    // Table sorts by seeding round first, then queue fields — first visible row is Round 1 (not min queue_position).
    const rowA1 = seedingRow(page, TEAM_A_NAME, 1);
    await expect(rowA1.locator('td.queue-position')).toHaveText('1');

    // Move down swaps this item with the next row in API order (Team A Round 2): positions become A R2 → 1, A R1 → 2.
    await rowA1.locator('button.reorder-btn[title="Move down"]').click();

    await expect(
      seedingRow(page, TEAM_A_NAME, 2).locator('td.queue-position'),
    ).toHaveText('1', { timeout: 10_000 });
    await expect(
      seedingRow(page, TEAM_A_NAME, 1).locator('td.queue-position'),
    ).toHaveText('2');

    await context.close();
  });

  test('type filter Bracket shows empty state when only seeding rows exist', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();
    await bypassQueueSyncLimit(page);

    await page.goto(`/admin/events/${eventId}?view=queue`);
    await expect(page.locator('.admin-content-header h2')).toHaveText('Queue', {
      timeout: 15_000,
    });

    await page.locator('select.queue-filter').selectOption('bracket');

    await expect(
      page.getByText('No queue items match the current filters.'),
    ).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('status filter hides Queued rows when Queued pill is toggled off', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();
    await bypassQueueSyncLimit(page);

    await page.goto(`/admin/events/${eventId}?view=queue`);
    await expect(page.locator('.admin-content-header h2')).toHaveText('Queue', {
      timeout: 15_000,
    });

    await page.locator('select.queue-filter').selectOption('all');

    const row = seedingRow(page, TEAM_B_NAME, 1);
    await row.getByRole('button', { name: 'Called' }).click();
    await expect(
      row.locator('.queue-status-badge.queue-status-called'),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Queued', exact: true }).click();

    await expect(page.locator('table tbody tr.queue-row')).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(
      page.locator('table tbody tr.queue-row').first(),
    ).toContainText(TEAM_B_NAME);
    await expect(
      page.locator('table tbody tr.queue-row').first(),
    ).toContainText('Called');

    await context.close();
  });
});
