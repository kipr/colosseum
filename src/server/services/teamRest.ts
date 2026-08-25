import type { Database } from '../database/connection';

export interface TeamRestInfo {
  /** Most recent completed appearance per team, normalized to UTC ISO. */
  lastPlayedAt: Map<number, string>;
  /** Teams currently called, arrived, or on a table in this event. */
  busy: Set<number>;
}

interface LastPlayedRow {
  team_id: number;
  last_played_at: string | Date;
}

interface ActiveQueueRow {
  seeding_team_id: number | null;
  bracket_team1_id: number | null;
  bracket_team2_id: number | null;
  double_seeding_team1_id: number | null;
  double_seeding_team2_id: number | null;
}

function normalizeTimestamp(value: string | Date): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

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

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Read event-wide completed appearances and active queue participation in two
 * bounded queries. Queue routes use these maps to enrich each returned row
 * without per-team lookups.
 */
export async function getTeamRest(
  db: Database,
  eventId: number,
): Promise<TeamRestInfo> {
  const lastPlayedRows = await db.all<LastPlayedRow>(
    `SELECT appearances.team_id,
            MAX(appearances.played_at) AS last_played_at
     FROM (
       SELECT bg.team1_id AS team_id, bg.completed_at AS played_at
       FROM bracket_games bg
       JOIN brackets b ON b.id = bg.bracket_id
       WHERE b.event_id = ?
         AND bg.status = 'completed'
         AND bg.completed_at IS NOT NULL

       UNION ALL

       SELECT bg.team2_id AS team_id, bg.completed_at AS played_at
       FROM bracket_games bg
       JOIN brackets b ON b.id = bg.bracket_id
       WHERE b.event_id = ?
         AND bg.status = 'completed'
         AND bg.completed_at IS NOT NULL

       UNION ALL

       SELECT ss.team_id, ss.scored_at AS played_at
       FROM seeding_scores ss
       JOIN teams t ON t.id = ss.team_id
       WHERE t.event_id = ?
         AND ss.score IS NOT NULL
         AND ss.scored_at IS NOT NULL

       UNION ALL

       SELECT dsm.team1_id AS team_id, dsm.completed_at AS played_at
       FROM double_seeding_matches dsm
       WHERE dsm.event_id = ?
         AND dsm.status = 'completed'
         AND dsm.completed_at IS NOT NULL

       UNION ALL

       SELECT dsm.team2_id AS team_id, dsm.completed_at AS played_at
       FROM double_seeding_matches dsm
       WHERE dsm.event_id = ?
         AND dsm.status = 'completed'
         AND dsm.completed_at IS NOT NULL
     ) appearances
     WHERE appearances.team_id IS NOT NULL
     GROUP BY appearances.team_id`,
    [eventId, eventId, eventId, eventId, eventId],
  );

  const activeRows = await db.all<ActiveQueueRow>(
    `SELECT gq.seeding_team_id,
            bg.team1_id AS bracket_team1_id,
            bg.team2_id AS bracket_team2_id,
            dsm.team1_id AS double_seeding_team1_id,
            dsm.team2_id AS double_seeding_team2_id
     FROM game_queue gq
     LEFT JOIN bracket_games bg ON bg.id = gq.bracket_game_id
     LEFT JOIN double_seeding_matches dsm
       ON dsm.id = gq.double_seeding_match_id
     WHERE gq.event_id = ?
       AND gq.status IN ('called', 'arrived', 'on_table')`,
    [eventId],
  );

  const lastPlayedAt = new Map<number, string>();
  for (const row of lastPlayedRows) {
    const normalized = normalizeTimestamp(row.last_played_at);
    if (normalized) lastPlayedAt.set(Number(row.team_id), normalized);
  }

  const busy = new Set<number>();
  for (const row of activeRows) {
    for (const teamId of [
      row.seeding_team_id,
      row.bracket_team1_id,
      row.bracket_team2_id,
      row.double_seeding_team1_id,
      row.double_seeding_team2_id,
    ]) {
      if (teamId != null) busy.add(Number(teamId));
    }
  }

  return { lastPlayedAt, busy };
}
