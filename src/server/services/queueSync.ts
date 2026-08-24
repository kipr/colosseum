import type { Database } from '../database/connection';
import {
  bumpQueueVersion,
  clearQueueDirty,
  getQueueVersionState,
} from './queueVersion';

/**
 * Non-destructive queue repair sync.
 *
 * The `game_queue` table is materialized from teams x rounds, bracket games,
 * and double-seeding matches. These sync functions repair drift between the
 * queue and those source tables. They are intentionally kept OFF the polling
 * hot path: reads only trigger a sync when the event's queue is flagged dirty
 * (see queueVersion.ts), when a client explicitly requests `sync=1`, or via
 * the low-frequency background repair in `scheduleQueueRepair`.
 *
 * Any sync that changes rows bumps the event's queue version so pollers'
 * ETags invalidate.
 */

const QUEUE_SYNC_FRESH_MS = 5_000;
const QUEUE_REPAIR_INTERVAL_MS = 60_000;

export const QUEUE_SYNC_TYPES = [
  'seeding',
  'bracket',
  'double_seeding',
] as const;

export type QueueSyncType = (typeof QUEUE_SYNC_TYPES)[number];

interface QueueSyncState {
  lastSyncedAt: number;
  inFlight?: Promise<number>;
}

// Keyed by db instance so tests with separate in-memory databases don't
// share coalescing/repair state.
const queueSyncStates = new WeakMap<object, Map<string, QueueSyncState>>();
const queueRepairTimes = new WeakMap<object, Map<number, number>>();

function getQueueSyncStateMap(db: Database): Map<string, QueueSyncState> {
  let stateMap = queueSyncStates.get(db as object);
  if (!stateMap) {
    stateMap = new Map<string, QueueSyncState>();
    queueSyncStates.set(db as object, stateMap);
  }
  return stateMap;
}

function queueSyncKey(eventId: number, queueType: QueueSyncType): string {
  return `${eventId}:${queueType}`;
}

async function runQueueTypeSync(
  db: Database,
  eventId: number,
  queueType: QueueSyncType,
): Promise<number> {
  let changes = 0;
  if (queueType === 'seeding') {
    changes = await syncSeedingQueue(db, eventId);
  } else if (queueType === 'bracket') {
    changes = await syncBracketQueue(db, eventId);
  } else {
    changes = await syncDoubleSeedingQueue(db, eventId);
  }
  if (changes > 0) {
    await bumpQueueVersion(db, eventId);
    return 1;
  }
  return 0;
}

async function syncQueueTypeCoalesced(
  db: Database,
  eventId: number,
  queueType: QueueSyncType,
  ignoreFreshness = false,
): Promise<number> {
  const now = Date.now();
  const stateMap = getQueueSyncStateMap(db);
  const key = queueSyncKey(eventId, queueType);
  const state = stateMap.get(key);

  if (state?.inFlight) {
    await state.inFlight;
    // The joined sync may have started before this caller captured its repair
    // generation, so its version bump cannot safely be attributed to this
    // repair. Excluding it makes the compare-and-clear conservatively fail.
    return 0;
  }

  if (
    !ignoreFreshness &&
    state &&
    now - state.lastSyncedAt < QUEUE_SYNC_FRESH_MS
  ) {
    return 0;
  }

  const syncState: QueueSyncState = {
    lastSyncedAt: state?.lastSyncedAt ?? 0,
  };
  const inFlight = runQueueTypeSync(db, eventId, queueType)
    .then((versionBumps) => {
      syncState.lastSyncedAt = Date.now();
      return versionBumps;
    })
    .finally(() => {
      syncState.inFlight = undefined;
    });

  syncState.inFlight = inFlight;
  stateMap.set(key, syncState);
  return inFlight;
}

/** Explicit `sync=1` request path: sync the requested type (or all). */
export async function syncQueueCoalesced(
  db: Database,
  eventId: number,
  queueType: string | null,
): Promise<void> {
  if (queueType && QUEUE_SYNC_TYPES.includes(queueType as QueueSyncType)) {
    await syncQueueTypeCoalesced(db, eventId, queueType as QueueSyncType);
    return;
  }

  if (queueType) return;

  for (const type of QUEUE_SYNC_TYPES) {
    await syncQueueTypeCoalesced(db, eventId, type);
  }
}

/**
 * Read-path freshness guard: if the event's queue is flagged dirty, run one
 * coalesced repair sync across all queue types and clear the flag. Returns
 * the current version for ETag generation.
 */
