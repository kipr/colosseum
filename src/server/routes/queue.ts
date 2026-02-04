import express, { Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

// Allowed fields for PATCH updates
const ALLOWED_UPDATE_FIELDS = ['status', 'table_number'];

// GET /queue/event/:eventId - Get queue for event (public for judges)
router.get('/event/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { status, queue_type } = req.query;
    const db = await getDatabase();

    let query = `
      SELECT gq.*,
             bg.game_number, bg.round_name, bg.bracket_side,
             t1.team_number as team1_number, t1.team_name as team1_name, t1.display_name as team1_display,
             t2.team_number as team2_number, t2.team_name as team2_name, t2.display_name as team2_display,
             st.team_number as seeding_team_number, st.team_name as seeding_team_name, st.display_name as seeding_team_display
      FROM game_queue gq
      LEFT JOIN bracket_games bg ON gq.bracket_game_id = bg.id
      LEFT JOIN teams t1 ON bg.team1_id = t1.id
      LEFT JOIN teams t2 ON bg.team2_id = t2.id
      LEFT JOIN teams st ON gq.seeding_team_id = st.id
      WHERE gq.event_id = ?
    `;
    const params: (string | number)[] = [eventId];

    if (status) {
      query += ' AND gq.status = ?';
      params.push(status as string);
    }

    if (queue_type) {
      query += ' AND gq.queue_type = ?';
      params.push(queue_type as string);
    }

    query += ' ORDER BY gq.queue_position ASC';

    const queue = await db.all(query, params);
    res.json(queue);
  } catch (error) {
    console.error('Error fetching game queue:', error);
    res.status(500).json({ error: 'Failed to fetch game queue' });
  }
});

