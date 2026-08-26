import express from 'express';
import { randomUUID } from 'crypto';
import { requireAuth, JUDGE_SESSION_TTL_MS } from '../middleware/auth';
import { accessCodeLimiter } from '../middleware/rateLimit';
import { getDatabase } from '../database/connection';
import { applyLoadedSchema } from '../scoresheetParse';
import { validatedHandler } from '../validation/middleware';
import { sendForbidden, sendNotFound } from '../validation/errors';
import { normalizeLegacyScoresheetSchema } from '../../shared/scoresheetNormalize';
import type { ScoresheetSchema } from '../../shared/scoresheetSchema';
import {
  adminScoresheetTemplatesRequest,
  createScoresheetTemplateRequest,
  scoresheetTemplateIdRequest,
  updateScoresheetTemplateRequest,
  verifyScoresheetTemplateRequest,
} from '../validation/templates';

const router = express.Router();

function inferTemplateType(
  schema: ScoresheetSchema,
): 'seeding' | 'bracket' | 'double_seeding' {
  // Explicit schema marker takes precedence; do not infer double seeding from
  // mode (head-to-head means bracket scoring with a winner).
  if (schema.scoreKind === 'double_seeding') {
    return 'double_seeding';
  }
  if (schema.mode === 'head-to-head') {
    return 'bracket';
  }
  if (schema.bracketSource !== undefined) {
    return 'bracket';
  }
  return 'seeding';
}

function rawBodySchema(body: unknown): unknown {
  if (body && typeof body === 'object' && 'schema' in body) {
    return (body as { schema: unknown }).schema;
  }
  return undefined;
}

// Get all scoresheet templates (public - for judges, without access codes)
// Returns only templates linked to events with status setup/active; includes event metadata for grouping
router.get(
  '/templates',
  async (req: express.Request, res: express.Response) => {
    try {
      const db = await getDatabase();
      // Deduplicate: one row per template (pick event by most recent event_date)
      const templates = await db.all(`
      WITH ranked AS (
        SELECT est.template_id, est.event_id,
          ROW_NUMBER() OVER (PARTITION BY est.template_id ORDER BY e.event_date DESC, e.name) AS rn
        FROM event_scoresheet_templates est
        INNER JOIN events e ON e.id = est.event_id AND e.status IN ('setup', 'active')
      )
      SELECT 
        t.id, 
        t.name, 
        t.description, 
        t.schema, 
        t.created_at,
        e.id AS event_id,
        e.name AS event_name,
        e.event_date AS event_date,
        e.status AS event_status
      FROM scoresheet_templates t
      INNER JOIN ranked r ON r.template_id = t.id AND r.rn = 1
      INNER JOIN events e ON e.id = r.event_id
      WHERE t.is_active IS TRUE
      ORDER BY e.event_date DESC, e.name, t.name
    `);

      templates.forEach((template) => {
        applyLoadedSchema(template);
      });

      res.json(templates);
    } catch (error) {
      console.error('Error fetching templates:', error);
      res.status(500).json({ error: 'Failed to fetch scoresheet templates' });
    }
  },
);

// Get all scoresheet templates with access codes (admin only)
// Optional eventId: when present, returns only templates linked to that event
router.get(
  '/templates/admin',
  requireAuth,
  ...validatedHandler(adminScoresheetTemplatesRequest, async (req, res) => {
    try {
      const db = await getDatabase();
      const eventId = req.validated.query.eventId;

      const baseSelect = `
      SELECT 
        t.id, 
        t.name, 
        t.description, 
        t.access_code, 
        t.created_at, 
        t.is_active
      FROM scoresheet_templates t
    `;

      let query: string;
      const params: (string | number)[] = [];

      if (eventId !== undefined) {
        query = `${baseSelect}
      INNER JOIN event_scoresheet_templates est ON est.template_id = t.id AND est.event_id = ?
      WHERE t.is_active IS TRUE
      ORDER BY t.name`;
        params.push(eventId);
      } else {
        query = `${baseSelect}
      WHERE t.is_active IS TRUE
      ORDER BY t.name`;
      }

      const templates = await db.all(query, params);
      res.json(templates);
    } catch (error) {
      console.error('Error fetching templates:', error);
      res.status(500).json({ error: 'Failed to fetch scoresheet templates' });
    }
  }),
);

