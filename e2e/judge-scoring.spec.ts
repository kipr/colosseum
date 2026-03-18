import { test, expect } from '@playwright/test';
import SQLite from 'better-sqlite3';
import path from 'path';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const DB_PATH = path.join(__dirname, '..', 'database', 'colosseum.db');
const SESSION_DB_PATH = path.join(__dirname, '..', 'database', 'sessions.db');

const ACCESS_CODE = 'e2e-judge-test-code';
const WRONG_CODE = 'wrong-code-xyz';
const EVENT_NAME = 'E2E Judge Scoring Event';
const TEMPLATE_NAME = 'E2E Seeding Sheet';
const TEAM_NAME = 'E2E Alpha Bots';
const TEAM_NUMBER = 42;

/* ------------------------------------------------------------------ */
/*  Shared state seeded in beforeAll                                  */
/* ------------------------------------------------------------------ */

let eventId: number;
let teamId: number;
let templateId: number;

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
        id: 'total_score',
        label: 'Total Score',
        type: 'calculated',
        formula: 'autonomous + driver',
        isGrandTotal: true,
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Helper: navigate through access-code flow to reach /scoresheet    */
/* ------------------------------------------------------------------ */

async function enterAsJudge(page: import('@playwright/test').Page) {
  await page.goto('/judge');
  await page.locator('.template-card', { hasText: TEMPLATE_NAME }).click();
  await page
    .getByPlaceholder('Enter code provided by administrator')
    .fill(ACCESS_CODE);
  await page.getByRole('button', { name: 'Access Scoresheet' }).click();
  await page.waitForURL(/\/scoresheet/);
  await expect(page.locator('.scoresheet-form')).toBeVisible();
}

/* ------------------------------------------------------------------ */
/*  Data lifecycle – serial so beforeAll runs exactly once             */
/* ------------------------------------------------------------------ */

