import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DEFAULT_AUTOMATIC_AWARD_SETTINGS } from '../src/shared/automaticAwards';

const event = { id: 1, name: 'Modal test event', status: 'active' };
const template = {
  id: 2,
  name: 'Preview test',
  description: '',
  access_code: 'preview-code',
  created_at: '2026-01-01T00:00:00Z',
  schema: { title: 'Preview test', fields: [] },
};

// Keep these interaction regressions independent of tournament data.
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
      '/teams/event/1': [],
      '/awards/templates': [],
      '/awards/event/1': [
        {
          id: 7,
          name: 'Test award',
          award_type: 'trophy',
          recipients: [],
          individual_recipients: [],
        },
      ],
      '/awards/event/1/team-award-counts': [
        {
          team_id: 11,
          team_number: 101,
          team_name: 'Alpha Bots',
          display_name: null,
          certificate_count: 0,
          trophy_count: 0,
        },
      ],
      '/awards/event/1/automatic/preview': {
        teamCount: 1,
        settings: DEFAULT_AUTOMATIC_AWARD_SETTINGS,
        savedSettings: DEFAULT_AUTOMATIC_AWARD_SETTINGS,
        automatic: {
          de: [],
          perBracketOverall: [],
          seeding: null,
          settings: DEFAULT_AUTOMATIC_AWARD_SETTINGS,
        },
        diagnostics: { zeroScoreIssues: [], duplicateBracketWeights: [] },
        hasWarnings: false,
      },
      '/scoresheet/templates/admin': [template],
      '/scoresheet/templates/2': template,
      '/field-templates': [],
    };
    if (path in data) await route.fulfill({ json: data[path] });
    else await route.continue();
  });
});

async function openTeam(page: Page) {
  await page.goto('/admin/events/1?view=teams');
  const trigger = page.getByRole('button', { name: '+ Add Team', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Add New Team' });
  await expect(dialog).toBeVisible();
  return { dialog, trigger };
}

test('dialog is named, contains focus, closes on Escape, and restores focus', async ({
  page,
}) => {
  const { dialog, trigger } = await openTeam(page);
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.locator('#team-number')).toBeFocused();
  await expect(dialog.locator('.modal-content')).toHaveCSS(
    'max-width',
    '500px',
  );
  await dialog.getByRole('button', { name: 'Add Team', exact: true }).focus();
  await page.keyboard.press('Tab');
  // Native dialogs may include the browser chrome in keyboard navigation,
  // but focus must never reach a control in the background page.
  expect(
    await page.evaluate(
      () =>
        document.activeElement === document.body ||
        !!document.activeElement?.closest('dialog[open]'),
    ),
  ).toBe(true);
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('dialog[open]'),
    ),
  ).toBe(true);
  await dialog.locator('#team-name').focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('content clicks bubble and dragging from a textarea to the backdrop keeps input', async ({
  page,
}) => {
  await page.goto('/admin/events/1?view=teams');
  await page.getByRole('button', { name: 'Bulk Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Bulk Import Teams' });
  const text = dialog.locator('#bulk-text');
  await text.fill('101, Keep these bots');
  await page.evaluate(() => {
    document.addEventListener(
      'click',
      () => (document.body.dataset.modalClickBubbled = 'yes'),
      { once: true },
    );
  });
  await dialog
    .getByRole('heading', { name: 'Bulk Import Teams', exact: true })
    .click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-modal-click-bubbled',
    'yes',
  );
  const box = (await text.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(text).toHaveValue('101, Keep these bots');
  await dialog.click({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);
});

for (const kind of ['automatic awards', 'recipients'] as const) {
  test(`${kind} saving disables the X, Escape, and backdrop until the save finishes`, async ({
    page,
  }) => {
    let releaseSave!: () => void;
    let requestBody: unknown;
    const endpoint =
      kind === 'recipients'
        ? '/awards/event-awards/7/recipients'
        : '/awards/event/1/automatic';
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await page.route(`**${endpoint}`, async (route) => {
      requestBody = route.request().postDataJSON();
      await save;
      await route.fulfill(
        kind === 'recipients'
          ? { json: { added: 1 } }
          : { status: 400, json: { error: 'Save failed' } },
      );
    });
    try {
      await page.goto('/admin/events/1?view=awards');
      await page
        .getByRole('button', {
          name:
            kind === 'recipients'
              ? '+ Add team'
              : 'Add automatic awards (from results)',
          exact: true,
        })
        .click();
      const dialog = page.getByRole('dialog', {
        name:
          kind === 'recipients' ? 'Add team recipients' : 'Automatic awards',
      });
      if (kind === 'recipients') await dialog.getByRole('checkbox').check();
      await dialog
        .getByRole('button', {
          name: kind === 'recipients' ? 'Add 1 team' : 'Apply automatic awards',
          exact: true,
        })
        .click();
      const dismiss = dialog.getByRole('button', {
        name: 'Dismiss dialog',
        exact: true,
      });
      await expect(dismiss).toBeDisabled();
      await expect(
        dialog.getByRole('button', { name: 'Cancel', exact: true }),
      ).toBeDisabled();
      await page.keyboard.press('Escape');
      await dialog.click({ position: { x: 5, y: 5 } });
      await expect(dialog).toBeVisible();
      await expect(dismiss).toBeDisabled();
      releaseSave();
      if (kind === 'recipients') {
        await expect(dialog).toHaveCount(0);
        expect(requestBody).toEqual({ team_ids: [11] });
      } else {
        await expect(dismiss).toBeEnabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
      }
    } finally {
      releaseSave();
    }
  });
}

test('About sizing stays stable before and after loading admin modal styles', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'About', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'About Colosseum' });
  await expect(dialog.locator('.modal-content')).toHaveCSS(
    'max-width',
    '520px',
  );
  await page.keyboard.press('Escape');
  await page.goto('/admin/events/1?view=teams');
  await page.getByRole('button', { name: 'About', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'About Colosseum' });
  await expect(dialog.locator('.modal-content')).toHaveCSS(
    'max-width',
    '800px',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: /Colosseum/ }).click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(dialog.locator('.modal-content')).toHaveCSS(
    'max-width',
    '520px',
  );
});

