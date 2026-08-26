/**
 * Additional HTTP route tests for /scoresheet endpoints.
 * Covers template CRUD, verify access code, inferTemplateType branches, and admin listing.
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
  seedScoresheetTemplate,
  seedEventScoresheetTemplate,
} from './helpers/seed';
import scoresheetRoutes from '../../src/server/routes/scoresheet';
import { canonicalSchema } from '../helpers/canonicalSchema';
import {
  expectValidationFailed,
  getApiError,
  getApiErrorMessage,
} from './helpers/apiError';
import {
  buildDoubleEliminationSchema,
  buildDoubleSeedingSchema,
} from '../../src/client/components/scoresheetUtils';

describe('Scoresheet Routes – extra coverage', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;
  let userId: number;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const user = await seedUser(testDb.db, { is_admin: true });
    userId = user.id;

    const app = createTestApp({ user: { id: userId, is_admin: true } });
    app.use('/scoresheet', scoresheetRoutes);
    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('GET /scoresheet/templates', () => {
    it('returns templates linked to active events', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Active Template',
        schema: JSON.stringify({ fields: [] }),
        created_by: userId,
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event.id,
        template_id: template.id,
        template_type: 'seeding',
      });

      const res = await http.get(`${baseUrl}/scoresheet/templates`);
      expect(res.status).toBe(200);
      const templates = res.json as { name: string; event_name: string }[];
      expect(templates.length).toBeGreaterThanOrEqual(1);
      expect(templates.some((t) => t.name === 'Active Template')).toBe(true);
    });

    it('excludes templates not linked to active events', async () => {
      const archivedEvent = await seedEvent(testDb.db, {
        status: 'archived',
        name: 'Old Event',
      });
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Archived Template',
        schema: JSON.stringify({ fields: [] }),
        created_by: userId,
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: archivedEvent.id,
        template_id: template.id,
        template_type: 'seeding',
      });

      const res = await http.get(`${baseUrl}/scoresheet/templates`);
      expect(res.status).toBe(200);
      const templates = res.json as { name: string }[];
      expect(templates.every((t) => t.name !== 'Archived Template')).toBe(true);
    });

    it('handles template with unparseable schema', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Bad Schema',
        schema: 'not-json',
        created_by: userId,
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event.id,
        template_id: template.id,
        template_type: 'seeding',
      });

      const res = await http.get(`${baseUrl}/scoresheet/templates`);
      expect(res.status).toBe(200);
      const templates = res.json as {
        name: string;
        schema: unknown;
        schemaIssues?: string[];
      }[];
      const badTemplate = templates.find((t) => t.name === 'Bad Schema');
      expect(badTemplate).toBeDefined();
      expect(badTemplate!.schema).toBeNull();
      expect(badTemplate!.schemaIssues?.length).toBeGreaterThan(0);
    });

    it('returns schemaIssues for stored schemas that do not parse', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Invalid Schema',
        schema: JSON.stringify({ mode: 'head-to-head' }),
        created_by: userId,
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event.id,
        template_id: template.id,
        template_type: 'bracket',
      });

      const res = await http.get(`${baseUrl}/scoresheet/templates`);
      expect(res.status).toBe(200);
      const templates = res.json as {
        name: string;
        schema: unknown;
        schemaIssues?: string[];
      }[];
      const invalid = templates.find((t) => t.name === 'Invalid Schema');
      expect(invalid?.schema).toEqual({ mode: 'head-to-head' });
      expect(invalid?.schemaIssues?.length).toBeGreaterThan(0);
    });
  });

  describe('GET /scoresheet/templates/admin', () => {
    it('returns all active templates without eventId filter', async () => {
      await seedScoresheetTemplate(testDb.db, {
        name: 'Admin Template',
        created_by: userId,
      });

      const res = await http.get(`${baseUrl}/scoresheet/templates/admin`);
      expect(res.status).toBe(200);
      const templates = res.json as { name: string }[];
      expect(templates.some((t) => t.name === 'Admin Template')).toBe(true);
    });

    it('filters by eventId when provided', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Event Scoped',
        created_by: userId,
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event.id,
        template_id: template.id,
        template_type: 'seeding',
      });

      const res = await http.get(
        `${baseUrl}/scoresheet/templates/admin?eventId=${event.id}`,
      );
      expect(res.status).toBe(200);
      const templates = res.json as { name: string }[];
      expect(templates.length).toBe(1);
      expect(templates[0].name).toBe('Event Scoped');
    });

    it('returns 400 for invalid eventId', async () => {
      const res = await http.get(
        `${baseUrl}/scoresheet/templates/admin?eventId=abc`,
      );
      expectValidationFailed(res);
    });
  });

  describe('POST /scoresheet/templates/:id/verify', () => {
    it('returns 404 for nonexistent template', async () => {
      const res = await http.post(
        `${baseUrl}/scoresheet/templates/999/verify`,
        { accessCode: 'test' },
      );
      expect(res.status).toBe(404);
      expect(getApiError(res.json)?.code).toBe('NOT_FOUND');
    });

    it('returns 403 for wrong access code', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        access_code: 'correct-code',
        schema: JSON.stringify({ fields: [] }),
        created_by: userId,
      });

      const res = await http.post(
        `${baseUrl}/scoresheet/templates/${template.id}/verify`,
        { accessCode: 'wrong-code' },
      );
      expect(res.status).toBe(403);
      expect(getApiErrorMessage(res.json)).toContain('Invalid access code');
    });

    it('returns template with parsed schema on correct access code', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Verified Template',
        access_code: 'secret',
        schema: JSON.stringify({ fields: [] }),
        created_by: userId,
      });

      const res = await http.post(
        `${baseUrl}/scoresheet/templates/${template.id}/verify`,
        { accessCode: 'secret' },
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        name: string;
        schema: { fields: unknown[]; schemaVersion: number };
        access_code?: string;
        schemaNormalization?: string[];
      };
      expect(body.name).toBe('Verified Template');
      expect(body.schema.fields).toEqual([]);
      expect(body.schema.schemaVersion).toBe(1);
      expect(body.schemaNormalization).toEqual(['add-schema-version']);
      expect(body.access_code).toBeUndefined();
    });

    it('returns 200 with schemaIssues when stored JSON is invalid', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Broken JSON',
        access_code: 'secret',
        schema: 'not-json',
        created_by: userId,
      });

      const res = await http.post(
        `${baseUrl}/scoresheet/templates/${template.id}/verify`,
        { accessCode: 'secret' },
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        schema: unknown;
        schemaIssues?: string[];
      };
      expect(body.schema).toBeNull();
      expect(body.schemaIssues?.length).toBeGreaterThan(0);
    });
  });

  describe('GET /scoresheet/templates/:id', () => {
    it('returns 404 when template not found', async () => {
      const res = await http.get(`${baseUrl}/scoresheet/templates/999`);
      expect(res.status).toBe(404);
      expect(getApiError(res.json)?.code).toBe('NOT_FOUND');
    });

    it('returns VALIDATION_FAILED for a non-numeric id', async () => {
      const res = await http.get(`${baseUrl}/scoresheet/templates/abc`);
      expectValidationFailed(res);
    });

    it('returns template with parsed schema', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'My Template',
        schema: JSON.stringify({ mode: 'seeding' }),
        created_by: userId,
      });

      const res = await http.get(
        `${baseUrl}/scoresheet/templates/${template.id}`,
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        name: string;
        schema: { mode: string };
        schemaIssues?: string[];
      };
      expect(body.name).toBe('My Template');
      expect(body.schema).toEqual({ mode: 'seeding' });
      expect(body.schemaIssues?.length).toBeGreaterThan(0);
    });
  });

  describe('POST /scoresheet/templates', () => {
    it('returns 400 when required fields missing', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'No Schema',
      });
      expectValidationFailed(res);
    });

    it('creates template without eventId', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'New Template',
        schema: canonicalSchema(),
        accessCode: 'abc123',
      });
      expect(res.status).toBe(200);
      const body = res.json as {
        name: string;
        schema: { fields: unknown[] };
        normalizationApplied: string[];
      };
      expect(body.name).toBe('New Template');
      expect(body.schema).toEqual(canonicalSchema());
      expect(body.normalizationApplied).toEqual([]);
    });

    it('accepts DE and double-seeding schemas from the client builders', async () => {
      const deSchema = buildDoubleEliminationSchema({
        title: 'Wizard DE Sheet',
        eventId: null,
        templateFields: null,
      });
      const dsSchema = buildDoubleSeedingSchema({
        title: 'Wizard DS Sheet',
        eventId: null,
        templateFields: null,
      });

      const deRes = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Wizard DE',
        schema: deSchema,
        accessCode: 'de-wiz',
      });
      expect(deRes.status).toBe(200);
      const deBody = deRes.json as {
        schema: { schemaVersion: number; mode?: string };
        normalizationApplied: string[];
      };
      expect(deBody.schema.schemaVersion).toBe(1);
      expect(deBody.schema.mode).toBe('head-to-head');
      expect(deBody.normalizationApplied).toEqual([]);

      const dsRes = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Wizard DS',
        schema: dsSchema,
        accessCode: 'ds-wiz',
      });
      expect(dsRes.status).toBe(200);
      const dsBody = dsRes.json as {
        schema: { schemaVersion: number; scoreKind?: string };
        normalizationApplied: string[];
      };
      expect(dsBody.schema.schemaVersion).toBe(1);
      expect(dsBody.schema.scoreKind).toBe('double_seeding');
      expect(dsBody.normalizationApplied).toEqual([]);
    });

    it('creates template with eventId and links to event', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Linked Template',
        schema: canonicalSchema(),
        accessCode: 'link123',
        eventId: event.id,
      });
      expect(res.status).toBe(200);
      const body = res.json as { id: number; name: string };
      expect(body.name).toBe('Linked Template');

      const link = await testDb.db.get(
        'SELECT * FROM event_scoresheet_templates WHERE template_id = ?',
        [body.id],
      );
      expect(link).toBeDefined();
      expect(link.event_id).toBe(event.id);
      expect(link.template_type).toBe('seeding');
    });

    it('infers bracket type when schema has mode=head-to-head', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Bracket Template',
        schema: canonicalSchema({ mode: 'head-to-head' }),
        accessCode: 'bracket123',
        eventId: event.id,
      });
      expect(res.status).toBe(200);

      const body = res.json as { id: number };
      const link = await testDb.db.get(
        'SELECT template_type FROM event_scoresheet_templates WHERE template_id = ?',
        [body.id],
      );
      expect(link.template_type).toBe('bracket');
    });

    it('infers bracket type when schema has bracketSource', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Bracket Source Template',
        schema: canonicalSchema({
          bracketSource: { type: 'db', scope: 'event', eventId: event.id },
        }),
        accessCode: 'bs123',
        eventId: event.id,
      });
      expect(res.status).toBe(200);

      const body = res.json as { id: number };
      const link = await testDb.db.get(
        'SELECT template_type FROM event_scoresheet_templates WHERE template_id = ?',
        [body.id],
      );
      expect(link.template_type).toBe('bracket');
    });

    it('normalizes missing schemaVersion on write', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Unversioned',
        schema: { fields: [] },
        accessCode: 'legacy123',
      });
      expect(res.status).toBe(200);
      const body = res.json as {
        id: number;
        schema: { schemaVersion: number; fields: unknown[] };
        normalizationApplied: string[];
      };
      expect(body.schema).toEqual({ schemaVersion: 1, fields: [] });
      expect(body.normalizationApplied).toEqual(['add-schema-version']);

      const stored = await testDb.db.get<{ schema: string }>(
        'SELECT schema FROM scoresheet_templates WHERE id = ?',
        [body.id],
      );
      expect(JSON.parse(stored!.schema)).toEqual({
        schemaVersion: 1,
        fields: [],
      });
    });

    it('normalizes bracketSource: true and infers bracket', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Legacy Bracket Flag',
        schema: { fields: [], bracketSource: true },
        accessCode: 'true-bs',
        eventId: event.id,
      });
      expect(res.status).toBe(200);
      const body = res.json as {
        id: number;
        schema: { bracketSource?: unknown };
        normalizationApplied: string[];
      };
      expect(body.schema.bracketSource).toEqual({ type: 'db' });
      expect(body.normalizationApplied).toEqual(
        expect.arrayContaining([
          'add-schema-version',
          'normalize-bracket-source-true',
        ]),
      );

      const link = await testDb.db.get(
        'SELECT template_type FROM event_scoresheet_templates WHERE template_id = ?',
        [body.id],
      );
      expect(link.template_type).toBe('bracket');
    });

    it('rejects invalid defaultValue types', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Bad Defaults',
        accessCode: 'bad-defaults',
        schema: canonicalSchema({
          fields: [
            {
              id: 'score',
              label: 'Score',
              type: 'number',
              min: 0,
              max: 10,
              defaultValue: 99,
            },
          ],
        }),
      });
      const error = expectValidationFailed(res);
      expect(JSON.stringify(error)).toContain('above max');
    });

    it('rejects legacy startValue', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Legacy Start Value',
        accessCode: 'legacy-start',
        schema: canonicalSchema({
          fields: [
            { id: 'name', label: 'Name', type: 'text', startValue: 'Ada' },
          ],
        }),
      });
      const error = expectValidationFailed(res);
      expect(JSON.stringify(error)).toContain('startValue');
    });

    it('persists templates with valid typed defaults', async () => {
      const schema = canonicalSchema({
        fields: [
          { id: 'name', label: 'Name', type: 'text', defaultValue: 'Ada' },
          {
            id: 'score',
            label: 'Score',
            type: 'number',
            min: 0,
            max: 10,
            defaultValue: 7,
          },
          {
            id: 'division',
            label: 'Division',
            type: 'dropdown',
            options: [
              { label: 'Junior', value: 'junior' },
              { label: 'Senior', value: 'senior' },
            ],
            defaultValue: 'senior',
          },
          { id: 'dq', label: 'DQ', type: 'checkbox', defaultValue: true },
        ],
      });
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Good Defaults',
        accessCode: 'good-defaults',
        schema,
      });
      expect(res.status).toBe(200);
      const body = res.json as { schema: { fields: Array<{ id: string }> } };
      expect(body.schema).toEqual(schema);
    });
  });

  describe('PUT /scoresheet/templates/:id', () => {
    it('updates template and re-links event', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Original',
        schema: JSON.stringify({ fields: [] }),
        access_code: 'old',
        created_by: userId,
      });

      const res = await http.put(
        `${baseUrl}/scoresheet/templates/${template.id}`,
        {
          name: 'Updated',
          schema: canonicalSchema(),
          accessCode: 'new',
          eventId: event.id,
        },
      );
      expect(res.status).toBe(200);
      const body = res.json as { name: string; schema: { fields: unknown[] } };
      expect(body.name).toBe('Updated');
      expect(body.schema).toEqual(canonicalSchema());

      const link = await testDb.db.get(
        'SELECT * FROM event_scoresheet_templates WHERE template_id = ?',
        [template.id],
      );
      expect(link).toBeDefined();
      expect(link.event_id).toBe(event.id);
    });

    it('updates template without eventId (removes links)', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Linked',
        schema: JSON.stringify({}),
        access_code: 'x',
        created_by: userId,
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event.id,
        template_id: template.id,
        template_type: 'seeding',
      });

      const res = await http.put(
        `${baseUrl}/scoresheet/templates/${template.id}`,
        {
          name: 'Unlinked',
          schema: canonicalSchema(),
          accessCode: 'y',
        },
      );
      expect(res.status).toBe(200);

      const link = await testDb.db.get(
        'SELECT * FROM event_scoresheet_templates WHERE template_id = ?',
        [template.id],
      );
      expect(link).toBeUndefined();
    });

    it('returns 404 when the template does not exist', async () => {
      const res = await http.put(`${baseUrl}/scoresheet/templates/99999`, {
        name: 'Missing',
        schema: canonicalSchema(),
        accessCode: 'x',
      });
      expect(res.status).toBe(404);
      expect(getApiError(res.json)?.code).toBe('NOT_FOUND');
    });

    it('rejects invalid defaultValue on update', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Original',
        schema: JSON.stringify({ fields: [] }),
        access_code: 'old',
        created_by: userId,
      });

      const res = await http.put(
        `${baseUrl}/scoresheet/templates/${template.id}`,
        {
          name: 'Updated',
          schema: canonicalSchema({
            fields: [
              {
                id: 'division',
                label: 'Division',
                type: 'dropdown',
                options: [{ label: 'Junior', value: 'junior' }],
                defaultValue: 'senior',
              },
            ],
          }),
          accessCode: 'new',
        },
      );
      expect(JSON.stringify(expectValidationFailed(res))).toContain(
        'match one of the declared options',
      );
    });
  });

  describe('DELETE /scoresheet/templates/:id', () => {
    it('deletes the template', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'To Delete',
        created_by: userId,
      });

      const res = await http.delete(
        `${baseUrl}/scoresheet/templates/${template.id}`,
      );
      expect(res.status).toBe(200);
      expect((res.json as { success: boolean }).success).toBe(true);

      const row = await testDb.db.get(
        'SELECT id FROM scoresheet_templates WHERE id = ?',
        [template.id],
      );
      expect(row).toBeUndefined();
    });

    it('returns success even for nonexistent template', async () => {
      const res = await http.delete(`${baseUrl}/scoresheet/templates/99999`);
      expect(res.status).toBe(200);
      expect((res.json as { success: boolean }).success).toBe(true);
    });
  });
});
