import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { materializeBracketGames } from '../../../src/server/services/bracketGenerateGames';
import { seedEvent, seedTeam, seedBracket } from '../../http/helpers/seed';

describe('materializeBracketGames', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('creates seeded games from templates for a 4-team bracket', async () => {
    const event = await seedEvent(testDb.db);
    const teams = [];
    for (let i = 1; i <= 4; i++) {
      teams.push(
        await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: i,
        }),
      );
    }
    const bracket = await seedBracket(testDb.db, {
      event_id: event.id,
      bracket_size: 4,
      actual_team_count: 4,
    });

    for (let seed = 1; seed <= 4; seed++) {
      await testDb.db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
         VALUES (?, ?, ?, FALSE) RETURNING id`,
        [bracket.id, teams[seed - 1].id, seed],
      );
    }

    const result = await materializeBracketGames(testDb.db, bracket.id, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.gamesCreated).toBeGreaterThan(0);

    const games = await testDb.db.all<{
      game_number: number;
      team1_id: number | null;
      team2_id: number | null;
      status: string;
    }>(
      'SELECT game_number, team1_id, team2_id, status FROM bracket_games WHERE bracket_id = ? ORDER BY game_number ASC',
      [bracket.id],
    );

    expect(games.length).toBe(result.data.gamesCreated);
    const withTeams = games.filter((g) => g.team1_id && g.team2_id);
    expect(withTeams.length).toBeGreaterThan(0);
    expect(
      withTeams.every((g) => g.status === 'ready' || g.status === 'bye'),
    ).toBe(true);
  });
});
