import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { listFieldTemplates } from '../../../src/server/usecases/listFieldTemplates';
import { seedUser } from '../../http/helpers/seed';

async function seedFieldTemplate(
  db: TestDb['db'],
  name: string,
  userId: number,
): Promise<void> {
  await db.run(
    `INSERT INTO scoresheet_field_templates (name, fields_json, created_by) VALUES (?, ?, ?)`,
    [name, '[]', userId],
  );
}

describe('listFieldTemplates', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns an empty list when none exist', async () => {
    const result = await listFieldTemplates({ db: testDb.db });
    expect(result.templates).toEqual([]);
  });

  it('returns all templates', async () => {
    const user = await seedUser(testDb.db);
    await seedFieldTemplate(testDb.db, 'A', user.id);
    await seedFieldTemplate(testDb.db, 'B', user.id);

    const result = await listFieldTemplates({ db: testDb.db });
    expect(result.templates.length).toBe(2);
  });
});
