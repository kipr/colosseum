import express from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

// Get all scoresheet templates (public - for judges, without access codes)
router.get('/templates', async (req: express.Request, res: express.Response) => {
  try {
    const db = await getDatabase();
    const templates = await db.all(
      'SELECT id, name, description, created_at FROM scoresheet_templates WHERE is_active = 1'
    );
    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch scoresheet templates' });
  }
});

// Get all scoresheet templates with access codes (admin only)
router.get('/templates/admin', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const db = await getDatabase();
    const templates = await db.all(
      'SELECT id, name, description, access_code, created_at, is_active FROM scoresheet_templates WHERE is_active = 1'
    );
    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch scoresheet templates' });
  }
});

// Verify access code and get template (public - for judges)
router.post('/templates/:id/verify', async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;
    const { accessCode } = req.body;
    const db = await getDatabase();
    
    const template = await db.get(
      'SELECT * FROM scoresheet_templates WHERE id = ? AND is_active = 1',
      [id]
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
});

// Get a specific template with full schema (authenticated - for admin preview)
router.get('/templates/:id', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();
    const template = await db.get(
      'SELECT * FROM scoresheet_templates WHERE id = ? AND is_active = 1',
      [id]
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
});

// Create a new template
router.post('/templates', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { name, description, schema, accessCode } = req.body;

    if (!name || !schema || !accessCode) {
      return res.status(400).json({ error: 'Name, schema, and access code are required' });
    }

    const db = await getDatabase();
    const result = await db.run(
      `INSERT INTO scoresheet_templates (name, description, schema, access_code, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [name, description, JSON.stringify(schema), accessCode, req.user.id]
    );

    const template = await db.get('SELECT * FROM scoresheet_templates WHERE id = ?', [result.lastID]);
    template.schema = JSON.parse(template.schema);
    
    res.json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Update a template
router.put('/templates/:id', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const { name, description, schema, accessCode } = req.body;

    const db = await getDatabase();
    await db.run(
      `UPDATE scoresheet_templates 
       SET name = ?, description = ?, schema = ?, access_code = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, description, JSON.stringify(schema), accessCode, id]
    );

    const template = await db.get('SELECT * FROM scoresheet_templates WHERE id = ?', [id]);
    template.schema = JSON.parse(template.schema);
    
    res.json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

export default router;

