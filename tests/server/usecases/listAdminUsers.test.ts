import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../../src/server/database/connection';
import { listAdminUsers } from '../../../src/server/usecases/listAdminUsers';

describe('listAdminUsers', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  it('returns only admin users', async () => {
    await testDb.db.run(
      `INSERT INTO users (name, email, google_id, is_admin) VALUES (?, ?, ?, ?)`,
      ['Admin', 'a@x.com', 'g1', true],
    );
    await testDb.db.run(
      `INSERT INTO users (name, email, google_id, is_admin) VALUES (?, ?, ?, ?)`,
      ['Reg', 'r@x.com', 'g2', false],
    );

    const result = await listAdminUsers({ db: testDb.db });
    expect(result.users.length).toBe(1);
    expect(result.users[0].email).toBe('a@x.com');
  });

  it('flags activity windows relative to provided now', async () => {
    const now = 1_000_000_000_000;
    const oneMinAgo = new Date(now - 60_000).toISOString();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();

    await testDb.db.run(
      `INSERT INTO users (name, email, google_id, is_admin, last_activity, token_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['Active', 'active@x.com', 'g1', true, oneMinAgo, now + 1000],
    );
    await testDb.db.run(
      `INSERT INTO users (name, email, google_id, is_admin, last_activity, token_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['Stale', 'stale@x.com', 'g2', true, twoHoursAgo, now - 1000],
    );

    const result = await listAdminUsers({ db: testDb.db, now });
    const byEmail = Object.fromEntries(result.users.map((u) => [u.email, u]));
    expect(byEmail['active@x.com'].isActive).toBe(true);
    expect(byEmail['active@x.com'].isRecentlyActive).toBe(true);
    expect(byEmail['active@x.com'].tokenValid).toBe(true);
    expect(byEmail['stale@x.com'].isActive).toBe(false);
    expect(byEmail['stale@x.com'].isRecentlyActive).toBe(false);
    expect(byEmail['stale@x.com'].tokenValid).toBe(false);
  });
});
