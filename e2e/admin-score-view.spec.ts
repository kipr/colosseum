import { test, expect } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';
import {
  deleteSession,
  seedAdminSession,
  setSessionCookie,
} from './helpers/session';

const ADMIN_EMAIL = 'e2e-admin-score-view@kipr.org';
const ADMIN_NAME = 'E2E Admin Score View';
const EVENT_NAME = `E2E Admin Score View ${Date.now()}`;
const TEMPLATE_TITLE = 'E2E Complete Event Seeding Sheet';
const TEAM_NAME = 'E2E Score View Bots';
const TEAM_NUMBER = 640;

let admin: Awaited<ReturnType<typeof seedAdminSession>>;
let eventId: number;
let templateId: number;

test.describe('Admin score view template lookup', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const db = e2eDb();

    admin = await seedAdminSession({
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      googleId: `e2e-admin-score-view-${Date.now()}`,
    });

    const ev = await db.run(
      `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
       VALUES (?, 'complete', 3, 'manual') RETURNING id`,
      [EVENT_NAME],
    );
    eventId = Number(ev.lastID);

    await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, status)
       VALUES (?, ?, ?, 'checked_in') RETURNING id`,
      [eventId, TEAM_NUMBER, TEAM_NAME],
    );

    const schema = {
      title: TEMPLATE_TITLE,
      eventId,
      layout: 'two-column',
      fields: [
        {
          id: 'team_number',
          label: 'Team Number',
          type: 'number',
        },
        {
          id: 'team_name',
          label: 'Team Name',
          type: 'text',
        },
        {
          id: 'round',
          label: 'Round',
          type: 'number',
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

    const tpl = await db.run(
      `INSERT INTO scoresheet_templates (name, description, schema, access_code, is_active)
       VALUES (?, 'Still exists after the event is complete', ?, 'e2e-score-view', TRUE)
       RETURNING id`,
      [TEMPLATE_TITLE, JSON.stringify(schema)],
    );
    templateId = Number(tpl.lastID);

    await db.run(
      `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type)
       VALUES (?, ?, 'seeding') RETURNING id`,
      [eventId, templateId],
    );

    await db.run(
      `INSERT INTO score_submissions
        (user_id, template_id, participant_name, score_data, status, event_id, score_type)
       VALUES (?, ?, ?, ?, 'pending', ?, 'seeding') RETURNING id`,
      [
        admin.adminUserId,
        templateId,
        TEAM_NAME,
        JSON.stringify({
          team_number: {
            label: 'Team Number',
            value: TEAM_NUMBER,
            type: 'number',
          },
          team_name: { label: 'Team Name', value: TEAM_NAME, type: 'text' },
          round: { label: 'Round', value: 1, type: 'number' },
          autonomous: { label: 'Autonomous', value: 40, type: 'number' },
          driver: { label: 'Driver', value: 55, type: 'number' },
          grand_total: { label: 'Total Score', value: 95, type: 'calculated' },
        }),
        eventId,
      ],
    );
  });

  test.afterAll(async () => {
    const db = e2eDb();

    await db.run('DELETE FROM score_submissions WHERE template_id = ?', [
      templateId,
    ]);
    await db.run(
      'DELETE FROM event_scoresheet_templates WHERE template_id = ?',
      [templateId],
    );
    await db.run('DELETE FROM scoresheet_templates WHERE id = ?', [templateId]);
    await db.run('DELETE FROM teams WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM events WHERE id = ?', [eventId]);
    await deleteSession(admin.sid);
    await db.run('DELETE FROM users WHERE id = ?', [admin.adminUserId]);
    await closeE2eDb();
  });

  test('opens a score from a complete event using the existing template', async ({
    page,
  }) => {
    await setSessionCookie(page, admin.signedCookie);
    await page.goto(`/admin/events/${eventId}?view=scoring`);

    await expect(
      page.getByRole('heading', { name: 'Seeding Scores' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(TEAM_NAME)).toBeVisible();

    await page.getByRole('button', { name: 'View Details' }).click();

    const modal = page.locator('.modal.show');
    await expect(
      modal.getByRole('heading', { name: 'Edit Score' }),
    ).toBeVisible();
    await expect(modal.locator('.scoresheet-title')).toHaveText(TEMPLATE_TITLE);
    await expect(
      modal.getByText('Score Details (Template Not Found)'),
    ).toHaveCount(0);
    await expect(
      modal.locator('.score-field', { hasText: 'Autonomous' }).locator('input'),
    ).toHaveValue('40');
  });
});
