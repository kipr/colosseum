import express, { Response } from 'express';
import { requireAdmin, AuthRequest } from '../middleware/auth';
import { publicExpensiveReadLimiter } from '../middleware/rateLimit';
import { getDatabase } from '../database/connection';
import { areFinalScoresReleased } from '../utils/eventVisibility';
import {
  computeAutomaticAwards,
  applyAutomaticAwardsAsEventAwards,
  loadAutomaticAwardSettings,
  getEventTeamCount,
  validateAutomaticAwardSettings,
  clampAutomaticAwardSettings,
  AutomaticAwardsAcknowledgementRequiredError,
  AutomaticAwardsValidationError,
  AUTO_AWARD_NAME_PREFIX,
  type AutomaticAwardSettings,
} from '../services/automaticAwards';
import { diagnosticsHaveWarnings } from '../../shared/automaticAwards';
import { computeAutomaticAwardDiagnostics } from '../services/eventScoreDiagnostics';
import {
  DEFAULT_AWARD_TYPE,
  isAwardType,
  type AwardType,
} from '../../shared/awards';

function parseTopNParam(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const n =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return null;
  }
  return n;
}

function parseAwardTypeParam(
  value: unknown,
  fallback: AwardType,
): AwardType | null {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (!isAwardType(value)) {
    return null;
  }
  return value;
}

