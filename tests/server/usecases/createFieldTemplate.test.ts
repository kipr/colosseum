import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { createFieldTemplate } from '../../../src/server/usecases/createFieldTemplate';
import { seedUser } from '../../http/helpers/seed';

describe('createFieldTemplate', () => {
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
    const user = await seedUser(testDb.db);
    const result = await createFieldTemplate({
      db: testDb.db,
      body: { fields: [] },
      userId: user.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 when fields is not an array', async () => {
    const user = await seedUser(testDb.db);
    const result = await createFieldTemplate({
      db: testDb.db,
      body: { name: 't', fields: { a: 1 } },
      userId: user.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('Fields must be an array');
    }
  });

  it('inserts and returns the new template', async () => {
    const user = await seedUser(testDb.db);
    const result = await createFieldTemplate({
      db: testDb.db,
      body: { name: 'new', description: 'd', fields: [] },
      userId: user.id,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.template.name).toBe('new');
      expect(result.template.created_by).toBe(user.id);
    }
  });
});
