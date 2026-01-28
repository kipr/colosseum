import express, { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

// Get all field templates
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
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
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    const template = await db.get(
      'SELECT * FROM scoresheet_field_templates WHERE id = ?',
      [id],
    );

    if (!template) {
      return res.status(404).json({ error: 'Field template not found' });
    }

    // Parse the JSON
    template.fields = JSON.parse(template.fields_json);

    res.json(template);
  } catch (error) {
    console.error('Error fetching field template:', error);
    res.status(500).json({ error: 'Failed to fetch field template' });
  }
});

// Create a new field template
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, fields } = req.body;

    if (!name || !fields) {
      return res.status(400).json({ error: 'Name and fields are required' });
    }

    if (!Array.isArray(fields)) {
      return res.status(400).json({ error: 'Fields must be an array' });
    }

    const db = await getDatabase();
    const result = await db.run(
      `INSERT INTO scoresheet_field_templates (name, description, fields_json, created_by)
       VALUES (?, ?, ?, ?)`,
      [name, description || null, JSON.stringify(fields), req.user.id],
    );

    const template = await db.get(
      'SELECT * FROM scoresheet_field_templates WHERE id = ?',
      [result.lastID],
    );

    res.json(template);
  } catch (error: any) {
    console.error('Error creating field template:', error);
    res.status(500).json({
      error: 'Failed to create field template',
      details: error.message,
    });
  }
});

// Update a field template
router.put('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, fields } = req.body;

    if (!name || !fields) {
      return res.status(400).json({ error: 'Name and fields are required' });
    }

    const db = await getDatabase();
    await db.run(
      `UPDATE scoresheet_field_templates 
       SET name = ?, description = ?, fields_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, description || null, JSON.stringify(fields), id],
    );

    const template = await db.get(
      'SELECT * FROM scoresheet_field_templates WHERE id = ?',
      [id],
    );

    res.json(template);
  } catch (error) {
    console.error('Error updating field template:', error);
    res.status(500).json({ error: 'Failed to update field template' });
  }
});

// Delete a field template
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    await db.run('DELETE FROM scoresheet_field_templates WHERE id = ?', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting field template:', error);
    res.status(500).json({ error: 'Failed to delete field template' });
  }
});

export default router;
