import { test, expect } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';
import {
  deleteSession,
  seedAdminSession,
  setSessionCookie,
  writeSession,
} from './helpers/session';

const ADMIN_EMAIL = 'e2e-nav-admin@kipr.org';
const ADMIN_NAME = 'E2E Nav Admin';
const GOOGLE_ID = `e2e-nav-admin-${Date.now()}`;
const STORED_EVENT = `E2E Nav Stored ${Date.now()}`;
const DEEP_LINK_EVENT = `E2E Nav Deep Link ${Date.now()}`;
const CREATED_EVENT = `E2E Nav Created ${Date.now()}`;

let admin: Awaited<ReturnType<typeof seedAdminSession>>;
let storedEventId: number;
let deepLinkEventId: number;
let createdEventId: number | null = null;

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await setSessionCookie(page, admin.signedCookie);
}

test.describe('Admin navigation and session', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    admin = await seedAdminSession({
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      googleId: GOOGLE_ID,
    });
    const db = e2eDb();
    const stored = await db.run(
      `INSERT INTO events (name, status, event_date, location, seeding_rounds, score_accept_mode, spectator_results_released)
       VALUES (?, 'setup', '2026-06-15', 'Stored Arena', 3, 'manual', 0) RETURNING id`,
      [STORED_EVENT],
    );
    storedEventId = Number(stored.lastID);
    const deep = await db.run(
      `INSERT INTO events (name, status, event_date, location, seeding_rounds, score_accept_mode, spectator_results_released)
       VALUES (?, 'active', '2026-07-01', 'Deep Arena', 3, 'manual', 0) RETURNING id`,
      [DEEP_LINK_EVENT],
    );
    deepLinkEventId = Number(deep.lastID);
  });

  test.afterAll(async () => {
    const db = e2eDb();
    const ids = [storedEventId, deepLinkEventId, createdEventId].filter(
      (id): id is number => id != null,
    );
    for (const id of ids) {
      await db.run('DELETE FROM audit_log WHERE event_id = ?', [id]);
      await db.run('DELETE FROM events WHERE id = ?', [id]);
    }
    await deleteSession(admin.sid);
    await db.run('DELETE FROM users WHERE id = ?', [admin.adminUserId]);
    await closeE2eDb();
  });

  test('a deep link beats a stored event selection', async ({ page }) => {
    await loginAsAdmin(page);
    await page.addInitScript((eventId) => {
      localStorage.setItem('colosseum_selected_event_id', String(eventId));
    }, storedEventId);

    await page.goto(`/admin/events/${deepLinkEventId}?view=events`);
    await expect(page.getByText('Currently Selected')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.event-badge-name')).toHaveText(DEEP_LINK_EVENT);
    await expect(
      page.locator('strong', { hasText: STORED_EVENT }),
    ).toBeVisible();
    const stored = await page.evaluate(() =>
      localStorage.getItem('colosseum_selected_event_id'),
    );
    expect(stored).toBe(String(deepLinkEventId));
  });

  test('browser back restores the previous route event', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/events/${storedEventId}?view=events`);
    await expect(page.locator('.event-badge-name')).toHaveText(STORED_EVENT, {
      timeout: 30_000,
    });
    await page.goto(`/admin/events/${deepLinkEventId}?view=events`);
    await expect(page.locator('.event-badge-name')).toHaveText(DEEP_LINK_EVENT);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/admin/events/${storedEventId}`));
    await expect(page.locator('.event-badge-name')).toHaveText(STORED_EVENT);
  });

  test('a bracket deep link selects the route event', async ({ page }) => {
    await loginAsAdmin(page);
    await page.addInitScript((eventId) => {
      localStorage.setItem('colosseum_selected_event_id', String(eventId));
    }, storedEventId);
    await page.goto(`/admin/events/${deepLinkEventId}/brackets/1`);
    await expect(page.getByRole('heading', { name: 'Brackets' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.event-badge-name')).toHaveText(DEEP_LINK_EVENT);
  });

  test('creating an event selects it even if the list refresh is slow', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/events?view=events');
    await expect(
      page.getByRole('button', { name: '+ Create New Event' }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '+ Create New Event' }).click();
    const modal = page.locator('.modal.show');
    await expect(
      modal.getByRole('heading', { name: 'Create New Event' }),
    ).toBeVisible();
    await modal.locator('#event-name').fill(CREATED_EVENT);
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    await page.route('**/events', async (route) => {
      if (route.request().method() === 'GET') await refreshGate;
      await route.continue();
    });
    await modal.getByRole('button', { name: 'Create Event' }).click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.event-badge-name')).toHaveText(CREATED_EVENT);
    const url = page.url();
    const match = url.match(/\/admin\/events\/(\d+)/);
    expect(match).toBeTruthy();
    createdEventId = Number(match?.[1]);
    releaseRefresh();
  });

  test('deleting the selected event falls back to an active or setup event', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/events/${createdEventId}?view=events`);
    await expect(page.locator('.event-badge-name')).toHaveText(CREATED_EVENT, {
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Delete' }).first().click();
    const confirm = page.locator('.modal.show');
    await expect(
      confirm.getByRole('heading', { name: 'Delete Event' }),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Event deleted!')).toBeVisible();
    await expect(page.locator('.event-badge-name')).not.toHaveText(
      CREATED_EVENT,
    );
    createdEventId = null;
  });

  test('session expiry returns the admin to home', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/events/${deepLinkEventId}?view=events`);
    await expect(page.locator('.event-badge-name')).toHaveText(
      DEEP_LINK_EVENT,
      {
        timeout: 30_000,
      },
    );
    await deleteSession(admin.sid);
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole('heading', { name: 'Welcome to Colosseum' }),
    ).toBeVisible();
    await writeSession(admin.sid, {
      cookie: {
        originalMaxAge: 7 * 24 * 60 * 60 * 1000,
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        secure: false,
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
      },
      passport: { user: admin.adminUserId },
    });
  });

  test('session lookup failure offers retry without treating it as logout', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    let failLookup = true;
    await page.route('**/auth/user', async (route) => {
      if (failLookup) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'bad session' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/admin/events?view=events');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/admin\/events/);
    failLookup = false;
    await page.unroute('**/auth/user');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(
      page.getByRole('button', { name: '+ Create New Event' }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('audit filters restart pagination and disable duplicate load more', async ({
    page,
  }) => {
    const db = e2eDb();
    for (let i = 0; i < 60; i += 1) {
      await db.run(
        `INSERT INTO audit_log (event_id, user_id, action, entity_type, entity_id, new_value)
         VALUES (?, ?, ?, 'team', ?, ?)`,
        [
          deepLinkEventId,
          admin.adminUserId,
          i < 30 ? 'create' : 'update',
          i + 1,
          JSON.stringify({ i }),
        ],
      );
    }

    await loginAsAdmin(page);
    await page.goto(`/admin/events/${deepLinkEventId}?view=audit`);
    await expect(page.getByPlaceholder('Filter by action')).toBeVisible({
      timeout: 15_000,
    });
    const loadMore = page.getByRole('button', { name: 'Load more' });
    await expect(loadMore).toBeVisible();
    await loadMore.click();
    await expect(page).toHaveURL(/audit_page=2/);
    await expect(loadMore).toBeEnabled();

    await page.locator('.audit-filter-input').first().fill('create');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).not.toHaveURL(/audit_page=/);
    await expect(page.getByText('create').first()).toBeVisible();
    await expect(page.getByText('update')).toHaveCount(0);
  });
});
