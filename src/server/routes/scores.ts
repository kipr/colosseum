import express from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { submitScoreToSheet, updateTeamScore } from '../services/googleSheets';
import {
  writeWinnerToBracket,
  clearWinnerFromBracket,
} from '../services/bracketParser';
import {
  getValidAccessToken,
  forceRefreshToken,
} from '../services/tokenRefresh';

const router = express.Router();

// Get scores filtered by spreadsheet config
router.get(
  '/by-spreadsheet/:configId',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { configId } = req.params;
      const db = await getDatabase();

      const scores = await db.all(
        `SELECT s.*, t.name as template_name, u.name as reviewer_name
       FROM score_submissions s
       JOIN scoresheet_templates t ON s.template_id = t.id
       LEFT JOIN users u ON s.reviewed_by = u.id
       WHERE s.spreadsheet_config_id = ?
       ORDER BY s.created_at DESC`,
        [configId],
      );

      // Parse score_data JSON
      scores.forEach((score) => {
        score.score_data = JSON.parse(score.score_data);
      });

      res.json(scores);
    } catch (error) {
      console.error('Error fetching scores:', error);
      res.status(500).json({ error: 'Failed to fetch scores' });
    }
  },
);

// Accept a score and submit to sheet
router.post(
  '/:id/accept',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const score = await db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [id],
      );
      if (!score) {
        return res.status(404).json({ error: 'Score not found' });
      }

      // Get config and owner info
      const config = await db.get(
        'SELECT sc.*, u.id as owner_id FROM spreadsheet_configs sc JOIN users u ON sc.user_id = u.id WHERE sc.id = ?',
        [score.spreadsheet_config_id],
      );

      if (!config) {
        return res
          .status(400)
          .json({ error: 'Spreadsheet configuration not found' });
      }

      // Get a valid (possibly refreshed) access token for the sheet owner
      let accessToken: string;
      try {
        accessToken = await getValidAccessToken(config.owner_id);
      } catch (tokenError: any) {
        return res.status(401).json({
          error:
            tokenError.message ||
            'Token refresh failed. Admin needs to re-authenticate.',
          needsReauth: true,
        });
      }

      // Parse score data
      const scoreData = JSON.parse(score.score_data);

      // Check if this is a head-to-head score
      const isHeadToHead = scoreData._isHeadToHead?.value === true;

      // Helper function to execute API call with retry on 401
      const executeWithRetry = async <T>(
        apiCall: (token: string) => Promise<T>,
      ): Promise<T> => {
        try {
          return await apiCall(accessToken);
        } catch (apiError: any) {
          const status =
            apiError?.code || apiError?.status || apiError?.response?.status;
          if (status === 401) {
            accessToken = await forceRefreshToken(config.owner_id);
            return await apiCall(accessToken);
          }
          throw apiError;
        }
      };

      try {
        if (isHeadToHead) {
          // Head-to-head mode: Write winner to bracket
          const gameNumber = scoreData.game_number?.value;
          const winnerTeamNumber = scoreData.winner_team_number?.value;
          const winnerDisplay = scoreData.winner_display?.value;

          if (!gameNumber || !winnerTeamNumber || !winnerDisplay) {
            return res.status(400).json({
              error:
                'Head-to-head score must have game number, winner team number, and winner display name',
            });
          }

          await executeWithRetry((token) =>
            writeWinnerToBracket(
              token,
              config.spreadsheet_id,
              config.sheet_name,
              parseInt(gameNumber, 10),
              winnerTeamNumber,
              winnerDisplay,
            ),
          );
        } else {
          // Standard seeding mode: Update team score
          const teamNumber = scoreData.team_number?.value;
          const round = scoreData.round?.value;
          const grandTotal = scoreData.grand_total?.value;

          if (!teamNumber || !round || grandTotal === undefined) {
            return res.status(400).json({
              error: 'Score must have team number, round, and total score',
            });
          }

          await executeWithRetry((token) =>
            updateTeamScore(
              token,
              config.spreadsheet_id,
              config.sheet_name,
              teamNumber,
              round,
              grandTotal,
            ),
          );
        }

        // Update status
        await db.run(
          `UPDATE score_submissions 
         SET status = 'accepted', submitted_to_sheet = true, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
          [req.user.id, id],
        );

        res.json({ success: true });
      } catch (sheetError: any) {
        console.error('Error submitting to sheet:', sheetError);
        res.status(500).json({
          error: sheetError.message || 'Failed to submit to spreadsheet',
        });
      }
    } catch (error) {
      console.error('Error accepting score:', error);
      res.status(500).json({ error: 'Failed to accept score' });
    }
  },
);

// Reject a score
router.post(
  '/:id/reject',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      await db.run(
        `UPDATE score_submissions 
       SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
        [req.user.id, id],
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error rejecting score:', error);
      res.status(500).json({ error: 'Failed to reject score' });
    }
  },
);

