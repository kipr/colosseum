import { Request, Response, Router } from 'express';
import { getDatabase } from '../../database/connection';
import { isEventArchived } from '../../utils/eventVisibility';
import {
  ensureQueueFresh,
  scheduleQueueRepair,
} from '../../services/queueSync';
import { queueEtag } from '../../services/queueVersion';
import {
  listAssignedTeams,
  listBracketsForEvent,
} from '../../services/bracketQueries';

export function registerEventRoutes(
  publicRouter: Router,
  authRouter: Router,
): void {
  // GET /brackets/event/:eventId/assigned-teams
  authRouter.get(
    '/event/:eventId/assigned-teams',
    async (req: Request, res: Response) => {
      try {
        const { eventId } = req.params;
        const db = await getDatabase();
        const assigned = await listAssignedTeams(db, eventId);
        res.json(assigned);
      } catch (error) {
        console.error('Error fetching assigned teams:', error);
        res.status(500).json({ error: 'Failed to fetch assigned teams' });
      }
    },
  );

  // GET /brackets/event/:eventId
  publicRouter.get('/event/:eventId', async (req: Request, res: Response) => {
    try {
      const { eventId } = req.params;
      if (await isEventArchived(eventId)) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const db = await getDatabase();
      const brackets = await listBracketsForEvent(db, eventId);
      res.json(brackets);
    } catch (error) {
      console.error('Error fetching brackets:', error);
      res.status(500).json({ error: 'Failed to fetch brackets' });
    }
  });

  // GET /brackets/event/:eventId/games
  publicRouter.get(
    '/event/:eventId/games',
    async (req: Request, res: Response) => {
      try {
        const eventIdNum = parseInt(req.params.eventId, 10);
        if (Number.isNaN(eventIdNum)) {
          return res.status(400).json({ error: 'Invalid event ID' });
        }

        if (await isEventArchived(eventIdNum)) {
          return res.status(404).json({ error: 'Event not found' });
        }

        const db = await getDatabase();

        const version = await ensureQueueFresh(db, eventIdNum);
        scheduleQueueRepair(db, eventIdNum);
        res.set('ETag', queueEtag(version));
        res.set('Cache-Control', 'no-cache');
        if (req.fresh) {
          return res.status(304).end();
        }

        const { eligible } = req.query;
        const onlyScoreable = eligible === 'scoreable';
        const whereClauses = ['b.event_id = ?'];
        const params: Array<string | number> = [eventIdNum, eventIdNum];

        if (onlyScoreable) {
          whereClauses.push('bg.team1_id IS NOT NULL');
          whereClauses.push('bg.team2_id IS NOT NULL');
          whereClauses.push("bg.status <> 'completed'");
        }

        const games = await db.all(
          `SELECT
         bg.id AS bracket_game_id,
         bg.id,
         bg.bracket_id,
         b.name AS bracket_name,
         bg.game_number,
         bg.round_name,
         bg.bracket_side,
         bg.status,
         bg.winner_id,
         bg.result_type,
         bg.disqualified_team_id,
         gq.queue_position,
         bg.team1_id,
         t1.team_number AS team1_number,
         t1.team_name AS team1_name,
         t1.display_name AS team1_display,
         bg.team2_id,
         t2.team_number AS team2_number,
         t2.team_name AS team2_name,
         t2.display_name AS team2_display,
         w.team_number AS winner_number,
         w.team_name AS winner_name,
         w.display_name AS winner_display
       FROM bracket_games bg
       JOIN brackets b ON bg.bracket_id = b.id
       LEFT JOIN game_queue gq
         ON gq.event_id = ?
        AND gq.bracket_game_id = bg.id
        AND gq.queue_type = 'bracket'
       LEFT JOIN teams t1 ON bg.team1_id = t1.id
       LEFT JOIN teams t2 ON bg.team2_id = t2.id
       LEFT JOIN teams w ON bg.winner_id = w.id
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY
         CASE WHEN gq.queue_position IS NULL THEN 1 ELSE 0 END ASC,
         gq.queue_position ASC,
         b.name ASC,
         bg.game_number ASC`,
          params,
        );

        res.json(games);
      } catch (error) {
        console.error('Error fetching event bracket games:', error);
        res.status(500).json({ error: 'Failed to fetch bracket games' });
      }
    },
  );
}
