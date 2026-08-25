import express, { Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { queueSyncLimiter } from '../middleware/rateLimit';
import { getDatabase, type Database } from '../database/connection';
import { isValidQueueStatus } from '../constants/queueStatus';
import {
  ensureQueueFresh,
  scheduleQueueRepair,
  syncQueueCoalesced,
} from '../services/queueSync';
import { bumpQueueVersion, queueEtag } from '../services/queueVersion';
import {
  BRACKET_INTERLEAVE_ORDER_SQL,
  type BracketQueueOrder,
  mergeBracketQueueItems,
} from '../services/bracketQueueOrder';
import { getTeamRest } from '../services/teamRest';

const router = express.Router();

// Allowed fields for PATCH updates
const ALLOWED_UPDATE_FIELDS = ['status', 'table_number'];

interface QueuePresenceSource {
  id: number;
  event_id: number;
  queue_type: string;
  status: string;
  present_team1_id: number | null;
  present_team2_id: number | null;
  team1_id: number | null;
  team2_id: number | null;
  double_seeding_team1_id: number | null;
  double_seeding_team2_id: number | null;
}

function getQueueParticipants(
  item: QueuePresenceSource,
): [number | null, number | null] {
  if (item.queue_type === 'bracket') {
    return [
      item.team1_id == null ? null : Number(item.team1_id),
      item.team2_id == null ? null : Number(item.team2_id),
    ];
  }
  if (item.queue_type === 'double_seeding') {
    return [
      item.double_seeding_team1_id == null
        ? null
        : Number(item.double_seeding_team1_id),
      item.double_seeding_team2_id == null
        ? null
        : Number(item.double_seeding_team2_id),
    ];
  }
  return [null, null];
}

function normalizedPresence(item: QueuePresenceSource): {
  team1_present: boolean;
  team2_present: boolean;
} {
  const [team1Id, team2Id] = getQueueParticipants(item);
  return {
    team1_present:
      team1Id !== null && Number(item.present_team1_id) === team1Id,
    team2_present:
      team2Id !== null && Number(item.present_team2_id) === team2Id,
  };
}

function isPairedQueueItem(item: QueuePresenceSource): boolean {
  const [team1Id, team2Id] = getQueueParticipants(item);
  return team1Id !== null && team2Id !== null;
}

async function getQueuePresenceSource(
  db: Database,
  id: string | number,
): Promise<QueuePresenceSource | undefined> {
  return db.get<QueuePresenceSource>(
    `SELECT gq.id, gq.event_id, gq.queue_type, gq.status,
            gq.present_team1_id, gq.present_team2_id,
            bg.team1_id, bg.team2_id,
            dsm.team1_id AS double_seeding_team1_id,
            dsm.team2_id AS double_seeding_team2_id
     FROM game_queue gq
     LEFT JOIN bracket_games bg ON bg.id = gq.bracket_game_id
     LEFT JOIN double_seeding_matches dsm
       ON dsm.id = gq.double_seeding_match_id
     WHERE gq.id = ?`,
    [id],
  );
}

function participantSnapshotPredicate(item: QueuePresenceSource): {
  sql: string;
  params: number[];
} {
  const [team1Id, team2Id] = getQueueParticipants(item);
  if (item.queue_type === 'bracket') {
    return {
      sql: `EXISTS (
              SELECT 1 FROM bracket_games bg
              WHERE bg.id = game_queue.bracket_game_id
                AND bg.team1_id = ? AND bg.team2_id = ?
            )`,
      params: [team1Id!, team2Id!],
    };
  }
  return {
    sql: `EXISTS (
            SELECT 1 FROM double_seeding_matches dsm
            WHERE dsm.id = game_queue.double_seeding_match_id
              AND dsm.team1_id = ? AND dsm.team2_id = ?
          )`,
    params: [team1Id!, team2Id!],
  };
}

// GET /queue/event/:eventId - Get queue for event (public for judges/spectators)
//
// Designed to be polled: the response carries a version-based ETag, so
// clients sending If-None-Match get a 304 from a single-row version lookup
// when nothing changed. Repair syncs only run when the event queue is
// flagged dirty (or when sync=1 is explicitly requested, rate-limited).
router.get(
  '/event/:eventId',
  queueSyncLimiter,
  async (req: Request, res: Response) => {
    try {
      const { eventId } = req.params;
      const { queue_type, sync } = req.query;
      const db = await getDatabase();

      const eventIdNum = parseInt(eventId, 10);
      if (isNaN(eventIdNum)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      if (sync === '1' || sync === 'true') {
        const qt = typeof queue_type === 'string' ? queue_type : null;
        await syncQueueCoalesced(db, eventIdNum, qt);
      }

      const version = await ensureQueueFresh(db, eventIdNum);
      scheduleQueueRepair(db, eventIdNum);

      res.set('ETag', queueEtag(version));
      res.set('Cache-Control', 'no-cache');
      if (req.fresh) {
        return res.status(304).end();
      }

      let query = `
      SELECT gq.*,
             bg.game_number, bg.round_name, bg.bracket_side,
             bg.team1_id, bg.team2_id,
             b.name as bracket_name,
             t1.team_number as team1_number, t1.team_name as team1_name, t1.display_name as team1_display,
             t2.team_number as team2_number, t2.team_name as team2_name, t2.display_name as team2_display,
             st.team_number as seeding_team_number, st.team_name as seeding_team_name, st.display_name as seeding_team_display,
             dsm.round_number as double_seeding_round, dsm.match_number as double_seeding_match_number,
             dsm.team1_id as double_seeding_team1_id, dsm.team2_id as double_seeding_team2_id,
             dst1.team_number as double_seeding_team1_number, dst1.team_name as double_seeding_team1_name, dst1.display_name as double_seeding_team1_display,
             dst2.team_number as double_seeding_team2_number, dst2.team_name as double_seeding_team2_name, dst2.display_name as double_seeding_team2_display
      FROM game_queue gq
      LEFT JOIN bracket_games bg ON gq.bracket_game_id = bg.id
      LEFT JOIN brackets b ON bg.bracket_id = b.id
      LEFT JOIN teams t1 ON bg.team1_id = t1.id
      LEFT JOIN teams t2 ON bg.team2_id = t2.id
      LEFT JOIN teams st ON gq.seeding_team_id = st.id
      LEFT JOIN double_seeding_matches dsm ON gq.double_seeding_match_id = dsm.id
      LEFT JOIN teams dst1 ON dsm.team1_id = dst1.id
      LEFT JOIN teams dst2 ON dsm.team2_id = dst2.id
      WHERE gq.event_id = ?
    `;
      const params: (string | number)[] = [eventIdNum];

      const statusParam = req.query.status;
      if (statusParam) {
        let statuses: string[] = [];
        if (Array.isArray(statusParam)) {
          statuses = statusParam as string[];
        } else if (typeof statusParam === 'string') {
          if (statusParam.includes(',')) {
            statuses = statusParam.split(',');
          } else if (statusParam.includes('|')) {
            statuses = statusParam.split('|');
          } else {
            statuses = [statusParam];
          }
        }

        if (statuses.length > 0) {
          query += ` AND gq.status IN (${statuses.map(() => '?').join(',')})`;
          params.push(...statuses);
        }
      }

      if (queue_type) {
        query += ' AND gq.queue_type = ?';
        params.push(queue_type as string);
      }

      query += ' ORDER BY gq.queue_position ASC';

      const queue = await db.all(query, params);
      const rest = await getTeamRest(db, eventIdNum);

      const enrichedQueue = queue.map((item) => ({
        ...item,
        ...normalizedPresence(item),
        team1_last_played_at:
          item.team1_id == null
            ? null
            : (rest.lastPlayedAt.get(Number(item.team1_id)) ?? null),
        team2_last_played_at:
          item.team2_id == null
            ? null
            : (rest.lastPlayedAt.get(Number(item.team2_id)) ?? null),
        team1_busy:
          item.team1_id != null && rest.busy.has(Number(item.team1_id)),
        team2_busy:
          item.team2_id != null && rest.busy.has(Number(item.team2_id)),
        seeding_team_last_played_at:
          item.seeding_team_id == null
            ? null
            : (rest.lastPlayedAt.get(Number(item.seeding_team_id)) ?? null),
        seeding_team_busy:
          item.seeding_team_id != null &&
          rest.busy.has(Number(item.seeding_team_id)),
        double_seeding_team1_last_played_at:
          item.double_seeding_team1_id == null
            ? null
            : (rest.lastPlayedAt.get(Number(item.double_seeding_team1_id)) ??
              null),
        double_seeding_team2_last_played_at:
          item.double_seeding_team2_id == null
            ? null
            : (rest.lastPlayedAt.get(Number(item.double_seeding_team2_id)) ??
              null),
        double_seeding_team1_busy:
          item.double_seeding_team1_id != null &&
          rest.busy.has(Number(item.double_seeding_team1_id)),
        double_seeding_team2_busy:
          item.double_seeding_team2_id != null &&
          rest.busy.has(Number(item.double_seeding_team2_id)),
      }));

      res.json(enrichedQueue);
    } catch (error) {
      console.error('Error fetching game queue:', error);
      res.status(500).json({ error: 'Failed to fetch game queue' });
    }
  },
);

// POST /queue - Add item to queue
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const {
      event_id,
      bracket_game_id,
      seeding_team_id,
      seeding_round,
      double_seeding_match_id,
      queue_type,
      queue_position,
      table_number,
    } = req.body;

    if (!event_id || !queue_type) {
      return res
        .status(400)
        .json({ error: 'event_id and queue_type are required' });
    }

    // Validate queue_type constraints
    if (queue_type === 'bracket' && !bracket_game_id) {
      return res
        .status(400)
        .json({ error: 'bracket_game_id is required for bracket queue type' });
    }
    if (queue_type === 'seeding' && (!seeding_team_id || !seeding_round)) {
      return res.status(400).json({
        error:
          'seeding_team_id and seeding_round are required for seeding queue type',
      });
    }
    if (queue_type === 'double_seeding' && !double_seeding_match_id) {
      return res.status(400).json({
        error:
          'double_seeding_match_id is required for double_seeding queue type',
      });
    }

    const db = await getDatabase();

    // Application-level constraint: never queue the same game/seeding round/match twice
    if (queue_type === 'bracket') {
      const existing = await db.get(
        'SELECT id FROM game_queue WHERE bracket_game_id = ?',
        [bracket_game_id],
      );
      if (existing) {
        return res
          .status(409)
          .json({ error: 'This game is already in the queue' });
      }
    } else if (queue_type === 'double_seeding') {
      const existing = await db.get(
        'SELECT id FROM game_queue WHERE double_seeding_match_id = ?',
        [double_seeding_match_id],
      );
      if (existing) {
        return res
          .status(409)
          .json({ error: 'This match is already in the queue' });
      }
    } else {
      const existing = await db.get(
        'SELECT id FROM game_queue WHERE seeding_team_id = ? AND seeding_round = ?',
        [seeding_team_id, seeding_round],
      );
      if (existing) {
        return res
          .status(409)
          .json({ error: 'This seeding round is already in the queue' });
      }
    }

    // If no position specified, add to end
    let position = queue_position;
    if (position === undefined) {
      const maxPos = await db.get(
        'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
        [event_id],
      );
      position = (maxPos?.max_pos ?? 0) + 1;
    }

    const result = await db.run(
      `INSERT INTO game_queue (
         event_id, bracket_game_id, seeding_team_id, seeding_round, double_seeding_match_id,
         queue_type, queue_position, status, table_number
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
      [
        event_id,
        queue_type === 'bracket' ? bracket_game_id : null,
        queue_type === 'seeding' ? seeding_team_id : null,
        queue_type === 'seeding' ? seeding_round : null,
        queue_type === 'double_seeding' ? double_seeding_match_id : null,
        queue_type,
        position,
        table_number ?? null,
      ],
    );
    await bumpQueueVersion(db, Number(event_id));

    const queueItem = await db.get('SELECT * FROM game_queue WHERE id = ?', [
      result.lastID,
    ]);
    res.status(201).json(queueItem);
  } catch (error) {
    console.error('Error adding to queue:', error);
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('FOREIGN KEY constraint failed')) {
      return res
        .status(400)
        .json({ error: 'Event, game, or team does not exist' });
    }
    if (errMsg.includes('CHECK constraint failed')) {
      return res.status(400).json({ error: 'Invalid queue_type or status' });
    }
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

// Shared reorder handler
async function handleReorder(req: AuthRequest, res: Response) {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: 'items array is required with {id, queue_position}' });
    }

    const db = await getDatabase();

    // Filter valid items and execute all updates in a single transaction
    const validItems = items.filter(
      (item) => item.id !== undefined && item.queue_position !== undefined,
    );

    if (validItems.length > 0) {
      const updatedItemIds = new Set<number>();
      await db.transaction(async (tx) => {
        for (const item of validItems) {
          const result = await tx.run(
            'UPDATE game_queue SET queue_position = ? WHERE id = ?',
            [item.queue_position, item.id],
          );
          if ((result.changes ?? 0) > 0) {
            updatedItemIds.add(Number(item.id));
          }
        }
      });

      if (updatedItemIds.size > 0) {
        const ids = [...updatedItemIds];
        const placeholders = ids.map(() => '?').join(', ');
        const owners = await db.all<{ event_id: number }>(
          `SELECT DISTINCT event_id FROM game_queue WHERE id IN (${placeholders})`,
          ids,
        );
        for (const owner of owners) {
          await bumpQueueVersion(db, owner.event_id);
        }
      }
    }

    res.json({ message: 'Queue reordered', updated: validItems.length });
  } catch (error) {
    console.error('Error reordering queue:', error);
    res.status(500).json({ error: 'Failed to reorder queue' });
  }
}

// POST /queue/reorder - Reorder queue items (MUST be before /:id routes)
router.post('/reorder', requireAuth, handleReorder);

// PATCH /queue/reorder - Reorder queue items (alias for POST)
router.patch('/reorder', requireAuth, handleReorder);

// POST /queue/populate-from-bracket - Populate queue from event bracket games
router.post(
  '/populate-from-bracket',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { event_id, bracket_id } = req.body;

      const eventId = Number(event_id);
      if (!Number.isInteger(eventId) || eventId <= 0) {
        return res.status(400).json({ error: 'event_id is required' });
      }

      const bracketId = bracket_id == null ? null : Number(bracket_id);
      if (
        bracketId !== null &&
        (!Number.isInteger(bracketId) || bracketId <= 0)
      ) {
        return res.status(400).json({ error: 'Invalid bracket_id' });
      }

      const db = await getDatabase();

      const event = await db.get<{ id: number }>(
        'SELECT id FROM events WHERE id = ?',
        [eventId],
      );
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      let targetBrackets: Array<{ id: number }>;
      if (bracketId !== null) {
        const bracket = await db.get<{ id: number; event_id: number }>(
          'SELECT id, event_id FROM brackets WHERE id = ?',
          [bracketId],
        );

        if (!bracket) {
          return res.status(404).json({ error: 'Bracket not found' });
        }
        if (bracket.event_id !== eventId) {
          return res
            .status(400)
            .json({ error: 'Bracket does not belong to this event' });
        }
        targetBrackets = [{ id: bracket.id }];
      } else {
        targetBrackets = await db.all<{ id: number }>(
          'SELECT id FROM brackets WHERE event_id = ? ORDER BY id ASC',
          [eventId],
        );
      }

      const targetBracketIds = new Set(
        targetBrackets.map((bracket) => bracket.id),
      );

      const eligibleGames =
        targetBrackets.length === 0
          ? []
          : await db.all<BracketQueueOrder & { id: number }>(
              `SELECT bg.id, bg.bracket_id, b.bracket_size, bg.game_number,
                      bg.play_order
               FROM bracket_games bg
               JOIN brackets b ON b.id = bg.bracket_id
               WHERE bg.bracket_id IN (${targetBrackets.map(() => '?').join(',')})
                 AND bg.status IN ('ready', 'pending')
                 AND bg.team1_id IS NOT NULL
                 AND bg.team2_id IS NOT NULL
               ORDER BY ${BRACKET_INTERLEAVE_ORDER_SQL}`,
              targetBrackets.map((bracket) => bracket.id),
            );

      interface QueueSequenceItem {
        id: number;
        bracket_game_id: number | null;
        queue_type: string;
        queue_position: number;
        bracketOrder: BracketQueueOrder | null;
        newBracketGameId: number | null;
      }

      const queueRows = await db.all<
        Omit<QueueSequenceItem, 'bracketOrder' | 'newBracketGameId'> &
          Partial<BracketQueueOrder>
      >(
        `SELECT gq.id, gq.bracket_game_id, gq.queue_type, gq.queue_position,
                bg.bracket_id, b.bracket_size, bg.game_number, bg.play_order
         FROM game_queue gq
         LEFT JOIN bracket_games bg ON bg.id = gq.bracket_game_id
         LEFT JOIN brackets b ON b.id = bg.bracket_id
         WHERE gq.event_id = ?
         ORDER BY gq.queue_position ASC, gq.id ASC`,
        [eventId],
      );
      const currentQueue: QueueSequenceItem[] = queueRows.map((row) => ({
        id: row.id,
        bracket_game_id: row.bracket_game_id,
        queue_type: row.queue_type,
        queue_position: row.queue_position,
        bracketOrder:
          row.queue_type === 'bracket' &&
          row.bracket_id !== undefined &&
          row.bracket_size !== undefined &&
          row.game_number !== undefined
            ? {
                bracket_id: row.bracket_id,
                bracket_size: row.bracket_size,
                game_number: row.game_number,
                play_order: row.play_order ?? null,
              }
            : null,
        newBracketGameId: null,
      }));

      const isTargetedRow = (row: QueueSequenceItem): boolean =>
        row.bracketOrder !== null &&
        targetBracketIds.has(row.bracketOrder.bracket_id);
      const firstTargetIndex = currentQueue.findIndex(isTargetedRow);
      const deletedRows = currentQueue.filter(isTargetedRow);
      const survivingQueue = currentQueue.filter((row) => !isTargetedRow(row));
      const additions: QueueSequenceItem[] = eligibleGames.map((game) => ({
        id: -game.id,
        bracket_game_id: game.id,
        queue_type: 'bracket',
        queue_position: -1,
        bracketOrder: {
          bracket_id: game.bracket_id,
          bracket_size: game.bracket_size,
          game_number: game.game_number,
          play_order: game.play_order,
        },
        newBracketGameId: game.id,
      }));

      let finalQueue: QueueSequenceItem[];
      if (survivingQueue.some((row) => row.bracketOrder !== null)) {
        finalQueue = mergeBracketQueueItems(survivingQueue, additions);
      } else {
        finalQueue = [...survivingQueue];
        const insertionIndex =
          firstTargetIndex === -1
            ? finalQueue.length
            : Math.min(firstTargetIndex, finalQueue.length);
        finalQueue.splice(insertionIndex, 0, ...additions);
      }

      let changes = 0;
      await db.transaction(async (tx) => {
        for (const row of deletedRows) {
          const result = await tx.run('DELETE FROM game_queue WHERE id = ?', [
            row.id,
          ]);
          changes += result.changes ?? 0;
        }

        for (let index = 0; index < finalQueue.length; index++) {
          const row = finalQueue[index];
          const queuePosition = index + 1;

          if (row.newBracketGameId !== null) {
            const result = await tx.run(
              `INSERT INTO game_queue (
                 event_id, bracket_game_id, queue_type, queue_position, status
               ) VALUES (?, ?, 'bracket', ?, 'queued')`,
              [eventId, row.newBracketGameId, queuePosition],
            );
            changes += result.changes ?? 0;
          } else if (
            (deletedRows.length > 0 || additions.length > 0) &&
            row.queue_position !== queuePosition
          ) {
            const result = await tx.run(
              'UPDATE game_queue SET queue_position = ? WHERE id = ?',
              [queuePosition, row.id],
            );
            changes += result.changes ?? 0;
          }
        }
      });

      if (changes > 0) {
        await bumpQueueVersion(db, eventId);
      }

      res.json({
        message: 'Queue populated from brackets',
        created: eligibleGames.length,
        bracketGamesTotal: eligibleGames.length,
      });
    } catch (error) {
      console.error('Error populating queue from bracket:', error);
      res.status(500).json({ error: 'Failed to populate queue from bracket' });
    }
  },
);

// POST /queue/populate-from-seeding - Populate queue from unplayed seeding rounds
router.post(
  '/populate-from-seeding',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { event_id } = req.body;

      if (!event_id) {
        return res.status(400).json({ error: 'event_id is required' });
      }

      const db = await getDatabase();

      // Get event and seeding_rounds count
      const event = await db.get(
        'SELECT id, seeding_rounds FROM events WHERE id = ?',
        [event_id],
      );

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const seedingRounds = event.seeding_rounds || 3;

      // Get all teams for this event
      const teams = await db.all(
        'SELECT id, team_number FROM teams WHERE event_id = ? ORDER BY team_number ASC',
        [event_id],
      );

      if (teams.length === 0) {
        return res.status(400).json({ error: 'No teams found for this event' });
      }

      // Get all scored seeding rounds (team_id + round_number with non-null score)
      const teamIds = teams.map((t: { id: number }) => t.id);
      const scoredRounds = await db.all(
        `SELECT team_id, round_number FROM seeding_scores
         WHERE team_id IN (${teamIds.map(() => '?').join(',')})
           AND score IS NOT NULL`,
        teamIds,
      );

      // Build a set of "team_id:round" for scored rounds
      const scoredSet = new Set(
        scoredRounds.map(
          (s: { team_id: number; round_number: number }) =>
            `${s.team_id}:${s.round_number}`,
        ),
      );

      // Build list of unplayed seeding rounds
      const unplayedRounds: { team_id: number; round: number }[] = [];
      for (let round = 1; round <= seedingRounds; round++) {
        for (const team of teams) {
          const key = `${team.id}:${round}`;
          if (!scoredSet.has(key)) {
            unplayedRounds.push({ team_id: team.id, round });
          }
        }
      }

      // Replace: delete existing queue for this event
      await db.run('DELETE FROM game_queue WHERE event_id = ?', [event_id]);

      // Insert unplayed seeding rounds into queue
      let created = 0;
      for (let i = 0; i < unplayedRounds.length; i++) {
        const item = unplayedRounds[i];
        await db.run(
          `INSERT INTO game_queue (
             event_id, seeding_team_id, seeding_round, queue_type, queue_position, status
           ) VALUES (?, ?, ?, 'seeding', ?, 'queued')`,
          [event_id, item.team_id, item.round, i + 1],
        );
        created++;
      }

      await bumpQueueVersion(db, Number(event_id));

      res.json({
        message: 'Queue populated from seeding',
        created,
        totalTeams: teams.length,
        totalRounds: seedingRounds,
      });
    } catch (error) {
      console.error('Error populating queue from seeding:', error);
      res.status(500).json({ error: 'Failed to populate queue from seeding' });
    }
  },
);

// PATCH /queue/:id/presence - Confirm one participant in a paired queue item
router.patch(
  '/:id/presence',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { team_id, present } = req.body;
      const teamId = team_id;

      if (
        typeof teamId !== 'number' ||
        !Number.isInteger(teamId) ||
        teamId <= 0 ||
        typeof present !== 'boolean'
      ) {
        return res.status(400).json({
          error:
            'team_id must be a positive integer and present must be boolean',
        });
      }

      const db = await getDatabase();
      const source = await getQueuePresenceSource(db, id);
      if (!source) {
        return res.status(404).json({ error: 'Queue item not found' });
      }
      if (
        !['bracket', 'double_seeding'].includes(source.queue_type) ||
        !isPairedQueueItem(source)
      ) {
        return res.status(400).json({
          error: 'Presence tracking requires a two-team match',
        });
      }
      if (source.status !== 'called') {
        return res.status(409).json({
          error: 'Presence can only be changed while the queue item is called',
        });
      }

      const [team1Id, team2Id] = getQueueParticipants(source);
      const slot = teamId === team1Id ? 1 : teamId === team2Id ? 2 : null;
      if (slot === null) {
        return res.status(409).json({
          error: 'Team is not a current participant in this queue item',
        });
      }

      const nextPresentId = present ? teamId : null;
      const snapshot = participantSnapshotPredicate(source);
      const presentColumn =
        slot === 1 ? 'present_team1_id' : 'present_team2_id';
      const otherPresentColumn =
        slot === 1 ? 'present_team2_id' : 'present_team1_id';
      const otherTeamId = slot === 1 ? team2Id! : team1Id!;

      // The status expression reads the other stored confirmation at update
      // time. Concurrent confirmations therefore reconcile to `arrived`
      // regardless of which request acquires the row lock first.
      const result = await db.run(
        `UPDATE game_queue
         SET ${presentColumn} = ?,
             status = CASE
               WHEN ? AND ${otherPresentColumn} = ? THEN 'arrived'
               ELSE 'called'
             END
         WHERE id = ? AND status = 'called' AND ${snapshot.sql}`,
        [nextPresentId, present, otherTeamId, id, ...snapshot.params],
      );

      if ((result.changes ?? 0) === 0) {
        const current = await getQueuePresenceSource(db, id);
        if (!current) {
          return res.status(404).json({ error: 'Queue item not found' });
        }
        return res.status(409).json({
          error: 'Queue status or participants changed; refresh and try again',
        });
      }

      await bumpQueueVersion(db, source.event_id);
      const updated = await getQueuePresenceSource(db, id);
      if (!updated) {
        return res.status(404).json({ error: 'Queue item not found' });
      }
      res.json({
        id: updated.id,
        status: updated.status,
        ...normalizedPresence(updated),
      });
    } catch (error) {
      console.error('Error updating queue presence:', error);
      res.status(500).json({ error: 'Failed to update queue presence' });
    }
  },
);

// PATCH /queue/:id - Update queue item status (MUST be after specific routes like /reorder)
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    const updates = Object.entries(req.body).filter(([key]) =>
      ALLOWED_UPDATE_FIELDS.includes(key),
    );

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const statusEntry = updates.find(([key]) => key === 'status');
    if (statusEntry && !isValidQueueStatus(statusEntry[1])) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const current = await getQueuePresenceSource(db, id);
    if (!current) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    let updateGuard = '';
    let updateGuardParams: (string | number)[] = [];
    const targetStatus = statusEntry?.[1];
    const gatedAdvance =
      typeof targetStatus === 'string' &&
      ['queued', 'called'].includes(current.status) &&
      ['arrived', 'on_table', 'scored'].includes(targetStatus) &&
      isPairedQueueItem(current);

    if (gatedAdvance) {
      const presence = normalizedPresence(current);
      if (!presence.team1_present || !presence.team2_present) {
        return res.status(409).json({
          error: 'Both teams must be present before this match can advance',
        });
      }

      const [team1Id, team2Id] = getQueueParticipants(current);
      const snapshot = participantSnapshotPredicate(current);
      updateGuard = `
        AND status = ?
        AND present_team1_id = ?
        AND present_team2_id = ?
        AND ${snapshot.sql}`;
      updateGuardParams = [
        current.status,
        team1Id!,
        team2Id!,
        ...snapshot.params,
      ];
    }

    const resetPresence =
      targetStatus === 'queued' || targetStatus === 'called';
    const setClause = [
      ...updates.map(([key]) => `${key} = ?`),
      ...(resetPresence
        ? ['present_team1_id = NULL', 'present_team2_id = NULL']
        : []),
    ].join(', ');
    const values = updates.map(([, value]) => value);

    const result = await db.run(
      `UPDATE game_queue SET ${setClause} WHERE id = ?${updateGuard}`,
      [...values, id, ...updateGuardParams],
    );

    if (result.changes === 0) {
      if (gatedAdvance) {
        return res.status(409).json({
          error: 'Queue status or participants changed; refresh and try again',
        });
      }
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const queueItem = await db.get('SELECT * FROM game_queue WHERE id = ?', [
      id,
    ]);
    if (queueItem) {
      await bumpQueueVersion(db, queueItem.event_id);
    }
    res.json(queueItem);
  } catch (error) {
    console.error('Error updating queue item:', error);
    const errMsg = (error as Error).message || '';
    if (
      errMsg.includes('CHECK constraint failed') ||
      errMsg.includes('violates check constraint')
    ) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    res.status(500).json({ error: 'Failed to update queue item' });
  }
});

// PATCH /queue/:id/call - Call team/game (sets status to 'called' and records time)
router.patch(
  '/:id/call',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { table_number } = req.body;
      const db = await getDatabase();

      let query = `UPDATE game_queue
                   SET status = 'called', called_at = CURRENT_TIMESTAMP,
                       present_team1_id = NULL, present_team2_id = NULL`;
      const params: (string | number | null)[] = [];

      if (table_number !== undefined) {
        query += ', table_number = ?';
        params.push(table_number);
      }

      query += ' WHERE id = ?';
      params.push(id);

      const result = await db.run(query, params);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Queue item not found' });
      }

      const queueItem = await db.get('SELECT * FROM game_queue WHERE id = ?', [
        id,
      ]);
      if (queueItem) {
        await bumpQueueVersion(db, queueItem.event_id);
      }
      res.json(queueItem);
    } catch (error) {
      console.error('Error calling queue item:', error);
      res.status(500).json({ error: 'Failed to call queue item' });
    }
  },
);

// DELETE /queue/:id - Remove from queue
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    const existing = await db.get<{ event_id: number }>(
      'SELECT event_id FROM game_queue WHERE id = ?',
      [id],
    );

    await db.run('DELETE FROM game_queue WHERE id = ?', [id]);

    if (existing) {
      await bumpQueueVersion(db, existing.event_id);
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error removing from queue:', error);
    res.status(500).json({ error: 'Failed to remove from queue' });
  }
});

export default router;
