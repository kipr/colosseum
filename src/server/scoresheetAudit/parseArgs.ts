export const DEFAULT_SQLITE_PATH = 'database/colosseum.db';

export const AUDIT_USAGE = `Usage: npm run audit:scoresheets -- [options]

Read-only inventory of scoresheet_templates and scoresheet_field_templates.
Does not write to the database.

Options:
  --sqlite <path>         Open a SQLite file read-only
  --database-url <url>    PostgreSQL connection string
  --fixtures <dir|file>   Audit JSON templates without a database
  --json                  Print the full report as JSON
  --out <file>            Write the report to a file
  --help                  Show this help

If no connection flags are given, uses DATABASE_URL when set, otherwise
${DEFAULT_SQLITE_PATH}. --fixtures without a connection flag skips the database.
`;

export type AuditCliArgs =
  | { ok: true; help: true }
  | {
      ok: true;
      help: false;
      sqlite?: string;
      databaseUrl?: string;
      fixtures?: string;
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

export function parseAuditArgs(argv: string[]): AuditCliArgs {
  let sqlite: string | undefined;
  let databaseUrl: string | undefined;
  let fixtures: string | undefined;
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
    if (arg === '--fixtures') {
      const taken = takeValue('--fixtures', argv, i);
      if (!taken.ok) return taken;
      fixtures = taken.value;
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
    fixtures,
    json,
    out,
  };
}

export type AuditSource =
  | { kind: 'sqlite'; path: string }
  | { kind: 'postgres'; url: string }
  | { kind: 'fixtures'; path: string };

export function resolveAuditSources(
  args: Extract<AuditCliArgs, { ok: true; help: false }>,
  env: NodeJS.ProcessEnv,
): { ok: true; sources: AuditSource[] } | { ok: false; error: string } {
  const sources: AuditSource[] = [];

  if (args.fixtures) {
    sources.push({ kind: 'fixtures', path: args.fixtures });
  }

  if (args.sqlite) {
    sources.push({ kind: 'sqlite', path: args.sqlite });
  } else if (args.databaseUrl) {
    sources.push({ kind: 'postgres', url: args.databaseUrl });
  } else if (!args.fixtures) {
    if (env.DATABASE_URL) {
      sources.push({ kind: 'postgres', url: env.DATABASE_URL });
    } else {
      sources.push({ kind: 'sqlite', path: DEFAULT_SQLITE_PATH });
    }
  }

  if (sources.length === 0) {
    return { ok: false, error: 'No audit source specified' };
  }

  return { ok: true, sources };
}
