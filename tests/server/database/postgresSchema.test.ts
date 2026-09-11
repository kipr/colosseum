/**
 * Live Postgres schema test.
 *
 * Replaces the old postgresParity test, which ran initializePostgres()
 * against a recording adapter and regex-matched the emitted SQL. That could
 * not tell whether the DDL actually applied. These assertions introspect the
 * schema the harness really built.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb, TestDb } from '../../sql/helpers/testDb';

const EXPECTED_TABLES = [
  'active_sessions',
  'audit_log',
  'award_templates',
  'bracket_entries',
  'bracket_games',
  'bracket_templates',
  'brackets',
  'documentation_categories',
  'documentation_scores',
  'documentation_sub_scores',
  'double_seeding_matches',
  'double_seeding_rankings',
  'double_seeding_scores',
  'event_automatic_award_settings',
  'event_award_individual_recipients',
  'event_award_recipients',
  'event_awards',
  'event_documentation_categories',
  'event_scoresheet_templates',
  'events',
  'game_queue',
  'judge_chat_messages',
  'queue_versions',
  'score_details',
  'score_submissions',
  'scoresheet_field_templates',
  'scoresheet_templates',
  'seeding_rankings',
  'seeding_scores',
  'session',
  'teams',
  'users',
];

describe('Postgres schema', () => {
  let testDb: TestDb;
  let tables: string[];
  let indexes: string[];

  beforeAll(async () => {
    testDb = await createTestDb();

    tables = (
      await testDb.db.all<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
      )
    ).map((r) => r.table_name);

    indexes = (
      await testDb.db.all<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`,
      )
    ).map((r) => r.indexname);
  });

  afterAll(() => {
    testDb.close();
  });

  async function columns(table: string) {
    return testDb.db.all<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = ?`,
      [table],
    );
  }

  async function columnNames(table: string) {
    return (await columns(table)).map((c) => c.column_name);
  }

  /** Full CHECK expressions for a table, as PostgreSQL stores them. */
  async function checkClauses(table: string) {
    const rows = await testDb.db.all<{ definition: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       WHERE c.contype = 'c'
         AND t.relname = ?
         AND t.relnamespace = current_schema()::regnamespace`,
      [table],
    );
    return rows.map((r) => r.definition);
  }

  describe('tables', () => {
    it('creates every table in the schema modules', () => {
      expect(tables.sort()).toEqual(EXPECTED_TABLES);
    });

    it('does not create legacy spreadsheet or chat artifacts', () => {
      expect(tables).not.toContain('spreadsheet_configs');
      expect(tables).not.toContain('chat_messages');
    });
  });

  describe('users', () => {
    it('does not store Google OAuth credentials', async () => {
      const userColumns = await columnNames('users');
      expect(userColumns).not.toContain('access_token');
      expect(userColumns).not.toContain('refresh_token');
      expect(userColumns).not.toContain('token_expires_at');
    });
  });

  describe('events', () => {
    it('has the public-result and score-accept columns', async () => {
      const cols = await columns('events');
      expect(cols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            column_name: 'double_seeding_rounds',
            column_default: '0',
          }),
          expect.objectContaining({
            column_name: 'score_accept_mode',
            is_nullable: 'NO',
            column_default: "'manual'::text",
          }),
          expect.objectContaining({
            column_name: 'spectator_results_released',
            is_nullable: 'NO',
            column_default: '0',
          }),
        ]),
      );
    });

    it('restricts status and score_accept_mode', async () => {
      const checks = checkClausesJoined(await checkClauses('events'));
      expect(checks).toContain("'setup'");
      expect(checks).toContain("'archived'");
      expect(checks).toContain("'auto_accept_all'");
    });
  });

  describe('brackets', () => {
    it('has ranking columns on brackets and bracket_entries', async () => {
      expect(await columnNames('brackets')).toContain('weight');
      const entryCols = await columnNames('bracket_entries');
      expect(entryCols).toContain('final_rank');
      expect(entryCols).toContain('bracket_raw_score');
      expect(entryCols).toContain('weighted_bracket_raw_score');
    });

    it('has play-order columns and the play-order index', async () => {
      expect(await columnNames('bracket_games')).toContain('play_order');
      expect(await columnNames('bracket_templates')).toContain('play_order');
      expect(indexes).toContain('idx_bracket_games_play_order');
    });

    it('keeps is_bye as a real boolean', async () => {
      const cols = await columns('bracket_entries');
      expect(cols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            column_name: 'is_bye',
            data_type: 'boolean',
            column_default: 'false',
          }),
        ]),
      );
    });

    it('has special-result metadata on games and submissions', async () => {
      const gameCols = await columns('bracket_games');
      expect(gameCols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            column_name: 'result_type',
            is_nullable: 'NO',
            column_default: "'standard'::text",
          }),
          expect.objectContaining({ column_name: 'disqualified_team_id' }),
        ]),
      );
      expect(await columnNames('score_submissions')).toContain('result_note');
    });
  });

  describe('double seeding', () => {
    it('creates the double-seeding tables', () => {
      expect(tables).toContain('double_seeding_matches');
      expect(tables).toContain('double_seeding_scores');
      expect(tables).toContain('double_seeding_rankings');
    });

    it('applies the additive score_submissions foreign keys', async () => {
      // These come from idempotent DO $$ blocks in schema/scoring.ts. They are
      // guarded by name, so a guard that ignores table_schema would skip them
      // once another schema in the same database had the constraint.
      const rows = await testDb.db.all<{ conname: string }>(
        `SELECT c.conname
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         WHERE c.contype = 'f'
           AND t.relname = 'score_submissions'
           AND t.relnamespace = current_schema()::regnamespace`,
      );
      const names = rows.map((r) => r.conname);
      expect(names).toContain('score_submissions_bracket_game_id_fkey');
      expect(names).toContain('score_submissions_game_queue_id_fkey');
      expect(names).toContain('score_submissions_double_seeding_match_id_fkey');
    });

    it('allows the double_seeding event template type', async () => {
      const checks = checkClausesJoined(
        await checkClauses('event_scoresheet_templates'),
      );
      expect(checks).toContain("'double_seeding'");
    });

    it('allows the arrived queue status and double_seeding identity', async () => {
      const checks = checkClausesJoined(await checkClauses('game_queue'));
      expect(checks).toContain("'arrived'");
      expect(checks).toContain("'double_seeding'");

      const queueCols = await columnNames('game_queue');
      expect(queueCols).toContain('double_seeding_match_id');
      expect(queueCols).toContain('present_team1_id');
      expect(queueCols).toContain('present_team2_id');
    });
  });

  describe('awards', () => {
    it('has award_type columns and the event/type index', async () => {
      for (const [table, column] of [
        ['award_templates', 'award_type'],
        ['event_awards', 'award_type'],
        ['event_automatic_award_settings', 'de_award_type'],
        ['event_automatic_award_settings', 'per_bracket_overall_award_type'],
        ['event_automatic_award_settings', 'seeding_award_type'],
      ]) {
        const cols = await columns(table);
        expect(cols).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              column_name: column,
              is_nullable: 'NO',
              column_default: "'trophy'::text",
            }),
          ]),
        );
      }
      expect(indexes).toContain('idx_event_awards_event_type');
    });
  });

  describe('documentation scoring', () => {
    it('creates the documentation tables and indexes', () => {
      expect(tables).toContain('documentation_categories');
      expect(tables).toContain('event_documentation_categories');
      expect(tables).toContain('documentation_scores');
      expect(tables).toContain('documentation_sub_scores');
      expect(indexes).toContain('idx_event_doc_categories_event');
      expect(indexes).toContain('idx_event_doc_categories_category');
      expect(indexes).toContain('idx_doc_scores_event');
      expect(indexes).toContain('idx_doc_scores_team');
      expect(indexes).toContain('idx_doc_sub_scores_doc');
    });
  });

  describe('triggers', () => {
    it('creates updated_at triggers on the configured tables only', async () => {
      const rows = await testDb.db.all<{ tgname: string }>(
        `SELECT tg.tgname
         FROM pg_trigger tg
         JOIN pg_class t ON t.oid = tg.tgrelid
         WHERE NOT tg.tgisinternal
           AND t.relnamespace = current_schema()::regnamespace`,
      );
      const names = rows.map((r) => r.tgname);
      expect(names).toContain('documentation_scores_updated_at');
      expect(names).toContain('events_updated_at');
      expect(names).not.toContain('judge_chat_messages_updated_at');
    });
  });

  describe('judge_chat_messages', () => {
    it('is event scoped with a sender-role check', async () => {
      const cols = await columns('judge_chat_messages');
      expect(cols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            column_name: 'event_id',
            is_nullable: 'NO',
          }),
          expect.objectContaining({
            column_name: 'conversation_key',
            is_nullable: 'NO',
          }),
        ]),
      );
      const checks = checkClausesJoined(
        await checkClauses('judge_chat_messages'),
      );
      expect(checks).toContain("'judge'");
      expect(checks).toContain("'admin'");
    });

    it('nulls template_id and user_id on delete', async () => {
      const rows = await testDb.db.all<{
        conname: string;
        definition: string;
      }>(
        `SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         WHERE c.contype = 'f'
           AND t.relname = 'judge_chat_messages'
           AND t.relnamespace = current_schema()::regnamespace`,
      );
      const byColumn = (column: string) =>
        rows.find((r) => r.definition.includes(`(${column})`))?.definition;
      expect(byColumn('template_id')).toContain('ON DELETE SET NULL');
      expect(byColumn('user_id')).toContain('ON DELETE SET NULL');
    });

    it('creates both judge chat indexes', () => {
      expect(indexes).toContain('idx_judge_chat_thread');
      expect(indexes).toContain('idx_judge_chat_event_created');
    });
  });
});

function checkClausesJoined(clauses: string[]): string {
  return clauses.join('\n');
}
