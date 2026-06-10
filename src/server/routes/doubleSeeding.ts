import express, { Request, Response } from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import {
  appendDoubleSeedingRounds,
  deleteLastDoubleSeedingRound,
  generateDoubleSeedingMatches,
  hasDoubleSeedingResults,
} from '../services/doubleSeedingMatches';
import { recalculateDoubleSeedingRankings } from '../services/doubleSeedingRankings';
import { isEventArchived } from '../utils/eventVisibility';
import { createAuditEntry } from './audit';
import { toAuditJson } from '../utils/auditJson';

const router = express.Router();

const MATCHES_SELECT = `
  SELECT dsm.*,
         t1.team_number as team1_number, t1.team_name as team1_name, t1.display_name as team1_display,
         t2.team_number as team2_number, t2.team_name as team2_name, t2.display_name as team2_display
  FROM double_seeding_matches dsm
  LEFT JOIN teams t1 ON dsm.team1_id = t1.id
  LEFT JOIN teams t2 ON dsm.team2_id = t2.id
`;

// GET /double-seeding/matches/event/:eventId - Matches for event (public; blocked for archived events)
router.get('/matches/event/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    if (await isEventArchived(eventId)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const db = await getDatabase();

    const matches = await db.all(
      `${MATCHES_SELECT}
       WHERE dsm.event_id = ?
       ORDER BY dsm.round_number ASC, dsm.match_number ASC`,
      [eventId],
    );

    res.json(matches);
  } catch (error) {
    console.error('Error fetching double-seeding matches:', error);
    res.status(500).json({ error: 'Failed to fetch double-seeding matches' });
  }
});

// POST /double-seeding/matches/generate/:eventId - Generate randomized matches (admin only)
router.post(
  '/matches/generate/:eventId',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const { rounds } = req.body as {
        rounds?: number;
      };
      const eventIdNum = parseInt(eventId, 10);
      const db = await getDatabase();

      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventIdNum,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const roundsNum = Number(rounds ?? 5);
      if (!Number.isInteger(roundsNum) || roundsNum < 0) {
        return res
          .status(400)
          .json({ error: 'rounds must be a non-negative integer' });
      }

      const roundState = await db.get<{
        current_rounds: number | null;
        match_count: number;
      }>(
        `SELECT MAX(round_number) as current_rounds, COUNT(*) as match_count
         FROM double_seeding_matches
         WHERE event_id = ?`,
        [eventIdNum],
      );
      const currentRounds = Number(roundState?.current_rounds ?? 0);
      const matchCount = Number(roundState?.match_count ?? 0);
      const teamCountRow = await db.get<{ team_count: number }>(
        'SELECT COUNT(*) as team_count FROM teams WHERE event_id = ?',
        [eventIdNum],
      );
      const teamCount = Number(teamCountRow?.team_count ?? 0);
      const hasResults = await hasDoubleSeedingResults(db, eventIdNum);

      if (roundsNum > teamCount) {
        return res.status(400).json({
          error: `Number of rounds (${roundsNum}) cannot exceed the number of teams (${teamCount})`,
        });
      }

      if (roundsNum === 0) {
        if (hasResults) {
          return res.status(409).json({
            error:
              'Double-seeding submissions or scores already exist for this event. Double seeding cannot be disabled.',
          });
        }

        const result = await db.transaction(async (tx) => {
          const del = await tx.run(
            'DELETE FROM double_seeding_matches WHERE event_id = ?',
            [eventIdNum],
          );
          await tx.run(
            'UPDATE events SET double_seeding_rounds = 0 WHERE id = ?',
            [eventIdNum],
          );
          return del;
        });

        await createAuditEntry(db, {
          event_id: eventIdNum,
          user_id: req.user?.id ?? null,
          action: 'double_seeding_disabled',
          entity_type: 'event',
          entity_id: eventIdNum,
          old_value: toAuditJson({ deleted: result.changes ?? 0 }),
          new_value: toAuditJson({ rounds: 0 }),
          ip_address: req.ip ?? null,
        });

        return res.json({
          message: 'Double seeding disabled',
          rounds: 0,
          matchesCreated: 0,
          deleted: result.changes ?? 0,
          matches: [],
        });
      }

      if (teamCount === 0) {
        return res
          .status(400)
          .json({ error: 'No teams available for double seeding' });
      }

      if (matchCount > 0 && roundsNum < currentRounds) {
        return res.status(409).json({
          error:
            'Double-seeding rounds can only be reduced by deleting the highest-numbered unsubmitted round.',
        });
      }

      if (matchCount > 0 && roundsNum === currentRounds) {
        const matches = await db.all(
          `${MATCHES_SELECT}
           WHERE dsm.event_id = ?
           ORDER BY dsm.round_number ASC, dsm.match_number ASC`,
          [eventIdNum],
        );

        return res.json({
          message: 'Double-seeding round count unchanged',
          rounds: currentRounds,
          matchesCreated: 0,
          matches,
        });
      }

      let result;
      try {
        result =
          matchCount > 0
            ? await appendDoubleSeedingRounds(db, eventIdNum, roundsNum)
            : await generateDoubleSeedingMatches(db, eventIdNum, roundsNum);
      } catch (genError) {
        return res.status(400).json({ error: (genError as Error).message });
      }

      await createAuditEntry(db, {
        event_id: eventIdNum,
        user_id: req.user?.id ?? null,
        action:
          matchCount > 0
            ? 'double_seeding_rounds_appended'
            : 'double_seeding_matches_generated',
        entity_type: 'event',
        entity_id: eventIdNum,
        old_value: null,
        new_value: toAuditJson(result),
        ip_address: req.ip ?? null,
      });

      const matches = await db.all(
        `${MATCHES_SELECT}
         WHERE dsm.event_id = ?
         ORDER BY dsm.round_number ASC, dsm.match_number ASC`,
        [eventIdNum],
      );

      res.status(201).json({
        message:
          matchCount > 0
            ? 'Double-seeding rounds appended'
            : 'Double-seeding matches generated',
        ...result,
        matches,
      });
    } catch (error) {
      console.error('Error generating double-seeding matches:', error);
      res
        .status(500)
        .json({ error: 'Failed to generate double-seeding matches' });
    }
  },
);

