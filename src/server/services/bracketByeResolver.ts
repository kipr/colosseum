import { Database } from '../database/connection';

/**
 * Result of a bye resolution pass.
 */
export interface ByeResolutionResult {
  byeGamesResolved: number;
  slotsFilled: number;
  readyGamesUpdated: number;
}

/**
 * Represents a game row from the database with fields we need for resolution.
 */
interface GameRow {
  id: number;
  game_number: number;
  status: string;
  team1_id: number | null;
  team2_id: number | null;
  team1_source: string | null;
  team2_source: string | null;
  winner_id: number | null;
  loser_id: number | null;
  winner_advances_to_id: number | null;
  loser_advances_to_id: number | null;
  winner_slot: string | null;
  loser_slot: string | null;
}

/**
 * Represents a bracket entry (seed position -> team mapping).
 */
interface EntryRow {
  seed_position: number;
  team_id: number | null;
  is_bye: number; // SQLite stores booleans as 0/1
}

/**
 * Resolves bye chains in a bracket by:
 * 1. Filling any missing team slots that can be derived from resolved sources
 * 2. Detecting implicit byes (games where one side is impossible)
 * 3. Marking bye games as resolved and propagating winners forward
 * 4. Updating pending games to ready when both teams are present
 *
 * This function is idempotent and will loop until no more changes are made.
 *
 * @param db - Database connection
 * @param bracketId - The bracket to resolve
 * @returns Statistics about what was resolved
 */
