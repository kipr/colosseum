import express, { Request, Response } from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { recalculateSeedingRankings } from '../services/seedingRankings';
import { isEventArchived } from '../utils/eventVisibility';
import { typedJson } from '../utils/typedJson';
import type {
  EventSeedingRankingsResponse,
  EventSeedingScoresResponse,
  RecalculateSeedingRankingsResponse,
  SeedingRanking,
  SeedingScore,
} from '../../shared/api';

const router = express.Router();

// Allowed fields for PATCH updates on seeding_scores
const ALLOWED_SCORE_UPDATE_FIELDS = [
  'score',
  'score_submission_id',
  'scored_at',
];

// ---------------------------------------------------------------------------
// Typed row → DTO mappers for the wire-typed endpoints below.
// Each `Row` interface mirrors one SQL `SELECT` list exactly; the mapper
// returns the matching `shared/api` DTO so a renamed or dropped column
// fails to compile here instead of silently shipping `undefined`.
// ---------------------------------------------------------------------------

/** Row shape of the `seeding_scores` + `teams` join used below. */
interface SeedingScoreRow {
  readonly id: number;
  readonly team_id: number;
  readonly round_number: number;
  readonly score: number | null;
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
}

const toSeedingScore = (row: SeedingScoreRow): SeedingScore => ({
  id: row.id,
  team_id: row.team_id,
  round_number: row.round_number,
  score: row.score,
  team_number: row.team_number,
  team_name: row.team_name,
  display_name: row.display_name,
});

/** Row shape of the `seeding_rankings` + `teams` join used below. */
interface SeedingRankingRow {
  readonly id: number;
  readonly team_id: number;
  readonly seed_average: number | null;
  readonly seed_rank: number | null;
  readonly raw_seed_score: number | null;
  readonly tiebreaker_value: number | null;
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
}

const toSeedingRanking = (row: SeedingRankingRow): SeedingRanking => ({
  id: row.id,
  team_id: row.team_id,
  seed_average: row.seed_average,
  seed_rank: row.seed_rank,
  raw_seed_score: row.raw_seed_score,
  tiebreaker_value: row.tiebreaker_value,
  team_number: row.team_number,
  team_name: row.team_name,
  display_name: row.display_name,
});

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

// GET /seeding/scores/event/:eventId - Get all scores for event (public; blocked for archived events)
router.get('/scores/event/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    if (await isEventArchived(eventId)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const db = await getDatabase();

    const rows = await db.all<SeedingScoreRow>(
      `SELECT ss.id, ss.team_id, ss.round_number, ss.score,
              t.team_number, t.team_name, t.display_name
       FROM seeding_scores ss
       JOIN teams t ON ss.team_id = t.id
       WHERE t.event_id = ?
       ORDER BY t.team_number ASC, ss.round_number ASC`,
      [eventId],
    );

    const body: EventSeedingScoresResponse = rows.map(toSeedingScore);
    typedJson(res, body);
  } catch (error) {
    console.error('Error fetching event seeding scores:', error);
    res.status(500).json({ error: 'Failed to fetch seeding scores' });
  }
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

// GET /seeding/rankings/event/:eventId - Get rankings for event (public; blocked for archived events)
router.get('/rankings/event/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    if (await isEventArchived(eventId)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const db = await getDatabase();

    const rows = await db.all<SeedingRankingRow>(
      `SELECT sr.id, sr.team_id, sr.seed_average, sr.seed_rank,
              sr.raw_seed_score, sr.tiebreaker_value,
              t.team_number, t.team_name, t.display_name
       FROM seeding_rankings sr
       JOIN teams t ON sr.team_id = t.id
       WHERE t.event_id = ?
       ORDER BY sr.seed_rank ASC NULLS LAST`,
      [eventId],
    );

    const body: EventSeedingRankingsResponse = rows.map(toSeedingRanking);
    typedJson(res, body);
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

      // Recalculate using shared service
      const result = await recalculateSeedingRankings(parseInt(eventId, 10));

      if (result.teamsRanked === 0 && result.teamsUnranked === 0) {
        return res.status(404).json({ error: 'No teams found for this event' });
      }

      // Fetch and return updated rankings
      const rows = await db.all<SeedingRankingRow>(
        `SELECT sr.id, sr.team_id, sr.seed_average, sr.seed_rank,
                sr.raw_seed_score, sr.tiebreaker_value,
                t.team_number, t.team_name, t.display_name
         FROM seeding_rankings sr
         JOIN teams t ON sr.team_id = t.id
         WHERE t.event_id = ?
         ORDER BY sr.seed_rank ASC NULLS LAST`,
        [eventId],
      );

      const body: RecalculateSeedingRankingsResponse = {
        message: 'Rankings recalculated',
        rankings: rows.map(toSeedingRanking),
        teamsRanked: result.teamsRanked,
        teamsUnranked: result.teamsUnranked,
      };
      typedJson(res, body);
    } catch (error) {
      console.error('Error recalculating rankings:', error);
      res.status(500).json({ error: 'Failed to recalculate rankings' });
    }
  },
);

export default router;
