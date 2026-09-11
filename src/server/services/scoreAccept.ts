import type { Database, DbExecutor, Transaction } from '../database/connection';
import { isUniqueConstraintError } from '../database/constraintErrors';
import { createAuditEntry } from '../routes/audit';
import { toAuditJson } from '../utils/auditJson';
import { resolveBracketByes } from './bracketByeResolver';
import { recalculateSeedingRankings } from './seedingRankings';
import { recalculateDoubleSeedingRankings } from './doubleSeedingRankings';
import { bumpQueueVersion, markQueueDirty } from './queueVersion';
import {
  DOUBLE_SEEDING_SCORE_LOCK_CLASS,
  lockEventAdvisory,
} from './eventAdvisoryLock';
import type { BracketResultType } from '../../shared/bracketResult';

/**
 * Pending score submission: set queue to `scored`. Revert/reject: `queued`.
 * Accept path removes the row via deleteSeedingQueueItemForAcceptedScore.
 */
export async function updateSeedingQueueItem(
  db: DbExecutor,
  eventId: number,
  teamId: number,
  roundNumber: number,
  pendingSubmission: boolean,
): Promise<void> {
  const existing = await db.get<{ id: number }>(
    `SELECT id FROM game_queue WHERE event_id = ? AND seeding_team_id = ? AND seeding_round = ? AND queue_type = 'seeding'`,
    [eventId, teamId, roundNumber],
  );
  if (existing) {
    const clearPresence = pendingSubmission
      ? ''
      : ', present_team1_id = NULL, present_team2_id = NULL';
    await db.run(
      `UPDATE game_queue
       SET status = ?, called_at = NULL, table_number = NULL${clearPresence}
       WHERE id = ?`,
      [pendingSubmission ? 'scored' : 'queued', existing.id],
    );
  } else {
    const maxPos = await db.get<{ max_pos: number | null }>(
      'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
      [eventId],
    );
    const pos = (maxPos?.max_pos ?? 0) + 1;
    await db.run(
      `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
       VALUES (?, ?, ?, 'seeding', ?, ?) RETURNING id`,
      [
        eventId,
        teamId,
        roundNumber,
        pos,
        pendingSubmission ? 'scored' : 'queued',
      ],
    );
  }
  await bumpQueueVersion(db, eventId);
}

/** Remove seeding queue row after a score is accepted (no longer in queue). */
export async function deleteSeedingQueueItemForAcceptedScore(
  db: DbExecutor,
  eventId: number,
  teamId: number,
  roundNumber: number,
): Promise<void> {
  const result = await db.run(
    `DELETE FROM game_queue WHERE event_id = ? AND seeding_team_id = ? AND seeding_round = ? AND queue_type = 'seeding'`,
    [eventId, teamId, roundNumber],
  );
  if (result.changes) {
    await bumpQueueVersion(db, eventId);
  }
}

/**
 * Pending score submission: set queue to `scored`. Revert/reject: `queued` or delete.
 * Accept path removes the row via deleteBracketQueueItemForAcceptedScore.
 */
export async function updateBracketQueueItem(
  db: DbExecutor,
  eventId: number,
  bracketGameId: number,
  pendingSubmission: boolean,
): Promise<void> {
  const existing = await db.get<{ id: number }>(
    `SELECT id FROM game_queue WHERE event_id = ? AND bracket_game_id = ? AND queue_type = 'bracket'`,
    [eventId, bracketGameId],
  );

  if (pendingSubmission) {
    if (existing) {
      await db.run(
        `UPDATE game_queue SET status = 'scored', called_at = NULL, table_number = NULL WHERE id = ?`,
        [existing.id],
      );
    } else {
      const maxPos = await db.get<{ max_pos: number | null }>(
        'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
        [eventId],
      );
      const pos = (maxPos?.max_pos ?? 0) + 1;
      await db.run(
        `INSERT INTO game_queue (event_id, bracket_game_id, queue_type, queue_position, status)
         VALUES (?, ?, 'bracket', ?, 'scored') RETURNING id`,
        [eventId, bracketGameId, pos],
      );
    }
    await bumpQueueVersion(db, eventId);
    return;
  }

  const game = await db.get<{
    team1_id: number | null;
    team2_id: number | null;
  }>('SELECT team1_id, team2_id FROM bracket_games WHERE id = ?', [
    bracketGameId,
  ]);
  const hasBothTeams =
    game != null && game.team1_id != null && game.team2_id != null;

  if (existing) {
    if (hasBothTeams) {
      await db.run(
        `UPDATE game_queue
         SET status = 'queued', called_at = NULL, table_number = NULL,
             present_team1_id = NULL, present_team2_id = NULL
         WHERE id = ?`,
        [existing.id],
      );
    } else {
      await db.run('DELETE FROM game_queue WHERE id = ?', [existing.id]);
    }
  } else if (hasBothTeams) {
    const maxPos = await db.get<{ max_pos: number | null }>(
      'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
      [eventId],
    );
    const pos = (maxPos?.max_pos ?? 0) + 1;
    await db.run(
      `INSERT INTO game_queue (event_id, bracket_game_id, queue_type, queue_position, status)
       VALUES (?, ?, 'bracket', ?, 'queued') RETURNING id`,
      [eventId, bracketGameId, pos],
    );
  }
  await bumpQueueVersion(db, eventId);
}

