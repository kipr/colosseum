import {
  normalizeLegacyScoresheetFields,
  normalizeLegacyScoresheetSchema,
  parseNormalizedScoresheetFields,
  parseNormalizedScoresheetSchema,
} from '../../shared/scoresheetNormalize';
import type { Database } from '../database/connection';
import { DEFAULT_SQLITE_PATH } from './parseArgs';
import type { DocumentKind } from './report';

export const MIGRATE_USAGE = `Usage: npm run migrate:scoresheets -- [options]

Normalize stored scoresheet_templates and scoresheet_field_templates to the
canonical schema. Dry-run by default; pass --apply to write.

Options:
  --sqlite <path>         Open a SQLite file (read-write when --apply)
  --database-url <url>    PostgreSQL connection string
  --apply                 Write canonical JSON for rows that parse after normalize
  --json                  Print the full report as JSON
  --out <file>            Write the report to a file
  --help                  Show this help

If no connection flags are given, uses DATABASE_URL when set, otherwise
${DEFAULT_SQLITE_PATH}.
`;

export type MigrateCliArgs =
  | { ok: true; help: true }
  | {
      ok: true;
      help: false;
      sqlite?: string;
      databaseUrl?: string;
      apply: boolean;
      json: boolean;
      out?: string;
    }
  | { ok: false; error: string };

function takeValue(
  flag: string,
  argv: string[],
  index: number,
): { ok: true; value: string; next: number } | { ok: false; error: string } {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    return { ok: false, error: `${flag} requires a value` };
  }
  return { ok: true, value, next: index + 1 };
}

export function parseMigrateArgs(argv: string[]): MigrateCliArgs {
  let sqlite: string | undefined;
  let databaseUrl: string | undefined;
  let apply = false;
  let json = false;
  let out: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--sqlite') {
      const taken = takeValue('--sqlite', argv, i);
      if (!taken.ok) return taken;
      sqlite = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--database-url') {
      const taken = takeValue('--database-url', argv, i);
      if (!taken.ok) return taken;
      databaseUrl = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--out') {
      const taken = takeValue('--out', argv, i);
      if (!taken.ok) return taken;
      out = taken.value;
      i = taken.next;
      continue;
    }
    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  if (help) {
    return { ok: true, help: true };
  }

  if (sqlite && databaseUrl) {
    return {
      ok: false,
      error: 'Cannot combine --sqlite and --database-url',
    };
  }

  return {
    ok: true,
    help: false,
    sqlite,
    databaseUrl,
    apply,
    json,
    out,
  };
}

export type MigrateSource =
  | { kind: 'sqlite'; path: string }
  | { kind: 'postgres'; url: string };

export function resolveMigrateSource(
  args: Extract<MigrateCliArgs, { ok: true; help: false }>,
  env: NodeJS.ProcessEnv,
): { ok: true; source: MigrateSource } | { ok: false; error: string } {
  if (args.sqlite) {
    return { ok: true, source: { kind: 'sqlite', path: args.sqlite } };
  }
  if (args.databaseUrl) {
    return { ok: true, source: { kind: 'postgres', url: args.databaseUrl } };
  }
  if (env.DATABASE_URL) {
    return { ok: true, source: { kind: 'postgres', url: env.DATABASE_URL } };
  }
  return { ok: true, source: { kind: 'sqlite', path: DEFAULT_SQLITE_PATH } };
}

export type MigrateRowStatus = 'migrated' | 'unchanged' | 'skipped';

export interface MigrateRowResult {
  kind: DocumentKind;
  id: number;
  name: string;
  status: MigrateRowStatus;
  migrations: string[];
  reason?: string;
}

export interface MigrateReport {
  apply: boolean;
  summary: {
    rowCount: number;
    migrated: number;
    unchanged: number;
    skipped: number;
  };
  rows: MigrateRowResult[];
}

interface PlannedWrite {
  kind: DocumentKind;
  id: number;
  json: string;
}

function parseStoredJson(
  text: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: 'Document JSON is empty.' };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid JSON.',
    };
  }
}

function planScoresheetMigration(jsonText: unknown): {
  result: Omit<MigrateRowResult, 'kind' | 'id' | 'name'>;
  writeJson?: string;
} {
  const parsed = parseStoredJson(jsonText);
  if (!parsed.ok) {
    return {
      result: { status: 'skipped', migrations: [], reason: parsed.error },
    };
  }

  const normalized = normalizeLegacyScoresheetSchema(parsed.value);
  const schema = parseNormalizedScoresheetSchema(parsed.value);
  if (!schema.success) {
    return {
      result: {
        status: 'skipped',
        migrations: normalized.migrations,
        reason: 'Normalized document still fails canonical parse.',
      },
    };
  }
  if (normalized.migrations.length === 0) {
    return { result: { status: 'unchanged', migrations: [] } };
  }
  return {
    result: { status: 'migrated', migrations: normalized.migrations },
    writeJson: JSON.stringify(schema.data),
  };
}

