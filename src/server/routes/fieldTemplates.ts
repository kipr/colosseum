import express, { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { listFieldTemplates } from '../usecases/listFieldTemplates';
import { getFieldTemplate } from '../usecases/getFieldTemplate';
import { createFieldTemplate } from '../usecases/createFieldTemplate';
import { updateFieldTemplate } from '../usecases/updateFieldTemplate';

const router = express.Router();

// Get all field templates
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await listFieldTemplates({ db });
    res.json(result.templates);
  } catch (error) {
    console.error('Error fetching field templates:', error);
    res.status(500).json({ error: 'Failed to fetch field templates' });
  }
});

// Get a single field template
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await getFieldTemplate({
      db,
      templateId: req.params.id,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json(result.template);
  } catch (error) {
    console.error('Error fetching field template:', error);
    res.status(500).json({ error: 'Failed to fetch field template' });
  }
});

// Create a new field template
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await createFieldTemplate({
      db,
      body: req.body,
      userId: req.user.id,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json(result.template);
  } catch (error: unknown) {
    console.error('Error creating field template:', error);
    res.status(500).json({
      error: 'Failed to create field template',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Update a field template
router.put('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await updateFieldTemplate({
      db,
      templateId: req.params.id,
      body: req.body,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json(result.template);
  } catch (error) {
    console.error('Error updating field template:', error);
    res.status(500).json({ error: 'Failed to update field template' });
  }
});

// Delete a field template
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    await db.run('DELETE FROM scoresheet_field_templates WHERE id = ?', [
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting field template:', error);
    res.status(500).json({ error: 'Failed to delete field template' });
  }
});

export default router;
