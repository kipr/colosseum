import { test, expect, type Locator, type Page } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';

/*
 * Header-click sorting on the public spectator tables: toggling, per-column
 * default direction, locale-aware names, and missing values sorting last in
 * both directions.
 */

const EVENT_NAME = 'E2E Table Sorting Event';
const CAT_A = 'E2E Sort Cat A';
const CAT_B = 'E2E Sort Cat B';

const TEAMS = {
  zeta: { number: 401, name: 'Zeta' },
  emile: { number: 402, name: 'Émile' },
  fox: { number: 403, name: 'fox' },
  ellen: { number: 404, name: 'Ellen' },
} as const;
const NAMES = Object.values(TEAMS).map((t) => t.name);

let eventId: number;
let bracketId: number;
const teamIds: Record<keyof typeof TEAMS, number> = {
  zeta: 0,
  emile: 0,
  fox: 0,
  ellen: 0,
};

/** Team names in rendered row order. */
async function rowNames(table: Locator): Promise<string[]> {
  const rows = await table.locator('tbody tr').allInnerTexts();
  return rows.map((text) => NAMES.find((name) => text.includes(name)) ?? '?');
}

function sortButton(page: Page, label: string): Locator {
  return page.getByRole('button', { name: label, exact: true });
}

function tableWithSort(page: Page, label: string): Locator {
  return page.locator('table', { has: sortButton(page, label) });
}

