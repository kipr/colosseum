/**
 * Postgres schema parity test.
 *
 * Runs initializePostgres() against a recording adapter that captures emitted
 * SQL, then asserts feature-critical tables, columns, indexes, and triggers
 * from the current SQLite baseline are also present in the Postgres path.
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

  describe('baseline schema', () => {
    it('creates events with current public-result and score-accept columns', () => {
      expect(allSql).toMatch(
        /CREATE TABLE.*events[\s\S]*double_seeding_rounds INTEGER DEFAULT 0/i,
      );
      expect(allSql).toMatch(
        /CREATE TABLE.*events[\s\S]*score_accept_mode TEXT NOT NULL DEFAULT 'manual'/i,
      );
      expect(allSql).toMatch(
        /CREATE TABLE.*events[\s\S]*spectator_results_released INTEGER NOT NULL DEFAULT 0/i,
      );
    });

    it('creates bracket baseline ranking columns', () => {
      expect(allSql).toMatch(/CREATE TABLE.*brackets[\s\S]*weight REAL/i);
      expect(allSql).toMatch(/CREATE TABLE.*bracket_entries[\s\S]*final_rank/i);
      expect(allSql).toMatch(
        /CREATE TABLE.*bracket_entries[\s\S]*bracket_raw_score/i,
      );
      expect(allSql).toMatch(
        /CREATE TABLE.*bracket_entries[\s\S]*weighted_bracket_raw_score/i,
      );
    });
  });

  describe('double-seeding baseline', () => {
    it('creates double-seeding tables', () => {
      expect(allSql).toMatch(/CREATE TABLE.*double_seeding_matches/i);
      expect(allSql).toMatch(/CREATE TABLE.*double_seeding_scores/i);
      expect(allSql).toMatch(/CREATE TABLE.*double_seeding_rankings/i);
    });

    it('creates score_submissions with double_seeding_match_id', () => {
      expect(allSql).toMatch(
        /CREATE TABLE.*score_submissions[\s\S]*double_seeding_match_id INTEGER/i,
      );
      expect(allSql).toMatch(
        /CONSTRAINT score_submissions_double_seeding_match_id_fkey[\s\S]*REFERENCES double_seeding_matches\(id\) ON DELETE SET NULL/i,
      );
    });

    it('allows double_seeding event scoresheet templates', () => {
      expect(allSql).toMatch(
        /CREATE TABLE.*event_scoresheet_templates[\s\S]*template_type IN \('seeding', 'bracket', 'double_seeding'\)/i,
      );
    });

    it('creates game_queue with arrived status and double_seeding identity', () => {
      expect(allSql).toMatch(
        /CREATE TABLE.*game_queue[\s\S]*status IN \('queued', 'called', 'arrived', 'on_table', 'scored'\)/i,
      );
      expect(allSql).toMatch(
        /CREATE TABLE.*game_queue[\s\S]*queue_type IN \('seeding', 'bracket', 'double_seeding'\)/i,
      );
      expect(allSql).toMatch(
        /CREATE TABLE.*game_queue[\s\S]*double_seeding_match_id INTEGER REFERENCES double_seeding_matches\(id\) ON DELETE CASCADE/i,
      );
    });
  });

  describe('documentation scoring', () => {
    it('creates documentation tables and indexes', () => {
      expect(allSql).toMatch(/CREATE TABLE.*documentation_categories/i);
      expect(allSql).toMatch(/CREATE TABLE.*event_documentation_categories/i);
      expect(allSql).toMatch(/CREATE TABLE.*documentation_scores/i);
      expect(allSql).toMatch(/CREATE TABLE.*documentation_sub_scores/i);
      expect(allSql).toContain('idx_event_doc_categories_event');
      expect(allSql).toContain('idx_event_doc_categories_category');
      expect(allSql).toContain('idx_doc_scores_event');
      expect(allSql).toContain('idx_doc_scores_team');
      expect(allSql).toContain('idx_doc_sub_scores_doc');
    });
  });

  describe('triggers', () => {
    it('includes documentation_scores in updated_at trigger set', () => {
      expect(allSql).toMatch(/documentation_scores_updated_at/i);
    });

    it('keeps judge_chat_messages out of the updated_at trigger set', () => {
      expect(allSql).not.toMatch(/judge_chat_messages_updated_at/i);
    });
  });

  describe('judge_chat_messages', () => {
    it('creates judge_chat_messages with event scope and sender-role check', () => {
      expect(allSql).toMatch(
        /CREATE TABLE.*judge_chat_messages[\s\S]*event_id INTEGER NOT NULL REFERENCES events\(id\) ON DELETE CASCADE/i,
      );
      expect(allSql).toMatch(
        /CREATE TABLE.*judge_chat_messages[\s\S]*conversation_key TEXT NOT NULL[\s\S]*sender_role TEXT NOT NULL CHECK \(sender_role IN \('judge', 'admin'\)\)/i,
      );
    });

    it('attributes template_id and user_id with ON DELETE SET NULL', () => {
      expect(allSql).toMatch(
        /CREATE TABLE.*judge_chat_messages[\s\S]*template_id INTEGER REFERENCES scoresheet_templates\(id\) ON DELETE SET NULL/i,
      );
      expect(allSql).toMatch(
        /CREATE TABLE.*judge_chat_messages[\s\S]*user_id INTEGER REFERENCES users\(id\) ON DELETE SET NULL/i,
      );
    });

    it('creates both judge chat indexes', () => {
      expect(allSql).toContain('idx_judge_chat_thread');
      expect(allSql).toContain('idx_judge_chat_event_created');
    });
  });

  describe('migration removal', () => {
    it('does not emit historical migration SQL', () => {
      expect(allSql).not.toMatch(/ALTER TABLE .* ADD COLUMN IF NOT EXISTS/i);
      expect(allSql).not.toMatch(/DROP TABLE IF EXISTS chat_messages/i);
      expect(allSql).not.toMatch(/DROP TABLE IF EXISTS spreadsheet_configs/i);
      expect(allSql).not.toMatch(
        /UPDATE game_queue[\s\S]*SET status = CASE status/i,
      );
    });

    it('does not create legacy spreadsheet artifacts', () => {
      expect(allSql).not.toMatch(
        /CREATE TABLE IF NOT EXISTS spreadsheet_configs/i,
      );
      expect(allSql).not.toMatch(/CREATE TABLE IF NOT EXISTS chat_messages/i);
      expect(allSql).not.toContain('idx_spreadsheet_configs_user');
      expect(allSql).not.toContain('idx_chat_messages_spreadsheet');
      expect(allSql).not.toContain('idx_chat_messages_created');
    });
  });
});
