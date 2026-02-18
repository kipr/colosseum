import express from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import type { Database } from '../database/connection';
import { createAuditEntry } from './audit';
import { toAuditJson } from '../utils/auditJson';
import { resolveBracketByes } from '../services/bracketByeResolver';

const router = express.Router();

/** Mark seeding queue item completed on accept, or queued on revert. Inserts if missing. */
async function updateSeedingQueueItem(
  db: Database,
  eventId: number,
  teamId: number,
  roundNumber: number,
  completed: boolean,
): Promise<void> {
  const existing = await db.get<{ id: number }>(
    `SELECT id FROM game_queue WHERE event_id = ? AND seeding_team_id = ? AND seeding_round = ? AND queue_type = 'seeding'`,
    [eventId, teamId, roundNumber],
  );
  if (existing) {
    await db.run(
      `UPDATE game_queue SET status = ?, called_at = NULL, table_number = NULL WHERE id = ?`,
      [completed ? 'completed' : 'queued', existing.id],
    );
  } else {
    const maxPos = await db.get<{ max_pos: number | null }>(
      'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
      [eventId],
    );
    const pos = (maxPos?.max_pos ?? 0) + 1;
    await db.run(
      `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
       VALUES (?, ?, ?, 'seeding', ?, ?)`,
      [eventId, teamId, roundNumber, pos, completed ? 'completed' : 'queued'],
    );
  }
}

/** Mark bracket queue item completed on accept, or queued on revert. Inserts if missing. */
async function updateBracketQueueItem(
  db: Database,
  eventId: number,
  bracketGameId: number,
  completed: boolean,
): Promise<void> {
  const existing = await db.get<{ id: number }>(
    `SELECT id FROM game_queue WHERE event_id = ? AND bracket_game_id = ? AND queue_type = 'bracket'`,
    [eventId, bracketGameId],
  );
  if (existing) {
    await db.run(
      `UPDATE game_queue SET status = ?, called_at = NULL, table_number = NULL WHERE id = ?`,
      [completed ? 'completed' : 'queued', existing.id],
    );
  } else {
    const maxPos = await db.get<{ max_pos: number | null }>(
      'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
      [eventId],
    );
    const pos = (maxPos?.max_pos ?? 0) + 1;
    await db.run(
      `INSERT INTO game_queue (event_id, bracket_game_id, queue_type, queue_position, status)
       VALUES (?, ?, 'bracket', ?, ?)`,
      [eventId, bracketGameId, pos, completed ? 'completed' : 'queued'],
    );
  }
}