/** Remove bracket queue row after a score is accepted. */
export async function deleteBracketQueueItemForAcceptedScore(
  db: DbExecutor,
  eventId: number,
  bracketGameId: number,
): Promise<void> {
  const result = await db.run(
    `DELETE FROM game_queue WHERE event_id = ? AND bracket_game_id = ? AND queue_type = 'bracket'`,
    [eventId, bracketGameId],
  );
  if (result.changes) {
    await bumpQueueVersion(db, eventId);
  }
}

/**
 * Pending score submission: set queue to `scored`. Revert/reject: `queued` or delete.
 * Accept path removes the row via deleteDoubleSeedingQueueItemForAcceptedScore.
 */
export async function updateDoubleSeedingQueueItem(
  db: DbExecutor,
  eventId: number,
  matchId: number,
  pendingSubmission: boolean,
): Promise<void> {
  const existing = await db.get<{ id: number }>(
    `SELECT id FROM game_queue WHERE event_id = ? AND double_seeding_match_id = ? AND queue_type = 'double_seeding'`,
    [eventId, matchId],
  );

  if (pendingSubmission) {
    if (existing) {
      await db.run(
        `UPDATE game_queue SET status = 'scored', called_at = NULL, table_number = NULL WHERE id = ?`,
        [existing.id],
      );
    } else {
      const maxPos = await db.get<{ max_pos: number | null }>(
        'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
        [eventId],
      );
      const pos = (maxPos?.max_pos ?? 0) + 1;
      await db.run(
        `INSERT INTO game_queue (event_id, double_seeding_match_id, queue_type, queue_position, status)
         VALUES (?, ?, 'double_seeding', ?, 'scored') RETURNING id`,
        [eventId, matchId, pos],
      );
    }
    await bumpQueueVersion(db, eventId);
    return;
  }

  const match = await db.get<{
    team1_id: number | null;
    team2_id: number | null;
  }>('SELECT team1_id, team2_id FROM double_seeding_matches WHERE id = ?', [
    matchId,
  ]);
  const hasTeam =
    match != null && (match.team1_id != null || match.team2_id != null);

  if (existing) {
    if (hasTeam) {
      await db.run(
        `UPDATE game_queue
         SET status = 'queued', called_at = NULL, table_number = NULL,
             present_team1_id = NULL, present_team2_id = NULL
         WHERE id = ?`,
        [existing.id],
      );
    } else {
      await db.run('DELETE FROM game_queue WHERE id = ?', [existing.id]);
    }
  } else if (hasTeam) {
    const maxPos = await db.get<{ max_pos: number | null }>(
      'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
      [eventId],
    );
    const pos = (maxPos?.max_pos ?? 0) + 1;
    await db.run(
      `INSERT INTO game_queue (event_id, double_seeding_match_id, queue_type, queue_position, status)
       VALUES (?, ?, 'double_seeding', ?, 'queued') RETURNING id`,
      [eventId, matchId, pos],
    );
  }
  await bumpQueueVersion(db, eventId);
}

