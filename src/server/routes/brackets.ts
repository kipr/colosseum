import express, { Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { resolveBracketByes } from '../services/bracketByeResolver';
import {
  calculateBracketRankings,
  calculateBracketRankingsIfReady,
} from '../services/bracketRankings';
import {
  isEventArchived,
  areFinalScoresReleased,
} from '../utils/eventVisibility';
import { createBracket } from '../usecases/createBracket';
import { generateBracketEntries } from '../usecases/generateBracketEntries';
import { generateBracketGames } from '../usecases/generateBracketGames';

const router = express.Router();

// Allowed fields for PATCH updates
const ALLOWED_BRACKET_UPDATE_FIELDS = [
  'name',
  'bracket_size',
  'actual_team_count',
  'status',
  'weight',
];

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

// ============================================================================
// BRACKETS
// ============================================================================

// GET /brackets/event/:eventId/assigned-teams - Teams already in brackets for this event (admin)
router.get(
  '/event/:eventId/assigned-teams',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { eventId } = req.params;
      const db = await getDatabase();

      const assigned = await db.all(
        `SELECT be.team_id, t.team_number, t.team_name, b.id as bracket_id, b.name as bracket_name
         FROM bracket_entries be
         JOIN brackets b ON be.bracket_id = b.id
         JOIN teams t ON be.team_id = t.id
         WHERE b.event_id = ? AND be.team_id IS NOT NULL
         ORDER BY b.name ASC, be.seed_position ASC`,
        [eventId],
      );

      res.json(assigned);
    } catch (error) {
      console.error('Error fetching assigned teams:', error);
      res.status(500).json({ error: 'Failed to fetch assigned teams' });
    }
  },
);

// GET /brackets/event/:eventId - List brackets for event (public; blocked for archived events)
router.get('/event/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    if (await isEventArchived(eventId)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const db = await getDatabase();

    const brackets = await db.all(
      'SELECT * FROM brackets WHERE event_id = ? ORDER BY created_at ASC',
      [eventId],
    );

    res.json(brackets);
  } catch (error) {
    console.error('Error fetching brackets:', error);
    res.status(500).json({ error: 'Failed to fetch brackets' });
  }
});

// GET /brackets/event/:eventId/games - List bracket games across an event (public)
router.get('/event/:eventId/games', async (req: Request, res: Response) => {
  try {
    const eventIdNum = parseInt(req.params.eventId, 10);
    if (Number.isNaN(eventIdNum)) {
      return res.status(400).json({ error: 'Invalid event ID' });
    }

    if (await isEventArchived(eventIdNum)) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const db = await getDatabase();
    const { eligible } = req.query;
    const onlyScoreable = eligible === 'scoreable';
    const whereClauses = ['b.event_id = ?'];
    const params: Array<string | number> = [eventIdNum, eventIdNum];

    if (onlyScoreable) {
      whereClauses.push('bg.team1_id IS NOT NULL');
      whereClauses.push('bg.team2_id IS NOT NULL');
      whereClauses.push("bg.status <> 'completed'");
    }

    const games = await db.all(
      `SELECT
         bg.id AS bracket_game_id,
         bg.id,
         bg.bracket_id,
         b.name AS bracket_name,
         bg.game_number,
         bg.round_name,
         bg.bracket_side,
         bg.status,
         bg.winner_id,
         gq.queue_position,
         bg.team1_id,
         t1.team_number AS team1_number,
         t1.team_name AS team1_name,
         t1.display_name AS team1_display,
         bg.team2_id,
         t2.team_number AS team2_number,
         t2.team_name AS team2_name,
         t2.display_name AS team2_display,
         w.team_number AS winner_number,
         w.team_name AS winner_name,
         w.display_name AS winner_display
       FROM bracket_games bg
       JOIN brackets b ON bg.bracket_id = b.id
       LEFT JOIN game_queue gq
         ON gq.event_id = ?
        AND gq.bracket_game_id = bg.id
        AND gq.queue_type = 'bracket'
       LEFT JOIN teams t1 ON bg.team1_id = t1.id
       LEFT JOIN teams t2 ON bg.team2_id = t2.id
       LEFT JOIN teams w ON bg.winner_id = w.id
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY
         CASE WHEN gq.queue_position IS NULL THEN 1 ELSE 0 END ASC,
         gq.queue_position ASC,
         b.name ASC,
         bg.game_number ASC`,
      params,
    );

    res.json(games);
  } catch (error) {
    console.error('Error fetching event bracket games:', error);
    res.status(500).json({ error: 'Failed to fetch bracket games' });
  }
});