// Get scores filtered by event (admin-only, paginated)
router.get(
  '/by-event/:eventId',
  requireAdmin,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { eventId } = req.params;
      const {
        status,
        score_type,
        page = '1',
        limit = '50',
      } = req.query as {
        status?: string;
        score_type?: string;
        page?: string;
        limit?: string;
      };

      const db = await getDatabase();

      // Validate event exists
      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventId,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // Parse pagination params
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (pageNum - 1) * limitNum;

      // Build WHERE conditions
      const conditions: string[] = ['s.event_id = ?'];
      const params: (string | number)[] = [parseInt(eventId, 10)];

      if (status && ['pending', 'accepted', 'rejected'].includes(status)) {
        conditions.push('s.status = ?');
        params.push(status);
      }

      if (score_type && ['seeding', 'bracket'].includes(score_type)) {
        conditions.push('s.score_type = ?');
        params.push(score_type);
      }

      const whereClause = conditions.join(' AND ');

      // Count total matching rows
      const countResult = await db.get(
        `SELECT COUNT(*) as count FROM score_submissions s WHERE ${whereClause}`,
        params,
      );
      const totalCount = countResult?.count || 0;
      const totalPages = Math.ceil(totalCount / limitNum);

      // Fetch rows with joins for display fields
      const scores = await db.all(
        `SELECT 
          s.*,
          t.name as template_name,
          submitter.name as submitted_by,
          reviewer.name as reviewer_name,
          b.name as bracket_name,
          bg.game_number,
          gq.queue_position,
          ss.round_number as seeding_round,
          seeding_team.team_number as team_display_number,
          seeding_team.team_name as team_name
        FROM score_submissions s
        LEFT JOIN scoresheet_templates t ON s.template_id = t.id
        LEFT JOIN users submitter ON s.user_id = submitter.id
        LEFT JOIN users reviewer ON s.reviewed_by = reviewer.id
        LEFT JOIN game_queue gq ON s.game_queue_id = gq.id
        LEFT JOIN bracket_games bg ON s.bracket_game_id = bg.id
        LEFT JOIN brackets b ON bg.bracket_id = b.id
        LEFT JOIN seeding_scores ss ON s.seeding_score_id = ss.id
        LEFT JOIN teams seeding_team ON ss.team_id = seeding_team.id
        WHERE ${whereClause}
        ORDER BY s.created_at DESC
        LIMIT ? OFFSET ?`,
        [...params, limitNum, offset],
      );

      // Parse score_data JSON for each row
      scores.forEach((score) => {
        if (score.score_data) {
          try {
            score.score_data = JSON.parse(score.score_data);
          } catch {
            // Keep as string if invalid JSON
          }
        }
      });

      res.json({
        rows: scores,
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages,
      });
    } catch (error) {
      console.error('Error fetching scores by event:', error);
      res.status(500).json({ error: 'Failed to fetch scores' });
    }
  },
);

