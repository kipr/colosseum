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
import { getApiError, getApiErrorMessage } from './helpers/apiError';
import {
  seedEvent,
  seedUser,
  seedTeam,
  seedBracket,
  seedAwardTemplate,
  seedEventAward,
  seedEventAwardRecipient,
  seedEventAwardIndividualRecipient,
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

      const listRes = await http.get<unknown[]>(`${baseUrl}/awards/templates`);
      expect(listRes.json).toHaveLength(0);
    });

    it('creates and updates award_type on templates', async () => {
      const created = await http.post<Record<string, unknown>>(
        `${baseUrl}/awards/templates`,
        {
          name: 'Paper Prize',
          award_type: 'certificate',
        },
      );
      expect(created.status).toBe(201);
      expect(created.json.award_type).toBe('certificate');

      const updated = await http.patch<Record<string, unknown>>(
        `${baseUrl}/awards/templates/${created.json.id}`,
        { award_type: 'trophy' },
      );
      expect(updated.status).toBe(200);
      expect(updated.json.award_type).toBe('trophy');
    });

    it('rejects invalid award_type on templates', async () => {
      const res = await http.post(`${baseUrl}/awards/templates`, {
        name: 'Bad Type',
        award_type: 'medal',
      });
      expect(res.status).toBe(400);
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
      expect(
        (res.json as Record<string, unknown>).individual_recipients,
      ).toEqual([]);
    });

    it('creates an event award from template', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const t = await seedAwardTemplate(testDb.db, {
        name: 'Sportsmanship',
        description: 'Fair play',
        award_type: 'certificate',
      });
      const res = await http.post(`${baseUrl}/awards/event/${event.id}`, {
        template_award_id: t.id,
      });
      expect(res.status).toBe(201);
      expect((res.json as Record<string, unknown>).name).toBe('Sportsmanship');
      expect((res.json as Record<string, unknown>).template_award_id).toBe(
        t.id,
      );
      expect((res.json as Record<string, unknown>).award_type).toBe(
        'certificate',
      );
    });

    it('creates and updates event award award_type', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const created = await http.post<Record<string, unknown>>(
        `${baseUrl}/awards/event/${event.id}`,
        { name: 'Spirit', award_type: 'certificate' },
      );
      expect(created.status).toBe(201);
      expect(created.json.award_type).toBe('certificate');

      const updated = await http.patch<Record<string, unknown>>(
        `${baseUrl}/awards/event-awards/${created.json.id}`,
        { award_type: 'trophy' },
      );
      expect(updated.status).toBe(200);
      expect(updated.json.award_type).toBe('trophy');
    });

    it('rejects invalid award_type on event awards', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const res = await http.post(`${baseUrl}/awards/event/${event.id}`, {
        name: 'Bad',
        award_type: 'ribbon',
      });
      expect(res.status).toBe(400);
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
        {
          name: string;
          recipients: { team_number: number }[];
          individual_recipients: unknown[];
        }[]
      >(`${baseUrl}/awards/event/${event.id}`);
      expect(res.status).toBe(200);
      expect(res.json).toHaveLength(1);
      expect(res.json[0].name).toBe('MVP');
      expect(res.json[0].recipients).toHaveLength(1);
      expect(res.json[0].recipients[0].team_number).toBe(1);
      expect(res.json[0].individual_recipients).toEqual([]);
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

    it('adds multiple recipients via team_ids', async () => {
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
        name: 'Bulk recipients',
      });

      const res = await http.post<{ team_id: number }[]>(
        `${baseUrl}/awards/event-awards/${award.id}/recipients`,
        { team_ids: [t1.id, t2.id] },
      );
      expect(res.status).toBe(201);
      expect(res.json).toHaveLength(2);
      expect(res.json.map((r) => r.team_id).sort()).toEqual(
        [t1.id, t2.id].sort(),
      );
    });

    it('rejects bulk team_ids with a cross-event team', async () => {
      const event1 = await seedEvent(testDb.db, {
        name: 'Event 1',
        status: 'active',
      });
      const event2 = await seedEvent(testDb.db, {
        name: 'Event 2',
        status: 'active',
      });
      const local = await seedTeam(testDb.db, {
        event_id: event1.id,
        team_number: 1,
      });
      const foreign = await seedTeam(testDb.db, {
        event_id: event2.id,
        team_number: 2,
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event1.id,
        name: 'Bulk cross-event',
      });

      const res = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/recipients`,
        { team_ids: [local.id, foreign.id] },
      );
      expect(res.status).toBe(400);
    });

    it('rejects bulk team_ids containing any non-integer', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Bulk invalid id',
      });

      const res = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/recipients`,
        { team_ids: [team.id, 'invalid'] },
      );
      expect(res.status).toBe(400);
      expect(getApiErrorMessage(res.json)).toMatch(/integers/i);

      const recipients = await testDb.db.all(
        'SELECT team_id FROM event_award_recipients WHERE event_award_id = ?',
        [award.id],
      );
      expect(recipients).toHaveLength(0);
    });
  });

  describe('GET /awards/event/:eventId/team-award-counts', () => {
    it('returns per-team certificate and trophy counts including Auto awards', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const t1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Alpha',
      });
      const t2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
        team_name: 'Beta',
      });
      const t3 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 3,
        team_name: 'Gamma',
      });

      const cert = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Spirit',
        award_type: 'certificate',
      });
      const trophy = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Champion',
        award_type: 'trophy',
      });
      const auto = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Auto: DE — Main — 1st',
        award_type: 'trophy',
      });

      await seedEventAwardRecipient(testDb.db, {
        event_award_id: cert.id,
        team_id: t1.id,
      });
      await seedEventAwardRecipient(testDb.db, {
        event_award_id: trophy.id,
        team_id: t1.id,
      });
      await seedEventAwardRecipient(testDb.db, {
        event_award_id: auto.id,
        team_id: t2.id,
      });

      const res = await http.get<
        {
          team_id: number;
          team_number: number;
          certificate_count: number;
          trophy_count: number;
        }[]
      >(`${baseUrl}/awards/event/${event.id}/team-award-counts`);
      expect(res.status).toBe(200);
      expect(res.json).toHaveLength(3);

      const byId = new Map(res.json.map((r) => [r.team_id, r]));
      expect(byId.get(t1.id)).toMatchObject({
        certificate_count: 1,
        trophy_count: 1,
      });
      expect(byId.get(t2.id)).toMatchObject({
        certificate_count: 0,
        trophy_count: 1,
      });
      expect(byId.get(t3.id)).toMatchObject({
        certificate_count: 0,
        trophy_count: 0,
      });
    });
  });

  // ── Individual Recipients ──

  describe('Event Award Individual Recipients', () => {
    it('adds an individual recipient with a team', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 7,
        team_name: 'Circuit Breakers',
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Outstanding Programming',
      });

      const res = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients`,
        {
          name: 'Ada Lovelace',
          team_id: team.id,
        },
      );
      expect(res.status).toBe(201);
      const body = res.json as Record<string, unknown>;
      expect(body.id).toBeDefined();
      expect(body.event_award_id).toBe(award.id);
      expect(body.name).toBe('Ada Lovelace');
      expect(body.team_id).toBe(team.id);
      expect(body.team_number).toBe(7);
      expect(body.team_name).toBe('Circuit Breakers');
      expect(body.display_name).toBeNull();
    });

    it('adds an individual recipient without a team', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Volunteer of the Year',
      });

      const res = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients`,
        { name: 'Grace Hopper' },
      );
      expect(res.status).toBe(201);
      const body = res.json as Record<string, unknown>;
      expect(body.name).toBe('Grace Hopper');
      expect(body.team_id).toBeNull();
      expect(body.team_number).toBeNull();
      expect(body.team_name).toBeNull();
    });

    it('trims the individual recipient name', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Trim test',
      });

      const res = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients`,
        { name: '  Katherine Johnson  ' },
      );
      expect(res.status).toBe(201);
      expect((res.json as Record<string, unknown>).name).toBe(
        'Katherine Johnson',
      );
    });

    it('rejects blank individual recipient names', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Blank name test',
      });

      const missing = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients`,
        {},
      );
      expect(missing.status).toBe(400);

      const blank = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients`,
        { name: '   ' },
      );
      expect(blank.status).toBe(400);
    });

    it('rejects individual recipient names longer than 200 characters', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Long name test',
      });

      const res = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients`,
        { name: 'a'.repeat(201) },
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when the award does not exist', async () => {
      const res = await http.post(
        `${baseUrl}/awards/event-awards/99999/individual-recipients`,
        { name: 'Nobody' },
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 when the associated team does not exist', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Missing team',
      });

      const res = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients`,
        { name: 'Ada Lovelace', team_id: 99999 },
      );
      expect(res.status).toBe(404);
      expect((res.json as Record<string, unknown>).error).toMatch(/team/i);
    });

    it('rejects an associated team from another event', async () => {
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
        name: 'Cross-event individual',
      });

      const res = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients`,
        { name: 'Ada Lovelace', team_id: team2.id },
      );
      expect(res.status).toBe(400);
      expect((res.json as Record<string, unknown>).error).toMatch(
        /same event/i,
      );
    });

    it('allows two people with the same name on one award', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Duplicate names',
      });

      const r1 = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients`,
        { name: 'Alex Smith' },
      );
      const r2 = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients`,
        { name: 'Alex Smith' },
      );
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect((r1.json as Record<string, unknown>).id).not.toBe(
        (r2.json as Record<string, unknown>).id,
      );
    });

    it('lists team and individual recipients together', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 7,
        team_name: 'Circuit Breakers',
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Mixed',
      });
      await seedEventAwardRecipient(testDb.db, {
        event_award_id: award.id,
        team_id: team.id,
      });
      await seedEventAwardIndividualRecipient(testDb.db, {
        event_award_id: award.id,
        name: 'Ada Lovelace',
        team_id: team.id,
      });

      const res = await http.get<
        {
          recipients: { team_id: number; team_number: number }[];
          individual_recipients: {
            id: number;
            name: string;
            team_id: number | null;
            team_number: number | null;
          }[];
        }[]
      >(`${baseUrl}/awards/event/${event.id}`);
      expect(res.status).toBe(200);
      expect(res.json[0].recipients).toHaveLength(1);
      expect(res.json[0].recipients[0].team_number).toBe(7);
      expect(res.json[0].individual_recipients).toHaveLength(1);
      expect(res.json[0].individual_recipients[0].name).toBe('Ada Lovelace');
      expect(res.json[0].individual_recipients[0].team_id).toBe(team.id);
      expect(res.json[0].individual_recipients[0].team_number).toBe(7);
    });

    it('removes an individual recipient by recipient id', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Remove individual',
      });
      const recipient = await seedEventAwardIndividualRecipient(testDb.db, {
        event_award_id: award.id,
        name: 'To Remove',
      });

      const res = await http.delete(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients/${recipient.id}`,
      );
      expect(res.status).toBe(200);

      const listRes = await http.get<{ individual_recipients: unknown[] }[]>(
        `${baseUrl}/awards/event/${event.id}`,
      );
      expect(listRes.json[0].individual_recipients).toEqual([]);
    });

    it('returns 404 when deleting a recipient that belongs to another award', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const award1 = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Award 1',
      });
      const award2 = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Award 2',
      });
      const recipient = await seedEventAwardIndividualRecipient(testDb.db, {
        event_award_id: award1.id,
        name: 'Wrong Award',
      });

      const res = await http.delete(
        `${baseUrl}/awards/event-awards/${award2.id}/individual-recipients/${recipient.id}`,
      );
      expect(res.status).toBe(404);

      const remaining = await testDb.db.get(
        `SELECT id FROM event_award_individual_recipients WHERE id = ?`,
        [recipient.id],
      );
      expect(remaining).toBeTruthy();
    });

    it('preserves the individual recipient and nulls team_id after team deletion', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 7,
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Team deleted',
      });
      const recipient = await seedEventAwardIndividualRecipient(testDb.db, {
        event_award_id: award.id,
        name: 'Ada Lovelace',
        team_id: team.id,
      });

      await testDb.db.run(`DELETE FROM teams WHERE id = ?`, [team.id]);

      const row = (await testDb.db.get(
        `SELECT id, name, team_id FROM event_award_individual_recipients WHERE id = ?`,
        [recipient.id],
      )) as Record<string, unknown>;
      expect(row.name).toBe('Ada Lovelace');
      expect(row.team_id).toBeNull();

      const listRes = await http.get<
        {
          individual_recipients: {
            name: string;
            team_id: number | null;
            team_number: number | null;
          }[];
        }[]
      >(`${baseUrl}/awards/event/${event.id}`);
      expect(listRes.json[0].individual_recipients).toHaveLength(1);
      expect(listRes.json[0].individual_recipients[0].name).toBe(
        'Ada Lovelace',
      );
      expect(listRes.json[0].individual_recipients[0].team_id).toBeNull();
      expect(listRes.json[0].individual_recipients[0].team_number).toBeNull();
    });

    it('cascades deletion of individual recipients when the award is deleted', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Cascade',
      });
      await seedEventAwardIndividualRecipient(testDb.db, {
        event_award_id: award.id,
        name: 'Ada Lovelace',
      });

      const res = await http.delete(
        `${baseUrl}/awards/event-awards/${award.id}`,
      );
      expect(res.status).toBe(200);

      const remaining = await testDb.db.all(
        `SELECT id FROM event_award_individual_recipients WHERE event_award_id = ?`,
        [award.id],
      );
      expect(remaining).toHaveLength(0);
    });

    it('keeps team-recipient responses unchanged when individuals are also present', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 42,
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Regression',
      });

      const teamRes = await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/recipients`,
        { team_id: team.id },
      );
      expect(teamRes.status).toBe(201);
      expect((teamRes.json as Record<string, unknown>).team_number).toBe(42);
      expect((teamRes.json as Record<string, unknown>).name).toBeUndefined();

      await http.post(
        `${baseUrl}/awards/event-awards/${award.id}/individual-recipients`,
        { name: 'Ada Lovelace', team_id: team.id },
      );

      const listRes = await http.get<
        {
          recipients: {
            team_id: number;
            team_number: number;
            name?: string;
          }[];
          individual_recipients: { name: string }[];
        }[]
      >(`${baseUrl}/awards/event/${event.id}`);
      expect(listRes.json[0].recipients).toHaveLength(1);
      expect(listRes.json[0].recipients[0].team_id).toBe(team.id);
      expect(listRes.json[0].recipients[0].team_number).toBe(42);
      expect(listRes.json[0].recipients[0].name).toBeUndefined();
      expect(listRes.json[0].individual_recipients).toHaveLength(1);
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
      const res = await http.get(`${baseUrl}/awards/event/${event.id}/public`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for active event', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const res = await http.get(`${baseUrl}/awards/event/${event.id}/public`);
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
      await seedEventAwardIndividualRecipient(testDb.db, {
        event_award_id: award.id,
        name: 'Ada Lovelace',
        team_id: team.id,
      });

      const res = await http.get<{
        manual: {
          name: string;
          description: string;
          recipients: { team_number: number; team_name: string }[];
          individual_recipients: {
            name: string;
            team_number: number | null;
            team_name: string | null;
            display_name: string | null;
            id?: number;
            team_id?: number;
          }[];
        }[];
      }>(`${baseUrl}/awards/event/${event.id}/public`);

      expect(res.status).toBe(200);
      expect(res.json.manual).toHaveLength(1);
      expect(res.json.manual[0].name).toBe('Champion');
      expect(res.json.manual[0].description).toBe('First place overall');
      expect(res.json.manual[0].recipients).toHaveLength(1);
      expect(res.json.manual[0].recipients[0].team_number).toBe(7);
      expect(res.json.manual[0].recipients[0].team_name).toBe('Winners');
      expect(res.json.manual[0].individual_recipients).toHaveLength(1);
      expect(res.json.manual[0].individual_recipients[0].name).toBe(
        'Ada Lovelace',
      );
      expect(res.json.manual[0].individual_recipients[0].team_number).toBe(7);
      expect(res.json.manual[0].individual_recipients[0].team_name).toBe(
        'Winners',
      );
      expect(
        res.json.manual[0].individual_recipients[0].display_name,
      ).toBeNull();
      expect(res.json.manual[0].individual_recipients[0]).not.toHaveProperty(
        'id',
      );
      expect(res.json.manual[0].individual_recipients[0]).not.toHaveProperty(
        'team_id',
      );
      expect(res.json.manual[0].individual_recipients[0]).not.toHaveProperty(
        'event_award_id',
      );
    });

    it('does not expose internal IDs in public response', async () => {
      const event = await createReleasedEvent();
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 7,
        team_name: 'Winners',
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'No IDs',
      });
      await seedEventAwardIndividualRecipient(testDb.db, {
        event_award_id: award.id,
        name: 'Ada Lovelace',
        team_id: team.id,
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
      const individuals = first.individual_recipients as Record<
        string,
        unknown
      >[];
      expect(individuals).toHaveLength(1);
      expect(individuals[0]).not.toHaveProperty('id');
      expect(individuals[0]).not.toHaveProperty('event_award_id');
      expect(individuals[0]).not.toHaveProperty('team_id');
      expect(individuals[0].name).toBe('Ada Lovelace');
    });

    it('gates individual recipients behind final score release', async () => {
      const event = await seedEvent(testDb.db, {
        status: 'complete',
      });
      const award = await seedEventAward(testDb.db, {
        event_id: event.id,
        name: 'Secret',
      });
      await seedEventAwardIndividualRecipient(testDb.db, {
        event_award_id: award.id,
        name: 'Ada Lovelace',
      });

      const unreleased = await http.get(
        `${baseUrl}/awards/event/${event.id}/public`,
      );
      expect(unreleased.status).toBe(404);

      await testDb.db.run(
        `UPDATE events SET spectator_results_released = 1 WHERE id = ?`,
        [event.id],
      );

      const released = await http.get<{
        manual: { individual_recipients: { name: string }[] }[];
      }>(`${baseUrl}/awards/event/${event.id}/public`);
      expect(released.status).toBe(200);
      expect(released.json.manual[0].individual_recipients[0].name).toBe(
        'Ada Lovelace',
      );
    });

    it('returns empty manual list for released event with no manual awards', async () => {
      const event = await createReleasedEvent();
      const res = await http.get<{
        manual: unknown[];
        automatic: {
          de: unknown[];
          perBracketOverall: unknown[];
          seeding: unknown;
          settings: {
            de_top_n: number;
            per_bracket_overall_top_n: number;
            seeding_top_n: number;
          };
        };
      }>(`${baseUrl}/awards/event/${event.id}/public`);
      expect(res.status).toBe(200);
      expect(res.json.manual).toEqual([]);
      expect(res.json.automatic.de).toEqual([]);
      expect(res.json.automatic.perBracketOverall).toEqual([]);
      expect(res.json.automatic.seeding).toBeNull();
      expect(res.json.automatic.settings).toEqual({
        de_top_n: 3,
        per_bracket_overall_top_n: 3,
        seeding_top_n: 3,
        de_award_type: 'trophy',
        per_bracket_overall_award_type: 'trophy',
        seeding_award_type: 'trophy',
      });
    });

    it('includes automatic DE and seeding, but skips per-bracket overall for single-bracket events', async () => {
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
            placements: {
              place: number;
              recipients: { team_number: number }[];
            }[];
          }[];
          seeding: {
            placements: {
              place: number;
              recipients: { team_number: number }[];
            }[];
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

      expect(res.json.automatic.seeding).not.toBeNull();
      expect(
        res.json.automatic.seeding!.placements[0].recipients[0].team_number,
      ).toBe(1);
      expect(
        res.json.automatic.seeding!.placements[1].recipients[0].team_number,
      ).toBe(2);
      expect(
        res.json.automatic.seeding!.placements[2].recipients[0].team_number,
      ).toBe(3);
    });

    it('honors persisted top-N settings for public automatic awards', async () => {
      const event = await createReleasedEvent();
      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        name: 'Main Bracket',
        status: 'completed',
      });
      const teams = [];
      for (let n = 1; n <= 4; n++) {
        teams.push(
          await seedTeam(testDb.db, {
            event_id: event.id,
            team_number: n,
            team_name: `Team ${n}`,
          }),
        );
      }
      for (let i = 0; i < teams.length; i++) {
        await testDb.db.run(
          `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, ?, ?, ?)`,
          [teams[i].id, 90 - i * 10, i + 1, 10 - i],
        );
        await seedDocumentationScore(testDb.db, {
          event_id: event.id,
          team_id: teams[i].id,
          overall_score: 4 - i,
        });
        await testDb.db.run(
          `INSERT INTO bracket_entries (
            bracket_id, team_id, seed_position, is_bye,
            final_rank, bracket_raw_score, weighted_bracket_raw_score
          ) VALUES (?, ?, ?, 0, ?, ?, ?)`,
          [bracket.id, teams[i].id, i + 1, i + 1, 1 - i * 0.1, 100 - i * 10],
        );
      }

      await testDb.db.run(
        `INSERT INTO event_automatic_award_settings
           (event_id, de_top_n, per_bracket_overall_top_n, seeding_top_n)
         VALUES (?, 2, 0, 4)`,
        [event.id],
      );

      const res = await http.get<{
        automatic: {
          de: { placements: { place: number }[] }[];
          perBracketOverall: unknown[];
          seeding: { placements: { place: number }[] } | null;
          settings: {
            de_top_n: number;
            per_bracket_overall_top_n: number;
            seeding_top_n: number;
          };
        };
      }>(`${baseUrl}/awards/event/${event.id}/public`);

      expect(res.status).toBe(200);
      expect(res.json.automatic.settings).toEqual({
        de_top_n: 2,
        per_bracket_overall_top_n: 0,
        seeding_top_n: 4,
        de_award_type: 'trophy',
        per_bracket_overall_award_type: 'trophy',
        seeding_award_type: 'trophy',
      });
      expect(res.json.automatic.de[0].placements.map((p) => p.place)).toEqual([
        1, 2,
      ]);
      expect(res.json.automatic.perBracketOverall).toEqual([]);
      expect(
        res.json.automatic.seeding!.placements.map((p) => p.place),
      ).toEqual([1, 2, 3, 4]);
    });
  });

  describe('GET /awards/event/:eventId/automatic/preview', () => {
    it('returns defaults, diagnostics, and preview for proposed top-N values', async () => {
      const event = await seedEvent(testDb.db, { name: 'Preview Event' });
      const t1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Only',
      });
      await testDb.db.run(
        `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, 80, 1, 10)`,
        [t1.id],
      );

      const res = await http.get<{
        teamCount: number;
        settings: { seeding_top_n: number };
        savedSettings: { de_top_n: number };
        hasWarnings: boolean;
        automatic: { seeding: { placements: unknown[] } | null };
        diagnostics: { zeroScoreIssues: unknown[] };
      }>(
        `${baseUrl}/awards/event/${event.id}/automatic/preview?de_top_n=0&per_bracket_overall_top_n=0&seeding_top_n=1`,
      );

      expect(res.status).toBe(200);
      expect(res.json.teamCount).toBe(1);
      expect(res.json.settings.seeding_top_n).toBe(1);
      expect(res.json.savedSettings.de_top_n).toBe(1); // clamped default
      expect(res.json.automatic.seeding?.placements).toHaveLength(1);
      expect(res.json.hasWarnings).toBe(true);
      expect(res.json.diagnostics.zeroScoreIssues.length).toBeGreaterThan(0);
    });

    it('rejects top-N above team count', async () => {
      const event = await seedEvent(testDb.db, { name: 'Bounds' });
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Solo',
      });
      const res = await http.get(
        `${baseUrl}/awards/event/${event.id}/automatic/preview?de_top_n=2&per_bracket_overall_top_n=0&seeding_top_n=0`,
      );
      expect(res.status).toBe(400);
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

    async function seedCompleteResults(eventId: number) {
      const bracket = await seedBracket(testDb.db, {
        event_id: eventId,
        name: 'Main Bracket',
        status: 'completed',
      });
      const t1 = await seedTeam(testDb.db, {
        event_id: eventId,
        team_number: 1,
        team_name: 'First',
      });
      const t2 = await seedTeam(testDb.db, {
        event_id: eventId,
        team_number: 2,
        team_name: 'Second',
      });
      const t3 = await seedTeam(testDb.db, {
        event_id: eventId,
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
        event_id: eventId,
        team_id: t1.id,
        overall_score: 3,
      });
      await seedDocumentationScore(testDb.db, {
        event_id: eventId,
        team_id: t2.id,
        overall_score: 2,
      });
      await seedDocumentationScore(testDb.db, {
        event_id: eventId,
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

      return { bracket, t1, t2, t3 };
    }

    it('creates Auto: event award rows from computed results', async () => {
      const event = await createReleasedEventForApply();
      await seedCompleteResults(event.id);

      const applyRes = await http.post<{
        created: number;
        removed: number;
        settings: { de_top_n: number };
      }>(`${baseUrl}/awards/event/${event.id}/automatic`, {
        de_top_n: 3,
        per_bracket_overall_top_n: 0,
        seeding_top_n: 3,
      });

      expect(applyRes.status).toBe(200);
      expect(applyRes.json.created).toBeGreaterThan(0);
      expect(applyRes.json.settings.de_top_n).toBe(3);

      const listRes = await http.get<{ name: string }[]>(
        `${baseUrl}/awards/event/${event.id}`,
      );
      expect(listRes.status).toBe(200);
      expect(listRes.json.some((a) => a.name.startsWith('Auto: '))).toBe(true);
      expect(listRes.json.some((a) => a.name.includes('Seeding'))).toBe(true);
    });

    it('applies configured award types to Auto: event awards', async () => {
      const event = await createReleasedEventForApply();
      await seedCompleteResults(event.id);

      const applyRes = await http.post<{
        created: number;
        settings: {
          de_award_type: string;
          seeding_award_type: string;
        };
      }>(`${baseUrl}/awards/event/${event.id}/automatic`, {
        de_top_n: 1,
        per_bracket_overall_top_n: 0,
        seeding_top_n: 1,
        de_award_type: 'trophy',
        seeding_award_type: 'certificate',
      });
      expect(applyRes.status).toBe(200);
      expect(applyRes.json.settings.de_award_type).toBe('trophy');
      expect(applyRes.json.settings.seeding_award_type).toBe('certificate');

      const listRes = await http.get<{ name: string; award_type: string }[]>(
        `${baseUrl}/awards/event/${event.id}`,
      );
      const deAward = listRes.json.find((a) => a.name.includes('DE —'));
      const seedingAward = listRes.json.find((a) => a.name.includes('Seeding'));
      expect(deAward?.award_type).toBe('trophy');
      expect(seedingAward?.award_type).toBe('certificate');
    });

    it('persists settings, disables categories with 0, and replaces prior Auto awards', async () => {
      const event = await createReleasedEventForApply();
      await seedCompleteResults(event.id);

      const first = await http.post<{ created: number; removed: number }>(
        `${baseUrl}/awards/event/${event.id}/automatic`,
        {
          de_top_n: 3,
          per_bracket_overall_top_n: 0,
          seeding_top_n: 3,
        },
      );
      expect(first.status).toBe(200);
      expect(first.json.created).toBe(6); // 3 DE + 3 seeding

      const second = await http.post<{
        created: number;
        removed: number;
        settings: {
          de_top_n: number;
          per_bracket_overall_top_n: number;
          seeding_top_n: number;
        };
      }>(`${baseUrl}/awards/event/${event.id}/automatic`, {
        de_top_n: 1,
        per_bracket_overall_top_n: 0,
        seeding_top_n: 0,
      });
      expect(second.status).toBe(200);
      expect(second.json.removed).toBe(6);
      expect(second.json.created).toBe(1);
      expect(second.json.settings).toEqual({
        de_top_n: 1,
        per_bracket_overall_top_n: 0,
        seeding_top_n: 0,
        de_award_type: 'trophy',
        per_bracket_overall_award_type: 'trophy',
        seeding_award_type: 'trophy',
      });

      const listRes = await http.get<{ name: string }[]>(
        `${baseUrl}/awards/event/${event.id}`,
      );
      expect(listRes.json).toHaveLength(1);
      expect(listRes.json[0].name).toContain('1st');
      expect(listRes.json[0].name).toContain('DE');
    });

    it('requires acknowledgement when diagnostics report warnings', async () => {
      const event = await createReleasedEventForApply();
      const t1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Missing Scores',
      });
      // No doc/seed/DE — zero-score warnings expected
      void t1;

      const blocked = await http.post<{
        error: string;
        requires_acknowledgement: boolean;
        hasWarnings: boolean;
      }>(`${baseUrl}/awards/event/${event.id}/automatic`, {
        de_top_n: 0,
        per_bracket_overall_top_n: 0,
        seeding_top_n: 0,
      });
      expect(blocked.status).toBe(409);
      expect(blocked.json.requires_acknowledgement).toBe(true);
      expect(blocked.json.hasWarnings).toBe(true);

      const applied = await http.post<{ created: number }>(
        `${baseUrl}/awards/event/${event.id}/automatic`,
        {
          de_top_n: 0,
          per_bracket_overall_top_n: 0,
          seeding_top_n: 0,
          acknowledge_warnings: true,
        },
      );
      expect(applied.status).toBe(200);
      expect(applied.json.created).toBe(0);
    });

    it('rejects top-N above team count', async () => {
      const event = await createReleasedEventForApply();
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Solo',
      });
      const res = await http.post(
        `${baseUrl}/awards/event/${event.id}/automatic`,
        {
          de_top_n: 5,
          per_bracket_overall_top_n: 0,
          seeding_top_n: 0,
          acknowledge_warnings: true,
        },
      );
      expect(res.status).toBe(400);
    });

    it('creates places beyond third with ordinal names', async () => {
      const event = await createReleasedEventForApply();
      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        name: 'Main Bracket',
        status: 'completed',
      });
      const teams = [];
      for (let n = 1; n <= 4; n++) {
        const t = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: n,
          team_name: `Team ${n}`,
        });
        teams.push(t);
        await testDb.db.run(
          `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score) VALUES (?, ?, ?, ?)`,
          [t.id, 100 - n, n, 10],
        );
        await seedDocumentationScore(testDb.db, {
          event_id: event.id,
          team_id: t.id,
          overall_score: 5,
        });
        await testDb.db.run(
          `INSERT INTO bracket_entries (
            bracket_id, team_id, seed_position, is_bye,
            final_rank, bracket_raw_score, weighted_bracket_raw_score
          ) VALUES (?, ?, ?, 0, ?, 1, 10)`,
          [bracket.id, t.id, n, n],
        );
      }

      const res = await http.post<{ created: number }>(
        `${baseUrl}/awards/event/${event.id}/automatic`,
        {
          de_top_n: 4,
          per_bracket_overall_top_n: 0,
          seeding_top_n: 0,
        },
      );
      expect(res.status).toBe(200);
      expect(res.json.created).toBe(4);

      const listRes = await http.get<{ name: string }[]>(
        `${baseUrl}/awards/event/${event.id}`,
      );
      expect(listRes.json.some((a) => a.name.includes('4th'))).toBe(true);
    });
  });
});
