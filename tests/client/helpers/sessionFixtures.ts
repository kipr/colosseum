import type { SessionUser } from '../../src/client/api/types';
import type { Event } from '../../src/client/utils/eventStatus';

export const userA: SessionUser = {
  id: 1,
  email: 'a@kipr.org',
  name: 'Ada Admin',
  isAdmin: true,
};

export const userB: SessionUser = {
  id: 2,
  email: 'b@kipr.org',
  name: 'Ben Staff',
  isAdmin: false,
};

export function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 1,
    name: 'Event',
    description: null,
    event_date: '2026-06-15',
    location: 'Arena',
    status: 'active',
    seeding_rounds: 3,
    double_seeding_rounds: 0,
    min_rest_minutes: 3,
    score_accept_mode: 'manual',
    spectator_results_released: false,
    created_by: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export const eventFive = makeEvent({
  id: 5,
  name: 'Stored Cup',
  status: 'setup',
});
export const eventSeven = makeEvent({
  id: 7,
  name: 'Deep Link Open',
  status: 'active',
});
export const eventNine = makeEvent({
  id: 9,
  name: 'Complete Classic',
  status: 'complete',
});
