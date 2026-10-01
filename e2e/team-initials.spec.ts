import { test, expect } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';
import {
  deleteSessionsForUser,
  seedAdminSession,
  setSessionCookie,
} from './helpers/session';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const EVENT_NAME = 'E2E Team Initials Event';
const TEMPLATE_NAME = 'E2E Team Initials Sheet';
const ACCESS_CODE = 'e2e-team-initials-code';

const TEAMS = [
  { number: 301, name: 'Initial Alpha' },
  { number: 302, name: 'Initial Beta' },
];

let eventId: number;
let teamIds: number[];
let templateId: number;
let admin: Awaited<ReturnType<typeof seedAdminSession>>;

function buildSchema(evtId: number) {
  return {
    title: TEMPLATE_NAME,
    mode: 'head-to-head',
    eventId: evtId,
    scoreDestination: 'db',
    layout: 'two-column',
    requireTeamInitials: true,
    bracketSource: { type: 'db', scope: 'event', eventId: evtId },
    teamsDataSource: { type: 'db', eventId: evtId },
    fields: [
      {
        id: 'game_number',
        label: 'Select Game',
        type: 'dropdown',
        required: true,
        dataSource: { type: 'bracket' },
      },
      {
        id: 'team_a_score',
        label: 'Team A Score',
        type: 'number',
        min: 0,
        column: 'left',
      },
      {
        id: 'team_b_score',
        label: 'Team B Score',
        type: 'number',
        min: 0,
        column: 'right',
      },
      {
        id: 'winner',
        label: 'Winner',
        type: 'winner-select',
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Data lifecycle – serial so state flows across tests               */
/* ------------------------------------------------------------------ */

test.describe('Team Initials E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const db = e2eDb();

    admin = await seedAdminSession({
      name: 'E2E Initials Admin',
      email: 'e2e-initials@test.com',
      googleId: 'google-e2e-initials',
    });

    const ev = await db.run(
      `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
       VALUES (?, 'active', 3, 'manual') RETURNING id`,
      [EVENT_NAME],
    );
    eventId = Number(ev.lastID);

    teamIds = [];
    for (const t of TEAMS) {
      const r = await db.run(
        `INSERT INTO teams (event_id, team_number, team_name, status)
         VALUES (?, ?, ?, 'checked_in') RETURNING id`,
        [eventId, t.number, t.name],
      );
      teamIds.push(Number(r.lastID));
    }

    const bracket = await db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status)
       VALUES (?, 'E2E Initials Bracket', 2, 'in_progress') RETURNING id`,
      [eventId],
    );
    await db.run(
      `INSERT INTO bracket_games (bracket_id, game_number, round_name, round_number, bracket_side, team1_id, team2_id, status)
       VALUES (?, 1, 'Finals', 1, 'winners', ?, ?, 'ready') RETURNING id`,
      [Number(bracket.lastID), teamIds[0], teamIds[1]],
    );

    const tpl = await db.run(
      `INSERT INTO scoresheet_templates (name, description, schema, access_code, is_active)
       VALUES (?, 'E2E team initials template', ?, ?, TRUE) RETURNING id`,
      [TEMPLATE_NAME, JSON.stringify(buildSchema(eventId)), ACCESS_CODE],
    );
    templateId = Number(tpl.lastID);
    await db.run(
      `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type)
       VALUES (?, ?, 'bracket') RETURNING id`,
      [eventId, templateId],
    );
  });

  test.afterAll(async () => {
    const db = e2eDb();

    await db.run('DELETE FROM score_submissions WHERE event_id = ?', [eventId]);
    await db.run(
      `DELETE FROM bracket_games WHERE bracket_id IN
       (SELECT id FROM brackets WHERE event_id = ?)`,
      [eventId],
    );
    await db.run('DELETE FROM brackets WHERE event_id = ?', [eventId]);
    if (templateId) {
      await db.run(
        'DELETE FROM event_scoresheet_templates WHERE template_id = ?',
        [templateId],
      );
      await db.run('DELETE FROM scoresheet_templates WHERE id = ?', [
        templateId,
      ]);
    }
    await db.run('DELETE FROM audit_log WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM teams WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM events WHERE id = ?', [eventId]);
    await deleteSessionsForUser(admin.adminUserId);
    await db.run('DELETE FROM users WHERE id = ?', [admin.adminUserId]);

    await closeE2eDb();
  });

  test('judge cannot submit a disqualification until both teams initial', async ({
    page,
  }) => {
    await page.goto('/judge');
    await page.locator('.template-card', { hasText: TEMPLATE_NAME }).click();
    await page
      .getByPlaceholder('Enter code provided by administrator')
      .fill(ACCESS_CODE);
    await page.getByRole('button', { name: 'Access Scoresheet' }).click();
    await page.waitForURL(/\/scoresheet/, { timeout: 10_000 });

    const gameSelect = page
      .locator('.scoresheet-header-fields')
      .locator('select')
      .first();
    const gameOption = gameSelect.locator(
      'option:not([value=""]):not([disabled])',
    );
    await expect(gameOption.first()).toBeAttached({ timeout: 10_000 });
    await gameSelect.selectOption(
      (await gameOption.first().getAttribute('value'))!,
    );

    await page.getByRole('button', { name: 'Disqualification' }).click();
    await page.getByRole('button', { name: `DQ ${TEAMS[1].number}` }).click();
    await page
      .getByLabel('Private reason or rule reference')
      .fill('Rule 4.2 violation');

    const signoff = page.locator('.team-initials-container');
    await expect(signoff).toContainText(
      `${TEAMS[1].number} disqualified – ${TEAMS[0].number} advances`,
    );

    // Blank initials block the submission before the confirm dialog.
    let confirmShown = false;
    page.on('dialog', (dialog) => {
      confirmShown = true;
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Submit Disqualification' }).click();
    await expect(signoff.locator('.team-initials-error')).toHaveCount(2);
    await expect(signoff.locator('#team-initials-team_a')).toBeFocused();
    expect(confirmShown).toBe(false);

    await signoff.locator('#team-initials-team_a').fill('ab');
    await signoff.locator('#team-initials-team_b').fill('c.d.');
    await expect(signoff.locator('.team-initials-error')).toHaveCount(0);

    await page.getByRole('button', { name: 'Submit Disqualification' }).click();
    await expect(page.getByText('Score submitted successfully!')).toBeVisible({
      timeout: 5_000,
    });
    expect(confirmShown).toBe(true);

    const stored = await e2eDb().get<{
      result_type: string;
      team_a_initials: string;
      team_b_initials: string;
    }>(
      `SELECT result_type, team_a_initials, team_b_initials
       FROM score_submissions WHERE event_id = ?`,
      [eventId],
    );
    expect(stored).toEqual({
      result_type: 'disqualification',
      team_a_initials: 'AB',
      team_b_initials: 'CD',
    });
  });

  test('admin sees the initials read-only in the score view', async ({
    page,
  }) => {
    await setSessionCookie(page, admin.signedCookie);
    await page.goto(`/admin/events/${eventId}?view=scoring`);
    await expect(page.getByRole('heading', { name: 'Scoring' })).toBeVisible({
      timeout: 15_000,
    });

    const scoreTypeFilter = page.locator('select.field-input').nth(1);
    await scoreTypeFilter.selectOption('bracket');

    const pendingRow = page
      .locator('table tbody tr')
      .filter({ hasText: 'Pending' })
      .first();
    await expect(pendingRow).toBeVisible({ timeout: 10_000 });
    await expect(pendingRow).not.toContainText('No initials');

    await pendingRow
      .getByRole('button', { name: /View|Edit/ })
      .first()
      .click();
    const signoff = page.locator('.score-view-signoff-panel');
    await expect(signoff).toBeVisible();
    await expect(signoff.locator('.score-view-signoff-initials')).toHaveText([
      'AB',
      'CD',
    ]);
    await expect(signoff.locator('input')).toHaveCount(0);
  });
});
