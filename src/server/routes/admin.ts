import express, { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { listSpreadsheets, getSpreadsheetInfo, getSpreadsheetSheets } from '../services/googleSheets';
import { getValidAccessToken } from '../services/tokenRefresh';

const router = express.Router();

// Get all spreadsheet configurations for the current user
router.get('/spreadsheets', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    // If 'all' query param is set, return all configs (for template assignment)
    // Otherwise, return only the current user's configs
    const query = req.query.all === 'true'
      ? 'SELECT * FROM spreadsheet_configs WHERE is_active = 1 ORDER BY spreadsheet_name, sheet_name'
      : 'SELECT * FROM spreadsheet_configs WHERE user_id = ? ORDER BY created_at DESC';
    const params = req.query.all === 'true' ? [] : [req.user.id];
    
    const configs = await db.all(query, params);
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
    // Get a valid (possibly refreshed) access token
    const accessToken = await getValidAccessToken(req.user.id);
    const sheets = await getSpreadsheetSheets(accessToken, spreadsheetId);
    res.json(sheets);
  } catch (error: any) {
    console.error('Error getting spreadsheet sheets:', error);
    if (error.message?.includes('re-authenticate')) {
      res.status(401).json({ error: error.message, needsReauth: true });
    } else {
      res.status(500).json({ error: 'Failed to get sheets from spreadsheet' });
    }
  }
});

// List available drives/locations
router.get('/drive/locations', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { listDrives } = await import('../services/googleSheets');
    // Get a valid (possibly refreshed) access token
    const accessToken = await getValidAccessToken(req.user.id);
    const locations = await listDrives(accessToken);
    res.json(locations);
  } catch (error: any) {
    console.error('Error listing drives:', error);
    if (error.message?.includes('re-authenticate')) {
      res.status(401).json({ error: error.message, needsReauth: true });
    } else {
      res.status(500).json({ error: 'Failed to list drives from Google Drive' });
    }
  }
});

// List spreadsheets from a specific drive/location
router.get('/drive/spreadsheets', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { driveId, driveType } = req.query;
    // Get a valid (possibly refreshed) access token
    const accessToken = await getValidAccessToken(req.user.id);
    const spreadsheets = await listSpreadsheets(
      accessToken,
      driveId as string,
      driveType as string
    );
    res.json(spreadsheets);
  } catch (error: any) {
    console.error('Error listing spreadsheets:', error);
    if (error.message?.includes('re-authenticate')) {
      res.status(401).json({ error: error.message, needsReauth: true });
    } else {
      res.status(500).json({ error: 'Failed to list spreadsheets from Google Drive' });
    }
  }
});

// Link a spreadsheet sheet with purpose
router.post('/spreadsheets/link', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { spreadsheetId, sheetName, sheetPurpose } = req.body;
    
    if (!spreadsheetId || !sheetName || !sheetPurpose) {
      return res.status(400).json({ error: 'Spreadsheet ID, sheet name, and purpose are required' });
    }

    // Get a valid (possibly refreshed) access token
    const accessToken = await getValidAccessToken(req.user.id);
    
    // Get spreadsheet info from Google
    const spreadsheetInfo = await getSpreadsheetInfo(accessToken, spreadsheetId);

    const db = await getDatabase();
    
    // Check if this exact combination already exists
    const existing = await db.get(
      'SELECT id FROM spreadsheet_configs WHERE user_id = ? AND spreadsheet_id = ? AND sheet_name = ? AND sheet_purpose = ?',
      [req.user.id, spreadsheetId, sheetName, sheetPurpose]
    );

    if (existing) {
      return res.status(400).json({ error: 'This sheet configuration already exists' });
    }

    // Create new configuration (multiple can be active)
    const result = await db.run(
      `INSERT INTO spreadsheet_configs (user_id, spreadsheet_id, spreadsheet_name, sheet_name, sheet_purpose, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [req.user.id, spreadsheetId, spreadsheetInfo.title, sheetName, sheetPurpose]
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

