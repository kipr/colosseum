import express from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { createAuditEntry } from './audit';
import { toAuditJson } from '../utils/auditJson';
import { recalculateDoubleSeedingRankings } from '../services/doubleSeedingRankings';
import {
  acceptEventScore,
  updateSeedingQueueItem,
  updateBracketQueueItem,
  updateDoubleSeedingQueueItem,
} from '../services/scoreAccept';

const router = express.Router();

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

      // Parse pagination params
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (pageNum - 1) * limitNum;

      // Build WHERE conditions for score_submissions
      const countConditions: string[] = ['s.event_id = e.id'];
      const dataConditions: string[] = ['s.event_id = ?'];
      const eventIdNum = parseInt(eventId, 10);
      const params: (string | number)[] = [eventIdNum];

      if (status && ['pending', 'accepted', 'rejected'].includes(status)) {
        countConditions.push('s.status = ?');
        dataConditions.push('s.status = ?');
        params.push(status);
      }

      if (
        score_type &&
        ['seeding', 'bracket', 'double_seeding'].includes(score_type)
      ) {
        countConditions.push('s.score_type = ?');
        dataConditions.push('s.score_type = ?');
        params.push(score_type);
      }

      const countWhereClause = countConditions.join(' AND ');
      const dataWhereClause = dataConditions.join(' AND ');

      // Validate event exists and get count in one query.
      // Param order: subquery params first (status, score_type), then outer e.id.
      const countParams = [...params.slice(1), eventIdNum];

      const eventAndCount = await db.get<{ event_id: number; count: number }>(
        `SELECT e.id as event_id,
                (SELECT COUNT(*) FROM score_submissions s WHERE ${countWhereClause}) as count
         FROM events e WHERE e.id = ?`,
        countParams,
      );
      if (!eventAndCount) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const totalCount = eventAndCount.count || 0;
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
          seeding_team.team_name as team_name,
          bg.team1_id as bracket_team1_id,
          bg.team2_id as bracket_team2_id,
          bg.team1_score as bracket_team1_score,
          bg.team2_score as bracket_team2_score,
          bt1.team_number as bracket_team1_number,
          bt1.team_name as bracket_team1_name,
          bt1.display_name as bracket_team1_display,
          bt2.team_number as bracket_team2_number,
          bt2.team_name as bracket_team2_name,
          bt2.display_name as bracket_team2_display,
          bw.team_number as bracket_winner_number,
          bw.team_name as bracket_winner_name,
          bw.display_name as bracket_winner_display,
          dsm.round_number as double_seeding_round,
          dsm.match_number as double_seeding_match_number,
          dsm.team1_id as double_seeding_team1_id,
          dsm.team2_id as double_seeding_team2_id,
          dst1.team_number as double_seeding_team1_number,
          dst1.team_name as double_seeding_team1_name,
          dst1.display_name as double_seeding_team1_display,
          dst2.team_number as double_seeding_team2_number,
          dst2.team_name as double_seeding_team2_name,
          dst2.display_name as double_seeding_team2_display
        FROM score_submissions s
        LEFT JOIN scoresheet_templates t ON s.template_id = t.id
        LEFT JOIN users submitter ON s.user_id = submitter.id
        LEFT JOIN users reviewer ON s.reviewed_by = reviewer.id
        LEFT JOIN game_queue gq ON s.game_queue_id = gq.id
        LEFT JOIN bracket_games bg ON s.bracket_game_id = bg.id
        LEFT JOIN brackets b ON bg.bracket_id = b.id
        LEFT JOIN seeding_scores ss ON s.seeding_score_id = ss.id
        LEFT JOIN teams seeding_team ON ss.team_id = seeding_team.id
        LEFT JOIN teams bt1 ON bg.team1_id = bt1.id
        LEFT JOIN teams bt2 ON bg.team2_id = bt2.id
        LEFT JOIN teams bw ON bg.winner_id = bw.id
        LEFT JOIN double_seeding_matches dsm ON s.double_seeding_match_id = dsm.id
        LEFT JOIN teams dst1 ON dsm.team1_id = dst1.id
        LEFT JOIN teams dst2 ON dsm.team2_id = dst2.id
        WHERE ${dataWhereClause}
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

