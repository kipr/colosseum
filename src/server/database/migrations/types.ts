/**
 * Shared types for discrete schema migrations.
 *
 * Each migration is an idempotent operation that brings an existing database
 * schema up-to-date with the canonical table definitions in `schema/tables.ts`.
 * On a fresh database the migration is a no-op (because the column or
 * constraint already exists from `CREATE TABLE`).
 */

import { Database } from '../connection';
import { Dialect } from '../dialect';

export interface Migration {
  /** Stable, descriptive identifier (used only for logging). */
  readonly name: string;
  /**
   * Apply the migration. Implementations must be idempotent and safe to
   * re-run on every server startup.
   */
  run(db: Database, dialect: Dialect): Promise<void>;
}
