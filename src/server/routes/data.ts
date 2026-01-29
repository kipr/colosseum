import express from 'express';
import { getDatabase } from '../database/connection';
import { getSheetData } from '../services/googleSheets';
import { getAvailableGames, getGame } from '../services/bracketParser';
import {
  getValidAccessToken,
  forceRefreshToken,
} from '../services/tokenRefresh';

const router = express.Router();

// Get data from a spreadsheet for dynamic dropdowns
router.get(
  '/sheet-data/:sheetName',
  async (req: express.Request, res: express.Response) => {
    try {
      const { sheetName } = req.params;
      const { range, templateId } = req.query;

      const db = await getDatabase();

      let config;

      // If templateId is provided, use that template's owner's config
      if (templateId) {
        const template = await db.get(
          'SELECT created_by FROM scoresheet_templates WHERE id = ?',
          [templateId],
        );

        if (template && template.created_by) {
          config = await db.get(
            'SELECT sc.*, u.access_token FROM spreadsheet_configs sc JOIN users u ON sc.user_id = u.id WHERE sc.user_id = ? AND sc.is_active IS TRUE LIMIT 1',
            [template.created_by],
          );
        }
      }

      // Fallback to any active 'data' purpose config
      if (!config) {
        config = await db.get(
          `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
         JOIN users u ON sc.user_id = u.id 
         WHERE sc.is_active IS TRUE AND (sc.sheet_purpose = 'data' OR sc.sheet_purpose IS NULL)
         ORDER BY sc.updated_at DESC LIMIT 1`,
        );
      }

      if (!config) {
        return res
          .status(400)
          .json({ error: 'No active spreadsheet configuration found' });
      }

      // Get a valid (possibly refreshed) access token
      let accessToken;
      try {
        accessToken = await getValidAccessToken(config.user_id);
      } catch (tokenError: unknown) {
        return res.status(401).json({
          error:
            (tokenError instanceof Error ? tokenError.message : null) ||
            'Token refresh failed. Admin needs to re-authenticate.',
          needsReauth: true,
        });
      }

      // Try to get data, retry with refreshed token if 401 error
      let data;
      try {
        data = await getSheetData(
          accessToken,
          config.spreadsheet_id,
          sheetName,
          range as string,
        );
      } catch (apiError: unknown) {
        const apiErr = apiError as { code?: number; status?: number; response?: { status?: number } };
        const status = apiErr?.code || apiErr?.status || apiErr?.response?.status;
        if (status === 401) {
          try {
            accessToken = await forceRefreshToken(config.user_id);
            data = await getSheetData(
              accessToken,
              config.spreadsheet_id,
              sheetName,
              range as string,
            );
          } catch {
            return res.status(401).json({
              error: 'Token expired. Admin needs to re-authenticate.',
              needsReauth: true,
            });
          }
        } else {
          throw apiError;
        }
      }

      res.json(data);
    } catch (error: unknown) {
      console.error('Error fetching sheet data:', error);
      res.status(500).json({
        error: 'Failed to fetch data from spreadsheet',
        details: error instanceof Error ? error.message : 'Unknown error',
        sheetName: req.params.sheetName,
      });
    }
  },
);