test('preview has distinct dismissal controls and uses the mobile height limit', async ({
  page,
}) => {
  await page.goto('/admin/events/1?view=scoresheets');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Template Preview' });
  await expect(
    dialog.getByRole('button', { name: 'Close', exact: true }),
  ).toHaveCount(1);
  await expect(
    dialog.getByRole('button', { name: 'Dismiss dialog', exact: true }),
  ).toHaveCount(1);
  await expect(dialog.locator('.modal-content')).toHaveCSS(
    'max-height',
    `${await page.evaluate(() => window.innerHeight * 0.95)}px`,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.locator('.modal-content')).toHaveCSS(
    'max-height',
    '717.4px',
  );
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('failed modal saves show an interactive toast above the dialog', async ({
  page,
}) => {
  await page.route('**/teams', (route) =>
    route.fulfill({ status: 400, json: { error: 'Team save failed' } }),
  );
  const { dialog } = await openTeam(page);
  await dialog.locator('#team-number').fill('101');
  await dialog.locator('#team-name').fill('Keep these bots');
  await dialog.getByRole('button', { name: 'Add Team', exact: true }).click();
  const toast = page.locator('.toast').filter({ hasText: 'Team save failed' });
  await expect(toast).toBeVisible();
  // Use a real click: visibility alone misses top-layer occlusion and inertness.
  await toast.locator('.toast-close').click({ timeout: 1500 });
  await expect(toast).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#team-name')).toHaveValue('Keep these bots');
});

test('editor toasts come from the tab and outlive the closed modal', async ({
  page,
}) => {
  await page.route('**/field-templates', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ json: { id: 3 } })
      : route.fallback(),
  );
  await page.goto('/admin/events/1?view=scoresheets');
  await page
    .getByRole('button', { name: '+ Create Field Template', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Create Field Template' });
  const name = dialog.getByPlaceholder('e.g., Botball 2024 Scoring Fields');
  await name.fill('Keep this template');
  const fields = dialog.locator('textarea').nth(1);
  await fields.fill('[');
  await dialog
    .getByRole('button', { name: 'Create Template', exact: true })
    .click();
  const invalid = page
    .locator('.toast-error')
    .filter({ hasText: 'Invalid JSON. Please check your syntax.' });
  await expect(invalid).toBeVisible();
  await invalid.locator('.toast-close').click({ timeout: 1500 });
  await expect(invalid).toHaveCount(0);
  await expect(name).toHaveValue('Keep this template');

  await fields.fill('[]');
  await dialog
    .getByRole('button', { name: 'Create Template', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = page
    .locator('.toast-success')
    .filter({ hasText: 'Field template created!' });
  await expect(saved).toBeVisible();
  await saved.locator('.toast-close').click({ timeout: 1500 });
  await expect(saved).toHaveCount(0);
});

for (const kind of ['automatic awards', 'recipients'] as const) {
  test(`${kind} stays reachable after repeated Escape during a failed save`, async ({
    page,
  }) => {
    let releaseSave!: () => void;
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const endpoint =
      kind === 'recipients'
        ? '/awards/event-awards/7/recipients'
        : '/awards/event/1/automatic';
    await page.route(`**${endpoint}`, async (route) => {
      await save;
      await route.fulfill({
        status: 400,
        json: { error: 'Guarded save failed' },
      });
    });
    try {
      await page.goto('/admin/events/1?view=awards');
      const trigger = page.getByRole('button', {
        name:
          kind === 'recipients'
            ? '+ Add team'
            : 'Add automatic awards (from results)',
        exact: true,
      });
      await trigger.click();
      const dialog = page.getByRole('dialog', {
        name:
          kind === 'recipients' ? 'Add team recipients' : 'Automatic awards',
      });
      if (kind === 'recipients') await dialog.getByRole('checkbox').check();
      await dialog
        .getByRole('button', {
          name: kind === 'recipients' ? 'Add 1 team' : 'Apply automatic awards',
          exact: true,
        })
        .click();
      const dismiss = dialog.getByRole('button', {
        name: 'Dismiss dialog',
        exact: true,
      });
      await expect(dismiss).toBeDisabled();
      // No pointer interaction between key presses: Chrome can bypass cancel.
      for (let press = 0; press < 5; press++)
        await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await expect(dismiss).toBeDisabled();
      releaseSave();
      await expect(dismiss).toBeEnabled();
      await expect(dialog).toBeVisible();
      if (kind === 'recipients')
        await expect(dialog.getByRole('checkbox')).toBeChecked();
      await dismiss.click();
      await expect(dialog).toHaveCount(0);
      await trigger.click();
      await expect(dialog).toBeVisible();
    } finally {
      releaseSave();
    }
  });
}

test('toasts remain interactive as dialogs close and another dialog opens', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/teams', (route) =>
    route.fulfill({ status: 400, json: { error: 'Persistent error' } }),
  );
  const { dialog } = await openTeam(page);
  await dialog.locator('#team-number').fill('101');
  await dialog.locator('#team-name').fill('Test bots');
  await dialog.getByRole('button', { name: 'Add Team', exact: true }).click();
  const toast = page.locator('.toast').filter({ hasText: 'Persistent error' });
  await expect(toast).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Dismiss dialog', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  // Trial clicks check real hit testing without dismissing the notification.
  await toast.locator('.toast-close').click({ trial: true });
  await page.getByRole('button', { name: 'About', exact: true }).click();
  const about = page.getByRole('dialog', { name: 'About Colosseum' });
  await expect(about).toBeVisible();
  await toast.locator('.toast-close').click();
  await expect(toast).toHaveCount(0);
  await expect(about).toBeVisible();
  expect(errors).toEqual([]);
});

test('native unguarded closure clears React state and allows reopening', async ({
  page,
}) => {
  const { dialog, trigger } = await openTeam(page);
  await dialog.evaluate((element) => (element as HTMLDialogElement).close());
  await expect(page.locator('dialog.modal')).toHaveCount(0);
  await trigger.click();
  await expect(dialog).toBeVisible();
});
