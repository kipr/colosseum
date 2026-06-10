/**
 * Service for generating pre-paired double-seeding matches.
 *
 * Double-seeding matches pair two teams on one table/scoresheet, but each
 * team only receives the score from its own side. There is no winner, loser,
 * or advancement.
 */

import type { Database } from '../database/connection';

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
  const teams = await db.all<{ id: number }>(
    'SELECT id FROM teams WHERE event_id = ? ORDER BY team_number ASC',
    [eventId],
  );
  const pairs = buildDoubleSeedingPairings(
    teams.map((t) => t.id),
    rounds,
  );

  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM double_seeding_matches WHERE event_id = ?', [
      eventId,
    ]);
    for (const pair of pairs) {
      await tx.run(
        `INSERT INTO double_seeding_matches
           (event_id, round_number, match_number, team1_id, team2_id, status)
         VALUES (?, ?, ?, ?, ?, 'ready')`,
        [eventId, pair.round, pair.matchNumber, pair.team1Id, pair.team2Id],
      );
    }
    await tx.run('UPDATE events SET double_seeding_rounds = ? WHERE id = ?', [
      rounds,
      eventId,
    ]);
  });

  return { rounds, matchesCreated: pairs.length };
}
