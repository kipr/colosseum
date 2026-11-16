import { test, expect, type Page } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

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
let individualOnlyAwardId: number;

/* ------------------------------------------------------------------ */
/*  Data lifecycle                                                    */
/* ------------------------------------------------------------------ */

test.describe('Spectator Public Views & Release Gating', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const db = e2eDb();

    // ── Active event (results NOT released) ──

    const activeEv = await db.run(
      `INSERT INTO events (name, status, event_date, location, seeding_rounds, score_accept_mode, spectator_results_released)
       VALUES (?, 'active', ?, ?, 3, 'manual', 0) RETURNING id`,
      [ACTIVE_EVENT_NAME, EVENT_DATE, EVENT_LOCATION],
    );
    activeEventId = Number(activeEv.lastID);

    const tA1 = await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, status)
       VALUES (?, ?, ?, 'checked_in') RETURNING id`,
      [activeEventId, TEAM_A.number, TEAM_A.name],
    );
    const activeTeamAId = Number(tA1.lastID);

    const tB1 = await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, status)
       VALUES (?, ?, ?, 'checked_in') RETURNING id`,
      [activeEventId, TEAM_B.number, TEAM_B.name],
    );
    const activeTeamBId = Number(tB1.lastID);

    // Seeding scores for active event
    await db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 1, 50) RETURNING id`,
      [activeTeamAId],
    );
    await db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 1, 45) RETURNING id`,
      [activeTeamBId],
    );

    // Bracket for active event (no games yet is fine)
    const activeBr = await db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status)
       VALUES (?, 'Active Bracket', 4, 'setup') RETURNING id`,
      [activeEventId],
    );
    const activeBracketId = Number(activeBr.lastID);

    // Bracket entry so there is at least a bracket to pick
    await db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
       VALUES (?, ?, 1, FALSE) RETURNING id`,
      [activeBracketId, activeTeamAId],
    );
    await db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
       VALUES (?, ?, 2, FALSE) RETURNING id`,
      [activeBracketId, activeTeamBId],
    );

    // ── Released event (complete + results released) ──

    const releasedEv = await db.run(
      `INSERT INTO events (name, status, event_date, location, seeding_rounds, score_accept_mode, spectator_results_released)
       VALUES (?, 'complete', ?, ?, 3, 'manual', 1) RETURNING id`,
      [RELEASED_EVENT_NAME, EVENT_DATE, EVENT_LOCATION],
    );
    releasedEventId = Number(releasedEv.lastID);

    const tA2 = await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, status)
       VALUES (?, ?, ?, 'checked_in') RETURNING id`,
      [releasedEventId, TEAM_A.number, TEAM_A.name],
    );
    teamAId = Number(tA2.lastID);

    const tB2 = await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, status)
       VALUES (?, ?, ?, 'checked_in') RETURNING id`,
      [releasedEventId, TEAM_B.number, TEAM_B.name],
    );
    teamBId = Number(tB2.lastID);

    // Seeding scores
    await db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 1, 80) RETURNING id`,
      [teamAId],
    );
    await db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 1, 75) RETURNING id`,
      [teamBId],
    );
    await db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 2, 85) RETURNING id`,
      [teamAId],
    );
    await db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score) VALUES (?, 2, 70) RETURNING id`,
      [teamBId],
    );

    // Seeding rankings
    await db.run(
      `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score)
       VALUES (?, 82.5, 1, 165) RETURNING id`,
      [teamAId],
    );
    await db.run(
      `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score)
       VALUES (?, 72.5, 2, 145) RETURNING id`,
      [teamBId],
    );

    // Bracket
    const br = await db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, actual_team_count, status, weight)
       VALUES (?, 'Main Bracket', 4, 2, 'completed', 1.0) RETURNING id`,
      [releasedEventId],
    );
    bracketId = Number(br.lastID);

    // Bracket entries with rankings
    await db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, final_rank, bracket_raw_score, weighted_bracket_raw_score)
       VALUES (?, ?, 1, FALSE, 1, 100, 100) RETURNING id`,
      [bracketId, teamAId],
    );
    await db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye, final_rank, bracket_raw_score, weighted_bracket_raw_score)
       VALUES (?, ?, 2, FALSE, 2, 50, 50) RETURNING id`,
      [bracketId, teamBId],
    );

    // Bracket game (completed)
    await db.run(
      `INSERT INTO bracket_games (bracket_id, game_number, round_name, round_number, bracket_side, team1_id, team2_id, status, winner_id, loser_id, team1_score, team2_score)
       VALUES (?, 1, 'Finals', 1, 'winners', ?, ?, 'completed', ?, ?, 100, 50) RETURNING id`,
      [bracketId, teamAId, teamBId, teamAId, teamBId],
    );

    // Documentation categories and scores
    const cat = await db.run(
      `INSERT INTO documentation_categories (name, weight, max_score) VALUES ('E2E Doc Cat', 1.0, 100) RETURNING id`,
    );
    const catId = Number(cat.lastID);

    await db.run(
      `INSERT INTO event_documentation_categories (event_id, category_id, ordinal) VALUES (?, ?, 1) RETURNING id`,
      [releasedEventId, catId],
    );

    const docScoreA = await db.run(
      `INSERT INTO documentation_scores (event_id, team_id, overall_score, scored_at)
       VALUES (?, ?, 90, CURRENT_TIMESTAMP) RETURNING id`,
      [releasedEventId, teamAId],
    );
    await db.run(
      `INSERT INTO documentation_sub_scores (documentation_score_id, category_id, score)
       VALUES (?, ?, 90) RETURNING id`,
      [Number(docScoreA.lastID), catId],
    );

    const docScoreB = await db.run(
      `INSERT INTO documentation_scores (event_id, team_id, overall_score, scored_at)
       VALUES (?, ?, 80, CURRENT_TIMESTAMP) RETURNING id`,
      [releasedEventId, teamBId],
    );
    await db.run(
      `INSERT INTO documentation_sub_scores (documentation_score_id, category_id, score)
       VALUES (?, ?, 80) RETURNING id`,
      [Number(docScoreB.lastID), catId],
    );

    // Awards
    const aw = await db.run(
      `INSERT INTO event_awards (event_id, name, description, sort_order)
       VALUES (?, 'Champion Award', 'Best overall team', 0) RETURNING id`,
      [releasedEventId],
    );
    awardId = Number(aw.lastID);

    await db.run(
      `INSERT INTO event_award_recipients (event_award_id, team_id)
       VALUES (?, ?) RETURNING id`,
      [awardId, teamAId],
    );
    await db.run(
      `INSERT INTO event_award_individual_recipients (event_award_id, name, team_id)
       VALUES (?, 'Ada Lovelace', ?) RETURNING id`,
      [awardId, teamAId],
    );

    const individualAward = await db.run(
      `INSERT INTO event_awards (event_id, name, description, sort_order)
       VALUES (?, 'Volunteer Award', 'Outstanding volunteer', 1) RETURNING id`,
      [releasedEventId],
    );
    individualOnlyAwardId = Number(individualAward.lastID);
    await db.run(
      `INSERT INTO event_award_individual_recipients (event_award_id, name, team_id)
       VALUES (?, 'Grace Hopper', NULL) RETURNING id`,
      [individualOnlyAwardId],
    );
  });

  test.afterAll(async () => {
    const db = e2eDb();

    // Clean up in reverse dependency order
    await db.run(
      'DELETE FROM event_award_individual_recipients WHERE event_award_id IN (?, ?)',
      [awardId, individualOnlyAwardId],
    );
    await db.run(
      'DELETE FROM event_award_recipients WHERE event_award_id = ?',
      [awardId],
    );
    await db.run('DELETE FROM event_awards WHERE event_id IN (?, ?)', [
      activeEventId,
      releasedEventId,
    ]);

    await db.run(
      'DELETE FROM documentation_sub_scores WHERE documentation_score_id IN (SELECT id FROM documentation_scores WHERE event_id IN (?, ?))',
      [activeEventId, releasedEventId],
    );
    await db.run('DELETE FROM documentation_scores WHERE event_id IN (?, ?)', [
      activeEventId,
      releasedEventId,
    ]);
    await db.run(
      'DELETE FROM event_documentation_categories WHERE event_id IN (?, ?)',
      [activeEventId, releasedEventId],
    );
    await db.run(
      "DELETE FROM documentation_categories WHERE name = 'E2E Doc Cat'",
    );

    await db.run(
      'DELETE FROM bracket_games WHERE bracket_id IN (SELECT id FROM brackets WHERE event_id IN (?, ?))',
      [activeEventId, releasedEventId],
    );
    await db.run(
      'DELETE FROM bracket_entries WHERE bracket_id IN (SELECT id FROM brackets WHERE event_id IN (?, ?))',
      [activeEventId, releasedEventId],
    );
    await db.run('DELETE FROM brackets WHERE event_id IN (?, ?)', [
      activeEventId,
      releasedEventId,
    ]);

    await db.run(
      'DELETE FROM seeding_rankings WHERE team_id IN (SELECT id FROM teams WHERE event_id IN (?, ?))',
      [activeEventId, releasedEventId],
    );
    await db.run(
      'DELETE FROM seeding_scores WHERE team_id IN (SELECT id FROM teams WHERE event_id IN (?, ?))',
      [activeEventId, releasedEventId],
    );
    await db.run('DELETE FROM teams WHERE event_id IN (?, ?)', [
      activeEventId,
      releasedEventId,
    ]);
    await db.run('DELETE FROM events WHERE id IN (?, ?)', [
      activeEventId,
      releasedEventId,
    ]);

    await closeE2eDb();
  });

  /* ── 1. Public event listing ─────────────────────────────────────── */

  test('spectator events page lists active and released events', async ({
    page,
  }) => {
    await page.goto('/spectator');

    await expect(page.locator('.spectator-events-header h2')).toHaveText(
      'Spectator',
    );
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

  test('navbar Colosseum title does not navigate away from spectator listing', async ({
    page,
  }) => {
    await page.goto('/spectator');

    // Spectator mode renders the brand as static text instead of a home link
    await expect(
      page.locator('.nav-brand .brand-link--spectator'),
    ).toBeVisible();
    await expect(page.locator('.nav-brand a.brand-link')).toHaveCount(0);
    await expect(page).toHaveURL(/\/spectator$/);
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

  test('navbar Colosseum title does not navigate away from spectator event view', async ({
    page,
  }) => {
    await page.goto(`/spectator/events/${activeEventId}?view=seeding`);

    // Spectator event pages also render the brand as static text
    await expect(
      page.locator('.nav-brand .brand-link--spectator'),
    ).toBeVisible();
    await expect(page.locator('.nav-brand a.brand-link')).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`/spectator/events/${activeEventId}`),
    );
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

    await expect(page.getByText(TEAM_A.name).first()).toBeVisible({
      timeout: 10_000,
    });
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

    await expect(page.getByText(TEAM_A.name).first()).toBeVisible({
      timeout: 10_000,
    });
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
    await page.goto(`/spectator/events/${releasedEventId}?view=documentation`);

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

    await expect(
      page.locator('.spectator-awards-section-title', {
        hasText: 'Double elimination',
      }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('.spectator-awards-section-title', {
        hasText: 'Per-bracket overall',
      }),
    ).toHaveCount(0);
    await expect(
      page.locator('.spectator-awards-section-title', {
        hasText: 'Seeding',
      }),
    ).toBeVisible();
    await expect(page.getByText('Other awards')).toBeVisible();
    const championAward = page
      .locator('.spectator-manual-award')
      .filter({ hasText: 'Champion Award' })
      .filter({ hasText: 'Best overall team' })
      .first();
    await expect(championAward).toBeVisible();
    await expect(
      championAward.getByText(`#${TEAM_A.number}`).first(),
    ).toBeVisible();
    await expect(championAward.getByText(TEAM_A.name).first()).toBeVisible();
    await expect(championAward.getByText('Ada Lovelace')).toBeVisible();
    await expect(
      championAward.getByText(`· #${TEAM_A.number} ${TEAM_A.name}`),
    ).toBeVisible();

    const volunteerAward = page
      .locator('.spectator-manual-award')
      .filter({ hasText: 'Volunteer Award' })
      .first();
    await expect(volunteerAward).toBeVisible();
    await expect(volunteerAward.getByText('Grace Hopper')).toBeVisible();
    await expect(volunteerAward.getByText('No recipients')).toHaveCount(0);
    await expect(volunteerAward.locator('text=/\\bid\\b/i')).toHaveCount(0);
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

    await expect(page.locator('.seeding-unified-table')).toBeVisible({
      timeout: 10_000,
    });
  });

  /* ── 10. Overall tab (release-gated) ─────────────────────────────── */

  test('released event overall tab loads', async ({ page }) => {
    await page.goto(`/spectator/events/${releasedEventId}?view=overall`);

    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: /^Overall$/ }),
    ).toBeVisible();

    // Overall scores display should render with team data
    await expect(page.getByText('Overall Scores')).toBeVisible({
      timeout: 10_000,
    });
  });

  /* ── 11. Tab navigation between seeding and released tabs ────────── */

  test('can navigate between tabs on released event', async ({ page }) => {
    await page.goto(`/spectator/events/${releasedEventId}?view=seeding`);

    // Start on seeding
    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: 'Seeding' }),
    ).toBeVisible();

    // Navigate to Awards
    await page.locator('.spectator-tab-btn', { hasText: 'Awards' }).click();
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
    await page.locator('.spectator-tab-btn', { hasText: /^Overall$/ }).click();
    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: /^Overall$/ }),
    ).toBeVisible();

    // Navigate back to Seeding
    await page.locator('.spectator-tab-btn', { hasText: 'Seeding' }).click();
    await expect(
      page.locator('.spectator-tab-btn.active', { hasText: 'Seeding' }),
    ).toBeVisible();
  });

  /* ── 12. Back navigation from event detail to listing ────────────── */

  test('back button returns to spectator events listing', async ({ page }) => {
    await page.goto(`/spectator/events/${releasedEventId}?view=seeding`);

    await page.locator('.spectator-back-btn').click();
    await page.waitForURL(/\/spectator$/);

    await expect(page.locator('.spectator-events-header h2')).toHaveText(
      'Spectator',
    );
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
    // Hide results
    await e2eDb().run(
      'UPDATE events SET spectator_results_released = 0 WHERE id = ?',
      [releasedEventId],
    );

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
      await e2eDb().run(
        'UPDATE events SET spectator_results_released = 1 WHERE id = ?',
        [releasedEventId],
      );
    }
  });
});

