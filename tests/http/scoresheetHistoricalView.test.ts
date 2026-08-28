/**
 * Historical score viewing and archive-on-delete after the kind cutover.
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
  seedEventScoresheetTemplate,
  seedScoreSubmission,
  seedScoresheetTemplate,
  seedUser,
} from './helpers/seed';
import { applyScoresheetKindMigration } from '../../src/server/database/migrations/scoresheetKind';
import scoresRoutes from '../../src/server/routes/scores';
import scoresheetRoutes from '../../src/server/routes/scoresheet';

describe('Historical scoresheet viewing after kind cutover', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const admin = await seedUser(testDb.db, { is_admin: true });
    const app = createTestApp({ user: { id: admin.id, is_admin: true } });
    app.use('/scores', scoresRoutes);
    app.use('/scoresheet', scoresheetRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns the migrated schema for an inactive old-event score and archives instead of deleting it', async () => {
    const admin = await seedUser(testDb.db, {
      email: 'history@example.com',
      google_id: 'history-admin',
      is_admin: true,
    });
    const event = await seedEvent(testDb.db, {
      name: 'Completed Event',
      status: 'complete',
    });
    const template = await seedScoresheetTemplate(testDb.db, {
      name: 'Old Seeding Sheet',
      schema: JSON.stringify({
        title: 'Old Seeding Sheet',
        fields: [
          { id: 'team_number', type: 'text', label: 'Team' },
          { id: 'score', type: 'number', label: 'Score' },
        ],
      }),
      created_by: admin.id,
    });
    await seedEventScoresheetTemplate(testDb.db, {
      event_id: event.id,
      template_id: template.id,
      template_type: 'seeding',
    });
    const score = await seedScoreSubmission(testDb.db, {
      user_id: admin.id,
      template_id: template.id,
      event_id: event.id,
      score_type: 'seeding',
      status: 'accepted',
      score_data: JSON.stringify({
        team_number: { type: 'text', value: '101', label: 'Team' },
        score: { type: 'number', value: 42, label: 'Score' },
      }),
    });

    await applyScoresheetKindMigration(testDb.db);
    await testDb.db.run(
      'UPDATE scoresheet_templates SET is_active = FALSE WHERE id = ?',
      [template.id],
    );

    const storedTemplate = await testDb.db.get(
      'SELECT id, schema FROM scoresheet_templates WHERE id = ?',
      [template.id],
    );
    expect(storedTemplate.id).toBe(template.id);
    expect(JSON.parse(storedTemplate.schema).kind).toBe('seeding');

    const storedScore = await testDb.db.get(
      'SELECT id, template_id FROM score_submissions WHERE id = ?',
      [score.id],
    );
    expect(storedScore.template_id).toBe(template.id);

    const publicList = await http.get(`${baseUrl}/scoresheet/templates`);
    expect(publicList.status).toBe(200);
    expect(
      (publicList.json as { id: number }[]).some(
        (row) => row.id === template.id,
      ),
    ).toBe(false);

    const history = await http.get(`${baseUrl}/scores/by-event/${event.id}`);
    expect(history.status).toBe(200);
    const rows = (
      history.json as {
        rows: Array<{
          id: number;
          template_id: number;
          template_schema: { kind: string; title: string; fields: unknown[] };
        }>;
      }
    ).rows;
    const viewed = rows.find((row) => row.id === score.id);
    expect(viewed).toBeDefined();
    expect(viewed!.template_id).toBe(template.id);
    expect(viewed!.template_schema.kind).toBe('seeding');
    expect(viewed!.template_schema.title).toBe('Old Seeding Sheet');
    expect(viewed!.template_schema.fields).toHaveLength(2);

    const archived = await http.delete(
      `${baseUrl}/scoresheet/templates/${template.id}`,
    );
    expect(archived.status).toBe(200);

    const afterArchive = await testDb.db.get(
      'SELECT id, is_active FROM scoresheet_templates WHERE id = ?',
      [template.id],
    );
    expect(afterArchive).toBeDefined();
    expect(Number(afterArchive.is_active)).toBe(0);

    const survivingScore = await testDb.db.get(
      'SELECT id FROM score_submissions WHERE id = ?',
      [score.id],
    );
    expect(survivingScore).toBeDefined();

    const historyAfterArchive = await http.get(
      `${baseUrl}/scores/by-event/${event.id}`,
    );
    const archivedView = (
      historyAfterArchive.json as {
        rows: Array<{ id: number; template_schema: { fields: unknown[] } }>;
      }
    ).rows.find((row) => row.id === score.id);
    expect(archivedView?.template_schema.fields).toHaveLength(2);
  });
});
