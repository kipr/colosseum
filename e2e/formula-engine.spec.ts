import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ScoresheetTemplate } from '../src/shared/scoresheetSchema';

const template: ScoresheetTemplate = {
  name: 'Formula Browser Test',
  schema: {
    title: 'Formula Browser Test',
    layout: 'two-column',
    fields: [
      {
        id: 'raw',
        label: 'Raw Points',
        type: 'text',
        defaultValue: 'bad',
        column: 'left',
      },
      {
        id: 'total',
        label: 'Total',
        type: 'calculated',
        formula: 'subtotal+1',
        isGrandTotal: true,
      },
      {
        id: 'subtotal',
        label: 'Subtotal',
        type: 'calculated',
        formula: 'raw*2',
        column: 'left',
      },
      {
        id: 'independent',
        label: 'Independent',
        type: 'calculated',
        formula: '3',
        column: 'right',
      },
    ],
  },
};

test('judge blocks submission, guards the handler, recovers, and submits fresh ordered totals', async ({
  page,
}) => {
  await page.addInitScript(
    (value) => sessionStorage.setItem('currentTemplate', JSON.stringify(value)),
    template,
  );
  let submissions = 0;
  let submitted: Record<string, { value: number }> = {};
  await page.route('**/api/scores/submit', async (route) => {
    submissions++;
    submitted = route.request().postDataJSON().scoreData;
    await route.fulfill({ json: { success: true } });
  });
  await page.goto('/scoresheet');
  const submit = page.getByRole('button', { name: 'Submit Score' });
  await expect(submit).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('finite number');
  await expect(page.locator('.grand-total-field .calculated-value')).toHaveText(
    'Unavailable',
  );
  await page
    .locator('.scoresheet-form')
    .evaluate((form) =>
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
  await expect(
    page.getByText('Correct the formula errors before submitting.'),
  ).toBeVisible();
  expect(submissions).toBe(0);
  await page
    .locator('.score-field', { hasText: 'Raw Points' })
    .locator('input')
    .fill('4');
  await expect(submit).toBeEnabled();
  await expect(page.locator('.grand-total-field .calculated-value')).toHaveText(
    '9',
  );
  await submit.click();
  await expect(page.getByText('Score submitted successfully!')).toBeVisible();
  expect(submissions).toBe(1);
  expect(submitted.total.value).toBe(9);
  expect(submitted.subtotal.value).toBe(8);
});

test('portable runs offline, guards downloads, restores drafts, resets, and matches app totals', async ({
  page,
  context,
}) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'formula-browser-'));
  const input = path.join(dir, 'input.json');
  const output = path.join(dir, 'sheet.html');
  writeFileSync(input, JSON.stringify(template));
  execFileSync(
    'node',
    [
      '-r',
      'ts-node/register',
      'tools/portable-scoresheet/export-html.ts',
      '--input',
      input,
      '--output',
      output,
    ],
    { stdio: 'pipe' },
  );
  await context.setOffline(true);
  await page.goto(pathToFileURL(output).href);
  const download = page.getByRole('button', { name: 'Download JSON' });
  await expect(download).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('finite number');
  let downloads = 0;
  page.on('download', () => downloads++);
  // Invoke the listener even though the native button is disabled.
  await download.dispatchEvent('click');
  expect(downloads).toBe(0);
  await page.locator('#field-raw').fill('4');
  await expect(download).toBeEnabled();
  await expect(page.locator('.grand-total')).toHaveText('9');
  await page.reload();
  await expect(page.locator('#field-raw')).toHaveValue('4');
  await expect(page.locator('.grand-total')).toHaveText('9');
  const downloaded = page.waitForEvent('download');
  await download.click();
  const file = await downloaded;
  const payload = JSON.parse(readFileSync((await file.path())!, 'utf8'));
  expect(payload.calculated).toEqual({ subtotal: 8, total: 9, independent: 3 });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('#field-raw')).toHaveValue('bad');
  await expect(download).toBeDisabled();
  await expect(page.locator('.grand-total')).toContainText('Unavailable');
});

test('app and portable preserve numeric and string button types for strict equality', async ({
  page,
}) => {
  const typedTemplate: ScoresheetTemplate = {
    name: 'Typed Buttons',
    schema: {
      title: 'Typed Buttons',
      layout: 'two-column',
      fields: [
        {
          id: 'choice',
          label: 'Choice',
          type: 'buttons',
          column: 'left',
          options: [
            { label: 'Numeric One', value: 1 },
            { label: 'Text One', value: '1' },
          ],
        },
        {
          id: 'total',
          label: 'Total',
          type: 'calculated',
          formula: "choice===1?10:choice==='1'?20:0",
          isGrandTotal: true,
        },
      ],
    },
  };
  const dir = mkdtempSync(path.join(os.tmpdir(), 'typed-buttons-'));
  const input = path.join(dir, 'input.json');
  const output = path.join(dir, 'sheet.html');
  writeFileSync(input, JSON.stringify(typedTemplate));
  execFileSync(
    'node',
    [
      '-r',
      'ts-node/register',
      'tools/portable-scoresheet/export-html.ts',
      '--input',
      input,
      '--output',
      output,
    ],
    { stdio: 'pipe' },
  );
  await page.addInitScript(
    (value) => sessionStorage.setItem('currentTemplate', JSON.stringify(value)),
    typedTemplate,
  );
  for (const url of ['/scoresheet', pathToFileURL(output).href]) {
    await page.goto(url);
    await expect(page.locator('.calculated-value')).toHaveText('0');
    await page.getByRole('button', { name: 'Numeric One' }).click();
    await expect(page.locator('.calculated-value')).toHaveText('10');
    await page.getByRole('button', { name: 'Text One' }).click();
    await expect(page.locator('.calculated-value')).toHaveText('20');
  }
});
