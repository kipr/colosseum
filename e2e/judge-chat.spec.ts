import { test, expect, type Page } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';
import {
  deleteSession,
  seedAdminSession,
  setSessionCookie,
} from './helpers/session';

const ACCESS_CODE = 'e2e-judge-chat-code';
const EVENT_NAME = 'E2E Judge Chat Event';
const TEMPLATE_NAME = 'E2E Judge Chat Sheet';
const TEAM_NAME = 'E2E Chat Bots';
const TEAM_NUMBER = 77;
const JUDGE_NAME = 'E2E Judge Alice';
const JUDGE_MESSAGE = 'Need help with scoring';
const ADMIN_REPLY = 'We are on our way to assist you';

const ADMIN_EMAIL = 'e2e-judge-chat-admin@kipr.org';
const ADMIN_NAME = 'E2E Judge Chat Admin';

let eventId: number;
let teamId: number;
let templateId: number;
let admin: Awaited<ReturnType<typeof seedAdminSession>>;

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
        options: [{ label: 'Round 1', value: '1' }],
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
}

async function enterAsJudge(page: Page) {
  await page.goto('/judge');
  await page.locator('.template-card', { hasText: TEMPLATE_NAME }).click();
  await page
    .getByPlaceholder('Enter code provided by administrator')
    .fill(ACCESS_CODE);
  await page.getByRole('button', { name: 'Access Scoresheet' }).click();
  await page.waitForURL(/\/scoresheet/);
  await expect(page.locator('.scoresheet-form')).toBeVisible();
}

async function openStaffDrawer(page: Page) {
  await page.getByRole('button', { name: /Contact event staff/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('Judge Chat E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const db = e2eDb();

    const ev = await db.run(
      `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
       VALUES (?, 'active', 1, 'auto_accept_seeding')`,
      [EVENT_NAME],
    );
    eventId = Number(ev.lastID);

    const tm = await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, status)
       VALUES (?, ?, ?, 'checked_in')`,
      [eventId, TEAM_NUMBER, TEAM_NAME],
    );
    teamId = Number(tm.lastID);

    const schema = buildSchema(eventId);
    const tpl = await db.run(
      `INSERT INTO scoresheet_templates (name, description, schema, access_code, is_active)
       VALUES (?, 'E2E judge chat template', ?, ?, TRUE)`,
      [TEMPLATE_NAME, JSON.stringify(schema), ACCESS_CODE],
    );
    templateId = Number(tpl.lastID);

    await db.run(
      `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type)
       VALUES (?, ?, 'seeding')`,
      [eventId, templateId],
    );

    await db.run(
      `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
       VALUES (?, ?, 1, 'seeding', 1, 'queued')`,
      [eventId, teamId],
    );

    admin = await seedAdminSession({ email: ADMIN_EMAIL, name: ADMIN_NAME });
  });

  test.afterAll(async () => {
    const db = e2eDb();

    await db.run('DELETE FROM judge_chat_messages WHERE event_id = ?', [
      eventId,
    ]);
    await db.run('DELETE FROM game_queue WHERE event_id = ?', [eventId]);
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

  test('judge sends message, admin replies, judge sees reply and unread clears', async ({
    page,
    browser,
  }) => {
    // ── Judge sends a message ──
    await enterAsJudge(page);

    await expect(
      page.getByRole('button', { name: /Contact event staff/i }),
    ).toBeVisible();

    await openStaffDrawer(page);

    await page.getByPlaceholder('Enter your name…').fill(JUDGE_NAME);
    await page.getByRole('button', { name: 'Continue' }).click();

    const judgeInput = page
      .getByRole('dialog')
      .locator('.chat-input-form input');
    await judgeInput.fill(JUDGE_MESSAGE);
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByRole('dialog').getByText(JUDGE_MESSAGE)).toBeVisible(
      {
        timeout: 5_000,
      },
    );

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // ── Admin sees conversation and replies ──
    const adminContext = await browser.newContext();
    await setSessionCookie(adminContext, admin.signedCookie);
    const adminPage = await adminContext.newPage();

    await adminPage.goto(`/admin/events/${eventId}?view=judge-chat`);

    await expect(
      adminPage.getByRole('heading', { name: 'Judge Chat' }),
    ).toBeVisible({ timeout: 10_000 });

    const conversation = adminPage.locator('.judge-chat-conversation-item', {
      hasText: JUDGE_NAME,
    });
    await expect(conversation).toBeVisible({ timeout: 10_000 });
    await conversation.click();

    await expect(
      adminPage.locator('.judge-chat-thread').getByText(JUDGE_MESSAGE),
    ).toBeVisible();

    const adminInput = adminPage
      .locator('.judge-chat-thread')
      .locator('.chat-input-form input');
    await adminInput.fill(ADMIN_REPLY);
    await adminPage
      .locator('.judge-chat-thread')
      .getByRole('button', { name: 'Send message' })
      .click();

    await expect(
      adminPage.locator('.judge-chat-thread').getByText(ADMIN_REPLY),
    ).toBeVisible({ timeout: 5_000 });

    await adminContext.close();

    // ── Judge page (still open) receives reply via polling ──
    const staffBtn = page.locator('.judge-chat-staff-btn');
    await expect(staffBtn.locator('.judge-chat-unread-dot')).toBeVisible({
      timeout: 16_000,
    });

    await openStaffDrawer(page);

    await expect(page.getByRole('dialog').getByText(ADMIN_REPLY)).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: 'Close' }).click();

    await expect(staffBtn.locator('.judge-chat-unread-dot')).not.toBeVisible({
      timeout: 5_000,
    });
  });
});