// Accept event-scoped score (admin-only, DB-only, no sheets)
router.post(
  '/:id/accept-event',
  requireAdmin,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const { force } = req.body as { force?: boolean };
      const db = await getDatabase();

      // Get the score submission
      const score = await db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [id],
      );
      if (!score) {
        return res.status(404).json({ error: 'Score submission not found' });
      }

      // Verify this is an event-scoped score
      if (!score.event_id) {
        return res.status(400).json({
          error:
            'This score is not event-scoped. Use the standard accept endpoint.',
        });
      }

      if (score.status === 'accepted') {
        return res.status(400).json({ error: 'Score is already accepted' });
      }

      const scoreData = JSON.parse(score.score_data);
      const scoreType = score.score_type;

      // Handle seeding score acceptance
      if (scoreType === 'seeding') {
        const teamId = scoreData.team_id?.value;
        const roundNumber =
          scoreData.round?.value || scoreData.round_number?.value;
        const scoreValue =
          scoreData.grand_total?.value ?? scoreData.score?.value;

        if (!teamId || !roundNumber) {
          return res.status(400).json({
            error: 'Seeding score must have team_id and round_number',
          });
        }

        // Check for conflict
        const existingScore = await db.get(
          'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
          [teamId, roundNumber],
        );

        if (existingScore && existingScore.score !== null && !force) {
          return res.status(409).json({
            error:
              'A score already exists for this team/round. Use force=true to override.',
            existingScore: existingScore.score,
            newScore: scoreValue,
          });
        }

        // Upsert seeding score within transaction
        await db.transaction((tx) => {
          tx.run(
            `INSERT INTO seeding_scores (team_id, round_number, score, score_submission_id, scored_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(team_id, round_number) DO UPDATE SET
               score = excluded.score,
               score_submission_id = excluded.score_submission_id,
               scored_at = CURRENT_TIMESTAMP`,
            [teamId, roundNumber, scoreValue, id],
          );

          // Update score submission status
          tx.run(
            `UPDATE score_submissions 
             SET status = 'accepted', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [req.user.id, id],
          );
        });

        // Get the seeding score ID and link it back
        const seedingScore = await db.get(
          'SELECT id FROM seeding_scores WHERE team_id = ? AND round_number = ?',
          [teamId, roundNumber],
        );

        if (seedingScore) {
          await db.run(
            'UPDATE score_submissions SET seeding_score_id = ? WHERE id = ?',
            [seedingScore.id, id],
          );
        }

        const updatedScore = await db.get(
          'SELECT * FROM score_submissions WHERE id = ?',
          [id],
        );
        await createAuditEntry(db, {
          event_id: score.event_id,
          user_id: req.user?.id ?? null,
          action: 'score_accepted',
          entity_type: 'score_submission',
          entity_id: Number(id),
          old_value: toAuditJson(score),
          new_value: toAuditJson(updatedScore),
          ip_address: req.ip ?? null,
        });

        await updateSeedingQueueItem(
          db,
          score.event_id,
          teamId,
          roundNumber,
          true,
        );

        return res.json({
          success: true,
          scoreType: 'seeding',
          seedingScoreId: seedingScore?.id,
        });
      }

      // Handle bracket score acceptance
      if (scoreType === 'bracket') {
        const bracketGameId = score.bracket_game_id;
        const winnerTeamId =
          scoreData.winner_team_id?.value || scoreData.winner_id?.value;
        const team1Score = scoreData.team1_score?.value;
        const team2Score = scoreData.team2_score?.value;

        if (!bracketGameId) {
          return res.status(400).json({
            error: 'Bracket score must have bracket_game_id linked',
          });
        }

        if (!winnerTeamId) {
          return res.status(400).json({
            error:
              'Bracket score must specify a winner (winner_team_id or winner_id)',
          });
        }

        // Get the game
        const game = await db.get('SELECT * FROM bracket_games WHERE id = ?', [
          bracketGameId,
        ]);

        if (!game) {
          return res.status(404).json({ error: 'Bracket game not found' });
        }

        // Verify winner is one of the teams
        if (game.team1_id !== winnerTeamId && game.team2_id !== winnerTeamId) {
          return res.status(400).json({
            error: 'Winner must be one of the teams in the game',
          });
        }

        // Check for conflict
        if (game.winner_id && game.winner_id !== winnerTeamId && !force) {
          return res.status(409).json({
            error:
              'Game already has a different winner. Use force=true to override.',
            existingWinnerId: game.winner_id,
            newWinnerId: winnerTeamId,
          });
        }

        const loserId =
          game.team1_id === winnerTeamId ? game.team2_id : game.team1_id;

        // Prepare advancement updates
        const updates: { gameId: number; slot: string; teamId: number }[] = [];

        if (game.winner_advances_to_id && game.winner_slot) {
          updates.push({
            gameId: game.winner_advances_to_id,
            slot: game.winner_slot,
            teamId: winnerTeamId,
          });
        }

        if (loserId && game.loser_advances_to_id && game.loser_slot) {
          updates.push({
            gameId: game.loser_advances_to_id,
            slot: game.loser_slot,
            teamId: loserId,
          });
        }

        // Execute all updates in transaction
        await db.transaction((tx) => {
          // Update game with winner and scores
          tx.run(
            `UPDATE bracket_games SET
              winner_id = ?,
              loser_id = ?,
              team1_score = ?,
              team2_score = ?,
              status = 'completed',
              completed_at = CURRENT_TIMESTAMP,
              score_submission_id = ?
            WHERE id = ?`,
            [
              winnerTeamId,
              loserId,
              team1Score ?? null,
              team2Score ?? null,
              id,
              bracketGameId,
            ],
          );

          // Advance teams to next games
          for (const update of updates) {
            const column = update.slot === 'team1' ? 'team1_id' : 'team2_id';
            tx.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
              update.teamId,
              update.gameId,
            ]);
          }

          // Update score submission status
          tx.run(
            `UPDATE score_submissions 
             SET status = 'accepted', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [req.user.id, id],
          );
        });

        // Mark destination games as ready if both teams assigned
        // TODO Use transaction for for looped DB ops
        for (const update of updates) {
          const destGame = await db.get(
            'SELECT * FROM bracket_games WHERE id = ?',
            [update.gameId],
          );
          if (
            destGame &&
            destGame.team1_id &&
            destGame.team2_id &&
            destGame.status === 'pending'
          ) {
            await db.run(
              `UPDATE bracket_games SET status = 'ready' WHERE id = ?`,
              [update.gameId],
            );
          }
        }

        // Resolve any bye chains
        const byeResolution = await resolveBracketByes(db, game.bracket_id);

        const updatedScore = await db.get(
          'SELECT * FROM score_submissions WHERE id = ?',
          [id],
        );
        const updatedGame = await db.get(
          'SELECT * FROM bracket_games WHERE id = ?',
          [bracketGameId],
        );

        await createAuditEntry(db, {
          event_id: score.event_id,
          user_id: req.user?.id ?? null,
          action: 'score_accepted',
          entity_type: 'score_submission',
          entity_id: Number(id),
          old_value: toAuditJson(score),
          new_value: toAuditJson(updatedScore),
          ip_address: req.ip ?? null,
        });
        await createAuditEntry(db, {
          event_id: score.event_id,
          user_id: req.user?.id ?? null,
          action: 'bracket_game_completed',
          entity_type: 'bracket_game',
          entity_id: bracketGameId,
          old_value: toAuditJson(game),
          new_value: toAuditJson(updatedGame),
          ip_address: req.ip ?? null,
        });

        await updateBracketQueueItem(db, score.event_id, bracketGameId, true);

        return res.json({
          success: true,
          scoreType: 'bracket',
          bracketGameId,
          winnerId: winnerTeamId,
          loserId,
          advanced: updates.length > 0,
          advancedTo: updates.length > 0 ? updates[0].gameId : undefined,
          byeResolution,
        });
      }

      // Unknown score type
      return res.status(400).json({
        error: `Unknown score_type: ${scoreType}. Expected 'seeding' or 'bracket'.`,
      });
    } catch (error) {
      console.error('Error accepting event score:', error);
      res.status(500).json({ error: 'Failed to accept score' });
    }
  },
);

