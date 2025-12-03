import express from 'express';
import { getDatabase } from '../database/connection';
import { getSheetData } from '../services/googleSheets';
import { getAvailableGames, getGame } from '../services/bracketParser';
import { getValidAccessToken } from '../services/tokenRefresh';

const router = express.Router();

// Get data from a spreadsheet for dynamic dropdowns
router.get('/sheet-data/:sheetName', async (req: express.Request, res: express.Response) => {
  try {
    const { sheetName } = req.params;
    const { range, templateId } = req.query;

    const db = await getDatabase();
    
    let config;
    
    // If templateId is provided, use that template's owner's config
    if (templateId) {
      const template = await db.get(
        'SELECT created_by FROM scoresheet_templates WHERE id = ?',
        [templateId]
      );
      
      if (template && template.created_by) {
        config = await db.get(
          'SELECT sc.*, u.access_token FROM spreadsheet_configs sc JOIN users u ON sc.user_id = u.id WHERE sc.user_id = ? AND sc.is_active = 1 LIMIT 1',
          [template.created_by]
        );
      }
    }
    
    // Fallback to any active 'data' purpose config
    if (!config) {
      config = await db.get(
        `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
         JOIN users u ON sc.user_id = u.id 
         WHERE sc.is_active = 1 AND (sc.sheet_purpose = 'data' OR sc.sheet_purpose IS NULL)
         ORDER BY sc.updated_at DESC LIMIT 1`
      );
    }

    if (!config) {
      return res.status(400).json({ error: 'No active spreadsheet configuration found' });
    }

    // Get a valid (possibly refreshed) access token
    let accessToken;
    try {
      accessToken = await getValidAccessToken(config.user_id);
    } catch (tokenError: any) {
      return res.status(401).json({ 
        error: tokenError.message || 'Token refresh failed. Admin needs to re-authenticate.',
        needsReauth: true 
      });
    }

    const data = await getSheetData(
      accessToken,
      config.spreadsheet_id,
      sheetName,
      range as string
    );

    res.json(data);
  } catch (error: any) {
    console.error('Error fetching sheet data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch data from spreadsheet',
      details: error.message,
      sheetName: req.params.sheetName
    });
  }
});

// Get bracket games from a spreadsheet
router.get('/bracket-games/:sheetName', async (req: express.Request, res: express.Response) => {
  try {
    const { sheetName } = req.params;
    const { templateId } = req.query;

    const db = await getDatabase();
    
    let config;
    
    // If templateId is provided, use that template's owner's config
    if (templateId) {
      const template = await db.get(
        'SELECT created_by FROM scoresheet_templates WHERE id = ?',
        [templateId]
      );
      
      if (template && template.created_by) {
        // Get the bracket-purpose config for this user
        config = await db.get(
          `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
           JOIN users u ON sc.user_id = u.id 
           WHERE sc.user_id = ? AND sc.is_active = 1 AND sc.sheet_purpose = 'bracket'
           LIMIT 1`,
          [template.created_by]
        );
        
        // Fallback to any active config for this user
        if (!config) {
          config = await db.get(
            `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
             JOIN users u ON sc.user_id = u.id 
             WHERE sc.user_id = ? AND sc.is_active = 1
             LIMIT 1`,
            [template.created_by]
          );
        }
      }
    }
    
    // Fallback to any active bracket config
    if (!config) {
      config = await db.get(
        `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
         JOIN users u ON sc.user_id = u.id 
         WHERE sc.is_active = 1 AND sc.sheet_purpose = 'bracket'
         ORDER BY sc.updated_at DESC LIMIT 1`
      );
    }

    if (!config) {
      return res.status(400).json({ error: 'No active bracket spreadsheet configuration found' });
    }

    // Get a valid (possibly refreshed) access token
    let accessToken;
    try {
      accessToken = await getValidAccessToken(config.user_id);
    } catch (tokenError: any) {
      return res.status(401).json({ 
        error: tokenError.message || 'Token refresh failed. Admin needs to re-authenticate.',
        needsReauth: true 
      });
    }

    const games = await getAvailableGames(
      accessToken,
      config.spreadsheet_id,
      sheetName
    );

    res.json(games);
  } catch (error: any) {
    console.error('Error fetching bracket games:', error);
    res.status(500).json({ 
      error: 'Failed to fetch bracket games',
      details: error.message
    });
  }
});

// Get a specific game from the bracket
router.get('/bracket-game/:sheetName/:gameNumber', async (req: express.Request, res: express.Response) => {
  try {
    const { sheetName, gameNumber } = req.params;
    const { templateId } = req.query;

    const db = await getDatabase();
    
    let config;
    
    if (templateId) {
      const template = await db.get(
        'SELECT created_by FROM scoresheet_templates WHERE id = ?',
        [templateId]
      );
      
      if (template && template.created_by) {
        config = await db.get(
          `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
           JOIN users u ON sc.user_id = u.id 
           WHERE sc.user_id = ? AND sc.is_active = 1 AND sc.sheet_purpose = 'bracket'
           LIMIT 1`,
          [template.created_by]
        );
        
        if (!config) {
          config = await db.get(
            `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
             JOIN users u ON sc.user_id = u.id 
             WHERE sc.user_id = ? AND sc.is_active = 1
             LIMIT 1`,
            [template.created_by]
          );
        }
      }
    }
    
    if (!config) {
      config = await db.get(
        `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
         JOIN users u ON sc.user_id = u.id 
         WHERE sc.is_active = 1 AND sc.sheet_purpose = 'bracket'
         ORDER BY sc.updated_at DESC LIMIT 1`
      );
    }

    if (!config) {
      return res.status(400).json({ error: 'No active bracket spreadsheet configuration found' });
    }

    // Get a valid (possibly refreshed) access token
    let accessToken;
    try {
      accessToken = await getValidAccessToken(config.user_id);
    } catch (tokenError: any) {
      return res.status(401).json({ 
        error: tokenError.message || 'Token refresh failed. Admin needs to re-authenticate.',
        needsReauth: true 
      });
    }

    const game = await getGame(
      accessToken,
      config.spreadsheet_id,
      sheetName,
      parseInt(gameNumber, 10)
    );

    if (!game) {
      return res.status(404).json({ error: `Game ${gameNumber} not found` });
    }

    res.json(game);
  } catch (error: any) {
    console.error('Error fetching bracket game:', error);
    res.status(500).json({ 
      error: 'Failed to fetch bracket game',
      details: error.message
    });
  }
});

export default router;