/** Remove double-seeding queue row after a score is accepted. */
export async function deleteDoubleSeedingQueueItemForAcceptedScore(
  db: DbExecutor,
  eventId: number,
  matchId: number,
): Promise<void> {
  const result = await db.run(
    `DELETE FROM game_queue WHERE event_id = ? AND double_seeding_match_id = ? AND queue_type = 'double_seeding'`,
    [eventId, matchId],
  );
  if (result.changes) {
    await bumpQueueVersion(db, eventId);
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
  scoreType: 'seeding' | 'bracket' | 'double_seeding';
  seedingScoreId?: number;
  bracketGameId?: number;
  doubleSeedingMatchId?: number;
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
  existingResultType?: BracketResultType;
  newResultType?: BracketResultType;
}

export type AcceptEventScoreResult =
  | AcceptEventScoreSuccess
  | AcceptEventScoreError;

const SEEDING_CONFLICT_ERROR =
  'A score already exists for this team/round. Use force=true to override.';
const BRACKET_CONFLICT_ERROR =
  'Game already has a different winner or result type. Use force=true to override.';
const DOUBLE_SEEDING_CONFLICT_ERROR =
  'A double-seeding score already exists for this match or team/round. Use force=true to override.';

function isDoubleSeedingUniqueConflict(error: unknown): boolean {
  if (!isUniqueConstraintError(error)) return false;
  const constraint =
    typeof error === 'object' &&
    error !== null &&
    'constraint' in error &&
    typeof (error as { constraint?: unknown }).constraint === 'string'
      ? (error as { constraint: string }).constraint
      : '';
  const message = error instanceof Error ? error.message : '';
  return (
    constraint.includes('double_seeding_scores') ||
    message.includes('double_seeding_scores')
  );
}

interface AcceptScoreContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  score: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scoreData: any;
  id: string;
  force: boolean;
  reviewedBy: number | null;
  ipAddress: string | null;
  auditAction: string;
}

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

  // force=true retries unique-constraint races so the override can delete the
  // newly committed conflicting row instead of returning 409.
  const attempts = force ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const score = await tx.get(
          'SELECT * FROM score_submissions WHERE id = ? FOR UPDATE',
          [id],
        );
        if (!score) {
          return {
            ok: false,
            status: 404,
            error: 'Score submission not found',
          };
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
        const ctx: AcceptScoreContext = {
          score,
          scoreData,
          id,
          force,
          reviewedBy,
          ipAddress,
          auditAction,
        };

        if (scoreType === 'seeding') {
          return acceptSeedingScore(tx, ctx);
        }
        if (scoreType === 'bracket') {
          return acceptBracketScore(tx, ctx);
        }
        if (scoreType === 'double_seeding') {
          return acceptDoubleSeedingScore(tx, ctx);
        }

        return {
          ok: false,
          status: 400,
          error: `Unknown score_type: ${scoreType}. Expected 'seeding', 'bracket', or 'double_seeding'.`,
        };
      });
    } catch (error) {
      if (!isDoubleSeedingUniqueConflict(error)) {
        throw error;
      }
      if (!force || attempt === attempts - 1) {
        return {
          ok: false,
          status: 409,
          error: DOUBLE_SEEDING_CONFLICT_ERROR,
        };
      }
    }
  }

  return {
    ok: false,
    status: 409,
    error: DOUBLE_SEEDING_CONFLICT_ERROR,
  };
}