// GET /brackets/templates - Get bracket templates (public)
// Must be registered before /:id to avoid "templates" being matched as bracket id
router.get('/templates', async (req: Request, res: Response) => {
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

// GET /brackets/:id - Get bracket with entries and games (public; blocked for archived events)
// final_rank is intentionally excluded here; use GET /:id/rankings (admin) for that.
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    const bracket = await db.get('SELECT * FROM brackets WHERE id = ?', [id]);

    if (bracket && (await isEventArchived(bracket.event_id))) {
      return res.status(404).json({ error: 'Bracket not found' });
    }

    if (!bracket) {
      return res.status(404).json({ error: 'Bracket not found' });
    }

    await calculateBracketRankingsIfReady(Number(id));

    // Explicit column list omits final_rank and bracket_raw_score to prevent leaking ranking data
    const entries = await db.all(
      `SELECT be.id, be.bracket_id, be.team_id, be.seed_position, be.initial_slot, be.is_bye,
              t.team_number, t.team_name, t.display_name
       FROM bracket_entries be
       LEFT JOIN teams t ON be.team_id = t.id
       WHERE be.bracket_id = ?
       ORDER BY be.seed_position ASC`,
      [id],
    );

    // Get games
    const games = await db.all(
      `SELECT bg.*,
              t1.team_number as team1_number, t1.team_name as team1_name, t1.display_name as team1_display,
              t2.team_number as team2_number, t2.team_name as team2_name, t2.display_name as team2_display,
              w.team_number as winner_number, w.team_name as winner_name, w.display_name as winner_display
       FROM bracket_games bg
       LEFT JOIN teams t1 ON bg.team1_id = t1.id
       LEFT JOIN teams t2 ON bg.team2_id = t2.id
       LEFT JOIN teams w ON bg.winner_id = w.id
       WHERE bg.bracket_id = ?
       ORDER BY bg.game_number ASC`,
      [id],
    );

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

// GET /brackets/:id/rankings/public - Public bracket rankings (released completed events only)
router.get('/:id/rankings/public', async (req: Request, res: Response) => {
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

    const entries = await db.all(
      `SELECT be.id, be.bracket_id, be.team_id, be.seed_position, be.is_bye,
                be.final_rank, be.bracket_raw_score, be.weighted_bracket_raw_score,
                COALESCE(ds.overall_score, 0) AS doc_score,
                COALESCE(sr.raw_seed_score, 0) AS raw_seed_score,
                COALESCE(ds.overall_score, 0) + COALESCE(sr.raw_seed_score, 0) +
                  COALESCE(be.weighted_bracket_raw_score, 0) AS total,
                t.team_number, t.team_name, t.display_name
         FROM bracket_entries be
         LEFT JOIN teams t ON be.team_id = t.id
         LEFT JOIN documentation_scores ds
           ON ds.team_id = be.team_id AND ds.event_id = ?
         LEFT JOIN seeding_rankings sr ON sr.team_id = be.team_id
         WHERE be.bracket_id = ?
         ORDER BY COALESCE(be.final_rank, 9999) ASC, be.seed_position ASC`,
      [bracket.event_id, id],
    );

    res.json({ weight: bracket.weight, entries });
  } catch (error) {
    console.error('Error fetching public bracket rankings:', error);
    res.status(500).json({ error: 'Failed to fetch bracket rankings' });
  }
});

// GET /brackets/:id/rankings - Get bracket entries with final rankings (admin only)
router.get(
  '/:id/rankings',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
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

      const entries = await db.all(
        `SELECT be.id, be.bracket_id, be.team_id, be.seed_position, be.initial_slot, be.is_bye,
                be.final_rank, be.bracket_raw_score, be.weighted_bracket_raw_score,
                COALESCE(ds.overall_score, 0) AS doc_score,
                COALESCE(sr.raw_seed_score, 0) AS raw_seed_score,
                COALESCE(ds.overall_score, 0) + COALESCE(sr.raw_seed_score, 0) +
                  COALESCE(be.weighted_bracket_raw_score, 0) AS total,
                t.team_number, t.team_name, t.display_name
         FROM bracket_entries be
         LEFT JOIN teams t ON be.team_id = t.id
         LEFT JOIN documentation_scores ds
           ON ds.team_id = be.team_id AND ds.event_id = ?
         LEFT JOIN seeding_rankings sr ON sr.team_id = be.team_id
         WHERE be.bracket_id = ?
         ORDER BY COALESCE(be.final_rank, 9999) ASC, be.seed_position ASC`,
        [bracket.event_id, id],
      );

      res.json({ weight: bracket.weight, entries });
    } catch (error) {
      console.error('Error fetching bracket rankings:', error);
      res.status(500).json({ error: 'Failed to fetch bracket rankings' });
    }
  },
);

