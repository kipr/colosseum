import express, { Request, Response } from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { publicExpensiveReadLimiter } from '../middleware/rateLimit';
import { getDatabase, Transaction } from '../database/connection';
import { isCheckConstraintError } from '../database/constraintErrors';
import { areFinalScoresReleased } from '../utils/eventVisibility';
import { computeOverallScores } from '../services/overallScores';
import { calculateEventBracketRankingsIfReady } from '../services/bracketRankings';
import { markQueueDirty } from '../services/queueVersion';
import { auditRequest } from './audit';
import seasonsRoutes from './seasons';

const PUBLIC_EVENT_FIELDS = `e.id, e.name, e.status, e.event_date, e.location,
  e.seeding_rounds, e.double_seeding_rounds, e.spectator_results_released,
  e.spectator_listing, e.season_id, s.name AS season_name,
  s.sort_order AS season_sort_order`;
const PUBLIC_EVENT_FROM =
  'FROM events e LEFT JOIN seasons s ON s.id = e.season_id';

const router = express.Router();

router.use('/seasons', seasonsRoutes);

// Allowed fields for PATCH updates
const ALLOWED_UPDATE_FIELDS = [
  'name',
  'description',
  'event_date',
  'location',
  'status',
  'seeding_rounds',
  'double_seeding_rounds',
  'min_rest_minutes',
  'score_accept_mode',
  'spectator_results_released',
  'spectator_listing',
  'season_id',
];

class EventValidationError extends Error {}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) {
    value = Number(value);
  }
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 2147483647
    ? value
    : undefined;
}

function validatePlacementInput(body: Record<string, unknown>): void {
  if (
    Object.prototype.hasOwnProperty.call(body, 'spectator_listing') &&
    body.spectator_listing !== 'current' &&
    body.spectator_listing !== 'archive'
  ) {
    throw new EventValidationError(
      'spectator_listing must be current or archive (not the hidden archived status)',
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(body, 'season_id') &&
    body.season_id !== null &&
    positiveInteger(body.season_id) === undefined
  ) {
    throw new EventValidationError(
      'season_id must be null or a positive 32-bit integer (numeric strings must be canonical)',
    );
  }
}

async function validateResultingPlacement(
  db: Pick<Transaction, 'get'>,
  listing: string,
  seasonId: number | null,
): Promise<void> {
  if (listing === 'archive' && seasonId === null) {
    throw new EventValidationError(
      'A season is required for archive placement',
    );
  }
  if (
    seasonId !== null &&
    !(await db.get('SELECT id FROM seasons WHERE id = ?', [seasonId]))
  ) {
    throw new EventValidationError(
      'season_id must reference an existing season',
    );
  }
}

function eventWriteError(error: unknown, res: Response): Response | undefined {
  if (error instanceof EventValidationError) {
    return res.status(400).json({ error: error.message });
  }
  // The FK also covers a season deleted between validation and persistence.
  if (
    (error as { constraint?: string })?.constraint === 'events_season_id_fkey'
  ) {
    return res
      .status(400)
      .json({ error: 'season_id must reference an existing season' });
  }
  if (isCheckConstraintError(error)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }
}

// GET /events - List all events
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
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
});

function toPublicEvent(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    event_date: row.event_date,
    location: row.location,
    seeding_rounds: row.seeding_rounds,
    double_seeding_rounds: row.double_seeding_rounds,
    spectator_listing: row.spectator_listing,
    season_id: row.season_id,
    season_name: row.season_name,
    season_sort_order: row.season_sort_order,
    final_scores_available:
      row.status === 'complete' && !!row.spectator_results_released,
  };
}

// GET /events/public - Current or public-archive events, never hidden events.
router.get('/public', async (req: Request, res: Response) => {
  if (
    Object.keys(req.query).some((key) => /^(listing|season_id)\[/.test(key))
  ) {
    return res
      .status(400)
      .json({ error: 'listing and season_id must be single scalar selectors' });
  }
  const listing = req.query.listing ?? 'current';
  if (listing !== 'current' && listing !== 'archive') {
    return res
      .status(400)
      .json({ error: 'listing must be current or archive' });
  }
  const seasonId =
    req.query.season_id === undefined
      ? undefined
      : positiveInteger(req.query.season_id);
  if (req.query.season_id !== undefined && seasonId === undefined) {
    return res.status(400).json({
      error:
        'season_id must be a positive 32-bit integer in canonical decimal form',
    });
  }
  const db = await getDatabase();
  const params: (string | number)[] = [listing];
  let query = `SELECT ${PUBLIC_EVENT_FIELDS} ${PUBLIC_EVENT_FROM}
    WHERE e.status != 'archived' AND e.spectator_listing = ?`;
  if (seasonId !== undefined) {
    query += ' AND e.season_id = ?';
    params.push(seasonId);
  }
  query += ' ORDER BY ';
  if (listing === 'archive') {
    query += 's.sort_order DESC, s.id DESC, ';
  }
  query += 'e.event_date DESC NULLS LAST, e.created_at DESC, e.id DESC';
  const events = await db.all(query, params);
  // A move changes both listings and the event's detail back link.
  res.setHeader('Cache-Control', 'public, no-cache');
  res.json(events.map(toPublicEvent));
});

// GET /events/:id/public - Get single event public info (public, for spectators)
router.get('/:id/public', async (req: Request, res: Response) => {
  const { id } = req.params;
  const db = await getDatabase();
  const event = await db.get(
    `SELECT ${PUBLIC_EVENT_FIELDS} ${PUBLIC_EVENT_FROM}
     WHERE e.id = ? AND e.status != 'archived'`,
    [id],
  );
  res.setHeader('Cache-Control', 'public, no-cache');
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  res.json(toPublicEvent(event));
});

// GET /events/:id/overall - Admin overall scores (single request, auth required)
router.get(
  '/:id/overall',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
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
  },
);

