import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADMIN_RETURN_TO,
  sanitizeAdminReturnTo,
} from '../../../src/server/utils/adminReturnTo';

describe('sanitizeAdminReturnTo', () => {
  it('preserves admin paths, queries, and fragments', () => {
    expect(
      sanitizeAdminReturnTo('/admin/events/42?view=brackets#ranking'),
    ).toBe('/admin/events/42?view=brackets#ranking');
    expect(sanitizeAdminReturnTo('/admin')).toBe('/admin');
  });

  it.each([
    undefined,
    null,
    42,
    '',
    'admin/events',
    '/judge',
    '/administrator',
    '/admin/../judge',
    'https://evil.example/admin/events',
    '//evil.example/admin/events',
    '/\\evil.example/admin/events',
  ])('falls back for unsafe return target %j', (value) => {
    expect(sanitizeAdminReturnTo(value)).toBe(DEFAULT_ADMIN_RETURN_TO);
  });
});
