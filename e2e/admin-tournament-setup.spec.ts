import { test, expect } from '@playwright/test';
import SQLite from 'better-sqlite3';
import { sign } from 'cookie-signature';
import crypto from 'crypto';
import path from 'path';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const DB_PATH = path.join(__dirname, '..', 'database', 'colosseum.db');
const SESSION_DB_PATH = path.join(__dirname, '..', 'database', 'sessions.db');
const SESSION_SECRET = 'colosseum-secret-key-change-in-production';

const ADMIN_EMAIL = 'e2e-admin@kipr.org';
const ADMIN_NAME = 'E2E Admin';
const GOOGLE_ID = `e2e-admin-${Date.now()}`;

const EVENT_NAME = `E2E Admin Setup ${Date.now()}`;
const TEAM_SINGLE = { number: 500, name: 'Solo Bots' };
const BULK_TEAMS = [
  { number: 501, name: 'Alpha Droids' },
  { number: 502, name: 'Beta Machines' },
  { number: 503, name: 'Gamma Gears' },
];
const SCORESHEET_NAME = `E2E Seeding Sheet ${Date.now()}`;
const ACCESS_CODE = `e2e-setup-${Date.now()}`;

/* ------------------------------------------------------------------ */
/*  Shared state                                                      */
/* ------------------------------------------------------------------ */

let userId: number;
let sessionId: string;
let signedCookie: string;
let createdEventId: number | null = null;

/* ------------------------------------------------------------------ */
/*  Helper: inject admin session into SQLite                          */
/* ------------------------------------------------------------------ */