async function acceptSeedingScore(
  tx: Transaction,
  ctx: AcceptScoreContext,
): Promise<AcceptEventScoreResult> {
  const teamId = ctx.scoreData.team_id?.value;
  const roundNumber =
    ctx.scoreData.round?.value || ctx.scoreData.round_number?.value;
  const scoreValue =
    ctx.scoreData.grand_total?.value ?? ctx.scoreData.score?.value;

  if (!teamId || !roundNumber) {
    return {
      ok: false,
      status: 400,
      error: 'Seeding score must have team_id and round_number',
    };
  }

  const upsert = await tx.run(
    `INSERT INTO seeding_scores (team_id, round_number, score, score_submission_id, scored_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(team_id, round_number) DO UPDATE SET
       score = excluded.score,
       score_submission_id = excluded.score_submission_id,
       scored_at = CURRENT_TIMESTAMP
     WHERE seeding_scores.score IS NULL OR ?
     RETURNING id`,
    [teamId, roundNumber, scoreValue, ctx.id, ctx.force],
  );

  if (!upsert.lastID) {
    const existingScore = await tx.get<{ score: number | null }>(
      'SELECT score FROM seeding_scores WHERE team_id = ? AND round_number = ?',
      [teamId, roundNumber],
    );
    return {
      ok: false,
      status: 409,
      error: SEEDING_CONFLICT_ERROR,
      existingScore: existingScore?.score ?? undefined,
      newScore: scoreValue,
    };
  }

  await tx.run(
    `UPDATE score_submissions
     SET status = 'accepted', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
         seeding_score_id = (SELECT id FROM seeding_scores WHERE team_id = ? AND round_number = ?)
     WHERE id = ?`,
    [ctx.reviewedBy, teamId, roundNumber, ctx.id],
  );

  const updatedScore = await tx.get(
    'SELECT * FROM score_submissions WHERE id = ?',
    [ctx.id],
  );
  await createAuditEntry(tx, {
    event_id: ctx.score.event_id,
    user_id: ctx.reviewedBy,
    action: ctx.auditAction,
    entity_type: 'score_submission',
    entity_id: Number(ctx.id),
    old_value: toAuditJson(ctx.score),
    new_value: toAuditJson(updatedScore),
    ip_address: ctx.ipAddress,
  });

  await deleteSeedingQueueItemForAcceptedScore(
    tx,
    ctx.score.event_id,
    teamId,
    roundNumber,
  );
  await recalculateSeedingRankings(ctx.score.event_id, tx);

  return {
    ok: true,
    success: true,
    scoreType: 'seeding',
    seedingScoreId: updatedScore?.seeding_score_id,
  };
}

