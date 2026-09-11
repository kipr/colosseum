import { Request, Response, Router } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { getDatabase } from '../../database/connection';
import {
  isCheckConstraintError,
  isForeignKeyConstraintError,
} from '../../database/constraintErrors';
import { calculateBracketRankingsIfReady } from '../../services/bracketRankings';
import { isEventArchived } from '../../utils/eventVisibility';
import { bumpQueueVersion, markQueueDirty } from '../../services/queueVersion';
import { createBracket } from '../../services/bracketCreate';
import {
  getBracketById,
  listBracketGamesWithTeams,
  listPublicBracketEntries,
} from '../../services/bracketQueries';
import { sendServiceResult } from './http';

const ALLOWED_BRACKET_UPDATE_FIELDS = [
  'name',
  'bracket_size',
  'actual_team_count',
  'status',
  'weight',
];

export function registerCrudRoutes(
  publicRouter: Router,
  authRouter: Router,
): void {
  // GET /brackets/:id
  publicRouter.get('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const bracket = await getBracketById(db, id);

      if (bracket && (await isEventArchived(bracket.event_id))) {
        return res.status(404).json({ error: 'Bracket not found' });
      }

      if (!bracket) {
        return res.status(404).json({ error: 'Bracket not found' });
      }

      await calculateBracketRankingsIfReady(Number(id));

      const entries = await listPublicBracketEntries(db, id);
      const games = await listBracketGamesWithTeams(db, id);

      res.json({
        ...bracket,
        entries,
        games,
      });
    } catch (error) {
      console.error('Error fetching bracket:', error);
      res.status(500).json({ error: 'Failed to fetch bracket' });
    }
  });

  // POST /brackets
  authRouter.post('/', async (req: AuthRequest, res: Response) => {
    try {
      const db = await getDatabase();
      const result = await createBracket(db, {
        ...req.body,
        created_by: req.user?.id || null,
      });
      sendServiceResult(res, result);
    } catch (error) {
      console.error('Error creating bracket:', error);
      if (isForeignKeyConstraintError(error)) {
        return res.status(400).json({ error: 'Event does not exist' });
      }
      if (isCheckConstraintError(error)) {
        return res.status(400).json({ error: 'Invalid status value' });
      }
      res.status(500).json({ error: 'Failed to create bracket' });
    }
  });

  // PATCH /brackets/:id
  authRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      if (
        req.body.weight !== undefined &&
        (typeof req.body.weight !== 'number' ||
          req.body.weight <= 0 ||
          req.body.weight > 1)
      ) {
        return res
          .status(400)
          .json({ error: 'weight must be a number in (0, 1]' });
      }

      const updates = Object.entries(req.body).filter(([key]) =>
        ALLOWED_BRACKET_UPDATE_FIELDS.includes(key),
      );

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
      const values = updates.map(([, value]) => value);

      const result = await db.run(
        `UPDATE brackets SET ${setClause} WHERE id = ?`,
        [...values, id],
      );

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Bracket not found' });
      }

      const bracket = await db.get<
        { event_id: number } & Record<string, unknown>
      >('SELECT * FROM brackets WHERE id = ?', [id]);
      if (!bracket) {
        return res.status(404).json({ error: 'Bracket not found' });
      }
      await bumpQueueVersion(db, bracket.event_id);
      res.json(bracket);
    } catch (error) {
      console.error('Error updating bracket:', error);
      if (isCheckConstraintError(error)) {
        return res
          .status(400)
          .json({ error: 'Invalid field value (check constraint failed)' });
      }
      res.status(500).json({ error: 'Failed to update bracket' });
    }
  });

  // DELETE /brackets/:id
  authRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const bracket = await db.get<{ event_id: number }>(
        'SELECT event_id FROM brackets WHERE id = ?',
        [id],
      );

      await db.run('DELETE FROM brackets WHERE id = ?', [id]);

      if (bracket) {
        await markQueueDirty(db, bracket.event_id);
      }

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting bracket:', error);
      res.status(500).json({ error: 'Failed to delete bracket' });
    }
  });
}