export async function resolveBracketByes(
  db: Database,
  bracketId: number,
): Promise<ByeResolutionResult> {
  const result: ByeResolutionResult = {
    byeGamesResolved: 0,
    slotsFilled: 0,
    readyGamesUpdated: 0,
  };

  // Load bracket entries for seed mapping
  const entries = await db.all<EntryRow>(
    'SELECT seed_position, team_id, is_bye FROM bracket_entries WHERE bracket_id = ?',
    [bracketId],
  );

  const entriesBySeed = new Map<
    number,
    { team_id: number | null; is_bye: boolean }
  >();
  for (const entry of entries) {
    entriesBySeed.set(entry.seed_position, {
      team_id: entry.team_id,
      is_bye: entry.is_bye === 1,
    });
  }

  // Max iterations to prevent infinite loops (should never need more than total games)
  const maxIterations = 200;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    let changesThisIteration = 0;

    // Load all games for this bracket
    const games = await db.all<GameRow>(
      `SELECT id, game_number, status, team1_id, team2_id, team1_source, team2_source,
              winner_id, loser_id, winner_advances_to_id, loser_advances_to_id,
              winner_slot, loser_slot
       FROM bracket_games WHERE bracket_id = ?`,
      [bracketId],
    );

    // Build a map of game_number -> game for quick source lookups
    const gamesByNumber = new Map<number, GameRow>();
    const gamesById = new Map<number, GameRow>();
    for (const game of games) {
      gamesByNumber.set(game.game_number, game);
      gamesById.set(game.id, game);
    }

    // Process each game that isn't already completed or bye
    for (const game of games) {
      if (game.status === 'completed' || game.status === 'bye') {
        continue;
      }

      // Step 1: Try to fill missing team slots from resolved sources
      const team1Resolved = resolveSource(
        game.team1_source,
        entriesBySeed,
        gamesByNumber,
        { currentGame: game, slot: 'team1' },
      );
      const team2Resolved = resolveSource(
        game.team2_source,
        entriesBySeed,
        gamesByNumber,
        { currentGame: game, slot: 'team2' },
      );

      // Fill team1 if missing and we have a resolved value
      if (game.team1_id === null && team1Resolved.resolved) {
        if (team1Resolved.team_id !== null) {
          await db.run('UPDATE bracket_games SET team1_id = ? WHERE id = ?', [
            team1Resolved.team_id,
            game.id,
          ]);
          game.team1_id = team1Resolved.team_id;
          result.slotsFilled++;
          changesThisIteration++;
        }
      }

      // Fill team2 if missing and we have a resolved value
      if (game.team2_id === null && team2Resolved.resolved) {
        if (team2Resolved.team_id !== null) {
          await db.run('UPDATE bracket_games SET team2_id = ? WHERE id = ?', [
            team2Resolved.team_id,
            game.id,
          ]);
          game.team2_id = team2Resolved.team_id;
          result.slotsFilled++;
          changesThisIteration++;
        }
      }

      // Step 2: Detect implicit byes
      // A game is an implicit bye if:
      // - Exactly one team is present (or resolvable to a team)
      // - The other side is resolved to "impossible" (null and source is resolved)
      const team1Present = game.team1_id !== null;
      const team2Present = game.team2_id !== null;
      const team1Impossible =
        team1Resolved.resolved && team1Resolved.team_id === null;
      const team2Impossible =
        team2Resolved.resolved && team2Resolved.team_id === null;

      // Case: team1 is present, team2 is impossible -> team1 wins by bye
      if (team1Present && !team2Present && team2Impossible) {
        await markGameAsBye(db, game, game.team1_id!, gamesById);
        result.byeGamesResolved++;
        changesThisIteration++;
        continue;
      }

      // Case: team2 is present, team1 is impossible -> team2 wins by bye
      if (team2Present && !team1Present && team1Impossible) {
        await markGameAsBye(db, game, game.team2_id!, gamesById);
        result.byeGamesResolved++;
        changesThisIteration++;
        continue;
      }

      // Case: both sides are impossible (shouldn't happen, but handle gracefully)
      if (team1Impossible && team2Impossible) {
        // Mark as bye with no winner - this propagates "impossibility" forward
        await db.run(
          `UPDATE bracket_games SET status = 'bye', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [game.id],
        );
        changesThisIteration++;
        continue;
      }

      // Step 3: Update pending -> ready if both teams are now present
      if (
        game.status === 'pending' &&
        game.team1_id !== null &&
        game.team2_id !== null
      ) {
        await db.run(`UPDATE bracket_games SET status = 'ready' WHERE id = ?`, [
          game.id,
        ]);
        result.readyGamesUpdated++;
        changesThisIteration++;
      }
    }

    // If no changes were made this iteration, we've reached a stable state
    if (changesThisIteration === 0) {
      break;
    }
  }

  if (iteration >= maxIterations) {
    console.warn(
      `resolveBracketByes: hit max iterations (${maxIterations}) for bracket ${bracketId}`,
    );
  }

  return result;
}

/**
 * Result of resolving a source string.
 */
interface SourceResolution {
  /** Whether the source could be resolved (true) or is still pending (false) */
  resolved: boolean;
  /** The team_id if resolved and a team exists, or null if resolved to "no team" (bye) */
  team_id: number | null;
}

/** Context for source resolution (championship reset logic). */
interface ResolveSourceContext {
  currentGame: GameRow;
  slot: 'team1' | 'team2';
}

/**
 * Resolve a team source string to a team_id or determine if it's impossible.
 *
 * @param source - Source string like 'seed:1', 'winner:5', 'loser:3'
 * @param entriesBySeed - Map of seed positions to team entries
 * @param gamesByNumber - Map of game numbers to game rows
 * @param context - Optional context for championship reset: when winners bracket
 *   wins the grand final, the loser is dropped and the winner gets a bye
 * @returns Resolution result
 */
function resolveSource(
  source: string | null,
  entriesBySeed: Map<number, { team_id: number | null; is_bye: boolean }>,
  gamesByNumber: Map<number, GameRow>,
  context?: ResolveSourceContext,
): SourceResolution {
  if (!source) {
    return { resolved: false, team_id: null };
  }

  // Handle seed:X sources
  if (source.startsWith('seed:')) {
    const seedNum = parseInt(source.split(':')[1], 10);
    const entry = entriesBySeed.get(seedNum);
    if (entry) {
      // Seed is resolved - either to a team or to null (bye)
      return { resolved: true, team_id: entry.team_id };
    }
    // Seed entry doesn't exist - treat as impossible
    return { resolved: true, team_id: null };
  }

  // Handle winner:X sources
  if (source.startsWith('winner:')) {
    const gameNum = parseInt(source.split(':')[1], 10);
    const sourceGame = gamesByNumber.get(gameNum);
    if (!sourceGame) {
      // Source game doesn't exist - impossible
      return { resolved: true, team_id: null };
    }
    // Only resolved if source game is decided
    if (sourceGame.status === 'completed' || sourceGame.status === 'bye') {
      return { resolved: true, team_id: sourceGame.winner_id };
    }
    // Source game not yet decided
    return { resolved: false, team_id: null };
  }

  // Handle loser:X sources
  if (source.startsWith('loser:')) {
    const gameNum = parseInt(source.split(':')[1], 10);
    const sourceGame = gamesByNumber.get(gameNum);
    if (!sourceGame) {
      // Source game doesn't exist - impossible
      return { resolved: true, team_id: null };
    }
    // Only resolved if source game is decided
    if (sourceGame.status === 'completed' || sourceGame.status === 'bye') {
      // Championship reset: when winners bracket wins the grand final, the loser
      // is dropped and the winner gets a bye. Detect this by: current game has
      // team1_source=winner:X and team2_source=loser:X (same X), and grand final
      // winner is team1 (winners bracket).
      if (context?.slot === 'team2' && context.currentGame.team1_source) {
        const team1SrcMatch = context.currentGame.team1_source.match(/^winner:(\d+)$/);
        if (team1SrcMatch && parseInt(team1SrcMatch[1], 10) === gameNum) {
          const winnersBracketWon =
            sourceGame.winner_id !== null &&
            sourceGame.winner_id === sourceGame.team1_id;
          if (winnersBracketWon) {
            return { resolved: true, team_id: null };
          }
        }
      }
      // Note: bye games have loser_id = null, which is correct (no loser exists)
      return { resolved: true, team_id: sourceGame.loser_id };
    }
    // Source game not yet decided
    return { resolved: false, team_id: null };
  }

  // Unknown source format
  return { resolved: false, team_id: null };
}

/**
 * Mark a game as a bye and propagate the winner forward.
 *
 * @param db - Database connection
 * @param game - The game to mark as bye
 * @param winnerId - The team that wins by bye
 * @param gamesById - Map of game ids to game rows (for slot assignment)
 */
async function markGameAsBye(
  db: Database,
  game: GameRow,
  winnerId: number,
  gamesById: Map<number, GameRow>,
): Promise<void> {
  // Update the game as a bye with the winner
  await db.run(
    `UPDATE bracket_games SET status = 'bye', winner_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [winnerId, game.id],
  );

  // Propagate winner forward to the next game
  if (game.winner_advances_to_id && game.winner_slot) {
    const column = game.winner_slot === 'team1' ? 'team1_id' : 'team2_id';
    await db.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
      winnerId,
      game.winner_advances_to_id,
    ]);

    // Update the local cache so subsequent iterations see the change
    const destGame = gamesById.get(game.winner_advances_to_id);
    if (destGame) {
      if (game.winner_slot === 'team1') {
        destGame.team1_id = winnerId;
      } else {
        destGame.team2_id = winnerId;
      }
    }
  }

  // Note: We don't propagate a loser because bye games have no loser
}
