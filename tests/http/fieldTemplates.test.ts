/**
 * HTTP route tests for /field-templates endpoints.
 * Covers full CRUD and authentication boundaries.
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
import { seedUser } from './helpers/seed';
import fieldTemplatesRoutes from '../../src/server/routes/fieldTemplates';

async function seedFieldTemplate(
  db: TestDb['db'],
  data: {
    name?: string;
    description?: string | null;
    fields_json?: string;
    created_by?: number | null;
  } = {},
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO scoresheet_field_templates (name, description, fields_json, created_by)
     VALUES (?, ?, ?, ?)`,
    [
      data.name ?? 'Test Field Template',
      data.description ?? null,
      data.fields_json ?? '[{"name":"score","type":"number"}]',
      data.created_by ?? null,
    ],
  );
  return { id: result.lastID! };
}

describe('Field Templates Routes', () => {
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
    it('GET / returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/field-templates', fieldTemplatesRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/field-templates`);
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });

    it('POST / returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/field-templates', fieldTemplatesRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(`${server.baseUrl}/field-templates`, {
          name: 'Test',
          fields: [{ name: 'score', type: 'number' }],
        });
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });

    it('PUT /:id returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/field-templates', fieldTemplatesRoutes);
      const server = await startServer(app);

      try {
        const res = await http.put(`${server.baseUrl}/field-templates/1`, {
          name: 'Updated',
          fields: [],
        });
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });

    it('DELETE /:id returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/field-templates', fieldTemplatesRoutes);
      const server = await startServer(app);

      try {
        const res = await http.delete(`${server.baseUrl}/field-templates/1`);
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });
  });

  // ==========================================================================
  // GET /field-templates
  // ==========================================================================

  describe('GET /field-templates', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/field-templates', fieldTemplatesRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns empty array when no templates exist', async () => {
      const res = await http.get(`${server.baseUrl}/field-templates`);
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns all templates', async () => {
      await seedFieldTemplate(testDb.db, { name: 'Template A' });
      await seedFieldTemplate(testDb.db, { name: 'Template B' });

      const res = await http.get(`${server.baseUrl}/field-templates`);
      expect(res.status).toBe(200);
      const templates = res.json as { name: string }[];
      expect(templates.length).toBe(2);
    });
  });

  // ==========================================================================
  // GET /field-templates/:id
  // ==========================================================================

  describe('GET /field-templates/:id', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/field-templates', fieldTemplatesRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 404 when template not found', async () => {
      const res = await http.get(`${server.baseUrl}/field-templates/999`);
      expect(res.status).toBe(404);
      expect((res.json as { error: string }).error).toContain(
        'Field template not found',
      );
    });

    it('returns template with parsed fields', async () => {
      const fieldsJson = '[{"name":"accuracy","type":"number","max":100}]';
      const tmpl = await seedFieldTemplate(testDb.db, {
        name: 'Accuracy',
        fields_json: fieldsJson,
      });

      const res = await http.get(
        `${server.baseUrl}/field-templates/${tmpl.id}`,
      );
      expect(res.status).toBe(200);
      const result = res.json as {
        name: string;
        fields: { name: string; type: string; max: number }[];
      };
      expect(result.name).toBe('Accuracy');
      expect(result.fields).toEqual([
        { name: 'accuracy', type: 'number', max: 100 },
      ]);
    });
  });

  // ==========================================================================
  // POST /field-templates
  // ==========================================================================

  describe('POST /field-templates', () => {
    let server: TestServerHandle;
    let userId: number;

    beforeEach(async () => {
      const user = await seedUser(testDb.db, { is_admin: true });
      userId = user.id;
      const app = createTestApp({ user: { id: userId, is_admin: true } });
      app.use('/field-templates', fieldTemplatesRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when name is missing', async () => {
      const res = await http.post(`${server.baseUrl}/field-templates`, {
        fields: [{ name: 'score', type: 'number' }],
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Name and fields are required',
      );
    });

    it('returns 400 when fields is missing', async () => {
      const res = await http.post(`${server.baseUrl}/field-templates`, {
        name: 'Test',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when fields is not an array', async () => {
      const res = await http.post(`${server.baseUrl}/field-templates`, {
        name: 'Test',
        fields: 'not-an-array',
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Fields must be an array',
      );
    });

    it('creates a field template', async () => {
      const fields = [
        { name: 'speed', type: 'number' },
        { name: 'accuracy', type: 'number' },
      ];
      const res = await http.post(`${server.baseUrl}/field-templates`, {
        name: 'Performance',
        description: 'Performance metrics',
        fields,
      });

      expect(res.status).toBe(200);
      const tmpl = res.json as {
        id: number;
        name: string;
        description: string;
        created_by: number;
      };
      expect(tmpl.id).toBeGreaterThan(0);
      expect(tmpl.name).toBe('Performance');
      expect(tmpl.description).toBe('Performance metrics');
      expect(tmpl.created_by).toBe(userId);
    });
  });

  // ==========================================================================
  // PUT /field-templates/:id
  // ==========================================================================

  describe('PUT /field-templates/:id', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const user = await seedUser(testDb.db, { is_admin: true });
      const app = createTestApp({ user: { id: user.id, is_admin: true } });
      app.use('/field-templates', fieldTemplatesRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when name is missing', async () => {
      const tmpl = await seedFieldTemplate(testDb.db);
      const res = await http.put(
        `${server.baseUrl}/field-templates/${tmpl.id}`,
        { fields: [] },
      );
      expect(res.status).toBe(400);
    });

    it('updates a field template', async () => {
      const tmpl = await seedFieldTemplate(testDb.db, { name: 'Old Name' });
      const newFields = [{ name: 'updated_field', type: 'text' }];

      const res = await http.put(
        `${server.baseUrl}/field-templates/${tmpl.id}`,
        {
          name: 'New Name',
          description: 'Updated desc',
          fields: newFields,
        },
      );

      expect(res.status).toBe(200);
      const result = res.json as { name: string; description: string };
      expect(result.name).toBe('New Name');
      expect(result.description).toBe('Updated desc');
    });
  });

  // ==========================================================================
  // DELETE /field-templates/:id
  // ==========================================================================

  describe('DELETE /field-templates/:id', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const user = await seedUser(testDb.db, { is_admin: true });
      const app = createTestApp({ user: { id: user.id, is_admin: true } });
      app.use('/field-templates', fieldTemplatesRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('deletes a field template', async () => {
      const tmpl = await seedFieldTemplate(testDb.db);

      const res = await http.delete(
        `${server.baseUrl}/field-templates/${tmpl.id}`,
      );
      expect(res.status).toBe(200);
      expect((res.json as { success: boolean }).success).toBe(true);

      // Verify deletion
      const getRes = await http.get(
        `${server.baseUrl}/field-templates/${tmpl.id}`,
      );
      expect(getRes.status).toBe(404);
    });
  });
});
