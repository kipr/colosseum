import express, { Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { listTeams } from '../usecases/listTeams';
import { getTeam } from '../usecases/getTeam';
import { createTeam } from '../usecases/createTeam';
import { bulkCreateTeams } from '../usecases/bulkCreateTeams';
import { updateTeam } from '../usecases/updateTeam';
import { checkInTeam } from '../usecases/checkInTeam';
import { bulkCheckInTeams } from '../usecases/bulkCheckInTeams';
import { deleteTeam } from '../usecases/deleteTeam';

const router = express.Router();

// GET /teams/event/:eventId - List teams for event (public; blocked for archived events)
router.get('/event/:eventId', async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { status } = req.query;
    const result = await listTeams({
      db,
      eventId: req.params.eventId,
      status: typeof status === 'string' ? status : undefined,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json(result.teams);
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

// GET /teams/:id - Get single team (public for judges)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await getTeam({ db, teamId: req.params.id });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json(result.team);
  } catch (error) {
    console.error('Error fetching team:', error);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

// POST /teams - Create team
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await createTeam({
      db,
      body: req.body,
      userId: req.user?.id ?? null,
      ipAddress: req.ip ?? null,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(201).json(result.team);
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// POST /teams/bulk - Bulk create teams
router.post('/bulk', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await bulkCreateTeams({
      db,
      body: req.body,
      userId: req.user?.id ?? null,
      ipAddress: req.ip ?? null,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.status(201).json({ created: result.created, errors: result.errors });
  } catch (error) {
    console.error('Error bulk creating teams:', error);
    res.status(500).json({ error: 'Failed to bulk create teams' });
  }
});

// PATCH /teams/:id - Update team
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    const result = await updateTeam({
      db,
      teamId: req.params.id,
      body: req.body,
      userId: req.user?.id ?? null,
      ipAddress: req.ip ?? null,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json(result.team);
  } catch (error) {
    console.error('Error updating team:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

// PATCH /teams/:id/check-in - Check in team
router.patch(
  '/:id/check-in',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const db = await getDatabase();
      const result = await checkInTeam({
        db,
        teamId: req.params.id,
        userId: req.user?.id ?? null,
        ipAddress: req.ip ?? null,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      res.json(result.team);
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
      const db = await getDatabase();
      const result = await bulkCheckInTeams({
        db,
        eventId: req.params.eventId,
        body: req.body,
        userId: req.user?.id ?? null,
        ipAddress: req.ip ?? null,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      res.json({ updated: result.updated, not_found: result.not_found });
    } catch (error) {
      console.error('Error bulk checking in teams:', error);
      res.status(500).json({ error: 'Failed to bulk check in teams' });
    }
  },
);

// DELETE /teams/:id - Delete team
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = await getDatabase();
    await deleteTeam({
      db,
      teamId: req.params.id,
      userId: req.user?.id ?? null,
      ipAddress: req.ip ?? null,
    });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting team:', error);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

export default router;