export async function ensureQueueFresh(
  db: Database,
  eventId: number,
): Promise<number> {
  const state = await getQueueVersionState(db, eventId);
  if (!state.dirty) {
    return state.version;
  }

  let repairVersionBumps = 0;
  for (const type of QUEUE_SYNC_TYPES) {
    repairVersionBumps += await syncQueueTypeCoalesced(db, eventId, type, true);
  }

  // Only clear the generation this repair started from, accounting for
  // version bumps made by the repair itself. A source mutation contributes
  // an additional bump, so its dirty flag survives for the next read even if
  // it races after the relevant queue type has already been synchronized.
  await clearQueueDirty(db, eventId, state.version + repairVersionBumps);
  return (await getQueueVersionState(db, eventId)).version;
}

/**
 * Self-healing safety net: at most once per minute per actively-read event,
 * run a background repair sync. Catches any drift source that was not
 * explicitly flagged dirty. Fire-and-forget; never delays the read.
 * Disabled under tests to avoid stray async work on closed databases.
 */
export function scheduleQueueRepair(db: Database, eventId: number): void {
  if (process.env.NODE_ENV === 'test') return;

  let times = queueRepairTimes.get(db as object);
  if (!times) {
    times = new Map<number, number>();
    queueRepairTimes.set(db as object, times);
  }

  const last = times.get(eventId) ?? 0;
  const now = Date.now();
  if (now - last < QUEUE_REPAIR_INTERVAL_MS) return;
  times.set(eventId, now);

  void (async () => {
    for (const type of QUEUE_SYNC_TYPES) {
      await syncQueueTypeCoalesced(db, eventId, type);
    }
  })().catch((error) => {
    console.error('Background queue repair sync failed:', error);
  });
}

/**
 * Ensure game_queue has all team x round items for seeding, with correct
 * status from seeding_scores. Returns the number of rows changed.
 */
async function syncSeedingQueue(
  db: Database,
  eventId: number,
): Promise<number> {
  const event = await db.get(
    'SELECT id, seeding_rounds FROM events WHERE id = ?',
    [eventId],
  );
  if (!event) return 0;

  const seedingRounds = event.seeding_rounds || 3;
  const teams = await db.all<{ id: number; team_number: number }>(
    'SELECT id, team_number FROM teams WHERE event_id = ? ORDER BY team_number ASC',
    [eventId],
  );
  if (teams.length === 0) return 0;

  const teamIds = teams.map((t) => t.id);
  const scoredRounds = await db.all<{ team_id: number; round_number: number }>(
    `SELECT team_id, round_number FROM seeding_scores
     WHERE team_id IN (${teamIds.map(() => '?').join(',')}) AND score IS NOT NULL`,
    teamIds,
  );
  const scoredSet = new Set(
    scoredRounds.map((s) => `${s.team_id}:${s.round_number}`),
  );
  const submittedRoundsRaw = await db.all<{ score_data: string }>(
    `SELECT score_data FROM score_submissions
     WHERE event_id = ?
       AND score_type = 'seeding'
       AND status = 'accepted'`,
    [eventId],
  );
  const submittedRounds: { team_id: number; round_number: number }[] = [];
  for (const row of submittedRoundsRaw) {
    try {
      const data =
        typeof row.score_data === 'string'
          ? JSON.parse(row.score_data)
          : row.score_data;
      const teamId = data?.team_id?.value;
      const roundNumber = data?.round?.value ?? data?.round_number?.value;
      if (teamId != null && roundNumber != null) {
        submittedRounds.push({
          team_id: Number(teamId),
          round_number: Number(roundNumber),
        });
      }
    } catch {
      // skip rows with unparseable score_data
    }
  }
  const submittedSet = new Set(
    submittedRounds.map((s) => `${s.team_id}:${s.round_number}`),
  );

  const pendingSeedingRaw = await db.all<{ score_data: string }>(
    `SELECT score_data FROM score_submissions
     WHERE event_id = ?
       AND score_type = 'seeding'
       AND status = 'pending'`,
    [eventId],
  );
  const pendingSeedingSet = new Set<string>();
  for (const row of pendingSeedingRaw) {
    try {
      const data =
        typeof row.score_data === 'string'
          ? JSON.parse(row.score_data)
          : row.score_data;
      const teamId = data?.team_id?.value;
      const roundNumber = data?.round?.value ?? data?.round_number?.value;
      if (teamId != null && roundNumber != null) {
        pendingSeedingSet.add(`${Number(teamId)}:${Number(roundNumber)}`);
      }
    } catch {
      // skip
    }
  }

  const existingSeeding = await db.all<{
    id: number;
    seeding_team_id: number;
    seeding_round: number;
    status: string;
  }>(
    `SELECT id, seeding_team_id, seeding_round, status FROM game_queue
     WHERE event_id = ? AND queue_type = 'seeding'`,
    [eventId],
  );
  const existingMap = new Map(
    existingSeeding.map((e) => [`${e.seeding_team_id}:${e.seeding_round}`, e]),
  );

  const allCombos: { team_id: number; round: number; scored: boolean }[] = [];
  for (let round = 1; round <= seedingRounds; round++) {
    for (const team of teams) {
      allCombos.push({
        team_id: team.id,
        round,
        scored:
          scoredSet.has(`${team.id}:${round}`) ||
          submittedSet.has(`${team.id}:${round}`),
      });
    }
  }

  const maxPos = await db.get<{ max_pos: number | null }>(
    'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
    [eventId],
  );
  let nextPos = (maxPos?.max_pos ?? 0) + 1;

  let changes = 0;
  await db.transaction(async (tx) => {
    for (const combo of allCombos) {
      const key = `${combo.team_id}:${combo.round}`;
      const existing = existingMap.get(key);

      if (existing) {
        if (combo.scored) {
          if (pendingSeedingSet.has(key)) {
            if (existing.status !== 'scored') {
              await tx.run(
                `UPDATE game_queue SET status = 'scored', called_at = NULL, table_number = NULL WHERE id = ?`,
                [existing.id],
              );
              changes++;
            }
          } else {
            await tx.run('DELETE FROM game_queue WHERE id = ?', [existing.id]);
            changes++;
          }
        } else if (
          existing.status === 'scored' &&
          !pendingSeedingSet.has(key)
        ) {
          await tx.run(
            "UPDATE game_queue SET status = 'queued', called_at = NULL, table_number = NULL WHERE id = ?",
            [existing.id],
          );
          changes++;
        }
      } else if (!combo.scored) {
        await tx.run(
          `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
           VALUES (?, ?, ?, 'seeding', ?, 'queued')`,
          [eventId, combo.team_id, combo.round, nextPos++],
        );
        changes++;
      } else if (pendingSeedingSet.has(key)) {
        await tx.run(
          `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
           VALUES (?, ?, ?, 'seeding', ?, 'scored')`,
          [eventId, combo.team_id, combo.round, nextPos++],
        );
        changes++;
      }
    }
  });
  return changes;
}

