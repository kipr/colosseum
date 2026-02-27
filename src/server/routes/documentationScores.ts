import express, { Response } from 'express';
import { requireAdmin, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

const ALLOWED_CATEGORY_UPDATE_FIELDS = [
  'name',
  'weight',
  'max_score',
  'ordinal',
];

/**
 * Compute overall_score from sub-scores using:
 * sum((score / max_score) * weight)
 */
function computeOverallScore(
  subScores: { score: number; max_score: number; weight: number }[],
): number {
  let total = 0;
  for (const { score, max_score, weight } of subScores) {
    if (max_score > 0) {
      total += (score / max_score) * weight;
    }
  }
  return total;
}

// GET /documentation-scores/categories/event/:eventId
router.get(
  '/categories/event/:eventId',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const db = await getDatabase();

      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventId,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const categories = await db.all(
        `SELECT * FROM documentation_score_categories
         WHERE event_id = ?
         ORDER BY ordinal ASC`,
        [eventId],
      );

      res.json(categories);
    } catch (error) {
      console.error('Error fetching documentation categories:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch documentation categories' });
    }
  },
);

// POST /documentation-scores/categories
router.post(
  '/categories',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { event_id, ordinal, name, weight, max_score } = req.body;

      if (!event_id || !ordinal || !name || max_score == null) {
        return res.status(400).json({
          error: 'event_id, ordinal, name, and max_score are required',
        });
      }

      const ord = parseInt(String(ordinal), 10);
      if (ord < 1 || ord > 4) {
        return res.status(400).json({
          error: 'ordinal must be between 1 and 4',
        });
      }

      const w = weight != null ? parseFloat(String(weight)) : 1.0;
      if (w < 0) {
        return res.status(400).json({ error: 'weight must be non-negative' });
      }

      const max = parseFloat(String(max_score));
      if (max <= 0 || !Number.isFinite(max)) {
        return res.status(400).json({
          error: 'max_score must be a positive number',
        });
      }

      const db = await getDatabase();

      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        event_id,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const result = await db.run(
        `INSERT INTO documentation_score_categories (event_id, ordinal, name, weight, max_score)
         VALUES (?, ?, ?, ?, ?)`,
        [event_id, ord, String(name).trim(), w, max],
      );

      const category = await db.get(
        'SELECT * FROM documentation_score_categories WHERE id = ?',
        [result.lastID],
      );
      res.status(201).json(category);
    } catch (error) {
      console.error('Error creating documentation category:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('UNIQUE constraint failed')) {
        return res.status(409).json({
          error: 'A category with this ordinal already exists for this event',
        });
      }
      res
        .status(500)
        .json({ error: 'Failed to create documentation category' });
    }
  },
);

