import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';
import {
  deleteSession,
  seedAdminSession,
  setSessionCookie,
} from './helpers/session';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const ACCESS_CODE = 'e2e-queue-test-code';
const EVENT_NAME = 'E2E Seeding Queue Event';
const TEMPLATE_NAME = 'E2E Queue Sheet';
const TEAM_A_NAME = 'Queue Bots Alpha';
const TEAM_A_NUMBER = 101;
const TEAM_B_NAME = 'Queue Bots Beta';
const TEAM_B_NUMBER = 102;

const ADMIN_EMAIL = 'e2e-queue-admin@kipr.org';
const ADMIN_NAME = 'E2E Queue Admin';
const ADMIN_SID = `e2e-queue-admin-${Date.now()}`;

/* ------------------------------------------------------------------ */
/*  Shared state seeded in beforeAll                                  */
/* ------------------------------------------------------------------ */

let eventId: number;
let teamAId: number;
let teamBId: number;
let templateId: number;
let admin: Awaited<ReturnType<typeof seedAdminSession>>;

/* ------------------------------------------------------------------ */
/*  Schema builder                                                    */
/* ------------------------------------------------------------------ */

function buildSchema(evtId: number) {
  return {
    title: TEMPLATE_NAME,
    eventId: evtId,
    scoreDestination: 'db',
    layout: 'two-column',
    fields: [
      {
        id: 'team_number',
        label: 'Team Number',
        type: 'dropdown',
        required: true,
        dataSource: {
          type: 'db',
          eventId: evtId,
          labelField: 'team_number',
          valueField: 'team_number',
        },
        cascades: {
          targetField: 'team_name',
          sourceField: 'team_name',
        },
      },
      {
        id: 'team_name',
        label: 'Team Name',
        type: 'text',
        autoPopulated: true,
      },
      {
        id: 'round',
        label: 'Round',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'Round 1', value: '1' },
          { label: 'Round 2', value: '2' },
          { label: 'Round 3', value: '3' },
        ],
      },
      {
        id: 'autonomous',
        label: 'Autonomous',
        type: 'number',
        min: 0,
        max: 100,
        column: 'left',
      },
      {
        id: 'driver',
        label: 'Driver',
        type: 'number',
        min: 0,
        max: 100,
        column: 'right',
      },
      {
        id: 'grand_total',
        label: 'Total Score',
        type: 'calculated',
        formula: 'autonomous + driver',
        isGrandTotal: true,
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function setAdminCookie(context: BrowserContext) {
  await setSessionCookie(context, admin.signedCookie);
}

/**
 * Strip sync=1 from queue API requests to avoid the queueSyncLimiter
 * (10 req/min). Queue statuses are already correct from server-side
 * updateSeedingQueueItem calls during submission/acceptance/rejection.
 */
async function bypassQueueSyncLimit(page: Page) {
  await page.route('**/queue/event/**', (route) => {
    const url = new URL(route.request().url());
    url.searchParams.delete('sync');
    route.continue({ url: url.toString() });
  });
}

async function enterAsJudge(page: Page) {
  await bypassQueueSyncLimit(page);
  await page.goto('/judge');
  await page.locator('.template-card', { hasText: TEMPLATE_NAME }).click();
  await page
    .getByPlaceholder('Enter code provided by administrator')
    .fill(ACCESS_CODE);
  await page.getByRole('button', { name: 'Access Scoresheet' }).click();
  await page.waitForURL(/\/scoresheet/);
  await expect(page.locator('.scoresheet-form')).toBeVisible();
}

async function submitSeedingScore(
  page: Page,
  teamNumber: number,
  teamName: string,
  round: number,
  autonomous: number,
  driver: number,
) {
  const queueLabel = `#${teamNumber} ${teamName} \u2013 Round ${round}`;
  const queueOption = page.locator('option', {
    hasText: new RegExp(`#${teamNumber}.*Round ${round}`),
  });
  await expect(queueOption).toBeAttached({ timeout: 15_000 });

  const queueSelect = page
    .locator('.score-field')
    .filter({ hasText: 'Select from Queue' })
    .locator('select');
  await queueSelect.selectOption({ label: queueLabel });

  const autoInput = page
    .locator('.score-field')
    .filter({ hasText: 'Autonomous' })
    .locator('input[type="number"]');
  await autoInput.fill(String(autonomous));

  const driverInput = page
    .locator('.score-field')
    .filter({ hasText: 'Driver' })
    .locator('input[type="number"]');
  await driverInput.fill(String(driver));

  const expectedTotal = autonomous + driver;
  await expect(
    page.locator('.grand-total-field').filter({ hasText: 'Total Score' }),
  ).toContainText(String(expectedTotal));

  await page.getByLabel('Team Initials').fill('AB');

  await page.getByRole('button', { name: 'Submit Score' }).click();

  await expect(page.getByText('Score submitted successfully!')).toBeVisible({
    timeout: 5_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Data lifecycle                                                    */
/* ------------------------------------------------------------------ */

test.describe('Seeding Queue E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    // ── Seed application DB ──
    const db = e2eDb();

    const ev = await db.run(
      `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
       VALUES (?, 'active', 3, 'manual') RETURNING id`,
      [EVENT_NAME],
    );
    eventId = Number(ev.lastID);

    const tmA = await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, status)
       VALUES (?, ?, ?, 'checked_in') RETURNING id`,
      [eventId, TEAM_A_NUMBER, TEAM_A_NAME],
    );
    teamAId = Number(tmA.lastID);

    const tmB = await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, status)
       VALUES (?, ?, ?, 'checked_in') RETURNING id`,
      [eventId, TEAM_B_NUMBER, TEAM_B_NAME],
    );
    teamBId = Number(tmB.lastID);

    const schema = buildSchema(eventId);
    const tpl = await db.run(
      `INSERT INTO scoresheet_templates (name, description, schema, access_code, is_active)
       VALUES (?, 'E2E queue test template', ?, ?, TRUE) RETURNING id`,
      [TEMPLATE_NAME, JSON.stringify(schema), ACCESS_CODE],
    );
    templateId = Number(tpl.lastID);

    await db.run(
      `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type)
       VALUES (?, ?, 'seeding') RETURNING id`,
      [eventId, templateId],
    );

    // Seed queue items: 3 rounds × 2 teams = 6 items
    let pos = 1;
    for (let round = 1; round <= 3; round++) {
      for (const tid of [teamAId, teamBId]) {
        await db.run(
          `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
           VALUES (?, ?, ?, 'seeding', ?, 'queued') RETURNING id`,
          [eventId, tid, round, pos++],
        );
      }
    }

    // ── Seed admin user and session ──
    admin = await seedAdminSession({
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      sid: ADMIN_SID,
    });
  });

  test.afterAll(async () => {
    const db = e2eDb();

    await db.run('DELETE FROM seeding_rankings WHERE team_id IN (?, ?)', [
      teamAId,
      teamBId,
    ]);
    await db.run('DELETE FROM seeding_scores WHERE team_id IN (?, ?)', [
      teamAId,
      teamBId,
    ]);
    await db.run('DELETE FROM score_submissions WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM game_queue WHERE event_id = ?', [eventId]);
    await db.run(
      'DELETE FROM event_scoresheet_templates WHERE template_id = ?',
      [templateId],
    );
    await db.run('DELETE FROM scoresheet_templates WHERE id = ?', [templateId]);
    await db.run('DELETE FROM audit_log WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM teams WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM events WHERE id = ?', [eventId]);
    await deleteSession(admin.sid);
    await db.run('DELETE FROM users WHERE id = ?', [admin.adminUserId]);

    await closeE2eDb();
  });

  /* ── 1. Admin Queue tab shows seeded queue items ─────────────── */

  test('admin sees seeding queue items in the Queue tab', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();
    await bypassQueueSyncLimit(page);

    await page.goto(`/admin/events/${eventId}?view=queue`);

    // Admin page should load and show Queue tab
    await expect(page.locator('.admin-content-header h2')).toHaveText('Queue', {
      timeout: 10_000,
    });

    // Click "All" status filter to see all items including scored
    await page.getByRole('button', { name: 'All', exact: true }).click();

    // Should see queue items with team names
    await expect(page.getByText(TEAM_A_NAME).first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(TEAM_B_NAME).first()).toBeVisible();

    // Should show 6 items total (3 rounds × 2 teams)
    await expect(page.locator('.queue-summary')).toContainText('6 item');

    await context.close();
  });

  /* ── 2. Judge submits a score via queue-based seeding form ───── */

  test('judge submits Team A Round 1 score via queue', async ({ page }) => {
    await enterAsJudge(page);
    await submitSeedingScore(page, TEAM_A_NUMBER, TEAM_A_NAME, 1, 40, 35);
  });

  /* ── 3. Admin sees pending score in Scoring tab ─────────────── */

  test('admin sees the pending score in the Scoring tab', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();

    await page.goto(`/admin/events/${eventId}?view=scoring`);

    await expect(page.locator('h2', { hasText: 'Scoring' })).toBeVisible({
      timeout: 10_000,
    });

    // Filter to seeding rows now that scoring renders separate table shapes by type
    const scoreTypeFilter = page.locator('select.field-input').nth(1);
    await scoreTypeFilter.selectOption('seeding');

    // Wait for scores to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({
      timeout: 10_000,
    });

    // Verify the pending seeding submission details
    const firstRow = page.locator('table tbody tr').first();
    await expect(
      firstRow.getByText(String(TEAM_A_NUMBER)).first(),
    ).toBeVisible();
    await expect(firstRow.getByText(TEAM_A_NAME)).toBeVisible();

    // Verify "Pending" badge
    await expect(firstRow.getByText('Pending')).toBeVisible();

    // Verify "Round 1" context
    await expect(firstRow.getByText('Round 1')).toBeVisible();

    await context.close();
  });

  /* ── 4. Admin accepts the score ─────────────────────────────── */

  test('admin accepts the pending score', async ({ browser }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();

    await page.goto(`/admin/events/${eventId}?view=scoring`);

    await expect(page.locator('table tbody tr').first()).toBeVisible({
      timeout: 10_000,
    });

    // Click Accept on the pending score
    const firstRow = page.locator('table tbody tr').first();
    await firstRow.getByRole('button', { name: 'Accept' }).click();

    // Wait for the status to change to Accepted
    await expect(firstRow.getByText('Accepted')).toBeVisible({
      timeout: 5_000,
    });

    // Verify the seeding_scores table was populated
    const seedingScore = await e2eDb().get<{ score: number }>(
      'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = 1',
      [teamAId],
    );
    expect(seedingScore).toBeDefined();
    expect(seedingScore!.score).toBe(75);

    await context.close();
  });

  /* ── 5. Queue item is removed after acceptance ────────────── */

  test('queue item is removed after score is accepted', async ({ browser }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();
    await bypassQueueSyncLimit(page);

    await page.goto(`/admin/events/${eventId}?view=queue`);

    await expect(page.locator('.admin-content-header h2')).toHaveText('Queue', {
      timeout: 10_000,
    });

    // Show all statuses
    await page.getByRole('button', { name: 'All', exact: true }).click();

    // Accepted scores remove the match from the queue (no row for Team A Round 1)
    const round1Row = page
      .locator('tr', { hasText: TEAM_A_NAME })
      .filter({ hasText: 'Round 1' });
    await expect(round1Row).toHaveCount(0, { timeout: 10_000 });

    await context.close();
  });

  /* ── 6. Judge submits another score, admin rejects it ───────── */

  test('judge submits Team B Round 1 score via queue', async ({ page }) => {
    await enterAsJudge(page);
    await submitSeedingScore(page, TEAM_B_NUMBER, TEAM_B_NAME, 1, 20, 15);
  });

  test('admin rejects score, queue item reverts to queued', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();

    await page.goto(`/admin/events/${eventId}?view=scoring`);

    await expect(page.locator('table tbody tr').first()).toBeVisible({
      timeout: 10_000,
    });

    const pendingRow = page
      .locator('table tbody tr')
      .filter({ hasText: 'Pending' })
      .first();
    await expect(pendingRow).toBeVisible({ timeout: 5_000 });

    await pendingRow.getByRole('button', { name: 'Reject' }).click();

    const confirmBtn = page.locator('.modal').getByRole('button', {
      name: 'Reject',
    });
    await confirmBtn.click();

    // Verify rejection in the UI
    await expect(
      page.locator('table tbody tr').filter({ hasText: 'Rejected' }).first(),
    ).toBeVisible({ timeout: 5_000 });

    // Verify queue item reverted to 'queued' in the DB
    const queueItem = await e2eDb().get<{ status: string }>(
      `SELECT status FROM game_queue
       WHERE event_id = ? AND seeding_team_id = ? AND seeding_round = 1`,
      [eventId, teamBId],
    );
    expect(queueItem).toBeDefined();
    expect(queueItem!.status).toBe('queued');

    await context.close();
  });

  /* ── 8. Full round-trip: submit, accept, verify rankings ────── */

  test('full round-trip: submit two more rounds for Team A, accept, rankings exist', async ({
    page,
    browser,
  }) => {
    // Submit Round 2 for Team A
    await enterAsJudge(page);
    await submitSeedingScore(page, TEAM_A_NUMBER, TEAM_A_NAME, 2, 50, 45);

    // Submit Round 3 for Team A (new page to get fresh scoresheet)
    await enterAsJudge(page);
    await submitSeedingScore(page, TEAM_A_NUMBER, TEAM_A_NAME, 3, 60, 55);

    // Admin accepts both scores via bulk accept
    const context = await browser.newContext();
    await setAdminCookie(context);
    const adminPage = await context.newPage();

    await adminPage.goto(`/admin/events/${eventId}?view=scoring`);
    await expect(adminPage.locator('table tbody tr').first()).toBeVisible({
      timeout: 10_000,
    });

    // Filter to pending
    const statusFilter = adminPage.locator('select.field-input').first();
    await statusFilter.selectOption('pending');

    await expect(adminPage.locator('table tbody tr').first()).toBeVisible({
      timeout: 10_000,
    });

    // Use Bulk Accept
    await adminPage.getByRole('button', { name: 'Bulk Accept' }).click();

    // Modal should appear
    await expect(
      adminPage.locator('.modal h3', { hasText: 'Bulk Accept Scores' }),
    ).toBeVisible({ timeout: 5_000 });

    // Click the accept button in the modal
    const acceptButton = adminPage
      .locator('.modal')
      .getByRole('button', { name: /Accept \d+ Score/ });
    await acceptButton.click();

    // Wait for success toast
    await expect(adminPage.getByText(/Accepted \d+ score/)).toBeVisible({
      timeout: 5_000,
    });

    // Verify seeding rankings were generated in the DB
    const scores = await e2eDb().all<{ round_number: number; score: number }>(
      'SELECT * FROM seeding_scores WHERE team_id = ? ORDER BY round_number',
      [teamAId],
    );

    // Team A should have 3 scored rounds
    expect(scores.length).toBe(3);
    expect(scores[0].score).toBe(75); // R1: 40+35
    expect(scores[1].score).toBe(95); // R2: 50+45
    expect(scores[2].score).toBe(115); // R3: 60+55

    await context.close();
  });
});
