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

// PATCH /queue/:id - Update queue item status
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

// POST /queue/reorder - Reorder queue items
router.post(
  '/reorder',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
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
  },
);

export default router;
