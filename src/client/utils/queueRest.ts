export type QueueType = 'seeding' | 'bracket' | 'double_seeding';
export type RestWarningKind = 'resting' | 'busy';

export interface RestAwareQueueItem {
  queue_type: QueueType;
  team1_id: number | null;
  team2_id: number | null;
  team1_number: number | null;
  team2_number: number | null;
  team1_last_played_at: string | null;
  team2_last_played_at: string | null;
  team1_busy: boolean;
  team2_busy: boolean;
  seeding_team_id: number | null;
  seeding_team_number: number | null;
  seeding_team_last_played_at: string | null;
  seeding_team_busy: boolean;
  double_seeding_team1_id: number | null;
  double_seeding_team2_id: number | null;
  double_seeding_team1_number: number | null;
  double_seeding_team2_number: number | null;
  double_seeding_team1_last_played_at: string | null;
  double_seeding_team2_last_played_at: string | null;
  double_seeding_team1_busy: boolean;
  double_seeding_team2_busy: boolean;
}

export interface TeamRestWarning {
  teamId: number;
  teamNumber: number | null;
  kind: RestWarningKind;
  lastPlayedAt: string | null;
  elapsedMinutes: number | null;
}

interface TeamRestSlot {
  teamId: number | null;
  teamNumber: number | null;
  lastPlayedAt: string | null;
  busy: boolean;
}

export function parseDatabaseTimestamp(value: string): number | null {
  let normalized = value;
  if (value.includes(' ') && !value.includes('Z') && !value.includes('+')) {
    normalized = `${value.replace(' ', 'T')}Z`;
  } else if (
    value.includes('T') &&
    !value.includes('Z') &&
    !value.includes('+')
  ) {
    normalized = `${value}Z`;
  }

  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getTeamSlots(item: RestAwareQueueItem): TeamRestSlot[] {
  if (item.queue_type === 'seeding') {
    return [
      {
        teamId: item.seeding_team_id,
        teamNumber: item.seeding_team_number,
        lastPlayedAt: item.seeding_team_last_played_at,
        busy: item.seeding_team_busy,
      },
    ];
  }

  if (item.queue_type === 'double_seeding') {
    return [
      {
        teamId: item.double_seeding_team1_id,
        teamNumber: item.double_seeding_team1_number,
        lastPlayedAt: item.double_seeding_team1_last_played_at,
        busy: item.double_seeding_team1_busy,
      },
      {
        teamId: item.double_seeding_team2_id,
        teamNumber: item.double_seeding_team2_number,
        lastPlayedAt: item.double_seeding_team2_last_played_at,
        busy: item.double_seeding_team2_busy,
      },
    ];
  }

  return [
    {
      teamId: item.team1_id,
      teamNumber: item.team1_number,
      lastPlayedAt: item.team1_last_played_at,
      busy: item.team1_busy,
    },
    {
      teamId: item.team2_id,
      teamNumber: item.team2_number,
      lastPlayedAt: item.team2_last_played_at,
      busy: item.team2_busy,
    },
  ];
}

export function getQueueRestWarnings(
  item: RestAwareQueueItem,
  minRestMinutes: number,
  nowMs: number,
): TeamRestWarning[] {
  const thresholdMs = Math.max(0, minRestMinutes) * 60_000;

  return getTeamSlots(item).flatMap((slot): TeamRestWarning[] => {
    if (slot.teamId == null) return [];

    if (slot.busy) {
      return [
        {
          teamId: slot.teamId,
          teamNumber: slot.teamNumber,
          kind: 'busy',
          lastPlayedAt: slot.lastPlayedAt,
          elapsedMinutes: null,
        },
      ];
    }

    if (thresholdMs === 0 || !slot.lastPlayedAt) return [];

    const playedAtMs = parseDatabaseTimestamp(slot.lastPlayedAt);
    if (playedAtMs == null) return [];

    const elapsedMs = nowMs - playedAtMs;
    if (elapsedMs < 0 || elapsedMs >= thresholdMs) return [];

    return [
      {
        teamId: slot.teamId,
        teamNumber: slot.teamNumber,
        kind: 'resting',
        lastPlayedAt: slot.lastPlayedAt,
        elapsedMinutes: Math.floor(elapsedMs / 60_000),
      },
    ];
  });
}

export function formatRestDuration(minutes: number): string {
  if (minutes < 1) return '<1 min';
  return `${minutes} min`;
}

export function describeRestDuration(minutes: number): string {
  if (minutes < 1) return 'less than a minute ago';
  if (minutes === 1) return 'one minute ago';
  return `${minutes} minutes ago`;
}
