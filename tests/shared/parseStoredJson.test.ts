import { describe, expect, it } from 'vitest';
import {
  parseStoredJson,
  tryParseStoredJson,
} from '../../src/shared/parseStoredJson';

describe('parseStoredJson', () => {
  it('parses a JSON string from a TEXT column', () => {
    expect(parseStoredJson('{"fields":[]}')).toEqual({ fields: [] });
  });

  it('returns an already-parsed object from a JSON/JSONB column', () => {
    const schema = { fields: [{ id: 'score' }] };
    expect(parseStoredJson(schema)).toBe(schema);
  });

  it('throws on invalid JSON strings', () => {
    expect(() => parseStoredJson('{')).toThrow();
  });

  it('tryParseStoredJson returns null instead of throwing', () => {
    expect(tryParseStoredJson('{')).toBeNull();
    expect(tryParseStoredJson(undefined)).toBeNull();
    expect(tryParseStoredJson('{"ok":true}')).toEqual({ ok: true });
  });
});