// POST /brackets - Create bracket
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await createBracket({
      db,
      body: req.body,
      userId: req.user?.id ?? null,
    });
    if (!result.ok) {
      const payload: Record<string, unknown> = { error: result.error };
      if ('conflicts' in result) payload.conflicts = result.conflicts;
      if ('team_ids' in result && result.team_ids) {
        payload.team_ids = result.team_ids;
      }
      return res.status(result.status).json(payload);
    }
    return res.status(result.status).json(result.bracket);
  } catch (error) {
    console.error('Error creating bracket:', error);
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json({ error: 'Event does not exist' });
    }
    if (errMsg.includes('CHECK constraint failed')) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    return res.status(500).json({ error: 'Failed to create bracket' });
  }
});

// PATCH /brackets/:id - Update bracket
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
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

    const bracket = await db.get('SELECT * FROM brackets WHERE id = ?', [id]);
    res.json(bracket);
  } catch (error) {
    console.error('Error updating bracket:', error);
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('CHECK constraint failed')) {
      return res
        .status(400)
        .json({ error: 'Invalid field value (check constraint failed)' });
    }
    res.status(500).json({ error: 'Failed to update bracket' });
  }
});

// DELETE /brackets/:id - Delete bracket
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    await db.run('DELETE FROM brackets WHERE id = ?', [id]);

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting bracket:', error);
    res.status(500).json({ error: 'Failed to delete bracket' });
  }
});

