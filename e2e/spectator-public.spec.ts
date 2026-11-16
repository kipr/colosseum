import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
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
let activeBracketId: number;
let activeTeamAId: number;
let activeTeamBId: number;
let awardId: number;
let individualOnlyAwardId: number;

/* ------------------------------------------------------------------ */
/*  Data lifecycle                                                    */
/* ------------------------------------------------------------------ */

// Register the same owned data lifecycle in each describe without duplicating
// the populated tournament or coupling step 5 to the legacy serial tests.
function useSpectatorFixtures(afterCleanup?: () => Promise<void>) {
  let documentationCategoryId: number | null = null;

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
    activeTeamAId = Number(tA1.lastID);

    const tB1 = await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, status)
       VALUES (?, ?, ?, 'checked_in') RETURNING id`,
      [activeEventId, TEAM_B.number, TEAM_B.name],
    );
    activeTeamBId = Number(tB1.lastID);

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
    activeBracketId = Number(activeBr.lastID);

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
    documentationCategoryId = catId;

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

    try {
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
      await db.run(
        'DELETE FROM documentation_scores WHERE event_id IN (?, ?)',
        [activeEventId, releasedEventId],
      );
      await db.run(
        'DELETE FROM event_documentation_categories WHERE event_id IN (?, ?)',
        [activeEventId, releasedEventId],
      );
      if (documentationCategoryId !== null) {
        await db.run('DELETE FROM documentation_categories WHERE id = ?', [
          documentationCategoryId,
        ]);
      }

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

      await afterCleanup?.();
    } finally {
      await closeE2eDb();
    }
  });
}

test.describe('Spectator Public Views & Release Gating', () => {
  test.describe.configure({ mode: 'serial' });
  useSpectatorFixtures();

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

const FINAL_RESULT_TABS = [
  'Documentation',
  'Awards',
  'Bracket Rankings',
  'Overall',
];

async function expectFinalTabs(page: Page, available: boolean) {
  for (const name of FINAL_RESULT_TABS) {
    await expect(
      page
        .locator('.spectator-tab-btn')
        .filter({ hasText: new RegExp(`^${name}$`) }),
    ).toHaveCount(available ? 1 : 0);
  }
}

async function expectScoreCells(row: Locator, cells: string[]) {
  await expect(row.locator('td')).toHaveText(cells);
}

async function expectSeedScores(page: Page, released: boolean, double = false) {
  const rows = page.locator('.spectator-seeding-view tbody tr');
  await expect(rows).toHaveCount(2);
  const alpha = rows.filter({ hasText: TEAM_A.name });
  const beta = rows.filter({ hasText: TEAM_B.name });
  if (double) {
    await expectScoreCells(alpha, [
      '1',
      '101',
      TEAM_A.name,
      released ? '91' : '61',
      released ? '103' : '73',
      released ? '97.00' : '67.00',
      '0.9375',
    ]);
    await expectScoreCells(beta, [
      '2',
      '202',
      TEAM_B.name,
      released ? '77' : '47',
      released ? '89' : '59',
      released ? '83.00' : '53.00',
      '0.6250',
    ]);
  } else {
    await expectScoreCells(alpha, [
      '1',
      '101',
      TEAM_A.name,
      released ? '80' : '50',
      released ? '85' : '—',
      '—',
      released ? '82.50' : '50.00',
      '0.8750',
    ]);
    await expectScoreCells(beta, [
      '2',
      '202',
      TEAM_B.name,
      released ? '75' : '45',
      released ? '70' : '—',
      '—',
      released ? '72.50' : '45.00',
      '0.6250',
    ]);
  }
}

type FinalView = 'documentation' | 'awards' | 'rankings' | 'overall';

function finalViewUrl(
  eventId: number,
  selectedBracket: number,
  view: FinalView,
) {
  return view === 'rankings'
    ? `/spectator/events/${eventId}/brackets/${selectedBracket}?view=rankings`
    : `/spectator/events/${eventId}?view=${view}`;
}

async function expectPopulatedFinalView(page: Page, view: FinalView) {
  if (view === 'awards') {
    const champion = page.locator('.spectator-manual-award').filter({
      hasText: 'Champion Award',
    });
    await expect(
      champion.getByText(TEAM_A.name, { exact: true }),
    ).toBeVisible();
    await expect(
      champion.getByText('Ada Lovelace', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Grace Hopper', { exact: true })).toBeVisible();
    await expect(
      page.locator('.spectator-awards-section-title').filter({
        hasText: 'Double elimination',
      }),
    ).toBeVisible();
    return;
  }
  const rows = page.locator(
    view === 'documentation'
      ? '.spectator-documentation-view tbody tr'
      : view === 'rankings'
        ? '.spectator-bracket-rankings-view tbody tr'
        : '.spectator-overall-view tbody tr',
  );
  await expect(rows).toHaveCount(2);
  const alpha = rows.filter({ hasText: TEAM_A.name });
  const beta = rows.filter({ hasText: TEAM_B.name });
  if (view === 'documentation') {
    await expectScoreCells(alpha, ['101', TEAM_A.name, '90/100', '=', '0.900']);
    await expectScoreCells(beta, ['202', TEAM_B.name, '80/100', '=', '0.800']);
  } else if (view === 'rankings') {
    await expectScoreCells(alpha, [
      '1st',
      '101',
      TEAM_A.name,
      '1.0000',
      '0.9000',
      '0.8750',
      '0.9375',
      '1.0000',
      '3.7125',
    ]);
    await expectScoreCells(beta, [
      '2nd',
      '202',
      TEAM_B.name,
      '0.5000',
      '0.8000',
      '0.6250',
      '0.6250',
      '0.5000',
      '2.5500',
    ]);
  } else {
    await expectScoreCells(alpha, [
      '101',
      TEAM_A.name,
      '0.9000',
      '+',
      '0.8750',
      '+',
      '0.9375',
      '+',
      '1.0000',
      '=',
      '3.7125',
    ]);
    await expectScoreCells(beta, [
      '202',
      TEAM_B.name,
      '0.8000',
      '+',
      '0.6250',
      '+',
      '0.6250',
      '+',
      '0.5000',
      '=',
      '2.5500',
    ]);
  }
}

async function expectPublicResultGates(
  request: APIRequestContext,
  eventId: number,
  selectedBracket: number,
  allowed: boolean,
  hidden = false,
) {
  const paths = [
    `/documentation-scores/event/${eventId}/public`,
    `/awards/event/${eventId}/public`,
    `/brackets/${selectedBracket}/rankings/public`,
    `/events/${eventId}/overall/public`,
  ];
  for (const path of paths) {
    // Query-selected events/placements cannot override the resource owner's gate.
    const decoyEventId =
      eventId === activeEventId ? releasedEventId : activeEventId;
    const response = await request.get(
      `${path}?event_id=${decoyEventId}&listing=current`,
    );
    expect(response.status(), path).toBe(allowed ? 200 : 404);
    const body = await response.json();
    if (!allowed) expect(body, path).toEqual({ error: 'Not found' });
    else if (path.startsWith('/documentation-scores/')) {
      expect(body.scores).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ team_id: teamAId, overall_score: 0.9 }),
        ]),
      );
    } else if (path.startsWith('/awards/')) {
      expect(body.manual).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Champion Award' }),
        ]),
      );
    } else if (path.startsWith('/brackets/')) {
      expect(body.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ team_id: teamAId, final_rank: 1 }),
        ]),
      );
    } else {
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ team_id: teamAId, total: 3.7125 }),
        ]),
      );
    }
  }
  const metadata = await request.get(`/events/${eventId}/public`);
  expect(metadata.status()).toBe(hidden ? 404 : 200);
  if (!hidden) {
    const body = await metadata.json();
    expect(body.final_scores_available).toBe(allowed);
    expect(Object.keys(body).sort()).toEqual(
      [
        'id',
        'name',
        'status',
        'event_date',
        'location',
        'seeding_rounds',
        'double_seeding_rounds',
        'final_scores_available',
        'spectator_listing',
        'season_id',
        'season_name',
        'season_sort_order',
      ].sort(),
    );
  }
  const ordinary = await request.get(`/brackets/${selectedBracket}`);
  expect(ordinary.status()).toBe(hidden ? 404 : 200);
  if (!hidden) {
    const body = await ordinary.json();
    expect(body.entries).toHaveLength(2);
    for (const entry of body.entries) {
      for (const field of [
        'final_rank',
        'bracket_raw_score',
        'weighted_bracket_raw_score',
      ]) {
        expect(entry).not.toHaveProperty(field);
      }
    }
  }
}

// Exercise React Router identity changes without reloading/unmounting the app.
// This uses browser history, not an application-only testing hook.
async function navigateSpectatorHistory(page: Page, path: string) {
  await page.evaluate((next) => {
    window.history.pushState(null, '', next);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test.describe('Spectator detail bookmarks (step 5)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let offsetEventId: number;
  let seasonId: number;
  test.beforeAll(async () => {
    // Different event/bracket IDs catch accidental event-ID-based authorization.
    offsetEventId = Number(
      (
        await e2eDb().run(
          "INSERT INTO events (name, status) VALUES ('E2E Detail ID offset', 'archived') RETURNING id",
        )
      ).lastID,
    );
  });
  useSpectatorFixtures(async () => {
    // Remove event-dependent rows before their season, using the same pool.
    if (offsetEventId)
      await e2eDb().run('DELETE FROM events WHERE id = ?', [offsetEventId]);
    if (seasonId)
      await e2eDb().run('DELETE FROM seasons WHERE id = ?', [seasonId]);
  });

  let metadataRequests: string[];
  let forbiddenMetadataRequests: string[];
  let pageErrors: string[];
  let navigatingToListing: boolean;

  test.beforeAll(async () => {
    const db = e2eDb();
    seasonId = Number(
      (
        await db.run(
          "INSERT INTO seasons (name, sort_order) VALUES ('E2E Detail archive season', 10) RETURNING id",
        )
      ).lastID,
    );
    await db.run(
      'UPDATE events SET double_seeding_rounds = 2 WHERE id IN (?, ?)',
      [activeEventId, releasedEventId],
    );
    // Use normalized, nontrivial scores so the complete final tables can be
    // asserted independently of their response payloads.
    await db.run(
      'UPDATE documentation_scores SET overall_score = CASE WHEN team_id = ? THEN 0.9 ELSE 0.8 END WHERE event_id = ?',
      [teamAId, releasedEventId],
    );
    await db.run(
      'UPDATE seeding_rankings SET raw_seed_score = CASE WHEN team_id = ? THEN 0.875 ELSE 0.625 END WHERE team_id IN (?, ?)',
      [teamAId, teamAId, teamBId],
    );
    for (const [team, average, rank, raw] of [
      [activeTeamAId, 50, 1, 0.875],
      [activeTeamBId, 45, 2, 0.625],
    ]) {
      await db.run(
        'INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, ?, ?, ?)',
        [team, average, rank, raw],
      );
    }
    await db.run(
      "UPDATE bracket_games SET bracket_side = 'finals' WHERE bracket_id = ?",
      [bracketId],
    );
    await db.run(
      `INSERT INTO bracket_games (bracket_id, game_number, round_name, round_number,
        bracket_side, team1_id, team2_id, status, winner_id, loser_id, team1_score, team2_score)
       VALUES (?, 1, 'Live round', 1, 'winners', ?, ?, 'completed', ?, ?, 12, 9)`,
      [
        activeBracketId,
        activeTeamAId,
        activeTeamBId,
        activeTeamAId,
        activeTeamBId,
      ],
    );
    for (const [event, alpha, beta, offset] of [
      [activeEventId, activeTeamAId, activeTeamBId, 0],
      [releasedEventId, teamAId, teamBId, 30],
    ]) {
      for (const round of [1, 2]) {
        const match = Number(
          (
            await db.run(
              `INSERT INTO double_seeding_matches (event_id, round_number, match_number,
            team1_id, team2_id, status) VALUES (?, ?, 1, ?, ?, 'completed') RETURNING id`,
              [event, round, alpha, beta],
            )
          ).lastID,
        );
        for (const [team, side, score] of [
          [alpha, 'team1', 49 + round * 12 + offset],
          [beta, 'team2', 35 + round * 12 + offset],
        ] as const) {
          await db.run(
            `INSERT INTO double_seeding_scores (event_id, match_id, team_id,
              round_number, side, score) VALUES (?, ?, ?, ?, ?, ?)`,
            [event, match, team, round, side, score],
          );
        }
      }
      for (const [team, average, rank, raw] of [
        [alpha, 67 + offset, 1, 0.9375],
        [beta, 53 + offset, 2, 0.625],
      ]) {
        await db.run(
          'INSERT INTO double_seeding_rankings (team_id, seed_average, seed_rank, raw_double_seed_score) VALUES (?, ?, ?, ?)',
          [team, average, rank, raw],
        );
      }
    }
  });

  async function restoreVisibility() {
    await e2eDb().run(
      "UPDATE events SET status = 'active', spectator_results_released = 0, spectator_listing = 'current', season_id = NULL WHERE id = ?",
      [activeEventId],
    );
    await e2eDb().run(
      "UPDATE events SET status = 'complete', spectator_results_released = 1, spectator_listing = 'archive', season_id = ? WHERE id = ?",
      [seasonId, releasedEventId],
    );
  }

  test.beforeEach(async ({ context, page }) => {
    await restoreVisibility();
    expect(await context.cookies()).toEqual([]);
    metadataRequests = [];
    forbiddenMetadataRequests = [];
    pageErrors = [];
    navigatingToListing = false;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const { pathname, search } = new URL(request.url());
      if (/^\/events\/[^/]+\/public$/.test(pathname))
        metadataRequests.push(pathname);
      if (
        (pathname === '/events/public' && !navigatingToListing) ||
        /^\/events\/?$/.test(pathname) ||
        (/^\/events\/[^/]+\/?$/.test(pathname) && pathname !== '/events/public')
      )
        forbiddenMetadataRequests.push(pathname + search);
    });
    // This route is a tripwire, never the selected-event data source.
    await page.route('**/events/public*', (route) =>
      route.fulfill({
        status: 503,
        json: { error: 'E2E current listing must not be needed' },
      }),
    );
  });

  test.afterEach(async () => {
    try {
      expect(
        forbiddenMetadataRequests,
        'No list or authenticated event metadata fallback',
      ).toEqual([]);
      expect(pageErrors, 'No uncaught browser errors').toEqual([]);
    } finally {
      await restoreVisibility();
    }
  });

  async function expectEvent(page: Page, released: boolean, listing: Listing) {
    await expect(
      page.getByRole('heading', {
        name: released ? RELEASED_EVENT_NAME : ACTIVE_EVENT_NAME,
        exact: true,
      }),
    ).toBeVisible();
    expect(metadataRequests).toContain(
      `/events/${released ? releasedEventId : activeEventId}/public`,
    );
    await expect(
      page.getByRole('link', {
        name: listing === 'archive' ? '← Back to Archive' : '← Current Events',
        exact: true,
      }),
    ).toHaveAttribute(
      'href',
      listing === 'archive'
        ? /^\/spectator\/archive(?:[?#].*)?$/
        : '/spectator',
    );
  }

  test('archive event and bracket open and refresh with zero current public events in PostgreSQL', async ({
    page,
    context,
  }) => {
    await e2eDb().run(
      "UPDATE events SET spectator_listing = 'archive', season_id = ? WHERE id = ?",
      [seasonId, activeEventId],
    );
    try {
      const current = await e2eDb().all(
        "SELECT id FROM events WHERE spectator_listing = 'current' AND status != 'archived'",
      );
      expect(
        current,
        'Only our own current fixture was moved; no unrelated rows modified',
      ).toEqual([]);
      const list = await context.request.get('/events/public');
      expect(list.status()).toBe(200);
      expect(await list.json()).toEqual([]);
      await expectPublicResultGates(
        context.request,
        releasedEventId,
        bracketId,
        true,
      );
      for (const path of [
        `/spectator/events/${releasedEventId}`,
        `/spectator/events/${releasedEventId}/brackets/${bracketId}?view=bracket&side=finals`,
      ]) {
        await page.goto(path);
        for (const refresh of [false, true]) {
          if (refresh) await page.reload();
          await expectEvent(page, true, 'archive');
          if (path.includes('/brackets/')) {
            await expect(
              page.locator('.bracket-section .bracket-match').first(),
            ).toContainText(TEAM_A.name);
            await expect(
              page.locator('.bracket-section .bracket-match').first(),
            ).toContainText(TEAM_B.name);
            await expect(
              page
                .locator('.bracket-section .bracket-match')
                .first()
                .locator('.team-score'),
            ).toHaveText(['100', '50']);
            expect(new URL(page.url()).searchParams.get('side')).toBe('finals');
          } else await expectSeedScores(page, true);
        }
      }
    } finally {
      await restoreVisibility();
    }
  });

  for (const listing of ['current', 'archive'] as const) {
    for (const listFailure of ['rejected', 'unrelated'] as const) {
      test(`${listing} direct bookmarks ignore ${listFailure} current-list responses and never request the list`, async ({
        page,
        context,
      }) => {
        const released = listing === 'archive';
        const event = released ? releasedEventId : activeEventId;
        const selectedBracket = released ? bracketId : activeBracketId;
        const other = await context.request.get(
          `/events/${released ? activeEventId : releasedEventId}/public`,
        );
        expect(other.status()).toBe(200);
        const unrelated = await other.json();
        await page.route('**/events/public*', (route) =>
          listFailure === 'rejected'
            ? route.abort('failed')
            : route.fulfill({ json: [unrelated] }),
        );
        for (const [path, tab] of [
          [`/spectator/events/${event}?view=seeding`, 'Seeding'],
          [`/spectator/events/${event}?view=double-seeding`, 'Double Seeding'],
          [
            `/spectator/events/${event}/brackets/${selectedBracket}?view=bracket&side=${released ? 'finals' : 'winners'}`,
            'Bracket',
          ],
        ]) {
          await page.goto(path);
          for (const refresh of [false, true]) {
            if (refresh) await page.reload();
            await expectEvent(page, released, listing);
            await expect(page.locator('.spectator-tab-btn.active')).toHaveText(
              tab,
            );
            if (tab === 'Bracket') {
              await expect(
                page.locator('.bracket-section .bracket-match').first(),
              ).toContainText(TEAM_A.name);
              await expect(
                page
                  .locator('.bracket-section .bracket-match')
                  .first()
                  .locator('.team-score'),
              ).toHaveText(released ? ['100', '50'] : ['12', '9']);
              expect(new URL(page.url()).pathname).toBe(
                `/spectator/events/${event}/brackets/${selectedBracket}`,
              );
              expect(new URL(page.url()).searchParams.get('side')).toBe(
                released ? 'finals' : 'winners',
              );
            } else
              await expectSeedScores(page, released, tab === 'Double Seeding');
          }
        }
      });
    }

    test(`${listing} permits exact ordinary and double-seeding live scores without releasing final results`, async ({
      page,
      context,
    }) => {
      await e2eDb().run(
        'UPDATE events SET spectator_listing = ?, season_id = ? WHERE id = ?',
        [listing, listing === 'archive' ? seasonId : null, activeEventId],
      );
      for (const view of ['seeding', 'double-seeding']) {
        await page.goto(`/spectator/events/${activeEventId}?view=${view}`);
        await expectEvent(page, false, listing);
        await expectSeedScores(page, false, view === 'double-seeding');
        await expectFinalTabs(page, false);
      }
      await page
        .locator('.spectator-tab-btn')
        .filter({ hasText: /^Bracket$/ })
        .click();
      await expect(page).toHaveURL(
        new RegExp(
          `/events/${activeEventId}/brackets/${activeBracketId}\\?view=bracket`,
        ),
      );
      await expect(
        page.locator('.bracket-section .bracket-match').first(),
      ).toContainText(TEAM_B.name);
      await expectPublicResultGates(
        context.request,
        activeEventId,
        activeBracketId,
        false,
      );
    });

    test(`${listing} direct-entry back link works without listing history`, async ({
      page,
    }) => {
      const released = listing === 'archive';
      await page.goto(
        `/spectator/events/${released ? releasedEventId : activeEventId}?view=seeding`,
      );
      await expectEvent(page, released, listing);
      expect(forbiddenMetadataRequests).toEqual([]);
      // Requests after clicking the destination link legitimately load a list.
      navigatingToListing = true;
      await page.unroute('**/events/public*');
      await page
        .getByRole('link', {
          name: released ? '← Back to Archive' : '← Current Events',
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(
        released ? /\/spectator\/archive(?:[?#].*)?$/ : /\/spectator$/,
      );
      await expect(
        page.locator('.spectator-event-card').filter({
          hasText: released ? RELEASED_EVENT_NAME : ACTIVE_EVENT_NAME,
        }),
      ).toBeVisible();
    });
  }

  test('released archive direct query URLs and refresh render populated documentation, awards, rankings and overall', async ({
    page,
  }) => {
    for (const view of [
      'documentation',
      'awards',
      'rankings',
      'overall',
    ] as const) {
      const path = finalViewUrl(releasedEventId, bracketId, view);
      await page.goto(path);
      for (const refresh of [false, true]) {
        if (refresh) await page.reload();
        await expectEvent(page, true, 'archive');
        await expectFinalTabs(page, true);
        await expectPopulatedFinalView(page, view);
        expect(new URL(page.url()).searchParams.get('view')).toBe(view);
      }
    }
  });

  test('tab navigation, browser back/forward and refresh preserve event, bracket and selected view', async ({
    page,
  }) => {
    await page.goto(`/spectator/events/${releasedEventId}?view=seeding`);
    await expectEvent(page, true, 'archive');
    await page
      .locator('.spectator-tab-btn')
      .filter({ hasText: /^Bracket$/ })
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `/events/${releasedEventId}/brackets/${bracketId}\\?view=bracket`,
      ),
    );
    await page
      .locator('.spectator-tab-btn')
      .filter({ hasText: /^Bracket Rankings$/ })
      .click();
    await expectPopulatedFinalView(page, 'rankings');
    await page
      .locator('.spectator-tab-btn')
      .filter({ hasText: /^Documentation$/ })
      .click();
    await expectPopulatedFinalView(page, 'documentation');
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(
        `/events/${releasedEventId}/brackets/${bracketId}\\?view=rankings`,
      ),
    );
    await expectPopulatedFinalView(page, 'rankings');
    await page.goBack();
    await expect(page.locator('.spectator-tab-btn.active')).toHaveText(
      'Bracket',
    );
    await page.goForward();
    await page.reload();
    await expectEvent(page, true, 'archive');
    await expectPopulatedFinalView(page, 'rankings');
  });

  test('release revoke/re-release, reopen, hide and hidden-to-current keep all four server gates after refresh', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const states = [
      { status: 'complete', release: 1, listing: 'archive', allowed: true },
      { status: 'complete', release: 0, listing: 'archive', allowed: false },
      { status: 'complete', release: 1, listing: 'archive', allowed: true },
      // Deliberately stale release: lifecycle, not the flag alone, must gate reads.
      { status: 'active', release: 1, listing: 'archive', allowed: false },
      { status: 'archived', release: 1, listing: 'archive', allowed: false },
      { status: 'archived', release: 1, listing: 'current', allowed: false },
    ];
    try {
      for (const state of states) {
        await test.step(JSON.stringify(state), async () => {
          await e2eDb().run(
            'UPDATE events SET status = ?, spectator_results_released = ?, spectator_listing = ? WHERE id = ?',
            [state.status, state.release, state.listing, releasedEventId],
          );
          const hidden = state.status === 'archived';
          for (const view of [
            'documentation',
            'awards',
            'rankings',
            'overall',
          ] as const) {
            await page.goto(finalViewUrl(releasedEventId, bracketId, view));
            await page.reload();
            if (hidden) {
              await expect(
                page.getByText('This event is unavailable.', { exact: true }),
              ).toBeVisible();
              await expect(
                page.getByRole('heading', { name: RELEASED_EVENT_NAME }),
              ).toHaveCount(0);
            } else await expectEvent(page, true, state.listing as Listing);
            await expectFinalTabs(page, state.allowed);
            if (state.allowed) await expectPopulatedFinalView(page, view);
            else {
              await expect(
                page.locator(
                  '.spectator-manual-award, .spectator-documentation-view tbody tr, .spectator-bracket-rankings-view tbody tr, .spectator-overall-view tbody tr',
                ),
              ).toHaveCount(0);
            }
          }
          await expectPublicResultGates(
            context.request,
            releasedEventId,
            bracketId,
            state.allowed,
            hidden,
          );
        });
      }
    } finally {
      await restoreVisibility();
    }
  });

  test('a released URL event cannot authorize a mismatched unreleased or hidden bracket owner', async ({
    page,
    context,
  }) => {
    for (const status of ['active', 'archived']) {
      await e2eDb().run('UPDATE events SET status = ? WHERE id = ?', [
        status,
        activeEventId,
      ]);
      const path = `/spectator/events/${releasedEventId}/brackets/${activeBracketId}?view=rankings`;
      expect(activeBracketId).not.toBe(activeEventId);
      await page.goto(path);
      await page.reload();
      await expectEvent(page, true, 'archive');
      await expect(
        page.getByText(
          'No rankings available. Rankings are calculated as bracket games are completed.',
          { exact: true },
        ),
      ).toBeVisible();
      // No new client ownership rejection is required: the actual owner's API
      // gate is authoritative, regardless of how the existing route is rendered.
      await expect(
        page.locator('.spectator-bracket-rankings-view tbody tr'),
      ).toHaveCount(0);
      const rankings = await context.request.get(
        `/brackets/${activeBracketId}/rankings/public?event_id=${releasedEventId}`,
      );
      expect(rankings.status()).toBe(404);
      expect(await rankings.json()).toEqual({ error: 'Not found' });
      const ordinary = await context.request.get(
        `/brackets/${activeBracketId}?event_id=${releasedEventId}`,
      );
      expect(ordinary.status()).toBe(status === 'archived' ? 404 : 200);
      await expectPublicResultGates(
        context.request,
        activeEventId,
        activeBracketId,
        false,
        status === 'archived',
      );
    }
  });

  test('malformed and missing event IDs are unavailable, not retryable or redirected to another event', async ({
    page,
  }) => {
    for (const id of ['not-an-id', '0', '-1', '1.5', '99999999']) {
      const path = `/spectator/events/${id}?view=awards`;
      await page.goto(path);
      await expect(
        page.getByText('This event is unavailable.', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Retry', exact: true }),
      ).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe(`/spectator/events/${id}`);
      await expect(
        page.locator('.spectator-tab-btn, .spectator-manual-award'),
      ).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: RELEASED_EVENT_NAME }),
      ).toHaveCount(0);
    }
    await page.reload();
    await expect(
      page.getByText('This event is unavailable.', { exact: true }),
    ).toBeVisible();
  });

  test('missing and malformed bracket bookmarks do not crash, expose another bracket or invent rankings', async ({
    page,
    context,
  }) => {
    for (const id of ['99999999', 'not-a-bracket']) {
      for (const view of ['bracket', 'rankings']) {
        const path = `/spectator/events/${releasedEventId}/brackets/${id}?view=${view}`;
        await page.goto(path);
        await page.reload();
        await expectEvent(page, true, 'archive');
        await expect(
          page.locator(
            '.bracket-match, .spectator-bracket-rankings-view tbody tr',
          ),
        ).toHaveCount(0);
        await expect(
          page.getByText(
            view === 'bracket'
              ? 'No bracket games available yet.'
              : 'No rankings available. Rankings are calculated as bracket games are completed.',
            { exact: true },
          ),
        ).toBeVisible();
        expect(new URL(page.url()).pathname).toBe(
          `/spectator/events/${releasedEventId}/brackets/${id}`,
        );
      }
    }
    const missing = await context.request.get(
      '/brackets/99999999/rankings/public',
    );
    expect(missing.status()).toBe(404);
  });

  for (const failure of ['network', '503'] as const) {
    test(`transient detail ${failure} failure offers Retry and recovers without listing fallback`, async ({
      page,
    }) => {
      let failing = true;
      await page.route(`**/events/${releasedEventId}/public`, (route) => {
        if (!failing) return route.continue();
        return failure === 'network'
          ? route.abort('failed')
          : route.fulfill({
              status: 503,
              json: { error: 'E2E temporary detail failure' },
            });
      });
      await page.goto(`/spectator/events/${releasedEventId}?view=awards`);
      await expect(
        page.getByText('Unable to load this event. Please try again.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText('This event is unavailable.', { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.locator('.spectator-tab-btn, .spectator-manual-award'),
      ).toHaveCount(0);
      failing = false;
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await expectEvent(page, true, 'archive');
      await expectPopulatedFinalView(page, 'awards');
      expect(
        metadataRequests.filter(
          (path) => path === `/events/${releasedEventId}/public`,
        ).length,
      ).toBeGreaterThanOrEqual(2);
    });
  }

  for (const resource of ['metadata', 'awards'] as const) {
    test(`late archive released ${resource} cannot replace current unreleased event after history navigation`, async ({
      page,
    }) => {
      const gate = deferredListingResponse();
      const pending: Promise<void>[] = [];
      const endpoint =
        resource === 'metadata'
          ? `**/events/${releasedEventId}/public`
          : `**/awards/event/${releasedEventId}/public`;
      await page.route(endpoint, async (route) => {
        const response = await route.fetch();
        const completion = gate.promise.then(() => route.fulfill({ response }));
        pending.push(completion);
        await completion;
      });
      try {
        await page.goto(`/spectator/events/${releasedEventId}?view=awards`);
        await expect.poll(() => pending.length).toBeGreaterThan(0);
        await navigateSpectatorHistory(
          page,
          `/spectator/events/${activeEventId}?view=seeding`,
        );
        await expectEvent(page, false, 'current');
        await expectSeedScores(page, false);
        gate.resolve();
        await Promise.all(pending);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            ),
        );
        await expectEvent(page, false, 'current');
        await expectSeedScores(page, false);
        await expectFinalTabs(page, false);
        await expect(
          page.getByRole('heading', { name: RELEASED_EVENT_NAME }),
        ).toHaveCount(0);
        await expect(
          page.getByText('Ada Lovelace', { exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole('link', { name: '← Back to Archive', exact: true }),
        ).toHaveCount(0);
      } finally {
        gate.resolve();
        await page.unrouteAll({ behavior: 'wait' });
      }
    });
  }

  test('switching from a populated event to hidden, deleted or missing metadata clears prior results', async ({
    page,
    context,
  }) => {
    await page.goto(`/spectator/events/${releasedEventId}?view=awards`);
    await expectPopulatedFinalView(page, 'awards');
    await e2eDb().run("UPDATE events SET status = 'archived' WHERE id = ?", [
      activeEventId,
    ]);
    const deleted = Number(
      (
        await e2eDb().run(
          "INSERT INTO events (name, status) VALUES ('E2E Deleted detail sentinel', 'active') RETURNING id",
        )
      ).lastID,
    );
    await e2eDb().run('DELETE FROM events WHERE id = ?', [deleted]);
    for (const id of [activeEventId, deleted, 99999999]) {
      await navigateSpectatorHistory(
        page,
        `/spectator/events/${id}?view=awards`,
      );
      await expect(
        page.getByText('This event is unavailable.', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: RELEASED_EVENT_NAME }),
      ).toHaveCount(0);
      await expect(
        page.locator('.spectator-tab-btn, .spectator-manual-award'),
      ).toHaveCount(0);
      await expect(page.getByText('Ada Lovelace', { exact: true })).toHaveCount(
        0,
      );
      expect(metadataRequests).toContain(`/events/${id}/public`);
      const response = await context.request.get(`/events/${id}/public`);
      expect(response.status()).toBe(404);
    }
  });
});
