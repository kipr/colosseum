import { test, expect } from '@playwright/test';

const event = { id: 1, name: 'Preview defaults event', status: 'active' };
const template = {
  id: 2,
  name: 'Preview defaults',
  description: '',
  access_code: 'preview-defaults-code',
  created_at: '2026-01-01T00:00:00Z',
  schema: {
    title: 'Preview defaults',
    layout: 'two-column',
    fields: [
      {
        id: 'judge_name',
        label: 'Judge Name',
        type: 'text',
        defaultValue: 'Ada Lovelace',
        column: 'left',
      },
      {
        id: 'cubes',
        label: 'Cubes',
        type: 'number',
        defaultValue: 3,
        column: 'left',
      },
      {
        id: 'penalties',
        label: 'Penalties',
        type: 'number',
        defaultValue: 0,
        column: 'left',
      },
      {
        id: 'division',
        label: 'Division',
        type: 'dropdown',
        defaultValue: 'senior',
        options: [
          { label: 'Junior', value: 'junior' },
          { label: 'Senior', value: 'senior' },
        ],
        column: 'right',
      },
      {
        id: 'rating',
        label: 'Rating',
        type: 'buttons',
        defaultValue: 2,
        options: [
          { label: 'Fair', value: 1 },
          { label: 'Good', value: 2 },
        ],
        column: 'right',
      },
      {
        id: 'parked',
        label: 'Parked',
        type: 'checkbox',
        defaultValue: true,
        column: 'right',
      },
      {
        id: 'cube_points',
        label: 'Cube Points',
        type: 'calculated',
        formula: 'cubes * 2',
        column: 'right',
      },
    ],
  },
};

// The preview should show what a judge sees before touching the sheet.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data: Record<string, unknown> = {
      '/auth/user': {
        id: 1,
        name: 'Admin',
        email: 'admin@kipr.org',
        isAdmin: true,
      },
      '/events': [event],
      '/events/1': event,
      '/scoresheet/templates/admin': [template],
      '/scoresheet/templates/2': template,
    };
    if (path in data) await route.fulfill({ json: data[path] });
    else await route.continue();
  });
});

test('template preview renders schema defaults', async ({ page }) => {
  await page.goto('/admin/events/1?view=scoresheets');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Template Preview' });
  const field = (label: string) =>
    dialog.locator('.score-field').filter({ hasText: label });

  await expect(field('Judge Name').locator('input')).toHaveValue(
    'Ada Lovelace',
  );
  await expect(field('Cubes').locator('input')).toHaveValue('3');
  // An untouched zero default is shown as a placeholder, as in the judge form.
  await expect(field('Penalties').locator('input')).toHaveValue('');
  await expect(field('Penalties').locator('input')).toHaveAttribute(
    'placeholder',
    '0',
  );
  await expect(field('Division').locator('select')).toHaveValue('senior');
  await expect(
    field('Rating').locator('.score-option-button', { hasText: 'Good' }),
  ).toHaveClass(/selected/);
  await expect(field('Parked').locator('input')).toBeChecked();
  await expect(field('Cube Points').locator('.calculated-value')).toHaveText(
    '6',
  );
});
