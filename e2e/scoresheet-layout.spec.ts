import { test, expect } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';

const ACCESS_CODE = 'e2e-layout-code';
const EVENT_NAME = 'E2E Scoresheet Layout Event';
const TEMPLATE_NAME = 'E2E Layout Sheet';

const LAYOUT_VIEWPORTS = [
  { width: 1000, height: 900 },
  { width: 820, height: 900 },
  { width: 700, height: 900 },
  { width: 500, height: 900 },
  { width: 390, height: 900 },
] as const;

let eventId: number;
let templateId: number;

function buildLayoutSchema() {
  return {
    title: TEMPLATE_NAME,
    layout: 'two-column',
    fields: [
      {
        id: 'section_header_side_a',
        label: 'SIDE A',
        type: 'section_header',
        column: 'left',
      },
      {
        id: 'drum_mult',
        label: 'Drum',
        suffix: '× 2',
        column: 'left',
        type: 'buttons',
        isMultiplier: true,
        options: [
          { label: 'No', value: '0' },
          { label: 'Yes', value: '1' },
        ],
      },
      {
        id: 'botguy_mult',
        label: 'Botguy',
        suffix: '× 2',
        column: 'left',
        type: 'buttons',
        isMultiplier: true,
        options: [
          { label: 'No', value: '0' },
          { label: 'Yes', value: '1' },
        ],
      },
      {
        id: 'starting_box',
        label: 'Robot touching starting box',
        column: 'left',
        type: 'buttons',
        options: [
          { label: 'No', value: '0' },
          { label: 'Yes', value: '1' },
        ],
      },
      {
        id: 'cube_stacks',
        label: 'Cube Stacks',
        type: 'repeatableGroup',
        column: 'left',
        rowLabel: 'Stack',
        minRows: 1,
        fields: [
          {
            id: 'small_red',
            label: 'Small Red',
            type: 'number',
            min: 0,
            max: 30,
            step: 1,
          },
          {
            id: 'small_green',
            label: 'Small Green',
            type: 'number',
            min: 0,
            max: 30,
            step: 1,
          },
          {
            id: 'large_red',
            label: 'Large Red',
            type: 'number',
            min: 0,
            max: 30,
            step: 1,
          },
          {
            id: 'large_green',
            label: 'Large Green',
            type: 'number',
            min: 0,
            max: 30,
            step: 1,
          },
          {
            id: 'large_brown',
            label: 'Large Brown',
            type: 'number',
            min: 0,
            max: 30,
            step: 1,
          },
        ],
      },
      {
        id: 'section_header_side_b',
        label: 'SIDE B',
        type: 'section_header',
        column: 'right',
      },
      {
        id: 'bonus',
        label: 'Bonus',
        column: 'right',
        type: 'buttons',
        options: [
          { label: 'No', value: '0' },
          { label: 'Yes', value: '100' },
        ],
      },
    ],
  };
}

async function enterAsJudge(page: import('@playwright/test').Page) {
  await page.goto('/judge');
  await page.locator('.template-card', { hasText: TEMPLATE_NAME }).click();
  await page
    .getByPlaceholder('Enter code provided by administrator')
    .fill(ACCESS_CODE);
  await page.getByRole('button', { name: 'Access Scoresheet' }).click();
  await page.waitForURL(/\/scoresheet/);
  await expect(page.locator('.scoresheet-form')).toBeVisible();
}

async function assertFitsInContainer(
  locator: import('@playwright/test').Locator,
  containerSelector: string,
) {
  const info = await locator.evaluate((el, selector) => {
    const container = el.closest(selector);
    if (!container) {
      return { overflows: true, reason: `missing ${selector}` };
    }
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    return {
      overflows:
        elRect.right > cRect.right + 1 || elRect.left < cRect.left - 1,
      elLeft: elRect.left,
      elRight: elRect.right,
      cLeft: cRect.left,
      cRight: cRect.right,
    };
  }, containerSelector);

  expect(info.overflows, JSON.stringify(info)).toBe(false);
}

async function assertNoPageHorizontalScroll(
  page: import('@playwright/test').Page,
) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(false);
}

test.describe('Scoresheet layout at narrow widths', () => {

  test.beforeAll(async () => {
    const db = e2eDb();

    const ev = await db.run(
      `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
       VALUES (?, 'active', 1, 'manual') RETURNING id`,
      [EVENT_NAME],
    );
    eventId = Number(ev.lastID);

    const schema = buildLayoutSchema();
    const tpl = await db.run(
      `INSERT INTO scoresheet_templates (name, description, schema, access_code, is_active)
       VALUES (?, 'E2E layout visual bugs', ?, ?, TRUE) RETURNING id`,
      [TEMPLATE_NAME, JSON.stringify(schema), ACCESS_CODE],
    );
    templateId = Number(tpl.lastID);

    await db.run(
      `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type)
       VALUES (?, ?, 'seeding') RETURNING id`,
      [eventId, templateId],
    );
  });

  test.afterAll(async () => {
    const db = e2eDb();

    await db.run('DELETE FROM score_submissions WHERE template_id = ?', [
      templateId,
    ]);
    await db.run(
      'DELETE FROM event_scoresheet_templates WHERE template_id = ?',
      [templateId],
    );
    await db.run('DELETE FROM scoresheet_templates WHERE id = ?', [templateId]);
    await db.run('DELETE FROM events WHERE id = ?', [eventId]);

    await closeE2eDb();
  });

  for (const viewport of LAYOUT_VIEWPORTS) {
    test(`choice buttons and number steppers fit at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await enterAsJudge(page);

      const buttonGroups = page.locator('.score-button-group');
      await expect(buttonGroups.first()).toBeVisible();

      const count = await buttonGroups.count();
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i += 1) {
        await assertFitsInContainer(
          buttonGroups.nth(i),
          '.scoresheet-column, .scoresheet-form',
        );
      }

      const yesNoButtons = page.locator('.score-option-button', {
        hasText: /^(Yes|No)$/,
      });
      const yesNoCount = await yesNoButtons.count();
      expect(yesNoCount).toBeGreaterThan(0);
      for (let i = 0; i < yesNoCount; i += 1) {
        await expect(yesNoButtons.nth(i)).toBeVisible();
        await assertFitsInContainer(
          yesNoButtons.nth(i),
          '.scoresheet-column, .scoresheet-form',
        );
      }

      const stepper = page.locator('.repeatable-group-number-stepper').first();
      await expect(stepper).toBeVisible();

      const input = stepper.locator('input.repeatable-group-number');
      await expect(input).toBeVisible();
      await expect(input).toHaveAttribute('type', 'text');
      await expect(input).toHaveAttribute('inputmode', /numeric|decimal/);

      await assertFitsInContainer(
        stepper,
        '.repeatable-group-control, .repeatable-group-table',
      );
      await assertNoPageHorizontalScroll(page);
    });
  }

  test('repeatable-group +/- buttons still change the number', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await enterAsJudge(page);

    const stepper = page.locator('.repeatable-group-number-stepper').first();
    const input = stepper.locator('input.repeatable-group-number');
    const increment = stepper.getByRole('button', { name: /Increase/ });
    const decrement = stepper.getByRole('button', { name: /Decrease/ });

    await increment.click();
    await increment.click();
    await expect(input).toHaveValue('2');

    await decrement.click();
    await expect(input).toHaveValue('1');
  });
});
