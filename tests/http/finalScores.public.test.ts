/** Anonymous spectator reads: placement must never change lifecycle/release gates. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
import { resetAllRateLimiters } from '../../src/server/middleware/rateLimit';
import {
  createTestApp,
  startServer,
  TestServerHandle,
  http,
} from './helpers/testServer';
import {
  seedEvent,
  seedUser,
  seedTeam,
  seedBracket,
  seedBracketGame,
  seedDocumentationScore,
  seedDocumentationScoreCategory,
  seedDocumentationSubScore,
  seedSeedingScore,
  seedDoubleSeedingMatch,
  seedDoubleSeedingScore,
  seedEventAward,
  seedEventAwardRecipient,
  seedEventAwardIndividualRecipient,
} from './helpers/seed';
import eventsRoutes from '../../src/server/routes/events';
import bracketsRoutes from '../../src/server/routes/brackets';
import docScoresRoutes from '../../src/server/routes/documentationScores';
import seedingRoutes from '../../src/server/routes/seeding';
import doubleSeedingRoutes from '../../src/server/routes/doubleSeeding';
import awardsRoutes from '../../src/server/routes/awards';
import teamsRoutes from '../../src/server/routes/teams';

type Listing = 'current' | 'archive';
type Lifecycle = 'setup' | 'active' | 'complete' | 'archived';
interface VisibilityCase {
  listing: Listing;
  status: Lifecycle;
  released: boolean;
}

const matrix: VisibilityCase[] = (['current', 'archive'] as const).flatMap(
  (listing) =>
    (['setup', 'active', 'complete', 'archived'] as const).flatMap((status) =>
      [false, true].map((released) => ({ listing, status, released })),
    ),
);

const isReleased = ({ status, released }: VisibilityCase) =>
  status === 'complete' && released;

describe('Public Final Scores API (anonymous)', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    resetAllRateLimiters();
    const app = createTestApp();
    app.use('/events', eventsRoutes);
    app.use('/brackets', bracketsRoutes);
    app.use('/documentation-scores', docScoresRoutes);
    app.use('/seeding', seedingRoutes);
    app.use('/double-seeding', doubleSeedingRoutes);
    app.use('/awards', awardsRoutes);
    app.use('/teams', teamsRoutes);
    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    resetAllRateLimiters();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  async function createFixture(
    visibility: VisibilityCase,
    tag: string,
    teamNumber: number,
  ) {
    const seasonResult = await testDb.db.run(
      'INSERT INTO seasons (name, sort_order) VALUES (?, ?) RETURNING id',
      [`${tag} season`, teamNumber],
    );
    const season = {
      id: seasonResult.lastID!,
      name: `${tag} season`,
      sort_order: teamNumber,
    };
    const event = await seedEvent(testDb.db, {
      name: `${tag} event`,
      status: visibility.status,
      event_date: '2026-03-01',
      location: `${tag} arena`,
      double_seeding_rounds: 1,
      description: `${tag} PRIVATE description`,
      score_accept_mode: 'auto_accept_all',
    });
    // Direct SQL deliberately preserves stale release flags on setup/active/hidden events.
    await testDb.db.run(
      `UPDATE events SET spectator_listing = ?, season_id = ?, spectator_results_released = ?,
       created_at = '2026-01-01 00:00:00' WHERE id = ?`,
      [visibility.listing, season.id, visibility.released ? 1 : 0, event.id],
    );
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: teamNumber,
      team_name: `${tag} team`,
      display_name: `${tag} display`,
    });
    const identity = {
      team_number: teamNumber,
      team_name: `${tag} team`,
      display_name: `${tag} display`,
    };
    const category = await seedDocumentationScoreCategory(testDb.db, {
      event_id: event.id,
      ordinal: 1,
      name: `${tag} design`,
      max_score: 100,
    });
    const doc = await seedDocumentationScore(testDb.db, {
      event_id: event.id,
      team_id: team.id,
      overall_score: 0.5,
    });
    await seedDocumentationSubScore(testDb.db, {
      documentation_score_id: doc.id,
      category_id: category.id,
      score: 50,
    });
    const seedingScore = await seedSeedingScore(testDb.db, {
      team_id: team.id,
      round_number: 1,
      score: 100,
    });
    await testDb.db.run(
      'INSERT INTO seeding_rankings (team_id, seed_rank, raw_seed_score) VALUES (?, 1, 0.25)',
      [team.id],
    );
    const doubleMatch = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      match_number: 1,
      team1_id: team.id,
    });
    const doubleScore = await seedDoubleSeedingScore(testDb.db, {
      event_id: event.id,
      match_id: doubleMatch.id,
      team_id: team.id,
      round_number: 1,
      side: 'team1',
      score: 25,
    });
    await testDb.db.run(
      'INSERT INTO double_seeding_rankings (team_id, seed_rank, raw_double_seed_score) VALUES (?, 1, 0.125)',
      [team.id],
    );
    const bracket = await seedBracket(testDb.db, {
      event_id: event.id,
      name: `${tag} bracket`,
      status: 'completed',
      actual_team_count: 1,
    });
    const entry = await testDb.db.run(
      `INSERT INTO bracket_entries (
         bracket_id, team_id, seed_position, initial_slot, is_bye,
         final_rank, bracket_raw_score, weighted_bracket_raw_score
       ) VALUES (?, ?, 1, 5, FALSE, 1, 1, 1) RETURNING id`,
      [bracket.id, team.id],
    );
    const game = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 1,
      team1_id: team.id,
    });
    const award = await seedEventAward(testDb.db, {
      event_id: event.id,
      name: `${tag} award`,
    });
    await seedEventAwardRecipient(testDb.db, {
      event_award_id: award.id,
      team_id: team.id,
    });
    await seedEventAwardIndividualRecipient(testDb.db, {
      event_award_id: award.id,
      name: `${tag} mentor`,
      team_id: team.id,
    });

    return {
      event,
      season,
      team,
      bracket,
      entryId: entry.lastID!,
      game,
      seedingScore,
      doubleMatch,
      doubleScore,
      metadata: {
        id: event.id,
        name: `${tag} event`,
        status: visibility.status,
        event_date: '2026-03-01',
        location: `${tag} arena`,
        seeding_rounds: 3,
        double_seeding_rounds: 1,
        final_scores_available: isReleased(visibility),
        spectator_listing: visibility.listing,
        season_id: season.id,
        season_name: season.name,
        season_sort_order: season.sort_order,
      },
      documentation: {
        categories: [
          {
            id: category.id,
            name: `${tag} design`,
            weight: 1,
            max_score: 100,
            ordinal: 1,
          },
        ],
        scores: [
          {
            team_id: team.id,
            overall_score: 0.5,
            ...identity,
            sub_scores: [
              {
                category_id: category.id,
                category_name: `${tag} design`,
                ordinal: 1,
                max_score: 100,
                weight: 1,
                score: 50,
              },
            ],
          },
        ],
      },
      awards: {
        manual: [
          {
            name: `${tag} award`,
            description: null,
            sort_order: 0,
            recipients: [identity],
            individual_recipients: [{ name: `${tag} mentor`, ...identity }],
          },
        ],
        automatic: {
          de: [
            {
              bracket_id: bracket.id,
              bracket_name: `${tag} bracket`,
              placements: [{ place: 1, medal: 'gold', recipients: [identity] }],
            },
          ],
          perBracketOverall: [],
          seeding: {
            placements: [{ place: 1, medal: 'gold', recipients: [identity] }],
          },
          settings: {
            de_top_n: 3,
            per_bracket_overall_top_n: 3,
            seeding_top_n: 3,
            de_award_type: 'trophy',
            per_bracket_overall_award_type: 'trophy',
            seeding_award_type: 'trophy',
          },
        },
      },
      rankings: {
        weight: 1,
        entries: [
          {
            id: entry.lastID!,
            bracket_id: bracket.id,
            team_id: team.id,
            seed_position: 1,
            is_bye: false,
            final_rank: 1,
            bracket_raw_score: 1,
            weighted_bracket_raw_score: 1,
            doc_score: 0.5,
            raw_seed_score: 0.25,
            raw_double_seed_score: 0.125,
            total: 1.875,
            ...identity,
          },
        ],
      },
      overall: [
        {
          team_id: team.id,
          ...identity,
          doc_score: 0.5,
          raw_seed_score: 0.25,
          raw_double_seed_score: 0.125,
          weighted_de_score: 1,
          total: 1.875,
        },
      ],
    };
  }

  type Fixture = Awaited<ReturnType<typeof createFixture>>;

  function finalEndpoints(fixture: Fixture) {
    return [
      `/documentation-scores/event/${fixture.event.id}/public`,
      `/awards/event/${fixture.event.id}/public`,
      `/brackets/${fixture.bracket.id}/rankings/public`,
      `/events/${fixture.event.id}/overall/public`,
    ];
  }

  async function expectFinalResults(
    fixture: Fixture,
    allowed: boolean,
    query = '',
  ) {
    const paths = finalEndpoints(fixture);
    const responses = await Promise.all(
      paths.map((path) => http.get(`${baseUrl}${path}${query}`)),
    );
    responses.forEach((response, i) => {
      expect(response.status, paths[i]).toBe(allowed ? 200 : 404);
      if (!allowed)
        expect(response.json, paths[i]).toEqual({ error: 'Not found' });
    });
    if (allowed) {
      expect(responses[0].json).toEqual(fixture.documentation);
      expect(responses[1].json).toEqual(fixture.awards);
      expect(responses[2].json).toEqual(fixture.rankings);
      expect(responses[3].json).toEqual(fixture.overall);
    }
  }

  describe('Auto-clear on reopen', () => {
    it.each(['current', 'archive'] as const)(
      'clears release when reopening a %s event without changing placement or season',
      async (listing) => {
        const fixture = await createFixture(
          { listing, status: 'complete', released: true },
          'Reopened sentinel',
          101,
        );
        const admin = await seedUser(testDb.db, { is_admin: true });
        const adminApp = createTestApp({
          user: { id: admin.id, is_admin: true },
        });
        adminApp.use('/events', eventsRoutes);
        const adminServer = await startServer(adminApp);

        try {
          await expectFinalResults(fixture, true);
          const readState = () =>
            testDb.db.get(
              `SELECT id, status, spectator_results_released, spectator_listing, season_id
             FROM events WHERE id = ?`,
              [fixture.event.id],
            );
          const before = await readState();
          expect(before).toEqual({
            id: fixture.event.id,
            status: 'complete',
            spectator_results_released: 1,
            spectator_listing: listing,
            season_id: fixture.season.id,
          });

          const patch = await http.patch(
            `${adminServer.baseUrl}/events/${fixture.event.id}`,
            { status: 'active' },
          );
          expect(patch.status).toBe(200);
          expect(await readState()).toEqual({
            ...before,
            status: 'active',
            spectator_results_released: 0,
          });

          const metadata = {
            ...fixture.metadata,
            status: 'active',
            final_scores_available: false,
          };
          const detail = await http.get(
            `${baseUrl}/events/${fixture.event.id}/public`,
          );
          expect(detail.status).toBe(200);
          expect(detail.json).toEqual(metadata);
          for (const [query, placement] of [
            ['', 'current'],
            ['?listing=current', 'current'],
            ['?listing=archive', 'archive'],
          ] as const) {
            const list = await http.get(`${baseUrl}/events/public${query}`);
            expect(list.status).toBe(200);
            expect(list.json).toEqual(placement === listing ? [metadata] : []);
          }
          await expectFinalResults(fixture, false);
        } finally {
          await adminServer.close();
        }
      },
    );
  });

  it('preserves populated persistent state and released results across placement and season changes', async () => {
    const fixture = await createFixture(
      { listing: 'current', status: 'complete', released: true },
      'Preserved sentinel',
      101,
    );
    const [archiveSeason, nextSeason] = await testDb.db.all<{
      id: number;
      name: string;
      sort_order: number;
    }>(
      `INSERT INTO seasons (name, sort_order) VALUES (?, 20), (?, 30)
       RETURNING id, name, sort_order`,
      ['First archive destination', 'Second archive destination'],
    );
    const admin = await seedUser(testDb.db, { is_admin: true });
    const adminApp = createTestApp({ user: { id: admin.id, is_admin: true } });
    adminApp.use('/events', eventsRoutes);
    const adminServer = await startServer(adminApp);

    try {
      // Materialize lazy derived rows before measuring placement-only mutations.
      await expectFinalResults(fixture, true);
      const tables = await testDb.db.all<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
           AND table_name NOT IN ('events', 'audit_log')
         ORDER BY table_name`,
      );
      async function snapshotTables() {
        const snapshot: Record<string, Record<string, unknown>[]> = {};
        for (const { table_name } of tables) {
          const quotedTable = `"${table_name.replace(/"/g, '""')}"`;
          const rows = await testDb.db.all<{ row: Record<string, unknown> }>(
            `SELECT to_jsonb(snapshot_row) AS row FROM ${quotedTable} AS snapshot_row
             ORDER BY to_jsonb(snapshot_row)::text`,
          );
          snapshot[table_name] = rows.map(({ row }) => row);
        }
        return snapshot;
      }
      async function snapshotEvent() {
        const row = await testDb.db.get<{ event: Record<string, unknown> }>(
          `SELECT to_jsonb(e) - 'updated_at' AS event FROM events e WHERE id = ?`,
          [fixture.event.id],
        );
        expect(row).toBeDefined();
        return row!.event;
      }
      const baselineTables = await snapshotTables();
      const baselineEvent = await snapshotEvent();
      expect(baselineEvent).toMatchObject({
        status: 'complete',
        spectator_results_released: 1,
        spectator_listing: 'current',
        season_id: fixture.season.id,
      });
      for (const table of [
        'teams',
        'bracket_entries',
        'bracket_games',
        'documentation_scores',
        'documentation_sub_scores',
        'seeding_scores',
        'seeding_rankings',
        'double_seeding_matches',
        'double_seeding_scores',
        'double_seeding_rankings',
        'event_awards',
        'event_award_recipients',
        'event_award_individual_recipients',
      ]) {
        expect(baselineTables[table], table).not.toHaveLength(0);
      }

      for (const [listing, season, payload] of [
        [
          'archive',
          archiveSeason,
          { spectator_listing: 'archive', season_id: archiveSeason.id },
        ],
        [
          'archive',
          nextSeason,
          { spectator_listing: 'archive', season_id: nextSeason.id },
        ],
        ['current', nextSeason, { spectator_listing: 'current' }],
      ] as const) {
        const patch = await http.patch(
          `${adminServer.baseUrl}/events/${fixture.event.id}`,
          payload,
        );
        expect(patch.status).toBe(200);
        const expectedEvent = {
          ...baselineEvent,
          spectator_listing: listing,
          season_id: season.id,
        };
        expect(await snapshotEvent()).toEqual(expectedEvent);
        expect(await snapshotTables()).toEqual(baselineTables);

        const metadata = {
          ...fixture.metadata,
          spectator_listing: listing,
          season_id: season.id,
          season_name: season.name,
          season_sort_order: season.sort_order,
        };
        const detail = await http.get(
          `${baseUrl}/events/${fixture.event.id}/public`,
        );
        expect(detail.status).toBe(200);
        expect(detail.json).toEqual(metadata);
        await expectFinalResults(fixture, true);
        for (const [query, placement] of [
          ['', 'current'],
          ['?listing=current', 'current'],
          ['?listing=archive', 'archive'],
        ] as const) {
          const list = await http.get(`${baseUrl}/events/public${query}`);
          expect(list.status).toBe(200);
          expect(list.json).toEqual(placement === listing ? [metadata] : []);
        }
        expect(await snapshotEvent()).toEqual(expectedEvent);
        expect(await snapshotTables()).toEqual(baselineTables);
      }
    } finally {
      await adminServer.close();
    }
  });

  it.each(matrix)(
    'gates all four populated endpoints: $listing / $status / released=$released',
    async (visibility) => {
      const fixture = await createFixture(visibility, 'Target sentinel', 101);
      const other = await createFixture(
        {
          listing: visibility.listing === 'current' ? 'archive' : 'current',
          status: 'complete',
          released: true,
        },
        'Foreign released sentinel',
        909,
      );
      await expectFinalResults(other, true);
      await expectFinalResults(fixture, isReleased(visibility));
      await expectFinalResults(
        fixture,
        isReleased(visibility),
        `?listing=archive&season_id=${other.season.id}&event_id=${other.event.id}&status=complete&spectator_results_released=1`,
      );
    },
  );

  it.each(matrix)(
    'keeps metadata/list visibility consistent: $listing / $status / released=$released',
    async (visibility) => {
      const fixture = await createFixture(visibility, 'Target sentinel', 101);
      const other = await createFixture(
        {
          listing: visibility.listing === 'current' ? 'archive' : 'current',
          status: 'complete',
          released: true,
        },
        'Foreign released sentinel',
        909,
      );
      const visible = visibility.status !== 'archived';
      for (const listing of ['current', 'archive'] as const) {
        const expected =
          listing === visibility.listing
            ? visible
              ? [fixture.metadata]
              : []
            : [other.metadata];
        const res = await http.get(
          `${baseUrl}/events/public?listing=${listing}`,
        );
        expect(res.status).toBe(200);
        expect(res.json).toEqual(expected);
        if (listing === 'current') {
          const defaultList = await http.get(`${baseUrl}/events/public`);
          expect(defaultList.status).toBe(200);
          expect(defaultList.json).toEqual(expected);
        }
        const filtered = await http.get(
          `${baseUrl}/events/public?listing=${listing}&season_id=${fixture.season.id}`,
        );
        expect(filtered.status).toBe(200);
        expect(filtered.json).toEqual(
          listing === visibility.listing && visible ? [fixture.metadata] : [],
        );
      }
      const detail = await http.get(
        `${baseUrl}/events/${fixture.event.id}/public?listing=archive`,
      );
      expect(detail.status).toBe(visible ? 200 : 404);
      expect(detail.json).toEqual(
        visible ? fixture.metadata : { error: 'Event not found' },
      );
    },
  );

  it.each(matrix.filter((row) => !isReleased(row)))(
    'uses the bracket owning event despite a foreign released event URL/query: $listing / $status / released=$released',
    async (visibility) => {
      // Make event and bracket IDs differ so event-ID-based authorization cannot pass accidentally.
      await seedEvent(testDb.db, { name: 'Unrelated event to offset IDs' });
      const fixture = await createFixture(
        visibility,
        'Blocked bracket owner',
        101,
      );
      const other = await createFixture(
        { listing: 'archive', status: 'complete', released: true },
        'Released decoy',
        909,
      );
      expect(fixture.bracket.id).not.toBe(fixture.event.id);
      await expectFinalResults(other, true);
      for (const query of [
        `?event_id=${other.event.id}`,
        `?eventId=${other.event.id}&listing=archive&season_id=${other.season.id}`,
        `?event_id=${other.event.id}&event_id=${fixture.event.id}&spectator_results_released=1`,
      ]) {
        const res = await http.get(
          `${baseUrl}/brackets/${fixture.bracket.id}/rankings/public${query}`,
        );
        expect(res.status).toBe(404);
        expect(res.json).toEqual({ error: 'Not found' });
      }
      const foreignContext = await http.get(
        `${baseUrl}/events/${other.event.id}/brackets/${fixture.bracket.id}/rankings/public`,
      );
      expect(foreignContext.status).toBe(404);
    },
  );

  it.each(matrix.filter((row) => row.status === 'archived'))(
    'preserves existing hidden live-read restrictions: $listing / released=$released',
    async (visibility) => {
      const fixture = await createFixture(visibility, 'Hidden sentinel', 101);
      const other = await createFixture(
        { listing: 'archive', status: 'complete', released: true },
        'Visible decoy',
        909,
      );
      const paths = [
        `/teams/event/${fixture.event.id}`,
        `/seeding/scores/event/${fixture.event.id}`,
        `/seeding/rankings/event/${fixture.event.id}`,
        `/double-seeding/matches/event/${fixture.event.id}`,
        `/double-seeding/scores/event/${fixture.event.id}`,
        `/double-seeding/rankings/event/${fixture.event.id}`,
        `/brackets/event/${fixture.event.id}`,
        `/brackets/event/${fixture.event.id}/games`,
        `/brackets/${fixture.bracket.id}`,
      ];
      for (const query of [
        '',
        `?listing=archive&season_id=${other.season.id}&event_id=${other.event.id}&status=active&spectator_results_released=1`,
      ]) {
        const responses = await Promise.all(
          paths.map((path) => http.get(`${baseUrl}${path}${query}`)),
        );
        responses.forEach((response, i) => {
          expect(response.status, paths[i]).toBe(404);
          expect(response.json).toEqual({
            error:
              i === paths.length - 1 ? 'Bracket not found' : 'Event not found',
          });
        });
      }
    },
  );

  it.each(['current', 'archive'] as const)(
    'keeps populated ordinary live reads available in %s without leaking final bracket fields',
    async (listing) => {
      const fixture = await createFixture(
        { listing, status: 'active', released: true },
        'Live sentinel',
        101,
      );
      await createFixture(
        {
          listing: listing === 'current' ? 'archive' : 'current',
          status: 'complete',
          released: true,
        },
        'Foreign sentinel',
        909,
      );
      const pathsAndIds = [
        [`/teams/event/${fixture.event.id}`, fixture.team.id],
        [`/seeding/scores/event/${fixture.event.id}`, fixture.seedingScore.id],
        [`/seeding/rankings/event/${fixture.event.id}`, fixture.team.id],
        [
          `/double-seeding/matches/event/${fixture.event.id}`,
          fixture.doubleMatch.id,
        ],
        [
          `/double-seeding/scores/event/${fixture.event.id}`,
          fixture.doubleScore.id,
        ],
        [`/double-seeding/rankings/event/${fixture.event.id}`, fixture.team.id],
        [`/brackets/event/${fixture.event.id}`, fixture.bracket.id],
        [`/brackets/event/${fixture.event.id}/games`, fixture.game.id],
      ] as const;
      for (const [path, id] of pathsAndIds) {
        const res = await http.get<Record<string, unknown>[]>(
          `${baseUrl}${path}?listing=archive`,
        );
        expect(res.status, path).toBe(200);
        expect(
          res.json.map((row) =>
            path.includes('/rankings/') ? row.team_id : row.id,
          ),
          path,
        ).toEqual([id]);
      }
      const bracket = await http.get<{
        id: number;
        entries: Record<string, unknown>[];
        games: { id: number }[];
      }>(`${baseUrl}/brackets/${fixture.bracket.id}?listing=archive`);
      expect(bracket.status).toBe(200);
      expect(bracket.json.id).toBe(fixture.bracket.id);
      expect(bracket.json.entries).toEqual([
        {
          id: fixture.entryId,
          bracket_id: fixture.bracket.id,
          team_id: fixture.team.id,
          seed_position: 1,
          initial_slot: 5,
          is_bye: false,
          team_number: 101,
          team_name: 'Live sentinel team',
          display_name: 'Live sentinel display',
        },
      ]);
      expect(bracket.json.games.map((game) => game.id)).toEqual([
        fixture.game.id,
      ]);
      await expectFinalResults(fixture, false);
    },
  );

  it('retains 404s for every missing final-result resource while released sentinels exist in both placements', async () => {
    for (const listing of ['current', 'archive'] as const) {
      await createFixture(
        { listing, status: 'complete', released: true },
        listing,
        listing === 'current' ? 101 : 909,
      );
    }
    for (const path of [
      '/documentation-scores/event/99999/public',
      '/awards/event/99999/public',
      '/brackets/99999/rankings/public',
      '/events/99999/overall/public',
    ]) {
      const res = await http.get(
        `${baseUrl}${path}?listing=archive&event_id=1`,
      );
      expect(res.status, path).toBe(404);
      expect(res.json).toEqual({ error: 'Not found' });
    }
  });
});