// PATCH /documentation-scores/categories/:id
router.patch(
  '/categories/:id',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const updates = Object.entries(req.body).filter(([key]) =>
        ALLOWED_CATEGORY_UPDATE_FIELDS.includes(key),
      );

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      for (const [key, value] of updates) {
        if (key === 'ordinal') {
          const ord = parseInt(String(value), 10);
          if (ord < 1 || ord > 4) {
            return res.status(400).json({
              error: 'ordinal must be between 1 and 4',
            });
          }
        }
        if (key === 'weight' && parseFloat(String(value)) < 0) {
          return res.status(400).json({ error: 'weight must be non-negative' });
        }
        if (
          key === 'max_score' &&
          (parseFloat(String(value)) <= 0 ||
            !Number.isFinite(parseFloat(String(value))))
        ) {
          return res.status(400).json({
            error: 'max_score must be a positive number',
          });
        }
      }

      const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
      const resolvedValues = updates.map(([key, value]) => {
        if (key === 'ordinal') return parseInt(String(value), 10);
        if (key === 'weight' || key === 'max_score')
          return parseFloat(String(value));
        return typeof value === 'string' ? String(value).trim() : value;
      });

      const result = await db.run(
        `UPDATE documentation_score_categories SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...resolvedValues, id],
      );

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }

      const category = await db.get(
        'SELECT * FROM documentation_score_categories WHERE id = ?',
        [id],
      );
      res.json(category);
    } catch (error) {
      console.error('Error updating documentation category:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('UNIQUE constraint failed')) {
        return res.status(409).json({
          error: 'A category with this ordinal already exists for this event',
        });
      }
      res
        .status(500)
        .json({ error: 'Failed to update documentation category' });
    }
  },
);

// DELETE /documentation-scores/categories/:id
router.delete(
  '/categories/:id',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const result = await db.run(
        'DELETE FROM documentation_score_categories WHERE id = ?',
        [id],
      );

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting documentation category:', error);
      res
        .status(500)
        .json({ error: 'Failed to delete documentation category' });
    }
  },
);

// GET /documentation-scores/event/:eventId
router.get(
  '/event/:eventId',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const db = await getDatabase();

      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventId,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const scores = await db.all(
        `SELECT ds.*, t.team_number, t.team_name, t.display_name
         FROM documentation_scores ds
         JOIN teams t ON ds.team_id = t.id
         WHERE ds.event_id = ?
         ORDER BY t.team_number ASC`,
        [eventId],
      );

      // Attach sub-scores for each
      for (const row of scores) {
        const subScores = await db.all(
          `SELECT dss.*, dsc.name as category_name, dsc.ordinal, dsc.max_score, dsc.weight
           FROM documentation_sub_scores dss
           JOIN documentation_score_categories dsc ON dss.category_id = dsc.id
           WHERE dss.documentation_score_id = ?
           ORDER BY dsc.ordinal ASC`,
          [row.id],
        );
        (row as Record<string, unknown>).sub_scores = subScores;
      }

      res.json(scores);
    } catch (error) {
      console.error('Error fetching documentation scores for event:', error);
      res.status(500).json({
        error: 'Failed to fetch documentation scores for event',
      });
    }
  },
);

// GET /documentation-scores/team/:teamId
router.get(
  '/team/:teamId',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { teamId } = req.params;
      const db = await getDatabase();

      const team = await db.get(
        'SELECT id, event_id, team_number, team_name, display_name FROM teams WHERE id = ?',
        [teamId],
      );
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }

      const docScore = await db.get(
        'SELECT * FROM documentation_scores WHERE team_id = ?',
        [teamId],
      );

      if (!docScore) {
        return res.json({
          team,
          documentation_score: null,
          sub_scores: [],
        });
      }

      const subScores = await db.all(
        `SELECT dss.*, dsc.name as category_name, dsc.ordinal, dsc.max_score, dsc.weight
         FROM documentation_sub_scores dss
         JOIN documentation_score_categories dsc ON dss.category_id = dsc.id
         WHERE dss.documentation_score_id = ?
         ORDER BY dsc.ordinal ASC`,
        [docScore.id],
      );

      res.json({
        team,
        documentation_score: docScore,
        sub_scores: subScores,
      });
    } catch (error) {
      console.error('Error fetching documentation scores for team:', error);
      res.status(500).json({
        error: 'Failed to fetch documentation scores for team',
      });
    }
  },
);

// PUT /documentation-scores/event/:eventId/team/:teamId
router.put(
  '/event/:eventId/team/:teamId',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId, teamId } = req.params;
      const { sub_scores } = req.body as {
        sub_scores?: { category_id: number; score: number }[];
      };

      if (!Array.isArray(sub_scores)) {
        return res.status(400).json({
          error: 'sub_scores must be an array of { category_id, score }',
        });
      }

      const db = await getDatabase();

      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventId,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const team = await db.get('SELECT id, event_id FROM teams WHERE id = ?', [
        teamId,
      ]);
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      if (Number(team.event_id) !== parseInt(eventId, 10)) {
        return res.status(400).json({
          error: 'Team does not belong to this event',
        });
      }

      const categories = await db.all<{
        id: number;
        max_score: number;
        weight: number;
      }>(
        `SELECT id, max_score, weight FROM documentation_score_categories WHERE event_id = ?`,
        [eventId],
      );
      const categoryMap = new Map(categories.map((c) => [c.id, c]));

      const subScoresForCompute: {
        score: number;
        max_score: number;
        weight: number;
      }[] = [];

      for (const item of sub_scores) {
        const catId = item.category_id;
        const cat = categoryMap.get(catId);
        if (!cat) {
          return res.status(400).json({
            error: `Category ${catId} does not exist or does not belong to this event`,
          });
        }
        const score = parseFloat(String(item.score));
        if (!Number.isFinite(score) || score < 0 || score > cat.max_score) {
          return res.status(400).json({
            error: `Score for category ${catId} must be between 0 and ${cat.max_score}`,
          });
        }
        subScoresForCompute.push({
          score,
          max_score: cat.max_score,
          weight: cat.weight,
        });
      }

      const overallScore = computeOverallScore(subScoresForCompute);
      const scoredBy = req.user?.id ?? null;

      const eventIdNum = parseInt(eventId, 10);
      const teamIdNum = parseInt(teamId, 10);

      const existing = await db.get<{ id: number }>(
        'SELECT id FROM documentation_scores WHERE event_id = ? AND team_id = ?',
        [eventIdNum, teamIdNum],
      );

      let docScoreId: number;

      if (existing) {
        await db.run(
          `UPDATE documentation_scores SET overall_score = ?, scored_by = ?, scored_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [overallScore, scoredBy, existing.id],
        );
        docScoreId = existing.id;
        await db.run(
          'DELETE FROM documentation_sub_scores WHERE documentation_score_id = ?',
          [existing.id],
        );
      } else {
        try {
          await db.run(
            `INSERT INTO documentation_scores (event_id, team_id, overall_score, scored_by, scored_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [eventIdNum, teamIdNum, overallScore, scoredBy],
          );
        } catch {
          return res.status(400).json({
            error: 'Invalid category or team reference',
          });
        }
        const inserted = await db.get<{ id: number }>(
          'SELECT id FROM documentation_scores WHERE event_id = ? AND team_id = ?',
          [eventIdNum, teamIdNum],
        );
        if (!inserted) {
          return res.status(500).json({
            error: 'Failed to retrieve inserted documentation score',
          });
        }
        docScoreId = inserted.id;
      }

      for (const item of sub_scores) {
        try {
          await db.run(
            `INSERT INTO documentation_sub_scores (documentation_score_id, category_id, score)
             VALUES (?, ?, ?)`,
            [
              docScoreId,
              Number(item.category_id),
              parseFloat(String(item.score)),
            ],
          );
        } catch {
          return res.status(400).json({
            error: 'Invalid category or team reference',
          });
        }
      }

      const docScore = await db.get(
        `SELECT ds.*, t.team_number, t.team_name, t.display_name
         FROM documentation_scores ds
         JOIN teams t ON ds.team_id = t.id
         WHERE ds.event_id = ? AND ds.team_id = ?`,
        [eventIdNum, teamIdNum],
      );

      const subScores = await db.all(
        `SELECT dss.*, dsc.name as category_name, dsc.ordinal, dsc.max_score, dsc.weight
         FROM documentation_sub_scores dss
         JOIN documentation_score_categories dsc ON dss.category_id = dsc.id
         WHERE dss.documentation_score_id = ?
         ORDER BY dsc.ordinal ASC`,
        [docScore.id],
      );

      res.json({
        ...docScore,
        sub_scores: subScores,
      });
    } catch (error) {
      console.error('Error upserting documentation score:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('FOREIGN KEY')) {
        return res
          .status(400)
          .json({ error: 'Invalid category or team reference' });
      }
      res.status(500).json({ error: 'Failed to upsert documentation score' });
    }
  },
);

// DELETE /documentation-scores/event/:eventId/team/:teamId
router.delete(
  '/event/:eventId/team/:teamId',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId, teamId } = req.params;
      const db = await getDatabase();

      await db.run(
        'DELETE FROM documentation_scores WHERE event_id = ? AND team_id = ?',
        [eventId, teamId],
      );

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting documentation score:', error);
      res.status(500).json({ error: 'Failed to delete documentation score' });
    }
  },
);

export default router;
