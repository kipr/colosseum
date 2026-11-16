import { randomUUID } from 'node:crypto';
import {
  test,
  expect,
  type APIResponse,
  type Browser,
  type Page,
} from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';
import {
  deleteSession,
  seedAdminSession,
  setSessionCookie,
} from './helpers/session';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

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

let admin: Awaited<ReturnType<typeof seedAdminSession>>;
let createdEventId: number | null = null;

/* ------------------------------------------------------------------ */
/*  Helper: set admin session cookie on page context                  */
/* ------------------------------------------------------------------ */

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await setSessionCookie(page, admin.signedCookie);
}

/* ------------------------------------------------------------------ */
/*  Test suite: serial, full admin setup path                         */
/* ------------------------------------------------------------------ */

test.describe('Admin Tournament Setup E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    admin = await seedAdminSession({
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      googleId: GOOGLE_ID,
    });
  });

  test.afterAll(async () => {
    const db = e2eDb();

    if (createdEventId) {
      await db.run(
        'DELETE FROM scoresheet_templates WHERE id IN (SELECT template_id FROM event_scoresheet_templates WHERE event_id = ?)',
        [createdEventId],
      );
      await db.run(
        'DELETE FROM event_scoresheet_templates WHERE event_id = ?',
        [createdEventId],
      );
    }

    // Clean up scoresheet templates by name (in case the join-based delete didn't catch them)
    await db.run('DELETE FROM scoresheet_templates WHERE name = ?', [
      SCORESHEET_NAME,
    ]);

    if (createdEventId) {
      await db.run('DELETE FROM teams WHERE event_id = ?', [createdEventId]);
      await db.run('DELETE FROM events WHERE id = ?', [createdEventId]);
    }

    await deleteSession(admin.sid);
    await db.run('DELETE FROM users WHERE id = ?', [admin.adminUserId]);

    await closeE2eDb();
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

    const modal = page.getByRole('dialog');
    await expect(
      modal.getByRole('heading', { name: 'Create New Event' }),
    ).toBeVisible();

    await modal.locator('#event-name').fill(EVENT_NAME);
    await modal.locator('#event-description').fill('E2E test event');
    await modal.locator('#event-location').fill('Test Arena');

    await modal.getByRole('button', { name: 'Create Event' }).click();

    // Modal closes and event appears in the page (table or selected card)
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('strong', { hasText: EVENT_NAME })).toBeVisible({
      timeout: 5_000,
    });

    // Capture the event ID from the URL for cleanup
    const url = page.url();
    const match = url.match(/\/admin\/events\/(\d+)/);
    if (match) {
      createdEventId = Number(match[1]);
    } else {
      // Fall back to DB lookup
      const row = await e2eDb().get<{ id: number }>(
        'SELECT id FROM events WHERE name = ?',
        [EVENT_NAME],
      );
      if (row) createdEventId = row.id;
    }

    expect(createdEventId).toBeTruthy();
  });

  /* ── 2. Event is selected and persisted ─────────────────────────── */

  test('selected event persists in localStorage', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/events/${createdEventId}?view=events`);

    await expect(page.getByText('Currently Selected')).toBeVisible();

    const storedId = await page.evaluate(() =>
      localStorage.getItem('colosseum_selected_event_id'),
    );
    expect(storedId).toBe(String(createdEventId));
  });

  /* ── 3. Add a single team ──────────────────────────────────────── */

  test('adds a single team via the Teams tab', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/events/${createdEventId}?view=teams`);

    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();

    await page.getByRole('button', { name: '+ Add Team' }).click();

    const modal = page.getByRole('dialog');
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

    const modal = page.getByRole('dialog');
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
    await expect(page.getByText(`${1 + BULK_TEAMS.length} teams`)).toBeVisible({
      timeout: 5_000,
    });

    await page.getByRole('button', { name: 'Bulk Check-In' }).click();

    const modal = page.getByRole('dialog');
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
    const checkedInBadges = page.locator(
      '.team-status-badge.status-checked-in',
    );
    await expect(checkedInBadges).toHaveCount(totalTeams);
  });

  /* ── 6. Create score sheet (manual JSON path) ──────────────────── */

  test('creates a score sheet via Paste JSON Manually', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/events/${createdEventId}?view=scoresheets`);

    await expect(
      page.getByRole('heading', { name: 'Score Sheets' }),
    ).toBeVisible();

    // Click the Create button in the event-scoped section
    const eventSection = page.locator('.card').filter({
      hasText: '+ Create New Score Sheet',
    });
    await eventSection
      .getByRole('button', { name: '+ Create New Score Sheet' })
      .click();

    // Choose "Paste JSON Manually"
    const choiceModal = page.getByRole('dialog');
    await expect(choiceModal.getByText('Paste JSON Manually')).toBeVisible();
    await choiceModal.getByText('Paste JSON Manually').click();

    // Template editor modal
    const editorModal = page.getByRole('dialog');
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

/* ------------------------------------------------------------------ */
/*  Spectator archive: independent fixtures, not the serial setup flow  */
/* ------------------------------------------------------------------ */

test.describe('Spectator archive admin controls', () => {
  type Season = { id: number; name: string; sort_order: number };
  type Status = 'setup' | 'active' | 'complete' | 'archived';
  type SeededEvent = {
    id: number;
    name: string;
    status: Status;
    released: number;
  };
  type PublicEvent = {
    id: number;
    name: string;
    status: Status;
    spectator_listing: 'current' | 'archive';
    season_id: number | null;
    season_name: string | null;
    final_scores_available: boolean;
  };

  let prefix: string;
  let archiveAdmin: Awaited<ReturnType<typeof seedAdminSession>> | undefined;

  test.beforeEach(async ({ page }) => {
    prefix = `E2E Archive ${randomUUID()}`;
    archiveAdmin = await seedAdminSession({
      email: `${randomUUID()}@kipr.org`,
      name: prefix,
    });
    await setSessionCookie(page, archiveAdmin.signedCookie);
  });

  test.afterEach(async () => {
    const db = e2eDb();
    if (archiveAdmin) {
      await db.run('DELETE FROM audit_log WHERE user_id = ?', [
        archiveAdmin.adminUserId,
      ]);
    }
    // Names also catch rows created in the UI if an assertion fails before
    // their IDs are captured. Event-owned sentinel rows cascade on deletion.
    await db.run('DELETE FROM events WHERE name LIKE ?', [`${prefix}%`]);
    await db.run('DELETE FROM seasons WHERE name LIKE ?', [`${prefix}%`]);
    if (archiveAdmin) {
      await deleteSession(archiveAdmin.sid);
      await db.run('DELETE FROM users WHERE id = ?', [
        archiveAdmin.adminUserId,
      ]);
      archiveAdmin = undefined;
    }
  });

  test.afterAll(closeE2eDb);

  async function seedSeason(suffix = 'Season', sortOrder = 0): Promise<Season> {
    const name = `${prefix} ${suffix}`;
    const inserted = await e2eDb().run(
      'INSERT INTO seasons (name, sort_order) VALUES (?, ?) RETURNING id',
      [name, sortOrder],
    );
    return { id: Number(inserted.lastID), name, sort_order: sortOrder };
  }

  async function seedEvent(
    suffix: string,
    options: {
      status?: Status;
      released?: number;
      listing?: 'current' | 'archive';
      season?: Season;
    } = {},
  ): Promise<SeededEvent> {
    const name = `${prefix} ${suffix}`;
    const status = options.status ?? 'setup';
    const released = options.released ?? 0;
    const inserted = await e2eDb().run(
      `INSERT INTO events
         (name, status, spectator_results_released, spectator_listing,
          season_id, event_date, description, location, created_by)
       VALUES (?, ?, ?, ?, ?, '2026-05-04', ?, ?, ?) RETURNING id`,
      [
        name,
        status,
        released,
        options.listing ?? 'current',
        options.season?.id ?? null,
        `${suffix} private description`,
        `${suffix} arena`,
        archiveAdmin!.adminUserId,
      ],
    );
    return { id: Number(inserted.lastID), name, status, released };
  }

  function selectedCard(page: Page) {
    return page.locator('.card').filter({
      has: page.getByText('Currently Selected', { exact: true }),
    });
  }

  function eventRow(page: Page, event: SeededEvent) {
    return page.getByRole('row').filter({
      has: page.getByText(event.name, { exact: true }),
    });
  }

  async function openEvents(page: Page, event?: SeededEvent) {
    await page.goto(
      event
        ? `/admin/events/${event.id}?view=events`
        : '/admin/events?view=events',
    );
    await expect(
      page.getByRole('button', { name: '+ Create New Event', exact: true }),
    ).toBeVisible();
    if (event) {
      await expect(selectedCard(page).locator('strong').first()).toHaveText(
        event.name,
      );
    }
  }

  async function storedEvent(id: number) {
    const event = await e2eDb().get<Record<string, unknown>>(
      'SELECT * FROM events WHERE id = ?',
      [id],
    );
    expect(event).toBeDefined();
    return event!;
  }

  async function submitEventForm(page: Page, creating: boolean) {
    const dialog = page.getByRole('dialog');
    const saved = page.waitForResponse(
      (response) =>
        /\/events(?:\/\d+)?$/.test(new URL(response.url()).pathname) &&
        response.request().method() === (creating ? 'POST' : 'PATCH'),
    );
    await dialog
      .getByRole('button', {
        name: creating ? 'Create Event' : 'Update Event',
        exact: true,
      })
      .click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBe(true);
    const event = (await response.json()) as SeededEvent;
    await expect(dialog).not.toBeVisible();
    return event;
  }

  async function reopenEditor(page: Page, event: SeededEvent) {
    await openEvents(page, event);
    await selectedCard(page)
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Edit Event',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  async function publicState(browser: Browser, page: Page, eventId: number) {
    // Never reuse the admin context/request fixture for spectator assertions.
    // A fresh context also avoids the public endpoints' 30-second browser cache.
    const anonymous = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    });
    try {
      expect(await anonymous.cookies()).toEqual([]);
      const seasonResponse = await anonymous.request.get('/events/seasons');
      expect(seasonResponse.status()).toBe(401);
      const [current, archive, detail, awards] = await Promise.all([
        anonymous.request.get('/events/public'),
        anonymous.request.get('/events/public?listing=archive'),
        anonymous.request.get(`/events/${eventId}/public`),
        anonymous.request.get(`/awards/event/${eventId}/public`),
      ]);
      await expect(current).toBeOK();
      await expect(archive).toBeOK();
      return {
        current: (await current.json()) as PublicEvent[],
        archive: (await archive.json()) as PublicEvent[],
        detailStatus: detail.status(),
        detail: (await detail.json()) as PublicEvent,
        awardsStatus: awards.status(),
        awards: await awards.json(),
      };
    } finally {
      await anonymous.close();
    }
  }

  test('persists an optional season through create, assignment, clearing, and reload', async ({
    page,
  }) => {
    await openEvents(page);
    await page
      .getByRole('button', { name: '+ Create New Event', exact: true })
      .click();
    let dialog = page.getByRole('dialog', {
      name: 'Create New Event',
      exact: true,
    });
    await dialog
      .getByLabel('Event Name', { exact: false })
      .fill(`${prefix} Unassigned`);
    await expect(dialog.getByLabel('Season', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('Season', { exact: true })).toHaveJSProperty(
      'required',
      false,
    );
    const event = await submitEventForm(page, true);
    expect(await storedEvent(event.id)).toMatchObject({
      spectator_listing: 'current',
      season_id: null,
    });

    const season = await seedSeason();
    dialog = await reopenEditor(page, event);
    await expect(dialog.getByLabel('Season', { exact: true })).toHaveValue('');
    await dialog
      .getByLabel('Season', { exact: true })
      .selectOption(String(season.id));
    await submitEventForm(page, false);

    dialog = await reopenEditor(page, event);
    await expect(dialog.getByLabel('Season', { exact: true })).toHaveValue(
      String(season.id),
    );
    expect(await storedEvent(event.id)).toMatchObject({
      spectator_listing: 'current',
      season_id: season.id,
    });
    await dialog.getByLabel('Season', { exact: true }).selectOption('');
    await submitEventForm(page, false);

    dialog = await reopenEditor(page, event);
    await expect(dialog.getByLabel('Season', { exact: true })).toHaveValue('');
    expect(await storedEvent(event.id)).toMatchObject({
      spectator_listing: 'current',
      season_id: null,
    });
  });

  test('creates a current event with an existing season and persists it after reload', async ({
    page,
  }) => {
    const season = await seedSeason();
    await openEvents(page);
    await page
      .getByRole('button', { name: '+ Create New Event', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Create New Event',
      exact: true,
    });
    await dialog
      .getByLabel('Event Name', { exact: false })
      .fill(`${prefix} Seasoned`);
    await dialog
      .getByLabel('Season', { exact: true })
      .selectOption({ label: season.name });
    const event = await submitEventForm(page, true);
    const editor = await reopenEditor(page, event);
    await expect(editor.getByLabel('Season', { exact: true })).toHaveValue(
      String(season.id),
    );
    expect(await storedEvent(event.id)).toMatchObject({
      status: 'setup',
      spectator_listing: 'current',
      season_id: season.id,
      spectator_results_released: 0,
    });
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(selectedCard(page)).toContainText(season.name);
  });

  test('creates the first season inline, selects it, and renders script-like names as text', async ({
    page,
  }) => {
    const seasonName = `${prefix} <script>season()</script>`;
    const eventName = `${prefix} <img src=x onerror="window.archiveXss=1">`;
    await openEvents(page);
    await page
      .getByRole('button', { name: '+ Create New Event', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Create New Event',
      exact: true,
    });
    await dialog.getByLabel('Event Name', { exact: false }).fill(eventName);
    const seasonSelect = dialog.getByLabel('Season', { exact: true });
    await expect(seasonSelect.locator('option')).toHaveCount(1);
    await dialog
      .getByRole('button', { name: '+ Create Season', exact: true })
      .click();
    await dialog.getByLabel('Season name', { exact: true }).fill(seasonName);
    await dialog.getByLabel('Sort order', { exact: true }).fill('-7');
    const created = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/events/seasons' &&
        response.request().method() === 'POST',
    );
    await dialog
      .getByRole('button', { name: 'Create Season', exact: true })
      .click();
    const response = await created;
    expect(response.ok(), await response.text()).toBe(true);
    const season = (await response.json()) as Season;
    expect(season).toMatchObject({ name: seasonName, sort_order: -7 });
    await expect(seasonSelect).toHaveValue(String(season.id));
    await expect(
      seasonSelect.locator('option', { hasText: seasonName }),
    ).toHaveCount(1);
    const event = await submitEventForm(page, true);

    const editor = await reopenEditor(page, event);
    await expect(editor.getByLabel('Season', { exact: true })).toHaveValue(
      String(season.id),
    );
    await expect(editor.getByLabel('Event Name', { exact: false })).toHaveValue(
      eventName,
    );
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      selectedCard(page).getByText(eventName, { exact: true }),
    ).toBeVisible();
    await expect(selectedCard(page)).toContainText(seasonName);
    expect(await page.evaluate(() => 'archiveXss' in window)).toBe(false);
    expect(
      await e2eDb().all(
        'SELECT id, name, sort_order FROM seasons WHERE name = ?',
        [seasonName],
      ),
    ).toEqual([season]);
    expect(await storedEvent(event.id)).toMatchObject({
      season_id: season.id,
      spectator_listing: 'current',
    });
  });

  for (const field of ['Season name', 'Sort order']) {
    test(`Enter in inline ${field} creates a season without submitting the event editor`, async ({
      page,
    }) => {
      const originalSeason = await seedSeason();
      const event = await seedEvent('Keyboard creation', {
        listing: 'archive',
        season: originalSeason,
      });
      const before = await storedEvent(event.id);
      const dialog = await reopenEditor(page, event);
      const editedName = `${prefix} Unsaved event edit`;
      await dialog.getByLabel('Event Name', { exact: false }).fill(editedName);
      const seasonSelect = dialog.getByLabel('Season', { exact: true });
      await expect(seasonSelect).toHaveValue(String(originalSeason.id));
      await dialog
        .getByRole('button', { name: '+ Create Season', exact: true })
        .click();

      const writes: string[] = [];
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (
          request.method() !== 'GET' &&
          (path === '/events/seasons' || path === `/events/${event.id}`)
        ) {
          writes.push(`${request.method()} ${path}`);
        }
      });

      // Invalid input must stay within the season creator, too.
      await dialog.getByLabel('Season name', { exact: true }).fill(' ');
      await dialog.getByLabel(field, { exact: true }).press('Enter');
      await expect(dialog.getByRole('alert')).toContainText('Season name');
      expect(writes).toEqual([]);
      expect(await storedEvent(event.id)).toEqual(before);

      const seasonName = `${prefix} Keyboard season`;
      await dialog.getByLabel('Season name', { exact: true }).fill(seasonName);
      await dialog.getByLabel('Sort order', { exact: true }).fill('-7');
      const created = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/events/seasons' &&
          response.request().method() === 'POST',
      );
      await dialog.getByLabel(field, { exact: true }).press('Enter');
      const response = await created;
      expect(response.ok(), await response.text()).toBe(true);
      const season = (await response.json()) as Season;
      expect(season).toMatchObject({ name: seasonName, sort_order: -7 });
      await expect(seasonSelect).toHaveValue(String(season.id));
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByLabel('Event Name', { exact: false }),
      ).toHaveValue(editedName);
      await expect(
        dialog.getByLabel('Season name', { exact: true }),
      ).toHaveCount(0);
      expect(writes).toEqual(['POST /events/seasons']);
      expect(await storedEvent(event.id)).toEqual(before);

      await submitEventForm(page, false);
      expect(writes).toEqual([
        'POST /events/seasons',
        `PATCH /events/${event.id}`,
      ]);
      expect(await storedEvent(event.id)).toMatchObject({
        name: editedName,
        spectator_listing: 'archive',
        season_id: season.id,
      });
    });
  }

  for (const scenario of [
    { status: 'active', released: 0 },
    { status: 'complete', released: 0 },
    { status: 'complete', released: 1 },
    { status: 'archived', released: 1 },
  ] as const) {
    test(`moves and returns ${scenario.status} / release=${scenario.released} without lifecycle, release, or data changes`, async ({
      page,
      browser,
    }) => {
      const season = await seedSeason('2025–2026', 26);
      const current = await seedEvent('Current sentinel', { season });
      const archived = await seedEvent('Archive sentinel', {
        season,
        listing: 'archive',
      });
      await seedEvent('Hidden sentinel', {
        status: 'archived',
        season,
        listing: 'archive',
      });
      const event = await seedEvent('Move target', scenario);
      const db = e2eDb();
      const team = await db.run(
        `INSERT INTO teams (event_id, team_number, team_name, status)
         VALUES (?, 731, 'Archive sentinel bots', 'checked_in') RETURNING id`,
        [event.id],
      );
      const teamId = Number(team.lastID);
      await db.run(
        'INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 1, 137)',
        [teamId],
      );
      const award = await db.run(
        `INSERT INTO event_awards (event_id, name, description, sort_order)
         VALUES (?, 'Archive sentinel award', 'Keep this award', 3) RETURNING id`,
        [event.id],
      );
      const awardId = Number(award.lastID);
      await db.run(
        'INSERT INTO event_award_recipients (event_award_id, team_id) VALUES (?, ?)',
        [awardId, teamId],
      );

      // Only raw rows and non-lazy public reads are used here. The HTTP suite
      // covers the exhaustive bracket/documentation/derived-results snapshots.
      async function preservedState() {
        const row = await storedEvent(event.id);
        return {
          event: Object.fromEntries(
            Object.entries(row).filter(
              ([key]) =>
                !['updated_at', 'spectator_listing', 'season_id'].includes(key),
            ),
          ),
          teams: await db.all(
            'SELECT * FROM teams WHERE event_id = ? ORDER BY id',
            [event.id],
          ),
          scores: await db.all(
            'SELECT * FROM seeding_scores WHERE team_id = ? ORDER BY id',
            [teamId],
          ),
          awards: await db.all(
            'SELECT * FROM event_awards WHERE event_id = ? ORDER BY id',
            [event.id],
          ),
          recipients: await db.all(
            'SELECT * FROM event_award_recipients WHERE event_award_id = ? ORDER BY id',
            [awardId],
          ),
        };
      }
      const before = await preservedState();
      const hidden = scenario.status === 'archived';
      async function assertPublic(
        listing: 'current' | 'archive',
        assigned: Season | null,
      ) {
        const state = await publicState(browser, page, event.id);
        const ids = (events: PublicEvent[]) =>
          events
            .filter((row) => row.name.startsWith(prefix))
            .map((row) => row.id)
            .sort((a, b) => a - b);
        expect(ids(state.current)).toEqual(
          [
            current.id,
            ...(!hidden && listing === 'current' ? [event.id] : []),
          ].sort((a, b) => a - b),
        );
        expect(ids(state.archive)).toEqual(
          [
            archived.id,
            ...(!hidden && listing === 'archive' ? [event.id] : []),
          ].sort((a, b) => a - b),
        );
        expect(state.detailStatus).toBe(hidden ? 404 : 200);
        if (!hidden) {
          expect(state.detail).toMatchObject({
            id: event.id,
            name: event.name,
            status: scenario.status,
            spectator_listing: listing,
            season_id: assigned?.id ?? null,
            season_name: assigned?.name ?? null,
            final_scores_available:
              scenario.status === 'complete' && !!scenario.released,
          });
          expect(state.detail).not.toHaveProperty('spectator_results_released');
        }
        const resultsAvailable =
          scenario.status === 'complete' && !!scenario.released;
        expect(state.awardsStatus).toBe(resultsAvailable ? 200 : 404);
        if (resultsAvailable) {
          expect(state.awards.manual).toEqual([
            {
              name: 'Archive sentinel award',
              description: 'Keep this award',
              sort_order: 3,
              recipients: [
                {
                  team_number: 731,
                  team_name: 'Archive sentinel bots',
                  display_name: null,
                },
              ],
              individual_recipients: [],
            },
          ]);
        }
      }

      await openEvents(page, event);
      await assertPublic('current', null);
      await selectedCard(page)
        .getByRole('button', { name: 'Move to Spectator Archive', exact: true })
        .click();
      const move = page.getByRole('dialog', {
        name: 'Move to Spectator Archive',
        exact: true,
      });
      await expect(
        move.getByRole('heading', {
          name: 'Move to Spectator Archive',
          exact: true,
        }),
      ).toBeVisible();
      await expect(move).toContainText(event.name);
      await expect(move).toContainText(/publicly viewable/i);
      await expect(move).toContainText(/status/i);
      await expect(move).toContainText(/releas/i);
      await expect(move).toContainText(/data/i);
      if (hidden) await expect(move).toContainText(/remain.*hidden/i);
      const seasonSelect = move.getByLabel('Season', { exact: true });
      await expect(seasonSelect).toHaveJSProperty('required', true);
      await seasonSelect.selectOption(String(season.id));
      const moving = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/events/${event.id}` &&
          response.request().method() === 'PATCH',
      );
      await move
        .getByRole('button', { name: 'Move to Spectator Archive', exact: true })
        .click();
      const moved = await moving;
      expect(moved.ok(), await moved.text()).toBe(true);
      const moveBody = moved.request().postDataJSON();
      expect(moveBody.spectator_listing).toBe('archive');
      expect(Number(moveBody.season_id)).toBe(season.id);
      expect(moveBody).not.toHaveProperty('status');
      expect(moveBody).not.toHaveProperty('spectator_results_released');
      await expect(move).not.toBeVisible();
      expect(await storedEvent(event.id)).toMatchObject({
        spectator_listing: 'archive',
        season_id: season.id,
      });
      expect(await preservedState()).toEqual(before);
      await expect(selectedCard(page)).toContainText(season.name);
      await expect(
        selectedCard(page).getByRole('button', {
          name: 'Return to Current Events',
          exact: true,
        }),
      ).toBeVisible();
      await assertPublic('archive', season);

      // Refresh with a different selected event: the moved event remains
      // discoverable and manageable in the table, not just a selected card.
      await openEvents(page, current);
      await page
        .getByLabel('Spectator placement', { exact: true })
        .selectOption('archive');
      const row = eventRow(page, event);
      await expect(row).toContainText(season.name);
      await row
        .getByRole('button', { name: 'Return to Current Events', exact: true })
        .click();
      const returning = page.getByRole('dialog', {
        name: 'Return to Current Events',
        exact: true,
      });
      await expect(
        returning.getByRole('heading', {
          name: 'Return to Current Events',
          exact: true,
        }),
      ).toBeVisible();
      await expect(returning).toContainText(event.name);
      if (hidden) await expect(returning).toContainText(/remain.*hidden/i);
      const returnedResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/events/${event.id}` &&
          response.request().method() === 'PATCH',
      );
      await returning
        .getByRole('button', { name: 'Return to Current Events', exact: true })
        .click();
      const returned = await returnedResponse;
      expect(returned.ok(), await returned.text()).toBe(true);
      const returnBody = returned.request().postDataJSON();
      expect(returnBody.spectator_listing).toBe('current');
      expect(returnBody).not.toHaveProperty('status');
      expect(returnBody).not.toHaveProperty('spectator_results_released');
      await expect(returning).not.toBeVisible();
      expect(await storedEvent(event.id)).toMatchObject({
        spectator_listing: 'current',
        season_id: season.id,
      });
      expect(await preservedState()).toEqual(before);
      await assertPublic('current', season);
      await openEvents(page, current);
      await page
        .getByLabel('Spectator placement', { exact: true })
        .selectOption('current');
      await expect(
        eventRow(page, event).getByRole('button', {
          name: 'Move to Spectator Archive',
          exact: true,
        }),
      ).toBeVisible();
      await expect(eventRow(page, event)).toContainText(season.name);
      if (hidden)
        await expect(eventRow(page, event)).toContainText(
          'Hidden from Spectators',
        );
    });
  }

  test('combines independent lifecycle and placement filters and keeps archived events editable', async ({
    page,
  }) => {
    const season = await seedSeason();
    const anchor = await seedEvent('Selected anchor');
    const fixtures: { event: SeededEvent; listing: 'current' | 'archive' }[] =
      [];
    for (const status of ['setup', 'active', 'complete', 'archived'] as const) {
      for (const listing of ['current', 'archive'] as const) {
        fixtures.push({
          event: await seedEvent(`${status} ${listing}`, {
            status,
            listing,
            season,
          }),
          listing,
        });
      }
    }
    await openEvents(page, anchor);
    const lifecycle = page.getByLabel('Lifecycle status', { exact: true });
    const placement = page.getByLabel('Spectator placement', { exact: true });
    await expect(lifecycle).toHaveAttribute('id', 'status-filter');
    await expect(placement).toHaveAttribute('id', 'placement-filter');
    await expect(lifecycle).toHaveValue('all');
    await expect(placement).toHaveValue('all');
    expect(
      await lifecycle
        .locator('option')
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        ),
    ).toEqual(['all', 'setup', 'active', 'complete', 'archived']);
    await expect(lifecycle.locator('option[value="archived"]')).toHaveText(
      'Hidden from Spectators',
    );

    for (const status of ['all', 'setup', 'active', 'complete', 'archived']) {
      await lifecycle.selectOption(status);
      for (const listing of ['all', 'current', 'archive']) {
        await placement.selectOption(listing);
        await expect(lifecycle).toHaveValue(status);
        for (const fixture of fixtures) {
          const visible =
            (status === 'all' || fixture.event.status === status) &&
            (listing === 'all' || fixture.listing === listing);
          await expect(eventRow(page, fixture.event)).toHaveCount(
            visible ? 1 : 0,
          );
        }
      }
    }

    await lifecycle.selectOption('complete');
    await placement.selectOption('archive');
    const archived = fixtures.find(
      (fixture) =>
        fixture.event.status === 'complete' && fixture.listing === 'archive',
    )!.event;
    const before = await storedEvent(archived.id);
    await eventRow(page, archived)
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    const editor = page.getByRole('dialog', {
      name: 'Edit Event',
      exact: true,
    });
    await expect(editor.getByLabel('Season', { exact: true })).toHaveValue(
      String(season.id),
    );
    await expect(editor.getByLabel('Season', { exact: true })).toHaveJSProperty(
      'required',
      true,
    );
    await editor
      .getByLabel('Description', { exact: true })
      .fill('Still editable in the spectator archive');
    await submitEventForm(page, false);
    await openEvents(page, anchor);
    await expect(
      page.getByLabel('Spectator placement', { exact: true }),
    ).toHaveValue('all');
    await expect(eventRow(page, archived)).toContainText(
      'Still editable in the spectator archive',
    );
    expect(await storedEvent(archived.id)).toMatchObject({
      description: 'Still editable in the spectator archive',
      status: before.status,
      spectator_results_released: before.spectator_results_released,
      spectator_listing: 'archive',
      season_id: season.id,
    });
  });

  for (const listing of ['current', 'archive'] as const) {
    test(`hides an event in ${listing} via legacy status without a separate release or placement request`, async ({
      page,
      browser,
    }) => {
      const season = await seedSeason();
      const event = await seedEvent('Hide target', {
        status: 'complete',
        released: 1,
        listing,
        season,
      });
      const mutations: { method: string; body: unknown }[] = [];
      page.on('request', (request) => {
        if (
          request.method() !== 'GET' &&
          new URL(request.url()).pathname === `/events/${event.id}`
        ) {
          mutations.push({
            method: request.method(),
            body: request.postDataJSON(),
          });
        }
      });
      await openEvents(page, event);
      expect((await publicState(browser, page, event.id)).detailStatus).toBe(
        200,
      );
      await selectedCard(page)
        .getByRole('button', { name: 'Hide from Spectators', exact: true })
        .click();
      const dialog = page.getByRole('dialog', {
        name: 'Hide from Spectators',
        exact: true,
      });
      await expect(
        dialog.getByRole('heading', {
          name: 'Hide from Spectators',
          exact: true,
        }),
      ).toBeVisible();
      await expect(dialog).toContainText(event.name);
      const hiddenResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/events/${event.id}` &&
          response.request().method() === 'PATCH',
      );
      await dialog
        .getByRole('button', { name: 'Hide from Spectators', exact: true })
        .click();
      const response = await hiddenResponse;
      expect(response.ok(), await response.text()).toBe(true);
      await expect(dialog).not.toBeVisible();
      expect(mutations).toEqual([
        { method: 'PATCH', body: { status: 'archived' } },
      ]);
      // The legacy status write auto-clears release when leaving complete;
      // the UI must not send a separate release or placement mutation.
      expect(await storedEvent(event.id)).toMatchObject({
        status: 'archived',
        spectator_results_released: 0,
        spectator_listing: listing,
        season_id: season.id,
      });
      await openEvents(page, event);
      await expect(selectedCard(page)).toContainText('Hidden from Spectators');
      const state = await publicState(browser, page, event.id);
      expect(state.current.map((row) => row.id)).not.toContain(event.id);
      expect(state.archive.map((row) => row.id)).not.toContain(event.id);
      expect(state.detailStatus).toBe(404);
      expect(state.awardsStatus).toBe(404);
    });
  }

  for (const target of ['selected card', 'filtered row'] as const) {
    test(`preserves lifecycle and placement filters after moving a ${target} and restores focus`, async ({
      page,
    }) => {
      const season = await seedSeason();
      const event = await seedEvent('Filter and focus target', {
        status: 'complete',
        released: 1,
        season,
      });
      const anchor = await seedEvent('Selected anchor');
      const remaining = await seedEvent('Remaining current event', {
        status: 'complete',
        season,
      });
      await openEvents(page, target === 'selected card' ? event : anchor);
      const lifecycle = page.getByLabel('Lifecycle status', { exact: true });
      const placement = page.getByLabel('Spectator placement', { exact: true });
      await lifecycle.selectOption('complete');
      await placement.selectOption('current');
      const scope =
        target === 'selected card' ? selectedCard(page) : eventRow(page, event);
      const trigger = scope.getByRole('button', {
        name: 'Move to Spectator Archive',
        exact: true,
      });
      const originalTrigger = await trigger.elementHandle();
      expect(originalTrigger).not.toBeNull();

      let refreshReady!: (response: APIResponse) => void;
      let refreshFailed!: (error: unknown) => void;
      const backgroundRefresh = new Promise<APIResponse>((resolve, reject) => {
        refreshReady = resolve;
        refreshFailed = reject;
      });
      let releaseRefresh!: () => void;
      const refreshHeld = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      // Hold the real post-save read so a foreground loading state cannot
      // briefly unmount Admin and reset its filters/focus unnoticed.
      await page.route('**/events', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        try {
          const response = await route.fetch();
          refreshReady(response);
          await refreshHeld;
          await route.fulfill({ response });
        } catch (error) {
          refreshFailed(error);
          throw error;
        }
      });
      try {
        await trigger.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', {
          name: 'Move to Spectator Archive',
          exact: true,
        });
        await expect(dialog.getByLabel('Season', { exact: true })).toHaveValue(
          String(season.id),
        );
        const movedResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/events/${event.id}` &&
            response.request().method() === 'PATCH',
        );
        const refreshedResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/events' &&
            response.request().method() === 'GET',
        );
        await dialog
          .getByRole('button', {
            name: 'Move to Spectator Archive',
            exact: true,
          })
          .click();
        const moved = await movedResponse;
        expect(moved.ok(), await moved.text()).toBe(true);
        await expect(await backgroundRefresh).toBeOK();
        await expect(dialog).not.toBeVisible();

        async function assertFiltersAndFocus() {
          await expect(lifecycle).toHaveValue('complete');
          await expect(placement).toHaveValue('current');
          await expect(eventRow(page, remaining)).toBeVisible();
          if (target === 'selected card') {
            await expect(
              selectedCard(page).getByRole('button', {
                name: 'Return to Current Events',
                exact: true,
              }),
            ).toBeVisible();
            await expect
              .poll(() =>
                originalTrigger!.evaluate(
                  (element) =>
                    element.isConnected && element === document.activeElement,
                ),
              )
              .toBe(true);
          } else {
            await expect(eventRow(page, event)).toHaveCount(0);
            expect(
              await originalTrigger!.evaluate((element) => element.isConnected),
            ).toBe(false);
            await expect(placement).toBeFocused();
          }
        }

        await assertFiltersAndFocus();
        releaseRefresh();
        const refreshed = await refreshedResponse;
        expect(await refreshed.finished()).toBeNull();
        await assertFiltersAndFocus();
        expect(await storedEvent(event.id)).toMatchObject({
          status: 'complete',
          spectator_results_released: 1,
          spectator_listing: 'archive',
          season_id: season.id,
        });
      } finally {
        releaseRefresh();
        await page.unrouteAll({ behavior: 'wait' });
      }
    });
  }

  test('reconciles a committed placement response after browser history leaves the dialog without reloading the provider', async ({
    page,
    browser,
  }) => {
    const season = await seedSeason();
    const event = await seedEvent('Delayed placement target', {
      status: 'active',
    });
    await openEvents(page, event);
    const documentRequests: string[] = [];
    page.on('request', (request) => {
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      ) {
        documentRequests.push(request.url());
      }
    });
    // Build same-document history before opening the native modal. Its inert
    // background cannot be clicked while pending, but browser Back still works.
    await page
      .locator('.admin-sidebar')
      .getByRole('button', { name: /Teams$/ })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/events/${event.id}\\?view=teams$`),
    );
    await expect(
      page
        .locator('.admin-content-header')
        .getByRole('heading', { name: 'Teams', exact: true }),
    ).toBeVisible();
    await page
      .locator('.admin-sidebar')
      .getByRole('button', { name: /Manage Events$/ })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/events/${event.id}\\?view=events$`),
    );
    await expect(
      selectedCard(page).getByText(event.name, { exact: true }),
    ).toBeVisible();

    let committed!: (response: APIResponse) => void;
    let commitFailed!: (error: unknown) => void;
    const serverSaved = new Promise<APIResponse>((resolve, reject) => {
      committed = resolve;
      commitFailed = reject;
    });
    let releasePatch!: () => void;
    const patchHeld = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    await page.route(`**/events/${event.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      try {
        const response = await route.fetch();
        committed(response);
        await patchHeld;
        await route.fulfill({ response });
      } catch (error) {
        commitFailed(error);
        throw error;
      }
    });
    try {
      await selectedCard(page)
        .getByRole('button', {
          name: 'Move to Spectator Archive',
          exact: true,
        })
        .click();
      const dialog = page.getByRole('dialog', {
        name: 'Move to Spectator Archive',
        exact: true,
      });
      await dialog
        .getByLabel('Season', { exact: true })
        .selectOption(String(season.id));
      await dialog
        .getByRole('button', {
          name: 'Move to Spectator Archive',
          exact: true,
        })
        .click();
      const saved = await serverSaved;
      await expect(saved).toBeOK();
      expect(await saved.json()).toMatchObject({
        id: event.id,
        status: 'active',
        spectator_listing: 'archive',
        season_id: season.id,
      });
      expect(await storedEvent(event.id)).toMatchObject({
        spectator_listing: 'archive',
        season_id: season.id,
      });
      await expect(
        dialog.getByRole('button', {
          name: 'Move to Spectator Archive',
          exact: true,
        }),
      ).toBeDisabled();

      await page.goBack();
      await expect(page).toHaveURL(
        new RegExp(`/admin/events/${event.id}\\?view=teams$`),
      );
      await expect(dialog).not.toBeVisible();
      await expect(
        page
          .locator('.admin-content-header')
          .getByRole('heading', { name: 'Teams', exact: true }),
      ).toBeVisible();
      const deliveredResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/events/${event.id}` &&
          response.request().method() === 'PATCH',
      );
      releasePatch();
      const delivered = await deliveredResponse;
      expect(delivered.ok(), await delivered.text()).toBe(true);
      expect(await delivered.finished()).toBeNull();
      await expect(page).toHaveURL(
        new RegExp(`/admin/events/${event.id}\\?view=teams$`),
      );
      await expect(dialog).not.toBeVisible();

      await page.goForward();
      await expect(page).toHaveURL(
        new RegExp(`/admin/events/${event.id}\\?view=events$`),
      );
      await expect(
        selectedCard(page).getByRole('button', {
          name: 'Return to Current Events',
          exact: true,
        }),
      ).toBeVisible();
      await expect(selectedCard(page)).toContainText(season.name);
      await expect(
        selectedCard(page).getByRole('button', {
          name: 'Move to Spectator Archive',
          exact: true,
        }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem('colosseum_selected_event_id'),
        ),
      ).toBe(String(event.id));
      expect(documentRequests).toEqual([]);
      await selectedCard(page)
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
      const editor = page.getByRole('dialog', {
        name: 'Edit Event',
        exact: true,
      });
      await expect(editor.getByLabel('Season', { exact: true })).toHaveValue(
        String(season.id),
      );
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      const state = await publicState(browser, page, event.id);
      expect(state.current.map((row) => row.id)).not.toContain(event.id);
      expect(state.archive.map((row) => row.id)).toContain(event.id);
      expect(state.detail).toMatchObject({
        id: event.id,
        spectator_listing: 'archive',
        season_id: season.id,
      });
    } finally {
      releasePatch();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });

  test('preserves a confirmed rename when an older placement response arrives after history navigation', async ({
    page,
  }) => {
    const season = await seedSeason();
    const event = await seedEvent('Stale placement rename target', {
      status: 'active',
    });
    const latestName = `${prefix} Latest saved name`;
    await openEvents(page, event);
    const documentRequests: string[] = [];
    page.on('request', (request) => {
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      ) {
        documentRequests.push(request.url());
      }
    });
    await page
      .locator('.admin-sidebar')
      .getByRole('button', { name: /Teams$/ })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/events/${event.id}\\?view=teams$`),
    );
    await page
      .locator('.admin-sidebar')
      .getByRole('button', { name: /Manage Events$/ })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/events/${event.id}\\?view=events$`),
    );

    let committed!: (response: APIResponse) => void;
    let commitFailed!: (error: unknown) => void;
    const serverSaved = new Promise<APIResponse>((resolve, reject) => {
      committed = resolve;
      commitFailed = reject;
    });
    let releasePatch!: () => void;
    const patchHeld = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    let refreshReady!: (response: APIResponse) => void;
    let refreshFailed!: (error: unknown) => void;
    const backgroundRefresh = new Promise<APIResponse>((resolve, reject) => {
      refreshReady = resolve;
      refreshFailed = reject;
    });
    let releaseRefresh!: () => void;
    const refreshHeld = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    await page.route(`**/events/${event.id}`, async (route) => {
      if (
        route.request().method() !== 'PATCH' ||
        route.request().postDataJSON().spectator_listing !== 'archive'
      ) {
        return route.fallback();
      }
      // Commit the placement, but only delay its response, never edit PATCHes.
      try {
        const response = await route.fetch();
        committed(response);
        await patchHeld;
        await route.fulfill({ response });
      } catch (error) {
        commitFailed(error);
        throw error;
      }
    });
    try {
      await selectedCard(page)
        .getByRole('button', {
          name: 'Move to Spectator Archive',
          exact: true,
        })
        .click();
      const placementDialog = page.getByRole('dialog', {
        name: 'Move to Spectator Archive',
        exact: true,
      });
      await placementDialog
        .getByLabel('Season', { exact: true })
        .selectOption(String(season.id));
      await placementDialog
        .getByRole('button', {
          name: 'Move to Spectator Archive',
          exact: true,
        })
        .click();
      const committedPlacement = await serverSaved;
      await expect(committedPlacement).toBeOK();
      expect(await committedPlacement.json()).toMatchObject({
        id: event.id,
        name: event.name,
        spectator_listing: 'archive',
        season_id: season.id,
      });
      expect(await storedEvent(event.id)).toMatchObject({
        name: event.name,
        spectator_listing: 'archive',
        season_id: season.id,
      });

      // Back unmounts the pending dialog; Forward returns to the same provider.
      await page.goBack();
      await expect(page).toHaveURL(
        new RegExp(`/admin/events/${event.id}\\?view=teams$`),
      );
      await expect(placementDialog).not.toBeVisible();
      await expect(
        page
          .locator('.admin-content-header')
          .getByRole('heading', { name: 'Teams', exact: true }),
      ).toBeVisible();
      await page.goForward();
      await expect(page).toHaveURL(
        new RegExp(`/admin/events/${event.id}\\?view=events$`),
      );
      await selectedCard(page)
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
      const editor = page.getByRole('dialog', {
        name: 'Edit Event',
        exact: true,
      });
      const nameInput = editor.getByLabel('Event Name', { exact: false });
      await nameInput.fill(latestName);
      const renameRefresh = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/events' &&
          response.request().method() === 'GET',
      );
      expect(await submitEventForm(page, false)).toMatchObject({
        id: event.id,
        name: latestName,
      });
      const renamed = await renameRefresh;
      expect(renamed.ok(), await renamed.text()).toBe(true);
      expect(await renamed.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: event.id, name: latestName }),
        ]),
      );
      expect(await renamed.finished()).toBeNull();
      // Cross render boundaries so the accepted refresh and selected-event
      // synchronization effect settle before delivering the older snapshot.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(
        selectedCard(page).getByText(latestName, { exact: true }),
      ).toBeVisible();

      // The old mutation must still refresh after its dialog unmounts, but that
      // read must not hide a stale cache replacement before Edit is opened.
      await page.route('**/events', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        try {
          const response = await route.fetch();
          refreshReady(response);
          await refreshHeld;
          await route.fulfill({ response });
        } catch (error) {
          refreshFailed(error);
          throw error;
        }
      });
      const deliveredPlacement = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/events/${event.id}` &&
          response.request().method() === 'PATCH' &&
          response.request().postDataJSON().spectator_listing === 'archive',
      );
      releasePatch();
      const delivered = await deliveredPlacement;
      expect(delivered.ok(), await delivered.text()).toBe(true);
      expect(await delivered.finished()).toBeNull();
      await expect(await backgroundRefresh).toBeOK();
      await selectedCard(page)
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
      await expect(nameInput).toHaveValue(latestName);

      const refreshedResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/events' &&
          response.request().method() === 'GET',
      );
      releaseRefresh();
      const refreshed = await refreshedResponse;
      expect(refreshed.ok(), await refreshed.text()).toBe(true);
      expect(await refreshed.finished()).toBeNull();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(nameInput).toHaveValue(latestName);
      await expect(
        selectedCard(page).getByText(latestName, { exact: true }),
      ).toBeVisible();
      const savedResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/events/${event.id}` &&
          response.request().method() === 'PATCH',
      );
      await submitEventForm(page, false);
      expect((await savedResponse).request().postDataJSON()).toMatchObject({
        name: latestName,
      });
      expect(await storedEvent(event.id)).toMatchObject({ name: latestName });
      expect(documentRequests).toEqual([]);
    } finally {
      releasePatch();
      releaseRefresh();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });

  test('selects a created event only after refresh confirms it when an intervening read omits it', async ({
    page,
  }) => {
    const season = await seedSeason();
    const anchor = await seedEvent('Create selection anchor', {
      status: 'active',
      listing: 'archive',
      season,
    });
    const createdName = `${prefix} Deferred create selection`;
    const refreshedLocation = `${prefix} Accepted intervening list`;
    await openEvents(page, anchor);
    const visitedUrls: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visitedUrls.push(frame.url());
    });

    function heldResponse() {
      let ready!: (response: APIResponse) => void;
      let failed!: (error: unknown) => void;
      const fetched = new Promise<APIResponse>((resolve, reject) => {
        ready = resolve;
        failed = reject;
      });
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { fetched, ready, failed, held, release };
    }

    const beforeCreate = heldResponse();
    const createResponse = heldResponse();
    const afterCreate = heldResponse();
    let refreshCount = 0;
    await page.route('**/events', async (route) => {
      const method = route.request().method();
      if (method !== 'GET' && method !== 'POST') return route.fallback();
      const gate =
        method === 'POST'
          ? createResponse
          : refreshCount++ === 0
            ? beforeCreate
            : afterCreate;
      try {
        if (gate === beforeCreate) {
          // Only this read can expose the marker; the placement PATCH snapshot
          // was already returned before this fixture-only database change.
          await e2eDb().run('UPDATE events SET location = ? WHERE id = ?', [
            refreshedLocation,
            anchor.id,
          ]);
        }
        const response = await route.fetch();
        gate.ready(response);
        await gate.held;
        await route.fulfill({ response });
      } catch (error) {
        gate.failed(error);
        throw error;
      }
    });
    try {
      // Fetch a real pre-create list through the placement's background refresh,
      // but do not deliver it until the create mutation has already started.
      await selectedCard(page)
        .getByRole('button', {
          name: 'Return to Current Events',
          exact: true,
        })
        .click();
      const placementDialog = page.getByRole('dialog', {
        name: 'Return to Current Events',
        exact: true,
      });
      await placementDialog
        .getByRole('button', {
          name: 'Return to Current Events',
          exact: true,
        })
        .click();
      const before = await beforeCreate.fetched;
      await expect(before).toBeOK();
      const beforeEvents = (await before.json()) as SeededEvent[];
      await expect(placementDialog).not.toBeVisible();

      await page
        .getByRole('button', { name: '+ Create New Event', exact: true })
        .click();
      const createDialog = page.getByRole('dialog', {
        name: 'Create New Event',
        exact: true,
      });
      await createDialog
        .getByLabel('Event Name', { exact: false })
        .fill(createdName);
      await createDialog
        .getByRole('button', { name: 'Create Event', exact: true })
        .click();
      const committed = await createResponse.fetched;
      await expect(committed).toBeOK();
      const created = (await committed.json()) as SeededEvent;
      expect(created).toMatchObject({ name: createdName });
      expect(await storedEvent(created.id)).toMatchObject({
        name: createdName,
      });
      expect(beforeEvents.map((event) => event.id)).not.toContain(created.id);

      const interveningRefresh = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/events' &&
          response.request().method() === 'GET',
      );
      beforeCreate.release();
      const intervening = await interveningRefresh;
      expect(intervening.ok(), await intervening.text()).toBe(true);
      expect(await intervening.finished()).toBeNull();
      // Visible server-only data proves the provider accepted this absent-event
      // list, so the mutation-start generation guard must skip the POST snapshot.
      await expect(selectedCard(page)).toContainText(refreshedLocation);
      await expect(createDialog).toBeVisible();
      await expect(eventRow(page, created)).toHaveCount(0);

      const deliveredCreate = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/events' &&
          response.request().method() === 'POST',
      );
      createResponse.release();
      const delivered = await deliveredCreate;
      expect(delivered.ok(), await delivered.text()).toBe(true);
      expect(await delivered.finished()).toBeNull();
      await expect(createDialog).not.toBeVisible();
      const after = await afterCreate.fetched;
      await expect(after).toBeOK();
      expect(await after.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: created.id, name: createdName }),
        ]),
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const createdUrl = new URL(
        `/admin/events/${created.id}?view=events`,
        page.url(),
      ).href;
      // The real provider and Admin router must not select or navigate to an ID
      // absent from confirmed events, even transiently before falling back.
      expect(visitedUrls).not.toContain(createdUrl);
      await expect(page).toHaveURL(
        new RegExp(`/admin/events/${anchor.id}\\?view=events$`),
      );
      await expect(selectedCard(page).locator('strong').first()).toHaveText(
        anchor.name,
      );
      await expect(eventRow(page, created)).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem('colosseum_selected_event_id'),
        ),
      ).toBe(String(anchor.id));

      const confirmingRefresh = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/events' &&
          response.request().method() === 'GET',
      );
      afterCreate.release();
      const confirmed = await confirmingRefresh;
      expect(confirmed.ok(), await confirmed.text()).toBe(true);
      expect(await confirmed.finished()).toBeNull();
      await expect(page).toHaveURL(createdUrl);
      await expect(selectedCard(page).locator('strong').first()).toHaveText(
        createdName,
      );
      // Check again after provider/router effects, rather than observing only
      // a transient selection that the missing-event fallback later replaces.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(page).toHaveURL(createdUrl);
      await expect(selectedCard(page).locator('strong').first()).toHaveText(
        createdName,
      );
      expect(
        await page.evaluate(() =>
          localStorage.getItem('colosseum_selected_event_id'),
        ),
      ).toBe(String(created.id));
    } finally {
      beforeCreate.release();
      createResponse.release();
      afterCreate.release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });

  test('requires a season, supports keyboard selection and cancellation, and restores focus without stale dialog state', async ({
    page,
  }) => {
    await seedSeason('First', 20);
    await seedSeason('Second', 10);
    const event = await seedEvent('Keyboard target');
    const other = await seedEvent('Other keyboard target');
    const before = await storedEvent(event.id);
    const otherBefore = await storedEvent(other.id);
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        /\/events\/\d+$/.test(new URL(request.url()).pathname)
      ) {
        mutations.push(request.url());
      }
    });
    await openEvents(page, event);
    const trigger = selectedCard(page).getByRole('button', {
      name: 'Move to Spectator Archive',
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press('Enter');
    let dialog = page.getByRole('dialog', {
      name: 'Move to Spectator Archive',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.tagName)).toBe('DIALOG');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('dialog[open]'),
      ),
    ).toBe(true);
    let select = dialog.getByLabel('Season', { exact: true });
    await expect(select).toHaveValue('');
    await expect(select).toHaveJSProperty('required', true);
    expect(
      await select.evaluate(
        (element) => (element as HTMLSelectElement).validity.valid,
      ),
    ).toBe(false);
    const confirm = dialog.getByRole('button', {
      name: 'Move to Spectator Archive',
      exact: true,
    });
    if (await confirm.isEnabled()) await confirm.click();
    await expect(dialog).toBeVisible();
    expect(await storedEvent(event.id)).toEqual(before);
    expect(mutations).toEqual([]);

    await select.focus();
    await page.keyboard.press('End');
    await expect(select).toHaveValue(
      (await select.locator('option').last().getAttribute('value'))!,
    );
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('dialog[open]'),
      ),
    ).toBe(true);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    dialog = page.getByRole('dialog', {
      name: 'Move to Spectator Archive',
      exact: true,
    });
    select = dialog.getByLabel('Season', { exact: true });
    await expect(select).toHaveValue('');
    await select.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();

    const otherTrigger = eventRow(page, other).getByRole('button', {
      name: 'Move to Spectator Archive',
      exact: true,
    });
    await otherTrigger.focus();
    await page.keyboard.press('Enter');
    dialog = page.getByRole('dialog', {
      name: 'Move to Spectator Archive',
      exact: true,
    });
    await expect(dialog).toContainText(other.name);
    await expect(dialog.getByLabel('Season', { exact: true })).toHaveValue('');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(otherTrigger).toBeFocused();
    expect(await storedEvent(event.id)).toEqual(before);
    expect(await storedEvent(other.id)).toEqual(otherBefore);
    expect(mutations).toEqual([]);
  });
});
