import { test, expect } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';
import {
  deleteSession,
  seedAdminSession,
  setSessionCookie,
} from './helpers/session';

const ACCESS_CODE = 'keep-this-code';
const EVENT_NAME = `E2E Access Code Edit ${Date.now()}`;
const TEMPLATE_NAME = 'E2E Access Code Sheet';
const ADMIN_EMAIL = 'e2e-access-code-edit@kipr.org';
const ADMIN_NAME = 'E2E Access Code Edit Admin';

let eventId: number;
let templateId: number;
let admin: Awaited<ReturnType<typeof seedAdminSession>>;

test.describe('Admin scoresheet access code on edit', () => {
  test.beforeAll(async () => {
    const db = e2eDb();
    const ev = await db.run(
      `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
       VALUES (?, 'setup', 3, 'manual') RETURNING id`,
      [EVENT_NAME],
    );
    eventId = Number(ev.lastID);

    const tpl = await db.run(
      `INSERT INTO scoresheet_templates (name, description, schema, access_code, is_active)
       VALUES (?, 'Existing sheet', ?, ?, TRUE) RETURNING id`,
      [TEMPLATE_NAME, JSON.stringify({ fields: [] }), ACCESS_CODE],
    );
    templateId = Number(tpl.lastID);

    await db.run(
      `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type)
       VALUES (?, ?, 'seeding') RETURNING id`,
      [eventId, templateId],
    );

    admin = await seedAdminSession({ email: ADMIN_EMAIL, name: ADMIN_NAME });
  });

  test.afterAll(async () => {
    const db = e2eDb();
    await db.run(
      'DELETE FROM event_scoresheet_templates WHERE template_id = ?',
      [templateId],
    );
    await db.run('DELETE FROM scoresheet_templates WHERE id = ?', [templateId]);
    await db.run('DELETE FROM events WHERE id = ?', [eventId]);
    await deleteSession(admin.sid);
    await db.run('DELETE FROM users WHERE id = ?', [admin.adminUserId]);
    await closeE2eDb();
  });

  test('autofills the access code and keeps it when the field is left blank', async ({
    page,
  }, testInfo) => {
    await setSessionCookie(page, admin.signedCookie);
    await page.goto(`/admin/events/${eventId}?view=scoresheets`);

    await expect(
      page.getByRole('heading', { name: 'Score Sheets' }),
    ).toBeVisible();
    await expect(page.getByText(ACCESS_CODE)).toBeVisible();

    await page
      .locator('tr', { hasText: TEMPLATE_NAME })
      .getByRole('button', { name: 'Edit' })
      .click();

    const modal = page.locator('.modal.show');
    await expect(
      modal.getByRole('heading', { name: 'Edit Score Sheet' }),
    ).toBeVisible();

    const accessInput = modal
      .locator('.form-group', { hasText: 'Access Code' })
      .locator('input');
    await expect(accessInput).toHaveValue(ACCESS_CODE);
    await page.screenshot({
      path: testInfo.outputPath('scoresheet-edit-access-code-autofill.png'),
      fullPage: true,
    });

    await accessInput.fill('');
    await modal.getByRole('button', { name: 'Update Score Sheet' }).click();

    await expect(
      page.getByText('Score sheet updated successfully!'),
    ).toBeVisible();

    const rowAfter = await e2eDb().get<{ access_code: string }>(
      'SELECT access_code FROM scoresheet_templates WHERE id = ?',
      [templateId],
    );
    expect(rowAfter?.access_code).toBe(ACCESS_CODE);

    await page.goto(`/admin/events/${eventId}?view=scoresheets`);
    await page
      .locator('tr', { hasText: TEMPLATE_NAME })
      .getByRole('button', { name: 'Edit' })
      .click();
    const modalAgain = page.locator('.modal.show');
    await expect(
      modalAgain.getByRole('heading', { name: 'Edit Score Sheet' }),
    ).toBeVisible();
    await expect(
      modalAgain
        .locator('.form-group', { hasText: 'Access Code' })
        .locator('input'),
    ).toHaveValue(ACCESS_CODE);
    await page.screenshot({
      path: testInfo.outputPath(
        'scoresheet-edit-access-code-after-blank-save.png',
      ),
      fullPage: true,
    });
  });
});
