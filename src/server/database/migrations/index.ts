/**
 * Discrete schema migrations applied after all `CREATE TABLE` statements.
 *
 * Each migration is idempotent: on a fresh database it's a no-op (the
 * canonical schema in `schema/tables.ts` already has the column or
 * constraint), and on an older database it brings the schema up-to-date.
 *
 * Most migrations are Postgres-only because SQLite can't `ALTER TABLE` to
 * add CHECK constraints or FKs after the fact, and SQLite developers always
 * start from a fresh `CREATE TABLE`.
 */

import { Database } from '../connection';
import { Dialect } from '../dialect';
import { addBracketEntryRankingColumns } from './addBracketEntryRankingColumns';
import { addBracketWeight } from './addBracketWeight';
import { addEventScoreAcceptMode } from './addEventScoreAcceptMode';
import { addEventSpectatorResultsReleased } from './addEventSpectatorResultsReleased';
import { addScoreSubmissionEventColumns } from './addScoreSubmissionEventColumns';
import { addScoreSubmissionsBracketGameFk } from './addScoreSubmissionsBracketGameFk';
import { addScoreSubmissionsGameQueueFk } from './addScoreSubmissionsGameQueueFk';
import { addSpreadsheetAutoAccept } from './addSpreadsheetAutoAccept';
import { addUserLastActivity } from './addUserLastActivity';
import { gameQueueStatusV2 } from './gameQueueStatusV2';
import { Migration } from './types';

/**
 * Ordered migration list. Column-add migrations come first so subsequent
 * FK-add migrations have something to reference. The queue-status rewrite
 * runs last so it sees the canonical column set.
 */
export const MIGRATIONS: readonly Migration[] = [
  addUserLastActivity,
  addSpreadsheetAutoAccept,
  addEventScoreAcceptMode,
  addEventSpectatorResultsReleased,
  addBracketWeight,
  addBracketEntryRankingColumns,
  addScoreSubmissionEventColumns,
  addScoreSubmissionsBracketGameFk,
  addScoreSubmissionsGameQueueFk,
  gameQueueStatusV2,
];

export async function runMigrations(
  db: Database,
  dialect: Dialect,
): Promise<void> {
  for (const migration of MIGRATIONS) {
    await migration.run(db, dialect);
  }
}
