import type { Database } from '../database/connection';
import {
  bumpQueueVersion,
  clearQueueDirty,
  getQueueVersionState,
} from './queueVersion';
import {
  BRACKET_INTERLEAVE_ORDER_SQL,
  BracketQueueOrder,
  mergeBracketQueueItems,
} from './bracketQueueOrder';

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
            `UPDATE game_queue
             SET status = 'queued', called_at = NULL, table_number = NULL,
                 present_team1_id = NULL, present_team2_id = NULL
             WHERE id = ?`,
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

  const allGames = await db.all<
    BracketQueueOrder & {
      id: number;
      status: string;
      team1_id: number | null;
      team2_id: number | null;
    }
  >(
    `SELECT bg.id, bg.bracket_id, b.bracket_size, bg.game_number,
            bg.play_order, bg.status, bg.team1_id, bg.team2_id
     FROM bracket_games bg
     JOIN brackets b ON b.id = bg.bracket_id
     WHERE b.event_id = ?
     ORDER BY ${BRACKET_INTERLEAVE_ORDER_SQL}`,
    [eventId],
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

  interface ExistingQueueItem {
    id: number;
    bracket_game_id: number | null;
    queue_type: string;
    queue_position: number;
    status: string;
    bracketOrder: BracketQueueOrder | null;
    newBracketGameId: number | null;
  }

  const existingQueueRows = await db.all<
    Omit<ExistingQueueItem, 'bracketOrder' | 'newBracketGameId'> &
      Partial<BracketQueueOrder>
  >(
    `SELECT gq.id, gq.bracket_game_id, gq.queue_type, gq.queue_position,
            gq.status, bg.bracket_id, b.bracket_size, bg.game_number,
            bg.play_order
     FROM game_queue gq
     LEFT JOIN bracket_games bg ON bg.id = gq.bracket_game_id
     LEFT JOIN brackets b ON b.id = bg.bracket_id
     WHERE gq.event_id = ?
     ORDER BY gq.queue_position ASC, gq.id ASC`,
    [eventId],
  );
  const existingQueue: ExistingQueueItem[] = existingQueueRows.map((row) => ({
    id: row.id,
    bracket_game_id: row.bracket_game_id,
    queue_type: row.queue_type,
    queue_position: row.queue_position,
    status: row.status,
    bracketOrder:
      row.queue_type === 'bracket' &&
      row.bracket_id !== undefined &&
      row.bracket_size !== undefined &&
      row.game_number !== undefined
        ? {
            bracket_id: row.bracket_id,
            bracket_size: row.bracket_size,
            game_number: row.game_number,
            play_order: row.play_order ?? null,
          }
        : null,
    newBracketGameId: null,
  }));
  const existingBracket = existingQueue.filter(
    (row) => row.queue_type === 'bracket' && row.bracket_game_id !== null,
  );
  const existingByGameId = new Map(
    existingBracket.map((row) => [row.bracket_game_id!, row]),
  );

  const deleteIds = new Set<number>();
  const statusUpdates: Array<{ id: number; status: 'queued' | 'scored' }> = [];
  const newGames: ExistingQueueItem[] = [];

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
            statusUpdates.push({ id: existing.id, status: 'scored' });
          }
        } else {
          deleteIds.add(existing.id);
        }
      } else if (
        isEligible &&
        existing.status === 'scored' &&
        !pendingBracketSet.has(game.id)
      ) {
        statusUpdates.push({ id: existing.id, status: 'queued' });
      } else if (
        !isEligible &&
        !isCompleted &&
        (game.team1_id == null || game.team2_id == null)
      ) {
        deleteIds.add(existing.id);
      }
    } else if (isEligible && !isCompleted) {
      newGames.push({
        id: -game.id,
        bracket_game_id: game.id,
        queue_type: 'bracket',
        queue_position: -1,
        status: 'queued',
        bracketOrder: {
          bracket_id: game.bracket_id,
          bracket_size: game.bracket_size,
          game_number: game.game_number,
          play_order: game.play_order,
        },
        newBracketGameId: game.id,
      });
    }
  }

  const sequenceChanged = deleteIds.size > 0 || newGames.length > 0;
  const survivingQueue = existingQueue.filter((row) => !deleteIds.has(row.id));
  const finalQueue = sequenceChanged
    ? mergeBracketQueueItems(survivingQueue, newGames)
    : survivingQueue;

  let changes = 0;
  await db.transaction(async (tx) => {
    for (const update of statusUpdates) {
      const clearPresence =
        update.status === 'queued'
          ? ', present_team1_id = NULL, present_team2_id = NULL'
          : '';
      const result = await tx.run(
        `UPDATE game_queue
         SET status = ?, called_at = NULL, table_number = NULL${clearPresence}
         WHERE id = ?`,
        [update.status, update.id],
      );
      changes += result.changes ?? 0;
    }

    for (const id of deleteIds) {
      const result = await tx.run('DELETE FROM game_queue WHERE id = ?', [id]);
      changes += result.changes ?? 0;
    }

    for (let index = 0; index < finalQueue.length; index++) {
      const row = finalQueue[index];
      const queuePosition = index + 1;

      if (row.newBracketGameId !== null) {
        const result = await tx.run(
          `INSERT INTO game_queue (
             event_id, bracket_game_id, queue_type, queue_position, status
           ) VALUES (?, ?, 'bracket', ?, 'queued')`,
          [eventId, row.newBracketGameId, queuePosition],
        );
        changes += result.changes ?? 0;
      } else if (sequenceChanged && row.queue_position !== queuePosition) {
        const result = await tx.run(
          'UPDATE game_queue SET queue_position = ? WHERE id = ?',
          [queuePosition, row.id],
        );
        changes += result.changes ?? 0;
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
            `UPDATE game_queue
             SET status = 'queued', called_at = NULL, table_number = NULL,
                 present_team1_id = NULL, present_team2_id = NULL
             WHERE id = ?`,
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
