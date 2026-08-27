import { describe, expect, it } from 'vitest';
import { SchemaError, z } from '../../../src/server/validation/schema';

describe('request schema helper', () => {
  it('trims strings and applies min/max', () => {
    const schema = z.string().trim().min(1).max(5);
    expect(schema.parse('  ab  ')).toBe('ab');
    expect(schema.safeParse('   ').success).toBe(false);
    expect(schema.safeParse('abcdef').success).toBe(false);
  });

  it('coerces route-param numbers and rejects non-positive ids', () => {
    const schema = z.coerce.number().int().positive();
    expect(schema.parse('12')).toBe(12);
    expect(schema.safeParse('0').success).toBe(false);
    expect(schema.safeParse('1.5').success).toBe(false);
  });

  it('does not coerce JSON numbers from strings', () => {
    const schema = z.number().int().positive();
    expect(schema.safeParse('1').success).toBe(false);
    expect(schema.parse(3)).toBe(3);
  });

  it('applies defaults for omitted optional fields', () => {
    const schema = z
      .object({
        name: z.string().trim().min(1),
        count: z.number().int().min(0).optional().default(5),
      })
      .strict();
    expect(schema.parse({ name: ' A ' })).toEqual({ name: 'A', count: 5 });
  });

  it('rejects unknown keys in strict objects', () => {
    const schema = z.object({ id: z.number() }).strict();
    const result = schema.safeParse({ id: 1, extra: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
    }
  });

  it('narrows discriminated unions and runs superRefine', () => {
    const schema = z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), n: z.number() }).strict(),
        z.object({ kind: z.literal('b'), label: z.string() }).strict(),
      ])
      .superRefine((value, ctx) => {
        if (value.kind === 'a' && value.n === 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['n'],
            message: 'n must be non-zero',
          });
        }
      });

    const parsed = schema.parse({ kind: 'b', label: 'ok' });
    if (parsed.kind === 'b') {
      expect(parsed.label).toBe('ok');
    }
    expect(schema.safeParse({ kind: 'a', n: 0 }).success).toBe(false);
    expect(schema.safeParse({ kind: 'c' }).success).toBe(false);
  });

  it('parses unions, records, and enums', () => {
    expect(z.union([z.string(), z.number()]).parse(4)).toBe(4);
    expect(z.record(z.string(), z.unknown()).parse({ a: 1 })).toEqual({
      a: 1,
    });
    expect(z.enum(['setup', 'active']).parse('setup')).toBe('setup');
    expect(z.enum(['setup', 'active']).safeParse('nope').success).toBe(false);
  });

  it('throws SchemaError from parse()', () => {
    expect(() => z.boolean().parse('yes')).toThrow(SchemaError);
  });
});
