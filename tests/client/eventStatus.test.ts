/**
 * Unit tests for event status utilities.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  getEventStatusClass,
  getEventStatusLabel,
  getSpectatorListingLabel,
  formatEventDate,
  isEventActive,
} from '../../src/client/utils/eventStatus';
import type {
  Event,
  EventStatus,
  Season,
  SpectatorListing,
} from '../../src/client/utils/eventStatus';

describe('spectator listing model', () => {
  it('requires placement and nullable season independently of lifecycle status', () => {
    expectTypeOf<SpectatorListing>().toEqualTypeOf<'current' | 'archive'>();
    expectTypeOf<
      Pick<Event, 'spectator_listing' | 'season_id'>
    >().toEqualTypeOf<{
      spectator_listing: SpectatorListing;
      season_id: number | null;
    }>();
    expectTypeOf<Event['status']>().toEqualTypeOf<
      'setup' | 'active' | 'complete' | 'archived'
    >();
    expectTypeOf<Season>().toEqualTypeOf<{
      id: number;
      name: string;
      sort_order: number;
    }>();
  });
});

describe('getSpectatorListingLabel', () => {
  it('returns Current Events for current placement', () => {
    expect(getSpectatorListingLabel('current')).toBe('Current Events');
  });

  it('returns Spectator Archive for archive placement', () => {
    expect(getSpectatorListingLabel('archive')).toBe('Spectator Archive');
  });

  it.each(['unknown', '', 'setup', 'active', 'complete', 'archived'])(
    'returns the original string for unknown placement %j',
    (listing) => {
      expect(getSpectatorListingLabel(listing)).toBe(listing);
    },
  );
});

describe('spectator placement and lifecycle independence', () => {
  const season: Season = { id: 7, name: '2025–2026', sort_order: 10 };
  const placements: Pick<Event, 'spectator_listing' | 'season_id'>[] = [
    { spectator_listing: 'current', season_id: null },
    { spectator_listing: 'current', season_id: season.id },
    { spectator_listing: 'archive', season_id: season.id },
  ];
  const lifecycleCases: {
    status: EventStatus;
    label: string;
    isActive: boolean;
  }[] = [
    { status: 'setup', label: 'Setup', isActive: true },
    { status: 'active', label: 'Active', isActive: true },
    { status: 'complete', label: 'Complete', isActive: false },
    { status: 'archived', label: 'Archived', isActive: false },
  ];

  describe.each(placements)(
    '$spectator_listing placement with season $season_id',
    (placement) => {
      it.each(lifecycleCases)(
        'preserves $status lifecycle behavior',
        ({ status, label, isActive }) => {
          const event: Pick<
            Event,
            'status' | 'spectator_listing' | 'season_id'
          > = { status, ...placement };

          expect(getEventStatusClass(event.status)).toBe(
            `event-status-${status}`,
          );
          expect(getEventStatusLabel(event.status)).toBe(label);
          expect(isEventActive(event.status)).toBe(isActive);
          expect(getSpectatorListingLabel(event.spectator_listing)).toBe(
            placement.spectator_listing === 'archive'
              ? 'Spectator Archive'
              : 'Current Events',
          );
        },
      );
    },
  );

  it.each(['current', 'archive'])(
    'does not interpret placement %j as a lifecycle status',
    (listing) => {
      expect(getEventStatusLabel(listing)).toBe(listing);
      expect(getEventStatusClass(listing)).toBe('');
    },
  );
});

describe('getEventStatusClass', () => {
  it('returns event-status-active for active', () => {
    expect(getEventStatusClass('active')).toBe('event-status-active');
  });

  it('returns event-status-setup for setup', () => {
    expect(getEventStatusClass('setup')).toBe('event-status-setup');
  });

  it('returns event-status-complete for complete', () => {
    expect(getEventStatusClass('complete')).toBe('event-status-complete');
  });

  it('returns event-status-archived for archived', () => {
    expect(getEventStatusClass('archived')).toBe('event-status-archived');
  });

  it('returns empty string for unknown status', () => {
    expect(getEventStatusClass('unknown')).toBe('');
    expect(getEventStatusClass('')).toBe('');
  });
});

describe('getEventStatusLabel', () => {
  it('returns Setup for setup', () => {
    expect(getEventStatusLabel('setup')).toBe('Setup');
  });

  it('returns Active for active', () => {
    expect(getEventStatusLabel('active')).toBe('Active');
  });

  it('returns Complete for complete', () => {
    expect(getEventStatusLabel('complete')).toBe('Complete');
  });

  it('returns Archived for archived', () => {
    expect(getEventStatusLabel('archived')).toBe('Archived');
  });

  it('returns the status string for unknown status', () => {
    expect(getEventStatusLabel('unknown')).toBe('unknown');
  });
});

describe('formatEventDate', () => {
  it('returns empty string for null', () => {
    expect(formatEventDate(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatEventDate(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatEventDate('')).toBe('');
  });

  it('formats YYYY-MM-DD date string', () => {
    const result = formatEventDate('2025-03-15');
    expect(result).toMatch(/Mar.*15.*2025/);
  });

  it('returns original string for unparseable string (no YYYY-MM-DD prefix)', () => {
    expect(formatEventDate('not-a-date')).toBe('not-a-date');
  });

  it('formats PostgreSQL ISO date string (YYYY-MM-DDTHH:mm:ss.sssZ)', () => {
    const result = formatEventDate('2025-03-15T00:00:00.000Z');
    expect(result).toMatch(/Mar.*15.*2025/);
  });
});

describe('isEventActive', () => {
  it('returns true for setup', () => {
    expect(isEventActive('setup')).toBe(true);
  });

  it('returns true for active', () => {
    expect(isEventActive('active')).toBe(true);
  });

  it('returns false for complete', () => {
    expect(isEventActive('complete')).toBe(false);
  });

  it('returns false for archived', () => {
    expect(isEventActive('archived')).toBe(false);
  });
});
