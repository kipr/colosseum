import { test, expect } from '@playwright/test';
import SQLite from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const DB_PATH = path.join(__dirname, '..', 'database', 'colosseum.db');
const SESSION_DB_PATH = path.join(__dirname, '..', 'database', 'sessions.db');
const SESSION_SECRET =
  process.env.SESSION_SECRET || 'colosseum-secret-key-change-in-production';

const EVENT_NAME = 'E2E Bracket Lifecycle Event';
const BRACKET_NAME = 'E2E Main Bracket';
const H2H_TEMPLATE_NAME = 'E2E Bracket Head-to-Head';
const ACCESS_CODE = 'e2e-bracket-lifecycle-code';

const TEAMS = [
  { number: 201, name: 'Alpha Bots' },
  { number: 202, name: 'Beta Builders' },
  { number: 203, name: 'Gamma Gears' },
  { number: 204, name: 'Delta Drives' },
];

/* ------------------------------------------------------------------ */
/*  Shared state seeded in beforeAll                                  */
/* ------------------------------------------------------------------ */

let eventId: number;
let teamIds: number[];
let adminUserId: number;
let templateId: number;
let signedCookie: string;
let bracketId: number;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function signSessionId(sid: string, secret: string): string {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `s:${sid}.${signature}`;
}

