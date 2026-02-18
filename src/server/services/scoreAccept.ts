import type { Database } from '../database/connection';
import { createAuditEntry } from '../routes/audit';
import { toAuditJson } from '../utils/auditJson';
import { resolveBracketByes } from './bracketByeResolver';
import { recalculateSeedingRankings } from './seedingRankings';

/** Mark seeding queue item completed on accept, or queued on revert. Inserts if missing. */
export async function updateSeedingQueueItem(
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
export async function updateBracketQueueItem(
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

export interface AcceptEventScoreParams {
  db: Database;
  submissionId: number;
  force: boolean;
  /** null = auto-accept (system); number = admin user id */
  reviewedBy: number | null;
  ipAddress: string | null;
}

export interface AcceptEventScoreSuccess {
  ok: true;
  success: true;
  scoreType: 'seeding' | 'bracket';
  seedingScoreId?: number;
  bracketGameId?: number;
  winnerId?: number;
  loserId?: number;
  advanced?: boolean;
  advancedTo?: number;
  byeResolution?: {
    byeGamesResolved: number;
    slotsFilled: number;
    readyGamesUpdated: number;
  };
}

export interface AcceptEventScoreError {
  ok: false;
  status: 400 | 404 | 409;
  error: string;
  existingScore?: number;
  newScore?: number;
  existingWinnerId?: number;
  newWinnerId?: number;
}

export type AcceptEventScoreResult =
  | AcceptEventScoreSuccess
  | AcceptEventScoreError;

/**
 * Accept an event-scoped score submission. Used by both the admin route and the submit endpoint (auto-accept).
 * When reviewedBy is null (auto-accept), uses audit action 'score_auto_accepted' and sets reviewed_by = NULL.
 */
export async function acceptEventScore(
  params: AcceptEventScoreParams,
): Promise<AcceptEventScoreResult> {
  const { db, submissionId, force, reviewedBy, ipAddress } = params;
  const id = String(submissionId);
  const auditAction =
    reviewedBy === null ? 'score_auto_accepted' : 'score_accepted';

  const score = await db.get('SELECT * FROM score_submissions WHERE id = ?', [
    id,
  ]);
  if (!score) {
    return { ok: false, status: 404, error: 'Score submission not found' };
  }

  if (!score.event_id) {
    return {
      ok: false,
      status: 400,
      error:
        'This score is not event-scoped. Use the standard accept endpoint.',
    };
  }

  if (score.status === 'accepted') {
    return { ok: false, status: 400, error: 'Score is already accepted' };
  }

  const scoreData = JSON.parse(score.score_data);
  const scoreType = score.score_type;

  if (scoreType === 'seeding') {
    const teamId = scoreData.team_id?.value;
    const roundNumber = scoreData.round?.value || scoreData.round_number?.value;
    const scoreValue = scoreData.grand_total?.value ?? scoreData.score?.value;

    if (!teamId || !roundNumber) {
      return {
        ok: false,
        status: 400,
        error: 'Seeding score must have team_id and round_number',
      };
    }

    const existingScore = await db.get(
      'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
      [teamId, roundNumber],
    );

    if (existingScore && existingScore.score !== null && !force) {
      return {
        ok: false,
        status: 409,
        error:
          'A score already exists for this team/round. Use force=true to override.',
        existingScore: existingScore.score,
        newScore: scoreValue,
      };
    }

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

      tx.run(
        `UPDATE score_submissions 
         SET status = 'accepted', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
             seeding_score_id = (SELECT id FROM seeding_scores WHERE team_id = ? AND round_number = ?)
         WHERE id = ?`,
        [reviewedBy, teamId, roundNumber, id],
      );
    });

    const updatedScore = await db.get(
      'SELECT * FROM score_submissions WHERE id = ?',
      [id],
    );
    await createAuditEntry(db, {
      event_id: score.event_id,
      user_id: reviewedBy,
      action: auditAction,
      entity_type: 'score_submission',
      entity_id: Number(id),
      old_value: toAuditJson(score),
      new_value: toAuditJson(updatedScore),
      ip_address: ipAddress,
    });

    await updateSeedingQueueItem(db, score.event_id, teamId, roundNumber, true);
    await recalculateSeedingRankings(score.event_id);

    return {
      ok: true,
      success: true,
      scoreType: 'seeding',
      seedingScoreId: updatedScore?.seeding_score_id,
    };
  }

  if (scoreType === 'bracket') {
    const bracketGameId = score.bracket_game_id;
    const winnerTeamId =
      scoreData.winner_team_id?.value || scoreData.winner_id?.value;
    const team1Score = scoreData.team1_score?.value;
    const team2Score = scoreData.team2_score?.value;

    if (!bracketGameId) {
      return {
        ok: false,
        status: 400,
        error: 'Bracket score must have bracket_game_id linked',
      };
    }

    if (!winnerTeamId) {
      return {
        ok: false,
        status: 400,
        error:
          'Bracket score must specify a winner (winner_team_id or winner_id)',
      };
    }

    const game = await db.get('SELECT * FROM bracket_games WHERE id = ?', [
      bracketGameId,
    ]);

    if (!game) {
      return { ok: false, status: 404, error: 'Bracket game not found' };
    }

    if (game.team1_id !== winnerTeamId && game.team2_id !== winnerTeamId) {
      return {
        ok: false,
        status: 400,
        error: 'Winner must be one of the teams in the game',
      };
    }

    if (game.winner_id && game.winner_id !== winnerTeamId && !force) {
      return {
        ok: false,
        status: 409,
        error:
          'Game already has a different winner. Use force=true to override.',
        existingWinnerId: game.winner_id,
        newWinnerId: winnerTeamId,
      };
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

    // When winners bracket wins the grand final, there is no championship reset.
    // Do not propagate the loser to the reset game - they are dropped; the winner
    // gets a bye in the championship reset to keep the UI consistent.
    const isGrandFinal =
      game.winner_advances_to_id &&
      game.loser_advances_to_id &&
      game.winner_advances_to_id === game.loser_advances_to_id;
    const winnersBracketWon = isGrandFinal && winnerTeamId === game.team1_id;

    if (
      loserId &&
      game.loser_advances_to_id &&
      game.loser_slot &&
      !winnersBracketWon
    ) {
      updates.push({
        gameId: game.loser_advances_to_id,
        slot: game.loser_slot,
        teamId: loserId,
      });
    }

    await db.transaction((tx) => {
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

      for (const update of updates) {
        const column = update.slot === 'team1' ? 'team1_id' : 'team2_id';
        tx.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
          update.teamId,
          update.gameId,
        ]);
      }

      tx.run(
        `UPDATE score_submissions 
         SET status = 'accepted', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [reviewedBy, id],
      );
    });

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
        await db.run(`UPDATE bracket_games SET status = 'ready' WHERE id = ?`, [
          update.gameId,
        ]);
      }
    }

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
      user_id: reviewedBy,
      action: auditAction,
      entity_type: 'score_submission',
      entity_id: Number(id),
      old_value: toAuditJson(score),
      new_value: toAuditJson(updatedScore),
      ip_address: ipAddress,
    });
    await createAuditEntry(db, {
      event_id: score.event_id,
      user_id: reviewedBy,
      action: 'bracket_game_completed',
      entity_type: 'bracket_game',
      entity_id: bracketGameId,
      old_value: toAuditJson(game),
      new_value: toAuditJson(updatedGame),
      ip_address: ipAddress,
    });

    await updateBracketQueueItem(db, score.event_id, bracketGameId, true);

    return {
      ok: true,
      success: true,
      scoreType: 'bracket',
      bracketGameId,
      winnerId: winnerTeamId,
      loserId,
      advanced: updates.length > 0,
      advancedTo: updates.length > 0 ? updates[0].gameId : undefined,
      byeResolution,
    };
  }

  return {
    ok: false,
    status: 400,
    error: `Unknown score_type: ${scoreType}. Expected 'seeding' or 'bracket'.`,
  };
}