// Revert a score (undo accept/reject)
router.post(
  '/:id/revert',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const score = await db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [id],
      );
      if (!score) {
        return res.status(404).json({ error: 'Score not found' });
      }

      // If the score was accepted (submitted to sheet), clear the cell
      if (score.status === 'accepted' && score.submitted_to_sheet) {
        const config = await db.get(
          'SELECT sc.*, u.id as owner_id FROM spreadsheet_configs sc JOIN users u ON sc.user_id = u.id WHERE sc.id = ?',
          [score.spreadsheet_config_id],
        );

        if (config) {
          // Get a valid (possibly refreshed) access token
          let accessToken: string;
          try {
            accessToken = await getValidAccessToken(config.owner_id);
          } catch (tokenError: any) {
            return res.status(401).json({
              error:
                tokenError.message ||
                'Token refresh failed. Admin needs to re-authenticate.',
              needsReauth: true,
            });
          }

          const scoreData = JSON.parse(score.score_data);

          // Check if this is a head-to-head score
          const isHeadToHead = scoreData._isHeadToHead?.value === true;

          // Helper function to execute API call with retry on 401
          const executeWithRetry = async <T>(
            apiCall: (token: string) => Promise<T>,
          ): Promise<T> => {
            try {
              return await apiCall(accessToken);
            } catch (apiError: any) {
              const status =
                apiError?.code ||
                apiError?.status ||
                apiError?.response?.status;
              if (status === 401) {
                accessToken = await forceRefreshToken(config.owner_id);
                return await apiCall(accessToken);
              }
              throw apiError;
            }
          };

          try {
            if (isHeadToHead) {
              // Head-to-head mode: Clear winner from bracket
              const gameNumber = scoreData.game_number?.value;

              if (gameNumber) {
                await executeWithRetry((token) =>
                  clearWinnerFromBracket(
                    token,
                    config.spreadsheet_id,
                    config.sheet_name,
                    parseInt(gameNumber, 10),
                  ),
                );
                console.log(
                  `Cleared winner for Game ${gameNumber} from bracket`,
                );
              }
            } else {
              // Standard seeding mode: Clear the team's score cell
              const teamNumber = scoreData.team_number?.value;
              const round = scoreData.round?.value;

              if (teamNumber && round) {
                await executeWithRetry((token) =>
                  updateTeamScore(
                    token,
                    config.spreadsheet_id,
                    config.sheet_name,
                    teamNumber,
                    round,
                    '', // Empty value to clear the cell
                  ),
                );
                console.log(
                  `Cleared score for Team ${teamNumber} Round ${round}`,
                );
              }
            }
          } catch (sheetError) {
            console.error('Error clearing cell in sheet:', sheetError);
            // Continue anyway to update the database status
          }
        }
      }

      await db.run(
        `UPDATE score_submissions 
       SET status = 'pending', submitted_to_sheet = false, reviewed_by = NULL, reviewed_at = NULL
       WHERE id = ?`,
        [id],
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error reverting score:', error);
      res.status(500).json({ error: 'Failed to revert score' });
    }
  },
);

// Update a score
router.put(
  '/:id',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const { scoreData } = req.body;
      const db = await getDatabase();

      await db.run(
        `UPDATE score_submissions 
       SET score_data = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
        [JSON.stringify(scoreData), id],
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating score:', error);
      res.status(500).json({ error: 'Failed to update score' });
    }
  },
);

// Delete a score
router.delete(
  '/:id',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      await db.run('DELETE FROM score_submissions WHERE id = ?', [id]);

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting score:', error);
      res.status(500).json({ error: 'Failed to delete score' });
    }
  },
);

export default router;