function createAdminSession() {
  const db = new SQLite(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  const result = db
    .prepare(
      `INSERT INTO users (google_id, email, name, is_admin)
       VALUES (?, ?, ?, 1)`,
    )
    .run(GOOGLE_ID, ADMIN_EMAIL, ADMIN_NAME);
  userId = Number(result.lastInsertRowid);
  db.close();

  sessionId = crypto.randomBytes(24).toString('hex');
  const sessionData = {
    cookie: {
      originalMaxAge: 7 * 24 * 60 * 60 * 1000,
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      secure: false,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    },
    passport: { user: userId },
  };

  const sessDb = new SQLite(SESSION_DB_PATH);
  sessDb.pragma('journal_mode = WAL');
  sessDb.pragma('busy_timeout = 5000');

  sessDb
    .prepare(
      `INSERT INTO sessions (sid, sess, expires)
       VALUES (?, ?, ?)`,
    )
    .run(
      sessionId,
      JSON.stringify(sessionData),
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    );
  sessDb.close();

  signedCookie = 's:' + sign(sessionId, SESSION_SECRET);
}

/* ------------------------------------------------------------------ */
/*  Helper: set admin session cookie on page context                  */
/* ------------------------------------------------------------------ */

async function loginAsAdmin(page: import('@playwright/test').Page) {
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

/* ------------------------------------------------------------------ */
/*  Test suite: serial, full admin setup path                         */
/* ------------------------------------------------------------------ */

test.describe('Admin Tournament Setup E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    createAdminSession();
  });

  test.afterAll(() => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    if (createdEventId) {
      db.prepare(
        'DELETE FROM event_scoresheet_templates WHERE event_id = ?',
      ).run(createdEventId);
      db.prepare(
        'DELETE FROM scoresheet_templates WHERE id IN (SELECT template_id FROM event_scoresheet_templates WHERE event_id = ?)',
      ).run(createdEventId);
    }

    // Clean up scoresheet templates by name (in case the join-based delete didn't catch them)
    db.prepare('DELETE FROM scoresheet_templates WHERE name = ?').run(
      SCORESHEET_NAME,
    );

    if (createdEventId) {
      db.prepare(
        'DELETE FROM event_scoresheet_templates WHERE event_id = ?',
      ).run(createdEventId);
      db.prepare('DELETE FROM teams WHERE event_id = ?').run(createdEventId);
      db.prepare('DELETE FROM events WHERE id = ?').run(createdEventId);
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.close();

    const sessDb = new SQLite(SESSION_DB_PATH);
    sessDb.pragma('busy_timeout = 5000');
    sessDb.prepare('DELETE FROM sessions WHERE sid = ?').run(sessionId);
    sessDb.close();
  });

  /* ── 1. Create Event ────────────────────────────────────────────── */

  test('creates a new event via the admin Events tab', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/events?view=events');

    const createEventButton = page.getByRole('button', {
      name: '+ Create New Event',
    });
    await expect(createEventButton).toBeVisible({ timeout: 30_000 });

    await createEventButton.click();

    const modal = page.locator('.modal.show');
    await expect(modal.getByRole('heading', { name: 'Create New Event' })).toBeVisible();

    await modal.locator('#event-name').fill(EVENT_NAME);
    await modal.locator('#event-description').fill('E2E test event');
    await modal.locator('#event-location').fill('Test Arena');

    await modal.getByRole('button', { name: 'Create Event' }).click();

    // Modal closes and event appears in the page (table or selected card)
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('strong', { hasText: EVENT_NAME }),
    ).toBeVisible({ timeout: 5_000 });

    // Capture the event ID from the URL for cleanup
    const url = page.url();
    const match = url.match(/\/admin\/events\/(\d+)/);
    if (match) {
      createdEventId = Number(match[1]);
    } else {
      // Fall back to DB lookup
      const db = new SQLite(DB_PATH);
      db.pragma('busy_timeout = 5000');
      const row = db
        .prepare('SELECT id FROM events WHERE name = ?')
        .get(EVENT_NAME) as { id: number } | undefined;
      if (row) createdEventId = row.id;
      db.close();
    }

    expect(createdEventId).toBeTruthy();
  });

  /* ── 2. Event is selected and persisted ─────────────────────────── */

  test('selected event persists in localStorage', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/events/${createdEventId}?view=events`);

    await expect(page.getByText('Currently Selected')).toBeVisible();

    const storedId = await page.evaluate(
      () => localStorage.getItem('colosseum_selected_event_id'),
    );
    expect(storedId).toBe(String(createdEventId));
  });

  /* ── 3. Add a single team ──────────────────────────────────────── */

  test('adds a single team via the Teams tab', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/events/${createdEventId}?view=teams`);

    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();

    await page.getByRole('button', { name: '+ Add Team' }).click();

    const modal = page.locator('.modal.show');
    await expect(
      modal.getByRole('heading', { name: 'Add New Team' }),
    ).toBeVisible();

    await modal.locator('#team-number').fill(String(TEAM_SINGLE.number));
    await modal.locator('#team-name').fill(TEAM_SINGLE.name);
    await modal.getByRole('button', { name: 'Add Team' }).click();

    await expect(page.getByText('Team created!')).toBeVisible({
      timeout: 5_000,
    });

    // Team appears in the table
    await expect(
      page.locator('td', { hasText: String(TEAM_SINGLE.number) }),
    ).toBeVisible();
    await expect(
      page.locator('td', { hasText: TEAM_SINGLE.name }),
    ).toBeVisible();
  });

  /* ── 4. Bulk import teams ──────────────────────────────────────── */

  test('bulk imports teams via CSV', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/events/${createdEventId}?view=teams`);

    await page.getByRole('button', { name: 'Bulk Import' }).click();

    const modal = page.locator('.modal.show');
    await expect(
      modal.getByRole('heading', { name: 'Bulk Import Teams' }),
    ).toBeVisible();

    const csvText = BULK_TEAMS.map((t) => `${t.number}, ${t.name}`).join('\n');
    await modal.locator('#bulk-text').fill(csvText);

    // Preview should show the correct count
    await expect(
      modal.getByText(`Preview (${BULK_TEAMS.length} teams to import)`),
    ).toBeVisible();

    await modal
      .getByRole('button', { name: `Import ${BULK_TEAMS.length} Team(s)` })
      .click();

    await expect(
      page.getByText(`Imported ${BULK_TEAMS.length} team(s)`),
    ).toBeVisible({ timeout: 5_000 });

    // All bulk-imported teams should appear in the table
    for (const team of BULK_TEAMS) {
      await expect(
        page.locator('td', { hasText: String(team.number) }),
      ).toBeVisible();
    }

    // Total should include the single team + bulk teams
    await expect(
      page.getByText(`${1 + BULK_TEAMS.length} teams`),
    ).toBeVisible();
  });

  /* ── 5. Bulk check-in ──────────────────────────────────────────── */

  test('bulk checks in all registered teams', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/events/${createdEventId}?view=teams`);

    // Wait for teams to load
    await expect(
      page.getByText(`${1 + BULK_TEAMS.length} teams`),
    ).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Bulk Check-In' }).click();

    const modal = page.locator('.modal.show');
    await expect(
      modal.getByRole('heading', { name: 'Bulk Check-In Teams' }),
    ).toBeVisible();

    const totalTeams = 1 + BULK_TEAMS.length;
    // All registered teams should be pre-selected
    await expect(
      modal.getByText(`${totalTeams} of ${totalTeams} selected`),
    ).toBeVisible();

    await modal
      .getByRole('button', { name: `Check In ${totalTeams} Team(s)` })
      .click();

    await expect(
      page.getByText(`Checked in ${totalTeams} team(s)`),
    ).toBeVisible({ timeout: 5_000 });

    // All teams should now show "Checked In" status
    const checkedInBadges = page.locator('.team-status-badge.status-checked-in');
    await expect(checkedInBadges).toHaveCount(totalTeams);
  });

  /* ── 6. Create score sheet (manual JSON path) ──────────────────── */

  test('creates a score sheet via Paste JSON Manually', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/events/${createdEventId}?view=scoresheets`);

    await expect(page.getByRole('heading', { name: 'Score Sheets' })).toBeVisible();

    // Click the Create button in the event-scoped section
    const eventSection = page.locator('.card').filter({
      hasText: '+ Create New Score Sheet',
    });
    await eventSection
      .getByRole('button', { name: '+ Create New Score Sheet' })
      .click();

    // Choose "Paste JSON Manually"
    const choiceModal = page.locator('.modal.show');
    await expect(
      choiceModal.getByText('Paste JSON Manually'),
    ).toBeVisible();
    await choiceModal.getByText('Paste JSON Manually').click();

    // Template editor modal
    const editorModal = page.locator('.modal.show');
    await expect(
      editorModal.getByRole('heading', { name: 'Create New Score Sheet' }),
    ).toBeVisible();

    // Fill in the form
    await editorModal
      .locator('input.field-input')
      .first()
      .fill(SCORESHEET_NAME);

    // Description textarea (first textarea)
    const descTextarea = editorModal.locator('textarea.field-input').first();
    await descTextarea.fill('E2E test score sheet');

    // Access code
    await editorModal
      .getByPlaceholder('Enter code for judges to use')
      .fill(ACCESS_CODE);

    // Schema JSON (second textarea)
    const schema = {
      title: SCORESHEET_NAME,
      eventId: createdEventId,
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
            eventId: createdEventId,
            labelField: 'team_number',
            valueField: 'team_number',
          },
        },
        {
          id: 'round',
          label: 'Round',
          type: 'dropdown',
          required: true,
          options: [
            { label: 'Round 1', value: '1' },
            { label: 'Round 2', value: '2' },
          ],
        },
        {
          id: 'score',
          label: 'Score',
          type: 'number',
          min: 0,
          max: 100,
        },
      ],
    };

    const schemaTextarea = editorModal.locator(
      'textarea.field-input[style*="monospace"]',
    );
    await schemaTextarea.fill(JSON.stringify(schema, null, 2));

    await editorModal
      .getByRole('button', { name: 'Create Score Sheet' })
      .click();

    // Success message appears
    await expect(
      page.getByText('Score sheet created successfully!'),
    ).toBeVisible({ timeout: 5_000 });

    // Score sheet should now appear in the list with name and access code
    await expect(page.locator('td', { hasText: SCORESHEET_NAME })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('code', { hasText: ACCESS_CODE })).toBeVisible();
  });

  /* ── 7. Score sheet appears on the judge page ──────────────────── */

  test('score sheet appears on the judge page under the event', async ({
    page,
  }) => {
    // Judge page does not require auth
    await page.goto('/judge');

    await expect(
      page.getByRole('heading', { name: 'Select a Score Sheet' }),
    ).toBeVisible();

    // The event we created should be active/setup, so its templates show here.
    // But the event is in 'setup' status — let's verify the template appears.
    // The public GET /scoresheet/templates returns templates for setup + active events.
    await expect(
      page.locator('.template-group-header', { hasText: EVENT_NAME }),
    ).toBeVisible({ timeout: 10_000 });

    const card = page.locator('.template-card', { hasText: SCORESHEET_NAME });
    await expect(card).toBeVisible();
    await expect(card.locator('h4')).toHaveText(SCORESHEET_NAME);
  });

  /* ── 8. Access code works for the created score sheet ──────────── */

  test('judge can verify access code for the created score sheet', async ({
    page,
  }) => {
    await page.goto('/judge');

    await page.locator('.template-card', { hasText: SCORESHEET_NAME }).click();

    const modal = page.locator('.modal');
    await expect(
      modal.getByRole('heading', { name: 'Enter Access Code' }),
    ).toBeVisible();

    await page
      .getByPlaceholder('Enter code provided by administrator')
      .fill(ACCESS_CODE);
    await page.getByRole('button', { name: 'Access Scoresheet' }).click();

    await page.waitForURL(/\/scoresheet/);
    await expect(page.locator('.scoresheet-form')).toBeVisible();
  });
});
