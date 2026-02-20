import express, { Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../database/connection';
import { ensureBracketTemplatesSeeded } from '../services/bracketTemplates';
import { resolveBracketByes } from '../services/bracketByeResolver';
import { recalculateSeedingRankings } from '../services/seedingRankings';

const router = express.Router();

// Allowed fields for PATCH updates
const ALLOWED_BRACKET_UPDATE_FIELDS = [
  'name',
  'bracket_size',
  'actual_team_count',
  'status',
];

const ALLOWED_GAME_UPDATE_FIELDS = [
  'team1_id',
  'team2_id',
  'status',
  'winner_id',
  'loser_id',
  'team1_score',
  'team2_score',
  'score_submission_id',
  'scheduled_time',
  'started_at',
  'completed_at',
];

// ============================================================================
// BRACKETS
// ============================================================================

// GET /brackets/event/:eventId/assigned-teams - Teams already in brackets for this event (admin)
router.get(
  '/event/:eventId/assigned-teams',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { eventId } = req.params;
      const db = await getDatabase();

      const assigned = await db.all(
        `SELECT be.team_id, t.team_number, t.team_name, b.id as bracket_id, b.name as bracket_name
         FROM bracket_entries be
         JOIN brackets b ON be.bracket_id = b.id
         JOIN teams t ON be.team_id = t.id
         WHERE b.event_id = ? AND be.team_id IS NOT NULL
         ORDER BY b.name ASC, be.seed_position ASC`,
        [eventId],
      );

      res.json(assigned);
    } catch (error) {
      console.error('Error fetching assigned teams:', error);
      res.status(500).json({ error: 'Failed to fetch assigned teams' });
    }
  },
);

// GET /brackets/event/:eventId - List brackets for event (public)
router.get('/event/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const db = await getDatabase();

    const brackets = await db.all(
      'SELECT * FROM brackets WHERE event_id = ? ORDER BY created_at ASC',
      [eventId],
    );

    res.json(brackets);
  } catch (error) {
    console.error('Error fetching brackets:', error);
    res.status(500).json({ error: 'Failed to fetch brackets' });
  }
});

// GET /brackets/templates - Get bracket templates (public)
// Must be registered before /:id to avoid "templates" being matched as bracket id
router.get('/templates', async (req: Request, res: Response) => {
  try {
    const { bracket_size } = req.query;
    const db = await getDatabase();

    let query = 'SELECT * FROM bracket_templates';
    const params: number[] = [];

    if (bracket_size) {
      query += ' WHERE bracket_size = ?';
      params.push(parseInt(bracket_size as string, 10));
    }

    query += ' ORDER BY bracket_size ASC, game_number ASC';

    const templates = await db.all(query, params);
    res.json(templates);
  } catch (error) {
    console.error('Error fetching bracket templates:', error);
    res.status(500).json({ error: 'Failed to fetch bracket templates' });
  }
});

// GET /brackets/:id - Get bracket with entries and games (public)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    const bracket = await db.get('SELECT * FROM brackets WHERE id = ?', [id]);

    if (!bracket) {
      return res.status(404).json({ error: 'Bracket not found' });
    }

    // Get entries with team info
    const entries = await db.all(
      `SELECT be.*, t.team_number, t.team_name, t.display_name
       FROM bracket_entries be
       LEFT JOIN teams t ON be.team_id = t.id
       WHERE be.bracket_id = ?
       ORDER BY be.seed_position ASC`,
      [id],
    );

    // Get games
    const games = await db.all(
      `SELECT bg.*,
              t1.team_number as team1_number, t1.team_name as team1_name, t1.display_name as team1_display,
              t2.team_number as team2_number, t2.team_name as team2_name, t2.display_name as team2_display,
              w.team_number as winner_number, w.team_name as winner_name, w.display_name as winner_display
       FROM bracket_games bg
       LEFT JOIN teams t1 ON bg.team1_id = t1.id
       LEFT JOIN teams t2 ON bg.team2_id = t2.id
       LEFT JOIN teams w ON bg.winner_id = w.id
       WHERE bg.bracket_id = ?
       ORDER BY bg.game_number ASC`,
      [id],
    );

    res.json({
      ...bracket,
      entries,
      games,
    });
  } catch (error) {
    console.error('Error fetching bracket:', error);
    res.status(500).json({ error: 'Failed to fetch bracket' });
  }
});

function nextPowerOfTwo(n: number): number {
  if (n <= 0) return 4;
  const p = Math.pow(2, Math.ceil(Math.log2(n)));
  return Math.max(4, Math.min(64, p));
}

