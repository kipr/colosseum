/**
 * HTTP route tests for awards endpoints.
 * Covers template CRUD, event award CRUD, recipient management,
 * and public release-gated awards endpoint.
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
  seedAwardTemplate,
  seedEventAward,
  seedEventAwardRecipient,
  seedDocumentationScore,
} from './helpers/seed';
import awardsRoutes from '../../src/server/routes/awards';
import eventsRoutes from '../../src/server/routes/events';

describe('Awards API', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const adminUser = await seedUser(testDb.db, { is_admin: true });
    const app = createTestApp({ user: { id: adminUser.id, is_admin: true } });
    app.use('/awards', awardsRoutes);
    app.use('/events', eventsRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  // ── Template CRUD ──

  describe('Award Templates', () => {
    it('creates a template', async () => {
      const res = await http.post(`${baseUrl}/awards/templates`, {
        name: 'Best Design',
        description: 'For the best robot design',
      });
      expect(res.status).toBe(201);
      expect(res.json).toHaveProperty('id');
      expect((res.json as Record<string, unknown>).name).toBe('Best Design');
    });

    it('rejects template without name', async () => {
      const res = await http.post(`${baseUrl}/awards/templates`, {
        description: 'missing name',
      });
      expect(res.status).toBe(400);
    });

    it('lists templates', async () => {
      await seedAwardTemplate(testDb.db, { name: 'Alpha' });
      await seedAwardTemplate(testDb.db, { name: 'Beta' });
      const res = await http.get<Record<string, unknown>[]>(
        `${baseUrl}/awards/templates`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toHaveLength(2);
    });

    it('updates a template', async () => {
      const t = await seedAwardTemplate(testDb.db, { name: 'Old Name' });
      const res = await http.patch(`${baseUrl}/awards/templates/${t.id}`, {
        name: 'New Name',
      });
      expect(res.status).toBe(200);
      expect((res.json as Record<string, unknown>).name).toBe('New Name');
    });

    it('deletes a template', async () => {
      const t = await seedAwardTemplate(testDb.db, { name: 'Doomed' });
      const res = await http.delete(`${baseUrl}/awards/templates/${t.id}`);
      expect(res.status).toBe(200);

      const listRes = await http.get<unknown[]>(
        `${baseUrl}/awards/templates`,
      );
      expect(listRes.json).toHaveLength(0);
    });

    it('template edit does not mutate existing event awards', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const t = await seedAwardTemplate(testDb.db, {
        name: 'Original',
        description: 'Original desc',
      });

      // Create event award from template
      await http.post(`${baseUrl}/awards/event/${event.id}`, {
        template_award_id: t.id,
      });

      // Update template
      await http.patch(`${baseUrl}/awards/templates/${t.id}`, {
        name: 'Changed',
      });

      // Event award should still have original name
      const awardsRes = await http.get<{ name: string }[]>(
        `${baseUrl}/awards/event/${event.id}`,
      );
      expect(awardsRes.json[0].name).toBe('Original');
    });
  });

  // ── Event Awards CRUD ──

  describe('Event Awards', () => {
    it('creates an event award manually', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const res = await http.post(`${baseUrl}/awards/event/${event.id}`, {
        name: 'Innovation',
        description: 'Most innovative robot',
      });
      expect(res.status).toBe(201);
      expect((res.json as Record<string, unknown>).name).toBe('Innovation');
      expect((res.json as Record<string, unknown>).recipients).toEqual([]);
    });

    it('creates an event award from template', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const t = await seedAwardTemplate(testDb.db, {
        name: 'Sportsmanship',
        description: 'Fair play',
      });
      const res = await http.post(`${baseUrl}/awards/event/${event.id}`, {
        template_award_id: t.id,
      });
      expect(res.status).toBe(201);
      expect((res.json as Record<string, unknown>).name).toBe('Sportsmanship');
      expect((res.json as Record<string, unknown>).template_award_id).toBe(
        t.id,
      );
    });

    it('allows duplicate event awards', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const r1 = await http.post(`${baseUrl}/awards/event/${event.id}`, {
        name: 'Star',
      });
      const r2 = await http.post(`${baseUrl}/awards/event/${event.id}`, {
        name: 'Star',
      });
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect((r1.json as Record<string, unknown>).id).not.toBe(
        (r2.json as Record<string, unknown>).id,
      );
    });

    it('lists event awards with recipients', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'MVP',
      });
      await seedEventAwardRecipient(testDb.db, {
        event_award_id: award.id,
        team_id: team.id,
      });

      const res = await http.get<
        { name: string; recipients: { team_number: number }[] }[]
      >(`${baseUrl}/awards/event/${event.id}`);
      expect(res.status).toBe(200);
      expect(res.json).toHaveLength(1);
      expect(res.json[0].name).toBe('MVP');
      expect(res.json[0].recipients).toHaveLength(1);
      expect(res.json[0].recipients[0].team_number).toBe(1);
    });

    it('updates an event award', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Old',
      });
      const res = await http.patch(
        `${baseUrl}/awards/event-awards/${award.id}`,
        { name: 'New' },
      );
      expect(res.status).toBe(200);
      expect((res.json as Record<string, unknown>).name).toBe('New');
    });

    it('deletes an event award', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Gone',
      });
      const res = await http.delete(
        `${baseUrl}/awards/event-awards/${award.id}`,
      );
      expect(res.status).toBe(200);
    });
  });

  // ── Recipients ──

  describe('Event Award Recipients', () => {
    it('adds a recipient to an event award', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 42,
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Best Bot',
      });

      const res = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/recipients`,
        { team_id: team.id },
      );
      expect(res.status).toBe(201);
      expect((res.json as Record<string, unknown>).team_number).toBe(42);
    });

    it('allows multiple recipients per event award', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const t1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const t2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Co-winners',
      });

      const r1 = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/recipients`,
        { team_id: t1.id },
      );
      const r2 = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/recipients`,
        { team_id: t2.id },
      );
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
    });

    it('rejects duplicate recipient for same award', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Dup Test',
      });
      await seedEventAwardRecipient(testDb.db, {
        event_award_id: award.id,
        team_id: team.id,
      });

      const res = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/recipients`,
        { team_id: team.id },
      );
      expect(res.status).toBe(409);
    });

    it('rejects cross-event team as recipient', async () => {
      const event1 = await seedEvent(testDb.db, {
        name: 'Event 1',
        status: 'active',
      });
      const event2 = await seedEvent(testDb.db, {
        name: 'Event 2',
        status: 'active',
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event2.id,
        team_number: 99,
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event1.id,
        name: 'Cross-event test',
      });

      const res = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/recipients`,
        { team_id: team2.id },
      );
      expect(res.status).toBe(400);
      expect((res.json as Record<string, unknown>).error).toMatch(
        /same event/i,
      );
    });

    it('removes a recipient', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Remove test',
      });
      await seedEventAwardRecipient(testDb.db, {
        event_award_id: award.id,
        team_id: team.id,
      });

      const res = await http.delete(
        `${baseUrl}/awards/event-awards/${award.id}/recipients/${team.id}`,
      );
      expect(res.status).toBe(200);
    });
  });

  // ── Public endpoint + release gating ──

  describe('GET /awards/event/:eventId/public', () => {
    async function createReleasedEvent() {
      const event = await seedEvent(testDb.db, {
        name: 'Released',
        status: 'complete',
      });
      await testDb.db.run(
        `UPDATE events SET spectator_results_released = 1 WHERE id = ?`,
        [event.id],
      );
      return event;
    }

    it('returns 404 for unreleased complete event', async () => {
      const event = await seedEvent(testDb.db, {
        status: 'complete',
      });
      const res = await http.get(
        `${baseUrl}/awards/event/${event.id}/public`,
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 for active event', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const res = await http.get(
        `${baseUrl}/awards/event/${event.id}/public`,
      );
      expect(res.status).toBe(404);
    });

    it('returns awards with recipients for released event', async () => {
      const event = await createReleasedEvent();
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 7,
        team_name: 'Winners',
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Champion',
        description: 'First place overall',
        sort_order: 0,
      });
      await seedEventAwardRecipient(testDb.db, {
        event_award_id: award.id,
        team_id: team.id,
      });

      const res = await http.get<{
        manual: {
          name: string;
          description: string;
          recipients: { team_number: number; team_name: string }[];
        }[];
      }>(`${baseUrl}/awards/event/${event.id}/public`);

      expect(res.status).toBe(200);
      expect(res.json.manual).toHaveLength(1);
      expect(res.json.manual[0].name).toBe('Champion');
      expect(res.json.manual[0].description).toBe('First place overall');
      expect(res.json.manual[0].recipients).toHaveLength(1);
      expect(res.json.manual[0].recipients[0].team_number).toBe(7);
      expect(res.json.manual[0].recipients[0].team_name).toBe('Winners');
    });

    it('does not expose internal IDs in public response', async () => {
      const event = await createReleasedEvent();
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'No IDs',
      });

      const res = await http.get<{
        manual: Record<string, unknown>[];
      }>(`${baseUrl}/awards/event/${event.id}/public`);
      expect(res.status).toBe(200);
      const first = res.json.manual[0];
      expect(first).not.toHaveProperty('id');
      expect(first).not.toHaveProperty('event_id');
      expect(first).not.toHaveProperty('template_award_id');
      expect(first).not.toHaveProperty('created_at');
      // Silence unused variable warning
      void award;
    });

    it('returns empty manual list for released event with no manual awards', async () => {
      const event = await createReleasedEvent();
      const res = await http.get<{
        manual: unknown[];
        automatic: {
          de: unknown[];
          perBracketOverall: unknown[];
          eventOverall: unknown;
        };
      }>(`${baseUrl}/awards/event/${event.id}/public`);
      expect(res.status).toBe(200);
      expect(res.json.manual).toEqual([]);
      expect(res.json.automatic.de).toEqual([]);
      expect(res.json.automatic.perBracketOverall).toEqual([]);
      expect(res.json.automatic.eventOverall).toBeNull();
    });

    it('includes automatic DE and event overall, but skips per-bracket overall for single-bracket events', async () => {
      const event = await createReleasedEvent();
      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        name: 'Main Bracket',
        status: 'completed',
      });
      const t1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'First',
      });
      const t2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
        team_name: 'Second',
      });
      const t3 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 3,
        team_name: 'Third',
      });

      await testDb.db.run(
        `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, 80, 1, 10)`,
        [t1.id],
      );
      await testDb.db.run(
        `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, 70, 2, 5)`,
        [t2.id],
      );
      await testDb.db.run(
        `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, 60, 3, 1)`,
        [t3.id],
      );

      await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: t1.id,
        overall_score: 3,
      });
      await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: t2.id,
        overall_score: 2,
      });
      await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: t3.id,
        overall_score: 1,
      });

      await testDb.db.run(
        `INSERT INTO bracket_entries (
          bracket_id, team_id, seed_position, is_bye,
          final_rank, bracket_raw_score, weighted_bracket_raw_score
        ) VALUES
          (?, ?, 1, 0, 1, 1, 100),
          (?, ?, 2, 0, 2, 0.5, 50),
          (?, ?, 3, 0, 3, 0.33, 10)`,
        [bracket.id, t1.id, bracket.id, t2.id, bracket.id, t3.id],
      );

      const res = await http.get<{
        manual: unknown[];
        automatic: {
          de: { bracket_name: string; placements: { place: number }[] }[];
          perBracketOverall: {
            bracket_name: string;
            placements: { place: number; recipients: { team_number: number }[] }[];
          }[];
          eventOverall: {
            placements: { place: number; recipients: { team_number: number }[] }[];
          } | null;
        };
      }>(`${baseUrl}/awards/event/${event.id}/public`);

      expect(res.status).toBe(200);
      expect(res.json.manual).toEqual([]);

      expect(res.json.automatic.de).toHaveLength(1);
      expect(res.json.automatic.de[0].bracket_name).toBe('Main Bracket');
      expect(res.json.automatic.de[0].placements.map((p) => p.place)).toEqual([
        1, 2, 3,
      ]);

      expect(res.json.automatic.perBracketOverall).toEqual([]);

      expect(res.json.automatic.eventOverall).not.toBeNull();
      expect(
        res.json.automatic.eventOverall!.placements[0].recipients[0]
          .team_number,
      ).toBe(1);
      expect(
        res.json.automatic.eventOverall!.placements[1].recipients[0]
          .team_number,
      ).toBe(2);
      expect(
        res.json.automatic.eventOverall!.placements[2].recipients[0]
          .team_number,
      ).toBe(3);
    });
  });

  describe('POST /awards/event/:eventId/automatic', () => {
    async function createReleasedEventForApply() {
      const event = await seedEvent(testDb.db, {
        name: 'Released Apply',
        status: 'complete',
      });
      await testDb.db.run(
        `UPDATE events SET spectator_results_released = 1 WHERE id = ?`,
        [event.id],
      );
      return event;
    }

    it('creates Auto: event award rows from computed results', async () => {
      const event = await createReleasedEventForApply();
      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        name: 'Main Bracket',
        status: 'completed',
      });
      const t1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'First',
      });
      const t2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
        team_name: 'Second',
      });
      const t3 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 3,
        team_name: 'Third',
      });

      await testDb.db.run(
        `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, 80, 1, 10)`,
        [t1.id],
      );
      await testDb.db.run(
        `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, 70, 2, 5)`,
        [t2.id],
      );
      await testDb.db.run(
        `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, 60, 3, 1)`,
        [t3.id],
      );

      await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: t1.id,
        overall_score: 3,
      });
      await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: t2.id,
        overall_score: 2,
      });
      await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: t3.id,
        overall_score: 1,
      });

      await testDb.db.run(
        `INSERT INTO bracket_entries (
          bracket_id, team_id, seed_position, is_bye,
          final_rank, bracket_raw_score, weighted_bracket_raw_score
        ) VALUES
          (?, ?, 1, 0, 1, 1, 100),
          (?, ?, 2, 0, 2, 0.5, 50),
          (?, ?, 3, 0, 3, 0.33, 10)`,
        [bracket.id, t1.id, bracket.id, t2.id, bracket.id, t3.id],
      );

      const applyRes = await http.post<{
        created: number;
        removed: number;
      }>(`${baseUrl}/awards/event/${event.id}/automatic`);

      expect(applyRes.status).toBe(200);
      expect(applyRes.json.created).toBeGreaterThan(0);

      const listRes = await http.get<{ name: string }[]>(
        `${baseUrl}/awards/event/${event.id}`,
      );
      expect(listRes.status).toBe(200);
      expect(listRes.json.some((a) => a.name.startsWith('Auto: '))).toBe(true);
    });
  });
});
