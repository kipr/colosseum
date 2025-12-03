import express from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

// Get all scoresheet templates (public - for judges, without access codes)
router.get('/templates', async (req: express.Request, res: express.Response) => {
  try {
    const db = await getDatabase();
    const templates = await db.all(`
      SELECT 
        t.id, 
        t.name, 
        t.description, 
        t.schema, 
        t.created_at,
        t.spreadsheet_config_id,
        sc.spreadsheet_name,
        sc.sheet_name
      FROM scoresheet_templates t
      LEFT JOIN spreadsheet_configs sc ON t.spreadsheet_config_id = sc.id
      WHERE t.is_active = 1
      ORDER BY sc.spreadsheet_name, t.name
    `);
    
    // Parse schema JSON for each template
    templates.forEach(template => {
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
});

// Get all scoresheet templates with access codes (admin only)
router.get('/templates/admin', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const db = await getDatabase();
    const templates = await db.all(`
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
      WHERE t.is_active = 1
      ORDER BY sc.spreadsheet_name, t.name
    `);
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
    const { name, description, schema, accessCode, spreadsheetConfigId } = req.body;

    if (!name || !schema || !accessCode) {
      return res.status(400).json({ error: 'Name, schema, and access code are required' });
    }

    const db = await getDatabase();
    const result = await db.run(
      `INSERT INTO scoresheet_templates (name, description, schema, access_code, created_by, spreadsheet_config_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, description, JSON.stringify(schema), accessCode, req.user.id, spreadsheetConfigId || null]
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
    const { name, description, schema, accessCode, spreadsheetConfigId } = req.body;

    const db = await getDatabase();
    await db.run(
      `UPDATE scoresheet_templates 
       SET name = ?, description = ?, schema = ?, access_code = ?, spreadsheet_config_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, description, JSON.stringify(schema), accessCode, spreadsheetConfigId || null, id]
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

