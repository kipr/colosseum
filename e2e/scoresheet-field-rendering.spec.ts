import { test, expect } from '@playwright/test';
import SQLite from 'better-sqlite3';
import path from 'path';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const DB_PATH = path.join(__dirname, '..', 'database', 'colosseum.db');
const ACCESS_CODE = 'e2e-field-render-code';
const EVENT_NAME = 'E2E Field Rendering Event';
const TEMPLATE_NAME = 'E2E All Field Types';

/* ------------------------------------------------------------------ */
/*  Shared state seeded in beforeAll                                  */
/* ------------------------------------------------------------------ */

let eventId: number;
let templateId: number;

/* ------------------------------------------------------------------ */
/*  Schema builder – exercises all five documented field types         */
/*  (text, number, dropdown, buttons, checkbox)                       */
/*  Uses two-column layout so every field renders exactly once.        */
/* ------------------------------------------------------------------ */

function buildAllFieldTypesSchema() {
  return {
    title: TEMPLATE_NAME,
    layout: 'two-column',
    fields: [
      {
        id: 'judge_name',
        label: 'Judge Name',
        type: 'text',
        required: true,
        placeholder: 'Enter your name',
        description: 'Full name of the judge',
      },
      {
        id: 'comments',
        label: 'Comments',
        type: 'text',
        placeholder: 'Optional feedback',
      },
      {
        id: 'division',
        label: 'Division',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'Junior', value: 'junior' },
          { label: 'Senior', value: 'senior' },
          { label: 'Professional', value: 'pro' },
        ],
        description: 'Select competition division',
      },
      {
        id: 'technical_score',
        label: 'Technical Score',
        type: 'number',
        required: true,
        min: 0,
        max: 50,
        step: 0.5,
        description: 'Score for technical merit (0-50)',
        column: 'left',
      },
      {
        id: 'performance_rating',
        label: 'Performance Rating',
        type: 'buttons',
        required: true,
        options: [
          { label: 'Excellent', value: '5' },
          { label: 'Good', value: '4' },
          { label: 'Fair', value: '3' },
          { label: 'Poor', value: '2' },
        ],
        description: 'Rate overall performance',
        column: 'left',
      },
      {
        id: 'creativity_score',
        label: 'Creativity Score',
        type: 'number',
        min: 0,
        max: 100,
        column: 'right',
      },
      {
        id: 'time_violation',
        label: 'Time Violation',
        type: 'checkbox',
        checkboxLabel: 'Exceeded time limit',
        description: 'Check if participant violated time rules',
        column: 'right',
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Helper: navigate through access-code flow to reach /scoresheet    */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Data lifecycle                                                    */
/* ------------------------------------------------------------------ */

test.describe('Scoresheet Field Rendering', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    const ev = db
      .prepare(
        `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
       VALUES (?, 'active', 1, 'manual')`,
      )
      .run(EVENT_NAME);
    eventId = Number(ev.lastInsertRowid);

    const schema = buildAllFieldTypesSchema();
    const tpl = db
      .prepare(
        `INSERT INTO scoresheet_templates (name, description, schema, access_code, is_active)
       VALUES (?, 'E2E field rendering test', ?, ?, 1)`,
      )
      .run(TEMPLATE_NAME, JSON.stringify(schema), ACCESS_CODE);
    templateId = Number(tpl.lastInsertRowid);

    db.prepare(
      `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type)
       VALUES (?, ?, 'seeding')`,
    ).run(eventId, templateId);

    db.close();
  });

  test.afterAll(() => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    db.prepare('DELETE FROM score_submissions WHERE template_id = ?').run(
      templateId,
    );
    db.prepare(
      'DELETE FROM event_scoresheet_templates WHERE template_id = ?',
    ).run(templateId);
    db.prepare('DELETE FROM scoresheet_templates WHERE id = ?').run(templateId);
    db.prepare('DELETE FROM events WHERE id = ?').run(eventId);

    db.close();
  });

  /* ── All field types render simultaneously ─────────────────────── */

  test('renders all five field types in a single form', async ({ page }) => {
    await enterAsJudge(page);

    const form = page.locator('.scoresheet-form');

    // Labels for every field
    await expect(
      form.locator('.score-label', { hasText: 'Judge Name' }),
    ).toBeVisible();
    await expect(
      form.locator('.score-label', { hasText: 'Comments' }),
    ).toBeVisible();
    await expect(
      form.locator('.score-label', { hasText: 'Division' }),
    ).toBeVisible();
    await expect(
      form.locator('.score-label', { hasText: 'Technical Score' }),
    ).toBeVisible();
    await expect(
      form.locator('.score-label', { hasText: 'Creativity Score' }),
    ).toBeVisible();
    await expect(
      form.locator('.score-label', { hasText: 'Performance Rating' }),
    ).toBeVisible();
    await expect(
      form.locator('.score-label', { hasText: 'Time Violation' }),
    ).toBeVisible();

    // One input element per field type
    await expect(form.locator('input[type="text"]')).toHaveCount(2);
    await expect(form.locator('input[type="number"]')).toHaveCount(2);
    await expect(form.locator('select')).toHaveCount(1);
    await expect(form.locator('.score-button-group')).toHaveCount(1);
    await expect(form.locator('input[type="checkbox"]')).toHaveCount(1);

    // Submit button
    await expect(
      page.getByRole('button', { name: 'Submit Score' }),
    ).toBeVisible();
  });

  /* ── Text field rendering ──────────────────────────────────────── */

  test('text fields render with correct placeholder and required attributes', async ({
    page,
  }) => {
    await enterAsJudge(page);

    // Required text field
    const judgeField = page
      .locator('.score-field')
      .filter({ hasText: 'Judge Name' });
    const judgeInput = judgeField.locator('input[type="text"]');
    await expect(judgeInput).toBeVisible();
    await expect(judgeInput).toHaveAttribute('placeholder', 'Enter your name');
    await expect(judgeInput).toHaveAttribute('required', '');

    // Optional text field
    const commentsField = page
      .locator('.score-field')
      .filter({ hasText: 'Comments' });
    const commentsInput = commentsField.locator('input[type="text"]');
    await expect(commentsInput).toBeVisible();
    await expect(commentsInput).toHaveAttribute(
      'placeholder',
      'Optional feedback',
    );
    await expect(commentsInput).not.toHaveAttribute('required', '');
  });

  /* ── Text field interaction ────────────────────────────────────── */

  test('text fields accept and display user input', async ({ page }) => {
    await enterAsJudge(page);

    const judgeInput = page
      .locator('.score-field')
      .filter({ hasText: 'Judge Name' })
      .locator('input[type="text"]');
    await judgeInput.fill('Jane Doe');
    await expect(judgeInput).toHaveValue('Jane Doe');

    const commentsInput = page
      .locator('.score-field')
      .filter({ hasText: 'Comments' })
      .locator('input[type="text"]');
    await commentsInput.fill('Great performance overall');
    await expect(commentsInput).toHaveValue('Great performance overall');
  });

  /* ── Number field rendering ────────────────────────────────────── */

  test('number fields render with correct min, max, step, and required attributes', async ({
    page,
  }) => {
    await enterAsJudge(page);

    // Required number field with min/max/step
    const techField = page
      .locator('.score-field')
      .filter({ hasText: 'Technical Score' });
    await expect(techField).toHaveClass(/compact/);
    const techInput = techField.locator('input[type="number"]');
    await expect(techInput).toBeVisible();
    await expect(techInput).toHaveAttribute('min', '0');
    await expect(techInput).toHaveAttribute('max', '50');
    await expect(techInput).toHaveAttribute('step', '0.5');
    await expect(techInput).toHaveAttribute('required', '');

    // Optional number field (step defaults to 1)
    const creativityField = page
      .locator('.score-field')
      .filter({ hasText: 'Creativity Score' });
    await expect(creativityField).toHaveClass(/compact/);
    const creativityInput = creativityField.locator('input[type="number"]');
    await expect(creativityInput).toBeVisible();
    await expect(creativityInput).toHaveAttribute('min', '0');
    await expect(creativityInput).toHaveAttribute('max', '100');
    await expect(creativityInput).toHaveAttribute('step', '1');
    await expect(creativityInput).not.toHaveAttribute('required', '');
  });

  /* ── Number field interaction ──────────────────────────────────── */

  test('number fields accept numeric input', async ({ page }) => {
    await enterAsJudge(page);

    const techInput = page
      .locator('.score-field')
      .filter({ hasText: 'Technical Score' })
      .locator('input[type="number"]');

    await techInput.fill('');
    await techInput.fill('25.5');
    await expect(techInput).toHaveValue('25.5');

    const creativityInput = page
      .locator('.score-field')
      .filter({ hasText: 'Creativity Score' })
      .locator('input[type="number"]');

    await creativityInput.fill('');
    await creativityInput.fill('88');
    await expect(creativityInput).toHaveValue('88');
  });

  /* ── Dropdown field rendering ──────────────────────────────────── */

  test('dropdown field renders with correct options', async ({ page }) => {
    await enterAsJudge(page);

    const divisionField = page
      .locator('.score-field')
      .filter({ hasText: 'Division' });
    const divisionSelect = divisionField.locator('select');
    await expect(divisionSelect).toBeVisible();
    await expect(divisionSelect).toHaveAttribute('required', '');

    // Placeholder option
    const placeholder = divisionSelect.locator('option', {
      hasText: 'Select...',
    });
    await expect(placeholder).toBeAttached();
    await expect(placeholder).toHaveValue('');

    // Defined options
    await expect(divisionSelect.locator('option')).toHaveCount(4);
    await expect(
      divisionSelect.locator('option[value="junior"]'),
    ).toHaveText('Junior');
    await expect(
      divisionSelect.locator('option[value="senior"]'),
    ).toHaveText('Senior');
    await expect(divisionSelect.locator('option[value="pro"]')).toHaveText(
      'Professional',
    );
  });

  /* ── Dropdown field interaction ────────────────────────────────── */

  test('dropdown field allows selecting and changing options', async ({
    page,
  }) => {
    await enterAsJudge(page);

    const divisionSelect = page
      .locator('.score-field')
      .filter({ hasText: 'Division' })
      .locator('select');

    await expect(divisionSelect).toHaveValue('');
    await divisionSelect.selectOption('senior');
    await expect(divisionSelect).toHaveValue('senior');
    await divisionSelect.selectOption('pro');
    await expect(divisionSelect).toHaveValue('pro');
  });

  /* ── Buttons field rendering ───────────────────────────────────── */

  test('button group field renders with correct options and no initial selection', async ({
    page,
  }) => {
    await enterAsJudge(page);

    const ratingField = page
      .locator('.score-field')
      .filter({ hasText: 'Performance Rating' });
    await expect(ratingField).toBeVisible();
    await expect(ratingField).toHaveClass(/compact/);

    const buttonGroup = ratingField.locator('.score-button-group');
    await expect(buttonGroup).toBeVisible();

    const buttons = buttonGroup.locator('.score-option-button');
    await expect(buttons).toHaveCount(4);
    await expect(buttons.nth(0)).toHaveText('Excellent');
    await expect(buttons.nth(1)).toHaveText('Good');
    await expect(buttons.nth(2)).toHaveText('Fair');
    await expect(buttons.nth(3)).toHaveText('Poor');

    // None selected by default
    await expect(
      buttonGroup.locator('.score-option-button.selected'),
    ).toHaveCount(0);
  });

  /* ── Buttons field interaction ─────────────────────────────────── */

  test('button group selection adds selected class and is single-select', async ({
    page,
  }) => {
    await enterAsJudge(page);

    const buttonGroup = page
      .locator('.score-field')
      .filter({ hasText: 'Performance Rating' })
      .locator('.score-button-group');
    const buttons = buttonGroup.locator('.score-option-button');

    // Click "Good"
    await buttons.nth(1).click();
    await expect(buttons.nth(1)).toHaveClass(/selected/);
    await expect(
      buttonGroup.locator('.score-option-button.selected'),
    ).toHaveCount(1);

    // Switch to "Excellent"
    await buttons.nth(0).click();
    await expect(buttons.nth(0)).toHaveClass(/selected/);
    await expect(buttons.nth(1)).not.toHaveClass(/selected/);
    await expect(
      buttonGroup.locator('.score-option-button.selected'),
    ).toHaveCount(1);
  });

  /* ── Checkbox field rendering ──────────────────────────────────── */

  test('checkbox field renders unchecked by default', async ({ page }) => {
    await enterAsJudge(page);

    const checkboxField = page
      .locator('.score-field')
      .filter({ hasText: 'Time Violation' });
    await expect(checkboxField).toBeVisible();
    await expect(checkboxField).toHaveClass(/compact/);

    const checkbox = checkboxField.locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
  });

  /* ── Checkbox field interaction ────────────────────────────────── */

  test('checkbox field toggles on click', async ({ page }) => {
    await enterAsJudge(page);

    const checkbox = page
      .locator('.score-field')
      .filter({ hasText: 'Time Violation' })
      .locator('input[type="checkbox"]');

    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
  });

  /* ── Two-column layout ─────────────────────────────────────────── */

  test('two-column layout places fields in correct columns', async ({
    page,
  }) => {
    await enterAsJudge(page);

    const columns = page.locator('.scoresheet-columns .scoresheet-column');
    await expect(columns).toHaveCount(2);

    const leftCol = columns.nth(0);
    const rightCol = columns.nth(1);

    // Left column has Technical Score (number) and Performance Rating (buttons)
    await expect(
      leftCol.locator('.score-label', { hasText: 'Technical Score' }),
    ).toBeVisible();
    await expect(
      leftCol.locator('.score-label', { hasText: 'Performance Rating' }),
    ).toBeVisible();

    // Right column has Creativity Score (number) and Time Violation (checkbox)
    await expect(
      rightCol.locator('.score-label', { hasText: 'Creativity Score' }),
    ).toBeVisible();
    await expect(
      rightCol.locator('.score-label', { hasText: 'Time Violation' }),
    ).toBeVisible();

    // Header fields are NOT in columns
    await expect(
      leftCol.locator('.score-label', { hasText: 'Judge Name' }),
    ).toHaveCount(0);
    await expect(
      rightCol.locator('.score-label', { hasText: 'Judge Name' }),
    ).toHaveCount(0);
  });
});
