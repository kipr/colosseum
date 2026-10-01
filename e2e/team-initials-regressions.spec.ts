import { test, expect, type Page } from '@playwright/test';
import { closeE2eDb, e2eDb } from './helpers/db';
import {
  deleteSessionsForUser,
  seedAdminSession,
  setSessionCookie,
} from './helpers/session';

type ScoreType = 'seeding' | 'bracket' | 'double_seeding';
type Totals = 'direct' | 'calculated' | 'zero';

const TEMPLATE_NAME = 'E2E Initials Regression Sheet';
const ACCESS_CODE = 'e2e-initials-regression-code';
const TEAM_A = 401;
const TEAM_B = 402;

let eventId: number | undefined;
let templateId: number | undefined;
let gameId: number;
let teamIds: number[];
let admin: Awaited<ReturnType<typeof seedAdminSession>> | undefined;

function buildSchema(scoreType: ScoreType, totals: Totals, required: boolean) {
  const fields = [
    ...(scoreType === 'bracket'
      ? [
          {
            id: 'game_number',
            label: 'Select Game',
            type: 'dropdown',
            required: true,
            dataSource: { type: 'bracket' },
          },
        ]
      : scoreType === 'seeding'
        ? [
            { id: 'team_number', label: 'Team Number', type: 'text' },
            { id: 'team_name', label: 'Team Name', type: 'text' },
            { id: 'round', label: 'Round', type: 'number' },
          ]
        : []),
    {
      id: 'team_a_score',
      label: 'Team A Score',
      type: 'number',
      min: 0,
      column: 'left',
    },
    ...(scoreType === 'seeding'
      ? [
          {
            id: 'grand_total',
            label: 'Total Score',
            type: 'calculated',
            formula: 'team_a_score',
            isGrandTotal: true,
          },
        ]
      : [
          {
            id: 'team_b_score',
            label: 'Team B Score',
            type: 'number',
            min: 0,
            column: 'right',
          },
          ...(totals === 'direct'
            ? []
            : ['a', 'b'].map((side) => ({
                id: `team_${side}_total`,
                label: `Team ${side.toUpperCase()} Total`,
                type: 'calculated',
                formula: `team_${side}_score${totals === 'zero' ? ' * 0' : ''}`,
                column: side === 'a' ? 'left' : 'right',
              }))),
        ]),
    ...(scoreType === 'bracket'
      ? [{ id: 'winner', label: 'Winner', type: 'winner-select' }]
      : []),
  ];

  return {
    title: TEMPLATE_NAME,
    mode: scoreType === 'bracket' ? 'head-to-head' : 'single',
    ...(scoreType === 'double_seeding' ? { scoreKind: scoreType } : {}),
    eventId,
    scoreDestination: 'db',
    layout: 'two-column',
    requireTeamInitials: required,
    bracketSource: { type: 'db', scope: 'event', eventId },
    teamsDataSource: { type: 'db', eventId },
    fields,
  };
}

async function seedScenario(
  scoreType: ScoreType,
  totals: Totals = 'calculated',
  required = true,
) {
  const db = e2eDb();
  const event = await db.run(
    `INSERT INTO events (name, status, seeding_rounds, score_accept_mode)
     VALUES ('E2E Initials Regression Event', 'active', 1, 'manual') RETURNING id`,
  );
  eventId = Number(event.lastID);
  teamIds = [];
  for (const [number, name] of [
    [TEAM_A, 'Regression Alpha'],
    [TEAM_B, 'Regression Beta'],
  ] as const) {
    const team = await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, status)
       VALUES (?, ?, ?, 'checked_in') RETURNING id`,
      [eventId, number, name],
    );
    teamIds.push(Number(team.lastID));
  }

  if (scoreType === 'bracket') {
    const bracket = await db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, status)
       VALUES (?, 'Initials Regression Bracket', 2, 'in_progress') RETURNING id`,
      [eventId],
    );
    const game = await db.run(
      `INSERT INTO bracket_games
       (bracket_id, game_number, round_name, round_number, bracket_side, team1_id, team2_id, status)
       VALUES (?, 1, 'Finals', 1, 'winners', ?, ?, 'ready') RETURNING id`,
      [Number(bracket.lastID), ...teamIds],
    );
    gameId = Number(game.lastID);
  } else if (scoreType === 'seeding') {
    await db.run(
      `INSERT INTO game_queue
       (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
       VALUES (?, ?, 1, 'seeding', 1, 'queued')`,
      [eventId, teamIds[0]],
    );
  } else {
    const match = await db.run(
      `INSERT INTO double_seeding_matches
       (event_id, round_number, match_number, team1_id, team2_id, status)
       VALUES (?, 1, 1, ?, ?, 'ready') RETURNING id`,
      [eventId, ...teamIds],
    );
    await db.run(
      `INSERT INTO game_queue
       (event_id, double_seeding_match_id, queue_type, queue_position, status)
       VALUES (?, ?, 'double_seeding', 1, 'queued')`,
      [eventId, Number(match.lastID)],
    );
  }

  const template = await db.run(
    `INSERT INTO scoresheet_templates (name, schema, access_code, is_active)
     VALUES (?, ?, ?, TRUE) RETURNING id`,
    [
      TEMPLATE_NAME,
      JSON.stringify(buildSchema(scoreType, totals, required)),
      ACCESS_CODE,
    ],
  );
  templateId = Number(template.lastID);
  await db.run(
    `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type)
     VALUES (?, ?, ?)`,
    [eventId, templateId, scoreType],
  );
}

