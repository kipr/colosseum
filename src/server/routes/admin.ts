import express, { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { listSpreadsheets, getSpreadsheetInfo, getSpreadsheetSheets } from '../services/googleSheets';
import { getValidAccessToken } from '../services/tokenRefresh';

const router = express.Router();

// Get all spreadsheet configurations
router.get('/spreadsheets', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    // If 'all' query param is set, return all active configs (for template assignment)
    // If 'shared' query param is set, return all configs regardless of user
    // Otherwise, return current user's configs
    let configs;
    if (req.query.all === 'true') {
      configs = await db.all('SELECT * FROM spreadsheet_configs WHERE is_active IS TRUE ORDER BY spreadsheet_name, sheet_name');
    } else if (req.query.shared === 'true') {
      configs = await db.all('SELECT * FROM spreadsheet_configs ORDER BY spreadsheet_name, sheet_name, created_at DESC');
    } else {
      configs = await db.all('SELECT * FROM spreadsheet_configs WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    }
    
    res.json(configs);
  } catch (error) {
    console.error('Error fetching spreadsheet configs:', error);
    res.status(500).json({ error: 'Failed to fetch spreadsheet configurations' });
  }
});

// Get unique spreadsheets grouped with counts
router.get('/spreadsheets/grouped', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    // If shared=true, show all spreadsheets; otherwise show only user's spreadsheets
    const showAll = req.query.shared === 'true';
    
    const query = showAll
      ? `SELECT 
          spreadsheet_id,
          MAX(spreadsheet_name) as spreadsheet_name,
          SUM(CASE WHEN sheet_name != '__SPREADSHEET_PLACEHOLDER__' THEN 1 ELSE 0 END) as sheet_count,
          SUM(CASE WHEN is_active IS TRUE AND sheet_name != '__SPREADSHEET_PLACEHOLDER__' THEN 1 ELSE 0 END) as active_count
        FROM spreadsheet_configs 
        GROUP BY spreadsheet_id
        ORDER BY spreadsheet_name`
      : `SELECT 
          spreadsheet_id,
          MAX(spreadsheet_name) as spreadsheet_name,
          SUM(CASE WHEN sheet_name != '__SPREADSHEET_PLACEHOLDER__' THEN 1 ELSE 0 END) as sheet_count,
          SUM(CASE WHEN is_active IS TRUE AND sheet_name != '__SPREADSHEET_PLACEHOLDER__' THEN 1 ELSE 0 END) as active_count
        FROM spreadsheet_configs 
        WHERE user_id = ?
        GROUP BY spreadsheet_id
        ORDER BY spreadsheet_name`;
    
    const params = showAll ? [] : [req.user.id];
    const spreadsheets = await db.all(query, params);
    res.json(spreadsheets);
  } catch (error) {
    console.error('Error fetching grouped spreadsheets:', error);
    res.status(500).json({ error: 'Failed to fetch spreadsheets' });
  }
});

// Get sheet configs for a specific spreadsheet (excluding placeholder)
router.get('/spreadsheets/by-spreadsheet/:spreadsheetId/configs', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { spreadsheetId } = req.params;
    const db = await getDatabase();
    const showAll = req.query.shared === 'true';
    
    const query = showAll
      ? `SELECT * FROM spreadsheet_configs 
         WHERE spreadsheet_id = ? AND sheet_name != '__SPREADSHEET_PLACEHOLDER__'
         ORDER BY sheet_name`
      : `SELECT * FROM spreadsheet_configs 
         WHERE spreadsheet_id = ? AND user_id = ? AND sheet_name != '__SPREADSHEET_PLACEHOLDER__'
         ORDER BY sheet_name`;
    
    const params = showAll ? [spreadsheetId] : [spreadsheetId, req.user.id];
    const configs = await db.all(query, params);
    res.json(configs);
  } catch (error) {
    console.error('Error fetching sheet configs:', error);
    res.status(500).json({ error: 'Failed to fetch sheet configurations' });
  }
});

// Deactivate all sheets for a spreadsheet
router.put('/spreadsheets/by-spreadsheet/:spreadsheetId/deactivate', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { spreadsheetId } = req.params;
    const db = await getDatabase();
    const updateAll = req.query.shared === 'true';
    
    if (updateAll) {
      await db.run(
        'UPDATE spreadsheet_configs SET is_active = false WHERE spreadsheet_id = ?',
        [spreadsheetId]
      );
    } else {
      await db.run(
        'UPDATE spreadsheet_configs SET is_active = false WHERE spreadsheet_id = ? AND user_id = ?',
        [spreadsheetId, req.user.id]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deactivating spreadsheet:', error);
    res.status(500).json({ error: 'Failed to deactivate spreadsheet' });
  }
});

