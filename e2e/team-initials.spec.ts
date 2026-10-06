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
const TEMPLATE_NAME = 'E2E Initials Head-to-Head';
const ACCESS_CODE = 'e2e-team-initials-code';
const TEAM_A = { number: 301, name: 'Initial Alphas' };
const TEAM_B = { number: 302, name: 'Initial Betas' };

/* ------------------------------------------------------------------ */
/*  Shared state seeded in beforeAll                                  */
/* ------------------------------------------------------------------ */

let eventId: number;
let templateId: number;
let gameId: number;
let admin: Awaited<ReturnType<typeof seedAdminSession>>;

function buildSchema(evtId: number, bracketId: number) {
  return {
    title: TEMPLATE_NAME,
    mode: 'head-to-head',
    eventId: evtId,
    scoreDestination: 'db',
    layout: 'two-column',
    teamInitials: { required: true },
    bracketSource: { type: 'db', bracketId },
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
        max: 100,
        column: 'left',
      },
      {
        id: 'team_b_score',
        label: 'Team B Score',
        type: 'number',
        min: 0,
        max: 100,
        column: 'right',
      },
      {
        id: 'team_a_total',
        label: 'Team A Total',
        type: 'calculated',
        formula: 'team_a_score',
        isTotal: true,
      },
      {
        id: 'team_b_total',
        label: 'Team B Total',
        type: 'calculated',
        formula: 'team_b_score',
        isTotal: true,
      },
      { id: 'winner', label: 'Winner', type: 'winner-select' },
    ],
  };
}

test.describe('Team initials E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const db = e2eDb();

    admin = await seedAdminSession({
      name: 'E2E Initials Admin',
      email: 'e2e-initials@test.com',
      googleId: 'google-e2e-initials',
    });

    const ev = await db.run(
      `INSERT INTO events (name, status, score_accept_mode)
       VALUES (?, 'active', 'manual') RETURNING id`,
      [EVENT_NAME],
    );
    eventId = Number(ev.lastID);

    const teamIds: number[] = [];
    for (const team of [TEAM_A, TEAM_B]) {
      const row = await db.run(
        `INSERT INTO teams (event_id, team_number, team_name, status)
         VALUES (?, ?, ?, 'checked_in') RETURNING id`,
        [eventId, team.number, team.name],
      );
      teamIds.push(Number(row.lastID));
    }

    const bracket = await db.run(
      `INSERT INTO brackets (event_id, name, bracket_size)
       VALUES (?, 'Initials Bracket', 2) RETURNING id`,
      [eventId],
    );
    const bracketId = Number(bracket.lastID);
    const game = await db.run(
      `INSERT INTO bracket_games (bracket_id, game_number, round_number, bracket_side, team1_id, team2_id, status)
       VALUES (?, 1, 1, 'winners', ?, ?, 'ready') RETURNING id`,
      [bracketId, teamIds[0], teamIds[1]],
    );
    gameId = Number(game.lastID);

    const tpl = await db.run(
      `INSERT INTO scoresheet_templates (name, description, schema, access_code, is_active)
       VALUES (?, 'E2E initials template', ?, ?, TRUE) RETURNING id`,
      [
        TEMPLATE_NAME,
        JSON.stringify(buildSchema(eventId, bracketId)),
        ACCESS_CODE,
      ],
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
    await db.run('DELETE FROM game_queue WHERE event_id = ?', [eventId]);
    await db.run(
      `DELETE FROM bracket_games WHERE bracket_id IN
       (SELECT id FROM brackets WHERE event_id = ?)`,
      [eventId],
    );
    await db.run('DELETE FROM brackets WHERE event_id = ?', [eventId]);
    await db.run(
      'DELETE FROM event_scoresheet_templates WHERE template_id = ?',
      [templateId],
    );
    await db.run('DELETE FROM scoresheet_templates WHERE id = ?', [templateId]);
    await db.run('DELETE FROM audit_log WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM teams WHERE event_id = ?', [eventId]);
    await db.run('DELETE FROM events WHERE id = ?', [eventId]);
    await deleteSessionsForUser(admin.adminUserId);
    await db.run('DELETE FROM users WHERE id = ?', [admin.adminUserId]);

    await closeE2eDb();
  });

  test('a disqualification cannot be submitted until both teams initial', async ({
    page,
  }) => {
    // Record alerts and accept the DQ confirmation.
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });

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
    await expect(gameSelect.locator(`option[value="${gameId}"]`)).toBeAttached({
      timeout: 10_000,
    });
    await gameSelect.selectOption(String(gameId));

    const teamAScore = page
      .locator('.scoresheet-column')
      .first()
      .locator('input[type="number"]');
    await teamAScore.fill('40');
    await page
      .locator('.scoresheet-column')
      .nth(1)
      .locator('input[type="number"]')
      .fill('20');

    await page.getByRole('button', { name: 'Disqualification' }).click();
    await page.getByRole('button', { name: `DQ ${TEAM_B.number}` }).click();
    await page.locator('.dq-reason-input').fill('Rule 4.2: left the table');

    const panel = page.locator('.team-initials-container');
    await expect(panel).toContainText(
      `Disqualification: Team ${TEAM_B.number}`,
    );
    const teamAInitials = page.locator('#team-initials-team_a');
    const teamBInitials = page.locator('#team-initials-team_b');

    // Only one team initials: the submission is blocked.
    await teamAInitials.fill('ab');
    const submit = page.getByRole('button', {
      name: 'Submit Disqualification',
    });
    await submit.click();
    await expect
      .poll(() => dialogs.at(-1))
      .toContain(`Team ${TEAM_B.number} must initial the score sheet`);
    await expect(teamBInitials).toBeFocused();

    // A score change after both teams initialed clears their initials.
    await teamBInitials.fill('cd');
    await teamAScore.fill('45');
    await expect(teamAInitials).toHaveValue('');
    await expect(teamBInitials).toHaveValue('');
    await expect(panel.locator('.team-initials-stale')).toContainText(
      'The sheet changed after',
    );

    // Initialing again lets the DQ through.
    await teamAInitials.fill('a.b');
    await teamBInitials.fill('cd');
    await submit.click();
    await expect(page.getByText('Score submitted successfully!')).toBeVisible({
      timeout: 5_000,
    });

    const rows = await e2eDb().all<{ side: string; initials: string }>(
      `SELECT sti.side, sti.initials FROM score_team_initials sti
       JOIN score_submissions s ON s.id = sti.score_submission_id
       WHERE s.event_id = ? ORDER BY sti.side`,
      [eventId],
    );
    expect(rows).toEqual([
      { side: 'team_a', initials: 'AB' },
      { side: 'team_b', initials: 'CD' },
    ]);
  });

  test('admins see the initials read-only on the score', async ({ page }) => {
    await setSessionCookie(page, admin.signedCookie);
    await page.goto(`/admin/events/${eventId}?view=scoring`);
    await expect(page.getByRole('heading', { name: 'Scoring' })).toBeVisible({
      timeout: 15_000,
    });

    await page.locator('select.field-input').nth(1).selectOption('bracket');
    const pendingRow = page
      .locator('table tbody tr')
      .filter({ hasText: 'Pending' })
      .first();
    await expect(pendingRow).toBeVisible({ timeout: 10_000 });
    await pendingRow.getByRole('button', { name: 'View Details' }).click();

    const initials = page.locator('.score-view-initials-panel');
    await expect(initials).toContainText(`Team ${TEAM_A.number}: AB`);
    await expect(initials).toContainText(`Team ${TEAM_B.number}: CD`);
    await expect(initials.locator('input')).toHaveCount(0);
  });
});