function scoreInput(page: Page, side: 'A' | 'B') {
  return page
    .locator('.score-field')
    .filter({ hasText: `Team ${side} Score` })
    .locator('input[type="number"]');
}

async function enterScoresheet(page: Page, scoreType: ScoreType) {
  await page.goto('/judge');
  await page.locator('.template-card', { hasText: TEMPLATE_NAME }).click();
  await page
    .getByPlaceholder('Enter code provided by administrator')
    .fill(ACCESS_CODE);
  await page.getByRole('button', { name: 'Access Scoresheet' }).click();
  await page.waitForURL(/\/scoresheet/);

  const select = page.locator('.scoresheet-form select').first();
  const option = select
    .locator('option:not([value=""]):not([disabled])')
    .first();
  await expect(option).toBeAttached();
  await select.selectOption((await option.getAttribute('value'))!);
  await scoreInput(page, 'A').fill('40');
  if (scoreType !== 'seeding') await scoreInput(page, 'B').fill('15');
  if (scoreType === 'bracket')
    await page.locator('.winner-button').first().click();
}

async function initialTeams(page: Page, scoreType: ScoreType) {
  await page.locator('#team-initials-team_a').fill('AB');
  if (scoreType !== 'seeding')
    await page.locator('#team-initials-team_b').fill('CD');
  // Catch accidental invalidation while another representative initials.
  await expect(page.locator('#team-initials-team_a')).toHaveValue('AB');
}

async function submitScore(page: Page, scoreType: ScoreType) {
  await page
    .getByRole('button', {
      name: scoreType === 'bracket' ? 'Submit Winner' : 'Submit Score',
      exact: true,
    })
    .click();
  await expect(page.getByText('Score submitted successfully!')).toBeVisible();
}

async function storedSubmission() {
  const row = await e2eDb().get<{
    score_data: string;
    team_a_initials: string | null;
    team_b_initials: string | null;
    scores_edited_at: string | null;
  }>('SELECT * FROM score_submissions WHERE template_id = ?', [templateId]);
  expect(row).toBeDefined();
  return { ...row!, data: JSON.parse(row!.score_data) };
}

