import express from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { getParticipants, getMatches } from '../services/googleSheets';

const router = express.Router();

// Submit a score (public - for judges without login)
router.post(
  '/scores/submit',
  async (req: express.Request, res: express.Response) => {
    try {
      const {
        templateId,
        participantName,
        matchId,
        scoreData,
        isHeadToHead,
        bracketSource,
        eventId,
        scoreType,
      } = req.body;

      if (!templateId || !scoreData) {
        return res
          .status(400)
          .json({ error: 'Template ID and score data are required' });
      }

      const db = await getDatabase();

      // Get the template
      const template = await db.get(
        'SELECT id, name, created_by, spreadsheet_config_id FROM scoresheet_templates WHERE id = ?',
        [templateId],
      );

      if (!template) {
        return res.status(400).json({ error: 'Template not found' });
      }

      // DB-backed (event-scoped) submission: resolve team_id if needed
      const attemptingDbBacked = eventId && scoreType === 'seeding';
      let resolvedTeamId = scoreData.team_id?.value;
      if (
        attemptingDbBacked &&
        !resolvedTeamId &&
        scoreData.team_number?.value
      ) {
        const team = await db.get(
          'SELECT id FROM teams WHERE event_id = ? AND team_number = ?',
          [eventId, scoreData.team_number.value],
        );
        resolvedTeamId = team?.id;
      }
      const isDbBacked = attemptingDbBacked && resolvedTeamId;

      let spreadsheetConfigId: number | null = null;

      if (attemptingDbBacked) {
        const event = await db.get('SELECT id FROM events WHERE id = ?', [
          eventId,
        ]);
        if (!event) {
          return res.status(400).json({ error: 'Invalid event' });
        }
        if (!resolvedTeamId) {
          return res
            .status(400)
            .json({ error: 'Team not found for event. Check team number.' });
        }
      }

      if (isDbBacked) {
        // Scores go to seeding_scores table; no spreadsheet
      } else {
        // Legacy: spreadsheet-based submission
        if (!template.created_by) {
          return res
            .status(400)
            .json({ error: 'Template has no owner for spreadsheet config' });
        }

        let config;
        if (template.spreadsheet_config_id) {
          config = await db.get(
            'SELECT * FROM spreadsheet_configs WHERE id = ?',
            [template.spreadsheet_config_id],
          );
          if (!config || !config.is_active) {
            return res.status(400).json({
              error: config
                ? 'The sheet linked to this score sheet is not active.'
                : 'The sheet linked to this score sheet no longer exists.',
            });
          }
        } else {
          if (isHeadToHead && bracketSource) {
            config = await db.get(
              `SELECT * FROM spreadsheet_configs 
             WHERE user_id = ? AND is_active IS TRUE AND sheet_purpose = 'bracket'
             LIMIT 1`,
              [template.created_by],
            );
          } else {
            config = await db.get(
              `SELECT * FROM spreadsheet_configs 
             WHERE user_id = ? AND is_active IS TRUE AND sheet_purpose = 'scores'
             LIMIT 1`,
              [template.created_by],
            );
          }
          if (!config) {
            return res
              .status(400)
              .json({ error: 'No active spreadsheet configuration found' });
          }
        }
        spreadsheetConfigId = config.id;
      }

      // Add metadata to score data for head-to-head
      const enrichedScoreData: Record<string, unknown> = {
        ...scoreData,
        _isHeadToHead: { value: isHeadToHead || false, type: 'boolean' },
        _bracketSource: { value: bracketSource || null, type: 'object' },
      };
      if (isDbBacked && resolvedTeamId) {
        enrichedScoreData.team_id = {
          label: 'Team ID',
          value: resolvedTeamId,
          type: 'number',
        };
      }

      // Build insert - event-scoped uses null for spreadsheet_config_id
      const result = await db.run(
        `INSERT INTO score_submissions 
       (user_id, template_id, spreadsheet_config_id, participant_name, match_id, score_data, event_id, score_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          null,
          templateId,
          spreadsheetConfigId,
          participantName,
          matchId,
          JSON.stringify(enrichedScoreData),
          isDbBacked ? eventId : null,
          isDbBacked ? scoreType : null,
        ],
      );

      const submission = await db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [result.lastID],
      );
      res.json(submission);
    } catch (error) {
      console.error('Error submitting score:', error);
      res.status(500).json({ error: 'Failed to submit score' });
    }
  },
);

// Get participants from spreadsheet
router.get(
  '/participants',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const db = await getDatabase();
      const config = await db.get(
        'SELECT * FROM spreadsheet_configs WHERE user_id = ? AND is_active IS TRUE',
        [req.user.id],
      );

      if (!config) {
        return res
          .status(400)
          .json({ error: 'No active spreadsheet configuration found' });
      }

      const participants = await getParticipants(
        req.user.access_token,
        config.spreadsheet_id,
        config.sheet_name,
      );

      res.json(participants);
    } catch (error) {
      console.error('Error fetching participants:', error);
      res.status(500).json({ error: 'Failed to fetch participants' });
    }
  },
);

// Get matches from spreadsheet
router.get(
  '/matches',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const db = await getDatabase();
      const config = await db.get(
        'SELECT * FROM spreadsheet_configs WHERE user_id = ? AND is_active IS TRUE',
        [req.user.id],
      );

      if (!config) {
        return res
          .status(400)
          .json({ error: 'No active spreadsheet configuration found' });
      }

      const matches = await getMatches(
        req.user.access_token,
        config.spreadsheet_id,
        config.sheet_name,
      );

      res.json(matches);
    } catch (error) {
      console.error('Error fetching matches:', error);
      res.status(500).json({ error: 'Failed to fetch matches' });
    }
  },
);

// Get user's score history
router.get(
  '/scores/history',
  requireAuth,
  async (req: AuthRequest, res: express.Response) => {
    try {
      const db = await getDatabase();
      const scores = await db.all(
        `SELECT s.*, t.name as template_name 
       FROM score_submissions s
       JOIN scoresheet_templates t ON s.template_id = t.id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC
       LIMIT 50`,
        [req.user.id],
      );

      // Parse score_data JSON
      scores.forEach((score) => {
        score.score_data = JSON.parse(score.score_data);
      });

      res.json(scores);
    } catch (error) {
      console.error('Error fetching score history:', error);
      res.status(500).json({ error: 'Failed to fetch score history' });
    }
  },
);

export default router;