/**
 * Represents an affected slot in a downstream bracket game.
 * A single game can have multiple affected slots (e.g., both team1 and winner).
 */
type AffectedSlot = 'team1' | 'team2' | 'winner';

/**
 * Details about a downstream game affected by reverting a source game.
 */
interface AffectedBracketGame {
  id: number;
  game_number: number;
  round_name: string;
  /** All slots that need to be cleared in this game */
  affectedSlots: AffectedSlot[];
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
  if (!match) return null; // "seed:N" or malformed
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
 * @param _teamId Deprecated - kept for API compatibility, no longer used
 * @returns Array of affected games with their affected slots
 */
async function findAffectedBracketGames(
  db: Awaited<ReturnType<typeof getDatabase>>,
  bracketId: number,
  gameId: number,
  _teamId: number,
): Promise<AffectedBracketGame[]> {
  void _teamId; // Intentionally unused - kept for API compatibility

  // Fetch all games in the bracket at once for consistency and performance
  const allGames = await db.all(
    'SELECT * FROM bracket_games WHERE bracket_id = ?',
    [bracketId],
  );

  // Build lookup maps for efficient traversal
  const gamesById = new Map<number, (typeof allGames)[0]>();
  const gamesByGameNumber = new Map<number, (typeof allGames)[0]>();

  // Build reverse lookup: for each game, which source games feed into its slots
  // via advancement pointers (winner_advances_to_id/loser_advances_to_id + slot)
  // Key: gameId, Value: { team1Sources: gameIds[], team2Sources: gameIds[] }
  const slotSources = new Map<
    number,
    { team1Sources: Set<number>; team2Sources: Set<number> }
  >();

  for (const game of allGames) {
    gamesById.set(game.id, game);
    gamesByGameNumber.set(game.game_number, game);

    // Build reverse lookup from advancement pointers
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

  // Track corrupted game IDs - games whose results are now invalid.
  // A game is corrupted if any of its participant slots depend on a corrupted game.
  const corruptedGameIds = new Set<number>();
  corruptedGameIds.add(gameId);

  // Also track by game_number for team*_source parsing
  const corruptedGameNumbers = new Set<number>();
  corruptedGameNumbers.add(sourceGame.game_number);

  // BFS through all downstream games
  const visited = new Set<number>();
  const affected: AffectedBracketGame[] = [];
  const queue: number[] = [];

  // Start with direct advancement targets from the source game
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

    // Method 1: Check team*_source strings (e.g., "winner:5")
    const team1Src = parseTeamSource(game.team1_source);
    if (team1Src && corruptedGameNumbers.has(team1Src.gameNumber)) {
      affectedSlots.push('team1');
    }

    const team2Src = parseTeamSource(game.team2_source);
    if (team2Src && corruptedGameNumbers.has(team2Src.gameNumber)) {
      affectedSlots.push('team2');
    }

    // Method 2: Check advancement pointers (reverse lookup)
    // This catches cases where team*_source isn't set but advancement pointers are
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

    // If any participant slot is affected and the game has a result, the result
    // is also invalid (wrong participants = wrong matchup = wrong result)
    if (affectedSlots.length > 0 && game.winner_id) {
      affectedSlots.push('winner');
    }

    // Record this game if it has any affected slots
    if (affectedSlots.length > 0) {
      affected.push({
        id: game.id,
        game_number: game.game_number,
        round_name: game.round_name || `Round ${game.round_number}`,
        affectedSlots,
      });

      // This game's result is now corrupted, which affects downstream games
      // that source from it
      corruptedGameIds.add(game.id);
      corruptedGameNumbers.add(game.game_number);
    }

    // Continue traversal unconditionally - we need to explore the full graph
    // to find all structurally affected games, even if this particular game
    // isn't affected (another branch might be)
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

  return affected;
}

/**
 * Legacy adapter: Returns affected games in the old single-slot format.
 * Used for backward compatibility with existing revert logic.
 * @deprecated Use findAffectedBracketGames directly and handle multiple slots
 */
function flattenAffectedSlots(affected: AffectedBracketGame[]): {
  id: number;
  game_number: number;
  round_name: string;
  affectedSlot: AffectedSlot;
}[] {
  const result: {
    id: number;
    game_number: number;
    round_name: string;
    affectedSlot: AffectedSlot;
  }[] = [];

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

// Revert event-scoped score (admin-only)
router.post(
  '/:id/revert-event',
  requireAdmin,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const { dryRun, confirm } = req.body as {
        dryRun?: boolean;
        confirm?: boolean;
      };
      const db = await getDatabase();

      // Get the score submission
      const score = await db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [id],
      );
      if (!score) {
        return res.status(404).json({ error: 'Score submission not found' });
      }

      // Verify this is an event-scoped score
      if (!score.event_id) {
        return res.status(400).json({
          error:
            'This score is not event-scoped. Use the standard revert endpoint.',
        });
      }

      if (score.status !== 'accepted') {
        return res.status(400).json({
          error: 'Only accepted scores can be reverted',
        });
      }

      const scoreType = score.score_type;

      // Handle seeding score revert
      if (scoreType === 'seeding') {
        const seedingScoreId = score.seeding_score_id;

        if (!seedingScoreId) {
          // No linked seeding score, just reset submission status
          await db.run(
            `UPDATE score_submissions 
             SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
             WHERE id = ?`,
            [id],
          );
          const scoreData = JSON.parse(score.score_data);
          const teamId = scoreData.team_id?.value;
          const roundNumber =
            scoreData.round?.value || scoreData.round_number?.value;
          if (teamId != null && roundNumber != null) {
            await updateSeedingQueueItem(
              db,
              score.event_id,
              teamId,
              roundNumber,
              false,
            );
          }
          const updatedScore = await db.get(
            'SELECT * FROM score_submissions WHERE id = ?',
            [id],
          );
          await createAuditEntry(db, {
            event_id: score.event_id,
            user_id: req.user?.id ?? null,
            action: 'score_reverted',
            entity_type: 'score_submission',
            entity_id: Number(id),
            old_value: toAuditJson(score),
            new_value: toAuditJson(updatedScore),
            ip_address: req.ip ?? null,
          });
          return res.json({ success: true, scoreType: 'seeding' });
        }

        // Check if there's a bracket that depends on seeding rankings
        // For now, we just warn but don't block - rankings recalc is manual
        if (dryRun) {
          return res.json({
            requiresConfirmation: false,
            scoreType: 'seeding',
            seedingScoreId,
            message:
              'Seeding score will be cleared. Rankings will need manual recalculation.',
          });
        }

        const oldSeedingScore = await db.get(
          'SELECT * FROM seeding_scores WHERE id = ?',
          [seedingScoreId],
        );

        // Clear the seeding score and reset submission
        await db.transaction((tx) => {
          tx.run('DELETE FROM seeding_scores WHERE id = ?', [seedingScoreId]);
          tx.run(
            `UPDATE score_submissions 
             SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, seeding_score_id = NULL
             WHERE id = ?`,
            [id],
          );
        });

        if (oldSeedingScore) {
          await updateSeedingQueueItem(
            db,
            score.event_id,
            oldSeedingScore.team_id,
            oldSeedingScore.round_number,
            false,
          );
        }

        const updatedScore = await db.get(
          'SELECT * FROM score_submissions WHERE id = ?',
          [id],
        );
        await createAuditEntry(db, {
          event_id: score.event_id,
          user_id: req.user?.id ?? null,
          action: 'score_reverted',
          entity_type: 'score_submission',
          entity_id: Number(id),
          old_value: toAuditJson(score),
          new_value: toAuditJson(updatedScore),
          ip_address: req.ip ?? null,
        });
        await createAuditEntry(db, {
          event_id: score.event_id,
          user_id: req.user?.id ?? null,
          action: 'seeding_score_cleared',
          entity_type: 'seeding_score',
          entity_id: seedingScoreId,
          old_value: toAuditJson(oldSeedingScore),
          new_value: null,
          ip_address: req.ip ?? null,
        });

        return res.json({
          success: true,
          scoreType: 'seeding',
          clearedSeedingScoreId: seedingScoreId,
        });
      }

      // Handle bracket score revert
      if (scoreType === 'bracket') {
        const bracketGameId = score.bracket_game_id;

        if (!bracketGameId) {
          // No linked bracket game, just reset submission status
          await db.run(
            `UPDATE score_submissions 
             SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
             WHERE id = ?`,
            [id],
          );
          const updatedScore = await db.get(
            'SELECT * FROM score_submissions WHERE id = ?',
            [id],
          );
          await createAuditEntry(db, {
            event_id: score.event_id,
            user_id: req.user?.id ?? null,
            action: 'score_reverted',
            entity_type: 'score_submission',
            entity_id: Number(id),
            old_value: toAuditJson(score),
            new_value: toAuditJson(updatedScore),
            ip_address: req.ip ?? null,
          });
          return res.json({ success: true, scoreType: 'bracket' });
        }

        const game = await db.get('SELECT * FROM bracket_games WHERE id = ?', [
          bracketGameId,
        ]);

        if (!game) {
          return res.status(404).json({ error: 'Bracket game not found' });
        }

        if (!game.winner_id) {
          // Game has no winner, just reset submission
          await db.run(
            `UPDATE score_submissions 
             SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
             WHERE id = ?`,
            [id],
          );
          await updateBracketQueueItem(
            db,
            score.event_id,
            bracketGameId,
            false,
          );
          const updatedScore = await db.get(
            'SELECT * FROM score_submissions WHERE id = ?',
            [id],
          );
          await createAuditEntry(db, {
            event_id: score.event_id,
            user_id: req.user?.id ?? null,
            action: 'score_reverted',
            entity_type: 'score_submission',
            entity_id: Number(id),
            old_value: toAuditJson(score),
            new_value: toAuditJson(updatedScore),
            ip_address: req.ip ?? null,
          });
          return res.json({ success: true, scoreType: 'bracket' });
        }

        // Find all downstream games affected by reverting this game's winner
        const affectedGames = await findAffectedBracketGames(
          db,
          game.bracket_id,
          bracketGameId,
          game.winner_id,
        );

        // Flatten for backward compatibility in API response (legacy clients expect single slot)
        const flattenedAffectedGames = flattenAffectedSlots(affectedGames);

        // If this would cascade and we're doing dry-run or haven't confirmed
        if (affectedGames.length > 0 && (dryRun || !confirm)) {
          return res.json({
            requiresConfirmation: true,
            scoreType: 'bracket',
            bracketGameId,
            // Include both formats for flexibility
            affectedGames: flattenedAffectedGames,
            affectedGamesDetailed: affectedGames,
            message: `Reverting this score will affect ${affectedGames.length} downstream game(s). Set confirm=true to proceed.`,
          });
        }

        // Apply the revert
        const winnerId = game.winner_id;
        const loserId = game.loser_id;

        await db.transaction((tx) => {
          // Clear winner from source game
          tx.run(
            `UPDATE bracket_games SET
              winner_id = NULL,
              loser_id = NULL,
              team1_score = NULL,
              team2_score = NULL,
              status = CASE 
                WHEN team1_id IS NOT NULL AND team2_id IS NOT NULL THEN 'ready'
                ELSE 'pending'
              END,
              completed_at = NULL,
              score_submission_id = NULL
            WHERE id = ?`,
            [bracketGameId],
          );

          // Clear affected downstream games
          // Handle multiple affected slots per game efficiently
          for (const affected of affectedGames) {
            const hasTeam1 = affected.affectedSlots.includes('team1');
            const hasTeam2 = affected.affectedSlots.includes('team2');
            const hasWinner = affected.affectedSlots.includes('winner');

            // Build dynamic update based on which slots are affected
            const updates: string[] = [];
            if (hasTeam1) updates.push('team1_id = NULL');
            if (hasTeam2) updates.push('team2_id = NULL');
            if (hasWinner) {
              updates.push(
                'winner_id = NULL',
                'loser_id = NULL',
                'team1_score = NULL',
                'team2_score = NULL',
                'completed_at = NULL',
              );
            }

            // Always set status appropriately
            // If winner is being cleared or both teams cleared, recalc status
            if (hasWinner || (hasTeam1 && hasTeam2)) {
              updates.push("status = 'pending'");
            } else if (hasTeam1 || hasTeam2) {
              // Only one team slot cleared - status depends on remaining slot
              updates.push(`status = CASE 
                WHEN ${hasTeam1 ? 'team2_id' : 'team1_id'} IS NOT NULL THEN 'pending'
                ELSE 'pending'
              END`);
            }

            if (updates.length > 0) {
              tx.run(
                `UPDATE bracket_games SET ${updates.join(', ')} WHERE id = ?`,
                [affected.id],
              );
            }
          }

          // Reset submission status
          tx.run(
            `UPDATE score_submissions 
             SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
             WHERE id = ?`,
            [id],
          );
        });

        const updatedScore = await db.get(
          'SELECT * FROM score_submissions WHERE id = ?',
          [id],
        );
        await createAuditEntry(db, {
          event_id: score.event_id,
          user_id: req.user?.id ?? null,
          action: 'score_reverted',
          entity_type: 'score_submission',
          entity_id: Number(id),
          old_value: toAuditJson(score),
          new_value: toAuditJson(updatedScore),
          ip_address: req.ip ?? null,
        });

        await updateBracketQueueItem(db, score.event_id, bracketGameId, false);

        return res.json({
          success: true,
          scoreType: 'bracket',
          bracketGameId,
          revertedWinnerId: winnerId,
          revertedLoserId: loserId,
          revertedGames: affectedGames.length + 1,
          affectedGames: flattenedAffectedGames,
          affectedGamesDetailed: affectedGames,
        });
      }

      // Unknown score type
      return res.status(400).json({
        error: `Unknown score_type: ${scoreType}. Expected 'seeding' or 'bracket'.`,
      });
    } catch (error) {
      console.error('Error reverting event score:', error);
      res.status(500).json({ error: 'Failed to revert score' });
    }
  },
);

