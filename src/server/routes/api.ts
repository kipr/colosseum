import express, { Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { submitScoreToSheet, getParticipants, getMatches } from '../services/googleSheets';

const router = express.Router();

// Submit a score (public - for judges without login)
router.post('/scores/submit', async (req: express.Request, res: express.Response) => {
  try {
    const { templateId, participantName, matchId, scoreData, judgeToken } = req.body;

    if (!templateId || !scoreData) {
      return res.status(400).json({ error: 'Template ID and score data are required' });
    }

    const db = await getDatabase();
    
    // Get the template to find who created it
    const template = await db.get(
      'SELECT created_by FROM scoresheet_templates WHERE id = ?',
      [templateId]
    );
    
    if (!template || !template.created_by) {
      return res.status(400).json({ error: 'Template not found or has no owner' });
    }

    // Get active spreadsheet config for the template owner
    const config = await db.get(
      'SELECT * FROM spreadsheet_configs WHERE user_id = ? AND is_active = 1',
      [template.created_by]
    );

    if (!config) {
      return res.status(400).json({ error: 'No active spreadsheet configuration found' });
    }

    // Get the owner's access token
    const owner = await db.get(
      'SELECT access_token FROM users WHERE id = ?',
      [template.created_by]
    );

    // Save to database (use null for user_id since judge isn't logged in)
    const result = await db.run(
      `INSERT INTO score_submissions 
       (user_id, template_id, spreadsheet_config_id, participant_name, match_id, score_data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [null, templateId, config.id, participantName, matchId, JSON.stringify(scoreData)]
    );

    // Submit to Google Sheets using owner's token
    try {
      await submitScoreToSheet(
        owner.access_token,
        config.spreadsheet_id,
        config.sheet_name,
        scoreData
      );

      // Mark as submitted
      await db.run(
        'UPDATE score_submissions SET submitted_to_sheet = 1 WHERE id = ?',
        [result.lastID]
      );
    } catch (sheetError) {
      console.error('Error submitting to sheet:', sheetError);
      // Score saved locally but not to sheet
    }

    const submission = await db.get('SELECT * FROM score_submissions WHERE id = ?', [result.lastID]);
    res.json(submission);
  } catch (error) {
    console.error('Error submitting score:', error);
    res.status(500).json({ error: 'Failed to submit score' });
  }
});

// Get participants from spreadsheet
router.get('/participants', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const db = await getDatabase();
    const config = await db.get(
      'SELECT * FROM spreadsheet_configs WHERE user_id = ? AND is_active = 1',
      [req.user.id]
    );

    if (!config) {
      return res.status(400).json({ error: 'No active spreadsheet configuration found' });
    }

    const participants = await getParticipants(
      req.user.access_token,
      config.spreadsheet_id,
      config.sheet_name
    );

    res.json(participants);
  } catch (error) {
    console.error('Error fetching participants:', error);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

// Get matches from spreadsheet
router.get('/matches', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const db = await getDatabase();
    const config = await db.get(
      'SELECT * FROM spreadsheet_configs WHERE user_id = ? AND is_active = 1',
      [req.user.id]
    );

    if (!config) {
      return res.status(400).json({ error: 'No active spreadsheet configuration found' });
    }

    const matches = await getMatches(
      req.user.access_token,
      config.spreadsheet_id,
      config.sheet_name
    );

    res.json(matches);
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

// Get user's score history
router.get('/scores/history', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const db = await getDatabase();
    const scores = await db.all(
      `SELECT s.*, t.name as template_name 
       FROM score_submissions s
       JOIN scoresheet_templates t ON s.template_id = t.id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    // Parse score_data JSON
    scores.forEach(score => {
      score.score_data = JSON.parse(score.score_data);
    });

    res.json(scores);
  } catch (error) {
    console.error('Error fetching score history:', error);
    res.status(500).json({ error: 'Failed to fetch score history' });
  }
});

export default router;

