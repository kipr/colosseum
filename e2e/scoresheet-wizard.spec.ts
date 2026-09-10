import { test, expect, type Locator } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';
import {
  deleteSession,
  seedAdminSession,
  setSessionCookie,
} from './helpers/session';

const EVENT_NAME = `E2E Scoresheet Wizard ${Date.now()}`;
const ADMIN_EMAIL = 'e2e-wizard-admin@kipr.org';
const ADMIN_NAME = 'E2E Wizard Admin';

let eventId: number;
let admin: Awaited<ReturnType<typeof seedAdminSession>>;

async function assertDescriptionFitsInsideCard(card: Locator) {
  const metrics = await card.evaluate((el) => {
    const desc = el.querySelector('.score-sheet-wizard-type-desc');
    if (!(desc instanceof HTMLElement)) {
      return { error: 'missing description' };
    }
    const cardRect = el.getBoundingClientRect();
    const descRect = desc.getBoundingClientRect();
    return {
      cardHeight: cardRect.height,
      descBottom: descRect.bottom,
      cardBottom: cardRect.bottom,
      clipped: descRect.bottom > cardRect.bottom + 1,
      overflowY: getComputedStyle(el).overflowY,
      scrollOverflow: el.scrollHeight - el.clientHeight,
    };
  });

  expect(metrics.error).toBeUndefined();
  expect(metrics.clipped, JSON.stringify(metrics)).toBe(false);
  expect(metrics.scrollOverflow, JSON.stringify(metrics)).toBeLessThanOrEqual(
    1,
  );
}

test.describe('Score sheet wizard type cards', () => {
  test.beforeAll(async () => {
    const db = e2eDb();
    const ev = await db.run(
      `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
       VALUES (?, 'setup', 3, 'manual') RETURNING id`,
      [EVENT_NAME],
    );
    eventId = Number(ev.lastID);
    admin = await seedAdminSession({ email: ADMIN_EMAIL, name: ADMIN_NAME });
  });

  test.afterAll(async () => {
    const db = e2eDb();
    await db.run('DELETE FROM events WHERE id = ?', [eventId]);
    await deleteSession(admin.sid);
    await db.run('DELETE FROM users WHERE id = ?', [admin.adminUserId]);
    await closeE2eDb();
  });

  test('step 1 type cards show full descriptions without clipping', async ({
    page,
  }) => {
    await setSessionCookie(page, admin.signedCookie);
    await page.goto(`/admin/events/${eventId}?view=scoresheets`);

    await expect(
      page.getByRole('heading', { name: 'Score Sheets' }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: '+ Create New Score Sheet' })
      .click();

    const choiceModal = page.locator('.modal.show');
    await expect(
      choiceModal.getByRole('heading', { name: 'Create New Score Sheet' }),
    ).toBeVisible();
    await choiceModal.getByText('Use Score Sheet Generator').click();

    const wizard = page.locator('.modal.show');
    await expect(
      wizard.getByRole('heading', { name: 'Score Sheet Wizard' }),
    ).toBeVisible();
    await expect(wizard.getByText('Step 1 of 4')).toBeVisible();

    const expectedCards = [
      { title: 'Seeding', description: 'For qualification rounds' },
      {
        title: 'Double Seeding',
        description: 'Paired rounds, per-side scores',
      },
      { title: 'Double Elimination', description: 'For bracket games' },
    ];

    const cards = wizard.locator('.score-sheet-wizard-type-card');
    await expect(cards).toHaveCount(expectedCards.length);

    for (const expected of expectedCards) {
      const card = cards.filter({
        has: page.locator('.score-sheet-wizard-type-title', {
          hasText: new RegExp(`^${expected.title}$`),
        }),
      });
      await expect(card.getByText(expected.description)).toBeVisible();
      await assertDescriptionFitsInsideCard(card);
    }
  });
});
