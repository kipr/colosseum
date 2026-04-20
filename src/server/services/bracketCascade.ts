import type { Database } from '../database/connection';

/**
 * Represents an affected slot in a downstream bracket game.
 * A single game can have multiple affected slots (e.g., both team1 and winner).
 */
export type AffectedSlot = 'team1' | 'team2' | 'winner';

/**
 * Details about a downstream game affected by reverting a source game.
 */
export interface AffectedBracketGame {
  id: number;
  game_number: number;
  round_name: string;
  /** All slots that need to be cleared in this game */
  affectedSlots: AffectedSlot[];
}

export interface FlatAffectedSlot {
  id: number;
  game_number: number;
  round_name: string;
  affectedSlot: AffectedSlot;
}

/**
 * Parse a team source string (e.g., "winner:5", "loser:3", "seed:1").
 * Returns the source type and game number, or null if not a game reference.
 */
function parseTeamSource(
  source: string | null,
): { type: 'winner' | 'loser'; gameNumber: number } | null {
  if (!source) return null;
  const match = source.match(/^(winner|loser):(\d+)$/);
  if (!match) return null;
  return {
    type: match[1] as 'winner' | 'loser',
    gameNumber: parseInt(match[2], 10),
  };
}

/**
 * Find all downstream bracket games affected by reverting a game.
 *
 * This performs a complete forward traversal of the bracket graph starting from
 * the reverted game, following both winner and loser advancement edges. The
 * function uses **structural dependency tracking**: a game is affected if its
 * team1_source or team2_source references a "corrupted" game (one whose result
 * is now invalid).
 *
 * Algorithm:
 * 1. Start with the reverted game as the only "corrupted" game
 * 2. BFS through all downstream games via winner/loser advancement edges
 * 3. For each downstream game, check if team1_source or team2_source references
 *    a corrupted game_number (e.g., "winner:5" where game 5 is corrupted)
 * 4. If a slot is structurally affected, the game's result is also invalid,
 *    so add this game_number to the corrupted set
 * 5. If a game has an affected slot AND a recorded result, mark 'winner' as
 *    affected too (wrong participants = wrong result)
 *
 * This is "surgical" - only games with actual structural dependencies are marked,
 * avoiding false positives from team ID matching while ensuring we catch the
 * full corruption cascade.
 *
 * @param db Database connection (should be called within a transaction for consistency)
 * @param bracketId The bracket containing the game
 * @param gameId The game being reverted
 * @returns Array of affected games with their affected slots
 */
