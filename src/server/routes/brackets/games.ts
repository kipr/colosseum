import { Request, Response, Router } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { getDatabase } from '../../database/connection';
import {
  isCheckConstraintError,
  isUniqueConstraintError,
} from '../../database/constraintErrors';
import { isEventArchived } from '../../utils/eventVisibility';
import { markQueueDirty } from '../../services/queueVersion';
import { generateBracketGames } from '../../services/bracketGenerateGames';
import {
  advanceExistingWinner,
  setWinnerAndAdvance,
} from '../../services/bracketAdvance';
import { listBracketGamesWithTeams } from '../../services/bracketQueries';
import { sendServiceResult } from './http';

const ALLOWED_GAME_UPDATE_FIELDS = [
  'team1_id',
  'team2_id',
  'status',
  'winner_id',
  'loser_id',
  'team1_score',
  'team2_score',
  'score_submission_id',
  'scheduled_time',
  'started_at',
  'completed_at',
];

export function registerGameRoutes(
  publicRouter: Router,
  authRouter: Router,
): void {
  // GET /brackets/:id/games
  publicRouter.get('/:id/games', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const bracket = await db.get<{ event_id: number }>(
        'SELECT event_id FROM brackets WHERE id = ?',
        [id],
      );
      if (bracket && (await isEventArchived(bracket.event_id))) {
        return res.status(404).json({ error: 'Bracket not found' });
      }

      const games = await listBracketGamesWithTeams(db, id);
      res.json(games);
    } catch (error) {
      console.error('Error fetching bracket games:', error);
      res.status(500).json({ error: 'Failed to fetch bracket games' });
    }
  });

  // POST /brackets/:id/games
  authRouter.post('/:id/games', async (req: AuthRequest, res: Response) => {
    try {
      const { id: bracketId } = req.params;
      const {
        game_number,
        round_name,
        round_number,
        bracket_side,
        team1_id,
        team2_id,
        team1_source,
        team2_source,
        status,
        winner_advances_to_id,
        loser_advances_to_id,
        winner_slot,
        loser_slot,
        scheduled_time,
      } = req.body;

      if (game_number === undefined) {
        return res.status(400).json({ error: 'game_number is required' });
      }

      const db = await getDatabase();

      const bracket = await db.get(
        'SELECT event_id FROM brackets WHERE id = ?',
        [bracketId],
      );
      if (!bracket) {
        return res.status(404).json({ error: 'Bracket not found' });
      }

      for (const teamId of [team1_id, team2_id].filter(Boolean)) {
        const team = await db.get('SELECT event_id FROM teams WHERE id = ?', [
          teamId,
        ]);
        if (team && team.event_id !== bracket.event_id) {
          return res.status(400).json({
            error: 'Teams must belong to the same event as the bracket',
          });
        }
      }

      const result = await db.run(
        `INSERT INTO bracket_games (
           bracket_id, game_number, round_name, round_number, bracket_side,
           team1_id, team2_id, team1_source, team2_source, status,
           winner_advances_to_id, loser_advances_to_id, winner_slot, loser_slot,
           scheduled_time
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          bracketId,
          game_number,
          round_name ?? null,
          round_number ?? null,
          bracket_side ?? null,
          team1_id ?? null,
          team2_id ?? null,
          team1_source ?? null,
          team2_source ?? null,
          status || 'pending',
          winner_advances_to_id ?? null,
          loser_advances_to_id ?? null,
          winner_slot ?? null,
          loser_slot ?? null,
          scheduled_time ?? null,
        ],
      );

      await markQueueDirty(db, bracket.event_id);

      const game = await db.get('SELECT * FROM bracket_games WHERE id = ?', [
        result.lastID,
      ]);
      res.status(201).json(game);
    } catch (error) {
      console.error('Error creating bracket game:', error);
      if (isUniqueConstraintError(error)) {
        return res
          .status(409)
          .json({ error: 'Game number already exists in this bracket' });
      }
      if (isCheckConstraintError(error)) {
        return res
          .status(400)
          .json({ error: 'Invalid status or bracket_side value' });
      }
      res.status(500).json({ error: 'Failed to create bracket game' });
    }
  });

  // PATCH /brackets/games/:id
  authRouter.patch('/games/:id', async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const updates = Object.entries(req.body).filter(([key]) =>
        ALLOWED_GAME_UPDATE_FIELDS.includes(key),
      );

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const game = await db.get(
        `SELECT bg.bracket_id, b.event_id
         FROM bracket_games bg
         JOIN brackets b ON bg.bracket_id = b.id
         WHERE bg.id = ?`,
        [id],
      );
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      for (const [key, value] of updates) {
        if (
          ['team1_id', 'team2_id', 'winner_id', 'loser_id'].includes(key) &&
          value
        ) {
          const team = await db.get('SELECT event_id FROM teams WHERE id = ?', [
            value,
          ]);
          if (team && team.event_id !== game.event_id) {
            return res.status(400).json({
              error: 'Teams must belong to the same event as the bracket',
            });
          }
        }
      }

      const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
      const values = updates.map(([, value]) => value);

      const result = await db.run(
        `UPDATE bracket_games SET ${setClause} WHERE id = ?`,
        [...values, id],
      );

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Game not found' });
      }

      await markQueueDirty(db, game.event_id);

      const updatedGame = await db.get(
        'SELECT * FROM bracket_games WHERE id = ?',
        [id],
      );
      res.json(updatedGame);
    } catch (error) {
      console.error('Error updating bracket game:', error);
      if (isCheckConstraintError(error)) {
        return res
          .status(400)
          .json({ error: 'Invalid status or bracket_side value' });
      }
      res.status(500).json({ error: 'Failed to update bracket game' });
    }
  });

  // POST /brackets/games/:id/advance
  authRouter.post(
    '/games/:id/advance',
    async (req: AuthRequest, res: Response) => {
      try {
        const { id } = req.params;
        const db = await getDatabase();
        const result = await advanceExistingWinner(db, parseInt(id, 10));
        sendServiceResult(res, result);
      } catch (error) {
        console.error('Error advancing winner:', error);
        res.status(500).json({ error: 'Failed to advance winner' });
      }
    },
  );

  // POST /brackets/:id/games/generate
  authRouter.post(
    '/:id/games/generate',
    async (req: AuthRequest, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const db = await getDatabase();
        const result = await generateBracketGames(
          db,
          parseInt(id, 10),
          force === 'true',
        );
        sendServiceResult(res, result);
      } catch (error) {
        console.error('Error generating bracket games:', error);
        res.status(500).json({ error: 'Failed to generate bracket games' });
      }
    },
  );

  // POST /brackets/:id/advance-winner
  authRouter.post(
    '/:id/advance-winner',
    async (req: AuthRequest, res: Response) => {
      try {
        const { id: bracketId } = req.params;
        const { game_id, winner_id } = req.body;
        const db = await getDatabase();

        if (!game_id || !winner_id) {
          return res
            .status(400)
            .json({ error: 'game_id and winner_id are required' });
        }

        const result = await setWinnerAndAdvance(
          db,
          parseInt(bracketId, 10),
          game_id,
          winner_id,
        );
        sendServiceResult(res, result);
      } catch (error) {
        console.error('Error advancing winner:', error);
        res.status(500).json({ error: 'Failed to advance winner' });
      }
    },
  );
}
