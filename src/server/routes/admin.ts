import express, { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { listSpreadsheets, getSpreadsheetInfo, getSpreadsheetSheets } from '../services/googleSheets';

const router = express.Router();

// Get all spreadsheet configurations for the current user
router.get('/spreadsheets', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const configs = await db.all(
      'SELECT * FROM spreadsheet_configs WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(configs);
  } catch (error) {
    console.error('Error fetching spreadsheet configs:', error);
    res.status(500).json({ error: 'Failed to fetch spreadsheet configurations' });
  }
});

// Get sheets/tabs from a specific spreadsheet
router.get('/spreadsheets/:spreadsheetId/sheets', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { spreadsheetId } = req.params;
    const sheets = await getSpreadsheetSheets(req.user.access_token, spreadsheetId);
    res.json(sheets);
  } catch (error) {
    console.error('Error getting spreadsheet sheets:', error);
    res.status(500).json({ error: 'Failed to get sheets from spreadsheet' });
  }
});

// List available drives/locations
router.get('/drive/locations', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { listDrives } = await import('../services/googleSheets');
    const locations = await listDrives(req.user.access_token);
    res.json(locations);
  } catch (error) {
    console.error('Error listing drives:', error);
    res.status(500).json({ error: 'Failed to list drives from Google Drive' });
  }
});

// List spreadsheets from a specific drive/location
router.get('/drive/spreadsheets', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { driveId, driveType } = req.query;
    const spreadsheets = await listSpreadsheets(
      req.user.access_token,
      driveId as string,
      driveType as string
    );
    res.json(spreadsheets);
  } catch (error) {
    console.error('Error listing spreadsheets:', error);
    res.status(500).json({ error: 'Failed to list spreadsheets from Google Drive' });
  }
});

// Link a spreadsheet
router.post('/spreadsheets/link', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { spreadsheetId, sheetName } = req.body;
    
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Spreadsheet ID is required' });
    }

    // Get spreadsheet info from Google
    const spreadsheetInfo = await getSpreadsheetInfo(req.user.access_token, spreadsheetId);

    const db = await getDatabase();
    
    // Deactivate other configurations
    await db.run('UPDATE spreadsheet_configs SET is_active = 0 WHERE user_id = ?', [req.user.id]);

    // Create new configuration
    const result = await db.run(
      `INSERT INTO spreadsheet_configs (user_id, spreadsheet_id, spreadsheet_name, sheet_name, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [req.user.id, spreadsheetId, spreadsheetInfo.title, sheetName || 'Sheet1']
    );

    const config = await db.get('SELECT * FROM spreadsheet_configs WHERE id = ?', [result.lastID]);
    res.json(config);
  } catch (error) {
    console.error('Error linking spreadsheet:', error);
    res.status(500).json({ error: 'Failed to link spreadsheet' });
  }
});

// Update active spreadsheet configuration
router.put('/spreadsheets/:id/activate', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    // Verify ownership
    const config = await db.get(
      'SELECT * FROM spreadsheet_configs WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );

    if (!config) {
      return res.status(404).json({ error: 'Spreadsheet configuration not found' });
    }

    // Deactivate all and activate this one
    await db.run('UPDATE spreadsheet_configs SET is_active = 0 WHERE user_id = ?', [req.user.id]);
    await db.run('UPDATE spreadsheet_configs SET is_active = 1 WHERE id = ?', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error activating spreadsheet:', error);
    res.status(500).json({ error: 'Failed to activate spreadsheet' });
  }
});

// Delete a spreadsheet configuration
router.delete('/spreadsheets/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    await db.run(
      'DELETE FROM spreadsheet_configs WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting spreadsheet config:', error);
    res.status(500).json({ error: 'Failed to delete spreadsheet configuration' });
  }
});

export default router;

