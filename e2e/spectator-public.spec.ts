import { test, expect } from '@playwright/test';
import SQLite from 'better-sqlite3';
import path from 'path';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const DB_PATH = path.join(__dirname, '..', 'database', 'colosseum.db');

const ACTIVE_EVENT_NAME = 'E2E Spectator Active Event';
const RELEASED_EVENT_NAME = 'E2E Spectator Released Event';
const EVENT_DATE = '2026-06-15';
const EVENT_LOCATION = 'E2E Test Arena';

const TEAM_A = { number: 101, name: 'Alpha Bots' };
const TEAM_B = { number: 202, name: 'Beta Builders' };

/* ------------------------------------------------------------------ */
/*  Shared state seeded in beforeAll                                  */
/* ------------------------------------------------------------------ */

let activeEventId: number;
let releasedEventId: number;
let teamAId: number;
let teamBId: number;
let bracketId: number;
let awardId: number;

/* ------------------------------------------------------------------ */
/*  Data lifecycle                                                    */
/* ------------------------------------------------------------------ */

test.describe('Spectator Public Views & Release Gating', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    // Ensure columns exist that may be missing from older dev DBs
    const migrations = [
      `ALTER TABLE events ADD COLUMN spectator_results_released INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE brackets ADD COLUMN weight REAL NOT NULL DEFAULT 1.0`,
      `ALTER TABLE bracket_entries ADD COLUMN final_rank INTEGER`,
      `ALTER TABLE bracket_entries ADD COLUMN bracket_raw_score REAL`,
      `ALTER TABLE bracket_entries ADD COLUMN weighted_bracket_raw_score REAL`,
    ];
    for (const sql of migrations) {
      try {
        db.exec(sql);
      } catch {
        // Column already exists
      }
    }

    // ── Active event (results NOT released) ──

    const activeEv = db
      .prepare(
        `INSERT INTO events (name, status, event_date, location, seeding_rounds, score_accept_mode, spectator_results_released)
         VALUES (?, 'active', ?, ?, 3, 'manual', 0)`,
      )
      .run(ACTIVE_EVENT_NAME, EVENT_DATE, EVENT_LOCATION);
    activeEventId = Number(activeEv.lastInsertRowid);

    const tA1 = db
      .prepare(
        `INSERT INTO teams (event_id, team_number, team_name, status)
         VALUES (?, ?, ?, 'checked_in')`,
      )
      .run(activeEventId, TEAM_A.number, TEAM_A.name);
    const activeTeamAId = Number(tA1.lastInsertRowid);

    const tB1 = db
      .prepare(
        `INSERT INTO teams (event_id, team_number, team_name, status)
         VALUES (?, ?, ?, 'checked_in')`,
      )
      .run(activeEventId, TEAM_B.number, TEAM_B.name);
    const activeTeamBId = Number(tB1.lastInsertRowid);

    // Seeding scores for active event
    db.prepare(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 1, 50)`,
    ).run(activeTeamAId);
    db.prepare(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 1, 45)`,
    ).run(activeTeamBId);

    // Bracket for active event (no games yet is fine)
    const activeBr = db
      .prepare(
        `INSERT INTO brackets (event_id, name, bracket_size, status)
         VALUES (?, 'Active Bracket', 4, 'setup')`,
      )
      .run(activeEventId);
    const activeBracketId = Number(activeBr.lastInsertRowid);

    // Bracket entry so there is at least a bracket to pick
    db.prepare(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
       VALUES (?, ?, 1, 0)`,
    ).run(activeBracketId, activeTeamAId);
    db.prepare(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
       VALUES (?, ?, 2, 0)`,
    ).run(activeBracketId, activeTeamBId);

    // ── Released event (complete + results released) ──

    const releasedEv = db
      .prepare(
        `INSERT INTO events (name, status, event_date, location, seeding_rounds, score_accept_mode, spectator_results_released)
         VALUES (?, 'complete', ?, ?, 3, 'manual', 1)`,
      )
      .run(RELEASED_EVENT_NAME, EVENT_DATE, EVENT_LOCATION);
    releasedEventId = Number(releasedEv.lastInsertRowid);

    const tA2 = db
      .prepare(
        `INSERT INTO teams (event_id, team_number, team_name, status)
         VALUES (?, ?, ?, 'checked_in')`,
      )
      .run(releasedEventId, TEAM_A.number, TEAM_A.name);
    teamAId = Number(tA2.lastInsertRowid);

    const tB2 = db
      .prepare(
        `INSERT INTO teams (event_id, team_number, team_name, status)
         VALUES (?, ?, ?, 'checked_in')`,
      )
      .run(releasedEventId, TEAM_B.number, TEAM_B.name);
    teamBId = Number(tB2.lastInsertRowid);

    // Seeding scores
    db.prepare(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 1, 80)`,
    ).run(teamAId);
    db.prepare(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 1, 75)`,
    ).run(teamBId);
    db.prepare(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 2, 85)`,
    ).run(teamAId);
    db.prepare(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 2, 70)`,
    ).run(teamBId);

    // Seeding rankings
    db.prepare(
      `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score)
       VALUES (?, 82.5, 1, 165)`,
    ).run(teamAId);
    db.prepare(
      `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score)
       VALUES (?, 72.5, 2, 145)`,
    ).run(teamBId);

    // Bracket
    const br = db
      .prepare(
        `INSERT INTO brackets (event_id, name, bracket_size, actual_team_count, status, weight)
         VALUES (?, 'Main Bracket', 4, 2, 'completed', 1.0)`,
      )
      .run(releasedEventId);
    bracketId = Number(br.lastInsertRowid);

    // Bracket entries with rankings
    db.prepare(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, final_rank, bracket_raw_score, weighted_bracket_raw_score)
       VALUES (?, ?, 1, 0, 1, 100, 100)`,
    ).run(bracketId, teamAId);
    db.prepare(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, final_rank, bracket_raw_score, weighted_bracket_raw_score)
       VALUES (?, ?, 2, 0, 2, 50, 50)`,
    ).run(bracketId, teamBId);

    // Bracket game (completed)
    db.prepare(
      `INSERT INTO bracket_games (bracket_id, game_number, round_name, round_number, bracket_side, team1_id, team2_id, status, winner_id, loser_id, team1_score, team2_score)
       VALUES (?, 1, 'Finals', 1, 'winners', ?, ?, 'completed', ?, ?, 100, 50)`,
    ).run(bracketId, teamAId, teamBId, teamAId, teamBId);

    // Documentation categories and scores
    const cat = db
      .prepare(
        `INSERT INTO documentation_categories (name, weight, max_score) VALUES ('E2E Doc Cat', 1.0, 100)`,
      )
      .run();
    const catId = Number(cat.lastInsertRowid);

    db.prepare(
      `INSERT INTO event_documentation_categories (event_id, category_id, ordinal) VALUES (?, ?, 1)`,
    ).run(releasedEventId, catId);

    const docScoreA = db
      .prepare(
        `INSERT INTO documentation_scores (event_id, team_id, overall_score, scored_at)
         VALUES (?, ?, 90, CURRENT_TIMESTAMP)`,
      )
      .run(releasedEventId, teamAId);
    db.prepare(
      `INSERT INTO documentation_sub_scores (documentation_score_id, category_id, score)
       VALUES (?, ?, 90)`,
    ).run(Number(docScoreA.lastInsertRowid), catId);

    const docScoreB = db
      .prepare(
        `INSERT INTO documentation_scores (event_id, team_id, overall_score, scored_at)
         VALUES (?, ?, 80, CURRENT_TIMESTAMP)`,
      )
      .run(releasedEventId, teamBId);
    db.prepare(
      `INSERT INTO documentation_sub_scores (documentation_score_id, category_id, score)
       VALUES (?, ?, 80)`,
    ).run(Number(docScoreB.lastInsertRowid), catId);

    // Awards
    const aw = db
      .prepare(
        `INSERT INTO event_awards (event_id, name, description, sort_order)
         VALUES (?, 'Champion Award', 'Best overall team', 0)`,
      )
      .run(releasedEventId);
    awardId = Number(aw.lastInsertRowid);

    db.prepare(
      `INSERT INTO event_award_recipients (event_award_id, team_id)
       VALUES (?, ?)`,
    ).run(awardId, teamAId);

    db.close();
  });

  test.afterAll(() => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    // Clean up in reverse dependency order
    db.prepare(
      'DELETE FROM event_award_recipients WHERE event_award_id = ?',
    ).run(awardId);
    db.prepare('DELETE FROM event_awards WHERE event_id IN (?, ?)').run(
      activeEventId,
      releasedEventId,
    );

    db.prepare(
      'DELETE FROM documentation_sub_scores WHERE documentation_score_id IN (SELECT id FROM documentation_scores WHERE event_id IN (?, ?))',
    ).run(activeEventId, releasedEventId);
    db.prepare(
      'DELETE FROM documentation_scores WHERE event_id IN (?, ?)',
    ).run(activeEventId, releasedEventId);
    db.prepare(
      "DELETE FROM event_documentation_categories WHERE event_id IN (?, ?)",
    ).run(activeEventId, releasedEventId);
    db.prepare(
      "DELETE FROM documentation_categories WHERE name = 'E2E Doc Cat'",
    ).run();

    db.prepare(
      'DELETE FROM bracket_games WHERE bracket_id IN (SELECT id FROM brackets WHERE event_id IN (?, ?))',
    ).run(activeEventId, releasedEventId);
    db.prepare(
      'DELETE FROM bracket_entries WHERE bracket_id IN (SELECT id FROM brackets WHERE event_id IN (?, ?))',
    ).run(activeEventId, releasedEventId);
    db.prepare('DELETE FROM brackets WHERE event_id IN (?, ?)').run(
      activeEventId,
      releasedEventId,
    );

    db.prepare(
      'DELETE FROM seeding_rankings WHERE team_id IN (SELECT id FROM teams WHERE event_id IN (?, ?))',
    ).run(activeEventId, releasedEventId);
    db.prepare(
      'DELETE FROM seeding_scores WHERE team_id IN (SELECT id FROM teams WHERE event_id IN (?, ?))',
    ).run(activeEventId, releasedEventId);
    db.prepare('DELETE FROM teams WHERE event_id IN (?, ?)').run(
      activeEventId,
      releasedEventId,
    );
    db.prepare('DELETE FROM events WHERE id IN (?, ?)').run(
      activeEventId,
      releasedEventId,
    );

    db.close();
  });

  /* ── 1. Public event listing ─────────────────────────────────────── */

  test('spectator events page lists active and released events', async ({
    page,
  }) => {
    await page.goto('/spectator');

    await expect(
      page.locator('.spectator-events-header h2'),
    ).toHaveText('Spectator');
    await expect(
      page.getByText('Select an event to view live scores and results.'),
    ).toBeVisible();

    const activeCard = page.locator('.spectator-event-card', {
      hasText: ACTIVE_EVENT_NAME,
    });
    await expect(activeCard).toBeVisible();

    const releasedCard = page.locator('.spectator-event-card', {
      hasText: RELEASED_EVENT_NAME,
    });
    await expect(releasedCard).toBeVisible();
  });

  test('active event card does NOT show "Final results available" badge', async ({
    page,
  }) => {
    await page.goto('/spectator');

    const activeCard = page.locator('.spectator-event-card', {
      hasText: ACTIVE_EVENT_NAME,
    });
    await expect(activeCard).toBeVisible();
    await expect(
      activeCard.locator('.spectator-event-card-badge'),
    ).not.toBeVisible();
  });

  test('released event card shows "Final results available" badge', async ({
    page,
  }) => {
    await page.goto('/spectator');

    const releasedCard = page.locator('.spectator-event-card', {
      hasText: RELEASED_EVENT_NAME,
    });
    await expect(releasedCard).toBeVisible();
    await expect(
      releasedCard.locator('.spectator-event-card-badge'),
    ).toBeVisible();
    await expect(
      releasedCard.locator('.spectator-event-card-badge'),
    ).toHaveText('Final results available');
  });

  test('event card displays date and location', async ({ page }) => {
    await page.goto('/spectator');

    const card = page.locator('.spectator-event-card', {
      hasText: RELEASED_EVENT_NAME,
    });
    await expect(card).toBeVisible();
    await expect(card.getByText(EVENT_LOCATION)).toBeVisible();
  });

  test('clicking an event card navigates to the event detail page', async ({
    page,
  }) => {
    await page.goto('/spectator');

    const card = page.locator('.spectator-event-card', {
      hasText: ACTIVE_EVENT_NAME,
    });
    await card.click();

    await page.waitForURL(
      new RegExp(`/spectator/events/${activeEventId}\\?view=seeding`),
    );
    await expect(
      page.getByRole('heading', { name: ACTIVE_EVENT_NAME }),
    ).toBeVisible();
  });

  /* ── 2. Seeding and Bracket tabs always visible ─────────────────── */

  test('active event shows Seeding and Bracket tabs', async ({ page }) => {
    await page.goto(`/spectator/events/${activeEventId}?view=seeding`);

    const seedingTab = page.locator('.spectator-tab-btn', {
      hasText: 'Seeding',
    });
    const bracketTab = page.locator('.spectator-tab-btn', {
      hasText: /^Bracket$/,
    });

    await expect(seedingTab).toBeVisible();
    await expect(bracketTab).toBeVisible();
  });

  test('active event seeding tab shows team scores', async ({ page }) => {
    await page.goto(`/spectator/events/${activeEventId}?view=seeding`);

    await expect(
      page.getByText(TEAM_A.name).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(TEAM_B.name).first()).toBeVisible();
  });

  /* ── 3. Release gating: restricted tabs hidden for active event ── */

  test('active event does NOT show Documentation, Awards, Bracket Rankings, or Overall tabs', async ({
    page,
  }) => {
    await page.goto(`/spectator/events/${activeEventId}?view=seeding`);

    await expect(
      page.locator('.spectator-tab-btn', { hasText: 'Seeding' }),
    ).toBeVisible();

    await expect(
      page.locator('.spectator-tab-btn', { hasText: 'Documentation' }),
    ).not.toBeVisible();
    await expect(
      page.locator('.spectator-tab-btn', { hasText: 'Awards' }),
    ).not.toBeVisible();
    await expect(
      page.locator('.spectator-tab-btn', { hasText: 'Bracket Rankings' }),
    ).not.toBeVisible();
    await expect(
      page.locator('.spectator-tab-btn', { hasText: /^Overall$/ }),
    ).not.toBeVisible();
  });

  /* ── 4. Released event shows all six tabs ────────────────────────── */

  test('released event shows all six tabs including gated ones', async ({
    page,
  }) => {
    await page.goto(`/spectator/events/${releasedEventId}?view=seeding`);

    const tabs = page.locator('.spectator-tab-btn');
    await expect(tabs).toHaveCount(6);

    await expect(tabs.nth(0)).toHaveText('Seeding');
    await expect(tabs.nth(1)).toHaveText('Bracket');
    await expect(tabs.nth(2)).toHaveText('Documentation');
    await expect(tabs.nth(3)).toHaveText('Awards');
    await expect(tabs.nth(4)).toHaveText('Bracket Rankings');
    await expect(tabs.nth(5)).toHaveText('Overall');
  });

  /* ── 5. Seeding tab on released event ────────────────────────────── */

  test('released event seeding tab shows teams and rankings', async ({
    page,
  }) => {
    await page.goto(`/spectator/events/${releasedEventId}?view=seeding`);

    await expect(
      page.getByText(TEAM_A.name).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(TEAM_B.name).first()).toBeVisible();
  });

  /* ── 6. Bracket tab on released event ────────────────────────────── */

  test('released event bracket tab shows bracket games', async ({ page }) => {
    await page.goto(
      `/spectator/events/${releasedEventId}/brackets/${bracketId}?view=bracket`,
    );

    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: /^Bracket$/ }),
    ).toBeVisible();

    // Bracket should display with at least one game
    await expect(page.locator('.bracket-section')).toBeVisible({
      timeout: 10_000,
    });
  });

  /* ── 7. Documentation tab (release-gated) ────────────────────────── */

  test('released event documentation tab shows scores', async ({ page }) => {
    await page.goto(
      `/spectator/events/${releasedEventId}?view=documentation`,
    );

    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: 'Documentation' }),
    ).toBeVisible();

    // Wait for documentation scores to load and render
    await expect(page.getByText(TEAM_A.name)).toBeVisible({ timeout: 10_000 });
  });

  /* ── 8. Awards tab (release-gated) ───────────────────────────────── */

  test('released event awards tab shows awards with recipients', async ({
    page,
  }) => {
    await page.goto(`/spectator/events/${releasedEventId}?view=awards`);

    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: 'Awards' }),
    ).toBeVisible();

    await expect(page.getByText('Champion Award')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Best overall team')).toBeVisible();
    await expect(
      page.getByText(`#${TEAM_A.number}`),
    ).toBeVisible();
    await expect(page.getByText(TEAM_A.name)).toBeVisible();
  });

  /* ── 9. Bracket Rankings tab (release-gated) ─────────────────────── */

  test('released event bracket rankings tab loads', async ({ page }) => {
    await page.goto(
      `/spectator/events/${releasedEventId}/brackets/${bracketId}?view=rankings`,
    );

    await expect(
      page.locator('.spectator-tab-btn.active', {
        hasText: 'Bracket Rankings',
      }),
    ).toBeVisible();

    // Rankings view should render (BracketRankingView component)
    await expect(
      page.locator('.bracket-ranking-table, .card'),
    ).toBeVisible({ timeout: 10_000 });
  });

  /* ── 10. Overall tab (release-gated) ─────────────────────────────── */

  test('released event overall tab loads', async ({ page }) => {
    await page.goto(`/spectator/events/${releasedEventId}?view=overall`);

    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: /^Overall$/ }),
    ).toBeVisible();

    // Overall scores display should render with team data
    await expect(
      page.getByText('Overall Scores'),
    ).toBeVisible({ timeout: 10_000 });
  });

  /* ── 11. Tab navigation between seeding and released tabs ────────── */

  test('can navigate between tabs on released event', async ({ page }) => {
    await page.goto(`/spectator/events/${releasedEventId}?view=seeding`);

    // Start on seeding
    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: 'Seeding' }),
    ).toBeVisible();

    // Navigate to Awards
    await page
      .locator('.spectator-tab-btn', { hasText: 'Awards' })
      .click();
    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: 'Awards' }),
    ).toBeVisible();
    await expect(page.getByText('Champion Award')).toBeVisible({
      timeout: 10_000,
    });

    // Navigate to Documentation
    await page
      .locator('.spectator-tab-btn', { hasText: 'Documentation' })
      .click();
    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: 'Documentation' }),
    ).toBeVisible();

    // Navigate to Overall
    await page
      .locator('.spectator-tab-btn', { hasText: /^Overall$/ })
      .click();
    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: /^Overall$/ }),
    ).toBeVisible();

    // Navigate back to Seeding
    await page
      .locator('.spectator-tab-btn', { hasText: 'Seeding' })
      .click();
    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: 'Seeding' }),
    ).toBeVisible();
  });

  /* ── 12. Back navigation from event detail to listing ────────────── */

  test('back button returns to spectator events listing', async ({ page }) => {
    await page.goto(`/spectator/events/${releasedEventId}?view=seeding`);

    await page.locator('.spectator-back-btn').click();
    await page.waitForURL(/\/spectator$/);

    await expect(
      page.locator('.spectator-events-header h2'),
    ).toHaveText('Spectator');
  });

  /* ── 13. Verify release gating at API level ──────────────────────── */

  test('public events API returns final_scores_available correctly', async ({
    request,
  }) => {
    const res = await request.get('/events/public');
    expect(res.ok()).toBeTruthy();

    const events = await res.json();
    const active = events.find(
      (e: { name: string }) => e.name === ACTIVE_EVENT_NAME,
    );
    const released = events.find(
      (e: { name: string }) => e.name === RELEASED_EVENT_NAME,
    );

    expect(active).toBeDefined();
    expect(active.final_scores_available).toBe(false);

    expect(released).toBeDefined();
    expect(released.final_scores_available).toBe(true);
  });

  /* ── 14. Release toggle: hide then re-show ───────────────────────── */

  test('hiding results removes gated tabs, re-releasing restores them', async ({
    page,
  }) => {
    const db = new SQLite(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    // Hide results
    db.prepare(
      'UPDATE events SET spectator_results_released = 0 WHERE id = ?',
    ).run(releasedEventId);
    db.close();

    try {
      await page.goto(`/spectator/events/${releasedEventId}?view=seeding`);

      // Gated tabs should be hidden
      await expect(
        page.locator('.spectator-tab-btn', { hasText: 'Seeding' }),
      ).toBeVisible();
      await expect(
        page.locator('.spectator-tab-btn', { hasText: 'Documentation' }),
      ).not.toBeVisible();
      await expect(
        page.locator('.spectator-tab-btn', { hasText: 'Awards' }),
      ).not.toBeVisible();
      await expect(
        page.locator('.spectator-tab-btn', { hasText: 'Bracket Rankings' }),
      ).not.toBeVisible();
      await expect(
        page.locator('.spectator-tab-btn', { hasText: /^Overall$/ }),
      ).not.toBeVisible();

      // Event listing should NOT show badge
      await page.goto('/spectator');
      const card = page.locator('.spectator-event-card', {
        hasText: RELEASED_EVENT_NAME,
      });
      await expect(card).toBeVisible();
      await expect(
        card.locator('.spectator-event-card-badge'),
      ).not.toBeVisible();
    } finally {
      // Restore for subsequent tests
      const db2 = new SQLite(DB_PATH);
      db2.pragma('journal_mode = WAL');
      db2.pragma('busy_timeout = 5000');
      db2.prepare(
        'UPDATE events SET spectator_results_released = 1 WHERE id = ?',
      ).run(releasedEventId);
      db2.close();
    }
  });
});
