import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import * as document from '../../src/shared/scoresheetDocument';
import * as schema from '../../src/shared/scoresheetSchema';

const CLIENT_DIR = path.join(__dirname, '../../src/client');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

function clientSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return clientSourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('scoresheetDocument module boundary', () => {
  it('does not import zod', () => {
    const source = readSource('src/shared/scoresheetDocument.ts');
    expect(source).not.toMatch(/from 'zod'/);
    expect(source).not.toMatch(/require\('zod'\)/);
  });

  it('imports from scoresheetSchema only as erasable types', () => {
    const source = readSource('src/shared/scoresheetDocument.ts');
    const schemaImports = source.match(/^import .*scoresheetSchema';$/gm) ?? [];
    expect(schemaImports.length).toBeGreaterThan(0);
    for (const line of schemaImports) {
      expect(line.startsWith('import type ')).toBe(true);
    }
  });

  it('re-exports the same helper identities from scoresheetSchema', () => {
    // Server and script callers still import these from scoresheetSchema. A
    // divergent local copy would drift from the client's behavior.
    expect(schema.getFieldDefaultValue).toBe(document.getFieldDefaultValue);
    expect(schema.getBlankFieldValue).toBe(document.getBlankFieldValue);
    expect(schema.isRepeatableGroupField).toBe(document.isRepeatableGroupField);
    expect(schema.isScoresheetValue).toBe(document.isScoresheetValue);
    expect(schema.isPlainObject).toBe(document.isPlainObject);
    expect(schema.discriminateShape).toBe(document.discriminateShape);
    expect(schema.formatSchemaValidationError).toBe(
      document.formatSchemaValidationError,
    );
    expect(schema.SCORESHEET_SCHEMA_VERSION).toBe(
      document.SCORESHEET_SCHEMA_VERSION,
    );
  });
});

describe('client Zod isolation', () => {
  it('never value-imports zod or the Zod-based shared modules', () => {
    const offenders: string[] = [];

    for (const file of clientSourceFiles(CLIENT_DIR)) {
      const source = fs.readFileSync(file, 'utf8');
      const relative = path.relative(path.join(__dirname, '../..'), file);

      for (const line of source.split('\n')) {
        const match = line.match(
          /^import\s+(type\s+)?(.*?)from\s+'([^']+)'/,
        ) as [string, string | undefined, string, string] | null;
        if (!match) continue;

        const [, typeOnlyKeyword, clause, specifier] = match;
        const isRestricted =
          specifier === 'zod' ||
          specifier.startsWith('zod/') ||
          /(shared\/scoresheetSchema|shared\/validationPrimitives|server\/validation\/)/.test(
            specifier,
          );
        if (!isRestricted) continue;

        if (typeOnlyKeyword) continue;
        // A value import brings the Zod runtime into the bundle. Inline `type`
        // specifiers on every binding are erased, so those are allowed.
        const bindings = clause
          .replace(/[{}]/g, '')
          .split(',')
          .map((binding) => binding.trim())
          .filter(Boolean);
        const hasValueBinding =
          bindings.length === 0 ||
          bindings.some((binding) => !binding.startsWith('type '));
        if (hasValueBinding) {
          offenders.push(`${relative}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