/**
 * Ensure game_queue has eligible bracket games, with correct status from
 * bracket_games. Returns the number of rows changed.
 */
async function syncBracketQueue(
  db: Database,
  eventId: number,
): Promise<number> {
  const brackets = await db.all<{ id: number }>(
    'SELECT id FROM brackets WHERE event_id = ?',
    [eventId],
  );
  if (brackets.length === 0) return 0;

  const bracketIds = brackets.map((b) => b.id);
  const allGames = await db.all<{
    id: number;
    game_number: number;
    status: string;
    team1_id: number | null;
    team2_id: number | null;
  }>(
    `SELECT id, game_number, status, team1_id, team2_id FROM bracket_games
     WHERE bracket_id IN (${bracketIds.map(() => '?').join(',')})
     ORDER BY game_number ASC`,
    bracketIds,
  );
  const submittedBracketGames = await db.all<{ bracket_game_id: number }>(
    `SELECT DISTINCT bracket_game_id
     FROM score_submissions
     WHERE event_id = ?
       AND score_type = 'bracket'
       AND status = 'accepted'
       AND bracket_game_id IS NOT NULL`,
    [eventId],
  );
  const submittedGameSet = new Set(
    submittedBracketGames.map((row) => row.bracket_game_id),
  );

  const pendingBracketGames = await db.all<{ bracket_game_id: number }>(
    `SELECT DISTINCT bracket_game_id
     FROM score_submissions
     WHERE event_id = ?
       AND score_type = 'bracket'
       AND status = 'pending'
       AND bracket_game_id IS NOT NULL`,
    [eventId],
  );
  const pendingBracketSet = new Set(
    pendingBracketGames.map((row) => row.bracket_game_id),
  );

  const existingBracket = await db.all<{
    id: number;
    bracket_game_id: number;
    status: string;
  }>(
    `SELECT id, bracket_game_id, status FROM game_queue
     WHERE event_id = ? AND queue_type = 'bracket'`,
    [eventId],
  );
  const existingByGameId = new Map(
    existingBracket.map((e) => [e.bracket_game_id, e]),
  );

  const maxPos = await db.get<{ max_pos: number | null }>(
    'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
    [eventId],
  );
  let nextPos = (maxPos?.max_pos ?? 0) + 1;

  let changes = 0;
  await db.transaction(async (tx) => {
    for (const game of allGames) {
      const isEligible =
        game.team1_id != null &&
        game.team2_id != null &&
        ['ready', 'pending'].includes(game.status);
      const isCompleted =
        game.status === 'completed' || submittedGameSet.has(game.id);
      const existing = existingByGameId.get(game.id);

      if (existing) {
        if (isCompleted) {
          if (pendingBracketSet.has(game.id)) {
            if (existing.status !== 'scored') {
              await tx.run(
                `UPDATE game_queue SET status = 'scored', called_at = NULL, table_number = NULL WHERE id = ?`,
                [existing.id],
              );
              changes++;
            }
          } else {
            await tx.run('DELETE FROM game_queue WHERE id = ?', [existing.id]);
            changes++;
          }
        } else if (
          isEligible &&
          existing.status === 'scored' &&
          !pendingBracketSet.has(game.id)
        ) {
          await tx.run(
            "UPDATE game_queue SET status = 'queued', called_at = NULL, table_number = NULL WHERE id = ?",
            [existing.id],
          );
          changes++;
        } else if (
          !isEligible &&
          !isCompleted &&
          (game.team1_id == null || game.team2_id == null)
        ) {
          await tx.run('DELETE FROM game_queue WHERE id = ?', [existing.id]);
          changes++;
        }
      } else if (isEligible && !isCompleted) {
        await tx.run(
          `INSERT INTO game_queue (event_id, bracket_game_id, queue_type, queue_position, status)
           VALUES (?, ?, 'bracket', ?, 'queued')`,
          [eventId, game.id, nextPos++],
        );
        changes++;
      }
    }
  });
  return changes;
}