// DELETE /double-seeding/matches/event/:eventId - Delete all matches for event (admin only)
router.delete(
  '/matches/event/:eventId',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const eventIdNum = parseInt(eventId, 10);
      const db = await getDatabase();

      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventIdNum,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      if (await hasDoubleSeedingResults(db, eventIdNum)) {
        return res.status(409).json({
          error:
            'Double-seeding submissions or scores already exist for this event. Matches cannot be deleted.',
        });
      }

      // game_queue rows cascade via double_seeding_match_id FK.
      const result = await db.transaction(async (tx) => {
        const del = await tx.run(
          'DELETE FROM double_seeding_matches WHERE event_id = ?',
          [eventIdNum],
        );
        await tx.run(
          'UPDATE events SET double_seeding_rounds = 0 WHERE id = ?',
          [eventIdNum],
        );
        return del;
      });

      await createAuditEntry(db, {
        event_id: eventIdNum,
        user_id: req.user?.id ?? null,
        action: 'double_seeding_matches_deleted',
        entity_type: 'event',
        entity_id: eventIdNum,
        old_value: toAuditJson({ deleted: result.changes ?? 0 }),
        new_value: null,
        ip_address: req.ip ?? null,
      });

      res.json({ success: true, deleted: result.changes ?? 0 });
    } catch (error) {
      console.error('Error deleting double-seeding matches:', error);
      res
        .status(500)
        .json({ error: 'Failed to delete double-seeding matches' });
    }
  },
);