function parseSettingsFromBody(
  body: Record<string, unknown>,
  fallback: AutomaticAwardSettings,
): AutomaticAwardSettings | null {
  const de = parseTopNParam(body.de_top_n, fallback.de_top_n);
  const perBracket = parseTopNParam(
    body.per_bracket_overall_top_n,
    fallback.per_bracket_overall_top_n,
  );
  const seeding = parseTopNParam(body.seeding_top_n, fallback.seeding_top_n);
  const deType = parseAwardTypeParam(
    body.de_award_type,
    fallback.de_award_type,
  );
  const perBracketType = parseAwardTypeParam(
    body.per_bracket_overall_award_type,
    fallback.per_bracket_overall_award_type,
  );
  const seedingType = parseAwardTypeParam(
    body.seeding_award_type,
    fallback.seeding_award_type,
  );
  if (
    de === null ||
    perBracket === null ||
    seeding === null ||
    deType === null ||
    perBracketType === null ||
    seedingType === null
  ) {
    return null;
  }
  return {
    de_top_n: de,
    per_bracket_overall_top_n: perBracket,
    seeding_top_n: seeding,
    de_award_type: deType,
    per_bracket_overall_award_type: perBracketType,
    seeding_award_type: seedingType,
  };
}

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
        'SELECT id, name, description, award_type, created_at, updated_at FROM award_templates ORDER BY name ASC',
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
      const { name, description, award_type } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      const resolvedType =
        award_type === undefined || award_type === null || award_type === ''
          ? DEFAULT_AWARD_TYPE
          : award_type;
      if (!isAwardType(resolvedType)) {
        return res
          .status(400)
          .json({ error: 'award_type must be "certificate" or "trophy"' });
      }
      const db = await getDatabase();
      const result = await db.run(
        'INSERT INTO award_templates (name, description, award_type) VALUES (?, ?, ?)',
        [String(name).trim(), description ?? null, resolvedType],
      );
      const created = await db.get(
        'SELECT id, name, description, award_type, created_at, updated_at FROM award_templates WHERE id = ?',
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
      const { name, description, award_type } = req.body;
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
      if (award_type !== undefined) {
        if (!isAwardType(award_type)) {
          return res
            .status(400)
            .json({ error: 'award_type must be "certificate" or "trophy"' });
        }
        updates.push('award_type = ?');
        values.push(award_type);
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
        'SELECT id, name, description, award_type, created_at, updated_at FROM award_templates WHERE id = ?',
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
        `SELECT ea.id, ea.event_id, ea.template_award_id, ea.name, ea.description, ea.award_type,
                ea.sort_order, ea.created_at, ea.updated_at
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

      const individualRecipients = await db.all(
        `SELECT eair.id, eair.event_award_id, eair.name, eair.team_id,
                t.team_number, t.team_name, t.display_name
         FROM event_award_individual_recipients eair
         LEFT JOIN teams t ON eair.team_id = t.id
         WHERE eair.event_award_id IN (
           SELECT id FROM event_awards WHERE event_id = ?
         )
         ORDER BY eair.id ASC`,
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

      const individualRecipientsByAward = new Map<
        number,
        typeof individualRecipients
      >();
      for (const r of individualRecipients) {
        const awardId = (r as Record<string, unknown>).event_award_id as number;
        if (!individualRecipientsByAward.has(awardId)) {
          individualRecipientsByAward.set(awardId, []);
        }
        individualRecipientsByAward.get(awardId)!.push(r);
      }

      const result = awards.map((a: Record<string, unknown>) => ({
        ...a,
        recipients: recipientsByAward.get(a.id as number) ?? [],
        individual_recipients:
          individualRecipientsByAward.get(a.id as number) ?? [],
      }));

      res.json(result);
    } catch (error) {
      console.error('Error fetching event awards:', error);
      res.status(500).json({ error: 'Failed to fetch event awards' });
    }
  },
);

// GET /awards/event/:eventId/automatic/preview — Preview top-N automatic awards + diagnostics (admin)
router.get(
  '/event/:eventId/automatic/preview',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const eventIdNum = Number.parseInt(String(eventId), 10);
      const db = await getDatabase();
      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventId,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const teamCount = await getEventTeamCount(eventIdNum);
      const savedSettings = clampAutomaticAwardSettings(
        await loadAutomaticAwardSettings(eventIdNum),
        teamCount,
      );

      const queryProvided =
        req.query.de_top_n !== undefined ||
        req.query.per_bracket_overall_top_n !== undefined ||
        req.query.seeding_top_n !== undefined ||
        req.query.de_award_type !== undefined ||
        req.query.per_bracket_overall_award_type !== undefined ||
        req.query.seeding_award_type !== undefined;

      const de = parseTopNParam(req.query.de_top_n, savedSettings.de_top_n);
      const perBracket = parseTopNParam(
        req.query.per_bracket_overall_top_n,
        savedSettings.per_bracket_overall_top_n,
      );
      const seeding = parseTopNParam(
        req.query.seeding_top_n,
        savedSettings.seeding_top_n,
      );
      const deType = parseAwardTypeParam(
        req.query.de_award_type,
        savedSettings.de_award_type,
      );
      const perBracketType = parseAwardTypeParam(
        req.query.per_bracket_overall_award_type,
        savedSettings.per_bracket_overall_award_type,
      );
      const seedingType = parseAwardTypeParam(
        req.query.seeding_award_type,
        savedSettings.seeding_award_type,
      );
      if (de === null || perBracket === null || seeding === null) {
        return res.status(400).json({
          error:
            'de_top_n, per_bracket_overall_top_n, and seeding_top_n must be integers',
        });
      }
      if (deType === null || perBracketType === null || seedingType === null) {
        return res.status(400).json({
          error:
            'de_award_type, per_bracket_overall_award_type, and seeding_award_type must be "certificate" or "trophy"',
        });
      }

      const settings: AutomaticAwardSettings = queryProvided
        ? {
            de_top_n: de,
            per_bracket_overall_top_n: perBracket,
            seeding_top_n: seeding,
            de_award_type: deType,
            per_bracket_overall_award_type: perBracketType,
            seeding_award_type: seedingType,
          }
        : savedSettings;
      const validationError = validateAutomaticAwardSettings(
        settings,
        teamCount,
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const [automatic, diagnostics] = await Promise.all([
        computeAutomaticAwards(eventIdNum, settings),
        computeAutomaticAwardDiagnostics(eventIdNum),
      ]);

      res.json({
        teamCount,
        settings,
        savedSettings,
        automatic,
        diagnostics,
        hasWarnings: diagnosticsHaveWarnings(diagnostics),
      });
    } catch (error) {
      console.error('Error previewing automatic event awards:', error);
      res.status(500).json({ error: 'Failed to preview automatic awards' });
    }
  },
);

// POST /awards/event/:eventId/automatic — Replace Auto:* event awards with computed placements (admin)
router.post(
  '/event/:eventId/automatic',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const eventIdNum = Number.parseInt(String(eventId), 10);
      const db = await getDatabase();
      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventId,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const teamCount = await getEventTeamCount(eventIdNum);
      const bodyOmitsSettings =
        body.de_top_n === undefined &&
        body.per_bracket_overall_top_n === undefined &&
        body.seeding_top_n === undefined &&
        body.de_award_type === undefined &&
        body.per_bracket_overall_award_type === undefined &&
        body.seeding_award_type === undefined;
      const fallback = clampAutomaticAwardSettings(
        await loadAutomaticAwardSettings(eventIdNum),
        teamCount,
      );
      const settings = parseSettingsFromBody(body, fallback);
      if (!settings) {
        return res.status(400).json({
          error:
            'de_top_n, per_bracket_overall_top_n, and seeding_top_n must be integers; award types must be "certificate" or "trophy"',
        });
      }
      const effectiveSettings = bodyOmitsSettings ? fallback : settings;

      const acknowledgeWarnings = Boolean(body.acknowledge_warnings);

      const result = await applyAutomaticAwardsAsEventAwards(
        eventIdNum,
        effectiveSettings,
        { acknowledgeWarnings },
      );
      res.json(result);
    } catch (error) {
      if (error instanceof AutomaticAwardsValidationError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof AutomaticAwardsAcknowledgementRequiredError) {
        return res.status(409).json({
          error: error.message,
          diagnostics: error.diagnostics,
          hasWarnings: true,
          requires_acknowledgement: true,
        });
      }
      console.error('Error applying automatic event awards:', error);
      res.status(500).json({ error: 'Failed to apply automatic awards' });
    }
  },
);

// GET /awards/event/:eventId/team-award-counts — per-team certificate/trophy tallies (admin)
router.get(
  '/event/:eventId/team-award-counts',
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

      const rows = await db.all(
        `SELECT t.id AS team_id, t.team_number, t.team_name, t.display_name,
                COALESCE(SUM(CASE WHEN ea.award_type = 'certificate' THEN 1 ELSE 0 END), 0)
                  AS certificate_count,
                COALESCE(SUM(CASE WHEN ea.award_type = 'trophy' THEN 1 ELSE 0 END), 0)
                  AS trophy_count
         FROM teams t
         LEFT JOIN event_award_recipients ear ON ear.team_id = t.id
         LEFT JOIN event_awards ea ON ea.id = ear.event_award_id AND ea.event_id = t.event_id
         WHERE t.event_id = ?
         GROUP BY t.id, t.team_number, t.team_name, t.display_name
         ORDER BY t.team_number ASC`,
        [eventId],
      );

      res.json(
        rows.map((r) => {
          const row = r as Record<string, unknown>;
          return {
            team_id: row.team_id,
            team_number: row.team_number,
            team_name: row.team_name,
            display_name: row.display_name ?? null,
            certificate_count: Number(row.certificate_count ?? 0),
            trophy_count: Number(row.trophy_count ?? 0),
          };
        }),
      );
    } catch (error) {
      console.error('Error fetching team award counts:', error);
      res.status(500).json({ error: 'Failed to fetch team award counts' });
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
      const { template_award_id, name, description, sort_order, award_type } =
        req.body;

      const db = await getDatabase();
      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventId,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      let awardName = name;
      let awardDescription = description;
      let awardType: AwardType | undefined =
        award_type === undefined || award_type === null || award_type === ''
          ? undefined
          : award_type;

      if (template_award_id) {
        const template = await db.get(
          'SELECT name, description, award_type FROM award_templates WHERE id = ?',
          [template_award_id],
        );
        if (!template) {
          return res.status(404).json({ error: 'Award template not found' });
        }
        const t = template as Record<string, unknown>;
        if (!awardName) awardName = t.name;
        if (awardDescription === undefined) awardDescription = t.description;
        if (awardType === undefined && isAwardType(t.award_type)) {
          awardType = t.award_type;
        }
      }

      if (!awardName || !String(awardName).trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }

      const resolvedType = awardType ?? DEFAULT_AWARD_TYPE;
      if (!isAwardType(resolvedType)) {
        return res
          .status(400)
          .json({ error: 'award_type must be "certificate" or "trophy"' });
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
        `INSERT INTO event_awards (event_id, template_award_id, name, description, award_type, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          template_award_id ?? null,
          String(awardName).trim(),
          awardDescription ?? null,
          resolvedType,
          order,
        ],
      );

      const created = await db.get('SELECT * FROM event_awards WHERE id = ?', [
        result.lastID,
      ]);
      res.status(201).json({
        ...(created as object),
        recipients: [],
        individual_recipients: [],
      });
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
      const { name, description, sort_order, award_type } = req.body;
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
      if (award_type !== undefined) {
        if (!isAwardType(award_type)) {
          return res
            .status(400)
            .json({ error: 'award_type must be "certificate" or "trophy"' });
        }
        updates.push('award_type = ?');
        values.push(award_type);
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
// Accepts either { team_id } (single) or { team_ids: number[] } (bulk).
router.post(
  '/event-awards/:id/recipients',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { team_id, team_ids } = req.body;

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

      let ids: number[] = [];
      if (Array.isArray(team_ids)) {
        if (team_ids.length === 0) {
          return res
            .status(400)
            .json({ error: 'team_ids must be a non-empty array of integers' });
        }
        ids = [];
        for (const v of team_ids) {
          const n = Number(v);
          if (!Number.isInteger(n)) {
            return res.status(400).json({
              error: 'team_ids must be a non-empty array of integers',
            });
          }
          ids.push(n);
        }
      } else if (team_id) {
        ids = [Number(team_id)];
      } else {
        return res
          .status(400)
          .json({ error: 'team_id or team_ids is required' });
      }

      const uniqueIds = Array.from(new Set(ids));
      const placeholders = uniqueIds.map(() => '?').join(',');
      const teams = await db.all<{ id: number; event_id: number }>(
        `SELECT id, event_id FROM teams WHERE id IN (${placeholders})`,
        uniqueIds,
      );
      if (teams.length !== uniqueIds.length) {
        return res.status(404).json({ error: 'One or more teams not found' });
      }
      for (const team of teams) {
        if (team.event_id !== awardEventId) {
          return res
            .status(400)
            .json({ error: 'Team does not belong to the same event' });
        }
      }

      await db.transaction(async (tx) => {
        for (const tid of uniqueIds) {
          await tx.run(
            'INSERT INTO event_award_recipients (event_award_id, team_id) VALUES (?, ?)',
            [id, tid],
          );
        }
      });

      const recipients = await db.all(
        `SELECT ear.id, ear.event_award_id, ear.team_id,
                t.team_number, t.team_name, t.display_name
         FROM event_award_recipients ear
         JOIN teams t ON ear.team_id = t.id
         WHERE ear.event_award_id = ? AND ear.team_id IN (${placeholders})
         ORDER BY t.team_number ASC`,
        [id, ...uniqueIds],
      );

      if (Array.isArray(team_ids)) {
        res.status(201).json(recipients);
      } else {
        res.status(201).json(recipients[0] ?? null);
      }
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
// EVENT AWARD INDIVIDUAL RECIPIENTS
// ============================================================================

const MAX_INDIVIDUAL_RECIPIENT_NAME_LENGTH = 200;

// POST /awards/event-awards/:id/individual-recipients
router.post(
  '/event-awards/:id/individual-recipients',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { name, team_id } = req.body;

      const trimmedName =
        name === undefined || name === null ? '' : String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({ error: 'Name is required' });
      }
      if (trimmedName.length > MAX_INDIVIDUAL_RECIPIENT_NAME_LENGTH) {
        return res.status(400).json({
          error: `Name must be at most ${MAX_INDIVIDUAL_RECIPIENT_NAME_LENGTH} characters`,
        });
      }

      const db = await getDatabase();
      const award = await db.get(
        'SELECT id, event_id FROM event_awards WHERE id = ?',
        [id],
      );
      if (!award) {
        return res.status(404).json({ error: 'Event award not found' });
      }

      let resolvedTeamId: number | null = null;
      if (team_id !== undefined && team_id !== null && team_id !== '') {
        const awardEventId = (award as Record<string, unknown>)
          .event_id as number;
        const team = await db.get(
          'SELECT id, event_id FROM teams WHERE id = ?',
          [team_id],
        );
        if (!team) {
          return res.status(404).json({ error: 'Team not found' });
        }
        if ((team as Record<string, unknown>).event_id !== awardEventId) {
          return res
            .status(400)
            .json({ error: 'Team does not belong to the same event' });
        }
        resolvedTeamId = Number(team_id);
      }

      const result = await db.run(
        `INSERT INTO event_award_individual_recipients (event_award_id, name, team_id)
         VALUES (?, ?, ?)`,
        [id, trimmedName, resolvedTeamId],
      );

      const recipient = await db.get(
        `SELECT eair.id, eair.event_award_id, eair.name, eair.team_id,
                t.team_number, t.team_name, t.display_name
         FROM event_award_individual_recipients eair
         LEFT JOIN teams t ON eair.team_id = t.id
         WHERE eair.id = ?`,
        [result.lastID],
      );
      res.status(201).json(recipient);
    } catch (error) {
      console.error('Error adding individual award recipient:', error);
      res
        .status(500)
        .json({ error: 'Failed to add individual award recipient' });
    }
  },
);

