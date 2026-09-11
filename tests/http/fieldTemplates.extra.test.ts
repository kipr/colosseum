/**
 * Additional field template tests targeting uncovered update/delete paths.
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

describe('Field Templates - additional coverage', () => {
  let testDb: TestDb;
  let server: TestServerHandle;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    const user = await seedUser(testDb.db);
    const app = createTestApp({ user: { id: user.id, is_admin: false } });
    app.use('/field-templates', fieldTemplatesRoutes);
    server = await startServer(app);
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('PUT /field-templates/:id', () => {
    it('rejects invalid formulas on both create and update with structured errors', async () => {
      const created = await http.post(`${server.baseUrl}/field-templates`, {
        name: 'Valid',
        fields: [{ id: 'a', type: 'number' }],
      });
      expect(created.status).toBe(200);
      const id = (created.json as { id: number }).id;
      const body = {
        name: 'Invalid',
        fields: [{ id: 'total', type: 'calculated', formula: 'unknown+1' }],
      };
      for (const res of [
        await http.post(`${server.baseUrl}/field-templates`, body),
        await http.put(`${server.baseUrl}/field-templates/${id}`, body),
      ]) {
        expect(res.status).toBe(400);
        expect(res.json).toMatchObject({
          error: expect.any(String),
          errors: expect.arrayContaining([
            expect.stringContaining('UNKNOWN_REFERENCE'),
          ]),
        });
      }
    });

    it('updates an existing field template', async () => {
      // Create
      const createRes = await http.post(`${server.baseUrl}/field-templates`, {
        name: 'Original',
        fields: [{ id: 'field1', type: 'number' }],
      });
      expect(createRes.status).toBe(200);
      const created = createRes.json as { id: number };

      // Update
      const updateRes = await http.put(
        `${server.baseUrl}/field-templates/${created.id}`,
        {
          name: 'Updated',
          fields: [{ id: 'field1', type: 'text' }],
        },
      );
      expect(updateRes.status).toBe(200);
      const updated = updateRes.json as { name: string };
      expect(updated.name).toBe('Updated');
    });

    it('returns 400 when name is missing', async () => {
      const res = await http.put(`${server.baseUrl}/field-templates/1`, {
        fields: [{ name: 'field1' }],
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when fields is missing', async () => {
      const res = await http.put(`${server.baseUrl}/field-templates/1`, {
        name: 'Test',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /field-templates/:id', () => {
    it('deletes a field template', async () => {
      const createRes = await http.post(`${server.baseUrl}/field-templates`, {
        name: 'To Delete',
        fields: [{ id: 'f1', type: 'number' }],
      });
      const created = createRes.json as { id: number };

      const deleteRes = await http.delete(
        `${server.baseUrl}/field-templates/${created.id}`,
      );
      expect(deleteRes.status).toBe(200);
      expect((deleteRes.json as { success: boolean }).success).toBe(true);
    });
  });

  describe('POST /field-templates - fields validation', () => {
    it('returns 400 when fields is not an array', async () => {
      const res = await http.post(`${server.baseUrl}/field-templates`, {
        name: 'Test',
        fields: 'not-an-array',
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('array');
    });

    it('returns 400 for invalid defaultValue', async () => {
      const res = await http.post(`${server.baseUrl}/field-templates`, {
        name: 'Bad Defaults',
        fields: [{ id: 'flag', type: 'checkbox', defaultValue: 'yes' }],
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('boolean');
    });

    it('persists valid typed defaults', async () => {
      const fields = [
        { id: 'score', type: 'number', min: 0, max: 100, defaultValue: 10 },
        { id: 'ok', type: 'checkbox', defaultValue: false },
      ];
      const res = await http.post(`${server.baseUrl}/field-templates`, {
        name: 'Good Defaults',
        fields,
      });
      expect(res.status).toBe(200);

      const created = res.json as { id: number; fields_json: string };
      expect(JSON.parse(created.fields_json)).toEqual(fields);
    });

    it('returns 400 on update when defaultValue is invalid', async () => {
      const createRes = await http.post(`${server.baseUrl}/field-templates`, {
        name: 'Original',
        fields: [{ id: 'score', type: 'number', defaultValue: 1 }],
      });
      const created = createRes.json as { id: number };

      const updateRes = await http.put(
        `${server.baseUrl}/field-templates/${created.id}`,
        {
          name: 'Updated',
          fields: [{ id: 'score', type: 'number', defaultValue: 'nope' }],
        },
      );
      expect(updateRes.status).toBe(400);
      expect((updateRes.json as { error: string }).error).toContain(
        'finite number',
      );
    });
  });
});
