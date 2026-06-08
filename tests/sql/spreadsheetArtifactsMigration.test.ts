/**
 * Verifies the legacy spreadsheet artifact removal migration drops
 * spreadsheet_configs, chat_messages, and related FK columns.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import SQLite from 'better-sqlite3';
import { createSqliteDatabase } from '../../src/server/database/connection';
import { migrateRemoveSpreadsheetArtifactsSQLite } from '../../src/server/database/init';

describe('spreadsheet artifacts removal migration (SQLite)', () => {
  let sqlite: SQLite.Database;

  beforeEach(() => {
    sqlite = new SQLite(':memory:');
  });

  afterEach(() => {
    sqlite.close();
  });

  async function tableExists(name: string): Promise<boolean> {
    const db = createSqliteDatabase(sqlite);
    const row = await db.get<{ name: string | null }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [name],
    );
    return Boolean(row?.name);
  }

  async function columnExists(table: string, column: string): Promise<boolean> {
    const db = createSqliteDatabase(sqlite);
    const rows = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
    return rows.some((row) => row.name === column);
  }

  it('no-ops when spreadsheet_configs is already absent', async () => {
    const db = createSqliteDatabase(sqlite);
    await db.exec(`
      CREATE TABLE score_submissions (
        id INTEGER PRIMARY KEY,
        template_id INTEGER NOT NULL,
        score_data TEXT NOT NULL
      )
    `);

    await migrateRemoveSpreadsheetArtifactsSQLite(db);

    expect(await tableExists('score_submissions')).toBe(true);
  });

  it('drops legacy tables and columns when spreadsheet_configs exists', async () => {
    const db = createSqliteDatabase(sqlite);

    // Mirror the legacy schema: both score_submissions and scoresheet_templates
    // carry a foreign key into spreadsheet_configs, which is what blocks a plain
    // DROP COLUMN and forces the rebuild path.
    await db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL
      )
    `);
    await db.exec(`
      CREATE TABLE spreadsheet_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        spreadsheet_id TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await db.exec(`
      CREATE TABLE scoresheet_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        schema TEXT NOT NULL,
        access_code TEXT NOT NULL,
        spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.exec(`
      CREATE TABLE score_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        template_id INTEGER NOT NULL,
        spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id),
        participant_name TEXT,
        match_id TEXT,
        score_data TEXT NOT NULL,
        submitted_to_sheet BOOLEAN DEFAULT 0,
        status TEXT DEFAULT 'pending',
        reviewed_by INTEGER,
        reviewed_at DATETIME,
        event_id INTEGER,
        bracket_game_id INTEGER,
        seeding_score_id INTEGER,
        score_type TEXT,
        game_queue_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (spreadsheet_config_id) REFERENCES spreadsheet_configs(id) ON DELETE CASCADE
      )
    `);
    await db.exec(`
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spreadsheet_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        message TEXT NOT NULL
      )
    `);

    // Seed rows to confirm data is preserved across the rebuild.
    await db.run(
      `INSERT INTO scoresheet_templates (id, name, schema, access_code, spreadsheet_config_id)
       VALUES (1, 'Tmpl', '[]', 'code', NULL)`,
    );
    await db.run(
      `INSERT INTO score_submissions (id, template_id, score_data, status, score_type)
       VALUES (42, 1, '{"a":1}', 'pending', 'seeding')`,
    );

    await migrateRemoveSpreadsheetArtifactsSQLite(db);

    expect(await tableExists('spreadsheet_configs')).toBe(false);
    expect(await tableExists('chat_messages')).toBe(false);
    expect(
      await columnExists('scoresheet_templates', 'spreadsheet_config_id'),
    ).toBe(false);
    expect(
      await columnExists('score_submissions', 'spreadsheet_config_id'),
    ).toBe(false);
    expect(await columnExists('score_submissions', 'submitted_to_sheet')).toBe(
      false,
    );
    expect(await tableExists('score_submissions')).toBe(true);

    // Data survives the rebuild.
    const template = await db.get<{ id: number; name: string }>(
      `SELECT id, name FROM scoresheet_templates WHERE id = 1`,
    );
    expect(template?.name).toBe('Tmpl');
    const submission = await db.get<{ id: number; score_type: string }>(
      `SELECT id, score_type FROM score_submissions WHERE id = 42`,
    );
    expect(submission?.score_type).toBe('seeding');
  });
});
