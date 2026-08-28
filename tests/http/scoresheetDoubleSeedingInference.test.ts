/**
 * Template type persistence from canonical schema.kind.
 * Legacy mode/scoreKind markers and missing kind are rejected at the write boundary.
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
import { seedUser, seedEvent } from './helpers/seed';
import scoresheetRoutes from '../../src/server/routes/scoresheet';

describe('Scoresheet template kind persistence', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const admin = await seedUser(testDb.db, { is_admin: true });
    const app = createTestApp({ user: { id: admin.id, is_admin: true } });
    app.use('/scoresheet', scoresheetRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('persists double_seeding from schema.kind', async () => {
    const event = await seedEvent(testDb.db);
    const res = await http.post(`${baseUrl}/scoresheet/templates`, {
      name: 'Double Seeding Sheet',
      description: 'Test',
      accessCode: 'code-ds',
      schema: {
        kind: 'double_seeding',
        scoreDestination: 'db',
        eventId: event.id,
        fields: [],
      },
      eventId: event.id,
    });

    expect(res.status).toBe(200);
    const template = res.json as { id: number };

    const links = await testDb.db.all(
      'SELECT * FROM event_scoresheet_templates WHERE template_id = ?',
      [template.id],
    );
    expect(links.length).toBe(1);
    expect(links[0].template_type).toBe('double_seeding');
  });

  it('persists bracket from schema.kind and a DB bracketSource', async () => {
    const event = await seedEvent(testDb.db);
    const res = await http.post(`${baseUrl}/scoresheet/templates`, {
      name: 'DE Sheet',
      description: 'Test',
      accessCode: 'code-de',
      schema: {
        kind: 'bracket',
        bracketSource: { type: 'db', eventId: event.id },
        fields: [],
      },
      eventId: event.id,
    });

    expect(res.status).toBe(200);
    const template = res.json as { id: number };

    const links = await testDb.db.all(
      'SELECT * FROM event_scoresheet_templates WHERE template_id = ?',
      [template.id],
    );
    expect(links[0].template_type).toBe('bracket');
  });

  it('rejects legacy scoreKind, mode, and missing kind', async () => {
    const event = await seedEvent(testDb.db);

    const scoreKind = await http.post(`${baseUrl}/scoresheet/templates`, {
      name: 'Legacy Double Seeding',
      accessCode: 'legacy-ds',
      schema: { scoreKind: 'double_seeding', fields: [] },
      eventId: event.id,
    });
    expect(scoreKind.status).toBe(400);

    const mode = await http.post(`${baseUrl}/scoresheet/templates`, {
      name: 'Legacy Bracket',
      accessCode: 'legacy-de',
      schema: { mode: 'head-to-head', fields: [] },
      eventId: event.id,
    });
    expect(mode.status).toBe(400);

    const missing = await http.post(`${baseUrl}/scoresheet/templates`, {
      name: 'Missing Kind',
      accessCode: 'missing',
      schema: { fields: [] },
      eventId: event.id,
    });
    expect(missing.status).toBe(400);
  });
});
