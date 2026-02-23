/**
 * HTTP route tests for scoresheet template event scoping.
 * Verifies event linkage on create/update, admin filtering, and judge list exclusions.
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
  seedUser,
  seedEvent,
  seedScoresheetTemplate,
  seedEventScoresheetTemplate,
} from './helpers/seed';
import scoresheetRoutes from '../../src/server/routes/scoresheet';

describe('Scoresheet Templates Event Scope', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;
  let authUser: { id: number };

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    authUser = await seedUser(testDb.db, { is_admin: true });
    const app = createTestApp({ user: { id: authUser.id, is_admin: true } });
    app.use('/scoresheet', scoresheetRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('POST /scoresheet/templates', () => {
    it('creates explicit event linkage when eventId provided', async () => {
      const event = await seedEvent(testDb.db, { name: 'Test Event' });

      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Seeding Sheet',
        description: 'Test',
        accessCode: 'code123',
        schema: { fields: [], eventId: event.id },
        eventId: event.id,
      });

      expect(res.status).toBe(200);
      const template = res.json as { id: number };
      expect(template.id).toBeGreaterThan(0);

      const links = await testDb.db.all(
        'SELECT * FROM event_scoresheet_templates WHERE template_id = ?',
        [template.id],
      );
      expect(links.length).toBe(1);
      expect(links[0].event_id).toBe(event.id);
      expect(links[0].template_type).toBe('seeding');
    });

    it('creates template without linkage when eventId omitted', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Unlinked Sheet',
        description: 'Test',
        accessCode: 'code456',
        schema: { fields: [] },
      });

      expect(res.status).toBe(200);
      const template = res.json as { id: number };

      const links = await testDb.db.all(
        'SELECT * FROM event_scoresheet_templates WHERE template_id = ?',
        [template.id],
      );
      expect(links.length).toBe(0);
    });

    it('infers bracket type from schema with mode head-to-head', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'DE Sheet',
        description: 'Bracket',
        accessCode: 'code789',
        schema: { mode: 'head-to-head', fields: [] },
        eventId: event.id,
      });

      expect(res.status).toBe(200);
      const template = res.json as { id: number };
      const links = await testDb.db.all(
        'SELECT * FROM event_scoresheet_templates WHERE template_id = ?',
        [template.id],
      );
      expect(links.length).toBe(1);
      expect(links[0].template_type).toBe('bracket');
    });

    it('infers bracket type from schema with bracketSource', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Bracket Sheet',
        description: 'Bracket via bracketSource',
        accessCode: 'code999',
        schema: { bracketSource: 'winners', fields: [] },
        eventId: event.id,
      });

      expect(res.status).toBe(200);
      const template = res.json as { id: number };
      const links = await testDb.db.all(
        'SELECT * FROM event_scoresheet_templates WHERE template_id = ?',
        [template.id],
      );
      expect(links.length).toBe(1);
      expect(links[0].template_type).toBe('bracket');
    });

    it('returns 400 when name, schema, or accessCode is missing', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Only Name',
        description: 'Test',
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('required');
    });
  });

  describe('POST /scoresheet/templates/:id/verify', () => {
    it('returns template with schema when access code is valid', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Judge Sheet',
        schema: JSON.stringify({ fields: [{ id: 'score' }] }),
        access_code: 'judge-secret',
      });

      const res = await http.post(
        `${baseUrl}/scoresheet/templates/${template.id}/verify`,
        { accessCode: 'judge-secret' },
      );

      expect(res.status).toBe(200);
      const body = res.json as { id: number; schema: unknown; access_code?: string };
      expect(body.id).toBe(template.id);
      expect(body.schema).toEqual({ fields: [{ id: 'score' }] });
      expect(body.access_code).toBeUndefined();
    });

    it('returns 404 when template does not exist', async () => {
      const res = await http.post(
        `${baseUrl}/scoresheet/templates/99999/verify`,
        { accessCode: 'any' },
      );
      expect(res.status).toBe(404);
    });

    it('returns 403 when access code is invalid', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Protected',
        access_code: 'correct-code',
      });

      const res = await http.post(
        `${baseUrl}/scoresheet/templates/${template.id}/verify`,
        { accessCode: 'wrong-code' },
      );
      expect(res.status).toBe(403);
    });
  });

  describe('GET /scoresheet/templates/:id', () => {
    it('returns full template for authenticated admin', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Admin Preview',
        schema: JSON.stringify({ fields: [] }),
      });

      const res = await http.get(`${baseUrl}/scoresheet/templates/${template.id}`);

      expect(res.status).toBe(200);
      const body = res.json as { id: number; name: string; schema: unknown };
      expect(body.id).toBe(template.id);
      expect(body.name).toBe('Admin Preview');
      expect(body.schema).toEqual({ fields: [] });
    });

    it('returns 404 when template does not exist', async () => {
      const res = await http.get(`${baseUrl}/scoresheet/templates/99999`);
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /scoresheet/templates/:id', () => {
    it('deletes template and returns success', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'To Delete',
      });

      const res = await http.delete(
        `${baseUrl}/scoresheet/templates/${template.id}`,
      );
      expect(res.status).toBe(200);
      expect((res.json as { success: boolean }).success).toBe(true);

      const row = await testDb.db.get(
        'SELECT * FROM scoresheet_templates WHERE id = ?',
        [template.id],
      );
      expect(row).toBeUndefined();
    });
  });

  describe('PUT /scoresheet/templates/:id', () => {
    it('re-links template to new event and removes old link', async () => {
      const event1 = await seedEvent(testDb.db, { name: 'Event A' });
      const event2 = await seedEvent(testDb.db, { name: 'Event B' });
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Shared Sheet',
        schema: JSON.stringify({ fields: [] }),
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event1.id,
        template_id: template.id,
        template_type: 'seeding',
      });

      const res = await http.put(
        `${baseUrl}/scoresheet/templates/${template.id}`,
        {
          name: 'Shared Sheet',
          description: '',
          accessCode: 'code',
          schema: { fields: [] },
          eventId: event2.id,
        },
      );

      expect(res.status).toBe(200);

      const links = await testDb.db.all(
        'SELECT * FROM event_scoresheet_templates WHERE template_id = ?',
        [template.id],
      );
      expect(links.length).toBe(1);
      expect(links[0].event_id).toBe(event2.id);
    });

    it('removes linkage when eventId omitted on update', async () => {
      const event = await seedEvent(testDb.db);
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Sheet',
        schema: JSON.stringify({ fields: [] }),
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event.id,
        template_id: template.id,
        template_type: 'seeding',
      });

      await http.put(`${baseUrl}/scoresheet/templates/${template.id}`, {
        name: 'Sheet',
        description: '',
        accessCode: 'code',
        schema: { fields: [] },
      });

      const links = await testDb.db.all(
        'SELECT * FROM event_scoresheet_templates WHERE template_id = ?',
        [template.id],
      );
      expect(links.length).toBe(0);
    });
  });

  describe('GET /scoresheet/templates/admin', () => {
    it('returns only templates linked to event when eventId provided', async () => {
      const event1 = await seedEvent(testDb.db, { name: 'Event 1' });
      const event2 = await seedEvent(testDb.db, { name: 'Event 2' });
      const t1 = await seedScoresheetTemplate(testDb.db, { name: 'Sheet A' });
      const t2 = await seedScoresheetTemplate(testDb.db, { name: 'Sheet B' });
      const t3 = await seedScoresheetTemplate(testDb.db, { name: 'Sheet C' });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event1.id,
        template_id: t1.id,
        template_type: 'seeding',
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event1.id,
        template_id: t2.id,
        template_type: 'seeding',
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event2.id,
        template_id: t3.id,
        template_type: 'seeding',
      });

      const res = await http.get(
        `${baseUrl}/scoresheet/templates/admin?eventId=${event1.id}`,
      );

      expect(res.status).toBe(200);
      const templates = res.json as { id: number; name: string }[];
      expect(templates.length).toBe(2);
      expect(templates.map((t) => t.name).sort()).toEqual([
        'Sheet A',
        'Sheet B',
      ]);
    });

    it('returns all templates when eventId omitted', async () => {
      const event = await seedEvent(testDb.db);
      const t1 = await seedScoresheetTemplate(testDb.db, { name: 'Sheet 1' });
      const t2 = await seedScoresheetTemplate(testDb.db, { name: 'Sheet 2' });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event.id,
        template_id: t1.id,
        template_type: 'seeding',
      });

      const res = await http.get(`${baseUrl}/scoresheet/templates/admin`);

      expect(res.status).toBe(200);
      const templates = res.json as { id: number }[];
      expect(templates.length).toBe(2);
    });

    it('returns 400 for invalid eventId', async () => {
      const res = await http.get(
        `${baseUrl}/scoresheet/templates/admin?eventId=not-a-number`,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('GET /scoresheet/templates (judge)', () => {
    it('excludes templates linked to complete or archived events', async () => {
      const eventActive = await seedEvent(testDb.db, {
        name: 'Active Event',
        status: 'active',
      });
      const eventComplete = await seedEvent(testDb.db, {
        name: 'Complete Event',
        status: 'complete',
      });
      const eventArchived = await seedEvent(testDb.db, {
        name: 'Archived Event',
        status: 'archived',
      });
      const tActive = await seedScoresheetTemplate(testDb.db, {
        name: 'Active Sheet',
        schema: JSON.stringify({ fields: [] }),
      });
      const tComplete = await seedScoresheetTemplate(testDb.db, {
        name: 'Complete Sheet',
        schema: JSON.stringify({ fields: [] }),
      });
      const tArchived = await seedScoresheetTemplate(testDb.db, {
        name: 'Archived Sheet',
        schema: JSON.stringify({ fields: [] }),
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: eventActive.id,
        template_id: tActive.id,
        template_type: 'seeding',
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: eventComplete.id,
        template_id: tComplete.id,
        template_type: 'seeding',
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: eventArchived.id,
        template_id: tArchived.id,
        template_type: 'seeding',
      });

      const res = await http.get(`${baseUrl}/scoresheet/templates`);

      expect(res.status).toBe(200);
      const templates = res.json as { id: number; name: string }[];
      expect(templates.length).toBe(1);
      expect(templates[0].name).toBe('Active Sheet');
    });

    it('excludes unscoped templates', async () => {
      const event = await seedEvent(testDb.db, { status: 'active' });
      const tLinked = await seedScoresheetTemplate(testDb.db, {
        name: 'Linked Sheet',
        schema: JSON.stringify({ fields: [] }),
      });
      await seedScoresheetTemplate(testDb.db, {
        name: 'Unscoped Sheet',
        schema: JSON.stringify({ fields: [] }),
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event.id,
        template_id: tLinked.id,
        template_type: 'seeding',
      });

      const res = await http.get(`${baseUrl}/scoresheet/templates`);

      expect(res.status).toBe(200);
      const templates = res.json as { id: number; name: string }[];
      expect(templates.length).toBe(1);
      expect(templates[0].name).toBe('Linked Sheet');
    });

    it('includes event metadata for grouping', async () => {
      const event = await seedEvent(testDb.db, {
        name: 'My Event',
        status: 'setup',
        event_date: '2026-03-15',
      });
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Event Sheet',
        schema: JSON.stringify({ fields: [] }),
      });
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: event.id,
        template_id: template.id,
        template_type: 'seeding',
      });

      const res = await http.get(`${baseUrl}/scoresheet/templates`);

      expect(res.status).toBe(200);
      const templates = res.json as {
        id: number;
        event_id: number;
        event_name: string;
        event_date: string | null;
      }[];
      expect(templates.length).toBe(1);
      expect(templates[0].event_id).toBe(event.id);
      expect(templates[0].event_name).toBe('My Event');
      expect(templates[0].event_date).toBe('2026-03-15');
    });
  });
});
