/**
 * Additional tests for teams routes – DELETE, check-in, and bulk check-in edge cases.
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
import { seedEvent, seedTeam, seedUser } from './helpers/seed';
import teamsRoutes from '../../src/server/routes/teams';

describe('Teams Routes – extra coverage', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const user = await seedUser(testDb.db, { is_admin: true });
    const app = createTestApp({ user: { id: user.id, is_admin: true } });
    app.use('/teams', teamsRoutes);
    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('DELETE /teams/:id', () => {
    it('deletes team and creates audit entry', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 42,
      });

      const res = await http.delete(`${baseUrl}/teams/${team.id}`);
      expect(res.status).toBe(204);

      const row = await testDb.db.get('SELECT id FROM teams WHERE id = ?', [
        team.id,
      ]);
      expect(row).toBeUndefined();

      const audit = await testDb.db.get(
        "SELECT * FROM audit_log WHERE action = 'team_deleted' AND entity_id = ?",
        [team.id],
      );
      expect(audit).toBeDefined();
      expect(audit.event_id).toBe(event.id);
    });

    it('returns 204 even when team does not exist (idempotent)', async () => {
      const res = await http.delete(`${baseUrl}/teams/99999`);
      expect(res.status).toBe(204);
    });
  });

  describe('PATCH /teams/:id/check-in', () => {
    it('checks in a team', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 10,
      });

      const res = await http.patch(`${baseUrl}/teams/${team.id}/check-in`, {});
      expect(res.status).toBe(200);
      const body = res.json as {
        status: string;
        checked_in_at: string | null;
      };
      expect(body.status).toBe('checked_in');
      expect(body.checked_in_at).not.toBeNull();
    });

    it('returns 404 when team not found', async () => {
      const res = await http.patch(`${baseUrl}/teams/99999/check-in`, {});
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /teams/event/:eventId/check-in/bulk', () => {
    it('returns 400 when team_numbers is not an array', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.patch(
        `${baseUrl}/teams/event/${event.id}/check-in/bulk`,
        { team_numbers: 'not-array' },
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when event does not exist', async () => {
      const res = await http.patch(
        `${baseUrl}/teams/event/99999/check-in/bulk`,
        { team_numbers: [1, 2] },
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Event does not exist',
      );
    });

    it('bulk checks in teams and reports not_found', async () => {
      const event = await seedEvent(testDb.db);
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });

      const res = await http.patch(
        `${baseUrl}/teams/event/${event.id}/check-in/bulk`,
        { team_numbers: [1, 2, 999] },
      );
      expect(res.status).toBe(200);
      const body = res.json as { updated: number; not_found: number[] };
      expect(body.updated).toBe(2);
      expect(body.not_found).toContain(999);
    });

    it('handles empty not_found list', async () => {
      const event = await seedEvent(testDb.db);
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.patch(
        `${baseUrl}/teams/event/${event.id}/check-in/bulk`,
        { team_numbers: [1] },
      );
      expect(res.status).toBe(200);
      const body = res.json as { updated: number; not_found?: number[] };
      expect(body.updated).toBe(1);
      expect(body.not_found).toBeUndefined();
    });
  });

  describe('POST /teams – constraint errors', () => {
    it('returns 409 for duplicate team number', async () => {
      const event = await seedEvent(testDb.db);
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.post(`${baseUrl}/teams`, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Duplicate',
      });
      expect(res.status).toBe(409);
      expect((res.json as { error: string }).error).toContain('already exists');
    });

    it('returns 400 for nonexistent event FK', async () => {
      const res = await http.post(`${baseUrl}/teams`, {
        event_id: 99999,
        team_number: 1,
        team_name: 'No Event',
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Event does not exist',
      );
    });
  });

  describe('PATCH /teams/:id – constraint errors', () => {
    it('returns 409 for duplicate team number update', async () => {
      const event = await seedEvent(testDb.db);
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });

      const res = await http.patch(`${baseUrl}/teams/${team2.id}`, {
        team_number: 1,
      });
      expect(res.status).toBe(409);
      expect((res.json as { error: string }).error).toContain('already exists');
    });
  });

  describe('POST /teams/bulk – edge cases', () => {
    it('reports duplicate team numbers within payload', async () => {
      const event = await seedEvent(testDb.db);

      const res = await http.post(`${baseUrl}/teams/bulk`, {
        event_id: event.id,
        teams: [
          { team_number: 1, team_name: 'A' },
          { team_number: 1, team_name: 'B' },
        ],
      });
      expect(res.status).toBe(201);
      const body = res.json as {
        created: number;
        errors: { index: number; error: string }[];
      };
      expect(body.created).toBe(1);
      expect(body.errors.length).toBe(1);
      expect(body.errors[0].error).toContain('Duplicate');
    });

    it('reports existing team numbers in database', async () => {
      const event = await seedEvent(testDb.db);
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.post(`${baseUrl}/teams/bulk`, {
        event_id: event.id,
        teams: [
          { team_number: 1, team_name: 'Existing' },
          { team_number: 2, team_name: 'New' },
        ],
      });
      expect(res.status).toBe(201);
      const body = res.json as {
        created: number;
        errors: { index: number; error: string }[];
      };
      expect(body.created).toBe(1);
      expect(body.errors.length).toBe(1);
      expect(body.errors[0].error).toContain('already exists');
    });

    it('returns 400 when all teams missing required fields', async () => {
      const event = await seedEvent(testDb.db);

      const res = await http.post(`${baseUrl}/teams/bulk`, {
        event_id: event.id,
        teams: [{ team_number: null, team_name: null }],
      });
      expect(res.status).toBe(201);
      const body = res.json as {
        created: number;
        errors: { index: number; error: string }[];
      };
      expect(body.created).toBe(0);
      expect(body.errors.length).toBe(1);
    });

    it('returns 400 when event does not exist', async () => {
      const res = await http.post(`${baseUrl}/teams/bulk`, {
        event_id: 99999,
        teams: [{ team_number: 1, team_name: 'A' }],
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Event does not exist',
      );
    });
  });
});