// POST /brackets - Create bracket
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const {
      event_id,
      name,
      bracket_size,
      actual_team_count,
      status,
      team_ids,
    } = req.body;

    const db = await getDatabase();

    if (Array.isArray(team_ids) && team_ids.length > 0) {
      // New flow: create bracket from explicit team selection
      if (!event_id || !name) {
        return res.status(400).json({
          error: 'event_id and name are required when team_ids provided',
        });
      }

      const teamIds = team_ids as number[];
      const uniqueIds = [...new Set(teamIds)];
      if (uniqueIds.length !== teamIds.length) {
        return res.status(400).json({ error: 'team_ids must be unique' });
      }

      const event = await db.get('SELECT id FROM events WHERE id = ?', [
        event_id,
      ]);
      if (!event) {
        return res.status(400).json({ error: 'Event does not exist' });
      }

      const placeholders = teamIds.map(() => '?').join(',');
      const teams = await db.all<{ id: number; event_id: number }>(
        `SELECT id, event_id FROM teams WHERE id IN (${placeholders})`,
        teamIds,
      );
      const foundIds = new Set(teams.map((t) => t.id));
      const notFound = teamIds.filter((id) => !foundIds.has(id));
      if (notFound.length > 0) {
        return res.status(400).json({
          error: 'One or more team_ids not found',
          team_ids: notFound,
        });
      }
      const wrongEvent = teams.filter((t) => t.event_id !== event_id);
      if (wrongEvent.length > 0) {
        return res.status(400).json({
          error: 'All teams must belong to the same event as the bracket',
          team_ids: wrongEvent.map((t) => t.id),
        });
      }

      const assigned = await db.all<{
        team_id: number;
        team_number: number;
        team_name: string;
        bracket_id: number;
        bracket_name: string;
      }>(
        `SELECT be.team_id, t.team_number, t.team_name, b.id as bracket_id, b.name as bracket_name
         FROM bracket_entries be
         JOIN brackets b ON be.bracket_id = b.id
         JOIN teams t ON be.team_id = t.id
         WHERE b.event_id = ? AND be.team_id IS NOT NULL AND be.team_id IN (${placeholders})`,
        [event_id, ...teamIds],
      );
      if (assigned.length > 0) {
        return res.status(409).json({
          error:
            'One or more teams are already assigned to a bracket at this event',
          conflicts: assigned.map((a) => ({
            team_id: a.team_id,
            team_number: a.team_number,
            team_name: a.team_name,
            bracket_id: a.bracket_id,
            bracket_name: a.bracket_name,
          })),
        });
      }

      const actualTeamCount = teamIds.length;
      const bracketSize = nextPowerOfTwo(actualTeamCount);
      if (bracketSize > 64) {
        return res.status(400).json({
          error: `Too many teams (${actualTeamCount}). Maximum bracket size is 64.`,
        });
      }

      await recalculateSeedingRankings(event_id);

      const rankings = await db.all<{
        team_id: number;
        seed_rank: number | null;
        team_number: number;
      }>(
        `SELECT sr.team_id, sr.seed_rank, t.team_number
         FROM seeding_rankings sr
         JOIN teams t ON sr.team_id = t.id
         WHERE sr.team_id IN (${placeholders})
         ORDER BY sr.seed_rank ASC NULLS LAST, t.team_number ASC`,
        teamIds,
      );
      const teamIdToRank = new Map(rankings.map((r, i) => [r.team_id, i + 1]));
      const orderedTeamIds = teamIds
        .slice()
        .sort(
          (a, b) => (teamIdToRank.get(a) ?? 999) - (teamIdToRank.get(b) ?? 999),
        );

      let bracketId: number | null = null;
      await db.transaction(async (tx) => {
        const br = await tx.run(
          `INSERT INTO brackets (event_id, name, bracket_size, actual_team_count, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            event_id,
            name,
            bracketSize,
            actualTeamCount,
            status || 'setup',
            req.user?.id || null,
          ],
        );
        const newBracketId = br.lastID!;
        bracketId = newBracketId;

        for (
          let seedPosition = 1;
          seedPosition <= bracketSize;
          seedPosition++
        ) {
          const teamId =
            seedPosition <= orderedTeamIds.length
              ? orderedTeamIds[seedPosition - 1]
              : null;
          const isBye = teamId === null;
          await tx.run(
            `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
             VALUES (?, ?, ?, ?)`,
            [newBracketId, teamId, seedPosition, isBye],
          );
        }
      });

      if (!bracketId) {
        throw new Error('Failed to create bracket');
      }

      await ensureBracketTemplatesSeeded(db, bracketSize);
      const templates = await db.all(
        'SELECT * FROM bracket_templates WHERE bracket_size = ? ORDER BY game_number ASC',
        [bracketSize],
      );
      if (templates.length === 0) {
        return res.status(400).json({
          error: `No bracket templates found for size ${bracketSize}`,
        });
      }

      const entries = await db.all(
        'SELECT * FROM bracket_entries WHERE bracket_id = ? ORDER BY seed_position ASC',
        [bracketId],
      );
      const entriesBySeed = new Map<
        number,
        { team_id: number | null; is_bye: boolean }
      >();
      for (const entry of entries) {
        entriesBySeed.set(entry.seed_position, {
          team_id: entry.team_id,
          is_bye: !!entry.is_bye,
        });
      }

      const gameIdByNumber = new Map<number, number>();
      for (const template of templates) {
        const result = await db.run(
          `INSERT INTO bracket_games (
            bracket_id, game_number, round_name, round_number, bracket_side,
            team1_source, team2_source, status, winner_slot, loser_slot
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          [
            bracketId,
            template.game_number,
            template.round_name,
            template.round_number,
            template.bracket_side,
            template.team1_source,
            template.team2_source,
            template.winner_slot,
            template.loser_slot,
          ],
        );
        gameIdByNumber.set(template.game_number, result.lastID as number);
      }

      for (const template of templates) {
        const gameId = gameIdByNumber.get(template.game_number);
        if (!gameId) continue;

        const winnerAdvancesToId = template.winner_advances_to
          ? gameIdByNumber.get(template.winner_advances_to)
          : null;
        const loserAdvancesToId = template.loser_advances_to
          ? gameIdByNumber.get(template.loser_advances_to)
          : null;

        let team1Id: number | null = null;
        let team2Id: number | null = null;

        if (template.team1_source.startsWith('seed:')) {
          const seedNum = parseInt(template.team1_source.split(':')[1], 10);
          const entry = entriesBySeed.get(seedNum);
          if (entry) team1Id = entry.team_id;
        }
        if (template.team2_source.startsWith('seed:')) {
          const seedNum = parseInt(template.team2_source.split(':')[1], 10);
          const entry = entriesBySeed.get(seedNum);
          if (entry) team2Id = entry.team_id;
        }

        const team1Entry = template.team1_source.startsWith('seed:')
          ? entriesBySeed.get(parseInt(template.team1_source.split(':')[1], 10))
          : null;
        const team2Entry = template.team2_source.startsWith('seed:')
          ? entriesBySeed.get(parseInt(template.team2_source.split(':')[1], 10))
          : null;

        let gameStatus = 'pending';
        let winnerId: number | null = null;
        if (team1Entry?.is_bye && team2Id) {
          winnerId = team2Id;
          gameStatus = 'bye';
        } else if (team2Entry?.is_bye && team1Id) {
          winnerId = team1Id;
          gameStatus = 'bye';
        } else if (team1Id && team2Id) {
          gameStatus = 'ready';
        }

        await db.run(
          `UPDATE bracket_games SET
            winner_advances_to_id = ?,
            loser_advances_to_id = ?,
            team1_id = ?,
            team2_id = ?,
            winner_id = ?,
            status = ?
          WHERE id = ?`,
          [
            winnerAdvancesToId,
            loserAdvancesToId,
            team1Id,
            team2Id,
            winnerId,
            gameStatus,
            gameId,
          ],
        );

        if (winnerId && winnerAdvancesToId && template.winner_slot) {
          const column =
            template.winner_slot === 'team1' ? 'team1_id' : 'team2_id';
          await db.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
            winnerId,
            winnerAdvancesToId,
          ]);
        }
      }

      await db.run(
        `UPDATE bracket_games SET status = 'ready'
         WHERE bracket_id = ? AND status = 'pending'
         AND team1_id IS NOT NULL AND team2_id IS NOT NULL`,
        [bracketId],
      );

      await resolveBracketByes(db, bracketId);

      const bracket = await db.get('SELECT * FROM brackets WHERE id = ?', [
        bracketId,
      ]);
      return res.status(201).json(bracket);
    }

    // Legacy flow: bracket_size required
    if (!event_id || !name || !bracket_size) {
      return res
        .status(400)
        .json({ error: 'event_id, name, and bracket_size are required' });
    }

    const result = await db.run(
      `INSERT INTO brackets (event_id, name, bracket_size, actual_team_count, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        event_id,
        name,
        bracket_size,
        actual_team_count ?? null,
        status || 'setup',
        req.user?.id || null,
      ],
    );

    const bracket = await db.get('SELECT * FROM brackets WHERE id = ?', [
      result.lastID,
    ]);
    res.status(201).json(bracket);
  } catch (error) {
    console.error('Error creating bracket:', error);
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json({ error: 'Event does not exist' });
    }
    if (errMsg.includes('CHECK constraint failed')) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    res.status(500).json({ error: 'Failed to create bracket' });
  }
});

// PATCH /brackets/:id - Update bracket
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    const updates = Object.entries(req.body).filter(([key]) =>
      ALLOWED_BRACKET_UPDATE_FIELDS.includes(key),
    );

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
    const values = updates.map(([, value]) => value);

    const result = await db.run(
      `UPDATE brackets SET ${setClause} WHERE id = ?`,
      [...values, id],
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Bracket not found' });
    }

    const bracket = await db.get('SELECT * FROM brackets WHERE id = ?', [id]);
    res.json(bracket);
  } catch (error) {
    console.error('Error updating bracket:', error);
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('CHECK constraint failed')) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    res.status(500).json({ error: 'Failed to update bracket' });
  }
});

// DELETE /brackets/:id - Delete bracket
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    await db.run('DELETE FROM brackets WHERE id = ?', [id]);

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting bracket:', error);
    res.status(500).json({ error: 'Failed to delete bracket' });
  }
});

// ============================================================================
// BRACKET ENTRIES
// ============================================================================

// POST /brackets/:id/entries - Add entry to bracket
router.post(
  '/:id/entries',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id: bracketId } = req.params;
      const { team_id, seed_position, initial_slot, is_bye } = req.body;

      if (seed_position === undefined) {
        return res.status(400).json({ error: 'seed_position is required' });
      }

      const db = await getDatabase();

      // Application-level constraint: team must belong to same event as bracket
      if (team_id) {
        const bracket = await db.get(
          'SELECT event_id FROM brackets WHERE id = ?',
          [bracketId],
        );
        if (!bracket) {
          return res.status(404).json({ error: 'Bracket not found' });
        }

        const team = await db.get('SELECT event_id FROM teams WHERE id = ?', [
          team_id,
        ]);
        if (!team) {
          return res.status(400).json({ error: 'Team not found' });
        }

        if (team.event_id !== bracket.event_id) {
          return res.status(400).json({
            error: 'Team must belong to the same event as the bracket',
          });
        }
      }

      const result = await db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, initial_slot, is_bye)
         VALUES (?, ?, ?, ?, ?)`,
        [
          bracketId,
          team_id ?? null,
          seed_position,
          initial_slot ?? null,
          is_bye ? 1 : 0,
        ],
      );

      const entry = await db.get('SELECT * FROM bracket_entries WHERE id = ?', [
        result.lastID,
      ]);
      res.status(201).json(entry);
    } catch (error) {
      console.error('Error adding bracket entry:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('UNIQUE constraint failed')) {
        return res.status(409).json({
          error: 'Team or seed position already exists in this bracket',
        });
      }
      if (errMsg.includes('CHECK constraint failed')) {
        return res.status(400).json({
          error:
            'Invalid entry: bye requires null team_id, non-bye requires team_id',
        });
      }
      res.status(500).json({ error: 'Failed to add bracket entry' });
    }
  },
);

