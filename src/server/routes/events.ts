import express, { Response } from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

// Allowed fields for PATCH updates
const ALLOWED_UPDATE_FIELDS = [
  'name',
  'description',
  'event_date',
  'location',
  'status',
  'seeding_rounds',
];

// GET /events - List all events
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const { status } = req.query;

    let query = 'SELECT * FROM events';
    const params: string[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status as string);
    }

    query += ' ORDER BY event_date DESC, created_at DESC';

    const events = await db.all(query, params);
    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /events/:id - Get single event
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    const event = await db.get('SELECT * FROM events WHERE id = ?', [id]);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// POST /events - Create event (admin only)
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, event_date, location, status, seeding_rounds } =
      req.body;

    if (!name) {
      return res.status(400).json({ error: 'Event name is required' });
    }

    const db = await getDatabase();

    const result = await db.run(
      `INSERT INTO events (name, description, event_date, location, status, seeding_rounds, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        event_date || null,
        location || null,
        status || 'setup',
        seeding_rounds ?? 3,
        req.user?.id || null,
      ],
    );

    const event = await db.get('SELECT * FROM events WHERE id = ?', [
      result.lastID,
    ]);
    res.status(201).json(event);
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// PATCH /events/:id - Update event (partial, admin only)
router.patch('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    // Filter to only allowed fields
    const updates = Object.entries(req.body).filter(([key]) =>
      ALLOWED_UPDATE_FIELDS.includes(key),
    );

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
    const values = updates.map(([, value]) => value);

    const result = await db.run(`UPDATE events SET ${setClause} WHERE id = ?`, [
      ...values,
      id,
    ]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = await db.get('SELECT * FROM events WHERE id = ?', [id]);
    res.json(event);
  } catch (error) {
    console.error('Error updating event:', error);
    // Check for constraint violations
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('CHECK constraint failed')) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// DELETE /events/:id - Delete event (admin only)
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    // DELETE is idempotent - return 204 regardless of whether row existed
    await db.run('DELETE FROM events WHERE id = ?', [id]);

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

export default router;
