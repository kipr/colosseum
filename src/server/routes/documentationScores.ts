import express, { Response } from 'express';
import { requireAdmin, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

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

// GET /documentation-scores/global-categories
router.get(
  '/global-categories',
  requireAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      const db = await getDatabase();
      const categories = await db.all(
        `SELECT id, name, weight, max_score FROM documentation_categories ORDER BY name ASC`,
      );
      res.json(categories);
    } catch (error) {
      console.error('Error fetching global documentation categories:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch global documentation categories' });
    }
  },
);

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

      const rows = await db.all(
        `SELECT edc.id as junction_id, edc.event_id, edc.ordinal, dc.id as id, dc.name, dc.weight, dc.max_score
         FROM event_documentation_categories edc
         JOIN documentation_categories dc ON edc.category_id = dc.id
         WHERE edc.event_id = ?
         ORDER BY edc.ordinal ASC`,
        [eventId],
      );
      const categories = rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        event_id: r.event_id,
        ordinal: r.ordinal,
        name: r.name,
        weight: r.weight,
        max_score: r.max_score,
      }));

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
      const { event_id, ordinal, name, weight, max_score, category_id } =
        req.body;

      if (!event_id || !ordinal) {
        return res.status(400).json({
          error: 'event_id and ordinal are required',
        });
      }

      const ord = parseInt(String(ordinal), 10);
      if (ord < 1 || ord > 4) {
        return res.status(400).json({
          error: 'ordinal must be between 1 and 4',
        });
      }

      const db = await getDatabase();

      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        event_id,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      let categoryId: number;

      if (category_id != null) {
        const existing = await db.get(
          'SELECT id, name, weight, max_score FROM documentation_categories WHERE id = ?',
          [category_id],
        );
        if (!existing) {
          return res.status(404).json({ error: 'Global category not found' });
        }
        categoryId = Number(category_id);
      } else {
        if (!name || max_score == null) {
          return res.status(400).json({
            error:
              'name and max_score are required when creating a new category',
          });
        }
        const w = weight != null ? parseFloat(String(weight)) : 1.0;
        if (w < 0) {
          return res.status(400).json({
            error: 'weight must be non-negative',
          });
        }
        const max = parseFloat(String(max_score));
        if (max <= 0 || !Number.isFinite(max)) {
          return res.status(400).json({
            error: 'max_score must be a positive number',
          });
        }
        const result = await db.run(
          `INSERT INTO documentation_categories (name, weight, max_score)
           VALUES (?, ?, ?)`,
          [String(name).trim(), w, max],
        );
        categoryId = result.lastID!;
      }

      await db.run(
        `INSERT INTO event_documentation_categories (event_id, category_id, ordinal)
         VALUES (?, ?, ?)`,
        [event_id, categoryId, ord],
      );

      const category = await db.get(
        `SELECT dc.id, edc.event_id, edc.ordinal, dc.name, dc.weight, dc.max_score
         FROM event_documentation_categories edc
         JOIN documentation_categories dc ON edc.category_id = dc.id
         WHERE edc.event_id = ? AND edc.category_id = ?`,
        [event_id, categoryId],
      );
      res.status(201).json(category);
    } catch (error) {
      console.error('Error creating documentation category:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('UNIQUE constraint failed')) {
        return res.status(409).json({
          error:
            'A category with this ordinal already exists for this event, or this category is already linked',
        });
      }
      res
        .status(500)
        .json({ error: 'Failed to create documentation category' });
    }
  },
);

// PATCH /documentation-scores/categories/:id
// :id is the global category_id; event_id required as query param
router.patch(
  '/categories/:id',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const eventId = req.query.event_id as string | undefined;
      if (!eventId) {
        return res.status(400).json({
          error: 'event_id query parameter is required',
        });
      }

      const { ordinal } = req.body;
      if (ordinal == null) {
        return res.status(400).json({ error: 'ordinal is required' });
      }

      const ord = parseInt(String(ordinal), 10);
      if (ord < 1 || ord > 4) {
        return res.status(400).json({
          error: 'ordinal must be between 1 and 4',
        });
      }

      const db = await getDatabase();

      const result = await db.run(
        `UPDATE event_documentation_categories SET ordinal = ? WHERE event_id = ? AND category_id = ?`,
        [ord, eventId, id],
      );

      if (result.changes === 0) {
        return res
          .status(404)
          .json({ error: 'Category not found for this event' });
      }

      const category = await db.get(
        `SELECT dc.id, edc.event_id, edc.ordinal, dc.name, dc.weight, dc.max_score
         FROM event_documentation_categories edc
         JOIN documentation_categories dc ON edc.category_id = dc.id
         WHERE edc.event_id = ? AND edc.category_id = ?`,
        [eventId, id],
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
// :id is the global category_id; event_id required as query param (removes link only)
router.delete(
  '/categories/:id',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const eventId = req.query.event_id as string | undefined;
      if (!eventId) {
        return res.status(400).json({
          error: 'event_id query parameter is required',
        });
      }

      const db = await getDatabase();

      const result = await db.run(
        'DELETE FROM event_documentation_categories WHERE event_id = ? AND category_id = ?',
        [eventId, id],
      );

      if (result.changes === 0) {
        return res
          .status(404)
          .json({ error: 'Category not found for this event' });
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
          `SELECT dss.*, dc.name as category_name, edc.ordinal, dc.max_score, dc.weight
           FROM documentation_sub_scores dss
           JOIN documentation_categories dc ON dss.category_id = dc.id
           JOIN event_documentation_categories edc ON edc.event_id = ? AND edc.category_id = dc.id
           WHERE dss.documentation_score_id = ?
           ORDER BY edc.ordinal ASC`,
          [eventId, row.id],
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

      const teamRow = team as { id: number; event_id: number };
      const subScores = await db.all(
        `SELECT dss.*, dc.name as category_name, edc.ordinal, dc.max_score, dc.weight
         FROM documentation_sub_scores dss
         JOIN documentation_categories dc ON dss.category_id = dc.id
         JOIN event_documentation_categories edc ON edc.event_id = ? AND edc.category_id = dc.id
         WHERE dss.documentation_score_id = ?
         ORDER BY edc.ordinal ASC`,
        [teamRow.event_id, docScore.id],
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
        category_id: number;
        max_score: number;
        weight: number;
      }>(
        `SELECT dc.id as category_id, dc.max_score, dc.weight
         FROM event_documentation_categories edc
         JOIN documentation_categories dc ON edc.category_id = dc.id
         WHERE edc.event_id = ?`,
        [eventId],
      );
      const categoryMap = new Map(
        categories.map((c) => [
          c.category_id,
          { max_score: c.max_score, weight: c.weight },
        ]),
      );

      const subScoresForCompute: {
        score: number;
        max_score: number;
        weight: number;
      }[] = [];

      for (const item of sub_scores) {
        const catId = Number(item.category_id);
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
        `SELECT dss.*, dc.name as category_name, edc.ordinal, dc.max_score, dc.weight
         FROM documentation_sub_scores dss
         JOIN documentation_categories dc ON dss.category_id = dc.id
         JOIN event_documentation_categories edc ON edc.event_id = ? AND edc.category_id = dc.id
         WHERE dss.documentation_score_id = ?
         ORDER BY edc.ordinal ASC`,
        [eventIdNum, docScore.id],
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
