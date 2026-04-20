import type { Database } from '../database/connection';
import { createAuditEntry } from '../routes/audit';
import { toAuditJson } from '../utils/auditJson';
import {
  updateBracketQueueItem,
  updateSeedingQueueItem,
} from '../services/scoreAccept';
import {
  findAffectedBracketGames,
  flattenAffectedSlots,
  type AffectedBracketGame,
  type FlatAffectedSlot,
} from '../services/bracketCascade';

export interface RevertEventScoreParams {
  db: Database;
  submissionId: number;
  dryRun: boolean;
  confirm: boolean;
  reviewedBy: number | null;
  ipAddress: string | null;
}

export type RevertEventScoreResult =
  | { ok: false; status: 404 | 400; error: string }
  | {
      ok: true;
      kind: 'seeding-success';
      clearedSeedingScoreId?: number;
    }
  | {
      ok: true;
      kind: 'seeding-dry-run';
      seedingScoreId: number;
      message: string;
    }
  | {
      ok: true;
      kind: 'bracket-success';
      bracketGameId: number;
      revertedWinnerId: number | null;
      revertedLoserId: number | null;
      revertedGames: number;
      affectedGames: FlatAffectedSlot[];
      affectedGamesDetailed: AffectedBracketGame[];
    }
  | {
      ok: true;
      kind: 'bracket-confirm';
      bracketGameId: number;
      affectedGames: FlatAffectedSlot[];
      affectedGamesDetailed: AffectedBracketGame[];
      message: string;
    }
  | {
      ok: true;
      kind: 'bracket-noop';
      bracketGameId?: number | null;
    };

export async function revertEventScore(
  params: RevertEventScoreParams,
): Promise<RevertEventScoreResult> {
  const { db, submissionId, dryRun, confirm, reviewedBy, ipAddress } = params;

  const score = await db.get('SELECT * FROM score_submissions WHERE id = ?', [
    submissionId,
  ]);
  if (!score) {
    return { ok: false, status: 404, error: 'Score submission not found' };
  }
  if (!score.event_id) {
    return {
      ok: false,
      status: 400,
      error:
        'This score is not event-scoped. Use the standard revert endpoint.',
    };
  }
  if (score.status !== 'accepted') {
    return {
      ok: false,
      status: 400,
      error: 'Only accepted scores can be reverted',
    };
  }

  const scoreType = score.score_type;

  if (scoreType === 'seeding') {
    return revertSeeding({
      db,
      submissionId,
      score,
      dryRun,
      reviewedBy,
      ipAddress,
    });
  }

  if (scoreType === 'bracket') {
    return revertBracket({
      db,
      submissionId,
      score,
      dryRun,
      confirm,
      reviewedBy,
      ipAddress,
    });
  }

  return {
    ok: false,
    status: 400,
    error: `Unknown score_type: ${scoreType}. Expected 'seeding' or 'bracket'.`,
  };
}

interface RevertSeedingArgs {
  db: Database;
  submissionId: number;
  score: Record<string, unknown> & {
    event_id: number;
    seeding_score_id: number | null;
    score_data: string;
  };
  dryRun: boolean;
  reviewedBy: number | null;
  ipAddress: string | null;
}

async function revertSeeding(
  args: RevertSeedingArgs,
): Promise<RevertEventScoreResult> {
  const { db, submissionId, score, dryRun, reviewedBy, ipAddress } = args;
  const seedingScoreId = score.seeding_score_id;

  if (!seedingScoreId) {
    await db.run(
      `UPDATE score_submissions
       SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
       WHERE id = ?`,
      [submissionId],
    );
    const scoreData = JSON.parse(score.score_data);
    const teamId = scoreData.team_id?.value;
    const roundNumber = scoreData.round?.value || scoreData.round_number?.value;
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
      [submissionId],
    );
    await createAuditEntry(db, {
      event_id: score.event_id,
      user_id: reviewedBy,
      action: 'score_reverted',
      entity_type: 'score_submission',
      entity_id: submissionId,
      old_value: toAuditJson(score),
      new_value: toAuditJson(updatedScore),
      ip_address: ipAddress,
    });
    return { ok: true, kind: 'seeding-success' };
  }

  if (dryRun) {
    return {
      ok: true,
      kind: 'seeding-dry-run',
      seedingScoreId,
      message:
        'Seeding score will be cleared. Rankings will need manual recalculation.',
    };
  }

  const oldSeedingScore = await db.get(
    'SELECT * FROM seeding_scores WHERE id = ?',
    [seedingScoreId],
  );

  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM seeding_scores WHERE id = ?', [seedingScoreId]);
    await tx.run(
      `UPDATE score_submissions
       SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, seeding_score_id = NULL
       WHERE id = ?`,
      [submissionId],
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
    [submissionId],
  );
  await createAuditEntry(db, {
    event_id: score.event_id,
    user_id: reviewedBy,
    action: 'score_reverted',
    entity_type: 'score_submission',
    entity_id: submissionId,
    old_value: toAuditJson(score),
    new_value: toAuditJson(updatedScore),
    ip_address: ipAddress,
  });
  await createAuditEntry(db, {
    event_id: score.event_id,
    user_id: reviewedBy,
    action: 'seeding_score_cleared',
    entity_type: 'seeding_score',
    entity_id: seedingScoreId,
    old_value: toAuditJson(oldSeedingScore),
    new_value: null,
    ip_address: ipAddress,
  });

  return {
    ok: true,
    kind: 'seeding-success',
    clearedSeedingScoreId: seedingScoreId,
  };
}

