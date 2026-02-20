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
      const templates = res.json as { name: string; schema: unknown }[];
      const badTemplate = templates.find((t) => t.name === 'Bad Schema');
      expect(badTemplate).toBeDefined();
      expect(badTemplate!.schema).toBeNull();
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
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('Invalid');
    });
  });

  describe('POST /scoresheet/templates/:id/verify', () => {
    it('returns 404 for nonexistent template', async () => {
      const res = await http.post(
        `${baseUrl}/scoresheet/templates/999/verify`,
        { accessCode: 'test' },
      );
      expect(res.status).toBe(404);
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
      expect((res.json as { error: string }).error).toContain('Invalid');
    });

    it('returns template with parsed schema on correct access code', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Verified Template',
        access_code: 'secret',
        schema: JSON.stringify({ fields: ['a', 'b'] }),
        created_by: userId,
      });

      const res = await http.post(
        `${baseUrl}/scoresheet/templates/${template.id}/verify`,
        { accessCode: 'secret' },
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        name: string;
        schema: { fields: string[] };
        access_code?: string;
      };
      expect(body.name).toBe('Verified Template');
      expect(body.schema).toEqual({ fields: ['a', 'b'] });
      expect(body.access_code).toBeUndefined();
    });
  });

  describe('GET /scoresheet/templates/:id', () => {
    it('returns 404 when template not found', async () => {
      const res = await http.get(`${baseUrl}/scoresheet/templates/999`);
      expect(res.status).toBe(404);
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
      const body = res.json as { name: string; schema: { mode: string } };
      expect(body.name).toBe('My Template');
      expect(body.schema).toEqual({ mode: 'seeding' });
    });
  });

  describe('POST /scoresheet/templates', () => {
    it('returns 400 when required fields missing', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'No Schema',
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('required');
    });

    it('creates template without eventId', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'New Template',
        schema: { fields: [] },
        accessCode: 'abc123',
      });
      expect(res.status).toBe(200);
      const body = res.json as { name: string; schema: { fields: unknown[] } };
      expect(body.name).toBe('New Template');
      expect(body.schema).toEqual({ fields: [] });
    });

    it('creates template with eventId and links to event', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Linked Template',
        schema: { fields: [] },
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
        schema: { mode: 'head-to-head' },
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
        schema: { bracketSource: true },
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
          schema: { fields: ['x'] },
          accessCode: 'new',
          eventId: event.id,
        },
      );
      expect(res.status).toBe(200);
      const body = res.json as { name: string; schema: { fields: string[] } };
      expect(body.name).toBe('Updated');
      expect(body.schema).toEqual({ fields: ['x'] });

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
          schema: {},
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
