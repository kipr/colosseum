import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { updateFieldTemplate } from '../../../src/server/usecases/updateFieldTemplate';
import { seedUser } from '../../http/helpers/seed';

describe('updateFieldTemplate', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 400 when name is missing', async () => {
    const result = await updateFieldTemplate({
      db: testDb.db,
      templateId: 1,
      body: { fields: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('replaces name/description/fields', async () => {
    const user = await seedUser(testDb.db);
    const inserted = await testDb.db.run(
      `INSERT INTO scoresheet_field_templates (name, fields_json, created_by) VALUES (?, ?, ?)`,
      ['old', '[]', user.id],
    );

    const result = await updateFieldTemplate({
      db: testDb.db,
      templateId: inserted.lastID!,
      body: { name: 'updated', description: 'd', fields: [{ x: 1 }] },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.template) {
      expect(result.template.name).toBe('updated');
      expect(result.template.description).toBe('d');
    }
  });
});