interface RevertBracketArgs {
  db: Database;
  submissionId: number;
  score: Record<string, unknown> & {
    event_id: number;
    bracket_game_id: number | null;
  };
  dryRun: boolean;
  confirm: boolean;
  reviewedBy: number | null;
  ipAddress: string | null;
}

async function revertBracket(
  args: RevertBracketArgs,
): Promise<RevertEventScoreResult> {
  const { db, submissionId, score, dryRun, confirm, reviewedBy, ipAddress } =
    args;
  const bracketGameId = score.bracket_game_id;

  if (!bracketGameId) {
    await db.run(
      `UPDATE score_submissions
       SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
       WHERE id = ?`,
      [submissionId],
    );
    const updatedScore = await db.get(
      'SELECT * FROM score_submissions WHERE id = ?',
      [submissionId],
    );
    await createAuditEntry(db, {
      event_id: score.event_id,
      user_id: reviewedBy,
      action: 'score_reverted',
      entity_type: 'score_submission',
      entity_id: submissionId,
      old_value: toAuditJson(score),
      new_value: toAuditJson(updatedScore),
      ip_address: ipAddress,
    });
    return { ok: true, kind: 'bracket-noop' };
  }

  const game = await db.get('SELECT * FROM bracket_games WHERE id = ?', [
    bracketGameId,
  ]);
  if (!game) {
    return { ok: false, status: 404, error: 'Bracket game not found' };
  }

  if (!game.winner_id) {
    await db.run(
      `UPDATE score_submissions
       SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
       WHERE id = ?`,
      [submissionId],
    );
    await updateBracketQueueItem(db, score.event_id, bracketGameId, false);
    const updatedScore = await db.get(
      'SELECT * FROM score_submissions WHERE id = ?',
      [submissionId],
    );
    await createAuditEntry(db, {
      event_id: score.event_id,
      user_id: reviewedBy,
      action: 'score_reverted',
      entity_type: 'score_submission',
      entity_id: submissionId,
      old_value: toAuditJson(score),
      new_value: toAuditJson(updatedScore),
      ip_address: ipAddress,
    });
    return { ok: true, kind: 'bracket-noop', bracketGameId };
  }

  const affectedGames = await findAffectedBracketGames(
    db,
    game.bracket_id,
    bracketGameId,
  );
  const flattenedAffectedGames = flattenAffectedSlots(affectedGames);

  if (affectedGames.length > 0 && (dryRun || !confirm)) {
    return {
      ok: true,
      kind: 'bracket-confirm',
      bracketGameId,
      affectedGames: flattenedAffectedGames,
      affectedGamesDetailed: affectedGames,
      message: `Reverting this score will affect ${affectedGames.length} downstream game(s). Set confirm=true to proceed.`,
    };
  }

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
      [submissionId],
    );
  });

  const updatedScore = await db.get(
    'SELECT * FROM score_submissions WHERE id = ?',
    [submissionId],
  );
  await createAuditEntry(db, {
    event_id: score.event_id,
    user_id: reviewedBy,
    action: 'score_reverted',
    entity_type: 'score_submission',
    entity_id: submissionId,
    old_value: toAuditJson(score),
    new_value: toAuditJson(updatedScore),
    ip_address: ipAddress,
  });

  await updateBracketQueueItem(db, score.event_id, bracketGameId, false);
  for (const affected of affectedGames) {
    await updateBracketQueueItem(db, score.event_id, affected.id, false);
  }

  return {
    ok: true,
    kind: 'bracket-success',
    bracketGameId,
    revertedWinnerId: winnerId,
    revertedLoserId: loserId,
    revertedGames: affectedGames.length + 1,
    affectedGames: flattenedAffectedGames,
    affectedGamesDetailed: affectedGames,
  };
}