// POST /queue - Add item to queue
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const {
      event_id,
      bracket_game_id,
      seeding_team_id,
      seeding_round,
      queue_type,
      queue_position,
      table_number,
    } = req.body;

    if (!event_id || !queue_type) {
      return res
        .status(400)
        .json({ error: 'event_id and queue_type are required' });
    }

    // Validate queue_type constraints
    if (queue_type === 'bracket' && !bracket_game_id) {
      return res
        .status(400)
        .json({ error: 'bracket_game_id is required for bracket queue type' });
    }
    if (queue_type === 'seeding' && (!seeding_team_id || !seeding_round)) {
      return res.status(400).json({
        error:
          'seeding_team_id and seeding_round are required for seeding queue type',
      });
    }

    const db = await getDatabase();

    // Application-level constraint: never queue the same game/seeding round twice
    if (queue_type === 'bracket') {
      const existing = await db.get(
        'SELECT id FROM game_queue WHERE bracket_game_id = ?',
        [bracket_game_id],
      );
      if (existing) {
        return res
          .status(409)
          .json({ error: 'This game is already in the queue' });
      }
    } else {
      const existing = await db.get(
        'SELECT id FROM game_queue WHERE seeding_team_id = ? AND seeding_round = ?',
        [seeding_team_id, seeding_round],
      );
      if (existing) {
        return res
          .status(409)
          .json({ error: 'This seeding round is already in the queue' });
      }
    }

    // If no position specified, add to end
    let position = queue_position;
    if (position === undefined) {
      const maxPos = await db.get(
        'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
        [event_id],
      );
      position = (maxPos?.max_pos ?? 0) + 1;
    }

    const result = await db.run(
      `INSERT INTO game_queue (
         event_id, bracket_game_id, seeding_team_id, seeding_round,
         queue_type, queue_position, status, table_number
       ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
      [
        event_id,
        queue_type === 'bracket' ? bracket_game_id : null,
        queue_type === 'seeding' ? seeding_team_id : null,
        queue_type === 'seeding' ? seeding_round : null,
        queue_type,
        position,
        table_number ?? null,
      ],
    );

    const queueItem = await db.get('SELECT * FROM game_queue WHERE id = ?', [
      result.lastID,
    ]);
    res.status(201).json(queueItem);
  } catch (error) {
    console.error('Error adding to queue:', error);
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('FOREIGN KEY constraint failed')) {
      return res
        .status(400)
        .json({ error: 'Event, game, or team does not exist' });
    }
    if (errMsg.includes('CHECK constraint failed')) {
      return res.status(400).json({ error: 'Invalid queue_type or status' });
    }
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

// Shared reorder handler
async function handleReorder(req: AuthRequest, res: Response) {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: 'items array is required with {id, queue_position}' });
    }

    const db = await getDatabase();

    // Filter valid items and execute all updates in a single transaction
    const validItems = items.filter(
      (item) => item.id !== undefined && item.queue_position !== undefined,
    );

    if (validItems.length > 0) {
      await db.transaction((tx) => {
        for (const item of validItems) {
          tx.run('UPDATE game_queue SET queue_position = ? WHERE id = ?', [
            item.queue_position,
            item.id,
          ]);
        }
      });
    }

    res.json({ message: 'Queue reordered', updated: validItems.length });
  } catch (error) {
    console.error('Error reordering queue:', error);
    res.status(500).json({ error: 'Failed to reorder queue' });
  }
}

// POST /queue/reorder - Reorder queue items (MUST be before /:id routes)
router.post('/reorder', requireAuth, handleReorder);

// PATCH /queue/reorder - Reorder queue items (alias for POST)
router.patch('/reorder', requireAuth, handleReorder);

// POST /queue/populate-from-bracket - Populate queue from bracket games
router.post(
  '/populate-from-bracket',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { event_id, bracket_id } = req.body;

      if (!event_id || !bracket_id) {
        return res
          .status(400)
          .json({ error: 'event_id and bracket_id are required' });
      }

      const db = await getDatabase();

      // Verify bracket exists and belongs to the event
      const bracket = await db.get(
        'SELECT id, event_id FROM brackets WHERE id = ?',
        [bracket_id],
      );

      if (!bracket) {
        return res.status(404).json({ error: 'Bracket not found' });
      }

      if (bracket.event_id !== event_id) {
        return res
          .status(400)
          .json({ error: 'Bracket does not belong to this event' });
      }

      // Get eligible bracket games:
      // - status IN ('ready', 'pending')
      // - both teams assigned (team1_id IS NOT NULL AND team2_id IS NOT NULL)
      const eligibleGames = await db.all(
        `SELECT id, game_number FROM bracket_games
         WHERE bracket_id = ?
           AND status IN ('ready', 'pending')
           AND team1_id IS NOT NULL
           AND team2_id IS NOT NULL
         ORDER BY game_number ASC`,
        [bracket_id],
      );

      // Replace: delete existing queue for this event
      await db.run('DELETE FROM game_queue WHERE event_id = ?', [event_id]);

      // Insert eligible games into queue
      let created = 0;
      for (let i = 0; i < eligibleGames.length; i++) {
        const game = eligibleGames[i];
        await db.run(
          `INSERT INTO game_queue (
             event_id, bracket_game_id, queue_type, queue_position, status
           ) VALUES (?, ?, 'bracket', ?, 'queued')`,
          [event_id, game.id, i + 1],
        );
        created++;
      }

      res.json({
        message: 'Queue populated from bracket',
        created,
        bracketGamesTotal: eligibleGames.length,
      });
    } catch (error) {
      console.error('Error populating queue from bracket:', error);
      res.status(500).json({ error: 'Failed to populate queue from bracket' });
    }
  },
);

// POST /queue/populate-from-seeding - Populate queue from unplayed seeding rounds
router.post(
  '/populate-from-seeding',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { event_id } = req.body;

      if (!event_id) {
        return res.status(400).json({ error: 'event_id is required' });
      }

      const db = await getDatabase();

      // Get event and seeding_rounds count
      const event = await db.get(
        'SELECT id, seeding_rounds FROM events WHERE id = ?',
        [event_id],
      );

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const seedingRounds = event.seeding_rounds || 3;

      // Get all teams for this event
      const teams = await db.all(
        'SELECT id, team_number FROM teams WHERE event_id = ? ORDER BY team_number ASC',
        [event_id],
      );

      if (teams.length === 0) {
        return res.status(400).json({ error: 'No teams found for this event' });
      }

      // Get all scored seeding rounds (team_id + round_number with non-null score)
      const teamIds = teams.map((t: { id: number }) => t.id);
      const scoredRounds = await db.all(
        `SELECT team_id, round_number FROM seeding_scores
         WHERE team_id IN (${teamIds.map(() => '?').join(',')})
           AND score IS NOT NULL`,
        teamIds,
      );

      // Build a set of "team_id:round" for scored rounds
      const scoredSet = new Set(
        scoredRounds.map(
          (s: { team_id: number; round_number: number }) =>
            `${s.team_id}:${s.round_number}`,
        ),
      );

      // Build list of unplayed seeding rounds
      const unplayedRounds: { team_id: number; round: number }[] = [];
      for (const team of teams) {
        for (let round = 1; round <= seedingRounds; round++) {
          const key = `${team.id}:${round}`;
          if (!scoredSet.has(key)) {
            unplayedRounds.push({ team_id: team.id, round });
          }
        }
      }

      // Replace: delete existing queue for this event
      await db.run('DELETE FROM game_queue WHERE event_id = ?', [event_id]);

      // Insert unplayed seeding rounds into queue
      let created = 0;
      for (let i = 0; i < unplayedRounds.length; i++) {
        const item = unplayedRounds[i];
        await db.run(
          `INSERT INTO game_queue (
             event_id, seeding_team_id, seeding_round, queue_type, queue_position, status
           ) VALUES (?, ?, ?, 'seeding', ?, 'queued')`,
          [event_id, item.team_id, item.round, i + 1],
        );
        created++;
      }

      res.json({
        message: 'Queue populated from seeding',
        created,
        totalTeams: teams.length,
        totalRounds: seedingRounds,
      });
    } catch (error) {
      console.error('Error populating queue from seeding:', error);
      res.status(500).json({ error: 'Failed to populate queue from seeding' });
    }
  },
);

// PATCH /queue/:id - Update queue item status (MUST be after specific routes like /reorder)
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    const updates = Object.entries(req.body).filter(([key]) =>
      ALLOWED_UPDATE_FIELDS.includes(key),
    );

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
    const values = updates.map(([, value]) => value);

    const result = await db.run(
      `UPDATE game_queue SET ${setClause} WHERE id = ?`,
      [...values, id],
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const queueItem = await db.get('SELECT * FROM game_queue WHERE id = ?', [
      id,
    ]);
    res.json(queueItem);
  } catch (error) {
    console.error('Error updating queue item:', error);
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('CHECK constraint failed')) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    res.status(500).json({ error: 'Failed to update queue item' });
  }
});

// PATCH /queue/:id/call - Call team/game (sets status to 'called' and records time)
router.patch(
  '/:id/call',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { table_number } = req.body;
      const db = await getDatabase();

      let query = `UPDATE game_queue SET status = 'called', called_at = CURRENT_TIMESTAMP`;
      const params: (string | number | null)[] = [];

      if (table_number !== undefined) {
        query += ', table_number = ?';
        params.push(table_number);
      }

      query += ' WHERE id = ?';
      params.push(id);

      const result = await db.run(query, params);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Queue item not found' });
      }

      const queueItem = await db.get('SELECT * FROM game_queue WHERE id = ?', [
        id,
      ]);
      res.json(queueItem);
    } catch (error) {
      console.error('Error calling queue item:', error);
      res.status(500).json({ error: 'Failed to call queue item' });
    }
  },
);

// DELETE /queue/:id - Remove from queue
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    await db.run('DELETE FROM game_queue WHERE id = ?', [id]);

    res.status(204).send();
  } catch (error) {
    console.error('Error removing from queue:', error);
    res.status(500).json({ error: 'Failed to remove from queue' });
  }
});

export default router;
