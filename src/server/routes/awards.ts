import express, { Response } from 'express';
import { requireAdmin, AuthRequest } from '../middleware/auth';
import { publicExpensiveReadLimiter } from '../middleware/rateLimit';
import { getDatabase } from '../database/connection';
import { areFinalScoresReleased } from '../utils/eventVisibility';

const router = express.Router();

// ============================================================================
// AWARD TEMPLATES (global catalog)
// ============================================================================

// GET /awards/templates
router.get(
  '/templates',
  requireAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      const db = await getDatabase();
      const templates = await db.all(
        'SELECT id, name, description, created_at, updated_at FROM award_templates ORDER BY name ASC',
      );
      res.json(templates);
    } catch (error) {
      console.error('Error fetching award templates:', error);
      res.status(500).json({ error: 'Failed to fetch award templates' });
    }
  },
);

// POST /awards/templates
router.post(
  '/templates',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, description } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      const db = await getDatabase();
      const result = await db.run(
        'INSERT INTO award_templates (name, description) VALUES (?, ?)',
        [String(name).trim(), description ?? null],
      );
      const created = await db.get(
        'SELECT id, name, description, created_at, updated_at FROM award_templates WHERE id = ?',
        [result.lastID],
      );
      res.status(201).json(created);
    } catch (error) {
      console.error('Error creating award template:', error);
      res.status(500).json({ error: 'Failed to create award template' });
    }
  },
);

// PATCH /awards/templates/:id
router.patch(
  '/templates/:id',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { name, description } = req.body;
      const db = await getDatabase();
      const existing = await db.get(
        'SELECT id FROM award_templates WHERE id = ?',
        [id],
      );
      if (!existing) {
        return res.status(404).json({ error: 'Award template not found' });
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      if (name !== undefined) {
        if (!String(name).trim()) {
          return res.status(400).json({ error: 'Name cannot be empty' });
        }
        updates.push('name = ?');
        values.push(String(name).trim());
      }
      if (description !== undefined) {
        updates.push('description = ?');
        values.push(description);
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      values.push(id);
      await db.run(
        `UPDATE award_templates SET ${updates.join(', ')} WHERE id = ?`,
        values,
      );
      const updated = await db.get(
        'SELECT id, name, description, created_at, updated_at FROM award_templates WHERE id = ?',
        [id],
      );
      res.json(updated);
    } catch (error) {
      console.error('Error updating award template:', error);
      res.status(500).json({ error: 'Failed to update award template' });
    }
  },
);

// DELETE /awards/templates/:id
router.delete(
  '/templates/:id',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();
      const existing = await db.get(
        'SELECT id FROM award_templates WHERE id = ?',
        [id],
      );
      if (!existing) {
        return res.status(404).json({ error: 'Award template not found' });
      }
      await db.run('DELETE FROM award_templates WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting award template:', error);
      res.status(500).json({ error: 'Failed to delete award template' });
    }
  },
);

// ============================================================================
// EVENT AWARDS (event-scoped)
// ============================================================================

// GET /awards/event/:eventId
router.get(
  '/event/:eventId',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const db = await getDatabase();
      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventId,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const awards = await db.all(
        `SELECT ea.id, ea.event_id, ea.template_award_id, ea.name, ea.description, ea.sort_order,
                ea.created_at, ea.updated_at
         FROM event_awards ea
         WHERE ea.event_id = ?
         ORDER BY ea.sort_order ASC, ea.id ASC`,
        [eventId],
      );

      const recipients = await db.all(
        `SELECT ear.id, ear.event_award_id, ear.team_id,
                t.team_number, t.team_name, t.display_name
         FROM event_award_recipients ear
         JOIN teams t ON ear.team_id = t.id
         WHERE ear.event_award_id IN (
           SELECT id FROM event_awards WHERE event_id = ?
         )
         ORDER BY t.team_number ASC`,
        [eventId],
      );

      const recipientsByAward = new Map<number, typeof recipients>();
      for (const r of recipients) {
        const awardId = (r as Record<string, unknown>).event_award_id as number;
        if (!recipientsByAward.has(awardId)) {
          recipientsByAward.set(awardId, []);
        }
        recipientsByAward.get(awardId)!.push(r);
      }

      const result = awards.map((a: Record<string, unknown>) => ({
        ...a,
        recipients: recipientsByAward.get(a.id as number) ?? [],
      }));

      res.json(result);
    } catch (error) {
      console.error('Error fetching event awards:', error);
      res.status(500).json({ error: 'Failed to fetch event awards' });
    }
  },
);