// POST /brackets/:id/rankings/calculate - Calculate final bracket rankings (admin)
router.post(
  '/:id/rankings/calculate',
  requireAuth,
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

// ============================================================================
// BRACKET ENTRIES
// ============================================================================

// POST /brackets/:id/entries - Add entry to bracket
router.post(
  '/:id/entries',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id: bracketId } = req.params;
      const { team_id, seed_position, initial_slot, is_bye } = req.body;

      if (seed_position === undefined) {
        return res.status(400).json({ error: 'seed_position is required' });
      }

      const db = await getDatabase();

      // Application-level constraint: team must belong to same event as bracket
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
         VALUES (?, ?, ?, ?, ?)`,
        [
          bracketId,
          team_id ?? null,
          seed_position,
          initial_slot ?? null,
          is_bye ? 1 : 0,
        ],
      );

      const entry = await db.get('SELECT * FROM bracket_entries WHERE id = ?', [
        result.lastID,
      ]);
      res.status(201).json(entry);
    } catch (error) {
      console.error('Error adding bracket entry:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('UNIQUE constraint failed')) {
        return res.status(409).json({
          error: 'Team or seed position already exists in this bracket',
        });
      }
      if (errMsg.includes('CHECK constraint failed')) {
        return res.status(400).json({
          error:
            'Invalid entry: bye requires null team_id, non-bye requires team_id',
        });
      }
      res.status(500).json({ error: 'Failed to add bracket entry' });
    }
  },
);

// DELETE /brackets/:bracketId/entries/:entryId - Remove entry
router.delete(
  '/:bracketId/entries/:entryId',
  requireAuth,
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

// POST /brackets/:id/entries/generate - Generate entries from seeding rankings
router.post(
  '/:id/entries/generate',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const db = await getDatabase();
      const result = await generateBracketEntries({
        db,
        bracketId: req.params.id,
        force: req.query.force === 'true',
      });
      if (!result.ok) {
        const payload: Record<string, unknown> = { error: result.error };
        if ('entriesCount' in result && result.entriesCount !== undefined) {
          payload.entriesCount = result.entriesCount;
        }
        return res.status(result.status).json(payload);
      }
      const { ok: _ok, ...body } = result;
      void _ok;
      return res.json(body);
    } catch (error) {
      console.error('Error generating bracket entries:', error);
      return res
        .status(500)
        .json({ error: 'Failed to generate bracket entries' });
    }
  },
);

// ============================================================================
// BRACKET GAMES
// ============================================================================

// GET /brackets/:id/games - Get games for bracket (public)
router.get('/:id/games', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    const games = await db.all(
      `SELECT bg.*,
              t1.team_number as team1_number, t1.team_name as team1_name, t1.display_name as team1_display,
              t2.team_number as team2_number, t2.team_name as team2_name, t2.display_name as team2_display,
              w.team_number as winner_number, w.team_name as winner_name, w.display_name as winner_display
       FROM bracket_games bg
       LEFT JOIN teams t1 ON bg.team1_id = t1.id
       LEFT JOIN teams t2 ON bg.team2_id = t2.id
       LEFT JOIN teams w ON bg.winner_id = w.id
       WHERE bg.bracket_id = ?
       ORDER BY bg.game_number ASC`,
      [id],
    );

    res.json(games);
  } catch (error) {
    console.error('Error fetching bracket games:', error);
    res.status(500).json({ error: 'Failed to fetch bracket games' });
  }
});

// POST /brackets/:id/games - Create game in bracket
router.post(
  '/:id/games',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
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

      // Application-level constraint: teams must belong to same event as bracket
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

      const game = await db.get('SELECT * FROM bracket_games WHERE id = ?', [
        result.lastID,
      ]);
      res.status(201).json(game);
    } catch (error) {
      console.error('Error creating bracket game:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('UNIQUE constraint failed')) {
        return res
          .status(409)
          .json({ error: 'Game number already exists in this bracket' });
      }
      if (errMsg.includes('CHECK constraint failed')) {
        return res
          .status(400)
          .json({ error: 'Invalid status or bracket_side value' });
      }
      res.status(500).json({ error: 'Failed to create bracket game' });
    }
  },
);

// PATCH /brackets/games/:id - Update game (scores, winner, etc.)
router.patch(
  '/games/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const updates = Object.entries(req.body).filter(([key]) =>
        ALLOWED_GAME_UPDATE_FIELDS.includes(key),
      );

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      // Application-level constraint: teams must belong to same event as bracket
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

      const updatedGame = await db.get(
        'SELECT * FROM bracket_games WHERE id = ?',
        [id],
      );
      res.json(updatedGame);
    } catch (error) {
      console.error('Error updating bracket game:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('CHECK constraint failed')) {
        return res
          .status(400)
          .json({ error: 'Invalid status or bracket_side value' });
      }
      res.status(500).json({ error: 'Failed to update bracket game' });
    }
  },
);

// POST /brackets/games/:id/advance - Advance winner to next game
router.post(
  '/games/:id/advance',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const game = await db.get('SELECT * FROM bracket_games WHERE id = ?', [
        id,
      ]);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      if (!game.winner_id) {
        return res.status(400).json({ error: 'Game has no winner to advance' });
      }

      const updates: { gameId: number; slot: string; teamId: number }[] = [];

      // Advance winner
      if (game.winner_advances_to_id && game.winner_slot) {
        updates.push({
          gameId: game.winner_advances_to_id,
          slot: game.winner_slot,
          teamId: game.winner_id,
        });
      }

      // Advance loser (for double elimination)
      if (game.loser_id && game.loser_advances_to_id && game.loser_slot) {
        updates.push({
          gameId: game.loser_advances_to_id,
          slot: game.loser_slot,
          teamId: game.loser_id,
        });
      }

      // Execute all updates in a single transaction
      await db.transaction(async (tx) => {
        for (const update of updates) {
          const column = update.slot === 'team1' ? 'team1_id' : 'team2_id';
          await tx.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
            update.teamId,
            update.gameId,
          ]);
        }

        await tx.run(
          `UPDATE bracket_games SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [id],
        );
      });

      // Resolve any downstream bye chains that may have been created
      const byeResolution = await resolveBracketByes(db, game.bracket_id);

      res.json({ message: 'Winner advanced', updates, byeResolution });
    } catch (error) {
      console.error('Error advancing winner:', error);
      res.status(500).json({ error: 'Failed to advance winner' });
    }
  },
);

// POST /brackets/:id/games/generate - Generate games from bracket templates
router.post(
  '/:id/games/generate',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const db = await getDatabase();
      const result = await generateBracketGames({
        db,
        bracketId: req.params.id,
        force: req.query.force === 'true',
      });
      if (!result.ok) {
        const payload: Record<string, unknown> = { error: result.error };
        if ('gamesCount' in result && result.gamesCount !== undefined) {
          payload.gamesCount = result.gamesCount;
        }
        return res.status(result.status).json(payload);
      }
      const { ok: _ok, ...body } = result;
      void _ok;
      return res.json(body);
    } catch (error) {
      console.error('Error generating bracket games:', error);
      return res
        .status(500)
        .json({ error: 'Failed to generate bracket games' });
    }
  },
);

