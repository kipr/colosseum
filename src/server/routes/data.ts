import express from 'express';
import { getDatabase } from '../database/connection';
import { getSheetData } from '../services/googleSheets';

const router = express.Router();

// Get data from a spreadsheet for dynamic dropdowns
router.get('/sheet-data/:sheetName', async (req: express.Request, res: express.Response) => {
  try {
    const { sheetName } = req.params;
    const { range } = req.query;

    const db = await getDatabase();
    
    // Find any active spreadsheet config (we'll use the first one we find)
    // In a multi-user scenario, you might want to pass a config ID
    const config = await db.get(
      'SELECT sc.*, u.access_token FROM spreadsheet_configs sc JOIN users u ON sc.user_id = u.id WHERE sc.is_active = 1 LIMIT 1'
    );

    if (!config) {
      return res.status(400).json({ error: 'No active spreadsheet configuration found' });
    }

    const data = await getSheetData(
      config.access_token,
      config.spreadsheet_id,
      sheetName,
      range as string
    );

    res.json(data);
  } catch (error) {
    console.error('Error fetching sheet data:', error);
    res.status(500).json({ error: 'Failed to fetch data from spreadsheet' });
  }
});

export default router;

