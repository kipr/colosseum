import { describe, expect, it } from 'vitest';
import { adminBracketPath, adminTabPath } from '../../src/client/utils/routes';

describe('admin route helpers', () => {
  it('builds tab paths with and without an event', () => {
    expect(adminTabPath('events')).toBe('/admin/events');
    expect(adminTabPath('teams', 42)).toBe('/admin/teams/42');
    expect(adminTabPath('double-seeding', '7')).toBe('/admin/double-seeding/7');
  });

  it('builds bracket detail paths with their nested view state', () => {
    expect(adminBracketPath(42, 9)).toBe('/admin/brackets/42/9');
    expect(adminBracketPath(42, 9, 'ranking', 'redemption')).toBe(
      '/admin/brackets/42/9?view=ranking&side=redemption',
    );
  });
});