// DELETE /brackets/:bracketId/entries/:entryId - Remove entry
router.delete(
  '/:bracketId/entries/:entryId',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { entryId } = req.params;
      const db = await getDatabase();

      await db.run('DELETE FROM bracket_entries WHERE id = ?', [entryId]);

      res.status(204).send();
    } catch (error) {
      console.error('Error removing bracket entry:', error);
      res.status(500).json({ error: 'Failed to remove bracket entry' });
    }
  },
);

// POST /brackets/:id/entries/generate - Generate entries from seeding rankings
router.post(
  '/:id/entries/generate',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { force } = req.query;
      const db = await getDatabase();

      // Get bracket info
      const bracket = await db.get('SELECT * FROM brackets WHERE id = ?', [id]);

      if (!bracket) {
        return res.status(404).json({ error: 'Bracket not found' });
      }

      // Check if entries already exist
      const existingEntries = await db.all(
        'SELECT id FROM bracket_entries WHERE bracket_id = ?',
        [id],
      );

      if (existingEntries.length > 0 && force !== 'true') {
        return res.status(409).json({
          error: 'Bracket already has entries. Use ?force=true to replace.',
          entriesCount: existingEntries.length,
        });
      }

      // Recalculate seeding rankings before fetching (ensures fresh data)
      const recalcResult = await recalculateSeedingRankings(bracket.event_id);
      console.log(
        `Recalculated rankings for event ${bracket.event_id}: ${recalcResult.teamsRanked} ranked, ${recalcResult.teamsUnranked} unranked`,
      );

      // Get ranked teams for this event
      const rankedTeams = await db.all(
        `SELECT sr.team_id, sr.seed_rank, t.team_number, t.team_name, t.display_name
         FROM seeding_rankings sr
         JOIN teams t ON sr.team_id = t.id
         WHERE t.event_id = ? AND sr.seed_rank IS NOT NULL
         ORDER BY sr.seed_rank ASC`,
        [bracket.event_id],
      );

      if (rankedTeams.length === 0) {
        return res.status(400).json({
          error: 'No ranked teams found. Calculate seeding rankings first.',
        });
      }

      const bracketSize = bracket.bracket_size;

      // Always use the current count of ranked teams (capped at bracket size)
      // This ensures regeneration picks up newly scored teams
      const teamCount = Math.min(rankedTeams.length, bracketSize);

      // Delete existing entries if force=true
      if (existingEntries.length > 0) {
        await db.run('DELETE FROM bracket_entries WHERE bracket_id = ?', [id]);
      }

      // Create entries
      let entriesCreated = 0;
      let byeCount = 0;

      for (let seedPosition = 1; seedPosition <= bracketSize; seedPosition++) {
        const team = rankedTeams[seedPosition - 1];

        if (team && seedPosition <= teamCount) {
          // Real team entry
          await db.run(
            `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
             VALUES (?, ?, ?, 0)`,
            [id, team.team_id, seedPosition],
          );
          entriesCreated++;
        } else {
          // Bye entry
          await db.run(
            `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
             VALUES (?, NULL, ?, 1)`,
            [id, seedPosition],
          );
          byeCount++;
        }
      }

      // Always update actual_team_count to reflect the current number of ranked teams
      await db.run('UPDATE brackets SET actual_team_count = ? WHERE id = ?', [
        teamCount,
        id,
      ]);

      res.json({
        message: 'Entries generated successfully',
        entriesCreated,
        byeCount,
        totalEntries: entriesCreated + byeCount,
        actualTeamCount: teamCount,
      });
    } catch (error) {
      console.error('Error generating bracket entries:', error);
      res.status(500).json({ error: 'Failed to generate bracket entries' });
    }
  },
);

