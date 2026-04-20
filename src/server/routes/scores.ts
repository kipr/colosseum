import express from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { createAuditEntry } from './audit';
import { toAuditJson } from '../utils/auditJson';
import {
  acceptEventScore,
  updateSeedingQueueItem,
  updateBracketQueueItem,
} from '../services/scoreAccept';
import { bulkAcceptEventScores } from '../usecases/bulkAcceptEventScores';
import { revertEventScore } from '../usecases/revertEventScore';

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

      if (score_type && ['seeding', 'bracket'].includes(score_type)) {
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
          bw.display_name as bracket_winner_display
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

// POST /scores/event/:eventId/accept/bulk - Bulk accept scores by IDs (single transaction)
router.post(
  '/event/:eventId/accept/bulk',
  requireAdmin,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { eventId } = req.params;
      const { score_ids } = req.body as { score_ids?: number[] };
      const db = await getDatabase();
      const result = await bulkAcceptEventScores({
        db,
        eventId,
        scoreIds: score_ids ?? [],
        reviewedBy: req.user?.id ?? null,
        ipAddress: req.ip ?? null,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      const { ok: _ok, ...rest } = result;
      void _ok;
      return res.json(rest);
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
      const result = await revertEventScore({
        db,
        submissionId: Number(id),
        dryRun: dryRun ?? false,
        confirm: confirm ?? false,
        reviewedBy: req.user?.id ?? null,
        ipAddress: req.ip ?? null,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      switch (result.kind) {
        case 'seeding-success':
          return res.json({
            success: true,
            scoreType: 'seeding',
            ...(result.clearedSeedingScoreId !== undefined && {
              clearedSeedingScoreId: result.clearedSeedingScoreId,
            }),
          });
        case 'seeding-dry-run':
          return res.json({
            requiresConfirmation: false,
            scoreType: 'seeding',
            seedingScoreId: result.seedingScoreId,
            message: result.message,
          });
        case 'bracket-success':
          return res.json({
            success: true,
            scoreType: 'bracket',
            bracketGameId: result.bracketGameId,
            revertedWinnerId: result.revertedWinnerId,
            revertedLoserId: result.revertedLoserId,
            revertedGames: result.revertedGames,
            affectedGames: result.affectedGames,
            affectedGamesDetailed: result.affectedGamesDetailed,
          });
        case 'bracket-confirm':
          return res.json({
            requiresConfirmation: true,
            scoreType: 'bracket',
            bracketGameId: result.bracketGameId,
            affectedGames: result.affectedGames,
            affectedGamesDetailed: result.affectedGamesDetailed,
            message: result.message,
          });
        case 'bracket-noop':
          return res.json({ success: true, scoreType: 'bracket' });
      }
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