// DELETE /double-seeding/matches/event/:eventId/round/:roundNumber - Delete the trailing unsubmitted round (admin only)
router.delete(
  '/matches/event/:eventId/round/:roundNumber',
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId, roundNumber } = req.params;
      const eventIdNum = parseInt(eventId, 10);
      const roundNum = parseInt(roundNumber, 10);

      if (isNaN(eventIdNum) || isNaN(roundNum) || roundNum < 1) {
        return res.status(400).json({ error: 'Invalid event ID or round' });
      }

      const db = await getDatabase();
      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        eventIdNum,
      ]);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      let result;
      try {
        result = await deleteLastDoubleSeedingRound(db, eventIdNum, roundNum);
      } catch (deleteError) {
        const message = (deleteError as Error).message;
        const status = message.includes('No double-seeding rounds') ? 404 : 409;
        return res.status(status).json({ error: message });
      }

      await createAuditEntry(db, {
        event_id: eventIdNum,
        user_id: req.user?.id ?? null,
        action: 'double_seeding_round_deleted',
        entity_type: 'event',
        entity_id: eventIdNum,
        old_value: toAuditJson({
          round: result.round,
          deleted: result.deleted,
        }),
        new_value: toAuditJson({ rounds: result.remainingRounds }),
        ip_address: req.ip ?? null,
      });

      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Error deleting double-seeding round:', error);
      res.status(500).json({ error: 'Failed to delete double-seeding round' });
    }
  },
);

// GET /double-seeding/scores/event/:eventId - Accepted scores for event (public; blocked for archived events)
router.get('/scores/event/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    if (await isEventArchived(eventId)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const db = await getDatabase();

    const scores = await db.all(
      `SELECT dss.*, t.team_number, t.team_name, t.display_name,
              dsm.match_number
       FROM double_seeding_scores dss
       JOIN teams t ON dss.team_id = t.id
       LEFT JOIN double_seeding_matches dsm ON dss.match_id = dsm.id
       WHERE dss.event_id = ?
       ORDER BY t.team_number ASC, dss.round_number ASC`,
      [eventId],
    );

    res.json(scores);
  } catch (error) {
    console.error('Error fetching double-seeding scores:', error);
    res.status(500).json({ error: 'Failed to fetch double-seeding scores' });
  }
});

// GET /double-seeding/scores/team/:teamId - Scores for team (public for judges)
router.get('/scores/team/:teamId', async (req: Request, res: Response) => {
  try {
    const { teamId } = req.params;
    const db = await getDatabase();

    const scores = await db.all(
      'SELECT * FROM double_seeding_scores WHERE team_id = ? ORDER BY round_number ASC',
      [teamId],
    );

    res.json(scores);
  } catch (error) {
    console.error('Error fetching double-seeding scores:', error);
    res.status(500).json({ error: 'Failed to fetch double-seeding scores' });
  }
});

// GET /double-seeding/rankings/event/:eventId - Rankings for event (public; blocked for archived events)
router.get('/rankings/event/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    if (await isEventArchived(eventId)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const db = await getDatabase();

    const rankings = await db.all(
      `SELECT dsr.*, t.team_number, t.team_name, t.display_name
       FROM double_seeding_rankings dsr
       JOIN teams t ON dsr.team_id = t.id
       WHERE t.event_id = ?
       ORDER BY dsr.seed_rank ASC NULLS LAST`,
      [eventId],
    );

    res.json(rankings);
  } catch (error) {
    console.error('Error fetching double-seeding rankings:', error);
    res.status(500).json({ error: 'Failed to fetch double-seeding rankings' });
  }
});

// POST /double-seeding/rankings/recalculate/:eventId - Recalculate rankings (admin only)
router.post(
  '/rankings/recalculate/:eventId',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { eventId } = req.params;
      const db = await getDatabase();

      const result = await recalculateDoubleSeedingRankings(
        parseInt(eventId, 10),
      );

      if (result.teamsRanked === 0 && result.teamsUnranked === 0) {
        return res.status(404).json({ error: 'No teams found for this event' });
      }

      const updatedRankings = await db.all(
        `SELECT dsr.*, t.team_number, t.team_name, t.display_name
         FROM double_seeding_rankings dsr
         JOIN teams t ON dsr.team_id = t.id
         WHERE t.event_id = ?
         ORDER BY dsr.seed_rank ASC NULLS LAST`,
        [eventId],
      );

      res.json({
        message: 'Rankings recalculated',
        rankings: updatedRankings,
        teamsRanked: result.teamsRanked,
        teamsUnranked: result.teamsUnranked,
      });
    } catch (error) {
      console.error('Error recalculating double-seeding rankings:', error);
      res.status(500).json({ error: 'Failed to recalculate rankings' });
    }
  },
);

export default router;