async function acceptBracketScore(
  tx: Transaction,
  ctx: AcceptScoreContext,
): Promise<AcceptEventScoreResult> {
  const bracketGameId = ctx.score.bracket_game_id;
  const resultType = (ctx.score.result_type ?? 'standard') as BracketResultType;
  const disqualifiedTeamId = ctx.score.disqualified_team_id as number | null;
  const team1Score = ctx.scoreData.team1_score?.value;
  const team2Score = ctx.scoreData.team2_score?.value;

  if (!bracketGameId) {
    return {
      ok: false,
      status: 400,
      error: 'Bracket score must have bracket_game_id linked',
    };
  }

  const game = await tx.get(
    'SELECT * FROM bracket_games WHERE id = ? FOR UPDATE',
    [bracketGameId],
  );

  if (!game) {
    return { ok: false, status: 404, error: 'Bracket game not found' };
  }

  let winnerTeamId =
    ctx.scoreData.winner_team_id?.value || ctx.scoreData.winner_id?.value;

  if (resultType === 'disqualification') {
    if (
      disqualifiedTeamId == null ||
      (game.team1_id !== disqualifiedTeamId &&
        game.team2_id !== disqualifiedTeamId)
    ) {
      return {
        ok: false,
        status: 400,
        error: 'Disqualified team must be one of the teams in the game',
      };
    }
    if (!String(ctx.score.result_note ?? '').trim()) {
      return {
        ok: false,
        status: 400,
        error: 'A disqualification requires a private reason',
      };
    }
    winnerTeamId =
      game.team1_id === disqualifiedTeamId ? game.team2_id : game.team1_id;
  } else if (disqualifiedTeamId != null) {
    return {
      ok: false,
      status: 400,
      error: 'Only a disqualification can specify a disqualified team',
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

  if (game.team1_id !== winnerTeamId && game.team2_id !== winnerTeamId) {
    return {
      ok: false,
      status: 400,
      error: 'Winner must be one of the teams in the game',
    };
  }

  const resultConflict =
    game.winner_id &&
    (game.winner_id !== winnerTeamId ||
      (game.result_type ?? 'standard') !== resultType ||
      (game.disqualified_team_id ?? null) !== disqualifiedTeamId);
  if (resultConflict && !ctx.force) {
    return {
      ok: false,
      status: 409,
      error: BRACKET_CONFLICT_ERROR,
      existingWinnerId: game.winner_id,
      newWinnerId: winnerTeamId,
      existingResultType: game.result_type ?? 'standard',
      newResultType: resultType,
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

  await tx.run(
    `UPDATE bracket_games SET
      winner_id = ?,
      loser_id = ?,
      team1_score = ?,
      team2_score = ?,
      result_type = ?,
      disqualified_team_id = ?,
      status = 'completed',
      completed_at = CURRENT_TIMESTAMP,
      score_submission_id = ?
    WHERE id = ?`,
    [
      winnerTeamId,
      loserId,
      resultType === 'standard' ? (team1Score ?? null) : null,
      resultType === 'standard' ? (team2Score ?? null) : null,
      resultType,
      disqualifiedTeamId,
      ctx.id,
      bracketGameId,
    ],
  );

  for (const update of updates) {
    const column = update.slot === 'team1' ? 'team1_id' : 'team2_id';
    await tx.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
      update.teamId,
      update.gameId,
    ]);
  }

  await tx.run(
    `UPDATE score_submissions
     SET status = 'accepted', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [ctx.reviewedBy, ctx.id],
  );

  for (const update of updates) {
    const destGame = await tx.get('SELECT * FROM bracket_games WHERE id = ?', [
      update.gameId,
    ]);
    if (
      destGame &&
      destGame.team1_id &&
      destGame.team2_id &&
      destGame.status === 'pending'
    ) {
      await tx.run(`UPDATE bracket_games SET status = 'ready' WHERE id = ?`, [
        update.gameId,
      ]);
    }
  }

  const byeResolution = await resolveBracketByes(tx, game.bracket_id);

  const updatedScore = await tx.get(
    'SELECT * FROM score_submissions WHERE id = ?',
    [ctx.id],
  );
  const updatedGame = await tx.get('SELECT * FROM bracket_games WHERE id = ?', [
    bracketGameId,
  ]);

  await createAuditEntry(tx, {
    event_id: ctx.score.event_id,
    user_id: ctx.reviewedBy,
    action: ctx.auditAction,
    entity_type: 'score_submission',
    entity_id: Number(ctx.id),
    old_value: toAuditJson(ctx.score),
    new_value: toAuditJson(updatedScore),
    ip_address: ctx.ipAddress,
  });
  await createAuditEntry(tx, {
    event_id: ctx.score.event_id,
    user_id: ctx.reviewedBy,
    action: 'bracket_game_completed',
    entity_type: 'bracket_game',
    entity_id: bracketGameId,
    old_value: toAuditJson(game),
    new_value: toAuditJson(updatedGame),
    ip_address: ctx.ipAddress,
  });

  await deleteBracketQueueItemForAcceptedScore(
    tx,
    ctx.score.event_id,
    bracketGameId,
  );
  // Advancement / bye resolution can make new games eligible for the queue;
  // flag the queue so the next read repairs it.
  await markQueueDirty(tx, ctx.score.event_id);

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

async function acceptDoubleSeedingScore(
  tx: Transaction,
  ctx: AcceptScoreContext,
): Promise<AcceptEventScoreResult> {
  const matchId = ctx.score.double_seeding_match_id;

  if (!matchId) {
    return {
      ok: false,
      status: 400,
      error: 'Double-seeding score must have double_seeding_match_id linked',
    };
  }

  const match = await tx.get(
    'SELECT * FROM double_seeding_matches WHERE id = ? FOR UPDATE',
    [matchId],
  );

  if (!match) {
    return {
      ok: false,
      status: 404,
      error: 'Double-seeding match not found',
    };
  }

  if (match.event_id !== ctx.score.event_id) {
    return {
      ok: false,
      status: 400,
      error: 'Double-seeding match does not belong to the submission event',
    };
  }

  if (match.team1_id == null && match.team2_id == null) {
    return {
      ok: false,
      status: 400,
      error: 'Double-seeding match has no participating teams',
    };
  }

  // Submitted team ids, when present, must match the stored match teams.
  const submittedTeamAId = ctx.scoreData.team_a_id?.value;
  const submittedTeamBId = ctx.scoreData.team_b_id?.value;
  if (submittedTeamAId != null && Number(submittedTeamAId) !== match.team1_id) {
    return {
      ok: false,
      status: 400,
      error: 'Submitted Team A does not match the stored match teams',
    };
  }
  if (submittedTeamBId != null && Number(submittedTeamBId) !== match.team2_id) {
    return {
      ok: false,
      status: 400,
      error: 'Submitted Team B does not match the stored match teams',
    };
  }

  const teamAScore =
    ctx.scoreData.team_a_total?.value ??
    ctx.scoreData.team1_score?.value ??
    null;
  const teamBScore =
    ctx.scoreData.team_b_total?.value ??
    ctx.scoreData.team2_score?.value ??
    null;

  const participatingTeamIds = [match.team1_id, match.team2_id].filter(
    (t): t is number => t != null,
  );

  // Serialize accepts that can collide on (event_id, team_id, round_number)
  // across different matches. Distinct match-row locks do not cover that.
  await lockEventAdvisory(
    tx,
    DOUBLE_SEEDING_SCORE_LOCK_CLASS,
    ctx.score.event_id,
  );
  participatingTeamIds.sort((a, b) => a - b);
  for (const teamId of participatingTeamIds) {
    await tx.get('SELECT id FROM teams WHERE id = ? FOR UPDATE', [teamId]);
  }

  // Conflict detection: existing score rows for this match, or for any
  // participating team in the same round (possibly from another match).
  const teamPlaceholders = participatingTeamIds.map(() => '?').join(',');
  const conflicts = await tx.all(
    `SELECT * FROM double_seeding_scores
     WHERE match_id = ?
        OR (event_id = ? AND round_number = ? AND team_id IN (${teamPlaceholders}))`,
    [matchId, ctx.score.event_id, match.round_number, ...participatingTeamIds],
  );

  if (conflicts.length > 0 && !ctx.force) {
    return {
      ok: false,
      status: 409,
      error: DOUBLE_SEEDING_CONFLICT_ERROR,
    };
  }

  if (conflicts.length > 0) {
    for (const conflict of conflicts) {
      await tx.run('DELETE FROM double_seeding_scores WHERE id = ?', [
        conflict.id,
      ]);
    }
  }

  if (match.team1_id != null) {
    await tx.run(
      `INSERT INTO double_seeding_scores
         (event_id, match_id, team_id, round_number, side, score, score_submission_id, scored_at)
       VALUES (?, ?, ?, ?, 'team1', ?, ?, CURRENT_TIMESTAMP) RETURNING id`,
      [
        ctx.score.event_id,
        matchId,
        match.team1_id,
        match.round_number,
        teamAScore,
        ctx.id,
      ],
    );
  }
  if (match.team2_id != null) {
    await tx.run(
      `INSERT INTO double_seeding_scores
         (event_id, match_id, team_id, round_number, side, score, score_submission_id, scored_at)
       VALUES (?, ?, ?, ?, 'team2', ?, ?, CURRENT_TIMESTAMP) RETURNING id`,
      [
        ctx.score.event_id,
        matchId,
        match.team2_id,
        match.round_number,
        teamBScore,
        ctx.id,
      ],
    );
  }

  await tx.run(
    `UPDATE double_seeding_matches SET
       status = 'completed',
       completed_at = CURRENT_TIMESTAMP,
       score_submission_id = ?
     WHERE id = ?`,
    [ctx.id, matchId],
  );

  await tx.run(
    `UPDATE score_submissions
     SET status = 'accepted', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
         double_seeding_match_id = ?
     WHERE id = ?`,
    [ctx.reviewedBy, matchId, ctx.id],
  );

  const updatedScore = await tx.get(
    'SELECT * FROM score_submissions WHERE id = ?',
    [ctx.id],
  );
  const updatedMatch = await tx.get(
    'SELECT * FROM double_seeding_matches WHERE id = ?',
    [matchId],
  );

  await createAuditEntry(tx, {
    event_id: ctx.score.event_id,
    user_id: ctx.reviewedBy,
    action: ctx.auditAction,
    entity_type: 'score_submission',
    entity_id: Number(ctx.id),
    old_value: toAuditJson(ctx.score),
    new_value: toAuditJson(updatedScore),
    ip_address: ctx.ipAddress,
  });
  await createAuditEntry(tx, {
    event_id: ctx.score.event_id,
    user_id: ctx.reviewedBy,
    action: 'double_seeding_match_completed',
    entity_type: 'double_seeding_match',
    entity_id: matchId,
    old_value: toAuditJson(match),
    new_value: toAuditJson(updatedMatch),
    ip_address: ctx.ipAddress,
  });

  await deleteDoubleSeedingQueueItemForAcceptedScore(
    tx,
    ctx.score.event_id,
    matchId,
  );
  await recalculateDoubleSeedingRankings(ctx.score.event_id, tx);

  return {
    ok: true,
    success: true,
    scoreType: 'double_seeding',
    doubleSeedingMatchId: matchId,
  };
}
