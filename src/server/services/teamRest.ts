import type { Database } from '../database/connection';

export interface TeamRestInfo {
  /**
   * Most recent appearance per team, timed from score submission (pending or
   * accepted) and normalized to UTC ISO.
   */
  lastPlayedAt: Map<number, string>;
  /** Teams currently called, arrived, or on a table in this event. */
  busy: Set<number>;
}

interface LastPlayedRow {
  team_id: number;
  last_played_at: string | Date;
}

interface PendingSeedingRow {
  score_data: string | Record<string, unknown> | null;
  created_at: string | Date;
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

function parsePendingSeedingTeamId(
  scoreData: PendingSeedingRow['score_data'],
): number | null {
  try {
    const data =
      typeof scoreData === 'string' ? JSON.parse(scoreData) : scoreData;
    const teamId = Number(
      (data as { team_id?: { value?: unknown } } | null)?.team_id?.value,
    );
    return Number.isInteger(teamId) ? teamId : null;
  } catch {
    return null;
  }
}

/**
 * Read event-wide scored appearances and active queue participation in a few
 * bounded queries. Queue routes use these maps to enrich each returned row
 * without per-team lookups.
 */
export async function getTeamRest(
  db: Database,
  eventId: number,
): Promise<TeamRestInfo> {
  // Rest is timed from when the judge submitted the score, not from when an
  // admin accepted it. Accepted results join back to their submission; rows
  // entered without one (manual admin edits) fall back to the accept time.
  // The connection reads these TIMESTAMP columns as UTC; see
  // POSTGRES_SESSION_OPTIONS in database/connection.ts.
  const lastPlayedRows = await db.all<LastPlayedRow>(
    `SELECT appearances.team_id,
            MAX(appearances.played_at) AS last_played_at
     FROM (
       SELECT bg.team1_id AS team_id,
              COALESCE(sub.created_at, bg.completed_at) AS played_at
       FROM bracket_games bg
       JOIN brackets b ON b.id = bg.bracket_id
       LEFT JOIN score_submissions sub ON sub.id = bg.score_submission_id
       WHERE b.event_id = ?
         AND bg.status = 'completed'
         AND bg.completed_at IS NOT NULL

       UNION ALL

       SELECT bg.team2_id AS team_id,
              COALESCE(sub.created_at, bg.completed_at) AS played_at
       FROM bracket_games bg
       JOIN brackets b ON b.id = bg.bracket_id
       LEFT JOIN score_submissions sub ON sub.id = bg.score_submission_id
       WHERE b.event_id = ?
         AND bg.status = 'completed'
         AND bg.completed_at IS NOT NULL

       UNION ALL

       SELECT ss.team_id,
              COALESCE(sub.created_at, ss.scored_at) AS played_at
       FROM seeding_scores ss
       JOIN teams t ON t.id = ss.team_id
       LEFT JOIN score_submissions sub ON sub.id = ss.score_submission_id
       WHERE t.event_id = ?
         AND ss.score IS NOT NULL
         AND ss.scored_at IS NOT NULL

       UNION ALL

       SELECT dsm.team1_id AS team_id,
              COALESCE(sub.created_at, dsm.completed_at) AS played_at
       FROM double_seeding_matches dsm
       LEFT JOIN score_submissions sub ON sub.id = dsm.score_submission_id
       WHERE dsm.event_id = ?
         AND dsm.status = 'completed'
         AND dsm.completed_at IS NOT NULL

       UNION ALL

       SELECT dsm.team2_id AS team_id,
              COALESCE(sub.created_at, dsm.completed_at) AS played_at
       FROM double_seeding_matches dsm
       LEFT JOIN score_submissions sub ON sub.id = dsm.score_submission_id
       WHERE dsm.event_id = ?
         AND dsm.status = 'completed'
         AND dsm.completed_at IS NOT NULL

       UNION ALL

       SELECT bg.team1_id AS team_id, sub.created_at AS played_at
       FROM score_submissions sub
       JOIN bracket_games bg ON bg.id = sub.bracket_game_id
       JOIN brackets b ON b.id = bg.bracket_id
       WHERE b.event_id = ?
         AND sub.status = 'pending'
         AND sub.created_at IS NOT NULL

       UNION ALL

       SELECT bg.team2_id AS team_id, sub.created_at AS played_at
       FROM score_submissions sub
       JOIN bracket_games bg ON bg.id = sub.bracket_game_id
       JOIN brackets b ON b.id = bg.bracket_id
       WHERE b.event_id = ?
         AND sub.status = 'pending'
         AND sub.created_at IS NOT NULL

       UNION ALL

       SELECT dsm.team1_id AS team_id, sub.created_at AS played_at
       FROM score_submissions sub
       JOIN double_seeding_matches dsm ON dsm.id = sub.double_seeding_match_id
       WHERE dsm.event_id = ?
         AND sub.status = 'pending'
         AND sub.created_at IS NOT NULL

       UNION ALL

       SELECT dsm.team2_id AS team_id, sub.created_at AS played_at
       FROM score_submissions sub
       JOIN double_seeding_matches dsm ON dsm.id = sub.double_seeding_match_id
       WHERE dsm.event_id = ?
         AND sub.status = 'pending'
         AND sub.created_at IS NOT NULL
     ) appearances
     WHERE appearances.team_id IS NOT NULL
     GROUP BY appearances.team_id`,
    [
      eventId,
      eventId,
      eventId,
      eventId,
      eventId,
      eventId,
      eventId,
      eventId,
      eventId,
    ],
  );

  // Pending seeding submissions identify their team only inside score_data,
  // so they are parsed here the same way queue sync does.
  const pendingSeedingRows = await db.all<PendingSeedingRow>(
    `SELECT sub.score_data, sub.created_at
     FROM score_submissions sub
     WHERE sub.event_id = ?
       AND sub.score_type = 'seeding'
       AND sub.status = 'pending'
       AND sub.created_at IS NOT NULL`,
    [eventId],
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

  const seedingTeamIds = new Set(
    (
      await db.all<{ id: number }>('SELECT id FROM teams WHERE event_id = ?', [
        eventId,
      ])
    ).map((row) => Number(row.id)),
  );
  for (const row of pendingSeedingRows) {
    const teamId = parsePendingSeedingTeamId(row.score_data);
    if (teamId == null || !seedingTeamIds.has(teamId)) continue;
    const normalized = normalizeTimestamp(row.created_at);
    if (!normalized) continue;
    const existing = lastPlayedAt.get(teamId);
    if (!existing || normalized > existing) {
      lastPlayedAt.set(teamId, normalized);
    }
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