type Listing = 'current' | 'archive';
type ListingSeason = { id: number; name: string; sortOrder: number };
type ListingEvent = {
  id: number;
  name: string;
  status: 'setup' | 'active' | 'complete' | 'archived';
  event_date: string | null;
  location: string | null;
  seeding_rounds: number;
  double_seeding_rounds: number;
  spectator_listing: Listing;
  season_id: number | null;
  season_name: string | null;
  season_sort_order: number | null;
  final_scores_available: boolean;
};
type ArchiveGroup = { season: ListingSeason; events: ListingEvent[] };

function deferredListingResponse() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function expectListingShell(page: Page, listing: Listing) {
  await expect(
    page.getByRole('heading', { level: 1, name: /Colosseum/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('heading', { level: 2 }),
  ).toHaveText(listing === 'archive' ? 'Spectator Archive' : 'Spectator');
  const nav = page.getByRole('navigation', { name: 'Spectator listings' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(2);
  for (const [value, label, href] of [
    ['current', 'Current Events', '/spectator'],
    ['archive', 'Archive', '/spectator/archive'],
  ]) {
    const link = nav.getByRole('link', { name: label, exact: true });
    await expect(link).toHaveAttribute('href', href);
    if (listing === value) {
      await expect(link).toHaveAttribute('aria-current', 'page');
    } else {
      await expect(link).not.toHaveAttribute('aria-current', 'page');
    }
  }
  await expect(page.getByRole('main').getByRole('combobox')).toHaveCount(0);
}

async function expectListingCards(
  page: Page,
  events: ListingEvent[],
  headingLevel: 3 | 4,
) {
  const cards = page.getByRole('main').locator('.spectator-event-card');
  await expect(cards).toHaveCount(events.length);
  for (const [index, event] of events.entries()) {
    const card = cards.nth(index);
    await expect(card).toHaveRole('link');
    await expect(card).toHaveAttribute(
      'href',
      `/spectator/events/${event.id}?view=seeding`,
    );
    await expect(card.getByRole('heading', { level: headingLevel })).toHaveText(
      event.name,
    );
    await expect(card).toHaveAccessibleName(
      new RegExp(event.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    const badge = card.locator('.spectator-event-card-badge');
    await expect(badge).toHaveCount(event.final_scores_available ? 1 : 0);
    if (event.final_scores_available) {
      await expect(badge).toHaveText('Final results available');
    }
    await expect(card.locator('.spectator-event-card-detail')).toHaveCount(
      Number(Boolean(event.event_date)) + Number(Boolean(event.location)),
    );
    if (event.event_date === EVENT_DATE) {
      await expect(card).toContainText('Jun 15, 2026');
    }
    if (event.location) await expect(card).toContainText(event.location);
  }
}

async function expectArchiveGroups(page: Page, groups: ArchiveGroup[]) {
  const sections = page.locator('section.spectator-archive-season');
  await expect(sections).toHaveCount(groups.length);
  await expect(sections.getByRole('heading', { level: 3 })).toHaveText(
    groups.map(({ season }) => season.name),
  );
  for (const [index, group] of groups.entries()) {
    const section = sections.nth(index);
    const heading = section.getByRole('heading', { level: 3 });
    await expect(heading).toHaveAttribute('id', /.+/);
    await expect(section).toHaveAttribute(
      'aria-labelledby',
      (await heading.getAttribute('id'))!,
    );
    await expect(section.getByRole('heading', { level: 4 })).toHaveText(
      group.events.map((event) => event.name),
    );
  }
  const headingIds = await sections
    .getByRole('heading', { level: 3 })
    .evaluateAll((headings) => headings.map((heading) => heading.id));
  expect(new Set(headingIds).size).toBe(groups.length);
  await expectListingCards(
    page,
    groups.flatMap((group) => group.events),
    4,
  );
}

test.describe('Spectator archive listings (step 4)', () => {
  // Playwright creates a fresh anonymous context for every test; no admin shim.
  test.use({ storageState: { cookies: [], origins: [] } });

  const seasons: ListingSeason[] = [];
  const seededEvents: ListingEvent[] = [];
  let archiveGroups: ArchiveGroup[];
  let currentEvents: ListingEvent[];
  let publicRequests: string[];
  let seasonCatalogRequests: string[];

  test.beforeAll(async () => {
    const db = e2eDb();
    async function season(name: string, sortOrder: number) {
      const inserted = await db.run(
        'INSERT INTO seasons (name, sort_order) VALUES (?, ?) RETURNING id',
        [name, sortOrder],
      );
      const row = { id: Number(inserted.lastID), name, sortOrder };
      seasons.push(row);
      return row;
    }
    async function event(
      name: string,
      assignedSeason: ListingSeason | null,
      options: {
        status?: ListingEvent['status'];
        listing?: Listing;
        date?: string | null;
        location?: string | null;
        released?: boolean;
      } = {},
    ) {
      const {
        status = 'active',
        listing = 'archive',
        date = EVENT_DATE,
        location = EVENT_LOCATION,
        released = false,
      } = options;
      const inserted = await db.run(
        `INSERT INTO events (name, status, spectator_listing, season_id,
          event_date, location, spectator_results_released)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          name,
          status,
          listing,
          assignedSeason?.id ?? null,
          date,
          location,
          Number(released),
        ],
      );
      const row: ListingEvent = {
        id: Number(inserted.lastID),
        name,
        status,
        event_date: date,
        location,
        seeding_rounds: 3,
        double_seeding_rounds: 0,
        spectator_listing: listing,
        season_id: assignedSeason?.id ?? null,
        season_name: assignedSeason?.name ?? null,
        season_sort_order: assignedSeason?.sortOrder ?? null,
        final_scores_available: status === 'complete' && released,
      };
      seededEvents.push(row);
      return row;
    }

    // Names, dates and insertion order deliberately disagree with season priority.
    const low = await season(`2099 E2E ${'長期Season'.repeat(10)}`, -20);
    const high = await season(
      '1998 E2E 高優先 <script>archiveSentinel()</script>',
      80,
    );
    const tieOlder = await season('E2E Zulu tied season Ω', 40);
    const tieNewer = await season('E2E Alpha tied season Ω', 40);
    const hiddenOnly = await season('E2E Hidden-only season sentinel', 100);
    await season('E2E Empty season sentinel', 200);

    const future = await event(
      `E2E ${'LongΩEvent'.repeat(12)} <script>archiveSentinel()</script>`,
      low,
      {
        status: 'complete',
        date: '2099-12-31',
        released: true,
        location: `E2E ${'LongArenaΩ'.repeat(20)}`,
      },
    );
    const old = await event('E2E Archive active stale-release sentinel', high, {
      date: '1990-01-01',
      released: true,
    });
    const duplicateOlder = await event('E2E Duplicate Ω <b>Final</b>', high, {
      status: 'complete',
    });
    const duplicateNewer = await event('E2E Duplicate Ω <b>Final</b>', high, {
      status: 'setup',
      released: true,
    });
    const undated = await event('E2E Archive undated released sentinel', high, {
      status: 'complete',
      date: null,
      location: null,
      released: true,
    });
    const tiedOlderEvent = await event(
      'E2E Complete unreleased sentinel',
      tieOlder,
      { status: 'complete', date: '2027-01-01' },
    );
    const tiedNewerEvent = await event(
      'E2E Cross-calendar membership sentinel',
      tieNewer,
      { date: '1980-01-01' },
    );
    const currentSetup = await event(
      'E2E Current setup stale-release sentinel',
      high,
      {
        listing: 'current',
        status: 'setup',
        date: '2030-01-01',
        released: true,
      },
    );
    const currentReleased = await event('E2E Current released sentinel', null, {
      listing: 'current',
      status: 'complete',
      released: true,
    });
    const currentUndated = await event('E2E Current undated sentinel', low, {
      listing: 'current',
      date: null,
      location: null,
    });
    await event('E2E Hidden current sentinel', high, {
      listing: 'current',
      status: 'archived',
      released: true,
    });
    await event('E2E Hidden archive mixed-season sentinel', high, {
      status: 'archived',
      released: true,
    });
    await event('E2E Hidden archive only-season sentinel', hiddenOnly, {
      status: 'archived',
      released: true,
    });

    archiveGroups = [
      { season: high, events: [duplicateNewer, duplicateOlder, old, undated] },
      { season: tieNewer, events: [tiedNewerEvent] },
      { season: tieOlder, events: [tiedOlderEvent] },
      { season: low, events: [future] },
    ];
    currentEvents = [currentSetup, currentReleased, currentUndated];
  });

  test.afterAll(async () => {
    try {
      for (const event of seededEvents) {
        await e2eDb().run('DELETE FROM events WHERE id = ?', [event.id]);
      }
      for (const season of seasons) {
        await e2eDb().run('DELETE FROM seasons WHERE id = ?', [season.id]);
      }
    } finally {
      await closeE2eDb();
    }
  });

  test.beforeEach(async ({ context, page }) => {
    expect(await context.cookies()).toEqual([]);
    publicRequests = [];
    seasonCatalogRequests = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/events/public') {
        publicRequests.push(url.pathname + url.search);
      }
      if (url.pathname === '/events/seasons') {
        seasonCatalogRequests.push(url.pathname + url.search);
      }
    });
  });

  test.afterEach(() => {
    expect(seasonCatalogRequests).toEqual([]);
    expect(
      publicRequests.every((path) =>
        ['/events/public', '/events/public?listing=archive'].includes(path),
      ),
    ).toBe(true);
  });

  test('anonymous direct archive entry and refresh show exact public season groups and shared cards', async ({
    page,
  }) => {
    await page.goto('/spectator/archive');
    await expectListingShell(page, 'archive');
    await expectArchiveGroups(page, archiveGroups);
    await page.reload();
    await expectListingShell(page, 'archive');
    await expectArchiveGroups(page, archiveGroups);
    await expect(
      page.locator('main script, .spectator-event-card b'),
    ).toHaveCount(0);

    await page
      .getByRole('link', { name: 'Current Events', exact: true })
      .click();
    await expectListingShell(page, 'current');
    await expect(
      page.getByText('Select an event to view live scores and results.', {
        exact: true,
      }),
    ).toBeVisible();
    await expectListingCards(page, currentEvents, 3);
    await expect(page.locator('.spectator-archive-season')).toHaveCount(0);
    expect(publicRequests).toContain('/events/public?listing=archive');
    expect(publicRequests).toContain('/events/public');
  });

  test('shuffled mixed public rows sort independently and group by season ID, not duplicate labels or dates', async ({
    page,
  }) => {
    const duplicateSeasonName = 'E2E Duplicate season Ω <b>literal</b>';
    const tiedIds = archiveGroups.slice(1, 3).map((group) => group.season.id);
    const rows = seededEvents.map((event) =>
      tiedIds.includes(event.season_id ?? -1)
        ? { ...event, season_name: duplicateSeasonName }
        : event,
    );
    const expected = archiveGroups.map((group) =>
      tiedIds.includes(group.season.id)
        ? { ...group, season: { ...group.season, name: duplicateSeasonName } }
        : group,
    );
    let reversed = true;
    await page.route('**/events/public*', (route) =>
      route.fulfill({
        json: reversed
          ? [...rows].reverse()
          : [...rows.slice(4), ...rows.slice(0, 4)],
      }),
    );

    await page.goto('/spectator/archive');
    await expectArchiveGroups(page, expected);
    reversed = false;
    await page.reload();
    await expectArchiveGroups(page, expected);
    await expect(
      page.locator('.spectator-archive-season h3 b, .spectator-event-card b'),
    ).toHaveCount(0);
    await page
      .getByRole('link', { name: 'Current Events', exact: true })
      .click();
    await expectListingCards(page, currentEvents, 3);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 4 }),
    ).toHaveCount(0);
  });

  for (const listing of ['current', 'archive'] as const) {
    test(`${listing} loading, network failure, 5xx and keyboard retry remain distinct from empty`, async ({
      page,
    }) => {
      const gate = deferredListingResponse();
      let outcome: 'network' | 'server' | 'success' = 'network';
      const emptyText =
        listing === 'archive'
          ? 'No archived events are currently available.'
          : 'No events are currently available.';
      await page.route('**/events/public*', async (route) => {
        await gate.promise;
        if (outcome === 'network') await route.abort('failed');
        else if (outcome === 'server')
          await route.fulfill({
            status: 503,
            json: { error: 'E2E unavailable sentinel' },
          });
        else
          await route.fulfill({
            json:
              listing === 'archive'
                ? archiveGroups.flatMap((group) => group.events)
                : currentEvents,
          });
      });
      try {
        await page.goto(
          listing === 'archive' ? '/spectator/archive' : '/spectator',
        );
        await expectListingShell(page, listing);
        await expect(page.getByRole('status')).toHaveText(
          listing === 'archive' ? 'Loading archive...' : 'Loading events...',
        );
        await expect(page.getByText(emptyText, { exact: true })).toHaveCount(0);
        gate.resolve();
        const alert = page.getByRole('alert');
        await expect(alert).toContainText(
          listing === 'archive'
            ? 'Could not load archive events.'
            : 'Could not load current events.',
        );
        await expect(page.getByRole('status')).toHaveCount(0);
        await expectListingShell(page, listing);
        await expect(page.getByText(emptyText, { exact: true })).toHaveCount(0);

        outcome = 'server';
        const serverFailure = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/events/public' &&
            response.status() === 503,
        );
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await serverFailure;
        await expect(alert).toBeVisible();
        await expectListingShell(page, listing);
        await expect(page.getByText(emptyText, { exact: true })).toHaveCount(0);

        outcome = 'success';
        await page.getByRole('button', { name: 'Retry', exact: true }).focus();
        await page.keyboard.press('Enter');
        if (listing === 'archive')
          await expectArchiveGroups(page, archiveGroups);
        else await expectListingCards(page, currentEvents, 3);
        await expect(alert).toHaveCount(0);
        await expect(page.getByRole('status')).toHaveCount(0);
        await expectListingShell(page, listing);
      } finally {
        gate.resolve();
      }
    });
  }

  test('empty current, empty archive and both empty retain working listing navigation', async ({
    page,
  }) => {
    let current: ListingEvent[] = [];
    let archive: ListingEvent[] = [];
    await page.route('**/events/public*', (route) =>
      route.fulfill({
        json:
          new URL(route.request().url()).searchParams.get('listing') ===
          'archive'
            ? archive
            : current,
      }),
    );
    for (const state of [
      { current: [], archive: archiveGroups.flatMap((group) => group.events) },
      { current: currentEvents, archive: [] },
      { current: [], archive: [] },
    ]) {
      ({ current, archive } = state);
      await page.goto('/spectator');
      await expectListingShell(page, 'current');
      await expectListingCards(page, current, 3);
      await expect(
        page.getByText('No events are currently available.', { exact: true }),
      ).toHaveCount(current.length ? 0 : 1);
      await page.getByRole('link', { name: 'Archive', exact: true }).click();
      await expectListingShell(page, 'archive');
      await expectArchiveGroups(page, archive.length ? archiveGroups : []);
      await expect(
        page.getByText('No archived events are currently available.', {
          exact: true,
        }),
      ).toHaveCount(archive.length ? 0 : 1);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await page
        .getByRole('link', { name: 'Current Events', exact: true })
        .click();
      await expectListingShell(page, 'current');
      await expectListingCards(page, current, 3);
    }
  });

  test('late current-list success or failure cannot replace archive data after navigation', async ({
    page,
  }) => {
    for (const status of [200, 503]) {
      const gate = deferredListingResponse();
      const requested = deferredListingResponse();
      const pending: Promise<void>[] = [];
      await page.route('**/events/public*', async (route) => {
        if (
          new URL(route.request().url()).searchParams.get('listing') ===
          'archive'
        ) {
          await route.fulfill({
            json: archiveGroups.flatMap((group) => group.events),
          });
        } else {
          const response = gate.promise.then(() =>
            route.fulfill({
              status,
              json:
                status === 200
                  ? currentEvents
                  : { error: 'E2E stale failure sentinel' },
            }),
          );
          pending.push(response);
          requested.resolve();
          await response;
        }
      });
      try {
        await page.goto('/spectator');
        await requested.promise;
        await expect(page.getByRole('status')).toHaveText('Loading events...');
        await page.getByRole('link', { name: 'Archive', exact: true }).click();
        await expectArchiveGroups(page, archiveGroups);
        gate.resolve();
        await Promise.all(pending);
        // Cross a browser render boundary after delivering the obsolete response.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            ),
        );
        await expectListingShell(page, 'archive');
        await expectArchiveGroups(page, archiveGroups);
        await expect(page.getByRole('alert')).toHaveCount(0);
      } finally {
        gate.resolve();
        await page.unrouteAll({ behavior: 'wait' });
      }
    }
  });

  test('mobile long labels wrap and real listing/card links support keyboard and browser history', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/spectator/archive');
    await expectListingShell(page, 'archive');
    await expectArchiveGroups(page, archiveGroups);
    const longGroup = archiveGroups[3];
    for (const name of [longGroup.season.name, longGroup.events[0].name]) {
      const heading = page.getByRole('heading', { name, exact: true });
      const lines = await heading.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      });
      expect(lines).toBeGreaterThan(1);
    }
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport);

    await page
      .getByRole('link', { name: 'Current Events', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/spectator$/);
    await expectListingShell(page, 'current');
    await expectListingCards(page, currentEvents, 3);
    await page.goBack();
    await expectListingShell(page, 'archive');
    await expectArchiveGroups(page, archiveGroups);
    await page.goForward();
    await expectListingShell(page, 'current');
    await page.getByRole('link', { name: 'Archive', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/spectator\/archive$/);
    await expectArchiveGroups(page, archiveGroups);

    const event = longGroup.events[0];
    await page
      .locator(
        `a.spectator-event-card[href="/spectator/events/${event.id}?view=seeding"]`,
      )
      .focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      new RegExp(`/spectator/events/${event.id}\\?view=seeding$`),
    );
    // Archive detail metadata/back-link behavior belongs to step 5, not this UI change.
    await page.goBack();
    await expect(page).toHaveURL(/\/spectator\/archive$/);
    await expectListingShell(page, 'archive');
    await expectArchiveGroups(page, archiveGroups);
  });
});
