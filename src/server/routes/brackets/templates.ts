import { Request, Response, Router } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { getDatabase } from '../../database/connection';
import {
  isCheckConstraintError,
  isUniqueConstraintError,
} from '../../database/constraintErrors';

export function registerTemplateRoutes(
  publicRouter: Router,
  authRouter: Router,
): void {
  // GET /brackets/templates — must be registered before GET /:id
  publicRouter.get('/templates', async (req: Request, res: Response) => {
    try {
      const { bracket_size } = req.query;
      const db = await getDatabase();

      let query = 'SELECT * FROM bracket_templates';
      const params: number[] = [];

      if (bracket_size) {
        query += ' WHERE bracket_size = ?';
        params.push(parseInt(bracket_size as string, 10));
      }

      query += ' ORDER BY bracket_size ASC, game_number ASC';

      const templates = await db.all(query, params);
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.json(templates);
    } catch (error) {
      console.error('Error fetching bracket templates:', error);
      res.status(500).json({ error: 'Failed to fetch bracket templates' });
    }
  });

  // POST /brackets/templates
  authRouter.post('/templates', async (req: AuthRequest, res: Response) => {
    try {
      const {
        bracket_size,
        game_number,
        play_order,
        round_name,
        round_number,
        bracket_side,
        team1_source,
        team2_source,
        winner_advances_to,
        loser_advances_to,
        winner_slot,
        loser_slot,
        is_championship,
        is_grand_final,
        is_reset_game,
      } = req.body;

      if (
        !bracket_size ||
        game_number === undefined ||
        !round_name ||
        round_number === undefined ||
        !bracket_side ||
        !team1_source ||
        !team2_source
      ) {
        return res.status(400).json({
          error:
            'bracket_size, game_number, round_name, round_number, bracket_side, team1_source, and team2_source are required',
        });
      }

      const db = await getDatabase();

      const result = await db.run(
        `INSERT INTO bracket_templates (
           bracket_size, game_number, play_order, round_name, round_number, bracket_side,
           team1_source, team2_source, winner_advances_to, loser_advances_to,
           winner_slot, loser_slot, is_championship, is_grand_final, is_reset_game
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          bracket_size,
          game_number,
          play_order ?? null,
          round_name,
          round_number,
          bracket_side,
          team1_source,
          team2_source,
          winner_advances_to ?? null,
          loser_advances_to ?? null,
          winner_slot ?? null,
          loser_slot ?? null,
          !!is_championship,
          !!is_grand_final,
          !!is_reset_game,
        ],
      );

      const template = await db.get(
        'SELECT * FROM bracket_templates WHERE id = ?',
        [result.lastID],
      );
      res.status(201).json(template);
    } catch (error) {
      console.error('Error creating bracket template:', error);
      if (isUniqueConstraintError(error)) {
        return res
          .status(409)
          .json({ error: 'Game number already exists for this bracket size' });
      }
      if (isCheckConstraintError(error)) {
        return res.status(400).json({ error: 'Invalid winner_slot value' });
      }
      res.status(500).json({ error: 'Failed to create bracket template' });
    }
  });
}
