import type { Database } from '../database/connection';
import { recalculateSeedingRankings } from '../services/seedingRankings';
import { resolveBracketByes } from '../services/bracketByeResolver';
import { ensureBracketTemplatesSeeded } from '../services/bracketTemplates';
import {
  applyTemplateAssignments,
  insertTemplateGames,
  loadEntriesBySeed,
  markReadyGames,
  type BracketTemplateRow,
} from '../sql/bracketGames';

export interface CreateBracketParams {
  db: Database;
  body: Record<string, unknown>;
  userId: number | null;
}

interface ConflictRow {
  team_id: number;
  team_number: number;
  team_name: string;
  bracket_id: number;
  bracket_name: string;
}

export type CreateBracketResult =
  | { ok: true; status: 201; bracket: Record<string, unknown> }
  | { ok: false; status: 400 | 404; error: string; team_ids?: number[] }
  | { ok: false; status: 409; error: string; conflicts: ConflictRow[] };

function nextPowerOfTwo(n: number): number {
  if (n <= 0) return 4;
  const p = Math.pow(2, Math.ceil(Math.log2(n)));
  return Math.max(4, Math.min(64, p));
}

function parseTeamSelection(body: Record<string, unknown>): {
  hasSelection: boolean;
  teamIds: number[];
} {
  const teamIds = body.team_ids;
  if (Array.isArray(teamIds) && teamIds.length > 0) {
    return { hasSelection: true, teamIds: teamIds as number[] };
  }
  return { hasSelection: false, teamIds: [] };
}

/**
 * Create a bracket. Two flows:
 *
 *  - "team selection" (`team_ids` provided): builds entries + games immediately
 *    using the canonical templates and the shared sql/bracketGames helpers.
 *  - "legacy" (just `bracket_size`): only inserts the bracket row.
 */
export async function createBracket(
  params: CreateBracketParams,
): Promise<CreateBracketResult> {
  const { db, body, userId } = params;

  const event_id = body.event_id as number | undefined;
  const name = body.name as string | undefined;
  const status = (body.status as string | undefined) ?? 'setup';
  const weight = body.weight as number | undefined;
  const actual_team_count = body.actual_team_count as number | undefined;

  if (
    weight !== undefined &&
    (typeof weight !== 'number' || weight <= 0 || weight > 1)
  ) {
    return {
      ok: false,
      status: 400,
      error: 'weight must be a number in (0, 1]',
    };
  }
  const bracketWeight: number = weight ?? 1.0;

  const { hasSelection, teamIds } = parseTeamSelection(body);

  if (hasSelection) {
    if (!event_id || !name) {
      return {
        ok: false,
        status: 400,
        error: 'event_id and name are required when team_ids provided',
      };
    }

    const uniqueIds = [...new Set(teamIds)];
    if (uniqueIds.length !== teamIds.length) {
      return { ok: false, status: 400, error: 'team_ids must be unique' };
    }

    const event = await db.get('SELECT id FROM events WHERE id = ?', [
      event_id,
    ]);
    if (!event) {
      return { ok: false, status: 400, error: 'Event does not exist' };
    }

    const placeholders = teamIds.map(() => '?').join(',');
    const teams = await db.all<{ id: number; event_id: number }>(
      `SELECT id, event_id FROM teams WHERE id IN (${placeholders})`,
      teamIds,
    );
    const foundIds = new Set(teams.map((t) => t.id));
    const notFound = teamIds.filter((id) => !foundIds.has(id));
    if (notFound.length > 0) {
      return {
        ok: false,
        status: 400,
        error: 'One or more team_ids not found',
        team_ids: notFound,
      };
    }
    const wrongEvent = teams.filter((t) => t.event_id !== event_id);
    if (wrongEvent.length > 0) {
      return {
        ok: false,
        status: 400,
        error: 'All teams must belong to the same event as the bracket',
        team_ids: wrongEvent.map((t) => t.id),
      };
    }

    const conflicts = await db.all<ConflictRow>(
      `SELECT be.team_id, t.team_number, t.team_name, b.id as bracket_id, b.name as bracket_name
       FROM bracket_entries be
       JOIN brackets b ON be.bracket_id = b.id
       JOIN teams t ON be.team_id = t.id
       WHERE b.event_id = ? AND be.team_id IS NOT NULL AND be.team_id IN (${placeholders})`,
      [event_id, ...teamIds],
    );
    if (conflicts.length > 0) {
      return {
        ok: false,
        status: 409,
        error:
          'One or more teams are already assigned to a bracket at this event',
        conflicts,
      };
    }

    const actualTeamCount = teamIds.length;
    const bracketSize = nextPowerOfTwo(actualTeamCount);
    if (bracketSize > 64) {
      return {
        ok: false,
        status: 400,
        error: `Too many teams (${actualTeamCount}). Maximum bracket size is 64.`,
      };
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
        `INSERT INTO brackets (event_id, name, bracket_size, actual_team_count, status, weight, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          event_id,
          name,
          bracketSize,
          actualTeamCount,
          status,
          bracketWeight,
          userId,
        ],
      );
      const newBracketId = br.lastID!;
      bracketId = newBracketId;

      for (let seedPosition = 1; seedPosition <= bracketSize; seedPosition++) {
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
    const templates = await db.all<BracketTemplateRow>(
      'SELECT * FROM bracket_templates WHERE bracket_size = ? ORDER BY game_number ASC',
      [bracketSize],
    );
    if (templates.length === 0) {
      return {
        ok: false,
        status: 400,
        error: `No bracket templates found for size ${bracketSize}`,
      };
    }

    const entriesBySeed = await loadEntriesBySeed(db, bracketId);
    const gameIdByNumber = await insertTemplateGames(db, bracketId, templates);
    await applyTemplateAssignments(
      db,
      templates,
      gameIdByNumber,
      entriesBySeed,
    );
    await markReadyGames(db, bracketId);
    await resolveBracketByes(db, bracketId);

    const bracket = await db.get('SELECT * FROM brackets WHERE id = ?', [
      bracketId,
    ]);
    return { ok: true, status: 201, bracket: bracket ?? {} };
  }

  // Legacy flow
  const bracket_size = body.bracket_size as number | undefined;
  if (!event_id || !name || !bracket_size) {
    return {
      ok: false,
      status: 400,
      error: 'event_id, name, and bracket_size are required',
    };
  }

  const result = await db.run(
    `INSERT INTO brackets (event_id, name, bracket_size, actual_team_count, status, weight, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      event_id,
      name,
      bracket_size,
      actual_team_count ?? null,
      status,
      bracketWeight,
      userId,
    ],
  );

  const bracket = await db.get('SELECT * FROM brackets WHERE id = ?', [
    result.lastID,
  ]);
  return { ok: true, status: 201, bracket: bracket ?? {} };
}
