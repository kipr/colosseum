/**
 * HTTP route tests for public final-score endpoints.
 * Verifies documentation scores, bracket rankings, and overall scores are
 * gated behind event completion + spectator_results_released.
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
  seedBracket,
  seedDocumentationScore,
  seedDocumentationScoreCategory,
  seedDocumentationSubScore,
  seedSeedingScore,
  seedEventAward,
  seedEventAwardRecipient,
} from './helpers/seed';
import eventsRoutes from '../../src/server/routes/events';
import bracketsRoutes from '../../src/server/routes/brackets';
import docScoresRoutes from '../../src/server/routes/documentationScores';
import seedingRoutes from '../../src/server/routes/seeding';
import awardsRoutes from '../../src/server/routes/awards';

describe('Public Final Scores API', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const adminUser = await seedUser(testDb.db, { is_admin: true });
    const app = createTestApp({ user: { id: adminUser.id, is_admin: true } });
    app.use('/events', eventsRoutes);
    app.use('/brackets', bracketsRoutes);
    app.use('/documentation-scores', docScoresRoutes);
    app.use('/seeding', seedingRoutes);
    app.use('/awards', awardsRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  async function createReleasedEvent() {
    const event = await seedEvent(testDb.db, {
      name: 'Released Event',
      status: 'complete',
    });
    await testDb.db.run(
      `UPDATE events SET spectator_results_released = 1 WHERE id = ?`,
      [event.id],
    );
    return event;
  }

  async function createUnreleasedEvent() {
    return seedEvent(testDb.db, {
      name: 'Unreleased Event',
      status: 'complete',
    });
  }

  describe('GET /events/public (final_scores_available)', () => {
    it('returns final_scores_available=true for released complete events', async () => {
      const event = await createReleasedEvent();
      const res = await http.get<{ final_scores_available: boolean }[]>(
        `${baseUrl}/events/public`,
      );
      expect(res.status).toBe(200);
      const found = res.json.find(
        (e: { final_scores_available: boolean } & { id?: number }) =>
          (e as Record<string, unknown>).id === event.id,
      );
      expect(found).toBeDefined();
      expect(found!.final_scores_available).toBe(true);
    });

    it('returns final_scores_available=false for unreleased complete events', async () => {
      await createUnreleasedEvent();
      const res = await http.get<Record<string, unknown>[]>(
        `${baseUrl}/events/public`,
      );
      expect(res.status).toBe(200);
      expect(res.json[0].final_scores_available).toBe(false);
    });

    it('returns final_scores_available=false for active events even if released', async () => {
      const event = await seedEvent(testDb.db, {
        name: 'Active',
        status: 'active',
      });
      await testDb.db.run(
        `UPDATE events SET spectator_results_released = 1 WHERE id = ?`,
        [event.id],
      );
      const res = await http.get<Record<string, unknown>[]>(
        `${baseUrl}/events/public`,
      );
      expect(res.json[0].final_scores_available).toBe(false);
    });

    it('does not expose the raw spectator_results_released field', async () => {
      await createReleasedEvent();
      const res = await http.get<Record<string, unknown>[]>(
        `${baseUrl}/events/public`,
      );
      expect(res.json[0]).not.toHaveProperty('spectator_results_released');
    });
  });

  describe('GET /documentation-scores/event/:eventId/public', () => {
    it('returns 404 for unreleased complete event', async () => {
      const event = await createUnreleasedEvent();
      const res = await http.get(
        `${baseUrl}/documentation-scores/event/${event.id}/public`,
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 for active event', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const res = await http.get(
        `${baseUrl}/documentation-scores/event/${event.id}/public`,
      );
      expect(res.status).toBe(404);
    });

    it('returns categories and scores for released event', async () => {
      const event = await createReleasedEvent();
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const cat = await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 1,
        name: 'Design',
        max_score: 100,
      });
      const doc = await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: team.id,
        overall_score: 0.75,
      });
      await seedDocumentationSubScore(testDb.db, {
        documentation_score_id: doc.id,
        category_id: cat.id,
        score: 75,
      });

      const res = await http.get<{
        categories: { name: string }[];
        scores: { team_number: number; sub_scores: { score: number }[] }[];
      }>(`${baseUrl}/documentation-scores/event/${event.id}/public`);

      expect(res.status).toBe(200);
      expect(res.json.categories).toHaveLength(1);
      expect(res.json.categories[0].name).toBe('Design');
      expect(res.json.scores).toHaveLength(1);
      expect(res.json.scores[0].team_number).toBe(1);
      expect(res.json.scores[0].sub_scores).toHaveLength(1);
    });

    it('does not expose internal IDs or timestamps in scores', async () => {
      const event = await createReleasedEvent();
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: team.id,
        overall_score: 0.5,
      });

      const res = await http.get<{ scores: Record<string, unknown>[] }>(
        `${baseUrl}/documentation-scores/event/${event.id}/public`,
      );
      expect(res.status).toBe(200);
      const score = res.json.scores[0];
      expect(score).not.toHaveProperty('id');
      expect(score).not.toHaveProperty('event_id');
      expect(score).not.toHaveProperty('scored_by');
      expect(score).not.toHaveProperty('created_at');
      expect(score).not.toHaveProperty('updated_at');
    });
  });

  describe('GET /brackets/:id/rankings/public', () => {
    it('returns 404 for unreleased complete event', async () => {
      const event = await createUnreleasedEvent();
      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        status: 'completed',
      });
      const res = await http.get(
        `${baseUrl}/brackets/${bracket.id}/rankings/public`,
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 for nonexistent bracket', async () => {
      const res = await http.get(`${baseUrl}/brackets/99999/rankings/public`);
      expect(res.status).toBe(404);
    });

    it('returns rankings with per-bracket overall fields for released event', async () => {
      const event = await createReleasedEvent();
      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        status: 'completed',
      });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 7,
        team_name: 'Ranked Team',
      });
      await testDb.db.run(
        `INSERT INTO bracket_entries (
          bracket_id, team_id, seed_position, is_bye, final_rank, bracket_raw_score, weighted_bracket_raw_score
        ) VALUES (?, ?, 1, 0, 1, 1.0, 1.0)`,
        [bracket.id, team.id],
      );

      const res = await http.get<{
        weight: number;
        entries: {
          team_id: number | null;
          doc_score: number;
          raw_seed_score: number;
          weighted_bracket_raw_score: number | null;
          total: number;
        }[];
      }>(`${baseUrl}/brackets/${bracket.id}/rankings/public`);

      expect(res.status).toBe(200);
      expect(res.json).toHaveProperty('weight');
      expect(res.json).toHaveProperty('entries');
      expect(res.json.entries).toHaveLength(1);
      expect(res.json.entries[0].team_id).toBe(team.id);
      expect(res.json.entries[0].doc_score).toBe(0);
      expect(res.json.entries[0].raw_seed_score).toBe(0);
      expect(res.json.entries[0].weighted_bracket_raw_score).toBe(1);
      expect(res.json.entries[0].total).toBe(1);
    });
  });

  describe('GET /events/:id/overall/public', () => {
    it('returns 404 for unreleased complete event', async () => {
      const event = await createUnreleasedEvent();
      const res = await http.get(
        `${baseUrl}/events/${event.id}/overall/public`,
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 for active event', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const res = await http.get(
        `${baseUrl}/events/${event.id}/overall/public`,
      );
      expect(res.status).toBe(404);
    });

    it('returns overall scores for released event', async () => {
      const event = await createReleasedEvent();
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 42,
        team_name: 'Scorers',
      });
      await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: team.id,
        overall_score: 0.5,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });
      await testDb.db.run(
        `INSERT INTO seeding_rankings (team_id, raw_seed_score) VALUES (?, ?)`,
        [team.id, 0.8],
      );

      const res = await http.get<
        {
          team_number: number;
          doc_score: number;
          raw_seed_score: number;
          total: number;
        }[]
      >(`${baseUrl}/events/${event.id}/overall/public`);

      expect(res.status).toBe(200);
      expect(res.json).toHaveLength(1);
      expect(res.json[0].team_number).toBe(42);
      expect(res.json[0].doc_score).toBe(0.5);
      expect(res.json[0].raw_seed_score).toBe(0.8);
      expect(res.json[0].total).toBeCloseTo(1.3, 4);
    });
  });

  describe('GET /awards/event/:eventId/public', () => {
    it('returns 404 for unreleased complete event', async () => {
      const event = await createUnreleasedEvent();
      const res = await http.get(
        `${baseUrl}/awards/event/${event.id}/public`,
      );
      expect(res.status).toBe(404);
    });

    it('returns awards for released event', async () => {
      const event = await createReleasedEvent();
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 10,
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Best Bot',
      });
      await seedEventAwardRecipient(testDb.db, {
        event_award_id: award.id,
        team_id: team.id,
      });

      const res = await http.get<{
        manual: { name: string; recipients: { team_number: number }[] }[];
      }>(`${baseUrl}/awards/event/${event.id}/public`);
      expect(res.status).toBe(200);
      expect(res.json.manual).toHaveLength(1);
      expect(res.json.manual[0].name).toBe('Best Bot');
      expect(res.json.manual[0].recipients).toHaveLength(1);
    });
  });

  describe('Auto-clear on reopen', () => {
    it('clears spectator_results_released when status changes from complete', async () => {
      const event = await createReleasedEvent();

      // Reopen the event (change status to active)
      await http.patch(`${baseUrl}/events/${event.id}`, { status: 'active' });

      // Verify overall public is now blocked
      const res = await http.get(
        `${baseUrl}/events/${event.id}/overall/public`,
      );
      expect(res.status).toBe(404);

      // Verify public event payload shows final_scores_available=false
      const pubRes = await http.get<Record<string, unknown>>(
        `${baseUrl}/events/${event.id}/public`,
      );
      expect(pubRes.json.final_scores_available).toBe(false);
    });
  });
});
