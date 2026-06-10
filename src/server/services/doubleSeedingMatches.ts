/**
 * Service for generating pre-paired double-seeding matches.
 *
 * Double-seeding matches pair two teams on one table/scoresheet, but each
 * team only receives the score from its own side. There is no winner, loser,
 * or advancement.
 */

import type { Database, Transaction } from '../database/connection';

export interface DoubleSeedingPair {
  round: number;
  matchNumber: number;
  team1Id: number;
  /** null = odd-team single-team run */
  team2Id: number | null;
}

export interface GenerateDoubleSeedingResult {
  rounds: number;
  matchesCreated: number;
}

export interface DeleteDoubleSeedingRoundResult {
  round: number;
  deleted: number;
  remainingRounds: number;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build randomized round pairings with the circle (round-robin) method:
 * - every team appears exactly once per round
 * - with an odd team count, one team runs alone each round and the lone team
 *   rotates so it differs between rounds
 * - pairings do not repeat across rounds while the rotation period allows it
 *
 * Exported for tests.
 */
export function buildDoubleSeedingPairings(
  teamIds: number[],
  rounds: number,
): DoubleSeedingPair[] {
  if (teamIds.length === 0) {
    throw new Error('No teams available for double seeding');
  }
  if (rounds < 1) {
    throw new Error('Number of rounds must be at least 1');
  }
  if (rounds > teamIds.length) {
    throw new Error(
      `Number of rounds (${rounds}) cannot exceed the number of teams (${teamIds.length})`,
    );
  }

  // null slot = lone run when the team count is odd
  const slots: (number | null)[] = shuffleInPlace([...teamIds]);
  if (slots.length % 2 === 1) {
    slots.push(null);
  }
  const m = slots.length;

  const pairs: DoubleSeedingPair[] = [];
  for (let r = 0; r < rounds; r++) {
    // Circle method: slot 0 fixed, remaining slots rotate each round.
    const rotated: (number | null)[] = [slots[0]];
    for (let k = 1; k < m; k++) {
      rotated.push(slots[1 + ((k - 1 + r) % (m - 1))]);
    }

    const seen = new Set<number>();
    let matchNumber = 1;
    for (let i = 0; i < m / 2; i++) {
      const a = rotated[i];
      const b = rotated[m - 1 - i];
      if (a === null && b === null) {
        throw new Error('Invalid pairing: empty match generated');
      }

      // Defensive duplicate check before insert (per round).
      for (const teamId of [a, b]) {
        if (teamId !== null) {
          if (seen.has(teamId)) {
            throw new Error(
              `Invalid pairing: team ${teamId} appears twice in round ${r + 1}`,
            );
          }
          seen.add(teamId);
        }
      }

      if (a === null || b === null) {
        pairs.push({
          round: r + 1,
          matchNumber: matchNumber++,
          team1Id: (a ?? b) as number,
          team2Id: null,
        });
      } else {
        // Randomize side assignment so table sides are not deterministic.
        const flip = Math.random() < 0.5;
        pairs.push({
          round: r + 1,
          matchNumber: matchNumber++,
          team1Id: flip ? b : a,
          team2Id: flip ? a : b,
        });
      }
    }
  }

  return pairs;
}

/**
 * True when the event has any double-seeding submissions or accepted scores.
 * Used to block destructive match regeneration/deletion.
 */
export async function hasDoubleSeedingResults(
  db: Database,
  eventId: number,
): Promise<boolean> {
  const score = await db.get<{ id: number }>(
    'SELECT id FROM double_seeding_scores WHERE event_id = ? LIMIT 1',
    [eventId],
  );
  if (score) return true;

  const submission = await db.get<{ id: number }>(
    `SELECT id FROM score_submissions
     WHERE event_id = ? AND score_type = 'double_seeding'
     LIMIT 1`,
    [eventId],
  );
  return !!submission;
}

export async function hasDoubleSeedingRoundResults(
  db: Database,
  eventId: number,
  roundNumber: number,
): Promise<boolean> {
  const score = await db.get<{ id: number }>(
    `SELECT id FROM double_seeding_scores
     WHERE event_id = ? AND round_number = ?
     LIMIT 1`,
    [eventId, roundNumber],
  );
  if (score) return true;

  const submission = await db.get<{ id: number }>(
    `SELECT ss.id
     FROM score_submissions ss
     JOIN double_seeding_matches dsm ON ss.double_seeding_match_id = dsm.id
     WHERE ss.event_id = ?
       AND dsm.event_id = ?
       AND dsm.round_number = ?
     LIMIT 1`,
    [eventId, eventId, roundNumber],
  );
  return !!submission;
}

async function getEventTeamIds(
  db: Database,
  eventId: number,
): Promise<number[]> {
  const teams = await db.all<{ id: number }>(
    'SELECT id FROM teams WHERE event_id = ? ORDER BY team_number ASC',
    [eventId],
  );
  return teams.map((t) => t.id);
}

async function getCurrentDoubleSeedingRound(
  db: Database,
  eventId: number,
): Promise<number> {
  const row = await db.get<{ max_round: number | null }>(
    'SELECT MAX(round_number) as max_round FROM double_seeding_matches WHERE event_id = ?',
    [eventId],
  );
  return row?.max_round ?? 0;
}

async function insertDoubleSeedingPairs(
  tx: Transaction,
  eventId: number,
  pairs: DoubleSeedingPair[],
): Promise<void> {
  for (const pair of pairs) {
    await tx.run(
      `INSERT INTO double_seeding_matches
         (event_id, round_number, match_number, team1_id, team2_id, status)
       VALUES (?, ?, ?, ?, ?, 'ready')`,
      [eventId, pair.round, pair.matchNumber, pair.team1Id, pair.team2Id],
    );
  }
}

/**
 * Generate randomized double-seeding matches for an event.
 * Replaces any existing matches (callers must enforce explicit confirmation)
 * and records the round count on the event.
 */
export async function generateDoubleSeedingMatches(
  db: Database,
  eventId: number,
  rounds: number,
): Promise<GenerateDoubleSeedingResult> {
  const teamIds = await getEventTeamIds(db, eventId);
  const pairs = buildDoubleSeedingPairings(teamIds, rounds);

  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM double_seeding_matches WHERE event_id = ?', [
      eventId,
    ]);
    await insertDoubleSeedingPairs(tx, eventId, pairs);
    await tx.run('UPDATE events SET double_seeding_rounds = ? WHERE id = ?', [
      rounds,
      eventId,
    ]);
  });

  return { rounds, matchesCreated: pairs.length };
}