// Reject a score
router.post(
  '/:id/reject',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const oldScore = await db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [id],
      );
      if (!oldScore) {
        return res.status(404).json({ error: 'Score not found' });
      }

      await db.run(
        `UPDATE score_submissions 
       SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
        [req.user.id, id],
      );

      if (oldScore.event_id) {
        const updatedScore = await db.get(
          'SELECT * FROM score_submissions WHERE id = ?',
          [id],
        );
        await createAuditEntry(db, {
          event_id: oldScore.event_id,
          user_id: req.user?.id ?? null,
          action: 'score_rejected',
          entity_type: 'score_submission',
          entity_id: Number(id),
          old_value: toAuditJson(oldScore),
          new_value: toAuditJson(updatedScore),
          ip_address: req.ip ?? null,
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error rejecting score:', error);
      res.status(500).json({ error: 'Failed to reject score' });
    }
  },
);

// Revert a score (undo accept/reject) - DB-only, no sheet operations
router.post(
  '/:id/revert',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const score = await db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [id],
      );
      if (!score) {
        return res.status(404).json({ error: 'Score not found' });
      }

      await db.run(
        `UPDATE score_submissions 
       SET status = 'pending', submitted_to_sheet = false, reviewed_by = NULL, reviewed_at = NULL
       WHERE id = ?`,
        [id],
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error reverting score:', error);
      res.status(500).json({ error: 'Failed to revert score' });
    }
  },
);

// Update a score
router.put(
  '/:id',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const { scoreData } = req.body;
      const db = await getDatabase();

      const oldScore = await db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [id],
      );
      if (!oldScore) {
        return res.status(404).json({ error: 'Score not found' });
      }

      await db.run(
        `UPDATE score_submissions 
       SET score_data = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
        [JSON.stringify(scoreData), id],
      );

      if (oldScore.event_id) {
        const updatedScore = await db.get(
          'SELECT * FROM score_submissions WHERE id = ?',
          [id],
        );
        await createAuditEntry(db, {
          event_id: oldScore.event_id,
          user_id: req.user?.id ?? null,
          action: 'score_updated',
          entity_type: 'score_submission',
          entity_id: Number(id),
          old_value: toAuditJson(oldScore),
          new_value: toAuditJson(updatedScore),
          ip_address: req.ip ?? null,
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating score:', error);
      res.status(500).json({ error: 'Failed to update score' });
    }
  },
);

// Delete a score
router.delete(
  '/:id',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const oldScore = await db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [id],
      );

      await db.run('DELETE FROM score_submissions WHERE id = ?', [id]);

      if (oldScore?.event_id) {
        await createAuditEntry(db, {
          event_id: oldScore.event_id,
          user_id: req.user?.id ?? null,
          action: 'score_deleted',
          entity_type: 'score_submission',
          entity_id: Number(id),
          old_value: toAuditJson(oldScore),
          new_value: null,
          ip_address: req.ip ?? null,
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting score:', error);
      res.status(500).json({ error: 'Failed to delete score' });
    }
  },
);

export default router;
