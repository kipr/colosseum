import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';
import {
  deleteSession,
  seedAdminSession,
  setSessionCookie,
} from './helpers/session';

const EVENT_NAME = `E2E Admin Queue Mgmt ${Date.now()}`;
const TEAM_A_NAME = 'E2E QMgmt Alpha';
const TEAM_B_NAME = 'E2E QMgmt Beta';
const TEAM_A_NUMBER = 801;
const TEAM_B_NUMBER = 802;

const ADMIN_EMAIL = 'e2e-queue-mgmt-admin@kipr.org';
const ADMIN_NAME = 'E2E Queue Mgmt Admin';

let eventId: number;
let teamAId: number;
let teamBId: number;
let admin: Awaited<ReturnType<typeof seedAdminSession>>;

async function setAdminCookie(context: BrowserContext) {
  await setSessionCookie(context, admin.signedCookie);
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

  test.beforeAll(async () => {
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

    // The queue is materialized as every team x configured seeding round.
    // Keep A R1 and A R2 adjacent in queue order for the reorder assertions.
    const queueItems = [
      [teamAId, 1],
      [teamAId, 2],
      [teamBId, 1],
      [teamBId, 2],
      [teamAId, 3],
      [teamBId, 3],
    ];
    for (const [index, [teamId, round]] of queueItems.entries()) {
      await db.run(
        `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
         VALUES (?, ?, ?, 'seeding', ?, 'queued') RETURNING id`,
        [eventId, teamId, round, index + 1],
      );
    }

    // A prior round outside the configured queue range supplies recent-play
    // history without being materialized as another queue row.
    await db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score, scored_at)
       VALUES (?, 99, 42, CURRENT_TIMESTAMP) RETURNING id`,
      [teamAId],
    );

    admin = await seedAdminSession({ email: ADMIN_EMAIL, name: ADMIN_NAME });
  });

  test.afterAll(async () => {
    const db = e2eDb();

    await db.run('DELETE FROM game_queue WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM teams WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM events WHERE id = ?', [eventId]);
    await deleteSession(admin.sid);
    await db.run('DELETE FROM users WHERE id = ?', [admin.adminUserId]);

    await closeE2eDb();
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
    await expect(page.locator('table tbody tr.queue-row')).toHaveCount(6);
    await expect(page.locator('.queue-summary')).toHaveText('6 items in queue');

    await context.close();
  });

  test('bracket population modal describes the event-wide safe reset', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();
    await bypassQueueSyncLimit(page);

    await page.goto(`/admin/events/${eventId}?view=queue`);
    await page.getByRole('button', { name: 'Populate from Brackets' }).click();

    await expect(
      page.getByRole('heading', { name: 'Populate Queue from Brackets' }),
    ).toBeVisible();
    await expect(
      page.getByText(/Seeding and double-seeding items remain in the queue/),
    ).toBeVisible();
    await expect(
      page.getByText('No brackets found for this event.'),
    ).toBeVisible();

    await context.close();
  });

  test('recently played team shows a warning and call confirmation', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();
    await bypassQueueSyncLimit(page);

    await page.goto(`/admin/events/${eventId}?view=queue`);
    const row = seedingRow(page, TEAM_A_NAME, 1);
    await expect(row.locator('.queue-rest-chip--resting')).toContainText(
      `#${TEAM_A_NUMBER}`,
      { timeout: 15_000 },
    );
    await expect(row).toHaveClass(/queue-row--rest-warning/);

    await row.getByRole('button', { name: 'Called' }).click();
    await expect(
      page.getByRole('heading', { name: 'Call Team Anyway?' }),
    ).toBeVisible();
    await expect(page.getByText(/finished another match/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(row.locator('.queue-status-queued')).toBeVisible();

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
    await page.getByRole('button', { name: 'Call Anyway' }).click();

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

  test('second browser sees a queue status change on the 10s poll', async ({
    browser,
  }) => {
    const actorContext = await browser.newContext();
    const watcherContext = await browser.newContext();
    await setAdminCookie(actorContext);
    await setAdminCookie(watcherContext);
    const actor = await actorContext.newPage();
    const watcher = await watcherContext.newPage();
    await bypassQueueSyncLimit(actor);
    await bypassQueueSyncLimit(watcher);

    await actor.goto(`/admin/events/${eventId}?view=queue`);
    await watcher.goto(`/admin/events/${eventId}?view=queue`);
    await expect(actor.locator('.admin-content-header h2')).toHaveText(
      'Queue',
      {
        timeout: 15_000,
      },
    );
    await expect(watcher.locator('.admin-content-header h2')).toHaveText(
      'Queue',
      { timeout: 15_000 },
    );

    const actorRow = seedingRow(actor, TEAM_B_NAME, 2);
    const watcherRow = seedingRow(watcher, TEAM_B_NAME, 2);
    await expect(watcherRow.locator('.queue-status-queued')).toBeVisible();

    await actorRow.getByRole('button', { name: 'Called' }).click();
    await expect(
      actorRow.locator('.queue-status-badge.queue-status-called'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      actorRow.getByRole('button', { name: 'Called' }),
    ).toBeDisabled();

    await expect(
      watcherRow.locator('.queue-status-badge.queue-status-called'),
    ).toBeVisible({ timeout: 15_000 });

    await actorRow.getByRole('button', { name: 'Back' }).click();
    await expect(
      actorRow.locator('.queue-status-badge.queue-status-queued'),
    ).toBeVisible({ timeout: 10_000 });

    await actorContext.close();
    await watcherContext.close();
  });

  test('queue table omits the order controls', async ({ browser }) => {
    const context = await browser.newContext();
    await setAdminCookie(context);
    const page = await context.newPage();
    await bypassQueueSyncLimit(page);

    await page.goto(`/admin/events/${eventId}?view=queue`);
    await expect(page.locator('.admin-content-header h2')).toHaveText('Queue', {
      timeout: 15_000,
    });

    await expect(
      page.getByRole('columnheader', { name: 'Order', exact: true }),
    ).toHaveCount(0);

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

  test('paired matches track each team presence and retain the single-team flow', async ({
    browser,
  }) => {
    const db = e2eDb();

    const bracket = await db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, actual_team_count, status)
       VALUES (?, 'E2E Presence Bracket', 2, 2, 'in_progress') RETURNING id`,
      [eventId],
    );
    const game = await db.run(
      `INSERT INTO bracket_games
         (bracket_id, game_number, play_order, round_name, round_number,
          bracket_side, team1_id, team2_id, status)
       VALUES (?, 91, 91, 'Presence Final', 1, 'finals', ?, ?, 'ready') RETURNING id`,
      [Number(bracket.lastID), teamAId, teamBId],
    );
    await db.run(
      `INSERT INTO game_queue
         (event_id, bracket_game_id, queue_type, queue_position, status,
          called_at)
       VALUES (?, ?, 'bracket', 20, 'called', CURRENT_TIMESTAMP) RETURNING id`,
      [eventId, Number(game.lastID)],
    );

    const pairedDoubleSeeding = await db.run(
      `INSERT INTO double_seeding_matches
         (event_id, round_number, match_number, team1_id, team2_id, status)
       VALUES (?, 90, 1, ?, ?, 'ready') RETURNING id`,
      [eventId, teamAId, teamBId],
    );
    await db.run(
      `INSERT INTO game_queue
         (event_id, double_seeding_match_id, queue_type, queue_position,
          status, called_at)
       VALUES (?, ?, 'double_seeding', 21, 'called', CURRENT_TIMESTAMP) RETURNING id`,
      [eventId, Number(pairedDoubleSeeding.lastID)],
    );

    const soloDoubleSeeding = await db.run(
      `INSERT INTO double_seeding_matches
         (event_id, round_number, match_number, team1_id, team2_id, status)
       VALUES (?, 91, 1, ?, NULL, 'ready') RETURNING id`,
      [eventId, teamAId],
    );
    await db.run(
      `INSERT INTO game_queue
         (event_id, double_seeding_match_id, queue_type, queue_position,
          status, called_at)
       VALUES (?, ?, 'double_seeding', 22, 'called', CURRENT_TIMESTAMP) RETURNING id`,
      [eventId, Number(soloDoubleSeeding.lastID)],
    );

    const context = await browser.newContext({
      viewport: { width: 600, height: 900 },
    });
    await setAdminCookie(context);
    const page = await context.newPage();
    await bypassQueueSyncLimit(page);
    await page.goto(`/admin/events/${eventId}?view=queue`);

    const bracketRow = page
      .locator('tr.queue-row')
      .filter({ hasText: 'E2E Presence Bracket' });
    await expect(bracketRow).toBeVisible({ timeout: 15_000 });
    await expect(
      bracketRow.getByRole('button', {
        name: `Mark #${TEAM_A_NUMBER} present`,
      }),
    ).toBeVisible();
    await expect(
      bracketRow.getByRole('button', {
        name: `Mark #${TEAM_B_NUMBER} present`,
      }),
    ).toBeVisible();
    await expect(bracketRow.getByText('0/2 present')).toBeVisible();
    await expect(
      bracketRow.getByText(
        `Waiting for #${TEAM_A_NUMBER} and #${TEAM_B_NUMBER}`,
      ),
    ).toBeVisible();
    await expect(
      bracketRow.getByRole('button', { name: 'Arrived' }),
    ).toHaveCount(0);

    await bracketRow
      .getByRole('button', { name: `Mark #${TEAM_A_NUMBER} present` })
      .click();
    await expect(bracketRow.getByText('1/2 present')).toBeVisible();
    await expect(
      bracketRow.getByText(`Waiting for #${TEAM_B_NUMBER}`),
    ).toBeVisible();
    const confirmedTeamA = bracketRow.getByRole('button', {
      name: `✓ #${TEAM_A_NUMBER} present`,
    });
    await expect(confirmedTeamA).toHaveClass(
      /queue-presence-control--confirmed/,
    );

    // The first confirmation remains reversible until the other team arrives.
    await confirmedTeamA.click();
    await expect(bracketRow.getByText('0/2 present')).toBeVisible();
    await bracketRow
      .getByRole('button', { name: `Mark #${TEAM_A_NUMBER} present` })
      .click();
    await bracketRow
      .getByRole('button', { name: `Mark #${TEAM_B_NUMBER} present` })
      .click();

    await expect(
      bracketRow.locator('.queue-status-badge.queue-status-arrived'),
    ).toBeVisible();
    await expect(
      bracketRow.getByRole('button', { name: 'On table' }),
    ).toBeVisible();
    await bracketRow.getByRole('button', { name: 'On table' }).click();
    await expect(
      bracketRow.getByRole('button', { name: 'Scored' }),
    ).toBeVisible();

    // Back from on-table retains arrival; Back again resets both confirmations.
    await bracketRow.getByRole('button', { name: 'Back' }).click();
    await expect(
      bracketRow.locator('.queue-status-badge.queue-status-arrived'),
    ).toBeVisible();
    await bracketRow.getByRole('button', { name: 'Back' }).click();
    await expect(bracketRow.getByText('0/2 present')).toBeVisible();
    await expect(
      bracketRow.getByRole('button', {
        name: `Mark #${TEAM_A_NUMBER} present`,
      }),
    ).toBeVisible();

    const pairedDoubleSeedingRow = page
      .locator('tr.queue-row')
      .filter({ hasText: 'Round 90' });
    await expect(
      pairedDoubleSeedingRow.getByRole('button', {
        name: `Mark #${TEAM_A_NUMBER} present`,
      }),
    ).toBeVisible();

    const soloDoubleSeedingRow = page
      .locator('tr.queue-row')
      .filter({ hasText: 'Round 91' });
    await expect(
      soloDoubleSeedingRow.getByRole('button', { name: 'Arrived' }),
    ).toBeVisible();
    await expect(
      soloDoubleSeedingRow.locator('.queue-presence-controls'),
    ).toHaveCount(0);

    await context.close();
  });
});
