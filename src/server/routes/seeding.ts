import express, { Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

// Allowed fields for PATCH updates on seeding_scores
const ALLOWED_SCORE_UPDATE_FIELDS = [
  'score',
  'score_submission_id',
  'scored_at',
];

// GET /seeding/scores/team/:teamId - Get scores for team (public for judges)
router.get('/scores/team/:teamId', async (req: Request, res: Response) => {
  try {
    const { teamId } = req.params;
    const db = await getDatabase();

    const scores = await db.all(
      'SELECT * FROM seeding_scores WHERE team_id = ? ORDER BY round_number ASC',
      [teamId],
    );

    res.json(scores);
  } catch (error) {
    console.error('Error fetching seeding scores:', error);
    res.status(500).json({ error: 'Failed to fetch seeding scores' });
  }
});

// GET /seeding/scores/event/:eventId - Get all scores for event (public for judges)
router.get('/scores/event/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
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
  } catch (error) {
    console.error('Error fetching event seeding scores:', error);
    res.status(500).json({ error: 'Failed to fetch seeding scores' });
  }
});

// POST /seeding/scores - Submit seeding score (public for judges)
router.post('/scores', async (req: Request, res: Response) => {
  try {
    const { team_id, round_number, score, score_submission_id } = req.body;

    if (!team_id || !round_number) {
      return res
        .status(400)
        .json({ error: 'team_id and round_number are required' });
    }

    const db = await getDatabase();

    // Use INSERT OR REPLACE to handle upsert
    const result = await db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score, score_submission_id, scored_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(team_id, round_number) DO UPDATE SET
         score = excluded.score,
         score_submission_id = excluded.score_submission_id,
         scored_at = CURRENT_TIMESTAMP`,
      [team_id, round_number, score ?? null, score_submission_id ?? null],
    );

    const seedingScore = await db.get(
      'SELECT * FROM seeding_scores WHERE team_id = ? AND round_number = ?',
      [team_id, round_number],
    );

    res.status(201).json(seedingScore ?? { id: result.lastID });
  } catch (error) {
    console.error('Error submitting seeding score:', error);
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json({ error: 'Team does not exist' });
    }
    if (errMsg.includes('CHECK constraint failed')) {
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
    try {
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
      res.json(score);
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
      const { id } = req.params;
      const db = await getDatabase();

      // DELETE is idempotent
      await db.run('DELETE FROM seeding_scores WHERE id = ?', [id]);

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting seeding score:', error);
      res.status(500).json({ error: 'Failed to delete seeding score' });
    }
  },
);

// GET /seeding/rankings/event/:eventId - Get rankings for event (public)
router.get('/rankings/event/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
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
      const { eventId } = req.params;
      const db = await getDatabase();

      // Get all teams for this event
      const teams = await db.all('SELECT id FROM teams WHERE event_id = ?', [
        eventId,
      ]);

      if (teams.length === 0) {
        return res.status(404).json({ error: 'No teams found for this event' });
      }

      // For each team, calculate their ranking based on seeding scores
      // Algorithm: Average of top 2 of 3 scores (as per schema.md)
      const rankings: {
        teamId: number;
        seedAverage: number | null;
        tiebreaker: number | null;
      }[] = [];

      for (const team of teams) {
        const scores = await db.all(
          'SELECT score FROM seeding_scores WHERE team_id = ? AND score IS NOT NULL ORDER BY score DESC',
          [team.id],
        );

        let seedAverage: number | null = null;
        let tiebreaker: number | null = null;

        if (scores.length >= 2) {
          // Average of top 2 scores
          seedAverage = (scores[0].score + scores[1].score) / 2;
          // Tiebreaker: 3rd score if available, else sum of all
          tiebreaker =
            scores.length >= 3
              ? scores[2].score
              : scores.reduce((sum, s) => sum + s.score, 0);
        } else if (scores.length === 1) {
          seedAverage = scores[0].score;
          tiebreaker = scores[0].score;
        }

        rankings.push({ teamId: team.id, seedAverage, tiebreaker });
      }

      // Sort by seed_average DESC, then tiebreaker DESC
      rankings.sort((a, b) => {
        if (a.seedAverage === null && b.seedAverage === null) return 0;
        if (a.seedAverage === null) return 1;
        if (b.seedAverage === null) return -1;
        if (a.seedAverage !== b.seedAverage)
          return b.seedAverage - a.seedAverage;
        if (a.tiebreaker === null && b.tiebreaker === null) return 0;
        if (a.tiebreaker === null) return 1;
        if (b.tiebreaker === null) return -1;
        return b.tiebreaker - a.tiebreaker;
      });

      // Calculate raw seed score (normalized 0-1)
      const maxAverage =
        rankings.find((r) => r.seedAverage !== null)?.seedAverage || 1;

      // Update rankings in database using a single transaction
      await db.transaction((tx) => {
        for (let i = 0; i < rankings.length; i++) {
          const r = rankings[i];
          const seedRank = r.seedAverage !== null ? i + 1 : null;
          const rawSeedScore =
            r.seedAverage !== null ? r.seedAverage / maxAverage : null;

          tx.run(
            `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score, tiebreaker_value)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(team_id) DO UPDATE SET
               seed_average = excluded.seed_average,
               seed_rank = excluded.seed_rank,
               raw_seed_score = excluded.raw_seed_score,
               tiebreaker_value = excluded.tiebreaker_value`,
            [r.teamId, r.seedAverage, seedRank, rawSeedScore, r.tiebreaker],
          );
        }
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
      });
    } catch (error) {
      console.error('Error recalculating rankings:', error);
      res.status(500).json({ error: 'Failed to recalculate rankings' });
    }
  },
);

export default router;