// POST /scores/event/:eventId/accept/bulk - Bulk accept scores by IDs.
// Best-effort per-score: each pending submission is accepted independently
// through the shared acceptEventScore service (same conflict behavior as
// single accept; conflicts are skipped/reported, never overridden).
router.post(
  '/event/:eventId/accept/bulk',
  requireAdmin,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { eventId } = req.params;
      const { score_ids } = req.body as { score_ids?: number[] };

      if (!Array.isArray(score_ids) || score_ids.length === 0) {
        return res.status(400).json({ error: 'score_ids array is required' });
      }

      const db = await getDatabase();

      // Verify event exists
      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventId,
      ]);
      if (!event) {
        return res.status(400).json({ error: 'Event does not exist' });
      }

      const eventIdNum = Number(eventId);
      const reviewedBy = req.user?.id ?? null;
      const ipAddress = req.ip ?? null;

      // Fetch all scores by IDs that belong to this event and are pending
      const placeholders = score_ids.map(() => '?').join(',');
      const scores = await db.all<{ id: number }>(
        `SELECT id FROM score_submissions WHERE id IN (${placeholders}) AND event_id = ? AND status = 'pending'
         ORDER BY created_at ASC, id ASC`,
        [...score_ids, eventIdNum],
      );

      const accepted: { id: number; scoreType: string }[] = [];
      const skipped: { id: number; reason: string }[] = [];

      for (const score of scores) {
        const result = await acceptEventScore({
          db,
          submissionId: score.id,
          force: false,
          reviewedBy,
          ipAddress,
        });
        if (result.ok) {
          accepted.push({ id: score.id, scoreType: result.scoreType });
        } else {
          skipped.push({ id: score.id, reason: result.error });
        }
      }

      if (accepted.length > 0) {
        await createAuditEntry(db, {
          event_id: eventIdNum,
          user_id: reviewedBy,
          action: 'scores_bulk_accepted',
          entity_type: 'score_submission',
          entity_id: null,
          old_value: null,
          new_value: toAuditJson({
            accepted_count: accepted.length,
            accepted_ids: accepted.map((a) => a.id),
            skipped: skipped.length > 0 ? skipped : undefined,
          }),
          ip_address: ipAddress,
        });
      }

      res.json({
        accepted: accepted.length,
        accepted_ids: accepted.map((a) => a.id),
        skipped: skipped.length > 0 ? skipped : undefined,
      });
    } catch (error) {
      console.error('Error bulk accepting scores:', error);
      res.status(500).json({ error: 'Failed to bulk accept scores' });
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

      const result = await acceptEventScore({
        db,
        submissionId: Number(id),
        force: force ?? false,
        reviewedBy: req.user?.id ?? null,
        ipAddress: req.ip ?? null,
      });

      if (!result.ok) {
        const {
          status,
          error,
          existingScore,
          newScore,
          existingWinnerId,
          newWinnerId,
        } = result;
        const body: Record<string, unknown> = { error };
        if (existingScore !== undefined) body.existingScore = existingScore;
        if (newScore !== undefined) body.newScore = newScore;
        if (existingWinnerId !== undefined)
          body.existingWinnerId = existingWinnerId;
        if (newWinnerId !== undefined) body.newWinnerId = newWinnerId;
        return res.status(status).json(body);
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- ok/success excluded from response
      const { ok, success, scoreType, ...rest } = result;
      return res.json({ success: true, scoreType, ...rest });
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
        await db.transaction(async (tx) => {
          await tx.run('DELETE FROM seeding_scores WHERE id = ?', [
            seedingScoreId,
          ]);
          await tx.run(
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

        await db.transaction(async (tx) => {
          await tx.run(
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

          for (const affected of affectedGames) {
            const hasTeam1 = affected.affectedSlots.includes('team1');
            const hasTeam2 = affected.affectedSlots.includes('team2');
            const hasWinner = affected.affectedSlots.includes('winner');

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

            if (hasWinner || (hasTeam1 && hasTeam2)) {
              updates.push("status = 'pending'");
            } else if (hasTeam1 || hasTeam2) {
              updates.push(`status = CASE 
                WHEN ${hasTeam1 ? 'team2_id' : 'team1_id'} IS NOT NULL THEN 'pending'
                ELSE 'pending'
              END`);
            }

            if (updates.length > 0) {
              await tx.run(
                `UPDATE bracket_games SET ${updates.join(', ')} WHERE id = ?`,
                [affected.id],
              );
            }
          }

          await tx.run(
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

        for (const affected of affectedGames) {
          await updateBracketQueueItem(db, score.event_id, affected.id, false);
        }

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

      // Handle double-seeding score revert (no cascade: no bracket advancement)
      if (scoreType === 'double_seeding') {
        const matchId = score.double_seeding_match_id;

        if (!matchId) {
          // No linked match, just reset submission status
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
          return res.json({ success: true, scoreType: 'double_seeding' });
        }

        if (dryRun) {
          return res.json({
            requiresConfirmation: false,
            scoreType: 'double_seeding',
            doubleSeedingMatchId: matchId,
            message:
              'Double-seeding scores for this match will be cleared and the match reset.',
          });
        }

        const match = await db.get(
          'SELECT * FROM double_seeding_matches WHERE id = ?',
          [matchId],
        );
        const oldScores = await db.all(
          'SELECT * FROM double_seeding_scores WHERE score_submission_id = ?',
          [id],
        );

        await db.transaction(async (tx) => {
          await tx.run(
            'DELETE FROM double_seeding_scores WHERE score_submission_id = ?',
            [id],
          );
          await tx.run(
            `UPDATE double_seeding_matches SET
               status = CASE
                 WHEN team1_id IS NOT NULL OR team2_id IS NOT NULL THEN 'ready'
                 ELSE 'pending'
               END,
               completed_at = NULL,
               score_submission_id = NULL
             WHERE id = ?`,
            [matchId],
          );
          await tx.run(
            `UPDATE score_submissions 
             SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
             WHERE id = ?`,
            [id],
          );
        });

        await updateDoubleSeedingQueueItem(db, score.event_id, matchId, false);
        await recalculateDoubleSeedingRankings(score.event_id);

        const updatedScore = await db.get(
          'SELECT * FROM score_submissions WHERE id = ?',
          [id],
        );
        const updatedMatch = await db.get(
          'SELECT * FROM double_seeding_matches WHERE id = ?',
          [matchId],
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
          action: 'double_seeding_scores_cleared',
          entity_type: 'double_seeding_match',
          entity_id: matchId,
          old_value: toAuditJson({ match, scores: oldScores }),
          new_value: toAuditJson(updatedMatch),
          ip_address: req.ip ?? null,
        });

        return res.json({
          success: true,
          scoreType: 'double_seeding',
          doubleSeedingMatchId: matchId,
          clearedScoreIds: oldScores.map((s) => s.id),
        });
      }

      // Unknown score type
      return res.status(400).json({
        error: `Unknown score_type: ${scoreType}. Expected 'seeding', 'bracket', or 'double_seeding'.`,
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

      if (oldScore.event_id && oldScore.score_type === 'seeding') {
        try {
          const scoreData = JSON.parse(oldScore.score_data ?? '{}');
          const teamId = scoreData.team_id?.value;
          const roundNumber =
            scoreData.round?.value ?? scoreData.round_number?.value;
          if (teamId != null && roundNumber != null) {
            await updateSeedingQueueItem(
              db,
              oldScore.event_id,
              Number(teamId),
              Number(roundNumber),
              false,
            );
          }
        } catch {
          // Leave queue unchanged if score_data cannot be parsed.
        }
      } else if (
        oldScore.event_id &&
        oldScore.score_type === 'bracket' &&
        oldScore.bracket_game_id != null
      ) {
        await updateBracketQueueItem(
          db,
          oldScore.event_id,
          oldScore.bracket_game_id,
          false,
        );
      } else if (
        oldScore.event_id &&
        oldScore.score_type === 'double_seeding' &&
        oldScore.double_seeding_match_id != null
      ) {
        await updateDoubleSeedingQueueItem(
          db,
          oldScore.event_id,
          oldScore.double_seeding_match_id,
          false,
        );
      }

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
       SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
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
