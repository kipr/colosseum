import express, { Request, Response } from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { listSeedingScoresForTeam } from '../usecases/listSeedingScoresForTeam';
import { listSeedingScoresForEvent } from '../usecases/listSeedingScoresForEvent';
import { upsertSeedingScore } from '../usecases/upsertSeedingScore';
import { updateSeedingScore } from '../usecases/updateSeedingScore';
import { listSeedingRankings } from '../usecases/listSeedingRankings';
import { recalculateSeedingRankings } from '../usecases/recalculateSeedingRankings';

const router = express.Router();

// GET /seeding/scores/team/:teamId - Get scores for team (public for judges)
router.get('/scores/team/:teamId', async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await listSeedingScoresForTeam({
      db,
      teamId: req.params.teamId,
    });
    res.json(result.scores);
  } catch (error) {
    console.error('Error fetching seeding scores:', error);
    res.status(500).json({ error: 'Failed to fetch seeding scores' });
  }
});

// GET /seeding/scores/event/:eventId - Get all scores for event (public; blocked for archived events)
router.get('/scores/event/:eventId', async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await listSeedingScoresForEvent({
      db,
      eventId: req.params.eventId,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json(result.scores);
  } catch (error) {
    console.error('Error fetching event seeding scores:', error);
    res.status(500).json({ error: 'Failed to fetch seeding scores' });
  }
});

// POST /seeding/scores - Submit seeding score (admin only)
router.post('/scores', requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await upsertSeedingScore({ db, body: req.body });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(201).json(result.score);
  } catch (error) {
    console.error('Error submitting seeding score:', error);
    res.status(500).json({ error: 'Failed to submit seeding score' });
  }
});

// PATCH /seeding/scores/:id - Update score (admin only)
router.patch(
  '/scores/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const db = await getDatabase();
      const result = await updateSeedingScore({
        db,
        scoreId: req.params.id,
        body: req.body,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      res.json(result.score);
    } catch (error) {
      console.error('Error updating seeding score:', error);
      res.status(500).json({ error: 'Failed to update seeding score' });
    }
  },
);

// DELETE /seeding/scores/:id - Delete score (admin only)
router.delete(
  '/scores/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const db = await getDatabase();
      // DELETE is idempotent
      await db.run('DELETE FROM seeding_scores WHERE id = ?', [req.params.id]);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting seeding score:', error);
      res.status(500).json({ error: 'Failed to delete seeding score' });
    }
  },
);

// GET /seeding/rankings/event/:eventId - Get rankings for event (public; blocked for archived events)
router.get('/rankings/event/:eventId', async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await listSeedingRankings({
      db,
      eventId: req.params.eventId,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json(result.rankings);
  } catch (error) {
    console.error('Error fetching seeding rankings:', error);
    res.status(500).json({ error: 'Failed to fetch seeding rankings' });
  }
});

// POST /seeding/rankings/recalculate/:eventId - Recalculate rankings (admin only)
router.post(
  '/rankings/recalculate/:eventId',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const db = await getDatabase();
      const result = await recalculateSeedingRankings({
        db,
        eventId: req.params.eventId,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      res.json({
        message: 'Rankings recalculated',
        rankings: result.rankings,
        teamsRanked: result.teamsRanked,
        teamsUnranked: result.teamsUnranked,
      });
    } catch (error) {
      console.error('Error recalculating rankings:', error);
      res.status(500).json({ error: 'Failed to recalculate rankings' });
    }
  },
);

export default router;
