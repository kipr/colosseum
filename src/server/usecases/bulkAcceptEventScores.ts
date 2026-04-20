import type { Database } from '../database/connection';
import { createAuditEntry } from '../routes/audit';
import { toAuditJson } from '../utils/auditJson';
import { resolveBracketByes } from '../services/bracketByeResolver';
import { recalculateSeedingRankings } from '../services/seedingRankings';
import {
  deleteBracketQueueItemForAcceptedScore,
  deleteSeedingQueueItemForAcceptedScore,
} from '../services/scoreAccept';

export interface BulkAcceptEventScoresParams {
  db: Database;
  eventId: string | number;
  scoreIds: number[];
  reviewedBy: number | null;
  ipAddress: string | null;
}

interface AcceptedItem {
  id: number;
  scoreType: 'seeding' | 'bracket';
}

interface SkippedItem {
  id: number;
  reason: string;
}

interface SeedingOp {
  id: number;
  teamId: number;
  roundNumber: number;
  scoreValue: number;
  score: Record<string, unknown>;
}

interface BracketOp {
  id: number;
  bracketGameId: number;
  winnerTeamId: number;
  loserId: number | null;
  team1Score: number | null;
  team2Score: number | null;
  updates: { gameId: number; slot: string; teamId: number }[];
  game: Record<string, unknown>;
  score: Record<string, unknown>;
}

export type BulkAcceptEventScoresResult =
  | {
      ok: true;
      accepted: number;
      accepted_ids: number[];
      skipped?: SkippedItem[];
    }
  | { ok: false; status: 400; error: string };

/**
 * Bulk-accept a list of pending score submissions for an event.
 *
 * Validation runs first (no DB writes), then a single transaction applies all
 * core updates (seeding_scores upserts, bracket_games winner/loser writes,
 * score_submissions status flips). After the transaction, we run the
 * post-acceptance side-effects (queue cleanup, audit, bye resolution,
 * ranking recalc).
 */