function planFieldMigration(jsonText: unknown): {
  result: Omit<MigrateRowResult, 'kind' | 'id' | 'name'>;
  writeJson?: string;
} {
  const parsed = parseStoredJson(jsonText);
  if (!parsed.ok) {
    return {
      result: { status: 'skipped', migrations: [], reason: parsed.error },
    };
  }

  const normalized = normalizeLegacyScoresheetFields(parsed.value);
  const fields = parseNormalizedScoresheetFields(parsed.value);
  if (!fields.success) {
    return {
      result: {
        status: 'skipped',
        migrations: normalized.migrations,
        reason: 'Normalized document still fails canonical parse.',
      },
    };
  }
  if (normalized.migrations.length === 0) {
    return { result: { status: 'unchanged', migrations: [] } };
  }
  return {
    result: { status: 'migrated', migrations: normalized.migrations },
    writeJson: JSON.stringify(fields.data),
  };
}

export async function migrateScoresheetDatabase(
  db: Database,
  options: { apply: boolean },
): Promise<MigrateReport> {
  const templates = await db.all<{ id: number; name: string; schema: unknown }>(
    'SELECT id, name, schema FROM scoresheet_templates ORDER BY id',
  );
  const fieldTemplates = await db.all<{
    id: number;
    name: string;
    fields_json: unknown;
  }>(
    'SELECT id, name, fields_json FROM scoresheet_field_templates ORDER BY id',
  );

  const rows: MigrateRowResult[] = [];
  const writes: PlannedWrite[] = [];

  for (const template of templates) {
    const planned = planScoresheetMigration(template.schema);
    rows.push({
      kind: 'scoresheet_template',
      id: template.id,
      name: template.name,
      ...planned.result,
    });
    if (planned.result.status === 'migrated' && planned.writeJson) {
      writes.push({
        kind: 'scoresheet_template',
        id: template.id,
        json: planned.writeJson,
      });
    }
  }

  for (const template of fieldTemplates) {
    const planned = planFieldMigration(template.fields_json);
    rows.push({
      kind: 'field_template',
      id: template.id,
      name: template.name,
      ...planned.result,
    });
    if (planned.result.status === 'migrated' && planned.writeJson) {
      writes.push({
        kind: 'field_template',
        id: template.id,
        json: planned.writeJson,
      });
    }
  }

  if (options.apply && writes.length > 0) {
    await db.transaction(async (tx) => {
      for (const write of writes) {
        if (write.kind === 'scoresheet_template') {
          await tx.run(
            `UPDATE scoresheet_templates
             SET schema = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [write.json, write.id],
          );
        } else {
          await tx.run(
            `UPDATE scoresheet_field_templates
             SET fields_json = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [write.json, write.id],
          );
        }
      }
    });
  }

  return {
    apply: options.apply,
    summary: {
      rowCount: rows.length,
      migrated: rows.filter((row) => row.status === 'migrated').length,
      unchanged: rows.filter((row) => row.status === 'unchanged').length,
      skipped: rows.filter((row) => row.status === 'skipped').length,
    },
    rows,
  };
}

function formatCount(label: string, count: number): string {
  return `${label}: ${count}`;
}

export function formatMigrateReportText(report: MigrateReport): string {
  const mode = report.apply ? 'apply' : 'dry-run';
  const lines: string[] = [
    `Scoresheet template migration (${mode})`,
    '======================================',
    formatCount('Rows', report.summary.rowCount),
    formatCount('Migrated', report.summary.migrated),
    formatCount('Unchanged', report.summary.unchanged),
    formatCount('Skipped', report.summary.skipped),
  ];

  if (report.rows.length === 0) {
    lines.push('', '(no rows)', '');
    return lines.join('\n');
  }

  lines.push('', 'Rows', '----');
  for (const row of report.rows) {
    lines.push(
      '',
      `[${row.kind}] ${row.name} (id=${row.id}, status=${row.status})`,
    );
    if (row.migrations.length > 0) {
      lines.push(`  migrations: ${row.migrations.join(', ')}`);
    }
    if (row.reason) {
      lines.push(`  reason: ${row.reason}`);
    }
    if (row.status === 'migrated' && !report.apply) {
      lines.push('  would write canonical JSON');
    }
  }
  lines.push('');
  return lines.join('\n');
}