export async function appendDoubleSeedingRounds(
  db: Database,
  eventId: number,
  targetRounds: number,
): Promise<GenerateDoubleSeedingResult> {
  const currentRounds = await getCurrentDoubleSeedingRound(db, eventId);
  if (targetRounds <= currentRounds) {
    throw new Error(
      `Target rounds (${targetRounds}) must be greater than the current round count (${currentRounds})`,
    );
  }

  const teamIds = await getEventTeamIds(db, eventId);
  if (targetRounds > teamIds.length) {
    throw new Error(
      `Number of rounds (${targetRounds}) cannot exceed the number of teams (${teamIds.length})`,
    );
  }

  const pairs = buildDoubleSeedingPairings(teamIds, targetRounds).filter(
    (pair) => pair.round > currentRounds,
  );

  await db.transaction(async (tx) => {
    await insertDoubleSeedingPairs(tx, eventId, pairs);
    await tx.run('UPDATE events SET double_seeding_rounds = ? WHERE id = ?', [
      targetRounds,
      eventId,
    ]);
  });

  return { rounds: targetRounds, matchesCreated: pairs.length };
}

export async function deleteLastDoubleSeedingRound(
  db: Database,
  eventId: number,
  roundNumber: number,
): Promise<DeleteDoubleSeedingRoundResult> {
  const currentRounds = await getCurrentDoubleSeedingRound(db, eventId);
  if (currentRounds === 0) {
    throw new Error('No double-seeding rounds exist for this event');
  }
  if (roundNumber !== currentRounds) {
    throw new Error(
      `Only the highest-numbered double-seeding round can be deleted. Current last round is ${currentRounds}.`,
    );
  }

  if (await hasDoubleSeedingRoundResults(db, eventId, roundNumber)) {
    throw new Error(
      'Double-seeding submissions or scores already exist for this round. The round cannot be deleted.',
    );
  }

  const remainingRounds = roundNumber - 1;
  const result = await db.transaction(async (tx) => {
    const del = await tx.run(
      'DELETE FROM double_seeding_matches WHERE event_id = ? AND round_number = ?',
      [eventId, roundNumber],
    );
    await tx.run('UPDATE events SET double_seeding_rounds = ? WHERE id = ?', [
      remainingRounds,
      eventId,
    ]);
    return del;
  });

  return {
    round: roundNumber,
    deleted: result.changes ?? 0,
    remainingRounds,
  };
}