/**
 * Ensure game_queue has eligible double-seeding matches, with correct status.
 * Returns the number of rows changed.
 */
async function syncDoubleSeedingQueue(
  db: Database,
  eventId: number,
): Promise<number> {
  const matches = await db.all<{
    id: number;
    status: string;
    team1_id: number | null;
    team2_id: number | null;
  }>(
    `SELECT id, status, team1_id, team2_id FROM double_seeding_matches
     WHERE event_id = ?
     ORDER BY round_number ASC, match_number ASC`,
    [eventId],
  );
  if (matches.length === 0) return 0;

  const acceptedMatches = await db.all<{ double_seeding_match_id: number }>(
    `SELECT DISTINCT double_seeding_match_id
     FROM score_submissions
     WHERE event_id = ?
       AND score_type = 'double_seeding'
       AND status = 'accepted'
       AND double_seeding_match_id IS NOT NULL`,
    [eventId],
  );
  const acceptedSet = new Set(
    acceptedMatches.map((row) => row.double_seeding_match_id),
  );

  const pendingMatches = await db.all<{ double_seeding_match_id: number }>(
    `SELECT DISTINCT double_seeding_match_id
     FROM score_submissions
     WHERE event_id = ?
       AND score_type = 'double_seeding'
       AND status = 'pending'
       AND double_seeding_match_id IS NOT NULL`,
    [eventId],
  );
  const pendingSet = new Set(
    pendingMatches.map((row) => row.double_seeding_match_id),
  );

  const existingRows = await db.all<{
    id: number;
    double_seeding_match_id: number;
    status: string;
  }>(
    `SELECT id, double_seeding_match_id, status FROM game_queue
     WHERE event_id = ? AND queue_type = 'double_seeding'`,
    [eventId],
  );
  const existingByMatchId = new Map(
    existingRows.map((e) => [e.double_seeding_match_id, e]),
  );

  const maxPos = await db.get<{ max_pos: number | null }>(
    'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
    [eventId],
  );
  let nextPos = (maxPos?.max_pos ?? 0) + 1;

  let changes = 0;
  await db.transaction(async (tx) => {
    for (const match of matches) {
      const hasTeam = match.team1_id != null || match.team2_id != null;
      const isEligible = hasTeam && ['ready', 'pending'].includes(match.status);
      const isCompleted =
        match.status === 'completed' || acceptedSet.has(match.id);
      const existing = existingByMatchId.get(match.id);

      if (existing) {
        if (isCompleted) {
          if (pendingSet.has(match.id)) {
            if (existing.status !== 'scored') {
              await tx.run(
                `UPDATE game_queue SET status = 'scored', called_at = NULL, table_number = NULL WHERE id = ?`,
                [existing.id],
              );
              changes++;
            }
          } else {
            await tx.run('DELETE FROM game_queue WHERE id = ?', [existing.id]);
            changes++;
          }
        } else if (
          isEligible &&
          existing.status === 'scored' &&
          !pendingSet.has(match.id)
        ) {
          await tx.run(
            "UPDATE game_queue SET status = 'queued', called_at = NULL, table_number = NULL WHERE id = ?",
            [existing.id],
          );
          changes++;
        } else if (!isEligible && !isCompleted && !hasTeam) {
          await tx.run('DELETE FROM game_queue WHERE id = ?', [existing.id]);
          changes++;
        }
      } else if (isEligible && !isCompleted) {
        await tx.run(
          `INSERT INTO game_queue (event_id, double_seeding_match_id, queue_type, queue_position, status)
           VALUES (?, ?, 'double_seeding', ?, ?)`,
          [
            eventId,
            match.id,
            nextPos++,
            pendingSet.has(match.id) ? 'scored' : 'queued',
          ],
        );
        changes++;
      }
    }
  });
  return changes;
}
