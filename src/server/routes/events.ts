import express, { Request, Response } from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { publicExpensiveReadLimiter } from '../middleware/rateLimit';
import { getDatabase } from '../database/connection';
import {
  isEventArchived,
  areFinalScoresReleased,
} from '../utils/eventVisibility';
import { computeOverallScores } from '../services/overallScores';
import { calculateEventBracketRankingsIfReady } from '../services/bracketRankings';
import { markQueueDirty } from '../services/queueVersion';
import { sendInvalidState, sendNotFound } from '../validation/errors';
import { validatedHandler } from '../validation/middleware';
import {
  createEventRequest,
  eventIdRequest,
  eventRowToUpdateCandidate,
  eventUpdateSchema,
  mergeEventPatch,
  patchEventRequest,
} from '../validation/events';

const PUBLIC_EVENT_FIELDS =
  'id, name, status, event_date, location, seeding_rounds, double_seeding_rounds, spectator_results_released';

const router = express.Router();

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

function toPublicEvent(row: Record<string, unknown>) {
  const { spectator_results_released, ...rest } = row;
  return {
    ...rest,
    final_scores_available:
      rest.status === 'complete' && !!spectator_results_released,
  };
}

// GET /events/public - List non-archived events (public, for spectators)
router.get('/public', async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const events = await db.all(
      `SELECT ${PUBLIC_EVENT_FIELDS} FROM events
       WHERE status != 'archived'
       ORDER BY event_date DESC, created_at DESC`,
    );
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json(events.map(toPublicEvent));
  } catch (error) {
    console.error('Error fetching public events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /events/:id/public - Get single event public info (public, for spectators)
router.get('/:id/public', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (await isEventArchived(id)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const db = await getDatabase();
    const event = await db.get(
      `SELECT ${PUBLIC_EVENT_FIELDS} FROM events WHERE id = ?`,
      [id],
    );
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json(toPublicEvent(event));
  } catch (error) {
    console.error('Error fetching public event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// GET /events/:id/overall - Admin overall scores (single request, auth required)
router.get(
  '/:id/overall',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();
      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        parseInt(id, 10),
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const eventId = parseInt(id, 10);
      await calculateEventBracketRankingsIfReady(eventId);
      const rows = await computeOverallScores(eventId);
      res.json(rows);
    } catch (error) {
      console.error('Error fetching overall scores:', error);
      res.status(500).json({ error: 'Failed to fetch overall scores' });
    }
  },
);

// GET /events/:id/overall/public - Public overall scores (released completed events only)
router.get(
  '/:id/overall/public',
  publicExpensiveReadLimiter,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!(await areFinalScoresReleased(id))) {
        return res.status(404).json({ error: 'Not found' });
      }
      const eventId = parseInt(id, 10);
      await calculateEventBracketRankingsIfReady(eventId);
      const rows = await computeOverallScores(eventId);
      res.json(rows);
    } catch (error) {
      console.error('Error fetching public overall scores:', error);
      res.status(500).json({ error: 'Failed to fetch overall scores' });
    }
  },
);

// GET /events/:id - Get single event
router.get(
  '/:id',
  requireAuth,
  ...validatedHandler(eventIdRequest, async (req, res) => {
    try {
      const { id } = req.validated.params;
      const db = await getDatabase();

      const event = await db.get('SELECT * FROM events WHERE id = ?', [id]);

      if (!event) {
        return sendNotFound(res, 'Event not found');
      }

      res.json(event);
    } catch (error) {
      console.error('Error fetching event:', error);
      res.status(500).json({ error: 'Failed to fetch event' });
    }
  }),
);

// POST /events - Create event (admin only)
router.post(
  '/',
  requireAdmin,
  ...validatedHandler(createEventRequest, async (req, res) => {
    try {
      const {
        name,
        description,
        event_date,
        location,
        status,
        seeding_rounds,
        double_seeding_rounds,
        min_rest_minutes,
        score_accept_mode,
      } = req.validated.body;

      const db = await getDatabase();

      const result = await db.run(
        `INSERT INTO events (name, description, event_date, location, status, seeding_rounds, double_seeding_rounds, min_rest_minutes, score_accept_mode, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          description ?? null,
          event_date ?? null,
          location ?? null,
          status,
          seeding_rounds,
          double_seeding_rounds,
          min_rest_minutes,
          score_accept_mode,
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
  }),
);

// PATCH /events/:id - Update event (partial, admin only)
router.patch(
  '/:id',
  requireAdmin,
  ...validatedHandler(patchEventRequest, async (req, res) => {
    try {
      const { id } = req.validated.params;
      const patch = req.validated.body;
      const db = await getDatabase();

      const existing = await db.get('SELECT * FROM events WHERE id = ?', [id]);
      if (!existing) {
        return sendNotFound(res, 'Event not found');
      }

      const merged = mergeEventPatch(
        eventRowToUpdateCandidate(existing),
        patch,
      );
      const parsed = eventUpdateSchema.safeParse(merged);
      if (!parsed.success) {
        return sendInvalidState(res, 'Invalid event update');
      }
      const next = parsed.data;

      if (
        patch.status !== undefined &&
        next.status !== 'complete' &&
        patch.spectator_results_released === undefined
      ) {
        next.spectator_results_released = 0;
      }

      const result = await db.run(
        `UPDATE events SET
          name = ?, description = ?, event_date = ?, location = ?, status = ?,
          seeding_rounds = ?, double_seeding_rounds = ?, min_rest_minutes = ?,
          score_accept_mode = ?, spectator_results_released = ?
         WHERE id = ?`,
        [
          next.name,
          next.description,
          next.event_date,
          next.location,
          next.status,
          next.seeding_rounds,
          next.double_seeding_rounds,
          next.min_rest_minutes,
          next.score_accept_mode,
          next.spectator_results_released,
          id,
        ],
      );

      if (result.changes === 0) {
        return sendNotFound(res, 'Event not found');
      }

      if (
        patch.seeding_rounds !== undefined &&
        patch.seeding_rounds !== existing.seeding_rounds
      ) {
        await markQueueDirty(db, id);
      }

      const event = await db.get('SELECT * FROM events WHERE id = ?', [id]);
      res.json(event);
    } catch (error) {
      console.error('Error updating event:', error);
      res.status(500).json({ error: 'Failed to update event' });
    }
  }),
);

// DELETE /events/:id - Delete event (admin only)
router.delete(
  '/:id',
  requireAdmin,
  ...validatedHandler(eventIdRequest, async (req, res) => {
    try {
      const { id } = req.validated.params;
      const db = await getDatabase();

      // DELETE is idempotent - return 204 regardless of whether row existed
      await db.run('DELETE FROM events WHERE id = ?', [id]);

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting event:', error);
      res.status(500).json({ error: 'Failed to delete event' });
    }
  }),
);

export default router;
