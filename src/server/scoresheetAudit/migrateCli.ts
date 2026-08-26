import fs from 'fs/promises';
import { Pool } from 'pg';
import {
  createPostgresDatabase,
  openSqliteFile,
  type Database,
} from '../database/connection';
import {
  formatMigrateReportText,
  migrateScoresheetDatabase,
  MIGRATE_USAGE,
  parseMigrateArgs,
  resolveMigrateSource,
  type MigrateReport,
  type MigrateSource,
} from './migrate';

export interface MigrateCliIo {
  stdout: { write: (chunk: string) => unknown };
  stderr: { write: (chunk: string) => unknown };
  env: NodeJS.ProcessEnv;
  writeFile?: (filePath: string, contents: string) => Promise<void>;
}

const defaultIo: MigrateCliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
};

interface OpenedDatabase {
  db: Database;
  close: () => Promise<void>;
}

export function openSqliteMigrateConnection(
  filePath: string,
  apply: boolean,
): OpenedDatabase {
  const opened = openSqliteFile(filePath, { readonly: !apply });
  return {
    db: opened.db,
    close: async () => {
      opened.close();
    },
  };
}

export function openPostgresMigrateConnection(
  databaseUrl: string,
): OpenedDatabase {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    db: createPostgresDatabase(pool),
    close: async () => {
      await pool.end();
    },
  };
}

function openSource(source: MigrateSource, apply: boolean): OpenedDatabase {
  if (source.kind === 'sqlite') {
    return openSqliteMigrateConnection(source.path, apply);
  }
  return openPostgresMigrateConnection(source.url);
}

function renderReport(report: MigrateReport, asJson: boolean): string {
  return asJson
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatMigrateReportText(report);
}

export async function runMigrateCli(
  argv: string[],
  io: MigrateCliIo = defaultIo,
): Promise<number> {
  const parsed = parseMigrateArgs(argv);
  if (!parsed.ok) {
    io.stderr.write(`${parsed.error}\n\n${MIGRATE_USAGE}`);
    return 1;
  }
  if (parsed.help) {
    io.stdout.write(MIGRATE_USAGE);
    return 0;
  }

  const resolved = resolveMigrateSource(parsed, io.env);
  if (!resolved.ok) {
    io.stderr.write(`${resolved.error}\n\n${MIGRATE_USAGE}`);
    return 1;
  }

  let opened: OpenedDatabase | null = null;
  try {
    opened = openSource(resolved.source, parsed.apply);
    const report = await migrateScoresheetDatabase(opened.db, {
      apply: parsed.apply,
    });
    const rendered = renderReport(report, parsed.json);

    if (parsed.out) {
      const writeFile = io.writeFile ?? fs.writeFile;
      await writeFile(parsed.out, rendered);
    }
    io.stdout.write(rendered);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n`);
    return 1;
  } finally {
    if (opened) {
      await opened.close();
    }
  }
}
