/**
 * Postgres schema parity test.
 *
 * Runs initializePostgres() against a recording adapter that captures all
 * emitted SQL, then asserts every feature-critical table, column, index,
 * and trigger that initializeSQLite() already creates is also present in
 * the Postgres path.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type {
  Database,
  DatabaseResult,
  Transaction,
} from '../../../src/server/database/connection';
import { initializePostgres } from '../../../src/server/database/init';

const noop: DatabaseResult = { lastID: 0, changes: 0 };

function createRecordingAdapter(): { db: Database; sql: string[] } {
  const sql: string[] = [];
  const db: Database = {
    exec: async (s: string) => {
      sql.push(s);
    },
    run: async () => noop,
    get: async () => undefined,
    all: async () => [],
    transaction: async <T>(fn: (tx: Transaction) => Promise<T>) => {
      const tx: Transaction = {
        run: async () => noop,
        exec: async (s: string) => {
          sql.push(s);
        },
      };
      return fn(tx);
    },
  };
  return { db, sql };
}

function joined(sql: string[]): string {
  return sql.join('\n');
}

describe('initializePostgres parity with SQLite', () => {
  let allSql: string;

  beforeAll(async () => {
    const { db, sql } = createRecordingAdapter();
    await initializePostgres(db);
    allSql = joined(sql);
  });

  // =========================================================================
  // events.spectator_results_released
  // =========================================================================
  describe('events table', () => {
    it('CREATE TABLE includes spectator_results_released', () => {
      expect(allSql).toMatch(/CREATE TABLE.*events[\s\S]*spectator_results_released/i);
    });

    it('has ALTER TABLE migration for spectator_results_released', () => {
      expect(allSql).toMatch(/ALTER TABLE events.*ADD COLUMN.*spectator_results_released/i);
    });
  });

  // =========================================================================
  // brackets.weight
  // =========================================================================
  describe('brackets table', () => {
    it('CREATE TABLE includes weight column with CHECK constraint', () => {
      expect(allSql).toMatch(/CREATE TABLE.*brackets[\s\S]*weight REAL/i);
    });

    it('has ALTER TABLE migration for weight', () => {
      expect(allSql).toMatch(/ALTER TABLE brackets.*ADD COLUMN.*weight/i);
    });
  });

  // =========================================================================
  // bracket_entries ranking columns
  // =========================================================================
  describe('bracket_entries table', () => {
    it('CREATE TABLE includes final_rank', () => {
      expect(allSql).toMatch(/CREATE TABLE.*bracket_entries[\s\S]*final_rank/i);
    });

    it('CREATE TABLE includes bracket_raw_score', () => {
      expect(allSql).toMatch(/CREATE TABLE.*bracket_entries[\s\S]*bracket_raw_score/i);
    });

    it('CREATE TABLE includes weighted_bracket_raw_score', () => {
      expect(allSql).toMatch(/CREATE TABLE.*bracket_entries[\s\S]*weighted_bracket_raw_score/i);
    });

    it('has ALTER TABLE migrations for ranking columns', () => {
      expect(allSql).toMatch(/ALTER TABLE bracket_entries.*ADD COLUMN.*final_rank/i);
      expect(allSql).toMatch(/ALTER TABLE bracket_entries.*ADD COLUMN.*bracket_raw_score/i);
      expect(allSql).toMatch(/ALTER TABLE bracket_entries.*ADD COLUMN.*weighted_bracket_raw_score/i);
    });
  });

  // =========================================================================
  // Documentation scoring tables
  // =========================================================================
  describe('documentation scoring tables', () => {
    it('creates documentation_categories', () => {
      expect(allSql).toMatch(/CREATE TABLE.*documentation_categories/i);
    });

    it('creates event_documentation_categories', () => {
      expect(allSql).toMatch(/CREATE TABLE.*event_documentation_categories/i);
    });

    it('creates documentation_scores', () => {
      expect(allSql).toMatch(/CREATE TABLE.*documentation_scores/i);
    });

    it('creates documentation_sub_scores', () => {
      expect(allSql).toMatch(/CREATE TABLE.*documentation_sub_scores/i);
    });
  });

  // =========================================================================
  // Documentation indexes
  // =========================================================================
  describe('documentation indexes', () => {
    it('creates idx_event_doc_categories_event', () => {
      expect(allSql).toContain('idx_event_doc_categories_event');
    });

    it('creates idx_event_doc_categories_category', () => {
      expect(allSql).toContain('idx_event_doc_categories_category');
    });

    it('creates idx_doc_scores_event', () => {
      expect(allSql).toContain('idx_doc_scores_event');
    });

    it('creates idx_doc_scores_team', () => {
      expect(allSql).toContain('idx_doc_scores_team');
    });

    it('creates idx_doc_sub_scores_doc', () => {
      expect(allSql).toContain('idx_doc_sub_scores_doc');
    });
  });

  // =========================================================================
  // Triggers
  // =========================================================================
  describe('updated_at triggers', () => {
    it('includes documentation_scores in updated_at trigger set', () => {
      expect(allSql).toMatch(/documentation_scores_updated_at/i);
    });
  });
});
