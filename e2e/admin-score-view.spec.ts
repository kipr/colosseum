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

const STICKY_ADMIN_EMAIL = 'e2e-admin-score-sticky@kipr.org';
const STICKY_ADMIN_NAME = 'E2E Admin Score Sticky';
const STICKY_EVENT_NAME = `E2E Admin Score Sticky ${Date.now()}`;
const STICKY_TEMPLATE_TITLE = 'E2E Team A B Sticky Sheet';

let stickyAdmin: Awaited<ReturnType<typeof seedAdminSession>>;
let stickyEventId: number;
let stickyTemplateId: number;

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

test.describe('Admin score view Team A/B sticky headers', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const db = e2eDb();

    stickyAdmin = await seedAdminSession({
      email: STICKY_ADMIN_EMAIL,
      name: STICKY_ADMIN_NAME,
      googleId: `e2e-admin-score-sticky-${Date.now()}`,
    });

    const ev = await db.run(
      `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
       VALUES (?, 'active', 3, 'manual') RETURNING id`,
      [STICKY_EVENT_NAME],
    );
    stickyEventId = Number(ev.lastID);

    const schema = {
      title: STICKY_TEMPLATE_TITLE,
      eventId: stickyEventId,
      mode: 'head-to-head',
      layout: 'two-column',
      fields: [
        {
          id: 'section_header_team_a',
          label: 'TEAM A',
          type: 'section_header',
          column: 'left',
        },
        {
          id: 'group_header_start_box_a',
          label: 'Lower Start Box',
          type: 'group_header',
          column: 'left',
        },
        {
          id: 'drums_a',
          label: 'Drums × 25',
          type: 'number',
          min: 0,
          max: 4,
          column: 'left',
        },
        {
          id: 'cubes_a',
          label: 'Cubes',
          type: 'number',
          min: 0,
          max: 20,
          column: 'left',
        },
        {
          id: 'botguy_a',
          label: 'Botguy',
          type: 'number',
          min: 0,
          max: 10,
          column: 'left',
        },
        {
          id: 'pom_a',
          label: 'Poms',
          type: 'number',
          min: 0,
          max: 20,
          column: 'left',
        },
        {
          id: 'bonus_a',
          label: 'Bonus',
          type: 'number',
          min: 0,
          max: 50,
          column: 'left',
        },
        {
          id: 'section_header_team_b',
          label: 'TEAM B',
          type: 'section_header',
          column: 'right',
        },
        {
          id: 'group_header_start_box_b',
          label: 'Lower Start Box',
          type: 'group_header',
          column: 'right',
        },
        {
          id: 'drums_b',
          label: 'Drums × 25',
          type: 'number',
          min: 0,
          max: 4,
          column: 'right',
        },
        {
          id: 'cubes_b',
          label: 'Cubes',
          type: 'number',
          min: 0,
          max: 20,
          column: 'right',
        },
        {
          id: 'botguy_b',
          label: 'Botguy',
          type: 'number',
          min: 0,
          max: 10,
          column: 'right',
        },
        {
          id: 'pom_b',
          label: 'Poms',
          type: 'number',
          min: 0,
          max: 20,
          column: 'right',
        },
        {
          id: 'bonus_b',
          label: 'Bonus',
          type: 'number',
          min: 0,
          max: 50,
          column: 'right',
        },
      ],
    };

    const tpl = await db.run(
      `INSERT INTO scoresheet_templates (name, description, schema, access_code, is_active)
       VALUES (?, 'Head-to-head sheet with Team A/B headers', ?, 'e2e-score-sticky', TRUE)
       RETURNING id`,
      [STICKY_TEMPLATE_TITLE, JSON.stringify(schema)],
    );
    stickyTemplateId = Number(tpl.lastID);

    await db.run(
      `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type)
       VALUES (?, ?, 'bracket') RETURNING id`,
      [stickyEventId, stickyTemplateId],
    );

    await db.run(
      `INSERT INTO score_submissions
        (user_id, template_id, participant_name, score_data, status, event_id, score_type,
         result_type, result_note)
       VALUES (?, ?, ?, ?, 'accepted', ?, 'bracket', 'no_contest', 'E2E no contest')
       RETURNING id`,
      [
        stickyAdmin.adminUserId,
        stickyTemplateId,
        'Sticky Match',
        JSON.stringify({
          drums_a: { label: 'Drums × 25', value: 0, type: 'number' },
          cubes_a: { label: 'Cubes', value: 2, type: 'number' },
          drums_b: { label: 'Drums × 25', value: 0, type: 'number' },
          cubes_b: { label: 'Cubes', value: 1, type: 'number' },
        }),
        stickyEventId,
      ],
    );
  });

  test.afterAll(async () => {
    const db = e2eDb();

    await db.run('DELETE FROM score_submissions WHERE template_id = ?', [
      stickyTemplateId,
    ]);
    await db.run(
      'DELETE FROM event_scoresheet_templates WHERE template_id = ?',
      [stickyTemplateId],
    );
    await db.run('DELETE FROM scoresheet_templates WHERE id = ?', [
      stickyTemplateId,
    ]);
    await db.run('DELETE FROM events WHERE id = ?', [stickyEventId]);
    await deleteSession(stickyAdmin.sid);
    await db.run('DELETE FROM users WHERE id = ?', [stickyAdmin.adminUserId]);
    await closeE2eDb();
  });

  test('does not cover score rows with Team A/B headers, and keeps the judge offset', async ({
    page,
  }) => {
    await setSessionCookie(page, stickyAdmin.signedCookie);
    await page.setViewportSize({ width: 1400, height: 560 });
    await page.goto(`/admin/events/${stickyEventId}?view=scoring`);

    await expect(
      page.getByRole('heading', { name: 'Bracket Scores' }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'View' }).click();

    const modal = page.locator('.modal.show');
    await expect(
      modal.getByRole('heading', { name: 'View Score' }),
    ).toBeVisible();

    const teamAHeader = modal
      .locator('.scoresheet-column')
      .first()
      .locator('.section-header');
    const drumsField = modal
      .locator('.scoresheet-column')
      .first()
      .locator('.score-field', { hasText: 'Drums × 25' });

    await expect(teamAHeader).toHaveText('TEAM A');
    await expect(drumsField).toBeVisible();
    await expect(teamAHeader).toHaveCSS('top', '0px');

    const restHeaderBox = await teamAHeader.boundingBox();
    const restFieldBox = await drumsField.boundingBox();
    expect(restHeaderBox).toBeTruthy();
    expect(restFieldBox).toBeTruthy();
    expect(boxesOverlap(restHeaderBox!, restFieldBox!)).toBe(false);

    const form = modal.locator('.score-view-form');
    await form.evaluate((el) => {
      el.scrollTop = 400;
    });

    const stuckOffset = await page.evaluate(() => {
      const formEl = document.querySelector('.score-view-form');
      const headerEl = document.querySelector(
        '.score-view-form .scoresheet-column .section-header',
      );
      if (!formEl || !headerEl) return Number.NaN;
      return (
        headerEl.getBoundingClientRect().top -
        formEl.getBoundingClientRect().top
      );
    });
    expect(stuckOffset).toBeGreaterThanOrEqual(0);
    expect(stuckOffset).toBeLessThan(40);

    const defaultStickyTop = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'section-header';
      document.body.appendChild(el);
      const top = getComputedStyle(el).top;
      el.remove();
      return top;
    });
    const fourPointFiveRem = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.position = 'absolute';
      probe.style.top = '4.5rem';
      document.body.appendChild(probe);
      const top = getComputedStyle(probe).top;
      probe.remove();
      return top;
    });
    expect(defaultStickyTop).toBe(fourPointFiveRem);
  });
});