test.describe('Team initials regressions', () => {
  // Each test owns its rows; failures must not skip later regression cases.
  test.beforeEach(() => {
    eventId = undefined;
    templateId = undefined;
    admin = undefined;
  });

  test.afterEach(async () => {
    const db = e2eDb();
    if (eventId) {
      await db.run('DELETE FROM score_submissions WHERE event_id = ?', [
        eventId,
      ]);
      await db.run('DELETE FROM game_queue WHERE event_id = ?', [eventId]);
      await db.run('DELETE FROM audit_log WHERE event_id = ?', [eventId]);
      await db.run('DELETE FROM events WHERE id = ?', [eventId]);
    }
    if (templateId)
      await db.run('DELETE FROM scoresheet_templates WHERE id = ?', [
        templateId,
      ]);
    if (admin) {
      await deleteSessionsForUser(admin.adminUserId);
      await db.run('DELETE FROM users WHERE id = ?', [admin.adminUserId]);
    }
    await closeE2eDb();
  });

  for (const scoreType of ['seeding', 'bracket', 'double_seeding'] as const) {
    test(`${scoreType}: changing a score clears initials and requires fresh sign-off`, async ({
      page,
    }) => {
      await seedScenario(scoreType);
      await enterScoresheet(page, scoreType);
      const summary = page.locator('.team-initials-summary');
      await expect(summary).toContainText('40');
      await initialTeams(page, scoreType);

      // Same match, teams, round and winner; only the attested score changes.
      await scoreInput(page, 'A').fill('45');
      await expect(summary).toContainText('45');
      if (scoreType === 'bracket') {
        await expect(page.locator('.winner-button').first()).toHaveClass(
          /selected/,
        );
      }
      await expect(page.locator('#team-initials-team_a')).toHaveValue('');
      if (scoreType !== 'seeding')
        await expect(page.locator('#team-initials-team_b')).toHaveValue('');

      const submitRequests: string[] = [];
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          request.url().endsWith('/api/scores/submit')
        ) {
          submitRequests.push(request.url());
        }
      });
      await page
        .getByRole('button', {
          name: scoreType === 'bracket' ? 'Submit Winner' : 'Submit Score',
          exact: true,
        })
        .click();
      await expect(page.locator('.team-initials-error')).toHaveCount(
        scoreType === 'seeding' ? 1 : 2,
      );
      expect(submitRequests).toEqual([]);
      const count = await e2eDb().get<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM score_submissions WHERE template_id = ?',
        [templateId],
      );
      expect(count?.count).toBe(0);

      await initialTeams(page, scoreType);
      await submitScore(page, scoreType);
      const stored = await storedSubmission();
      expect(stored.team_a_initials).toBe('AB');
      expect(stored.team_b_initials).toBe(
        scoreType === 'seeding' ? null : 'CD',
      );
      const totalId =
        scoreType === 'seeding'
          ? 'grand_total'
          : scoreType === 'bracket'
            ? 'team1_score'
            : 'team_a_total';
      expect(Number(stored.data[totalId].value)).toBe(45);
    });
  }

  for (const scoreType of ['bracket', 'double_seeding'] as const) {
    for (const totals of ['direct', 'zero'] as const) {
      test(`${scoreType}: sign-off summary matches submitted ${totals === 'direct' ? 'direct scores without calculated totals' : 'calculated zero totals'}`, async ({
        page,
      }) => {
        await seedScenario(scoreType, totals);
        await enterScoresheet(page, scoreType);
        const summary = await page
          .locator('.team-initials-summary')
          .innerText();
        await initialTeams(page, scoreType);
        await submitScore(page, scoreType);

        const stored = await storedSubmission();
        const a = Number(
          stored.data[scoreType === 'bracket' ? 'team1_score' : 'team_a_total']
            .value,
        );
        const b = Number(
          stored.data[scoreType === 'bracket' ? 'team2_score' : 'team_b_total']
            .value,
        );
        expect([a, b]).toEqual(totals === 'direct' ? [40, 15] : [0, 0]);
        expect(summary).toBe(
          scoreType === 'bracket'
            ? `${TEAM_A} wins (${a} – ${b})`
            : `${TEAM_A}: ${a} · ${TEAM_B}: ${b}`,
        );
      });
    }
  }

  for (const signoff of [
    'opted out',
    'historical missing',
    'recorded',
    'legacy recorded',
  ] as const) {
    test(`admin edit: ${signoff} initials ${signoff.includes('recorded') ? 'show' : 'do not imply'} post-sign-off changes`, async ({
      page,
    }) => {
      await seedScenario('bracket', 'direct', signoff !== 'opted out');
      const signed = signoff.includes('recorded');
      const legacy = signoff === 'legacy recorded';
      const data = {
        team_a_score: { label: 'Team A Score', type: 'number', value: 40 },
        team_b_score: { label: 'Team B Score', type: 'number', value: 15 },
        winner: { label: 'Winner', type: 'winner-select', value: 'team_a' },
        winner_team_id: {
          label: 'Winner Team ID',
          type: 'number',
          value: teamIds[0],
        },
        ...(legacy
          ? {
              team_a_team_initials: {
                label: 'Team Initials',
                type: 'text',
                value: 'AB',
              },
            }
          : {}),
      };
      const submission = await e2eDb().run(
        `INSERT INTO score_submissions
         (template_id, event_id, bracket_game_id, score_type, participant_name, score_data, team_a_initials, team_b_initials)
         VALUES (?, ?, ?, 'bracket', 'Initials regression submission', ?, ?, ?) RETURNING id`,
        [
          templateId,
          eventId,
          gameId,
          JSON.stringify(data),
          signed && !legacy ? 'AB' : null,
          signed && !legacy ? 'CD' : null,
        ],
      );
      admin = await seedAdminSession({
        name: 'Initials Regression Admin',
        email: 'initials-regression@test.com',
      });
      await setSessionCookie(page, admin.signedCookie);
      await page.goto(`/admin/events/${eventId}?view=scoring`);
      await expect(
        page.getByRole('heading', { name: 'Scoring' }),
      ).toBeVisible();
      await page.locator('select.field-input').nth(1).selectOption('bracket');
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: 'Pending' })
        .first();
      const open = () =>
        row
          .getByRole('button', { name: /View|Edit/ })
          .first()
          .click();
      await open();
      await expect(scoreInput(page, 'A')).toHaveValue('40');
      const warning = page.getByText(/Scores edited after team sign-off/);
      await expect(warning).toHaveCount(0);
      await scoreInput(page, 'A').fill('45');
      page.on('dialog', (dialog) => void dialog.accept());
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().endsWith(`/scores/${submission.lastID}`),
      );
      await page.getByRole('button', { name: 'Save Changes' }).click();
      expect((await saved).ok()).toBe(true);
      await expect(
        page.getByRole('button', { name: 'Save Changes' }),
      ).toHaveCount(0);

      const stored = await storedSubmission();
      expect(stored.scores_edited_at).not.toBeNull();
      expect(Number(stored.data.team_a_score.value)).toBe(45);
      // Load the persisted submission rather than racing the table refresh.
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Scoring' }),
      ).toBeVisible();
      await page.locator('select.field-input').nth(1).selectOption('bracket');
      await open();
      await expect(scoreInput(page, 'A')).toHaveValue('45');
      if (signed) {
        await expect(page.locator('.score-view-signoff-initials')).toHaveText(
          legacy ? ['AB'] : ['AB', 'CD'],
        );
        await expect(warning).toBeVisible();
      } else {
        await expect(page.locator('.score-view-signoff-initials')).toHaveCount(
          0,
        );
        await expect(warning).toHaveCount(0);
      }
    });
  }
});
