import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { openSqliteFile } from '../../../src/server/database/connection';
import { initializeSQLite } from '../../../src/server/database/init';
import {
  formatMigrateReportText,
  migrateScoresheetDatabase,
  MIGRATE_USAGE,
  parseMigrateArgs,
  resolveMigrateSource,
} from '../../../src/server/scoresheetAudit/migrate';
import { runMigrateCli } from '../../../src/server/scoresheetAudit/migrateCli';
import { DEFAULT_SQLITE_PATH } from '../../../src/server/scoresheetAudit/parseArgs';
import { createTestDb } from '../../sql/helpers/testDb';
import { seedScoresheetTemplate } from '../../http/helpers/seed';
import { canonicalSchema } from '../../helpers/canonicalSchema';

describe('parseMigrateArgs', () => {
  it('parses help, apply, sqlite, json, and out', () => {
    expect(parseMigrateArgs(['--help'])).toEqual({ ok: true, help: true });
    expect(
      parseMigrateArgs([
        '--sqlite',
        'dump.db',
        '--apply',
        '--json',
        '--out',
        'report.json',
      ]),
    ).toEqual({
      ok: true,
      help: false,
      sqlite: 'dump.db',
      databaseUrl: undefined,
      apply: true,
      json: true,
      out: 'report.json',
    });
  });

  it('rejects combining sqlite and database-url', () => {
    expect(
      parseMigrateArgs(['--sqlite', 'a.db', '--database-url', 'postgres://x']),
    ).toEqual({
      ok: false,
      error: 'Cannot combine --sqlite and --database-url',
    });
  });
});

describe('resolveMigrateSource', () => {
  const base = {
    ok: true as const,
    help: false as const,
    apply: false,
    json: false,
  };

  it('defaults to sqlite when no flags and no DATABASE_URL', () => {
    expect(resolveMigrateSource({ ...base }, {})).toEqual({
      ok: true,
      source: { kind: 'sqlite', path: DEFAULT_SQLITE_PATH },
    });
  });

  it('defaults to postgres when DATABASE_URL is set', () => {
    expect(
      resolveMigrateSource({ ...base }, { DATABASE_URL: 'postgres://x' }),
    ).toEqual({
      ok: true,
      source: { kind: 'postgres', url: 'postgres://x' },
    });
  });
});

describe('migrateScoresheetDatabase', () => {
  it('dry-run reports migrations without writing', async () => {
    const testDb = await createTestDb();
    try {
      const legacy = await seedScoresheetTemplate(testDb.db, {
        name: 'Legacy',
        schema: JSON.stringify({ title: 'Old', fields: [] }),
      });
      await seedScoresheetTemplate(testDb.db, {
        name: 'Canonical',
        schema: JSON.stringify(canonicalSchema()),
      });
      await testDb.db.run(
        `INSERT INTO scoresheet_templates (name, schema, access_code)
         VALUES (?, ?, ?)`,
        ['Broken', '{not-json', 'x'],
      );
      await testDb.db.run(
        `INSERT INTO scoresheet_field_templates (name, fields_json)
         VALUES (?, ?)`,
        [
          'Field Pack',
          JSON.stringify([{ id: 'poms', label: 'Poms', type: 'number' }]),
        ],
      );

      const report = await migrateScoresheetDatabase(testDb.db, {
        apply: false,
      });
      expect(report.apply).toBe(false);
      expect(report.summary.migrated).toBe(1);
      expect(report.summary.unchanged).toBe(2);
      expect(report.summary.skipped).toBe(1);

      const stored = await testDb.db.get<{ schema: string }>(
        'SELECT schema FROM scoresheet_templates WHERE id = ?',
        [legacy.id],
      );
      expect(JSON.parse(stored!.schema)).toEqual({ title: 'Old', fields: [] });

      const text = formatMigrateReportText(report);
      expect(text).toContain('dry-run');
      expect(text).toContain('add-schema-version');
    } finally {
      testDb.close();
    }
  });

  it('apply writes canonical JSON and is idempotent', async () => {
    const testDb = await createTestDb();
    try {
      const legacy = await seedScoresheetTemplate(testDb.db, {
        name: 'Legacy',
        schema: JSON.stringify({
          fields: [],
          bracketSource: true,
        }),
      });

      const first = await migrateScoresheetDatabase(testDb.db, { apply: true });
      expect(first.summary.migrated).toBe(1);
      const stored = await testDb.db.get<{ schema: string }>(
        'SELECT schema FROM scoresheet_templates WHERE id = ?',
        [legacy.id],
      );
      expect(JSON.parse(stored!.schema)).toEqual({
        schemaVersion: 1,
        fields: [],
        bracketSource: { type: 'db' },
      });

      const second = await migrateScoresheetDatabase(testDb.db, {
        apply: true,
      });
      expect(second.summary.migrated).toBe(0);
      expect(second.summary.unchanged).toBe(1);
    } finally {
      testDb.close();
    }
  });
});

describe('runMigrateCli', () => {
  it('prints usage for --help', async () => {
    let stdout = '';
    const code = await runMigrateCli(['--help'], {
      stdout: {
        write: (chunk) => {
          stdout += chunk;
        },
      },
      stderr: { write: () => undefined },
      env: {},
    });
    expect(code).toBe(0);
    expect(stdout).toBe(MIGRATE_USAGE);
  });

  it('migrates a sqlite file with --apply', async () => {
    const filePath = path.join(
      os.tmpdir(),
      `colosseum-migrate-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    const opened = openSqliteFile(filePath);
    try {
      await initializeSQLite(opened.db);
      await opened.db.run(
        `INSERT INTO scoresheet_templates (name, schema, access_code)
         VALUES (?, ?, ?)`,
        ['Legacy', JSON.stringify({ fields: [] }), 'code'],
      );
    } finally {
      opened.close();
    }

    try {
      let stdout = '';
      const code = await runMigrateCli(
        ['--sqlite', filePath, '--apply', '--json'],
        {
          stdout: {
            write: (chunk) => {
              stdout += chunk;
            },
          },
          stderr: { write: () => undefined },
          env: {},
        },
      );
      expect(code).toBe(0);
      const report = JSON.parse(stdout) as {
        apply: boolean;
        summary: { migrated: number };
      };
      expect(report.apply).toBe(true);
      expect(report.summary.migrated).toBe(1);

      const verify = openSqliteFile(filePath, { readonly: true });
      try {
        const row = await verify.db.get<{ schema: string }>(
          'SELECT schema FROM scoresheet_templates WHERE name = ?',
          ['Legacy'],
        );
        expect(JSON.parse(row!.schema).schemaVersion).toBe(1);
      } finally {
        verify.close();
      }
    } finally {
      fs.unlinkSync(filePath);
    }
  });
});
