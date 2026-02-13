/**
 * HTTP route tests for team audit logging.
 * Verifies that team create/update/delete write audit_log entries.
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
import { seedEvent, seedUser, seedTeam } from './helpers/seed';
import teamsRoutes from '../../src/server/routes/teams';

describe('Teams Audit Logging', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;
  let authUser: { id: number };

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    authUser = await seedUser(testDb.db);
    const app = createTestApp({ user: { id: authUser.id, is_admin: false } });
    app.use('/teams', teamsRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('POST /teams writes team_added audit entry', async () => {
    const event = await seedEvent(testDb.db);

    const res = await http.post(`${baseUrl}/teams`, {
      event_id: event.id,
      team_number: 99,
      team_name: 'Audit Test Team',
      display_name: 'Team 99',
    });

    expect(res.status).toBe(201);
    const team = res.json as { id: number };

    const auditLogs = await testDb.db.all(
      'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
      [event.id, 'team_added', 'team', team.id],
    );
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].event_id).toBe(event.id);
    expect(auditLogs[0].user_id).toBe(authUser.id);
    expect(auditLogs[0].action).toBe('team_added');
    expect(auditLogs[0].entity_type).toBe('team');
    expect(auditLogs[0].entity_id).toBe(team.id);
  });

  it('PATCH /teams/:id writes team_updated audit entry', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
      team_name: 'Original Name',
    });

    const res = await http.patch(`${baseUrl}/teams/${team.id}`, {
      team_name: 'Updated Name',
    });

    expect(res.status).toBe(200);

    const auditLogs = await testDb.db.all(
      'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
      [event.id, 'team_updated', 'team', team.id],
    );
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].event_id).toBe(event.id);
    expect(auditLogs[0].user_id).toBe(authUser.id);
    expect(auditLogs[0].action).toBe('team_updated');
    expect(auditLogs[0].entity_type).toBe('team');
    expect(auditLogs[0].entity_id).toBe(team.id);
  });

  it('DELETE /teams/:id writes team_deleted audit entry', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
      team_name: 'To Be Deleted',
    });

    const res = await http.delete(`${baseUrl}/teams/${team.id}`);

    expect(res.status).toBe(204);

    const auditLogs = await testDb.db.all(
      'SELECT * FROM audit_log WHERE event_id = ? AND action = ? AND entity_type = ? AND entity_id = ?',
      [event.id, 'team_deleted', 'team', team.id],
    );
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].event_id).toBe(event.id);
    expect(auditLogs[0].user_id).toBe(authUser.id);
    expect(auditLogs[0].action).toBe('team_deleted');
    expect(auditLogs[0].entity_type).toBe('team');
    expect(auditLogs[0].entity_id).toBe(team.id);
  });
});
