import express from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

function inferTemplateType(schema: unknown): 'seeding' | 'bracket' {
  if (schema && typeof schema === 'object' && 'mode' in schema) {
    if ((schema as { mode?: string }).mode === 'head-to-head') return 'bracket';
  }
  if (schema && typeof schema === 'object' && 'bracketSource' in schema) {
    return 'bracket';
  }
  return 'seeding';
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
        t.spreadsheet_config_id,
        sc.spreadsheet_name,
        sc.sheet_name,
        e.id AS event_id,
        e.name AS event_name,
        e.event_date AS event_date,
        e.status AS event_status
      FROM scoresheet_templates t
      INNER JOIN ranked r ON r.template_id = t.id AND r.rn = 1
      INNER JOIN events e ON e.id = r.event_id
      LEFT JOIN spreadsheet_configs sc ON t.spreadsheet_config_id = sc.id
      WHERE t.is_active IS TRUE
      ORDER BY e.event_date DESC, e.name, t.name
    `);

      // Parse schema JSON for each template
      templates.forEach((template) => {
        if (template.schema) {
          try {
            template.schema = JSON.parse(template.schema);
          } catch (e) {
            console.error('Error parsing template schema:', e);
            template.schema = null;
          }
        }
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
  async (req: AuthRequest, res: express.Response) => {
    try {
      const db = await getDatabase();
      const eventId = req.query.eventId;
      const hasEventFilter = eventId !== undefined && eventId !== '';

      const baseSelect = `
      SELECT 
        t.id, 
        t.name, 
        t.description, 
        t.access_code, 
        t.created_at, 
        t.is_active,
        t.spreadsheet_config_id,
        sc.spreadsheet_name,
        sc.sheet_name
      FROM scoresheet_templates t
      LEFT JOIN spreadsheet_configs sc ON t.spreadsheet_config_id = sc.id
    `;

      let query: string;
      const params: (string | number)[] = [];

      if (hasEventFilter) {
        const eventIdNum = Number(eventId);
        if (Number.isNaN(eventIdNum)) {
          return res.status(400).json({ error: 'Invalid eventId' });
        }
        query = `${baseSelect}
      INNER JOIN event_scoresheet_templates est ON est.template_id = t.id AND est.event_id = ?
      WHERE t.is_active IS TRUE
      ORDER BY sc.spreadsheet_name, t.name`;
        params.push(eventIdNum);
      } else {
        query = `${baseSelect}
      WHERE t.is_active IS TRUE
      ORDER BY sc.spreadsheet_name, t.name`;
      }

      const templates = await db.all(query, params);
      res.json(templates);
    } catch (error) {
      console.error('Error fetching templates:', error);
      res.status(500).json({ error: 'Failed to fetch scoresheet templates' });
    }
  },
);

// Verify access code and get template (public - for judges)
router.post(
  '/templates/:id/verify',
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;
      const { accessCode } = req.body;
      const db = await getDatabase();

      const template = await db.get(
        'SELECT * FROM scoresheet_templates WHERE id = ? AND is_active IS TRUE',
        [id],
      );

      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      // Verify access code
      if (template.access_code !== accessCode) {
        return res.status(403).json({ error: 'Invalid access code' });
      }

      // Parse JSON schema and remove sensitive data
      template.schema = JSON.parse(template.schema);
      delete template.access_code;
      delete template.created_by;

      res.json(template);
    } catch (error) {
      console.error('Error verifying template access:', error);
      res.status(500).json({ error: 'Failed to verify access' });
    }
  },
);

// Get a specific template with full schema (authenticated - for admin preview)
router.get(
  '/templates/:id',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();
      const template = await db.get(
        'SELECT * FROM scoresheet_templates WHERE id = ? AND is_active IS TRUE',
        [id],
      );

      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      // Parse JSON schema
      template.schema = JSON.parse(template.schema);
      res.json(template);
    } catch (error) {
      console.error('Error fetching template:', error);
      res.status(500).json({ error: 'Failed to fetch template' });
    }
  },
);

// Create a new template
router.post(
  '/templates',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const {
        name,
        description,
        schema,
        accessCode,
        spreadsheetConfigId,
        eventId,
      } = req.body;

      if (!name || !schema || !accessCode) {
        return res
          .status(400)
          .json({ error: 'Name, schema, and access code are required' });
      }

      const db = await getDatabase();
      const result = await db.run(
        `INSERT INTO scoresheet_templates (name, description, schema, access_code, created_by, spreadsheet_config_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
        [
          name,
          description,
          JSON.stringify(schema),
          accessCode,
          req.user.id,
          spreadsheetConfigId || null,
        ],
      );

      const templateId = result.lastID!;

      if (eventId != null && Number.isInteger(Number(eventId))) {
        const templateType = inferTemplateType(schema);
        await db.run(
          `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type) VALUES (?, ?, ?)`,
          [Number(eventId), templateId, templateType],
        );
      }

      const template = await db.get(
        'SELECT * FROM scoresheet_templates WHERE id = ?',
        [templateId],
      );
      template.schema = JSON.parse(template.schema);

      res.json(template);
    } catch (error) {
      console.error('Error creating template:', error);
      res.status(500).json({ error: 'Failed to create template' });
    }
  },
);

// Update a template
router.put(
  '/templates/:id',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        schema,
        accessCode,
        spreadsheetConfigId,
        eventId,
      } = req.body;

      const db = await getDatabase();
      await db.transaction((tx) => {
        tx.run(
          `UPDATE scoresheet_templates 
         SET name = ?, description = ?, schema = ?, access_code = ?, spreadsheet_config_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
          [
            name,
            description,
            JSON.stringify(schema),
            accessCode,
            spreadsheetConfigId || null,
            id,
          ],
        );

        tx.run('DELETE FROM event_scoresheet_templates WHERE template_id = ?', [
          id,
        ]);

        if (eventId != null && Number.isInteger(Number(eventId))) {
          const templateType = inferTemplateType(schema);
          tx.run(
            `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type) VALUES (?, ?, ?)`,
            [Number(eventId), id, templateType],
          );
        }
      });

      const template = await db.get(
        'SELECT * FROM scoresheet_templates WHERE id = ?',
        [id],
      );
      template.schema = JSON.parse(template.schema);

      res.json(template);
    } catch (error) {
      console.error('Error updating template:', error);
      res.status(500).json({ error: 'Failed to update template' });
    }
  },
);

// Delete a template
router.delete(
  '/templates/:id',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      await db.run('DELETE FROM scoresheet_templates WHERE id = ?', [id]);

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting template:', error);
      res.status(500).json({ error: 'Failed to delete template' });
    }
  },
);

export default router;