function buildH2hSchema(evtId: number, bktId: number) {
  return {
    title: H2H_TEMPLATE_NAME,
    mode: 'head-to-head',
    eventId: evtId,
    scoreDestination: 'db',
    layout: 'two-column',
    bracketSource: { type: 'db', bracketId: bktId },
    teamsDataSource: { type: 'db', eventId: evtId },
    fields: [
      {
        id: 'game_number',
        label: 'Select Game',
        type: 'dropdown',
        required: true,
        dataSource: { type: 'bracket' },
      },
      {
        id: 'team_a_score',
        label: 'Team A Score',
        type: 'number',
        min: 0,
        max: 100,
        column: 'left',
      },
      {
        id: 'team_b_score',
        label: 'Team B Score',
        type: 'number',
        min: 0,
        max: 100,
        column: 'right',
      },
      {
        id: 'team_a_total',
        label: 'Team A Total',
        type: 'calculated',
        formula: 'team_a_score',
        isTotal: true,
      },
      {
        id: 'team_b_total',
        label: 'Team B Total',
        type: 'calculated',
        formula: 'team_b_score',
        isTotal: true,
      },
      {
        id: 'winner',
        label: 'Winner',
        type: 'winner-select',
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Data lifecycle – serial so state flows across tests               */
/* ------------------------------------------------------------------ */

test.describe('Bracket Lifecycle E2E', () => {
  test.describe.configure({ mode: 'serial' });

  /* ── Seed data ─────────────────────────────────────────────────── */

  test.beforeAll(() => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    // 1. Admin user
    const userResult = db
      .prepare(
        `INSERT INTO users (name, email, google_id, is_admin)
         VALUES (?, ?, ?, 1)`,
      )
      .run('E2E Bracket Admin', 'e2e-bracket@test.com', 'google-e2e-bracket');
    adminUserId = Number(userResult.lastInsertRowid);

    // 2. Event (manual score acceptance so bracket scores stay pending)
    const evResult = db
      .prepare(
        `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
         VALUES (?, 'active', 3, 'manual')`,
      )
      .run(EVENT_NAME);
    eventId = Number(evResult.lastInsertRowid);

    // 3. Teams
    teamIds = TEAMS.map((t) => {
      const r = db
        .prepare(
          `INSERT INTO teams (event_id, team_number, team_name, status)
           VALUES (?, ?, ?, 'checked_in')`,
        )
        .run(eventId, t.number, t.name);
      return Number(r.lastInsertRowid);
    });

    // 4. Seeding scores (3 rounds per team; descending so team order is predictable)
    const baseScores = [90, 70, 50, 30];
    for (let i = 0; i < teamIds.length; i++) {
      for (let round = 1; round <= 3; round++) {
        db.prepare(
          `INSERT INTO seeding_scores (team_id, round_number, score, scored_at)
           VALUES (?, ?, ?, datetime('now'))`,
        ).run(teamIds[i], round, baseScores[i] + round);
      }
    }

    // 5. Seeding rankings (seed 1 = highest average)
    for (let i = 0; i < teamIds.length; i++) {
      const avg = baseScores[i] + 2; // average of rounds 1-3
      db.prepare(
        `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score)
         VALUES (?, ?, ?, ?)`,
      ).run(teamIds[i], avg, i + 1, avg / 100);
    }

    // 6. Admin session in sessions.db
    const sid = crypto.randomUUID();
    const sessionData = JSON.stringify({
      cookie: {
        originalMaxAge: 604800000,
        expires: new Date(Date.now() + 604800000).toISOString(),
        secure: false,
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
      },
      passport: { user: adminUserId },
    });

    const sessDb = new SQLite(SESSION_DB_PATH);
    sessDb.pragma('journal_mode = WAL');
    sessDb.pragma('busy_timeout = 5000');
    sessDb
      .prepare(
        `INSERT OR REPLACE INTO sessions (sid, sess, expires)
         VALUES (?, ?, ?)`,
      )
      .run(sid, sessionData, Date.now() + 604800000);
    sessDb.close();

    signedCookie = signSessionId(sid, SESSION_SECRET);

    db.close();
  });

  /* ── Cleanup ───────────────────────────────────────────────────── */

  test.afterAll(() => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    db.prepare('DELETE FROM score_submissions WHERE event_id = ?').run(eventId);
    db.prepare(
      `DELETE FROM bracket_games WHERE bracket_id IN
       (SELECT id FROM brackets WHERE event_id = ?)`,
    ).run(eventId);
    db.prepare(
      `DELETE FROM bracket_entries WHERE bracket_id IN
       (SELECT id FROM brackets WHERE event_id = ?)`,
    ).run(eventId);
    db.prepare('DELETE FROM brackets WHERE event_id = ?').run(eventId);
    if (templateId) {
      db.prepare(
        'DELETE FROM event_scoresheet_templates WHERE template_id = ?',
      ).run(templateId);
      db.prepare('DELETE FROM scoresheet_templates WHERE id = ?').run(
        templateId,
      );
    }
    db.prepare('DELETE FROM seeding_rankings WHERE team_id IN (?, ?, ?, ?)').run(
      ...teamIds,
    );
    db.prepare('DELETE FROM seeding_scores WHERE team_id IN (?, ?, ?, ?)').run(
      ...teamIds,
    );
    db.prepare('DELETE FROM audit_log WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM teams WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
    db.prepare('DELETE FROM users WHERE id = ?').run(adminUserId);

    db.close();

    const sessDb = new SQLite(SESSION_DB_PATH);
    sessDb.pragma('busy_timeout = 5000');
    sessDb
      .prepare(
        `DELETE FROM sessions WHERE sess LIKE ?`,
      )
      .run(`%"user":${adminUserId}%`);
    sessDb.close();
  });

  /* ── Helper: set admin cookie on page ──────────────────────────── */

  async function setAdminCookie(page: import('@playwright/test').Page) {
    await page.context().addCookies([
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

  /* ── 1. Admin creates bracket from ranked teams ────────────────── */

  test('admin creates a bracket from ranked teams via the UI', async ({
    page,
  }) => {
    await setAdminCookie(page);
    await page.goto(`/admin/events/${eventId}?view=brackets`);

    // Wait for the admin page to load with the event
    await expect(page.locator('.admin-content')).toBeVisible({
      timeout: 15_000,
    });

    // Click "+ Create Bracket"
    await page.getByRole('button', { name: '+ Create Bracket' }).click();

    // Modal appears
    await expect(page.getByRole('heading', { name: 'Create Bracket' })).toBeVisible();

    // Wait for teams to load in the modal
    await expect(
      page.locator('.bracket-create-teams-table'),
    ).toBeVisible({ timeout: 10_000 });

    // Enter bracket name
    await page.locator('#bracket-name').fill(BRACKET_NAME);

    // Select all available teams
    await page
      .getByRole('button', { name: 'Select All Available' })
      .click();

    // Summary should show 4 teams selected, bracket size 4, 0 byes
    const summary = page.locator('.bracket-create-summary');
    await expect(summary).toContainText('4 teams');
    await expect(summary).toContainText('Bracket size: 4');
    await expect(summary).toContainText('Byes: 0');

    // Submit (exact match to avoid the "+ Create Bracket" button)
    await page
      .getByRole('button', { name: 'Create Bracket', exact: true })
      .click();

    // Should navigate to bracket detail view
    await page.waitForURL(/\/admin\/events\/\d+\/brackets\/\d+/, {
      timeout: 10_000,
    });

    // Extract bracketId from URL
    const url = page.url();
    const match = url.match(/\/brackets\/(\d+)/);
    expect(match).toBeTruthy();
    bracketId = Number(match![1]);
    expect(bracketId).toBeGreaterThan(0);

    // Bracket header should show
    await expect(page.locator('.bracket-header-card')).toBeVisible();
    await expect(
      page.locator('.bracket-header-card').getByText(BRACKET_NAME),
    ).toBeVisible();
  });

  /* ── 2. URL-driven bracket detail views ────────────────────────── */

  test('bracket detail view renders with correct URL-driven views', async ({
    page,
  }) => {
    await setAdminCookie(page);

    // Management view
    await page.goto(
      `/admin/events/${eventId}/brackets/${bracketId}?view=management`,
    );
    await expect(page.locator('.bracket-header-card')).toBeVisible({
      timeout: 15_000,
    });

    // Entries section should show 4 entries
    await expect(
      page.getByRole('heading', { name: /Bracket Entries\s*\(4\)/ }),
    ).toBeVisible();

    // Games section should show games
    const gamesHeading = page.getByRole('heading', {
      name: /Bracket Games\s*\(\d+\)/,
    });
    await expect(gamesHeading).toBeVisible();

    // Winners Bracket side should be present
    await expect(page.getByText('Winners Bracket')).toBeVisible();

    // Bracket view (via URL)
    await page.goto(
      `/admin/events/${eventId}/brackets/${bracketId}?view=bracket`,
    );
    await expect(page.locator('.bracket-header-card')).toBeVisible({
      timeout: 10_000,
    });

    // View mode toggle should show Bracket View as active
    const bracketViewBtn = page.getByRole('button', { name: 'Bracket View' });
    await expect(bracketViewBtn).toBeVisible();

    // Ranking view (via URL)
    await page.goto(
      `/admin/events/${eventId}/brackets/${bracketId}?view=ranking`,
    );
    await expect(page.locator('.bracket-header-card')).toBeVisible({
      timeout: 10_000,
    });
    const rankingViewBtn = page.getByRole('button', { name: 'Ranking View' });
    await expect(rankingViewBtn).toBeVisible();
  });

  /* ── 3. Seed H2H template (now that bracket exists) ────────────── */

  test('seed head-to-head scoresheet template for bracket games', async () => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    const schema = buildH2hSchema(eventId, bracketId);
    const tpl = db
      .prepare(
        `INSERT INTO scoresheet_templates (name, description, schema, access_code, is_active)
         VALUES (?, 'E2E bracket head-to-head template', ?, ?, 1)`,
      )
      .run(H2H_TEMPLATE_NAME, JSON.stringify(schema), ACCESS_CODE);
    templateId = Number(tpl.lastInsertRowid);

    db.prepare(
      `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type)
       VALUES (?, ?, 'bracket')`,
    ).run(eventId, templateId);

    db.close();

    expect(templateId).toBeGreaterThan(0);
  });

  /* ── 4. Judge submits winner for a bracket game ────────────────── */

  test('judge submits a bracket game winner via head-to-head scoresheet', async ({
    page,
  }) => {
    // Navigate to judge page
    await page.goto('/judge');

    // Select the H2H template
    await page
      .locator('.template-card', { hasText: H2H_TEMPLATE_NAME })
      .click();

    // Enter access code
    await page
      .getByPlaceholder('Enter code provided by administrator')
      .fill(ACCESS_CODE);
    await page.getByRole('button', { name: 'Access Scoresheet' }).click();

    // Should navigate to scoresheet
    await page.waitForURL(/\/scoresheet/, { timeout: 10_000 });
    await expect(page.locator('.scoresheet-form')).toBeVisible();

    // Wait for bracket games to load in the dropdown
    const gameSelect = page
      .locator('.scoresheet-header-fields')
      .locator('select')
      .first();
    await expect(gameSelect).toBeVisible({ timeout: 10_000 });

    // Wait for a real game option to appear (not just the placeholder)
    const firstGameOption = gameSelect.locator(
      'option:not([value=""]):not([disabled])',
    );
    await expect(firstGameOption.first()).toBeAttached({ timeout: 10_000 });
    const gameValue = await firstGameOption.first().getAttribute('value');
    expect(gameValue).toBeTruthy();
    await gameSelect.selectOption(gameValue!);

    // Team names should populate
    const winnerSection = page.locator('.winner-select-container');
    await expect(winnerSection).toBeVisible();

    // Enter scores (fields are in two-column layout)
    const teamAScoreInput = page
      .locator('.scoresheet-column')
      .first()
      .locator('input[type="number"]');
    await teamAScoreInput.fill('75');

    const teamBScoreInput = page
      .locator('.scoresheet-column')
      .nth(1)
      .locator('input[type="number"]');
    await teamBScoreInput.fill('50');

    // Select Team A as the winner (first button in winner-options)
    const winnerButtons = page.locator('.winner-button');
    await winnerButtons.first().click();
    await expect(winnerButtons.first().locator('.winner-badge')).toBeVisible();

    // Submit
    await page.getByRole('button', { name: 'Submit Winner' }).click();

    // Success notification
    await expect(
      page.getByText('Score submitted successfully!'),
    ).toBeVisible({ timeout: 5_000 });
  });

  /* ── 5. Admin accepts the bracket score ────────────────────────── */

  test('admin accepts pending bracket score in the scoring tab', async ({
    page,
  }) => {
    await setAdminCookie(page);
    await page.goto(`/admin/events/${eventId}?view=scoring`);

    // Wait for scoring tab to load
    await expect(page.getByRole('heading', { name: 'Scoring' })).toBeVisible({
      timeout: 15_000,
    });

    // Wait for scores to load
    await expect(page.locator('table')).toBeVisible({ timeout: 10_000 });

    // Find the bracket score row with "Pending" badge
    const pendingRow = page
      .locator('tr')
      .filter({ has: page.locator('.badge-purple') })
      .filter({ has: page.locator('.badge-warning') })
      .first();

    await expect(pendingRow).toBeVisible({ timeout: 10_000 });

    // Context should show bracket name and game number
    await expect(pendingRow).toContainText(BRACKET_NAME);

    // Click Accept
    await pendingRow.getByRole('button', { name: 'Accept' }).click();

    // Success toast should appear
    await expect(
      page.getByText(/Score accepted/i),
    ).toBeVisible({ timeout: 5_000 });
  });

  /* ── 6. Bracket view shows updated winner and advancement ──────── */

  test('bracket management view reflects the accepted winner', async ({
    page,
  }) => {
    await setAdminCookie(page);
    await page.goto(
      `/admin/events/${eventId}/brackets/${bracketId}?view=management`,
    );

    await expect(page.locator('.bracket-header-card')).toBeVisible({
      timeout: 15_000,
    });

    // Find the completed game row in the Winners Bracket games table
    const winnersSection = page
      .locator('.games-side-group')
      .filter({ hasText: 'Winners Bracket' });
    await expect(winnersSection).toBeVisible();

    // At least one game should show "Completed" status
    await expect(
      winnersSection.locator('.game-status-badge', { hasText: 'Completed' }),
    ).toBeVisible({ timeout: 10_000 });

    // The completed row should show a winner team name
    const completedRow = winnersSection
      .locator('tr')
      .filter({ has: page.locator('.game-status-badge', { hasText: 'Completed' }) })
      .first();
    await expect(completedRow).toBeVisible();

    // Winner column should contain a .team-name element (not "—")
    await expect(completedRow.locator('td .team-name').last()).toBeVisible();

    // The winner should be one of our team numbers
    const winnerText = await completedRow.locator('td .team-name').last().textContent();
    const hasTeamNumber = TEAMS.some((t) =>
      winnerText?.includes(String(t.number)),
    );
    expect(hasTeamNumber).toBe(true);
  });
});
