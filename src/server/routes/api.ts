import express from 'express';
import {
  requireAuth,
  AuthRequest,
  requireJudgeSession,
} from '../middleware/auth';
import { scoreSubmitLimiter } from '../middleware/rateLimit';
import { getDatabase } from '../database/connection';
import { submitEventScore } from '../usecases/submitEventScore';

const router = express.Router();

// Submit a score (requires judge session or admin auth)
router.post(
  '/scores/submit',
  scoreSubmitLimiter,
  requireJudgeSession,
  async (req: express.Request, res: express.Response) => {
    try {
      const db = await getDatabase();
      const result = await submitEventScore({
        db,
        body: req.body,
        ipAddress: req.ip ?? null,
      });

      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }

      res.json(result.submission);
    } catch (error) {
      console.error('Error submitting score:', error);
      res.status(500).json({ error: 'Failed to submit score' });
    }
  },
);

// Get user's score history
router.get(
  '/scores/history',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const db = await getDatabase();
      const scores = await db.all(
        `SELECT s.*, t.name as template_name 
       FROM score_submissions s
       JOIN scoresheet_templates t ON s.template_id = t.id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC
       LIMIT 50`,
        [req.user.id],
      );

      // Parse score_data JSON
      scores.forEach((score) => {
        score.score_data = JSON.parse(score.score_data);
      });

      res.json(scores);
    } catch (error) {
      console.error('Error fetching score history:', error);
      res.status(500).json({ error: 'Failed to fetch score history' });
    }
  },
);

export default router;
