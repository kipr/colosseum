/**
 * Pure transformer tests for the scoresheet `kind` migration.
 */
import { describe, expect, it } from 'vitest';
import {
  transformScoresheetKind,
  type TransformScoresheetKindInput,
} from '../../../../src/server/database/migrations/scoresheetKind';

function transform(
  schema: unknown,
  linkedTemplateTypes: string[] = [],
  extras: Partial<TransformScoresheetKindInput> = {},
) {
  return transformScoresheetKind({
    id: extras.id ?? 7,
    name: extras.name ?? 'Example Template',
    schemaText:
      extras.schemaText ??
      (typeof schema === 'string' ? schema : JSON.stringify(schema)),
    linkedTemplateTypes,
  });
}

describe('transformScoresheetKind', () => {
  it('maps all three legacy archetypes', () => {
    const seeding = transform({ title: 'Seed', fields: [] });
    expect(seeding.ok).toBe(true);
    if (!seeding.ok) return;
    expect(seeding.kind).toBe('seeding');
    expect(seeding.changed).toBe(true);
    expect(JSON.parse(seeding.schemaText)).toEqual({
      title: 'Seed',
      fields: [],
      kind: 'seeding',
    });

    const bracket = transform({
      mode: 'head-to-head',
      bracketSource: { type: 'db', eventId: 3 },
      fields: [],
    });
    expect(bracket.ok).toBe(true);
    if (!bracket.ok) return;
    expect(bracket.kind).toBe('bracket');
    expect(JSON.parse(bracket.schemaText).mode).toBeUndefined();
    expect(JSON.parse(bracket.schemaText).kind).toBe('bracket');

    const doubleSeeding = transform({
      scoreKind: 'double_seeding',
      fields: [],
    });
    expect(doubleSeeding.ok).toBe(true);
    if (!doubleSeeding.ok) return;
    expect(doubleSeeding.kind).toBe('double_seeding');
    expect(JSON.parse(doubleSeeding.schemaText).scoreKind).toBeUndefined();
    expect(JSON.parse(doubleSeeding.schemaText).kind).toBe('double_seeding');
  });

  it('infers bracket from bracketSource when no explicit marker exists', () => {
    const result = transform({
      bracketSource: { type: 'db', scope: 'event', eventId: 11 },
      fields: [{ id: 'game_number' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('bracket');
    expect(result.currentArchetype).toBe('legacy:bracketSource');
  });

  it('leaves already-canonical input unchanged, including a second pass', () => {
    const canonical = JSON.stringify({
      kind: 'seeding',
      title: 'Canonical',
      fields: [{ id: 'a', nested: { keep: true } }],
    });
    const first = transform(canonical);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.changed).toBe(false);
    expect(first.schemaText).toBe(canonical);

    const second = transform(first.schemaText);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changed).toBe(false);
    expect(second.schemaText).toBe(canonical);
  });

  it('removes legacy keys while preserving unrelated nested values', () => {
    const result = transform({
      mode: 'head-to-head',
      title: 'Keep me',
      nested: { a: 1, b: [true, { c: 'x' }] },
      fields: [{ id: 'score', extra: { keep: 1 } }],
      bracketSource: { type: 'db', eventId: 9, extraFlag: true },
      teamsDataSource: { type: 'db', eventId: 9 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.schemaText)).toEqual({
      title: 'Keep me',
      nested: { a: 1, b: [true, { c: 'x' }] },
      fields: [{ id: 'score', extra: { keep: 1 } }],
      bracketSource: { type: 'db', eventId: 9, extraFlag: true },
      teamsDataSource: { type: 'db', eventId: 9 },
      kind: 'bracket',
    });
  });

  it('rejects malformed JSON and non-object JSON', () => {
    const malformed = transform(null, [], { schemaText: '{' });
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.diagnostic).toContain('id=7');
    expect(malformed.diagnostic).toContain('Example Template');
    expect(malformed.diagnostic).toContain('malformed JSON');

    for (const value of ['[]', 'null', '"x"', '12']) {
      const result = transform(value);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.diagnostic).toContain('must be an object');
    }
  });

  it('rejects unsupported spellings and unsupported old marker values', () => {
    expect(transform({ kind: 'head-to-head', fields: [] }).ok).toBe(false);
    expect(transform({ kind: 'double-seeding', fields: [] }).ok).toBe(false);
    expect(transform({ mode: 'double-elimination', fields: [] }).ok).toBe(
      false,
    );
    expect(transform({ scoreKind: 'seeding', fields: [] }).ok).toBe(false);
    expect(transform({ kind: 'bracket', fields: [] }).ok).toBe(false);
  });

  it('rejects simultaneous old markers and conflicting canonical/legacy signals', () => {
    const bothLegacy = transform({
      mode: 'head-to-head',
      scoreKind: 'double_seeding',
      bracketSource: { type: 'db' },
    });
    expect(bothLegacy.ok).toBe(false);
    if (!bothLegacy.ok) {
      expect(bothLegacy.diagnostic).toContain('both legacy properties');
    }

    const conflict = transform({
      kind: 'seeding',
      mode: 'head-to-head',
      bracketSource: { type: 'db' },
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.diagnostic).toContain('conflicting');
    }
  });

  it('accepts agreeing canonical and legacy signals and strips the legacy key', () => {
    const result = transform({
      kind: 'bracket',
      mode: 'head-to-head',
      bracketSource: { type: 'db', bracketId: 4 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(result.schemaText);
    expect(parsed.kind).toBe('bracket');
    expect(parsed.mode).toBeUndefined();
  });

  it('rejects missing or invalid bracket sources and variant-incompatible sources', () => {
    expect(transform({ mode: 'head-to-head', fields: [] }).ok).toBe(false);
    expect(
      transform({
        kind: 'bracket',
        bracketSource: { sheetName: 'DE 16 Team' },
      }).ok,
    ).toBe(false);
    expect(
      transform({
        kind: 'seeding',
        bracketSource: { type: 'db' },
      }).ok,
    ).toBe(false);
    expect(
      transform({
        scoreKind: 'double_seeding',
        bracketSource: { type: 'db' },
      }).ok,
    ).toBe(false);
  });

  it('checks matching, missing, multiple matching, and conflicting event links', () => {
    const matching = transform({ fields: [] }, ['seeding']);
    expect(matching.ok).toBe(true);

    const missing = transform({ fields: [] }, []);
    expect(missing.ok).toBe(true);

    const multipleMatching = transform({ fields: [] }, ['seeding', 'seeding']);
    expect(multipleMatching.ok).toBe(true);

    const conflicting = transform({ fields: [] }, ['seeding', 'bracket']);
    expect(conflicting.ok).toBe(false);
    if (!conflicting.ok) {
      expect(conflicting.diagnostic).toContain('conflicting event-template');
    }

    const mismatched = transform(
      { mode: 'head-to-head', bracketSource: { type: 'db' } },
      ['seeding'],
    );
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) {
      expect(mismatched.diagnostic).toContain('does not match kind');
    }
  });
});
