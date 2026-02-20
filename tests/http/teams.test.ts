/**
 * HTTP route tests for /teams endpoints.
 * Covers CRUD, bulk create, check-in, and authorization.
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

describe('Teams Routes', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(async () => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  // ==========================================================================
  // Authentication Boundaries
  // ==========================================================================

  describe('Authentication Boundaries', () => {
    describe('GET /teams/event/:eventId (public)', () => {
      it('allows unauthenticated access', async () => {
        const event = await seedEvent(testDb.db);
        const app = createTestApp();
        app.use('/teams', teamsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(
            `${server.baseUrl}/teams/event/${event.id}`,
          );
          expect(res.status).toBe(200);
        } finally {
          await server.close();
        }
      });
    });

    describe('GET /teams/:id (public)', () => {
      it('allows unauthenticated access', async () => {
        const event = await seedEvent(testDb.db);
        const team = await seedTeam(testDb.db, {
          event_id: event.id,
          team_number: 1,
        });
        const app = createTestApp();
        app.use('/teams', teamsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(`${server.baseUrl}/teams/${team.id}`);
          expect(res.status).toBe(200);
        } finally {
          await server.close();
        }
      });
    });

    describe('POST /teams (auth required)', () => {
      it('returns 401 when not authenticated', async () => {
        const app = createTestApp();
        app.use('/teams', teamsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(`${server.baseUrl}/teams`, {
            event_id: 1,
            team_number: 1,
            team_name: 'Test',
          });
          expect(res.status).toBe(401);
        } finally {
          await server.close();
        }
      });
    });

    describe('PATCH /teams/:id (auth required)', () => {
      it('returns 401 when not authenticated', async () => {
        const app = createTestApp();
        app.use('/teams', teamsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.patch(`${server.baseUrl}/teams/1`, {
            team_name: 'Updated',
          });
          expect(res.status).toBe(401);
        } finally {
          await server.close();
        }
      });
    });

    describe('DELETE /teams/:id (auth required)', () => {
      it('returns 401 when not authenticated', async () => {
        const app = createTestApp();
        app.use('/teams', teamsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.delete(`${server.baseUrl}/teams/1`);
          expect(res.status).toBe(401);
        } finally {
          await server.close();
        }
      });
    });
  });

  // ==========================================================================
  // GET /teams/event/:eventId
  // ==========================================================================

  describe('GET /teams/event/:eventId', () => {
    let server: TestServerHandle;
    let eventId: number;

    beforeEach(async () => {
      const event = await seedEvent(testDb.db);
      eventId = event.id;
      const app = createTestApp({ user: { id: 1, is_admin: false } });
      app.use('/teams', teamsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns empty array when no teams exist', async () => {
      const res = await http.get(`${server.baseUrl}/teams/event/${eventId}`);
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns teams for the event', async () => {
      await seedTeam(testDb.db, {
        event_id: eventId,
        team_number: 1,
        team_name: 'Alpha',
      });
      await seedTeam(testDb.db, {
        event_id: eventId,
        team_number: 2,
        team_name: 'Beta',
      });

      const res = await http.get(`${server.baseUrl}/teams/event/${eventId}`);
      expect(res.status).toBe(200);
      const teams = res.json as { team_name: string }[];
      expect(teams.length).toBe(2);
    });

    it('returns teams ordered by team_number', async () => {
      await seedTeam(testDb.db, {
        event_id: eventId,
        team_number: 5,
        team_name: 'Five',
      });
      await seedTeam(testDb.db, {
        event_id: eventId,
        team_number: 2,
        team_name: 'Two',
      });

      const res = await http.get(`${server.baseUrl}/teams/event/${eventId}`);
      const teams = res.json as { team_number: number }[];
      expect(teams[0].team_number).toBe(2);
      expect(teams[1].team_number).toBe(5);
    });

    it('filters by status', async () => {
      await seedTeam(testDb.db, {
        event_id: eventId,
        team_number: 1,
        status: 'registered',
      });
      await seedTeam(testDb.db, {
        event_id: eventId,
        team_number: 2,
        status: 'checked_in',
      });

      const res = await http.get(
        `${server.baseUrl}/teams/event/${eventId}?status=checked_in`,
      );
      const teams = res.json as { status: string }[];
      expect(teams.length).toBe(1);
      expect(teams[0].status).toBe('checked_in');
    });
  });

  // ==========================================================================
  // GET /teams/:id
  // ==========================================================================

  describe('GET /teams/:id', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: { id: 1, is_admin: false } });
      app.use('/teams', teamsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 404 when team not found', async () => {
      const res = await http.get(`${server.baseUrl}/teams/999`);
      expect(res.status).toBe(404);
      expect((res.json as { error: string }).error).toContain('Team not found');
    });

    it('returns the team when found', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 42,
        team_name: 'Robotics',
      });

      const res = await http.get(`${server.baseUrl}/teams/${team.id}`);
      expect(res.status).toBe(200);
      const result = res.json as { team_number: number; team_name: string };
      expect(result.team_number).toBe(42);
      expect(result.team_name).toBe('Robotics');
    });
  });

  // ==========================================================================
  // POST /teams
  // ==========================================================================

  describe('POST /teams', () => {
    let server: TestServerHandle;
    let eventId: number;
    let userId: number;

    beforeEach(async () => {
      const user = await seedUser(testDb.db, { is_admin: true });
      userId = user.id;
      const event = await seedEvent(testDb.db);
      eventId = event.id;

      const app = createTestApp({ user: { id: userId, is_admin: true } });
      app.use('/teams', teamsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await http.post(`${server.baseUrl}/teams`, {});
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'event_id, team_number, and team_name are required',
      );
    });

    it('creates team with defaults', async () => {
      const res = await http.post(`${server.baseUrl}/teams`, {
        event_id: eventId,
        team_number: 10,
        team_name: 'Gearheads',
      });

      expect(res.status).toBe(201);
      const team = res.json as {
        id: number;
        team_number: number;
        team_name: string;
        status: string;
        display_name: string;
      };
      expect(team.team_number).toBe(10);
      expect(team.team_name).toBe('Gearheads');
      expect(team.status).toBe('registered');
      expect(team.display_name).toBe('10 Gearheads');
    });

    it('creates team with custom display_name', async () => {
      const res = await http.post(`${server.baseUrl}/teams`, {
        event_id: eventId,
        team_number: 10,
        team_name: 'Gearheads',
        display_name: 'The Gears',
      });

      expect(res.status).toBe(201);
      const team = res.json as { display_name: string };
      expect(team.display_name).toBe('The Gears');
    });

    it('returns 409 for duplicate team_number in same event', async () => {
      await seedTeam(testDb.db, { event_id: eventId, team_number: 10 });

      const res = await http.post(`${server.baseUrl}/teams`, {
        event_id: eventId,
        team_number: 10,
        team_name: 'Duplicate',
      });

      expect(res.status).toBe(409);
      expect((res.json as { error: string }).error).toContain(
        'Team number already exists',
      );
    });

    it('returns 400 when event does not exist', async () => {
      const res = await http.post(`${server.baseUrl}/teams`, {
        event_id: 9999,
        team_number: 1,
        team_name: 'Test',
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Event does not exist',
      );
    });
  });

  // ==========================================================================
  // POST /teams/bulk
  // ==========================================================================

  describe('POST /teams/bulk', () => {
    let server: TestServerHandle;
    let eventId: number;

    beforeEach(async () => {
      const user = await seedUser(testDb.db, { is_admin: true });
      const event = await seedEvent(testDb.db);
      eventId = event.id;

      const app = createTestApp({ user: { id: user.id, is_admin: true } });
      app.use('/teams', teamsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when teams array is missing', async () => {
      const res = await http.post(`${server.baseUrl}/teams/bulk`, {
        event_id: eventId,
      });
      expect(res.status).toBe(400);
    });

    it('creates multiple teams', async () => {
      const res = await http.post(`${server.baseUrl}/teams/bulk`, {
        event_id: eventId,
        teams: [
          { team_number: 1, team_name: 'Alpha' },
          { team_number: 2, team_name: 'Beta' },
          { team_number: 3, team_name: 'Gamma' },
        ],
      });

      expect(res.status).toBe(201);
      const result = res.json as { created: number };
      expect(result.created).toBe(3);
    });

    it('reports errors for duplicate team_numbers in payload', async () => {
      const res = await http.post(`${server.baseUrl}/teams/bulk`, {
        event_id: eventId,
        teams: [
          { team_number: 1, team_name: 'Alpha' },
          { team_number: 1, team_name: 'Duplicate' },
        ],
      });

      expect(res.status).toBe(201);
      const result = res.json as {
        created: number;
        errors?: { index: number; error: string }[];
      };
      expect(result.created).toBe(1);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBe(1);
    });

    it('skips teams that already exist in the database', async () => {
      await seedTeam(testDb.db, { event_id: eventId, team_number: 1 });

      const res = await http.post(`${server.baseUrl}/teams/bulk`, {
        event_id: eventId,
        teams: [
          { team_number: 1, team_name: 'Existing' },
          { team_number: 2, team_name: 'New' },
        ],
      });

      expect(res.status).toBe(201);
      const result = res.json as { created: number; errors?: unknown[] };
      expect(result.created).toBe(1);
      expect(result.errors).toBeDefined();
    });

    it('returns 400 when event does not exist', async () => {
      const res = await http.post(`${server.baseUrl}/teams/bulk`, {
        event_id: 9999,
        teams: [{ team_number: 1, team_name: 'Test' }],
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Event does not exist',
      );
    });
  });

  // ==========================================================================
  // PATCH /teams/:id
  // ==========================================================================

  describe('PATCH /teams/:id', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const user = await seedUser(testDb.db, { is_admin: true });
      const app = createTestApp({ user: { id: user.id, is_admin: true } });
      app.use('/teams', teamsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 404 when team not found', async () => {
      const res = await http.patch(`${server.baseUrl}/teams/999`, {
        team_name: 'Updated',
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when no valid fields provided', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.patch(`${server.baseUrl}/teams/${team.id}`, {
        invalid_field: 'value',
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'No valid fields',
      );
    });

    it('updates team_name', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Old Name',
      });

      const res = await http.patch(`${server.baseUrl}/teams/${team.id}`, {
        team_name: 'New Name',
      });

      expect(res.status).toBe(200);
      expect((res.json as { team_name: string }).team_name).toBe('New Name');
    });

    it('updates status', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        status: 'registered',
      });

      const res = await http.patch(`${server.baseUrl}/teams/${team.id}`, {
        status: 'checked_in',
      });

      expect(res.status).toBe(200);
      expect((res.json as { status: string }).status).toBe('checked_in');
    });

    it('returns 409 when updating to duplicate team_number in same event', async () => {
      const event = await seedEvent(testDb.db);
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'First',
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
        team_name: 'Second',
      });

      const res = await http.patch(`${server.baseUrl}/teams/${team2.id}`, {
        team_number: 1,
      });

      expect(res.status).toBe(409);
      expect((res.json as { error: string }).error).toContain(
        'Team number already exists',
      );
    });

    it('returns 400 when updating to invalid status', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Test',
      });

      const res = await http.patch(`${server.baseUrl}/teams/${team.id}`, {
        status: 'invalid_status',
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Invalid team_number or status',
      );
    });
  });

  // ==========================================================================
  // PATCH /teams/:id/check-in
  // ==========================================================================

  describe('PATCH /teams/:id/check-in', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const user = await seedUser(testDb.db, { is_admin: true });
      const app = createTestApp({ user: { id: user.id, is_admin: true } });
      app.use('/teams', teamsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/teams', teamsRoutes);
      const unauthServer = await startServer(app);

      try {
        const res = await http.patch(
          `${unauthServer.baseUrl}/teams/1/check-in`,
          {},
        );
        expect(res.status).toBe(401);
      } finally {
        await unauthServer.close();
      }
    });

    it('returns 404 when team not found', async () => {
      const res = await http.patch(
        `${server.baseUrl}/teams/999/check-in`,
        {},
      );
      expect(res.status).toBe(404);
    });

    it('checks in a team', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        status: 'registered',
      });

      const res = await http.patch(
        `${server.baseUrl}/teams/${team.id}/check-in`,
        {},
      );

      expect(res.status).toBe(200);
      const result = res.json as { status: string; checked_in_at: string };
      expect(result.status).toBe('checked_in');
      expect(result.checked_in_at).toBeTruthy();
    });
  });

  // ==========================================================================
  // DELETE /teams/:id
  // ==========================================================================

  describe('DELETE /teams/:id', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const user = await seedUser(testDb.db, { is_admin: true });
      const app = createTestApp({ user: { id: user.id, is_admin: true } });
      app.use('/teams', teamsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 204 and deletes the team', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.delete(`${server.baseUrl}/teams/${team.id}`);
      expect(res.status).toBe(204);

      // Verify team was deleted
      const getRes = await http.get(`${server.baseUrl}/teams/${team.id}`);
      expect(getRes.status).toBe(404);
    });

    it('returns 204 when team does not exist (idempotent)', async () => {
      const res = await http.delete(`${server.baseUrl}/teams/999`);
      expect(res.status).toBe(204);
    });
  });

  // ==========================================================================
  // PATCH /teams/event/:eventId/check-in/bulk
  // ==========================================================================

  describe('PATCH /teams/event/:eventId/check-in/bulk', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const user = await seedUser(testDb.db, { is_admin: true });
      const app = createTestApp({ user: { id: user.id, is_admin: true } });
      app.use('/teams', teamsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/teams', teamsRoutes);
      const unauthServer = await startServer(app);

      try {
        const res = await http.patch(
          `${unauthServer.baseUrl}/teams/event/1/check-in/bulk`,
          { team_numbers: [1, 2] },
        );
        expect(res.status).toBe(401);
      } finally {
        await unauthServer.close();
      }
    });

    it('returns 400 when team_numbers is missing', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.patch(
        `${server.baseUrl}/teams/event/${event.id}/check-in/bulk`,
        {},
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'team_numbers array is required',
      );
    });

    it('returns 400 when team_numbers is empty array', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.patch(
        `${server.baseUrl}/teams/event/${event.id}/check-in/bulk`,
        { team_numbers: [] },
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when event does not exist', async () => {
      const res = await http.patch(
        `${server.baseUrl}/teams/event/99999/check-in/bulk`,
        { team_numbers: [1, 2] },
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Event does not exist',
      );
    });

    it('bulk checks in teams by team numbers', async () => {
      const event = await seedEvent(testDb.db);
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Alpha',
        status: 'registered',
      });
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
        team_name: 'Beta',
        status: 'registered',
      });

      const res = await http.patch(
        `${server.baseUrl}/teams/event/${event.id}/check-in/bulk`,
        { team_numbers: [1, 2] },
      );

      expect(res.status).toBe(200);
      const result = res.json as { updated: number; not_found?: number[] };
      expect(result.updated).toBe(2);
      expect(result.not_found).toBeUndefined();

      const team1 = await testDb.db.get(
        'SELECT status FROM teams WHERE event_id = ? AND team_number = ?',
        [event.id, 1],
      );
      const team2 = await testDb.db.get(
        'SELECT status FROM teams WHERE event_id = ? AND team_number = ?',
        [event.id, 2],
      );
      expect(team1?.status).toBe('checked_in');
      expect(team2?.status).toBe('checked_in');
    });

    it('reports not_found for team numbers that do not exist', async () => {
      const event = await seedEvent(testDb.db);
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
        team_name: 'Alpha',
        status: 'registered',
      });

      const res = await http.patch(
        `${server.baseUrl}/teams/event/${event.id}/check-in/bulk`,
        { team_numbers: [1, 999] },
      );

      expect(res.status).toBe(200);
      const result = res.json as { updated: number; not_found?: number[] };
      expect(result.updated).toBe(1);
      expect(result.not_found).toEqual([999]);
    });
  });
});