// ============================================================================
// BRACKET GAMES
// ============================================================================

// GET /brackets/:id/games - Get games for bracket (public)
router.get('/:id/games', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDatabase();

    const games = await db.all(
      `SELECT bg.*,
              t1.team_number as team1_number, t1.team_name as team1_name, t1.display_name as team1_display,
              t2.team_number as team2_number, t2.team_name as team2_name, t2.display_name as team2_display,
              w.team_number as winner_number, w.team_name as winner_name, w.display_name as winner_display
       FROM bracket_games bg
       LEFT JOIN teams t1 ON bg.team1_id = t1.id
       LEFT JOIN teams t2 ON bg.team2_id = t2.id
       LEFT JOIN teams w ON bg.winner_id = w.id
       WHERE bg.bracket_id = ?
       ORDER BY bg.game_number ASC`,
      [id],
    );

    res.json(games);
  } catch (error) {
    console.error('Error fetching bracket games:', error);
    res.status(500).json({ error: 'Failed to fetch bracket games' });
  }
});

// POST /brackets/:id/games - Create game in bracket
router.post(
  '/:id/games',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id: bracketId } = req.params;
      const {
        game_number,
        round_name,
        round_number,
        bracket_side,
        team1_id,
        team2_id,
        team1_source,
        team2_source,
        status,
        winner_advances_to_id,
        loser_advances_to_id,
        winner_slot,
        loser_slot,
        scheduled_time,
      } = req.body;

      if (game_number === undefined) {
        return res.status(400).json({ error: 'game_number is required' });
      }

      const db = await getDatabase();

      // Application-level constraint: teams must belong to same event as bracket
      const bracket = await db.get(
        'SELECT event_id FROM brackets WHERE id = ?',
        [bracketId],
      );
      if (!bracket) {
        return res.status(404).json({ error: 'Bracket not found' });
      }

      for (const teamId of [team1_id, team2_id].filter(Boolean)) {
        const team = await db.get('SELECT event_id FROM teams WHERE id = ?', [
          teamId,
        ]);
        if (team && team.event_id !== bracket.event_id) {
          return res.status(400).json({
            error: 'Teams must belong to the same event as the bracket',
          });
        }
      }

      const result = await db.run(
        `INSERT INTO bracket_games (
           bracket_id, game_number, round_name, round_number, bracket_side,
           team1_id, team2_id, team1_source, team2_source, status,
           winner_advances_to_id, loser_advances_to_id, winner_slot, loser_slot,
           scheduled_time
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bracketId,
          game_number,
          round_name ?? null,
          round_number ?? null,
          bracket_side ?? null,
          team1_id ?? null,
          team2_id ?? null,
          team1_source ?? null,
          team2_source ?? null,
          status || 'pending',
          winner_advances_to_id ?? null,
          loser_advances_to_id ?? null,
          winner_slot ?? null,
          loser_slot ?? null,
          scheduled_time ?? null,
        ],
      );

      const game = await db.get('SELECT * FROM bracket_games WHERE id = ?', [
        result.lastID,
      ]);
      res.status(201).json(game);
    } catch (error) {
      console.error('Error creating bracket game:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('UNIQUE constraint failed')) {
        return res
          .status(409)
          .json({ error: 'Game number already exists in this bracket' });
      }
      if (errMsg.includes('CHECK constraint failed')) {
        return res
          .status(400)
          .json({ error: 'Invalid status or bracket_side value' });
      }
      res.status(500).json({ error: 'Failed to create bracket game' });
    }
  },
);

// PATCH /brackets/games/:id - Update game (scores, winner, etc.)
router.patch(
  '/games/:id',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const updates = Object.entries(req.body).filter(([key]) =>
        ALLOWED_GAME_UPDATE_FIELDS.includes(key),
      );

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      // Application-level constraint: teams must belong to same event as bracket
      const game = await db.get(
        `SELECT bg.bracket_id, b.event_id
         FROM bracket_games bg
         JOIN brackets b ON bg.bracket_id = b.id
         WHERE bg.id = ?`,
        [id],
      );
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      for (const [key, value] of updates) {
        if (
          ['team1_id', 'team2_id', 'winner_id', 'loser_id'].includes(key) &&
          value
        ) {
          const team = await db.get('SELECT event_id FROM teams WHERE id = ?', [
            value,
          ]);
          if (team && team.event_id !== game.event_id) {
            return res.status(400).json({
              error: 'Teams must belong to the same event as the bracket',
            });
          }
        }
      }

      const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
      const values = updates.map(([, value]) => value);

      const result = await db.run(
        `UPDATE bracket_games SET ${setClause} WHERE id = ?`,
        [...values, id],
      );

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Game not found' });
      }

      const updatedGame = await db.get(
        'SELECT * FROM bracket_games WHERE id = ?',
        [id],
      );
      res.json(updatedGame);
    } catch (error) {
      console.error('Error updating bracket game:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('CHECK constraint failed')) {
        return res
          .status(400)
          .json({ error: 'Invalid status or bracket_side value' });
      }
      res.status(500).json({ error: 'Failed to update bracket game' });
    }
  },
);

// POST /brackets/games/:id/advance - Advance winner to next game
router.post(
  '/games/:id/advance',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const db = await getDatabase();

      const game = await db.get('SELECT * FROM bracket_games WHERE id = ?', [
        id,
      ]);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      if (!game.winner_id) {
        return res.status(400).json({ error: 'Game has no winner to advance' });
      }

      const updates: { gameId: number; slot: string; teamId: number }[] = [];

      // Advance winner
      if (game.winner_advances_to_id && game.winner_slot) {
        updates.push({
          gameId: game.winner_advances_to_id,
          slot: game.winner_slot,
          teamId: game.winner_id,
        });
      }

      // Advance loser (for double elimination)
      if (game.loser_id && game.loser_advances_to_id && game.loser_slot) {
        updates.push({
          gameId: game.loser_advances_to_id,
          slot: game.loser_slot,
          teamId: game.loser_id,
        });
      }

      // Execute all updates in a single transaction
      await db.transaction(async (tx) => {
        for (const update of updates) {
          const column = update.slot === 'team1' ? 'team1_id' : 'team2_id';
          await tx.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
            update.teamId,
            update.gameId,
          ]);
        }

        await tx.run(
          `UPDATE bracket_games SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [id],
        );
      });

      // Resolve any downstream bye chains that may have been created
      const byeResolution = await resolveBracketByes(db, game.bracket_id);

      res.json({ message: 'Winner advanced', updates, byeResolution });
    } catch (error) {
      console.error('Error advancing winner:', error);
      res.status(500).json({ error: 'Failed to advance winner' });
    }
  },
);