// POST /awards/event/:eventId
router.post(
  '/event/:eventId',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const { template_award_id, name, description, sort_order } = req.body;

      const db = await getDatabase();
      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventId,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      let awardName = name;
      let awardDescription = description;

      if (template_award_id) {
        const template = await db.get(
          'SELECT name, description FROM award_templates WHERE id = ?',
          [template_award_id],
        );
        if (!template) {
          return res.status(404).json({ error: 'Award template not found' });
        }
        const t = template as Record<string, unknown>;
        if (!awardName) awardName = t.name;
        if (awardDescription === undefined) awardDescription = t.description;
      }

      if (!awardName || !String(awardName).trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }

      const order =
        sort_order !== undefined
          ? sort_order
          : ((
              (await db.get(
                'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM event_awards WHERE event_id = ?',
                [eventId],
              )) as Record<string, number>
            ).next_order ?? 0);

      const result = await db.run(
        `INSERT INTO event_awards (event_id, template_award_id, name, description, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [
          eventId,
          template_award_id ?? null,
          String(awardName).trim(),
          awardDescription ?? null,
          order,
        ],
      );

      const created = await db.get('SELECT * FROM event_awards WHERE id = ?', [
        result.lastID,
      ]);
      res.status(201).json({ ...(created as object), recipients: [] });
    } catch (error) {
      console.error('Error creating event award:', error);
      res.status(500).json({ error: 'Failed to create event award' });
    }
  },
);

// PATCH /awards/event-awards/:id
router.patch(
  '/event-awards/:id',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { name, description, sort_order } = req.body;
      const db = await getDatabase();
      const existing = await db.get(
        'SELECT id FROM event_awards WHERE id = ?',
        [id],
      );
      if (!existing) {
        return res.status(404).json({ error: 'Event award not found' });
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      if (name !== undefined) {
        if (!String(name).trim()) {
          return res.status(400).json({ error: 'Name cannot be empty' });
        }
        updates.push('name = ?');
        values.push(String(name).trim());
      }
      if (description !== undefined) {
        updates.push('description = ?');
        values.push(description);
      }
      if (sort_order !== undefined) {
        updates.push('sort_order = ?');
        values.push(sort_order);
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      values.push(id);
      await db.run(
        `UPDATE event_awards SET ${updates.join(', ')} WHERE id = ?`,
        values,
      );
      const updated = await db.get('SELECT * FROM event_awards WHERE id = ?', [
        id,
      ]);
      res.json(updated);
    } catch (error) {
      console.error('Error updating event award:', error);
      res.status(500).json({ error: 'Failed to update event award' });
    }
  },
);

// DELETE /awards/event-awards/:id
router.delete(
  '/event-awards/:id',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();
      const existing = await db.get(
        'SELECT id FROM event_awards WHERE id = ?',
        [id],
      );
      if (!existing) {
        return res.status(404).json({ error: 'Event award not found' });
      }
      await db.run('DELETE FROM event_awards WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting event award:', error);
      res.status(500).json({ error: 'Failed to delete event award' });
    }
  },
);

// ============================================================================
// EVENT AWARD RECIPIENTS
// ============================================================================

// POST /awards/event-awards/:id/recipients
router.post(
  '/event-awards/:id/recipients',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { team_id } = req.body;

      if (!team_id) {
        return res.status(400).json({ error: 'team_id is required' });
      }

      const db = await getDatabase();
      const award = await db.get(
        'SELECT id, event_id FROM event_awards WHERE id = ?',
        [id],
      );
      if (!award) {
        return res.status(404).json({ error: 'Event award not found' });
      }

      const awardEventId = (award as Record<string, unknown>)
        .event_id as number;
      const team = await db.get('SELECT id, event_id FROM teams WHERE id = ?', [
        team_id,
      ]);
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      if ((team as Record<string, unknown>).event_id !== awardEventId) {
        return res
          .status(400)
          .json({ error: 'Team does not belong to the same event' });
      }

      await db.run(
        'INSERT INTO event_award_recipients (event_award_id, team_id) VALUES (?, ?)',
        [id, team_id],
      );

      const recipient = await db.get(
        `SELECT ear.id, ear.event_award_id, ear.team_id,
                t.team_number, t.team_name, t.display_name
         FROM event_award_recipients ear
         JOIN teams t ON ear.team_id = t.id
         WHERE ear.event_award_id = ? AND ear.team_id = ?`,
        [id, team_id],
      );
      res.status(201).json(recipient);
    } catch (error) {
      const errMsg = String(error);
      if (errMsg.includes('UNIQUE') || errMsg.includes('unique')) {
        return res
          .status(409)
          .json({ error: 'Team is already a recipient of this award' });
      }
      console.error('Error adding award recipient:', error);
      res.status(500).json({ error: 'Failed to add award recipient' });
    }
  },
);

// DELETE /awards/event-awards/:awardId/recipients/:teamId
router.delete(
  '/event-awards/:awardId/recipients/:teamId',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { awardId, teamId } = req.params;
      const db = await getDatabase();
      const result = await db.run(
        'DELETE FROM event_award_recipients WHERE event_award_id = ? AND team_id = ?',
        [awardId, teamId],
      );
      if (!result.changes) {
        return res.status(404).json({ error: 'Recipient not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error removing award recipient:', error);
      res.status(500).json({ error: 'Failed to remove award recipient' });
    }
  },
);

// ============================================================================
// PUBLIC ENDPOINT (release-gated)
// ============================================================================

// GET /awards/event/:eventId/public
router.get(
  '/event/:eventId/public',
  publicExpensiveReadLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const released = await areFinalScoresReleased(eventId);
      if (!released) {
        return res.status(404).json({ error: 'Not found' });
      }

      const db = await getDatabase();
      const awards = await db.all(
        `SELECT id, name, description, sort_order
         FROM event_awards
         WHERE event_id = ?
         ORDER BY sort_order ASC, id ASC`,
        [eventId],
      );

      const recipients = await db.all(
        `SELECT ear.event_award_id, t.team_number, t.team_name, t.display_name
         FROM event_award_recipients ear
         JOIN teams t ON ear.team_id = t.id
         WHERE ear.event_award_id IN (
           SELECT id FROM event_awards WHERE event_id = ?
         )
         ORDER BY t.team_number ASC`,
        [eventId],
      );

      const recipientsByAward = new Map<
        number,
        {
          team_number: number;
          team_name: string;
          display_name: string | null;
        }[]
      >();
      for (const r of recipients) {
        const row = r as Record<string, unknown>;
        const awardId = row.event_award_id as number;
        if (!recipientsByAward.has(awardId)) {
          recipientsByAward.set(awardId, []);
        }
        recipientsByAward.get(awardId)!.push({
          team_number: row.team_number as number,
          team_name: row.team_name as string,
          display_name: row.display_name as string | null,
        });
      }

      const result = awards.map((a: Record<string, unknown>) => ({
        name: a.name,
        description: a.description,
        sort_order: a.sort_order,
        recipients: recipientsByAward.get(a.id as number) ?? [],
      }));

      res.json(result);
    } catch (error) {
      console.error('Error fetching public awards:', error);
      res.status(500).json({ error: 'Failed to fetch awards' });
    }
  },
);

export default router;
