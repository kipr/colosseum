import express, { Request, Response } from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { publicExpensiveReadLimiter } from '../middleware/rateLimit';
import { getDatabase } from '../database/connection';
import { listEvents } from '../usecases/listEvents';
import { listPublicEvents } from '../usecases/listPublicEvents';
import { getPublicEvent } from '../usecases/getPublicEvent';
import { getEvent } from '../usecases/getEvent';
import { getOverallScores } from '../usecases/getOverallScores';
import { getPublicOverallScores } from '../usecases/getPublicOverallScores';
import { createEvent } from '../usecases/createEvent';
import { updateEvent } from '../usecases/updateEvent';
import { deleteEvent } from '../usecases/deleteEvent';

const router = express.Router();

// GET /events - List all events
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const { status } = req.query;
    const result = await listEvents({
      db,
      status: typeof status === 'string' ? status : undefined,
    });
    res.json(result.events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /events/public - List non-archived events (public, for spectators)
router.get('/public', async (_req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await listPublicEvents({ db });
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json(result.events);
  } catch (error) {
    console.error('Error fetching public events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /events/:id/public - Get single event public info (public, for spectators)
router.get('/:id/public', async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await getPublicEvent({ db, eventId: req.params.id });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json(result.event);
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
      const db = await getDatabase();
      const result = await getOverallScores({ db, eventId: req.params.id });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      res.json(result.rows);
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
      const result = await getPublicOverallScores({ eventId: req.params.id });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching public overall scores:', error);
      res.status(500).json({ error: 'Failed to fetch overall scores' });
    }
  },
);

// GET /events/:id - Get single event
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await getEvent({ db, eventId: req.params.id });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json(result.event);
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// POST /events - Create event (admin only)
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await createEvent({
      db,
      body: req.body,
      userId: req.user?.id ?? null,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(201).json(result.event);
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// PATCH /events/:id - Update event (partial, admin only)
router.patch('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await updateEvent({
      db,
      eventId: req.params.id,
      body: req.body,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json(result.event);
  } catch (error) {
    console.error('Error updating event:', error);
    // Check for constraint violations (e.g. invalid status enum)
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
    const db = await getDatabase();
    await deleteEvent({ db, eventId: req.params.id });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

export default router;
