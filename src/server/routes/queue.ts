import express, { Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { queueSyncLimiter } from '../middleware/rateLimit';
import { getDatabase } from '../database/connection';
import type { Database } from '../database/connection';
import { isValidQueueStatus } from '../../shared/domain';
import type { QueueStatus, QueueType } from '../../shared/domain';
import type { QueueItem } from '../../shared/api';
import { typedJson } from '../utils/typedJson';

const router = express.Router();

// Allowed fields for PATCH updates
const ALLOWED_UPDATE_FIELDS = ['status', 'table_number'];

// ---------------------------------------------------------------------------
// Typed row → DTO mapping for the queue endpoints. The base row mirrors the
// columns of `game_queue`; the joined row adds the display columns the GET
// endpoint pulls from the bracket / team / bracket_games tables. Mutation
// endpoints (POST, PATCH, /call) return the bare base row, with the joined
// fields filled in as `null` so the wire shape always matches `QueueItem`.
// ---------------------------------------------------------------------------

interface BaseQueueItemRow {
  readonly id: number;
  readonly event_id: number;
  readonly bracket_game_id: number | null;
  readonly seeding_team_id: number | null;
  readonly seeding_round: number | null;
  readonly queue_type: QueueType;
  readonly queue_position: number;
  readonly status: QueueStatus;
  readonly table_number: number | null;
  readonly called_at: string | null;
  readonly created_at: string;
}

interface JoinedQueueItemRow extends BaseQueueItemRow {
  readonly game_number: number | null;
  readonly round_name: string | null;
  readonly bracket_side: string | null;
  readonly bracket_name: string | null;
  readonly team1_number: number | null;
  readonly team1_name: string | null;
  readonly team1_display: string | null;
  readonly team2_number: number | null;
  readonly team2_name: string | null;
  readonly team2_display: string | null;
  readonly seeding_team_number: number | null;
  readonly seeding_team_name: string | null;
  readonly seeding_team_display: string | null;
}

const toQueueItem = (row: JoinedQueueItemRow): QueueItem => ({
  id: row.id,
  event_id: row.event_id,
  bracket_game_id: row.bracket_game_id,
  seeding_team_id: row.seeding_team_id,
  seeding_round: row.seeding_round,
  queue_type: row.queue_type,
  queue_position: row.queue_position,
  status: row.status,
  table_number: row.table_number,
  called_at: row.called_at,
  created_at: row.created_at,
  game_number: row.game_number,
  round_name: row.round_name,
  bracket_side: row.bracket_side,
  bracket_name: row.bracket_name,
  team1_number: row.team1_number,
  team1_name: row.team1_name,
  team1_display: row.team1_display,
  team2_number: row.team2_number,
  team2_name: row.team2_name,
  team2_display: row.team2_display,
  seeding_team_number: row.seeding_team_number,
  seeding_team_name: row.seeding_team_name,
  seeding_team_display: row.seeding_team_display,
});

/**
 * Lift a bare `game_queue` row (returned by POST / PATCH / /call, which do
 * not JOIN the display tables) into the full `QueueItem` shape by filling
 * the joined display fields with `null`. Clients re-merge mutation
 * responses against the cached, fully-joined GET row, so the missing
 * display columns are never read off the mutation response itself.
 */
const toBareQueueItem = (row: BaseQueueItemRow): QueueItem =>
  toQueueItem({
    ...row,
    game_number: null,
    round_name: null,
    bracket_side: null,
    bracket_name: null,
    team1_number: null,
    team1_name: null,
    team1_display: null,
    team2_number: null,
    team2_name: null,
    team2_display: null,
    seeding_team_number: null,
    seeding_team_name: null,
    seeding_team_display: null,
  });

const BASE_QUEUE_COLUMNS = `gq.id, gq.event_id, gq.bracket_game_id, gq.seeding_team_id,
         gq.seeding_round, gq.queue_type, gq.queue_position, gq.status,
         gq.table_number, gq.called_at, gq.created_at`;

/** Fetch a single bare game_queue row by id, typed against `BaseQueueItemRow`. */
const fetchBaseQueueRow = (
  db: Database,
  id: number | string,
): Promise<BaseQueueItemRow | undefined> =>
  db.get<BaseQueueItemRow>(
    `SELECT id, event_id, bracket_game_id, seeding_team_id, seeding_round,
            queue_type, queue_position, status, table_number, called_at, created_at
     FROM game_queue WHERE id = ?`,
    [id],
  );

/** Non-destructive sync: ensure game_queue has all team×round items for seeding, with correct status from seeding_scores. */
async function syncSeedingQueue(db: Database, eventId: number): Promise<void> {
  const event = await db.get(
    'SELECT id, seeding_rounds FROM events WHERE id = ?',
    [eventId],
  );
  if (!event) return;

  const seedingRounds = event.seeding_rounds || 3;
  const teams = await db.all<{ id: number; team_number: number }>(
    'SELECT id, team_number FROM teams WHERE event_id = ? ORDER BY team_number ASC',
    [eventId],
  );
  if (teams.length === 0) return;

  const teamIds = teams.map((t) => t.id);
  const scoredRounds = await db.all<{ team_id: number; round_number: number }>(
    `SELECT team_id, round_number FROM seeding_scores
     WHERE team_id IN (${teamIds.map(() => '?').join(',')}) AND score IS NOT NULL`,
    teamIds,
  );
  const scoredSet = new Set(
    scoredRounds.map((s) => `${s.team_id}:${s.round_number}`),
  );
  const submittedRoundsRaw = await db.all<{ score_data: string }>(
    `SELECT score_data FROM score_submissions
     WHERE event_id = ?
       AND score_type = 'seeding'
       AND status = 'accepted'`,
    [eventId],
  );
  const submittedRounds: { team_id: number; round_number: number }[] = [];
  for (const row of submittedRoundsRaw) {
    try {
      const data =
        typeof row.score_data === 'string'
          ? JSON.parse(row.score_data)
          : row.score_data;
      const teamId = data?.team_id?.value;
      const roundNumber = data?.round?.value ?? data?.round_number?.value;
      if (teamId != null && roundNumber != null) {
        submittedRounds.push({
          team_id: Number(teamId),
          round_number: Number(roundNumber),
        });
      }
    } catch {
      // skip rows with unparseable score_data
    }
  }
  const submittedSet = new Set(
    submittedRounds.map((s) => `${s.team_id}:${s.round_number}`),
  );

  const pendingSeedingRaw = await db.all<{ score_data: string }>(
    `SELECT score_data FROM score_submissions
     WHERE event_id = ?
       AND score_type = 'seeding'
       AND status = 'pending'`,
    [eventId],
  );
  const pendingSeedingSet = new Set<string>();
  for (const row of pendingSeedingRaw) {
    try {
      const data =
        typeof row.score_data === 'string'
          ? JSON.parse(row.score_data)
          : row.score_data;
      const teamId = data?.team_id?.value;
      const roundNumber = data?.round?.value ?? data?.round_number?.value;
      if (teamId != null && roundNumber != null) {
        pendingSeedingSet.add(`${Number(teamId)}:${Number(roundNumber)}`);
      }
    } catch {
      // skip
    }
  }

  const existingSeeding = await db.all<{
    id: number;
    seeding_team_id: number;
    seeding_round: number;
    status: string;
  }>(
    `SELECT id, seeding_team_id, seeding_round, status FROM game_queue
     WHERE event_id = ? AND queue_type = 'seeding'`,
    [eventId],
  );
  const existingMap = new Map(
    existingSeeding.map((e) => [`${e.seeding_team_id}:${e.seeding_round}`, e]),
  );

  const allCombos: { team_id: number; round: number; scored: boolean }[] = [];
  for (let round = 1; round <= seedingRounds; round++) {
    for (const team of teams) {
      allCombos.push({
        team_id: team.id,
        round,
        scored:
          scoredSet.has(`${team.id}:${round}`) ||
          submittedSet.has(`${team.id}:${round}`),
      });
    }
  }

  const maxPos = await db.get<{ max_pos: number | null }>(
    'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
    [eventId],
  );
  let nextPos = (maxPos?.max_pos ?? 0) + 1;

  await db.transaction(async (tx) => {
    for (const combo of allCombos) {
      const key = `${combo.team_id}:${combo.round}`;
      const existing = existingMap.get(key);

      if (existing) {
        if (combo.scored) {
          if (pendingSeedingSet.has(key)) {
            await tx.run(
              `UPDATE game_queue SET status = 'scored', called_at = NULL, table_number = NULL WHERE id = ?`,
              [existing.id],
            );
          } else {
            await tx.run('DELETE FROM game_queue WHERE id = ?', [existing.id]);
          }
        } else if (
          existing.status === 'scored' &&
          !pendingSeedingSet.has(key)
        ) {
          await tx.run(
            "UPDATE game_queue SET status = 'queued', called_at = NULL, table_number = NULL WHERE id = ?",
            [existing.id],
          );
        }
      } else if (!combo.scored) {
        await tx.run(
          `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
           VALUES (?, ?, ?, 'seeding', ?, 'queued')`,
          [eventId, combo.team_id, combo.round, nextPos++],
        );
      } else if (pendingSeedingSet.has(key)) {
        await tx.run(
          `INSERT INTO game_queue (event_id, seeding_team_id, seeding_round, queue_type, queue_position, status)
           VALUES (?, ?, ?, 'seeding', ?, 'scored')`,
          [eventId, combo.team_id, combo.round, nextPos++],
        );
      }
    }
  });
}

/** Non-destructive sync: ensure game_queue has eligible bracket games, with correct status from bracket_games. */
async function syncBracketQueue(db: Database, eventId: number): Promise<void> {
  const brackets = await db.all<{ id: number }>(
    'SELECT id FROM brackets WHERE event_id = ?',
    [eventId],
  );
  if (brackets.length === 0) return;

  const bracketIds = brackets.map((b) => b.id);
  const allGames = await db.all<{
    id: number;
    game_number: number;
    status: string;
    team1_id: number | null;
    team2_id: number | null;
  }>(
    `SELECT id, game_number, status, team1_id, team2_id FROM bracket_games
     WHERE bracket_id IN (${bracketIds.map(() => '?').join(',')})
     ORDER BY game_number ASC`,
    bracketIds,
  );
  const submittedBracketGames = await db.all<{ bracket_game_id: number }>(
    `SELECT DISTINCT bracket_game_id
     FROM score_submissions
     WHERE event_id = ?
       AND score_type = 'bracket'
       AND status = 'accepted'
       AND bracket_game_id IS NOT NULL`,
    [eventId],
  );
  const submittedGameSet = new Set(
    submittedBracketGames.map((row) => row.bracket_game_id),
  );

  const pendingBracketGames = await db.all<{ bracket_game_id: number }>(
    `SELECT DISTINCT bracket_game_id
     FROM score_submissions
     WHERE event_id = ?
       AND score_type = 'bracket'
       AND status = 'pending'
       AND bracket_game_id IS NOT NULL`,
    [eventId],
  );
  const pendingBracketSet = new Set(
    pendingBracketGames.map((row) => row.bracket_game_id),
  );

  const existingBracket = await db.all<{
    id: number;
    bracket_game_id: number;
    status: string;
  }>(
    `SELECT id, bracket_game_id, status FROM game_queue
     WHERE event_id = ? AND queue_type = 'bracket'`,
    [eventId],
  );
  const existingByGameId = new Map(
    existingBracket.map((e) => [e.bracket_game_id, e]),
  );

  const maxPos = await db.get<{ max_pos: number | null }>(
    'SELECT MAX(queue_position) as max_pos FROM game_queue WHERE event_id = ?',
    [eventId],
  );
  let nextPos = (maxPos?.max_pos ?? 0) + 1;

  await db.transaction(async (tx) => {
    for (const game of allGames) {
      const isEligible =
        game.team1_id != null &&
        game.team2_id != null &&
        ['ready', 'pending'].includes(game.status);
      const isCompleted =
        game.status === 'completed' || submittedGameSet.has(game.id);
      const existing = existingByGameId.get(game.id);

      if (existing) {
        if (isCompleted) {
          if (pendingBracketSet.has(game.id)) {
            await tx.run(
              `UPDATE game_queue SET status = 'scored', called_at = NULL, table_number = NULL WHERE id = ?`,
              [existing.id],
            );
          } else {
            await tx.run('DELETE FROM game_queue WHERE id = ?', [existing.id]);
          }
        } else if (
          isEligible &&
          existing.status === 'scored' &&
          !pendingBracketSet.has(game.id)
        ) {
          await tx.run(
            "UPDATE game_queue SET status = 'queued', called_at = NULL, table_number = NULL WHERE id = ?",
            [existing.id],
          );
        } else if (
          !isEligible &&
          !isCompleted &&
          (game.team1_id == null || game.team2_id == null)
        ) {
          await tx.run('DELETE FROM game_queue WHERE id = ?', [existing.id]);
        }
      } else if (isEligible && !isCompleted) {
        await tx.run(
          `INSERT INTO game_queue (event_id, bracket_game_id, queue_type, queue_position, status)
           VALUES (?, ?, 'bracket', ?, 'queued')`,
          [eventId, game.id, nextPos++],
        );
      }
    }
  });
}

// GET /queue/event/:eventId - Get queue for event (public for judges)
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
        if (!qt || qt === 'seeding') {
          await syncSeedingQueue(db, eventIdNum);
        }
        if (!qt || qt === 'bracket') {
          await syncBracketQueue(db, eventIdNum);
        }
      }

      let query = `
      SELECT ${BASE_QUEUE_COLUMNS},
             bg.game_number, bg.round_name, bg.bracket_side,
             b.name as bracket_name,
             t1.team_number as team1_number, t1.team_name as team1_name, t1.display_name as team1_display,
             t2.team_number as team2_number, t2.team_name as team2_name, t2.display_name as team2_display,
             st.team_number as seeding_team_number, st.team_name as seeding_team_name, st.display_name as seeding_team_display
      FROM game_queue gq
      LEFT JOIN bracket_games bg ON gq.bracket_game_id = bg.id
      LEFT JOIN brackets b ON bg.bracket_id = b.id
      LEFT JOIN teams t1 ON bg.team1_id = t1.id
      LEFT JOIN teams t2 ON bg.team2_id = t2.id
      LEFT JOIN teams st ON gq.seeding_team_id = st.id
      WHERE gq.event_id = ?
    `;
      const params: (string | number)[] = [eventId];

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

      const rows = await db.all<JoinedQueueItemRow>(query, params);
      const body: readonly QueueItem[] = rows.map(toQueueItem);
      typedJson(res, body);
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

    const db = await getDatabase();

    // Application-level constraint: never queue the same game/seeding round twice
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
         event_id, bracket_game_id, seeding_team_id, seeding_round,
         queue_type, queue_position, status, table_number
       ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
      [
        event_id,
        queue_type === 'bracket' ? bracket_game_id : null,
        queue_type === 'seeding' ? seeding_team_id : null,
        queue_type === 'seeding' ? seeding_round : null,
        queue_type,
        position,
        table_number ?? null,
      ],
    );

    const row =
      result.lastID !== undefined
        ? await fetchBaseQueueRow(db, result.lastID)
        : undefined;
    if (!row) {
      return res.status(500).json({ error: 'Failed to add to queue' });
    }
    res.status(201);
    typedJson(res, toBareQueueItem(row));
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
      await db.transaction(async (tx) => {
        for (const item of validItems) {
          await tx.run(
            'UPDATE game_queue SET queue_position = ? WHERE id = ?',
            [item.queue_position, item.id],
          );
        }
      });
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

