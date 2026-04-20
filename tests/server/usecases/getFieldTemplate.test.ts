import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { getFieldTemplate } from '../../../src/server/usecases/getFieldTemplate';
import { seedUser } from '../../http/helpers/seed';

describe('getFieldTemplate', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns 404 when missing', async () => {
    const result = await getFieldTemplate({ db: testDb.db, templateId: 9999 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe('Field template not found');
    }
  });

  it('parses fields_json into an array', async () => {
    const user = await seedUser(testDb.db);
    const fields = [{ id: 'f1', label: 'Field 1', type: 'number' }];
    const inserted = await testDb.db.run(
      `INSERT INTO scoresheet_field_templates (name, fields_json, created_by) VALUES (?, ?, ?)`,
      ['t1', JSON.stringify(fields), user.id],
    );

    const result = await getFieldTemplate({
      db: testDb.db,
      templateId: inserted.lastID!,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.template.fields).toEqual(fields);
    }
  });
});
