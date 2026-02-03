import express, { Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

// Allowed fields for PATCH updates
const ALLOWED_UPDATE_FIELDS = [
  'team_number',
  'team_name',
  'display_name',
  'status',
];

// GET /teams/event/:eventId - List teams for event (public for judges)
router.get('/event/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { status } = req.query;
    const db = await getDatabase();

    let query = 'SELECT * FROM teams WHERE event_id = ?';
    const params: (string | number)[] = [eventId];

    if (status) {
      query += ' AND status = ?';
      params.push(status as string);
    }

    query += ' ORDER BY team_number ASC';

    const teams = await db.all(query, params);
    res.json(teams);
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

// GET /teams/:id - Get single team (public for judges)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    const team = await db.get('SELECT * FROM teams WHERE id = ?', [id]);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    res.json(team);
  } catch (error) {
    console.error('Error fetching team:', error);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

// POST /teams - Create team
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { event_id, team_number, team_name, display_name, status } = req.body;

    if (!event_id || !team_number || !team_name) {
      return res
        .status(400)
        .json({ error: 'event_id, team_number, and team_name are required' });
    }

    const db = await getDatabase();

    const result = await db.run(
      `INSERT INTO teams (event_id, team_number, team_name, display_name, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        event_id,
        team_number,
        team_name,
        display_name || `${team_number} ${team_name}`,
        status || 'registered',
      ],
    );

    const team = await db.get('SELECT * FROM teams WHERE id = ?', [
      result.lastID,
    ]);
    res.status(201).json(team);
  } catch (error) {
    console.error('Error creating team:', error);
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('UNIQUE constraint failed')) {
      return res
        .status(409)
        .json({ error: 'Team number already exists for this event' });
    }
    if (errMsg.includes('CHECK constraint failed')) {
      return res.status(400).json({ error: 'Invalid team_number or status' });
    }
    if (errMsg.includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json({ error: 'Event does not exist' });
    }
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// POST /teams/bulk - Bulk create teams
router.post('/bulk', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { event_id, teams } = req.body;

    if (!event_id || !Array.isArray(teams) || teams.length === 0) {
      return res
        .status(400)
        .json({ error: 'event_id and teams array are required' });
    }

    const db = await getDatabase();

    // Verify event exists
    const event = await db.get('SELECT id FROM events WHERE id = ?', [
      event_id,
    ]);
    if (!event) {
      return res.status(400).json({ error: 'Event does not exist' });
    }

    const errors: { index: number; error: string }[] = [];

    // Phase 1: Pre-validate all teams in the payload
    const validTeams: {
      index: number;
      team_number: number;
      team_name: string;
      display_name: string;
      status: string;
    }[] = [];
    const teamNumbersInPayload = new Set<number>();

    for (let i = 0; i < teams.length; i++) {
      const { team_number, team_name, display_name, status } = teams[i];

      if (!team_number || !team_name) {
        errors.push({
          index: i,
          error: 'team_number and team_name are required',
        });
        continue;
      }

      // Check for duplicates within the payload itself
      if (teamNumbersInPayload.has(team_number)) {
        errors.push({
          index: i,
          error: `Duplicate team number ${team_number} in payload`,
        });
        continue;
      }
      teamNumbersInPayload.add(team_number);

      validTeams.push({
        index: i,
        team_number,
        team_name,
        display_name: display_name || `${team_number} ${team_name}`,
        status: status || 'registered',
      });
    }

    // Phase 2: Check for existing team numbers in the database
    if (validTeams.length > 0) {
      const existingTeams = await db.all<{ team_number: number }>(
        `SELECT team_number FROM teams WHERE event_id = ? AND team_number IN (${validTeams.map(() => '?').join(',')})`,
        [event_id, ...validTeams.map((t) => t.team_number)],
      );
      const existingNumbers = new Set(existingTeams.map((t) => t.team_number));

      // Filter out teams that already exist
      const teamsToInsert = validTeams.filter((t) => {
        if (existingNumbers.has(t.team_number)) {
          errors.push({
            index: t.index,
            error: `Team number ${t.team_number} already exists`,
          });
          return false;
        }
        return true;
      });

      // Phase 3: Insert all valid teams in a single transaction
      if (teamsToInsert.length > 0) {
        await db.transaction((tx) => {
          for (const team of teamsToInsert) {
            tx.run(
              `INSERT INTO teams (event_id, team_number, team_name, display_name, status)
               VALUES (?, ?, ?, ?, ?)`,
              [
                event_id,
                team.team_number,
                team.team_name,
                team.display_name,
                team.status,
              ],
            );
          }
        });
      }

      res.status(201).json({
        created: teamsToInsert.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } else {
      res.status(201).json({
        created: 0,
        errors: errors.length > 0 ? errors : undefined,
      });
    }
  } catch (error) {
    console.error('Error bulk creating teams:', error);
    res.status(500).json({ error: 'Failed to bulk create teams' });
  }
});

// PATCH /teams/:id - Update team
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    // Filter to only allowed fields
    const updates = Object.entries(req.body).filter(([key]) =>
      ALLOWED_UPDATE_FIELDS.includes(key),
    );

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
    const values = updates.map(([, value]) => value);

    const result = await db.run(`UPDATE teams SET ${setClause} WHERE id = ?`, [
      ...values,
      id,
    ]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const team = await db.get('SELECT * FROM teams WHERE id = ?', [id]);
    res.json(team);
  } catch (error) {
    console.error('Error updating team:', error);
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('UNIQUE constraint failed')) {
      return res
        .status(409)
        .json({ error: 'Team number already exists for this event' });
    }
    if (errMsg.includes('CHECK constraint failed')) {
      return res.status(400).json({ error: 'Invalid team_number or status' });
    }
    res.status(500).json({ error: 'Failed to update team' });
  }
});

// PATCH /teams/:id/check-in - Check in team
router.patch(
  '/:id/check-in',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const result = await db.run(
        `UPDATE teams SET status = 'checked_in', checked_in_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id],
      );

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Team not found' });
      }

      const team = await db.get('SELECT * FROM teams WHERE id = ?', [id]);
      res.json(team);
    } catch (error) {
      console.error('Error checking in team:', error);
      res.status(500).json({ error: 'Failed to check in team' });
    }
  },
);