// Delete all configs for a spreadsheet (unlink)
router.delete('/spreadsheets/by-spreadsheet/:spreadsheetId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { spreadsheetId } = req.params;
    const db = await getDatabase();
    const deleteAll = req.query.shared === 'true';
    
    // First, get the config IDs we're about to delete
    let configIds: number[];
    if (deleteAll) {
      const configs = await db.all(
        'SELECT id FROM spreadsheet_configs WHERE spreadsheet_id = ?',
        [spreadsheetId]
      );
      configIds = configs.map((c: any) => c.id);
    } else {
      const configs = await db.all(
        'SELECT id FROM spreadsheet_configs WHERE spreadsheet_id = ? AND user_id = ?',
        [spreadsheetId, req.user.id]
      );
      configIds = configs.map((c: any) => c.id);
    }
    
    // Unlink any scoresheet templates that reference these configs
    if (configIds.length > 0) {
      const placeholders = configIds.map(() => '?').join(',');
      await db.run(
        `UPDATE scoresheet_templates SET spreadsheet_config_id = NULL WHERE spreadsheet_config_id IN (${placeholders})`,
        configIds
      );
    }
    
    // Now delete the configs
    if (deleteAll) {
      await db.run(
        'DELETE FROM spreadsheet_configs WHERE spreadsheet_id = ?',
        [spreadsheetId]
      );
    } else {
      await db.run(
        'DELETE FROM spreadsheet_configs WHERE spreadsheet_id = ? AND user_id = ?',
        [spreadsheetId, req.user.id]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting spreadsheet:', error);
    res.status(500).json({ error: 'Failed to delete spreadsheet' });
  }
});

// Link just a spreadsheet (creates a placeholder config without a sheet)
router.post('/spreadsheets/link-spreadsheet', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { spreadsheetId } = req.body;
    
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Spreadsheet ID is required' });
    }

    const db = await getDatabase();
    
    // Check if this spreadsheet is already linked by this user
    const existing = await db.get(
      'SELECT id FROM spreadsheet_configs WHERE user_id = ? AND spreadsheet_id = ?',
      [req.user.id, spreadsheetId]
    );

    if (existing) {
      return res.status(400).json({ error: 'This spreadsheet is already linked' });
    }

    // Get spreadsheet info from Google
    const accessToken = await getValidAccessToken(req.user.id);
    const spreadsheetInfo = await getSpreadsheetInfo(accessToken, spreadsheetId);

    // Create a placeholder config (no sheet selected yet)
    // We'll use a special marker for sheet_name to indicate it's just the spreadsheet link
    const result = await db.run(
      `INSERT INTO spreadsheet_configs (user_id, spreadsheet_id, spreadsheet_name, sheet_name, sheet_purpose, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, spreadsheetId, spreadsheetInfo.title, '__SPREADSHEET_PLACEHOLDER__', 'none', false]
    );

    res.json({ success: true, id: result.lastID });
  } catch (error) {
    console.error('Error linking spreadsheet:', error);
    res.status(500).json({ error: 'Failed to link spreadsheet' });
  }
});

// Link a specific sheet within an already-linked spreadsheet
router.post('/spreadsheets/link-sheet', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { spreadsheetId, sheetName, sheetPurpose, isActive = false } = req.body;
    
    if (!spreadsheetId || !sheetName || !sheetPurpose) {
      return res.status(400).json({ error: 'Spreadsheet ID, sheet name, and purpose are required' });
    }

    const db = await getDatabase();
    
    // Check if this exact combination already exists for this user
    const existing = await db.get(
      'SELECT id FROM spreadsheet_configs WHERE user_id = ? AND spreadsheet_id = ? AND sheet_name = ?',
      [req.user.id, spreadsheetId, sheetName]
    );

    if (existing) {
      return res.status(400).json({ error: 'This sheet is already configured' });
    }

    // Get spreadsheet name from existing config or from Google
    let spreadsheetName;
    const existingConfig = await db.get(
      'SELECT spreadsheet_name FROM spreadsheet_configs WHERE spreadsheet_id = ? AND user_id = ?',
      [spreadsheetId, req.user.id]
    );
    
    if (existingConfig) {
      spreadsheetName = existingConfig.spreadsheet_name;
    } else {
      const accessToken = await getValidAccessToken(req.user.id);
      const spreadsheetInfo = await getSpreadsheetInfo(accessToken, spreadsheetId);
      spreadsheetName = spreadsheetInfo.title;
    }

    // Create the sheet config
    const result = await db.run(
      `INSERT INTO spreadsheet_configs (user_id, spreadsheet_id, spreadsheet_name, sheet_name, sheet_purpose, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, spreadsheetId, spreadsheetName, sheetName, sheetPurpose, !!isActive]
    );

    // Remove placeholder if it exists for this user
    await db.run(
      'DELETE FROM spreadsheet_configs WHERE user_id = ? AND spreadsheet_id = ? AND sheet_name = ?',
      [req.user.id, spreadsheetId, '__SPREADSHEET_PLACEHOLDER__']
    );

    const config = await db.get('SELECT * FROM spreadsheet_configs WHERE id = ?', [result.lastID]);
    res.json(config);
  } catch (error) {
    console.error('Error linking sheet:', error);
    res.status(500).json({ error: 'Failed to link sheet' });
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
    // Check for auth errors from Google API (401, invalid credentials, etc.)
    const isAuthError = error.message?.includes('re-authenticate') || 
                        error.message?.includes('invalid authentication') ||
                        error.code === 401 || 
                        error.status === 401;
    if (isAuthError) {
      res.status(401).json({ 
        error: 'Your Google authentication has expired. Please log out and log back in.', 
        needsReauth: true 
      });
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
    const isAuthError = error.message?.includes('re-authenticate') || 
                        error.message?.includes('invalid authentication') ||
                        error.code === 401 || 
                        error.status === 401;
    if (isAuthError) {
      res.status(401).json({ 
        error: 'Your Google authentication has expired. Please log out and log back in.', 
        needsReauth: true 
      });
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
    const isAuthError = error.message?.includes('re-authenticate') || 
                        error.message?.includes('invalid authentication') ||
                        error.code === 401 || 
                        error.status === 401;
    if (isAuthError) {
      res.status(401).json({ 
        error: 'Your Google authentication has expired. Please log out and log back in.', 
        needsReauth: true 
      });
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
    
    // Check if this exact combination already exists for this user
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
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, spreadsheetId, spreadsheetInfo.title, sheetName, sheetPurpose, true]
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

    // Verify ownership unless shared mode
    const config = await db.get(
      'SELECT * FROM spreadsheet_configs WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );

    if (!config) {
      return res.status(404).json({ error: 'Spreadsheet configuration not found' });
    }

    // Activate this spreadsheet (allow multiple active)
    await db.run('UPDATE spreadsheet_configs SET is_active = true WHERE id = ?', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error activating spreadsheet:', error);
    res.status(500).json({ error: 'Failed to activate spreadsheet' });
  }
});

// Deactivate a spreadsheet configuration
router.put('/spreadsheets/:id/deactivate', requireAuth, async (req: AuthRequest, res: Response) => {
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

    // Deactivate this spreadsheet
    await db.run('UPDATE spreadsheet_configs SET is_active = false WHERE id = ?', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deactivating spreadsheet:', error);
    res.status(500).json({ error: 'Failed to deactivate spreadsheet' });
  }
});

// Toggle auto-accept for a spreadsheet config
router.post('/spreadsheets/:id/auto-accept', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;
    const db = await getDatabase();

    // Verify the config exists
    const config = await db.get('SELECT * FROM spreadsheet_configs WHERE id = ?', [id]);
    if (!config) {
      return res.status(404).json({ error: 'Spreadsheet configuration not found' });
    }

    // Update auto_accept setting
    await db.run(
      'UPDATE spreadsheet_configs SET auto_accept = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [enabled ? true : false, id]
    );

    res.json({ success: true, auto_accept: enabled });
  } catch (error) {
    console.error('Error updating auto-accept:', error);
    res.status(500).json({ error: 'Failed to update auto-accept setting' });
  }
});

