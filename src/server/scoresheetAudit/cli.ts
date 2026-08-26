import fs from 'fs/promises';
import { Pool } from 'pg';
import {
  createPostgresDatabase,
  openSqliteFile,
  type Database,
} from '../database/connection';
import {
  AUDIT_USAGE,
  parseAuditArgs,
  resolveAuditSources,
  type AuditSource,
} from './parseArgs';
import { formatAuditReportText, type AuditReport } from './report';
import { runScoresheetAudit } from './runAudit';

export interface AuditCliIo {
  stdout: { write: (chunk: string) => unknown };
  stderr: { write: (chunk: string) => unknown };
  env: NodeJS.ProcessEnv;
  writeFile?: (filePath: string, contents: string) => Promise<void>;
}

const defaultIo: AuditCliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
};

interface OpenedDatabase {
  db: Database;
  close: () => Promise<void>;
}

export function openSqliteAuditConnection(filePath: string): OpenedDatabase {
  const opened = openSqliteFile(filePath, { readonly: true });
  return {
    db: opened.db,
    close: async () => {
      opened.close();
    },
  };
}

export function openPostgresAuditConnection(
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

function openSource(source: AuditSource): OpenedDatabase | null {
  if (source.kind === 'sqlite') {
    return openSqliteAuditConnection(source.path);
  }
  if (source.kind === 'postgres') {
    return openPostgresAuditConnection(source.url);
  }
  return null;
}

function renderReport(report: AuditReport, asJson: boolean): string {
  return asJson
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatAuditReportText(report);
}

export async function runAuditCli(
  argv: string[],
  io: AuditCliIo = defaultIo,
): Promise<number> {
  const parsed = parseAuditArgs(argv);
  if (!parsed.ok) {
    io.stderr.write(`${parsed.error}\n\n${AUDIT_USAGE}`);
    return 1;
  }
  if (parsed.help) {
    io.stdout.write(AUDIT_USAGE);
    return 0;
  }

  const resolved = resolveAuditSources(parsed, io.env);
  if (!resolved.ok) {
    io.stderr.write(`${resolved.error}\n\n${AUDIT_USAGE}`);
    return 1;
  }

  const fixtures = resolved.sources.find(
    (source) => source.kind === 'fixtures',
  );
  const dbSource = resolved.sources.find(
    (source) => source.kind === 'sqlite' || source.kind === 'postgres',
  );

  let opened: OpenedDatabase | null = null;
  try {
    if (dbSource) {
      opened = openSource(dbSource);
    }

    const report = await runScoresheetAudit({
      db: opened?.db,
      fixtures: fixtures?.path,
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
