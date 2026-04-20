/**
 * Postgres / SQLite schema parity test.
 *
 * Two assertions:
 *   1. Structural: for every entry in TABLES_IN_ORDER that defines both
 *      dialects, the column NAMES declared in `pg` and `sqlite` are the same
 *      set. Types are intentionally allowed to differ (SERIAL vs
 *      AUTOINCREMENT, TIMESTAMP vs DATETIME).
 *   2. Smoke: the existing game_queue v2 migration emits the canonical
 *      `queued/called/arrived/on_table/scored` CHECK on Postgres.
 */
import { describe, it, expect } from 'vitest';
import { TABLES_IN_ORDER } from '../../../src/server/database/tables';
import migration0001 from '../../../src/server/database/migrations/0001_game_queue_status_v2';
import type { Database } from '../../../src/server/database/connection';

/**
 * Extract column names from a CREATE TABLE body.
 *
 * Strategy:
 *   - Strip the leading `CREATE TABLE IF NOT EXISTS <name> (`.
 *   - Strip the trailing `)` that closes the table.
 *   - Split on top-level commas (commas not inside `(...)`), ignoring lines
 *     that begin with `UNIQUE`, `CHECK`, `FOREIGN KEY`, `PRIMARY KEY`, or
 *     `CONSTRAINT`.
 *   - Take the first identifier of each remaining clause.
 */
function extractColumnNames(createTableSql: string): string[] {
  const stripped = createTableSql
    .replace(/--.*$/gm, '')
    .trim()
    .replace(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?\w+"?\s*\(/i, '')
    .replace(/\)\s*;?\s*$/, '');

  const clauses: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of stripped) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      clauses.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) clauses.push(buf);

  const names: string[] = [];
  for (const raw of clauses) {
    const clause = raw.trim();
    if (!clause) continue;
    if (
      /^(UNIQUE|CHECK|FOREIGN\s+KEY|PRIMARY\s+KEY|CONSTRAINT)\b/i.test(clause)
    )
      continue;
    const match = clause.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?/);
    if (match) names.push(match[1]);
  }
  return names;
}

describe('Postgres / SQLite schema parity', () => {
  const dualDialectTables = TABLES_IN_ORDER.filter(
    (t) => t.pg.trim() && t.sqlite.trim(),
  );

  it.each(dualDialectTables.map((t) => [t.name, t] as const))(
    '%s declares the same column set in both dialects',
    (_name, table) => {
      const pgCols = new Set(extractColumnNames(table.pg));
      const sqliteCols = new Set(extractColumnNames(table.sqlite));
      expect([...pgCols].sort()).toEqual([...sqliteCols].sort());
    },
  );

  it('declares at least one column in each dialect for every dual-dialect table', () => {
    for (const table of dualDialectTables) {
      expect(extractColumnNames(table.pg).length).toBeGreaterThan(0);
      expect(extractColumnNames(table.sqlite).length).toBeGreaterThan(0);
    }
  });

  describe('game_queue status v2 migration smoke', () => {
    it('emits the canonical status CHECK on Postgres', async () => {
      const sql: string[] = [];
      const stub: Database = {
        exec: async (s: string) => {
          sql.push(s);
        },
        run: async () => ({ changes: 0 }),
        get: async () => undefined,
        all: async () => [],
        transaction: async () => {
          throw new Error('not used in pg branch');
        },
      };
      await migration0001.up(stub, 'pg');
      const joined = sql.join('\n');
      expect(joined).toMatch(
        /ADD CONSTRAINT game_queue_status_check[\s\S]*CHECK \(status IN \('queued', 'called', 'arrived', 'on_table', 'scored'\)\)/i,
      );
    });
  });
});
