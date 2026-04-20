/**
 * Server-side schema validation for scoresheet template create/update.
 * - Strict zod parse on POST/PUT (rejects invalid shapes).
 * - Forgiving parse on read (legacy / future-unknown rows still surface so the
 *   client can decide how to render them).
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
import { seedUser, seedScoresheetTemplate } from './helpers/seed';
import scoresheetRoutes from '../../src/server/routes/scoresheet';

describe('Scoresheet template schema validation', () => {
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

  describe('POST /scoresheet/templates', () => {
    it('rejects a schema with a non-array fields property', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Bad Schema',
        accessCode: 'abc',
        schema: { fields: 'not-an-array' },
      });
      expect(res.status).toBe(400);
      const body = res.json as { error: string; issues: unknown[] };
      expect(body.error).toBe('Invalid schema');
      expect(Array.isArray(body.issues)).toBe(true);
    });

    it('rejects a schema with an unknown field type', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Bad Schema',
        accessCode: 'abc',
        schema: {
          fields: [{ id: 'x', label: 'X', type: 'mystery-type' }],
        },
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toBe('Invalid schema');
    });

    it('rejects a buttons field without options', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Bad Schema',
        accessCode: 'abc',
        schema: {
          fields: [{ id: 'b', label: 'B', type: 'buttons' }],
        },
      });
      expect(res.status).toBe(400);
    });

    it('accepts a fully-populated valid schema', async () => {
      const res = await http.post(`${baseUrl}/scoresheet/templates`, {
        name: 'Valid Schema',
        accessCode: 'abc',
        schema: {
          title: 'Valid',
          layout: 'two-column',
          fields: [
            { id: 't', label: 'T', type: 'text' },
            { id: 'n', label: 'N', type: 'number', min: 0, step: 1 },
            {
              id: 'd',
              label: 'D',
              type: 'dropdown',
              options: [{ label: 'A', value: 'a' }],
            },
            {
              id: 'calc',
              label: 'Calc',
              type: 'calculated',
              formula: 'n',
              isTotal: true,
            },
          ],
        },
      });
      expect(res.status).toBe(200);
      const body = res.json as { id: number; schema: { fields: unknown[] } };
      expect(body.schema.fields).toHaveLength(4);
    });
  });

  describe('PUT /scoresheet/templates/:id', () => {
    it('rejects an invalid update without mutating the row', async () => {
      const original = await seedScoresheetTemplate(testDb.db, {
        name: 'Original',
        schema: JSON.stringify({ fields: [] }),
        access_code: 'code',
        created_by: userId,
      });

      const res = await http.put(
        `${baseUrl}/scoresheet/templates/${original.id}`,
        {
          name: 'Updated',
          accessCode: 'newcode',
          schema: { fields: [{ id: 'x', label: 'X', type: 'invalid' }] },
        },
      );
      expect(res.status).toBe(400);

      const row = await testDb.db.get(
        'SELECT name, schema FROM scoresheet_templates WHERE id = ?',
        [original.id],
      );
      expect(row.name).toBe('Original');
      expect(row.schema).toBe(JSON.stringify({ fields: [] }));
    });

    it('accepts a valid update', async () => {
      const original = await seedScoresheetTemplate(testDb.db, {
        name: 'Original',
        schema: JSON.stringify({ fields: [] }),
        access_code: 'code',
        created_by: userId,
      });

      const res = await http.put(
        `${baseUrl}/scoresheet/templates/${original.id}`,
        {
          name: 'Updated',
          accessCode: 'code',
          schema: {
            fields: [{ id: 'x', label: 'X', type: 'text' as const }],
          },
        },
      );
      expect(res.status).toBe(200);
    });
  });

  describe('GET /scoresheet/templates/:id (forgiving read)', () => {
    it('returns the raw object for a legacy schema that fails validation', async () => {
      // Seed directly so we bypass validation and simulate a legacy row.
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Legacy',
        schema: JSON.stringify({
          fields: [{ id: 'mystery', label: 'Mystery', type: 'mystery-type' }],
        }),
        access_code: 'code',
        created_by: userId,
      });

      const res = await http.get(
        `${baseUrl}/scoresheet/templates/${template.id}`,
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        schema: { fields: Array<{ type: string }> };
      };
      expect(body.schema.fields[0].type).toBe('mystery-type');
    });

    it('returns null schema when the stored value is unparseable JSON', async () => {
      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Bad JSON',
        schema: 'not-json',
        access_code: 'code',
        created_by: userId,
      });

      const res = await http.get(
        `${baseUrl}/scoresheet/templates/${template.id}`,
      );
      expect(res.status).toBe(200);
      expect((res.json as { schema: unknown }).schema).toBeNull();
    });
  });
});
