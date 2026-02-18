import express from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { createAuditEntry } from './audit';
import { toAuditJson } from '../utils/auditJson';

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
        game_queue_id,
        bracket_game_id,
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

      // DB-backed (event-scoped) submission: resolve team_id if needed (seeding)
      const attemptingDbBackedSeeding = eventId && scoreType === 'seeding';
      let resolvedTeamId = scoreData.team_id?.value;
      if (
        attemptingDbBackedSeeding &&
        !resolvedTeamId &&
        scoreData.team_number?.value
      ) {
        const team = await db.get(
          'SELECT id FROM teams WHERE event_id = ? AND team_number = ?',
          [eventId, scoreData.team_number.value],
        );
        resolvedTeamId = team?.id;
      }
      const isDbBackedSeeding = attemptingDbBackedSeeding && resolvedTeamId;

      // DB-backed bracket submission: validate bracket_game_id belongs to event
      const attemptingDbBackedBracket =
        eventId && scoreType === 'bracket' && bracket_game_id != null;
      let isDbBackedBracket = false;
      if (attemptingDbBackedBracket) {
        const event = await db.get('SELECT id FROM events WHERE id = ?', [
          eventId,
        ]);
        if (!event) {
          return res.status(400).json({ error: 'Invalid event' });
        }
        const game = await db.get(
          `SELECT bg.id FROM bracket_games bg
           JOIN brackets b ON bg.bracket_id = b.id
           WHERE bg.id = ? AND b.event_id = ?`,
          [bracket_game_id, eventId],
        );
        if (!game) {
          return res.status(400).json({
            error: 'Bracket game not found or does not belong to this event',
          });
        }
        isDbBackedBracket = true;
      }

      if (eventId && scoreType === 'bracket' && bracket_game_id == null) {
        return res.status(400).json({
          error: 'bracket_game_id is required for DB-backed bracket submission',
        });
      }

      const isDbBacked = isDbBackedSeeding || isDbBackedBracket;

      const spreadsheetConfigId: number | null = null;

      if (attemptingDbBackedSeeding) {
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

      if (!isDbBacked) {
        return res.status(400).json({
          error:
            'Event-scoped submission is required. Provide eventId and scoreType (seeding or bracket) with bracket_game_id for bracket scores.',
        });
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
       (user_id, template_id, spreadsheet_config_id, participant_name, match_id, score_data, event_id, score_type, game_queue_id, bracket_game_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          null,
          templateId,
          spreadsheetConfigId,
          participantName,
          matchId,
          JSON.stringify(enrichedScoreData),
          isDbBacked ? eventId : null,
          isDbBacked ? scoreType : null,
          game_queue_id ?? null,
          isDbBackedBracket ? bracket_game_id : null,
        ],
      );

      const submission = await db.get(
        'SELECT * FROM score_submissions WHERE id = ?',
        [result.lastID],
      );

      // Audit event-scoped submissions only (skip legacy spreadsheet path)
      if (isDbBacked && submission) {
        await createAuditEntry(db, {
          event_id: eventId,
          user_id: null,
          action: 'score_submitted',
          entity_type: 'score_submission',
          entity_id: submission.id,
          old_value: null,
          new_value: toAuditJson({
            id: submission.id,
            event_id: submission.event_id,
            score_type: submission.score_type,
            status: submission.status,
            score_data: submission.score_data,
          }),
          ip_address: req.ip ?? null,
        });
      }

      res.json(submission);
    } catch (error) {
      console.error('Error submitting score:', error);
      res.status(500).json({ error: 'Failed to submit score' });
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