test.describe('Judge Scoring E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    const ev = db
      .prepare(
        `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
       VALUES (?, 'active', 3, 'auto_accept_seeding')`,
      )
      .run(EVENT_NAME);
    eventId = Number(ev.lastInsertRowid);

    const tm = db
      .prepare(
        `INSERT INTO teams (event_id, team_number, team_name, status)
       VALUES (?, ?, ?, 'checked_in')`,
      )
      .run(eventId, TEAM_NUMBER, TEAM_NAME);
    teamId = Number(tm.lastInsertRowid);

    const schema = buildSchema(eventId);
    const tpl = db
      .prepare(
        `INSERT INTO scoresheet_templates (name, description, schema, access_code, is_active)
       VALUES (?, 'E2E test template', ?, ?, 1)`,
      )
      .run(TEMPLATE_NAME, JSON.stringify(schema), ACCESS_CODE);
    templateId = Number(tpl.lastInsertRowid);

    db.prepare(
      `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type)
       VALUES (?, ?, 'seeding')`,
    ).run(eventId, templateId);

    for (let round = 1; round <= 3; round++) {
      db.prepare(
        `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
         VALUES (?, ?, ?, 'seeding', ?, 'queued')`,
      ).run(eventId, teamId, round, round);
    }

    db.close();
  });

  test.afterAll(() => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    db.prepare('DELETE FROM score_submissions WHERE template_id = ?').run(
      templateId,
    );
    db.prepare('DELETE FROM game_queue WHERE event_id = ?').run(eventId);
    db.prepare(
      'DELETE FROM event_scoresheet_templates WHERE template_id = ?',
    ).run(templateId);
    db.prepare('DELETE FROM scoresheet_templates WHERE id = ?').run(templateId);
    db.prepare('DELETE FROM seeding_scores WHERE team_id = ?').run(teamId);
    db.prepare('DELETE FROM audit_log WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM teams WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM events WHERE id = ?').run(eventId);

    db.close();
  });

  /* ── 1. Template selection ─────────────────────────────────────── */

  test('shows scoresheet templates grouped by event on /judge', async ({
    page,
  }) => {
    await page.goto('/judge');

    await expect(
      page.getByRole('heading', { name: 'Select a Score Sheet' }),
    ).toBeVisible();

    // Event name appears as a group header
    await expect(
      page.locator('.template-group-header', { hasText: EVENT_NAME }),
    ).toBeVisible();

    // Template card is visible within the group
    const card = page.locator('.template-card', { hasText: TEMPLATE_NAME });
    await expect(card).toBeVisible();
    await expect(card.locator('h4')).toHaveText(TEMPLATE_NAME);
  });

  /* ── 2. Access-code verification (invalid) ─────────────────────── */

  test('rejects an invalid access code with error message', async ({
    page,
  }) => {
    await page.goto('/judge');
    await page.locator('.template-card', { hasText: TEMPLATE_NAME }).click();

    const modal = page.locator('.modal');
    await expect(
      modal.getByRole('heading', { name: 'Enter Access Code' }),
    ).toBeVisible();
    await expect(
      modal.getByText(`Template: ${TEMPLATE_NAME}`),
    ).toBeVisible();

    await page
      .getByPlaceholder('Enter code provided by administrator')
      .fill(WRONG_CODE);
    await page.getByRole('button', { name: 'Access Scoresheet' }).click();

    await expect(modal.getByText('Invalid access code')).toBeVisible();

    // Modal stays open; URL unchanged
    await expect(page).toHaveURL(/\/judge/);
  });

  /* ── 3. Access-code verification + sessionStorage handoff ──────── */

  test('valid access code stores template in sessionStorage and navigates to /scoresheet', async ({
    page,
  }) => {
    await page.goto('/judge');
    await page.locator('.template-card', { hasText: TEMPLATE_NAME }).click();

    await page
      .getByPlaceholder('Enter code provided by administrator')
      .fill(ACCESS_CODE);
    await page.getByRole('button', { name: 'Access Scoresheet' }).click();

    // Navigation to scoresheet with query params
    await page.waitForURL(/\/scoresheet\?template=\d+&name=/);

    // sessionStorage populated with parsed template
    const stored = await page.evaluate(() =>
      sessionStorage.getItem('currentTemplate'),
    );
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed.id).toBe(templateId);
    expect(parsed.schema).toBeDefined();
    expect(Array.isArray(parsed.schema.fields)).toBe(true);
    expect(parsed.schema.fields.length).toBeGreaterThan(0);

    // access_code must NOT be leaked to the client
    expect(parsed.access_code).toBeUndefined();

    // Scoresheet form renders with the template title
    await expect(page.locator('.scoresheet-form')).toBeVisible();
  });

  /* ── 4. Score submission (queue-based seeding) ─────────────────── */

  test('submits a score via the queue-based seeding form', async ({ page }) => {
    await enterAsJudge(page);

    // Wait for queue items to load from the API
    await expect(page.getByText('Select from Queue')).toBeVisible();
    const queueOption = page.locator('option', {
      hasText: new RegExp(`#${TEAM_NUMBER}.*Round 1`),
    });
    await expect(queueOption).toBeAttached({ timeout: 10_000 });

    // Select the Round 1 queue item
    const queueSelect = page
      .locator('.score-field')
      .filter({ hasText: 'Select from Queue' })
      .locator('select');
    await queueSelect.selectOption({
      label: `#${TEAM_NUMBER} ${TEAM_NAME} \u2013 Round 1`,
    });

    // Fill scoring fields
    const autoInput = page
      .locator('.score-field')
      .filter({ hasText: 'Autonomous' })
      .locator('input[type="number"]');
    await autoInput.fill('25');

    const driverInput = page
      .locator('.score-field')
      .filter({ hasText: 'Driver' })
      .locator('input[type="number"]');
    await driverInput.fill('30');

    // Calculated total should update
    await expect(
      page.locator('.grand-total-field').filter({ hasText: 'Total Score' }),
    ).toContainText('55');

    // Submit
    await page.getByRole('button', { name: 'Submit Score' }).click();

    // Success notification appears
    await expect(
      page.getByText('Score submitted successfully!'),
    ).toBeVisible({ timeout: 5_000 });
  });

  /* ── 5. Expired-session fallback ───────────────────────────────── */

  test('expired judge session shows error and redirects to /judge', async ({
    page,
  }) => {
    await enterAsJudge(page);

    // ── Expire the server-side judge session ──

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === 'connect.sid');
    expect(sessionCookie).toBeDefined();

    const decoded = decodeURIComponent(sessionCookie!.value);
    const sidMatch = decoded.match(/^s:([^.]+)\./);
    expect(sidMatch).toBeTruthy();
    const sid = sidMatch![1];

    const sessDb = new SQLite(SESSION_DB_PATH);
    sessDb.pragma('busy_timeout = 5000');

    const row = sessDb
      .prepare('SELECT sess FROM sessions WHERE sid = ?')
      .get(sid) as { sess: string } | undefined;
    expect(row).toBeDefined();

    const sessData = JSON.parse(row!.sess);
    expect(sessData.judgeAuth).toBeDefined();
    sessData.judgeAuth.expiresAt = Date.now() - 60_000;

    sessDb
      .prepare('UPDATE sessions SET sess = ? WHERE sid = ?')
      .run(JSON.stringify(sessData), sid);
    sessDb.close();

    // ── Fill form and attempt submission ──

    const queueOption = page.locator('option', {
      hasText: new RegExp(`#${TEAM_NUMBER}.*Round 2`),
    });
    await expect(queueOption).toBeAttached({ timeout: 10_000 });

    const queueSelect = page
      .locator('.score-field')
      .filter({ hasText: 'Select from Queue' })
      .locator('select');
    await queueSelect.selectOption({
      label: `#${TEAM_NUMBER} ${TEAM_NAME} \u2013 Round 2`,
    });

    await page
      .locator('.score-field')
      .filter({ hasText: 'Autonomous' })
      .locator('input[type="number"]')
      .fill('10');
    await page
      .locator('.score-field')
      .filter({ hasText: 'Driver' })
      .locator('input[type="number"]')
      .fill('15');

    await page.getByRole('button', { name: 'Submit Score' }).click();

    // Error notification with expiry message
    await expect(page.getByText(/session expired/i)).toBeVisible({
      timeout: 5_000,
    });

    // Client redirects to /judge after ~2 s
    await page.waitForURL(/\/judge/, { timeout: 5_000 });

    // sessionStorage should have been cleared
    const stored = await page.evaluate(() =>
      sessionStorage.getItem('currentTemplate'),
    );
    expect(stored).toBeNull();
  });
});
