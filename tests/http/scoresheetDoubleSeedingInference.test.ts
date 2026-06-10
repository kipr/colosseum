/**
 * Template type inference for double-seeding scoresheets.
 * The explicit schema marker scoreKind: 'double_seeding' takes precedence;
 * head-to-head still means bracket.
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

describe('Scoresheet template inference - double seeding', () => {
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

  it('infers double_seeding from schema.scoreKind', async () => {
    const event = await seedEvent(testDb.db);
    const res = await http.post(`${baseUrl}/scoresheet/templates`, {
      name: 'Double Seeding Sheet',
      description: 'Test',
      accessCode: 'code-ds',
      schema: {
        scoreKind: 'double_seeding',
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

  it('keeps inferring bracket from mode head-to-head when no scoreKind exists', async () => {
    const event = await seedEvent(testDb.db);
    const res = await http.post(`${baseUrl}/scoresheet/templates`, {
      name: 'DE Sheet',
      description: 'Test',
      accessCode: 'code-de',
      schema: { mode: 'head-to-head', fields: [] },
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
});