export async function findAffectedBracketGames(
  db: Database,
  bracketId: number,
  gameId: number,
): Promise<AffectedBracketGame[]> {
  const allGames = await db.all(
    'SELECT * FROM bracket_games WHERE bracket_id = ?',
    [bracketId],
  );

  const gamesById = new Map<number, (typeof allGames)[0]>();
  const gamesByGameNumber = new Map<number, (typeof allGames)[0]>();

  // Reverse lookup: for each game, which source games feed into its slots
  // via advancement pointers (winner_advances_to_id/loser_advances_to_id + slot)
  const slotSources = new Map<
    number,
    { team1Sources: Set<number>; team2Sources: Set<number> }
  >();

  for (const game of allGames) {
    gamesById.set(game.id, game);
    gamesByGameNumber.set(game.game_number, game);

    if (game.winner_advances_to_id) {
      if (!slotSources.has(game.winner_advances_to_id)) {
        slotSources.set(game.winner_advances_to_id, {
          team1Sources: new Set(),
          team2Sources: new Set(),
        });
      }
      const slot = game.winner_slot as 'team1' | 'team2' | null;
      if (slot === 'team1') {
        slotSources.get(game.winner_advances_to_id)!.team1Sources.add(game.id);
      } else if (slot === 'team2') {
        slotSources.get(game.winner_advances_to_id)!.team2Sources.add(game.id);
      }
    }
    if (game.loser_advances_to_id) {
      if (!slotSources.has(game.loser_advances_to_id)) {
        slotSources.set(game.loser_advances_to_id, {
          team1Sources: new Set(),
          team2Sources: new Set(),
        });
      }
      const slot = game.loser_slot as 'team1' | 'team2' | null;
      if (slot === 'team1') {
        slotSources.get(game.loser_advances_to_id)!.team1Sources.add(game.id);
      } else if (slot === 'team2') {
        slotSources.get(game.loser_advances_to_id)!.team2Sources.add(game.id);
      }
    }
  }

  const sourceGame = gamesById.get(gameId);
  if (!sourceGame) return [];

  const corruptedGameIds = new Set<number>();
  corruptedGameIds.add(gameId);

  const corruptedGameNumbers = new Set<number>();
  corruptedGameNumbers.add(sourceGame.game_number);

  const visited = new Set<number>();
  const affected: AffectedBracketGame[] = [];
  const queue: number[] = [];

  if (sourceGame.winner_advances_to_id) {
    queue.push(sourceGame.winner_advances_to_id);
  }
  if (sourceGame.loser_advances_to_id) {
    queue.push(sourceGame.loser_advances_to_id);
  }

  while (queue.length > 0) {
    const nextGameId = queue.shift()!;
    if (visited.has(nextGameId)) continue;
    visited.add(nextGameId);

    const game = gamesById.get(nextGameId);
    if (!game) continue;

    const affectedSlots: AffectedSlot[] = [];

    const team1Src = parseTeamSource(game.team1_source);
    if (team1Src && corruptedGameNumbers.has(team1Src.gameNumber)) {
      affectedSlots.push('team1');
    }

    const team2Src = parseTeamSource(game.team2_source);
    if (team2Src && corruptedGameNumbers.has(team2Src.gameNumber)) {
      affectedSlots.push('team2');
    }

    const sources = slotSources.get(nextGameId);
    if (sources) {
      for (const srcGameId of sources.team1Sources) {
        if (
          corruptedGameIds.has(srcGameId) &&
          !affectedSlots.includes('team1')
        ) {
          affectedSlots.push('team1');
        }
      }
      for (const srcGameId of sources.team2Sources) {
        if (
          corruptedGameIds.has(srcGameId) &&
          !affectedSlots.includes('team2')
        ) {
          affectedSlots.push('team2');
        }
      }
    }

    if (affectedSlots.length > 0 && game.winner_id) {
      affectedSlots.push('winner');
    }

    if (affectedSlots.length > 0) {
      affected.push({
        id: game.id,
        game_number: game.game_number,
        round_name: game.round_name || `Round ${game.round_number}`,
        affectedSlots,
      });

      corruptedGameIds.add(game.id);
      corruptedGameNumbers.add(game.game_number);
    }

    if (
      game.winner_advances_to_id &&
      !visited.has(game.winner_advances_to_id)
    ) {
      queue.push(game.winner_advances_to_id);
    }
    if (game.loser_advances_to_id && !visited.has(game.loser_advances_to_id)) {
      queue.push(game.loser_advances_to_id);
    }
  }

  // Stabilization: BFS may visit a game before all its source games are
  // corrupted (e.g., Grand Final reached via the shorter winners path before
  // the longer redemption path is fully processed). Re-scan visited games
  // to catch any slots missed due to ordering.
  let stabilized = false;
  while (!stabilized) {
    stabilized = true;
    for (const visitedId of visited) {
      const game = gamesById.get(visitedId);
      if (!game) continue;

      const existingIdx = affected.findIndex((a) => a.id === visitedId);
      const currentSlots: AffectedSlot[] =
        existingIdx >= 0 ? affected[existingIdx].affectedSlots : [];

      const newSlots: AffectedSlot[] = [];

      const t1 = parseTeamSource(game.team1_source);
      if (
        t1 &&
        corruptedGameNumbers.has(t1.gameNumber) &&
        !currentSlots.includes('team1')
      ) {
        newSlots.push('team1');
      }

      const t2 = parseTeamSource(game.team2_source);
      if (
        t2 &&
        corruptedGameNumbers.has(t2.gameNumber) &&
        !currentSlots.includes('team2')
      ) {
        newSlots.push('team2');
      }

      const srcEntry = slotSources.get(visitedId);
      if (srcEntry) {
        for (const srcId of srcEntry.team1Sources) {
          if (
            corruptedGameIds.has(srcId) &&
            !currentSlots.includes('team1') &&
            !newSlots.includes('team1')
          ) {
            newSlots.push('team1');
          }
        }
        for (const srcId of srcEntry.team2Sources) {
          if (
            corruptedGameIds.has(srcId) &&
            !currentSlots.includes('team2') &&
            !newSlots.includes('team2')
          ) {
            newSlots.push('team2');
          }
        }
      }

      if (
        newSlots.length > 0 &&
        game.winner_id &&
        !currentSlots.includes('winner')
      ) {
        newSlots.push('winner');
      }

      if (newSlots.length > 0) {
        if (existingIdx >= 0) {
          affected[existingIdx].affectedSlots.push(...newSlots);
        } else {
          affected.push({
            id: game.id,
            game_number: game.game_number,
            round_name: game.round_name || `Round ${game.round_number}`,
            affectedSlots: newSlots,
          });
        }
        if (!corruptedGameIds.has(game.id)) {
          corruptedGameIds.add(game.id);
          corruptedGameNumbers.add(game.game_number);
          stabilized = false;
        }
      }
    }
  }

  return affected;
}

/**
 * Legacy adapter: returns affected games in the old single-slot format.
 * Used for backward compatibility with API consumers that expect a flat list.
 */
export function flattenAffectedSlots(
  affected: AffectedBracketGame[],
): FlatAffectedSlot[] {
  const result: FlatAffectedSlot[] = [];
  for (const game of affected) {
    for (const slot of game.affectedSlots) {
      result.push({
        id: game.id,
        game_number: game.game_number,
        round_name: game.round_name,
        affectedSlot: slot,
      });
    }
  }
  return result;
}
