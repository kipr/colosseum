import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('has correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Colosseum - Score Sheet App');
  });

  test('shows welcome heading and role cards', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Welcome to Colosseum' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Judge / Scorer' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Administrator' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Spectator' })).toBeVisible();
  });

  test('judge card navigates to /judge', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { name: 'Judge / Scorer' }).click();
    await expect(page).toHaveURL(/\/judge/);
  });

  test('spectator card navigates to /spectator', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { name: 'Spectator' }).click();
    await expect(page).toHaveURL(/\/spectator/);
  });
});