// Get bracket games from a spreadsheet
router.get(
  '/bracket-games/:sheetName',
  async (req: express.Request, res: express.Response) => {
    try {
      const { sheetName } = req.params;
      const { templateId } = req.query;

      const db = await getDatabase();

      let config;

      // If templateId is provided, use that template's owner's config
      if (templateId) {
        const template = await db.get(
          'SELECT created_by FROM scoresheet_templates WHERE id = ?',
          [templateId],
        );

        if (template && template.created_by) {
          // Get the bracket-purpose config for this user
          config = await db.get(
            `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
           JOIN users u ON sc.user_id = u.id 
           WHERE sc.user_id = ? AND sc.is_active IS TRUE AND sc.sheet_purpose = 'bracket'
           LIMIT 1`,
            [template.created_by],
          );

          // Fallback to any active config for this user
          if (!config) {
            config = await db.get(
              `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
             JOIN users u ON sc.user_id = u.id 
             WHERE sc.user_id = ? AND sc.is_active IS TRUE
             LIMIT 1`,
              [template.created_by],
            );
          }
        }
      }

      // Fallback to any active bracket config
      if (!config) {
        config = await db.get(
          `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
         JOIN users u ON sc.user_id = u.id 
         WHERE sc.is_active IS TRUE AND sc.sheet_purpose = 'bracket'
         ORDER BY sc.updated_at DESC LIMIT 1`,
        );
      }

      if (!config) {
        return res
          .status(400)
          .json({ error: 'No active bracket spreadsheet configuration found' });
      }

      // Get a valid (possibly refreshed) access token
      let accessToken;
      try {
        accessToken = await getValidAccessToken(config.user_id);
      } catch (tokenError: unknown) {
        return res.status(401).json({
          error:
            (tokenError instanceof Error ? tokenError.message : null) ||
            'Token refresh failed. Admin needs to re-authenticate.',
          needsReauth: true,
        });
      }

      // Try to get games, retry with refreshed token if 401 error
      let games;
      try {
        games = await getAvailableGames(
          accessToken,
          config.spreadsheet_id,
          sheetName,
        );
      } catch (apiError: unknown) {
        // Check if it's a 401 error
        const apiErr = apiError as { code?: number; status?: number; response?: { status?: number } };
        const status = apiErr?.code || apiErr?.status || apiErr?.response?.status;
        if (status === 401) {
          // Force refresh token and retry
          try {
            accessToken = await forceRefreshToken(config.user_id);
            games = await getAvailableGames(
              accessToken,
              config.spreadsheet_id,
              sheetName,
            );
          } catch {
            return res.status(401).json({
              error: 'Token expired. Admin needs to re-authenticate.',
              needsReauth: true,
            });
          }
        } else {
          throw apiError;
        }
      }

      res.json(games);
    } catch (error: unknown) {
      console.error('Error fetching bracket games:', error);
      res.status(500).json({
        error: 'Failed to fetch bracket games',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// Get a specific game from the bracket
router.get(
  '/bracket-game/:sheetName/:gameNumber',
  async (req: express.Request, res: express.Response) => {
    try {
      const { sheetName, gameNumber } = req.params;
      const { templateId } = req.query;

      const db = await getDatabase();

      let config;

      if (templateId) {
        const template = await db.get(
          'SELECT created_by FROM scoresheet_templates WHERE id = ?',
          [templateId],
        );

        if (template && template.created_by) {
          config = await db.get(
            `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
           JOIN users u ON sc.user_id = u.id 
           WHERE sc.user_id = ? AND sc.is_active IS TRUE AND sc.sheet_purpose = 'bracket'
           LIMIT 1`,
            [template.created_by],
          );

          if (!config) {
            config = await db.get(
              `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
             JOIN users u ON sc.user_id = u.id 
             WHERE sc.user_id = ? AND sc.is_active IS TRUE
             LIMIT 1`,
              [template.created_by],
            );
          }
        }
      }

      if (!config) {
        config = await db.get(
          `SELECT sc.*, u.access_token FROM spreadsheet_configs sc 
         JOIN users u ON sc.user_id = u.id 
         WHERE sc.is_active IS TRUE AND sc.sheet_purpose = 'bracket'
         ORDER BY sc.updated_at DESC LIMIT 1`,
        );
      }

      if (!config) {
        return res
          .status(400)
          .json({ error: 'No active bracket spreadsheet configuration found' });
      }

      // Get a valid (possibly refreshed) access token
      let accessToken;
      try {
        accessToken = await getValidAccessToken(config.user_id);
      } catch (tokenError: unknown) {
        return res.status(401).json({
          error:
            (tokenError instanceof Error ? tokenError.message : null) ||
            'Token refresh failed. Admin needs to re-authenticate.',
          needsReauth: true,
        });
      }

      // Try to get game, retry with refreshed token if 401 error
      let game;
      try {
        game = await getGame(
          accessToken,
          config.spreadsheet_id,
          sheetName,
          parseInt(gameNumber, 10),
        );
      } catch (apiError: unknown) {
        const apiErr = apiError as { code?: number; status?: number; response?: { status?: number } };
        const status = apiErr?.code || apiErr?.status || apiErr?.response?.status;
        if (status === 401) {
          try {
            accessToken = await forceRefreshToken(config.user_id);
            game = await getGame(
              accessToken,
              config.spreadsheet_id,
              sheetName,
              parseInt(gameNumber, 10),
            );
          } catch {
            return res.status(401).json({
              error: 'Token expired. Admin needs to re-authenticate.',
              needsReauth: true,
            });
          }
        } else {
          throw apiError;
        }
      }

      if (!game) {
        return res.status(404).json({ error: `Game ${gameNumber} not found` });
      }

      res.json(game);
    } catch (error: unknown) {
      console.error('Error fetching bracket game:', error);
      res.status(500).json({
        error: 'Failed to fetch bracket game',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

export default router;
