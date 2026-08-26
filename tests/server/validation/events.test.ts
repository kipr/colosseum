import { describe, expect, it } from 'vitest';
import {
  createEventBodySchema,
  eventPatchBodySchema,
  eventRowToUpdateCandidate,
  eventUpdateSchema,
  mergeEventPatch,
} from '../../../src/server/validation/events';

describe('createEventBodySchema', () => {
  it('requires a non-empty name and applies defaults', () => {
    const result = createEventBodySchema.safeParse({ name: ' Regional ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Regional');
      expect(result.data.status).toBe('setup');
      expect(result.data.seeding_rounds).toBe(3);
      expect(result.data.min_rest_minutes).toBe(3);
      expect(result.data.score_accept_mode).toBe('manual');
    }
  });

  it('rejects an empty name and negative rest minutes', () => {
    expect(createEventBodySchema.safeParse({}).success).toBe(false);
    expect(
      createEventBodySchema.safeParse({ name: 'X', min_rest_minutes: -1 })
        .success,
    ).toBe(false);
  });
});

describe('event patch merge', () => {
  it('rejects unknown keys and empty patches', () => {
    expect(eventPatchBodySchema.safeParse({}).success).toBe(false);
    expect(
      eventPatchBodySchema.safeParse({ name: 'A', extra: true }).success,
    ).toBe(false);
  });

  it('revalidates the merged candidate', () => {
    const current = eventRowToUpdateCandidate({
      name: 'Original',
      description: null,
      event_date: null,
      location: null,
      status: 'setup',
      seeding_rounds: 3,
      double_seeding_rounds: 0,
      min_rest_minutes: 3,
      score_accept_mode: 'manual',
      spectator_results_released: 0,
    });
    const patch = eventPatchBodySchema.parse({ status: 'active' });
    const merged = mergeEventPatch(current, patch);
    expect(eventUpdateSchema.parse(merged).status).toBe('active');
    expect(merged.name).toBe('Original');
  });
});