// Delete a spreadsheet configuration
router.delete('/spreadsheets/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    // First, unlink any scoresheet templates that reference this config
    await db.run(
      'UPDATE scoresheet_templates SET spreadsheet_config_id = NULL WHERE spreadsheet_config_id = ?',
      [id]
    );

    // Now delete the config (allow shared delete if query param is set)
    const deleteShared = req.query.shared === 'true';
    if (deleteShared) {
      await db.run(
        'DELETE FROM spreadsheet_configs WHERE id = ?',
        [id]
      );
    } else {
      await db.run(
        'DELETE FROM spreadsheet_configs WHERE id = ? AND user_id = ?',
        [id, req.user.id]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting spreadsheet config:', error);
    res.status(500).json({ error: 'Failed to delete spreadsheet configuration' });
  }
});

// Get all admin users with activity status
router.get('/users', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    
    // Get all admin users with last activity
    const users = await db.all(`
      SELECT 
        id, 
        email, 
        name, 
        is_admin,
        token_expires_at,
        last_activity,
        created_at,
        updated_at
      FROM users 
      WHERE is_admin IS TRUE
      ORDER BY last_activity DESC NULLS LAST
    `);
    
    // Add activity status to each user
    const now = Date.now();
    const usersWithStatus = users.map((user: any) => {
      // Handle both Date objects (PostgreSQL) and strings (SQLite)
      let lastActivityTime: number | null = null;
      if (user.last_activity) {
        if (user.last_activity instanceof Date) {
          lastActivityTime = user.last_activity.getTime();
        } else {
          lastActivityTime = new Date(user.last_activity).getTime();
        }
      }
      
      // Consider "active" if activity within last 5 minutes
      const isActive = lastActivityTime ? (now - lastActivityTime) < 5 * 60 * 1000 : false;
      // Consider "recently active" if within last hour
      const isRecentlyActive = lastActivityTime ? (now - lastActivityTime) < 60 * 60 * 1000 : false;
      
      return {
        ...user,
        last_activity: lastActivityTime ? new Date(lastActivityTime).toISOString() : null,
        isActive,
        isRecentlyActive,
        tokenValid: user.token_expires_at ? user.token_expires_at > now : false
      };
    });
    
    res.json(usersWithStatus);
  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({ error: 'Failed to fetch admin users' });
  }
});

export default router;