// POST /brackets/:id/games/generate - Generate games from bracket templates
router.post(
  '/:id/games/generate',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { force } = req.query;
      const db = await getDatabase();

      // Get bracket info
      const bracket = await db.get('SELECT * FROM brackets WHERE id = ?', [id]);

      if (!bracket) {
        return res.status(404).json({ error: 'Bracket not found' });
      }

      // Check if games already exist
      const existingGames = await db.all(
        'SELECT id FROM bracket_games WHERE bracket_id = ?',
        [id],
      );

      if (existingGames.length > 0 && force !== 'true') {
        return res.status(409).json({
          error: 'Bracket already has games. Use ?force=true to replace.',
          gamesCount: existingGames.length,
        });
      }

      // Ensure templates exist for this bracket size
      await ensureBracketTemplatesSeeded(db, bracket.bracket_size);

      // Get templates for this bracket size
      const templates = await db.all(
        'SELECT * FROM bracket_templates WHERE bracket_size = ? ORDER BY game_number ASC',
        [bracket.bracket_size],
      );

      if (templates.length === 0) {
        return res.status(400).json({
          error: `No bracket templates found for size ${bracket.bracket_size}`,
        });
      }

      // Get entries for looking up seed-based team assignments
      const entries = await db.all(
        'SELECT * FROM bracket_entries WHERE bracket_id = ? ORDER BY seed_position ASC',
        [id],
      );

      const entriesBySeed = new Map<
        number,
        { team_id: number | null; is_bye: boolean }
      >();
      for (const entry of entries) {
        entriesBySeed.set(entry.seed_position, {
          team_id: entry.team_id,
          is_bye: !!entry.is_bye,
        });
      }

      // Delete existing games if force=true
      if (existingGames.length > 0) {
        await db.run('DELETE FROM bracket_games WHERE bracket_id = ?', [id]);
      }

      // First pass: Create all games and collect their IDs
      const gameIdByNumber = new Map<number, number>();

      for (const template of templates) {
        const result = await db.run(
          `INSERT INTO bracket_games (
            bracket_id, game_number, round_name, round_number, bracket_side,
            team1_source, team2_source, status, winner_slot, loser_slot
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          [
            id,
            template.game_number,
            template.round_name,
            template.round_number,
            template.bracket_side,
            template.team1_source,
            template.team2_source,
            template.winner_slot,
            template.loser_slot,
          ],
        );
        gameIdByNumber.set(template.game_number, result.lastID as number);
      }

      // Second pass: Update advancement links and seed-based teams
      for (const template of templates) {
        const gameId = gameIdByNumber.get(template.game_number);
        if (!gameId) continue;

        // Resolve winner/loser advances_to IDs
        const winnerAdvancesToId = template.winner_advances_to
          ? gameIdByNumber.get(template.winner_advances_to)
          : null;
        const loserAdvancesToId = template.loser_advances_to
          ? gameIdByNumber.get(template.loser_advances_to)
          : null;

        // Resolve seed-based team assignments
        let team1Id: number | null = null;
        let team2Id: number | null = null;
        let status = 'pending';

        if (template.team1_source.startsWith('seed:')) {
          const seedNum = parseInt(template.team1_source.split(':')[1], 10);
          const entry = entriesBySeed.get(seedNum);
          if (entry) {
            team1Id = entry.team_id;
          }
        }

        if (template.team2_source.startsWith('seed:')) {
          const seedNum = parseInt(template.team2_source.split(':')[1], 10);
          const entry = entriesBySeed.get(seedNum);
          if (entry) {
            team2Id = entry.team_id;
          }
        }

        // Check for bye scenarios
        const team1Entry = template.team1_source.startsWith('seed:')
          ? entriesBySeed.get(parseInt(template.team1_source.split(':')[1], 10))
          : null;
        const team2Entry = template.team2_source.startsWith('seed:')
          ? entriesBySeed.get(parseInt(template.team2_source.split(':')[1], 10))
          : null;

        // If one team is a bye, auto-advance the other team
        let winnerId: number | null = null;
        if (team1Entry?.is_bye && team2Id) {
          winnerId = team2Id;
          status = 'bye';
        } else if (team2Entry?.is_bye && team1Id) {
          winnerId = team1Id;
          status = 'bye';
        } else if (team1Id && team2Id) {
          status = 'ready';
        }

        await db.run(
          `UPDATE bracket_games SET
            winner_advances_to_id = ?,
            loser_advances_to_id = ?,
            team1_id = ?,
            team2_id = ?,
            winner_id = ?,
            status = ?
          WHERE id = ?`,
          [
            winnerAdvancesToId,
            loserAdvancesToId,
            team1Id,
            team2Id,
            winnerId,
            status,
            gameId,
          ],
        );

        // If this was a bye game, propagate the winner forward
        if (winnerId && winnerAdvancesToId && template.winner_slot) {
          const column =
            template.winner_slot === 'team1' ? 'team1_id' : 'team2_id';
          await db.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
            winnerId,
            winnerAdvancesToId,
          ]);
        }
      }

      // Third pass: Check for ready games (both teams assigned, neither null)
      await db.run(
        `UPDATE bracket_games SET status = 'ready'
         WHERE bracket_id = ? AND status = 'pending'
         AND team1_id IS NOT NULL AND team2_id IS NOT NULL`,
        [id],
      );

      // Fourth pass: Resolve bye chains (implicit byes from loser sources, etc.)
      const byeResolution = await resolveBracketByes(db, parseInt(id, 10));

      res.json({
        message: 'Games generated successfully',
        gamesCreated: templates.length,
        byeResolution,
      });
    } catch (error) {
      console.error('Error generating bracket games:', error);
      res.status(500).json({ error: 'Failed to generate bracket games' });
    }
  },
);

// POST /brackets/:id/advance-winner - Advance winner for a specific game
router.post(
  '/:id/advance-winner',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id: bracketId } = req.params;
      const { game_id, winner_id } = req.body;
      const db = await getDatabase();

      if (!game_id || !winner_id) {
        return res
          .status(400)
          .json({ error: 'game_id and winner_id are required' });
      }

      // Get the game and verify it belongs to this bracket
      const game = await db.get(
        'SELECT * FROM bracket_games WHERE id = ? AND bracket_id = ?',
        [game_id, bracketId],
      );

      if (!game) {
        return res
          .status(404)
          .json({ error: 'Game not found in this bracket' });
      }

      if (game.status === 'completed') {
        return res.status(400).json({ error: 'Game is already completed' });
      }

      // Verify winner_id is one of the teams in the game
      if (game.team1_id !== winner_id && game.team2_id !== winner_id) {
        return res.status(400).json({
          error: 'winner_id must be one of the teams in the game',
        });
      }

      // Determine loser
      const loserId =
        game.team1_id === winner_id ? game.team2_id : game.team1_id;

      const updates: { gameId: number; slot: string; teamId: number }[] = [];

      // Prepare winner advancement
      if (game.winner_advances_to_id && game.winner_slot) {
        updates.push({
          gameId: game.winner_advances_to_id,
          slot: game.winner_slot,
          teamId: winner_id,
        });
      }

      // Prepare loser advancement (for double elimination)
      if (loserId && game.loser_advances_to_id && game.loser_slot) {
        updates.push({
          gameId: game.loser_advances_to_id,
          slot: game.loser_slot,
          teamId: loserId,
        });
      }

      // Execute all updates in a single transaction
      await db.transaction(async (tx) => {
        await tx.run(
          `UPDATE bracket_games SET
            winner_id = ?,
            loser_id = ?,
            status = 'completed',
            completed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [winner_id, loserId, game_id],
        );

        for (const update of updates) {
          const column = update.slot === 'team1' ? 'team1_id' : 'team2_id';
          await tx.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
            update.teamId,
            update.gameId,
          ]);
        }
      });

      // Check if destination games are now ready
      for (const update of updates) {
        const destGame = await db.get(
          'SELECT * FROM bracket_games WHERE id = ?',
          [update.gameId],
        );
        if (
          destGame &&
          destGame.team1_id &&
          destGame.team2_id &&
          destGame.status === 'pending'
        ) {
          await db.run(
            `UPDATE bracket_games SET status = 'ready' WHERE id = ?`,
            [update.gameId],
          );
        }
      }

      // Resolve any downstream bye chains that may have been created
      const byeResolution = await resolveBracketByes(
        db,
        parseInt(bracketId, 10),
      );

      res.json({
        message: 'Winner advanced successfully',
        winner_id,
        loser_id: loserId,
        updates,
        byeResolution,
      });
    } catch (error) {
      console.error('Error advancing winner:', error);
      res.status(500).json({ error: 'Failed to advance winner' });
    }
  },
);

