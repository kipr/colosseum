import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
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
const STICKY_TEMPLATE_TITLE =
  '2026 Botball Fall Tournament - Double Elimination Score Sheet';

const botballDeSchema = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../templates/botball-de-template.json'),
    'utf8',
  ),
) as { title: string; fields: unknown[] };

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

    const schema = { ...botballDeSchema, eventId: stickyEventId };

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
          team_a_starting_cubes: { label: 'Cubes', value: 4, type: 'number' },
          team_a_starting_baskets: {
            label: 'Baskets',
            value: 1,
            type: 'number',
          },
          team_b_starting_cubes: { label: 'Cubes', value: 2, type: 'number' },
          team_b_starting_baskets: {
            label: 'Baskets',
            value: 0,
            type: 'number',
          },
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

  test('pins Team A/B to the form top on a long sheet, and keeps the judge offset', async ({
    page,
  }) => {
    await setSessionCookie(page, stickyAdmin.signedCookie);
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.goto(`/admin/events/${stickyEventId}?view=scoring`);

    await expect(
      page.getByRole('heading', { name: 'Bracket Scores' }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'View' }).click();

    const modal = page.locator('.modal.show');
    await expect(
      modal.getByRole('heading', { name: 'View Score' }),
    ).toBeVisible();

    const form = modal.locator('.score-view-form');
    const teamAHeader = modal
      .locator('.scoresheet-column')
      .first()
      .locator('.section-header');
    const cubesField = modal
      .locator('.scoresheet-column')
      .first()
      .locator('.score-field', { hasText: 'Cubes' })
      .first();

    await expect(teamAHeader).toHaveText('TEAM A');
    await expect(cubesField).toBeVisible();
    await expect(teamAHeader).toHaveCSS('top', '0px');

    const restHeaderBox = await teamAHeader.boundingBox();
    const restFieldBox = await cubesField.boundingBox();
    expect(restHeaderBox).toBeTruthy();
    expect(restFieldBox).toBeTruthy();
    expect(boxesOverlap(restHeaderBox!, restFieldBox!)).toBe(false);

    const overflow = await form.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(
      overflow.clientHeight,
      'the form must be a real scrollport, not a collapsed flex sliver',
    ).toBeGreaterThan(300);
    expect(
      overflow.scrollHeight,
      'the Botball DE sheet must overflow the form so sticky can be tested',
    ).toBeGreaterThan(overflow.clientHeight + 200);

    await form.evaluate((el) => {
      el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, 520);
    });

    const { stuckOffset, formScrollTop } = await page.evaluate(() => {
      const formEl = document.querySelector('.modal.show .score-view-form');
      const headerEl = document.querySelector(
        '.modal.show .score-view-form .scoresheet-column .section-header',
      );
      if (!formEl || !headerEl) {
        throw new Error('Could not find score-view-form or TEAM A header');
      }
      return {
        stuckOffset:
          headerEl.getBoundingClientRect().top -
          formEl.getBoundingClientRect().top,
        formScrollTop: formEl.scrollTop,
      };
    });
    expect(formScrollTop).toBeGreaterThan(200);
    expect(stuckOffset).toBeGreaterThanOrEqual(0);
    expect(
      stuckOffset,
      'after scrolling a long sheet, TEAM A should stick flush to the top of the form',
    ).toBeLessThan(8);

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
