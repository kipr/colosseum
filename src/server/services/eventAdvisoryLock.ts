import { isDatabase, type DbExecutor } from '../database/connection';

/**
 * int4 class ids so event advisory locks do not collide with each other.
 * Held until the current transaction commits (`pg_advisory_xact_lock`).
 */
export const SEEDING_RANKING_LOCK_CLASS = 1001;
export const DOUBLE_SEEDING_RANKING_LOCK_CLASS = 1002;
export const DOUBLE_SEEDING_SCORE_LOCK_CLASS = 1003;

export async function lockEventAdvisory(
  db: DbExecutor,
  lockClass: number,
  eventId: number,
): Promise<void> {
  await db.run('SELECT pg_advisory_xact_lock(?, ?)', [lockClass, eventId]);
}

/**
 * Run `fn` while holding a per-event transaction advisory lock.
 * When `db` is a pool adapter, opens a transaction so the lock covers
 * both the callback's reads and its writes.
 */
export async function withEventAdvisoryLock<T>(
  db: DbExecutor,
  lockClass: number,
  eventId: number,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  const run = async (tx: DbExecutor) => {
    await lockEventAdvisory(tx, lockClass, eventId);
    return fn(tx);
  };
  if (isDatabase(db)) {
    return db.transaction(run);
  }
  return run(db);
}