// POST /brackets/:id/advance-winner - Advance winner for a specific game
router.post(
  '/:id/advance-winner',
  requireAuth,
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

      // Get the game and verify it belongs to this bracket
      const game = await db.get(
        'SELECT * FROM bracket_games WHERE id = ? AND bracket_id = ?',
        [game_id, bracketId],
      );

      if (!game) {
        return res
          .status(404)
          .json({ error: 'Game not found in this bracket' });
      }

      if (game.status === 'completed') {
        return res.status(400).json({ error: 'Game is already completed' });
      }

      // Verify winner_id is one of the teams in the game
      if (game.team1_id !== winner_id && game.team2_id !== winner_id) {
        return res.status(400).json({
          error: 'winner_id must be one of the teams in the game',
        });
      }

      // Determine loser
      const loserId =
        game.team1_id === winner_id ? game.team2_id : game.team1_id;

      const updates: { gameId: number; slot: string; teamId: number }[] = [];

      // Prepare winner advancement
      if (game.winner_advances_to_id && game.winner_slot) {
        updates.push({
          gameId: game.winner_advances_to_id,
          slot: game.winner_slot,
          teamId: winner_id,
        });
      }

      // Prepare loser advancement (for double elimination)
      if (loserId && game.loser_advances_to_id && game.loser_slot) {
        updates.push({
          gameId: game.loser_advances_to_id,
          slot: game.loser_slot,
          teamId: loserId,
        });
      }

      // Execute all updates in a single transaction
      await db.transaction(async (tx) => {
        await tx.run(
          `UPDATE bracket_games SET
            winner_id = ?,
            loser_id = ?,
            status = 'completed',
            completed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [winner_id, loserId, game_id],
        );

        for (const update of updates) {
          const column = update.slot === 'team1' ? 'team1_id' : 'team2_id';
          await tx.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
            update.teamId,
            update.gameId,
          ]);
        }
      });

      // Check if destination games are now ready
      for (const update of updates) {
        const destGame = await db.get(
          'SELECT * FROM bracket_games WHERE id = ?',
          [update.gameId],
        );
        if (
          destGame &&
          destGame.team1_id &&
          destGame.team2_id &&
          destGame.status === 'pending'
        ) {
          await db.run(
            `UPDATE bracket_games SET status = 'ready' WHERE id = ?`,
            [update.gameId],
          );
        }
      }

      // Resolve any downstream bye chains that may have been created
      const byeResolution = await resolveBracketByes(
        db,
        parseInt(bracketId, 10),
      );

      res.json({
        message: 'Winner advanced successfully',
        winner_id,
        loser_id: loserId,
        updates,
        byeResolution,
      });
    } catch (error) {
      console.error('Error advancing winner:', error);
      res.status(500).json({ error: 'Failed to advance winner' });
    }
  },
);

// ============================================================================
// BRACKET TEMPLATES
// ============================================================================

// POST /brackets/templates - Create bracket template
router.post(
  '/templates',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        bracket_size,
        game_number,
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
           bracket_size, game_number, round_name, round_number, bracket_side,
           team1_source, team2_source, winner_advances_to, loser_advances_to,
           winner_slot, loser_slot, is_championship, is_grand_final, is_reset_game
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bracket_size,
          game_number,
          round_name,
          round_number,
          bracket_side,
          team1_source,
          team2_source,
          winner_advances_to ?? null,
          loser_advances_to ?? null,
          winner_slot ?? null,
          loser_slot ?? null,
          is_championship ? 1 : 0,
          is_grand_final ? 1 : 0,
          is_reset_game ? 1 : 0,
        ],
      );

      const template = await db.get(
        'SELECT * FROM bracket_templates WHERE id = ?',
        [result.lastID],
      );
      res.status(201).json(template);
    } catch (error) {
      console.error('Error creating bracket template:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('UNIQUE constraint failed')) {
        return res
          .status(409)
          .json({ error: 'Game number already exists for this bracket size' });
      }
      if (errMsg.includes('CHECK constraint failed')) {
        return res.status(400).json({ error: 'Invalid winner_slot value' });
      }
      res.status(500).json({ error: 'Failed to create bracket template' });
    }
  },
);

export default router;
