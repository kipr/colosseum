/**
 * HTTP route tests for bracket creation with explicit team selection.
 * Verifies team_ids flow: create bracket, entries, games; overlap 409; cross-event validation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
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
  seedSeedingScore,
  seedBracket,
} from './helpers/seed';
import bracketsRoutes from '../../src/server/routes/brackets';
import { recalculateSeedingRankings } from '../../src/server/services/seedingRankings';

describe('Brackets Team Selection', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;
  let authUser: { id: number };

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    authUser = await seedUser(testDb.db);
    const app = createTestApp({ user: { id: authUser.id, is_admin: false } });
    app.use('/brackets', bracketsRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('creates bracket with team_ids: bracket_size, entries, games', async () => {
    const event = await seedEvent(testDb.db);
    const teams: { id: number }[] = [];
    for (let i = 1; i <= 11; i++) {
      const t = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 100 + i,
        team_name: `Team ${100 + i}`,
      });
      teams.push(t);
    }

    // Add seeding scores so teams get ranked (need 2+ scores per team)
    for (const t of teams) {
      await seedSeedingScore(testDb.db, {
        team_id: t.id,
        round_number: 1,
        score: 500 - teams.indexOf(t) * 10,
      });
      await seedSeedingScore(testDb.db, {
        team_id: t.id,
        round_number: 2,
        score: 480 - teams.indexOf(t) * 10,
      });
    }
    await recalculateSeedingRankings(event.id);

    const teamIds = teams.map((t) => t.id);
    const res = await http.post(`${baseUrl}/brackets`, {
      event_id: event.id,
      name: 'Test Bracket',
      team_ids: teamIds,
    });

    expect(res.status).toBe(201);
    const bracket = res.json as {
      id: number;
      bracket_size: number;
      actual_team_count: number;
    };
    expect(bracket.bracket_size).toBe(16);
    expect(bracket.actual_team_count).toBe(11);

    const entries = await testDb.db.all(
      'SELECT * FROM bracket_entries WHERE bracket_id = ? ORDER BY seed_position ASC',
      [bracket.id],
    );
    expect(entries).toHaveLength(16);
    const byeCount = entries.filter((e) => e.is_bye === 1).length;
    expect(byeCount).toBe(5);

    const games = await testDb.db.all(
      'SELECT * FROM bracket_games WHERE bracket_id = ? ORDER BY game_number ASC',
      [bracket.id],
    );
    expect(games.length).toBeGreaterThan(0);
    const readyOrBye = games.filter(
      (g: { status: string }) =>
        g.status === 'ready' || g.status === 'bye',
    );
    expect(readyOrBye.length).toBeGreaterThan(0);
  });

  it('blocks overlap: returns 409 when team already in another bracket', async () => {
    const event = await seedEvent(testDb.db);
    const teamA = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
      team_name: 'ACES Robotics',
    });
    const teamB = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
      team_name: 'Other Team',
    });

    await seedSeedingScore(testDb.db, {
      team_id: teamA.id,
      round_number: 1,
      score: 100,
    });
    await seedSeedingScore(testDb.db, {
      team_id: teamA.id,
      round_number: 2,
      score: 90,
    });
    await seedSeedingScore(testDb.db, {
      team_id: teamB.id,
      round_number: 1,
      score: 80,
    });
    await seedSeedingScore(testDb.db, {
      team_id: teamB.id,
      round_number: 2,
      score: 70,
    });
    await recalculateSeedingRankings(event.id);

    const res1 = await http.post(`${baseUrl}/brackets`, {
      event_id: event.id,
      name: 'Bracket A',
      team_ids: [teamA.id],
    });
    expect(res1.status).toBe(201);

    const res2 = await http.post(`${baseUrl}/brackets`, {
      event_id: event.id,
      name: 'Bracket B',
      team_ids: [teamA.id, teamB.id],
    });
    expect(res2.status).toBe(409);
    const data = res2.json as { error?: string; conflicts?: unknown[] };
    expect(data.error).toContain('already assigned');
    expect(data.conflicts).toBeDefined();
    expect(Array.isArray(data.conflicts)).toBe(true);
    expect((data.conflicts as { team_id: number }[]).some((c) => c.team_id === teamA.id)).toBe(true);
  });

  it('rejects cross-event team_ids with 400', async () => {
    const event1 = await seedEvent(testDb.db);
    const event2 = await seedEvent(testDb.db, { name: 'Other Event' });
    const team1 = await seedTeam(testDb.db, {
      event_id: event1.id,
      team_number: 1,
      team_name: 'Event1 Team',
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event2.id,
      team_number: 2,
      team_name: 'Event2 Team',
    });

    await seedSeedingScore(testDb.db, {
      team_id: team1.id,
      round_number: 1,
      score: 100,
    });
    await seedSeedingScore(testDb.db, {
      team_id: team1.id,
      round_number: 2,
      score: 90,
    });
    await seedSeedingScore(testDb.db, {
      team_id: team2.id,
      round_number: 1,
      score: 80,
    });
    await seedSeedingScore(testDb.db, {
      team_id: team2.id,
      round_number: 2,
      score: 70,
    });
    await recalculateSeedingRankings(event1.id);
    await recalculateSeedingRankings(event2.id);

    const res = await http.post(`${baseUrl}/brackets`, {
      event_id: event1.id,
      name: 'Bracket',
      team_ids: [team1.id, team2.id],
    });
    expect(res.status).toBe(400);
    const data = res.json as { error?: string };
    expect(data.error).toContain('same event');
  });

  it('GET /brackets/event/:eventId/assigned-teams returns team-bracket mapping', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
      team_name: 'ACES',
    });
    const bracket = await seedBracket(testDb.db, {
      event_id: event.id,
      name: 'Bracket A',
      bracket_size: 4,
    });
    await testDb.db.run(
      `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
       VALUES (?, ?, 1, 0)`,
      [bracket.id, team.id],
    );

    const res = await http.get(
      `${baseUrl}/brackets/event/${event.id}/assigned-teams`,
    );
    expect(res.status).toBe(200);
    const assigned = res.json as AssignedTeam[];
    expect(assigned).toHaveLength(1);
    expect(assigned[0].team_id).toBe(team.id);
    expect(assigned[0].team_number).toBe(1);
    expect(assigned[0].bracket_id).toBe(bracket.id);
    expect(assigned[0].bracket_name).toBe('Bracket A');
  });
});

interface AssignedTeam {
  team_id: number;
  team_number: number;
  team_name: string;
  bracket_id: number;
  bracket_name: string;
}
