import { describe, expect, it } from 'vitest';
import {
  describeRestDuration,
  formatRestDuration,
  getQueueRestWarnings,
  parseDatabaseTimestamp,
  type RestAwareQueueItem,
} from '../../src/client/utils/queueRest';

const NOW = Date.parse('2026-08-25T12:00:00.000Z');

function queueItem(
  overrides: Partial<RestAwareQueueItem> = {},
): RestAwareQueueItem {
  return {
    queue_type: 'seeding',
    team1_id: null,
    team2_id: null,
    team1_number: null,
    team2_number: null,
    team1_last_played_at: null,
    team2_last_played_at: null,
    team1_busy: false,
    team2_busy: false,
    seeding_team_id: 1,
    seeding_team_number: 101,
    seeding_team_last_played_at: null,
    seeding_team_busy: false,
    double_seeding_team1_id: null,
    double_seeding_team2_id: null,
    double_seeding_team1_number: null,
    double_seeding_team2_number: null,
    double_seeding_team1_last_played_at: null,
    double_seeding_team2_last_played_at: null,
    double_seeding_team1_busy: false,
    double_seeding_team2_busy: false,
    ...overrides,
  };
}

describe('queue rest warning helpers', () => {
  it('warns inside the window and expires at the exact threshold', () => {
    const item = queueItem({
      seeding_team_last_played_at: '2026-08-25T11:57:30.000Z',
    });
    const warnings = getQueueRestWarnings(item, 10, NOW);
    expect(warnings).toMatchObject([
      { kind: 'resting', teamNumber: 101, elapsedMinutes: 2 },
    ]);

    expect(
      getQueueRestWarnings(
        queueItem({
          seeding_team_last_played_at: '2026-08-25T11:50:00.000Z',
        }),
        10,
        NOW,
      ),
    ).toEqual([]);
  });

  it('keeps busy warnings enabled at zero and gives them precedence', () => {
    const warnings = getQueueRestWarnings(
      queueItem({
        seeding_team_busy: true,
        seeding_team_last_played_at: '2026-08-25T11:59:00.000Z',
      }),
      0,
      NOW,
    );
    expect(warnings).toMatchObject([
      { kind: 'busy', elapsedMinutes: null, teamNumber: 101 },
    ]);
  });

  it('returns independent warnings for both bracket participants', () => {
    const warnings = getQueueRestWarnings(
      queueItem({
        queue_type: 'bracket',
        team1_id: 1,
        team2_id: 2,
        team1_number: 101,
        team2_number: 102,
        team1_busy: true,
        team2_last_played_at: '2026-08-25 11:55:00',
      }),
      10,
      NOW,
    );
    expect(warnings).toMatchObject([
      { teamId: 1, kind: 'busy' },
      { teamId: 2, kind: 'resting', elapsedMinutes: 5 },
    ]);
  });

  it('ignores absent solo slots, invalid timestamps, and future timestamps', () => {
    const solo = queueItem({
      queue_type: 'double_seeding',
      double_seeding_team1_id: 1,
      double_seeding_team1_number: 101,
      double_seeding_team1_last_played_at: 'not-a-date',
      double_seeding_team2_id: null,
      double_seeding_team2_busy: true,
    });
    expect(getQueueRestWarnings(solo, 10, NOW)).toEqual([]);

    const future = queueItem({
      seeding_team_last_played_at: '2026-08-25T12:01:00.000Z',
    });
    expect(getQueueRestWarnings(future, 10, NOW)).toEqual([]);
  });

  it('normalizes database timestamps and formats elapsed copy', () => {
    expect(parseDatabaseTimestamp('2026-08-25 12:00:00')).toBe(NOW);
    expect(formatRestDuration(0)).toBe('<1 min');
    expect(formatRestDuration(3)).toBe('3 min');
    expect(describeRestDuration(0)).toBe('less than a minute ago');
    expect(describeRestDuration(1)).toBe('one minute ago');
    expect(describeRestDuration(3)).toBe('3 minutes ago');
  });
});