test.describe('Table sorting', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const db = e2eDb();

    const ev = await db.run(
      `INSERT INTO events (name, status, event_date, location, seeding_rounds, score_accept_mode, spectator_results_released)
       VALUES (?, 'complete', '2026-06-15', 'E2E Arena', 3, 'manual', 1) RETURNING id`,
      [EVENT_NAME],
    );
    eventId = Number(ev.lastID);

    for (const key of Object.keys(TEAMS) as (keyof typeof TEAMS)[]) {
      const t = await db.run(
        `INSERT INTO teams (event_id, team_number, team_name, status)
         VALUES (?, ?, ?, 'checked_in') RETURNING id`,
        [eventId, TEAMS[key].number, TEAMS[key].name],
      );
      teamIds[key] = Number(t.lastID);
    }

    // No finals game, so the server leaves these ranks as seeded. The two
    // unranked entries are inserted with ids in the opposite order to their
    // seed positions (the API's order), so the id tie break is observable.
    const br = await db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, actual_team_count, status, weight)
       VALUES (?, 'Sort Bracket', 4, 4, 'in_progress', 1.0) RETURNING id`,
      [eventId],
    );
    bracketId = Number(br.lastID);
    const entries: [keyof typeof TEAMS, number, number | null][] = [
      ['emile', 1, 1],
      ['zeta', 2, 2],
      ['ellen', 4, null],
      ['fox', 3, null],
    ];
    for (const [key, seed, rank] of entries) {
      await db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, final_rank)
         VALUES (?, ?, ?, FALSE, ?) RETURNING id`,
        [bracketId, teamIds[key], seed, rank],
      );
    }

    // Documentation: Ellen is unscored; Émile has no Cat B sub-score.
    const catIds: number[] = [];
    for (const [ordinal, name] of [CAT_A, CAT_B].entries()) {
      const cat = await db.run(
        `INSERT INTO documentation_categories (name, weight, max_score) VALUES (?, 1.0, 100) RETURNING id`,
        [name],
      );
      catIds.push(Number(cat.lastID));
      await db.run(
        `INSERT INTO event_documentation_categories (event_id, category_id, ordinal) VALUES (?, ?, ?) RETURNING id`,
        [eventId, Number(cat.lastID), ordinal + 1],
      );
    }
    const docs: [keyof typeof TEAMS, number, number | null][] = [
      ['zeta', 0.9, 50],
      ['emile', 0.7, null],
      ['fox', 0.5, 70],
    ];
    for (const [key, overall, catB] of docs) {
      const ds = await db.run(
        `INSERT INTO documentation_scores (event_id, team_id, overall_score, scored_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP) RETURNING id`,
        [eventId, teamIds[key], overall],
      );
      await db.run(
        `INSERT INTO documentation_sub_scores (documentation_score_id, category_id, score)
         VALUES (?, ?, 60) RETURNING id`,
        [Number(ds.lastID), catIds[0]],
      );
      if (catB !== null) {
        await db.run(
          `INSERT INTO documentation_sub_scores (documentation_score_id, category_id, score)
           VALUES (?, ?, ?) RETURNING id`,
          [Number(ds.lastID), catIds[1], catB],
        );
      }
    }
  });

  test.afterAll(async () => {
    const db = e2eDb();
    await db.run(
      'DELETE FROM documentation_sub_scores WHERE documentation_score_id IN (SELECT id FROM documentation_scores WHERE event_id = ?)',
      [eventId],
    );
    await db.run('DELETE FROM documentation_scores WHERE event_id = ?', [
      eventId,
    ]);
    await db.run(
      'DELETE FROM event_documentation_categories WHERE event_id = ?',
      [eventId],
    );
    await db.run('DELETE FROM documentation_categories WHERE name IN (?, ?)', [
      CAT_A,
      CAT_B,
    ]);
    await db.run(
      'DELETE FROM bracket_entries WHERE bracket_id IN (SELECT id FROM brackets WHERE event_id = ?)',
      [eventId],
    );
    await db.run('DELETE FROM brackets WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM teams WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM events WHERE id = ?', [eventId]);
    await closeE2eDb();
  });

  test('bracket rankings keep unranked teams last and tie-break by id', async ({
    page,
  }) => {
    await page.goto(
      `/spectator/events/${eventId}/brackets/${bracketId}?view=rankings`,
    );
    const table = tableWithSort(page, 'Sort by DE place');
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Default: place ascending; unranked last, by entry id (Ellen before fox).
    expect(await rowNames(table)).toEqual(['Émile', 'Zeta', 'Ellen', 'fox']);

    await sortButton(page, 'Sort by DE place').click();
    expect(await rowNames(table)).toEqual(['Zeta', 'Émile', 'Ellen', 'fox']);

    await sortButton(page, 'Sort by team name').click();
    expect(await rowNames(table)).toEqual(['Ellen', 'Émile', 'fox', 'Zeta']);

    await sortButton(page, 'Sort by team name').click();
    expect(await rowNames(table)).toEqual(['Zeta', 'fox', 'Émile', 'Ellen']);
  });

  test('overall starts on total descending and toggles', async ({ page }) => {
    await page.goto(`/spectator/events/${eventId}?view=overall`);
    const table = tableWithSort(page, 'Sort by total');
    await expect(table).toBeVisible({ timeout: 10_000 });

    expect(await rowNames(table)).toEqual(['Zeta', 'Émile', 'fox', 'Ellen']);

    await sortButton(page, 'Sort by total').click();
    expect(await rowNames(table)).toEqual(['Ellen', 'fox', 'Émile', 'Zeta']);

    // A newly selected column starts ascending.
    await sortButton(page, 'Sort by team name').click();
    expect(await rowNames(table)).toEqual(['Ellen', 'Émile', 'fox', 'Zeta']);
  });

  test('documentation keeps a missing category score last both ways', async ({
    page,
  }) => {
    await page.goto(`/spectator/events/${eventId}?view=documentation`);
    const table = tableWithSort(page, `Sort by ${CAT_B}`);
    await expect(table).toBeVisible({ timeout: 10_000 });

    await sortButton(page, `Sort by ${CAT_B}`).click();
    expect(await rowNames(table)).toEqual(['Zeta', 'fox', 'Émile']);

    await sortButton(page, `Sort by ${CAT_B}`).click();
    expect(await rowNames(table)).toEqual(['fox', 'Zeta', 'Émile']);
  });
});
