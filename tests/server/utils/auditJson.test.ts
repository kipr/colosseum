/**
 * Unit tests for audit JSON serialization utility.
 */
import { describe, it, expect } from 'vitest';
import { toAuditJson } from '../../../src/server/utils/auditJson';

describe('toAuditJson', () => {
  it('returns null for null', () => {
    expect(toAuditJson(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(toAuditJson(undefined)).toBeNull();
  });

  it('returns JSON string for primitive values', () => {
    expect(toAuditJson(42)).toBe('42');
    expect(toAuditJson('hello')).toBe('"hello"');
    expect(toAuditJson(true)).toBe('true');
    expect(toAuditJson(false)).toBe('false');
  });

  it('returns JSON string for objects', () => {
    expect(toAuditJson({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
  });

  it('returns JSON string for arrays', () => {
    expect(toAuditJson([1, 2, 3])).toBe('[1,2,3]');
  });

  it('handles nested structures', () => {
    const value = { id: 1, data: { nested: true } };
    expect(toAuditJson(value)).toBe('{"id":1,"data":{"nested":true}}');
  });
});
