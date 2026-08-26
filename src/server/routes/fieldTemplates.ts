import express from 'express';
import { requireAuth } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { applyLoadedFields } from '../scoresheetParse';
import { sendNotFound } from '../validation/errors';
import { validatedHandler } from '../validation/middleware';
import { normalizeLegacyScoresheetFields } from '../../shared/scoresheetNormalize';
import {
  createFieldTemplateRequest,
  fieldTemplateIdRequest,
  updateFieldTemplateRequest,
} from '../validation/templates';

const router = express.Router();

function rawBodyFields(body: unknown): unknown {
  if (body && typeof body === 'object' && 'fields' in body) {
    return (body as { fields: unknown }).fields;
  }
  return undefined;
}

// Get all field templates
router.get('/', requireAuth, async (_req, res) => {
  try {
    const db = await getDatabase();
    const templates = await db.all(
      'SELECT * FROM scoresheet_field_templates ORDER BY created_at DESC',
    );
    res.json(templates);
  } catch (error) {
    console.error('Error fetching field templates:', error);
    res.status(500).json({ error: 'Failed to fetch field templates' });
  }
});

// Get a single field template
router.get(
  '/:id',
  requireAuth,
  ...validatedHandler(fieldTemplateIdRequest, async (req, res) => {
    try {
      const { id } = req.validated.params;
      const db = await getDatabase();

      const template = await db.get(
        'SELECT * FROM scoresheet_field_templates WHERE id = ?',
        [id],
      );

      if (!template) {
        return sendNotFound(res, 'Field template not found');
      }

      applyLoadedFields(template);
      res.json(template);
    } catch (error) {
      console.error('Error fetching field template:', error);
      res.status(500).json({ error: 'Failed to fetch field template' });
    }
  }),
);

// Create a new field template
router.post(
  '/',
  requireAuth,
  ...validatedHandler(createFieldTemplateRequest, async (req, res) => {
    try {
      const { name, description, fields } = req.validated.body;
      const { migrations } = normalizeLegacyScoresheetFields(
        rawBodyFields(req.body),
      );

      const db = await getDatabase();
      const result = await db.run(
        `INSERT INTO scoresheet_field_templates (name, description, fields_json, created_by)
       VALUES (?, ?, ?, ?)`,
        [name, description ?? null, JSON.stringify(fields), req.user.id],
      );

      const template = await db.get(
        'SELECT * FROM scoresheet_field_templates WHERE id = ?',
        [result.lastID],
      );
      template.normalizationApplied = migrations;

      res.json(template);
    } catch (error: unknown) {
      console.error('Error creating field template:', error);
      res.status(500).json({
        error: 'Failed to create field template',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }),
);

// Update a field template
router.put(
  '/:id',
  requireAuth,
  ...validatedHandler(updateFieldTemplateRequest, async (req, res) => {
    try {
      const { id } = req.validated.params;
      const { name, description, fields } = req.validated.body;
      const { migrations } = normalizeLegacyScoresheetFields(
        rawBodyFields(req.body),
      );

      const db = await getDatabase();
      const existing = await db.get(
        'SELECT id FROM scoresheet_field_templates WHERE id = ?',
        [id],
      );
      if (!existing) {
        return sendNotFound(res, 'Field template not found');
      }

      await db.run(
        `UPDATE scoresheet_field_templates 
       SET name = ?, description = ?, fields_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
        [name, description ?? null, JSON.stringify(fields), id],
      );

      const template = await db.get(
        'SELECT * FROM scoresheet_field_templates WHERE id = ?',
        [id],
      );
      template.normalizationApplied = migrations;

      res.json(template);
    } catch (error) {
      console.error('Error updating field template:', error);
      res.status(500).json({ error: 'Failed to update field template' });
    }
  }),
);

// Delete a field template
router.delete(
  '/:id',
  requireAuth,
  ...validatedHandler(fieldTemplateIdRequest, async (req, res) => {
    try {
      const { id } = req.validated.params;
      const db = await getDatabase();

      await db.run('DELETE FROM scoresheet_field_templates WHERE id = ?', [id]);

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting field template:', error);
      res.status(500).json({ error: 'Failed to delete field template' });
    }
  }),
);

export default router;
