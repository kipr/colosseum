import { Response, Router } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { getDatabase } from '../../database/connection';
import {
  isCheckConstraintError,
  isUniqueConstraintError,
} from '../../database/constraintErrors';
import { generateBracketEntries } from '../../services/bracketGenerateEntries';
import { sendServiceResult } from './http';

export function registerEntryRoutes(authRouter: Router): void {
  // POST /brackets/:id/entries
  authRouter.post('/:id/entries', async (req: AuthRequest, res: Response) => {
    try {
      const { id: bracketId } = req.params;
      const { team_id, seed_position, initial_slot, is_bye } = req.body;

      if (seed_position === undefined) {
        return res.status(400).json({ error: 'seed_position is required' });
      }

      const db = await getDatabase();

      if (team_id) {
        const bracket = await db.get(
          'SELECT event_id FROM brackets WHERE id = ?',
          [bracketId],
        );
        if (!bracket) {
          return res.status(404).json({ error: 'Bracket not found' });
        }

        const team = await db.get('SELECT event_id FROM teams WHERE id = ?', [
          team_id,
        ]);
        if (!team) {
          return res.status(400).json({ error: 'Team not found' });
        }

        if (team.event_id !== bracket.event_id) {
          return res.status(400).json({
            error: 'Team must belong to the same event as the bracket',
          });
        }
      }

      const result = await db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, initial_slot, is_bye)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        [
          bracketId,
          team_id ?? null,
          seed_position,
          initial_slot ?? null,
          !!is_bye,
        ],
      );

      const entry = await db.get('SELECT * FROM bracket_entries WHERE id = ?', [
        result.lastID,
      ]);
      res.status(201).json(entry);
    } catch (error) {
      console.error('Error adding bracket entry:', error);
      if (isUniqueConstraintError(error)) {
        return res.status(409).json({
          error: 'Team or seed position already exists in this bracket',
        });
      }
      if (isCheckConstraintError(error)) {
        return res.status(400).json({
          error:
            'Invalid entry: bye requires null team_id, non-bye requires team_id',
        });
      }
      res.status(500).json({ error: 'Failed to add bracket entry' });
    }
  });

  // DELETE /brackets/:bracketId/entries/:entryId
  authRouter.delete(
    '/:bracketId/entries/:entryId',
    async (req: AuthRequest, res: Response) => {
      try {
        const { entryId } = req.params;
        const db = await getDatabase();

        await db.run('DELETE FROM bracket_entries WHERE id = ?', [entryId]);

        res.status(204).send();
      } catch (error) {
        console.error('Error removing bracket entry:', error);
        res.status(500).json({ error: 'Failed to remove bracket entry' });
      }
    },
  );

  // POST /brackets/:id/entries/generate
  authRouter.post(
    '/:id/entries/generate',
    async (req: AuthRequest, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const db = await getDatabase();
        const result = await generateBracketEntries(
          db,
          parseInt(id, 10),
          force === 'true',
        );
        sendServiceResult(res, result);
      } catch (error) {
        console.error('Error generating bracket entries:', error);
        res.status(500).json({ error: 'Failed to generate bracket entries' });
      }
    },
  );
}