// DELETE /awards/event-awards/:awardId/individual-recipients/:recipientId
router.delete(
  '/event-awards/:awardId/individual-recipients/:recipientId',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { awardId, recipientId } = req.params;
      const db = await getDatabase();
      const result = await db.run(
        `DELETE FROM event_award_individual_recipients
         WHERE event_award_id = ? AND id = ?`,
        [awardId, recipientId],
      );
      if (!result.changes) {
        return res.status(404).json({ error: 'Recipient not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error removing individual award recipient:', error);
      res
        .status(500)
        .json({ error: 'Failed to remove individual award recipient' });
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
         WHERE event_id = ? AND name NOT LIKE ?
         ORDER BY sort_order ASC, id ASC`,
        [eventId, `${AUTO_AWARD_NAME_PREFIX}%`],
      );

      const recipients = await db.all(
        `SELECT ear.event_award_id, t.team_number, t.team_name, t.display_name
         FROM event_award_recipients ear
         JOIN teams t ON ear.team_id = t.id
         WHERE ear.event_award_id IN (
           SELECT id FROM event_awards WHERE event_id = ? AND name NOT LIKE ?
         )
         ORDER BY t.team_number ASC`,
        [eventId, `${AUTO_AWARD_NAME_PREFIX}%`],
      );

      const individualRecipients = await db.all(
        `SELECT eair.event_award_id, eair.name,
                t.team_number, t.team_name, t.display_name
         FROM event_award_individual_recipients eair
         LEFT JOIN teams t ON eair.team_id = t.id
         WHERE eair.event_award_id IN (
           SELECT id FROM event_awards WHERE event_id = ? AND name NOT LIKE ?
         )
         ORDER BY eair.id ASC`,
        [eventId, `${AUTO_AWARD_NAME_PREFIX}%`],
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

      const individualRecipientsByAward = new Map<
        number,
        {
          name: string;
          team_number: number | null;
          team_name: string | null;
          display_name: string | null;
        }[]
      >();
      for (const r of individualRecipients) {
        const row = r as Record<string, unknown>;
        const awardId = row.event_award_id as number;
        if (!individualRecipientsByAward.has(awardId)) {
          individualRecipientsByAward.set(awardId, []);
        }
        individualRecipientsByAward.get(awardId)!.push({
          name: row.name as string,
          team_number: (row.team_number as number | null) ?? null,
          team_name: (row.team_name as string | null) ?? null,
          display_name: (row.display_name as string | null) ?? null,
        });
      }

      const manual = awards.map((a: Record<string, unknown>) => ({
        name: a.name,
        description: a.description,
        sort_order: a.sort_order,
        recipients: recipientsByAward.get(a.id as number) ?? [],
        individual_recipients:
          individualRecipientsByAward.get(a.id as number) ?? [],
      }));

      const automatic = await computeAutomaticAwards(Number(eventId));

      res.json({ manual, automatic });
    } catch (error) {
      console.error('Error fetching public awards:', error);
      res.status(500).json({ error: 'Failed to fetch awards' });
    }
  },
);

export default router;
