/**
 * HTTP route tests for /double-seeding endpoints.
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
  seedUser,
  seedEvent,
  seedTeam,
  seedScoresheetTemplate,
  seedScoreSubmission,
  seedDoubleSeedingMatch,
  seedDoubleSeedingScore,
} from './helpers/seed';
import doubleSeedingRoutes from '../../src/server/routes/doubleSeeding';

interface MatchRow {
  id: number;
  round_number: number;
  match_number: number | null;
  team1_id: number | null;
  team2_id: number | null;
  status: string;
  team1_number: number | null;
  team2_number: number | null;
}

describe('Double Seeding Routes', () => {
  let testDb: TestDb;
  let adminServer: TestServerHandle;
  let publicServer: TestServerHandle;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const admin = await seedUser(testDb.db, { is_admin: true });
    const adminApp = createTestApp({ user: { id: admin.id, is_admin: true } });
    adminApp.use('/double-seeding', doubleSeedingRoutes);
    adminServer = await startServer(adminApp);

    const publicApp = createTestApp();
    publicApp.use('/double-seeding', doubleSeedingRoutes);
    publicServer = await startServer(publicApp);
  });

  afterEach(async () => {
    await adminServer.close();
    await publicServer.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('POST /double-seeding/matches/generate/:eventId', () => {
    it('generates randomized ready matches and stores the round count', async () => {
      const event = await seedEvent(testDb.db);
      for (let i = 1; i <= 6; i++) {
        await seedTeam(testDb.db, { event_id: event.id, team_number: i });
      }

      const res = await http.post(
        `${adminServer.baseUrl}/double-seeding/matches/generate/${event.id}`,
        { rounds: 5 },
      );

      expect(res.status).toBe(201);
      const body = res.json as {
        rounds: number;
        matchesCreated: number;
        matches: MatchRow[];
      };
      expect(body.rounds).toBe(5);
      expect(body.matchesCreated).toBe(15);
      expect(body.matches.length).toBe(15);
      expect(body.matches.every((m) => m.status === 'ready')).toBe(true);

      const eventRow = await testDb.db.get(
        'SELECT double_seeding_rounds FROM events WHERE id = ?',
        [event.id],
      );
      expect(eventRow?.double_seeding_rounds).toBe(5);
    });

    it('requires explicit confirmation to replace existing matches', async () => {
      const event = await seedEvent(testDb.db);
      for (let i = 1; i <= 4; i++) {
        await seedTeam(testDb.db, { event_id: event.id, team_number: i });
      }

      const first = await http.post(
        `${adminServer.baseUrl}/double-seeding/matches/generate/${event.id}`,
        { rounds: 3 },
      );
      expect(first.status).toBe(201);

      const blocked = await http.post(
        `${adminServer.baseUrl}/double-seeding/matches/generate/${event.id}`,
        { rounds: 3 },
      );
      expect(blocked.status).toBe(409);
      expect(
        (blocked.json as { requiresConfirmation?: boolean })
          .requiresConfirmation,
      ).toBe(true);

      const replaced = await http.post(
        `${adminServer.baseUrl}/double-seeding/matches/generate/${event.id}`,
        { rounds: 2, confirmReplace: true },
      );
      expect(replaced.status).toBe(201);
      expect((replaced.json as { matchesCreated: number }).matchesCreated).toBe(
        4,
      );
    });

    it('blocks regeneration once double-seeding results exist', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      await seedTeam(testDb.db, { event_id: event.id, team_number: 2 });
      const match = await seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        team1_id: team.id,
      });
      await seedDoubleSeedingScore(testDb.db, {
        event_id: event.id,
        match_id: match.id,
        team_id: team.id,
        round_number: 1,
        side: 'team1',
        score: 10,
      });

      const res = await http.post(
        `${adminServer.baseUrl}/double-seeding/matches/generate/${event.id}`,
        { rounds: 2, confirmReplace: true },
      );
      expect(res.status).toBe(409);
      expect((res.json as { error: string }).error).toContain(
        'cannot be regenerated',
      );
    });

    it('fails when rounds exceed the team count', async () => {
      const event = await seedEvent(testDb.db);
      await seedTeam(testDb.db, { event_id: event.id, team_number: 1 });
      await seedTeam(testDb.db, { event_id: event.id, team_number: 2 });

      const res = await http.post(
        `${adminServer.baseUrl}/double-seeding/matches/generate/${event.id}`,
        { rounds: 3 },
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('cannot exceed');
    });

    it('rejects non-admin requests', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(
        `${publicServer.baseUrl}/double-seeding/matches/generate/${event.id}`,
        { rounds: 5 },
      );
      expect(res.status).toBe(403);
    });
  });

  describe('GET /double-seeding/matches/event/:eventId', () => {
    it('returns matches with team display fields (public access)', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 11,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 22,
      });
      await seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        match_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
      });

      const res = await http.get(
        `${publicServer.baseUrl}/double-seeding/matches/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      const matches = res.json as MatchRow[];
      expect(matches.length).toBe(1);
      expect(matches[0].team1_number).toBe(11);
      expect(matches[0].team2_number).toBe(22);
    });

    it('returns 404 for archived events', async () => {
      const event = await seedEvent(testDb.db, { status: 'archived' });
      const res = await http.get(
        `${publicServer.baseUrl}/double-seeding/matches/event/${event.id}`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /double-seeding/matches/event/:eventId', () => {
    it('deletes matches and resets the event round count', async () => {
      const event = await seedEvent(testDb.db, { double_seeding_rounds: 3 });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      await seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        team1_id: team.id,
      });

      const res = await http.delete(
        `${adminServer.baseUrl}/double-seeding/matches/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      expect((res.json as { deleted: number }).deleted).toBe(1);

      const remaining = await testDb.db.all(
        'SELECT * FROM double_seeding_matches WHERE event_id = ?',
        [event.id],
      );
      expect(remaining.length).toBe(0);

      const eventRow = await testDb.db.get(
        'SELECT double_seeding_rounds FROM events WHERE id = ?',
        [event.id],
      );
      expect(eventRow?.double_seeding_rounds).toBe(0);
    });

    it('blocks deletion when results exist', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const match = await seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        team1_id: team.id,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: '{}',
        event_id: event.id,
        score_type: 'double_seeding',
        double_seeding_match_id: match.id,
      });

      const res = await http.delete(
        `${adminServer.baseUrl}/double-seeding/matches/event/${event.id}`,
      );
      expect(res.status).toBe(409);
    });
  });

  describe('scores and rankings endpoints', () => {
    it('lists event scores publicly and blocks archived events', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 7,
      });
      const match = await seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        team1_id: team.id,
      });
      await seedDoubleSeedingScore(testDb.db, {
        event_id: event.id,
        match_id: match.id,
        team_id: team.id,
        round_number: 1,
        side: 'team1',
        score: 42,
      });

      const res = await http.get(
        `${publicServer.baseUrl}/double-seeding/scores/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      const rows = res.json as Array<{
        team_number: number;
        score: number;
        round_number: number;
      }>;
      expect(rows.length).toBe(1);
      expect(rows[0].team_number).toBe(7);
      expect(rows[0].score).toBe(42);

      await testDb.db.run(
        `UPDATE events SET status = 'archived' WHERE id = ?`,
        [event.id],
      );
      const archived = await http.get(
        `${publicServer.baseUrl}/double-seeding/scores/event/${event.id}`,
      );
      expect(archived.status).toBe(404);
    });

    it('lists team scores publicly', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const match = await seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        team1_id: team.id,
      });
      await seedDoubleSeedingScore(testDb.db, {
        event_id: event.id,
        match_id: match.id,
        team_id: team.id,
        round_number: 1,
        side: 'team1',
        score: 17,
      });

      const res = await http.get(
        `${publicServer.baseUrl}/double-seeding/scores/team/${team.id}`,
      );
      expect(res.status).toBe(200);
      expect((res.json as Array<{ score: number }>)[0].score).toBe(17);
    });

    it('recalculates and lists rankings', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const match = await seedDoubleSeedingMatch(testDb.db, {
        event_id: event.id,
        round_number: 1,
        team1_id: team.id,
      });
      await seedDoubleSeedingScore(testDb.db, {
        event_id: event.id,
        match_id: match.id,
        team_id: team.id,
        round_number: 1,
        side: 'team1',
        score: 30,
      });

      const recalc = await http.post(
        `${adminServer.baseUrl}/double-seeding/rankings/recalculate/${event.id}`,
      );
      expect(recalc.status).toBe(200);
      expect((recalc.json as { teamsRanked: number }).teamsRanked).toBe(1);

      const rankings = await http.get(
        `${publicServer.baseUrl}/double-seeding/rankings/event/${event.id}`,
      );
      expect(rankings.status).toBe(200);
      const rows = rankings.json as Array<{
        seed_rank: number;
        raw_double_seed_score: number;
      }>;
      expect(rows.length).toBe(1);
      expect(rows[0].seed_rank).toBe(1);
      expect(rows[0].raw_double_seed_score).toBeCloseTo(1);

      await testDb.db.run(
        `UPDATE events SET status = 'archived' WHERE id = ?`,
        [event.id],
      );
      const archived = await http.get(
        `${publicServer.baseUrl}/double-seeding/rankings/event/${event.id}`,
      );
      expect(archived.status).toBe(404);
    });
  });
});