export async function bulkAcceptEventScores(
  params: BulkAcceptEventScoresParams,
): Promise<BulkAcceptEventScoresResult> {
  const { db, eventId, scoreIds, reviewedBy, ipAddress } = params;

  if (!Array.isArray(scoreIds) || scoreIds.length === 0) {
    return { ok: false, status: 400, error: 'score_ids array is required' };
  }

  const event = await db.get('SELECT id FROM events WHERE id = ?', [eventId]);
  if (!event) {
    return { ok: false, status: 400, error: 'Event does not exist' };
  }

  const eventIdNum = Number(eventId);
  const auditAction = 'score_accepted';
  const placeholders = scoreIds.map(() => '?').join(',');
  const scores = await db.all(
    `SELECT * FROM score_submissions WHERE id IN (${placeholders}) AND event_id = ? AND status = 'pending'`,
    [...scoreIds, eventIdNum],
  );

  const accepted: AcceptedItem[] = [];
  const skipped: SkippedItem[] = [];
  const seedingOps: SeedingOp[] = [];
  const bracketOps: BracketOp[] = [];

  for (const score of scores) {
    const id = score.id;
    const scoreData = JSON.parse(score.score_data);
    const scoreType = score.score_type;

    if (scoreType === 'seeding') {
      const teamId = scoreData.team_id?.value;
      const roundNumber =
        scoreData.round?.value ?? scoreData.round_number?.value;
      const scoreValue = scoreData.grand_total?.value ?? scoreData.score?.value;

      if (!teamId || !roundNumber) {
        skipped.push({
          id,
          reason: 'Seeding score must have team_id and round_number',
        });
        continue;
      }

      const existingScore = await db.get(
        'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
        [teamId, roundNumber],
      );
      if (existingScore && existingScore.score !== null) {
        skipped.push({
          id,
          reason: 'A score already exists for this team/round',
        });
        continue;
      }

      seedingOps.push({ id, teamId, roundNumber, scoreValue, score });
    } else if (scoreType === 'bracket') {
      const bracketGameId = score.bracket_game_id;
      const winnerTeamId =
        scoreData.winner_team_id?.value ?? scoreData.winner_id?.value;
      const team1Score = scoreData.team1_score?.value ?? null;
      const team2Score = scoreData.team2_score?.value ?? null;

      if (!bracketGameId) {
        skipped.push({
          id,
          reason: 'Bracket score must have bracket_game_id linked',
        });
        continue;
      }
      if (!winnerTeamId) {
        skipped.push({
          id,
          reason: 'Bracket score must specify a winner',
        });
        continue;
      }

      const game = await db.get('SELECT * FROM bracket_games WHERE id = ?', [
        bracketGameId,
      ]);
      if (!game) {
        skipped.push({ id, reason: 'Bracket game not found' });
        continue;
      }
      if (game.team1_id !== winnerTeamId && game.team2_id !== winnerTeamId) {
        skipped.push({
          id,
          reason: 'Winner must be one of the teams in the game',
        });
        continue;
      }
      if (game.winner_id && game.winner_id !== winnerTeamId) {
        skipped.push({
          id,
          reason: 'Game already has a different winner',
        });
        continue;
      }

      const loserId =
        game.team1_id === winnerTeamId ? game.team2_id : game.team1_id;
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

      bracketOps.push({
        id,
        bracketGameId,
        winnerTeamId,
        loserId,
        team1Score,
        team2Score,
        updates,
        game,
        score,
      });
    } else {
      skipped.push({
        id,
        reason: `Unknown score_type: ${scoreType}`,
      });
    }
  }

  await db.transaction(async (tx) => {
    for (const op of seedingOps) {
      await tx.run(
        `INSERT INTO seeding_scores (team_id, round_number, score, score_submission_id, scored_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(team_id, round_number) DO UPDATE SET
           score = excluded.score,
           score_submission_id = excluded.score_submission_id,
           scored_at = CURRENT_TIMESTAMP`,
        [op.teamId, op.roundNumber, op.scoreValue, op.id],
      );
      await tx.run(
        `UPDATE score_submissions
         SET status = 'accepted', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
             seeding_score_id = (SELECT id FROM seeding_scores WHERE team_id = ? AND round_number = ?)
         WHERE id = ?`,
        [reviewedBy, op.teamId, op.roundNumber, op.id],
      );
    }

    for (const op of bracketOps) {
      await tx.run(
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
          op.winnerTeamId,
          op.loserId,
          op.team1Score,
          op.team2Score,
          op.id,
          op.bracketGameId,
        ],
      );
      for (const u of op.updates) {
        const column = u.slot === 'team1' ? 'team1_id' : 'team2_id';
        await tx.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
          u.teamId,
          u.gameId,
        ]);
      }
      await tx.run(
        `UPDATE score_submissions
         SET status = 'accepted', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [reviewedBy, op.id],
      );
    }
  });

  for (const op of seedingOps) {
    const updatedScore = await db.get(
      'SELECT * FROM score_submissions WHERE id = ?',
      [op.id],
    );
    await createAuditEntry(db, {
      event_id: eventIdNum,
      user_id: reviewedBy,
      action: auditAction,
      entity_type: 'score_submission',
      entity_id: op.id,
      old_value: toAuditJson(op.score),
      new_value: toAuditJson(updatedScore),
      ip_address: ipAddress,
    });
    await deleteSeedingQueueItemForAcceptedScore(
      db,
      eventIdNum,
      op.teamId,
      op.roundNumber,
    );
    accepted.push({ id: op.id, scoreType: 'seeding' });
  }
  if (seedingOps.length > 0) {
    await recalculateSeedingRankings(eventIdNum);
  }

  const bracketIdsProcessed = new Set<number>();
  for (const op of bracketOps) {
    for (const u of op.updates) {
      await db.run(
        `UPDATE bracket_games SET status = 'ready'
         WHERE id = ? AND team1_id IS NOT NULL AND team2_id IS NOT NULL AND status = 'pending'`,
        [u.gameId],
      );
    }
    const updatedScore = await db.get(
      'SELECT * FROM score_submissions WHERE id = ?',
      [op.id],
    );
    const updatedGame = await db.get(
      'SELECT * FROM bracket_games WHERE id = ?',
      [op.bracketGameId],
    );
    await createAuditEntry(db, {
      event_id: eventIdNum,
      user_id: reviewedBy,
      action: auditAction,
      entity_type: 'score_submission',
      entity_id: op.id,
      old_value: toAuditJson(op.score),
      new_value: toAuditJson(updatedScore),
      ip_address: ipAddress,
    });
    await createAuditEntry(db, {
      event_id: eventIdNum,
      user_id: reviewedBy,
      action: 'bracket_game_completed',
      entity_type: 'bracket_game',
      entity_id: op.bracketGameId,
      old_value: toAuditJson(op.game),
      new_value: toAuditJson(updatedGame),
      ip_address: ipAddress,
    });
    await deleteBracketQueueItemForAcceptedScore(
      db,
      eventIdNum,
      op.bracketGameId,
    );
    accepted.push({ id: op.id, scoreType: 'bracket' });

    const bracketId = (op.game as { bracket_id: number }).bracket_id;
    if (bracketId && !bracketIdsProcessed.has(bracketId)) {
      bracketIdsProcessed.add(bracketId);
      await resolveBracketByes(db, bracketId);
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

  return {
    ok: true,
    accepted: accepted.length,
    accepted_ids: accepted.map((a) => a.id),
    skipped: skipped.length > 0 ? skipped : undefined,
  };
}
