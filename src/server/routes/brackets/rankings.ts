import { Request, Response, Router } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { getDatabase } from '../../database/connection';
import {
  calculateBracketRankings,
  calculateBracketRankingsIfReady,
} from '../../services/bracketRankings';
import { areFinalScoresReleased } from '../../utils/eventVisibility';
import { listRankedBracketEntries } from '../../services/bracketQueries';

export function registerRankingRoutes(
  publicRouter: Router,
  authRouter: Router,
): void {
  // GET /brackets/:id/rankings/public
  publicRouter.get(
    '/:id/rankings/public',
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const db = await getDatabase();

        const bracket = await db.get<{
          id: number;
          weight: number;
          event_id: number;
        }>('SELECT id, weight, event_id FROM brackets WHERE id = ?', [id]);

        if (!bracket) {
          return res.status(404).json({ error: 'Not found' });
        }

        if (!(await areFinalScoresReleased(bracket.event_id))) {
          return res.status(404).json({ error: 'Not found' });
        }

        await calculateBracketRankingsIfReady(Number(id));

        const entries = await listRankedBracketEntries(
          db,
          bracket.event_id,
          id,
          { includeInitialSlot: false },
        );

        res.json({ weight: bracket.weight, entries });
      } catch (error) {
        console.error('Error fetching public bracket rankings:', error);
        res.status(500).json({ error: 'Failed to fetch bracket rankings' });
      }
    },
  );

  // GET /brackets/:id/rankings
  authRouter.get('/:id/rankings', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const bracket = await db.get<{
        id: number;
        weight: number;
        event_id: number;
      }>('SELECT id, weight, event_id FROM brackets WHERE id = ?', [id]);

      if (!bracket) {
        return res.status(404).json({ error: 'Bracket not found' });
      }

      await calculateBracketRankingsIfReady(Number(id));

      const entries = await listRankedBracketEntries(db, bracket.event_id, id, {
        includeInitialSlot: true,
      });

      res.json({ weight: bracket.weight, entries });
    } catch (error) {
      console.error('Error fetching bracket rankings:', error);
      res.status(500).json({ error: 'Failed to fetch bracket rankings' });
    }
  });

  // POST /brackets/:id/rankings/calculate
  authRouter.post(
    '/:id/rankings/calculate',
    async (req: AuthRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ error: 'Invalid bracket ID' });
        }

        const db = await getDatabase();
        const bracket = await db.get('SELECT id FROM brackets WHERE id = ?', [
          id,
        ]);
        if (!bracket) {
          return res.status(404).json({ error: 'Bracket not found' });
        }

        const result = await calculateBracketRankings(id);
        res.json(result);
      } catch (error) {
        const errMsg = (error as Error).message || '';
        if (errMsg.includes('Cannot calculate rankings')) {
          return res.status(400).json({ error: errMsg });
        }
        console.error('Error calculating bracket rankings:', error);
        res.status(500).json({ error: 'Failed to calculate bracket rankings' });
      }
    },
  );
}
