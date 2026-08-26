import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  MIGRATION_ADD_SCHEMA_VERSION,
  MIGRATION_NORMALIZE_BRACKET_SOURCE_TRUE,
  MIGRATION_UNWRAP_WRAPPER,
  normalizeLegacyScoresheetFields,
  normalizeLegacyScoresheetSchema,
  parseNormalizedScoresheetFields,
  parseNormalizedScoresheetSchema,
} from '../../src/shared/scoresheetNormalize';
import {
  discriminateShape,
  SCORESHEET_SCHEMA_VERSION,
} from '../../src/shared/scoresheetSchema';
import { canonicalSchema } from '../helpers/canonicalSchema';

const TEMPLATES_DIR = path.join(__dirname, '../../templates');

function templateFiles(): string[] {
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function readTemplate(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8'));
}

describe('normalizeLegacyScoresheetSchema', () => {
  it('is a no-op for a canonical schema', () => {
    const input = canonicalSchema({ title: 'Keep' });
    const result = normalizeLegacyScoresheetSchema(input);
    expect(result.migrations).toEqual([]);
    expect(result.value).toEqual(input);
    expect(input).toEqual(canonicalSchema({ title: 'Keep' }));
  });

  it('adds schemaVersion to unversioned schema objects', () => {
    const input = { title: 'Legacy', fields: [] };
    const result = normalizeLegacyScoresheetSchema(input);
    expect(result.migrations).toEqual([MIGRATION_ADD_SCHEMA_VERSION]);
    expect(result.value).toEqual({
      title: 'Legacy',
      fields: [],
      schemaVersion: SCORESHEET_SCHEMA_VERSION,
    });
    expect(input).toEqual({ title: 'Legacy', fields: [] });
  });

  it('normalizes bracketSource: true on unversioned documents', () => {
    const result = normalizeLegacyScoresheetSchema({
      fields: [],
      bracketSource: true,
    });
    expect(result.migrations).toEqual([
      MIGRATION_ADD_SCHEMA_VERSION,
      MIGRATION_NORMALIZE_BRACKET_SOURCE_TRUE,
    ]);
    expect(result.value).toEqual({
      fields: [],
      schemaVersion: SCORESHEET_SCHEMA_VERSION,
      bracketSource: { type: 'db' },
    });
  });

  it('does not rewrite bracketSource: true on version-1 documents', () => {
    const input = canonicalSchema({ bracketSource: true });
    const result = normalizeLegacyScoresheetSchema(input);
    expect(result.migrations).toEqual([]);
    expect(result.value).toEqual(input);
  });

  it('unwraps wrapper documents before other migrations', () => {
    const result = normalizeLegacyScoresheetSchema({
      name: 'Wrapped',
      description: 'legacy',
      schema: { fields: [], title: 'Inner' },
    });
    expect(result.migrations).toEqual([
      MIGRATION_UNWRAP_WRAPPER,
      MIGRATION_ADD_SCHEMA_VERSION,
    ]);
    expect(result.value).toEqual({
      fields: [],
      title: 'Inner',
      schemaVersion: SCORESHEET_SCHEMA_VERSION,
    });
  });

  it('unwraps a version-1 wrapper without adding schemaVersion again', () => {
    const inner = canonicalSchema({ title: 'Inner' });
    const result = normalizeLegacyScoresheetSchema({
      name: 'Wrapped',
      schema: inner,
    });
    expect(result.migrations).toEqual([MIGRATION_UNWRAP_WRAPPER]);
    expect(result.value).toEqual(inner);
  });
});

describe('parseNormalizedScoresheetSchema', () => {
  it('parses unversioned and boolean-bracketSource documents', () => {
    const unversioned = parseNormalizedScoresheetSchema({ fields: [] });
    expect(unversioned.success).toBe(true);
    if (unversioned.success) {
      expect(unversioned.data.schemaVersion).toBe(SCORESHEET_SCHEMA_VERSION);
      expect(unversioned.data.fields).toEqual([]);
    }

    const bracketTrue = parseNormalizedScoresheetSchema({
      fields: [],
      bracketSource: true,
    });
    expect(bracketTrue.success).toBe(true);
    if (bracketTrue.success) {
      expect(bracketTrue.data.bracketSource).toEqual({ type: 'db' });
    }
  });

  it('still rejects structurally invalid documents after normalization', () => {
    expect(
      parseNormalizedScoresheetSchema({ mode: 'head-to-head' }).success,
    ).toBe(false);
    expect(
      parseNormalizedScoresheetSchema(
        canonicalSchema({
          fields: [
            { id: 'score', label: 'Score', type: 'number', min: 5, max: 1 },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('parses every checked-in full schema or wrapper template', () => {
    for (const name of templateFiles()) {
      const parsed = readTemplate(name);
      const shape = discriminateShape(parsed);
      if (shape === 'bare_field_array') {
        const result = parseNormalizedScoresheetFields(parsed);
        expect(result.success, name).toBe(true);
        continue;
      }
      const result = parseNormalizedScoresheetSchema(parsed);
      expect(
        result.success,
        `${name}: ${JSON.stringify(result.success ? [] : result.error.issues)}`,
      ).toBe(true);
    }
  });
});

describe('normalizeLegacyScoresheetFields', () => {
  it('clones field arrays without rewriting them', () => {
    const input = [{ id: 'score', label: 'Score', type: 'number' }];
    const result = normalizeLegacyScoresheetFields(input);
    expect(result.migrations).toEqual([]);
    expect(result.value).toEqual(input);
    expect(result.value).not.toBe(input);
  });
});
