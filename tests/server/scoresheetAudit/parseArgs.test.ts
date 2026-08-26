import { describe, expect, it } from 'vitest';
import {
  AUDIT_USAGE,
  DEFAULT_SQLITE_PATH,
  parseAuditArgs,
  resolveAuditSources,
} from '../../../src/server/scoresheetAudit/parseArgs';
import { runAuditCli } from '../../../src/server/scoresheetAudit/cli';

describe('parseAuditArgs', () => {
  it('parses help', () => {
    expect(parseAuditArgs(['--help'])).toEqual({ ok: true, help: true });
    expect(parseAuditArgs(['-h'])).toEqual({ ok: true, help: true });
  });

  it('parses sqlite, fixtures, json, and out', () => {
    expect(
      parseAuditArgs([
        '--sqlite',
        'dump.db',
        '--fixtures',
        'templates',
        '--json',
        '--out',
        'report.json',
      ]),
    ).toEqual({
      ok: true,
      help: false,
      sqlite: 'dump.db',
      databaseUrl: undefined,
      fixtures: 'templates',
      json: true,
      out: 'report.json',
    });
  });

  it('rejects combining sqlite and database-url', () => {
    expect(
      parseAuditArgs(['--sqlite', 'a.db', '--database-url', 'postgres://x']),
    ).toEqual({
      ok: false,
      error: 'Cannot combine --sqlite and --database-url',
    });
  });

  it('rejects missing flag values and unknown arguments', () => {
    expect(parseAuditArgs(['--sqlite'])).toEqual({
      ok: false,
      error: '--sqlite requires a value',
    });
    expect(parseAuditArgs(['--nope'])).toEqual({
      ok: false,
      error: 'Unknown argument: --nope',
    });
  });
});

describe('resolveAuditSources', () => {
  const base = {
    ok: true as const,
    help: false as const,
    json: false,
  };

  it('defaults to sqlite when no flags and no DATABASE_URL', () => {
    expect(resolveAuditSources({ ...base }, {})).toEqual({
      ok: true,
      sources: [{ kind: 'sqlite', path: DEFAULT_SQLITE_PATH }],
    });
  });

  it('defaults to postgres when DATABASE_URL is set', () => {
    expect(
      resolveAuditSources({ ...base }, { DATABASE_URL: 'postgres://x' }),
    ).toEqual({
      ok: true,
      sources: [{ kind: 'postgres', url: 'postgres://x' }],
    });
  });

  it('skips the database when only --fixtures is set', () => {
    expect(
      resolveAuditSources(
        { ...base, fixtures: 'templates' },
        { DATABASE_URL: 'postgres://x' },
      ),
    ).toEqual({
      ok: true,
      sources: [{ kind: 'fixtures', path: 'templates' }],
    });
  });

  it('combines explicit sqlite with fixtures', () => {
    expect(
      resolveAuditSources(
        { ...base, fixtures: 'templates', sqlite: 'dump.db' },
        {},
      ),
    ).toEqual({
      ok: true,
      sources: [
        { kind: 'fixtures', path: 'templates' },
        { kind: 'sqlite', path: 'dump.db' },
      ],
    });
  });
});

describe('runAuditCli', () => {
  it('prints usage for --help', async () => {
    let stdout = '';
    const code = await runAuditCli(['--help'], {
      stdout: {
        write: (chunk) => {
          stdout += chunk;
        },
      },
      stderr: { write: () => undefined },
      env: {},
    });
    expect(code).toBe(0);
    expect(stdout).toBe(AUDIT_USAGE);
  });

  it('returns 1 for invalid arguments', async () => {
    let stderr = '';
    const code = await runAuditCli(['--sqlite'], {
      stdout: { write: () => undefined },
      stderr: {
        write: (chunk) => {
          stderr += chunk;
        },
      },
      env: {},
    });
    expect(code).toBe(1);
    expect(stderr).toContain('--sqlite requires a value');
  });

  it('audits fixtures and supports --json and --out', async () => {
    let stdout = '';
    const files: Record<string, string> = {};
    const code = await runAuditCli(
      ['--fixtures', 'templates', '--json', '--out', 'report.json'],
      {
        stdout: {
          write: (chunk) => {
            stdout += chunk;
          },
        },
        stderr: { write: () => undefined },
        env: {},
        writeFile: async (filePath, contents) => {
          files[filePath] = contents;
        },
      },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { summary: { rowCount: number } };
    expect(parsed.summary.rowCount).toBe(9);
    expect(files['report.json']).toBe(stdout);
  });
});