// PATCH /teams/event/:eventId/check-in/bulk - Bulk check in teams by team numbers
router.patch(
  '/event/:eventId/check-in/bulk',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const { team_numbers } = req.body;

      if (!Array.isArray(team_numbers) || team_numbers.length === 0) {
        return res
          .status(400)
          .json({ error: 'team_numbers array is required' });
      }

      const db = await getDatabase();

      // Verify event exists
      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventId,
      ]);
      if (!event) {
        return res.status(400).json({ error: 'Event does not exist' });
      }

      // Find which team numbers exist for this event
      const existingTeams = await db.all<{ id: number; team_number: number }>(
        `SELECT id, team_number FROM teams WHERE event_id = ? AND team_number IN (${team_numbers.map(() => '?').join(',')})`,
        [eventId, ...team_numbers],
      );

      const existingNumbers = new Set(existingTeams.map((t) => t.team_number));
      const notFound = team_numbers.filter(
        (n: number) => !existingNumbers.has(n),
      );

      // Update all found teams in a single transaction
      if (existingTeams.length > 0) {
        await db.transaction((tx) => {
          for (const team of existingTeams) {
            tx.run(
              `UPDATE teams SET status = 'checked_in', checked_in_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [team.id],
            );
          }
        });
      }

      res.json({
        updated: existingTeams.length,
        not_found: notFound.length > 0 ? notFound : undefined,
      });
    } catch (error) {
      console.error('Error bulk checking in teams:', error);
      res.status(500).json({ error: 'Failed to bulk check in teams' });
    }
  },
);

// DELETE /teams/:id - Delete team
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    // DELETE is idempotent - return 204 regardless of whether row existed
    await db.run('DELETE FROM teams WHERE id = ?', [id]);

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting team:', error);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

export default router;