// ============================================================================
// BRACKET TEMPLATES
// ============================================================================

// POST /brackets/templates - Create bracket template
router.post(
  '/templates',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        bracket_size,
        game_number,
        round_name,
        round_number,
        bracket_side,
        team1_source,
        team2_source,
        winner_advances_to,
        loser_advances_to,
        winner_slot,
        loser_slot,
        is_championship,
        is_grand_final,
        is_reset_game,
      } = req.body;

      if (
        !bracket_size ||
        game_number === undefined ||
        !round_name ||
        round_number === undefined ||
        !bracket_side ||
        !team1_source ||
        !team2_source
      ) {
        return res.status(400).json({
          error:
            'bracket_size, game_number, round_name, round_number, bracket_side, team1_source, and team2_source are required',
        });
      }

      const db = await getDatabase();

      const result = await db.run(
        `INSERT INTO bracket_templates (
           bracket_size, game_number, round_name, round_number, bracket_side,
           team1_source, team2_source, winner_advances_to, loser_advances_to,
           winner_slot, loser_slot, is_championship, is_grand_final, is_reset_game
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bracket_size,
          game_number,
          round_name,
          round_number,
          bracket_side,
          team1_source,
          team2_source,
          winner_advances_to ?? null,
          loser_advances_to ?? null,
          winner_slot ?? null,
          loser_slot ?? null,
          is_championship ? 1 : 0,
          is_grand_final ? 1 : 0,
          is_reset_game ? 1 : 0,
        ],
      );

      const template = await db.get(
        'SELECT * FROM bracket_templates WHERE id = ?',
        [result.lastID],
      );
      res.status(201).json(template);
    } catch (error) {
      console.error('Error creating bracket template:', error);
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('UNIQUE constraint failed')) {
        return res
          .status(409)
          .json({ error: 'Game number already exists for this bracket size' });
      }
      if (errMsg.includes('CHECK constraint failed')) {
        return res.status(400).json({ error: 'Invalid winner_slot value' });
      }
      res.status(500).json({ error: 'Failed to create bracket template' });
    }
  },
);

export default router;
