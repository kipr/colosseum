import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('has correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Colosseum - Score Sheet App');
  });

  test('shows welcome heading and role cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.app-loading')).toHaveCount(0);

    await expect(
      page.getByRole('heading', { name: 'Welcome to Colosseum' }),
    ).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Judge' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Administrator' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Spectator' }),
    ).toBeVisible();
  });

  test('judge card navigates to /judge', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { name: 'Judge' }).click();
    await expect(page).toHaveURL(/\/judge/);
  });

  test('spectator card navigates to /spectator', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { name: 'Spectator' }).click();
    await expect(page).toHaveURL(/\/spectator/);
  });

  test('administrator card starts OAuth with an admin return path', async ({
    page,
  }) => {
    let oauthUrl: URL | undefined;
    await page.route('**/auth/google**', async (route) => {
      oauthUrl = new URL(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: 'OAuth started',
      });
    });

    await page.goto('/');
    await page.getByRole('heading', { name: 'Administrator' }).click();

    await expect.poll(() => oauthUrl?.pathname).toBe('/auth/google');
    expect(oauthUrl?.searchParams.get('returnTo')).toBe('/admin/events');
  });
});
