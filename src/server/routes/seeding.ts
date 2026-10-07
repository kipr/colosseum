import express, { Request, Response } from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import {
  isCheckConstraintError,
  isForeignKeyConstraintError,
} from '../database/constraintErrors';
import { recalculateSeedingRankings } from '../services/seedingRankings';
import { isEventArchived } from '../utils/eventVisibility';
import { markQueueDirty } from '../services/queueVersion';
import { auditRequest } from './audit';

const router = express.Router();

// Allowed fields for PATCH updates on seeding_scores
const ALLOWED_SCORE_UPDATE_FIELDS = [
  'score',
  'score_submission_id',
  'scored_at',
];

// GET /seeding/scores/team/:teamId - Get scores for team (public for judges)
router.get('/scores/team/:teamId', async (req: Request, res: Response) => {
  const { teamId } = req.params;
  const db = await getDatabase();

  const scores = await db.all(
    'SELECT * FROM seeding_scores WHERE team_id = ? ORDER BY round_number ASC',
    [teamId],
  );

  res.json(scores);
});

// GET /seeding/scores/event/:eventId - Get all scores for event (public; blocked for archived events)
router.get('/scores/event/:eventId', async (req: Request, res: Response) => {
  const { eventId } = req.params;
  if (await isEventArchived(eventId)) {
    return res.status(404).json({ error: 'Event not found' });
  }
  const db = await getDatabase();

  const scores = await db.all(
    `SELECT ss.*, t.team_number, t.team_name, t.display_name
     FROM seeding_scores ss
     JOIN teams t ON ss.team_id = t.id
     WHERE t.event_id = ?
     ORDER BY t.team_number ASC, ss.round_number ASC`,
    [eventId],
  );

  res.json(scores);
});

// POST /seeding/scores - Submit seeding score (admin only)
router.post('/scores', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { team_id, round_number, score, score_submission_id } = req.body;

    if (!team_id || !round_number) {
      return res
        .status(400)
        .json({ error: 'team_id and round_number are required' });
    }

    const db = await getDatabase();

    const oldScore = await db.get(
      'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
      [team_id, round_number],
    );

    const result = await db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score, score_submission_id, scored_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(team_id, round_number) DO UPDATE SET
         score = excluded.score,
         score_submission_id = excluded.score_submission_id,
         scored_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [team_id, round_number, score ?? null, score_submission_id ?? null],
    );

    const seedingScore = await db.get(
      'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
      [team_id, round_number],
    );

    const team = await db.get<{ event_id: number }>(
      'SELECT event_id FROM teams WHERE id = ?',
      [team_id],
    );
    await auditRequest(db, req, {
      event_id: team?.event_id ?? null,
      action: 'seeding_score_submitted',
      entity_type: 'seeding_score',
      entity_id: seedingScore?.id ?? result.lastID,
      old_value: oldScore,
      new_value: seedingScore,
    });
    if (team) {
      // Scored rounds leave the seeding queue on the next queue read.
      await markQueueDirty(db, team.event_id);
    }

    res.status(201).json(seedingScore ?? { id: result.lastID });
  } catch (error) {
    console.error('Error submitting seeding score:', error);
    if (isForeignKeyConstraintError(error)) {
      return res.status(400).json({ error: 'Team does not exist' });
    }
    if (isCheckConstraintError(error)) {
      return res
        .status(400)
        .json({ error: 'Invalid round_number (must be > 0)' });
    }
    res.status(500).json({ error: 'Failed to submit seeding score' });
  }
});

// PATCH /seeding/scores/:id - Update score (admin only)
router.patch(
  '/scores/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const db = await getDatabase();

    // Filter to only allowed fields
    const updates = Object.entries(req.body).filter(([key]) =>
      ALLOWED_SCORE_UPDATE_FIELDS.includes(key),
    );

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
    const values = updates.map(([, value]) => value);

    const oldScore = await db.get('SELECT * FROM seeding_scores WHERE id = ?', [
      id,
    ]);
    const result = await db.run(
      `UPDATE seeding_scores SET ${setClause} WHERE id = ?`,
      [...values, id],
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Seeding score not found' });
    }

    const score = await db.get('SELECT * FROM seeding_scores WHERE id = ?', [
      id,
    ]);

    if (score) {
      const team = await db.get<{ event_id: number }>(
        'SELECT event_id FROM teams WHERE id = ?',
        [score.team_id],
      );
      await auditRequest(db, req, {
        event_id: team?.event_id ?? null,
        action: 'seeding_score_updated',
        entity_type: 'seeding_score',
        entity_id: Number(id),
        old_value: oldScore,
        new_value: score,
      });
      if (team) {
        await markQueueDirty(db, team.event_id);
      }
    }

    res.json(score);
  },
);

// DELETE /seeding/scores/:id - Delete score (admin only)
router.delete(
  '/scores/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const db = await getDatabase();

    const existing = await db.get<{ team_id: number }>(
      'SELECT * FROM seeding_scores WHERE id = ?',
      [id],
    );

    // DELETE is idempotent
    await db.run('DELETE FROM seeding_scores WHERE id = ?', [id]);

    if (existing) {
      const team = await db.get<{ event_id: number }>(
        'SELECT event_id FROM teams WHERE id = ?',
        [existing.team_id],
      );
      await auditRequest(db, req, {
        event_id: team?.event_id ?? null,
        action: 'seeding_score_deleted',
        entity_type: 'seeding_score',
        entity_id: Number(id),
        old_value: existing,
      });
      if (team) {
        // Deleted score re-queues the round on the next queue read.
        await markQueueDirty(db, team.event_id);
      }
    }

    res.status(204).send();
  },
);

// GET /seeding/rankings/event/:eventId - Get rankings for event (public; blocked for archived events)
router.get('/rankings/event/:eventId', async (req: Request, res: Response) => {
  const { eventId } = req.params;
  if (await isEventArchived(eventId)) {
    return res.status(404).json({ error: 'Event not found' });
  }
  const db = await getDatabase();

  const rankings = await db.all(
    `SELECT sr.*, t.team_number, t.team_name, t.display_name
     FROM seeding_rankings sr
     JOIN teams t ON sr.team_id = t.id
     WHERE t.event_id = ?
     ORDER BY sr.seed_rank ASC NULLS LAST`,
    [eventId],
  );

  res.json(rankings);
});

// POST /seeding/rankings/recalculate/:eventId - Recalculate rankings (admin only)
router.post(
  '/rankings/recalculate/:eventId',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    const { eventId } = req.params;
    const db = await getDatabase();

    // Recalculate using shared service
    const result = await recalculateSeedingRankings(parseInt(eventId, 10));

    if (result.teamsRanked === 0 && result.teamsUnranked === 0) {
      return res.status(404).json({ error: 'No teams found for this event' });
    }

    await auditRequest(db, req, {
      event_id: Number(eventId),
      action: 'seeding_rankings_recalculated',
      entity_type: 'event',
      entity_id: Number(eventId),
      new_value: result,
    });

    // Fetch and return updated rankings
    const updatedRankings = await db.all(
      `SELECT sr.*, t.team_number, t.team_name, t.display_name
       FROM seeding_rankings sr
       JOIN teams t ON sr.team_id = t.id
       WHERE t.event_id = ?
       ORDER BY sr.seed_rank ASC NULLS LAST`,
      [eventId],
    );

    res.json({
      message: 'Rankings recalculated',
      rankings: updatedRankings,
      teamsRanked: result.teamsRanked,
      teamsUnranked: result.teamsUnranked,
    });
  },
);

export default router;