// POST /queue/populate-from-bracket - Populate queue from bracket games
router.post(
  '/populate-from-bracket',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { event_id, bracket_id } = req.body;

      if (!event_id || !bracket_id) {
        return res
          .status(400)
          .json({ error: 'event_id and bracket_id are required' });
      }

      const db = await getDatabase();

      // Verify bracket exists and belongs to the event
      const bracket = await db.get(
        'SELECT id, event_id FROM brackets WHERE id = ?',
        [bracket_id],
      );

      if (!bracket) {
        return res.status(404).json({ error: 'Bracket not found' });
      }

      if (bracket.event_id !== event_id) {
        return res
          .status(400)
          .json({ error: 'Bracket does not belong to this event' });
      }

      // Get eligible bracket games:
      // - status IN ('ready', 'pending')
      // - both teams assigned (team1_id IS NOT NULL AND team2_id IS NOT NULL)
      const eligibleGames = await db.all(
        `SELECT id, game_number FROM bracket_games
         WHERE bracket_id = ?
           AND status IN ('ready', 'pending')
           AND team1_id IS NOT NULL
           AND team2_id IS NOT NULL
         ORDER BY game_number ASC`,
        [bracket_id],
      );

      // Replace: delete existing queue for this event
      await db.run('DELETE FROM game_queue WHERE event_id = ?', [event_id]);

      // Insert eligible games into queue
      let created = 0;
      for (let i = 0; i < eligibleGames.length; i++) {
        const game = eligibleGames[i];
        await db.run(
          `INSERT INTO game_queue (
             event_id, bracket_game_id, queue_type, queue_position, status
           ) VALUES (?, ?, 'bracket', ?, 'queued')`,
          [event_id, game.id, i + 1],
        );
        created++;
      }

      res.json({
        message: 'Queue populated from bracket',
        created,
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

    const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
    const values = updates.map(([, value]) => value);

    const result = await db.run(
      `UPDATE game_queue SET ${setClause} WHERE id = ?`,
      [...values, id],
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const row = await fetchBaseQueueRow(db, id);
    if (!row) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    typedJson(res, toBareQueueItem(row));
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

      let query = `UPDATE game_queue SET status = 'called', called_at = CURRENT_TIMESTAMP`;
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

      const row = await fetchBaseQueueRow(db, id);
      if (!row) {
        return res.status(404).json({ error: 'Queue item not found' });
      }
      typedJson(res, toBareQueueItem(row));
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

    await db.run('DELETE FROM game_queue WHERE id = ?', [id]);

    res.status(204).send();
  } catch (error) {
    console.error('Error removing from queue:', error);
    res.status(500).json({ error: 'Failed to remove from queue' });
  }
});

export default router;
