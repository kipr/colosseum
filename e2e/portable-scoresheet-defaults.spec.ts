import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test.describe('Portable scoresheet default values', () => {
  let htmlUrl: string;

  test.beforeAll(() => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'portable-defaults-e2e-'));
    const outputPath = path.join(tempDir, 'defaults.html');

    execFileSync(
      'node',
      [
        'tools/portable-scoresheet/export-html.mjs',
        '--input',
        'templates/test-default-values.json',
        '--output',
        outputPath,
      ],
      {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'pipe',
      },
    );

    htmlUrl = pathToFileURL(outputPath).href;
  });

  test('renders schema defaults and restores them on Reset', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
    });
    await page.goto(htmlUrl);

    const judgeInput = page.locator('#field-judge_name');
    const scoreInput = page.locator('#field-technical_score');
    const divisionSelect = page.locator('#field-division');
    const checkbox = page.locator('#field-time_violation');
    const ratingButtons = page
      .locator('.field-buttons')
      .filter({ hasText: 'Performance Rating' })
      .locator('button');

    await expect(judgeInput).toHaveValue('Ada Lovelace');
    await expect(scoreInput).toHaveValue('12.5');
    await expect(divisionSelect).toHaveValue('senior');
    await expect(checkbox).toBeChecked();
    await expect(ratingButtons.filter({ hasText: 'Good' })).toHaveClass(
      /active/,
    );
    await expect(page.locator('.calculated-value.grand-total')).toHaveText(
      '14.5',
    );

    await judgeInput.fill('Grace Hopper');
    await scoreInput.fill('20');
    await divisionSelect.selectOption('pro');
    await checkbox.uncheck();
    await ratingButtons.filter({ hasText: 'Excellent' }).click();

    await expect(judgeInput).toHaveValue('Grace Hopper');
    await expect(scoreInput).toHaveValue('20');
    await expect(divisionSelect).toHaveValue('pro');
    await expect(checkbox).not.toBeChecked();
    await expect(ratingButtons.filter({ hasText: 'Excellent' })).toHaveClass(
      /active/,
    );

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Reset' }).click();

    await expect(judgeInput).toHaveValue('Ada Lovelace');
    await expect(scoreInput).toHaveValue('12.5');
    await expect(divisionSelect).toHaveValue('senior');
    await expect(checkbox).toBeChecked();
    await expect(ratingButtons.filter({ hasText: 'Good' })).toHaveClass(
      /active/,
    );
    await expect(page.locator('.calculated-value.grand-total')).toHaveText(
      '14.5',
    );
  });
});
