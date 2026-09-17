import { describe, expect, it } from 'vitest';
import {
  adminBracketPath,
  adminTabPath,
  spectatorBracketPath,
  spectatorEventPath,
} from '../../src/client/utils/routes';

describe('admin route helpers', () => {
  it('builds tab paths with and without an event', () => {
    expect(adminTabPath('events')).toBe('/admin/events');
    expect(adminTabPath('teams')).toBe('/admin/events');
    expect(adminTabPath('events', 42)).toBe('/admin/events/42');
    expect(adminTabPath('teams', 42)).toBe('/admin/events/42/teams');
    expect(adminTabPath('double-seeding', '7')).toBe(
      '/admin/events/7/double-seeding',
    );
  });

  it('builds bracket detail paths with their nested view state', () => {
    expect(adminBracketPath(42, 9)).toBe('/admin/events/42/brackets/9');
    expect(adminBracketPath(42, 9, 'ranking', 'redemption')).toBe(
      '/admin/events/42/brackets/9?view=ranking&side=redemption',
    );
  });
});

describe('spectator route helpers', () => {
  it('builds canonical event view paths', () => {
    expect(spectatorEventPath(42)).toBe('/spectator/events/42/seeding');
    expect(spectatorEventPath(42, 'double-seeding')).toBe(
      '/spectator/events/42/double-seeding',
    );
    expect(spectatorEventPath(42, 'documentation')).toBe(
      '/spectator/events/42/documentation',
    );
  });

  it('builds nested bracket paths and keeps side as query state', () => {
    expect(spectatorBracketPath(42, 9, 'bracket')).toBe(
      '/spectator/events/42/brackets/9',
    );
    expect(spectatorBracketPath(42, 9, 'rankings', 'redemption')).toBe(
      '/spectator/events/42/brackets/9/rankings?side=redemption',
    );
  });
});