// GET /events/:id/overall/public - Public overall scores (released completed events only)
router.get(
  '/:id/overall/public',
  publicExpensiveReadLimiter,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!(await areFinalScoresReleased(id))) {
      return res.status(404).json({ error: 'Not found' });
    }
    const eventId = parseInt(id, 10);
    await calculateEventBracketRankingsIfReady(eventId);
    const rows = await computeOverallScores(eventId);
    res.json(rows);
  },
);

// GET /events/:id - Get single event
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const db = await getDatabase();

  const event = await db.get('SELECT * FROM events WHERE id = ?', [id]);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  res.json(event);
});

// POST /events - Create event (admin only)
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be an object' });
    }
    validatePlacementInput(req.body);
    const {
      name,
      description,
      event_date,
      location,
      status,
      seeding_rounds,
      min_rest_minutes,
      score_accept_mode,
      spectator_listing = 'current',
      season_id = null,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Event name is required' });
    }

    if (
      min_rest_minutes !== undefined &&
      (!Number.isInteger(min_rest_minutes) || min_rest_minutes < 0)
    ) {
      return res.status(400).json({
        error: 'min_rest_minutes must be a non-negative integer',
      });
    }

    const db = await getDatabase();
    const seasonId = season_id === null ? null : positiveInteger(season_id)!;
    await validateResultingPlacement(db, spectator_listing, seasonId);

    const event = await db.get(
      `INSERT INTO events (name, description, event_date, location, status, seeding_rounds, min_rest_minutes, score_accept_mode, created_by, spectator_listing, season_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        name,
        description || null,
        event_date || null,
        location || null,
        status || 'setup',
        seeding_rounds ?? 3,
        min_rest_minutes ?? 3,
        score_accept_mode || 'manual',
        req.user?.id || null,
        spectator_listing,
        seasonId,
      ],
    );

    await auditRequest(db, req, {
      event_id: event.id,
      action: 'event_created',
      entity_type: 'event',
      entity_id: event.id,
      new_value: event,
    });
    res.status(201).json(event);
  } catch (error) {
    if (eventWriteError(error, res)) return;
    throw error;
  }
});

// PATCH /events/:id - Update event (partial, admin only)
router.patch('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be an object' });
    }
    validatePlacementInput(req.body);

    if (
      Object.prototype.hasOwnProperty.call(req.body, 'min_rest_minutes') &&
      (!Number.isInteger(req.body.min_rest_minutes) ||
        req.body.min_rest_minutes < 0)
    ) {
      return res.status(400).json({
        error: 'min_rest_minutes must be a non-negative integer',
      });
    }

    // Filter to only allowed fields
    const updates = Object.entries(req.body)
      .filter(([key]) => ALLOWED_UPDATE_FIELDS.includes(key))
      .map(
        ([key, value]) =>
          [
            key,
            key === 'season_id' && value !== null
              ? positiveInteger(value)!
              : value,
          ] as [string, unknown],
      );

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // If status is changing away from 'complete', auto-clear spectator release
    const statusUpdate = updates.find(([key]) => key === 'status');
    if (
      statusUpdate &&
      statusUpdate[1] !== 'complete' &&
      !updates.some(([key]) => key === 'spectator_results_released')
    ) {
      updates.push(['spectator_results_released', 0]);
    }

    const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
    const values = updates.map(([, value]) => value);

    // Lock before merging omitted values: concurrent edits must validate the
    // actual resulting row and audit its real before/after snapshots.
    const result = await db.transaction(async (tx) => {
      const oldEvent = await tx.get(
        'SELECT * FROM events WHERE id = ? FOR UPDATE',
        [id],
      );
      if (!oldEvent) return undefined;
      const fields = Object.fromEntries(updates);
      await validateResultingPlacement(
        tx,
        (fields.spectator_listing ?? oldEvent.spectator_listing) as string,
        Object.prototype.hasOwnProperty.call(fields, 'season_id')
          ? (fields.season_id as number | null)
          : oldEvent.season_id,
      );
      const event = await tx.get(
        `UPDATE events SET ${setClause} WHERE id = ? RETURNING *`,
        [...values, id],
      );
      return { oldEvent, event };
    });

    if (!result) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Changing seeding_rounds adds/removes seeding queue slots.
    if (updates.some(([key]) => key === 'seeding_rounds')) {
      await markQueueDirty(db, Number(id));
    }

    const { oldEvent, event } = result;
    await auditRequest(db, req, {
      event_id: Number(id),
      action: 'event_updated',
      entity_type: 'event',
      entity_id: Number(id),
      old_value: oldEvent,
      new_value: event,
    });
    res.json(event);
  } catch (error) {
    if (eventWriteError(error, res)) return;
    console.error('Error updating event:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// DELETE /events/:id - Delete event (admin only)
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const db = await getDatabase();

  const oldEvent = await db.get('SELECT * FROM events WHERE id = ?', [id]);

  // DELETE is idempotent - return 204 regardless of whether row existed
  await db.run('DELETE FROM events WHERE id = ?', [id]);

  if (oldEvent) {
    // audit_log.event_id references events, so the entry is reachable by
    // entity (event #id) rather than by event.
    await auditRequest(db, req, {
      event_id: null,
      action: 'event_deleted',
      entity_type: 'event',
      entity_id: Number(id),
      old_value: oldEvent,
    });
  }

  res.status(204).send();
});

export default router;