// Verify access code and get template (public - for judges)
router.post(
  '/templates/:id/verify',
  accessCodeLimiter,
  ...validatedHandler(verifyScoresheetTemplateRequest, async (req, res) => {
    try {
      const { id } = req.validated.params;
      const { accessCode } = req.validated.body;
      const db = await getDatabase();

      const template = await db.get(
        'SELECT * FROM scoresheet_templates WHERE id = ? AND is_active IS TRUE',
        [id],
      );

      if (!template) {
        return sendNotFound(res, 'Template not found');
      }

      if (template.access_code !== accessCode) {
        return sendForbidden(res, 'Invalid access code');
      }

      // Mint a judge session scoped to this template and its linked events
      if (req.session) {
        const linkedEvents = await db.all(
          `SELECT event_id FROM event_scoresheet_templates WHERE template_id = ?`,
          [id],
        );
        const eventIds = linkedEvents.map(
          (row: { event_id: number }) => row.event_id,
        );

        const now = Date.now();
        const existing = req.session.judgeAuth;
        const reuseConversationKey =
          existing != null &&
          now <= existing.expiresAt &&
          existing.templateId === id &&
          typeof existing.conversationKey === 'string' &&
          existing.conversationKey.length > 0;

        req.session.judgeAuth = {
          templateId: id,
          eventIds,
          conversationKey: reuseConversationKey
            ? existing.conversationKey
            : randomUUID(),
          issuedAt: now,
          expiresAt: now + JUDGE_SESSION_TTL_MS,
        };
      }

      applyLoadedSchema(template);
      delete template.access_code;
      delete template.created_by;

      res.json(template);
    } catch (error) {
      console.error('Error verifying template access:', error);
      res.status(500).json({ error: 'Failed to verify access' });
    }
  }),
);

// Get a specific template with full schema (authenticated - for admin preview)
router.get(
  '/templates/:id',
  requireAuth,
  ...validatedHandler(scoresheetTemplateIdRequest, async (req, res) => {
    try {
      const { id } = req.validated.params;
      const db = await getDatabase();
      const template = await db.get(
        'SELECT * FROM scoresheet_templates WHERE id = ? AND is_active IS TRUE',
        [id],
      );

      if (!template) {
        return sendNotFound(res, 'Template not found');
      }

      applyLoadedSchema(template);
      res.json(template);
    } catch (error) {
      console.error('Error fetching template:', error);
      res.status(500).json({ error: 'Failed to fetch template' });
    }
  }),
);

// Create a new template
router.post(
  '/templates',
  requireAuth,
  ...validatedHandler(createScoresheetTemplateRequest, async (req, res) => {
    try {
      const { name, description, schema, accessCode, eventId } =
        req.validated.body;
      const { migrations } = normalizeLegacyScoresheetSchema(
        rawBodySchema(req.body),
      );

      const db = await getDatabase();
      const result = await db.run(
        `INSERT INTO scoresheet_templates (name, description, schema, access_code, created_by)
       VALUES (?, ?, ?, ?, ?)`,
        [
          name,
          description ?? null,
          JSON.stringify(schema),
          accessCode,
          req.user.id,
        ],
      );

      const templateId = result.lastID!;

      if (eventId != null) {
        const templateType = inferTemplateType(schema);
        await db.run(
          `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type) VALUES (?, ?, ?)`,
          [eventId, templateId, templateType],
        );
      }

      const template = await db.get(
        'SELECT * FROM scoresheet_templates WHERE id = ?',
        [templateId],
      );
      applyLoadedSchema(template);
      template.normalizationApplied = migrations;

      res.json(template);
    } catch (error) {
      console.error('Error creating template:', error);
      res.status(500).json({ error: 'Failed to create template' });
    }
  }),
);

// Update a template
router.put(
  '/templates/:id',
  requireAuth,
  ...validatedHandler(updateScoresheetTemplateRequest, async (req, res) => {
    try {
      const { id } = req.validated.params;
      const { name, description, schema, accessCode, eventId } =
        req.validated.body;
      const { migrations } = normalizeLegacyScoresheetSchema(
        rawBodySchema(req.body),
      );

      const db = await getDatabase();
      const existing = await db.get(
        'SELECT id FROM scoresheet_templates WHERE id = ?',
        [id],
      );
      if (!existing) {
        return sendNotFound(res, 'Template not found');
      }

      await db.transaction(async (tx) => {
        await tx.run(
          `UPDATE scoresheet_templates 
         SET name = ?, description = ?, schema = ?, access_code = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
          [name, description ?? null, JSON.stringify(schema), accessCode, id],
        );

        await tx.run(
          'DELETE FROM event_scoresheet_templates WHERE template_id = ?',
          [id],
        );

        if (eventId != null) {
          const templateType = inferTemplateType(schema);
          await tx.run(
            `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type) VALUES (?, ?, ?)`,
            [eventId, id, templateType],
          );
        }
      });

      const template = await db.get(
        'SELECT * FROM scoresheet_templates WHERE id = ?',
        [id],
      );
      applyLoadedSchema(template);
      template.normalizationApplied = migrations;

      res.json(template);
    } catch (error) {
      console.error('Error updating template:', error);
      res.status(500).json({ error: 'Failed to update template' });
    }
  }),
);

// Delete a template
router.delete(
  '/templates/:id',
  requireAuth,
  ...validatedHandler(scoresheetTemplateIdRequest, async (req, res) => {
    try {
      const { id } = req.validated.params;
      const db = await getDatabase();

      await db.run('DELETE FROM scoresheet_templates WHERE id = ?', [id]);

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting template:', error);
      res.status(500).json({ error: 'Failed to delete template' });
    }
  }),
);

export default router;
